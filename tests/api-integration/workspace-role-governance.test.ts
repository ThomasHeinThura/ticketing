/**
 * P4 roles (RL-1..RL-15) on the canonical `role` store (owner decision, 23 Oct): create, clone,
 * edit, preview, holders, bulk reassignment, history, and the rank, authority and last-manager
 * guards, driven through the real routes. `workspace-role-writes.test.ts` keeps the inherited
 * S7 behaviours (reserved names, locks, the 25-role ceiling, deletion by pending action).
 */
import { randomUUID } from "node:crypto";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { projectMembershipKeys } from "../../apps/api/src/identity/membership-projection";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import {
  inviteAndAcceptAsNewMemberNative,
  inviteWorkspaceMemberNative,
} from "./helpers/workspace-invitation-write-http";
import { updateWorkspaceMemberRoleNative } from "./helpers/workspace-membership-write-http";
import {
  createWorkspaceRoleNative,
  deleteWorkspaceRoleNative,
  getWorkspaceRoleHistoryNative,
  getWorkspaceRoleNative,
  listWorkspaceRoleHoldersNative,
  listWorkspaceRolesNative,
  previewWorkspaceRoleNative,
  reassignWorkspaceRoleNative,
  updateWorkspaceRoleNative,
} from "./helpers/workspace-role-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];

type RoleBody = {
  id: string;
  role: string;
  name: string;
  description: string | null;
  rank: number;
  capabilities: string[];
  permission: Record<string, string[]>;
  isSystem: boolean;
  isEditable: boolean;
  holderCount: number;
  version: string;
};

async function openDatabaseClient(): Promise<Client> {
  const client = new Client({
    connectionString: process.env.TASKDESK_DATABASE_URL,
  });
  await client.connect();
  return client;
}

async function waitForBackendBlockedBy(
  observer: Client,
  blockerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const blocked = await observer.query<{ waiting: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM pg_stat_activity
         WHERE pid <> $1 AND wait_event_type = 'Lock'
           AND $1 = ANY(pg_blocking_pids(pid))
       ) AS waiting`,
      [blockerPid],
    );
    if (blocked.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("role patch did not reach the organization-row barrier");
}

async function setup() {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const created = await createWorkspaceNative(app, owner.cookie, {
    name: "Roles",
  });
  expect(created.status).toBe(200);
  const workspaceId = ((await created.json()) as { id: string }).id;
  return { app, owner, workspaceId };
}

async function addRoleIdentityGrant(input: {
  workspaceId: string;
  roleId: string;
  personId: string;
  userId: string;
  connectionId: string;
  source: "jit_default" | "oidc_group" | "scim_group";
  maxRoleRank: number;
}) {
  const mappingId = `${input.connectionId}-mapping`;
  const identityId = `${input.connectionId}-identity`;
  await db.insert(schema.identityConnectionTable).values({
    id: input.connectionId,
    providerType: "entra",
    portalScope: "agent",
    organisationId: null,
    defaultWorkspaceId: input.workspaceId,
    displayName: input.connectionId,
    issuer: `https://${input.connectionId}.example.test/issuer`,
    tenantId: input.connectionId,
    clientId: `${input.connectionId}-client`,
    clientSecret: Buffer.from("test-encrypted-client-secret"),
    redirectUri: "http://localhost:1337/api/auth/identity/callback",
    scopes: ["openid"],
    claimMapping: {},
    domainBindings: [],
    jitPolicy: {
      enabled: input.source === "jit_default",
      default_role_id: input.source === "jit_default" ? input.roleId : null,
      required_entra_app_role: "TaskDesk.User",
    },
    maxRoleRank: input.maxRoleRank,
    enabled: true,
  });
  if (input.source === "oidc_group") {
    await db.insert(schema.oidcGroupMappingTable).values({
      id: mappingId,
      identityConnectionId: input.connectionId,
      externalGroupId: `${input.connectionId}-group`,
      roleId: input.roleId,
      scope: "workspace",
      scopeId: input.workspaceId,
      enabled: true,
    });
  } else if (input.source === "scim_group") {
    await db.insert(schema.scimConnectionTable).values({
      identityConnectionId: input.connectionId,
      tokenHash: Buffer.alloc(32, 7),
      tokenPrefix: "test",
      allowedResources: ["users", "groups"],
      enabled: true,
    });
    await db.insert(schema.scimGroupTable).values({
      id: `${input.connectionId}-group`,
      scimConnectionId: input.connectionId,
      externalId: `${input.connectionId}-external-group`,
      displayName: `${input.connectionId} group`,
      active: true,
    });
    await db.insert(schema.scimGroupMappingTable).values({
      id: mappingId,
      scimConnectionId: input.connectionId,
      externalGroupId: `${input.connectionId}-external-group`,
      roleId: input.roleId,
      scope: "workspace",
      scopeId: input.workspaceId,
      enabled: true,
    });
  }
  await db.insert(schema.externalIdentityTable).values({
    id: identityId,
    identityConnectionId: input.connectionId,
    personId: input.personId,
    userId: input.userId,
    issuer: `https://${input.connectionId}.example.test/issuer`,
    subject: `${input.connectionId}-subject`,
    userNameSnapshot: `${input.connectionId}@example.test`,
    emailSnapshot: `${input.connectionId}@example.test`,
    active: true,
    provisionedVia: input.source === "scim_group" ? "scim" : "jit",
  });
  if (input.source === "scim_group") {
    await db.insert(schema.scimGroupDirectoryMemberTable).values({
      id: `${input.connectionId}-directory-member`,
      scimConnectionId: input.connectionId,
      scimGroupId: `${input.connectionId}-group`,
      externalIdentityId: identityId,
      active: true,
    });
  }
  const grantId = `${input.connectionId}-grant`;
  await db.insert(schema.membershipGrantTable).values({
    id: grantId,
    personId: input.personId,
    scope: "workspace",
    scopeId: input.workspaceId,
    roleId: input.roleId,
    sourceKind: input.source,
    externalIdentityId: identityId,
    identityConnectionId: input.connectionId,
    ...(input.source === "oidc_group" ? { oidcGroupMappingId: mappingId } : {}),
    ...(input.source === "scim_group" ? { scimGroupMappingId: mappingId } : {}),
  });
  await db.transaction((tx) =>
    projectMembershipKeys(tx, [
      {
        personId: input.personId,
        scope: "workspace",
        scopeId: input.workspaceId,
      },
    ]),
  );
  if (input.source === "scim_group") {
    const [membership] = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, input.personId),
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, input.workspaceId),
        ),
      );
    await db.insert(schema.scimGroupMemberTable).values({
      id: `${input.connectionId}-group-member`,
      scimGroupMappingId: mappingId,
      externalIdentityId: identityId,
      membershipId: membership?.id ?? null,
      membershipGrantId: grantId,
    });
  }
  return { grantId, mappingId, identityId };
}

