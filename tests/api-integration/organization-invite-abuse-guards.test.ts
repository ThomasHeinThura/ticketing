import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  extractSessionCookie,
  signUpUser,
} from "./helpers/organization-http";

// R1 (retrofit plan §4, highest silent-failure risk), second half: the
// `ctx.path === "/organization/invite-member" && isCloud()` guard in
// apps/api/src/auth.ts's global `hooks.before` middleware
// (apps/api/src/auth.ts:671-706, the path check at :684). Its own comment
// (auth.ts:681-683) records why it exists: the 2026-05-28 incident sent
// ~14k phishing invites from disposable-email signups. Like the rate-limit
// rule in organization-invite-rate-limit.test.ts, this is matched on a
// literal path string and becomes a silent no-op the moment invitations
// move to a new route without the guard moving with them -- no exception,
// no type error, no other failing test.
//
// Kept in its own file (not merged into
// organization-plugin-characterization.test.ts) only to keep its
// invite-member calls out of the shared better-auth rate-limit Map that
// organization-invite-rate-limit.test.ts deliberately exhausts; each test
// below makes exactly one invite-member call, well under that rule's
// max: 5, so ordering within this file cannot make either test flaky.
//
// UNRUN: no PostgreSQL is available in this environment; see the report for
// how this was verified by reading the source instead.
describe("R1: /organization/invite-member cloud abuse gates (auth.ts:671-706)", () => {
  const CLOUD_ENV: Record<string, string> = { KANEO_CLOUD: "true" };
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [key, value] of Object.entries(CLOUD_ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const key of Object.keys(CLOUD_ENV)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("blocks an invite to a disposable-email address on cloud, and writes no invitation row", async () => {
    // apps/api/src/auth.ts:699-705. "dropmail.me" is in
    // apps/api/src/utils/disposable-email-domains.ts.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const response = await app.request("/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: owner.cookie,
      },
      body: JSON.stringify({
        organizationId: workspace.id,
        email: "throwaway@dropmail.me",
        role: "member",
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toMatch(/disposable-email/);

    const invitationRows = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.workspaceId, workspace.id));
    expect(invitationRows).toHaveLength(0);
  });

  it("blocks an anonymous/guest session from sending a workspace invitation on cloud", async () => {
    // apps/api/src/auth.ts:684-698. The guard checks the SESSION user's
    // isAnonymous flag before anything about membership or permissions is
    // evaluated, so this fires even though the anonymous user is not a
    // member of the target workspace at all.
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceViaPlugin(app, owner.cookie);
    const workspace = (await created.json()) as { id: string };

    const anonSignIn = await app.request("/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(anonSignIn.status).toBe(200);
    const anonCookie = extractSessionCookie(anonSignIn);

    const response = await app.request("/api/auth/organization/invite-member", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: anonCookie,
      },
      body: JSON.stringify({
        organizationId: workspace.id,
        email: `guest-invitee-${randomUUID()}@example.com`,
        role: "member",
      }),
    });
    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toMatch(/Guest accounts/);

    const invitationRows = await db
      .select()
      .from(schema.invitationTable)
      .where(eq(schema.invitationTable.workspaceId, workspace.id));
    expect(invitationRows).toHaveLength(0);
  });
});
