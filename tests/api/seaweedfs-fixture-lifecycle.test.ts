import { inspect, isDeepStrictEqual } from "node:util";
import * as vitest from "vitest";
import { afterEach, expect, it, vi } from "vitest";

function assertRestored(actual: object, expected: object) {
  expect(isDeepStrictEqual(actual, expected)).toBe(true);
}

it("does not disclose environment values when restoration fails", () => {
  let diagnostic = "";
  try {
    assertRestored(
      { S3_SECRET: "synthetic-actual-secret" },
      { S3_SECRET: "synthetic-expected-secret" },
    );
  } catch (error) {
    diagnostic = inspect(error, { showHidden: true, depth: 5 });
  }
  expect(diagnostic.length > 0).toBe(true);
  expect(
    diagnostic.includes("synthetic-actual-secret") ||
      diagnostic.includes("synthetic-expected-secret"),
  ).toBe(false);
});

const containerId = "a".repeat(64);
const networkId = "b".repeat(64);

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.doUnmock("vitest");
  vi.doUnmock("node:child_process");
  vi.doUnmock("node:fs");
  vi.doUnmock("node:module");
  vi.doUnmock("node:timers/promises");
  vi.doUnmock("../../apps/api/src/storage/s3");
  vi.resetModules();
});

async function fixture(
  phase: "bucket" | "delay" | "cors" | "network-failure" | "config-failure",
) {
  let setup!: () => Promise<void>;
  let cleanup!: () => Promise<void>;
  const pending = deferred();
  const events: string[] = [];
  void pending.promise.then(
    () => events.push("pending settled"),
    () => events.push("pending settled"),
  );
  let sends = 0;
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith("S3_")),
  );

  vi.doMock("vitest", () => ({
    ...vitest,
    describe: (_name: string, register: () => void) => register(),
    beforeAll: (hook: typeof setup) => {
      setup = hook;
    },
    afterAll: (hook: typeof cleanup) => {
      cleanup = hook;
    },
    it: () => {},
  }));
  vi.doMock("node:child_process", () => ({
    execFileSync: (_program: string, args: string[]) => {
      events.push(args.join(" "));
      if (
        phase === "network-failure" &&
        args[0] === "network" &&
        args[1] === "create"
      )
        throw new Error("synthetic Docker failure");
      if (args[0] === "network" && args[1] === "create") return networkId;
      if (args[0] === "create") return containerId;
      if (args[0] === "port") return "127.0.0.1:12345";
      return "";
    },
  }));
  vi.doMock("node:fs", () => ({
    mkdtempSync: () => "/synthetic/seaweedfs",
    writeFileSync: () => {
      events.push("config write");
      if (phase === "config-failure") throw new Error("synthetic private path");
    },
    rmSync: () => {
      events.push("directory remove");
    },
  }));
  vi.doMock("node:module", () => ({
    createRequire: () => () => ({
      S3Client: class {
        send(_command: unknown, options?: { abortSignal?: AbortSignal }) {
          sends++;
          const isCors = sends > (phase === "delay" ? 2 : 1);
          events.push(isCors ? "cors send" : "bucket send");
          if (phase === "delay" && sends === 1)
            return Promise.reject(new Error("not ready"));
          if ((phase === "bucket" && !isCors) || (phase === "cors" && isCors)) {
            options?.abortSignal?.addEventListener(
              "abort",
              () => pending.reject(new Error("aborted")),
              { once: true },
            );
            return pending.promise;
          }
          return Promise.resolve();
        }
        destroy() {
          events.push("destroy");
        }
      },
      CreateBucketCommand: class {},
      PutBucketCorsCommand: class {},
    }),
  }));
  vi.doMock("node:timers/promises", () => ({
    setTimeout: (
      _ms: number,
      _value: unknown,
      options?: { signal?: AbortSignal },
    ) => {
      events.push("retry delay");
      options?.signal?.addEventListener(
        "abort",
        () => pending.reject(new Error("aborted")),
        { once: true },
      );
      return pending.promise;
    },
  }));
  vi.doMock("../../apps/api/src/storage/s3", () => ({
    createAttachmentDownloadUrl: vi.fn(),
    createAttachmentUploadUrl: vi.fn(),
    deleteS3Object: vi.fn(),
    finalizeAttachmentObject: vi.fn(),
  }));
  vi.resetModules();
  await import("../api-integration/seaweedfs-s3.test");
  return {
    setup,
    cleanup,
    pending,
    events,
    environment,
    restoreEnvironment() {
      for (const key of Object.keys(process.env))
        if (key.startsWith("S3_")) delete process.env[key];
      Object.assign(process.env, environment);
    },
  };
}

for (const phase of ["bucket", "delay", "cors"] as const) {
  it(`settles ${phase} setup before destroying resources`, async () => {
    const run = await fixture(phase);
    let setupResult: Promise<void> | undefined;
    try {
      setupResult = run.setup();
      await vi.waitFor(() =>
        expect(run.events).toContain(
          phase === "delay" ? "retry delay" : `${phase} send`,
        ),
      );
      await run.cleanup();
      expect(run.events.indexOf("pending settled")).toBeGreaterThanOrEqual(0);
      expect(run.events.indexOf("destroy")).toBeGreaterThan(
        run.events.indexOf("pending settled"),
      );
      await expect(setupResult).rejects.toThrow(
        /SeaweedFS compatibility setup failed/,
      );
      expect(run.events.indexOf("destroy")).toBeGreaterThan(
        run.events.indexOf(phase === "delay" ? "retry delay" : `${phase} send`),
      );
      expect(run.events).toContain(`rm --force ${containerId}`);
      expect(run.events).toContain(`network rm ${networkId}`);
      expect(run.events.at(-1)).toBe("directory remove");
      assertRestored(
        Object.fromEntries(
          Object.entries(process.env).filter(([key]) => key.startsWith("S3_")),
        ),
        run.environment,
      );
      const count = run.events.length;
      await Promise.resolve();
      expect(run.events).toHaveLength(count);
    } finally {
      run.pending.resolve();
      await setupResult?.catch(() => {});
      run.restoreEnvironment();
    }
  });
}

for (const phase of ["config-failure", "network-failure"] as const)
  it(`cleans ${phase} without touching unowned resources`, async () => {
    const run = await fixture(phase);
    try {
      await expect(run.setup()).rejects.toThrow(
        new RegExp(
          phase === "config-failure" ? "configuration" : "network creation",
        ),
      );
      await run.cleanup();
      expect(run.events).not.toContain(`rm --force ${containerId}`);
      expect(run.events).not.toContain(`network rm ${networkId}`);
      expect(run.events).toContain("directory remove");
    } finally {
      run.pending.resolve();
      run.restoreEnvironment();
    }
  });
