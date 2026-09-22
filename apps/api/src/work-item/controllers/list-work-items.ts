import { and, asc, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { workItemTable } from "../../database/schema";

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
 */
export async function listWorkItems(projectId: string, workspaceId: string) {
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
