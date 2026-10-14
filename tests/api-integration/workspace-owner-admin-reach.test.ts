/**
 * Decision log 2026-10-14, "Workspace owners and admins hold an explicit `sees_all` grant"
 * (rbac.md Reach step 2).
 *
 * Every test here goes through the REAL routes: a user signs up, creates a workspace and a
 * project, and the other actors join through the native membership routes. Reach is read back
 * through the project routes themselves (404 = out of reach), and the persisted rows are
 * asserted so each writer is pinned individually (`syncWorkspaceAdminReach` in every
 * membership writer; remove one call and exactly that writer's test goes red).
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { encryptIdentityClientSecret } from "../../apps/api/src/identity/client-secret";
import { projectMembershipKeys } from "../../apps/api/src/identity/membership-projection";
import { createApp } from "../../apps/api/src/index";
import deleteAccountData from "../../apps/api/src/user/controllers/delete-account-data";
import { seedDefaultWorkspaceRoles } from "../../apps/api/src/utils/seed-default-workspace-roles";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { reconcileWorkspaceAdminReach } from "../../apps/api/src/workspace/workspace-admin-reach";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { signUpUser } from "./helpers/organization-http";
import {
  createWorkspaceNative,
  deleteWorkspaceNative,
} from "./helpers/workspace-write-http";

type App = ReturnType<typeof createApp>["app"];
type Actor = Awaited<ReturnType<typeof signUpUser>>;

async function call(
  app: App,
  cookie: string,
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const init = {
    method,
    headers: { "content-type": "application/json", cookie, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const response =
    method === "GET"
      ? await app.request(path, init)
      : await csrfRequest(app, path, init, cookie);
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // empty body
  }
  return { status: response.status, json: json as Record<string, any> };
}

async function personIdOf(userId: string) {
  const [row] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!row) throw new Error("person not provisioned");
  return row.id;
}

async function reachRows(userId: string, workspaceId: string) {
  const personId = await personIdOf(userId);
  const membership = await db
    .select({
      seesAll: schema.membershipTable.seesAll,
      roleKey: schema.roleTable.key,
    })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.roleTable.id, schema.membershipTable.roleId),
    )
    .where(
      and(
        eq(schema.membershipTable.personId, personId),
        eq(schema.membershipTable.scope, "workspace"),
        eq(schema.membershipTable.scopeId, workspaceId),
      ),
    );
  const grants = await db
    .select({
      seesAll: schema.membershipGrantTable.seesAll,
      directOrigin: schema.membershipGrantTable.directOrigin,
      revokedAt: schema.membershipGrantTable.revokedAt,
      membershipId: schema.membershipGrantTable.membershipId,
    })
    .from(schema.membershipGrantTable)
    .where(
      and(
        eq(schema.membershipGrantTable.personId, personId),
        eq(schema.membershipGrantTable.scope, "workspace"),
        eq(schema.membershipGrantTable.scopeId, workspaceId),
      ),
    );
  return { membership, grants };
}

async function typeIdFor(workspaceId: string) {
  const [row] = await db
    .select({ id: schema.workItemTypeTable.id })
    .from(schema.workItemTypeTable)
    .where(eq(schema.workItemTypeTable.workspaceId, workspaceId))
    .limit(1);
  if (!row) throw new Error("no default work item type");
  return row.id;
}

type World = {
  app: App;
  owner: Actor;
  workspaceId: string;
  projectId: string;
};

async function newWorld(): Promise<World> {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const ws = await createWorkspaceNative(app, owner.cookie, { name: "Acme" });
  expect(ws.status).toBe(200);
  const workspaceId = ((await ws.json()) as { id: string }).id;
  const project = await call(app, owner.cookie, "POST", "/api/project", {
    workspaceId,
    name: "P",
    icon: "Folder",
    slug: `p-${randomUUID().slice(0, 8)}`,
  });
  expect(project.status).toBe(200);
  return { app, owner, workspaceId, projectId: project.json.id as string };
}

async function addMember(world: World, role: string): Promise<Actor> {
  const actor = await signUpUser(world.app);
  const added = await call(
    world.app,
    world.owner.cookie,
    "POST",
    `/api/workspace/${world.workspaceId}/members`,
    { userId: actor.user.id, role },
  );
  expect(added.status).toBe(200);
  return actor;
}

async function canReadProject(world: World, actor: Actor) {
  return (
    await call(
      world.app,
      actor.cookie,
      "GET",
      `/api/project/${world.projectId}`,
    )
  ).status;
}

async function setRole(world: World, actor: Actor, role: string) {
  const response = await call(
    world.app,
    world.owner.cookie,
    "PATCH",
    `/api/workspace/${world.workspaceId}/members/${actor.user.id}/role`,
    { role },
  );
  expect(response.status).toBe(200);
}

describe("workspace owner/admin explicit sees_all grant", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a fresh ordinary owner creates a workspace and project, then reads, lists, updates, and works items in it", async () => {
    const world = await newWorld();
    const { app, owner, workspaceId, projectId } = world;

    // The grant exists straight after creation, with direct system provenance.
    const rows = await reachRows(owner.user.id, workspaceId);
    expect(rows.membership).toEqual([{ seesAll: true, roleKey: "owner" }]);
    expect(rows.grants).toHaveLength(1);
    expect(rows.grants[0]).toMatchObject({
      seesAll: true,
      directOrigin: "system_backfill",
      revokedAt: null,
    });
    expect(rows.grants[0]?.membershipId).not.toBeNull();

    expect(
      (await call(app, owner.cookie, "GET", `/api/project/${projectId}`))
        .status,
    ).toBe(200);
    const list = await call(
      app,
      owner.cookie,
      "GET",
      `/api/project?workspaceId=${workspaceId}`,
    );
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).toContain(projectId);
    expect(
      (
        await call(app, owner.cookie, "PUT", `/api/project/${projectId}`, {
          name: "Renamed",
          icon: "Folder",
          slug: "p",
          description: "d",
        })
      ).status,
    ).toBe(200);

    const created = await call(
      app,
      owner.cookie,
      "POST",
      `/api/projects/${projectId}/work-items`,
      { typeId: await typeIdFor(workspaceId), title: "first" },
    );
    expect(created.status).toBe(200);
    const key = created.json.key as string;
    const read = await call(app, owner.cookie, "GET", `/api/work-items/${key}`);
    expect(read.status).toBe(200);
    const edited = await call(
      app,
      owner.cookie,
      "PATCH",
      `/api/work-items/${key}`,
      { title: "edited" },
      { "if-match": String(read.json.version ?? 1) },
    );
    expect(edited.status).toBe(200);
    expect(
      (
        await call(
          app,
          owner.cookie,
          "GET",
          `/api/projects/${projectId}/work-items`,
        )
      ).status,
    ).toBe(200);
  });

  it("promoting a member to admin grants reach; demoting them away revokes it (404 again)", async () => {
    const world = await newWorld();
    const member = await addMember(world, "member");
    expect(await canReadProject(world, member)).toBe(404);
    expect(
      (await reachRows(member.user.id, world.workspaceId)).membership,
    ).toEqual([]);

    await setRole(world, member, "admin");
    expect(await canReadProject(world, member)).toBe(200);
    expect(
      (await reachRows(member.user.id, world.workspaceId)).membership,
    ).toEqual([{ seesAll: true, roleKey: "admin" }]);

    await setRole(world, member, "viewer");
    expect(await canReadProject(world, member)).toBe(404);
    const after = await reachRows(member.user.id, world.workspaceId);
    expect(after.membership).toEqual([]);
    expect(after.grants).toHaveLength(1);
    expect(after.grants[0]).toMatchObject({
      revokedAt: expect.any(Date),
      membershipId: null,
    });
  });

  it("a member added directly as admin has reach; a plain member or viewer or manager gains none", async () => {
    const world = await newWorld();
    const admin = await addMember(world, "admin");
    const member = await addMember(world, "member");
    const viewer = await addMember(world, "viewer");
    expect(await canReadProject(world, admin)).toBe(200);
    expect(await canReadProject(world, member)).toBe(404);
    expect(await canReadProject(world, viewer)).toBe(404);

    // A manager: seeded row inserted directly (no native route mints `manager` today).
    const manager = await signUpUser(world.app);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: world.workspaceId,
      userId: manager.user.id,
      role: "manager",
      joinedAt: new Date(),
    });
    expect(await canReadProject(world, manager)).toBe(404);
    for (const actor of [member, viewer, manager]) {
      expect(
        (await reachRows(actor.user.id, world.workspaceId)).grants,
      ).toEqual([]);
    }
  });

  it("accepting an invitation to the admin role gains reach", async () => {
    const world = await newWorld();
    const invitee = await signUpUser(world.app);
    const invited = await call(
      world.app,
      world.owner.cookie,
      "POST",
      `/api/workspace/${world.workspaceId}/invitations`,
      { email: invitee.user.email, role: "admin" },
    );
    expect(invited.status).toBe(200);
    const invitationId = (invited.json.id ??
      invited.json.invitation?.id) as string;
    expect(await canReadProject(world, invitee)).toBe(404);
    const accepted = await call(
      world.app,
      invitee.cookie,
      "POST",
      `/api/invitation/${invitationId}/accept`,
    );
    expect(accepted.status).toBe(200);
    expect(await canReadProject(world, invitee)).toBe(200);
  });

  it("removing an admin revokes their reach rows", async () => {
    const world = await newWorld();
    const admin = await addMember(world, "admin");
    expect(await canReadProject(world, admin)).toBe(200);
    const removed = await call(
      world.app,
      world.owner.cookie,
      "DELETE",
      `/api/workspace/${world.workspaceId}/members/${admin.user.id}`,
    );
    expect(removed.status).toBe(200);
    const rows = await reachRows(admin.user.id, world.workspaceId);
    expect(rows.membership).toEqual([]);
    expect(rows.grants.every((grant) => grant.revokedAt !== null)).toBe(true);
    expect(await canReadProject(world, admin)).not.toBe(200);
  });

  it("an admin who leaves loses their reach rows", async () => {
    const world = await newWorld();
    const admin = await addMember(world, "admin");
    const left = await call(
      world.app,
      admin.cookie,
      "POST",
      `/api/workspace/${world.workspaceId}/leave`,
    );
    expect(left.status).toBe(200);
    const rows = await reachRows(admin.user.id, world.workspaceId);
    expect(rows.membership).toEqual([]);
    expect(rows.grants.every((grant) => grant.revokedAt !== null)).toBe(true);
  });

  it("transferring ownership moves the owner grant: the new owner gains it, the previous owner keeps admin reach", async () => {
    const world = await newWorld();
    const next = await addMember(world, "member");
    expect(await canReadProject(world, next)).toBe(404);
    const transferred = await call(
      world.app,
      world.owner.cookie,
      "POST",
      `/api/workspace/${world.workspaceId}/transfer-ownership`,
      { newOwnerUserId: next.user.id },
    );
    expect(transferred.status).toBe(200);
    expect(
      (await reachRows(next.user.id, world.workspaceId)).membership,
    ).toEqual([{ seesAll: true, roleKey: "owner" }]);
    expect(
      (await reachRows(world.owner.user.id, world.workspaceId)).membership,
    ).toEqual([{ seesAll: true, roleKey: "admin" }]);
    expect(await canReadProject(world, next)).toBe(200);
    expect(await canReadProject(world, world.owner)).toBe(200);
  });

  it("another workspace's projects stay unreachable for an owner or admin", async () => {
    const world = await newWorld();
    const other = await newWorld();
    expect(
      (
        await call(
          world.app,
          world.owner.cookie,
          "GET",
          `/api/project/${other.projectId}`,
        )
      ).status,
    ).toBe(404);
    const admin = await addMember(world, "admin");
    expect(
      (
        await call(
          world.app,
          admin.cookie,
          "GET",
          `/api/project/${other.projectId}`,
        )
      ).status,
    ).toBe(404);
  });

  it("an external (JIT) grant for the same person is never deleted by promotion or demotion; its role is reprojected with sees_all false", async () => {
    process.env.TASKDESK_ENCRYPTION_KEY ??= "d7".repeat(32);
    const world = await newWorld();
    const member = await addMember(world, "member");
    const personId = await personIdOf(member.user.id);
    const [internal] = await db
      .select({ id: schema.personTable.organisationId })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, personId));
    if (!internal) throw new Error("organisation");

    const [role] = await db
      .insert(schema.roleTable)
      .values({
        scope: "workspace",
        workspaceId: world.workspaceId,
        key: "ext-reader",
        name: "External reader",
        rank: 10,
        capabilities: ["project:read"],
      })
      .returning();
    if (!role) throw new Error("role");
    await db.insert(schema.identityConnectionTable).values({
      id: "owner-reach-connection",
      providerType: "entra",
      portalScope: "agent",
      organisationId: null,
      defaultWorkspaceId: world.workspaceId,
      displayName: "Owner reach",
      issuer:
        "https://login.microsoftonline.com/12345678-1234-4234-8234-123456789012/v2.0",
      tenantId: "12345678-1234-4234-8234-123456789012",
      clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientSecret: encryptIdentityClientSecret(
        "owner-reach-connection",
        "stored-secret",
      ),
      redirectUri: "http://localhost:1337/api/auth/identity/callback",
      scopes: ["openid", "profile"],
      claimMapping: { version: 1, displayName: "name" },
      domainBindings: [],
      jitPolicy: {
        enabled: true,
        default_role_id: role.id,
        required_entra_app_role: "TaskDesk.User",
      },
      maxRoleRank: 50,
      enabled: true,
    });
    const [identity] = await db
      .insert(schema.externalIdentityTable)
      .values({
        identityConnectionId: "owner-reach-connection",
        personId,
        userId: member.user.id,
        issuer:
          "https://login.microsoftonline.com/12345678-1234-4234-8234-123456789012/v2.0",
        subject: "owner-reach-subject",
        userNameSnapshot: "m@example.test",
        emailSnapshot: "m@example.test",
        active: true,
        provisionedVia: "jit",
      })
      .returning();
    if (!identity) throw new Error("identity");
    const [jit] = await db
      .insert(schema.membershipGrantTable)
      .values({
        personId,
        scope: "workspace",
        scopeId: world.workspaceId,
        roleId: role.id,
        sourceKind: "jit_default",
        externalIdentityId: identity.id,
        identityConnectionId: "owner-reach-connection",
        seesAll: false,
      })
      .returning();
    if (!jit) throw new Error("jit grant");
    await db.transaction((tx) =>
      projectMembershipKeys(tx, [
        { personId, scope: "workspace", scopeId: world.workspaceId },
      ]),
    );
    expect(
      (await reachRows(member.user.id, world.workspaceId)).membership,
    ).toEqual([{ seesAll: false, roleKey: "ext-reader" }]);

    await setRole(world, member, "admin");
    expect(
      (await reachRows(member.user.id, world.workspaceId)).membership,
    ).toEqual([{ seesAll: true, roleKey: "admin" }]);

    await setRole(world, member, "viewer");
    // Our grant is revoked, the JIT grant is untouched and projected again, without sees_all.
    expect(
      (await reachRows(member.user.id, world.workspaceId)).membership,
    ).toEqual([{ seesAll: false, roleKey: "ext-reader" }]);
    const [jitAfter] = await db
      .select({
        revokedAt: schema.membershipGrantTable.revokedAt,
        membershipId: schema.membershipGrantTable.membershipId,
      })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.id, jit.id));
    expect(jitAfter?.revokedAt).toBeNull();
    expect(jitAfter?.membershipId).not.toBeNull();
  });

  it("deleting a workspace with owner/admin grants succeeds and leaves no reach rows behind", async () => {
    const world = await newWorld();
    await addMember(world, "admin");
    const deleted = await deleteWorkspaceNative(
      world.app,
      world.owner.cookie,
      world.workspaceId,
    );
    expect(deleted.status).toBe(200);
    const left = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.scopeId, world.workspaceId));
    expect(left).toEqual([]);
    const grants = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable)
      .where(
        and(
          eq(schema.membershipGrantTable.scopeId, world.workspaceId),
          isNull(schema.membershipGrantTable.revokedAt),
        ),
      );
    expect(grants).toEqual([]);
  });

  it("account deletion of a sole-member owner deletes the workspace without tripping the reach rows' role restriction", async () => {
    const world = await newWorld();
    await deleteAccountData(world.owner.user.id);
    const workspaces = await db
      .select({ id: schema.workspaceTable.id })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, world.workspaceId));
    expect(workspaces).toEqual([]);
    const memberships = await db
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(eq(schema.membershipTable.scopeId, world.workspaceId));
    expect(memberships).toEqual([]);
  });

  it("account deletion of an admin who leaves a shared workspace revokes their reach rows", async () => {
    const world = await newWorld();
    const admin = await addMember(world, "admin");
    expect(await canReadProject(world, admin)).toBe(200);
    await deleteAccountData(admin.user.id);
    const rows = await reachRows(admin.user.id, world.workspaceId);
    expect(rows.membership).toEqual([]);
    expect(rows.grants.every((grant) => grant.revokedAt !== null)).toBe(true);
  });

  it("is idempotent and fails closed for a duplicate-row (ambiguous) legacy membership", async () => {
    const world = await newWorld();
    const { syncWorkspaceAdminReach } = await import(
      "../../apps/api/src/workspace/workspace-admin-reach"
    );
    // Re-running over the unchanged owner changes nothing.
    await db.transaction((tx) =>
      syncWorkspaceAdminReach(tx, world.workspaceId, world.owner.user.id),
    );
    await db.transaction((tx) =>
      syncWorkspaceAdminReach(tx, world.workspaceId, world.owner.user.id),
    );
    const rows = await reachRows(world.owner.user.id, world.workspaceId);
    expect(rows.grants).toHaveLength(1);
    expect(rows.membership).toHaveLength(1);

    // Two legacy rows for the same pair is ambiguous: the grant is revoked, not guessed at.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: world.workspaceId,
      userId: world.owner.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await db.transaction((tx) =>
      syncWorkspaceAdminReach(tx, world.workspaceId, world.owner.user.id),
    );
    expect(
      (await reachRows(world.owner.user.id, world.workspaceId)).membership,
    ).toEqual([]);
  });

  describe("round 2: guards and reconciliation", () => {
    async function explicitDirectGrant(world: World, actor: Actor) {
      const personId = await personIdOf(actor.user.id);
      const ownerPersonId = await personIdOf(world.owner.user.id);
      const [role] = await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: world.workspaceId,
          key: `explicit-direct-${randomUUID().slice(0, 8)}`,
          name: "Explicit direct",
          rank: 5,
          capabilities: [],
        })
        .returning();
      if (!role) throw new Error("role");
      const [grant] = await db
        .insert(schema.membershipGrantTable)
        .values({
          personId,
          scope: "workspace",
          scopeId: world.workspaceId,
          roleId: role.id,
          sourceKind: "direct",
          directOrigin: "admin",
          grantedByPersonId: ownerPersonId,
          seesAll: false,
        })
        .returning();
      if (!grant) throw new Error("grant");
      await db.transaction((tx) =>
        projectMembershipKeys(tx, [
          { personId, scope: "workspace", scopeId: world.workspaceId },
        ]),
      );
      return grant;
    }

    it("an admin-made direct grant is never rewritten or revoked by promotion or demotion", async () => {
      const world = await newWorld();
      const member = await addMember(world, "member");
      const grant = await explicitDirectGrant(world, member);
      await setRole(world, member, "admin");
      expect(await canReadProject(world, member)).toBe(404);
      let rows = await reachRows(member.user.id, world.workspaceId);
      expect(rows.membership).toEqual([
        { seesAll: false, roleKey: expect.stringMatching(/^explicit-direct-/) },
      ]);
      expect(rows.grants).toHaveLength(1);
      await setRole(world, member, "viewer");
      rows = await reachRows(member.user.id, world.workspaceId);
      expect(rows.grants).toEqual([
        expect.objectContaining({ directOrigin: "admin", revokedAt: null }),
      ]);
      const [after] = await db
        .select()
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.id, grant.id));
      expect(after).toMatchObject({ roleId: grant.roleId, seesAll: false });
    });

    it("a custom role merely named admin (workspace_role not is_system) gets no grant", async () => {
      const world = await newWorld();
      await db
        .update(schema.workspaceRoleTable)
        .set({ isSystem: false })
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, world.workspaceId),
            eq(schema.workspaceRoleTable.role, "admin"),
          ),
        );
      const lookalike = await addMember(world, "admin");
      expect(await canReadProject(world, lookalike)).toBe(404);
      expect(
        (await reachRows(lookalike.user.id, world.workspaceId)).grants,
      ).toEqual([]);
    });

    it("a manager added and set through the real routes gains no grant", async () => {
      const world = await newWorld();
      await db.insert(schema.workspaceRoleTable).values({
        workspaceId: world.workspaceId,
        role: "manager",
        permission: "{}",
        isSystem: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const manager = await addMember(world, "manager");
      expect(await canReadProject(world, manager)).toBe(404);
      expect(
        (await reachRows(manager.user.id, world.workspaceId)).grants,
      ).toEqual([]);
      const other = await addMember(world, "member");
      await setRole(world, other, "manager");
      expect(
        (await reachRows(other.user.id, world.workspaceId)).grants,
      ).toEqual([]);
    });

    it("carrier role rows are system, not editable, and carry no capabilities", async () => {
      const world = await newWorld();
      await addMember(world, "admin");
      const roles = await db
        .select({
          key: schema.roleTable.key,
          isSystem: schema.roleTable.isSystem,
          isEditable: schema.roleTable.isEditable,
          capabilities: schema.roleTable.capabilities,
        })
        .from(schema.roleTable)
        .where(eq(schema.roleTable.workspaceId, world.workspaceId));
      expect(roles.map((r) => r.key).sort()).toEqual(["admin", "owner"]);
      for (const role of roles) {
        expect(role).toMatchObject({
          isSystem: true,
          isEditable: false,
          capabilities: [],
        });
      }
    });

    it("a customer-side person promoted to admin gets no grant", async () => {
      const world = await newWorld();
      const member = await addMember(world, "member");
      await db
        .update(schema.personTable)
        .set({ side: "customer" })
        .where(eq(schema.personTable.userId, member.user.id));
      await setRole(world, member, "admin");
      expect(
        (await reachRows(member.user.id, world.workspaceId)).grants,
      ).toEqual([]);
    });

    it("revocation through remove and leave only touches system_backfill grants; an admin-made direct grant stays active", async () => {
      const world = await newWorld();
      const removed = await addMember(world, "viewer");
      const leaver = await addMember(world, "viewer");
      const removedGrant = await explicitDirectGrant(world, removed);
      const leaverGrant = await explicitDirectGrant(world, leaver);
      await setRole(world, removed, "admin");
      await setRole(world, leaver, "admin");
      // The sync never created ours for them (an admin-made direct grant already exists).
      expect(
        (await reachRows(removed.user.id, world.workspaceId)).grants,
      ).toHaveLength(1);
      expect(
        (
          await call(
            world.app,
            world.owner.cookie,
            "DELETE",
            `/api/workspace/${world.workspaceId}/members/${removed.user.id}`,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await call(
            world.app,
            leaver.cookie,
            "POST",
            `/api/workspace/${world.workspaceId}/leave`,
          )
        ).status,
      ).toBe(200);
      for (const grant of [removedGrant, leaverGrant]) {
        const [row] = await db
          .select({
            revokedAt: schema.membershipGrantTable.revokedAt,
            directOrigin: schema.membershipGrantTable.directOrigin,
          })
          .from(schema.membershipGrantTable)
          .where(eq(schema.membershipGrantTable.id, grant.id));
        expect(row).toEqual({ revokedAt: null, directOrigin: "admin" });
      }
    });

    it("boot reconciliation grants an admin whose staff person is created after they joined", async () => {
      const world = await newWorld();
      const userId = `late-person-${randomUUID()}`;
      await db.insert(schema.userTable).values({
        id: userId,
        name: "Late",
        email: `${userId}@example.com`,
        emailVerified: true,
      });
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: world.workspaceId,
        userId,
        role: "admin",
        joinedAt: new Date(),
      });
      await reconcileWorkspaceAdminReach();
      const none = await db
        .select({ id: schema.membershipTable.id })
        .from(schema.membershipTable)
        .where(eq(schema.membershipTable.scopeId, world.workspaceId));
      expect(none).toHaveLength(1); // only the owner
      await ensureStaffPersonForUser(userId);
      await reconcileWorkspaceAdminReach();
      expect((await reachRows(userId, world.workspaceId)).membership).toEqual([
        { seesAll: true, roleKey: "admin" },
      ]);
      // idempotent
      expect(await reconcileWorkspaceAdminReach()).toBe(0);
    });

    it("boot reconciliation grants an admin whose is_system row is healed by the default-role seed", async () => {
      const world = await newWorld();
      await db
        .update(schema.workspaceRoleTable)
        .set({ isSystem: false })
        .where(
          and(
            eq(schema.workspaceRoleTable.workspaceId, world.workspaceId),
            eq(schema.workspaceRoleTable.role, "admin"),
          ),
        );
      const admin = await addMember(world, "admin");
      expect(await canReadProject(world, admin)).toBe(404);
      await seedDefaultWorkspaceRoles();
      await reconcileWorkspaceAdminReach();
      expect(await canReadProject(world, admin)).toBe(200);
    });
  });
});
