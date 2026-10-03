import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const AGENT_ORIGIN = "http://localhost:1337";
const PORTAL_ORIGIN = "http://portal.localhost:5174";

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

async function createAgentSession(id: string) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: "CSRF Agent",
      email: `${id}@example.test`,
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("agent fixture was not created");
  await ensureStaffPersonForUser(user.id);
  const password = "csrf-fixture-password";
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  const app = createApp().app;
  const login = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  return { app, cookie: cookie! };
}

describe("agent session CSRF boundary", () => {
  it("issues and reuses a same-session token, rejecting foreign issuer origins before setting cookies", async () => {
    const { app, cookie } = await createAgentSession("csrf-issuer-user");
    const issue = (headers: Record<string, string>) =>
      app.request("/api/me/csrf-token", { headers: { cookie, ...headers } });

    const first = await issue({ origin: AGENT_ORIGIN });
    expect(first.status).toBe(200);
    const body = (await first.json()) as { token: string; expiresAt: string };
    expect(body.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT/u);
    const setCookie = first.headers
      .getSetCookie()
      .find((value) => value.startsWith("tdk_csrf_dev="));
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/HttpOnly/u);
    expect(setCookie).toMatch(/SameSite=Strict/u);
    expect(setCookie).toMatch(/Path=\//u);
    expect(setCookie).not.toMatch(/Secure/u);

    const reused = await issue({
      origin: AGENT_ORIGIN,
      cookie: `${cookie}; ${setCookie!.split(";", 1)[0]}`,
    });
    expect(reused.status).toBe(200);
    expect(await reused.json()).toEqual(body);
    expect(reused.headers.getSetCookie()).toHaveLength(0);

    const refererFallback = await issue({
      referer: `${AGENT_ORIGIN}/dashboard`,
    });
    expect(refererFallback.status).toBe(200);
    const fetchMetadataFallback = await issue({
      "sec-fetch-site": "same-origin",
    });
    expect(fetchMetadataFallback.status).toBe(200);

    const deniedOrigins: Record<string, string>[] = [
      { origin: PORTAL_ORIGIN },
      { origin: "null" },
      { referer: `${PORTAL_ORIGIN}/settings` },
    ];
    for (const headers of deniedOrigins) {
      const denied = await issue(headers);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toEqual({ message: "csrf_origin_invalid" });
      expect(denied.headers.getSetCookie()).toHaveLength(0);
    }
  });

  it("requires a session-bound double-submit token before unsafe custom API handlers", async () => {
    const first = await createAgentSession("csrf-mutation-user-a");
    const second = await createAgentSession("csrf-mutation-user-b");
    const tokenResponse = await first.app.request("/api/me/csrf-token", {
      headers: { cookie: first.cookie, origin: AGENT_ORIGIN },
    });
    const { token } = (await tokenResponse.json()) as { token: string };
    const csrfCookie = tokenResponse.headers
      .getSetCookie()
      .find((value) => value.startsWith("tdk_csrf_dev="))
      ?.split(";", 1)[0];
    expect(csrfCookie).toBeDefined();

    const post = (headers: Record<string, string>) =>
      first.app.request("/api/me/step-up/challenges", {
        method: "POST",
        headers: {
          cookie: first.cookie,
          origin: AGENT_ORIGIN,
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({
          kind: "operation",
          operation: "metrics_token_rotate",
          version: 1,
        }),
      });
    const missing = await post({});
    expect(missing.status).toBe(403);
    expect(await missing.json()).toEqual({ message: "csrf_token_missing" });
    const refererOnly = await first.app.request("/api/me/step-up/challenges", {
      method: "POST",
      headers: {
        cookie: first.cookie,
        referer: `${AGENT_ORIGIN}/god-mode/observability`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "operation",
        operation: "metrics_token_rotate",
        version: 1,
      }),
    });
    expect(refererOnly.status).toBe(403);
    expect(await refererOnly.json()).toEqual({ message: "csrf_token_missing" });
    const mismatch = await post({
      "x-taskdesk-csrf": `${token}x`,
      cookie: `${first.cookie}; ${csrfCookie}`,
    });
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ message: "csrf_token_mismatch" });
    const invalid = await first.app.request("/api/me/step-up/challenges", {
      method: "POST",
      headers: {
        cookie: `${second.cookie}; ${csrfCookie}`,
        origin: AGENT_ORIGIN,
        "x-taskdesk-csrf": token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "operation",
        operation: "metrics_token_rotate",
        version: 1,
      }),
    });
    expect(invalid.status).toBe(403);
    expect(await invalid.json()).toEqual({ message: "csrf_token_invalid" });
    const foreign = await post({ origin: PORTAL_ORIGIN });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ message: "csrf_origin_invalid" });
  });
});
