import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { portalNotificationRouter } from "../../apps/api/src/notification/portal-inbox";
import { apiRouter, type BaseVariables } from "../../apps/api/src/openapi";
import { grantCustomerOrganisationMembership } from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import {
  type Customer,
  type IntakeSeed,
  seedIntake,
  staffRequest,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

/**
 * A-01: a workspace belongs to the provider's internal organisation while a customer's
 * submission carries the customer organisation. The submission notifications
 * (`submission.replied` for a clarification, `submission.declined`) must still reach the
 * requesting customer's portal inbox and unread count, and nobody else's.
 */
const portalHost = "portal.localhost:5174";

function appFor(userId: string) {
  const app = apiRouter<BaseVariables>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("session", {
      portal: "customer",
      userId,
      id: `session-${userId}`,
    } as unknown as NonNullable<BaseVariables["session"]>);
    await next();
  });
  return app.route("/api/portal/notification", portalNotificationRouter);
}

/** Re-home the workspace to the internal provider organisation, as every real install has it. */
async function moveWorkspaceToProvider(seed: IntakeSeed) {
  const [existing] = await db
    .select({ id: schema.organisationTable.id })
    .from(schema.organisationTable)
    .where(eq(schema.organisationTable.isInternal, true))
    .limit(1);
  const providerId = existing?.id ?? `provider-${randomUUID()}`;
  if (!existing)
    await db.insert(schema.organisationTable).values({
      id: providerId,
      key: providerId,
      name: "Provider",
      isInternal: true,
      portalAccess: false,
    });
  expect(providerId).not.toBe(seed.customer.orgId);
  await db
    .update(schema.workspaceTable)
    .set({ organisationId: providerId })
    .where(eq(schema.workspaceTable.id, seed.t.workspaceId));
}

async function addColleague(orgId: string) {
  const id = `cust-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email: `${id}@example.test` })
    .returning();
  const [person] = await db
    .insert(schema.personTable)
    .values({
      userId: id,
      organisationId: orgId,
      side: "customer",
      active: true,
      isPlaceholder: false,
    })
    .returning();
  if (!user || !person) throw new Error("colleague fixture missing");
  await grantCustomerOrganisationMembership(orgId, person.id);
  return { user, person, orgId } as Customer;
}

async function notify(
  recipient: Customer,
  submissionId: string,
  kind: "submission.replied" | "submission.declined",
  createdAt: string,
) {
  const [row] = await db
    .insert(schema.notificationTable)
    .values({
      userId: recipient.user.id,
      personId: recipient.person.id,
      type: "task_comment",
      kind,
      title: null,
      content: null,
      eventData: {},
      resourceType: "submission",
      resourceId: submissionId,
      isRead: false,
      createdAt: new Date(createdAt),
    })
    .returning();
  if (!row) throw new Error("notification fixture missing");
  return row;
}

async function inbox(userId: string, filter: "all" | "unread") {
  const response = await appFor(userId).request(
    `http://${portalHost}/api/portal/notification/inbox?filter=${filter}`,
    { headers: { host: portalHost } },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    unreadCount: number;
    data: Array<{ id: string; kind: string; requestRef: string | null }>;
  };
}

beforeEach(async () => resetTestDatabase());

describe("A-01 customer submission notifications in the portal inbox", () => {
  it("lists clarification and decline notifications and counts them unread", async () => {
    const seed = await seedIntake("a01-submission-scope");
    await moveWorkspaceToProvider(seed);
    const clarifyRef = await submitAs(seed, seed.customer, "Need details");
    const declineRef = await submitAs(seed, seed.customer, "Out of scope");
    const clarify = await submissionRow(clarifyRef);
    const decline = await submissionRow(declineRef);
    expect(clarify.organisationId).toBe(seed.customer.orgId);
    const replied = await notify(
      seed.customer,
      clarify.id,
      "submission.replied",
      "2026-10-31T13:25:13.000Z",
    );
    const declined = await notify(
      seed.customer,
      decline.id,
      "submission.declined",
      "2026-10-31T13:39:14.000Z",
    );

    for (const filter of ["all", "unread"] as const) {
      const page = await inbox(seed.customer.user.id, filter);
      expect(page.unreadCount).toBe(2);
      expect(
        page.data.map(({ id, kind, requestRef }) => ({ id, kind, requestRef })),
      ).toEqual([
        {
          id: declined.id,
          kind: "submission.declined",
          requestRef: declineRef,
        },
        { id: replied.id, kind: "submission.replied", requestRef: clarifyRef },
      ]);
    }

    const markRead = await appFor(seed.customer.user.id).request(
      `http://${portalHost}/api/portal/notification/${encodeURIComponent(replied.id)}/read`,
      { method: "PATCH", headers: { host: portalHost } },
    );
    expect(markRead.status).toBe(200);
    expect((await inbox(seed.customer.user.id, "unread")).unreadCount).toBe(1);
  });

  it("never shows a submission notification to anyone but its requester", async () => {
    const seed = await seedIntake("a01-submission-scope-negative");
    await moveWorkspaceToProvider(seed);
    const ref = await submitAs(seed, seed.customer);
    const submission = await submissionRow(ref);

    // A colleague in the same customer organisation, addressed a row about someone else's request.
    const colleague = await addColleague(seed.customer.orgId);
    const colleagueRow = await notify(
      colleague,
      submission.id,
      "submission.declined",
      "2026-10-31T13:39:14.000Z",
    );
    const colleaguePage = await inbox(colleague.user.id, "all");
    expect(colleaguePage.data).toEqual([]);
    expect(colleaguePage.unreadCount).toBe(0);
    const colleagueRead = await appFor(colleague.user.id).request(
      `http://${portalHost}/api/portal/notification/${encodeURIComponent(colleagueRow.id)}/read`,
      { method: "PATCH", headers: { host: portalHost } },
    );
    expect(colleagueRead.status).toBe(404);

    // A customer of another organisation and tenant.
    const other = await seedIntake("a01-submission-scope-other");
    await moveWorkspaceToProvider(other);
    await notify(
      other.customer,
      submission.id,
      "submission.replied",
      "2026-10-31T13:25:13.000Z",
    );
    const otherPage = await inbox(other.customer.user.id, "all");
    expect(otherPage.data).toEqual([]);
    expect(otherPage.unreadCount).toBe(0);
  });

  it("gives the triager's 'Customer replied' row the submission reference to open (A-09)", async () => {
    const seed = await seedIntake("a09-submission-ref");
    await moveWorkspaceToProvider(seed);
    const ref = await submitAs(seed, seed.customer);
    const submission = await submissionRow(ref);
    const [row] = await db
      .insert(schema.notificationTable)
      .values({
        userId: seed.t.requester.user.id,
        personId: seed.t.requesterPerson.id,
        type: "task_comment",
        kind: "submission.replied",
        title: null,
        content: null,
        eventData: {},
        resourceType: "submission",
        resourceId: submission.id,
        isRead: false,
      })
      .returning();
    if (!row) throw new Error("staff notification fixture missing");

    const response = await staffRequest(
      seed.t,
      seed.t.requester,
      "/api/notification/inbox?filter=all",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const page = (await response.json()) as {
      data: Array<{ id: string; eventData: Record<string, unknown> | null }>;
    };
    const listed = page.data.find((entry) => entry.id === row.id);
    expect(listed?.eventData?.submissionRef).toBe(ref);
  });
});
