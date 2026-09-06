import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  extractSessionCookie,
  nextClientIp,
  signUpUser,
} from "./helpers/organization-http";

// R1 (retrofit plan §4, highest silent-failure risk), second half: the
// `ctx.path === "/organization/invite-member" && isCloud()` guard in
// apps/api/src/auth.ts's global `hooks.before` middleware
// (apps/api/src/auth.ts:626-706, the path check at :684). Its own comment
// (auth.ts:636-640) records why it exists: the 2026-05-28 incident sent
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
describe("R1: /organization/invite-member cloud abuse gates (auth.ts:626-706)", () => {
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
    // apps/api/src/auth.ts:660-681. "dropmail.me" is in
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

  it("FINDING: the gate's isAnonymous branch is UNREACHABLE on this baseline — #6 removed anonymous() sign-in", async () => {
    // auth.ts:640 still refuses an invitation from a session whose user has
    // isAnonymous set. On the #16 baseline that branch cannot be reached: #6
    // removed the anonymous() plugin (auth.ts:234), so nothing mints an
    // anonymous user and /sign-in/anonymous does not exist.
    //
    // Characterized rather than asserted-around. The branch is harmless — it is
    // defence in depth if guest access ever returns — but a test claiming to
    // cover it would be claiming coverage this baseline cannot provide, and S4-S7
    // would inherit that false assurance.
    const { app } = createApp();

    const anonymous = await app.request("/api/auth/sign-in/anonymous", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
    });

    // 404: the route is gone with the plugin.
    expect(anonymous.status).toBe(404);
  });
});
