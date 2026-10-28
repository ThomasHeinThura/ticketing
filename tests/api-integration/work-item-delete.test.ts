/** Durable single-item deletion: request, persisted session approval, then soft delete. */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  createPendingAction,
  decideOwnPendingAction,
  getOwnPendingAction,
} from "../../apps/api/src/pending-action/service";
import { approveWorkItemDeletion } from "../../apps/api/src/pending-action/work-item-deletion-target";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessForWorkspaceRole,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
} from "./helpers/fixtures";
import { createCustomerUser } from "./helpers/p5-invite";
import { raceProjectArchive } from "./helpers/race-soft-delete";
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
  await grantProjectAccessForWorkspaceRole(user.id, workspaceId, role);
  return user;
}

async function setupProjectWithDefaultState(
  role: "member" | "admin" | "viewer" = "admin",
) {
  const creator = await createWorkspaceMember({ role });
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
    token: randomUUID(),
    userId: creator.user.id,
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

function deleteWorkItemRequest(
  app: ReturnType<typeof createApp>["app"],
  key: string,
) {
  return app.request(`/api/work-items/${key}`, { method: "DELETE" });
}

async function approveDeletion(
  app: ReturnType<typeof createApp>["app"],
  response: Response,
) {
  expect(response.status).toBe(202);
  const { pendingActionId } = (await response.json()) as {
    pendingActionId: string;
  };
  const approved = await app.request(
    `/api/me/pending-actions/${pendingActionId}/approve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  expect(approved.status).toBe(200);
  expect(await approved.json()).toMatchObject({ state: "executed" });
}

async function pendingFixture() {
  const f = await setupProjectWithDefaultState();
  mockAuthenticatedSession(f.creator.user);
  const { app } = createApp();
  const item = (await (
    await createWorkItemRequest(app, f.project.id, {
      typeId: f.type.id,
      title: "Private deletion title",
    })
  ).json()) as { key: string; id: string };
  const [person] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, f.creator.user.id));
  if (!person) throw new Error("person missing");
  const request = {
    requesterPersonId: person.id,
    credentialType: "session" as const,
    credentialId: `session-${f.creator.user.id}`,
    origin: "web" as const,
    action: "delete" as const,
    routeKey: "DELETE /api/work-items/{key}",
    targetType: "work_item",
    targetIds: [item.key],
    actorId: f.creator.user.id,
    actorType: "person" as const,
  };
  const pending = await createPendingAction(request);
  const approval = {
    id: pending.pendingActionId,
    requesterPersonId: person.id,
    userId: f.creator.user.id,
    sessionId: request.credentialId,
    traceId: randomUUID(),
  };
  const row = async () =>
    (
      await db
        .select()
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.key, item.key))
    )[0];
  const action = async () =>
    (
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, pending.pendingActionId))
    )[0];
  return { ...f, app, item, person, request, pending, approval, row, action };
}

describe("API integration: work item delete (#23 fourth slice)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("WI-23: request leaves the row intact until persisted browser approval", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Delete me",
    });
    const { key } = (await created.json()) as { key: string };

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(202);
    expect((await app.request(`/api/work-items/${key}`)).status).toBe(200);
    const [before] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(before?.deletedAt).toBeNull();
    await approveDeletion(app, response);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row).toBeDefined();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("#499: work-item delete waits for project archive and leaves the item unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Archive race",
    });
    const { key } = (await created.json()) as { key: string };

    const race = await raceProjectArchive(
      project.id,
      async () => await deleteWorkItemRequest(app, key),
    );
    expect(race.blockedOnRowLock).toBe(true);
    if (race.operation.status === "rejected") throw race.operation.reason;
    expect(race.operation.value.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.deletedAt).toBeNull();
  });

  it("issue #276: a deleted item now 404s on a direct GET, via the shared requireWorkItemReach guard", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Gone after delete",
    });
    const { key } = (await created.json()) as { key: string };

    await approveDeletion(app, await deleteWorkItemRequest(app, key));

    const getResponse = await app.request(`/api/work-items/${key}`);
    expect(getResponse.status).toBe(404);
  });

  it("idempotency: deleting an already-deleted item is a 404, not a 200", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Delete twice",
    });
    const { key } = (await created.json()) as { key: string };

    const first = await deleteWorkItemRequest(app, key);
    await approveDeletion(app, first);

    const second = await deleteWorkItemRequest(app, key);
    expect(second.status).toBe(404);
  });

  it("404s on a nonexistent key", async () => {
    const { creator, project } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await deleteWorkItemRequest(app, `${project.slug}-999999`);
    expect(response.status).toBe(404);
  });

  it("cross-workspace 404: a key that exists but belongs to another workspace", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Not yours",
    });
    const { key } = (await created.json()) as { key: string };

    const stranger = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(stranger.user);

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(404);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.deletedAt).toBeNull();
  });

  it("permissions: a caller without work_item:delete is refused 403, and the row is unchanged", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Viewer should not delete this",
    });
    const { key } = (await created.json()) as { key: string };

    const viewer = await addWorkspaceMember(creator.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);

    const response = await deleteWorkItemRequest(app, key);
    expect(response.status).toBe(403);

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    expect(row?.deletedAt).toBeNull();
  });

  it("writes a work_item.deleted audit row", async () => {
    const { creator, project, type } = await setupProjectWithDefaultState();
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await createWorkItemRequest(app, project.id, {
      typeId: type.id,
      title: "Audited delete",
    });
    const { key } = (await created.json()) as { key: string };

    const [row] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));

    const response = await deleteWorkItemRequest(app, key);
    await approveDeletion(app, response);

    const auditRows = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, row?.id ?? ""));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("work_item.deleted");
    expect(auditRows[0]?.entityType).toBe("work_item");
  });
  it("executes concurrent approvals exactly once with one durable deletion event", async () => {
    const f = await pendingFixture();
    const results = await Promise.allSettled([
      approveWorkItemDeletion(f.approval),
      approveWorkItemDeletion(f.approval),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.row())?.deletedAt).not.toBeNull();
    expect((await f.action())?.state).toBe("executed");
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "work_item.deleted"),
            eq(schema.auditLogTable.entityId, f.item.id),
          ),
        ),
    ).toHaveLength(1);
  });
  it.each(["cancelled", "denied"] as const)(
    "%s leaves the item intact",
    async (outcome) => {
      const f = await pendingFixture();
      await decideOwnPendingAction({
        id: f.pending.pendingActionId,
        requesterPersonId: f.person.id,
        outcome,
        sessionId: f.approval.sessionId,
      });
      await expect(approveWorkItemDeletion(f.approval)).rejects.toMatchObject({
        status: 409,
      });
      expect((await f.row())?.deletedAt).toBeNull();
    },
  );
  it("expiry does not delete", async () => {
    const f = await pendingFixture();
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingActionTable.id, f.pending.pendingActionId));
    expect(await approveWorkItemDeletion(f.approval)).toMatchObject({
      state: "expired",
    });
    expect((await f.row())?.deletedAt).toBeNull();
  });
  it.each(["version", "child"])(
    "invalidates when the frozen %s changes",
    async (change) => {
      const f = await pendingFixture();
      if (change === "version")
        await db
          .update(schema.workItemTable)
          .set({ version: 2 })
          .where(eq(schema.workItemTable.id, f.item.id));
      else {
        const child = (await (
          await createWorkItemRequest(f.app, f.project.id, {
            typeId: f.type.id,
            title: "New child",
          })
        ).json()) as { id: string };
        await db
          .update(schema.workItemTable)
          .set({ parentId: f.item.id })
          .where(eq(schema.workItemTable.id, child.id));
      }
      await expect(approveWorkItemDeletion(f.approval)).rejects.toMatchObject({
        status: 409,
      });
      expect((await f.action())?.state).toBe("invalidated");
      expect((await f.row())?.deletedAt).toBeNull();
    },
  );
  it("redacts title and permanent keys after project read permission is lost", async () => {
    const f = await pendingFixture();
    const [membership] = await db
      .select()
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, f.person.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, f.project.id),
        ),
      );
    if (!membership) throw new Error("project membership missing");
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read"] })
      .where(eq(schema.roleTable.id, membership.roleId));
    const detail = await getOwnPendingAction(
      f.creator.user.id,
      f.pending.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(detail.summary).toEqual({ redacted: true, targetCount: 1 });
    expect(detail.targetIds).toEqual([]);
    expect(JSON.stringify(detail)).not.toContain(f.item.key);
    // PA-6 step 2: an approver who lost access since requesting gets 404 (indistinguishable
    // from an unreachable action) and the action is invalidated.
    await expect(approveWorkItemDeletion(f.approval)).rejects.toMatchObject({
      status: 404,
    });
    expect((await f.action())?.state).toBe("invalidated");
    expect((await f.row())?.deletedAt).toBeNull();
  });
  it("requires a current persisted agent session at approval", async () => {
    const f = await pendingFixture();
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.sessionTable.id, f.approval.sessionId));
    await expect(approveWorkItemDeletion(f.approval)).rejects.toMatchObject({
      status: 403,
    });
    expect((await f.row())?.deletedAt).toBeNull();
  });
  it("retains original API-key authority at browser approval", async () => {
    const f = await pendingFixture();
    await decideOwnPendingAction({
      id: f.pending.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.approval.sessionId,
    });
    const id = randomUUID();
    await db.insert(schema.apikeyTable).values({
      id,
      userId: f.creator.user.id,
      referenceId: f.creator.user.id,
      key: randomUUID(),
      enabled: true,
      permissions: JSON.stringify({ work_item: ["delete"] }),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const pending = await createPendingAction({
      ...f.request,
      origin: "api",
      credentialType: "api_key",
      credentialId: id,
      actorType: "api_key",
    });
    // Canonical delete implies read; do not invent a stricter API-key permission model.
    expect(pending.summary).toMatchObject({ key: f.item.key });
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, id));
    await expect(
      approveWorkItemDeletion({ ...f.approval, id: pending.pendingActionId }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.row())?.deletedAt).toBeNull();
  });
  it("summarizes the customer requester separately from the deleting actor and portal effect", async () => {
    const f = await pendingFixture();
    await decideOwnPendingAction({
      id: f.pending.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.approval.sessionId,
    });
    const customer = await createCustomerUser({
      organisationId: f.creator.workspace.organisationId,
      person: true,
    });
    if (!customer.personId)
      throw new Error("customer requester person missing");
    await db
      .update(schema.workItemTable)
      .set({
        requesterId: customer.personId,
        customerVisibility: "organisation",
      })
      .where(eq(schema.workItemTable.key, f.item.key));

    const pending = await createPendingAction(f.request);
    expect(pending.summary).toMatchObject({
      key: f.item.key,
      customerRequesterName: customer.user.name,
      requestedByName: f.creator.user.name,
      customerVisibility: "organisation",
      portalRemoval: "removed_on_approval",
      recoveryDays: 30,
    });
  });
  it("preserves children and relation rows through the soft-delete restore window", async () => {
    const f = await pendingFixture();
    await decideOwnPendingAction({
      id: f.pending.pendingActionId,
      requesterPersonId: f.person.id,
      outcome: "cancelled",
      sessionId: f.approval.sessionId,
    });
    const child = (await (
      await createWorkItemRequest(f.app, f.project.id, {
        typeId: f.type.id,
        title: "Surviving child",
      })
    ).json()) as { id: string; key: string };
    await db
      .update(schema.workItemTable)
      .set({ parentId: f.item.id })
      .where(eq(schema.workItemTable.id, child.id));
    const [relation] = await db
      .insert(schema.workItemRelationTable)
      .values({ sourceId: f.item.id, targetId: child.id, type: "relates" })
      .returning();
    const requested = await createPendingAction(f.request);
    expect(requested.summary).toMatchObject({ childrenAffected: 1 });
    await approveWorkItemDeletion({
      ...f.approval,
      id: requested.pendingActionId,
    });
    const [savedChild] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, child.id));
    expect(savedChild).toMatchObject({ parentId: f.item.id, deletedAt: null });
    expect(
      await db
        .select()
        .from(schema.workItemRelationTable)
        .where(eq(schema.workItemRelationTable.id, relation?.id ?? "")),
    ).toHaveLength(1);
    const hidden = await f.app.request(
      `/api/work-items/${child.key}/relations`,
    );
    expect(await hidden.json()).toMatchObject({ data: [], hiddenCount: 0 });
    // Restoration itself has no public route in this slice; retained rows recover their links.
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: null })
      .where(eq(schema.workItemTable.id, f.item.id));
    const restored = await f.app.request(
      `/api/work-items/${child.key}/relations`,
    );
    expect(((await restored.json()) as { data: unknown[] }).data).toHaveLength(
      1,
    );
  });
  it("denies anonymous approval and pending-action reads", async () => {
    const f = await pendingFixture();
    mockAnonymousSession();
    expect(
      (
        await f.app.request(
          `/api/me/pending-actions/${f.pending.pendingActionId}`,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await f.app.request(
          `/api/me/pending-actions/${f.pending.pendingActionId}/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          },
        )
      ).status,
    ).toBe(401);
    expect((await f.row())?.deletedAt).toBeNull();
  });
  it("keeps an executed summary visible through soft deletion while rechecking current project read", async () => {
    const f = await pendingFixture();
    await approveWorkItemDeletion(f.approval);
    const detail = await getOwnPendingAction(
      f.creator.user.id,
      f.pending.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(detail.summary).toMatchObject({
      key: f.item.key,
      title: "Private deletion title",
    });
    expect(detail.targetIds).toEqual([f.item.key]);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, f.project.id));
    const hidden = await getOwnPendingAction(
      f.creator.user.id,
      f.pending.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(hidden.summary).toEqual({ redacted: true, targetCount: 1 });
    expect(hidden.targetIds).toEqual([]);
  });
});
