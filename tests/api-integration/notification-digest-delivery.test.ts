import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfiguredAgentOrigin } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import type { ClaimedNotificationDelivery } from "../../apps/api/src/database/repositories/notification-delivery.repository";
import {
  notificationDeliveryTable,
  notificationPreferenceTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { saveCanonicalPreference } from "../../apps/api/src/notification/canonical-preferences";
import { evaluateCurrentNotificationReachAndPreference } from "../../apps/api/src/notification/current-eligibility";
import { processNextNotificationDigest } from "../../apps/api/src/notification/digest-delivery";
import { sealDueDigestGroups } from "../../apps/api/src/notification/digest-seal";
import { enqueueNotificationEvent } from "../../apps/api/src/notification/fanout";
import { listVisibleNotificationInbox } from "../../apps/api/src/notification/inbox.repository";
import { verifyNotificationPreferenceLink } from "../../apps/api/src/notification/preference-link";
import { resolveWorkItemEventRecipients } from "../../apps/api/src/notification/work-item-recipients";
import { updateEmailProvider } from "../../apps/api/src/notification-provider/service";
import { createComment } from "../../apps/api/src/work-item/controllers/create-comment";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

type DigestEmailSend =
  typeof import("../../packages/email/src").sendNotificationEmail;

beforeEach(resetTestDatabase);

/**
 * A customer is notified only about their own linked request (`customerRequestOwnerPersonIds`):
 * the work item must carry the accepted submission the customer raised.
 */
async function linkCustomerRequestSubmission(input: {
  workspaceId: string;
  organisationId: string;
  workItemTypeId: string;
  workItemId: string;
  requesterId: string;
}) {
  const requestType = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: input.workspaceId,
        key: `customer-digest-request-${randomUUID()}`,
        name: "Customer request",
        group: "General",
        workItemTypeId: input.workItemTypeId,
        formSchema: { fields: [] },
        published: true,
        customerVisible: true,
      })
      .returning(),
    "linked customer request type",
  );
  const version = requireRow(
    await db
      .insert(schema.requestTypeVersionTable)
      .values({
        workspaceId: input.workspaceId,
        requestTypeId: requestType.id,
        number: 1,
        formSchema: { fields: [] },
        workItemTypeId: input.workItemTypeId,
      })
      .returning(),
    "linked customer request type version",
  );
  await db.insert(schema.submissionTable).values({
    organisationId: input.organisationId,
    requesterId: input.requesterId,
    requestTypeId: requestType.id,
    requestTypeVersionId: version.id,
    formData: {},
    state: "accepted",
    submittedAt: new Date(),
    customerVisibility: "organisation",
    workItemId: input.workItemId,
  });
}
afterEach(() => vi.restoreAllMocks());

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
        key: `digest-${randomUUID()}`,
        name: "Digest test type",
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
        key: `digest-${randomUUID()}`,
        name: "Digest test backlog",
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
        key: `DIG-${randomUUID().slice(0, 8)}`,
        title: "Private work item title that must not be emailed",
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
    digest: "hourly",
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
  return { actor, recipient, recipientPerson, actorPerson, item, project };
}

async function createDigestCandidate(f: Awaited<ReturnType<typeof fixture>>) {
  const comment = await createComment(
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
            content: [{ type: "text", text: "Synthetic public comment body" }],
          },
        ],
      },
    },
  );
  const rows = await db.execute<{
    id: string;
    event_id: string;
    digest_id: string | null;
  }>(sql`
    SELECT d.id, d.event_id, d.digest_id
      FROM notification_delivery d JOIN outbox o ON o.event_id = d.event_id
     WHERE o.kind = 'work_item.commented'
       AND o.payload->'payload'->>'commentId' = ${comment.id}
       AND d.recipient_person_id = ${f.recipientPerson.id}
  `);
  const delivery = rows.rows[0];
  if (!delivery?.digest_id)
    throw new Error("Digest candidate was not materialized");
  await db.execute(sql`
    UPDATE notification_digest
       SET window_end_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute',
           next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'
     WHERE id = ${delivery.digest_id}
  `);
  await sealDueDigestGroups();
  return {
    eventId: delivery.event_id,
    deliveryId: delivery.id,
    digestId: delivery.digest_id,
  };
}

