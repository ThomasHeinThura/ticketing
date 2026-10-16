import { appendAuditLog } from "../audit/audit-writer";
import type { Transaction } from "../database/executor";
import { projectMembershipKeys } from "../identity/membership-projection";
import { workspaceMemberRoles } from "../utils/workspace-member-roles";
import {
  creatorHasWorkspaceSeesAll,
  findCreatorPerson,
  findCreatorPersonForUpdate,
  findProjectLeadRole,
  hasActiveDirectProjectGrant,
  insertProjectCreatorGrant,
  insertProjectLeadRole,
  listCreatorGrantPersonIds,
  lockCreatorGrantPeople,
  lockCreatorGrants,
  PROJECT_CREATOR_ORIGIN,
  PROJECT_LEAD_ROLE_KEY,
  type ProjectCreatorGrantFilter,
  revokeCreatorGrants as revokeCreatorGrantRows,
} from "./project-creator-grant.repository";

type Tx = Transaction;

export { PROJECT_CREATOR_ORIGIN, PROJECT_LEAD_ROLE_KEY };

/**
 * A project's creator holds a project-lead membership (decision log 2026-10-14, "A project's
 * creator holds a project-lead membership"; `rbac.md` § Reach step 3 and the project-lead role).
 *
 * Before this, a workspace `manager` (or a `member` creating an internal project) could create
 * a project and then had no reach to it: the board answered 404 and the project was missing
 * from their list. Owners and admins were unaffected, because they hold `sees_all`
 * (`workspace-admin-reach.ts`).
 *
 * WHAT IS WRITTEN, in the same transaction as the project insert:
 *  - `project.created_by` = the creator's staff `person.id` (NULL for older projects);
 *  - a DIRECT `membership_grant` on the project, `direct_origin = 'project_creator'` (written
 *    by nothing else, no granting person), carrying the project-scope `project-lead` role,
 *    projected onto the effective `membership` row by `projectMembershipKeys` exactly like any
 *    other grant;
 *  - an audit row (`membership.changed`, `after.source = 'project_creator'`).
 *
 * SKIPPED when the creator already holds an active workspace `sees_all` membership (owners and
 * admins): they already reach every project, and a project-scope role would not add reach.
 * It would also REPLACE their workspace authority for that project (a project-scope role
 * overrides workspace roles on that project, `authorityFor`), which an owner or admin must
 * never lose by creating a project. Everyone else is always granted.
 *
 * ROLE. `project-lead` is a per-workspace `role` row (`scope = 'project'`, `is_system`) whose
 * capabilities are EXACTLY the built-in `lead` list (`BUILT_IN_ROLES.lead`, rbac.md). Unlike
 * the #733 reach carriers it carries real capabilities, so it grants real authority on the
 * project; it is written by migration 0124 for existing workspaces and on demand here. A
 * same-keyed row that is not `is_system` is never trusted: no grant is made (fail closed).
 * Identity-provider mappings can never target it: `validateIdpMappingRole` accepts only
 * workspace- and organisation-scope roles, so a project-scope role is refused.
 *
 * LIFECYCLE. Only grants with `direct_origin = 'project_creator'` are ever revoked here; an
 * admin-made direct grant and any external (SCIM / OIDC / JIT) grant are never touched
 * (`projectMembershipKeys` reprojects whatever remains). Revoked when the person leaves or is
 * removed from the workspace or their account is erased (`revokeProjectCreatorGrantsForMember`)
 * and when the project is deleted (`revokeProjectCreatorGrantsForProject`). A workspace delete
 * removes them with every other membership row (`deleteWorkspaceRoleDependents`, #732).
 *
 * LOCK ORDER matches `workspace-admin-reach.ts`: person row `FOR UPDATE` first, then grant
 * rows, audit chain last.
 */

/** The role id to grant, or `null` when the workspace holds an untrusted same-keyed row. */
export async function ensureProjectLeadRole(
  tx: Tx,
  workspaceId: string,
): Promise<string | null> {
  let row = await findProjectLeadRole(tx, workspaceId);
  if (!row) {
    await insertProjectLeadRole(tx, workspaceId);
    row = await findProjectLeadRole(tx, workspaceId);
  }
  return row?.isSystem === true ? row.id : null;
}

/** The creator's staff person (locked `FOR UPDATE`), or `null` when none is provisioned. */
export async function lockCreatorPerson(tx: Tx, userId: string) {
  const person = await findCreatorPersonForUpdate(tx, userId);
  return person?.side === "staff" ? person : null;
}

/**
 * Grant the creator the project-lead role on a project this transaction just inserted.
 * Idempotent per (person, project): the direct-grant unique index would reject a duplicate,
 * so an existing active direct grant is left alone.
 */
