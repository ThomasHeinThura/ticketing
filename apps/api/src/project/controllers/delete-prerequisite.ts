import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { prerequisiteTable } from "../../database/schema";
import { requireActiveProject } from "../require-active-project";

async function deletePrerequisite(
  projectId: string,
  prerequisiteId: string,
  workspaceId: string,
) {
  await requireActiveProject(projectId, workspaceId);

  const [deleted] = await db
    .delete(prerequisiteTable)
    .where(
      and(
        eq(prerequisiteTable.id, prerequisiteId),
        eq(prerequisiteTable.projectId, projectId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Prerequisite not found" });
  }

  return deleted;
}

export default deletePrerequisite;
