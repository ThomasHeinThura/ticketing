import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { BUILT_IN_ROLES } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { signNotificationPreferenceLink } from "../../apps/api/src/notification/preference-link";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const bcrypt = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
)("bcryptjs") as { hash(value: string, rounds: number): Promise<string> };
let signInCounter = 0;
type Audience = "agent" | "customer";
const origin = (audience: Audience) =>
  audience === "agent"
    ? getConfiguredAgentOrigin()
    : getConfiguredCustomerOrigin();
const sessionName = (audience: Audience) =>
  audience === "agent"
    ? "__Host-tdk_agent_session"
    : "__Host-tdk_portal_session";
beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
  await db.insert(schema.instancePluginConfigTable).values({
    id: randomUUID(),
    pluginId: "auth.password",
    instanceKey: "csrf-customer-password",
    displayName: "CSRF test customer password",
    enabled: true,
    config: {},
    scope: "instance",
    portalScope: "customer",
    configVersion: 1,
  });
  await reloadAuthConfiguration();
});
async function fixture(audience: Audience) {
  const user =
    audience === "agent"
      ? (await createWorkspaceMember({ role: "admin" })).user
      : requireRow(
          await db
            .insert(schema.userTable)
            .values({
              id: randomUUID(),
              name: "Portal CSRF person",
              email: `${randomUUID()}@example.test`,
              emailVerified: true,
            })
            .returning(),
          "user",
        );
  if (audience === "customer") {
    const org = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: randomUUID(),
          name: "Customer CSRF org",
          isInternal: false,
          active: true,
          portalAccess: true,
        })
        .returning(),
      "org",
    );
    const person = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId: user.id,
          organisationId: org.id,
          side: "customer",
          active: true,
          isPlaceholder: false,
        })
        .returning(),
      "person",
    );
    await db
      .insert(schema.roleTable)
      .values({
        scope: BUILT_IN_ROLES.customer.scope,
        workspaceId: null,
        key: BUILT_IN_ROLES.customer.key,
        name: "Customer",
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: [...BUILT_IN_ROLES.customer.capabilities],
        isSystem: true,
        isEditable: false,
      })
      .onConflictDoNothing();
    const role = requireRow(
      await db
        .select()
        .from(schema.roleTable)
        .where(eq(schema.roleTable.key, BUILT_IN_ROLES.customer.key)),
      "role",
    );
    await db.insert(schema.membershipTable).values({
      personId: person.id,
      scope: "organisation",
      scopeId: org.id,
      roleId: role.id,
      seesAll: false,
    });
  }
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id)),
    "person",
  );
  const password = "RealCookieCsrfPassword-42!";
  await db.insert(schema.accountTable).values({
    id: randomUUID(),
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  const app = createApp().app;
  const login = await app.request(
    `${origin(audience)}/api/auth/sign-in/email`,
    {
      method: "POST",
      headers: {
        host: new URL(origin(audience)).host,
        origin: origin(audience),
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${(++signInCounter % 250) + 1}`,
      },
      body: JSON.stringify({ email: user.email, password }),
    },
  );
  expect(login.status, await login.clone().text()).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${sessionName(audience)}=`))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("No real session cookie");
  const session = requireRow(
    await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id)),
    "session",
  );
  const token = signNotificationPreferenceLink({
    audience,
    recipientPersonId: person.id,
    selector: {
      eventKind: "work_item.mentioned",
      channel: "notify.email",
      scope: "global",
      scopeId: null,
    },
  });
  const exchange = (headers: Record<string, string> = {}, bodyToken = token) =>
    app.request(
      `${origin(audience)}/api/public/${audience === "agent" ? "agent" : "portal"}/notification-preference-handoffs`,
      {
        method: "POST",
        headers: {
          host: new URL(origin(audience)).host,
          origin: origin(audience),
          "content-type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ token: bodyToken }),
      },
    );
  const issue = async (
    cookieHeader = cookie,
    headers: Record<string, string> = {},
  ) =>
    app.request(
      `${origin(audience)}${audience === "agent" ? "/api/me/csrf-token" : "/api/portal/csrf-token"}`,
      {
        headers: {
          host: new URL(origin(audience)).host,
          origin: origin(audience),
          cookie: cookieHeader,
          ...headers,
        },
      },
    );
  const proof = async () => {
    const response = await issue();
    expect(response.status, await response.clone().text()).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const cookie = response.headers
      .getSetCookie()
      .find(
        (c) =>
          c.startsWith("tdk_csrf_dev=") || c.startsWith("__Host-tdk_csrf="),
      )
      ?.split(";", 1)[0];
    if (!cookie) throw new Error("No CSRF cookie");
    return { token, cookie, response };
  };
  return {
    audience,
    user,
    person,
    session,
    cookie,
    token,
    exchange,
    issue,
    proof,
    app,
  };
}
async function handoffs() {
  return (
    await db.execute(
      "SELECT count(*)::int AS total FROM notification_preference_handoff",
    )
  ).rows;
}
describe.each(["agent", "customer"] as const)(
  "NO2 %s public cookie-session protection",
  (audience) => {
    it("allows anonymous signed body and valid double-submit without modifying preferences", async () => {
      const f = await fixture(audience);
      const anonymous = await f.exchange();
      expect(anonymous.status).toBe(202);
      const proof = await f.proof();
      expect(proof.response.headers.get("cache-control")).toBe("no-store");
      expect(proof.response.headers.get("pragma")).toBe("no-cache");
      const accepted = await f.exchange({
        cookie: `${f.cookie}; ${proof.cookie}`,
        "x-taskdesk-csrf": proof.token,
      });
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true });
      expect(await handoffs()).toEqual([{ total: 2 }]);
      expect(
        (await db.execute("SELECT 1 FROM notification_preference")).rows,
      ).toHaveLength(0);
    });
    it("requires actual CSRF even though the route itself is public", async () => {
      const f = await fixture(audience);
      const proof = await f.proof();
      const invalidHeaders: Record<string, string>[] = [
        { cookie: f.cookie },
        {
          cookie: `${f.cookie}; ${proof.cookie}`,
          "x-taskdesk-csrf": `${proof.token}x`,
        },
        {
          cookie: `${f.cookie}; ${proof.cookie}; ${proof.cookie}`,
          "x-taskdesk-csrf": proof.token,
        },
      ];
      for (const headers of invalidHeaders)
        expect((await f.exchange(headers)).status).toBe(403);
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("rejects empty, duplicate, invalid and foreign audience session cookies without anonymous fallback", async () => {
      const f = await fixture(audience);
      const proof = await f.proof();
      const otherName = sessionName(
        audience === "agent" ? "customer" : "agent",
      );
      for (const sessionCookie of [
        `${sessionName(audience)}=`,
        `${f.cookie}; ${f.cookie}`,
        `${sessionName(audience)}=not-a-real-session`,
        `${otherName}=not-a-real-session`,
        `${f.cookie}; ${otherName}=foreign`,
      ]) {
        const response = await f.exchange({
          cookie: `${sessionCookie}; ${proof.cookie}`,
          "x-taskdesk-csrf": proof.token,
        });
        expect(response.status, sessionCookie.split("=")[0]).toBe(401);
        expect(response.headers.get("set-cookie")).toBeNull();
      }
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("rejects expired/revoked/deactivated sessions using fresh persisted facts", async () => {
      const f = await fixture(audience);
      const proof = await f.proof();
      const headers = {
        cookie: `${f.cookie}; ${proof.cookie}`,
        "x-taskdesk-csrf": proof.token,
      };
      await db
        .update(schema.sessionTable)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.sessionTable.id, f.session.id));
      expect((await f.exchange(headers)).status).toBe(401);
      await db
        .update(schema.sessionTable)
        .set({ expiresAt: new Date(Date.now() + 60_000) })
        .where(eq(schema.sessionTable.id, f.session.id));
      await db
        .update(schema.personTable)
        .set({ active: false })
        .where(eq(schema.personTable.id, f.person.id));
      expect((await f.exchange(headers)).status).toBe(401);
      await db
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.id, f.session.id));
      expect((await f.exchange(headers)).status).toBe(401);
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("requires exact Origin even anonymously and refuses Origin/host audience confusion", async () => {
      const f = await fixture(audience);
      const invalidHeaders: Record<string, string>[] = [
        { origin: "" },
        { origin: "null" },
        { origin: `${origin(audience)}/` },
        { origin: "https://attacker.example" },
        { origin: origin(audience === "agent" ? "customer" : "agent") },
      ];
      for (const headers of invalidHeaders)
        expect((await f.exchange(headers)).status).toBe(403);
      const wrongHost = await f.exchange({
        host: new URL(origin(audience === "agent" ? "customer" : "agent")).host,
      });
      expect(wrongHost.status).toBe(audience === "agent" ? 404 : 403);
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("binds CSRF to the exact real session and rejects equally tampered cookie/header", async () => {
      const first = await fixture(audience);
      const proof = await first.proof();
      const second = await fixture(audience);
      expect(
        (
          await second.exchange({
            cookie: `${second.cookie}; ${proof.cookie}`,
            "x-taskdesk-csrf": proof.token,
          })
        ).status,
      ).toBe(403);
      const name = proof.cookie.split("=", 1)[0];
      const tampered = `${proof.token}x`;
      expect(
        (
          await first.exchange({
            cookie: `${first.cookie}; ${name}=${tampered}`,
            "x-taskdesk-csrf": tampered,
          })
        ).status,
      ).toBe(403);
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("never issues tokens to anonymous, wrong-origin, foreign-session or impersonated browsers", async () => {
      const f = await fixture(audience);
      expect((await f.issue("")).status).toBe(401);
      const invalid = await f.issue(f.cookie, {
        origin: "https://attacker.example",
      });
      expect(invalid.status).toBe(403);
      expect(invalid.headers.get("set-cookie")).toBeNull();
      expect(
        (
          await f.issue(
            `${sessionName(audience === "agent" ? "customer" : "agent")}=foreign`,
          )
        ).status,
      ).toBe(401);
      const proof = await f.proof();
      await db
        .update(schema.sessionTable)
        .set({ impersonatedBy: f.user.id })
        .where(eq(schema.sessionTable.id, f.session.id));
      // GM-9/GM-11: only the agent issuer serves an impersonation session (its ordinary
      // writes and exit control need a token); the portal issuer never does. The handoff
      // exchange below still refuses an impersonated browser on both audiences.
      expect((await f.issue()).status).toBe(audience === "agent" ? 200 : 401);
      expect(
        (
          await f.exchange({
            cookie: `${f.cookie}; ${proof.cookie}`,
            "x-taskdesk-csrf": proof.token,
          })
        ).status,
      ).toBe(401);
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("revalidates current bans and customer organisation access after token issuance", async () => {
      const f = await fixture(audience);
      const proof = await f.proof();
      const headers = {
        cookie: `${f.cookie}; ${proof.cookie}`,
        "x-taskdesk-csrf": proof.token,
      };
      await db
        .update(schema.userTable)
        .set({ banned: true })
        .where(eq(schema.userTable.id, f.user.id));
      expect((await f.exchange(headers)).status).toBe(401);
      await db
        .update(schema.userTable)
        .set({ banned: false })
        .where(eq(schema.userTable.id, f.user.id));
      if (audience === "customer") {
        await db
          .update(schema.organisationTable)
          .set({ portalAccess: false })
          .where(eq(schema.organisationTable.id, f.person.organisationId));
        expect((await f.exchange(headers)).status).toBe(401);
        expect((await f.issue()).status).toBe(401);
      }
      expect(await handoffs()).toEqual([{ total: 0 }]);
    });
    it("does not make the browser's current account the signed recipient at POST", async () => {
      const f = await fixture(audience);
      const proof = await f.proof();
      const other = await fixture(audience);
      const different = signNotificationPreferenceLink({
        audience,
        recipientPersonId: other.person.id,
        selector: {
          eventKind: "work_item.mentioned",
          channel: "notify.email",
          scope: "global",
          scopeId: null,
        },
      });
      const response = await f.exchange(
        {
          cookie: `${f.cookie}; ${proof.cookie}`,
          "x-taskdesk-csrf": proof.token,
        },
        different,
      );
      expect(response.status).toBe(202);
      expect(await handoffs()).toEqual([{ total: 1 }]);
    });
  },
);
