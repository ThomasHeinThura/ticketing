import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

async function archiveProject(id: string, workspaceId: string) {
  // Keep this as one conditional write: its project-row lock serializes with the
  // in-transaction FOR SHARE guard on legacy task writes and with soft deletion.
  const [archivedProject] = await db
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

  if (!archivedProject) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  return archivedProject;
}

export default archiveProject;
