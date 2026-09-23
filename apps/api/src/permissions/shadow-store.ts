/**
 * Issue #8, Slice 2 — the shadow-evidence writer.
 *
 * Every write here happens AFTER the response has already been produced, off the request's
 * own promise chain (`shadow-middleware.ts` fires this and does not await it) — a failed
 * write is caught here and logged; it never becomes a changed response or added request
 * latency. That is the requirement in the brief ("Writes never affect the request... A
 * failed write shows up as a log line and never as a changed response").
 *
 * Uses `db` from `apps/api/src/database` (the shared connection) but never touches that
 * file, or `schema.ts` — this module's own `shadow-schema.ts` declares the two tables it
 * writes to. Runs as the ordinary application role: this deployment provisions exactly one
 * Postgres role (decision log, 2026-09-23, "audit_log is append-only by trigger, not by
 * grant"), so there is no separate maintenance role to prefer for the pruning DELETEs below.
 */

import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import db from "../database";
import {
  policyShadowEventTable,
  policyShadowTallyTable,
  type ShadowOutcome,
} from "./shadow-schema";

const RETENTION_DAYS = 30;
/** Addendum: "capped at 50 rows per (day, route_key, outcome, reason_code)". */
const MAX_EVENT_ROWS_PER_BUCKET = 50;
/** Bounded delete per prune pass, per table — never one unbounded statement. */
const PRUNE_BATCH_SIZE = 5_000;

export type ShadowRecord = {
  readonly day: string; // YYYY-MM-DD, UTC
  readonly routeKey: string;
  readonly routerGroup: string;
  readonly outcome: ShadowOutcome;
  readonly reasonCode: string | null;
  readonly policyKind: string | null;
  readonly policyCapability: string | null;
  readonly legacyAllowed: boolean | null;
  readonly legacyStatus: number | null;
  readonly policyAllowed: boolean | null;
  readonly policyStatus: number | null;
  readonly policyCode: string | null;
  readonly diagnostic: string | null;
  readonly identityKind: string | null;
  readonly workspaceId: string | null;
  readonly traceId: string | null;
};

/** Today's UTC date as `YYYY-MM-DD` — the bucket key every tally/prune decision uses. */
export function utcDateString(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

let lastPruneDay: string | null = null;

/**
 * #323 Opus S6: the old guard was set BEFORE the deletes, so one failed prune was not
 * retried until the next UTC day; and a single bounded pass (5,000/table) could never keep
 * up with a day's worst-case bucket growth, so the backlog grew for good. Now: loop
 * bounded batches until a pass deletes fewer than `PRUNE_BATCH_SIZE` rows (per table),
 * with a total ceiling so one prune still cannot run away; and set the day-guard only
 * AFTER a fully successful prune — a failure logs and leaves the guard unset, so the next
 * `recordShadowOutcome` retries within the same day. There is no job runner yet
 * (`apps/api/src/jobs/` does not exist, and `docs/01-architecture/background-jobs.md`'s
 * closed list has nothing to add this to) — see that document for the real mechanism this
 * should move onto once one exists.
 */
const PRUNE_TOTAL_CAP = 200_000;

async function pruneIfDue(now: Date): Promise<void> {
  const today = utcDateString(now);
  if (lastPruneDay === today) {
    return;
  }

  const cutoffDay = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const cutoffDayString = utcDateString(cutoffDay);
  const cutoffTimestamp = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);

  try {
    let totalDeleted = 0;
    for (;;) {
      const tallyResult = await db.execute(sql`
        DELETE FROM ${policyShadowTallyTable}
        WHERE ctid IN (
          SELECT ctid FROM ${policyShadowTallyTable}
          WHERE ${policyShadowTallyTable.day} < ${cutoffDayString}
          LIMIT ${PRUNE_BATCH_SIZE}
        )
      `);
      const eventResult = await db.execute(sql`
        DELETE FROM ${policyShadowEventTable}
        WHERE ctid IN (
          SELECT ctid FROM ${policyShadowEventTable}
          WHERE ${policyShadowEventTable.createdAt} < ${cutoffTimestamp}
          LIMIT ${PRUNE_BATCH_SIZE}
        )
      `);
      const tallyDeleted = Number(tallyResult.rowCount ?? 0);
      const eventDeleted = Number(eventResult.rowCount ?? 0);
      totalDeleted += tallyDeleted + eventDeleted;
      const drained =
        tallyDeleted < PRUNE_BATCH_SIZE && eventDeleted < PRUNE_BATCH_SIZE;
      if (drained || totalDeleted >= PRUNE_TOTAL_CAP) {
        break;
      }
    }
    lastPruneDay = today; // only after the whole prune succeeded (S6).
  } catch (error) {
    console.error("policy shadow: prune failed", error);
    // Guard stays unset so the next record retries within this same UTC day.
  }
}

