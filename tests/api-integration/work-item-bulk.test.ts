/**
 * `POST /api/work-items/bulk` (`docs/03-features/work-items.md` `WI-24`-`WI-27`) --
 * #23's fourth slice. See `bulk-work-items.ts`'s own doc comment for why only `delete`
 * and `assign` are implemented (the rest of `WI-24`'s operations have no underlying
 * single-item mechanism anywhere in this codebase yet).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId,
      key: `type-${randomUUID()}`,
      name: "Task",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type) throw new Error("makeWorkItemType: insert returned no row");
  return type;
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const [stateTemplate] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId,
      key: `state-${randomUUID()}`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!stateTemplate) throw new Error("makeDefaultState: state_template");
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId,
      stateTemplateId: stateTemplate.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("makeDefaultState: state");
  return state;
}

async function addWorkspaceMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Integration Test User",
    })
    .returning();
  if (!user) throw new Error("addWorkspaceMember: user");
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  if (role !== "owner") {
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId,
      role,
      permission: JSON.stringify({}),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return user;
}

async function addPersonOnRoster(projectId: string) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  const [person] = await db
    .insert(schema.personTable)
    .values({
      organisationId: organisation.id,
      side: "staff",
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!person) throw new Error("addPersonOnRoster: person");
  const [role] = await db
    .insert(schema.roleTable)
    .values({
      scope: "project",
      key: `role-${randomUUID()}`,
      name: "Project Member",
      rank: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!role) throw new Error("addPersonOnRoster: role");
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: projectId,
    roleId: role.id,
    createdAt: now,
    updatedAt: now,
  });
  return person;
}

async function setupProjectWithDefaultState() {
  const creator = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  return { creator, project, type, state };
}

function createWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function bulkRequest(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown>,
) {
  return app.request("/api/work-items/bulk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API integration: bulk work item operations (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-25: bulk delete succeeds for every item and soft-deletes each one", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { key: string };

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key, b.key],
      operation: "delete",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(body.succeeded.sort()).toEqual([a.key, b.key].sort());
    expect(body.failed).toHaveLength(0);

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows.every((row) => row.deletedAt !== null)).toBe(true);
  });

  it("WI-25: a partial failure reports per-item reasons without rolling back the successes", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };
    const nonexistentKey = `${project.slug}-999999`;

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key, nonexistentKey],
      operation: "delete",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(body.succeeded).toEqual([a.key]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.id).toBe(nonexistentKey);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("WI-25: 'not found' and 'out of reach' (a foreign-workspace id) report the identical reason", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const mine = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Mine",
      })
    ).json()) as { key: string };

    const foreign = await createWorkspaceMember({ role: "admin" });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const foreignType = await makeWorkItemType(foreign.workspace.id);
    await makeDefaultState(foreign.workspace.id, foreignProject.id);
    mockAuthenticatedSession(foreign.user);
    const foreignItem = (await (
      await createWorkItemRequest(app, foreignProject.id, {
        typeId: foreignType.id,
        title: "Not yours",
      })
    ).json()) as { key: string };
    mockAuthenticatedSession(creator.user);

    const nonexistentKey = `${project.slug}-999999`;

    const foreignAttempt = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [mine.key, foreignItem.key],
      operation: "delete",
    });
    const nonexistentAttempt = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [mine.key, nonexistentKey],
      operation: "delete",
    });

    const foreignBody = (await foreignAttempt.json()) as {
      failed: Array<{ id: string; reason: string }>;
    };
    const nonexistentBody = (await nonexistentAttempt.json()) as {
      failed: Array<{ id: string; reason: string }>;
    };
    expect(foreignBody.failed[0]?.reason).toBe(
      nonexistentBody.failed[0]?.reason,
    );
  });

  it("bulk assign succeeds per item", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const target = await addPersonOnRoster(project.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "B",
      })
    ).json()) as { key: string };

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key, b.key],
      operation: "assign",
      assigneeId: target.id,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(body.succeeded.sort()).toEqual([a.key, b.key].sort());

    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows.every((row) => row.assigneeId === target.id)).toBe(true);
  });

  it("assign missing assigneeId is a 400", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "assign",
    });
    expect(response.status).toBe(400);
  });

  it("permissions: a caller without work_item:delete is refused 403 for the whole batch", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "delete",
    });
    expect(response.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(row?.deletedAt).toBeNull();
  });

  it("permissions: no access to the named workspace at all is refused 403", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };

    const stranger = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(stranger.user);

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "delete",
    });
    expect(response.status).toBe(403);
  });

  it("Opus review of #433, F1: bulk delete on a soft-deleted project's item fails and leaves the row unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "delete",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(body.succeeded).toHaveLength(0);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.id).toBe(a.key);
    expect(body.failed[0]?.reason).toContain("Work item not found");

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(row?.deletedAt).toBeNull();
  });

  it("Opus review of #433, F1: bulk assign on a soft-deleted project's item fails and leaves the row unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const target = await addPersonOnRoster(project.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "assign",
      assigneeId: target.id,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(body.succeeded).toHaveLength(0);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.id).toBe(a.key);
    expect(body.failed[0]?.reason).toContain("Work item not found");

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(row?.assigneeId).toBeNull();
  });

  it("writes one bulk.performed audit summary row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "A",
      })
    ).json()) as { key: string };

    await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "delete",
    });

    const summaryRows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "bulk.performed"));
    expect(summaryRows).toHaveLength(1);
  });
});
