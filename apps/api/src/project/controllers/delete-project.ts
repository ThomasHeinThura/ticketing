import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { projectTable } from "../../database/schema";

// #187: 30 days, matching `docs/03-features/projects-and-engagements.md` PR-16 and the
// `project` row's retention entry in `docs/01-architecture/data-model.md`.
const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Soft-deletes a project: `deleted_at`/`purge_after` are stamped, the row (and everything
 * that references it -- `work_item` included) stays in the database. A real `DELETE` is
 * deliberately never issued here: `work_item.project_id` has `ON DELETE CASCADE` (#185),
 * and this route existing to let an ordinary user destroy every work item under a project
 * with no recovery window is exactly the defect #187 closes. Purging after the 30-day
 * window is a separate job (#198), not built yet.
 */
async function deleteProject(id: string, workspaceId: string) {
  const [deletedProject] = await db
    .update(projectTable)
    .set({
      deletedAt: new Date(),
      purgeAfter: new Date(Date.now() + PURGE_AFTER_MS),
    })
    .where(
      and(
        eq(projectTable.id, id),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
      ),
    )
    .returning();

  if (!deletedProject) {
    // Either the project never existed/belonged to this workspace, or it was already
    // soft-deleted -- both look the same from the outside: gone. Re-stamping an
    // already-deleted project would keep pushing its purge date out, silently
    // extending (and resetting) its recovery window every time someone retried the
    // delete.
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  return deletedProject;
}

export default deleteProject;