/**
 * Upserts the tally bucket (`count = count + 1`), and — for every non-`agree` outcome —
 * inserts an event row, guarded by an `INSERT … SELECT … WHERE` count check against the
 * same bucket rather than a hard database constraint. Under true concurrent writers to the
 * same bucket, two inserts can each read the count before either commits and both pass the
 * guard — an accepted, documented residual (the cap is an evidence-volume bound, not a
 * security control), never a correctness requirement this file promises exactly 50.
 */
export async function recordShadowOutcome(record: ShadowRecord): Promise<void> {
  try {
    await db
      .insert(policyShadowTallyTable)
      .values({
        id: createId(),
        day: record.day,
        routeKey: record.routeKey,
        routerGroup: record.routerGroup,
        outcome: record.outcome,
        reasonCode: record.reasonCode,
        count: 1,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          policyShadowTallyTable.day,
          policyShadowTallyTable.routeKey,
          policyShadowTallyTable.outcome,
          policyShadowTallyTable.reasonCode,
        ],
        set: {
          count: sql`${policyShadowTallyTable.count} + 1`,
          lastSeenAt: new Date(),
        },
      });
  } catch (error) {
    console.error("policy shadow: tally write failed", error, {
      routeKey: record.routeKey,
      outcome: record.outcome,
    });
  }

  if (record.outcome !== "agree") {
    try {
      await db.execute(sql`
        INSERT INTO ${policyShadowEventTable} (
          id, day, route_key, router_group, policy_kind, policy_capability, outcome,
          reason_code, legacy_allowed, legacy_status, policy_allowed, policy_status,
          policy_code, diagnostic, identity_kind, workspace_id, trace_id, created_at
        )
        SELECT
          ${createId()}, ${record.day}, ${record.routeKey}, ${record.routerGroup},
          ${record.policyKind}, ${record.policyCapability}, ${record.outcome},
          ${record.reasonCode}, ${record.legacyAllowed}, ${record.legacyStatus},
          ${record.policyAllowed}, ${record.policyStatus}, ${record.policyCode},
          ${record.diagnostic}, ${record.identityKind}, ${record.workspaceId},
          ${record.traceId}, now()
        WHERE (
          SELECT count(*) FROM ${policyShadowEventTable}
          WHERE ${policyShadowEventTable.day} = ${record.day}
            AND ${policyShadowEventTable.routeKey} = ${record.routeKey}
            AND ${policyShadowEventTable.outcome} = ${record.outcome}
            AND ${policyShadowEventTable.reasonCode} IS NOT DISTINCT FROM ${record.reasonCode}
        ) < ${MAX_EVENT_ROWS_PER_BUCKET}
      `);
    } catch (error) {
      console.error("policy shadow: event write failed", error, {
        routeKey: record.routeKey,
        outcome: record.outcome,
      });
    }
  }

  await pruneIfDue(new Date());
}

/**
 * Persists accumulated saturation drops as one tally row per route key — outcome
 * `unevaluated`, reason `shadow_saturated`, `count + n` (#323 Opus S5). Deliberately
 * tally-only: drops are a coverage fact, not attributable events, so no event row and no
 * `resolveIdentity` run — the write itself must stay one cheap upsert.
 */
export async function recordShadowDrops(
  routeKey: string,
  count: number,
): Promise<void> {
  try {
    await db
      .insert(policyShadowTallyTable)
      .values({
        id: createId(),
        day: utcDateString(),
        routeKey,
        routerGroup: "shadow-control",
        outcome: "unevaluated",
        reasonCode: "shadow_saturated",
        count,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          policyShadowTallyTable.day,
          policyShadowTallyTable.routeKey,
          policyShadowTallyTable.outcome,
          policyShadowTallyTable.reasonCode,
        ],
        set: {
          count: sql`${policyShadowTallyTable.count} + ${count}`,
          lastSeenAt: new Date(),
        },
      });
  } catch (error) {
    console.error("policy shadow: drop-count write failed", error, {
      routeKey,
      count,
    });
  }
}

/** Test-only: lets `resetTestDatabase()`-style suites re-arm the once-per-day prune guard. */
export function resetShadowPruneGuardForTests(): void {
  lastPruneDay = null;
}
