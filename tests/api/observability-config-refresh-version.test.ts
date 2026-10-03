import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import {
  createObservabilityConfigRefresher,
  type ObservabilityConfigSnapshot,
} from "../../apps/api/src/instance/observability/config-refresh-version";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("observability config refresh ordering", () => {
  it("ignores an older overlapping read after a newer snapshot applies", async () => {
    const pending = [
      deferred<ObservabilityConfigSnapshot | undefined>(),
      deferred<ObservabilityConfigSnapshot | undefined>(),
    ];
    let reads = 0;
    const applied: unknown[] = [];
    const controller = createObservabilityConfigRefresher({
      read: () => pending[reads++]?.promise ?? Promise.resolve(undefined),
      validate: (levels) => levels,
      apply: (levels) => applied.push(levels),
      onFailure: () => assert.fail("valid snapshots must not fail"),
      initialVersion: 4,
    });

    const older = controller.refresh();
    const newer = controller.refresh();
    pending[1]?.resolve({ version: 6, levels: "newer" });
    await newer;
    pending[0]?.resolve({ version: 5, levels: "older" });
    await older;

    expect(applied).toEqual(["newer"]);
  });

  it("logs one warning per failure interval and validates same-version recovery", async () => {
    const results: Array<ObservabilityConfigSnapshot | Error> = [
      new Error("database unavailable"),
      { version: 4, levels: "valid" },
      new Error("database unavailable again"),
    ];
    let validations = 0;
    let warnings = 0;
    const controller = createObservabilityConfigRefresher({
      read: async () => {
        const result = results.shift();
        if (result instanceof Error) throw result;
        return result;
      },
      validate: (levels) => {
        validations += 1;
        if (levels !== "valid") throw new Error("invalid levels");
        return levels;
      },
      apply: () => assert.fail("same-version recovery must not reapply"),
      onFailure: () => {
        warnings += 1;
      },
      initialVersion: 4,
    });

    await controller.refresh();
    await controller.refresh();
    await controller.refresh();

    expect(validations).toBe(1);
    expect(warnings).toBe(2);
  });

  it("does not let an older success reset a newer failure interval", async () => {
    const staleRead = deferred<ObservabilityConfigSnapshot | undefined>();
    const results: Array<ObservabilityConfigSnapshot | Error> = [
      new Error("newer failure"),
      new Error("failure remains active"),
      { version: 4, levels: "valid" },
      new Error("new failure interval"),
    ];
    let calls = 0;
    let validations = 0;
    let warnings = 0;
    const controller = createObservabilityConfigRefresher({
      read: () => {
        calls += 1;
        if (calls === 1) return staleRead.promise;
        const result = results.shift();
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result);
      },
      validate: (levels) => {
        validations += 1;
        if (levels !== "valid") throw new Error("invalid levels");
        return levels;
      },
      apply: () => assert.fail("same-version recovery must not reapply"),
      onFailure: () => {
        warnings += 1;
      },
      initialVersion: 4,
    });

    const stale = controller.refresh();
    await controller.refresh();
    staleRead.resolve({ version: 4, levels: "valid" });
    await stale;
    await controller.refresh();
    expect(warnings).toBe(1);
    expect(validations).toBe(1);

    await controller.refresh();
    await controller.refresh();
    expect(warnings).toBe(2);
    expect(validations).toBe(2);
  });

  it("discards a refresh that completes after shutdown", async () => {
    const pending = deferred<ObservabilityConfigSnapshot | undefined>();
    const applied: unknown[] = [];
    let warnings = 0;
    const controller = createObservabilityConfigRefresher({
      read: () => pending.promise,
      validate: (levels) => levels,
      apply: (levels) => applied.push(levels),
      onFailure: () => {
        warnings += 1;
      },
      initialVersion: 4,
    });

    const refresh = controller.refresh();
    controller.stop();
    pending.resolve({ version: 5, levels: "late" });
    await refresh;

    expect(applied).toEqual([]);
    expect(warnings).toBe(0);
  });
});
