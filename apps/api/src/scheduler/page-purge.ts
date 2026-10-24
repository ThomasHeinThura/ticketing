import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import type { Executor } from "../database/executor";
import { openHoldOver, pagePeople } from "../utils/legal-hold-scope";
import { withJobLease } from "./leader-lock";
import { fenceLegalHolds } from "./soft-delete-purge.repository";

/**
 * `page-purge` (background-jobs.md; `PG-7`): hard-deletes a project page whose restore window
 * has passed (`purge_after <= now()`, set to delete time + 30 days), together with every stored
 * version (cascade from the page row). The window is the one `POST
 * /api/projects/{projectId}/pages/{id}/undelete` enforces from the same `purge_after` column, so
 * a page is never restorable and purged at once.
 *
 * A page is **skipped while an open `legal_hold` covers** its workspace's organisation, its
 * project's organisation, or a person attached to the page or one of its versions (author,
 * last editor, version authors, and those people's organisations); it stays soft-deleted until
 * the hold lifts. A page that still has a child page in any state is skipped as well:
 * `project_page_parent_fk` is NO ACTION, so children purge first and the parent follows on a
 * later pass (leaf-first, the same rule the project purge uses). Each page runs in its own
 * transaction that first fences hold placement (`LOCK TABLE legal_hold IN SHARE MODE`) and
 * re-checks eligibility under a row lock, so an undelete or a hold committed after the
 * candidate scan wins. One `page.purged` audit row (system actor) records the title and the
 * number of versions removed; never the body.
 */

export const PAGE_PURGE_JOB = "page-purge";
export const PAGE_PURGE_LEASE_MS = 30 * 60 * 1000;
export const PAGE_PURGE_BATCH = 50;
export const PAGE_PURGE_MAX_PAGES = 500;

/** `pp` alias required: the page row of the caller's query. */
const PAGE_UNDER_OPEN_HOLD = openHoldOver(
  pagePeople(sql`SELECT pp."id"`),
  sql`
    SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = pp."workspace_id"
    UNION ALL
    SELECT pr."organisation_id" FROM "project" pr WHERE pr."id" = pp."project_id"
  `,
);

const ELIGIBLE = sql`
  pp."deleted_at" IS NOT NULL
  AND pp."purge_after" IS NOT NULL
  AND pp."purge_after" <= now()
  AND NOT EXISTS (SELECT 1 FROM "project_page" ch WHERE ch."parent_id" = pp."id")
  AND NOT ${PAGE_UNDER_OPEN_HOLD}
`;

export type PagePurgeOutcome = {
  status: "purged" | "held_elsewhere";
  purged: number;
  versionsDeleted: number;
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
      : sql`AND pp."id" NOT IN (${sql.join(
          exclude.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const result = await executor.execute<{ id: string }>(sql`
    SELECT pp."id" FROM "project_page" pp
    WHERE ${ELIGIBLE} ${notSeen}
    ORDER BY pp."purge_after", pp."id"
    LIMIT ${limit}
  `);
  return result.rows.map((row) => row.id);
}

async function purgeOne(
  id: string,
): Promise<{ purged: boolean; versionsDeleted: number }> {
  return db.transaction(async (tx) => {
    await fenceLegalHolds(tx);
    const locked = await tx.execute<{
      id: string;
      title: string;
      workspace_id: string;
      project_id: string;
    }>(sql`
      SELECT pp."id", pp."title", pp."workspace_id", pp."project_id" FROM "project_page" pp
      WHERE pp."id" = ${id} AND ${ELIGIBLE}
      FOR UPDATE OF pp
    `);
    const page = locked.rows[0];
    if (!page) return { purged: false, versionsDeleted: 0 };
    const counted = await tx.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM "project_page_version" WHERE "page_id" = ${id}`,
    );
    const versionsDeleted = Number(counted.rows[0]?.n ?? 0);
    // The versions cascade from the page row.
    await tx.execute(sql`DELETE FROM "project_page" WHERE "id" = ${id}`);
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      workspaceId: page.workspace_id,
      projectId: page.project_id,
      action: "page.purged",
      entityType: "project_page",
      entityId: id,
      before: { title: page.title },
      after: { versionsDeleted },
    });
    return { purged: true, versionsDeleted };
  });
}

/** One purge pass over every eligible page, bounded by a row budget. */
export async function purgeSoftDeletedPages(
  options: { batch?: number; maxPages?: number } = {},
): Promise<Omit<PagePurgeOutcome, "status">> {
  const batch = options.batch ?? PAGE_PURGE_BATCH;
  const maxPages = options.maxPages ?? PAGE_PURGE_MAX_PAGES;
  const outcome = {
    purged: 0,
    versionsDeleted: 0,
    skipped: 0,
    failed: 0,
    budgetExhausted: false,
    degraded: false,
  };
  const seen: string[] = [];
  for (;;) {
    if (seen.length >= maxPages) {
      outcome.budgetExhausted = (await listCandidates(db, 1, seen)).length > 0;
      return outcome;
    }
    const ids = await listCandidates(db, batch, seen);
    if (ids.length === 0) return outcome;
    for (const id of ids) {
      if (seen.length >= maxPages) break;
      seen.push(id);
      try {
        const result = await purgeOne(id);
        if (result.purged) {
          outcome.purged++;
          outcome.versionsDeleted += result.versionsDeleted;
        } else outcome.skipped++;
      } catch {
        outcome.failed++;
        outcome.degraded = true;
      }
    }
  }
}

/** The registered job body: leader-locked, idempotent, and it emits the structured run line. */
export async function runPagePurgeJob(): Promise<PagePurgeOutcome> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease<PagePurgeOutcome>(
      PAGE_PURGE_JOB,
      async () => ({
        status: "purged",
        ...(await purgeSoftDeletedPages()),
      }),
      () => ({
        status: "held_elsewhere",
        purged: 0,
        versionsDeleted: 0,
        skipped: 0,
        failed: 0,
        budgetExhausted: false,
        degraded: false,
      }),
      PAGE_PURGE_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: PAGE_PURGE_JOB,
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
        job: PAGE_PURGE_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: null,
        outcome: "failed",
      }),
    );
    throw error;
  }
}
