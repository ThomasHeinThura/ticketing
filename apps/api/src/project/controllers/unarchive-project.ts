import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";
import { invalidateNativeAuthorization } from "../../ws";
import { lockProjectHierarchy } from "../hierarchy.repository";

async function unarchiveProject(id: string, workspaceId: string) {
  const unarchivedProject = await db.transaction(async (tx) => {
    // Same lock as archive and re-parenting: the parent check below and the write must not
    // interleave with a parent being archived.
    await lockProjectHierarchy(tx, workspaceId);
    return unarchiveProjectLocked(tx, id, workspaceId);
  });

  await invalidateNativeAuthorization({ projectId: id });

  return unarchivedProject;
}

async function unarchiveProjectLocked(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  id: string,
  workspaceId: string,
) {
  const [existingProject] = await tx
    .select()
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        // #202: a soft-deleted project is gone for ordinary use during its 30-day
        // recovery window (#187, PR-16) -- unarchiving one would return a row to
        // the (still deleted) state it was in, with a misleading success. Same
        // exclusion `get-project.ts` applies.
        isNull(projectTable.deletedAt),
      ),
    );

  if (!existingProject) {
    throw new HTTPException(404, {
      message:
        "Project doesn't exist or doesn't belong to the specified workspace",
    });
  }

  // A child cannot come back to life under an archived parent: archiving a parent requires
  // its children to be archived first, and this keeps that invariant true in reverse.
  if (existingProject.parentId !== null) {
    const [parent] = await tx
      .select({ archivedAt: projectTable.archivedAt })
      .from(projectTable)
      .where(eq(projectTable.id, existingProject.parentId))
      .limit(1);
    if (parent?.archivedAt) {
      throw new HTTPException(409, {
        message: "project_parent_archived: unarchive the parent project first",
      });
    }
  }

  const [unarchivedProject] = await tx
    .update(projectTable)
    .set({ archivedAt: null })
    .where(eq(projectTable.id, id))
    .returning();

  if (!unarchivedProject) {
    throw new HTTPException(500, {
      message: "Failed to unarchive project",
    });
  }

  return unarchivedProject;
}

export default unarchiveProject;
