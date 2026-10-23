import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  evaluateProjectRead,
  resolveCallerIdentity,
} from "../../utils/has-project-reach";
import {
  findLiveProject,
  loadProjectAncestorIds,
} from "../hierarchy.repository";
import { callerRankInProject } from "./roster";
import type { RosterActor } from "./service";

/** The acting person and their rank in the project, for the authority-minting roster writes. */
export async function resolveRosterActor(
  c: Context,
  scope: { workspaceId: string; projectId: string },
): Promise<RosterActor> {
  const userId = c.get("userId") as string;
  const identity = await resolveCallerIdentity(c, userId);
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  return {
    personId: identity.personId,
    rank: callerRankInProject(
      identity.authority,
      scope.projectId,
      scope.workspaceId,
    ),
    actorId: userId,
    actorType: c.get("apiKey") ? "api_key" : "person",
  };
}

/**
 * Re-parenting needs `project:manage_members` on the prospective parent as well as the child
 * (the registered policy covers the child). An unreachable parent answers exactly like a
 * missing one. Shared by `PATCH .../ownership` and its access preview.
 */
export async function assertCanManageProspectiveParent(
  c: Context,
  input: { workspaceId: string; parentId: string },
) {
  const userId = c.get("userId") as string;
  const parent = await findLiveProject(db, input.workspaceId, input.parentId);
  const identity = parent ? await resolveCallerIdentity(c, userId) : null;
  const decision = parent
    ? evaluateProjectRead(identity, "project:manage_members", "project", {
        projectId: parent.id,
        workspaceId: input.workspaceId,
        organisationId: parent.organisationId,
        ancestorProjectIds: await loadProjectAncestorIds(
          db,
          input.workspaceId,
          parent.id,
        ),
        ownerTeamId: null,
      })
    : null;
  if (!parent || !decision?.reachable) {
    throw new HTTPException(422, { message: "project_parent_not_found" });
  }
  if (!decision.capable) {
    throw new HTTPException(403, {
      message: "Insufficient permissions on the prospective parent project",
    });
  }
  return parent;
}
