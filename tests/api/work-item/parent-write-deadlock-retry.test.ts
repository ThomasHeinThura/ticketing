/**
 * Issue #295 -- unit coverage of `runWithParentWriteDeadlockRetry`'s own retry logic,
 * isolated from a real Postgres connection (the live, genuine trigger-pair deadlock
 * reproduction is `tests/api-integration/work-item-parent-write-deadlock-retry.test.ts`).
 *
 * Mirrors `transition-deadlock.test.ts`'s own "unit test the mapping predicate, prove the
 * live case separately" split, one level up: this proves the WRAPPER (retries a bounded
 * number of times on `40P01`, never on anything else, and re-invokes the callback from
 * scratch on each attempt rather than only inspecting the first error).
 */
import { describe, expect, it, vi } from "vitest";
import { runWithParentWriteDeadlockRetry } from "../../../apps/api/src/work-item/parent-write-deadlock-retry";

function deadlockError(): Error {
  // Same wrapped shape `isPostgresDeadlockError`'s own tests use -- Drizzle hangs the
  // real driver error off `.cause`, never on the top-level `.code`.
  return new Error('Failed query: update "work_item" …', {
    cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }),
  });
}

describe("runWithParentWriteDeadlockRetry", () => {
  it("returns the first attempt's result when there is no error at all", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(runWithParentWriteDeadlockRetry(run)).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries a genuine 40P01 and succeeds once the callback stops deadlocking", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(deadlockError())
      .mockRejectedValueOnce(deadlockError())
      .mockResolvedValueOnce("committed on the third try");

    await expect(runWithParentWriteDeadlockRetry(run)).resolves.toBe(
      "committed on the third try",
    );
    // Re-invoked from scratch each time -- never just re-inspecting the first error.
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not retry a different error at all -- only 40P01 is retry-safe here", async () => {
    const notFound = new Error("Work item not found");
    const run = vi.fn().mockRejectedValue(notFound);

    await expect(runWithParentWriteDeadlockRetry(run)).rejects.toBe(notFound);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after a bounded number of attempts and surfaces the last deadlock, never hangs", async () => {
    const run = vi.fn().mockRejectedValue(deadlockError());

    await expect(runWithParentWriteDeadlockRetry(run)).rejects.toThrow(
      /Failed query/,
    );
    // Bounded: a fixed, small number of attempts, not an unbounded retry loop.
    expect(run.mock.calls.length).toBeGreaterThan(1);
    expect(run.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
