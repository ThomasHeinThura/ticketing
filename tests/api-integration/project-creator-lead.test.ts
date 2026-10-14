/**
 * Decision log 2026-10-14, "A project's creator holds a project-lead membership"
 * (rbac.md Reach step 3, project-scope `project-lead` role; data-model.md `project.created_by`).
 *
 * Every actor goes through the REAL routes. Reach is read back through the project routes
 * themselves (404 = out of reach) and the persisted rows are asserted so each writer is pinned
 * individually (create grant, member removal, leave, account erasure, project delete,
 * workspace delete). Mutating a writer must turn exactly that writer's test red.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BUILT_IN_ROLES, defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { validateIdpMappingRole } from "../../apps/api/src/identity/repository";
import { createApp } from "../../apps/api/src/index";
import createProjectCtrl from "../../apps/api/src/project/controllers/create-project";
import {
  ensureProjectLeadRole,
  lockCreatorPerson,
  PROJECT_CREATOR_ORIGIN,
  PROJECT_LEAD_ROLE_KEY,
  revokeProjectCreatorGrantsForMember,
} from "../../apps/api/src/project/project-creator-grant";
import deleteAccountData from "../../apps/api/src/user/controllers/delete-account-data";
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
  p: string,
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
      ? await app.request(p, init)
      : await csrfRequest(app, p, init, cookie);
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

type World = { app: App; owner: Actor; workspaceId: string };

async function newWorld(): Promise<World> {
  const { app } = createApp();
  const owner = await signUpUser(app);
  const ws = await createWorkspaceNative(app, owner.cookie, { name: "Acme" });
  expect(ws.status).toBe(200);
  return { app, owner, workspaceId: ((await ws.json()) as { id: string }).id };
}

/** A workspace `manager`: no native route mints one, so the legacy row is seeded directly. */
async function addManager(world: World): Promise<Actor> {
  const actor = await signUpUser(world.app);
  // The built-in `manager` capabilities are honoured only for a genuine (`is_system`)
  // `workspace_role` row, which the default seed does not create (rbac.md).
  await db
    .insert(schema.workspaceRoleTable)
    .values({
      workspaceId: world.workspaceId,
      role: "manager",
      permission: JSON.stringify(defaultRolePayloads.admin),
      isSystem: true,
    })
    .onConflictDoNothing();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: world.workspaceId,
    userId: actor.user.id,
    role: "manager",
    joinedAt: new Date(),
  });
  return actor;
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

async function createProject(
  world: World,
  actor: Actor,
  workspaceId = world.workspaceId,
) {
  const response = await call(world.app, actor.cookie, "POST", "/api/project", {
    workspaceId,
    name: "P",
    icon: "Folder",
    slug: `p-${randomUUID().slice(0, 8)}`,
  });
  return { status: response.status, id: response.json.id as string };
}

async function projectStatus(world: World, actor: Actor, projectId: string) {
  return (
    await call(world.app, actor.cookie, "GET", `/api/project/${projectId}`)
  ).status;
}

async function creatorGrants(personId: string, projectId?: string) {
  return db
    .select({
      id: schema.membershipGrantTable.id,
      scopeId: schema.membershipGrantTable.scopeId,
      directOrigin: schema.membershipGrantTable.directOrigin,
      grantedBy: schema.membershipGrantTable.grantedByPersonId,
      revokedAt: schema.membershipGrantTable.revokedAt,
      membershipId: schema.membershipGrantTable.membershipId,
      seesAll: schema.membershipGrantTable.seesAll,
      roleKey: schema.roleTable.key,
    })
    .from(schema.membershipGrantTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.roleTable.id, schema.membershipGrantTable.roleId),
    )
    .where(
      and(
        eq(schema.membershipGrantTable.personId, personId),
        eq(schema.membershipGrantTable.scope, "project"),
        projectId === undefined
          ? undefined
          : eq(schema.membershipGrantTable.scopeId, projectId),
      ),
    );
}

