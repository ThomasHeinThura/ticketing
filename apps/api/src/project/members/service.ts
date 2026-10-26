import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import { projectMembershipKeys } from "../../identity/membership-projection";
import { lockProjectMembershipScopes } from "../../identity/repository";
import { invalidateNativeAuthorization } from "../../ws";
import { descendantProjectIds, reachAncestorIds } from "../hierarchy";
import {
  findLiveProject,
  loadProjectAncestorIds,
  loadWorkspaceAncestry,
} from "../hierarchy.repository";
import {
  buildRoster,
  decideRosterRemoval,
  previewReparentAccess,
  type RosterEntry,
  type RosterRoleRef,
} from "./roster";
import {
  findActiveDirectGrant,
  insertAdminProjectGrant,
  isWorkspaceMemberPerson,
  listProjectScopeRoles,
  listRosterCandidates,
  loadProjectNames,
  loadRosterRows,
  lockPersonById,
  ROSTER_ROLE_DEFINITIONS,
  ROSTER_ROLE_KEYS,
  resolveRosterRole,
  revokeDirectGrant,
  setDirectGrantRole,
} from "./roster.repository";

export type RosterActor = {
  /** The acting person (`membership_grant.granted_by_person_id`). */
  personId: string;
  /** The actor's rank in this project (`callerRankInProject`). */
  rank: number;
  actorId: string;
  actorType: "person" | "api_key";
};

type Scope = { workspaceId: string; projectId: string };

async function requireProject(tx: Transaction | typeof db, scope: Scope) {
  const project = await findLiveProject(tx, scope.workspaceId, scope.projectId);
  if (!project) throw new HTTPException(404, { message: "Project not found" });
  return project;
}

async function loadRoster(
  executor: Transaction | typeof db,
  scope: Scope,
): Promise<RosterEntry[]> {
  const ancestorIds = await loadProjectAncestorIds(
    executor,
    scope.workspaceId,
    scope.projectId,
  );
  const ids = [scope.projectId, ...ancestorIds];
  const [rowsByProject, names] = await Promise.all([
    loadRosterRows(executor, ids),
    loadProjectNames(executor, scope.workspaceId, ancestorIds),
  ]);
  return buildRoster({
    direct: rowsByProject.get(scope.projectId) ?? [],
    ancestors: ancestorIds.map((id) => ({
      projectId: id,
      projectName: names.get(id) ?? id,
      rows: rowsByProject.get(id) ?? [],
    })),
  });
}

/** `GET /api/projects/{projectId}/members` */
export async function listProjectMembers(scope: Scope, callerRank: number) {
  await requireProject(db, scope);
  const [members, existing] = await Promise.all([
    loadRoster(db, scope),
    listProjectScopeRoles(db, scope.workspaceId),
  ]);
  const byKey = new Map(existing.map((role) => [role.roleKey, role]));
  // The canonical keys are always offered; one not yet created has `roleId: null` and is
  // created on first use. Any other project-scope role the workspace holds is listed too.
  const roles = [
    ...ROSTER_ROLE_KEYS.map((key) => {
      const row = byKey.get(key);
      const built = ROSTER_ROLE_DEFINITIONS[key];
      return {
        roleKey: key,
        roleName: row?.roleName ?? built.name,
        roleRank: row?.roleRank ?? builtInRank(key),
        roleId: row?.roleId ?? null,
      };
    }),
    ...existing
      .filter((role) => !ROSTER_ROLE_KEYS.includes(role.roleKey as never))
      .map((role) => ({
        roleKey: role.roleKey,
        roleName: role.roleName,
        roleRank: role.roleRank,
        roleId: role.roleId as string | null,
      })),
  ].sort(
    (a, b) => a.roleRank - b.roleRank || a.roleKey.localeCompare(b.roleKey),
  );
  return { members, roles, callerRank };
}

function builtInRank(key: (typeof ROSTER_ROLE_KEYS)[number]): number {
  return key === "project-lead" ? 50 : key === "project-member" ? 40 : 20;
}

/** `GET /api/projects/{projectId}/members/candidates` */
export async function listProjectMemberCandidates(scope: Scope) {
  await requireProject(db, scope);
  return listRosterCandidates(db, scope.workspaceId, scope.projectId);
}

