import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { invalidateFeatureFlagCache } from "../../apps/api/src/feature-flag/enforce";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { seedIntake } from "./helpers/intake-http";

const host = "portal.localhost:5174";
const path = "/api/portal/notification-preferences/canonical/quiet-hours";
const quietHours = { start: "22:00", end: "07:00", timezone: "UTC" };

beforeEach(async () => {
  await resetTestDatabase();
  invalidateFeatureFlagCache();
});

describe("portal quiet-hours host boundary", () => {
  it("serves the documented preference URL and preserves canonical compatibility", async () => {
    const seed = await seedIntake("portal-preferences-contract-url");
    mockAuthenticatedSession(seed.customer.user, { portal: "customer" });
    const base = "/api/portal/notification-preferences";
    const headers = { host, "content-type": "application/json" };
    const read = await seed.t.app.request(`http://${host}${base}`, { headers });
    expect(read.status, await read.clone().text()).toBe(200);
    expect(read.headers.get("cache-control")).toContain("no-store");
    expect(await read.json()).toHaveLength(9);
    const saved = await seed.t.app.request(`http://${host}${base}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        eventKind: "submission.accepted",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: true,
        digest: "daily",
      }),
    });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const compatible = await seed.t.app.request(
      `http://${host}${base}/canonical`,
      { headers },
    );
    expect(compatible.status).toBe(200);
    expect(await compatible.json()).toContainEqual({
      eventKind: "submission.accepted",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
      enabled: true,
      digest: "daily",
      source: "global",
    });
  });

  it("saves, reloads and clears own quiet hours on the customer host with no-store", async () => {
    const seed = await seedIntake("portal-quiet-host");
    mockAuthenticatedSession(seed.customer.user, { portal: "customer" });
    const request = (method: string, body?: unknown) =>
      seed.t.app.request(`http://${host}${path}`, {
        method,
        headers: { host, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const before = await request("GET");
    expect(before.status, await before.clone().text()).toBe(200);
    expect(before.headers.get("cache-control")).toContain("no-store");
    expect(await before.json()).toBeNull();
    const saved = await request("PUT", { quietHours });
    expect(saved.status, await saved.clone().text()).toBe(200);
    expect(saved.headers.get("cache-control")).toContain("no-store");
    expect(await saved.json()).toEqual(quietHours);
    expect(await (await request("GET")).json()).toEqual(quietHours);
    expect(
      (await request("PUT", { quietHours: { ...quietHours, start: "25:00" } }))
        .status,
    ).toBe(400);
    expect(await (await request("GET")).json()).toEqual(quietHours);
    expect((await request("PUT", { quietHours: null })).status).toBe(200);
    expect(await (await request("GET")).json()).toBeNull();
  });

  it("rejects agent host, staff or missing session and explicit API keys", async () => {
    const seed = await seedIntake("portal-quiet-denial");
    const request = (requestHost: string, extra: Record<string, string> = {}) =>
      seed.t.app.request(`http://${requestHost}${path}`, {
        headers: { host: requestHost, ...extra },
      });
    mockAuthenticatedSession(seed.customer.user, { portal: "customer" });
    expect((await request("localhost:1337")).status).toBe(404);
    expect(
      (await request(host, { "x-api-key": "invalid-explicit-credential" }))
        .status,
    ).toBe(403);
    mockAuthenticatedSession(seed.t.requester.user);
    expect((await request("localhost:1337")).status).toBe(404);
    expect((await request(host)).status).toBe(401);
    mockAnonymousSession();
    expect((await request(host)).status).toBe(401);
  });

  it("fails closed without changing saved preferences when the portal flag is off", async () => {
    const seed = await seedIntake("portal-quiet-off");
    mockAuthenticatedSession(seed.customer.user, { portal: "customer" });
    const request = (method: string, body?: unknown) =>
      seed.t.app.request(`http://${host}${path}`, {
        method,
        headers: { host, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    expect((await request("PUT", { quietHours })).status).toBe(200);
    await db
      .insert(schema.instanceFeatureFlagTable)
      .values({
        featureKey: "feature.customer_portal",
        enabled: false,
        locked: true,
      })
      .onConflictDoUpdate({
        target: schema.instanceFeatureFlagTable.featureKey,
        set: { enabled: false, locked: true },
      });
    invalidateFeatureFlagCache();
    const response = await request("GET");
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await request("PUT", { quietHours: null })).status).toBe(404);
    const [person] = await db
      .select({
        start: schema.personTable.quietHoursStart,
        end: schema.personTable.quietHoursEnd,
        timezone: schema.personTable.quietHoursTimezone,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, seed.customer.person.id));
    expect(person).toEqual(quietHours);
  });
});