async function roles(app: App, cookie: string, workspaceId: string) {
  const response = await listWorkspaceRolesNative(app, cookie, workspaceId);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as RoleBody[];
}

async function roleByKey(
  app: App,
  cookie: string,
  workspaceId: string,
  key: string,
) {
  const found = (await roles(app, cookie, workspaceId)).find(
    (role) => role.role === key,
  );
  if (!found) throw new Error(`no role ${key}`);
  return found;
}

async function createCustom(
  app: App,
  cookie: string,
  workspaceId: string,
  body: Record<string, unknown>,
) {
  const response = await createWorkspaceRoleNative(
    app,
    cookie,
    workspaceId,
    body,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as RoleBody;
}

async function errorOf(response: Response) {
  return JSON.parse(await response.text()) as {
    error: string;
    message: string;
    [key: string]: unknown;
  };
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("create and clone (RL-1, RL-2 data, RL-5)", () => {
  it("stores the implication closure, a description and a rank, and audits the added capabilities", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Support Lead",
      description: "Triages and assigns",
      rank: 45,
      capabilities: ["work_item:update", "work_item:assign"],
    });
    expect(role).toMatchObject({
      role: "support-lead",
      name: "Support Lead",
      description: "Triages and assigns",
      rank: 45,
      isSystem: false,
      isEditable: true,
      holderCount: 0,
    });
    // RL-5: ticking `work_item:update` carries `work_item:read` in the stored closure.
    expect(role.capabilities).toEqual([
      "work_item:assign",
      "work_item:read",
      "work_item:update",
    ]);

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, role.id),
          eq(schema.auditLogTable.action, "role.created"),
        ),
      );
    expect(audit?.after).toMatchObject({
      role: "support-lead",
      added: ["work_item:assign", "work_item:read", "work_item:update"],
      removed: [],
    });
  });

  it("clones a built-in role's capabilities into an independent custom role", async () => {
    const { app, owner, workspaceId } = await setup();
    const viewer = await roleByKey(app, owner.cookie, workspaceId, "viewer");
    const clone = await createCustom(app, owner.cookie, workspaceId, {
      role: "Viewer plus",
      cloneFromRoleId: viewer.id,
    });
    expect(clone.capabilities).toEqual(
      [...BUILT_IN_ROLES.viewer.capabilities].sort(),
    );
    expect(clone.isSystem).toBe(false);

    // The clone is independent: editing it leaves the original untouched.
    const edited = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      clone.id,
      { capabilities: ["work_item:read"] },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    expect(
      (await roleByKey(app, owner.cookie, workspaceId, "viewer")).capabilities,
    ).toEqual([...BUILT_IN_ROLES.viewer.capabilities].sort());
  });

  it("refuses an unknown or instance-tier capability (RL-6) and says which", async () => {
    const { app, owner, workspaceId } = await setup();
    const response = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "bad",
        capabilities: ["work_item:read", "instance:admin", "made:up"],
      },
    );
    expect(response.status).toBe(400);
    const body = await errorOf(response);
    expect(body.error).toBe("invalid_capability");
    expect(body.capabilities).toEqual(["instance:admin", "made:up"]);
  });

  it("allows a role with no capabilities, and refuses capabilities and a clone together", async () => {
    const { app, owner, workspaceId } = await setup();
    const empty = await createCustom(app, owner.cookie, workspaceId, {
      role: "Placeholder",
    });
    expect(empty.capabilities).toEqual([]);
    const viewer = await roleByKey(app, owner.cookie, workspaceId, "viewer");
    const both = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      {
        role: "Both",
        capabilities: ["work_item:read"],
        cloneFromRoleId: viewer.id,
      },
    );
    expect(both.status).toBe(400);
  });
});

