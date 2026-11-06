import { describe, expect, it, vi } from "vitest";
import { runStorageProbe } from "../../../apps/api/src/instance/storage/probe";
import type { StorageProbeAdapter } from "../../../apps/api/src/storage";
import { StorageProbeCollisionError } from "../../../apps/api/src/storage/probe-error";

const ID = "e21a9b3f-8a77-42be-9864-63d35c925735";

function memoryAdapter(overrides: Partial<StorageProbeAdapter> = {}) {
  let object: Buffer | undefined;
  const adapter: StorageProbeAdapter = {
    driver: "filesystem",
    write: vi.fn(async (_key, bytes) => {
      object = Buffer.from(bytes);
    }),
    read: vi.fn(async () => Buffer.from(object ?? "")),
    ...overrides,
  };
  return {
    adapter,
    getObject: () => object,
    replace: (bytes: string) => {
      object = Buffer.from(bytes);
    },
  };
}

describe("storage probe orchestration", () => {
  it("verifies bytes and retains the diagnostic object", async () => {
    const storage = memoryAdapter();
    const result = await runStorageProbe(storage.adapter, {
      createId: () => ID,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(137),
    });
    expect(result).toEqual({
      status: "verified",
      cleanup: "not_attempted",
      diagnosticObjectMayRemain: true,
      durationMs: 37,
    });
    expect(storage.getObject()).toBeDefined();
  });

  it.each([
    ["content_mismatch", async () => Buffer.from("different")],
    [
      "read_failed",
      async () => {
        throw new Error("secret key");
      },
    ],
  ] as const)(
    "reports %s without deleting a replacement or exposing errors",
    async (status, read) => {
      const storage = memoryAdapter({
        read: vi.fn(async () => {
          storage.replace("replacement");
          return read();
        }),
      });
      const result = await runStorageProbe(storage.adapter, {
        createId: () => ID,
      });
      expect(result).toMatchObject({
        status,
        cleanup: "not_attempted",
        diagnosticObjectMayRemain: true,
      });
      expect(JSON.stringify(result)).not.toContain("secret key");
      expect(storage.getObject()?.toString()).toBe("replacement");
    },
  );

  it.each([
    [new StorageProbeCollisionError(), false],
    [new Error("secret key"), true],
  ])(
    "reports write failure conservatively",
    async (error, diagnosticObjectMayRemain) => {
      const storage = memoryAdapter({
        write: vi.fn(async () => {
          throw error;
        }),
      });
      const result = await runStorageProbe(storage.adapter, {
        createId: () => ID,
      });
      expect(result).toMatchObject({
        status: "write_failed",
        cleanup: "not_attempted",
        diagnosticObjectMayRemain,
      });
      expect(JSON.stringify(result)).not.toContain("secret key");
    },
  );

  it("reports possible residue when an S3 retry returns a collision", async () => {
    const storage = memoryAdapter({
      driver: "s3",
      write: vi.fn(async () => {
        storage.replace("committed before response was lost");
        throw new StorageProbeCollisionError();
      }),
    });
    const result = await runStorageProbe(storage.adapter, {
      createId: () => ID,
    });
    expect(result).toMatchObject({
      status: "write_failed",
      cleanup: "not_attempted",
      diagnosticObjectMayRemain: true,
    });
    expect(storage.getObject()).toBeDefined();
    expect(storage.adapter.read).not.toHaveBeenCalled();
  });

  it.each(["resolve", "reject"] as const)(
    "never deletes after a late write %s",
    async (outcome) => {
      vi.useFakeTimers();
      try {
        let finish!: () => void;
        const pending = new Promise<void>((resolve, reject) => {
          finish = () =>
            outcome === "resolve"
              ? resolve()
              : reject(new Error("late failure"));
        });
        const storage = memoryAdapter({ write: vi.fn(() => pending) });
        const resultPromise = runStorageProbe(storage.adapter, {
          createId: () => ID,
        });
        await vi.advanceTimersByTimeAsync(2_000);
        expect(await resultPromise).toMatchObject({
          status: "timed_out",
          cleanup: "not_attempted",
          diagnosticObjectMayRemain: true,
        });
        storage.replace("replacement");
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(storage.getObject()?.toString()).toBe("replacement");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("bounds a stalled read and retains the diagnostic object", async () => {
    vi.useFakeTimers();
    try {
      const storage = memoryAdapter({
        read: vi.fn(() => new Promise<Buffer>(() => {})),
      });
      const result = runStorageProbe(storage.adapter, {
        createId: () => ID,
        now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(20_000),
      });
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await result).toMatchObject({
        status: "timed_out",
        cleanup: "not_attempted",
        diagnosticObjectMayRemain: true,
        durationMs: 15_000,
      });
      expect(storage.getObject()).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects malformed generated ids without touching storage", async () => {
    const storage = memoryAdapter();
    await expect(
      runStorageProbe(storage.adapter, { createId: () => "bad" }),
    ).rejects.toThrow("Storage probe identifier generation failed.");
    expect(storage.adapter.write).not.toHaveBeenCalled();
  });
});
