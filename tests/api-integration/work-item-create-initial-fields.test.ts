import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { createWorkItem } from "../../apps/api/src/work-item/controllers/create-work-item";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import {
  raceProjectArchive,
  waitForLockBlocker,
} from "./helpers/race-soft-delete";
import { addMember, makeApiKey } from "./helpers/reach-world";

beforeEach(resetTestDatabase);
async function fixture(
  capabilities = [
    "project:read",
    "work_item:read",
    "work_item:create",
    "work_item:update",
    "work_item:assign",
  ],
) {
  const actor = await createWorkspaceMember({ role: "member" });
  await seedWorkspaceDefaults(actor.workspace.id);
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  await seedProjectStates(project.id, actor.workspace.id);
  const role = await grantProjectRole(actor.user.id, project.id, capabilities);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id)),
    "person",
  );
  const type = requireRow(
    await db
      .select()
      .from(schema.workItemTypeTable)
      .where(
        and(
          eq(schema.workItemTypeTable.workspaceId, actor.workspace.id),
          eq(schema.workItemTypeTable.key, "task"),
        ),
      ),
    "type",
  );
  const label = requireRow(
    await db
      .insert(schema.labelTable)
      .values({
        workspaceId: actor.workspace.id,
        projectId: project.id,
        name: "Synthetic release",
        color: "teal",
      })
      .returning(),
    "label",
  );
  await db.insert(schema.sessionTable).values({
    id: `session-${actor.user.id}`,
    token: `token-${actor.user.id}`,
    userId: actor.user.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3600000),
    updatedAt: new Date(),
  });
  mockAuthenticatedSession(actor.user);
  const { app } = createApp();
  const cookie = `__Host-tdk_agent_session=token-${actor.user.id}`;
  const create = (extra: Record<string, unknown> = {}) =>
    csrfRequest(
      app,
      `/api/projects/${project.id}/work-items`,
      {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Synthetic initial fields",
          ...extra,
        }),
      },
      cookie,
    );
  const direct = (extra = {}) =>
    createWorkItem({
      projectId: project.id,
      workspaceId: actor.workspace.id,
      typeId: type.id,
      title: "Synthetic atomic request",
      actorId: actor.user.id,
      actorType: "person",
      authorization: { userId: actor.user.id },
      ...extra,
    });
  return { ...actor, project, role, person, type, label, app, create, direct };
}
async function expectNoCreate(projectId: string) {
  expect(await db.select().from(schema.workItemTable)).toHaveLength(0);
  expect(await db.select().from(schema.workItemLabelTable)).toHaveLength(0);
  expect(await db.select().from(schema.activityTable)).toHaveLength(0);
  expect(await db.select().from(schema.outboxTable)).toHaveLength(0);
  expect(
    requireRow(
      await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, projectId)),
      "project",
    ).lastTaskNumber,
  ).toBe(0);
}
describe("atomic canonical creation with initial fields", () => {
  it("commits UTC dates, real catalogue labels, eligible assignee, activity and declared events in one version", async () => {
    const f = await fixture();
    const response = await f.create({
      startDate: "2026-10-22T09:30:00.000+06:30",
      dueDate: "2026-10-23T12:00:00.000Z",
      labelIds: [f.label.id],
      assigneeId: f.person.id,
      priority: "urgent",
    });
    expect(response.status).toBe(200);
    const item = await response.json();
    expect(item).toMatchObject({
      version: 1,
      assigneeId: f.person.id,
      priority: "urgent",
      startDate: "2026-10-22T03:00:00.000Z",
      dueDate: "2026-10-23T12:00:00.000Z",
    });
    expect(await db.select().from(schema.workItemLabelTable)).toMatchObject([
      { workItemId: item.id, labelId: f.label.id },
    ]);
    const activity = await db.select().from(schema.activityTable);
    expect(activity.filter((row) => row.verb === "created")).toHaveLength(1);
    expect(activity.filter((row) => row.field === "assigneeId")).toMatchObject([
      { visibility: "internal", oldValue: null, newValue: f.person.id },
    ]);
    const outbox = await db.select().from(schema.outboxTable);
    expect(outbox.map((row) => row.kind).sort()).toEqual([
      "work_item.assigned",
      "work_item.created",
      "work_item.updated",
    ]);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "work_item.assigned")),
    ).toHaveLength(1);
  });
  it("rejects foreign and another-project labels without an item, labels, number, journal or event", async () => {
    const f = await fixture();
    const foreign = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: f.workspace.id,
    });
    for (const values of [
      { workspaceId: foreign.workspace.id },
      { workspaceId: f.workspace.id, projectId: project.id },
    ]) {
      const label = requireRow(
        await db
          .insert(schema.labelTable)
          .values({ ...values, name: randomUUID(), color: "teal" })
          .returning(),
        "invalid label",
      );
      expect(
        (await f.create({ labelIds: [label.id], assigneeId: f.person.id }))
          .status,
      ).toBe(422);
      await expectNoCreate(f.project.id);
    }
  });
  it("rejects inactive, off-roster, foreign and unknown assignees atomically", async () => {
    const f = await fixture();
    const other = await addMember(f.workspace.id, "member");
    const foreign = await createWorkspaceMember();
    const foreignPerson = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, foreign.user.id)),
      "foreign person",
    );
    for (const assigneeId of [
      other.personId,
      foreignPerson.id,
      "unknown-person",
    ]) {
      expect(
        (await f.create({ assigneeId, labelIds: [f.label.id] })).status,
      ).toBe(400);
      await expectNoCreate(f.project.id);
    }
    await grantProjectRole(other.user.id, f.project.id, ["work_item:read"]);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, other.personId));
    expect((await f.create({ assigneeId: other.personId })).status).toBe(400);
    await expectNoCreate(f.project.id);
  });
  it("keeps basic create authority distinct from dates/labels update and assignment", async () => {
    const f = await fixture(["project:read", "work_item:create"]);
    for (const extra of [
      { dueDate: "2026-10-22T00:00:00Z" },
      { labelIds: [f.label.id] },
      { assigneeId: f.person.id },
    ]) {
      expect((await f.create(extra)).status).toBe(403);
      await expectNoCreate(f.project.id);
    }
    expect((await f.create()).status).toBe(200);
  });
  it("allows self assignment through scoped update, and requires scoped assign for another roster member", async () => {
    const f = await fixture([
      "project:read",
      "work_item:create",
      "work_item:update",
    ]);
    const other = await addMember(f.workspace.id, "member");
    await grantProjectRole(other.user.id, f.project.id, ["work_item:read"]);
    expect((await f.create({ assigneeId: other.personId })).status).toBe(403);
    await expectNoCreate(f.project.id);
    expect((await f.create({ assigneeId: f.person.id })).status).toBe(200);
    await grantProjectRole(f.user.id, f.project.id, ["work_item:assign"]);
    expect((await f.create({ assigneeId: other.personId })).status).toBe(200);
  });
  it("rechecks permission loss in the transaction even after caller authorization", async () => {
    const f = await fixture();
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read", "work_item:create"] })
      .where(eq(schema.roleTable.id, f.role.id));
    await expect(f.direct({ labelIds: [f.label.id] })).rejects.toMatchObject({
      status: 403,
    });
    await expectNoCreate(f.project.id);
  });
  it("clamps initial fields to the API key's current stored capabilities", async () => {
    const f = await fixture();
    const raw = await makeApiKey(f.user.id, { work_item: ["create"] });
    const response = await f.app.request(
      `/api/projects/${f.project.id}/work-items`,
      {
        method: "POST",
        headers: { "x-api-key": raw, "content-type": "application/json" },
        body: JSON.stringify({
          typeId: f.type.id,
          title: "Scoped key",
          labelIds: [f.label.id],
        }),
      },
    );
    expect(response.status).toBe(403);
    await expectNoCreate(f.project.id);
    const wide = await makeApiKey(f.user.id, {
      work_item: ["create", "update", "assign"],
    });
    const allowed = await f.app.request(
      `/api/projects/${f.project.id}/work-items`,
      {
        method: "POST",
        headers: { "x-api-key": wide, "content-type": "application/json" },
        body: JSON.stringify({
          typeId: f.type.id,
          title: "Scoped atomic key",
          labelIds: [f.label.id],
          assigneeId: f.person.id,
        }),
      },
    );
    expect(allowed.status).toBe(200);
  });
  it("refuses non-leaveable or absent workflow configuration without writing", async () => {
    const f = await fixture();
    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId: null })
      .where(eq(schema.workItemTypeTable.id, f.type.id));
    expect((await f.create()).status).toBe(422);
    await expectNoCreate(f.project.id);
    const workflowId = `no-outbound-${randomUUID()}`;
    await db.insert(schema.workflowTable).values({
      id: workflowId,
      workspaceId: f.workspace.id,
      key: workflowId,
      name: "No outbound fixture",
    });
    await db
      .insert(schema.workflowVersionTable)
      .values({ id: `${workflowId}-v1`, workflowId, number: 1 });
    await db
      .update(schema.workflowVersionTable)
      .set({ publishedAt: new Date() })
      .where(eq(schema.workflowVersionTable.id, `${workflowId}-v1`));
    await db
      .update(schema.workflowTable)
      .set({ activeVersionId: `${workflowId}-v1` })
      .where(eq(schema.workflowTable.id, workflowId));
    await db
      .update(schema.workItemTypeTable)
      .set({ workflowId })
      .where(eq(schema.workItemTypeTable.id, f.type.id));
    expect((await f.create()).status).toBe(422);
    await expectNoCreate(f.project.id);
  });
  it("revalidates a project archived while creation waits on its real row lock", async () => {
    const f = await fixture();
    const race = await raceProjectArchive(f.project.id, () =>
      f.direct({ labelIds: [f.label.id], assigneeId: f.person.id }),
    );
    expect(race.blockedOnRowLock).toBe(true);
    expect(race.operation.status).toBe("rejected");
    if (race.operation.status === "rejected")
      expect(race.operation.reason).toMatchObject({ status: 404 });
    await expectNoCreate(f.project.id);
  });
  it("retries an aborted concurrent workflow-binding read and rejects the newly invalid default", async () => {
    const f = await fixture();
    const client = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await client.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE work_item_type SET workflow_id = NULL WHERE id = $1",
        [f.type.id],
      );
      const result = await client.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      pending = f.direct({ labelIds: [f.label.id] });
      // Attach a rejection handler immediately; the actual outcome is asserted below.
      const settled = pending.then(
        () => ({ status: 200 }),
        (error: unknown) => error,
      );
      expect(await waitForLockBlocker(client, result.rows[0]?.pid ?? -1)).toBe(
        true,
      );
      await client.query("COMMIT");
      expect(await settled).toMatchObject({ status: 422 });
      await expectNoCreate(f.project.id);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
      await pending?.catch(() => {});
    }
  });
  it("rejects invalid dates and duplicate label IDs through the canonical validators", async () => {
    const f = await fixture();
    for (const extra of [
      { startDate: "2026-02-31T00:00:00Z" },
      { dueDate: "1800-01-01T00:00:00Z" },
      { labelIds: [f.label.id, f.label.id] },
    ]) {
      expect((await f.create(extra)).status).toBe(400);
      await expectNoCreate(f.project.id);
    }
  });
});
