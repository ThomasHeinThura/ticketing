import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { PROJECT_LABEL_ROUTE_KEYS } from "./helpers/project-reach-route-keys";
import { makeApiKey } from "./helpers/reach-world";

async function fixture(roleName = "owner") {
  const actor = await createWorkspaceMember({ role: roleName });
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  const role = await grantWorkItemProjectAccess(actor.user.id, project.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: actor.workspace.id,
        key: randomUUID(),
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: actor.workspace.id,
        key: randomUUID(),
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "state template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: template.id,
        isDefault: true,
      })
      .returning(),
    "state",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: actor.workspace.id,
        projectId: project.id,
        typeId: type.id,
        stateId: state.id,
        title: "Label test",
        number: 1,
        key: "pending",
      })
      .returning(),
    "item",
  );
  const label = requireRow(
    await db
      .insert(schema.labelTable)
      .values({
        workspaceId: actor.workspace.id,
        name: "Urgent review",
        color: "teal",
      })
      .returning(),
    "label",
  );
  mockAuthenticatedSession(actor.user);
  return { ...actor, role, project, item, label, ...createApp() };
}
function patch(
  app: ReturnType<typeof createApp>["app"],
  key: string,
  version: number,
  labelIds: string[],
) {
  return app.request(`/api/work-items/${key}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "if-match": `"${version}"` },
    body: JSON.stringify({ labelIds }),
  });
}

describe("canonical work-item labels", () => {
  beforeEach(resetTestDatabase);
  it("persists assignment, records internal activity and clears it with version protection", async () => {
    const { app, item, label } = await fixture();
    expect((await patch(app, item.key, item.version, [label.id])).status).toBe(
      200,
    );
    const list = await app.request(`/api/work-items/${item.key}/labels`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([
      {
        id: label.id,
        name: label.name,
        color: label.color,
        projectId: null,
        assigned: true,
      },
    ]);
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "label",
          visibility: "internal",
          oldValue: [],
          newValue: [label.id],
        }),
      ]),
    );
    expect((await patch(app, item.key, item.version, [])).status).toBe(409);
    expect((await patch(app, item.key, item.version + 1, [])).status).toBe(200);
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
  });
  it("rejects foreign and missing IDs atomically without changing title or version", async () => {
    const { app, item, label } = await fixture();
    const foreign = await createWorkspaceMember({ role: "owner" });
    const other = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: foreign.workspace.id,
          name: "Private",
          color: "gray",
        })
        .returning(),
      "foreign label",
    );
    for (const id of [other.id, "absent"]) {
      const response = await app.request(`/api/work-items/${item.key}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "if-match": `"${item.version}"`,
        },
        body: JSON.stringify({
          title: "must roll back",
          labelIds: [label.id, id],
        }),
      });
      expect(response.status).toBe(422);
    }
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
    expect(
      (
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, item.id))
      )[0],
    ).toMatchObject({ title: item.title, version: item.version });
  });
  it("rejects duplicates and does not record a second event for an unchanged set", async () => {
    const { app, item, label } = await fixture();
    expect(
      (await patch(app, item.key, item.version, [label.id, label.id])).status,
    ).toBe(400);
    expect((await patch(app, item.key, item.version, [label.id])).status).toBe(
      200,
    );
    expect(
      (await patch(app, item.key, item.version + 1, [label.id])).status,
    ).toBe(200);
    const rows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(rows.filter((row) => row.field === "label")).toHaveLength(1);
  });
  it("honours a project read-only override even for the workspace owner", async () => {
    const { app, item, role, label } = await fixture();
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read", "work_item:read"] })
      .where(eq(schema.roleTable.id, role.id));
    expect(
      (await app.request(`/api/work-items/${item.key}/labels`)).status,
    ).toBe(200);
    expect((await patch(app, item.key, item.version, [label.id])).status).toBe(
      403,
    );
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
  });

  it("holds API keys to their stored read/update ceiling", async () => {
    const { app, item, label, user } = await fixture();
    mockAnonymousSession();
    const readKey = await makeApiKey(user.id, { work_item: ["read"] });
    expect(
      (
        await app.request(`/api/work-items/${item.key}/labels`, {
          headers: { "x-api-key": readKey },
        })
      ).status,
    ).toBe(200);
    const write = (key: string) =>
      app.request(`/api/work-items/${item.key}`, {
        method: "PATCH",
        headers: {
          "x-api-key": key,
          "content-type": "application/json",
          "if-match": `"${item.version}"`,
        },
        body: JSON.stringify({ labelIds: [label.id] }),
      });
    expect((await write(readKey)).status).toBe(403);
    const writeKey = await makeApiKey(user.id, {
      work_item: ["read", "update"],
    });
    expect((await write(writeKey)).status).toBe(200);
  });

  it("catalogue deletion advances item versions and records removal rather than silently cascading", async () => {
    const { app, item, label } = await fixture();
    expect((await patch(app, item.key, item.version, [label.id])).status).toBe(
      200,
    );
    const deleted = await app.request(`/api/label/${label.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
    const [current] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    expect(current?.version).toBe(item.version + 2);
    const rows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(rows.filter((row) => row.field === "label")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          oldValue: [label.id],
          newValue: [],
          visibility: "internal",
        }),
      ]),
    );
    expect((await patch(app, item.key, item.version + 1, [])).status).toBe(409);
  });

  it("a concurrent catalogue delete cannot leave an unlogged assignment or orphan", async () => {
    const { app, item, label } = await fixture();
    const [write, deleted] = await Promise.all([
      patch(app, item.key, item.version, [label.id]),
      app.request(`/api/label/${label.id}`, { method: "DELETE" }),
    ]);
    expect([200, 422]).toContain(write.status);
    expect(deleted.status).toBe(200);
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
    const [current] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    const rows = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(current?.version).toBe(
      item.version + (write.status === 200 ? 2 : 0),
    );
    expect(rows.filter((row) => row.field === "label")).toHaveLength(
      write.status === 200 ? 2 : 0,
    );
  });

  it("does not expose a foreign work item or catalogue", async () => {
    const { app, item } = await fixture();
    const foreign = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(foreign.user);
    const hidden = await app.request(`/api/work-items/${item.key}/labels`);
    const missing = await app.request("/api/work-items/ABSENT-123/labels");
    expect(hidden.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
  });
});

describe("project label catalogues", () => {
  beforeEach(resetTestDatabase);

  it("keeps equal workspace/project names distinct and supports idempotent project CRUD", async () => {
    const { app, project, label: workspaceLabel } = await fixture();
    const capabilities = await app.request(
      `/api/capabilities?workspaceId=${project.workspaceId}&projectId=${project.id}`,
    );
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ manageLabels: true });
    const url = `/api/label/project/${project.id}/catalogue`;
    const create = () =>
      app.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: workspaceLabel.name, color: "teal" }),
      });
    const created = await create();
    expect(created.status).toBe(200);
    const label = await created.json();
    expect(label).toMatchObject({
      projectId: project.id,
      workspaceId: project.workspaceId,
    });
    expect(label.id).not.toBe(workspaceLabel.id);
    expect((await create()).status).toBe(200);
    expect(await (await create()).json()).toMatchObject({ id: label.id });
    const list = await app.request(url);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([label]);
    const workspace = await app.request(
      `/api/label/workspace/${project.workspaceId}`,
    );
    expect(workspace.status).toBe(200);
    expect(await workspace.json()).toEqual([
      expect.objectContaining({ id: workspaceLabel.id }),
    ]);
    const edited = await app.request(`${url}/${label.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Project-specific", color: "blue" }),
    });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({
      id: label.id,
      name: "Project-specific",
      color: "blue",
    });
    expect(
      (await app.request(`${url}/${label.id}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(await (await app.request(url)).json()).toEqual([]);
    expect(
      (
        await db
          .select()
          .from(schema.labelTable)
          .where(eq(schema.labelTable.id, workspaceLabel.id))
      )[0],
    ).toMatchObject({ name: workspaceLabel.name });
  });

  it("allows own-project plus workspace assignment and rejects another project's labels atomically", async () => {
    const { app, item, project, label } = await fixture();
    const own = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "Own",
          color: "gray",
        })
        .returning(),
      "own label",
    );
    const other = await createProjectFixture({
      workspaceId: project.workspaceId,
    });
    const foreign = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: project.workspaceId,
          projectId: other.project.id,
          name: "Private project",
          color: "blue",
        })
        .returning(),
      "other project label",
    );
    const available = await app.request(`/api/work-items/${item.key}/labels`);
    expect(available.status).toBe(200);
    expect(
      (await available.json()).map((entry: { id: string }) => entry.id).sort(),
    ).toEqual([own.id, label.id].sort());
    expect(
      (await patch(app, item.key, item.version, [label.id, own.id, foreign.id]))
        .status,
    ).toBe(422);
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
    expect(
      (await patch(app, item.key, item.version, [label.id, own.id])).status,
    ).toBe(200);
    expect(
      (
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, item.id))
      )[0]?.version,
    ).toBe(item.version + 1);
  });

  it("project deletion journals removed assignments and preserves workspace assignments", async () => {
    const { app, item, project, label } = await fixture();
    const own = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "Project",
          color: "gray",
        })
        .returning(),
      "project label",
    );
    expect(
      (await patch(app, item.key, item.version, [label.id, own.id])).status,
    ).toBe(200);
    const deleted = await app.request(
      `/api/label/project/${project.id}/catalogue/${own.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    expect(await db.select().from(schema.workItemLabelTable)).toEqual([
      expect.objectContaining({ labelId: label.id, workItemId: item.id }),
    ]);
    expect(
      (
        await db
          .select()
          .from(schema.workItemTable)
          .where(eq(schema.workItemTable.id, item.id))
      )[0]?.version,
    ).toBe(item.version + 2);
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(activity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "label",
          visibility: "internal",
          oldValue: [label.id, own.id].sort(),
          newValue: [label.id],
        }),
      ]),
    );
    expect((await patch(app, item.key, item.version + 1, [])).status).toBe(409);
  });

  it("inherited routes cannot read, mutate, copy or delete project catalogue entries", async () => {
    const { app, project, user } = await fixture();
    const own = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "Project",
          color: "gray",
        })
        .returning(),
      "project label",
    );
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Legacy",
          number: 1,
          status: "to-do",
          userId: user.id,
        })
        .returning(),
      "legacy task",
    );
    for (const [path, method, body] of [
      [`/api/label/${own.id}`, "GET", undefined],
      [`/api/label/${own.id}`, "PUT", { name: "Changed", color: "red" }],
      [`/api/label/${own.id}`, "DELETE", undefined],
      [`/api/label/${own.id}/task`, "PUT", { taskId: task.id }],
    ] as const) {
      const response = await app.request(path, {
        method,
        ...(body
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      expect(response.status).toBe(404);
    }
    expect(
      (
        await db
          .select()
          .from(schema.labelTable)
          .where(eq(schema.labelTable.id, own.id))
      )[0],
    ).toMatchObject({ projectId: project.id, name: "Project" });
  });

  it("hides a foreign project and its label exactly like missing IDs", async () => {
    const { app } = await fixture();
    const foreign = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const label = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "Hidden",
          color: "gray",
        })
        .returning(),
      "foreign label",
    );
    for (const routeKey of PROJECT_LABEL_ROUTE_KEYS) {
      const [method, template] = routeKey.split(" ");
      if (!method || !template)
        throw new Error("Invalid project-label test route");
      const path = template
        .replace("{projectId}", project.id)
        .replace("{id}", label.id);
      const absentPath = template
        .replace("{projectId}", "missing")
        .replace("{id}", label.id);
      const init = {
        method,
        ...(method === "POST" || method === "PATCH"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "Change", color: "blue" }),
            }
          : {}),
      };
      const hidden = await app.request(path, init);
      const absent = await app.request(absentPath, init);
      expect(hidden.status, routeKey).toBe(404);
      expect(absent.status, routeKey).toBe(404);
      expect(await hidden.text(), routeKey).toBe(await absent.text());
    }
  });

  it("hides a same-workspace project without explicit project reach", async () => {
    const { app, workspace } = await fixture("member");
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    for (const routeKey of PROJECT_LABEL_ROUTE_KEYS) {
      const [method, template] = routeKey.split(" ");
      if (!method || !template) throw new Error("Invalid route");
      const path = template
        .replace("{projectId}", project.id)
        .replace("{id}", "hidden-label");
      const init = {
        method,
        ...(method === "POST" || method === "PATCH"
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ name: "Hidden", color: "teal" }),
            }
          : {}),
      };
      const denied = await app.request(path, init);
      const absent = await app.request(
        path.replace(project.id, "missing"),
        init,
      );
      expect(denied.status, routeKey).toBe(404);
      expect(absent.status, routeKey).toBe(404);
      expect(await denied.text(), routeKey).toBe(await absent.text());
    }
  });

  it("serializes project catalogue deletion against a concurrent assignment", async () => {
    const { app, item, project } = await fixture();
    const label = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "Concurrent",
          color: "teal",
        })
        .returning(),
      "project label",
    );
    const [write, deleted] = await Promise.all([
      patch(app, item.key, item.version, [label.id]),
      app.request(`/api/label/project/${project.id}/catalogue/${label.id}`, {
        method: "DELETE",
      }),
    ]);
    expect([200, 422]).toContain(write.status);
    expect(deleted.status).toBe(200);
    expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
    const [current] = await db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.id, item.id));
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(eq(schema.activityTable.workItemId, item.id));
    expect(current?.version).toBe(
      item.version + (write.status === 200 ? 2 : 0),
    );
    expect(activity.filter((row) => row.field === "label")).toHaveLength(
      write.status === 200 ? 2 : 0,
    );
  });

  it("rejects a conflicting rename without changing the original catalogue entry", async () => {
    const { app, project } = await fixture();
    const rows = await db
      .insert(schema.labelTable)
      .values([
        {
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "First",
          color: "teal",
        },
        {
          workspaceId: project.workspaceId,
          projectId: project.id,
          name: "Second",
          color: "blue",
        },
      ])
      .returning();
    const first = requireRow(rows, "first label");
    const response = await app.request(
      `/api/label/project/${project.id}/catalogue/${first.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Second", color: "blue" }),
      },
    );
    expect(response.status).toBe(409);
    const [persisted] = await db
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.id, first.id));
    expect(persisted).toMatchObject({ name: "First", color: "teal" });
  });

  it("legacy bulk labels reject hidden project catalogue IDs without copying or removing by name", async () => {
    const {
      app,
      workspace,
      project,
      user,
      label: workspaceLabel,
    } = await fixture();
    await grantProjectRole(user.id, project.id, ["label:manage"]);
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Reachable legacy task",
          status: "to-do",
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning(),
      "legacy task",
    );
    const { project: hiddenProject } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const hiddenLabel = requireRow(
      await db
        .insert(schema.labelTable)
        .values({
          workspaceId: workspace.id,
          projectId: hiddenProject.id,
          name: workspaceLabel.name,
          color: "pink",
        })
        .returning(),
      "hidden project label",
    );
    expect(
      (await app.request(`/api/label/project/${hiddenProject.id}/catalogue`))
        .status,
    ).toBe(404);
    const bulk = (operation: "addLabel" | "removeLabel", value: string) =>
      app.request("/api/task/bulk", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskIds: [task.id], operation, value }),
      });
    const allowed = await bulk("addLabel", workspaceLabel.id);
    expect(allowed.status).toBe(200);
    const before = await db
      .select()
      .from(schema.labelTable)
      .where(eq(schema.labelTable.taskId, task.id));
    expect(before).toEqual([
      expect.objectContaining({
        name: workspaceLabel.name,
        color: workspaceLabel.color,
        projectId: null,
      }),
    ]);
    for (const operation of ["addLabel", "removeLabel"] as const) {
      const denied = await bulk(operation, hiddenLabel.id);
      const absent = await bulk(operation, "missing-project-label");
      expect(denied.status, operation).toBe(200);
      expect(absent.status, operation).toBe(200);
      const deniedBody = await denied.json();
      expect(deniedBody).toMatchObject({
        updatedCount: 0,
        results: [
          { taskId: task.id, success: false, error: "Label not found" },
        ],
      });
      expect(deniedBody, operation).toEqual(await absent.json());
      expect(
        await db
          .select()
          .from(schema.labelTable)
          .where(eq(schema.labelTable.taskId, task.id)),
      ).toEqual(before);
    }
  });

  it("scopes API-key catalogue writes and rejects a read-only key", async () => {
    const { app, project, user } = await fixture();
    const key = await makeApiKey(user.id, {
      workspace: ["read"],
      label: ["manage"],
    });
    const url = `/api/label/project/${project.id}/catalogue`;
    const write = (apiKey: string) =>
      app.request(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify({ name: "Key label", color: "teal" }),
      });
    mockAnonymousSession();
    expect((await write(key)).status).toBe(200);
    const readOnly = await makeApiKey(user.id, { workspace: ["read"] });
    expect((await write(readOnly)).status).toBe(403);
  });
});

describe("project catalogue capability parity", () => {
  beforeEach(resetTestDatabase);
  it("keeps a member's legacy label create grant from becoming label:manage", async () => {
    const { app, project } = await fixture("member");
    const capabilities = await app.request(
      `/api/capabilities?workspaceId=${project.workspaceId}&projectId=${project.id}`,
    );
    expect(capabilities.status).toBe(200);
    expect(await capabilities.json()).toMatchObject({ manageLabels: false });
    expect(
      (await app.request(`/api/label/project/${project.id}/catalogue`)).status,
    ).toBe(200);
    const write = await app.request(
      `/api/label/project/${project.id}/catalogue`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "No grant", color: "gray" }),
      },
    );
    expect(write.status).toBe(403);
  });
});