describe("authority and rank guards (RL-3, RL-4, RL-14)", () => {
  it("RL-3: an admin cannot grant a capability they do not hold, and nothing is written", async () => {
    const { app, owner, workspaceId } = await setup();
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const before = (await roles(app, owner.cookie, workspaceId)).length;
    const response = await createWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      { role: "Escalation", capabilities: ["workspace:delete"] },
    );
    expect(response.status).toBe(403);
    const body = await errorOf(response);
    expect(body.error).toBe("beyond_own_authority");
    expect(body.capabilities).toEqual(["workspace:delete"]);
    expect((await roles(app, owner.cookie, workspaceId)).length).toBe(before);
  });

  it("RL-3 applies to what an edit ADDS, not to what the role already had", async () => {
    const { app, owner, workspaceId } = await setup();
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    // The owner builds a role carrying a capability no admin holds.
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Deleter",
      rank: 30,
      capabilities: ["workspace:delete", "work_item:read"],
    });
    // The admin may narrow it (keeping nothing beyond their authority is not required) ...
    const narrowed = await updateWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      role.id,
      { capabilities: ["work_item:read"] },
    );
    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    // ... but may not add it back.
    const widened = await updateWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      role.id,
      { capabilities: ["work_item:read", "workspace:delete"] },
    );
    expect(widened.status).toBe(403);
    expect((await errorOf(widened)).error).toBe("beyond_own_authority");
  });

  it("RL-14: a role cannot be created at or above the caller's own rank", async () => {
    const { app, owner, workspaceId } = await setup();
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const equal = await createWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      { role: "Equal", rank: 80, capabilities: ["work_item:read"] },
    );
    expect(equal.status).toBe(403);
    expect((await errorOf(equal)).error).toBe("rank_guard");
    await createCustom(app, admin.cookie, workspaceId, {
      role: "Below",
      rank: 79,
      capabilities: ["work_item:read"],
    });
    const ownerEqual = await createWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      { role: "Above", rank: 100, capabilities: ["work_item:read"] },
    );
    expect(ownerEqual.status).toBe(403);
  });

  it("RL-4: a role ranked at or above the caller's own is read-only; a lower one is editable", async () => {
    const { app, owner, workspaceId } = await setup();
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const high = await createCustom(app, owner.cookie, workspaceId, {
      role: "High",
      rank: 90,
      capabilities: ["work_item:read"],
    });
    const low = await createCustom(app, owner.cookie, workspaceId, {
      role: "Low",
      rank: 30,
      capabilities: ["work_item:read"],
    });
    const refused = await updateWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      high.id,
      { description: "x" },
    );
    expect(refused.status).toBe(403);
    expect((await errorOf(refused)).error).toBe("rank_guard");
    const allowed = await updateWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      low.id,
      { description: "ok" },
    );
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    // And a rank edit cannot reach the caller's own rank.
    const lift = await updateWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      low.id,
      { rank: 80 },
    );
    expect(lift.status).toBe(403);
  });

  it("a plain member cannot read or write roles beyond their authority", async () => {
    const { app, owner, workspaceId } = await setup();
    const member = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "member",
    );
    const response = await createWorkspaceRoleNative(
      app,
      member.cookie,
      workspaceId,
      { role: "Nope", capabilities: ["work_item:read"] },
    );
    expect(response.status).toBe(403);
  });
});

describe("built-in roles (RL-6)", () => {
  it("owner is never editable; a built-in keeps its key, name and rank", async () => {
    const { app, owner, workspaceId } = await setup();
    const ownerRole = await roleByKey(app, owner.cookie, workspaceId, "owner");
    const lockedOwner = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      ownerRole.id,
      { capabilities: ["work_item:read"] },
    );
    expect(lockedOwner.status).toBe(403);
    expect((await errorOf(lockedOwner)).error).toBe("role_not_editable");

    const manager = await roleByKey(app, owner.cookie, workspaceId, "manager");
    // The compiled definition decides editability: every built-in but `owner`.
    expect(manager).toMatchObject({ isSystem: true, isEditable: true });
    expect(ownerRole).toMatchObject({ isSystem: true, isEditable: false });
    for (const body of [
      { name: "Renamed" },
      { rank: 10 },
      { permission: { work_item: ["read"] } },
    ]) {
      const refused = await updateWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        manager.id,
        body,
      );
      expect(refused.status, JSON.stringify(body)).toBe(403);
    }
  });

  it("editing a built-in's capabilities takes effect and is audited; `manager` has no legacy row to move", async () => {
    const { app, owner, workspaceId } = await setup();
    const manager = await roleByKey(app, owner.cookie, workspaceId, "manager");
    expect(manager.capabilities).toContain("webhook:manage");
    const edited = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      manager.id,
      {
        capabilities: manager.capabilities.filter(
          (capability) => capability !== "webhook:manage",
        ),
      },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const after = (await edited.json()) as RoleBody;
    expect(after.capabilities).not.toContain("webhook:manage");
    expect(after.isSystem).toBe(true);
    const history = await getWorkspaceRoleHistoryNative(
      app,
      owner.cookie,
      workspaceId,
      manager.id,
    );
    const entries = (await history.json()) as Array<{
      action: string;
      removed: string[];
    }>;
    expect(entries[0]).toMatchObject({
      action: "role.updated",
      removed: ["webhook:manage"],
    });
  });

  it("a built-in is never deleted", async () => {
    const { app, owner, workspaceId } = await setup();
    for (const key of [
      "owner",
      "admin",
      "manager",
      "lead",
      "member",
      "viewer",
    ]) {
      const role = await roleByKey(app, owner.cookie, workspaceId, key);
      const response = await deleteWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        role.id,
      );
      expect(response.status, key).toBe(400);
    }
  });
});