async function customerDigestFixture() {
  const actor = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: actor.workspace.organisationId })
    .where(eq(schema.projectTable.id, project.id));
  const actorPerson = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id)),
    "customer digest actor",
  );
  const customerUser = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `digest-customer-${randomUUID()}`,
        name: "Portal customer",
        email: `digest-customer-${randomUUID()}@example.test`,
      })
      .returning(),
    "customer digest user",
  );
  const customerPerson = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: customerUser.id,
        organisationId: actor.workspace.organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "customer digest person",
  );
  await grantCustomerOrganisationMembership(
    actor.workspace.organisationId,
    customerPerson.id,
  );
  await grantWorkItemProjectAccess(actor.user.id, project.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: actor.workspace.id,
        key: `customer-digest-${randomUUID()}`,
        name: "Request",
        category: "delivery",
      })
      .returning(),
    "customer digest type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: actor.workspace.id,
        key: `customer-digest-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "customer digest state template",
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
    "customer digest state",
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
        key: `REQ-${randomUUID().slice(0, 8)}`,
        title: "Private title must not enter customer email",
        requesterId: customerPerson.id,
        customerVisibility: "organisation",
      })
      .returning(),
    "customer digest work item",
  );
  await linkCustomerRequestSubmission({
    workspaceId: actor.workspace.id,
    organisationId: actor.workspace.organisationId,
    workItemTypeId: type.id,
    workItemId: item.id,
    requesterId: customerPerson.id,
  });
  await db.insert(notificationPreferenceTable).values({
    personId: customerPerson.id,
    scope: "global",
    scopeId: null,
    channel: "notify.email",
    eventKind: "work_item.commented",
    enabled: true,
    digest: "hourly",
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
            content: [{ type: "text", text: "A public customer update" }],
          },
        ],
      },
    },
  );
  const rows = await db.execute<{
    id: string;
    event_id: string;
    digest_id: string | null;
  }>(sql`
    SELECT d.id, d.event_id, d.digest_id FROM notification_delivery d
    JOIN outbox o ON o.event_id = d.event_id
    WHERE o.kind = 'work_item.commented'
      AND o.payload->'payload'->>'commentId' = ${comment.id}
      AND d.recipient_person_id = ${customerPerson.id}
  `);
  const candidate = rows.rows[0];
  if (!candidate?.digest_id)
    throw new Error("Customer digest candidate missing");
  await db.execute(sql`
    UPDATE notification_digest
       SET window_end_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute',
           next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'
     WHERE id = ${candidate.digest_id}
  `);
  await sealDueDigestGroups();
  return { actor, customerUser, customerPerson, candidate, item };
}

async function customerTransitionDigestFixture() {
  const actor = await createWorkspaceMember({ role: "admin" });
  const { project } = await createProjectFixture({
    workspaceId: actor.workspace.id,
  });
  await db
    .update(schema.projectTable)
    .set({ organisationId: actor.workspace.organisationId })
    .where(eq(schema.projectTable.id, project.id));
  const actorPerson = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, actor.user.id)),
    "customer transition actor person",
  );
  const customerUser = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: `transition-customer-${randomUUID()}`,
        name: "Portal customer",
        email: `transition-customer-${randomUUID()}@example.test`,
      })
      .returning(),
    "customer transition user",
  );
  const customerPerson = requireRow(
    await db
      .insert(schema.personTable)
      .values({
        userId: customerUser.id,
        organisationId: actor.workspace.organisationId,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .returning(),
    "customer transition person",
  );
  await grantCustomerOrganisationMembership(
    actor.workspace.organisationId,
    customerPerson.id,
  );
  await grantWorkItemProjectAccess(actor.user.id, project.id);
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: actor.workspace.id,
        key: `customer-transition-${randomUUID()}`,
        name: "Request",
        category: "delivery",
      })
      .returning(),
    "customer transition type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: actor.workspace.id,
        key: `customer-transition-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
      })
      .returning(),
    "customer transition state template",
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
    "customer transition state",
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
        key: `REQ-${randomUUID().slice(0, 8)}`,
        title: "Private request title",
        requesterId: customerPerson.id,
        customerVisibility: "organisation",
      })
      .returning(),
    "customer transition work item",
  );
  await linkCustomerRequestSubmission({
    workspaceId: actor.workspace.id,
    organisationId: actor.workspace.organisationId,
    workItemTypeId: type.id,
    workItemId: item.id,
    requesterId: customerPerson.id,
  });
  await db.insert(schema.watcherTable).values({
    workItemId: item.id,
    personId: customerPerson.id,
    source: "explicit",
    muted: false,
  });
  await db.insert(notificationPreferenceTable).values({
    personId: customerPerson.id,
    scope: "global",
    scopeId: null,
    channel: "notify.email",
    eventKind: "work_item.transitioned",
    enabled: true,
    digest: "hourly",
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
  const eventId = `transition-${randomUUID()}`;
  const event = {
    id: eventId,
    kind: "work_item.transitioned" as const,
    occurredAt: new Date().toISOString(),
    actor: {
      type: "person" as const,
      id: actor.user.id,
      name: actor.user.name,
    },
    scope: {
      workspaceId: actor.workspace.id,
      projectId: project.id,
      organisationId: actor.workspace.organisationId,
    },
    payload: { key: item.key, workItemId: item.id },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
  await db.transaction((tx) =>
    enqueueNotificationEvent(tx, event, {
      resolveRecipients: resolveWorkItemEventRecipients,
    }),
  );
  const delivery = requireRow(
    await db
      .select()
      .from(notificationDeliveryTable)
      .where(eq(notificationDeliveryTable.eventId, eventId)),
    "customer transition digest delivery",
  );
  if (!delivery.digestId)
    throw new Error("Customer transition digest candidate missing");
  await db.execute(sql`
    UPDATE notification_digest
       SET window_end_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute',
           next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'
     WHERE id = ${delivery.digestId}
  `);
  await sealDueDigestGroups();
  return { actor, customerUser, customerPerson, item, eventId, delivery };
}

describe("persisted notification digest delivery", () => {
  it("suppresses a queued termized customer digest when organisation reach is revoked", async () => {
    const f = await customerTransitionDigestFixture();
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, f.customerPerson.id),
          eq(schema.membershipTable.scope, "organisation"),
          eq(schema.membershipTable.scopeId, f.actor.workspace.organisationId),
        ),
      );
    const send = vi.fn(async () => ({ success: true as const }));
    await expect(processNextNotificationDigest(send)).resolves.toMatchObject({
      kind: "claimed",
      outcome: "suppressed",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("uses a post-enqueue workspace rename at inbox and digest send time", async () => {
    const f = await customerTransitionDigestFixture();
    const sessionNow = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${f.actor.user.id}`,
      token: `token-${f.actor.user.id}`,
      userId: f.actor.user.id,
      portal: "agent",
      expiresAt: new Date(sessionNow.getTime() + 3_600_000),
      createdAt: sessionNow,
      updatedAt: sessionNow,
    });
    const literal = '$t(term:agent.work_item, {"count":1})';
    const systemCopy = {
      version: 1,
      title: [
        { kind: "term", termKey: "request", count: 1 },
        { kind: "text", text: " update" },
      ],
      body: [
        { kind: "text", text: "A " },
        { kind: "term", termKey: "request", count: 1 },
        { kind: "text", text: ` message: ${literal}` },
      ],
    } as const;
    const persistedNotice = requireRow(
      await db
        .select()
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.eventId, f.eventId)),
      "customer transition notification",
    );
    expect(persistedNotice.eventData).toMatchObject({
      systemCopy: {
        version: 1,
        title: [
          { kind: "term", termKey: "request", count: 1 },
          { kind: "text", text: " updated" },
        ],
      },
    });
    await db
      .update(schema.notificationTable)
      .set({ eventData: { systemCopy } })
      .where(eq(schema.notificationTable.eventId, f.eventId));

    mockAuthenticatedSession(f.actor.user);
    const { app } = createApp();
    const cookie = `__Host-tdk_agent_session=token-${f.actor.user.id}`;
    const terminologyPath = `/api/workspaces/${f.actor.workspace.id}/terminology`;
    const initial = await app.request(
      new URL(terminologyPath, getConfiguredAgentOrigin()),
      {
        headers: {
          cookie,
          host: new URL(getConfiguredAgentOrigin()).host,
        },
      },
    );
    expect(initial.status).toBe(200);
    const current = (await initial.json()) as { etag: string };
    const rename = await csrfRequest(
      app,
      terminologyPath,
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          expectedEtag: current.etag,
          override: {
            audience: "customer",
            termKey: "request",
            locale: "en-US",
            forms: { one: "Case", other: "Cases" },
          },
        }),
      },
      cookie,
    );
    expect(rename.status, await rename.clone().text()).toBe(200);

    const visibleProjection = await listVisibleNotificationInbox({
      userId: f.customerUser.id,
      credentialCanReadTask: true,
      filter: "all",
      limit: 50,
    });
    const notice = visibleProjection.rows
      .map(({ notification }) => notification)
      .find((row) => row.eventId === f.eventId);
    expect(notice).toMatchObject({
      title: "Case update",
      content: `A Case message: ${literal}`,
    });
    expect(JSON.stringify(notice)).not.toContain("systemCopy");

    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    await expect(processNextNotificationDigest(send)).resolves.toMatchObject({
      kind: "claimed",
      outcome: "delivered",
    });
    const [, subject, data] = send.mock.calls[0] ?? [];
    expect(subject.toLowerCase()).toContain("case summary");
    expect(data.message.toLowerCase()).toContain("case updates: 1");
    expect(data.message.toLowerCase()).not.toContain("request updates");
    expect(subject).not.toContain(literal);
    expect(data.message).not.toContain(literal);
  });

  it("sends customer counts only to the authenticated portal with a customer preference token", async () => {
    const f = await customerDigestFixture();
    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    await expect(processNextNotificationDigest(send)).resolves.toMatchObject({
      kind: "claimed",
      outcome: "delivered",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [to, subject, data] = send.mock.calls[0] ?? [];
    expect(to).toBe(f.customerUser.email);
    expect(subject).toBe("Your hourly request summary: 1 update");
    expect(data.actionUrl).toMatch(/portal\.localhost.*\/requests$/u);
    expect(data.message).toBe("New comments: 1");
    expect(JSON.stringify(data)).not.toContain("Private title");
    expect(JSON.stringify(data)).not.toContain(f.item.key);
    const token = String(data.preferenceUrl).match(
      /#preference_token=([A-Za-z0-9_.-]+)/u,
    )?.[1];
    expect(
      verifyNotificationPreferenceLink(token ?? "", "customer"),
    ).toMatchObject({
      recipientPersonId: f.customerPerson.id,
      selector: {
        eventKind: "work_item.commented",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
      },
    });
    expect(String(data.preferenceUrl)).toContain("/account#preference_token=");
  });

  it("sends one bounded summary with the same retry identity and leaves member attempts at zero", async () => {
    const f = await fixture();
    const candidate = await createDigestCandidate(f);
    const memberRow = await db.execute<
      ClaimedNotificationDelivery & { payload: unknown }
    >(sql`
      SELECT d.id, d.event_id AS "eventId", d.recipient_person_id AS "recipientPersonId",
             d.channel, d.workspace_id AS "workspaceId", d.organisation_id AS "organisationId",
             d.dedupe_key AS "dedupeKey", d.attempts, o.kind AS "eventKind", o.payload,
             n.title, n.body, n.resource_type AS "resourceType", n.resource_id AS "resourceId"
        FROM notification_delivery d JOIN outbox o ON o.event_id = d.event_id
        JOIN notification n ON n.event_id = d.event_id AND n.person_id = d.recipient_person_id
       WHERE d.id = ${candidate.deliveryId}
    `);
    const eligibility = await db.transaction((tx) =>
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...(memberRow.rows[0] as ClaimedNotificationDelivery),
        payload: memberRow.rows[0]
          ?.payload as ClaimedNotificationDelivery["payload"],
      }),
    );
    if (eligibility.kind === "suppress") throw new Error(eligibility.reason);
    expect(eligibility).toMatchObject({ kind: "eligible" });
    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    const deliveryResult = await processNextNotificationDigest(send);
    if (
      deliveryResult.kind === "claimed" &&
      deliveryResult.outcome === "deferred"
    ) {
      const reason = await db.execute(
        sql`SELECT last_error FROM notification_digest LIMIT 1`,
      );
      throw new Error(
        String(
          (reason.rows[0] as { last_error?: string } | undefined)?.last_error,
        ),
      );
    }
    expect(deliveryResult).toMatchObject({
      kind: "claimed",
      outcome: "delivered",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [, subject, message] = send.mock.calls[0] ?? [];
    const serialized = JSON.stringify({ subject, message });
    expect(serialized).toContain("Your hourly summary: 1 update");
    expect(serialized).toContain("New comments: 1");
    expect(serialized).not.toContain("PRIVATE TITLE");
    expect(serialized).not.toContain("PRIVATE BODY");
    const rows = await db.execute(sql`
      SELECT d.state AS "deliveryState", d.attempts AS "deliveryAttempts",
             g.state AS "digestState", g.attempts AS "digestAttempts"
        FROM notification_delivery d
        JOIN notification_digest g ON g.id = d.digest_id
       WHERE d.id = ${candidate.deliveryId}
    `);
    expect(rows.rows[0]).toMatchObject({
      deliveryState: "delivered",
      deliveryAttempts: 0,
      digestState: "delivered",
      digestAttempts: 1,
    });
    expect(await processNextNotificationDigest(send)).toEqual({ kind: "idle" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent group claims so one external call owns the group", async () => {
    const f = await fixture();
    await createDigestCandidate(f);
    let releaseProvider!: () => void;
    const waiting = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const send = vi.fn(async (_to, _subject, _data, options) => {
      await options.authorize?.();
      await waiting;
      return { success: true as const };
    });
    const first = processNextNotificationDigest(send);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await expect(processNextNotificationDigest(send)).resolves.toEqual({
      kind: "idle",
    });
    releaseProvider();
    await expect(first).resolves.toMatchObject({ outcome: "delivered" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries a failed group with a stable payload identity and one durable group attempt", async () => {
    const f = await fixture();
    const candidate = await createDigestCandidate(f);
    let firstIdentity: string | undefined;
    const failedSend: DigestEmailSend = async (
      _to,
      _subject,
      _data,
      options,
    ) => {
      firstIdentity = options?.idempotencyKey;
      throw new Error("synthetic SMTP failure");
    };
    await expect(
      processNextNotificationDigest(failedSend),
    ).resolves.toMatchObject({
      kind: "claimed",
      outcome: "retry",
    });
    const failedState = await db.execute(sql`
      SELECT g.state AS "digestState", g.attempts AS "digestAttempts",
             d.state AS "deliveryState", d.attempts AS "deliveryAttempts"
        FROM notification_digest g
        JOIN notification_delivery d ON d.digest_id = g.id
       WHERE g.id = ${candidate.digestId} AND d.id = ${candidate.deliveryId}
    `);
    expect(failedState.rows[0]).toEqual({
      digestState: "pending",
      digestAttempts: 1,
      deliveryState: "pending",
      deliveryAttempts: 0,
    });
    await db.execute(sql`
      UPDATE notification_digest
         SET next_attempt_at = (clock_timestamp() AT TIME ZONE 'UTC') - interval '1 minute'
       WHERE id = ${candidate.digestId}
    `);
    let secondIdentity: string | undefined;
    const succeedSend: DigestEmailSend = async (
      _to,
      _subject,
      _data,
      options,
    ) => {
      secondIdentity = options?.idempotencyKey;
      return { success: true };
    };
    await expect(
      processNextNotificationDigest(succeedSend),
    ).resolves.toMatchObject({
      kind: "claimed",
      outcome: "delivered",
    });
    expect(firstIdentity).toBeTruthy();
    expect(secondIdentity).toBe(firstIdentity);
    const completed = await db.execute(sql`
      SELECT state, attempts FROM notification_digest WHERE id = ${candidate.digestId}
    `);
    expect(completed.rows[0]).toEqual({ state: "delivered", attempts: 2 });
  });
});
