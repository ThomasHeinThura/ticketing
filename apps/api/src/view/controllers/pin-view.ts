import { publishEvent } from "../../events";
import { type SavedViewAuditActor, writeSavedViewAudit } from "../audit";
import { togglePinnedView } from "../repository";
import getView from "./get-view";

// SV-20: "Views can be pinned to the sidebar, per user." `POST /api/views/{id}/pin` is
// `self (kind 2 -- the caller's own user_preference row)` per search-and-saved-views.md's
// API table -- a toggle, not a body-carrying mutation: calling it again on an already-
// pinned view unpins it. Stored as one `user_preference` row per (person, workspace),
// `key = 'pinned_view_ids'`, `value` a plain string array -- the table's own shape is
// generic (see `userPreferenceTable`'s schema.ts comment), this is the one concrete use
// this PR wires up.
async function pinView(
  viewId: string,
  personId: string,
  userId: string,
  auditActor: SavedViewAuditActor,
) {
  // workspaceAccess.fromSavedView establishes workspace reach, but private/team
  // visibility is a separate SV-15..SV-18 rule. Apply the same check as direct reads
  // before writing the caller's preference, so knowing an id cannot pin an invisible view.
  const view = await getView(viewId, personId, userId);

  const mutation = await togglePinnedView(personId, view.workspaceId, viewId);

  await writeSavedViewAudit({
    actor: auditActor,
    action: "saved_view.pinned",
    workspaceId: view.workspaceId,
    projectId: view.scope === "project" ? view.scopeId : null,
    entityId: viewId,
    before: { pinned: mutation.wasPinned },
    after: { pinned: mutation.isPinned },
  });

  await publishEvent("saved_view.pinned", {
    savedViewId: viewId,
    workspaceId: view.workspaceId,
    userId,
    pinned: mutation.isPinned,
  });

  return { pinnedViewIds: mutation.pinnedViewIds };
}

export default pinView;
