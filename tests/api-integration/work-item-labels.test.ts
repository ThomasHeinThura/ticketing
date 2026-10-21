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
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { makeApiKey } from "./helpers/reach-world";

async function fixture() {
  const actor = await createWorkspaceMember({ role: "owner" });
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
      { id: label.id, name: label.name, color: label.color, assigned: true },
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
