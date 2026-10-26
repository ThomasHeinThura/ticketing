import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { portalNotificationRouter } from "../../apps/api/src/notification/portal-inbox";
import { apiRouter, type BaseVariables } from "../../apps/api/src/openapi";
import { resetTestDatabase } from "./helpers/database";
import {
  type Customer,
  type IntakeSeed,
  seedIntake,
  submissionRow,
  submitAs,
} from "./helpers/intake-http";

const portalHost = "portal.localhost:5174";

function appFor(userId: string, portal = "customer") {
  const app = apiRouter<BaseVariables>();
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("session", {
      portal,
      userId,
      id: `session-${userId}`,
    } as unknown as NonNullable<BaseVariables["session"]>);
    await next();
  });
  return app.route("/api/portal/notification", portalNotificationRouter);
}

async function addSubmissionNotification(
  customer: Customer,
  ref: string,
  kind: "submission.replied" | "submission.declined" = "submission.replied",
) {
  const submission = await submissionRow(ref);
  const [row] = await db
    .insert(schema.notificationTable)
    .values({
      userId: customer.user.id,
      personId: customer.person.id,
      type: "task_comment",
      kind,
      title: "Private staff name must not appear",
      content: "Internal triage note must not appear",
      eventData: { staffName: "Private Agent", note: "internal payload" },
      resourceType: "submission",
      resourceId: submission.id,
      isRead: false,
      createdAt: new Date("2026-10-26T10:00:00.000Z"),
    })
    .returning();
  if (!row) throw new Error("notification fixture missing");
  return row;
}

beforeEach(async () => resetTestDatabase());

describe("portal customer notification inbox", () => {
  it("returns a customer-safe request link and supports read, unread and read-all", async () => {
    const seed = await seedIntake("no12-portal-inbox");
    const ref = await submitAs(seed, seed.customer);
    const notification = await addSubmissionNotification(seed.customer, ref);
    const app = appFor(seed.customer.user.id);
    const url = `http://${portalHost}/api/portal/notification/inbox`;
    const headers = { host: portalHost };

    const response = await app.request(url, { headers });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page).toMatchObject({
      unreadCount: 1,
      data: [
        {
          id: notification.id,
          kind: "submission.replied",
          isRead: false,
          requestRef: ref,
          commentId: null,
        },
      ],
    });
    expect(JSON.stringify(page)).not.toContain("Private Agent");
    expect(JSON.stringify(page)).not.toContain("internal payload");

    const markedRead = await app.request(
      `http://${portalHost}/api/portal/notification/${encodeURIComponent(notification.id)}/read`,
      { method: "PATCH", headers },
    );
    expect(markedRead.status).toBe(200);
    expect(
      (
        await db
          .select({ isRead: schema.notificationTable.isRead })
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.id, notification.id))
      )[0]?.isRead,
    ).toBe(true);

    const markedUnread = await app.request(
      `http://${portalHost}/api/portal/notification/${encodeURIComponent(notification.id)}/unread`,
      { method: "PATCH", headers },
    );
    expect(markedUnread.status).toBe(200);

    const allRead = await app.request(
      `http://${portalHost}/api/portal/notification/read-all`,
      {
        method: "PATCH",
        headers,
      },
    );
    expect(allRead.status).toBe(200);
    expect(
      (
        await db
          .select({ isRead: schema.notificationTable.isRead })
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.id, notification.id))
      )[0]?.isRead,
    ).toBe(true);
  });

  it("rejects agent sessions, unsupported assignment filters and another recipient's row", async () => {
    const seed = await seedIntake("no12-portal-inbox-denials");
    const ref = await submitAs(seed, seed.customer);
    const notification = await addSubmissionNotification(seed.customer, ref);
    const headers = { host: portalHost };

    const staff = await appFor(seed.customer.user.id, "agent").request(
      `http://${portalHost}/api/portal/notification/inbox`,
      { headers },
    );
    expect(staff.status).toBe(404);

    const assignments = await appFor(seed.customer.user.id).request(
      `http://${portalHost}/api/portal/notification/inbox?filter=assignments`,
      { headers },
    );
    expect(assignments.status).toBe(400);

    const other = await seedIntake("no12-portal-inbox-other");
    const otherRef = await submitAs(other, other.customer);
    const otherNotification = await addSubmissionNotification(
      other.customer,
      otherRef,
      "submission.declined",
    );
    const crossRecipient = await appFor(seed.customer.user.id).request(
      `http://${portalHost}/api/portal/notification/${encodeURIComponent(otherNotification.id)}/read`,
      { method: "PATCH", headers },
    );
    expect(crossRecipient.status).toBe(404);
    expect(notification.userId).toBe(seed.customer.user.id);
  });
});
