import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { assertCanReadView } from "../assert-can-read-view";

// `workspaceAccess.fromSavedView()` has already confirmed the caller reaches the view's
// own workspace; this is SV-15..SV-18's finer visibility rule on top of that. A 404, not
// 403 -- "not found or out of reach" stays indistinguishable, the same reasoning
// `workspace-access-middleware.ts`'s own `RESOURCE_NOT_FOUND_MESSAGE` comment gives.
async function getView(id: string, personId: string, userId: string) {
  const view = await db.query.savedViewTable.findFirst({
    where: (savedView, { eq }) => eq(savedView.id, id),
  });

  if (!view) {
    throw new HTTPException(404, { message: "Saved view not found" });
  }

  await assertCanReadView(view, personId, userId);
  return view;
}

export default getView;
