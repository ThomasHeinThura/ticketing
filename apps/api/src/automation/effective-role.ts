import {
  authorityFor,
  type Capability,
  can,
  type ResolvedIdentity,
  type RoleGrant,
  selectedGrantsFor,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { roleTable } from "../database/schema";
import { expandedRoleCapabilities } from "../permissions/workspace-role-authority.repository";

/**
 * `AM-3`: an automation acts as a system actor with an explicit **effective role**, configured
 * per rule, and cannot exceed it. The role is a `role` row; every action is checked against that
 * role's capabilities at the triggering item's project before it runs. The author's own
 * authority is never consulted at execution (`AM-12`), only at save time, where the role must be
 * at or below the author's rank.
 */

export type EffectiveRole = {
  id: string;
  key: string;
  name: string;
  scope: string;
  workspaceId: string | null;
  rank: number;
  capabilities: readonly string[];
};

export async function loadRole(
  roleId: string,
  executor: Executor = db,
): Promise<EffectiveRole | undefined> {
  const [row] = await executor
    .select({
      id: roleTable.id,
      key: roleTable.key,
      name: roleTable.name,
      scope: roleTable.scope,
      workspaceId: roleTable.workspaceId,
      rank: roleTable.rank,
      capabilities: roleTable.capabilities,
    })
    .from(roleTable)
    .where(eq(roleTable.id, roleId))
    .limit(1);
  if (!row) return undefined;
  return {
    ...row,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
  };
}

/** A workspace-scope role of this workspace is the only kind a rule may run as. */
export function roleIsUsableForWorkspace(
  role: Pick<EffectiveRole, "scope" | "workspaceId">,
  workspaceId: string,
): boolean {
  return role.scope === "workspace" && role.workspaceId === workspaceId;
}

/**
 * The grants that stand for the author here. A workspace rule reads every instance and workspace
 * grant. A project rule reads the evaluator's own selection (`selectedGrantsFor`): a direct
 * project-scope grant replaces the workspace grants for that project, and with none the nearest
 * ancestor project's grants stand in. A save-time ceiling must not exceed what the author can do
 * in that project, so it follows the same narrowing.
 */
function authorGrants(
  identity: Pick<ResolvedIdentity, "authority">,
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[],
): readonly RoleGrant[] {
  if (projectId === null)
    return identity.authority.filter(
      (grant) =>
        grant.scope === "instance" ||
        (grant.scope === "workspace" && grant.scopeId === workspaceId),
    );
  return selectedGrantsFor(identity, "project", {
    workspaceId,
    projectId,
    ancestorProjectIds,
  });
}

/** The highest rank the identity holds that applies to this workspace (and project). */
export function callerRank(
  identity: Pick<ResolvedIdentity, "authority">,
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[] = [],
): number {
  let rank = 0;
  for (const grant of authorGrants(
    identity,
    workspaceId,
    projectId,
    ancestorProjectIds,
  ))
    rank = Math.max(rank, grant.rank);
  return rank;
}

/** "Set a rule's effective role: only to a role at or below your own rank." */
export function roleWithinCallerRank(
  role: Pick<EffectiveRole, "rank">,
  identity: Pick<ResolvedIdentity, "authority">,
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[] = [],
): boolean {
  return (
    role.rank <=
    callerRank(identity, workspaceId, projectId, ancestorProjectIds)
  );
}

/**
 * Rank alone is not authority (RL-3): the expanded capabilities the author holds here. A project
 * rule takes them from the evaluator's own `authorityFor`, so a project override or an inherited
 * parent override narrows them exactly as it narrows the author's real reach.
 */
export function callerCapabilities(
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities">,
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[] = [],
): Set<string> {
  let held: Set<string>;
  if (projectId === null) {
    held = new Set<string>();
    for (const grant of authorGrants(identity, workspaceId, null, []))
      for (const name of expandedRoleCapabilities(grant.capabilities))
        held.add(name);
  } else {
    held = new Set<string>(
      authorityFor(identity, "project", {
        workspaceId,
        projectId,
        ancestorProjectIds,
      }),
    );
  }
  // A personal API/MCP key acts as owner RBAC ∩ its frozen subset (rbac.md § MCP), so a rule
  // it saves may not run as a role holding anything outside that subset.
  if (identity.keyCapabilities !== undefined) {
    const keyHeld = expandedRoleCapabilities(identity.keyCapabilities);
    for (const name of [...held])
      if (!keyHeld.has(name as Capability)) held.delete(name);
  }
  return held;
}

/** Capabilities of the role the author does not hold (empty when the role is a subset). */
export function roleCapabilitiesMissing(
  role: Pick<EffectiveRole, "capabilities">,
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities">,
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[] = [],
): string[] {
  const held = callerCapabilities(
    identity,
    workspaceId,
    projectId,
    ancestorProjectIds,
  );
  return [...expandedRoleCapabilities(role.capabilities)].filter(
    (name) => !held.has(name),
  );
}

/** `AM-3` + `RL-3`: at or below the author's rank AND holding nothing the author does not. */
export function roleWithinCallerAuthority(
  role: Pick<EffectiveRole, "rank" | "capabilities">,
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities">,
  workspaceId: string,
  projectId: string | null,
  ancestorProjectIds: readonly string[] = [],
): { ok: true } | { ok: false; reason: "rank" | "capabilities" } {
  if (
    !roleWithinCallerRank(
      role,
      identity,
      workspaceId,
      projectId,
      ancestorProjectIds,
    )
  )
    return { ok: false, reason: "rank" };
  if (
    roleCapabilitiesMissing(
      role,
      identity,
      workspaceId,
      projectId,
      ancestorProjectIds,
    ).length
  )
    return { ok: false, reason: "capabilities" };
  return { ok: true };
}

/**
 * The identity an automation's actions are authorised as: the effective role and nothing else.
 * It has no membership, no reach and no key subset, so `can()` answers purely from the role.
 */
export function automationIdentity(role: EffectiveRole): Pick<
  ResolvedIdentity,
  "authority" | "keyCapabilities"
> & {
  credential: ResolvedIdentity["credential"];
  side: ResolvedIdentity["side"];
} {
  // Bound to the role's **own** workspace, never to whatever target is being asked about, so a
  // role can never be carried into another workspace by the caller's argument.
  const grant: RoleGrant = {
    roleKey: role.key,
    scope: "workspace",
    scopeId: role.workspaceId ?? "",
    rank: role.rank,
    capabilities: role.capabilities,
  };
  return { authority: [grant], credential: "session", side: "staff" };
}

export function roleMayAct(
  role: EffectiveRole,
  capability: Capability,
  target: { workspaceId: string; projectId: string },
): boolean {
  return can(automationIdentity(role), capability, "work_item", {
    workspaceId: target.workspaceId,
    projectId: target.projectId,
    workItemProjectId: target.projectId,
    ancestorProjectIds: [],
  });
}

/** Roles a person may pick for a rule in this workspace: usable, at or below their rank, and a capability subset of theirs. */
export async function listAssignableRoles(
  workspaceId: string,
  identity: Pick<ResolvedIdentity, "authority" | "keyCapabilities">,
  projectId: string | null,
  ancestorProjectIds: readonly string[] = [],
  executor: Executor = db,
) {
  const rows = await executor
    .select({
      id: roleTable.id,
      key: roleTable.key,
      name: roleTable.name,
      rank: roleTable.rank,
      capabilities: roleTable.capabilities,
    })
    .from(roleTable)
    .where(
      and(
        eq(roleTable.scope, "workspace"),
        eq(roleTable.workspaceId, workspaceId),
      ),
    )
    .orderBy(roleTable.rank, roleTable.key);
  const limit = callerRank(
    identity,
    workspaceId,
    projectId,
    ancestorProjectIds,
  );
  return rows
    .filter(
      (row) =>
        row.rank <= limit &&
        roleWithinCallerAuthority(
          {
            rank: row.rank,
            capabilities: Array.isArray(row.capabilities)
              ? row.capabilities.filter(
                  (entry): entry is string => typeof entry === "string",
                )
              : [],
          },
          identity,
          workspaceId,
          projectId,
          ancestorProjectIds,
        ).ok,
    )
    .map(({ id, key, name, rank }) => ({ id, key, name, rank }));
}
