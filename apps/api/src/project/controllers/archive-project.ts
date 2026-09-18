import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

async function archiveProject(id: string, workspaceId: string) {
  const [existingProject] = await db
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        // #202: a soft-deleted project is gone for ordinary use during its 30-day
        // recovery window (#187, PR-16) -- archiving one would set `archived_at`
        // on a row no read path will ever show again. Same exclusion
        // `get-project.ts` applies.
        isNull(projectTable.deletedAt),
      ),
    );

  if (!existingProject) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  const [archivedProject] = await db
    .update(projectTable)
    .set({ archivedAt: new Date() })
    .where(eq(projectTable.id, id))
    .returning();

  if (!archivedProject) {
    throw new HTTPException(500, {
      message: "Failed to archive project",
    });
  }

  return archivedProject;
}

export default archiveProject;
