import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { notificationPreferenceTable } from "../../apps/api/src/database/schema";
import { immediateNotificationRuntime } from "../../apps/api/src/notification/immediate-runtime";
import { processNextNotificationDelivery } from "../../apps/api/src/notification/outbox-drain";
import { verifyNotificationPreferenceLink } from "../../apps/api/src/notification/preference-link";
import { updateEmailProvider } from "../../apps/api/src/notification-provider/service";
import { createComment } from "../../apps/api/src/work-item/controllers/create-comment";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

describe("customer immediate comment email", () => {
  it("sends only the current public projection with a customer preference handoff", async () => {
    const actor = await createWorkspaceMember({ role: "admin" });
    const actorPerson = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, actor.user.id)),
      "comment actor person",
    );
    const [customerUser] = await db
      .insert(schema.userTable)
      .values({
        id: `comment-customer-${randomUUID()}`,
        name: "Customer account",
        email: `comment-customer-${randomUUID()}@example.test`,
      })
      .returning();
    if (!customerUser) throw new Error("customer user missing");
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
      "comment customer person",
    );
    await grantCustomerOrganisationMembership(
      actor.workspace.organisationId,
      customerPerson.id,
    );
    const { project } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: actor.workspace.organisationId })
      .where(eq(schema.projectTable.id, project.id));
    await grantWorkItemProjectAccess(actor.user.id, project.id);
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: actor.workspace.id,
          key: `customer-comment-${randomUUID()}`,
          name: "Request",
          category: "delivery",
        })
        .returning(),
      "request type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: actor.workspace.id,
          key: `customer-comment-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
        })
        .returning(),
      "request state template",
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
      "request state",
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
          title: "Sensitive request title must not be sent",
          requesterId: customerPerson.id,
          customerVisibility: "organisation",
        })
        .returning(),
      "customer request",
    );
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: actor.workspace.id,
          key: `customer-comment-${randomUUID()}`,
          name: "Customer request",
          group: "General",
          workItemTypeId: type.id,
          formSchema: { fields: [] },
          published: true,
          customerVisible: true,
        })
        .returning(),
      "linked customer request type",
    );
    const requestTypeVersion = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: actor.workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema: { fields: [] },
          workItemTypeId: type.id,
        })
        .returning(),
      "linked customer request type version",
    );
    const linkedSubmission = requireRow(
      await db
        .insert(schema.submissionTable)
        .values({
          organisationId: actor.workspace.organisationId,
          requesterId: customerPerson.id,
          requestTypeId: requestType.id,
          requestTypeVersionId: requestTypeVersion.id,
          formData: {},
          state: "accepted",
          submittedAt: new Date(),
          customerVisibility: "organisation",
          workItemId: item.id,
        })
        .returning(),
      "linked customer submission",
    );
    const [otherCustomerUser] = await db
      .insert(schema.userTable)
      .values({
        id: `comment-other-customer-${randomUUID()}`,
        name: "Other customer",
        email: `comment-other-customer-${randomUUID()}@example.test`,
      })
      .returning();
    if (!otherCustomerUser) throw new Error("other customer user missing");
    const otherCustomerPerson = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: otherCustomerUser.id,
          organisationId: actor.workspace.organisationId,
          side: "customer",
          active: true,
          isPlaceholder: false,
        })
        .returning(),
      "other customer person",
    );
    await grantCustomerOrganisationMembership(
      actor.workspace.organisationId,
      otherCustomerPerson.id,
    );
    await db.insert(schema.watcherTable).values({
      workItemId: item.id,
      personId: otherCustomerPerson.id,
      source: "explicit",
      muted: false,
    });
    await db.insert(notificationPreferenceTable).values({
      personId: otherCustomerPerson.id,
      scope: "global",
      scopeId: null,
      channel: "notify.email",
      eventKind: "work_item.commented",
      enabled: true,
      digest: "off",
    });
    await db.insert(notificationPreferenceTable).values({
      personId: customerPerson.id,
      scope: "global",
      scopeId: null,
      channel: "notify.email",
      eventKind: "work_item.commented",
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
    if (!eventId) throw new Error("customer comment event missing");
    const send = vi.fn(async (_to, _subject, _data, options) => {
      expect(await options.authorize?.()).toBe(true);
      return { success: true as const };
    });
    await expect(
      processNextNotificationDelivery(immediateNotificationRuntime(send)),
    ).resolves.toEqual({ kind: "delivered" });
    expect(send).toHaveBeenCalledTimes(1);
    const [to, subject, data] = send.mock.calls[0] ?? [];
    expect(to).toBe(customerUser.email);
    expect(subject).toBe("New comment on a request");
    expect(data.actionUrl).toMatch(/portal\.localhost.*\/requests$/u);
    expect(JSON.stringify(data)).not.toContain("Sensitive request title");
    expect(JSON.stringify(data)).not.toContain("Customer account");
    const token = String(data.preferenceUrl).match(
      /#preference_token=([A-Za-z0-9_.-]+)/u,
    )?.[1];
    expect(
      verifyNotificationPreferenceLink(token ?? "", "customer"),
    ).toMatchObject({
      recipientPersonId: customerPerson.id,
      selector: {
        eventKind: "work_item.commented",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
      },
    });
    expect(String(data.preferenceUrl)).toContain("/account#preference_token=");
    const persisted = await db.execute(
      sql`SELECT state, digest_id FROM notification_delivery WHERE event_id = ${eventId}`,
    );
    expect(persisted.rows).toEqual([{ state: "delivered", digest_id: null }]);

    const otherCustomerNotifications = await db
      .select({ id: schema.notificationTable.id })
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, otherCustomerUser.id));
    expect(otherCustomerNotifications).toEqual([]);

    const secondComment = await createComment(
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
              content: [{ type: "text", text: "A later public update" }],
            },
          ],
        },
      },
    );
    const secondEvent = await db.execute<{ eventId: string }>(sql`
      SELECT event_id AS "eventId" FROM outbox
       WHERE kind = 'work_item.commented'
         AND payload->'payload'->>'commentId' = ${secondComment.id}
    `);
    const secondEventId = secondEvent.rows[0]?.eventId;
    if (!secondEventId)
      throw new Error("second customer comment event missing");
    await db
      .update(schema.submissionTable)
      .set({ requesterId: otherCustomerPerson.id })
      .where(eq(schema.submissionTable.id, linkedSubmission.id));
    await expect(
      processNextNotificationDelivery(immediateNotificationRuntime(send)),
    ).resolves.toMatchObject({
      kind: "suppressed",
      reason: "customer_request_not_owned",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const suppressed = await db.execute(sql`
      SELECT state FROM notification_delivery WHERE event_id = ${secondEventId}
    `);
    expect(suppressed.rows).toEqual([{ state: "suppressed" }]);
  });
});