describe("edit safety (RL-7, RL-9, RL-10, concurrency, self-edit)", () => {
  it("RL-9 keeps valid identity grants and retires only the source that exceeds the edited role rank", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Identity Reader",
      rank: 20,
      capabilities: ["work_item:read"],
    });
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      role.role,
    );
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, holder.user.id))
      .limit(1);
    if (!person) throw new Error("role identity holder person is missing");
    const jit = await addRoleIdentityGrant({
      workspaceId,
      roleId: role.id,
      personId: person.id,
      userId: holder.user.id,
      connectionId: "role-edit-jit-connection",
      source: "jit_default",
      maxRoleRank: 25,
    });
    const oidc = await addRoleIdentityGrant({
      workspaceId,
      roleId: role.id,
      personId: person.id,
      userId: holder.user.id,
      connectionId: "role-edit-oidc-connection",
      source: "oidc_group",
      maxRoleRank: 40,
    });
    const scim = await addRoleIdentityGrant({
      workspaceId,
      roleId: role.id,
      personId: person.id,
      userId: holder.user.id,
      connectionId: "role-edit-scim-connection",
      source: "scim_group",
      maxRoleRank: 28,
    });

    const capabilityEdit = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { capabilities: ["work_item:read", "work_item:update"] },
    );
    expect(capabilityEdit.status, await capabilityEdit.clone().text()).toBe(
      200,
    );
    const afterCapabilityEdit = await db
      .select({
        id: schema.membershipGrantTable.id,
        revokedAt: schema.membershipGrantTable.revokedAt,
      })
      .from(schema.membershipGrantTable)
      .where(
        inArray(schema.membershipGrantTable.id, [
          jit.grantId,
          oidc.grantId,
          scim.grantId,
        ]),
      );
    expect(afterCapabilityEdit).toHaveLength(3);
    expect(afterCapabilityEdit.every((grant) => grant.revokedAt === null)).toBe(
      true,
    );

    const rankEdit = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { rank: 30 },
    );
    expect(rankEdit.status, await rankEdit.clone().text()).toBe(200);
    const afterRankEdit = await db
      .select({
        id: schema.membershipGrantTable.id,
        sourceKind: schema.membershipGrantTable.sourceKind,
        revokedAt: schema.membershipGrantTable.revokedAt,
        revocationReason: schema.membershipGrantTable.revocationReason,
      })
      .from(schema.membershipGrantTable)
      .where(
        inArray(schema.membershipGrantTable.id, [
          jit.grantId,
          oidc.grantId,
          scim.grantId,
        ]),
      );
    expect(
      afterRankEdit.find((grant) => grant.id === jit.grantId),
    ).toMatchObject({
      sourceKind: "jit_default",
      revocationReason: "mapping_changed",
    });
    expect(
      afterRankEdit.find((grant) => grant.id === jit.grantId)?.revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      afterRankEdit.find((grant) => grant.id === oidc.grantId),
    ).toMatchObject({
      sourceKind: "oidc_group",
      revokedAt: null,
      revocationReason: null,
    });
    expect(
      afterRankEdit.find((grant) => grant.id === scim.grantId),
    ).toMatchObject({
      sourceKind: "scim_group",
      revocationReason: "mapping_changed",
    });
    expect(
      afterRankEdit.find((grant) => grant.id === scim.grantId)?.revokedAt,
    ).toBeInstanceOf(Date);
    const [scimHistory] = await db
      .select({
        revokedAt: schema.scimGroupMemberTable.revokedAt,
        membershipId: schema.scimGroupMemberTable.membershipId,
      })
      .from(schema.scimGroupMemberTable)
      .where(eq(schema.scimGroupMemberTable.membershipGrantId, scim.grantId));
    expect(scimHistory?.revokedAt).toBeInstanceOf(Date);
    expect(scimHistory?.membershipId).toBeNull();

    const restoredRank = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { rank: 20 },
    );
    expect(restoredRank.status, await restoredRank.clone().text()).toBe(200);
    const afterRestore = await db
      .select({
        id: schema.membershipGrantTable.id,
        revokedAt: schema.membershipGrantTable.revokedAt,
        revocationReason: schema.membershipGrantTable.revocationReason,
      })
      .from(schema.membershipGrantTable)
      .where(
        inArray(schema.membershipGrantTable.id, [
          jit.grantId,
          oidc.grantId,
          scim.grantId,
        ]),
      );
    expect(
      afterRestore.find((grant) => grant.id === jit.grantId)?.revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      afterRestore.find((grant) => grant.id === scim.grantId)?.revokedAt,
    ).toBeInstanceOf(Date);
    expect(
      afterRestore.find((grant) => grant.id === jit.grantId)?.revocationReason,
    ).toBe("mapping_changed");
    expect(
      afterRestore.find((grant) => grant.id === scim.grantId)?.revocationReason,
    ).toBe("mapping_changed");
    const [membership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, person.id),
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, workspaceId),
        ),
      );
    expect(membership?.roleId).toBe(role.id);
    const events = await db
      .select({ kind: schema.provisioningEventTable.kind })
      .from(schema.provisioningEventTable)
      .where(
        inArray(schema.provisioningEventTable.identityConnectionId, [
          "role-edit-jit-connection",
          "role-edit-oidc-connection",
          "role-edit-scim-connection",
        ]),
      );
    expect(
      events.filter((event) => event.kind === "connection.changed"),
    ).toHaveLength(9);
  });

  it("rejects external-forbidden authority without changing role or grant provenance", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Protected Identity Role",
      rank: 20,
      capabilities: ["work_item:read"],
    });
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      role.role,
    );
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, holder.user.id))
      .limit(1);
    if (!person) throw new Error("role identity holder person is missing");
    const grant = await addRoleIdentityGrant({
      workspaceId,
      roleId: role.id,
      personId: person.id,
      userId: holder.user.id,
      connectionId: "role-edit-forbidden-connection",
      source: "oidc_group",
      maxRoleRank: 25,
    });

    const response = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { capabilities: ["instance:admin"] },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("invalid_capability");
    const [storedRole] = await db
      .select({
        rank: schema.roleTable.rank,
        capabilities: schema.roleTable.capabilities,
      })
      .from(schema.roleTable)
      .where(eq(schema.roleTable.id, role.id));
    expect(storedRole).toMatchObject({
      rank: 20,
      capabilities: ["work_item:read"],
    });
    const [storedGrant] = await db
      .select({
        revokedAt: schema.membershipGrantTable.revokedAt,
        revocationReason: schema.membershipGrantTable.revocationReason,
      })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.id, grant.grantId));
    expect(storedGrant).toEqual({ revokedAt: null, revocationReason: null });
    const events = await db
      .select({ id: schema.provisioningEventTable.id })
      .from(schema.provisioningEventTable)
      .where(
        eq(
          schema.provisioningEventTable.identityConnectionId,
          "role-edit-forbidden-connection",
        ),
      );
    expect(events).toHaveLength(0);
  });

  it("rolls back the role and grant retirement when transactional identity evidence fails", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Rollback Identity Role",
      rank: 20,
      capabilities: ["work_item:read"],
    });
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      role.role,
    );
    const [person] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, holder.user.id))
      .limit(1);
    if (!person) throw new Error("role identity holder person is missing");
    const grant = await addRoleIdentityGrant({
      workspaceId,
      roleId: role.id,
      personId: person.id,
      userId: holder.user.id,
      connectionId: "role-edit-rollback-connection",
      source: "jit_default",
      maxRoleRank: 25,
    });
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION reject_role_change_provisioning_event()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = 'connection.changed'
          AND NEW.identity_connection_id = 'role-edit-rollback-connection' THEN
          RAISE EXCEPTION 'role change evidence failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `),
    );
    await db.execute(
      sql.raw(`
      CREATE TRIGGER reject_role_change_provisioning_event_trigger
      BEFORE INSERT ON provisioning_event
      FOR EACH ROW EXECUTE FUNCTION reject_role_change_provisioning_event()
    `),
    );
    try {
      const response = await updateWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        role.id,
        { rank: 30 },
      );
      expect(response.status).toBe(500);
      const [storedRole] = await db
        .select({ rank: schema.roleTable.rank })
        .from(schema.roleTable)
        .where(eq(schema.roleTable.id, role.id));
      expect(storedRole?.rank).toBe(20);
      const [storedGrant] = await db
        .select({
          revokedAt: schema.membershipGrantTable.revokedAt,
          revocationReason: schema.membershipGrantTable.revocationReason,
        })
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.id, grant.grantId));
      expect(storedGrant).toEqual({ revokedAt: null, revocationReason: null });
      const roleAudits = await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "role.updated"),
            eq(schema.auditLogTable.entityId, role.id),
          ),
        );
      expect(roleAudits).toHaveLength(0);
    } finally {
      await db.execute(
        sql.raw(`
        DROP TRIGGER IF EXISTS reject_role_change_provisioning_event_trigger ON provisioning_event;
        DROP FUNCTION IF EXISTS reject_role_change_provisioning_event();
      `),
      );
    }
  });

  it("retries a role edit when a concurrent identity grant and connection-ceiling change expand the locked closure", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Identity Race Role",
      rank: 20,
      capabilities: ["work_item:read"],
    });
    const firstHolder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      role.role,
    );
    const secondHolder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      role.role,
    );
    const [firstPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, firstHolder.user.id))
      .limit(1);
    const [secondPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, secondHolder.user.id))
      .limit(1);
    if (!firstPerson || !secondPerson)
      throw new Error("role race holder person is missing");
    const [ownerPerson] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, owner.user.id))
      .limit(1);
    if (!ownerPerson) throw new Error("role race owner person is missing");
    const directGrantId = "role-edit-race-second-direct-grant";
    await db.insert(schema.membershipGrantTable).values({
      id: directGrantId,
      personId: secondPerson.id,
      scope: "workspace",
      scopeId: workspaceId,
      roleId: role.id,
      sourceKind: "direct",
      directOrigin: "admin",
      grantedByPersonId: ownerPerson.id,
    });
    await db.transaction((tx) =>
      projectMembershipKeys(tx, [
        { personId: secondPerson.id, scope: "workspace", scopeId: workspaceId },
      ]),
    );
    const source = await addRoleIdentityGrant({
      workspaceId,
      roleId: role.id,
      personId: firstPerson.id,
      userId: firstHolder.user.id,
      connectionId: "role-edit-race-connection",
      source: "oidc_group",
      maxRoleRank: 25,
    });
    const secondIdentityId = "role-edit-race-second-identity";
    await db.insert(schema.externalIdentityTable).values({
      id: secondIdentityId,
      identityConnectionId: "role-edit-race-connection",
      personId: secondPerson.id,
      userId: secondHolder.user.id,
      issuer: "https://role-edit-race.example.test/issuer",
      subject: "role-edit-race-second-subject",
      userNameSnapshot: "role-edit-race-second@example.test",
      emailSnapshot: "role-edit-race-second@example.test",
      active: true,
      provisionedVia: "jit",
    });
    const [secondMembership] = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, secondPerson.id),
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, workspaceId),
        ),
      );
    if (!secondMembership)
      throw new Error("second role race membership is missing");
    const [workspace] = await db
      .select({ organisationId: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspaceId));
    if (!workspace) throw new Error("role race workspace is missing");

    const blocker = await openDatabaseClient();
    const observer = await openDatabaseClient();
    let roleEdit: Promise<Response> | undefined;
    let transactionOpen = false;
    try {
      await blocker.query("BEGIN");
      transactionOpen = true;
      await blocker.query(
        "SELECT id FROM organisation WHERE id = $1 FOR UPDATE",
        [workspace.organisationId],
      );
      const pidResult = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = pidResult.rows[0]?.pid;
      if (blockerPid === undefined)
        throw new Error("could not read role race blocker pid");

      roleEdit = updateWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        role.id,
        { rank: 30 },
      );
      await waitForBackendBlockedBy(observer, blockerPid);

      // Match the IP-22 parent-first source writer order while the role edit is
      // waiting at the organisation row: workspace, people, role, connection,
      // mapping, identity, then the affected projection key and grant.
      await blocker.query("SELECT id FROM workspace WHERE id = $1 FOR UPDATE", [
        workspaceId,
      ]);
      await blocker.query(
        "SELECT id FROM person WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE",
        [[firstPerson.id, secondPerson.id].sort()],
      );
      await blocker.query("SELECT id FROM role WHERE id = $1 FOR UPDATE", [
        role.id,
      ]);
      await blocker.query(
        "SELECT id FROM identity_connection WHERE id = $1 FOR UPDATE",
        ["role-edit-race-connection"],
      );
      await blocker.query(
        "SELECT id FROM oidc_group_mapping WHERE id = $1 FOR UPDATE",
        [source.mappingId],
      );
      await blocker.query(
        "SELECT id FROM external_identity WHERE id = $1 FOR UPDATE",
        [secondIdentityId],
      );
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`taskdesk:membership:${secondPerson.id}:workspace:${workspaceId}`],
      );
      await blocker.query(
        "SELECT id FROM membership WHERE id = $1 FOR UPDATE",
        [secondMembership.id],
      );
      await blocker.query(
        "UPDATE identity_connection SET max_role_rank = 40, config_version = config_version + 1 WHERE id = $1",
        ["role-edit-race-connection"],
      );
      const secondGrantId = randomUUID();
      await blocker.query(
        `INSERT INTO membership_grant (
          id, membership_id, person_id, scope, scope_id, role_id,
          source_kind, external_identity_id, identity_connection_id,
          oidc_group_mapping_id, sees_all
        ) VALUES ($1, $2, $3, 'workspace', $4, $5, 'oidc_group', $6, $7, $8, false)`,
        [
          secondGrantId,
          secondMembership.id,
          secondPerson.id,
          workspaceId,
          role.id,
          secondIdentityId,
          "role-edit-race-connection",
          source.mappingId,
        ],
      );
      await blocker.query("COMMIT");
      transactionOpen = false;

      const response = await roleEdit;
      expect(response.status, await response.clone().text()).toBe(200);
      const grants = await db
        .select({
          id: schema.membershipGrantTable.id,
          revokedAt: schema.membershipGrantTable.revokedAt,
        })
        .from(schema.membershipGrantTable)
        .where(
          inArray(schema.membershipGrantTable.id, [
            source.grantId,
            secondGrantId,
          ]),
        );
      expect(grants).toHaveLength(2);
      expect(grants.every((grant) => grant.revokedAt === null)).toBe(true);
      const [connection] = await db
        .select({ maxRoleRank: schema.identityConnectionTable.maxRoleRank })
        .from(schema.identityConnectionTable)
        .where(
          eq(schema.identityConnectionTable.id, "role-edit-race-connection"),
        );
      expect(connection?.maxRoleRank).toBe(40);
      const [storedDirectGrant] = await db
        .select({ revokedAt: schema.membershipGrantTable.revokedAt })
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.id, directGrantId));
      expect(storedDirectGrant?.revokedAt).toBeNull();
    } finally {
      if (transactionOpen) await blocker.query("ROLLBACK");
      await roleEdit?.catch(() => undefined);
      await Promise.all([observer.end(), blocker.end()]);
    }
  });

  it("RL-9: a role change takes effect on the very next request", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Reader",
      rank: 20,
      capabilities: ["workspace:read"],
    });
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "reader",
    );
    expect(
      (await listWorkspaceRolesNative(app, holder.cookie, workspaceId)).status,
    ).toBe(200);
    const narrowed = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { capabilities: [] },
    );
    expect(narrowed.status, await narrowed.clone().text()).toBe(200);
    expect(
      (await listWorkspaceRolesNative(app, holder.cookie, workspaceId)).status,
    ).toBe(403);
  });

  it("a stale expectedVersion is a 409 carrying the current role; the right one saves", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Versioned",
      capabilities: ["work_item:read"],
    });
    const first = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { description: "one", expectedVersion: role.version },
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const fresh = (await first.json()) as RoleBody;
    expect(fresh.version).not.toBe(role.version);

    const stale = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { description: "two", expectedVersion: role.version },
    );
    expect(stale.status).toBe(409);
    const body = await errorOf(stale);
    expect(body.error).toBe("role_changed");
    expect((body.current as RoleBody).description).toBe("one");
  });

  it("editing your own role to remove capabilities needs confirmation", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Ops",
      rank: 30,
      capabilities: ["workspace:manage_roles", "work_item:read"],
    });
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "ops",
    );
    const unconfirmed = await updateWorkspaceRoleNative(
      app,
      holder.cookie,
      workspaceId,
      role.id,
      { capabilities: ["workspace:manage_roles"] },
    );
    expect(unconfirmed.status).toBe(409);
    const body = await errorOf(unconfirmed);
    expect(body.error).toBe("self_edit_confirmation_required");
    expect(body.removed).toEqual(["work_item:read"]);

    const confirmed = await updateWorkspaceRoleNative(
      app,
      holder.cookie,
      workspaceId,
      role.id,
      { capabilities: ["workspace:manage_roles"], confirmSelfEdit: true },
    );
    expect(confirmed.status, await confirmed.clone().text()).toBe(200);
  });

  it("RL-7: a save that would leave only suspended people able to manage roles is refused", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Ops",
      rank: 30,
      capabilities: ["workspace:manage_roles"],
    });
    const holder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "ops",
    );
    // The only other role manager (the owner) is suspended.
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, owner.user.id));
    const response = await updateWorkspaceRoleNative(
      app,
      holder.cookie,
      workspaceId,
      role.id,
      { capabilities: [], confirmSelfEdit: true },
    );
    expect(response.status, await response.clone().text()).toBe(409);
    expect((await errorOf(response)).error).toBe("last_role_manager");
    const [row] = await db
      .select({ capabilities: schema.roleTable.capabilities })
      .from(schema.roleTable)
      .where(eq(schema.roleTable.id, role.id));
    expect(row?.capabilities).toEqual([
      "workspace:manage_roles",
      "workspace:read",
    ]);
  });

  it("RL-10: history lists who changed which capabilities, newest first", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Audited",
      rank: 20,
      capabilities: ["work_item:read"],
    });
    const updated = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { capabilities: ["work_item:read", "label:manage"], rank: 25 },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    const response = await getWorkspaceRoleHistoryNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
    );
    expect(response.status).toBe(200);
    const entries = (await response.json()) as Array<{
      action: string;
      added: string[];
      removed: string[];
      actorName: string | null;
      rank: { before: number | null; after: number | null } | null;
    }>;
    expect(entries.map((entry) => entry.action)).toEqual([
      "role.updated",
      "role.created",
    ]);
    expect(entries[0]).toMatchObject({
      added: ["label:manage"],
      removed: [],
      rank: { before: 20, after: 25 },
    });
    expect(entries[1]?.added).toEqual(["work_item:read"]);
    expect(entries[0]?.actorName).toBeTruthy();
  });
});

