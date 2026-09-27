import { and, eq, inArray, or } from "drizzle-orm";
import db from "../../database";
import { savedViewTable, teamMemberTable } from "../../database/schema";

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

  return db
    .select()
    .from(savedViewTable)
    .where(and(eq(savedViewTable.workspaceId, workspaceId), reachPredicate));
}

export default listViews;