async function projectMemberships(personId: string, projectId: string) {
  return db
    .select({ id: schema.membershipTable.id, roleKey: schema.roleTable.key })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.roleTable.id, schema.membershipTable.roleId),
    )
    .where(
      and(
        eq(schema.membershipTable.personId, personId),
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, projectId),
      ),
    );
}

async function auditRows(projectId: string) {
  return db
    .select({
      action: schema.auditLogTable.action,
      actorType: schema.auditLogTable.actorType,
      actorId: schema.auditLogTable.actorId,
      workspaceId: schema.auditLogTable.workspaceId,
      projectId: schema.auditLogTable.projectId,
      after: schema.auditLogTable.after,
    })
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.projectId, projectId))
    .orderBy(schema.auditLogTable.seq);
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

/** read, list, update, and work items in the project, all as `actor`. */
async function exerciseProject(
  world: World,
  actor: Actor,
  projectId: string,
  slug: string,
  /** The PUT status: project-scope capabilities do not raise the workspace-role gate. */
  expectedUpdateStatus = 200,
) {
  expect(await projectStatus(world, actor, projectId)).toBe(200);
  const list = await call(
    world.app,
    actor.cookie,
    "GET",
    `/api/project?workspaceId=${world.workspaceId}`,
  );
  expect(list.status).toBe(200);
  expect(JSON.stringify(list.json)).toContain(projectId);
  expect(
    (
      await call(world.app, actor.cookie, "PUT", `/api/project/${projectId}`, {
        name: "Renamed",
        icon: "Folder",
        slug,
        description: "d",
      })
    ).status,
  ).toBe(expectedUpdateStatus);
  const created = await call(
    world.app,
    actor.cookie,
    "POST",
    `/api/projects/${projectId}/work-items`,
    { typeId: await typeIdFor(world.workspaceId), title: "first" },
  );
  expect(created.status).toBe(200);
  const key = created.json.key as string;
  const read = await call(
    world.app,
    actor.cookie,
    "GET",
    `/api/work-items/${key}`,
  );
  expect(read.status).toBe(200);
  expect(
    (
      await call(
        world.app,
        actor.cookie,
        "PATCH",
        `/api/work-items/${key}`,
        { title: "edited" },
        { "if-match": String(read.json.version ?? 1) },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await call(
        world.app,
        actor.cookie,
        "GET",
        `/api/projects/${projectId}/work-items`,
      )
    ).status,
  ).toBe(200);
}

async function expectCreatorGrantWritten(
  world: World,
  actor: Actor,
  projectId: string,
) {
  const personId = await personIdOf(actor.user.id);
  const [project] = await db
    .select({ createdBy: schema.projectTable.createdBy })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, projectId));
  expect(project?.createdBy).toBe(personId);

  const grants = await creatorGrants(personId, projectId);
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({
    directOrigin: PROJECT_CREATOR_ORIGIN,
    grantedBy: null,
    revokedAt: null,
    seesAll: false,
    roleKey: PROJECT_LEAD_ROLE_KEY,
  });
  expect(grants[0]?.membershipId).not.toBeNull();
  const memberships = await projectMemberships(personId, projectId);
  expect(memberships).toHaveLength(1);
  expect(memberships[0]?.roleKey).toBe(PROJECT_LEAD_ROLE_KEY);
  return personId;
}

