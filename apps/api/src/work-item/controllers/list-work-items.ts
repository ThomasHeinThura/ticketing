import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { workItemTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

/**
 * `GET /api/projects/{projectId}/work-items` (`work_item:read`, plus reach on the
 * project). No pagination in this first slice -- the spec's own edge case
 * ("10,000 items in one project: ... list paginates") is a stated future requirement,
 * not one of the `WI-1`..`WI-4` behaviour rules this slice implements; deferred rather
 * than guessed at, flagged in the PR body.
 *
 * Excludes archived/deleted rows by default, matching `WI-21`'s stated default-filter
 * convention -- a no-op today (nothing in this slice ever sets `archivedAt`/`deletedAt`),
 * but the right default to ship rather than one to retrofit once archiving/deletion land.
 *
 * #202 / PR #204's freeze invariant (independent Opus security review of PR #271, S2):
 * this route filtered `work_item.deleted_at`/`archived_at` but never `project.deleted_at`,
 * so a soft-deleted project's list stayed readable through here. `getProjectWorkspaceId`
 * (`utils/assert-assignable-user.ts`) is the same helper every task route already uses to
 * apply that exclusion -- it throws 404 for a soft-deleted or nonexistent project, so this
 * route now 404s instead of returning an (empty or stale) 200 list.
 */
export async function listWorkItems(projectId: string, workspaceId: string) {
  await getProjectWorkspaceId(projectId);

  return db.query.workItemTable.findMany({
    where: and(
      eq(workItemTable.projectId, projectId),
      eq(workItemTable.workspaceId, workspaceId),
      isNull(workItemTable.archivedAt),
      isNull(workItemTable.deletedAt),
    ),
    orderBy: [asc(workItemTable.number)],
  });
}

export default listWorkItems;
