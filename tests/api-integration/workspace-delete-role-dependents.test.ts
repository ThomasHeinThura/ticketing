/**
 * Issue #180 -- deleting a workspace (route) or erasing an account (which deletes
 * sole-member workspaces) used to 500 once any membership, grant or group mapping
 * referenced a role owned by that workspace: `role.workspace_id` is ON DELETE CASCADE
 * but `membership.role_id`, `membership_grant.role_id`, `oidc_group_mapping.role_id`
 * and `scim_group_mapping.role_id` are ON DELETE RESTRICT. The fix deletes those
 * dependents explicitly (`deleteWorkspaceRoleDependents`); the RESTRICT FKs stay.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import createProject from "../../apps/api/src/project/controllers/create-project";
import { lockProjectCreation } from "../../apps/api/src/project/project-creation-lock";
import deleteAccountData, {
  ERASURE_LOCK_TIMEOUT_MS,
} from "../../apps/api/src/user/controllers/delete-account-data";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import {
  createWorkspaceNative,
  deleteWorkspaceNative,
} from "./helpers/workspace-write-http";

const ENCRYPTION_KEY = "ab".repeat(32);
const originalEncryptionKey = process.env.TASKDESK_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.TASKDESK_ENCRYPTION_KEY = ENCRYPTION_KEY;
});
afterAll(() => {
  if (originalEncryptionKey === undefined)
    delete process.env.TASKDESK_ENCRYPTION_KEY;
  else process.env.TASKDESK_ENCRYPTION_KEY = originalEncryptionKey;
});
beforeEach(async () => {
  await resetTestDatabase();
});

async function personIdFor(userId: string) {
  await ensureStaffPersonForUser(userId);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!person) throw new Error("person was not provisioned");
  return person.id;
}

async function createRole(
  workspaceId: string,
  scope: "workspace" | "project",
  key = `fixture-${randomUUID()}`,
) {
  return requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope,
        workspaceId,
        key,
        name: key,
        rank: 1,
        capabilities: ["project:read"],
      })
      .returning(),
    "role",
  );
}

async function releaseOwnerReach(workspaceId: string) {
  await db
    .delete(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.scope, "workspace"),
        eq(schema.membershipGrantTable.scopeId, workspaceId),
      ),
    );
  await db
    .delete(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.scope, "workspace"),
        eq(schema.membershipTable.scopeId, workspaceId),
      ),
    );
}

/**
 * `releaseOwnerReach`: workspace creation now gives the owner an explicit workspace
 * `sees_all` membership and a direct `system_backfill` grant (decision log 2026-10-14,
 * `workspace-admin-reach.ts`). Fixtures that must seed THEIR OWN workspace-scope
 * membership/direct grant for that same person would otherwise collide on the
 * one-membership-per-(person, scope, scope_id) and one-active-direct-grant unique keys
 * (23505). Those fixtures opt in to start from the person's pre-reach state; every other
 * test here keeps the owner's reach rows, so deletion is still exercised with them present.
 */
async function createWorkspaceViaRoute(
  name: string,
  options: { releaseOwnerReach?: boolean } = {},
) {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const created = await createWorkspaceNative(app, owner.cookie, { name });
  const { id } = (await created.json()) as { id: string };
  if (options.releaseOwnerReach) await releaseOwnerReach(id);
  return { app, owner, workspaceId: id };
}

/** Every role-dependent row that is allowed to exist for a workspace. */
async function countDependents(workspaceId: string, projectIds: string[]) {
  const roles = await db
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.workspaceId, workspaceId));
  const roleIds = roles.map((r) => r.id);
  const memberships = (await db.select().from(schema.membershipTable)).filter(
    (m) =>
      roleIds.includes(m.roleId) ||
      m.scopeId === workspaceId ||
      projectIds.includes(m.scopeId),
  );
  const grants = (await db.select().from(schema.membershipGrantTable)).filter(
    (g) => roleIds.includes(g.roleId),
  );
  const oidc = (await db.select().from(schema.oidcGroupMappingTable)).filter(
    (m) => roleIds.includes(m.roleId),
  );
  const scim = (await db.select().from(schema.scimGroupMappingTable)).filter(
    (m) => roleIds.includes(m.roleId),
  );
  return {
    roles: roles.length,
    memberships: memberships.length,
    grants: grants.length,
    oidc: oidc.length,
    scim: scim.length,
  };
}

