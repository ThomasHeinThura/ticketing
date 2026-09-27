import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
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
  const view = await db.query.savedViewTable.findFirst({
    where: (savedView, { eq }) => eq(savedView.id, id),
  });

  if (!view) {
    throw new HTTPException(404, { message: "Saved view not found" });
  }

  await assertCanEditView(view, personId, userId);

  const [deleted] = await db
    .delete(savedViewTable)
    .where(eq(savedViewTable.id, id))
    .returning();

  if (!deleted) {
    throw new HTTPException(404, { message: "Saved view not found" });
  }

  await publishEvent("saved_view.deleted", {
    savedViewId: id,
    workspaceId: view.workspaceId,
    userId,
  });

  return deleted;
}

export default deleteView;
