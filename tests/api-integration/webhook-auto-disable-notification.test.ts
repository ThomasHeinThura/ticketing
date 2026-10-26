/** WH-7 / NO-8: auto-disable notices use the existing event's transactional fan-out. */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import {
  enqueueOutboxEvent,
  eventScope,
} from "../../apps/api/src/events/outbox";
import { parseParentEnvelope } from "../../apps/api/src/events/outbox-consumer";
import getNotifications from "../../apps/api/src/notification/controllers/get-notifications";
import { listVisibleNotificationRows } from "../../apps/api/src/notification/inbox.repository";
import { resolveNotificationDeepLinks } from "../../apps/api/src/notification/links";
import { resolveWebhookAutoDisabledRecipients } from "../../apps/api/src/notification/recipient-resolvers";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import { enqueueWebhookDeliveries } from "../../apps/api/src/webhook/consumer";
import { processNextWebhookDelivery } from "../../apps/api/src/webhook/delivery";
import type { WebhookSendResult } from "../../apps/api/src/webhook/safe-http";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

process.env.TASKDESK_ENCRYPTION_KEY ??= "e1".repeat(32);

const SECRET = "whsec_notification_test_secret_0000000";

async function personFor(userId: string) {
  return requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "webhook owner person",
  );
}

async function makeWebhook(
  workspaceId: string,
  ownerUserId: string,
  failingSince = new Date(Date.now() - 25 * 3_600_000),
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
        failingSince,
      })
      .returning(),
    "webhook",
  );
}