async function auditRoster(
  tx: Transaction,
  scope: Scope,
  actor: RosterActor,
  target: { personId: string; organisationId: string },
  detail: {
    change: "added" | "role_changed" | "removed";
    before: RosterRoleRef | null;
    after: RosterRoleRef | null;
  },
) {
  await appendAuditLog(tx, {
    actorId: actor.actorId,
    actorType: actor.actorType,
    organisationId: target.organisationId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    action: "membership.changed",
    entityType: "membership",
    entityId: target.personId,
    before: detail.before
      ? {
          scope: "project",
          scopeId: scope.projectId,
          role: detail.before.roleKey,
        }
      : null,
    after: {
      source: "project_roster",
      change: detail.change,
      scope: "project",
      scopeId: scope.projectId,
      role: detail.after?.roleKey ?? null,
      granted: detail.after !== null,
    },
  });
}

function assertCanGrant(actor: RosterActor, role: RosterRoleRef) {
  if (role.roleRank > actor.rank) {
    throw new HTTPException(403, {
      message:
        "role_exceeds_caller_authority: you cannot grant a role above your own rank",
    });
  }
}

async function requireTargetPerson(tx: Transaction, personId: string) {
  // Person row first (repo-wide lock order), then grants inside projectMembershipKeys.
  const person = await lockPersonById(tx, personId);
  if (!person) throw new HTTPException(404, { message: "Person not found" });
  return person;
}

/** `POST /api/projects/{projectId}/members` */
export async function addProjectMember(
  scope: Scope,
  input: { personId: string; roleKey: string },
  actor: RosterActor,
) {
  await db.transaction(async (tx) => {
    await requireProject(tx, scope);
    const person = await requireTargetPerson(tx, input.personId);
    if (!(await lockProjectMembershipScopes(tx, [scope.projectId])))
      throw new HTTPException(404, { message: "Project not found" });
    // PR-8: staff only. Inactive people cannot be added (AS-5 would refuse them anyway).
    if (
      person.side !== "staff" ||
      !person.active ||
      !(await isWorkspaceMemberPerson(tx, scope.workspaceId, person.userId))
    ) {
      throw new HTTPException(422, {
        message:
          "person_not_eligible: only active staff members of this workspace can join a project roster",
      });
    }
    const role = await resolveRosterRole(tx, scope.workspaceId, input.roleKey);
    if (!role) {
      throw new HTTPException(422, { message: "project_role_not_found" });
    }
    assertCanGrant(actor, role);
    if (await findActiveDirectGrant(tx, person.id, scope.projectId)) {
      throw new HTTPException(409, {
        message: "already_member: this person is already on the project roster",
      });
    }
    await insertAdminProjectGrant(tx, {
      personId: person.id,
      projectId: scope.projectId,
      roleId: role.roleId,
      grantedByPersonId: actor.personId,
    });
    await projectMembershipKeys(tx, [
      { personId: person.id, scope: "project", scopeId: scope.projectId },
    ]);
    await auditRoster(
      tx,
      scope,
      actor,
      { personId: person.id, organisationId: person.organisationId },
      {
        change: "added",
        before: null,
        after: role,
      },
    );
  });
  await invalidateNativeAuthorization({ projectId: scope.projectId });
  return loadRoster(db, scope);
}

/**
 * `PATCH /api/projects/{projectId}/members/{personId}` (PR-3): change a role. On a person who
 * is only inherited (or only held by an identity-provider mapping) this writes the explicit
 * child row that overrides it.
 */
export async function updateProjectMemberRole(
  scope: Scope,
  input: { personId: string; roleKey: string },
  actor: RosterActor,
) {
  await db.transaction(async (tx) => {
    await requireProject(tx, scope);
    const person = await requireTargetPerson(tx, input.personId);
    if (!(await lockProjectMembershipScopes(tx, [scope.projectId])))
      throw new HTTPException(404, { message: "Project not found" });
    const roster = await loadRoster(tx, scope);
    const current = roster.find((entry) => entry.personId === person.id);
    if (!current) {
      throw new HTTPException(404, {
        message: "Member not found on this project",
      });
    }
    if (current.roleRank > actor.rank) {
      throw new HTTPException(403, {
        message:
          "role_exceeds_caller_authority: you cannot change a member whose role is above your own rank",
      });
    }
    const role = await resolveRosterRole(tx, scope.workspaceId, input.roleKey);
    if (!role) {
      throw new HTTPException(422, { message: "project_role_not_found" });
    }
    assertCanGrant(actor, role);
    if (current.source === "direct" && current.roleId === role.roleId) return;

    const grant = await findActiveDirectGrant(tx, person.id, scope.projectId);
    if (grant) await setDirectGrantRole(tx, grant.id, role.roleId);
    else {
      await insertAdminProjectGrant(tx, {
        personId: person.id,
        projectId: scope.projectId,
        roleId: role.roleId,
        grantedByPersonId: actor.personId,
      });
    }
    await projectMembershipKeys(tx, [
      { personId: person.id, scope: "project", scopeId: scope.projectId },
    ]);
    await auditRoster(
      tx,
      scope,
      actor,
      { personId: person.id, organisationId: person.organisationId },
      {
        change: "role_changed",
        before: current,
        after: role,
      },
    );
  });
  await invalidateNativeAuthorization({ projectId: scope.projectId });
  return loadRoster(db, scope);
}

