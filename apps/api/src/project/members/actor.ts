import {
  authorityFor,
  can,
  expandCapabilities,
  isKeyCredential,
  type ResolvedIdentity,
  selectedGrantsFor,
} from "@taskdesk/permissions";
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
  loadProjectOwnerTeamIdFor,
} from "../hierarchy.repository";
import type { RosterActor } from "./service";

/**
 * Pure authority and rank derivation for project roster reads and writes.
 *
 * Keeps project-scoped `held` (including inherited ancestor grants, session-only instance-admin
 * bypass, and API/MCP key capability clamping) separate from `rank` so RL-3 custom roles whose
 * rank differs from their capability set are handled accurately.
 */
export function resolveRosterActorAuthority(
  identity: Pick<
    ResolvedIdentity,
    "authority" | "credential" | "keyCapabilities"
  > & {
    readonly side?: ResolvedIdentity["side"];
  },
  input: {
    workspaceId: string;
    projectId: string;
    organisationId?: string | null;
    ancestorProjectIds: readonly string[];
    isInstanceAdmin?: boolean;
  },
): {
  held: ReadonlySet<string> | null;
  rank: number;
  canManageMembers: boolean;
} {
  const instanceAdmin =
    input.isInstanceAdmin ??
    can(identity as ResolvedIdentity, "instance:admin", "instance", {
      instance: true,
    });
  // P4R1-M1: what the caller holds at this project, the same selection the evaluator makes,
  // clamped to the frozen subset of the API key when the request carries one (`can()` does the
  // same; a key credential without a subset holds nothing).
  const keyed = isKeyCredential(identity.credential);
  const resolved =
    instanceAdmin && !keyed
      ? null
      : authorityFor(identity, "project", {
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          organisationId: input.organisationId ?? undefined,
          ancestorProjectIds: input.ancestorProjectIds,
        });
  let held: ReadonlySet<string> | null = resolved;
  if (resolved !== null && (keyed || identity.keyCapabilities !== undefined)) {
    const keyHeld = expandCapabilities(identity.keyCapabilities ?? []);
    held = new Set([...resolved].filter((name) => keyHeld.has(name)));
  }
  const grantedRank = Math.max(
    0,
    ...selectedGrantsFor(identity, "project", {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ancestorProjectIds: input.ancestorProjectIds,
    }).map((grant) => grant.rank),
  );
  const rank =
    instanceAdmin && !keyed ? Math.max(100, grantedRank) : grantedRank;
  const canManageMembers = held === null || held.has("project:manage_members");
  return { held, rank, canManageMembers };
}

/** The acting person and their rank in the project, for the authority-minting roster writes. */
export async function resolveRosterActor(
  c: Context,
  scope: { workspaceId: string; projectId: string },
): Promise<RosterActor> {
  const userId = c.get("userId") as string;
  const identity = await resolveCallerIdentity(c, userId);
  if (!identity) throw new HTTPException(403, { message: "Forbidden" });
  const project = await findLiveProject(db, scope.workspaceId, scope.projectId);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  const isInstanceAdmin = can(identity, "instance:admin", "instance", {
    instance: true,
  });
  const keyed = isKeyCredential(identity.credential);
  const ancestorProjectIds =
    isInstanceAdmin && !keyed
      ? []
      : await loadProjectAncestorIds(db, scope.workspaceId, scope.projectId);
  const { held, rank, canManageMembers } = resolveRosterActorAuthority(
    identity,
    {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      organisationId: project.organisationId,
      ancestorProjectIds,
      isInstanceAdmin,
    },
  );
  return {
    personId: identity.personId,
    rank,
    actorId: userId,
    actorType: c.get("apiKey") ? "api_key" : "person",
    held,
    canManageMembers,
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
        ownerTeamId: await loadProjectOwnerTeamIdFor(
          db,
          identity,
          input.workspaceId,
          parent.id,
        ),
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
