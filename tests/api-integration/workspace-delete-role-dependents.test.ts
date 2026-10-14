/**
 * Issue #180 -- deleting a workspace (route) or erasing an account (which deletes
 * sole-member workspaces) used to 500 once any membership, grant or group mapping
 * referenced a role owned by that workspace: `role.workspace_id` is ON DELETE CASCADE
 * but `membership.role_id`, `membership_grant.role_id`, `oidc_group_mapping.role_id`
 * and `scim_group_mapping.role_id` are ON DELETE RESTRICT. The fix deletes those
 * dependents explicitly (`deleteWorkspaceRoleDependents`); the RESTRICT FKs stay.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
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

async function createWorkspaceViaRoute(name: string) {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const created = await createWorkspaceNative(app, owner.cookie, { name });
  const { id } = (await created.json()) as { id: string };
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
    const { app, owner, workspaceId } =
      await createWorkspaceViaRoute("WS role");
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
    const { app, owner, workspaceId } = await createWorkspaceViaRoute("SCIM");
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
    const { app, owner, workspaceId } = await createWorkspaceViaRoute("Doomed");
    const keepWorkspace = (
      await createWorkspaceNative(app, owner.cookie, { name: "Keeper" }).then(
        (r) => r.json(),
      )
    ).id as string;
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
