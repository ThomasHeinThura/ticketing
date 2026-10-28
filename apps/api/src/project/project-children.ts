import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { Executor } from "../database/executor";
import { projectTable } from "../database/schema";

/**
 * Ids of a project's children that are not soft-deleted (archived children count: they still
 * occupy the `project_workspace_parent_fk` RESTRICT edge and still point at the parent).
 */
export async function listLiveChildProjectIds(
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        eq(projectTable.parentId, projectId),
        isNull(projectTable.deletedAt),
      ),
    )
    .orderBy(projectTable.id)
    .limit(1);
  return rows.map((row) => row.id);
}

export const PROJECT_HAS_CHILDREN_MESSAGE =
  "project_has_live_children: delete or move this project's child projects first";

/**
 * P1-5: a project with live (non-deleted) child projects cannot be deleted. Soft-deleting the
 * parent would leave children pointing at a deleted parent and the parent could never be purged
 * (the parent FK is RESTRICT). Refused at the delete request and again at approval.
 */
export async function assertNoLiveChildProjects(
  executor: Executor,
  workspaceId: string,
  projectId: string,
): Promise<void> {
  const [child] = await listLiveChildProjectIds(
    executor,
    workspaceId,
    projectId,
  );
  if (child !== undefined) {
    throw new HTTPException(409, { message: PROJECT_HAS_CHILDREN_MESSAGE });
  }
}
