import { and, eq, inArray, or } from "drizzle-orm";
import db from "../../database";
import { savedViewTable, teamMemberTable } from "../../database/schema";

const PINNED_VIEWS_KEY = "pinned_view_ids";

// SV-15..SV-18's reach rule: private → owner only, team → the shared team's members,
// workspace → anyone (workspace membership is already established by
// `workspaceAccess.fromQuery()` before this runs).
async function listViews(
  workspaceId: string,
  personId: string,
  userId: string,
) {
  const teamIds = await db
    .select({ teamId: teamMemberTable.teamId })
    .from(teamMemberTable)
    .where(eq(teamMemberTable.userId, userId));
  const teamIdList = teamIds.map((t) => t.teamId);

  const reachPredicate = or(
    eq(savedViewTable.visibility, "workspace"),
    eq(savedViewTable.createdBy, personId),
    teamIdList.length > 0
      ? and(
          eq(savedViewTable.visibility, "team"),
          inArray(savedViewTable.sharedWithTeamId, teamIdList),
        )
      : undefined,
  );

  const [views, preference] = await Promise.all([
    db
      .select()
      .from(savedViewTable)
      .where(and(eq(savedViewTable.workspaceId, workspaceId), reachPredicate)),
    db.query.userPreferenceTable.findFirst({
      where: (preferenceRow, { and, eq }) =>
        and(
          eq(preferenceRow.personId, personId),
          eq(preferenceRow.scope, "workspace"),
          eq(preferenceRow.scopeId, workspaceId),
          eq(preferenceRow.key, PINNED_VIEWS_KEY),
        ),
    }),
  ]);

  const pinnedIds = new Set(
    Array.isArray(preference?.value)
      ? preference.value.filter(
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