/** SCIM + OIDC mappings, a grant for each, and a scim_group_member, all on `roleId`. */
async function seedProvisioningRows(
  workspaceId: string,
  roleId: string,
  userId: string,
) {
  const personId = await personIdFor(userId);
  const connectionId = `conn-${randomUUID()}`;
  await db.insert(schema.identityConnectionTable).values({
    id: connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    displayName: "Issue 180 fixture",
    issuer: "https://login.microsoftonline.com/tenant/v2.0",
    tenantId: "tenant",
    clientId: "client",
    clientSecret: encryptIdentityClientSecret(connectionId, "fixture"),
    redirectUri: "http://localhost:1337/api/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: { enabled: false, requiredEntraAppRole: "staff" },
    maxRoleRank: 10,
    enabled: true,
  });
  await db.insert(schema.scimConnectionTable).values({
    identityConnectionId: connectionId,
    tokenHash: Buffer.alloc(32, 1),
    tokenPrefix: "fixture0",
    tokenCreatedAt: new Date(),
    allowedResources: ["users", "groups"],
    enabled: true,
  });
  const externalIdentity = requireRow(
    await db
      .insert(schema.externalIdentityTable)
      .values({
        identityConnectionId: connectionId,
        personId,
        userId,
        issuer: "https://login.microsoftonline.com/tenant/v2.0",
        subject: userId,
        scimExternalId: userId,
        userNameSnapshot: userId,
        emailSnapshot: `${userId}@example.test`,
        active: true,
        provisionedVia: "scim",
      })
      .returning(),
    "external identity",
  );
  const oidcMapping = requireRow(
    await db
      .insert(schema.oidcGroupMappingTable)
      .values({
        identityConnectionId: connectionId,
        externalGroupId: randomUUID(),
        roleId,
        scope: "workspace",
        scopeId: workspaceId,
      })
      .returning(),
    "oidc mapping",
  );
  const scimMapping = requireRow(
    await db
      .insert(schema.scimGroupMappingTable)
      .values({
        scimConnectionId: connectionId,
        externalGroupId: randomUUID(),
        roleId,
        scope: "workspace",
        scopeId: workspaceId,
      })
      .returning(),
    "scim mapping",
  );
  const membership = requireRow(
    await db
      .insert(schema.membershipTable)
      .values({
        personId,
        scope: "workspace",
        scopeId: workspaceId,
        roleId,
      })
      .returning(),
    "membership",
  );
  const base = {
    membershipId: membership.id,
    personId,
    scope: "workspace",
    scopeId: workspaceId,
    roleId,
    externalIdentityId: externalIdentity.id,
    identityConnectionId: connectionId,
  };
  await db.insert(schema.membershipGrantTable).values({
    ...base,
    sourceKind: "oidc_group",
    oidcGroupMappingId: oidcMapping.id,
  });
  const [scimGrant] = await db
    .insert(schema.membershipGrantTable)
    .values({
      ...base,
      sourceKind: "scim_group",
      scimGroupMappingId: scimMapping.id,
    })
    .returning();
  await db.insert(schema.scimGroupMemberTable).values({
    scimGroupMappingId: scimMapping.id,
    externalIdentityId: externalIdentity.id,
    membershipId: membership.id,
    membershipGrantId: requireRow([scimGrant], "scim grant").id,
  });
  return { connectionId };
}

