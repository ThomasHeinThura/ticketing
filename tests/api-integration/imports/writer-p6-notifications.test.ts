/**
 * P6-R2-01: imported events are history, not triggers. A full import run whose records carry a
 * matched assignee, comments that mention a person, state changes and a rerun (delta update)
 * creates no notification fan-out: no inbox row, no external delivery child, no digest. The same
 * assignment written natively still notifies, so the guard is the import source and nothing else.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createPersonalApiKey } from "../../../apps/api/src/api-key/service";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { saveCanonicalPreference } from "../../../apps/api/src/notification/canonical-preferences";
import { updateEmailProvider } from "../../../apps/api/src/notification-provider/service";
import { mockAuthenticatedSession } from "../helpers/auth";
import { resetTestDatabase } from "../helpers/database";
import {
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "../helpers/fixtures";
import {
  commitChunk,
  createRun,
  record,
  type WriterFixture,
  writerFixture,
} from "./writer-fixture";

beforeEach(async () => resetTestDatabase());

/** A second, active staff member who can be assigned and wants every channel it can get. */
async function notifiableMember(f: WriterFixture) {
  const { user } = await createWorkspaceMember({ role: "member" });
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: f.workspace.id,
    userId: user.id,
    role: "member",
    joinedAt: new Date(),
  });
  await grantWorkItemProjectAccess(user.id, f.project.id);
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id)),
    "member person",
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
    { userId: f.user.id, personId: f.person.id },
  );
  await saveCanonicalPreference(user.id, {
    eventKind: "work_item.mentioned",
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "off",
  });
  await saveCanonicalPreference(user.id, {
    eventKind: "work_item.commented",
    channel: "notify.email",
    scope: "global",
    scopeId: null,
    enabled: true,
    digest: "daily",
  });
  // Assignment email has no write API yet; the row is what the fan-out reads.
  await db.execute(sql`INSERT INTO notification_preference
    (person_id, scope, scope_id, channel, event_kind, enabled, digest)
    VALUES (${person.id}, 'global', NULL, 'notify.email', 'work_item.assigned', true, 'off')
    ON CONFLICT (person_id, scope, scope_id, channel, event_kind) DO UPDATE SET enabled = true, digest = 'off'`);
  return { user, person };
}

function mentionBody(personId: string, text: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text },
          { type: "taskdeskMention", attrs: { id: personId } },
        ],
      },
    ],
  };
}

async function fanoutCounts() {
  const count = async (
    table: "notification" | "notification_delivery" | "notification_digest",
  ) =>
    Number(
      (
        await db.execute<{ n: string }>(
          sql`SELECT count(*)::text AS n FROM ${sql.identifier(table)}`,
        )
      ).rows[0]?.n,
    );
  return {
    inbox: await count("notification"),
    deliveries: await count("notification_delivery"),
    digests: await count("notification_digest"),
  };
}

async function addState(f: WriterFixture, group: string) {
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: f.workspace.id,
        key: `p6n-${randomUUID()}`,
        name: group,
        group,
      })
      .returning(),
    "state template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId: f.project.id, stateTemplateId: template.id })
      .returning(),
    "state",
  );
}

describe("P6-R2-01: imports create no notification fan-out", () => {
  it("writes no inbox, delivery or digest rows for a full import run, while a native assignment still notifies", async () => {
    const f = await writerFixture();
    const member = await notifiableMember(f);
    const { app } = createApp();
    const done = await addState(f, "completed");

    // Assigning someone else needs `work_item:assign` on the importing key.
    const { key } = await createPersonalApiKey(
      { userId: f.user.id },
      {
        name: "notify import MCP",
        capabilities: [
          "instance:admin",
          "work_item:create",
          "work_item:read",
          "work_item:update",
          "work_item:assign",
        ],
        isMcp: true,
      },
    );
    const run = await createRun(app, f, "notify-import", key);
    const records = [
      record(f, "N-1", {
        assigneeEmail: member.user.email.toUpperCase(),
        comments: [
          {
            sourceId: "n1-c1",
            authorEmail: f.user.email,
            body: mentionBody(member.person.id, "Please look, "),
            visibility: "public",
          },
          {
            sourceId: "n1-c2",
            authorEmail: member.user.email,
            body: "Internal note by the assignee",
          },
        ],
      }),
      record(f, "N-2", {
        stateId: done.id,
        item: {
          typeId: f.type.id,
          title: "Imported closed item with assignee",
          assigneeId: member.person.id,
          startDate: "2020-01-01T00:00:00.000Z",
        },
        comments: [
          {
            sourceId: "n2-c1",
            authorEmail: f.user.email,
            body: mentionBody(member.person.id, "Done, thanks "),
            visibility: "public",
          },
        ],
      }),
    ];
    const { commit } = await commitChunk(app, f, run.id, "c1", records, key);
    expect(commit.counts).toMatchObject({ created: 2, rejected: 0 });

    // The import really assigned the member and wrote the comments: the zero below is not vacuous.
    const items = await Promise.all(
      commit.rows.map(async (row) =>
        requireRow(
          await db
            .select()
            .from(schema.workItemTable)
            .where(eq(schema.workItemTable.id, row.targetId as string)),
          "imported item",
        ),
      ),
    );
    expect(items.map((item) => item.assigneeId)).toEqual([
      member.person.id,
      member.person.id,
    ]);
    expect(await db.select().from(schema.commentTable)).toHaveLength(3);
    const outbox = await db.select().from(schema.outboxTable);
    expect(outbox.map((row) => row.kind)).toContain("work_item.assigned");

    // Rerun with a changed title (the delta/update path) and a second run.
    const rerun = await createRun(app, f, "notify-import", key);
    await commitChunk(
      app,
      f,
      rerun.id,
      "c1",
      [record(f, "N-1", {}, "Imported N-1, renamed at source")],
      key,
    );

    expect(await fanoutCounts()).toEqual({
      inbox: 0,
      deliveries: 0,
      digests: 0,
    });

    // Control: the same person assigned natively (the assign route) is notified.
    mockAuthenticatedSession(f.user);
    const created = await app.request(
      `/api/projects/${f.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typeId: f.type.id, title: "Native item" }),
      },
    );
    expect(created.status, await created.clone().text()).toBe(200);
    const native = (await created.json()) as { key: string };
    const assigned = await app.request(`/api/work-items/${native.key}/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assigneeId: member.person.id }),
    });
    expect(assigned.status, await assigned.clone().text()).toBe(200);
    const inbox = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, member.user.id));
    expect(inbox.map((row) => row.kind)).toEqual(["work_item.assigned"]);
    const after = await fanoutCounts();
    expect(after.inbox).toBe(1);
    expect(after.deliveries).toBeGreaterThanOrEqual(1);
  });
});