async function emitWorkItemEvent(workspaceId: string, projectId: string) {
  const id = `evt_${randomUUID()}`;
  await db.transaction((tx) =>
    enqueueOutboxEvent(tx, {
      id,
      kind: "work_item.created",
      occurredAt: new Date().toISOString(),
      actor: { type: "system", id: null, name: "TaskDesk" },
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
  return parseParentEnvelope(requireRow(row ? [row] : [], "event envelope"));
}

function failureSender() {
  return {
    send: async (): Promise<WebhookSendResult> => ({
      statusCode: 503,
      durationMs: 10,
      responseBody: "unavailable",
      error: "http_503",
      success: false,
    }),
    now: () => new Date(),
  };
}

async function autoDisabledEvent(webhookId: string) {
  const [row] = await db
    .select()
    .from(schema.outboxTable)
    .where(
      and(
        eq(schema.outboxTable.kind, "webhook.auto_disabled"),
        eq(
          sql<string>`${schema.outboxTable.payload}->'payload'->>'webhookId'`,
          webhookId,
        ),
      ),
    )
    .limit(1);
  const event = row ? parseParentEnvelope(row) : null;
  return event?.payload.webhookId === webhookId ? event : null;
}

describe("WH-7 auto-disable notification fan-out", () => {
  beforeEach(async () => resetTestDatabase());

  it("notifies the current webhook owner once in-app and does not repeat on subsequent queued work", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "admin" });
    const manager = await createWorkspaceMember({ role: "admin" });
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, manager.user.id));
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: manager.user.id,
      role: "admin",
      joinedAt: new Date(),
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, [
      "project:read",
      "work_item:read",
    ]);
    const webhook = await makeWebhook(workspace.id, user.id);
    const firstEvent = await emitWorkItemEvent(workspace.id, project.id);
    const secondEvent = await emitWorkItemEvent(workspace.id, project.id);
    await db.transaction(async (tx) => {
      await enqueueWebhookDeliveries(tx, firstEvent);
      await enqueueWebhookDeliveries(tx, secondEvent);
    });

    const deps = failureSender();
    await processNextWebhookDelivery(deps);
    await processNextWebhookDelivery(deps);

    const noticeEvent = await autoDisabledEvent(webhook.id);
    expect(noticeEvent).not.toBeNull();
    const notices = await db
      .select()
      .from(schema.notificationTable)
      .where(
        and(
          eq(schema.notificationTable.kind, "webhook.auto_disabled"),
          eq(schema.notificationTable.resourceId, webhook.id),
        ),
      );
    expect(notices).toHaveLength(1);
    const notice = requireRow(notices, "webhook notification");
    expect(notice).toMatchObject({
      personId: (await personFor(user.id)).id,
      eventId: noticeEvent?.id,
      resourceType: "webhook",
      type: "info",
    });
    expect(notices.map(({ personId }) => personId)).not.toContain(
      (await personFor(manager.user.id)).id,
    );
    expect(
      resolveNotificationDeepLinks([
        {
          id: notice.id,
          kind: notice.kind,
          resourceType: notice.resourceType,
          resourceId: notice.resourceId,
        },
      ]).get(notice.id),
    ).toEqual({ type: "webhook", id: webhook.id });
    expect(notice.body).toBe(
      "A webhook was disabled and needs your attention.",
    );
    expect(notice.body).not.toContain("http_503");

    const inbox = await listVisibleNotificationRows({
      userId: user.id,
      credentialCanReadTask: true,
    });
    const ownerNotice = inbox.find(
      ({ notification }) => notification.eventId === noticeEvent?.id,
    );
    expect(ownerNotice?.workspaceId).toBe(workspace.id);
    expect(ownerNotice?.notification.resourceId).toBe(webhook.id);

    const apiNotifications = await getNotifications(user.id, true);
    const apiOwnerNotice = apiNotifications.find(
      (notification) => notification.eventId === noticeEvent?.id,
    );
    expect(apiOwnerNotice?.deepLink).toEqual({
      type: "webhook",
      id: webhook.id,
    });

    const eventRows = await db
      .select()
      .from(schema.outboxTable)
      .where(eq(schema.outboxTable.kind, "webhook.auto_disabled"));
    expect(eventRows).toHaveLength(1);
  });

  it("fails closed for inactive or out-of-reach owners and a mismatched event workspace", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "admin" });
    const webhook = await makeWebhook(workspace.id, user.id);
    const owner = await personFor(user.id);
    const event = {
      id: `evt_${randomUUID()}`,
      kind: "webhook.auto_disabled",
      occurredAt: new Date().toISOString(),
      actor: { type: "system", id: null, name: "TaskDesk" },
      scope: eventScope({
        workspaceId: workspace.id,
        organisationId: workspace.organisationId,
        projectId: null,
      }),
      payload: {
        key: webhook.id,
        url: `/agent/settings/webhooks/${webhook.id}`,
        webhookId: webhook.id,
        ownerPersonId: "untrusted-event-owner",
        lastError: "must-not-be-projected",
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    } as const;

    const recipients = await db.transaction((tx) =>
      resolveWebhookAutoDisabledRecipients(tx, event),
    );
    expect(recipients.map(({ personId }) => personId)).toEqual([owner.id]);
    expect(recipients[0]?.body).not.toContain("must-not-be-projected");

    const wrongWorkspace = {
      ...event,
      scope: eventScope({
        workspaceId: `foreign-${randomUUID()}`,
        organisationId: workspace.organisationId,
        projectId: null,
      }),
    };
    expect(
      await db.transaction((tx) =>
        resolveWebhookAutoDisabledRecipients(tx, wrongWorkspace),
      ),
    ).toEqual([]);

    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(eq(schema.workspaceUserTable.userId, user.id));
    expect(
      await db.transaction((tx) =>
        resolveWebhookAutoDisabledRecipients(tx, event),
      ),
    ).toEqual([]);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "admin" })
      .where(eq(schema.workspaceUserTable.userId, user.id));

    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.id, owner.id));
    expect(
      await db.transaction((tx) =>
        resolveWebhookAutoDisabledRecipients(tx, event),
      ),
    ).toEqual([]);

    await db
      .update(schema.personTable)
      .set({ active: true })
      .where(eq(schema.personTable.id, owner.id));
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, user.id));
    await db
      .delete(schema.membershipTable)
      .where(eq(schema.membershipTable.personId, owner.id));
    expect(
      await db.transaction((tx) =>
        resolveWebhookAutoDisabledRecipients(tx, event),
      ),
    ).toEqual([]);
  });
});
