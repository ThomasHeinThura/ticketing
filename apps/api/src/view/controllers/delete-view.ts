import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { assertCanEditView } from "../assert-can-edit-view";

// search-and-saved-views.md's API table marks this "202 pending action" -- this codebase
// has no async delete-queue mechanism for any resource yet (grep across `apps/api/src`
// found none; `project`'s own soft-delete, the closest analogue, answers 200 synchronously
// with the deleted row). Rather than invent a queue this PR does not otherwise need, the
// delete runs synchronously and the ROUTE answers 202 (the literal status code the spec
// names), carrying the deleted view -- honest about being synchronous today, without
// silently downgrading the documented contract to 200. Disclosed in this PR's body.
async function deleteView(id: string, personId: string, userId: string) {
  const deleted = await db.transaction(async (tx) => {
    const view = await tx.query.savedViewTable.findFirst({
      where: (savedView, { eq }) => eq(savedView.id, id),
    });

    if (!view) {
      throw new HTTPException(404, { message: "Saved view not found" });
    }

    await assertCanEditView(view, personId, userId);

    const [row] = await tx
      .delete(savedViewTable)
      .where(eq(savedViewTable.id, id))
      .returning();

    if (!row) {
      throw new HTTPException(404, { message: "Saved view not found" });
    }

    await appendAuditLog(tx, {
      actorId: personId,
      actorType: "person",
      workspaceId: view.workspaceId,
      action: "saved_view.deleted",
      entityType: "saved_view",
      entityId: id,
      before: {
        name: view.name,
        visibility: view.visibility,
        sharedWithTeamId: view.sharedWithTeamId,
        layout: view.layout,
      },
      after: null,
    });

    return row;
  });

  await publishEvent("saved_view.deleted", {
    savedViewId: id,
    workspaceId: deleted.workspaceId,
    userId,
  });

  return deleted;
}

export default deleteView;
