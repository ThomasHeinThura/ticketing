import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notificationDigestTable } from "../../apps/api/src/database/schema";
import type { DomainEventEnvelope } from "../../apps/api/src/events/outbox";
import { sealDueDigestGroups } from "../../apps/api/src/notification/digest-seal";
import { attachDigestWindow } from "../../apps/api/src/notification/digest-writer";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function seed() {
  const { user, workspace } = await createWorkspaceMember({ role: "owner" });
  const identity = await resolveRequestIdentity({ userId: user.id });
  if (!identity) throw new Error("fixture identity did not resolve");
  const event = {
    id: "event-1",
    kind: "work_item.commented",
    occurredAt: new Date().toISOString(),
    actor: { type: "system", id: null, name: "System" },
    scope: {
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
    },
    payload: {},
    causationId: null,
    depth: 0,
    originAutomationId: null,
  } as DomainEventEnvelope<Record<string, unknown>>;
  return { personId: identity.personId, event };
}

const attach = (
  ctx: Awaited<ReturnType<typeof seed>>,
  cadence: "hourly" | "daily" = "hourly",
  channel = "notify.email",
) =>
  db.transaction((tx) =>
    attachDigestWindow({
      tx,
      event: ctx.event,
      recipientPersonId: ctx.personId,
      channel,
      cadence,
    }),
  );

describe("NO-5 digest-window writer and NO-6 sealing", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("joins one collecting group per recipient, channel, workspace and window", async () => {
    const ctx = await seed();
    const first = await attach(ctx);
    const second = await attach(ctx);
    expect(second.id).toBe(first.id);
    const other = await attach(ctx, "hourly", "notify.webhook");
    expect(other.id).not.toBe(first.id);
    const daily = await attach(ctx, "daily");
    expect(daily.id).not.toBe(first.id);

    const [group] = await db
      .select()
      .from(notificationDigestTable)
      .where(eq(notificationDigestTable.id, first.id));
    expect(group).toMatchObject({
      state: "collecting",
      cadence: "hourly",
      channel: "notify.email",
      recipientPersonId: ctx.personId,
      attempts: 0,
    });
    // The window is exactly one hour and still open.
    expect(
      group && group.windowEndAt.getTime() - group.windowStartAt.getTime(),
    ).toBe(60 * 60 * 1000);
  });

  it("uses the person's zone, falling back to the instance zone, and stores it", async () => {
    const ctx = await seed();
    await db
      .update(schema.instanceSettingTable)
      .set({ timezone: "Asia/Yangon" })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const fromInstance = await attach(ctx);
    const [a] = await db
      .select({ tz: notificationDigestTable.timezone })
      .from(notificationDigestTable)
      .where(eq(notificationDigestTable.id, fromInstance.id));
    expect(a?.tz).toBe("Asia/Yangon");

    await db
      .update(schema.personTable)
      .set({ quietHoursTimezone: "Europe/London" })
      .where(eq(schema.personTable.id, ctx.personId));
    const fromPerson = await attach(ctx, "daily");
    const [b] = await db
      .select({ tz: notificationDigestTable.timezone })
      .from(notificationDigestTable)
      .where(eq(notificationDigestTable.id, fromPerson.id));
    expect(b?.tz).toBe("Europe/London");
  });

  it("moves to the next window when the current group is sealed", async () => {
    const ctx = await seed();
    const first = await attach(ctx);
    await db
      .update(notificationDigestTable)
      .set({ state: "pending" })
      .where(eq(notificationDigestTable.id, first.id));
    const next = await attach(ctx);
    expect(next.id).not.toBe(first.id);
    const [sealed, fresh] = await Promise.all([
      db
        .select()
        .from(notificationDigestTable)
        .where(eq(notificationDigestTable.id, first.id)),
      db
        .select()
        .from(notificationDigestTable)
        .where(eq(notificationDigestTable.id, next.id)),
    ]);
    expect(fresh[0]?.windowStartAt.getTime()).toBe(
      sealed[0]?.windowEndAt.getTime(),
    );
  });

  it("seals only groups whose window has ended, without calling a provider", async () => {
    const ctx = await seed();
    const open = await attach(ctx);
    const ended = await attach(ctx, "daily");
    await db.execute(sql`
      UPDATE notification_digest
         SET window_end_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'
       WHERE id = ${ended.id}
    `);
    expect(await sealDueDigestGroups()).toBe(1);
    const rows = await db
      .select({
        id: notificationDigestTable.id,
        state: notificationDigestTable.state,
      })
      .from(notificationDigestTable);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.state]))).toEqual({
      [open.id]: "collecting",
      [ended.id]: "pending",
    });
    expect(await sealDueDigestGroups()).toBe(0);
  });
});
