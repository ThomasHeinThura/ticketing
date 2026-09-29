import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { teamMemberTable } from "../database/schema";

/**
 * Applies the saved-view visibility rule after workspace reach is established by the
 * route middleware. A 404 keeps an unreachable private/team view indistinguishable
 * from a missing row.
 */
export async function assertCanReadView(
  view: {
    visibility: string;
    createdBy: string;
    sharedWithTeamId: string | null;
  },
  personId: string,
  userId: string,
): Promise<void> {
  if (view.visibility === "workspace" || view.createdBy === personId) {
    return;
  }

  if (view.visibility === "team" && view.sharedWithTeamId) {
    const [membership] = await db
      .select({ id: teamMemberTable.id })
      .from(teamMemberTable)
      .where(
        and(
          eq(teamMemberTable.teamId, view.sharedWithTeamId),
          eq(teamMemberTable.userId, userId),
        ),
      )
      .limit(1);

    if (membership) {
      return;
    }
  }

  throw new HTTPException(404, { message: "Saved view not found" });
}
