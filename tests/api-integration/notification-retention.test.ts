import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notificationDeliveryTable } from "../../apps/api/src/database/schema";
import { enqueueOutboxEvent } from "../../apps/api/src/events/outbox";
import { purgeReadNotifications } from "../../apps/api/src/notification/retention";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

async function seed() {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const identity = await resolveRequestIdentity({ userId: user.id });
  if (!identity) throw new Error("fixture identity did not resolve");
  const [person] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.id, identity.personId));
  if (!person) throw new Error("fixture person missing");
  return { user, workspace, person };
}

async function insertNotification(
  ctx: Awaited<ReturnType<typeof seed>>,
  id: string,
  options: {
    readDaysAgo: number | null;
    resourceType?: string;
    resourceId?: string;
  },
) {
  await db.insert(schema.notificationTable).values({
    id,
    userId: ctx.user.id,
    personId: ctx.person.id,
    type: "info",
    title: id,
    resourceType: options.resourceType ?? "person",
    resourceId: options.resourceId ?? ctx.person.id,
    isRead: options.readDaysAgo !== null,
    readAt:
      options.readDaysAgo === null
        ? null
        : new Date(Date.now() - options.readDaysAgo * DAY_MS),
  });
}

async function remaining(ids: string[]) {
  const rows = await db
    .select({ id: schema.notificationTable.id })
    .from(schema.notificationTable)
    .where(inArray(schema.notificationTable.id, ids));
  return rows.map((r) => r.id).sort();
}

async function setRetention(days: number) {
  await db
    .update(schema.instanceSettingTable)
    .set({ notificationRetentionDays: days })
    .where(eq(schema.instanceSettingTable.id, "singleton"));
}

describe("NO-17 read-notification retention", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("with the 90-day default purges only read rows older than 90 days", async () => {
    const ctx = await seed();
    await insertNotification(ctx, "old-read", { readDaysAgo: 91 });
    await insertNotification(ctx, "recent-read", { readDaysAgo: 89 });
    await insertNotification(ctx, "old-unread", { readDaysAgo: null });
    await db
      .update(schema.notificationTable)
      .set({ createdAt: new Date(Date.now() - 400 * DAY_MS) })
      .where(eq(schema.notificationTable.id, "old-unread"));

    expect(await purgeReadNotifications()).toBe(1);
    expect(await remaining(["old-read", "recent-read", "old-unread"])).toEqual([
      "old-unread",
      "recent-read",
    ]);
  });

  it("with 30 days configured purges a row read 31 days ago and keeps an unread one", async () => {
    const ctx = await seed();
    await setRetention(30);
    await insertNotification(ctx, "read-31", { readDaysAgo: 31 });
    await insertNotification(ctx, "read-29", { readDaysAgo: 29 });
    await insertNotification(ctx, "unread-old", { readDaysAgo: null });
    await purgeReadNotifications();
    expect(await remaining(["read-31", "read-29", "unread-old"])).toEqual([
      "read-29",
      "unread-old",
    ]);
  });

  it("changing the value changes the next cutoff but never makes unread rows eligible", async () => {
    const ctx = await seed();
    await insertNotification(ctx, "read-40", { readDaysAgo: 40 });
    await insertNotification(ctx, "unread", { readDaysAgo: null });
    await purgeReadNotifications();
    expect(await remaining(["read-40", "unread"])).toEqual([
      "read-40",
      "unread",
    ]);
    await setRetention(7);
    await purgeReadNotifications();
    expect(await remaining(["read-40", "unread"])).toEqual(["unread"]);
  });

  it("P4R1-L4: keeps a read row while an external child of it is still pending, then purges it", async () => {
    const ctx = await seed();
    const eventId = `evt_${crypto.randomUUID()}`;
    await db.transaction((tx) =>
      enqueueOutboxEvent(tx, {
        id: eventId,
        kind: "work_item.mentioned",
        occurredAt: new Date().toISOString(),
        actor: { type: "system", id: null, name: "System" },
        scope: { workspaceId: ctx.workspace.id },
        payload: {},
        causationId: null,
        depth: 0,
        originAutomationId: null,
      }),
    );
    await insertNotification(ctx, "read-with-child", { readDaysAgo: 200 });
    await db
      .update(schema.notificationTable)
      .set({ eventId })
      .where(eq(schema.notificationTable.id, "read-with-child"));
    const [child] = await db
      .insert(notificationDeliveryTable)
      .values({
        eventId,
        recipientPersonId: ctx.person.id,
        channel: "notify.email",
        workspaceId: ctx.workspace.id,
        dedupeKey: `dedupe-${eventId}`,
        state: "pending",
      })
      .returning();

    expect(await purgeReadNotifications()).toBe(0);
    expect(await remaining(["read-with-child"])).toEqual(["read-with-child"]);

    await db
      .update(notificationDeliveryTable)
      .set({ state: "delivered", deliveredAt: new Date() })
      .where(eq(notificationDeliveryTable.id, child?.id as string));
    expect(await purgeReadNotifications()).toBe(1);
    expect(await remaining(["read-with-child"])).toEqual([]);
  });

  it("an open person hold retains that person's old read notifications", async () => {
    const ctx = await seed();
    await insertNotification(ctx, "held-person", { readDaysAgo: 200 });
    await db.insert(schema.legalHoldTable).values({
      scope: "person",
      scopeId: ctx.person.id,
      placedBy: "test",
      reason: "test hold",
    });
    expect(await purgeReadNotifications()).toBe(0);
    expect(await remaining(["held-person"])).toEqual(["held-person"]);
    await db
      .update(schema.legalHoldTable)
      .set({ liftedAt: new Date(), liftedBy: "test" });
    expect(await purgeReadNotifications()).toBe(1);
  });

  it("an open organisation hold retains rows for staff recipients through the resource owner", async () => {
    const ctx = await seed();
    const [workspaceRow] = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, ctx.workspace.id));
    if (!workspaceRow) throw new Error("workspace missing");
    // A workspace notification references the workspace's organisation.
    await insertNotification(ctx, "held-org", {
      readDaysAgo: 200,
      resourceType: "workspace",
      resourceId: ctx.workspace.id,
    });
    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: workspaceRow.organisationId,
      placedBy: "test",
      reason: "test hold",
    });
    expect(await purgeReadNotifications()).toBe(0);
    expect(await remaining(["held-org"])).toEqual(["held-org"]);
  });

  it("a resource whose owner cannot be resolved is retained while any hold is open", async () => {
    const ctx = await seed();
    await insertNotification(ctx, "orphaned", {
      readDaysAgo: 200,
      resourceType: "work_item",
      resourceId: "no-such-item",
    });
    expect(await purgeReadNotifications()).toBe(1);

    await insertNotification(ctx, "orphaned-2", {
      readDaysAgo: 200,
      resourceType: "work_item",
      resourceId: "no-such-item-2",
    });
    await db.insert(schema.legalHoldTable).values({
      scope: "organisation",
      scopeId: "unrelated-organisation",
      placedBy: "test",
      reason: "test hold",
    });
    expect(await purgeReadNotifications()).toBe(0);
    expect(await remaining(["orphaned-2"])).toEqual(["orphaned-2"]);
  });

  it("a missing settings row deletes nothing (fail closed)", async () => {
    const ctx = await seed();
    await insertNotification(ctx, "old-read", { readDaysAgo: 500 });
    await db
      .delete(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(await purgeReadNotifications()).toBe(0);
    expect(await remaining(["old-read"])).toEqual(["old-read"]);
  });
});
