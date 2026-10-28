import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  authenticatedPreferenceHandoff,
  publicPreferenceHandoff,
} from "../../apps/api/src/notification/preference-handoff";
import { deleteExpiredPreferenceHandoffs } from "../../apps/api/src/notification/preference-handoff.repository";
import { signNotificationPreferenceLink } from "../../apps/api/src/notification/preference-link";
import type { BaseVariables } from "../../apps/api/src/openapi";
import { apiRouter } from "../../apps/api/src/openapi";
import {
  parseConfiguredOrigins,
  type SelectedOrigin,
  selectOriginFromContext,
} from "../../apps/api/src/utils/request-origin";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const selector = {
  eventKind: "work_item.mentioned",
  channel: "notify.email",
  scope: "global" as const,
  scopeId: null,
};
const cookieName = "__Host-tdk_notification_preference_handoff";
beforeEach(resetTestDatabase);
async function personFixture() {
  const f = await createWorkspaceMember();
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, f.user.id)),
    "recipient",
  );
  return { ...f, person };
}
// Mount each factory at its production path: the strict policy registry is keyed by the full route.
function publicHandoffPath(audience: "agent" | "customer") {
  return audience === "agent"
    ? "/api/public/agent/notification-preference-handoffs"
    : "/api/public/portal/notification-preference-handoffs";
}
function authenticatedHandoffPath(audience: "agent" | "customer") {
  return audience === "agent"
    ? "/api/notification-preferences"
    : "/api/portal/notification-preferences";
}
function publicRouter(audience: "agent" | "customer") {
  const app = apiRouter<BaseVariables & { appOrigin: SelectedOrigin }>();
  const origins = parseConfiguredOrigins(
    getConfiguredAgentOrigin(),
    getConfiguredCustomerOrigin(),
  );
  app.use("*", async (c, next) => {
    c.set("appOrigin", selectOriginFromContext(c, origins));
    await next();
  });
  return app.route(
    publicHandoffPath(audience),
    publicPreferenceHandoff(audience),
  );
}
function requestExchange(
  router: ReturnType<typeof publicRouter>,
  token: string,
  audience: "agent" | "customer" = "agent",
  origin?: string,
) {
  const target =
    audience === "agent"
      ? getConfiguredAgentOrigin()
      : getConfiguredCustomerOrigin();
  return router.request(`${target}${publicHandoffPath(audience)}`, {
    method: "POST",
    headers: {
      host: new URL(target).host,
      origin: origin ?? target,
      "content-type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
}
function authenticated(
  f: Awaited<ReturnType<typeof personFixture>>,
  audience: "agent" | "customer" = "agent",
) {
  const app = apiRouter();
  app.use("*", async (c, next) => {
    c.set("userId", f.user.id);
    const session = {
      id: `synthetic-${f.user.id}`,
      token: "synthetic-session",
      userId: f.user.id,
      expiresAt: new Date(Date.now() + 600000),
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null,
      portal: audience,
    };
    c.set("session", session);
    await next();
  });
  return app.route(
    authenticatedHandoffPath(audience),
    authenticatedPreferenceHandoff(audience),
  );
}
async function readHandoff(
  f: Awaited<ReturnType<typeof personFixture>>,
  cookie: string,
) {
  const target = getConfiguredAgentOrigin();
  return authenticated(f).request(
    `${target}${authenticatedHandoffPath("agent")}/email-link-handoff`,
    {
      headers: { host: new URL(target).host, cookie },
    },
  );
}

describe("persisted signed preference handoff factories", () => {
  it("stores only verified selector and hashed handle, then reads without consuming or changing preferences", async () => {
    const f = await personFixture();
    const token = signNotificationPreferenceLink({
      audience: "agent",
      recipientPersonId: f.person.id,
      selector,
    });
    const response = await requestExchange(publicRouter("agent"), token);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    for (const attribute of [
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      "Path=/",
      "Max-Age=600",
    ])
      expect(setCookie).toContain(attribute);
    const cookie = setCookie.split(";")[0] ?? "";
    const handle = cookie.slice(cookieName.length + 1);
    const rows = await db.execute(
      sql`SELECT handle_hash, audience, recipient_person_id, event_kind, channel, scope, scope_id, expires_at - created_at AS lifetime FROM notification_preference_handoff`,
    );
    expect(rows.rows).toHaveLength(1);
    const stored = rows.rows[0] as {
      handle_hash: Buffer;
      recipient_person_id: string;
    };
    expect(stored.handle_hash).toHaveLength(32);
    expect(stored.handle_hash.toString("base64url")).not.toBe(handle);
    expect(stored.recipient_person_id).toBe(f.person.id);
    expect(JSON.stringify(rows.rows)).not.toContain(token);
    expect(JSON.stringify(rows.rows)).not.toContain(handle);
    for (let n = 0; n < 2; n++) {
      const read = await readHandoff(f, cookie);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(selector);
      expect(read.headers.get("cache-control")).toBe("no-store");
      expect(read.headers.get("set-cookie")).toBeNull();
    }
    expect(
      (await db.execute(sql`SELECT 1 FROM notification_preference`)).rows,
    ).toHaveLength(0);
    expect(
      (await db.execute(sql`SELECT 1 FROM notification_preference_handoff`))
        .rows,
    ).toHaveLength(1);
  });
  it("keeps mismatches generic and leaves a handoff available for its recipient", async () => {
    const recipient = await personFixture();
    const other = await personFixture();
    const response = await requestExchange(
      publicRouter("agent"),
      signNotificationPreferenceLink({
        audience: "agent",
        recipientPersonId: recipient.person.id,
        selector,
      }),
    );
    const cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    const denied = await readHandoff(other, cookie);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("set-cookie")).toBeNull();
    expect(await denied.text()).not.toContain(recipient.person.id);
    expect((await readHandoff(recipient, cookie)).status).toBe(200);
    await db.execute(
      sql`UPDATE notification_preference_handoff SET created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'`,
    );
    expect((await readHandoff(recipient, cookie)).status).toBe(404);
  });
  it("treats invalid, expired and wrong-audience token submissions uniformly without persisting them", async () => {
    const f = await personFixture();
    const router = publicRouter("agent");
    const tokens = [
      "invalid",
      signNotificationPreferenceLink({
        audience: "customer",
        recipientPersonId: f.person.id,
        selector,
      }),
      signNotificationPreferenceLink(
        { audience: "agent", recipientPersonId: f.person.id, selector },
        Date.now() - 31 * 86400000,
      ),
    ];
    for (const token of tokens) {
      const response = await requestExchange(router, token);
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({ accepted: true });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(
      (await db.execute(sql`SELECT 1 FROM notification_preference_handoff`))
        .rows,
    ).toHaveLength(0);
    expect(
      (
        await requestExchange(
          router,
          "invalid",
          "agent",
          getConfiguredCustomerOrigin(),
        )
      ).status,
    ).toBe(403);
  });
  it("saves the explicit self canonical preference through the persisted API without changing legacy rows", async () => {
    const f = await personFixture();
    const other = await personFixture();
    await db.insert(schema.sessionTable).values({
      id: `session-${f.user.id}`,
      token: `token-${f.user.id}`,
      userId: f.user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockAuthenticatedSession(f.user);
    const { app } = createApp();
    const cookie = `__Host-tdk_agent_session=token-${f.user.id}`;
    const before = await app.request("/api/notification-preferences");
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({
      canonicalPreferences: [
        { ...selector, enabled: true, digest: "off", source: "default" },
        {
          ...selector,
          eventKind: "work_item.commented",
          enabled: false,
          digest: "off",
          source: "default",
        },
        {
          ...selector,
          eventKind: "automation.notification_sent",
          enabled: false,
          digest: "off",
          source: "default",
        },
        {
          ...selector,
          eventKind: "report.export_ready",
          enabled: true,
          digest: "off",
          source: "default",
        },
      ],
    });
    const saved = await csrfRequest(
      app,
      "/api/notification-preferences",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          canonicalPreference: { ...selector, enabled: false, digest: "off" },
        }),
      },
      cookie,
    );
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      canonicalPreferences: [
        { ...selector, enabled: false, digest: "off", source: "global" },
        {
          ...selector,
          eventKind: "work_item.commented",
          enabled: false,
          digest: "off",
          source: "default",
        },
        {
          ...selector,
          eventKind: "automation.notification_sent",
          enabled: false,
          digest: "off",
          source: "default",
        },
        {
          ...selector,
          eventKind: "report.export_ready",
          enabled: true,
          digest: "off",
          source: "default",
        },
      ],
    });
    expect(
      (await db.execute(sql`SELECT person_id FROM notification_preference`))
        .rows,
    ).toEqual([{ person_id: f.person.id }]);
    const commentSaved = await csrfRequest(
      app,
      "/api/notification-preferences",
      {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          canonicalPreference: {
            ...selector,
            eventKind: "work_item.commented",
            enabled: true,
            digest: "daily",
          },
        }),
      },
      cookie,
    );
    expect(commentSaved.status).toBe(200);
    expect(await commentSaved.json()).toMatchObject({
      canonicalPreferences: [
        { ...selector, enabled: false, digest: "off", source: "global" },
        {
          ...selector,
          eventKind: "work_item.commented",
          enabled: true,
          digest: "daily",
          source: "global",
        },
        {
          ...selector,
          eventKind: "automation.notification_sent",
          enabled: false,
          digest: "off",
          source: "default",
        },
        {
          ...selector,
          eventKind: "report.export_ready",
          enabled: true,
          digest: "off",
          source: "default",
        },
      ],
    });
    expect(
      (
        await db.execute(
          sql`SELECT event_kind, digest FROM notification_preference ORDER BY event_kind`,
        )
      ).rows,
    ).toEqual([
      { event_kind: "work_item.commented", digest: "daily" },
      { event_kind: "work_item.mentioned", digest: "off" },
    ]);
    expect(
      (await db.execute(sql`SELECT 1 FROM user_notification_preference`)).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.execute(
          sql`SELECT 1 FROM notification_preference WHERE person_id = ${other.person.id}`,
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("purges expired handoffs while preserving current recipient selectors", async () => {
    const f = await personFixture();
    const router = publicRouter("agent");
    const token = signNotificationPreferenceLink({
      audience: "agent",
      recipientPersonId: f.person.id,
      selector,
    });
    await requestExchange(router, token);
    await db.execute(
      sql`UPDATE notification_preference_handoff SET created_at = created_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'`,
    );
    const current = await requestExchange(router, token);
    const cookie = current.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(await deleteExpiredPreferenceHandoffs()).toBe(1);
    expect((await readHandoff(f, cookie)).status).toBe(200);
    expect(await deleteExpiredPreferenceHandoffs()).toBe(0);
  });

  it("rate limits by the trusted peer bucket even when forwarded IP headers are forged", async () => {
    const router = publicRouter("agent");
    const origin = getConfiguredAgentOrigin();
    for (let n = 0; n < 21; n++) {
      const response = await router.request(
        `${origin}${publicHandoffPath("agent")}`,
        {
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            "content-type": "application/json",
            "x-forwarded-for": `198.51.100.${n}`,
          },
          body: JSON.stringify({ token: "invalid" }),
        },
      );
      expect(response.status).toBe(n < 20 ? 202 : 429);
    }
  });
});
