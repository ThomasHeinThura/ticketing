import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { portalCanonicalPreferences } from "../../apps/api/src/notification/portal-canonical-preferences";
import { apiRouter, type BaseVariables } from "../../apps/api/src/openapi";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";

const portalHost = "portal.localhost:5174";
const canonicalPath = "/api/portal/notification-preferences/canonical";
const comment = {
  eventKind: "work_item.commented",
  channel: "notify.email",
  scope: "global",
  scopeId: null,
  enabled: true,
  digest: "daily",
};

beforeEach(resetTestDatabase);

function router(userId: string, portal = "customer") {
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
  // Production mount: the strict policy registry is keyed by the full route.
  return app.route(canonicalPath, portalCanonicalPreferences);
}

describe("portal canonical notification preferences", () => {
  it("reads defaults and persists only the authenticated customer's preferences", async () => {
    const customer = await createCustomerPrincipal();
    const other = await createCustomerPrincipal();
    const app = router(customer.user.id);
    const path = `http://${portalHost}${canonicalPath}`;
    const headers = { host: portalHost };
    const before = await app.request(path, { headers });
    expect(before.status).toBe(200);
    const defaults = (await before.json()) as Array<{
      eventKind: string;
      enabled: boolean;
      digest: string;
    }>;
    expect(defaults.map((row) => row.eventKind)).toEqual([
      "work_item.mentioned",
      "work_item.commented",
      "work_item.transitioned",
      "approval.requested",
      "approval.expiring",
      "approval.withdrawn",
      "submission.replied",
      "submission.accepted",
      "submission.declined",
    ]);
    expect(
      defaults.filter((row) => row.enabled).map((row) => row.eventKind),
    ).toEqual([
      "work_item.mentioned",
      "approval.requested",
      "approval.expiring",
      "approval.withdrawn",
    ]);
    expect(defaults.every((row) => row.digest === "off")).toBe(true);

    const saved = await app.request(path, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(comment),
    });
    expect(saved.status).toBe(200);
    expect(
      ((await saved.json()) as Array<{ eventKind: string }>).find(
        (row) => row.eventKind === comment.eventKind,
      ),
    ).toMatchObject({ ...comment, source: "global" });
    expect(
      (await db.execute(sql`SELECT person_id FROM notification_preference`))
        .rows,
    ).toEqual([{ person_id: customer.person.id }]);
    expect(
      (
        await db.execute(
          sql`SELECT person_id FROM notification_preference WHERE person_id = ${other.person.id}`,
        )
      ).rows,
    ).toEqual([]);
  });

  it("refuses staff sessions and digesting direct mentions", async () => {
    const customer = await createCustomerPrincipal();
    const staffSession = router(customer.user.id, "agent");
    const path = `http://${portalHost}${canonicalPath}`;
    expect(
      (await staffSession.request(path, { headers: { host: portalHost } }))
        .status,
    ).toBe(404);
    const response = await router(customer.user.id).request(path, {
      method: "PUT",
      headers: { host: portalHost, "content-type": "application/json" },
      body: JSON.stringify({
        ...comment,
        eventKind: "work_item.mentioned",
        digest: "daily",
      }),
    });
    expect(response.status).toBe(400);
  });
  it("persists every customer event and rejects staff-only or urgent digests", async () => {
    const customer = await createCustomerPrincipal();
    const app = router(customer.user.id);
    const path = `http://${portalHost}${canonicalPath}`;
    const headers = { host: portalHost, "content-type": "application/json" };
    const events = [
      "work_item.mentioned",
      "work_item.commented",
      "work_item.transitioned",
      "approval.requested",
      "approval.expiring",
      "approval.withdrawn",
      "submission.replied",
      "submission.accepted",
      "submission.declined",
    ];
    for (const eventKind of events) {
      const digest = ["work_item.mentioned", "approval.expiring"].includes(
        eventKind,
      )
        ? "off"
        : "daily";
      const saved = await app.request(path, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...comment, eventKind, digest }),
      });
      expect(saved.status).toBe(200);
    }
    const read = await app.request(path, { headers });
    expect(
      (
        (await read.json()) as Array<{ enabled: boolean; source: string }>
      ).every((row) => row.enabled && row.source === "global"),
    ).toBe(true);
    for (const eventKind of [
      "work_item.mentioned",
      "approval.expiring",
      "work_item.assigned",
    ]) {
      expect(
        (
          await app.request(path, {
            method: "PUT",
            headers,
            body: JSON.stringify({ ...comment, eventKind, digest: "daily" }),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await app.request(path, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            ...comment,
            scope: "workspace",
            scopeId: "other",
          }),
        })
      ).status,
    ).toBe(400);
  });

  it("saves and clears only the customer's own valid quiet hours", async () => {
    const customer = await createCustomerPrincipal();
    const other = await createCustomerPrincipal();
    const path = `http://${portalHost}${canonicalPath}/quiet-hours`;
    const headers = { host: portalHost, "content-type": "application/json" };
    const app = router(customer.user.id);
    const quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };
    expect(
      (
        await app.request(path, {
          method: "PUT",
          headers,
          body: JSON.stringify({ quietHours }),
        })
      ).status,
    ).toBe(200);
    expect(await (await app.request(path, { headers })).json()).toEqual(
      quietHours,
    );
    expect(
      await (await router(other.user.id).request(path, { headers })).json(),
    ).toBeNull();
    expect(
      (
        await app.request(path, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            quietHours: { ...quietHours, start: "25:00" },
          }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await router(customer.user.id, "agent").request(path, { headers }))
        .status,
    ).toBe(404);
    expect(
      (
        await app.request(path, {
          method: "PUT",
          headers,
          body: JSON.stringify({ quietHours: null }),
        })
      ).status,
    ).toBe(200);
    expect(await (await app.request(path, { headers })).json()).toBeNull();
  });
});
