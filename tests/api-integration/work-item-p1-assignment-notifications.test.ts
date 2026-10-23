/**
 * UNRUN: written without a database (the P1 implementer may not touch one); the
 * coordinator runs this suite. P1 work package: AS-16/17/18 (+ AS-3 previous holder)
 * assignment notification fan-out, WI-28/29 watcher fan-out and implicit watcher, AS-8 and
 * RH-17 response facts, WI-26 bulk transition with one illegal edge, CA-4 comment
 * visibility immutability.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectAccessForWorkspaceRole,
  grantWorkItemProjectAccess,
  prepareAuthenticatedApiFixture,
  requireRow,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

async function makeType(workspaceId: string, workflowId: string | null = null) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        workflowId,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeType",
  );
}

async function makeState(
  workspaceId: string,
  projectId: string,
  options: { group: string; isDefault?: boolean },
) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: options.group,
        group: options.group,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState: template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: options.isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeState: state",
  );
  return { stateTemplate, state };
}

async function makeWorkflow(
  workspaceId: string,
  transitions: {
    fromStateTemplateId: string | null;
    toStateTemplateId: string;
  }[],
) {
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({ workspaceId, key: `wf-${randomUUID()}`, name: "Workflow" })
      .returning(),
    "makeWorkflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "makeWorkflow: version",
  );
  await db.insert(schema.workflowTransitionTable).values(
    transitions.map((t) => ({
      versionId: version.id,
      guards: [],
      effects: [],
      roleId: null,
      ...t,
    })),
  );
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  return workflow;
}

async function addMember(workspaceId: string, role: string) {
  const userId = `user-${randomUUID()}`;
  const user = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name: "Integration Test User",
      })
      .returning(),
    "addMember: user",
  );
  await prepareAuthenticatedApiFixture(user.id);
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  if (role !== "owner") {
    const now = new Date();
    // (workspace_id, role) is unique: the second member of a role reuses the first row.
    await db
      .insert(schema.workspaceRoleTable)
      .values({
        workspaceId,
        role,
        permission: JSON.stringify({}),
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
  await grantProjectAccessForWorkspaceRole(user.id, workspaceId, role);
  return user;
}

async function personOnRoster(input: { userId?: string; projectId: string }) {
  const organisation = await ensureInternalOrganisation();
  const now = new Date();
  const [existing] = input.userId
    ? await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, input.userId))
        .limit(1)
    : [];
  const person =
    existing ??
    requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: input.userId ?? null,
          organisationId: organisation.id,
          side: "staff",
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "personOnRoster: person",
    );
  const role = requireRow(
    await db
      .insert(schema.roleTable)
      .values({
        scope: "project",
        key: `role-${randomUUID()}`,
        name: "Project Member",
        rank: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "personOnRoster: role",
  );
  await db
    .insert(schema.membershipTable)
    .values({
      personId: person.id,
      scope: "project",
      scopeId: input.projectId,
      roleId: role.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  return person;
}

async function setup() {
  const { user: creator, workspace } = await createWorkspaceMember({
    role: "admin",
  });
  const { project } = await createProjectFixture({ workspaceId: workspace.id });
  await grantWorkItemProjectAccess(creator.id, project.id);
  return { creator, workspace, project };
}

async function createItem(app: App, projectId: string, typeId: string) {
  const response = await app.request(`/api/projects/${projectId}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId, title: "Item" }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as { key: string; id: string };
}

function assign(app: App, key: string, body: Record<string, unknown>) {
  return app.request(`/api/work-items/${key}/assign`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function unassign(app: App, key: string, expectedAssigneeId?: string) {
  const query = expectedAssigneeId
    ? `?expectedAssigneeId=${encodeURIComponent(expectedAssigneeId)}`
    : "";
  return app.request(`/api/work-items/${key}/assign${query}`, {
    method: "DELETE",
  });
}

async function inboxFor(userId: string, kind: string) {
  return db
    .select()
    .from(schema.notificationTable)
    .where(
      and(
        eq(schema.notificationTable.userId, userId),
        eq(schema.notificationTable.kind, kind),
      ),
    );
}

async function projectWithDefaultState() {
  const base = await setup();
  const type = await makeType(base.workspace.id);
  await makeState(base.workspace.id, base.project.id, {
    group: "backlog",
    isDefault: true,
  });
  const { ensureCreationWorkflow } = await import("./helpers/workflow");
  await ensureCreationWorkflow({
    workspaceId: base.workspace.id,
    projectId: base.project.id,
    typeId: type.id,
  });
  return { ...base, type };
}

describe("P1: assignment notifications and watchers (AS-16/17/18, AS-3, WI-28/29)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("AS-16: assigning notifies the new assignee exactly once, and the event is persisted once", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const memberUser = await addMember(workspace.id, "member");
    const member = await personOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);

    expect(
      (await assign(app, item.key, { assigneeId: member.id })).status,
    ).toBe(200);

    const rows = await inboxFor(memberUser.id, "work_item.assigned");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      personId: member.id,
      resourceType: "work_item",
      resourceId: item.id,
    });
    // `notify` replaces the bare outbox write: one outbox row per event, never two.
    const outbox = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.assigned"));
    expect(outbox).toHaveLength(1);
  });

  it("AS-18: assigning yourself does not notify you, but work_item.assigned is still emitted", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const memberUser = await addMember(workspace.id, "member");
    const member = await personOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);

    mockAuthenticatedSession(memberUser);
    expect(
      (await assign(app, item.key, { assigneeId: member.id })).status,
    ).toBe(200);

    expect(await inboxFor(memberUser.id, "work_item.assigned")).toHaveLength(0);
    const outbox = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.assigned"));
    expect(outbox).toHaveLength(1);
  });

  it("AS-3/AS-17: a reassignment tells the previous holder, and unassigning tells the holder, but not when they unassign themselves (AS-18)", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const aUser = await addMember(workspace.id, "member");
    const bUser = await addMember(workspace.id, "member");
    const a = await personOnRoster({ userId: aUser.id, projectId: project.id });
    const b = await personOnRoster({ userId: bUser.id, projectId: project.id });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);
    await assign(app, item.key, { assigneeId: a.id });

    // Reassign A -> B by the lead: B is told they got it, A is told they lost it.
    expect(
      (
        await assign(app, item.key, {
          assigneeId: b.id,
          expectedCurrentAssigneeId: a.id,
        })
      ).status,
    ).toBe(200);
    expect(await inboxFor(bUser.id, "work_item.assigned")).toHaveLength(1);
    // A was told about their own assignment first, then about losing it.
    expect(await inboxFor(aUser.id, "work_item.assigned")).toHaveLength(2);

    // The lead clears B: B is told (AS-17).
    expect((await unassign(app, item.key, b.id)).status).toBe(200);
    expect(await inboxFor(bUser.id, "work_item.unassigned")).toHaveLength(1);

    // B unassigning THEMSELVES is never notified to B (AS-18).
    await assign(app, item.key, { assigneeId: b.id });
    mockAuthenticatedSession(bUser);
    expect((await unassign(app, item.key)).status).toBe(200);
    expect(await inboxFor(bUser.id, "work_item.unassigned")).toHaveLength(1);
  });

  it("AS-16/WI-29: an initial assignee on create is notified and becomes an implicit watcher", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const memberUser = await addMember(workspace.id, "member");
    const member = await personOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const response = await app.request(
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Born assigned",
          assigneeId: member.id,
        }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const created = (await response.json()) as { id: string };

    expect(await inboxFor(memberUser.id, "work_item.assigned")).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.watcherTable)
        .where(
          and(
            eq(schema.watcherTable.workItemId, created.id),
            eq(schema.watcherTable.personId, member.id),
          ),
        ),
    ).toMatchObject([{ source: "implicit", muted: false }]);
  });

  it("WI-29: assigning creates an implicit watcher, and never un-mutes a previous opt-out", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const memberUser = await addMember(workspace.id, "member");
    const member = await personOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);
    await assign(app, item.key, { assigneeId: member.id });

    const watcher = () =>
      db
        .select()
        .from(schema.watcherTable)
        .where(
          and(
            eq(schema.watcherTable.workItemId, item.id),
            eq(schema.watcherTable.personId, member.id),
          ),
        );
    expect(await watcher()).toMatchObject([
      { source: "implicit", muted: false },
    ]);

    // The assignee opts out (implicit watcher -> muted, row kept), is unassigned and
    // assigned again: the opt-out survives.
    mockAuthenticatedSession(memberUser);
    await app.request(`/api/work-items/${item.key}/watch`, {
      method: "DELETE",
    });
    expect(await watcher()).toMatchObject([{ muted: true }]);
    mockAuthenticatedSession(creator);
    await unassign(app, item.key, member.id);
    await assign(app, item.key, { assigneeId: member.id });
    expect(await watcher()).toMatchObject([
      { source: "implicit", muted: true },
    ]);
  });

  it("WI-28: an unmuted watcher is told about an assignment change; a muted one is not", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const assigneeUser = await addMember(workspace.id, "member");
    const assignee = await personOnRoster({
      userId: assigneeUser.id,
      projectId: project.id,
    });
    const watcherUser = await addMember(workspace.id, "member");
    await personOnRoster({ userId: watcherUser.id, projectId: project.id });
    const mutedUser = await addMember(workspace.id, "member");
    await personOnRoster({ userId: mutedUser.id, projectId: project.id });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);
    for (const user of [watcherUser, mutedUser]) {
      mockAuthenticatedSession(user);
      expect(
        (
          await app.request(`/api/work-items/${item.key}/watch`, {
            method: "POST",
          })
        ).status,
      ).toBe(200);
    }
    const [mutedPerson] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, mutedUser.id));
    await db
      .update(schema.watcherTable)
      .set({ muted: true })
      .where(
        and(
          eq(schema.watcherTable.workItemId, item.id),
          eq(schema.watcherTable.personId, mutedPerson?.id ?? ""),
        ),
      );

    mockAuthenticatedSession(creator);
    await assign(app, item.key, { assigneeId: assignee.id });

    expect(await inboxFor(watcherUser.id, "work_item.assigned")).toHaveLength(
      1,
    );
    expect(await inboxFor(mutedUser.id, "work_item.assigned")).toHaveLength(0);
  });
});

describe("P1: response facts (AS-8, RH-17) and RH-13 context", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("AS-8: detail and list report assigneeActive / assigneeOnProject; the assignment is retained", async () => {
    const { creator, workspace, project, type } =
      await projectWithDefaultState();
    const memberUser = await addMember(workspace.id, "member");
    const member = await personOnRoster({
      userId: memberUser.id,
      projectId: project.id,
    });
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);
    await assign(app, item.key, { assigneeId: member.id });

    const detail = async () =>
      (await (await app.request(`/api/work-items/${item.key}`)).json()) as {
        assigneeId: string | null;
        assigneeActive: boolean | null;
        assigneeOnProject: boolean | null;
      };
    expect(await detail()).toMatchObject({
      assigneeId: member.id,
      assigneeActive: true,
      assigneeOnProject: true,
    });

    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, member.id));
    expect(await detail()).toMatchObject({
      assigneeId: member.id,
      assigneeActive: false,
      assigneeOnProject: true,
    });

    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, member.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );
    const listed = (await (
      await app.request(`/api/projects/${project.id}/work-items`)
    ).json()) as {
      data: {
        key: string;
        assigneeId: string | null;
        assigneeOnProject: boolean | null;
      }[];
    };
    expect(listed.data.find((row) => row.key === item.key)).toMatchObject({
      assigneeId: member.id,
      assigneeOnProject: false,
    });
  });

  it("RH-17: blockedByOpenCount counts open blockers only, on detail and list", async () => {
    const { creator, project, type, workspace } =
      await projectWithDefaultState();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const blocker = await createItem(app, project.id, type.id);
    const blocked = await createItem(app, project.id, type.id);
    const closed = await makeState(workspace.id, project.id, {
      group: "completed",
    });
    await db.insert(schema.workItemRelationTable).values({
      sourceId: blocker.id,
      targetId: blocked.id,
      type: "blocks",
    });

    const count = async () =>
      (
        (await (
          await app.request(`/api/work-items/${blocked.key}`)
        ).json()) as {
          blockedByOpenCount: number;
        }
      ).blockedByOpenCount;
    expect(await count()).toBe(1);
    const listed = (await (
      await app.request(`/api/projects/${project.id}/work-items`)
    ).json()) as { data: { key: string; blockedByOpenCount: number }[] };
    expect(
      listed.data.find((row) => row.key === blocked.key)?.blockedByOpenCount,
    ).toBe(1);
    expect(
      listed.data.find((row) => row.key === blocker.key)?.blockedByOpenCount,
    ).toBe(0);

    // Closing the blocker clears the badge.
    await db
      .update(schema.workItemTable)
      .set({ stateId: closed.state.id })
      .where(eq(schema.workItemTable.id, blocker.id));
    expect(await count()).toBe(0);
  });
});

describe("P1: WI-26 bulk transition with one illegal edge", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("transitions the legal item, fails the illegal one with a reason, and rolls nothing back", async () => {
    const { creator, workspace, project } = await setup();
    const backlog = await makeState(workspace.id, project.id, {
      group: "backlog",
      isDefault: true,
    });
    const started = await makeState(workspace.id, project.id, {
      group: "started",
    });
    // Only backlog -> started exists; started -> started is the illegal edge.
    const workflow = await makeWorkflow(workspace.id, [
      {
        fromStateTemplateId: backlog.stateTemplate.id,
        toStateTemplateId: started.stateTemplate.id,
      },
    ]);
    const type = await makeType(workspace.id, workflow.id);
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const legal = await createItem(app, project.id, type.id);
    const illegal = await createItem(app, project.id, type.id);
    await db
      .update(schema.workItemTable)
      .set({ stateId: started.state.id })
      .where(eq(schema.workItemTable.id, illegal.id));

    const response = await app.request("/api/work-items/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: workspace.id,
        workItemKeys: [legal.key, illegal.key],
        operation: "transition",
        toStateTemplateId: started.stateTemplate.id,
      }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as {
      succeeded: string[];
      failed: { id: string; reason: string }[];
    };
    expect(body.succeeded).toEqual([legal.key]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]?.id).toBe(illegal.key);
    expect(body.failed[0]?.reason).not.toBe("");

    const rows = await db
      .select({
        id: schema.workItemTable.id,
        stateId: schema.workItemTable.stateId,
      })
      .from(schema.workItemTable);
    expect(rows.find((row) => row.id === legal.id)?.stateId).toBe(
      started.state.id,
    );
    expect(rows.find((row) => row.id === illegal.id)?.stateId).toBe(
      started.state.id,
    );
  });
});

describe("P1: CA-4 comment visibility is immutable", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a PATCH that names a visibility edits the body only and leaves the stored visibility untouched", async () => {
    const { creator, project, type } = await projectWithDefaultState();
    mockAuthenticatedSession(creator);
    const { app } = createApp();
    const item = await createItem(app, project.id, type.id);
    const created = await app.request(`/api/work-items/${item.key}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: { type: "doc", content: [] },
        visibility: "internal",
      }),
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const comment = (await created.json()) as { id: string };

    const patched = await app.request(`/api/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        body: { type: "doc", content: [{ type: "paragraph" }] },
        visibility: "public",
      }),
    });
    // Ignored (the body schema has no visibility field) or rejected: never applied.
    expect([200, 400, 422]).toContain(patched.status);
    const [row] = await db
      .select({ visibility: schema.commentTable.visibility })
      .from(schema.commentTable)
      .where(eq(schema.commentTable.id, comment.id));
    expect(row?.visibility).toBe("internal");
  });
});
