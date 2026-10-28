import db from "../database";
import type { Executor } from "../database/executor";
import { appendAuditLog } from "./audit-writer";
import {
  type AuditPurgeBounds,
  auditPurgePrerequisitesPresent,
  fenceLegalHolds,
  purgeAuditPrefix,
  readAuditPurgeBounds,
  readAuditPurgeCutoff,
} from "./purge.repository";
import { lockAuditChain } from "./repository";

/**
 * `audit-purge` (`background-jobs.md`: daily 03:00, lease 30 min; `AU-3`, `AU-6`, `AU-13`,
 * `PA-12`).
 *
 * Deletes only the **oldest contiguous prefix** of the chain (`AU-3`: "only the
 * oldest-past-retention range"): the prefix stops at the first row that is still inside
 * retention or whose organisation/actor is under an open `legal_hold`, and it never includes
 * the chain head. Skipping held rows in the middle of a range would punch several holes that a
 * single `audit_chain_anchor` cannot describe, so a held row conservatively retains everything
 * newer than it until the hold lifts. The anchor is written before the delete in the same
 * transaction by `audit_log_purge_prefix` itself (migration 0132), which also enforces a
 * hard-coded 12-month retention floor: the application supplies only the cut-off `seq`, never
 * the anchor, and holds no INSERT on `audit_chain_anchor`. The purge appends its own
 * `audit.purged` row (`AU-6`) in that transaction.
 */

/**
 * `AU-13`: "the same configurable window (12 months by default)". No stored setting exists yet.
 * The database function enforces 12 months as an absolute floor, so a shorter value passed here
 * makes the purge fail loudly (the function refuses) rather than delete early.
 */
export const DEFAULT_AUDIT_RETENTION = "12 months";
/** Rows deleted per run at most; a backlog drains over successive nights. */
export const AUDIT_PURGE_MAX_ROWS = 10_000;
export const AUDIT_PURGE_ACTOR = "audit-purge";

/**
 * Pure plan: the exclusive upper `seq` bound of the deletable prefix, or `null` when nothing
 * may be deleted. The head is always kept so the next append still chains from a real row.
 */
export function planAuditPurge(bounds: AuditPurgeBounds): bigint | null {
  if (bounds.headSeq === null) return null;
  let below = bounds.headSeq;
  if (bounds.firstBlockedSeq !== null && bounds.firstBlockedSeq < below)
    below = bounds.firstBlockedSeq;
  if (bounds.capSeq !== null && bounds.capSeq < below) below = bounds.capSeq;
  return below;
}

export type AuditPurgeOutcome =
  | {
      status: "skipped";
      reason: "prerequisites_missing";
      degraded: true;
    }
  | { status: "nothing_to_purge"; degraded: false }
  | {
      status: "purged";
      anchorId: string;
      purgedCount: number;
      degraded: false;
    };

export async function runAuditPurge(
  options: { retention?: string; maxRows?: number; executor?: Executor } = {},
): Promise<AuditPurgeOutcome> {
  const retention = options.retention ?? DEFAULT_AUDIT_RETENTION;
  const maxRows = options.maxRows ?? AUDIT_PURGE_MAX_ROWS;
  const executor = options.executor ?? db;

  return executor.transaction(async (tx) => {
    const prerequisites = await auditPurgePrerequisitesPresent(tx);
    if (!prerequisites.anchorTable || !prerequisites.purgeFunction) {
      return {
        status: "skipped" as const,
        reason: "prerequisites_missing" as const,
        degraded: true as const,
      };
    }

    await lockAuditChain(tx);
    await fenceLegalHolds(tx);

    const below = planAuditPurge(
      await readAuditPurgeBounds(tx, retention, maxRows),
    );
    if (below === null) {
      return { status: "nothing_to_purge" as const, degraded: false as const };
    }
    const throughSeq = await readAuditPurgeCutoff(tx, below);
    if (throughSeq === null) {
      return { status: "nothing_to_purge" as const, degraded: false as const };
    }

    // The database function enforces the retention floor, holds and head rule, then computes
    // and writes the anchor itself and deletes. Any refusal aborts the whole transaction.
    const range = await purgeAuditPrefix(tx, throughSeq);
    const anchorId = range.anchorId;

    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      action: "audit.purged",
      entityType: "audit_chain_anchor",
      entityId: anchorId,
      before: null,
      after: {
        job: AUDIT_PURGE_ACTOR,
        purgedCount: range.purgedCount,
        firstPurgedCreatedAt: range.firstPurgedCreatedAt,
        purgedThroughAt: range.purgedThroughAt,
        retention,
      },
    });

    return {
      status: "purged" as const,
      anchorId,
      purgedCount: range.purgedCount,
      degraded: false as const,
    };
  });
}
