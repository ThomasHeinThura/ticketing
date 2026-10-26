import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import {
  listOrganisationPurgeCandidates,
  purgeExpiredOrganisation,
} from "../instance/organisation-purge";
import {
  countRowsRetainedBySharedObject,
  deleteProjectTree,
  deleteWorkItemRow,
  fenceLegalHolds,
  listProjectPurgeCandidates,
  listWorkItemPurgeCandidates,
  lockEligibleProject,
  lockEligibleWorkItem,
  readWorkItemProjectId,
  releaseAttachmentsForPurge,
} from "./soft-delete-purge.repository";
import {
  detachChildrenForPurge,
  lockWorkItemHierarchyForProject,
} from "./soft-delete-purge-detach";

/**
 * The soft-delete purge half of `session-cleanup` (`background-jobs.md`; `WI-21`, `PR-16`,
 * `PA-12`): completes an already-approved soft deletion once its 30-day window has passed, with
 * no second approval, and **skips any row whose organisation or person is under an open
 * `legal_hold`**, leaving it soft-deleted until the hold lifts.
 *
 * Each candidate runs in its own transaction that first fences hold placement
 * (`LOCK TABLE legal_hold IN SHARE MODE`) and re-checks eligibility under a row lock, so a hold
 * placed or a restore committed after the candidate scan wins. Attachments are handed to
 * `attachment-gc` first (marked `deleted`) so their stored objects are removed before the rows
 * cascade away; the item/project is deleted on a later run once none remain. Holds cover every
 * person whose rows cascade away with the item/project (requester, assignee, comment authors,
 * attachment uploaders, activity actors, watchers, participants, approvers, ...), see the
 * repository. A failure (an
 * unexpected RESTRICT foreign key, for example) leaves that row soft-deleted and marks the run
 * degraded; it never aborts the rest of the batch.
 */

/** Candidates fetched per page; a run keeps paging until a budget runs out (`PA-12`). */
export const SOFT_DELETE_PURGE_BATCH = 50;
/** Wall-clock budget per run, kept well inside `session-cleanup`'s 5 minute lease. */
export const SOFT_DELETE_PURGE_TIME_BUDGET_MS = 3 * 60 * 1000;
/** Upper bound on rows attempted per run (projects and work items together). */
export const SOFT_DELETE_PURGE_MAX_ROWS = 2000;

export type SoftDeleteRowResult =
  | "purged"
  | "awaiting_attachments"
  | "no_longer_eligible";

export type SoftDeletePurgeOutcome = {
  projectsPurged: number;
  workItemsPurged: number;
  organisationsPurged?: number;
  awaitingAttachments: number;
  skipped: number;
  failed: number;
  /**
   * Eligible rows pinned by an attachment whose stored object another attachment row shares
   * (`attachment-gc` never collects it). They stay soft-deleted and the run is degraded.
   */
  permanentlyRetained?: number;
  /** True when the time or row budget stopped the run with candidates still pending. */
  budgetExhausted?: boolean;
  degraded: boolean;
};

export type SoftDeletePurgeOptions = {
  batch?: number;
  timeBudgetMs?: number;
  maxRows?: number;
  now?: () => number;
};

export async function purgeSoftDeletedWorkItem(
  id: string,
): Promise<SoftDeleteRowResult> {
  return db.transaction(async (tx) => {
    await fenceLegalHolds(tx);
    // Lock order (Q10): hierarchy advisory lock first, then the row lock -- the order
    // `set-work-item-parent`, delete and move use. The project is read unlocked, then
    // re-verified under the row lock.
    const projectId = await readWorkItemProjectId(tx, id);
    if (!projectId) return "no_longer_eligible";
    await lockWorkItemHierarchyForProject(tx, projectId);
    const locked = await lockEligibleWorkItem(tx, id);
    if (!locked || locked.projectId !== projectId) return "no_longer_eligible";
    const remaining = await releaseAttachmentsForPurge(tx, { workItemId: id });
    if (remaining > 0) return "awaiting_attachments";
    // WI-22: children never block the purge; they are detached (journaled) first.
    await detachChildrenForPurge(tx, locked);
    return (await deleteWorkItemRow(tx, id)) === 1
      ? "purged"
      : "no_longer_eligible";
  });
}

export async function purgeSoftDeletedProject(
  id: string,
): Promise<{ result: SoftDeleteRowResult; workItemsDeleted: number }> {
  return db.transaction(async (tx) => {
    await fenceLegalHolds(tx);
    const ownerResult = await tx.execute<{ organisation_id: string | null }>(
      sql`SELECT organisation_id FROM project WHERE id = ${id}`,
    );
    const organisationId = ownerResult.rows[0]?.organisation_id;
    if (organisationId) {
      const { lockOrganisationIdentityDomainBindings } = await import(
        "../instance/organisation-lifecycle"
      );
      await lockOrganisationIdentityDomainBindings(tx);
      await tx.execute(sql`
        SELECT id FROM organisation WHERE id = ${organisationId} FOR UPDATE
      `);
      await tx.execute(sql`
        SELECT operation_id FROM organisation_deletion_snapshot
        WHERE organisation_id = ${organisationId} FOR UPDATE
      `);
    }
    if (!(await lockEligibleProject(tx, id)))
      return { result: "no_longer_eligible", workItemsDeleted: 0 };
    const remaining = await releaseAttachmentsForPurge(tx, { projectId: id });
    if (remaining > 0)
      return { result: "awaiting_attachments", workItemsDeleted: 0 };
    const deleted = await deleteProjectTree(tx, id);
    if (deleted.projectsDeleted !== 1) {
      throw new Error("Project purge removed no project row");
    }
    return { result: "purged", workItemsDeleted: deleted.workItemsDeleted };
  });
}

