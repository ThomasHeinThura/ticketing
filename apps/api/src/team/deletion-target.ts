import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { teamTable } from "../database/schema";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { deleteTeamRow, deletionBlockers } from "./repository";

export const TEAM_DELETION_ROUTE = "DELETE /api/teams/{id}" as const;

/**
 * TM-7: deleting a team is a click-level pending action, refused while the team is the CAB or
 * has saved views shared with it or owns a project (`project.owner_team_id`). The refusal is raised at request time and again at approval.
 *
 * Registered in `registeredDeletionTargets()` (pending-action/deletion-targets.ts) by the
 * coordinator.
 */
export const teamDeletionTarget: RegisteredDeletionTarget = {
  targetType: "team",
  routeKey: TEAM_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Team not found",
  load: async (tx, id) => {
    const [team] = await tx
      .select()
      .from(teamTable)
      .where(eq(teamTable.id, id))
      .for("update")
      .limit(1);
    if (!team) return undefined;
    return {
      id: team.id,
      workspaceId: team.workspaceId,
      projectId: null,
      organisationId: null,
      name: team.name,
      summary: { teamId: team.id, name: team.name },
      version: registeredDeletionFingerprint(team),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [team] = await tx
      .select({ id: teamTable.id, workspaceId: teamTable.workspaceId })
      .from(teamTable)
      .where(eq(teamTable.id, id))
      .limit(1);
    return team
      ? {
          id: team.id,
          workspaceId: team.workspaceId,
          projectId: null,
          organisationId: null,
        }
      : undefined;
  },
  assertDeletable: async (tx, loaded) => {
    const [team] = await tx
      .select()
      .from(teamTable)
      .where(
        and(
          eq(teamTable.id, loaded.id),
          eq(teamTable.workspaceId, loaded.workspaceId),
        ),
      )
      .limit(1);
    if (!team) return;
    const blockers = await deletionBlockers(tx, team);
    if (blockers.length > 0)
      throw new HTTPException(409, { message: blockers.join(" ") });
  },
  execute: async (tx, { loaded, identity }) => {
    const deleted = await deleteTeamRow(tx, loaded.id, loaded.workspaceId, {
      userId: identity.userId,
      actorType: "person",
    });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
