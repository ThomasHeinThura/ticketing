import { type SQL, sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { dbNowUtc } from "../utils/db-time";
import {
  PROJECT_UNDER_OPEN_HOLD,
  PROJECT_WORK_ITEMS,
  WORK_ITEM_UNDER_OPEN_HOLD,
} from "../utils/legal-hold-scope";

/**
 * SQL for the soft-delete purge inside `session-cleanup` (`WI-21`, `PR-16`, `PA-12`).
 *
 * `work_item.deleted_at` / `project.deleted_at` / `project.purge_after` are
 * `timestamp without time zone` holding a UTC wall clock, so every comparison uses
 * {@link dbNowUtc} (see `utils/db-time.ts`). A row is held when an open `legal_hold` covers
 * its workspace's organisation, its project's organisation, or a person attached to it
 * (requester or assignee, and that person's organisation) — `data-model.md` §2. The people and
 * organisations are defined once in `utils/legal-hold-scope.ts`, shared with the workspace
 * hard delete and `attachment-gc`.
 */

const WORK_ITEM_WINDOW = sql`interval '30 days'`;

const WI_ITEMS = sql`SELECT wi."id"`;
const PROJECT_ITEMS = PROJECT_WORK_ITEMS;

/**
 * Work-item eligibility, `wi` alias: soft-deleted ≥ 30 days ago, no child work items (the
 * `parent_id` FK is RESTRICT, so leaves purge first and parents follow on a later run), no
 * portal submission (RESTRICT FK — reported, never force-deleted), and not held.
 */
const WORK_ITEM_ELIGIBLE = sql`
  wi."deleted_at" IS NOT NULL
  AND wi."deleted_at" <= ${dbNowUtc()} - ${WORK_ITEM_WINDOW}
  AND NOT EXISTS (SELECT 1 FROM "work_item" c WHERE c."parent_id" = wi."id")
  AND NOT EXISTS (SELECT 1 FROM "submission" s WHERE s."work_item_id" = wi."id")
  AND NOT ${WORK_ITEM_UNDER_OPEN_HOLD}
`;

/**
 * Project eligibility, `pr` alias: `purge_after` passed (set to delete time + 30 days), and no
 * RESTRICT dependant outside the project's own tree (portal submissions on its work items, a
 * request type or request-type version naming it as `default_project_id`) — those stay
 * soft-deleted and are reported rather than retried and failed every night.
 */
const PROJECT_ELIGIBLE = sql`
  pr."deleted_at" IS NOT NULL
  AND pr."purge_after" IS NOT NULL
  AND pr."purge_after" <= ${dbNowUtc()}
  AND NOT EXISTS (
    SELECT 1 FROM "submission" s
    JOIN "work_item" wi ON wi."id" = s."work_item_id"
    WHERE wi."project_id" = pr."id"
  )
  AND NOT EXISTS (SELECT 1 FROM "request_type" rt WHERE rt."default_project_id" = pr."id")
  AND NOT EXISTS (
    SELECT 1 FROM "request_type_version" rtv WHERE rtv."default_project_id" = pr."id"
  )
  AND NOT ${PROJECT_UNDER_OPEN_HOLD}
`;

/**
 * Attachments that cascade away with the given work items (directly or via their comments).
 * `a` alias is the attachment; `items` selects work-item ids.
 */
function ownedAttachment(items: SQL): SQL {
  return sql`(
    a."work_item_id" IN (${items})
    OR a."comment_id" IN (
      SELECT c."id" FROM "comment" c WHERE c."work_item_id" IN (${items})
    )
  )`;
}

/**
 * `attachment-gc` never deletes a stored object another live (not `deleted`) attachment row
 * still names (the same `object_key`), so such an attachment cannot leave and the row owning it
 * cannot purge until that live reference goes; rows that are all `deleted` collect together
 * (the last one removes the object). Matches `attachment-cleanup.ts`'s shared-object check.
 */
const SHARED_OBJECT = sql`EXISTS (
  SELECT 1 FROM "attachment" b
  WHERE b."object_key" = a."object_key" AND b."id" <> a."id" AND b."state" <> 'deleted'
)`;

function hasOwnedAttachment(items: SQL, sharedOnly: boolean): SQL {
  return sql`EXISTS (
    SELECT 1 FROM "attachment" a
    WHERE ${ownedAttachment(items)} ${sharedOnly ? sql`AND ${SHARED_OBJECT}` : sql``}
  )`;
}

function excluding(alias: SQL, ids: readonly string[]): SQL {
  if (ids.length === 0) return sql``;
  return sql`AND ${alias} NOT IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

/**
 * Candidates are ordered so rows that cannot make progress never starve the rest: rows with no
 * attachments first, then rows whose attachments are still on their way out (rotated behind the
 * clean rows), and rows pinned by a shared stored object last. `exclude` carries the ids already
 * attempted in this run so a run can page past rows that are still waiting.
 */
export async function listWorkItemPurgeCandidates(
  executor: Executor,
  limit: number,
  exclude: readonly string[] = [],
): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    SELECT wi."id" FROM "work_item" wi
    WHERE ${WORK_ITEM_ELIGIBLE} ${excluding(sql`wi."id"`, exclude)}
    ORDER BY ${hasOwnedAttachment(WI_ITEMS, true)} ASC,
             ${hasOwnedAttachment(WI_ITEMS, false)} ASC,
             wi."deleted_at" ASC, wi."id" ASC
    LIMIT ${limit}
  `);
  return result.rows.map((row) => row.id);
}

