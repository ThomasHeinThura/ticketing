/** Bulk operations retain per-item reach; deletion waits for durable typed-count approval. */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
} from "./helpers/fixtures";
import { makeApiKey } from "./helpers/reach-world";
import { ensureCreationWorkflow } from "./helpers/workflow";

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
  await prepareAuthenticatedApiFixture(user.id);

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
  await grantWorkItemProjectAccess(creator.user.id, project.id);
  const type = await makeWorkItemType(creator.workspace.id);
  const state = await makeDefaultState(creator.workspace.id, project.id);
  await ensureCreationWorkflow({
    workspaceId: creator.workspace.id,
    projectId: project.id,
    typeId: type.id,
  });
  await db.insert(schema.sessionTable).values({
    id: `session-${creator.user.id}`,
    userId: creator.user.id,
    token: randomUUID(),
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
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

  it("WI-25: bulk deletion waits for typed-count browser approval", async () => {
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
    expect(response.status).toBe(202);
    const { pendingActionId } = (await response.json()) as {
      pendingActionId: string;
    };
    const before = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(before.every((row) => row.deletedAt === null)).toBe(true);
    const approved = await app.request(
      `/api/me/pending-actions/${pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typedCount: "2" }),
      },
    );
    expect(approved.status).toBe(200);

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
      operation: "set_priority",
      priority: "high",
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
    expect(row?.priority).toBe("high");
    expect(row?.deletedAt).toBeNull();
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
    await grantWorkItemProjectAccess(foreign.user.id, foreignProject.id);
    const foreignType = await makeWorkItemType(foreign.workspace.id);
    await makeDefaultState(foreign.workspace.id, foreignProject.id);
    await ensureCreationWorkflow({
      workspaceId: foreign.workspace.id,
      projectId: foreignProject.id,
      typeId: foreignType.id,
    });
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
      operation: "set_priority",
      priority: "high",
    });
    const nonexistentAttempt = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [mine.key, nonexistentKey],
      operation: "set_priority",
      priority: "high",
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
    expect(await response.json()).toEqual({
      succeeded: [],
      failed: [{ id: a.key, reason: "Work item not found" }],
    });

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

  it("#499: bulk no-op assignment on an archived project is reported as failed", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const target = await addPersonOnRoster(project.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Already assigned",
    });
    const { key } = (await created.json()) as { key: string };

    const initial = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [key],
      operation: "assign",
      assigneeId: target.id,
    });
    expect(initial.status).toBe(200);

    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [key],
      operation: "assign",
      assigneeId: target.id,
    });
    const body = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(body.succeeded).toHaveLength(0);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.id).toBe(key);
    expect(body.failed[0]?.reason).toContain("Work item not found");

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.assigneeId).toBe(target.id);
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
      operation: "set_priority",
      priority: "high",
    });

    const summaryRows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "bulk.performed"));
    expect(summaryRows).toHaveLength(1);
  });

  it("supports bulk set_priority and archive per item with per-item and summary audit rows (WI-24..WI-27)", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const a = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Item A",
      })
    ).json()) as { key: string };
    const b = (await (
      await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Item B",
      })
    ).json()) as { key: string };

    const priorityResp = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key, b.key],
      operation: "set_priority",
      priority: "urgent",
    });
    expect(priorityResp.status).toBe(200);
    const priorityBody = (await priorityResp.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(priorityBody.succeeded).toEqual([a.key, b.key]);
    expect(priorityBody.failed).toHaveLength(0);

    const [rowAAfterPriority] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(rowAAfterPriority?.priority).toBe("urgent");

    const archiveResp = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [a.key],
      operation: "archive",
    });
    expect(archiveResp.status).toBe(200);
    const archiveBody = (await archiveResp.json()) as {
      succeeded: string[];
      failed: Array<{ id: string; reason: string }>;
    };
    expect(archiveBody.succeeded).toEqual([a.key]);

    const [rowAAfterArchive] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, a.key));
    expect(rowAAfterArchive?.archivedAt).not.toBeNull();
  });
  it("bulk label add/remove preserves unrelated links, validates target scope, and audits each success once", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Bulk labels",
    });
    expect(created.status).toBe(200);
    const item = (await created.json()) as { id: string; key: string };
    const [existing, added] = await db
      .insert(schema.labelTable)
      .values([
        {
          name: "Existing",
          color: "#123456",
          workspaceId: creator.workspace.id,
        },
        {
          name: "Added",
          color: "#654321",
          workspaceId: creator.workspace.id,
          projectId: project.id,
        },
      ])
      .returning();
    if (!existing || !added) throw new Error("Missing labels");
    await db
      .insert(schema.workItemLabelTable)
      .values({ workItemId: item.id, labelId: existing.id });
    const body = {
      workspaceId: creator.workspace.id,
      workItemKeys: [item.key, item.key],
    };
    const add = await bulkRequest(app, {
      ...body,
      operation: "add_label",
      labelId: added.id,
    });
    expect(await add.json()).toEqual({ succeeded: [item.key], failed: [] });
    const assigned = () =>
      db
        .select()
        .from(schema.workItemLabelTable)
        .where(eq(schema.workItemLabelTable.workItemId, item.id));
    expect((await assigned()).map((row) => row.labelId).sort()).toEqual(
      [existing.id, added.id].sort(),
    );
    const remove = await bulkRequest(app, {
      ...body,
      operation: "remove_label",
      labelId: added.id,
    });
    expect(await remove.json()).toEqual({ succeeded: [item.key], failed: [] });
    expect((await assigned()).map((row) => row.labelId)).toEqual([existing.id]);
    for (const operation of ["add_label", "remove_label"]) {
      const missing = await bulkRequest(app, {
        ...body,
        operation,
        labelId: "missing-label",
      });
      expect(await missing.json()).toEqual({
        succeeded: [],
        failed: [{ id: item.key, reason: "Label unavailable" }],
      });
    }
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, item.id));
    expect(
      audits.filter((row) => row.action === "work_item.updated"),
    ).toHaveLength(2);
    const summary = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "bulk.performed"));
    expect(summary).toHaveLength(4);
  });

  it("bulk due date writes real UTC values, clears them, and preserves per-item partial success", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Dated bulk item",
    });
    expect(created.status).toBe(200);
    const item = (await created.json()) as { id: string; key: string };
    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [item.key, "MISSING-1"],
      operation: "set_due_date",
      dueDate: "2026-10-29T10:30:00+06:30",
    });
    expect(await response.json()).toEqual({
      succeeded: [item.key],
      failed: [{ id: "MISSING-1", reason: "Work item not found" }],
    });
    const read = async () =>
      (
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, item.id))
      )[0];
    expect((await read())?.dueDate).toEqual(new Date("2026-10-29T04:00:00Z"));
    await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [item.key],
      operation: "set_due_date",
      dueDate: null,
    });
    expect((await read())?.dueDate).toBeNull();
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(activity.filter((row) => row.field === "due_date")).toHaveLength(2);
  });

  it("confirmed bulk reassign uses the submitted holder and does not overwrite a concurrent holder", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const previous = await addPersonOnRoster(project.id);
    const target = await addPersonOnRoster(project.id);
    const concurrent = await addPersonOnRoster(project.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const items = [] as Array<{ id: string; key: string }>;
    for (const title of ["Confirmed", "Changed meanwhile"]) {
      const created = await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title,
      });
      expect(created.status).toBe(200);
      items.push((await created.json()) as { id: string; key: string });
    }
    const [confirmed, changed] = items;
    if (!confirmed || !changed) throw new Error("Missing test items");
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: previous.id })
      .where(eq(schema.workItemTable.id, confirmed.id));
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: concurrent.id })
      .where(eq(schema.workItemTable.id, changed.id));
    const unconfirmed = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: items.map((item) => item.key),
      operation: "assign",
      assigneeId: target.id,
    });
    const unconfirmedResult = (await unconfirmed.json()) as {
      succeeded: string[];
      failed: unknown[];
    };
    expect(unconfirmedResult.succeeded).toEqual([]);
    expect(unconfirmedResult.failed).toHaveLength(2);
    const response = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: items.map((item) => item.key),
      operation: "assign",
      assigneeId: target.id,
      expectedCurrentAssigneeIds: Object.fromEntries(
        items.map((item) => [item.key, previous.id]),
      ),
    });
    const result = (await response.json()) as {
      succeeded: string[];
      failed: Array<{ id: string }>;
    };
    expect(result.succeeded).toEqual([confirmed.key]);
    expect(result.failed.map((item) => item.id)).toEqual([changed.key]);
    const rows = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
    expect(rows.find((row) => row.id === confirmed.id)?.assigneeId).toBe(
      target.id,
    );
    expect(rows.find((row) => row.id === changed.id)?.assigneeId).toBe(
      concurrent.id,
    );
  });
  it("rejects foreign, other-project and task-instance catalogue targets identically even for remove-noop", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const foreign = await createWorkspaceMember({ role: "admin" });
    const { project: otherProject } = await createProjectFixture({
      workspaceId: creator.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Legacy labelled task",
        number: 1,
        status: "to-do",
        userId: creator.user.id,
      })
      .returning();
    if (!task) throw new Error("Missing task fixture");
    const labels = await db
      .insert(schema.labelTable)
      .values([
        {
          name: "Foreign catalogue",
          color: "#123456",
          workspaceId: foreign.workspace.id,
        },
        {
          name: "Other project",
          color: "#123456",
          workspaceId: creator.workspace.id,
          projectId: otherProject.id,
        },
        {
          name: "Task copy",
          color: "#123456",
          workspaceId: creator.workspace.id,
          taskId: task.id,
        },
      ])
      .returning();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Catalogue isolation",
    });
    expect(created.status).toBe(200);
    const item = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };
    for (const operation of ["add_label", "remove_label"]) {
      for (const labelId of [
        ...labels.map((label) => label.id),
        "missing-label",
      ]) {
        const result = await bulkRequest(app, {
          workspaceId: creator.workspace.id,
          workItemKeys: [item.key],
          operation,
          labelId,
        });
        expect(await result.json()).toEqual({
          succeeded: [],
          failed: [{ id: item.key, reason: "Label unavailable" }],
        });
      }
    }
    const [after] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(after?.version).toBe(item.version);
    expect(
      await db
        .select()
        .from(schema.workItemLabelTable)
        .where(eq(schema.workItemLabelTable.workItemId, item.id)),
    ).toEqual([]);
  });

  it("concurrent bulk label additions retain both links and create no duplicate join rows", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Concurrent labels",
    });
    expect(created.status).toBe(200);
    const item = (await created.json()) as { id: string; key: string };
    const labels = await db
      .insert(schema.labelTable)
      .values([
        {
          name: "Concurrent A",
          color: "#123456",
          workspaceId: creator.workspace.id,
        },
        {
          name: "Concurrent B",
          color: "#654321",
          workspaceId: creator.workspace.id,
        },
      ])
      .returning();
    const results = await Promise.all(
      labels
        .flatMap((label) => [label, label])
        .map((label) =>
          bulkRequest(app, {
            workspaceId: creator.workspace.id,
            workItemKeys: [item.key],
            operation: "add_label",
            labelId: label.id,
          }),
        ),
    );
    for (const result of results)
      expect(await result.json()).toEqual({
        succeeded: [item.key],
        failed: [],
      });
    const links = await db
      .select()
      .from(schema.workItemLabelTable)
      .where(eq(schema.workItemLabelTable.workItemId, item.id));
    expect(links.map((link) => link.labelId).sort()).toEqual(
      labels.map((label) => label.id).sort(),
    );
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, item.id));
    expect(
      audits.filter((row) => row.action === "work_item.updated"),
    ).toHaveLength(4);
  });

  it.each(["add_label", "remove_label", "set_due_date"])(
    "refuses bulk %s without update authority",
    async (operation) => {
      const { creator, project, type } = await setupProjectWithDefaultState();
      mockAuthenticatedSession(creator.user);
      const { app } = createApp();
      const created = await createWorkItemRequest(app, project.id, {
        typeId: type.id,
        title: "Permission test",
      });
      const item = (await created.json()) as { id: string; key: string };
      const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
      mockAuthenticatedSession(viewer);
      const result = await bulkRequest(app, {
        workspaceId: creator.workspace.id,
        workItemKeys: [item.key],
        operation,
        labelId: "unavailable",
        dueDate: null,
      });
      expect(result.status).toBe(403);
      const [after] = await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, item.id));
      expect(after?.dueDate).toBeNull();
    },
  );
  it("rejects unsafe and incomplete captured-holder maps at the HTTP boundary before any write", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    const target = await addPersonOnRoster(project.id);
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Map boundary",
    });
    expect(created.status).toBe(200);
    const item = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };
    const unsafe = JSON.parse('{"__proto__":null}') as Record<string, null>;
    unsafe[item.key] = null;
    for (const map of [{}, { [item.key]: null, "OTHER-1": null }, unsafe]) {
      const result = await bulkRequest(app, {
        workspaceId: creator.workspace.id,
        workItemKeys: [item.key],
        operation: "assign",
        assigneeId: target.id,
        expectedCurrentAssigneeIds: map,
      });
      expect(result.status).toBe(400);
    }
    const [after] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(after?.assigneeId).toBeNull();
    expect(after?.version).toBe(item.version);
    const summaries = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "bulk.performed"));
    expect(summaries).toEqual([]);
  });
  it("enforces stored API-key update ceiling for new bulk field operations", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Credential ceiling",
    });
    const item = (await created.json()) as { id: string; key: string };
    const [label] = await db
      .insert(schema.labelTable)
      .values({
        workspaceId: creator.workspace.id,
        name: "API catalogue",
        color: "#123456",
      })
      .returning();
    if (!label) throw new Error("Missing label");
    const readKey = await makeApiKey(creator.user.id, { work_item: ["read"] });
    const writeKey = await makeApiKey(creator.user.id, {
      work_item: ["read", "update"],
    });
    mockAnonymousSession();
    for (const operation of ["add_label", "remove_label", "set_due_date"]) {
      const request = (key: string) =>
        app.request("/api/work-items/bulk", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key },
          body: JSON.stringify({
            workspaceId: creator.workspace.id,
            workItemKeys: [item.key],
            operation,
            labelId: label.id,
            dueDate: "2026-10-29T00:00:00Z",
          }),
        });
      expect((await request(readKey)).status).toBe(403);
      const allowed = await request(writeKey);
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toEqual({
        succeeded: [item.key],
        failed: [],
      });
    }
  });
  it("bulk add retains the canonical 100-label bound without preventing removals", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Label bound",
    });
    const item = (await created.json()) as {
      id: string;
      key: string;
      version: number;
    };
    const labels = await db
      .insert(schema.labelTable)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          workspaceId: creator.workspace.id,
          name: `Bound ${index}`,
          color: "#123456",
        })),
      )
      .returning();
    const target = labels[100];
    if (!target) throw new Error("Missing final label");
    await db
      .insert(schema.workItemLabelTable)
      .values(
        labels
          .slice(0, 100)
          .map((label) => ({ workItemId: item.id, labelId: label.id })),
      );
    const result = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [item.key],
      operation: "add_label",
      labelId: target.id,
    });
    expect(await result.json()).toEqual({
      succeeded: [],
      failed: [
        { id: item.key, reason: "A work item may have at most 100 labels" },
      ],
    });
    const [after] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(after?.version).toBe(item.version);
    const removal = await bulkRequest(app, {
      workspaceId: creator.workspace.id,
      workItemKeys: [item.key],
      operation: "remove_label",
      labelId: labels[0]?.id,
    });
    expect(await removal.json()).toEqual({ succeeded: [item.key], failed: [] });
    expect(
      await db
        .select()
        .from(schema.workItemLabelTable)
        .where(eq(schema.workItemLabelTable.workItemId, item.id)),
    ).toHaveLength(99);
  });

  it("publishes bulk holder capture, label and due-date inputs in OpenAPI", async () => {
    const { app } = createApp();
    const response = await app.request("/api/openapi");
    expect(response.status).toBe(200);
    const specification = (await response.json()) as {
      paths: Record<
        string,
        {
          post?: {
            requestBody?: {
              content: Record<
                string,
                { schema: { properties: Record<string, unknown> } }
              >;
            };
          };
        }
      >;
    };
    const properties =
      specification.paths["/work-items/bulk"]?.post?.requestBody?.content[
        "application/json"
      ]?.schema.properties;
    expect(properties).toHaveProperty("expectedCurrentAssigneeIds");
    expect(properties).toHaveProperty("labelId");
    expect(properties).toHaveProperty("dueDate");
  });
});