describe("a project's creator holds a project-lead membership", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a manager creates a project, then reads, lists, updates and works items in it; created_by, grant, membership and audit row are written", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const slug = `m-${randomUUID().slice(0, 8)}`;
    const response = await call(
      world.app,
      manager.cookie,
      "POST",
      "/api/project",
      { workspaceId: world.workspaceId, name: "P", icon: "Folder", slug },
    );
    expect(response.status).toBe(200);
    const projectId = response.json.id as string;

    const personId = await expectCreatorGrantWritten(world, manager, projectId);
    await exerciseProject(world, manager, projectId, slug);

    // Audit: written in the creation transaction, project-scoped, by the creator.
    const rows = await auditRows(projectId);
    const grantAudit = rows.filter(
      (row) =>
        row.action === "membership.changed" &&
        (row.after as { source?: string } | null)?.source ===
          PROJECT_CREATOR_ORIGIN,
    );
    expect(grantAudit).toHaveLength(1);
    expect(grantAudit[0]).toMatchObject({
      actorType: "person",
      actorId: personId,
      workspaceId: world.workspaceId,
      projectId,
      after: {
        source: PROJECT_CREATOR_ORIGIN,
        scope: "project",
        scopeId: projectId,
        role: PROJECT_LEAD_ROLE_KEY,
        granted: true,
      },
    });
  });

  it("a member (who may create internal projects) gets the same", async () => {
    const world = await newWorld();
    const member = await addMember(world, "member");
    const slug = `mm-${randomUUID().slice(0, 8)}`;
    const response = await call(
      world.app,
      member.cookie,
      "POST",
      "/api/project",
      { workspaceId: world.workspaceId, name: "P", icon: "Folder", slug },
    );
    expect(response.status).toBe(200);
    const projectId = response.json.id as string;
    await expectCreatorGrantWritten(world, member, projectId);
    // A member's workspace role does not hold `project:update`, and the route's capability
    // gate still reads the workspace role: the grant gives REACH (read, list, work items), not
    // a capability the workspace role lacks.
    await exerciseProject(world, member, projectId, slug, 403);
  });

  it("an owner is unaffected: created_by is set, but no project grant, membership or grant audit is written", async () => {
    const world = await newWorld();
    const project = await createProject(world, world.owner);
    expect(project.status).toBe(200);
    const ownerPerson = await personIdOf(world.owner.user.id);
    const [row] = await db
      .select({ createdBy: schema.projectTable.createdBy })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(row?.createdBy).toBe(ownerPerson);
    expect(await creatorGrants(ownerPerson)).toEqual([]);
    expect(await projectMemberships(ownerPerson, project.id)).toEqual([]);
    expect(
      (await auditRows(project.id)).filter(
        (r) => r.action === "membership.changed",
      ),
    ).toEqual([]);
    expect(await projectStatus(world, world.owner, project.id)).toBe(200);
    // An admin is likewise skipped (explicit sees_all).
    const admin = await addMember(world, "admin");
    const adminProject = await createProject(world, admin);
    expect(adminProject.status).toBe(200);
    expect(await creatorGrants(await personIdOf(admin.user.id))).toEqual([]);
    expect(await projectStatus(world, admin, adminProject.id)).toBe(200);
  });

  it("a custom role holding only project:create gets the same reach on the project it creates", async () => {
    const world = await newWorld();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: world.workspaceId,
      role: "project-starter",
      permission: JSON.stringify({ project: ["create"] }),
    });
    const actor = await signUpUser(world.app);
    const added = await call(
      world.app,
      world.owner.cookie,
      "POST",
      `/api/workspace/${world.workspaceId}/members`,
      { userId: actor.user.id, role: "project-starter" },
    );
    expect(added.status).toBe(200);
    const project = await createProject(world, actor);
    expect(project.status).toBe(200);
    await expectCreatorGrantWritten(world, actor, project.id);
    expect(await projectStatus(world, actor, project.id)).toBe(200);
  });

  it("the grant reaches only the creator: another member and another manager stay at 404", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const other = await addManager(world);
    const bystander = await addMember(world, "member");
    const project = await createProject(world, manager);
    expect(project.status).toBe(200);
    expect(await projectStatus(world, other, project.id)).toBe(404);
    expect(await projectStatus(world, bystander, project.id)).toBe(404);
    expect(await creatorGrants(await personIdOf(other.user.id))).toEqual([]);
  });

  it("no cross-workspace effect: a manager of two workspaces holds the grant only on the project they created", async () => {
    const world = await newWorld();
    const other = await newWorld();
    const manager = await addManager(world);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.workspaceId,
      userId: manager.user.id,
      role: "manager",
      joinedAt: new Date(),
    });
    const mine = await createProject(world, manager);
    const theirs = await createProject(other, other.owner);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(await projectStatus(world, manager, mine.id)).toBe(200);
    expect(await projectStatus(world, manager, theirs.id)).toBe(404);
    const personId = await personIdOf(manager.user.id);
    expect((await creatorGrants(personId)).map((g) => g.scopeId)).toEqual([
      mine.id,
    ]);
    // Removing them from the OTHER workspace leaves the grant in this one.
    expect(
      (
        await call(
          other.app,
          other.owner.cookie,
          "DELETE",
          `/api/workspace/${other.workspaceId}/members/${manager.user.id}`,
        )
      ).status,
    ).toBe(200);
    const after = await creatorGrants(personId, mine.id);
    expect(after[0]?.revokedAt).toBeNull();
    expect(await projectStatus(world, manager, mine.id)).toBe(200);
  });

  it("removing the creator from the workspace revokes their creator grants only; an admin-made direct grant on another project survives", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const mine = await createProject(world, manager);
    const adminGranted = await createProject(world, world.owner);
    const personId = await personIdOf(manager.user.id);
    const ownerPerson = await personIdOf(world.owner.user.id);

    // An explicit, admin-origin grant of the same person on another project.
    const [role] = await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        workspaceId: world.workspaceId,
        key: `viewer-${randomUUID().slice(0, 6)}`,
        name: "Project viewer",
        rank: 1,
        capabilities: ["project:read"],
      })
      .returning();
    if (!role) throw new Error("role");
    const [grant] = await db
      .insert(schema.membershipGrantTable)
      .values({
        personId,
        scope: "project",
        scopeId: adminGranted.id,
        roleId: role.id,
        sourceKind: "direct",
        directOrigin: "admin",
        grantedByPersonId: ownerPerson,
      })
      .returning();
    if (!grant) throw new Error("grant");

    const removed = await call(
      world.app,
      world.owner.cookie,
      "DELETE",
      `/api/workspace/${world.workspaceId}/members/${manager.user.id}`,
    );
    expect(removed.status).toBe(200);

    const mineRows = await creatorGrants(personId, mine.id);
    expect(mineRows).toHaveLength(1);
    expect(mineRows[0]?.revokedAt).toEqual(expect.any(Date));
    expect(mineRows[0]?.membershipId).toBeNull();
    expect(await projectMemberships(personId, mine.id)).toEqual([]);
    expect(await projectStatus(world, manager, mine.id)).not.toBe(200);

    const [survivor] = await db
      .select({ revokedAt: schema.membershipGrantTable.revokedAt })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.id, grant.id));
    expect(survivor?.revokedAt).toBeNull();

    const revokeAudit = (await auditRows(mine.id)).filter(
      (row) => (row.after as { granted?: boolean } | null)?.granted === false,
    );
    expect(revokeAudit).toHaveLength(1);
    expect(revokeAudit[0]).toMatchObject({
      action: "membership.changed",
      actorType: "system",
      actorId: null,
      after: {
        source: PROJECT_CREATOR_ORIGIN,
        role: PROJECT_LEAD_ROLE_KEY,
        reason: "workspace_membership_ended",
      },
    });
  });

  it("the member revoke is a no-op while the person is still a workspace member", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const project = await createProject(world, manager);
    const personId = await personIdOf(manager.user.id);
    const revoked = await db.transaction((tx) =>
      revokeProjectCreatorGrantsForMember(
        tx,
        world.workspaceId,
        manager.user.id,
      ),
    );
    expect(revoked).toBe(0);
    expect(
      (await creatorGrants(personId, project.id))[0]?.revokedAt,
    ).toBeNull();
    expect(await projectStatus(world, manager, project.id)).toBe(200);
  });

  it("promoting a creator to admin revokes their creator grant (audited, same transaction); other role changes keep it", async () => {
    const world = await newWorld();
    const member = await addMember(world, "member");
    const project = await createProject(world, member);
    expect(project.status).toBe(200);
    const personId = await personIdOf(member.user.id);
    const setRole = (role: string) =>
      call(
        world.app,
        world.owner.cookie,
        "PATCH",
        `/api/workspace/${world.workspaceId}/members/${member.user.id}/role`,
        { role },
      );

    // A role change that does not grant sees_all leaves the grant alone.
    expect((await setRole("viewer")).status).toBe(200);
    expect(
      (await creatorGrants(personId, project.id))[0]?.revokedAt,
    ).toBeNull();
    expect((await setRole("member")).status).toBe(200);
    expect(
      (await creatorGrants(personId, project.id))[0]?.revokedAt,
    ).toBeNull();

    expect((await setRole("admin")).status).toBe(200);
    const rows = await creatorGrants(personId, project.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).toEqual(expect.any(Date));
    expect(await projectMemberships(personId, project.id)).toEqual([]);
    // Reach now comes from sees_all alone.
    expect(await projectStatus(world, member, project.id)).toBe(200);
    const revokeAudit = (await auditRows(project.id)).filter(
      (row) =>
        (row.after as { reason?: string } | null)?.reason ===
        "workspace_sees_all_granted",
    );
    expect(revokeAudit).toHaveLength(1);
    expect(revokeAudit[0]).toMatchObject({
      action: "membership.changed",
      actorType: "system",
      after: { source: PROJECT_CREATOR_ORIGIN, granted: false },
    });
  });

  it("lockCreatorPerson returns only a staff person", async () => {
    const world = await newWorld();
    const actor = await signUpUser(world.app);
    const staff = await db.transaction((tx) =>
      lockCreatorPerson(tx, actor.user.id),
    );
    expect(staff?.id).toBe(await personIdOf(actor.user.id));
    await db
      .update(schema.personTable)
      .set({ side: "customer" })
      .where(eq(schema.personTable.userId, actor.user.id));
    expect(
      await db.transaction((tx) => lockCreatorPerson(tx, actor.user.id)),
    ).toBeNull();
  });

  it("a creator who leaves the workspace loses their grant", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const project = await createProject(world, manager);
    const personId = await personIdOf(manager.user.id);
    expect(await projectStatus(world, manager, project.id)).toBe(200);
    const left = await call(
      world.app,
      manager.cookie,
      "POST",
      `/api/workspace/${world.workspaceId}/leave`,
    );
    expect(left.status).toBe(200);
    const rows = await creatorGrants(personId, project.id);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(await projectMemberships(personId, project.id)).toEqual([]);
  });

  it("account erasure revokes the creator grant in a workspace the person only leaves", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const project = await createProject(world, manager);
    const personId = await personIdOf(manager.user.id);
    await deleteAccountData(manager.user.id);
    const rows = await creatorGrants(personId, project.id);
    // The grant is revoked (or the person row, and with it the grant, is gone entirely).
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    expect(await projectMemberships(personId, project.id)).toEqual([]);
    const [still] = await db
      .select({ createdBy: schema.projectTable.createdBy })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(still).toBeDefined();
  });

  it("deleting the project revokes its creator grant, and only that project's", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const doomed = await createProject(world, manager);
    const kept = await createProject(world, manager);
    const personId = await personIdOf(manager.user.id);
    const deleted = await call(
      world.app,
      world.owner.cookie,
      "DELETE",
      `/api/project/${doomed.id}`,
    );
    expect(deleted.status).toBe(200);
    const doomedRows = await creatorGrants(personId, doomed.id);
    expect(doomedRows).toHaveLength(1);
    expect(doomedRows[0]?.revokedAt).toEqual(expect.any(Date));
    expect(await projectMemberships(personId, doomed.id)).toEqual([]);
    const keptRows = await creatorGrants(personId, kept.id);
    expect(keptRows[0]?.revokedAt).toBeNull();
    expect(await projectMemberships(personId, kept.id)).toHaveLength(1);
    expect(
      (await auditRows(doomed.id)).filter(
        (row) =>
          (row.after as { reason?: string } | null)?.reason ===
          "project_deleted",
      ),
    ).toHaveLength(1);
  });

  it("deleting the workspace removes creator grants and memberships (#732 helper) without touching other workspaces", async () => {
    const world = await newWorld();
    const other = await newWorld();
    const manager = await addManager(world);
    const otherManager = await addManager(other);
    const mine = await createProject(world, manager);
    const theirs = await createProject(other, otherManager);
    const deleted = await deleteWorkspaceNative(
      world.app,
      world.owner.cookie,
      world.workspaceId,
    );
    expect(deleted.status).toBe(200);
    const personId = await personIdOf(manager.user.id);
    expect(await creatorGrants(personId, mine.id)).toEqual([]);
    expect(await projectMemberships(personId, mine.id)).toEqual([]);
    const roles = await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(eq(schema.roleTable.workspaceId, world.workspaceId));
    expect(roles).toEqual([]);
    // The other workspace's creator keeps theirs.
    const otherPerson = await personIdOf(otherManager.user.id);
    expect((await creatorGrants(otherPerson, theirs.id))[0]?.revokedAt).toBe(
      null,
    );
    expect(await projectStatus(other, otherManager, theirs.id)).toBe(200);
  });

  it("a creator with no staff person still creates the project (created_by NULL, no grant)", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.userId, manager.user.id));
    const created = await createProjectCtrl(
      world.workspaceId,
      "P",
      "Folder",
      `np-${randomUUID().slice(0, 8)}`,
      {
        kind: "project",
        supportLevel: null,
        serviceCalendarId: null,
        organisationId: null,
      },
      manager.user.id,
    );
    expect(created?.createdBy).toBeNull();
    expect(
      await db
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable)
        .where(eq(schema.membershipGrantTable.scopeId, created?.id ?? "")),
    ).toEqual([]);
  });

  it("created_by is set null if the creator's person row is erased (ON DELETE SET NULL)", async () => {
    const world = await newWorld();
    const manager = await addManager(world);
    const project = await createProject(world, manager);
    expect(project.status).toBe(200);
    const personId = await personIdOf(manager.user.id);
    await db
      .delete(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.personId, personId));
    await db
      .delete(schema.personTable)
      .where(eq(schema.personTable.id, personId));
    const [row] = await db
      .select({ createdBy: schema.projectTable.createdBy })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(row).toEqual({ createdBy: null });
  });
});