describe("#180 workspace delete with role-referencing rows", () => {
  it("deletes a workspace holding a project-scope role membership (the repro)", async () => {
    const { app, owner, workspaceId } =
      await createWorkspaceViaRoute("Project role");
    const { project } = await createProjectFixture({ workspaceId });
    const role = await grantProjectRole(owner.user.id, project.id, [
      "project:read",
    ]);

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, workspaceId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, role.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.roleId, role.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.scopeId, project.id)),
    ).toHaveLength(0);
  });

  it("deletes a workspace holding a workspace-scope custom role membership", async () => {
    const { app, owner, workspaceId } = await createWorkspaceViaRoute(
      "WS role",
      { releaseOwnerReach: true },
    );
    const personId = await personIdFor(owner.user.id);
    const role = await createRole(workspaceId, "workspace");
    const membership = requireRow(
      await db
        .insert(schema.membershipTable)
        .values({
          personId,
          scope: "workspace",
          scopeId: workspaceId,
          roleId: role.id,
        })
        .returning(),
      "membership",
    );
    await db.insert(schema.membershipGrantTable).values({
      membershipId: membership.id,
      personId,
      scope: "workspace",
      scopeId: workspaceId,
      roleId: role.id,
      sourceKind: "direct",
      directOrigin: "system_backfill",
    });

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);

    expect(await countDependents(workspaceId, [])).toEqual({
      roles: 0,
      memberships: 0,
      grants: 0,
      oidc: 0,
      scim: 0,
    });
    expect(await db.select().from(schema.membershipGrantTable)).toHaveLength(0);
  });

  it("deletes a workspace with SCIM/OIDC mappings, grants and scim_group_member rows, keeping the connection", async () => {
    const { app, owner, workspaceId } = await createWorkspaceViaRoute("SCIM", {
      releaseOwnerReach: true,
    });
    const role = await createRole(workspaceId, "workspace");
    const { connectionId } = await seedProvisioningRows(
      workspaceId,
      role.id,
      owner.user.id,
    );

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);

    expect(await db.select().from(schema.oidcGroupMappingTable)).toHaveLength(
      0,
    );
    expect(await db.select().from(schema.scimGroupMappingTable)).toHaveLength(
      0,
    );
    expect(await db.select().from(schema.membershipGrantTable)).toHaveLength(0);
    expect(await db.select().from(schema.scimGroupMemberTable)).toHaveLength(0);
    expect(await db.select().from(schema.membershipTable)).toHaveLength(0);
    // The identity connection and the external identity belong to the instance, not the
    // workspace: they survive.
    expect(
      await db
        .select()
        .from(schema.identityConnectionTable)
        .where(eq(schema.identityConnectionTable.id, connectionId)),
    ).toHaveLength(1);
    expect(await db.select().from(schema.externalIdentityTable)).toHaveLength(
      1,
    );
  });

  it("leaves another workspace's rows alone, including the same person's memberships there", async () => {
    const { app, owner, workspaceId } = await createWorkspaceViaRoute(
      "Doomed",
      { releaseOwnerReach: true },
    );
    const keepWorkspace = (
      await createWorkspaceNative(app, owner.cookie, { name: "Keeper" }).then(
        (r) => r.json(),
      )
    ).id as string;
    await releaseOwnerReach(keepWorkspace);
    const { project: doomedProject } = await createProjectFixture({
      workspaceId,
    });
    const { project: keptProject } = await createProjectFixture({
      workspaceId: keepWorkspace,
    });
    const doomedRole = await grantProjectRole(owner.user.id, doomedProject.id, [
      "project:read",
    ]);
    const keptRole = await grantProjectRole(owner.user.id, keptProject.id, [
      "project:read",
    ]);
    const keptWsRole = await createRole(keepWorkspace, "workspace");
    const { connectionId } = await seedProvisioningRows(
      keepWorkspace,
      keptWsRole.id,
      owner.user.id,
    );

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);

    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, doomedRole.id)),
    ).toHaveLength(0);
    // Kept workspace: role, project membership, workspace-scope membership, mappings,
    // grants and group members all survive.
    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(inArray(schema.roleTable.id, [keptRole.id, keptWsRole.id])),
    ).toHaveLength(2);
    const memberships = await db.select().from(schema.membershipTable);
    expect(memberships.map((m) => m.roleId).sort()).toEqual(
      [keptRole.id, keptWsRole.id].sort(),
    );
    expect(await db.select().from(schema.oidcGroupMappingTable)).toHaveLength(
      1,
    );
    expect(await db.select().from(schema.scimGroupMappingTable)).toHaveLength(
      1,
    );
    expect(await db.select().from(schema.membershipGrantTable)).toHaveLength(2);
    expect(await db.select().from(schema.scimGroupMemberTable)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.identityConnectionTable)
        .where(eq(schema.identityConnectionTable.id, connectionId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, keepWorkspace)),
    ).toHaveLength(1);
  });

  it("account erasure deletes a sole-member workspace holding role-referencing rows", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const projectRole = await grantProjectRole(owner.user.id, project.id, [
      "project:read",
    ]);
    const wsRole = await createRole(owner.workspace.id, "workspace");
    await seedProvisioningRows(owner.workspace.id, wsRole.id, owner.user.id);
    // Another workspace of the same person that is NOT deleted (shared, other owner).
    const other = await createWorkspaceMember({ role: "owner" });
    const otherProject = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    const otherRole = await grantProjectRole(
      other.user.id,
      otherProject.project.id,
      ["project:read"],
    );

    await deleteAccountData(owner.user.id);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(inArray(schema.roleTable.id, [projectRole.id, wsRole.id])),
    ).toHaveLength(0);
    expect(await db.select().from(schema.oidcGroupMappingTable)).toHaveLength(
      0,
    );
    expect(await db.select().from(schema.scimGroupMappingTable)).toHaveLength(
      0,
    );
    expect(await db.select().from(schema.scimGroupMemberTable)).toHaveLength(0);
    expect(await db.select().from(schema.membershipGrantTable)).toHaveLength(0);
    // The other person's workspace and membership are untouched.
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.roleId, otherRole.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, other.workspace.id)),
    ).toHaveLength(1);
  });

  it("still refuses to delete a single role that a membership references (RESTRICT stays in force)", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const role = await grantProjectRole(owner.user.id, project.id, [
      "project:read",
    ]);

    await expect(
      db.delete(schema.roleTable).where(eq(schema.roleTable.id, role.id)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, role.id)),
    ).toHaveLength(1);
  });
});

