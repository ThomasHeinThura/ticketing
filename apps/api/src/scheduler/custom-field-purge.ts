import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import { CUSTOM_FIELD_RESTORE_WINDOW_DAYS } from "../custom-field/retention";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  openHoldOver,
  workItemAttachmentOrganisations,
  workItemPeople,
} from "../utils/legal-hold-scope";
import { withJobLease } from "./leader-lock";
import { fenceLegalHolds } from "./soft-delete-purge.repository";

/**
 * `custom-field-purge` (background-jobs.md; `CF-8`): hard-deletes a custom field that was
 * soft-deleted more than 30 days ago, together with every stored value and its per-type
 * visibility (both cascade from the field row). The window is the same constant
 * `POST /api/custom-fields/{id}/restore` enforces, so a field is never restorable and already
 * purged at once.
 *
 * A field is **skipped while an open `legal_hold` covers** its workspace's organisation, the
 * organisation or (current) project of any work item that holds a value, or any person attached to a work item that
 * holds a value; it stays soft-deleted until the hold lifts. Each field runs in its own
 * transaction that first fences hold placement (`LOCK TABLE legal_hold IN SHARE MODE`) and
 * re-checks eligibility under a row lock, so a restore or a hold committed after the candidate
 * scan wins. One `custom_field.purged` audit row (system actor) records the key and the number
 * of values removed; never the values themselves.
 */

export const CUSTOM_FIELD_PURGE_JOB = "custom-field-purge";
export const CUSTOM_FIELD_PURGE_LEASE_MS = 30 * 60 * 1000;
export const CUSTOM_FIELD_PURGE_BATCH = 50;
export const CUSTOM_FIELD_PURGE_MAX_FIELDS = 500;

const WINDOW = sql.raw(`interval '${CUSTOM_FIELD_RESTORE_WINDOW_DAYS} days'`);

/** `cf` alias required: the field row of the caller's query. */
const FIELD_VALUE_ITEMS = sql`SELECT v."entity_id" FROM "custom_field_value" v WHERE v."custom_field_id" = cf."id"`;
// The scope is derived from the LIVE work_item rows holding a value (current project, workspace
// and attachment organisations), never from `custom_field_value.project_id`, which is written on
// insert only and goes stale when an item moves between projects.
const FIELD_UNDER_OPEN_HOLD = openHoldOver(
  workItemPeople(FIELD_VALUE_ITEMS),
  sql`
    SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = cf."workspace_id"
    UNION ALL
    SELECT w."organisation_id" FROM "work_item" wi
      JOIN "workspace" w ON w."id" = wi."workspace_id"
      WHERE wi."id" IN (${FIELD_VALUE_ITEMS})
    UNION ALL
    SELECT p."organisation_id" FROM "work_item" wi
      JOIN "project" p ON p."id" = wi."project_id"
      WHERE wi."id" IN (${FIELD_VALUE_ITEMS})
    UNION ALL
    ${workItemAttachmentOrganisations(FIELD_VALUE_ITEMS)}
  `,
);

const ELIGIBLE = sql`
  cf."deleted_at" IS NOT NULL
  AND cf."deleted_at" < now() - ${WINDOW}
  AND NOT ${FIELD_UNDER_OPEN_HOLD}
`;

export type CustomFieldPurgeOutcome = {
  status: "purged" | "held_elsewhere";
  purged: number;
  valuesDeleted: number;
  skipped: number;
  failed: number;
  budgetExhausted: boolean;
  degraded: boolean;
};

async function listCandidates(
  executor: Executor,
  limit: number,
  exclude: readonly string[],
): Promise<string[]> {
  const notSeen =
    exclude.length === 0
      ? sql``
      : sql`AND cf."id" NOT IN (${sql.join(
          exclude.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const result = await executor.execute<{ id: string }>(sql`
    SELECT cf."id" FROM "custom_field" cf
    WHERE ${ELIGIBLE} ${notSeen}
    ORDER BY cf."deleted_at", cf."id"
    LIMIT ${limit}
  `);
  return result.rows.map((row) => row.id);
}

async function purgeOne(
  id: string,
): Promise<{ purged: boolean; valuesDeleted: number }> {
  return db.transaction(async (tx) => {
    await fenceLegalHolds(tx);
    const locked = await tx.execute<{
      id: string;
      key: string;
      workspace_id: string;
      deleted_at: Date;
    }>(sql`
      SELECT cf."id", cf."key", cf."workspace_id", cf."deleted_at" FROM "custom_field" cf
      WHERE cf."id" = ${id} AND ${ELIGIBLE}
      FOR UPDATE OF cf
    `);
    const field = locked.rows[0];
    if (!field) return { purged: false, valuesDeleted: 0 };
    const counted = await tx.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM "custom_field_value" WHERE "custom_field_id" = ${id}`,
    );
    const valuesDeleted = Number(counted.rows[0]?.n ?? 0);
    // The values and the per-type visibility rows cascade from the field.
    await tx.execute(sql`DELETE FROM "custom_field" WHERE "id" = ${id}`);
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      workspaceId: field.workspace_id,
      action: "custom_field.purged",
      entityType: "custom_field",
      entityId: id,
      before: { key: field.key },
      after: { valuesDeleted },
    });
    return { purged: true, valuesDeleted };
  });
}

/** One purge pass over every eligible field, bounded by a row budget. */
export async function purgeSoftDeletedCustomFields(
  options: { batch?: number; maxFields?: number } = {},
): Promise<Omit<CustomFieldPurgeOutcome, "status">> {
  const batch = options.batch ?? CUSTOM_FIELD_PURGE_BATCH;
  const maxFields = options.maxFields ?? CUSTOM_FIELD_PURGE_MAX_FIELDS;
  const outcome = {
    purged: 0,
    valuesDeleted: 0,
    skipped: 0,
    failed: 0,
    budgetExhausted: false,
    degraded: false,
  };
  const seen: string[] = [];
  for (;;) {
    if (seen.length >= maxFields) {
      outcome.budgetExhausted = (await listCandidates(db, 1, seen)).length > 0;
      return outcome;
    }
    const ids = await listCandidates(db, batch, seen);
    if (ids.length === 0) return outcome;
    for (const id of ids) {
      if (seen.length >= maxFields) break;
      seen.push(id);
      try {
        const result = await purgeOne(id);
        if (result.purged) {
          outcome.purged++;
          outcome.valuesDeleted += result.valuesDeleted;
        } else outcome.skipped++;
      } catch {
        outcome.failed++;
        outcome.degraded = true;
      }
    }
  }
}

/** The registered job body: leader-locked, idempotent, and it emits the structured run line. */
export async function runCustomFieldPurgeJob(): Promise<CustomFieldPurgeOutcome> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease<CustomFieldPurgeOutcome>(
      CUSTOM_FIELD_PURGE_JOB,
      async () => ({
        status: "purged",
        ...(await purgeSoftDeletedCustomFields()),
      }),
      () => ({
        status: "held_elsewhere",
        purged: 0,
        valuesDeleted: 0,
        skipped: 0,
        failed: 0,
        budgetExhausted: false,
        degraded: false,
      }),
      CUSTOM_FIELD_PURGE_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: CUSTOM_FIELD_PURGE_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: outcome.purged,
        status: outcome.status,
        outcome: outcome.degraded ? "degraded" : "ok",
      }),
    );
    return outcome;
  } catch (error) {
    console.log(
      JSON.stringify({
        job: CUSTOM_FIELD_PURGE_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: null,
        outcome: "failed",
      }),
    );
    throw error;
  }
}