describe("the project-lead role row", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("carries exactly the built-in lead capabilities at project scope, is system, and is seeded at workspace creation", async () => {
    const world = await newWorld();
    const rows = await db
      .select()
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, world.workspaceId),
          eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      scope: "project",
      isSystem: true,
      rank: BUILT_IN_ROLES.lead.rank,
    });
    const capabilities = (rows[0]?.capabilities ?? []) as string[];
    expect([...capabilities].sort()).toEqual(
      [...BUILT_IN_ROLES.lead.capabilities].sort(),
    );
    // No instance-tier authority, no sees_all.
    expect(
      capabilities.some((c) => c.startsWith("instance:") || c === "sees_all"),
    ).toBe(false);
  });

  it("is idempotent: ensuring it twice yields one row and the same id", async () => {
    const world = await newWorld();
    const first = await db.transaction((tx) =>
      ensureProjectLeadRole(tx, world.workspaceId),
    );
    const second = await db.transaction((tx) =>
      ensureProjectLeadRole(tx, world.workspaceId),
    );
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    const rows = await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, world.workspaceId),
          eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("an identity provider can never target it (SCIM / OIDC / JIT mapping validator refuses a project-scope role)", async () => {
    const world = await newWorld();
    const roleId = await db.transaction((tx) =>
      ensureProjectLeadRole(tx, world.workspaceId),
    );
    if (!roleId) throw new Error("role");
    for (const scope of ["workspace", "organisation"] as const) {
      const ok = await db.transaction((tx) =>
        validateIdpMappingRole(tx, {
          portalScope: "agent",
          organisationId: null,
          maxRoleRank: 100,
          scope,
          scopeId: world.workspaceId,
          roleId,
        }),
      );
      expect(ok).toBe(false);
    }
    // Control: the same validator accepts a legitimate workspace-scope role, so the refusal
    // above is about the project-lead role and not a broken fixture.
    const [workspaceRole] = await db
      .insert(schema.roleTable)
      .values({
        scope: "workspace",
        workspaceId: world.workspaceId,
        key: "ext-reader",
        name: "Reader",
        rank: 10,
        capabilities: ["project:read"],
      })
      .returning();
    if (!workspaceRole) throw new Error("role");
    expect(
      await db.transaction((tx) =>
        validateIdpMappingRole(tx, {
          portalScope: "agent",
          organisationId: null,
          maxRoleRank: 100,
          scope: "workspace",
          scopeId: world.workspaceId,
          roleId: workspaceRole.id,
        }),
      ),
    ).toBe(true);
  });

  it("an untrusted same-keyed (non-system) row is never used: the creator gets no grant", async () => {
    const world = await newWorld();
    await db
      .update(schema.roleTable)
      .set({ isSystem: false })
      .where(
        and(
          eq(schema.roleTable.workspaceId, world.workspaceId),
          eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
        ),
      );
    const manager = await addManager(world);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const project = await createProject(world, manager);
    expect(project.status).toBe(200);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes("project-lead grant skipped"),
      ),
    ).toBe(true);
    warn.mockRestore();
    expect(await creatorGrants(await personIdOf(manager.user.id))).toEqual([]);
    expect(await projectStatus(world, manager, project.id)).toBe(404);
  });
});