describe("#180 round 2 -- predicates that only the scope/mapping paths reach", () => {
  async function globalRole() {
    return requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: null,
          key: `global-${randomUUID()}`,
          name: "Global built-in",
          rank: 1,
          capabilities: ["project:read"],
        })
        .returning(),
      "global role",
    );
  }

  it("removes a membership holding a GLOBAL role scoped to the doomed workspace, and keeps the role", async () => {
    const { app, owner, workspaceId } = await createWorkspaceViaRoute(
      "Global",
      { releaseOwnerReach: true },
    );
    const personId = await personIdFor(owner.user.id);
    const role = await globalRole();
    await db.insert(schema.membershipTable).values({
      personId,
      scope: "workspace",
      scopeId: workspaceId,
      roleId: role.id,
    });

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.roleId, role.id)),
    ).toHaveLength(0);
    // The global role is not workspace-owned: it survives.
    expect(
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, role.id)),
    ).toHaveLength(1);
  });

  it("removes a membership holding a GLOBAL role scoped to a project of the doomed workspace, but not one in another workspace", async () => {
    const { app, owner, workspaceId } =
      await createWorkspaceViaRoute("GlobalP");
    const other = await createWorkspaceMember({ role: "owner" });
    const personId = await personIdFor(owner.user.id);
    const role = await globalRole();
    const { project } = await createProjectFixture({ workspaceId });
    const { project: otherProject } = await createProjectFixture({
      workspaceId: other.workspace.id,
    });
    await db.insert(schema.membershipTable).values([
      { personId, scope: "project", scopeId: project.id, roleId: role.id },
      {
        personId,
        scope: "project",
        scopeId: otherProject.id,
        roleId: role.id,
      },
    ]);

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
    const remaining = await db
      .select()
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.roleId, role.id));
    expect(remaining.map((m) => m.scopeId)).toEqual([otherProject.id]);
  });

  it("removes a scim_group_member reached only through its group-mapping id", async () => {
    const { app, owner, workspaceId } = await createWorkspaceViaRoute(
      "MapOnly",
      { releaseOwnerReach: true },
    );
    const other = await createWorkspaceMember({ role: "owner" });
    const doomedRole = await createRole(workspaceId, "workspace");
    const keptRole = await createRole(other.workspace.id, "workspace");
    const doomed = await seedProvisioningRows(
      workspaceId,
      doomedRole.id,
      owner.user.id,
    );
    // A second, surviving mapping + grant (other workspace). Re-point the doomed
    // mapping's scim_group_member at the SURVIVING grant, so the member is not reachable
    // through a doomed grant -- only through its (doomed) mapping id.
    const survivor = await seedProvisioningRows(
      other.workspace.id,
      keptRole.id,
      other.user.id,
    );
    const [survivingMember] = await db
      .select()
      .from(schema.scimGroupMemberTable)
      .where(
        eq(
          schema.scimGroupMemberTable.scimGroupMappingId,
          (
            await db
              .select()
              .from(schema.scimGroupMappingTable)
              .where(eq(schema.scimGroupMappingTable.roleId, keptRole.id))
          )[0]?.id ?? "",
        ),
      );
    const [doomedMember] = await db
      .select()
      .from(schema.scimGroupMemberTable)
      .where(
        eq(
          schema.scimGroupMemberTable.scimGroupMappingId,
          (
            await db
              .select()
              .from(schema.scimGroupMappingTable)
              .where(eq(schema.scimGroupMappingTable.roleId, doomedRole.id))
          )[0]?.id ?? "",
        ),
      );
    if (!survivingMember || !doomedMember) throw new Error("fixture");
    // Detach the doomed member from its own (doomed) grant by swapping grant ids with
    // the surviving member's grant: doomed member -> surviving grant.
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.scimGroupMemberTable)
        .where(eq(schema.scimGroupMemberTable.id, doomedMember.id));
      await tx
        .delete(schema.scimGroupMemberTable)
        .where(eq(schema.scimGroupMemberTable.id, survivingMember.id));
      await tx.insert(schema.scimGroupMemberTable).values({
        scimGroupMappingId: doomedMember.scimGroupMappingId,
        externalIdentityId: doomedMember.externalIdentityId,
        membershipId: null,
        membershipGrantId: survivingMember.membershipGrantId,
      });
    });
    expect(doomed.connectionId).not.toBe(survivor.connectionId);

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect(await db.select().from(schema.scimGroupMemberTable)).toHaveLength(0);
    // The surviving workspace's grant is untouched.
    expect(
      await db
        .select()
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.roleId, keptRole.id)),
    ).toHaveLength(2);
  });

  it("deletes a membership in workspace B that holds a role owned by workspace A when A is deleted (invalid by model)", async () => {
    const { app, owner, workspaceId } = await createWorkspaceViaRoute("A");
    const other = await createWorkspaceMember({ role: "owner" });
    const roleA = await createRole(workspaceId, "workspace");
    const personB = await personIdFor(other.user.id);
    await db.insert(schema.membershipTable).values({
      personId: personB,
      scope: "workspace",
      scopeId: other.workspace.id,
      roleId: roleA.id,
    });

    const response = await deleteWorkspaceNative(
      app,
      owner.cookie,
      workspaceId,
    );
    expect(response.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.personId, personB)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, other.workspace.id)),
    ).toHaveLength(1);
  });
});

