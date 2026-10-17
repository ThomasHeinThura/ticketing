/**
 * #580 batch 2: behaviour pins for the column and workflow-rule controllers once their
 * queries live in repositories -- slug/position rules, the 409 on a column that still holds
 * tasks, per-project reorder scoping, and the workflow-rule insert-vs-update upsert.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
} from "./helpers/fixtures";

async function adminWithProject() {
  const member = await createWorkspaceMember({ role: "admin" });
  const fixture = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  await grantProjectManageAccess(member.user.id, fixture.project.id);
  mockAuthenticatedSession(member.user);
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
    const { project, columns } = await adminWithProject();
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

    const removed = await call("DELETE", `/api/column/${columns.done.id}`);
    expect(removed.status).toBe(200);
    await removed.text();
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
