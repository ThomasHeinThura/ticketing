import db from "../database";
import {
  countRowsRetainedBySharedObject,
  deleteProjectTree,
  deleteWorkItemRow,
  fenceLegalHolds,
  listProjectPurgeCandidates,
  listWorkItemPurgeCandidates,
  lockEligibleProject,
  lockEligibleWorkItem,
  releaseAttachmentsForPurge,
} from "./soft-delete-purge.repository";

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
    if (!(await lockEligibleWorkItem(tx, id))) return "no_longer_eligible";
    const remaining = await releaseAttachmentsForPurge(tx, { workItemId: id });
    if (remaining > 0) return "awaiting_attachments";
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
