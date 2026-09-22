import { and, eq, isNull, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { ProjectSlugTakenError } from "./create-project";

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

  // #23's mandatory Opus security review of PR #261, finding F1: answer a slug collision
  // before attempting the write where we can, so the common case is a clean 409 rather
  // than a caught driver error. Mirrors `update-workspace.ts`'s own pre-check exactly.
  // The catch below still covers the race between this read and the update.
  const [clash] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(and(eq(projectTable.slug, slug), ne(projectTable.id, id)))
    .limit(1);
  if (clash) {
    throw new ProjectSlugTakenError(slug);
  }

  try {
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
  } catch (error) {
    if (isUniqueViolation(error, "slug")) {
      throw new ProjectSlugTakenError(slug);
    }
    throw error;
  }
}

export default updateProject;