describe("holders and bulk reassignment (RL-8)", () => {
  async function twoHolders() {
    const world = await setup();
    const role = await createCustom(
      world.app,
      world.owner.cookie,
      world.workspaceId,
      {
        role: "Temp",
        rank: 20,
        capabilities: ["work_item:read"],
      },
    );
    const first = await inviteAndAcceptAsNewMemberNative(
      world.app,
      world.owner.cookie,
      world.workspaceId,
      "temp",
    );
    const second = await inviteAndAcceptAsNewMemberNative(
      world.app,
      world.owner.cookie,
      world.workspaceId,
      "temp",
    );
    return { ...world, role, first, second };
  }

  it("lists the holders with their state and counts them", async () => {
    const { app, owner, workspaceId, role, first, second } = await twoHolders();
    const response = await listWorkspaceRoleHoldersNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      role: RoleBody;
      holders: Array<{ userId: string; active: boolean; suspended: boolean }>;
    };
    expect(body.role.holderCount).toBe(2);
    expect(body.holders.map((holder) => holder.userId).sort()).toEqual(
      [first.user.id, second.user.id].sort(),
    );
    expect(body.holders.every((holder) => holder.active)).toBe(true);
  });

  it("moves every holder (or only the listed people) in one step, then the role can be deleted", async () => {
    const { app, owner, workspaceId, role, first, second } = await twoHolders();
    const member = await roleByKey(app, owner.cookie, workspaceId, "member");

    const one = await reassignWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { toRoleId: member.id, userIds: [first.user.id] },
    );
    expect(one.status, await one.clone().text()).toBe(200);
    expect(await one.json()).toMatchObject({ moved: 1 });

    const rest = await reassignWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { toRoleId: member.id },
    );
    expect(await rest.json()).toMatchObject({ moved: 1 });

    const moved = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, second.user.id),
        ),
      );
    expect(moved[0]?.role).toBe("member");
    expect(
      (await roleByKey(app, owner.cookie, workspaceId, "member")).holderCount,
    ).toBe(2);

    // Nobody holds it any more, so deletion is now a pending action, not a refusal.
    const deletion = await deleteWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
    );
    expect(deletion.status, await deletion.clone().text()).toBe(202);

    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, role.id),
          eq(schema.auditLogTable.action, "membership.changed"),
        ),
      );
    expect(audit?.after).toMatchObject({
      kind: "role_reassigned",
      to: "member",
    });
  });

  it("refuses same-role, owner on either side, and roles at or above the caller's rank", async () => {
    const { app, owner, workspaceId, role } = await twoHolders();
    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const adminRole = await roleByKey(app, owner.cookie, workspaceId, "admin");
    const ownerRole = await roleByKey(app, owner.cookie, workspaceId, "owner");
    const member = await roleByKey(app, owner.cookie, workspaceId, "member");

    const same = await reassignWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { toRoleId: role.id },
    );
    expect(same.status).toBe(400);

    const toOwner = await reassignWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { toRoleId: ownerRole.id },
    );
    expect(toOwner.status).toBe(400);

    const fromOwner = await reassignWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      ownerRole.id,
      { toRoleId: member.id },
    );
    expect(fromOwner.status).toBe(400);

    // An admin (rank 80) can neither hand out their own rank nor move people who hold it.
    const intoAdmin = await reassignWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      role.id,
      { toRoleId: adminRole.id },
    );
    expect(intoAdmin.status).toBe(403);
    const outOfAdmin = await reassignWorkspaceRoleNative(
      app,
      admin.cookie,
      workspaceId,
      adminRole.id,
      { toRoleId: member.id },
    );
    expect(outOfAdmin.status).toBe(403);
  });

  it("RL-7: moving the last active role managers out of their role is refused and rolled back", async () => {
    const { app, owner, workspaceId } = await setup();
    // `ops` holds role management; `hr` may move people but cannot manage roles.
    await createCustom(app, owner.cookie, workspaceId, {
      role: "Ops",
      rank: 30,
      capabilities: ["workspace:manage_roles"],
    });
    // RL-3: people can only be moved into a role whose capabilities the mover holds, so `hr`
    // holds everything `viewer` does as well as member management.
    const viewerToMoveTo = await roleByKey(
      app,
      owner.cookie,
      workspaceId,
      "viewer",
    );
    const hrRole = await createCustom(app, owner.cookie, workspaceId, {
      role: "Hr",
      rank: 60,
      capabilities: [
        ...viewerToMoveTo.capabilities,
        "workspace:manage_members",
      ],
    });
    expect(hrRole.capabilities).not.toContain("workspace:manage_roles");
    const opsHolder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "ops",
    );
    const hrHolder = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "hr",
    );
    const opsRole = await roleByKey(app, owner.cookie, workspaceId, "ops");
    const viewer = await roleByKey(app, owner.cookie, workspaceId, "viewer");
    // The owner, the only other role manager, is suspended.
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, owner.user.id));
    const response = await reassignWorkspaceRoleNative(
      app,
      hrHolder.cookie,
      workspaceId,
      opsRole.id,
      { toRoleId: viewer.id },
    );
    expect(response.status, await response.clone().text()).toBe(409);
    expect((await errorOf(response)).error).toBe("last_role_manager");
    const [still] = await db
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, opsHolder.user.id),
        ),
      );
    expect(still?.role).toBe("ops");
  });
});

