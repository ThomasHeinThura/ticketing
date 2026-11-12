import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => {
  const keys = [
    "CUSTOM_OAUTH_CLIENT_ID",
    "CUSTOM_OAUTH_CLIENT_SECRET",
    "CUSTOM_OAUTH_AUTHORIZATION_URL",
    "CUSTOM_OAUTH_TOKEN_URL",
    "CUSTOM_OAUTH_USER_INFO_URL",
    "CUSTOM_OAUTH_DISCOVERY_URL",
  ] as const;
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.CUSTOM_OAUTH_CLIENT_ID = "integration-client";
  process.env.CUSTOM_OAUTH_CLIENT_SECRET = "integration-secret";
  process.env.CUSTOM_OAUTH_AUTHORIZATION_URL =
    "https://oauth.example.test/authorize";
  process.env.CUSTOM_OAUTH_TOKEN_URL = "https://oauth.example.test/token";
  process.env.CUSTOM_OAUTH_USER_INFO_URL =
    "https://oauth.example.test/userinfo";
  process.env.CUSTOM_OAUTH_DISCOVERY_URL = "";
  return { email: "", verified: true, previous };
});

import {
  getConfiguredAgentOrigin,
  reloadAuthConfiguration,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";
import { nextClientIp } from "./helpers/organization-http";

afterAll(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(provider.previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
  await reloadAuthConfiguration();
  provider.verified = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === "https://oauth.example.test/token")
        return Response.json({
          access_token: "integration-token",
          token_type: "Bearer",
        });
      if (url === "https://oauth.example.test/userinfo")
        return Response.json({
          id: provider.email,
          email: provider.email,
          email_verified: provider.verified,
          name: "Invited staff",
        });
      throw new Error(`Unexpected OAuth request: ${url}`);
    }),
  );
});

describe("generic OAuth staff registration", () => {
  it("rejects an uninvited first sign-in and creates a staff person for an invited verified user", async () => {
    const inviter = await createWorkspaceMember({ role: "owner" });
    const { app } = createApp();
    const origin = getConfiguredAgentOrigin();
    const signIn = async (email: string) => {
      provider.email = email;
      const start = await app.request(`${origin}/api/auth/sign-in/social`, {
        method: "POST",
        headers: {
          host: new URL(origin).host,
          origin,
          "content-type": "application/json",
          "x-forwarded-for": nextClientIp(),
        },
        body: JSON.stringify({
          provider: "custom",
          callbackURL: "/dashboard",
          errorCallbackURL: "/auth/sign-in",
        }),
      });
      expect(start.status, await start.clone().text()).toBe(200);
      const { url } = (await start.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      expect(state).toBeTruthy();
      const cookie = start.headers
        .getSetCookie()
        .map((item) => item.split(";", 1)[0])
        .join("; ");
      return app.request(
        `${origin}/api/auth/callback/custom?code=integration-code&state=${encodeURIComponent(state ?? "")}`,
        {
          headers: {
            host: new URL(origin).host,
            cookie,
            "x-forwarded-for": nextClientIp(),
          },
          redirect: "manual",
        },
      );
    };
    const stranger = `${randomUUID()}@example.test`;
    await signIn(stranger);
    expect(
      await db
        .select()
        .from(schema.userTable)
        .where(eq(schema.userTable.email, stranger)),
    ).toHaveLength(0);
    const email = `${randomUUID()}@example.test`;
    await db.insert(schema.invitationTable).values({
      workspaceId: inviter.workspace.id,
      inviterId: inviter.user.id,
      email,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await signIn(email);
    const [user] = await db
      .select()
      .from(schema.userTable)
      .where(eq(schema.userTable.email, email));
    if (!user) throw new Error("OAuth invitee was not created");
    const [person] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    expect(person?.side).toBe("staff");
  });
});