/**
 * #734 (owner decision 2026-10-15): account erasure counts identity-provisioned (SCIM/OIDC)
 * access in its sole-member check. A workspace that anyone else can still reach is never
 * erased around them: the request stops with a 409, before anything is deleted.
 */
describe("#734 account erasure and IdP-provisioned members", () => {
  async function snapshot() {
    return {
      workspaces: (await db.select().from(schema.workspaceTable)).length,
      roles: (await db.select().from(schema.roleTable)).length,
      memberships: (await db.select().from(schema.membershipTable)).length,
      grants: (await db.select().from(schema.membershipGrantTable)).length,
      oidc: (await db.select().from(schema.oidcGroupMappingTable)).length,
      scim: (await db.select().from(schema.scimGroupMappingTable)).length,
      scimMembers: (await db.select().from(schema.scimGroupMemberTable)).length,
      users: (await db.select().from(schema.userTable)).length,
      legacyMembers: (await db.select().from(schema.workspaceUserTable)).length,
    };
  }

  async function soleLegacyMemberWorkspace() {
    const owner = await createWorkspaceMember({ role: "owner" });
    const wsRole = await createRole(owner.workspace.id, "workspace");
    return { owner, wsRole };
  }

  it("stops with a 409 and deletes nothing when another person holds SCIM/OIDC access", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    await seedProvisioningRows(owner.workspace.id, wsRole.id, other.user.id);
    const before = await snapshot();

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /Other people still have access to ".*"\. Transfer it or remove it/u,
    );

    expect(await snapshot()).toEqual(before);
  });

  it("stops when the other person's access is a project-scope membership of the workspace", async () => {
    const { owner } = await soleLegacyMemberWorkspace();
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);
    // A GLOBAL role: only the project scope, not role ownership, ties this row to the workspace.
    const projectRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: null,
          key: `global-${randomUUID()}`,
          name: "Global built-in",
          rank: 1,
          capabilities: ["project:read"],
        })
        .returning(),
      "global role",
    );
    await db.insert(schema.membershipTable).values({
      personId: otherPerson,
      scope: "project",
      scopeId: project.id,
      roleId: projectRole.id,
    });
    const before = await snapshot();

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /Other people still have access to/u,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("stops when the only other row is a grant", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);
    await db.insert(schema.membershipGrantTable).values({
      personId: otherPerson,
      scope: "workspace",
      scopeId: owner.workspace.id,
      roleId: wsRole.id,
      sourceKind: "direct",
      directOrigin: "system_backfill",
    });
    const before = await snapshot();

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /Other people still have access to/u,
    );
    expect(await snapshot()).toEqual(before);
  });

  /**
   * Another person's provisioned access whose OWN scope and role are in a different
   * workspace, linked to the doomed workspace only through the group mapping it derives from.
   * `seedProvisioningRows` creates both an OIDC and a SCIM grant on the workspace; this moves
   * every row of that person to `elsewhere` and drops the grant of the other kind, so the
   * one remaining link is the mapping arm under test.
   */
  async function mappingOnlyAccess(kind: "oidc" | "scim") {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const elsewhereRole = await createRole(other.workspace.id, "workspace");
    await seedProvisioningRows(owner.workspace.id, wsRole.id, other.user.id);
    const otherPerson = await personIdFor(other.user.id);
    const drop = kind === "oidc" ? "scim_group" : "oidc_group";
    const dropped = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.sourceKind, drop));
    const droppedIds = dropped.map((row) => row.id);
    await db
      .delete(schema.scimGroupMemberTable)
      .where(
        inArray(schema.scimGroupMemberTable.membershipGrantId, droppedIds),
      );
    await db
      .delete(schema.membershipGrantTable)
      .where(inArray(schema.membershipGrantTable.id, droppedIds));
    if (kind === "oidc") {
      // The SCIM member row pointed at the dropped SCIM grant and is gone with it.
    }
    await db
      .update(schema.membershipTable)
      .set({
        scope: "workspace",
        scopeId: other.workspace.id,
        roleId: elsewhereRole.id,
      })
      .where(eq(schema.membershipTable.personId, otherPerson));
    await db
      .update(schema.membershipGrantTable)
      .set({
        scope: "workspace",
        scopeId: other.workspace.id,
        roleId: elsewhereRole.id,
      })
      .where(eq(schema.membershipGrantTable.personId, otherPerson));
    return { owner, other };
  }

  it.each(["oidc", "scim"] as const)(
    "stops when another person's grant reaches the workspace only through its %s group mapping",
    async (kind) => {
      const { owner } = await mappingOnlyAccess(kind);
      const before = await snapshot();

      await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
        /Other people still have access to/u,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  async function customerOrganisationInWorkspace(
    options: { active?: boolean } = {},
  ) {
    const { owner } = await soleLegacyMemberWorkspace();
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `cust-${randomUUID()}`, name: "Customer Org" })
        .returning(),
      "customer organisation",
    );
    await db
      .update(schema.projectTable)
      .set({ organisationId: organisation.id })
      .where(eq(schema.projectTable.id, project.id));
    const customerUser = await createWorkspaceMember({ role: "member" });
    await personIdFor(customerUser.user.id);
    await db
      .update(schema.personTable)
      .set({
        side: "customer",
        organisationId: organisation.id,
        active: options.active ?? true,
      })
      .where(eq(schema.personTable.userId, customerUser.user.id));
    return { owner, project, organisation, customerUser };
  }

  it("stops when a signed-in customer of an organisation served by the workspace would lose their projects", async () => {
    const { owner } = await customerOrganisationInWorkspace();
    const before = await snapshot();

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /Other people still have access to/u,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("serializes customer project creation before erasure, including a creator with no staff person", async () => {
    const { owner } = await soleLegacyMemberWorkspace();
    const organisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({ key: `cust-${randomUUID()}`, name: "Customer Org" })
        .returning(),
      "customer organisation",
    );
    const customerUser = await createWorkspaceMember({ role: "member" });
    const customerPersonId = await personIdFor(customerUser.user.id);
    await db
      .update(schema.personTable)
      .set({ side: "customer", organisationId: organisation.id })
      .where(eq(schema.personTable.id, customerPersonId));

    const creatorWithoutPerson = `unprovisioned-${randomUUID()}`;
    expect(
      await db
        .select({ id: schema.personTable.id })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, creatorWithoutPerson)),
    ).toHaveLength(0);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired: () => void = () => {};
    const acquiredSignal = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const blocker = db.transaction(async (tx) => {
      await lockProjectCreation(tx, owner.workspace.id);
      acquired();
      await gate;
    });
    await acquiredSignal;

    const waitForAdvisoryWaiters = async (expected: number) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const result = await db.execute(sql`
          SELECT count(*)::int AS count
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND NOT granted
            AND classid = 1524::oid
            AND objid = hashtext(${owner.workspace.id})::oid
            AND objsubid = 2
        `);
        const count = Number(result.rows[0]?.count ?? 0);
        if (count >= expected) return;
      }
      throw new Error(
        `Timed out waiting for ${expected} advisory-lock waiter(s)`,
      );
    };

    // Exercise the real createProjectRow path and its optional creator-person lookup. The
    // blocker makes PostgreSQL expose its queued advisory request before erasure is started.
    const projectCreation = createProject(
      owner.workspace.id,
      "Raced customer project",
      "Folder",
      `raced-${randomUUID()}`,
      {
        kind: "project",
        supportLevel: null,
        serviceCalendarId: null,
        organisationId: organisation.id,
      },
      creatorWithoutPerson,
    ).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
    let erasure:
      | Promise<
          | { status: "fulfilled"; value: unknown }
          | { status: "rejected"; reason: unknown }
        >
      | undefined;
    try {
      await waitForAdvisoryWaiters(1);
      erasure = deleteAccountData(owner.user.id).then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason: unknown) => ({ status: "rejected" as const, reason }),
      );
      await waitForAdvisoryWaiters(2);
    } finally {
      release();
      await blocker;
    }
    const projectResult = await projectCreation;
    expect(projectResult.status).toBe("fulfilled");
    const erasureResult = await erasure;
    expect(erasureResult?.status).toBe("rejected");
    expect(
      String(erasureResult?.status === "rejected" ? erasureResult.reason : ""),
    ).toMatch(/Other people still have access to/u);
    expect(
      await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.projectTable.id })
        .from(schema.projectTable)
        .where(eq(schema.projectTable.workspaceId, owner.workspace.id)),
    ).toHaveLength(1);
  }, 30_000);

  it("is not blocked by an inactive customer, or by a customer of an organisation the workspace does not serve", async () => {
    const inactive = await customerOrganisationInWorkspace({ active: false });
    await deleteAccountData(inactive.owner.user.id);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, inactive.owner.workspace.id)),
    ).toHaveLength(0);

    const { owner } = await soleLegacyMemberWorkspace();
    const unrelated = await customerOrganisationInWorkspace();
    // The unrelated organisation is bound to a project of ANOTHER workspace only.
    await deleteAccountData(owner.user.id);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, unrelated.owner.workspace.id)),
    ).toHaveLength(1);
  });

  it("a grant written concurrently, while erasure waits for its lock, is seen by the check (no silent loss)", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written: () => void = () => {};
    const writtenSignal = new Promise<void>((resolve) => {
      written = resolve;
    });
    // Connection 1: an uncommitted write of another person's grant on the workspace.
    const writer = db.transaction(async (tx) => {
      await tx.insert(schema.membershipGrantTable).values({
        personId: otherPerson,
        scope: "workspace",
        scopeId: owner.workspace.id,
        roleId: wsRole.id,
        sourceKind: "direct",
        directOrigin: "system_backfill",
      });
      written();
      await gate;
    });
    await writtenSignal;
    // Connection 2: erasure runs its check; it must wait for the writer, then see the row.
    const erasure = deleteAccountData(owner.user.id);
    const settled = await Promise.race([
      erasure.then(
        () => "finished",
        () => "finished",
      ),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 800)),
    ]);
    expect(settled).toBe("waiting");
    release();
    await writer;
    await expect(erasure).rejects.toThrow(/Other people still have access to/u);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(1);
    expect(await db.select().from(schema.membershipGrantTable)).toHaveLength(1);
  });

  it("does not deadlock a writer that locks person first and then writes membership (lock order person, membership_grant, membership)", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => {};
    const startedSignal = new Promise<void>((resolve) => {
      started = resolve;
    });
    // The provisioning writers' order: person row first, then membership.
    const writer = db.transaction(async (tx) => {
      await tx
        .update(schema.personTable)
        .set({ updatedAt: new Date() })
        .where(eq(schema.personTable.id, otherPerson));
      started();
      await gate;
      await tx.insert(schema.membershipTable).values({
        personId: otherPerson,
        scope: "workspace",
        scopeId: owner.workspace.id,
        roleId: wsRole.id,
      });
    });
    await startedSignal;
    const erasure = deleteAccountData(owner.user.id);
    const erasureOutcome = erasure.then(
      () => "erased",
      (error: unknown) => error,
    );
    // Erasure is queued on `person` and holds nothing the writer needs next.
    await new Promise((resolve) => setTimeout(resolve, 500));
    release();
    await writer; // would block or deadlock if erasure already held `membership`
    const outcome = await erasureOutcome;
    expect(String((outcome as Error).message)).toMatch(
      /Other people still have access to/u,
    );
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(1);
  });

  it("a refused erasure never takes the table lock: it answers the access 409 at once even while a writer holds a conflicting lock", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);
    // Committed: another person already has access, so the first-pass check refuses.
    await db.insert(schema.membershipTable).values({
      personId: otherPerson,
      scope: "workspace",
      scopeId: owner.workspace.id,
      roleId: wsRole.id,
    });
    const before = await snapshot();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written: () => void = () => {};
    const writtenSignal = new Promise<void>((resolve) => {
      written = resolve;
    });
    // An unrelated writer holds ROW EXCLUSIVE on membership_grant (conflicts with the
    // erasure's SHARE ROW EXCLUSIVE table lock) and does not commit.
    const writer = db.transaction(async (tx) => {
      await tx.insert(schema.membershipGrantTable).values({
        personId: otherPerson,
        scope: "workspace",
        scopeId: `unrelated-${randomUUID()}`,
        roleId: wsRole.id,
        sourceKind: "direct",
        directOrigin: "system_backfill",
      });
      written();
      await gate;
    });
    await writtenSignal;

    const started = Date.now();
    const caught = await deleteAccountData(owner.user.id).then(
      () => null,
      (error: unknown) => error,
    );
    const elapsed = Date.now() - started;
    release();
    await writer;

    // The message below is the real discriminator (a call that tried the lock would have
    // waited out the timeout and answered "busy"); the time bound is a loose backstop,
    // well under the lock timeout so a slow runner does not flake it.
    expect(elapsed).toBeLessThan(ERASURE_LOCK_TIMEOUT_MS - 500);
    expect(String((caught as Error).message)).toMatch(
      /Other people still have access to/u,
    );
    expect(String((caught as Error).message)).not.toMatch(/busy/u);
    expect(await snapshot()).toEqual({ ...before, grants: before.grants + 1 });
  }, 30_000);

  it("a lock timeout answers 409 with nothing deleted, and leaves the writer untouched", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);
    const before = await snapshot();

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let written: () => void = () => {};
    const writtenSignal = new Promise<void>((resolve) => {
      written = resolve;
    });
    const writer = db.transaction(async (tx) => {
      await tx.insert(schema.membershipGrantTable).values({
        personId: otherPerson,
        scope: "workspace",
        scopeId: owner.workspace.id,
        roleId: wsRole.id,
        sourceKind: "direct",
        directOrigin: "system_backfill",
      });
      written();
      await gate;
    });
    await writtenSignal;
    // The writer never commits inside the lock timeout, so erasure gives up.
    const erasure = deleteAccountData(owner.user.id);
    const caught = await erasure.then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toMatchObject({ status: "CONFLICT" });
    expect(String((caught as Error).message)).toMatch(
      /busy updating access\. Nothing was deleted/u,
    );
    release();
    await writer;
    // Only the writer's own grant exists beyond the starting state; nothing was deleted.
    expect(await snapshot()).toEqual({
      ...before,
      grants: before.grants + 1,
    });
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(1);
  }, 30_000);

  it("still counts access held by a deactivated person (a dormant account is not an excuse to erase around it)", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);
    await db.insert(schema.membershipTable).values({
      personId: otherPerson,
      scope: "workspace",
      scopeId: owner.workspace.id,
      roleId: wsRole.id,
    });
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, otherPerson));
    const before = await snapshot();

    await expect(deleteAccountData(owner.user.id)).rejects.toThrow(
      /Other people still have access to/u,
    );
    expect(await snapshot()).toEqual(before);
  });

  it("is not blocked by another person's revoked grant", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.membershipGrantTable).values({
      personId: await personIdFor(other.user.id),
      scope: "workspace",
      scopeId: owner.workspace.id,
      roleId: wsRole.id,
      sourceKind: "direct",
      directOrigin: "system_backfill",
      revokedAt: new Date(),
      revocationReason: "direct_removed",
    });

    await deleteAccountData(owner.user.id);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(0);
  });

  it("proceeds as before for a truly sole member, whose own provisioned rows go with the workspace", async () => {
    const { owner, wsRole } = await soleLegacyMemberWorkspace();
    await seedProvisioningRows(owner.workspace.id, wsRole.id, owner.user.id);

    await deleteAccountData(owner.user.id);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(0);
    expect(await db.select().from(schema.membershipGrantTable)).toHaveLength(0);
  });

  it("is not blocked by another person's access to a different workspace", async () => {
    const { owner } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherRole = await createRole(other.workspace.id, "workspace");
    await seedProvisioningRows(other.workspace.id, otherRole.id, other.user.id);

    await deleteAccountData(owner.user.id);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, other.workspace.id)),
    ).toHaveLength(1);
  });

  it("does not count, or delete, another person's organisation-scoped row that merely shares the workspace id", async () => {
    const { owner, wsRole: _unused } = await soleLegacyMemberWorkspace();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherPerson = await personIdFor(other.user.id);
    const otherRole = await createRole(other.workspace.id, "workspace");
    const lookalike = requireRow(
      await db
        .insert(schema.membershipTable)
        .values({
          personId: otherPerson,
          scope: "organisation",
          scopeId: owner.workspace.id,
          roleId: otherRole.id,
        })
        .returning(),
      "organisation-scoped membership",
    );

    await deleteAccountData(owner.user.id);

    expect(
      await db
        .select()
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, owner.workspace.id)),
    ).toHaveLength(0);
    // The scope = 'workspace' predicate: this row is not access to the workspace.
    expect(
      await db
        .select()
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.id, lookalike.id)),
    ).toHaveLength(1);
  });
});
