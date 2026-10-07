import { listSavedViewsForWorkspace } from "../repository";

// SV-15..SV-18's reach rule: private → owner only, team → the shared team's members,
// workspace → anyone (workspace membership is already established by
// `workspaceAccess.fromQuery()` before this runs).
async function listViews(
  workspaceId: string,
  personId: string,
  userId: string,
) {
  const { views, pinnedValue } = await listSavedViewsForWorkspace(
    workspaceId,
    personId,
    userId,
  );

  const pinnedIds = new Set(
    Array.isArray(pinnedValue)
      ? pinnedValue.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  );

  // The list is the read/restore path for SV-20: persist pin state per user, expose it
  // to the navigation consumer, and keep pinned views first. Pins to deleted or no-longer
  // reachable views remain inert in the generic preference value and are never returned.
  return views
    .map((savedView) => ({
      ...savedView,
      isPinned: pinnedIds.has(savedView.id),
    }))
    .sort((left, right) => Number(right.isPinned) - Number(left.isPinned));
}

export default listViews;
