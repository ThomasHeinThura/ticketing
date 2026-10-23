import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../../apps/api/src/scheduler";
import type { PositionRebalanceOutcome } from "../../../apps/api/src/scheduler/position-rebalance";
import {
  POSITION_REBALANCE_BATCH,
  POSITION_REBALANCE_MAX_PARTITION_ROWS,
  runPositionRebalanceJob,
} from "../../../apps/api/src/scheduler/position-rebalance-job";

const partition = (id: string) => ({
  workspaceId: "w",
  projectId: "p",
  stateId: id,
});
const outcome = (
  status: PositionRebalanceOutcome["status"],
  changed = 0,
): PositionRebalanceOutcome => ({ status, changed });

describe("position-rebalance schedule", () => {
  afterEach(shutdownScheduler);

  it("registers the named handler every five minutes", () => {
    initializeScheduler();
    const job = registeredJobByName("position-rebalance");
    expect(job?.getPattern()).toBe("*/5 * * * *");
    expect(typeof (job as unknown as { fn?: unknown })?.fn).toBe("function");
  });
});

describe("runPositionRebalanceJob", () => {
  it("passes bounded limits and never a sampling scan bound", async () => {
    const recover = vi.fn().mockResolvedValue([]);
    await runPositionRebalanceJob(recover);
    expect(recover).toHaveBeenCalledWith(POSITION_REBALANCE_BATCH, {
      maxPartitionRows: POSITION_REBALANCE_MAX_PARTITION_ROWS,
    });
  });

  it("is a healthy no-op when nothing is dense", async () => {
    expect(await runPositionRebalanceJob(async () => [])).toEqual({
      partitions: 0,
      rebalanced: 0,
      changed: 0,
      deferred: 0,
      degraded: false,
    });
  });

  it("counts rebalanced rows and treats contention as normal, not degraded", async () => {
    const result = await runPositionRebalanceJob(async () => [
      { partition: partition("a"), outcome: outcome("rebalanced", 7) },
      { partition: partition("b"), outcome: outcome("healthy") },
      { partition: partition("c"), outcome: outcome("busy") },
      { partition: partition("d"), outcome: outcome("leased") },
    ]);
    expect(result).toEqual({
      partitions: 4,
      rebalanced: 1,
      changed: 7,
      deferred: 2,
      degraded: false,
    });
  });

  it.each(["bounded", "unavailable"] as const)(
    "reports %s partitions as degraded",
    async (status) => {
      const result = await runPositionRebalanceJob(async () => [
        { partition: partition("a"), outcome: outcome(status) },
      ]);
      expect(result.degraded).toBe(true);
    },
  );

  it("propagates a recovery failure so the scheduler logs the run as failed", async () => {
    await expect(
      runPositionRebalanceJob(async () => {
        throw new Error("db down");
      }),
    ).rejects.toThrow("db down");
  });
});
