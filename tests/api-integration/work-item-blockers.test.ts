import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { deleteWorkItemRelationInTransaction } from "../../apps/api/src/work-item-relation/service";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { waitForLockBlocker } from "./helpers/race-soft-delete";

async function fixture() {
  const actor = await createWorkspaceMember({ role: "member" });
  const workspaceId = actor.workspace.id;
  const { project } = await createProjectFixture({ workspaceId });
  await grantWorkItemProjectAccess(actor.user.id, project.id);
  const openTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "Ready",
        group: "unstarted",
      })
      .returning(),
    "open template",
  );
  const doneTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "Closed",
        group: "completed",
      })
      .returning(),
    "done template",
  );
  const open = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: openTemplate.id,
        isDefault: true,
      })
      .returning(),
    "open",
  );
  requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId: project.id, stateTemplateId: doneTemplate.id })
      .returning(),
    "done",
  );
  const workflow = requireRow(
    await db
      .insert(schema.workflowTable)
      .values({ workspaceId, key: randomUUID(), name: "Blocker workflow" })
      .returning(),
    "workflow",
  );
  const version = requireRow(
    await db
      .insert(schema.workflowVersionTable)
      .values({ workflowId: workflow.id, number: 1, publishedAt: new Date() })
      .returning(),
    "workflow version",
  );
  await db.insert(schema.workflowTransitionTable).values([
    {
      versionId: version.id,
      fromStateTemplateId: openTemplate.id,
      toStateTemplateId: doneTemplate.id,
      guards: [{ type: "no_open_blockers" }],
      effects: [],
    },
    {
      versionId: version.id,
      fromStateTemplateId: doneTemplate.id,
      toStateTemplateId: openTemplate.id,
      isReopen: true,
      guards: [],
      effects: [],
    },
  ]);
  await db
    .update(schema.workflowTable)
    .set({ activeVersionId: version.id })
    .where(eq(schema.workflowTable.id, workflow.id));
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "Task",
        category: "delivery",
        workflowId: workflow.id,
      })
      .returning(),
    "type",
  );
  let n = 0;
  async function item(title: string) {
    n++;
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId,
          projectId: project.id,
          typeId: type.id,
          stateId: open.id,
          title,
          number: n,
          key: `${project.slug}-${n}`,
        })
        .returning(),
      "item",
    );
  }
  const blocked = await item("Blocked work");
  const a = await item("Blocker A");
  const b = await item("Blocker B");
  mockAuthenticatedSession(actor.user);
  const { app } = createApp();
  const transition = async (key: string, to = doneTemplate.id) =>
    app.request(`/api/work-items/${key}/transition`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toStateTemplateId: to }),
    });
  const link = async (source = a) => {
    const response = await app.request(
      `/api/work-items/${source.key}/relations`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetKey: blocked.key, type: "blocks" }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { id: string };
  };
  async function recipient() {
    const user = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: user.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const role = await grantWorkItemProjectAccess(user.user.id, project.id);
    const person = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, user.user.id)),
      "recipient person",
    );
    await db
      .update(schema.workItemTable)
      .set({ assigneeId: person.id })
      .where(eq(schema.workItemTable.id, blocked.id));
    return { ...user, person, role };
  }
  const events = () =>
    db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "work_item.unblocked"));
  const remove = (id: string) =>
    db.transaction((tx) =>
      deleteWorkItemRelationInTransaction(tx, {
        relationId: id,
        key: blocked.key,
        workspaceId,
        actorId: actor.user.id,
        actorType: "person",
        authorize: async () => {},
      }),
    );
  return {
    actor,
    workspaceId,
    project,
    blocked,
    a,
    b,
    app,
    transition,
    link,
    recipient,
    events,
    remove,
    openTemplate,
    doneTemplate,
  };
}
beforeEach(resetTestDatabase);
describe("real canonical blockers and unblocked notifications", () => {
  it("offers and enforces no_open_blockers from persisted mapped state groups", async () => {
    const f = await fixture();
    await f.link();
    const offers = (await (
      await f.app.request(`/api/work-items/${f.blocked.key}/transitions`)
    ).json()) as { available: boolean; blockedBy: { reasonCode: string }[] }[];
    expect(offers[0]).toMatchObject({
      available: false,
      blockedBy: [{ reasonCode: "guard.no_open_blockers" }],
    });
    expect((await f.transition(f.blocked.key)).status).toBe(422);
    expect((await f.transition(f.a.key)).status).toBe(200);
    const ready = (await (
      await f.app.request(`/api/work-items/${f.blocked.key}/transitions`)
    ).json()) as { available: boolean }[];
    expect(ready[0]?.available).toBe(true);
    expect((await f.transition(f.blocked.key)).status).toBe(200);
    expect(await f.events()).toHaveLength(1);
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });
  it("concurrent final blockers close once and notify only the current eligible assignee", async () => {
    const f = await fixture();
    const recipient = await f.recipient();
    await f.link();
    await f.link(f.b);
    const results = await Promise.all([
      f.transition(f.a.key),
      f.transition(f.b.key),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const events = await f.events();
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]?.payload)).toContain(f.blocked.key);
    const inbox = await db.select().from(schema.notificationTable);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.userId).toBe(recipient.user.id);
    expect(inbox[0]?.body).not.toContain(f.a.key);
    expect(inbox[0]?.body).not.toContain(f.b.key);
    mockAuthenticatedSession(recipient.user);
    const response = await f.app.request("/api/notification");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(f.blocked.key);
  });
  it("reopening restores blocking and a second closure emits a fresh event without duplicate retries", async () => {
    const f = await fixture();
    await f.link();
    expect((await f.transition(f.a.key)).status).toBe(200);
    expect((await f.transition(f.a.key, f.openTemplate.id)).status).toBe(200);
    expect((await f.transition(f.blocked.key)).status).toBe(422);
    expect((await f.transition(f.a.key)).status).toBe(200);
    expect((await f.transition(f.a.key)).status).toBe(409);
    expect(await f.events()).toHaveLength(2);
  });
  it("keeps the event but creates no inbox recipient after assignee reach is revoked", async () => {
    const f = await fixture();
    const recipient = await f.recipient();
    await f.link();
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, recipient.role.id));
    expect((await f.transition(f.a.key)).status).toBe(200);
    expect(await f.events()).toHaveLength(1);
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });
  it("approved edge removal emits only when the last still-open blocker is removed", async () => {
    const f = await fixture();
    const a = await f.link();
    const b = await f.link(f.b);
    await f.remove(a.id);
    expect(await f.events()).toHaveLength(0);
    await f.remove(b.id);
    expect(await f.events()).toHaveLength(1);
  });
  it("serializes an edge creation ahead of a stale transition so the real guard still denies", async () => {
    const f = await fixture();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
      await client.query("SELECT pg_advisory_xact_lock(782019, hashtext($1))", [
        f.workspaceId,
      ]);
      const creating = f.link();
      expect(await waitForLockBlocker(client, rows[0].pid)).toBe(true);
      const closing = f.transition(f.blocked.key);
      await client.query("COMMIT");
      await creating;
      expect((await closing).status).toBe(422);
      expect(await f.events()).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
  it("serializes approved edge removal before transition and emits one unblock event", async () => {
    const f = await fixture();
    const edge = await f.link();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query("SELECT pg_backend_pid() AS pid");
      await client.query("SELECT pg_advisory_xact_lock(782019, hashtext($1))", [
        f.workspaceId,
      ]);
      const removing = f.remove(edge.id);
      expect(await waitForLockBlocker(client, rows[0].pid)).toBe(true);
      const closing = f.transition(f.blocked.key);
      await client.query("COMMIT");
      await removing;
      expect((await closing).status).toBe(200);
      expect(await f.events()).toHaveLength(1);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});

it("keeps an inaccessible blocker's identity internal while notifying the readable blocked item", async () => {
  const f = await fixture();
  const recipient = await f.recipient();
  const { project } = await createProjectFixture({
    workspaceId: f.workspaceId,
  });
  await grantWorkItemProjectAccess(f.actor.user.id, project.id);
  const open = requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId: project.id,
        stateTemplateId: f.openTemplate.id,
        isDefault: true,
      })
      .returning(),
    "hidden project open state",
  );
  await db
    .insert(schema.stateTable)
    .values({ projectId: project.id, stateTemplateId: f.doneTemplate.id });
  const hidden = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId: f.workspaceId,
        projectId: project.id,
        typeId: f.blocked.typeId,
        stateId: open.id,
        title: "RESTRICTED_BLOCKER_TITLE",
        number: 1,
        key: `${project.slug}-1`,
      })
      .returning(),
    "hidden blocker",
  );
  await f.link(hidden);
  expect((await f.transition(hidden.key)).status).toBe(200);
  const events = await f.events();
  expect(events).toHaveLength(1);
  expect(JSON.stringify(events[0]?.payload)).toContain(hidden.id);
  mockAuthenticatedSession(recipient.user);
  const inbox = await f.app.request("/api/notification");
  expect(inbox.status).toBe(200);
  const body = await inbox.text();
  expect(body).toContain(f.blocked.key);
  expect(body).not.toContain(hidden.id);
  expect(body).not.toContain(hidden.key);
  expect(body).not.toContain("RESTRICTED_BLOCKER_TITLE");
});
