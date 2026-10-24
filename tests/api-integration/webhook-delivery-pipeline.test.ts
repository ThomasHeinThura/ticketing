/**
 * Webhook pipeline end to end against the database (`WH-3`, `WH-4`, `WH-6`, `WH-7`, `WH-8`,
 * `WH-14`): the parent consumer enqueues, the delivery worker signs and records, the owner's
 * reach is decided at send time, and a failing endpoint backs off, dies and auto-disables.
 *
 * The HTTP client is injected, so nothing leaves the process; the SSRF client and the signature
 * are covered by `tests/api/webhook/*` without a database.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  webhookDeliveryTable,
  webhookTable,
} from "../../apps/api/src/database/schema";
import { enqueueOutboxEvent } from "../../apps/api/src/events/outbox";
import { parseParentEnvelope } from "../../apps/api/src/events/outbox-consumer";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import {
  enqueueWebhookDeliveries,
  webhookParentConsumer,
} from "../../apps/api/src/webhook/consumer";
import { processNextWebhookDelivery } from "../../apps/api/src/webhook/delivery";
import { enqueueRedelivery } from "../../apps/api/src/webhook/repository";
import type { WebhookSendResult } from "../../apps/api/src/webhook/safe-http";
import { signWebhookBody } from "../../apps/api/src/webhook/signature";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

process.env.TASKDESK_ENCRYPTION_KEY ??= "e1".repeat(32);

const SECRET = "whsec_integration_secret_0000000";

type Sent = {
  url: string;
  headers: Record<string, string>;
  rawBody: string;
};

function sender(result: Partial<WebhookSendResult> = {}) {
  const sent: Sent[] = [];
  const send = async (input: Sent): Promise<WebhookSendResult> => {
    sent.push(input);
    return {
      statusCode: 200,
      durationMs: 12,
      responseBody: "ok",
      error: null,
      success: true,
      ...result,
    };
  };
  return {
    sent,
    deps: {
      send: send as never,
      now: () => new Date(),
    },
  };
}

async function personFor(userId: string) {
  return requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "person",
  );
}

async function makeWebhook(
  workspaceId: string,
  ownerUserId: string,
  overrides: Partial<typeof webhookTable.$inferInsert> = {},
) {
  const owner = await personFor(ownerUserId);
  return requireRow(
    await db
      .insert(webhookTable)
      .values({
        workspaceId,
        name: "Ops hook",
        url: "https://hooks.example.com/in",
        secret: encryptSecret(SECRET) as string,
        events: ["work_item.created"],
        createdBy: owner.id,
        ...overrides,
      })
      .returning(),
    "webhook",
  );
}

async function emit(
  workspaceId: string,
  projectId: string,
  kind = "work_item.created",
) {
  const id = `evt_${randomUUID()}`;
  await db.transaction((tx) =>
    enqueueOutboxEvent(tx, {
      id,
      kind,
      occurredAt: new Date().toISOString(),
      actor: { type: "system", id: null, name: "System" },
      scope: { workspaceId, projectId },
      payload: { key: "TEST-1", url: "/agent/work-items/TEST-1" },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    }),
  );
  const [row] = await db
    .select()
    .from(schema.outboxTable)
    .where(eq(schema.outboxTable.eventId, id));
  return {
    id,
    envelope: parseParentEnvelope(requireRow(row ? [row] : [], "outbox row")),
  };
}

async function deliveries(webhookId: string) {
  return db
    .select()
    .from(webhookDeliveryTable)
    .where(eq(webhookDeliveryTable.webhookId, webhookId));
}

async function makeDue(webhookId: string) {
  await db
    .update(webhookDeliveryTable)
    .set({ nextAttemptAt: new Date(Date.now() - 1_000) })
    .where(eq(webhookDeliveryTable.webhookId, webhookId));
}

describe("webhook pipeline", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("queues one delivery per active, subscribed webhook, and a replay adds none (WH-3, EV-2)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const subscribed = await makeWebhook(workspace.id, user.id);
    const other = await makeWebhook(workspace.id, user.id, {
      events: ["work_item.deleted"],
    });
    const inactive = await makeWebhook(workspace.id, user.id, {
      active: false,
      disabledAt: new Date(),
      disabledReason: "manual",
    });
    const { envelope } = await emit(workspace.id, project.id);

    expect(webhookParentConsumer.handles("work_item.created")).toBe(true);
    expect(webhookParentConsumer.handles("pending_action.decided")).toBe(false);
    for (let replay = 0; replay < 2; replay++)
      await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));

    expect(await deliveries(subscribed.id)).toHaveLength(1);
    expect(await deliveries(other.id)).toHaveLength(0);
    expect(await deliveries(inactive.id)).toHaveLength(0);
  });

  it("signs and records a delivery for an owner who can see the project (WH-1, WH-2, WH-14)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const webhook = await makeWebhook(workspace.id, user.id);
    const { id, envelope } = await emit(workspace.id, project.id);
    await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));

    const { sent, deps } = sender();
    const result = await processNextWebhookDelivery(deps);
    expect(result.kind).toBe("delivered");
    expect(sent).toHaveLength(1);
    const call = sent[0] as Sent;
    expect(call.url).toBe(webhook.url);
    expect(call.headers["X-TaskDesk-Event"]).toBe("work_item.created");
    expect(call.headers["X-TaskDesk-Signature"]).toBe(
      signWebhookBody(SECRET, call.rawBody),
    );
    expect(JSON.parse(call.rawBody)).toMatchObject({
      id,
      event: "work_item.created",
      data: { workItem: { key: "TEST-1" } },
    });
    const [row] = await deliveries(webhook.id);
    expect(row).toMatchObject({
      state: "delivered",
      attempt: 1,
      statusCode: 200,
      error: null,
    });
    expect(call.headers["X-TaskDesk-Delivery"]).toBe(row?.id);
    // The recorded body is what was signed, so redelivery sends the same event (WH-8).
    expect(row?.requestBody).toMatchObject({ id });
  });

  it("skips, without sending, an event outside the owner's reach, and keeps the webhook active (WH-14)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const webhook = await makeWebhook(workspace.id, user.id);
    const { envelope } = await emit(workspace.id, project.id);
    await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));

    const { sent, deps } = sender();
    expect((await processNextWebhookDelivery(deps)).kind).toBe("skipped");
    expect(sent).toHaveLength(0);
    const [row] = await deliveries(webhook.id);
    expect(row).toMatchObject({
      state: "skipped_out_of_reach",
      requestBody: null,
      attempt: 0,
    });
    const [live] = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.id, webhook.id));
    expect(live?.active).toBe(true);
  });

  it("pauses a webhook whose owner left the workspace instead of delivering (WH-14)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const webhook = await makeWebhook(workspace.id, user.id);
    const { envelope } = await emit(workspace.id, project.id);
    await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      );

    const { sent, deps } = sender();
    expect((await processNextWebhookDelivery(deps)).kind).toBe("cancelled");
    expect(sent).toHaveLength(0);
    const [live] = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.id, webhook.id));
    expect(live).toMatchObject({
      active: false,
      disabledReason: "owner_left",
    });
    expect((await deliveries(webhook.id))[0]).toMatchObject({
      state: "cancelled",
      error: "owner_left",
    });
  });

  it("backs off 30 s after the first failure and is dead after the sixth attempt (WH-4, WH-5)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const webhook = await makeWebhook(workspace.id, user.id);
    const { envelope } = await emit(workspace.id, project.id);
    await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));
    const { deps } = sender({
      statusCode: 500,
      success: false,
      error: "http_500",
    });

    const before = Date.now();
    expect((await processNextWebhookDelivery(deps)).kind).toBe("retry");
    const [first] = await deliveries(webhook.id);
    expect(first).toMatchObject({ state: "pending", attempt: 1 });
    expect(first?.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(
      before + 29_000,
    );
    const [afterFirst] = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.id, webhook.id));
    expect(afterFirst?.failingSince).not.toBeNull();
    expect(afterFirst?.lastError).toBe("http_500");

    for (let attempt = 2; attempt <= 6; attempt++) {
      await makeDue(webhook.id);
      const outcome = await processNextWebhookDelivery(deps);
      expect(outcome.kind).toBe(attempt === 6 ? "dead" : "retry");
    }
    expect((await deliveries(webhook.id))[0]).toMatchObject({
      state: "dead",
      attempt: 6,
    });
  });

  it("auto-disables a webhook that has failed continuously for 24 hours and emits the event (WH-7)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const webhook = await makeWebhook(workspace.id, user.id, {
      failingSince: new Date(Date.now() - 25 * 3_600_000),
    });
    const { envelope } = await emit(workspace.id, project.id);
    await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));

    const { deps } = sender({
      statusCode: 503,
      success: false,
      error: "http_503",
    });
    await processNextWebhookDelivery(deps);
    const [live] = await db
      .select()
      .from(webhookTable)
      .where(eq(webhookTable.id, webhook.id));
    expect(live).toMatchObject({
      active: false,
      disabledReason: "failing_24h",
    });
    const events = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "webhook.auto_disabled"));
    expect(events).toHaveLength(1);
    expect(events[0]?.workspaceId).toBe(workspace.id);
  });

  it("redelivers the recorded body as a new delivery (WH-8)", async () => {
    const { user, workspace } = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const webhook = await makeWebhook(workspace.id, user.id);
    const { id, envelope } = await emit(workspace.id, project.id);
    await db.transaction((tx) => enqueueWebhookDeliveries(tx, envelope));
    const { sent, deps } = sender();
    await processNextWebhookDelivery(deps);
    const [original] = await deliveries(webhook.id);

    const queued = await enqueueRedelivery(
      requireRow(original ? [original] : [], "original"),
    );
    expect(queued).toMatchObject({
      source: "redelivery",
      redeliveryOf: original?.id,
      state: "pending",
    });
    await processNextWebhookDelivery(deps, queued.id);
    expect(sent).toHaveLength(2);
    expect(JSON.parse((sent[1] as Sent).rawBody).id).toBe(id);
    expect(
      (await deliveries(webhook.id)).map((row) => row.state).sort(),
    ).toEqual(["delivered", "delivered"]);
  });
});