export async function grantProjectCreatorLead(
  tx: Tx,
  input: {
    workspaceId: string;
    projectId: string;
    person: { id: string; organisationId: string };
  },
): Promise<"granted" | "skipped_sees_all" | "skipped_no_role" | "existing"> {
  const { workspaceId, projectId, person } = input;

  if (await creatorHasWorkspaceSeesAll(tx, person.id, workspaceId)) {
    return "skipped_sees_all";
  }

  const roleId = await ensureProjectLeadRole(tx, workspaceId);
  if (roleId === null) {
    // Fail closed, but never silently: the creator gets no project reach from this grant.
    console.warn(
      `⚠️ project-lead grant skipped for workspace ${workspaceId}, project ${projectId}: an untrusted (non-system) project-scope role keyed "${PROJECT_LEAD_ROLE_KEY}" exists.`,
    );
    return "skipped_no_role";
  }

  if (await hasActiveDirectProjectGrant(tx, person.id, projectId)) {
    return "existing";
  }

  await insertProjectCreatorGrant(tx, {
    personId: person.id,
    projectId,
    roleId,
  });
  await projectMembershipKeys(tx, [
    { personId: person.id, scope: "project", scopeId: projectId },
  ]);

  await appendAuditLog(tx, {
    actorId: person.id,
    actorType: "person",
    organisationId: person.organisationId,
    workspaceId,
    projectId,
    action: "membership.changed",
    entityType: "membership",
    entityId: person.id,
    after: {
      source: PROJECT_CREATOR_ORIGIN,
      scope: "project",
      scopeId: projectId,
      role: PROJECT_LEAD_ROLE_KEY,
      granted: true,
    },
  });
  return "granted";
}

async function revokeCreatorGrants(
  tx: Tx,
  filter: ProjectCreatorGrantFilter,
  reason: string,
): Promise<number> {
  // Person rows first, in one deterministic order (the repo-wide lock order), then the grants.
  const candidatePersonIds = await listCreatorGrantPersonIds(tx, filter);
  if (candidatePersonIds.length === 0) return 0;
  const people = await lockCreatorGrantPeople(tx, [
    ...new Set(candidatePersonIds),
  ]);
  const organisationOf = new Map(
    people.map((person) => [person.id, person.organisationId]),
  );

  const grants = await lockCreatorGrants(tx, filter);
  if (grants.length === 0) return 0;

  await revokeCreatorGrantRows(
    tx,
    grants.map((grant) => grant.id),
    new Date(),
  );
  await projectMembershipKeys(
    tx,
    grants.map((grant) => ({
      personId: grant.personId,
      scope: "project" as const,
      scopeId: grant.scopeId,
    })),
  );

  for (const grant of grants) {
    await appendAuditLog(tx, {
      actorId: null,
      actorType: "system",
      organisationId: organisationOf.get(grant.personId) ?? null,
      workspaceId: filter.workspaceId,
      projectId: grant.scopeId,
      action: "membership.changed",
      entityType: "membership",
      entityId: grant.personId,
      after: {
        source: PROJECT_CREATOR_ORIGIN,
        scope: "project",
        scopeId: grant.scopeId,
        role: PROJECT_LEAD_ROLE_KEY,
        granted: false,
        reason,
      },
    });
  }
  return grants.length;
}

/**
 * The person is no longer a member of the workspace (removed, left, or their account was
 * erased): revoke every creator grant they hold on that workspace's projects. A person who is
 * still a member is left alone, so this is safe to call from any membership writer.
 */
export async function revokeProjectCreatorGrantsForMember(
  tx: Tx,
  workspaceId: string,
  userId: string,
): Promise<number> {
  if ((await workspaceMemberRoles(tx, workspaceId, userId)).length > 0) {
    return 0;
  }
  const person = await findCreatorPerson(tx, userId);
  if (!person) return 0;
  return revokeCreatorGrants(
    tx,
    { kind: "member", workspaceId, personId: person.id },
    "workspace_membership_ended",
  );
}

/** The project was deleted: revoke every creator grant on it. */
export async function revokeProjectCreatorGrantsForProject(
  tx: Tx,
  workspaceId: string,
  projectId: string,
): Promise<number> {
  return revokeCreatorGrants(
    tx,
    { kind: "project", workspaceId, projectId },
    "project_deleted",
  );
}

/**
 * The person has just gained workspace `sees_all` (promoted to owner or admin): a project-scope
 * `project_creator` grant would REPLACE their workspace authority on that project under the
 * declarative evaluator, which is why creation skips the grant for `sees_all` holders. Revoke
 * every such grant they hold in the workspace, audited, inside the promoting transaction.
 */
export async function revokeProjectCreatorGrantsOnSeesAll(
  tx: Tx,
  workspaceId: string,
  personId: string,
): Promise<number> {
  return revokeCreatorGrants(
    tx,
    { kind: "member", workspaceId, personId },
    "workspace_sees_all_granted",
  );
}
