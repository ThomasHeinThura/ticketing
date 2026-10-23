import {
  type PositionRebalanceOutcome,
  type RankPartition,
  recoverDensePositionPartitions,
} from "./position-rebalance";

type RecoveredPartition = {
  partition: RankPartition;
  outcome: PositionRebalanceOutcome;
};

export type PositionRebalanceJobOutcome = {
  partitions: number;
  rebalanced: number;
  changed: number;
  deferred: number;
  degraded: boolean;
};

/** Partitions renumbered per run; the next run picks up any remainder (WI-12). */
export const POSITION_REBALANCE_BATCH = 50;
/** A partition larger than this is deferred, never renumbered inside one scheduled run. */
export const POSITION_REBALANCE_MAX_PARTITION_ROWS = 5000;

/**
 * `position-rebalance` (`WI-12`, `background-jobs.md`): finds every state/backlog partition whose
 * neighbouring `work_item.position` gap fell below 1e-6 and renumbers it. Rank writes already
 * rebalance their own partition on demand; this job is the backstop for partitions a rank write
 * could not renumber (busy, lease held elsewhere) and for any density a bulk write left behind.
 *
 * Idempotent: `rebalancePositionPartition` re-checks density under the partition's advisory lock
 * and reports `healthy` without writing, and each run is bounded.
 *
 * `busy` and `leased` are normal contention and not a failure; `bounded` (partition over the row
 * cap) and `unavailable` (project gone) cannot make progress on a retry and are surfaced as
 * `degraded` so the scheduler logs them. `scanRows` is deliberately not passed: that option
 * samples by `ORDER BY id LIMIT n`, which would starve partitions beyond the first n ids forever.
 */
export async function runPositionRebalanceJob(
  recover: (
    limit: number,
    options: { maxPartitionRows: number },
  ) => Promise<RecoveredPartition[]> = recoverDensePositionPartitions,
): Promise<PositionRebalanceJobOutcome> {
  const results = await recover(POSITION_REBALANCE_BATCH, {
    maxPartitionRows: POSITION_REBALANCE_MAX_PARTITION_ROWS,
  });
  let rebalanced = 0;
  let changed = 0;
  let deferred = 0;
  let degraded = false;
  for (const { outcome } of results) {
    if (outcome.status === "rebalanced") {
      rebalanced += 1;
      changed += outcome.changed;
    } else if (outcome.status === "busy" || outcome.status === "leased") {
      deferred += 1;
    } else if (
      outcome.status === "bounded" ||
      outcome.status === "unavailable"
    ) {
      degraded = true;
    }
  }
  return {
    partitions: results.length,
    rebalanced,
    changed,
    deferred,
    degraded,
  };
}
