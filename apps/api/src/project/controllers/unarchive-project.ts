import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { invalidateNativeAuthorization } from "../../ws";
import { getActiveProjectQuery } from "../repository";

async function unarchiveProject(id: string, workspaceId: string) {
  const [existingProject] = await getActiveProjectQuery(id, workspaceId);

  if (!existingProject) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  const [unarchivedProject] = await db
    .update(projectTable)
    .set({ archivedAt: null })
    .where(eq(projectTable.id, id))
    .returning();

  if (!unarchivedProject) {
    throw new HTTPException(500, {
      message: "Failed to unarchive project",
    });
  }

  await invalidateNativeAuthorization({ projectId: id });

  return unarchivedProject;
}

export default unarchiveProject;
