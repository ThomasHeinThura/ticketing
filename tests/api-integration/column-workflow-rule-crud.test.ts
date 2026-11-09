/**
 * #580 batch 2: behaviour pins for the column and workflow-rule controllers once their
 * queries live in repositories -- slug/position rules, the 409 on a column that still holds
 * tasks, per-project reorder scoping, and the workflow-rule insert-vs-update upsert.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  grantProjectRole,
  WORK_ITEM_PROJECT_CAPABILITIES,
} from "./helpers/fixtures";
import {
  approvePendingDeletion,
  deleteThroughApproval,
  ensureAgentSession,
  requestDeletion,
} from "./helpers/pending-deletion";
import { addCanonicalMember, makeApiKey } from "./helpers/reach-world";

async function adminWithProject() {
  const member = await createWorkspaceMember({ role: "admin" });
  const fixture = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectManageAccess(member.user.id, fixture.project.id);
  mockAuthenticatedSession(member.user);
  // Column deletion is a pending action; approval re-validates a live session row.
  await ensureAgentSession(member.user.id);
  return { member, ...fixture };
}

function call(method: string, path: string, body?: unknown) {
  const { app } = createApp();
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("API integration: column CRUD through the repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("appends a new column after the highest position and rejects a duplicate slug with 409", async () => {
    const { project } = await adminWithProject();
    const before = await db
      .select({ position: schema.columnTable.position })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));
    const highest = Math.max(...before.map((c) => c.position));

    const created = await call("POST", `/api/column/${project.id}`, {
      name: "Blocked Work",
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      slug: "blocked-work",
      position: highest + 1,
      isFinal: false,
    });

    const duplicate = await call("POST", `/api/column/${project.id}`, {
      name: "blocked work",
    });
    expect(duplicate.status).toBe(409);
    await duplicate.text();
  });

  it("lists columns by position and applies only the supplied update fields", async () => {
    const { project, columns } = await adminWithProject();

    const list = await call("GET", `/api/column/${project.id}`);
    const rows = (await list.json()) as { position: number }[];
    expect(rows.map((r) => r.position)).toEqual(
      [...rows.map((r) => r.position)].sort((a, b) => a - b),
    );

    const updated = await call("PUT", `/api/column/${columns.todo.id}`, {
      color: "#ff0000",
    });
    expect(updated.status).toBe(200);
    const body = (await updated.json()) as { name: string; color: string };
    expect(body.color).toBe("#ff0000");
    expect(body.name).toBe(columns.todo.name);

    const missing = await call("PUT", "/api/column/does-not-exist", {
      name: "x",
    });
    expect(missing.status).toBe(404);
    await missing.text();
  });

  it("refuses to delete a column that holds tasks, deletes an empty one", async () => {
    const { member, project, columns } = await adminWithProject();
    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: "Keeps the column",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });

    const blocked = await call("DELETE", `/api/column/${columns.todo.id}`);
    expect(blocked.status).toBe(409);
    await blocked.text();
    expect(
      await db
        .select()
        .from(schema.columnTable)
        .where(eq(schema.columnTable.id, columns.todo.id)),
    ).toHaveLength(1);

    // The empty column's DELETE requests (202); it survives until the requester approves.
    const { app } = createApp();
    await deleteThroughApproval(
      app,
      member.user,
      `/api/column/${columns.done.id}`,
      {
        afterRequest: async () => {
          expect(
            await db
              .select()
              .from(schema.columnTable)
              .where(eq(schema.columnTable.id, columns.done.id)),
          ).toHaveLength(1);
        },
      },
    );
    expect(
      await db
        .select()
        .from(schema.columnTable)
        .where(eq(schema.columnTable.id, columns.done.id)),
    ).toHaveLength(0);
  });

  it("reorders within the project and answers 400 for a column of another project", async () => {
    const { member, project, columns } = await adminWithProject();
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const reordered = await call("PUT", `/api/column/reorder/${project.id}`, {
      columns: [
        { id: columns.todo.id, position: 10 },
        { id: columns.done.id, position: 0 },
      ],
    });
    expect(reordered.status).toBe(200);
    const body = (await reordered.json()) as { id: string; position: number }[];
    expect(body[0]?.id).toBe(columns.done.id);
    expect(body.find((c) => c.id === columns.todo.id)?.position).toBe(10);

    const foreign = await call("PUT", `/api/column/reorder/${project.id}`, {
      columns: [{ id: other.columns.todo.id, position: 99 }],
    });
    expect(foreign.status).toBe(400);
    await foreign.text();
    const [untouched] = await db
      .select({ position: schema.columnTable.position })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.id, other.columns.todo.id));
    expect(untouched?.position).not.toBe(99);
  });

  it("rolls back earlier reorder writes when a later scoped update returns no row", async () => {
    const { member, project, columns } = await adminWithProject();
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const original = await db
      .select({
        id: schema.columnTable.id,
        position: schema.columnTable.position,
      })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));

    const response = await call("PUT", `/api/column/reorder/${project.id}`, {
      columns: [
        { id: columns.todo.id, position: 99 },
        { id: other.columns.todo.id, position: 100 },
      ],
    });
    expect(response.status).toBe(400);
    await response.text();
    const after = await db
      .select({
        id: schema.columnTable.id,
        position: schema.columnTable.position,
      })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));
    expect(after).toEqual(original);
  });
});

describe("API integration: workflow-rule CRUD through the repository", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("upsert inserts once, then updates the same rule's column; list joins the column", async () => {
    const { project, columns } = await adminWithProject();
    const rule = { integrationType: "github", eventType: "pr_merged" };

    const first = await call("PUT", `/api/workflow-rule/${project.id}`, {
      ...rule,
      columnId: columns.todo.id,
    });
    expect(first.status).toBe(200);
    const created = (await first.json()) as { id: string; columnId: string };

    const second = await call("PUT", `/api/workflow-rule/${project.id}`, {
      ...rule,
      columnId: columns.done.id,
    });
    expect(second.status).toBe(200);
    const updated = (await second.json()) as { id: string; columnId: string };
    expect(updated.id).toBe(created.id);
    expect(updated.columnId).toBe(columns.done.id);

    const list = await call("GET", `/api/workflow-rule/${project.id}`);
    const rules = (await list.json()) as {
      id: string;
      columnName: string;
      columnSlug: string;
    }[];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: created.id,
      columnName: columns.done.name,
      columnSlug: columns.done.slug,
    });
  });

  it("rejects a column from another project with 400 and deletes by id", async () => {
    const { member, project, columns } = await adminWithProject();
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const wrong = await call("PUT", `/api/workflow-rule/${project.id}`, {
      integrationType: "github",
      eventType: "pr_opened",
      columnId: other.columns.todo.id,
    });
    expect(wrong.status).toBe(400);
    await wrong.text();
    expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(0);

    const ok = await call("PUT", `/api/workflow-rule/${project.id}`, {
      integrationType: "github",
      eventType: "pr_opened",
      columnId: columns.todo.id,
    });
    const { id } = (await ok.json()) as { id: string };

    const removed = await call("DELETE", `/api/workflow-rule/${id}`);
    expect(removed.status).toBe(200);
    await removed.text();
    expect(await db.select().from(schema.workflowRuleTable)).toHaveLength(0);

    const gone = await call("DELETE", `/api/workflow-rule/${id}`);
    expect(gone.status).toBe(404);
    await gone.text();
  });
});

// A8-2 (D2): archive, unarchive and restore need `project:archive`; board columns and workflow
// rules need `project:manage_settings`. A lead holds `project:update` only, so the broader check
// that used to guard these routes let a lead archive a project or reshape its board.
describe("API integration: archive, column and workflow-rule authority (A8-2)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ARCHIVED_AT = new Date("2026-11-01T00:00:00.000Z");

  async function world() {
    const owner = await createWorkspaceMember({ role: "admin" });
    const fixture = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const lead = await addCanonicalMember(owner.workspace.id, "lead");
    await grantProjectRole(lead.user.id, fixture.project.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
      "project:update",
    ]);
    const manager = await addCanonicalMember(owner.workspace.id, "manager");
    await grantProjectRole(manager.user.id, fixture.project.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
      "project:update",
      "project:archive",
      "project:manage_settings",
    ]);
    await ensureAgentSession(lead.user.id);
    await ensureAgentSession(manager.user.id);
    const [rule] = await db
      .insert(schema.workflowRuleTable)
      .values({
        projectId: fixture.project.id,
        integrationType: "github",
        eventType: "pr_opened",
        columnId: fixture.columns.todo.id,
      })
      .returning();
    if (!rule) throw new Error("world: workflow rule was not seeded");
    return { ...fixture, owner, lead, manager, rule };
  }

  async function setArchivedAt(projectId: string, archivedAt: Date | null) {
    await db
      .update(schema.projectTable)
      .set({ archivedAt })
      .where(eq(schema.projectTable.id, projectId));
  }

  async function snapshot(projectId: string) {
    const columns = await db
      .select()
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, projectId))
      .orderBy(schema.columnTable.id);
    const rules = await db
      .select()
      .from(schema.workflowRuleTable)
      .where(eq(schema.workflowRuleTable.projectId, projectId))
      .orderBy(schema.workflowRuleTable.id);
    const [project] = await db
      .select({
        archivedAt: schema.projectTable.archivedAt,
        deletedAt: schema.projectTable.deletedAt,
      })
      .from(schema.projectTable)
      .where(eq(schema.projectTable.id, projectId));
    const pendingActions = await db.select().from(schema.pendingActionTable);
    return { columns, rules, project, pendingActions };
  }

  // Every strict write a lead must be refused and a manager allowed. Column delete is the
  // request half of the pending-action flow (202 for a manager); approval is tested below.
  const writes = (
    projectId: string,
    columns: { todo: { id: string }; done: { id: string } },
    ruleId: string,
  ) => [
    {
      name: "POST /api/column/{projectId}",
      allowed: 200,
      run: () => call("POST", `/api/column/${projectId}`, { name: "Blocked" }),
    },
    {
      name: "PUT /api/column/{id}",
      allowed: 200,
      run: () =>
        call("PUT", `/api/column/${columns.todo.id}`, { color: "#ff0000" }),
    },
    {
      name: "PUT /api/column/reorder/{projectId}",
      allowed: 200,
      run: () =>
        call("PUT", `/api/column/reorder/${projectId}`, {
          columns: [
            { id: columns.todo.id, position: 10 },
            { id: columns.done.id, position: 0 },
          ],
        }),
    },
    {
      name: "DELETE /api/column/{id}",
      allowed: 202,
      run: () => call("DELETE", `/api/column/${columns.done.id}`),
    },
    {
      name: "PUT /api/workflow-rule/{projectId}",
      allowed: 200,
      run: () =>
        call("PUT", `/api/workflow-rule/${projectId}`, {
          integrationType: "github",
          eventType: "pr_merged",
          columnId: columns.todo.id,
        }),
    },
    {
      name: "DELETE /api/workflow-rule/{id}",
      allowed: 200,
      run: () => call("DELETE", `/api/workflow-rule/${ruleId}`),
    },
    {
      name: "PUT /api/project/{id}/archive",
      allowed: 200,
      run: () => call("PUT", `/api/project/${projectId}/archive`),
    },
  ];

  it("refuses a lead (project:update only) with 403 and writes nothing", async () => {
    const { project, columns, lead, rule } = await world();
    mockAuthenticatedSession(lead.user);
    const before = await snapshot(project.id);
    for (const write of writes(project.id, columns, rule.id)) {
      const response = await write.run();
      expect(response.status, `${write.name}: ${await response.text()}`).toBe(
        403,
      );
    }
    expect(await snapshot(project.id)).toEqual(before);
    expect(before.project?.archivedAt).toBeNull();
    expect(before.pendingActions).toHaveLength(0);

    // Unarchive needs an archived project to mean anything.
    await setArchivedAt(project.id, ARCHIVED_AT);
    const archived = await snapshot(project.id);
    const unarchive = await call("PUT", `/api/project/${project.id}/unarchive`);
    expect(unarchive.status, await unarchive.text()).toBe(403);
    expect(await snapshot(project.id)).toEqual(archived);
    expect(archived.project?.archivedAt?.toISOString()).toBe(
      ARCHIVED_AT.toISOString(),
    );
  });

  it("allows a manager (project:archive and project:manage_settings)", async () => {
    const { project, columns, manager, rule } = await world();
    mockAuthenticatedSession(manager.user);
    for (const write of writes(project.id, columns, rule.id)) {
      const response = await write.run();
      expect(response.status, `${write.name}: ${await response.text()}`).toBe(
        write.allowed,
      );
    }
    const after = await snapshot(project.id);
    expect(after.columns.find((c) => c.slug === "blocked")).toBeDefined();
    expect(after.columns.find((c) => c.id === columns.todo.id)).toMatchObject({
      color: "#ff0000",
      position: 10,
    });
    expect(after.columns.find((c) => c.id === columns.done.id)).toMatchObject({
      position: 0,
    });
    expect(after.rules.map((r) => r.id)).not.toContain(rule.id);
    expect(after.rules).toHaveLength(1);
    expect(after.project?.archivedAt).not.toBeNull();
    expect(after.pendingActions).toHaveLength(1);

    const unarchived = await call(
      "PUT",
      `/api/project/${project.id}/unarchive`,
    );
    expect(unarchived.status, await unarchived.text()).toBe(200);
    expect((await snapshot(project.id)).project?.archivedAt).toBeNull();
  });

  it("lets a manager delete a column through approval; a lead cannot request it", async () => {
    const { project, columns, lead, manager } = await world();
    const { app } = createApp();

    mockAuthenticatedSession(lead.user);
    const refused = await app.request(`/api/column/${columns.done.id}`, {
      method: "DELETE",
    });
    expect(refused.status, await refused.text()).toBe(403);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);

    mockAuthenticatedSession(manager.user);
    await deleteThroughApproval(
      app,
      manager.user,
      `/api/column/${columns.done.id}`,
    );
    const remaining = await db
      .select({ id: schema.columnTable.id })
      .from(schema.columnTable)
      .where(eq(schema.columnTable.projectId, project.id));
    expect(remaining.map((c) => c.id)).not.toContain(columns.done.id);
  });

  it("refuses approval after the requester's project role drops project:manage_settings", async () => {
    const { project, columns, manager } = await world();
    mockAuthenticatedSession(manager.user);
    const { app } = createApp();
    const pending = await requestDeletion(
      app,
      `/api/column/${columns.done.id}`,
    );

    // Strip the strict capability from the manager's project role, keeping project:update.
    const [membership] = await db
      .select({ roleId: schema.membershipTable.roleId })
      .from(schema.membershipTable)
      .innerJoin(
        schema.personTable,
        eq(schema.personTable.id, schema.membershipTable.personId),
      )
      .where(
        and(
          eq(schema.personTable.userId, manager.user.id),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );
    if (!membership) throw new Error("manager project membership missing");
    const [role] = await db
      .select({ capabilities: schema.roleTable.capabilities })
      .from(schema.roleTable)
      .where(eq(schema.roleTable.id, membership.roleId));
    if (!role) throw new Error("manager project role missing");
    expect(role.capabilities).toContain("project:manage_settings");
    await db
      .update(schema.roleTable)
      .set({
        capabilities: (role.capabilities as string[]).filter(
          (capability) => capability !== "project:manage_settings",
        ),
      })
      .where(eq(schema.roleTable.id, membership.roleId));

    const approval = await approvePendingDeletion(
      app,
      manager.user.id,
      pending,
    );
    const body = await approval.text();
    // The executor answers a requester who lost the capability with the masked 404
    // (`invalidatedApprovalError(approverLostAccess = true)`), not 403.
    expect(approval.status, body).toBe(404);
    expect(
      await db.query.pendingActionTable.findFirst({
        where: eq(schema.pendingActionTable.id, pending.pendingActionId),
      }),
    ).toMatchObject({
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect(
      await db
        .select()
        .from(schema.columnTable)
        .where(eq(schema.columnTable.id, columns.done.id)),
    ).toHaveLength(1);
  });

  describe("API keys", () => {
    function keyCall(key: string) {
      const { app } = createApp();
      return (method: string, path: string, body?: unknown) =>
        app.request(path, {
          method,
          headers: { "content-type": "application/json", "x-api-key": key },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
    }

    it("refuses a manager's API key whose scope lacks the strict capability", async () => {
      const { project, columns, manager } = await world();
      mockAnonymousSession();
      const send = keyCall(
        await makeApiKey(manager.user.id, {
          project: ["read", "update"],
          workspace: ["read"],
        }),
      );
      const archive = await send("PUT", `/api/project/${project.id}/archive`);
      expect(archive.status, await archive.text()).toBe(403);
      const column = await send("POST", `/api/column/${project.id}`, {
        name: "Blocked",
      });
      expect(column.status, await column.text()).toBe(403);
      const rule = await send("PUT", `/api/workflow-rule/${project.id}`, {
        integrationType: "github",
        eventType: "pr_merged",
        columnId: columns.todo.id,
      });
      expect(rule.status, await rule.text()).toBe(403);
      expect((await snapshot(project.id)).project?.archivedAt).toBeNull();
    });

    it("lets a key scoped {project:[update, archive]} archive", async () => {
      const { project, manager } = await world();
      mockAnonymousSession();
      const send = keyCall(
        await makeApiKey(manager.user.id, {
          project: ["read", "update", "archive"],
          workspace: ["read"],
        }),
      );
      const archive = await send("PUT", `/api/project/${project.id}/archive`);
      expect(archive.status, await archive.text()).toBe(200);
      expect((await snapshot(project.id)).project?.archivedAt).not.toBeNull();
    });

    it("lets a key scoped {project:[update, manage_settings]} create a column", async () => {
      const { project, manager } = await world();
      mockAnonymousSession();
      const send = keyCall(
        await makeApiKey(manager.user.id, {
          project: ["read", "update", "manage_settings"],
          workspace: ["read"],
        }),
      );
      const column = await send("POST", `/api/column/${project.id}`, {
        name: "Blocked",
      });
      expect(column.status, await column.text()).toBe(200);
      expect(
        (await snapshot(project.id)).columns.find((c) => c.slug === "blocked"),
      ).toBeDefined();
    });

    // Documents current behaviour: the legacy `requireWorkspacePermission({ project: ["update"] })`
    // gate compares the stored key scope literally, so `archive` without `update` is refused even
    // though `project:archive` implies `project:update` in the canonical registry.
    it("refuses a key scoped {project:[archive]} without update at the legacy gate", async () => {
      const { project, manager } = await world();
      mockAnonymousSession();
      const send = keyCall(
        await makeApiKey(manager.user.id, {
          project: ["read", "archive"],
          workspace: ["read"],
        }),
      );
      const archive = await send("PUT", `/api/project/${project.id}/archive`);
      expect(archive.status).toBe(403);
      expect(await archive.text()).toContain("Insufficient API key scope");
      expect((await snapshot(project.id)).project?.archivedAt).toBeNull();
    });
  });
});