function tally(outcome: SoftDeletePurgeOutcome, result: SoftDeleteRowResult) {
  if (result === "awaiting_attachments") outcome.awaitingAttachments++;
  if (result === "no_longer_eligible") outcome.skipped++;
}

/**
 * Projects first (they take their work items with them), then individual work items. Each kind
 * is drained page by page until no candidate is left or the time/row budget is spent. Rows
 * already attempted in the run are excluded from the next page, so rows still awaiting
 * `attachment-gc` (or failing) cannot block the head of the order; the candidate order itself
 * also sorts rows with attachments behind clean ones (see the repository).
 */
export async function purgeSoftDeletedRows(
  batchOrOptions: number | SoftDeletePurgeOptions = {},
): Promise<SoftDeletePurgeOutcome> {
  const options: SoftDeletePurgeOptions =
    typeof batchOrOptions === "number"
      ? { batch: batchOrOptions }
      : batchOrOptions;
  const batch = options.batch ?? SOFT_DELETE_PURGE_BATCH;
  const maxRows = options.maxRows ?? SOFT_DELETE_PURGE_MAX_ROWS;
  const now = options.now ?? Date.now;
  const deadline =
    now() + (options.timeBudgetMs ?? SOFT_DELETE_PURGE_TIME_BUDGET_MS);
  let attempted = 0;

  const outcome: SoftDeletePurgeOutcome = {
    projectsPurged: 0,
    workItemsPurged: 0,
    awaitingAttachments: 0,
    skipped: 0,
    failed: 0,
    permanentlyRetained: 0,
    budgetExhausted: false,
    degraded: false,
  };

  const outOfBudget = () => attempted >= maxRows || now() >= deadline;

  async function drain(
    list: (
      executor: typeof db,
      limit: number,
      exclude: readonly string[],
    ) => Promise<string[]>,
    attempt: (id: string) => Promise<void>,
  ) {
    const seen: string[] = [];
    for (;;) {
      if (outOfBudget()) {
        // Only report exhaustion when something is actually left.
        outcome.budgetExhausted =
          (await list(db, 1, seen)).length > 0 || outcome.budgetExhausted;
        return;
      }
      const ids = await list(db, batch, seen);
      if (ids.length === 0) return;
      for (const id of ids) {
        if (outOfBudget()) break;
        seen.push(id);
        attempted++;
        try {
          await attempt(id);
        } catch {
          outcome.failed++;
          outcome.degraded = true;
        }
      }
    }
  }

  await drain(listProjectPurgeCandidates, async (id) => {
    const { result, workItemsDeleted } = await purgeSoftDeletedProject(id);
    if (result === "purged") {
      outcome.projectsPurged++;
      outcome.workItemsPurged += workItemsDeleted;
    } else tally(outcome, result);
  });

  await drain(listWorkItemPurgeCandidates, async (id) => {
    const result = await purgeSoftDeletedWorkItem(id);
    if (result === "purged") outcome.workItemsPurged++;
    else tally(outcome, result);
  });

  const seenOrganisations: string[] = [];
  for (;;) {
    if (outOfBudget()) {
      outcome.budgetExhausted =
        (await listOrganisationPurgeCandidates(db, 1, seenOrganisations))
          .length > 0 || outcome.budgetExhausted;
      break;
    }
    const candidates = await listOrganisationPurgeCandidates(
      db,
      batch,
      seenOrganisations,
    );
    if (candidates.length === 0) break;
    for (const candidate of candidates) {
      if (outOfBudget()) break;
      seenOrganisations.push(candidate.organisationId);
      attempted++;
      try {
        const result = await db.transaction(async (tx) => {
          const purged = await purgeExpiredOrganisation(tx, candidate);
          if (purged.status === "purged") {
            await appendAuditLog(tx, {
              actorId: null,
              actorType: "system",
              traceId: `organisation-purge-${createId()}`,
              workspaceId: null,
              organisationId: null,
              action: "hard_purge.executed",
              entityType: "organisation",
              entityId: candidate.organisationId,
              before: null,
              after: {
                organisationId: candidate.organisationId,
                operationId: candidate.operationId,
                generation: candidate.generation,
                projects: purged.counts.projects,
                workItems: purged.counts.workItems,
                people: purged.counts.people,
                attachments: purged.counts.attachments,
                storageObjectsQueued: purged.counts.storageObjectsQueued,
                legalHold: "none",
                retention: "30_day_window_elapsed",
              },
            });
          }
          return purged;
        });
        if (result.status === "purged")
          outcome.organisationsPurged = (outcome.organisationsPurged ?? 0) + 1;
        else outcome.skipped++;
      } catch {
        outcome.failed++;
        outcome.degraded = true;
      }
    }
  }

  try {
    const retained = await countRowsRetainedBySharedObject(db);
    outcome.permanentlyRetained = retained.workItems + retained.projects;
    if (outcome.permanentlyRetained > 0) outcome.degraded = true;
  } catch {
    outcome.failed++;
    outcome.degraded = true;
  }

  return outcome;
}
