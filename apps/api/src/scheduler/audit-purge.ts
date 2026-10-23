import { type AuditPurgeOutcome, runAuditPurge } from "../audit/purge";
import { withJobLease } from "./leader-lock";

// background-jobs.md: `audit-purge`, daily 03:00, lease TTL 30 minutes.
export const AUDIT_PURGE_JOB = "audit-purge";
export const AUDIT_PURGE_LEASE_MS = 30 * 60 * 1000;

export type AuditPurgeJobOutcome =
  | AuditPurgeOutcome
  | { status: "held_elsewhere"; degraded: false };

/**
 * The registered job body: leader-locked, idempotent (a rerun finds nothing past the last
 * anchor), and it emits the structured run line every job emits (job, duration, items,
 * outcome). Missing database prerequisites are a degraded, non-destructive run.
 */
export async function runAuditPurgeJob(): Promise<AuditPurgeJobOutcome> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease<AuditPurgeJobOutcome>(
      AUDIT_PURGE_JOB,
      () => runAuditPurge(),
      () => ({ status: "held_elsewhere", degraded: false }),
      AUDIT_PURGE_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: AUDIT_PURGE_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: outcome.status === "purged" ? outcome.purgedCount : 0,
        status: outcome.status,
        outcome: outcome.degraded ? "degraded" : "ok",
      }),
    );
    return outcome;
  } catch (error) {
    console.log(
      JSON.stringify({
        job: AUDIT_PURGE_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: null,
        outcome: "failed",
      }),
    );
    throw error;
  }
}