describe("migration 0124", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  const sqlText = readFileSync(
    path.resolve(
      __dirname,
      "../../apps/api/drizzle/0124_project_created_by_and_creator_grant.sql",
    ),
    "utf8",
  );
  const seedStatement = sqlText
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .find((part) => part.includes('INSERT INTO "role"'));

  it("seeds the project-lead role literal from the built-in lead list", () => {
    expect(seedStatement).toBeDefined();
    const literal = /'(\[.*?\])'::jsonb/s.exec(seedStatement ?? "")?.[1];
    expect(JSON.parse(literal ?? "[]")).toEqual([
      ...BUILT_IN_ROLES.lead.capabilities,
    ]);
  });

  it("seeds one role per existing workspace, idempotently, and backfills NO membership or grant", async () => {
    const world = await newWorld();
    await db
      .delete(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, world.workspaceId),
          eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
        ),
      );
    // An existing project that predates created_by.
    const project = await createProject(world, world.owner);
    await db.execute(
      sql`UPDATE "project" SET created_by = NULL WHERE id = ${project.id}`,
    );
    const grantsBefore = await db
      .select({ id: schema.membershipGrantTable.id })
      .from(schema.membershipGrantTable);

    for (let run = 0; run < 2; run++) {
      await db.execute(sql.raw(seedStatement ?? ""));
    }
    const roles = await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(
        and(
          eq(schema.roleTable.workspaceId, world.workspaceId),
          eq(schema.roleTable.key, PROJECT_LEAD_ROLE_KEY),
        ),
      );
    expect(roles).toHaveLength(1);
    expect(
      await db
        .select({ id: schema.membershipGrantTable.id })
        .from(schema.membershipGrantTable),
    ).toHaveLength(grantsBefore.length);
    const [row] = await db
      .select({ createdBy: schema.projectTable.createdBy })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, project.id));
    expect(row?.createdBy).toBeNull();
  });
});
