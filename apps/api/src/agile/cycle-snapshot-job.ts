import { withJobLease } from "../scheduler/leader-lock";
import { snapshotEndedCycles } from "./cycle.repository";

/** Daily CY-9 snapshot backstop; scheduler cadence is registered centrally. */
export const CYCLE_SNAPSHOT_JOB = "cycle-snapshot";
export const CYCLE_SNAPSHOT_LEASE_MS = 15 * 60 * 1000;

export type CycleSnapshotJobOutcome =
  | (Awaited<ReturnType<typeof snapshotEndedCycles>> & {
      status: "completed";
    })
  | { status: "held_elsewhere"; degraded: false };

/** Lease-guarded entry point registered by the shared scheduler. */
export async function runCycleSnapshotJob(): Promise<CycleSnapshotJobOutcome> {
  const startedAt = Date.now();
  try {
    const result = await withJobLease<CycleSnapshotJobOutcome>(
      CYCLE_SNAPSHOT_JOB,
      async () => ({
        ...(await snapshotEndedCycles(new Date())),
        status: "completed",
      }),
      () => ({ status: "held_elsewhere", degraded: false }),
      CYCLE_SNAPSHOT_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: CYCLE_SNAPSHOT_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: "scanned" in result ? result.created : 0,
        status: result.status,
        outcome: "degraded" in result && result.degraded ? "degraded" : "ok",
      }),
    );
    return result;
  } catch (error) {
    console.log(
      JSON.stringify({
        job: CYCLE_SNAPSHOT_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: null,
        outcome: "failed",
      }),
    );
    throw error;
  }
}