/**
 * `DELETE /api/projects/{projectId}/members/{personId}` (PR-4): removes a DIRECT row only. An
 * inherited membership answers 409 `inherited_membership` naming the ancestor to remove it at.
 */
export async function removeProjectMember(
  scope: Scope,
  input: { personId: string },
  actor: RosterActor,
) {
  await db.transaction(async (tx) => {
    await requireProject(tx, scope);
    const person = await requireTargetPerson(tx, input.personId);
    if (!(await lockProjectMembershipScopes(tx, [scope.projectId])))
      throw new HTTPException(404, { message: "Project not found" });
    const { parents, deleted } = await loadWorkspaceAncestry(
      tx,
      scope.workspaceId,
    );
    const ancestorIds = reachAncestorIds(parents, deleted, scope.projectId);
    const rowsByProject = await loadRosterRows(tx, [
      scope.projectId,
      ...ancestorIds,
    ]);
    const directRow = (rowsByProject.get(scope.projectId) ?? []).find(
      (row) => row.personId === person.id,
    );
    const verdict = decideRosterRemoval({
      directRow,
      ancestorIdsNearestFirst: ancestorIds,
      ancestorMemberOf: new Set(
        ancestorIds.filter((id) =>
          (rowsByProject.get(id) ?? []).some(
            (row) => row.personId === person.id,
          ),
        ),
      ),
    });
    if (!verdict.allowed) {
      if (verdict.code === "not_on_roster") {
        throw new HTTPException(404, {
          message: "Member not found on this project",
        });
      }
      if (verdict.code === "inherited_membership") {
        throw new HTTPException(409, {
          message: `inherited_membership: inherited from project ${verdict.inheritedFrom}; remove this person at that parent project`,
        });
      }
      throw new HTTPException(409, {
        message:
          "managed_membership: this membership comes from an identity-provider mapping; change the mapping instead",
      });
    }
    if (directRow && directRow.roleRank > actor.rank) {
      throw new HTTPException(403, {
        message:
          "role_exceeds_caller_authority: you cannot remove a member whose role is above your own rank",
      });
    }
    const grant = await findActiveDirectGrant(tx, person.id, scope.projectId);
    if (!grant) {
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    }
    await revokeDirectGrant(tx, grant.id);
    await projectMembershipKeys(tx, [
      { personId: person.id, scope: "project", scopeId: scope.projectId },
    ]);
    await auditRoster(
      tx,
      scope,
      actor,
      { personId: person.id, organisationId: person.organisationId },
      {
        change: "removed",
        before: directRow ?? null,
        after: null,
      },
    );
  });
  await invalidateNativeAuthorization({ projectId: scope.projectId });
  return loadRoster(db, scope);
}

/**
 * `GET /api/projects/{projectId}/ownership/preview?parentId=` : who gains and loses access if
 * the project is re-parented (edge-case table, "Project moved to a different parent"). Same
 * ancestor reach rules as the roster; nothing is written.
 */
export async function previewReparent(
  scope: Scope,
  newParentId: string | null,
) {
  const project = await requireProject(db, scope);
  const { parents, deleted } = await loadWorkspaceAncestry(
    db,
    scope.workspaceId,
  );
  const moved = new Map(parents);
  moved.set(scope.projectId, newParentId);
  const oldAncestors = reachAncestorIds(parents, deleted, scope.projectId);
  const newAncestors =
    newParentId === null
      ? []
      : reachAncestorIds(moved, deleted, scope.projectId);
  const ids = [...new Set([scope.projectId, ...oldAncestors, ...newAncestors])];
  const [rowsByProject, names] = await Promise.all([
    loadRosterRows(db, ids),
    loadProjectNames(db, scope.workspaceId, ids),
  ]);
  const directPersonIds = new Set(
    (rowsByProject.get(scope.projectId) ?? []).map((row) => row.personId),
  );
  const descendantCount = descendantProjectIds(parents, scope.projectId).length;
  return {
    projectId: scope.projectId,
    currentParentId: project.parentId,
    newParentId,
    descendantProjectCount: descendantCount,
    ...previewReparentAccess({
      parents,
      deleted,
      projectId: scope.projectId,
      newParentId,
      directPersonIds,
      rowsByProject,
      projectNames: names,
    }),
  };
}
