import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db from "../../apps/api/src/database";
import { portalCanonicalPreferences } from "../../apps/api/src/notification/portal-canonical-preferences";
import { apiRouter, type BaseVariables } from "../../apps/api/src/openapi";
import { createCustomerPrincipal } from "./helpers/customer-principal";
import { resetTestDatabase } from "./helpers/database";

const portalHost = "portal.localhost:5174";
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
  return app.route("/", portalCanonicalPreferences);
}

describe("portal canonical notification preferences", () => {
  it("reads defaults and persists only the authenticated customer's preferences", async () => {
    const customer = await createCustomerPrincipal();
    const other = await createCustomerPrincipal();
    const app = router(customer.user.id);
    const path = `http://${portalHost}/`;
    const headers = { host: portalHost };
    const before = await app.request(path, { headers });
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual([
      {
        ...comment,
        eventKind: "work_item.mentioned",
        enabled: true,
        digest: "off",
        source: "default",
      },
      {
        ...comment,
        enabled: false,
        digest: "off",
        source: "default",
      },
    ]);

    const saved = await app.request(path, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(comment),
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject([
      {
        ...comment,
        eventKind: "work_item.mentioned",
        enabled: true,
        digest: "off",
        source: "default",
      },
      { ...comment, source: "global" },
    ]);
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
    const path = `http://${portalHost}/`;
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
});
