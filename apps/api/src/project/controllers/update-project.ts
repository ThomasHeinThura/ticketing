import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

async function updateProject(
  id: string,
  name: string,
  icon: string,
  slug: string,
  description: string,
  workspaceId: string,
) {
  const [existingProject] = await db
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        // #202: a soft-deleted project is gone for ordinary use during its 30-day
        // recovery window (#187, PR-16), so it cannot be renamed, re-iconed or
        // re-described while "deleted". Same exclusion `get-project.ts` applies.
        isNull(projectTable.deletedAt),
      ),
    );

  const isProjectExisting = Boolean(existingProject);

  if (!isProjectExisting) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  const [updatedWorkspace] = await db
    .update(projectTable)
    .set({
      name,
      icon,
      slug,
      description,
    })
    .where(eq(projectTable.id, id))
    .returning();

  return updatedWorkspace;
}

export default updateProject;