export async function listProjectPurgeCandidates(
  executor: Executor,
  limit: number,
  exclude: readonly string[] = [],
): Promise<string[]> {
  const result = await executor.execute<{ id: string }>(sql`
    SELECT pr."id" FROM "project" pr
    WHERE ${PROJECT_ELIGIBLE} ${excluding(sql`pr."id"`, exclude)}
    ORDER BY ${hasOwnedAttachment(PROJECT_ITEMS, true)} ASC,
             ${hasOwnedAttachment(PROJECT_ITEMS, false)} ASC,
             pr."purge_after" ASC, pr."id" ASC
    LIMIT ${limit}
  `);
  return result.rows.map((row) => row.id);
}

/**
 * Counts eligible (past-window, unheld) work items and projects that are pinned by an attachment
 * whose stored object is shared with another attachment row. `attachment-gc` never collects
 * those, so they stay soft-deleted until the other reference goes; the run reports them.
 */
export async function countRowsRetainedBySharedObject(
  executor: Executor,
): Promise<{ workItems: number; projects: number }> {
  const items = await executor.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM "work_item" wi
    WHERE ${WORK_ITEM_ELIGIBLE} AND ${hasOwnedAttachment(WI_ITEMS, true)}
  `);
  const projects = await executor.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM "project" pr
    WHERE ${PROJECT_ELIGIBLE} AND ${hasOwnedAttachment(PROJECT_ITEMS, true)}
  `);
  return {
    workItems: Number(items.rows[0]?.count ?? 0),
    projects: Number(projects.rows[0]?.count ?? 0),
  };
}

/** Fences hold placement until commit (same fence `attachment-gc` uses). */
export async function fenceLegalHolds(executor: Executor): Promise<void> {
  await executor.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
}

/** Re-checks eligibility under a row lock; false when it changed (restored, held, ...). */
export async function lockEligibleWorkItem(
  executor: Executor,
  id: string,
): Promise<boolean> {
  const result = await executor.execute<{ id: string }>(sql`
    SELECT wi."id" FROM "work_item" wi
    WHERE wi."id" = ${id} AND ${WORK_ITEM_ELIGIBLE}
    FOR UPDATE OF wi
  `);
  return result.rows.length === 1;
}

export async function lockEligibleProject(
  executor: Executor,
  id: string,
): Promise<boolean> {
  const result = await executor.execute<{ id: string }>(sql`
    SELECT pr."id" FROM "project" pr
    WHERE pr."id" = ${id} AND ${PROJECT_ELIGIBLE}
    FOR UPDATE OF pr
  `);
  return result.rows.length === 1;
}

/**
 * Hands every attachment under the given work items (directly or via their comments) to
 * `attachment-gc` by marking it `deleted`, so the stored object is removed before the row is
 * cascaded away. Returns the number of attachment rows that still exist afterwards; the work
 * item is purged only once that reaches zero.
 */
export async function releaseAttachmentsForPurge(
  executor: Executor,
  scope: { workItemId: string } | { projectId: string },
): Promise<number> {
  const items =
    "workItemId" in scope
      ? sql`SELECT ${scope.workItemId}::text AS id`
      : sql`SELECT wi."id" FROM "work_item" wi WHERE wi."project_id" = ${scope.projectId}`;
  const owned = ownedAttachment(items);
  await executor.execute(sql`
    UPDATE "attachment" a
    SET "state" = 'deleted', "deleted_at" = ${dbNowUtc()}, "updated_at" = now()
    WHERE ${owned} AND a."state" <> 'deleted'
  `);
  const remaining = await executor.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM "attachment" a WHERE ${owned}
  `);
  return Number(remaining.rows[0]?.count ?? 0);
}

/** Hard-deletes one work item; comments, activity, relations etc. follow its FK cascades. */
export async function deleteWorkItemRow(
  executor: Executor,
  id: string,
): Promise<number> {
  const result = await executor.execute(
    sql`DELETE FROM "work_item" WHERE "id" = ${id}`,
  );
  return result.rowCount ?? 0;
}

/**
 * Deletes a project's work items leaf-first (the `parent_id` FK is RESTRICT, so a single
 * cascade from the project could fail on a parent row), then the project itself.
 */
export async function deleteProjectTree(
  executor: Executor,
  projectId: string,
): Promise<{ workItemsDeleted: number; projectsDeleted: number }> {
  let workItemsDeleted = 0;
  for (;;) {
    const result = await executor.execute(sql`
      DELETE FROM "work_item" wi
      WHERE wi."project_id" = ${projectId}
        AND NOT EXISTS (SELECT 1 FROM "work_item" c WHERE c."parent_id" = wi."id")
    `);
    const count = result.rowCount ?? 0;
    if (count === 0) break;
    workItemsDeleted += count;
  }
  const project = await executor.execute(
    sql`DELETE FROM "project" WHERE "id" = ${projectId}`,
  );
  return { workItemsDeleted, projectsDeleted: project.rowCount ?? 0 };
}
