import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  automationRunTable,
  automationTable,
  notificationDeliveryTable,
  notificationDigestTable,
  outboxTable,
  slaEscalationTable,
  webhookDeliveryTable,
  webhookTable,
} from "../../apps/api/src/database/schema";
import {
  purgeNotificationAndOutboxRetention,
  purgeTerminalNotificationDeliveries,
  purgeTerminalOutboxEvents,
} from "../../apps/api/src/notification/retention";
import { runSessionCleanup } from "../../apps/api/src/scheduler/session-cleanup";
import { buildTenant, personOf } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { setTestDatabaseTimezone } from "./helpers/database-timezone";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

async function makeOrganisation(label: string) {
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `p20-${label}-${randomUUID()}`,
        name: `P20 ${label}`,
      })
      .returning(),
    `makeOrganisation(${label})`,
  );
}

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "p20-test",
        reason: "p20 legal-hold retention test",
      })
      .returning(),
    "placeHold",
  );
}

async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "p20-test" })
    .where(eq(schema.legalHoldTable.id, id));
}

async function insertOutboxRow(input: {
  eventId?: string;
  workspaceId: string;
  organisationId?: string | null;
  projectId?: string | null;
  kind?: string;
  state: "pending" | "delivered" | "dead";
  ageMs: number;
  actor?: { type: "person" | "system"; id: string | null; name: string };
  eventPayload?: Record<string, unknown>;
}) {
  const eventId = input.eventId ?? `evt_${randomUUID()}`;
  const kind = input.kind ?? "workspace.created";
  const ts = new Date(Date.now() - input.ageMs);
  const actor = input.actor ?? { type: "system", id: null, name: "System" };
  return requireRow(
    await db
      .insert(outboxTable)
      .values({
        eventId,
        workspaceId: input.workspaceId,
        organisationId: input.organisationId ?? null,
        kind,
        state: input.state,
        payload: {
          id: eventId,
          kind,
          occurredAt: ts.toISOString(),
          actor,
          scope: {
            workspaceId: input.workspaceId,
            ...(input.organisationId
              ? { organisationId: input.organisationId }
              : {}),
            ...(input.projectId ? { projectId: input.projectId } : {}),
          },
          payload: input.eventPayload ?? { workspaceId: input.workspaceId },
          causationId: null,
          depth: 0,
          originAutomationId: null,
        },
        createdAt: ts,
        updatedAt: ts,
      })
      .returning(),
    "insertOutboxRow",
  );
}