describe("preview (RL-12) and reads", () => {
  it("previews the navigation and work-item actions of a DRAFT set without saving it", async () => {
    const { app, owner, workspaceId } = await setup();
    const role = await createCustom(app, owner.cookie, workspaceId, {
      role: "Draft",
      capabilities: ["work_item:read"],
    });
    const response = await previewWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { capabilities: ["work_item:update", "project:read"] },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const preview = (await response.json()) as {
      navigation: Array<{ key: string; allowed: boolean }>;
      workItemActions: Array<{ key: string; allowed: boolean }>;
    };
    expect(
      preview.navigation.find((entry) => entry.key === "projects")?.allowed,
    ).toBe(true);
    expect(
      preview.workItemActions.find((entry) => entry.key === "edit")?.allowed,
    ).toBe(true);
    expect(
      preview.workItemActions.find((entry) => entry.key === "delete")?.allowed,
    ).toBe(false);
    // Nothing persisted.
    expect(
      (await roleByKey(app, owner.cookie, workspaceId, "draft")).capabilities,
    ).toEqual(["work_item:read"]);

    const bad = await previewWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      role.id,
      { capabilities: ["instance:admin"] },
    );
    expect(bad.status).toBe(400);
  });

  it("is tenant-isolated: another workspace's role id is a 404 on every route", async () => {
    const { app, owner, workspaceId } = await setup();
    const other = await createWorkspaceNative(app, owner.cookie, {
      name: "Other",
    });
    const otherId = ((await other.json()) as { id: string }).id;
    const foreign = await createCustom(app, owner.cookie, otherId, {
      role: "Foreign",
      capabilities: ["work_item:read"],
    });
    for (const response of [
      await getWorkspaceRoleNative(app, owner.cookie, workspaceId, foreign.id),
      await listWorkspaceRoleHoldersNative(
        app,
        owner.cookie,
        workspaceId,
        foreign.id,
      ),
      await getWorkspaceRoleHistoryNative(
        app,
        owner.cookie,
        workspaceId,
        foreign.id,
      ),
      await updateWorkspaceRoleNative(
        app,
        owner.cookie,
        workspaceId,
        foreign.id,
        { description: "x" },
      ),
    ]) {
      expect(response.status).toBe(404);
    }
  });
});

