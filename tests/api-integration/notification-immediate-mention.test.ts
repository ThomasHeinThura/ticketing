import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  getCanonicalPreferences,
  saveCanonicalPreference,
} from "../../apps/api/src/notification/canonical-preferences";
import { immediateNotificationRuntime } from "../../apps/api/src/notification/immediate-runtime";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { verifyNotificationPreferenceLink } from "../../apps/api/src/notification/preference-link";
import { readEmailProvider } from "../../apps/api/src/notification-provider/repository";
import { runtimeSmtpConfiguration } from "../../apps/api/src/notification-provider/runtime";
import { smtpConfigurationSchema } from "../../apps/api/src/notification-provider/schema";
import { updateEmailProvider } from "../../apps/api/src/notification-provider/service";
import { createComment } from "../../apps/api/src/work-item/controllers/create-comment";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { privateSmtpReceiver } from "./helpers/private-smtp";

// Use the real built email consumer and its actual Node singleton, not the legacy integration mock.
const email = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("@taskdesk/email") as typeof import("../../packages/email/src");
const preference = {
  eventKind: "work_item.mentioned" as const,
  channel: "notify.email" as const,
  scope: "global" as const,
  scopeId: null,
  enabled: true,
  digest: "off" as const,
};
beforeEach(resetTestDatabase);
afterEach(() => {
  email.setRuntimeSmtpResolver(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function fixture() {
  const actor = await createWorkspaceMember({ role: "admin" });
  const recipient = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: actor.workspace.id,
    userId: recipient.user.id,
    role: "member",
    joinedAt: new Date(),
  });
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  await grantWorkItemProjectAccess(actor.user.id, project.id);
  await grantWorkItemProjectAccess(recipient.user.id, project.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: actor.workspace.id,
        key: `synthetic-${randomUUID()}`,
        name: "Synthetic task",
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
        key: `synthetic-${randomUUID()}`,
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
        number: 1,
        key: `SYN-${randomUUID()}`,
        title: "Synthetic notification journey",
      })
      .returning(),
    "item",
  );
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, recipient.user.id)),
    "recipient person",
  );
  const author = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id)),
    "author person",
  );
  await updateEmailProvider(
    {
      version: 0,
      enabled: true,
      config: {
        host: "smtp.synthetic.example",
        port: 587,
        secure: false,
        requireTLS: false,
        username: null,
        fromAddress: "sender@example.test",
        replyTo: null,
      },
    },
    { userId: actor.user.id, personId: author.id },
  );
  await saveCanonicalPreference(recipient.user.id, preference);
  return { actor, recipient, person, item, project, author };
}
function privatePersistedProvider(
  smtp: Awaited<ReturnType<typeof privateSmtpReceiver>>,
  beforeConnect?: () => Promise<void>,
) {
  email.setRuntimeSmtpResolver(async () => {
    const row = await readEmailProvider();
    if (!row?.enabled) return null;
    const config = smtpConfigurationSchema.parse(row.config);
    if (beforeConnect) await beforeConnect();
    return runtimeSmtpConfiguration(config, null, {
      resolve: async () => [{ address: "198.51.100.20", family: 4 }],
      connect: (input, signal) =>
        email.openSmtpSocket(
          {
            ...input,
            host: "127.0.0.1",
            port: Number(smtp.config.options.port),
          },
          signal,
        ),
    });
  });
}
async function mention(f: Awaited<ReturnType<typeof fixture>>) {
  return createComment(
    f.item.id,
    f.actor.workspace.id,
    f.actor.user.id,
    "person",
    {
      visibility: "public",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Synthetic persisted mention " },
              { type: "taskdeskMention", attrs: { id: f.person.id } },
            ],
          },
        ],
      },
    },
  );
}
async function deliveryRows() {
  return (
    await db.execute<{
      id: string;
      state: string;
      attempts: number;
      event_id: string;
    }>(
      sql`SELECT id, state, attempts, event_id FROM notification_delivery ORDER BY id`,
    )
  ).rows;
}
function decodedMessage(message: string) {
  return message
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

describe("native persisted comment mention to immediate SMTP delivery", () => {
  it("creates a real child, sends a safe exact-comment/preference link, and leaves parent processing independent", async () => {
    const f = await fixture();
    const smtp = await privateSmtpReceiver();
    privatePersistedProvider(smtp);
    try {
      const comment = await mention(f);
      expect(await deliveryRows()).toHaveLength(1);
      const child = requireRow(await deliveryRows(), "child");
      const runtime = immediateNotificationRuntime(email.sendNotificationEmail);
      expect(await processNextNotificationDelivery(runtime)).toEqual({
        kind: "delivered",
      });
      expect(await deliveryRows()).toMatchObject([
        { id: child.id, state: "delivered", attempts: 1 },
      ]);
      expect(smtp.messages).toHaveLength(1);
      const message = decodedMessage(smtp.messages[0] ?? "");
      expect(message).toContain(`?comment=${comment.id}`);
      const token = message.match(/#preference_token=([A-Za-z0-9_.-]+)/u)?.[1];
      expect(token).toBeTruthy();
      expect(
        verifyNotificationPreferenceLink(token ?? "", "agent"),
      ).toMatchObject({
        recipientPersonId: f.person.id,
        selector: {
          eventKind: "work_item.mentioned",
          channel: "notify.email",
          scope: "global",
          scopeId: null,
        },
      });
      const parent = await db.execute(
        sql`SELECT state FROM outbox WHERE event_id = ${child.event_id}`,
      );
      expect(parent.rows[0]).toMatchObject({ state: "pending" });
      expect(await processNextNotificationDelivery(runtime)).toEqual({
        kind: "idle",
      });
      expect(smtp.messages).toHaveLength(1);
    } finally {
      await smtp.close();
    }
  });
  it("honors explicit canonical disable without reading or enabling legacy delivery preferences", async () => {
    const f = await fixture();
    await saveCanonicalPreference(f.recipient.user.id, {
      ...preference,
      enabled: false,
    });
    await mention(f);
    expect(await deliveryRows()).toHaveLength(0);
    expect(await getCanonicalPreferences(f.recipient.user.id)).toMatchObject([
      { enabled: false, source: "global" },
    ]);
    expect(
      (
        await db
          .select()
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.personId, f.person.id))
      ).length,
    ).toBe(1);
  });
  it.each(["disabled", "quiet_hours", "reach_lost"] as const)(
    "rechecks %s before provider I/O without consuming a provider attempt",
    async (change) => {
      const f = await fixture();
      await mention(f);
      const send = vi.fn();
      if (change === "disabled")
        await updateEmailProvider(
          { version: 1, enabled: false },
          { userId: f.actor.user.id, personId: f.author.id },
        );
      if (change === "quiet_hours")
        await db
          .update(schema.personTable)
          .set({
            quietHoursStart: "21:00",
            quietHoursEnd: "07:00",
            quietHoursTimezone: "Asia/Yangon",
          })
          .where(eq(schema.personTable.id, f.person.id));
      if (change === "reach_lost")
        await db
          .delete(schema.membershipTable)
          .where(
            and(
              eq(schema.membershipTable.personId, f.person.id),
              eq(schema.membershipTable.scope, "project"),
              eq(schema.membershipTable.scopeId, f.project.id),
            ),
          );
      const result = await processNextNotificationDelivery(
        immediateNotificationRuntime(send),
      );
      expect(result.kind).toBe(
        change === "disabled"
          ? "deferred"
          : change === "quiet_hours"
            ? "unresolved"
            : "suppressed",
      );
      expect(send).not.toHaveBeenCalled();
      expect(await deliveryRows()).toMatchObject([{ attempts: 0 }]);
    },
  );
  it.each(["reach", "email"] as const)(
    "rechecks %s after runtime provider resolution before opening an SMTP socket",
    async (change) => {
      const f = await fixture();
      await mention(f);
      const smtp = await privateSmtpReceiver();
      privatePersistedProvider(smtp, async () => {
        if (change === "reach")
          await db
            .delete(schema.membershipTable)
            .where(
              and(
                eq(schema.membershipTable.personId, f.person.id),
                eq(schema.membershipTable.scope, "project"),
                eq(schema.membershipTable.scopeId, f.project.id),
              ),
            );
        else
          await db
            .update(schema.userTable)
            .set({ email: "changed-synthetic@example.test" })
            .where(eq(schema.userTable.id, f.recipient.user.id));
      });
      try {
        expect(
          await processNextNotificationDelivery(
            immediateNotificationRuntime(email.sendNotificationEmail),
          ),
        ).toEqual({ kind: "retry", ambiguous: false });
        expect(smtp.messages).toHaveLength(0);
      } finally {
        await smtp.close();
      }
    },
  );

  it("retains an actual lost SMTP acknowledgement and retries with the same Message-ID", async () => {
    const f = await fixture();
    await mention(f);
    const child = requireRow(await deliveryRows(), "child");
    const receiverOptions = { holdAck: true };
    const smtp = await privateSmtpReceiver(receiverOptions);
    privatePersistedProvider(smtp);
    const send = (...args: Parameters<typeof email.sendNotificationEmail>) => {
      const [to, subject, data, options] = args;
      return email.sendNotificationEmail(to, subject, data, {
        ...options,
        deadlineMs: 100,
      });
    };
    const runtime = immediateNotificationRuntime(send);
    try {
      expect(await processNextNotificationDelivery(runtime)).toEqual({
        kind: "retry",
        ambiguous: true,
      });
      expect(smtp.messages).toHaveLength(1);
      const reservations = await db.execute(
        sql`SELECT owner_delivery_id FROM outbox_dedupe_reservation WHERE owner_delivery_id = ${child.id}`,
      );
      expect(reservations.rows).toHaveLength(1);
      expect(await deliveryRows()).toMatchObject([
        { id: child.id, state: "pending", attempts: 1 },
      ]);
      expect(await processNextNotificationDelivery(runtime)).toEqual({
        kind: "idle",
      });
      receiverOptions.holdAck = false;
      await db.execute(
        sql`UPDATE outbox_dedupe_reservation SET lease_expires_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE owner_delivery_id = ${child.id}`,
      );
      await db.execute(
        sql`UPDATE notification_delivery SET next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = ${child.id}`,
      );
      expect(await processNextNotificationDelivery(runtime)).toEqual({
        kind: "delivered",
      });
      expect(await deliveryRows()).toMatchObject([
        { id: child.id, state: "delivered", attempts: 2 },
      ]);
      expect(smtp.messages).toHaveLength(2);
      expect(smtp.messages[0]?.match(/Message-ID: (.+)/u)?.[1]).toBe(
        smtp.messages[1]?.match(/Message-ID: (.+)/u)?.[1],
      );
    } finally {
      await smtp.close();
    }
  });
  it("keeps independent children independent when one recipient fails", async () => {
    const f = await fixture();
    await mention(f);
    // A second genuine mention creates a second parent and delivery, rather than cloning a row.
    await mention(f);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error("synthetic provider failure"));
    const runtime = immediateNotificationRuntime(send);
    expect(await processNextNotificationDelivery(runtime)).toEqual({
      kind: "delivered",
    });
    expect(await processNextNotificationDelivery(runtime)).toEqual({
      kind: "retry",
      ambiguous: false,
    });
    expect((await deliveryRows()).map((r) => r.state).sort()).toEqual([
      "delivered",
      "pending",
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
