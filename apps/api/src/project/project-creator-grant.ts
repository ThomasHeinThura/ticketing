import { createId } from "@paralleldrive/cuid2";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import type db from "../database";
import { schema } from "../database";
import { projectMembershipKeys } from "../identity/membership-projection";
import { workspaceMemberRoles } from "../utils/workspace-member-roles";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
export const PROJECT_LEAD_ROLE_KEY = "project-lead";
export const PROJECT_CREATOR_ORIGIN = "project_creator";

/** The role id to grant, or `null` when the workspace holds an untrusted same-keyed row. */
export async function ensureProjectLeadRole(
  tx: Tx,
  workspaceId: string,
): Promise<string | null> {
  const select = () =>
    tx
      .select({
        id: schema.roleTable.id,
        isSystem: schema.roleTable.isSystem,
      })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.scope, "project"),
          eq(schema.roleTable.workspaceId, workspaceId),
          eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
        ),
      )
      .limit(1);
  let [row] = await select();
  if (!row) {
    const lead = BUILT_IN_ROLES.lead;
    await tx
      .insert(schema.roleTable)
      .values({
        id: createId(),
        scope: "project",
        workspaceId,
        key: PROJECT_LEAD_ROLE_KEY,
        name: "Project lead",
        description:
          "Project-scope lead granted to the creator of a project (rbac.md built-in lead capabilities).",
        rank: lead.rank,
        capabilities: [...lead.capabilities],
        isSystem: true,
        isEditable: true,
      })
      .onConflictDoNothing();
    [row] = await select();
  }
  return row?.isSystem === true ? row.id : null;
}

/** The creator's staff person (locked `FOR UPDATE`), or `null` when none is provisioned. */
export async function lockCreatorPerson(tx: Tx, userId: string) {
  const [person] = await tx
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .for("update")
    .limit(1);
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

  const [seesAll] = await tx
    .select({ id: schema.membershipTable.id })
    .from(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, person.id),
        eq(schema.membershipTable.scope, "workspace"),
        eq(schema.membershipTable.scopeId, workspaceId),
        eq(schema.membershipTable.seesAll, true),
      ),
    )
    .limit(1);
  if (seesAll) return "skipped_sees_all";

  const roleId = await ensureProjectLeadRole(tx, workspaceId);
  if (roleId === null) {
    // Fail closed, but never silently: the creator gets no project reach from this grant.
    console.warn(
      `⚠️ project-lead grant skipped for workspace ${workspaceId}, project ${projectId}: an untrusted (non-system) project-scope role keyed "${PROJECT_LEAD_ROLE_KEY}" exists.`,
    );
    return "skipped_no_role";
  }

  const [existing] = await tx
    .select({ id: schema.membershipGrantTable.id })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, person.id),
        eq(schema.membershipGrantTable.scope, "project"),
        eq(schema.membershipGrantTable.scopeId, projectId),
        eq(schema.membershipGrantTable.sourceKind, "direct"),
        isNull(schema.membershipGrantTable.revokedAt),
      ),
    )
    .limit(1);
  if (existing) return "existing";

  await tx.insert(schema.membershipGrantTable).values({
    id: createId(),
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId,
    sourceKind: "direct",
    directOrigin: PROJECT_CREATOR_ORIGIN,
    seesAll: false,
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
  filter:
    | { kind: "member"; workspaceId: string; personId: string }
    | { kind: "project"; workspaceId: string; projectId: string },
  reason: string,
): Promise<number> {
  const projectIdsOfWorkspace = tx
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.workspaceId, filter.workspaceId));
  const scopePredicate =
    filter.kind === "project"
      ? eq(schema.membershipGrantTable.scopeId, filter.projectId)
      : inArray(schema.membershipGrantTable.scopeId, projectIdsOfWorkspace);
  const personPredicate =
    filter.kind === "member"
      ? eq(schema.membershipGrantTable.personId, filter.personId)
      : undefined;
  const where = and(
    eq(schema.membershipGrantTable.scope, "project"),
    scopePredicate,
    eq(schema.membershipGrantTable.sourceKind, "direct"),
    eq(schema.membershipGrantTable.directOrigin, PROJECT_CREATOR_ORIGIN),
    isNull(schema.membershipGrantTable.revokedAt),
    personPredicate,
  );

  // Person rows first, in one deterministic order (the repo-wide lock order), then the grants.
  const candidates = await tx
    .select({ personId: schema.membershipGrantTable.personId })
    .from(schema.membershipGrantTable)
    .where(where);
  if (candidates.length === 0) return 0;
  const personIds = [...new Set(candidates.map((row) => row.personId))];
  const people = await tx
    .select({
      id: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
    })
    .from(schema.personTable)
    .where(inArray(schema.personTable.id, personIds))
    .orderBy(schema.personTable.id)
    .for("update");
  const organisationOf = new Map(
    people.map((person) => [person.id, person.organisationId]),
  );

  const grants = await tx
    .select({
      id: schema.membershipGrantTable.id,
      personId: schema.membershipGrantTable.personId,
      scopeId: schema.membershipGrantTable.scopeId,
    })
    .from(schema.membershipGrantTable)
    .where(where)
    .orderBy(schema.membershipGrantTable.id)
    .for("update");
  if (grants.length === 0) return 0;

  const now = new Date();
  await tx
    .update(schema.membershipGrantTable)
    .set({
      revokedAt: now,
      revocationReason: "direct_removed",
      membershipId: null,
      updatedAt: now,
    })
    .where(
      inArray(
        schema.membershipGrantTable.id,
        grants.map((grant) => grant.id),
      ),
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
  const [person] = await tx
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
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