describe("built-in admin editing and assignment rank (review fixes)", () => {
  it("the built-in admin is editable while an admin member exists, and its legacy statement row moves by delta", async () => {
    const { app, owner, workspaceId } = await setup();
    await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    // The admin member holds a direct `system_backfill` reach grant on the admin role row.
    const admin = await roleByKey(app, owner.cookie, workspaceId, "admin");
    const edited = await updateWorkspaceRoleNative(
      app,
      owner.cookie,
      workspaceId,
      admin.id,
      {
        capabilities: admin.capabilities.filter(
          (capability) => capability !== "label:manage",
        ),
      },
    );
    expect(edited.status, await edited.clone().text()).toBe(200);
    const [legacy] = await db
      .select({ permission: schema.workspaceRoleTable.permission })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, workspaceId),
          eq(schema.workspaceRoleTable.role, "admin"),
        ),
      );
    const statements = JSON.parse(legacy?.permission ?? "{}") as Record<
      string,
      string[]
    >;
    // `label:read` rides on `workspace:read`, which the role still holds; the writes are gone.
    expect(statements.label).toEqual(["read"]);
    expect(statements.project?.length).toBeGreaterThan(0);
  });

  it("a manager cannot promote themselves to admin, nor a lead invite an admin; an admin may still assign admin", async () => {
    const { app, owner, workspaceId } = await setup();
    const manager = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "manager",
    );
    const lead = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "lead",
    );
    const promote = await updateWorkspaceMemberRoleNative(
      app,
      manager.cookie,
      workspaceId,
      manager.user.id,
      { role: "admin" },
    );
    expect(promote.status, await promote.clone().text()).toBe(403);
    expect((await errorOf(promote)).error).toBe("rank_guard");

    const invited = await inviteWorkspaceMemberNative(
      app,
      lead.cookie,
      workspaceId,
      { email: "escalation@example.com", role: "admin" },
    );
    expect(invited.status, await invited.clone().text()).toBe(403);

    const admin = await inviteAndAcceptAsNewMemberNative(
      app,
      owner.cookie,
      workspaceId,
      "admin",
    );
    const lateral = await updateWorkspaceMemberRoleNative(
      app,
      admin.cookie,
      workspaceId,
      lead.user.id,
      { role: "admin" },
    );
    expect(lateral.status, await lateral.clone().text()).toBe(200);
  });
});
