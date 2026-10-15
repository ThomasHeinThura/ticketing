/**
 * Issue #180 -- deleting a workspace (route) or erasing an account (which deletes
 * sole-member workspaces) used to 500 once any membership, grant or group mapping
 * referenced a role owned by that workspace: `role.workspace_id` is ON DELETE CASCADE
 * but `membership.role_id`, `membership_grant.role_id`, `oidc_group_mapping.role_id`
 * and `scim_group_mapping.role_id` are ON DELETE RESTRICT. The fix deletes those
 * dependents explicitly (`deleteWorkspaceRoleDependents`); the RESTRICT FKs stay.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { createApp } from "../../apps/api/src/index";
import deleteAccountData from "../../apps/api/src/user/controllers/delete-account-data";
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
      /Other people still have access to ".*" through your identity provider/u,
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
      /Other people still have access/u,
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
      /Other people still have access/u,
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
