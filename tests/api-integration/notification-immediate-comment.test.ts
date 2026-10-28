import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { saveCanonicalPreference } from "../../apps/api/src/notification/canonical-preferences";
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

const email = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("@taskdesk/email") as typeof import("../../packages/email/src");

beforeEach(resetTestDatabase);
afterEach(() => {
  email.setRuntimeSmtpResolver(undefined);
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
        key: `comment-${randomUUID()}`,
        name: "Comment test type",
        category: "delivery",
      })
      .returning(),
    "work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: actor.workspace.id,
        key: `comment-${randomUUID()}`,
        name: "Comment test backlog",
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
        key: `CMT-${randomUUID().slice(0, 8)}`,
        title: "Immediate comment work item",
      })
      .returning(),
    "work item",
  );
  const recipientPerson = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, recipient.user.id)),
    "recipient person",
  );
  const actorPerson = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id)),
    "actor person",
  );
  await db.insert(schema.watcherTable).values({
    workItemId: item.id,
    personId: recipientPerson.id,
    source: "explicit",
    muted: false,
  });
  await saveCanonicalPreference(recipient.user.id, {
    eventKind: "work_item.commented",
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "off",
  });
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
    { userId: actor.user.id, personId: actorPerson.id },
  );
  const comment = await createComment(
    item.id,
    actor.workspace.id,
    actor.user.id,
    "person",
    {
      visibility: "public",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "A public update" }],
          },
        ],
      },
    },
  );
  const rows = await db.execute<{ eventId: string }>(sql`
    SELECT event_id AS "eventId" FROM outbox
     WHERE kind = 'work_item.commented'
       AND payload->'payload'->>'commentId' = ${comment.id}
  `);
  const eventId = rows.rows[0]?.eventId;
  if (!eventId) throw new Error("Comment notification event was not persisted");
  return {
    actor,
    recipient,
    recipientPerson,
    actorPerson,
    item,
    comment,
    eventId,
  };
}

function captureWithPrivateSmtp(
  smtp: Awaited<ReturnType<typeof privateSmtpReceiver>>,
) {
  email.setRuntimeSmtpResolver(async () => {
    const row = await readEmailProvider();
    if (!row?.enabled) return null;
    const config = smtpConfigurationSchema.parse(row.config);
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

function decodeQuotedPrintable(message: string) {
  return message
    .replace(/=\r\n/g, "")
    .replace(/=([0-9A-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

describe("immediate canonical comment email", () => {
  it("delivers digest=off immediately with a comment-specific preference link", async () => {
    const f = await fixture();
    const smtp = await privateSmtpReceiver();
    captureWithPrivateSmtp(smtp);
    try {
      const result = await processNextNotificationDelivery(
        immediateNotificationRuntime(email.sendNotificationEmail),
      );
      expect(result).toEqual({ kind: "delivered" });
      const rows = await db.execute(sql`
        SELECT state, attempts, digest_id AS "digestId"
          FROM notification_delivery WHERE event_id = ${f.eventId}
      `);
      expect(rows.rows).toEqual([
        { state: "delivered", attempts: 1, digestId: null },
      ]);
      expect(smtp.messages).toHaveLength(1);
      const message = decodeQuotedPrintable(smtp.messages[0] ?? "");
      expect(message).toContain(
        `/agent/work-items/${encodeURIComponent(f.item.key)}?comment=${encodeURIComponent(f.comment.id)}`,
      );
      const token = message.match(/#preference_token=([A-Za-z0-9_.-]+)/u)?.[1];
      expect(token).toBeTruthy();
      expect(
        verifyNotificationPreferenceLink(token ?? "", "agent"),
      ).toMatchObject({
        recipientPersonId: f.recipientPerson.id,
        selector: {
          eventKind: "work_item.commented",
          channel: "notify.email",
          scope: "global",
          scopeId: null,
        },
      });
    } finally {
      await smtp.close();
    }
  });
});
