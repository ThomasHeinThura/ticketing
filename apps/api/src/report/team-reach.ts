import { type SQL, sql } from "drizzle-orm";
import type { ReportContext } from "./types";

/** Team membership or ownership of a live project in the caller's current report reach. */
export function reachableTeam(
  ctx: Pick<ReportContext, "workspaceId" | "identity" | "reach">,
  team: SQL = sql`t`,
): SQL {
  return sql`(
    EXISTS (SELECT 1 FROM team_member mine WHERE mine.team_id = ${team}.id AND mine.user_id = ${ctx.identity.userId})
    OR EXISTS (SELECT 1 FROM project p WHERE p.owner_team_id = ${team}.id AND p.workspace_id = ${ctx.workspaceId}
      AND p.deleted_at IS NULL AND ${ctx.reach})
  )`;
}
