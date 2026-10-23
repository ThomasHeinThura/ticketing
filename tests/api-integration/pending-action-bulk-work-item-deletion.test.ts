import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { approveBulkWorkItemDeletion } from "../../apps/api/src/pending-action/bulk-work-item-deletion-target";
import {
  createPendingAction,
  decideOwnPendingAction,
  getOwnPendingAction,
} from "../../apps/api/src/pending-action/service";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(password: string, rounds: number): Promise<string>;
};

async function fixture(count = 2) {
  const creator = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: creator.workspace.id,
  });
  await grantWorkItemProjectAccess(creator.user.id, project.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id)),
    "person",
  );
  const sessionId = `session-${creator.user.id}`;
  await db.insert(schema.sessionTable).values({
    id: sessionId,
    userId: creator.user.id,
    token: randomUUID(),
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: creator.workspace.id,
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
        workspaceId: creator.workspace.id,
        key: randomUUID(),
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "template",
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
  const items = await db
    .insert(schema.workItemTable)
    .values(
      Array.from({ length: count }, (_, i) => ({
        workspaceId: creator.workspace.id,
        projectId: project.id,
        typeId: type.id,
        stateId: state.id,
        key: `BULK-${i + 1}`,
        number: i + 1,
        title: `Persisted target ${i + 1}`,
      })),
    )
    .returning();
  mockAuthenticatedSession(creator.user);
  const { app } = createApp();
  const request = async (keys = items.map((i) => i.key)) =>
    app.request("/api/work-items/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        workItemKeys: keys,
        operation: "delete",
      }),
    });
  const approval = (
    id: string,
    typedCount = String(items.length),
    stepUpToken?: string,
  ) => ({
    id,
    requesterPersonId: person.id,
    userId: creator.user.id,
    sessionId,
    traceId: randomUUID(),
    typedCount,
    stepUpToken,
  });
  const pending = async (id: string) =>
    requireRow(
      await db
        .select()
        .from(schema.pendingActionTable)
        .where(eq(schema.pendingActionTable.id, id)),
      "pending",
    );
  const rows = () =>
    db
      .select()
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.projectId, project.id));
  const agentRequest = (url: string, body: unknown) => {
    const req = withConfiguredAgentAuthority(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return app.request(req.input, req.init);
  };
  const proof = async (id: string) => {
    await db
      .insert(schema.accountTable)
      .values({
        id: randomUUID(),
        accountId: creator.user.id,
        providerId: "credential",
        userId: creator.user.id,
        password: await bcrypt.hash("bulk-local-password", 4),
      })
      .onConflictDoNothing();
    const challenge = await agentRequest("/api/me/step-up/challenges", {
      kind: "pending_action",
      pendingActionId: id,
    });
    expect(challenge.status, await challenge.clone().text()).toBe(200);
    const data = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const verified = await agentRequest("/api/me/step-up", {
      kind: "pending_action",
      pendingActionId: id,
      challengeId: data.challengeId,
      nonce: data.nonce,
      method: "password",
      password: "bulk-local-password",
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    return ((await verified.json()) as { token: string }).token;
  };
  return {
    creator,
    project,
    person,
    sessionId,
    items,
    app,
    request,
    approval,
    pending,
    rows,
    proof,
    agentRequest,
  };
}
async function requestPending(
  f: Awaited<ReturnType<typeof fixture>>,
  keys?: string[],
) {
  const response = await f.request(keys);
  expect(response.status, await response.clone().text()).toBe(202);
  return (await response.json()) as {
    pendingActionId: string;
    summary: Record<string, unknown>;
    confirmation: string;
    action: string;
  };
}
beforeEach(() => resetTestDatabase());
describe("durable canonical bulk work-item deletion", () => {
  it("returns202 without deleting and executes once through real browser approval with typed count", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    expect(created).toMatchObject({
      action: "bulk_delete",
      confirmation: "typed_count",
      summary: { selectedCount: 2, affectedCount: 2, recoveryDays: 30 },
    });
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
    const response = await f.app.request(
      `/api/me/pending-actions/${created.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typedCount: "2" }),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "executed",
      result: { succeeded: ["BULK-1", "BULK-2"], failed: [] },
    });
    expect((await f.rows()).every((r) => r.deletedAt !== null)).toBe(true);
    const detail = await getOwnPendingAction(
      f.creator.user.id,
      created.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(detail.summary).toMatchObject({
      result: { succeeded: ["BULK-1", "BULK-2"], failed: [] },
    });
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "work_item.deleted")),
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "bulk.performed")),
    ).toHaveLength(1);
  });
  it.each([undefined, "", "02", "1", "3"])(
    "rejects wrong typed count %s without changing data",
    async (count) => {
      const f = await fixture();
      const created = await requestPending(f);
      await expect(
        approveBulkWorkItemDeletion({
          ...f.approval(created.pendingActionId),
          typedCount: count,
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect((await f.pending(created.pendingActionId)).state).toBe("pending");
      expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
    },
  );
  it("explicitly excludes missing and hidden targets without discovering their titles", async () => {
    const f = await fixture();
    const { project: hidden } = await createProjectFixture({
      workspaceId: f.creator.workspace.id,
    });
    const originalState = requireRow(
      await db
        .select()
        .from(schema.stateTable)
        .where(
          eq(
            schema.stateTable.id,
            requireRow(f.items.slice(1), "second item").stateId,
          ),
        ),
      "state",
    );
    const hiddenState = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: hidden.id,
          stateTemplateId: originalState.stateTemplateId,
          isDefault: true,
        })
        .returning(),
      "hidden state",
    );
    await db
      .update(schema.workItemTable)
      .set({ projectId: hidden.id, stateId: hiddenState.id })
      .where(
        eq(
          schema.workItemTable.id,
          requireRow(f.items.slice(1), "second item").id,
        ),
      );
    const created = await requestPending(f, ["BULK-1", "BULK-2", "MISSING-1"]);
    expect(created.summary).toMatchObject({
      selectedCount: 3,
      affectedCount: 1,
      failed: [
        { id: "BULK-2", reason: "Work item not found" },
        { id: "MISSING-1", reason: "Work item not found" },
      ],
    });
    expect(JSON.stringify(created.summary)).not.toContain("Persisted target 2");
    expect((await f.pending(created.pendingActionId)).targetIds).toEqual([
      "BULK-1",
    ]);
    const result = await approveBulkWorkItemDeletion(
      f.approval(created.pendingActionId, "1"),
    );
    expect(result.result).toMatchObject({
      succeeded: ["BULK-1"],
      failed: [
        { id: "BULK-2", reason: "Work item not found" },
        { id: "MISSING-1", reason: "Work item not found" },
      ],
    });
  });
  it("returns200 failures and no pending action when none are eligible", async () => {
    const f = await fixture();
    const response = await f.request(["MISSING-1"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      succeeded: [],
      failed: [{ id: "MISSING-1", reason: "Work item not found" }],
    });
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
  });
  it.each(["cancelled", "denied"] as const)(
    "%s leaves the batch intact",
    async (outcome) => {
      const f = await fixture();
      const created = await requestPending(f);
      await decideOwnPendingAction({
        id: created.pendingActionId,
        requesterPersonId: f.person.id,
        sessionId: f.sessionId,
        outcome,
      });
      await expect(
        approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
      ).rejects.toMatchObject({ status: 409 });
      expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
    },
  );
  it("expiry deletes nothing", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.pendingActionTable.id, created.pendingActionId));
    expect(
      await approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ).toMatchObject({ state: "expired" });
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
  it("a stale member invalidates the whole frozen batch", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    await db
      .update(schema.workItemTable)
      .set({ version: 2 })
      .where(
        eq(
          schema.workItemTable.id,
          requireRow(f.items.slice(1), "second item").id,
        ),
      );
    await expect(
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.pending(created.pendingActionId)).state).toBe(
      "invalidated",
    );
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
  it("serializes concurrent approvals and rejects an exact-set retry", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    expect((await f.request(["BULK-2", "BULK-1"])).status).toBe(409);
    const results = await Promise.allSettled([
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("savepoints retain successes and durable per-item failures", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    await db.execute(
      sql`CREATE FUNCTION taskdesk_test_refuse_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='BULK-2' AND NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'test constraint'; END IF; RETURN NEW; END $$`,
    );
    await db.execute(
      sql`CREATE TRIGGER taskdesk_test_refuse_delete BEFORE UPDATE ON work_item FOR EACH ROW EXECUTE FUNCTION taskdesk_test_refuse_delete()`,
    );
    try {
      const result = await approveBulkWorkItemDeletion(
        f.approval(created.pendingActionId),
      );
      expect(result.result).toEqual({
        succeeded: ["BULK-1"],
        failed: [{ id: "BULK-2", reason: "failed" }],
      });
      expect(
        (await f.rows()).find((r) => r.key === "BULK-1")?.deletedAt,
      ).not.toBeNull();
      expect(
        (await f.rows()).find((r) => r.key === "BULK-2")?.deletedAt,
      ).toBeNull();
      expect(
        (await f.pending(created.pendingActionId)).payloadSummary,
      ).toMatchObject({ result: result.result });
    } finally {
      await db.execute(
        sql`DROP TRIGGER taskdesk_test_refuse_delete ON work_item`,
      );
      await db.execute(sql`DROP FUNCTION taskdesk_test_refuse_delete()`);
    }
  });
  it("50 targets require count only;51 need actual bound password proof and cannot replay", async () => {
    const f = await fixture(51);
    const fifty = await requestPending(
      f,
      f.items.slice(0, 50).map((i) => i.key),
    );
    expect(fifty.confirmation).toBe("typed_count");
    await decideOwnPendingAction({
      id: fifty.pendingActionId,
      requesterPersonId: f.person.id,
      sessionId: f.sessionId,
      outcome: "cancelled",
    });
    const created = await requestPending(f);
    expect(created.confirmation).toBe("typed_count_step_up");
    await expect(
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 403 });
    expect((await f.pending(created.pendingActionId)).state).toBe("pending");
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          and(
            eq(schema.auditLogTable.action, "auth.step_up_denied"),
            eq(schema.auditLogTable.entityId, created.pendingActionId),
          ),
        ),
    ).toHaveLength(1);
    const token = await f.proof(created.pendingActionId);
    expect(
      await approveBulkWorkItemDeletion(
        f.approval(created.pendingActionId, "51", token),
      ),
    ).toMatchObject({ state: "executed" });
    await expect(
      approveBulkWorkItemDeletion(
        f.approval(created.pendingActionId, "51", token),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.rows()).every((r) => r.deletedAt !== null)).toBe(true);
  });
  it("redacts the entire confirmation after any approved target loses read, and invalidates without shrinking", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    const membership = requireRow(
      await db
        .select()
        .from(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, f.person.id),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, f.project.id),
          ),
        ),
      "membership",
    );
    await db
      .update(schema.roleTable)
      .set({ capabilities: ["project:read"] })
      .where(eq(schema.roleTable.id, membership.roleId));
    const detail = await getOwnPendingAction(
      f.creator.user.id,
      created.pendingActionId,
      undefined,
      { apiKeyId: null, traceId: randomUUID() },
    );
    expect(detail.summary).toEqual({ redacted: true, targetCount: 2 });
    expect(detail.targetIds).toEqual([]);
    await expect(
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
  it("does not substitute a moved target even when the new project is readable and deletable", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    const { project } = await createProjectFixture({
      workspaceId: f.creator.workspace.id,
    });
    await grantWorkItemProjectAccess(f.creator.user.id, project.id);
    const item = requireRow(f.items.slice(1), "second");
    const state = requireRow(
      await db
        .select()
        .from(schema.stateTable)
        .where(eq(schema.stateTable.id, item.stateId)),
      "state",
    );
    const moved = requireRow(
      await db
        .insert(schema.stateTable)
        .values({
          projectId: project.id,
          stateTemplateId: state.stateTemplateId,
          isDefault: true,
        })
        .returning(),
      "new state",
    );
    await db
      .update(schema.workItemTable)
      .set({ projectId: project.id, stateId: moved.id })
      .where(eq(schema.workItemTable.id, item.id));
    await expect(
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.pending(created.pendingActionId)).state).toBe(
      "invalidated",
    );
    expect(
      await db
        .select()
        .from(schema.workItemTable)
        .where(sql`${schema.workItemTable.deletedAt} IS NOT NULL`),
    ).toHaveLength(0);
  });
  it("rejects altered approved payload and preserves all items", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    const row = await f.pending(created.pendingActionId);
    await db
      .update(schema.pendingActionTable)
      .set({
        payload: {
          ...(row.payload as Record<string, unknown>),
          target_ids: ["BULK-1"],
        },
      })
      .where(eq(schema.pendingActionTable.id, row.id));
    await expect(
      approveBulkWorkItemDeletion(f.approval(row.id)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
  it("rechecks the original key ceiling rather than borrowing browser authority", async () => {
    const f = await fixture();
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
    const created = await createPendingAction({
      requesterPersonId: f.person.id,
      credentialType: "api_key",
      credentialId: id,
      origin: "api",
      action: "bulk_delete",
      targetType: "work_item",
      targetIds: f.items.map((i) => i.key),
      routeKey: "POST /api/work-items/bulk",
      workspaceId: f.creator.workspace.id,
      actorId: f.creator.user.id,
      actorType: "api_key",
    });
    await db
      .update(schema.apikeyTable)
      .set({ permissions: JSON.stringify({ work_item: ["read"] }) })
      .where(eq(schema.apikeyTable.id, id));
    await expect(
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId)),
    ).rejects.toMatchObject({ status: 409 });
    expect((await f.pending(created.pendingActionId)).invalidationReason).toBe(
      "capability_removed",
    );
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
  it("step-up proof binds to exactly one batch and a count mismatch does not consume it", async () => {
    const f = await fixture(102);
    const first = await requestPending(
      f,
      f.items.slice(0, 51).map((i) => i.key),
    );
    const second = await requestPending(
      f,
      f.items.slice(51).map((i) => i.key),
    );
    const token = await f.proof(first.pendingActionId);
    await expect(
      approveBulkWorkItemDeletion(
        f.approval(second.pendingActionId, "51", token),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      approveBulkWorkItemDeletion(
        f.approval(first.pendingActionId, "50", token),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await approveBulkWorkItemDeletion(
        f.approval(first.pendingActionId, "51", token),
      ),
    ).toMatchObject({ state: "executed" });
    expect((await f.pending(second.pendingActionId)).state).toBe("pending");
    expect((await f.rows()).filter((r) => r.deletedAt !== null)).toHaveLength(
      51,
    );
  });
  it("proof challenge rechecks actual frozen authority and never admits revoked key requests", async () => {
    const f = await fixture(51);
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
    const created = await createPendingAction({
      requesterPersonId: f.person.id,
      credentialType: "api_key",
      credentialId: id,
      origin: "api",
      action: "bulk_delete",
      targetType: "work_item",
      targetIds: f.items.map((i) => i.key),
      routeKey: "POST /api/work-items/bulk",
      workspaceId: f.creator.workspace.id,
      actorId: f.creator.user.id,
      actorType: "api_key",
    });
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, id));
    const response = await f.agentRequest("/api/me/step-up/challenges", {
      kind: "pending_action",
      pendingActionId: created.pendingActionId,
    });
    expect(response.status).toBe(403);
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
  it("uses immutable approved targets and count rather than display summary to execute", async () => {
    const f = await fixture();
    const created = await requestPending(f);
    await db
      .update(schema.pendingActionTable)
      .set({
        payloadSummary: {
          affectedCount: 1,
          selection: { kind: "keys", keys: ["NOT-APPROVED"] },
        },
      })
      .where(eq(schema.pendingActionTable.id, created.pendingActionId));
    await expect(
      approveBulkWorkItemDeletion(f.approval(created.pendingActionId, "1")),
    ).rejects.toMatchObject({ status: 400 });
    const result = await approveBulkWorkItemDeletion(
      f.approval(created.pendingActionId, "2"),
    );
    expect(result.result).toEqual({
      succeeded: ["BULK-1", "BULK-2"],
      failed: [],
    });
  });
  it("rejects selection over500 before creating any pending action", async () => {
    const f = await fixture();
    const response = await f.request(
      Array.from({ length: 501 }, (_, i) => `TOO-MANY-${i}`),
    );
    expect(response.status).toBe(400);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
    expect((await f.rows()).every((r) => r.deletedAt === null)).toBe(true);
  });
});
