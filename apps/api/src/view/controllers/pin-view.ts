import { and, eq } from "drizzle-orm";
import db from "../../database";
import { userPreferenceTable } from "../../database/schema";
import { publishEvent } from "../../events";
import getView from "./get-view";

const PINNED_VIEWS_KEY = "pinned_view_ids";

// SV-20: "Views can be pinned to the sidebar, per user." `POST /api/views/{id}/pin` is
// `self (kind 2 -- the caller's own user_preference row)` per search-and-saved-views.md's
// API table -- a toggle, not a body-carrying mutation: calling it again on an already-
// pinned view unpins it. Stored as one `user_preference` row per (person, workspace),
// `key = 'pinned_view_ids'`, `value` a plain string array -- the table's own shape is
// generic (see `userPreferenceTable`'s schema.ts comment), this is the one concrete use
// this PR wires up.
async function pinView(viewId: string, personId: string, userId: string) {
  // workspaceAccess.fromSavedView establishes workspace reach, but private/team
  // visibility is a separate SV-15..SV-18 rule. Apply the same check as direct reads
  // before writing the caller's preference, so knowing an id cannot pin an invisible view.
  const view = await getView(viewId, personId, userId);

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userPreferenceTable)
      .where(
        and(
          eq(userPreferenceTable.personId, personId),
          eq(userPreferenceTable.scope, "workspace"),
          eq(userPreferenceTable.scopeId, view.workspaceId),
          eq(userPreferenceTable.key, PINNED_VIEWS_KEY),
        ),
      )
      .limit(1);

    const currentIds = Array.isArray(existing?.value)
      ? (existing.value as unknown[]).filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    const pinned = currentIds.includes(viewId);
    const nextIds = pinned
      ? currentIds.filter((entry) => entry !== viewId)
      : [...currentIds, viewId];

    if (existing) {
      await tx
        .update(userPreferenceTable)
        .set({ value: nextIds })
        .where(eq(userPreferenceTable.id, existing.id));
    } else {
      await tx.insert(userPreferenceTable).values({
        personId,
        scope: "workspace",
        scopeId: view.workspaceId,
        key: PINNED_VIEWS_KEY,
        value: nextIds,
      });
    }

    await publishEvent("saved_view.pinned", {
      savedViewId: viewId,
      workspaceId: view.workspaceId,
      userId,
      pinned: !pinned,
    });

    return { pinnedViewIds: nextIds };
  });
}

export default pinView;