async function insertDigestRow(input: {
  recipientPersonId: string;
  workspaceId: string;
  organisationId?: string | null;
  channel?: string;
  state: "collecting" | "pending" | "delivered" | "dead" | "suppressed";
  ageMs: number;
  windowOffsetHours?: number;
}) {
  const ts = new Date(Date.now() - input.ageMs);
  const offset = (input.windowOffsetHours ?? 0) * HOUR_MS;
  const windowStartAt = new Date(ts.getTime() - HOUR_MS - offset);
  const windowEndAt = new Date(ts.getTime() - offset);
  return requireRow(
    await db
      .insert(notificationDigestTable)
      .values({
        recipientPersonId: input.recipientPersonId,
        channel: input.channel ?? "notify.email",
        workspaceId: input.workspaceId,
        organisationId: input.organisationId ?? null,
        cadence: "hourly",
        timezone: "UTC",
        windowStartAt,
        windowEndAt,
        state: input.state,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning(),
    "insertDigestRow",
  );
}

async function insertDeliveryRow(input: {
  eventId: string;
  recipientPersonId: string;
  workspaceId: string;
  organisationId?: string | null;
  channel?: string;
  digestId?: string | null;
  state: "pending" | "delivered" | "dead" | "suppressed";
  ageMs: number;
}) {
  const ts = new Date(Date.now() - input.ageMs);
  return requireRow(
    await db
      .insert(notificationDeliveryTable)
      .values({
        eventId: input.eventId,
        recipientPersonId: input.recipientPersonId,
        channel: input.channel ?? "notify.email",
        workspaceId: input.workspaceId,
        organisationId: input.organisationId ?? null,
        digestId: input.digestId ?? null,
        dedupeKey: `dedupe-${randomUUID()}`,
        state: input.state,
        deliveredAt: input.state === "delivered" ? ts : null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning(),
    "insertDeliveryRow",
  );
}

async function remainingDeliveries(ids: string[]) {
  const rows = await db
    .select({ id: notificationDeliveryTable.id })
    .from(notificationDeliveryTable)
    .where(inArray(notificationDeliveryTable.id, ids));
  return rows.map((row) => row.id).sort();
}

async function remainingDigests(ids: string[]) {
  const rows = await db
    .select({ id: notificationDigestTable.id })
    .from(notificationDigestTable)
    .where(inArray(notificationDigestTable.id, ids));
  return rows.map((row) => row.id).sort();
}

async function remainingOutbox(eventIds: string[]) {
  const rows = await db
    .select({ eventId: outboxTable.eventId })
    .from(outboxTable)
    .where(inArray(outboxTable.eventId, eventIds));
  return rows.map((row) => row.eventId).sort();
}

describe("P-20 30-day notification_delivery, notification_digest, and outbox retention", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("purges >30d terminal children, empty terminal digests, and unreferenced terminal outbox in one session-cleanup pass while retaining pending, recent, and still-referenced rows", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const recipient = await personOf(user.id);

    // 1. Eligible chain: >30d delivered/suppressed/dead children -> >30d terminal digest -> >30d delivered/dead outbox.
    const oldDeliveredOutbox = await insertOutboxRow({
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 35 * DAY_MS,
    });
    const oldDeadOutbox = await insertOutboxRow({
      workspaceId: workspace.id,
      state: "dead",
      ageMs: 36 * DAY_MS,
    });
    const oldDeliveredDigest = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 35 * DAY_MS,
      windowOffsetHours: 1,
    });
    const oldSuppressedDigest = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      channel: "notify.slack",
      state: "suppressed",
      ageMs: 35 * DAY_MS,
      windowOffsetHours: 2,
    });
    const oldDeadDigest = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "dead",
      ageMs: 35 * DAY_MS,
      windowOffsetHours: 3,
    });

    const oldDeliveredChild = await insertDeliveryRow({
      eventId: oldDeliveredOutbox.eventId,
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      digestId: oldDeliveredDigest.id,
      state: "delivered",
      ageMs: 35 * DAY_MS,
    });
    const oldSuppressedChild = await insertDeliveryRow({
      eventId: oldDeliveredOutbox.eventId,
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      channel: "notify.slack",
      digestId: oldSuppressedDigest.id,
      state: "suppressed",
      ageMs: 34 * DAY_MS,
    });
    const oldDeadChild = await insertDeliveryRow({
      eventId: oldDeadOutbox.eventId,
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      digestId: oldDeadDigest.id,
      state: "dead",
      ageMs: 36 * DAY_MS,
    });

    // 2. Retained rows: <30d terminal rows, >30d pending/collecting rows, and >30d parents pinned by kept children.
    const recentOutbox = await insertOutboxRow({
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 29 * DAY_MS,
    });
    const pendingOutbox = await insertOutboxRow({
      workspaceId: workspace.id,
      state: "pending",
      ageMs: 45 * DAY_MS,
    });
    const outboxPinnedByPendingChild = await insertOutboxRow({
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 40 * DAY_MS,
    });
    const outboxPinnedByRecentChild = await insertOutboxRow({
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 40 * DAY_MS,
    });

    const digestPinnedByRecentChild = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 40 * DAY_MS,
      windowOffsetHours: 4,
    });
    const recentDigest = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 28 * DAY_MS,
      windowOffsetHours: 5,
    });
    const collectingOldDigest = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "collecting",
      ageMs: 45 * DAY_MS,
      windowOffsetHours: 6,
    });
    const pendingOldDigest = await insertDigestRow({
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "pending",
      ageMs: 45 * DAY_MS,
      windowOffsetHours: 7,
    });

    const pendingOldChild = await insertDeliveryRow({
      eventId: outboxPinnedByPendingChild.eventId,
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "pending",
      ageMs: 40 * DAY_MS,
    });
    const recentDeliveredChild = await insertDeliveryRow({
      eventId: outboxPinnedByRecentChild.eventId,
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      digestId: digestPinnedByRecentChild.id,
      state: "delivered",
      ageMs: 20 * DAY_MS,
    });

    const outcome = await runSessionCleanup();
    expect(outcome.degraded).toBe(false);

    expect(
      await remainingDeliveries([
        oldDeliveredChild.id,
        oldSuppressedChild.id,
        oldDeadChild.id,
        pendingOldChild.id,
        recentDeliveredChild.id,
      ]),
    ).toEqual([pendingOldChild.id, recentDeliveredChild.id].sort());

    expect(
      await remainingDigests([
        oldDeliveredDigest.id,
        oldSuppressedDigest.id,
        oldDeadDigest.id,
        digestPinnedByRecentChild.id,
        recentDigest.id,
        collectingOldDigest.id,
        pendingOldDigest.id,
      ]),
    ).toEqual(
      [
        digestPinnedByRecentChild.id,
        recentDigest.id,
        collectingOldDigest.id,
        pendingOldDigest.id,
      ].sort(),
    );

    expect(
      await remainingOutbox([
        oldDeliveredOutbox.eventId,
        oldDeadOutbox.eventId,
        recentOutbox.eventId,
        pendingOutbox.eventId,
        outboxPinnedByPendingChild.eventId,
        outboxPinnedByRecentChild.eventId,
      ]),
    ).toEqual(
      [
        recentOutbox.eventId,
        pendingOutbox.eventId,
        outboxPinnedByPendingChild.eventId,
        outboxPinnedByRecentChild.eventId,
      ].sort(),
    );
  });

  it("retains >30d terminal outbox events while webhook, automation, or SLA children remain", async () => {
    const tenant = await buildTenant("p20-live-consumers");
    const creator = await personOf(tenant.requester.user.id);

    const webhookPinnedOutbox = await insertOutboxRow({
      workspaceId: tenant.workspaceId,
      projectId: tenant.project.id,
      kind: "work_item.created",
      state: "delivered",
      ageMs: 40 * DAY_MS,
      eventPayload: {
        workItemId: tenant.workItem.id,
        key: tenant.workItem.key,
      },
    });
    const automationPinnedOutbox = await insertOutboxRow({
      workspaceId: tenant.workspaceId,
      projectId: tenant.project.id,
      kind: "work_item.created",
      state: "delivered",
      ageMs: 40 * DAY_MS,
      eventPayload: {
        workItemId: tenant.workItem.id,
        key: tenant.workItem.key,
      },
    });
    const slaPinnedOutbox = await insertOutboxRow({
      workspaceId: tenant.workspaceId,
      projectId: tenant.project.id,
      kind: "sla.breached",
      state: "delivered",
      ageMs: 40 * DAY_MS,
      eventPayload: {
        workItemId: tenant.workItem.id,
        key: tenant.workItem.key,
      },
    });

    const webhook = requireRow(
      await db
        .insert(webhookTable)
        .values({
          workspaceId: tenant.workspaceId,
          name: "Hook",
          url: "https://hooks.example.com/p20",
          secret: "secret",
          events: ["work_item.created"],
          createdBy: creator.id,
        })
        .returning(),
      "webhook",
    );
    const webhookDelivery = requireRow(
      await db
        .insert(webhookDeliveryTable)
        .values({
          webhookId: webhook.id,
          workspaceId: tenant.workspaceId,
          eventId: webhookPinnedOutbox.eventId,
          eventKind: "work_item.created",
          state: "pending",
        })
        .returning(),
      "webhookDelivery",
    );

    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: tenant.workspaceId,
          key: `p20-role-${randomUUID()}`,
          name: "P20 Role",
          rank: 10,
          capabilities: [],
        })
        .returning(),
      "role",
    );
    const automation = requireRow(
      await db
        .insert(automationTable)
        .values({
          workspaceId: tenant.workspaceId,
          name: "P20 Rule",
          trigger: "work_item.created",
          effectiveRoleId: role.id,
          createdBy: creator.id,
        })
        .returning(),
      "automation",
    );
    const automationRun = requireRow(
      await db
        .insert(automationRunTable)
        .values({
          automationId: automation.id,
          workspaceId: tenant.workspaceId,
          eventId: automationPinnedOutbox.eventId,
          state: "running",
        })
        .returning(),
      "automationRun",
    );

    const escalation = requireRow(
      await db
        .insert(slaEscalationTable)
        .values({
          workspaceId: tenant.workspaceId,
          projectId: tenant.project.id,
          workItemId: tenant.workItem.id,
          metric: "resolution",
          triggerEventId: slaPinnedOutbox.eventId,
          stateIdAtStart: tenant.workItem.stateId,
          lastOrder: 1,
          nextDueAt: new Date(Date.now() + HOUR_MS),
          state: "active",
        })
        .returning(),
      "slaEscalation",
    );

    expect(await purgeTerminalOutboxEvents()).toBe(0);
    expect(
      await remainingOutbox([
        webhookPinnedOutbox.eventId,
        automationPinnedOutbox.eventId,
        slaPinnedOutbox.eventId,
      ]),
    ).toHaveLength(3);

    // Terminal consumers still reference their envelopes until the child rows are deleted.
    await db
      .update(webhookDeliveryTable)
      .set({ state: "delivered", leaseToken: null })
      .where(eq(webhookDeliveryTable.id, webhookDelivery.id));
    await db
      .update(automationRunTable)
      .set({ state: "done" })
      .where(eq(automationRunTable.id, automationRun.id));
    await db
      .update(slaEscalationTable)
      .set({ state: "completed", nextDueAt: null })
      .where(eq(slaEscalationTable.id, escalation.id));

    expect(await purgeTerminalOutboxEvents()).toBe(0);
    expect(
      await remainingOutbox([
        webhookPinnedOutbox.eventId,
        automationPinnedOutbox.eventId,
        slaPinnedOutbox.eventId,
      ]),
    ).toHaveLength(3);

    await db
      .delete(webhookDeliveryTable)
      .where(eq(webhookDeliveryTable.id, webhookDelivery.id));
    expect(await purgeTerminalOutboxEvents()).toBe(1);
    expect(await remainingOutbox([webhookPinnedOutbox.eventId])).toEqual([]);
    await db
      .delete(automationRunTable)
      .where(eq(automationRunTable.id, automationRun.id));
    expect(await purgeTerminalOutboxEvents()).toBe(1);
    expect(await remainingOutbox([automationPinnedOutbox.eventId])).toEqual([]);
    await db
      .delete(slaEscalationTable)
      .where(eq(slaEscalationTable.id, escalation.id));
    expect(await purgeTerminalOutboxEvents()).toBe(1);
    expect(
      await remainingOutbox([
        webhookPinnedOutbox.eventId,
        automationPinnedOutbox.eventId,
        slaPinnedOutbox.eventId,
      ]),
    ).toEqual([]);
  });

  it.each([false, true])(
    "retains inbox-referenced envelopes regardless of read state (%s)",
    async (isRead) => {
      const { user, workspace } = await createWorkspaceMember({
        role: "owner",
      });
      const referenced = await insertOutboxRow({
        workspaceId: workspace.id,
        state: "delivered",
        ageMs: 45 * DAY_MS,
      });
      const unreferenced = await insertOutboxRow({
        workspaceId: workspace.id,
        state: "dead",
        ageMs: 45 * DAY_MS,
      });
      const inbox = requireRow(
        await db
          .insert(schema.notificationTable)
          .values({
            userId: user.id,
            eventId: referenced.eventId,
            isRead,
            readAt: isRead ? new Date(Date.now() - 45 * DAY_MS) : null,
          })
          .returning(),
        "inbox reference",
      );
      expect(await purgeTerminalOutboxEvents()).toBe(1);
      expect(
        await remainingOutbox([referenced.eventId, unreferenced.eventId]),
      ).toEqual([referenced.eventId]);
      await db
        .delete(schema.notificationTable)
        .where(eq(schema.notificationTable.id, inbox.id));
      expect(await purgeTerminalOutboxEvents()).toBe(1);
      expect(await remainingOutbox([referenced.eventId])).toEqual([]);
    },
  );

  it("obeys recipient, actor/source, and resource-owner legal holds (two-sided: retained while open, purged once lifted)", async () => {
    const tenant = await buildTenant("p20-holds");
    const staffActor = await personOf(tenant.requester.user.id);

    const customerOrg = await makeOrganisation("customer-owner");
    const unrelatedOrg = await makeOrganisation("unrelated");
    await db
      .update(schema.projectTable)
      .set({ organisationId: customerOrg.id })
      .where(eq(schema.projectTable.id, tenant.project.id));

    const otherMember = await createWorkspaceMember({ role: "member" });
    const heldRecipient = await personOf(otherMember.user.id);

    // Row A: held by recipient person hold (also pins its digest and parent outbox).
    const recipientHeldOutbox = await insertOutboxRow({
      workspaceId: tenant.workspaceId,
      state: "delivered",
      ageMs: 40 * DAY_MS,
    });
    const recipientHeldDigest = await insertDigestRow({
      recipientPersonId: heldRecipient.id,
      workspaceId: tenant.workspaceId,
      state: "delivered",
      ageMs: 40 * DAY_MS,
      windowOffsetHours: 10,
    });
    const recipientHeldDelivery = await insertDeliveryRow({
      eventId: recipientHeldOutbox.eventId,
      recipientPersonId: heldRecipient.id,
      workspaceId: tenant.workspaceId,
      digestId: recipientHeldDigest.id,
      state: "delivered",
      ageMs: 40 * DAY_MS,
    });

    // Row B: staff recipient, but references a work item owned by `customerOrg` (resource-owner hold).
    const resourceHeldOutbox = await insertOutboxRow({
      workspaceId: tenant.workspaceId,
      projectId: tenant.project.id,
      kind: "work_item.created",
      state: "delivered",
      ageMs: 40 * DAY_MS,
      eventPayload: {
        workItemId: tenant.workItem.id,
        key: tenant.workItem.key,
      },
    });
    const resourceHeldDelivery = await insertDeliveryRow({
      eventId: resourceHeldOutbox.eventId,
      recipientPersonId: staffActor.id,
      workspaceId: tenant.workspaceId,
      state: "delivered",
      ageMs: 40 * DAY_MS,
    });

    // Row C: resolved workspace event with no hold on its workspace/actor/recipient (proves unrelated holds do not freeze everything).
    const unheldOutbox = await insertOutboxRow({
      workspaceId: tenant.workspaceId,
      kind: "workspace.created",
      state: "delivered",
      ageMs: 40 * DAY_MS,
      eventPayload: { workspaceId: tenant.workspaceId },
    });
    const unheldDelivery = await insertDeliveryRow({
      eventId: unheldOutbox.eventId,
      recipientPersonId: staffActor.id,
      workspaceId: tenant.workspaceId,
      state: "delivered",
      ageMs: 40 * DAY_MS,
    });

    const recipientHold = await placeHold("person", heldRecipient.id);
    const customerOrgHold = await placeHold("organisation", customerOrg.id);
    const unrelatedHold = await placeHold("organisation", unrelatedOrg.id);

    const firstPass = await purgeNotificationAndOutboxRetention();
    expect(firstPass).toEqual({
      notificationDeliveriesPurged: 1,
      notificationDigestsPurged: 0,
      outboxEventsPurged: 1,
    });

    expect(
      await remainingDeliveries([
        recipientHeldDelivery.id,
        resourceHeldDelivery.id,
        unheldDelivery.id,
      ]),
    ).toEqual([recipientHeldDelivery.id, resourceHeldDelivery.id].sort());
    expect(await remainingDigests([recipientHeldDigest.id])).toEqual([
      recipientHeldDigest.id,
    ]);
    expect(
      await remainingOutbox([
        recipientHeldOutbox.eventId,
        resourceHeldOutbox.eventId,
        unheldOutbox.eventId,
      ]),
    ).toEqual([recipientHeldOutbox.eventId, resourceHeldOutbox.eventId].sort());

    // Lift holds and verify the retained rows now purge cleanly in child-before-parent order.
    await liftHold(recipientHold.id);
    await liftHold(customerOrgHold.id);
    await liftHold(unrelatedHold.id);

    const secondPass = await purgeNotificationAndOutboxRetention();
    expect(secondPass).toEqual({
      notificationDeliveriesPurged: 2,
      notificationDigestsPurged: 1,
      outboxEventsPurged: 2,
    });
  });

  it("conservatively retains rows with unresolved resource ownership while any legal hold is open, then purges once lifted", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const recipient = await personOf(user.id);
    const unrelatedOrg = await makeOrganisation("conservative-unrelated");

    // References a deleted/non-existent work item: ownership cannot be resolved.
    const orphanedOutbox = await insertOutboxRow({
      workspaceId: workspace.id,
      kind: "work_item.updated",
      state: "delivered",
      ageMs: 45 * DAY_MS,
      eventPayload: { workItemId: "deleted-work-item-id", key: "GONE-1" },
    });
    const orphanedDelivery = await insertDeliveryRow({
      eventId: orphanedOutbox.eventId,
      recipientPersonId: recipient.id,
      workspaceId: workspace.id,
      state: "delivered",
      ageMs: 45 * DAY_MS,
    });

    const hold = await placeHold("organisation", unrelatedOrg.id);

    expect(await purgeNotificationAndOutboxRetention()).toEqual({
      notificationDeliveriesPurged: 0,
      notificationDigestsPurged: 0,
      outboxEventsPurged: 0,
    });
    expect(await remainingDeliveries([orphanedDelivery.id])).toEqual([
      orphanedDelivery.id,
    ]);
    expect(await remainingOutbox([orphanedOutbox.eventId])).toEqual([
      orphanedOutbox.eventId,
    ]);

    await liftHold(hold.id);

    expect(await purgeNotificationAndOutboxRetention()).toEqual({
      notificationDeliveriesPurged: 1,
      notificationDigestsPurged: 0,
      outboxEventsPurged: 1,
    });
  });

  it("retains legacy task assignees, payload users, and deleted tasks under holds", async () => {
    const tenant = await buildTenant("legacy-holds");
    const heldMember = await createWorkspaceMember({ role: "member" });
    const heldPerson = await personOf(heldMember.user.id);
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: tenant.project.id,
          title: "Legacy",
          userId: heldMember.user.id,
        })
        .returning(),
      "legacy task",
    );
    const events = [];
    for (const eventPayload of [
      { taskId: task.id, newAssigneeId: heldMember.user.id },
      { taskId: task.id },
      { taskId: "deleted-task", newAssigneeId: tenant.requester.user.id },
      { taskId: task.id, newAssigneeId: "unresolved-user" },
    ]) {
      events.push(
        await insertOutboxRow({
          workspaceId: tenant.workspaceId,
          projectId: tenant.project.id,
          kind: "task.assignee_changed",
          state: "delivered",
          ageMs: 45 * DAY_MS,
          eventPayload,
        }),
      );
    }
    const hold = await placeHold("person", heldPerson.id);
    expect(await purgeTerminalOutboxEvents()).toBe(0);
    // Remove the live assignee to prove the payload user itself protects the event.
    await db
      .update(schema.taskTable)
      .set({ userId: null })
      .where(eq(schema.taskTable.id, task.id));
    expect(await purgeTerminalOutboxEvents()).toBe(1);
    expect(await remainingOutbox(events.map((e) => e.eventId))).toEqual(
      events
        .filter((_, index) => index !== 1)
        .map((event) => event.eventId)
        .sort(),
    );
    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));
    expect(await purgeTerminalOutboxEvents()).toBe(0);
    await liftHold(hold.id);
    expect(await purgeTerminalOutboxEvents()).toBe(3);
  });

  it("retains deleted operational owners conservatively and webhook payload owners directly", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const person = await personOf(user.id);
    const webhook = requireRow(
      await db
        .insert(webhookTable)
        .values({
          workspaceId: workspace.id,
          name: "Deleted hook",
          url: "https://hooks.example.com/p20",
          secret: "test",
          events: ["work_item.created"],
          createdBy: person.id,
        })
        .returning(),
      "hook",
    );
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: "workspace",
          workspaceId: workspace.id,
          key: randomUUID(),
          name: "Retention",
          rank: 10,
          capabilities: [],
        })
        .returning(),
      "role",
    );
    const automation = requireRow(
      await db
        .insert(automationTable)
        .values({
          workspaceId: workspace.id,
          name: "Deleted rule",
          trigger: "work_item.created",
          effectiveRoleId: role.id,
          createdBy: person.id,
        })
        .returning(),
      "automation",
    );
    const key = requireRow(
      await db
        .insert(schema.apikeyTable)
        .values({
          key: randomUUID(),
          userId: user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "key",
    );
    const action = requireRow(
      await db
        .insert(schema.pendingActionTable)
        .values({
          requestedByPersonId: person.id,
          credentialType: "session",
          origin: "web",
          action: "delete",
          targetType: "work_item",
          targetIds: [randomUUID()],
          payload: {},
          routeKey: "test",
          payloadHash: "a".repeat(64),
          payloadSummary: {},
          confirmationRequired: "click",
          traceId: randomUUID(),
          expiresAt: new Date(Date.now() + DAY_MS),
          workspaceId: workspace.id,
        })
        .returning(),
      "pending action",
    );
    const events = [];
    for (const [kind, eventPayload] of [
      [
        "webhook.auto_disabled",
        { webhookId: webhook.id, ownerPersonId: person.id },
      ],
      ["api_key.auto_disabled", { apiKeyId: key.id }],
      ["automation.run_failed", { automationId: automation.id }],
      ["pending_action.requested", { pendingActionId: action.id }],
    ] as const) {
      events.push(
        await insertOutboxRow({
          workspaceId: workspace.id,
          kind,
          eventPayload,
          state: "delivered",
          ageMs: 45 * DAY_MS,
        }),
      );
    }
    const unheldMember = await createWorkspaceMember({ role: "member" });
    const unheldPerson = await personOf(unheldMember.user.id);
    const unheld = await insertOutboxRow({
      workspaceId: workspace.id,
      kind: "webhook.auto_disabled",
      state: "delivered",
      ageMs: 45 * DAY_MS,
      eventPayload: {
        webhookId: "deleted-unheld-webhook",
        ownerPersonId: unheldPerson.id,
      },
    });
    const hold = await placeHold("person", person.id);
    expect(await purgeTerminalOutboxEvents()).toBe(1);
    expect(await remainingOutbox([unheld.eventId])).toEqual([]);
    await db.delete(webhookTable).where(eq(webhookTable.id, webhook.id));
    await db
      .delete(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, key.id));
    await db
      .delete(automationTable)
      .where(eq(automationTable.id, automation.id));
    await db
      .delete(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, action.id));
    expect(await purgeTerminalOutboxEvents()).toBe(0);
    expect(await remainingOutbox(events.map((e) => e.eventId))).toHaveLength(4);
    await liftHold(hold.id);
    expect(await purgeTerminalOutboxEvents()).toBe(4);
  });

  it.each(["Asia/Yangon", "America/New_York"] as const)(
    "bounds work per batch/run and compares UTC timestamps safely in %s",
    async (timezone) => {
      const { user, workspace } = await createWorkspaceMember({
        role: "owner",
      });
      const recipient = await personOf(user.id);

      // 5 eligible (>30d) chains + 1 boundary chain at 29d 21h (must survive even under +06:30 session TimeZone).
      const eligibleOutboxIds: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const outbox = await insertOutboxRow({
          workspaceId: workspace.id,
          state: "delivered",
          ageMs: (32 + i) * DAY_MS,
        });
        const digest = await insertDigestRow({
          recipientPersonId: recipient.id,
          workspaceId: workspace.id,
          state: "delivered",
          ageMs: (32 + i) * DAY_MS,
          windowOffsetHours: 20 + i,
        });
        await insertDeliveryRow({
          eventId: outbox.eventId,
          recipientPersonId: recipient.id,
          workspaceId: workspace.id,
          digestId: digest.id,
          state: "delivered",
          ageMs: (32 + i) * DAY_MS,
        });
        eligibleOutboxIds.push(outbox.eventId);
      }

      const nearBoundaryAgeMs = 29 * DAY_MS + 21 * HOUR_MS;
      const boundaryOutbox = await insertOutboxRow({
        workspaceId: workspace.id,
        state: "delivered",
        ageMs: nearBoundaryAgeMs,
      });
      const boundaryDigest = await insertDigestRow({
        recipientPersonId: recipient.id,
        workspaceId: workspace.id,
        state: "delivered",
        ageMs: nearBoundaryAgeMs,
        windowOffsetHours: 99,
      });
      const boundaryDelivery = await insertDeliveryRow({
        eventId: boundaryOutbox.eventId,
        recipientPersonId: recipient.id,
        workspaceId: workspace.id,
        digestId: boundaryDigest.id,
        state: "delivered",
        ageMs: nearBoundaryAgeMs,
      });

      const restoreTimezone = await setTestDatabaseTimezone(timezone);
      try {
        // Bounded to 2 batches * 2 rows = at most 4 rows per table in pass 1.
        const firstBounded = await purgeNotificationAndOutboxRetention({
          batchSize: 2,
          maxBatches: 2,
        });
        expect(firstBounded).toEqual({
          notificationDeliveriesPurged: 4,
          notificationDigestsPurged: 4,
          outboxEventsPurged: 4,
        });

        // Second pass finishes the 5th eligible chain while sparing the 29d21h boundary chain.
        const secondBounded = await purgeNotificationAndOutboxRetention({
          batchSize: 2,
          maxBatches: 2,
        });
        expect(secondBounded).toEqual({
          notificationDeliveriesPurged: 1,
          notificationDigestsPurged: 1,
          outboxEventsPurged: 1,
        });

        expect(await purgeTerminalNotificationDeliveries()).toBe(0);
        expect(await remainingDeliveries([boundaryDelivery.id])).toEqual([
          boundaryDelivery.id,
        ]);
        expect(await remainingDigests([boundaryDigest.id])).toEqual([
          boundaryDigest.id,
        ]);
        expect(
          await remainingOutbox([...eligibleOutboxIds, boundaryOutbox.eventId]),
        ).toEqual([boundaryOutbox.eventId]);
      } finally {
        await restoreTimezone();
      }
    },
  );
});
