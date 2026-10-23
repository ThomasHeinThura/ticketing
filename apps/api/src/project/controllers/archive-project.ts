import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { invalidateNativeAuthorization } from "../../ws";
import {
  hasActiveChildren,
  lockProjectHierarchy,
} from "../hierarchy.repository";

async function archiveProject(id: string, workspaceId: string) {
  // The hierarchy lock serialises this with re-parenting, so a child cannot be attached
  // between the active-children check below and the archive write. The write stays one
  // conditional UPDATE: its project-row lock serializes with the in-transaction FOR SHARE
  // guard on legacy task writes and with soft deletion.
  const archivedProject = await db.transaction(async (tx) => {
    await lockProjectHierarchy(tx, workspaceId);

    // Edge-case table ("Parent archived with active children"): refused -- the children
    // must be archived first.
    if (await hasActiveChildren(tx, workspaceId, id)) {
      throw new HTTPException(409, {
        message:
          "project_has_active_children: archive its child projects first",
      });
    }

    const [row] = await tx
      .update(projectTable)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(projectTable.id, id),
          eq(projectTable.workspaceId, workspaceId),
          isNull(projectTable.deletedAt),
        ),
      )
      .returning();
    return row;
  });

  if (!archivedProject) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  await invalidateNativeAuthorization({ projectId: id });

  return archivedProject;
}

export default archiveProject;
