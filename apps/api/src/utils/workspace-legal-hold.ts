import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { workspaceUnderOpenHold } from "./legal-hold-scope";

/**
 * Legal-hold fence for a hard delete of a whole workspace (PA-12; data-model.md: an open hold
 * suspends hard delete of held business/history data in the matching scope).
 *
 * Same fencing contract as `scheduler/soft-delete-purge.repository.ts` and
 * `instance/purge-target.ts`: take `LOCK TABLE legal_hold IN SHARE MODE` (it conflicts with the
 * ROW EXCLUSIVE lock a hold placement/lift takes, so no hold can appear between this check and
 * the delete commits), then look for an open hold (`lifted_at IS NULL`).
 *
 * The people and organisations come from `utils/legal-hold-scope.ts`, the single predicate the
 * 30-day purge and `attachment-gc` also use: every person and organisation whose rows cascade
 * away with the workspace (work-item requesters, assignees, participants and their adders,
 * actors, comment authors/editors/deleters, attachment uploaders, watchers, approvals, project
 * creators and stakeholders, the legacy task subtree) plus every workspace member.
 */
export class WorkspaceUnderLegalHoldError extends Error {
  constructor() {
    super("legal_hold");
    this.name = "WorkspaceUnderLegalHoldError";
  }
}

export async function lockLegalHolds(executor: Executor): Promise<void> {
  await executor.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
}

export async function isWorkspaceUnderOpenLegalHold(
  executor: Executor,
  workspaceId: string,
): Promise<boolean> {
  const result = await executor.execute<{ held: boolean }>(
    sql`SELECT ${workspaceUnderOpenHold(workspaceId)} AS held`,
  );
  return result.rows[0]?.held === true;
}

/** Locks the hold table, then refuses with {@link WorkspaceUnderLegalHoldError} when held. */
export async function assertWorkspaceNotUnderLegalHold(
  executor: Executor,
  workspaceId: string,
): Promise<void> {
  await lockLegalHolds(executor);
  if (await isWorkspaceUnderOpenLegalHold(executor, workspaceId))
    throw new WorkspaceUnderLegalHoldError();
}
