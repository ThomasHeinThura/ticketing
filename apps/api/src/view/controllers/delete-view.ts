import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { assertCanEditView } from "../assert-can-edit-view";

// `pending-actions.md` PA-1/PA-2 requires a durable pending_action before any delete and
// explicitly says nothing is deleted at request time. The shared mechanism is tracked by
// #428 and is not implemented yet. Until it exists, fail closed after the route's normal
// reach/capability/owner checks: do not mutate the view, create a fake pending record, or
// return 202 as if approval could be completed.
async function deleteView(id: string, personId: string, userId: string) {
  const view = await db.query.savedViewTable.findFirst({
    where: (savedView, { eq }) => eq(savedView.id, id),
  });

  if (!view) {
    throw new HTTPException(404, { message: "Saved view not found" });
  }

  await assertCanEditView(view, personId, userId);

  return "Saved-view deletion is unavailable until the pending-action approval flow is implemented (#428); nothing was deleted.";
}

export default deleteView;
