import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalAuth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { authenticateApiRequest } from "../../apps/api/src/utils/authenticate-api-request";
import { resetTestDatabase } from "./helpers/database";

const PORTAL_HOST = "portal.localhost:5174";
const ORG_ID = "portal-boundary-org";
const CUSTOMER_ROLE_ID = "portal-boundary-customer-role";

async function customer(id: string, admitted: boolean) {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: id, email: `${id}@example.test` })
    .returning();
  const [person] = await db
    .insert(schema.personTable)
    .values({
      userId: id,
      organisationId: ORG_ID,
      side: "customer",
      active: true,
      isPlaceholder: false,
    })
    .returning();
  if (!user || !person) throw new Error("customer fixture missing");
  if (admitted)
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "organisation",
      scopeId: ORG_ID,
      roleId: CUSTOMER_ROLE_ID,
      seesAll: false,
    });
  return user;
}

function portalSession(user: { id: string; email: string }) {
  return {
    session: {
      id: `session-${user.id}`,
      token: `token-${user.id}`,
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
      portal: "customer",
    },
    user: { ...user, twoFactorEnabled: false },
  } as never;
}

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.organisationTable).values({
    id: ORG_ID,
    key: "portal-boundary",
    name: "Portal Boundary",
    isInternal: false,
    portalAccess: true,
  });
  await db.insert(schema.roleTable).values({
    id: CUSTOMER_ROLE_ID,
    scope: "organisation",
    workspaceId: null,
    key: "customer",
    name: "Customer",
    rank: 0,
    capabilities: [],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("customer portal session requires an admitted customer identity", () => {
  it("authenticateApiRequest refuses a portal session without an admitted identity", async () => {
    const stranger = await customer("portal-stranger", false);
    const admitted = await customer("portal-admitted", true);
    const probe = new Hono();
    probe.onError((error, c) =>
      error instanceof HTTPException
        ? c.json({ message: error.message }, error.status)
        : c.json({ message: "error" }, 500),
    );
    probe.use("*", async (c, next) => {
      await authenticateApiRequest(c);
      await next();
    });
    probe.get("/probe", (c) => c.json({ userId: c.get("userId") }));
    const spy = vi.spyOn(portalAuth.api, "getSession");

    spy.mockResolvedValue(portalSession(stranger));
    const refused = await probe.request("/probe", {
      headers: { host: PORTAL_HOST },
    });
    expect(refused.status).toBe(401);

    spy.mockResolvedValue(portalSession(admitted));
    const allowed = await probe.request("/probe", {
      headers: { host: PORTAL_HOST },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ userId: admitted.id });
  });

  it("the portal auth handler refuses a session without an admitted identity before delegating", async () => {
    const stranger = await customer("portal-handler-stranger", false);
    const admitted = await customer("portal-handler-admitted", true);
    const { app } = createApp();
    const spy = vi.spyOn(portalAuth.api, "getSession");
    const handler = vi
      .spyOn(portalAuth, "handler")
      .mockResolvedValue(new Response("null", { status: 200 }));

    spy.mockResolvedValue(portalSession(stranger));
    const refused = await app.request(
      `http://${PORTAL_HOST}/api/auth/get-session`,
      { headers: { host: PORTAL_HOST } },
    );
    expect(refused.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();

    spy.mockResolvedValue(portalSession(admitted));
    const allowed = await app.request(
      `http://${PORTAL_HOST}/api/auth/get-session`,
      { headers: { host: PORTAL_HOST } },
    );
    expect(allowed.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
