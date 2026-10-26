import { describe, expect, it, vi } from "vitest";
import { runStorageProbe } from "../../../apps/api/src/instance/storage/probe";
import type { StorageProbeAdapter } from "../../../apps/api/src/storage";
import { StorageProbeCollisionError } from "../../../apps/api/src/storage/probe-error";

const ID = "e21a9b3f-8a77-42be-9864-63d35c925735";

function memoryAdapter(overrides: Partial<StorageProbeAdapter> = {}) {
  let object: Buffer | undefined;
  const calls: string[] = [];
  const adapter: StorageProbeAdapter = {
    driver: "filesystem",
    async write(key, bytes, signal) {
      calls.push(`write:${key}`);
      if (signal.aborted) throw signal.reason;
      object = Buffer.from(bytes);
    },
    async read(key, maxBytes, signal) {
      calls.push(`read:${key}`);
      if (signal.aborted || !object || object.length > maxBytes)
        throw signal.reason ?? new Error("unavailable");
      return Buffer.from(object);
    },
    async delete(key, signal) {
      calls.push(`delete:${key}`);
      if (signal.aborted) throw signal.reason;
      object = undefined;
    },
    ...overrides,
  };
  return { adapter, calls, getObject: () => object };
}

describe("storage probe orchestration", () => {
  it("writes, verifies, and deletes one generated reserved key", async () => {
    const storage = memoryAdapter();
    const result = await runStorageProbe(storage.adapter, {
      createId: () => ID,
      now: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(137),
    });
    expect(result).toEqual({
      status: "verified",
      cleanup: "confirmed",
      durationMs: 37,
    });
    expect(storage.calls).toEqual([
      `write:taskdesk-storage-probe-${ID}`,
      `read:taskdesk-storage-probe-${ID}`,
      `delete:taskdesk-storage-probe-${ID}`,
    ]);
    expect(storage.getObject()).toBeUndefined();
  });

  it("never reports verified when stored bytes differ", async () => {
    const storage = memoryAdapter({
      async read() {
        return Buffer.from("different");
      },
    });
    const result = await runStorageProbe(storage.adapter, {
      createId: () => ID,
    });
    expect(result.status).toBe("content_mismatch");
    expect(result.cleanup).toBe("confirmed");
    expect(storage.getObject()).toBeUndefined();
  });

  it("reports cleanup uncertainty after a write timeout", async () => {
    let finishWrite: (() => void) | undefined;
    const lateWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const storage = memoryAdapter({
      async write() {
        await lateWrite;
      },
    });
    const result = await runStorageProbe(storage.adapter, {
      createId: () => ID,
    });
    expect(result.status).toBe("cleanup_indeterminate");
    expect(result.cleanup).toBe("indeterminate");
    finishWrite?.();
    await vi.waitFor(() =>
      expect(storage.calls).toContain(`delete:taskdesk-storage-probe-${ID}`),
    );
  }, 5_000);

  it("does not delete a key after an exclusive-create failure", async () => {
    const storage = memoryAdapter({
      async write() {
        throw new StorageProbeCollisionError();
      },
    });
    const result = await runStorageProbe(storage.adapter, {
      createId: () => ID,
    });
    expect(result).toMatchObject({
      status: "write_failed",
      cleanup: "not_attempted",
    });
    expect(storage.calls).toHaveLength(0);
  });

  it("rejects a malformed generated id before touching the adapter", async () => {
    const storage = memoryAdapter();
    await expect(
      runStorageProbe(storage.adapter, { createId: () => "bad" }),
    ).rejects.toThrow("Storage probe identifier generation failed.");
    expect(storage.calls).toHaveLength(0);
  });
});
