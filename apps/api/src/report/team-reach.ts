import { can } from "@taskdesk/permissions";
import { type SQL, sql } from "drizzle-orm";
import type { ReportContext } from "./types";

/** Validated full-workspace reach retains R6-06 metadata; read_all alone never widens it. */
export function canReadAllTeams(
  ctx: Pick<ReportContext, "workspaceId" | "identity">,
): boolean {
  const reach = ctx.identity.reach;
  const workspaceWide =
    reach.kind === "all" ||
    (reach.kind === "membership_with_workspaces" &&
      reach.workspaceIds.includes(ctx.workspaceId));
  return (
    workspaceWide &&
    can(ctx.identity, "report:read_all", "workspace", {
      workspaceId: ctx.workspaceId,
    })
  );
}

/** Workspace-wide team visibility, or membership/ownership within current project reach. */
export function reachableTeam(
  ctx: Pick<ReportContext, "workspaceId" | "identity" | "reach">,
  team: SQL = sql`t`,
): SQL {
  if (canReadAllTeams(ctx)) return sql`true`;
  return sql`(
    EXISTS (SELECT 1 FROM team_member mine WHERE mine.team_id = ${team}.id AND mine.user_id = ${ctx.identity.userId})
    OR EXISTS (SELECT 1 FROM project p WHERE p.owner_team_id = ${team}.id AND p.workspace_id = ${ctx.workspaceId}
      AND p.deleted_at IS NULL AND ${ctx.reach})
  )`;
}
