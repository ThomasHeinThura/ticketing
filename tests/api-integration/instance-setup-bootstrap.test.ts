import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ensureSetupToken,
  isSetupCompleted,
  SETUP_TOKEN_HEADER,
  verifyAndConsumeSetupToken,
} from "../../apps/api/src/instance/setup-token";
import { resetTestDatabase } from "./helpers/database";
import { nextClientIp } from "./helpers/organization-http";

/**
 * Issue #18 — the inherited zero-user registration bypass and the
 * setup-token flow that replaces it.
 *
 * Before this fix, `apps/api/src/auth.ts`'s `databaseHooks.user.create`
 * skipped every registration control and auto-promoted whoever signed up
 * first on an empty instance to `role: "admin"` — no proof of authorization
 * required, and advertised publicly via `GET /api/instance/status`
 * (`hasUsers`/`hasAdmin`). See
 * docs/07-planning/security-reviews/13-kaneo-import-lenses/E-secrets.md
 * (finding E-13) and docs/01-architecture/auth-and-identity.md § Break-glass
 * for the specified replacement this file proves is actually in place.
 */

const throwawayPassword = () => `Pw-${randomUUID()}`;

async function totalUserCount(): Promise<number> {
  const [row] = await db.select({ value: count() }).from(schema.userTable);
  return row?.value ?? 0;
}

async function roleOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId));
  return row?.role ?? null;
}

function signUp(
  app: ReturnType<typeof createApp>["app"],
  overrides: { email?: string; setupToken?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Each call is a distinct "client" for the /sign-up/email rate limiter
    // (3 per 60s per IP, auth.ts's customRules) -- this file makes many
    // more than three sign-up attempts.
    "x-forwarded-for": nextClientIp(),
  };
  if (overrides.setupToken) {
    headers[SETUP_TOKEN_HEADER] = overrides.setupToken;
  }
  return app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: overrides.email ?? `bootstrap-${randomUUID()}@example.com`,
      password: throwawayPassword(),
      name: "Bootstrap Candidate",
    }),
  });
}

describe("issue #18: the setup-token flow gates first-admin bootstrap", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    delete process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL;
    process.env.DISABLE_REGISTRATION = "false";
  });

  it("(a) refuses first registration on a zero-user instance with no setup token", async () => {
    const { app } = createApp();
    expect(await totalUserCount()).toBe(0);

    const response = await signUp(app);

    expect(response.status).toBe(403);
    expect(await totalUserCount()).toBe(0);
    expect(await isSetupCompleted()).toBe(false);
  });

  it("(a) still refuses a zero-user signup with no token even when registration is otherwise wide open (DISABLE_REGISTRATION=false)", async () => {
    process.env.DISABLE_REGISTRATION = "false";
    const { app } = createApp();

    const response = await signUp(app);

    // The zero-user window is never a generic open-registration bypass --
    // it is ONLY the operator's own setup-token or headless bootstrap path,
    // regardless of how permissive the ordinary registration flags are.
    expect(response.status).toBe(403);
    expect(await totalUserCount()).toBe(0);
  });

  it("(a) refuses a bogus token, not just a missing one", async () => {
    const { app } = createApp();

    const response = await signUp(app, { setupToken: "not-a-real-token" });

    expect(response.status).toBe(403);
    expect(await totalUserCount()).toBe(0);
  });

  it("(b) a valid setup token lets first-registration succeed and promotes the registrant to admin", async () => {
    const rawToken = await ensureSetupToken();
    expect(rawToken).toEqual(expect.any(String));

    const { app } = createApp();
    const email = `admin-${randomUUID()}@example.com`;
    const response = await signUp(app, {
      email,
      setupToken: rawToken as string,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };

    expect(await roleOf(body.user.id)).toBe("admin");
    expect(await totalUserCount()).toBe(1);
    expect(await isSetupCompleted()).toBe(true);

    // The token is consumed: the row's hash/expiry are cleared, so it is
    // no longer sitting there valid-but-unused.
    const [setting] = await db
      .select({
        setupTokenHash: schema.instanceSettingTable.setupTokenHash,
        setupCompletedAt: schema.instanceSettingTable.setupCompletedAt,
      })
      .from(schema.instanceSettingTable)
      .limit(1);
    expect(setting?.setupTokenHash).toBeNull();
    expect(setting?.setupCompletedAt).not.toBeNull();
  });

  it("(b) a used token is invalidated at the storage layer -- a second consume attempt fails", async () => {
    // Precise, direct proof of single-use: exercised at the HTTP level below
    // too, but registration being open by default there means a SECOND
    // signup can succeed anyway (as an ordinary, non-admin user) once the
    // first has landed -- that is a different property (tested as "(c)"
    // above) and would make this assertion pass for the wrong reason if it
    // only checked an HTTP status code. Calling the actual consuming
    // function twice is what proves the token itself, not just the
    // zero-user window, is single-use.
    const rawToken = (await ensureSetupToken()) as string;

    expect(await verifyAndConsumeSetupToken(rawToken)).toBe(true);
    expect(await verifyAndConsumeSetupToken(rawToken)).toBe(false);
  });

  it("(b) a used token cannot be replayed to bootstrap a SECOND admin once registration is closed", async () => {
    const rawToken = (await ensureSetupToken()) as string;
    const { app } = createApp();

    const first = await signUp(app, { setupToken: rawToken });
    expect(first.status).toBe(200);
    expect(await totalUserCount()).toBe(1);

    // Lock the instance down the way an operator who just finished setup
    // plausibly would. With the token already consumed and no invitation,
    // a replay attempt has nothing left to succeed through.
    process.env.DISABLE_REGISTRATION = "true";
    const replay = await signUp(app, { setupToken: rawToken });

    expect(replay.status).toBe(403);
    expect(await totalUserCount()).toBe(1);
  });

  it("(c) once a user exists, the zero-user bootstrap path is fully inert regardless of any token", async () => {
    // Seed one ordinary user directly -- no admin, and crucially no trip
    // through the bootstrap flow at all, so instance_setting still has no
    // setup_completed_at and a token can still be issued.
    await db.insert(schema.userTable).values({
      id: `seed-${randomUUID()}`,
      email: `seed-${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Pre-existing user",
    });
    expect(await totalUserCount()).toBe(1);
    expect(await isSetupCompleted()).toBe(false);

    const rawToken = (await ensureSetupToken()) as string;
    expect(rawToken).toEqual(expect.any(String));

    // With registration wide open, presenting the (still objectively valid)
    // token has NO special effect any more -- it is only meaningful on a
    // zero-user instance. The new user must NOT be promoted to admin.
    process.env.DISABLE_REGISTRATION = "false";
    const { app } = createApp();
    const openEmail = `ordinary-${randomUUID()}@example.com`;
    const openResponse = await signUp(app, {
      email: openEmail,
      setupToken: rawToken,
    });
    expect(openResponse.status).toBe(200);
    const openBody = (await openResponse.json()) as { user: { id: string } };
    expect(await roleOf(openBody.user.id)).not.toBe("admin");

    // And with registration disabled, the very same token does NOT bypass
    // that control the way the zero-user window used to bypass everything.
    process.env.DISABLE_REGISTRATION = "true";
    const blockedEmail = `blocked-${randomUUID()}@example.com`;
    const blockedResponse = await signUp(app, {
      email: blockedEmail,
      setupToken: rawToken,
    });
    expect(blockedResponse.status).toBe(403);
    expect(
      (
        await db
          .select()
          .from(schema.userTable)
          .where(eq(schema.userTable.email, blockedEmail))
      ).length,
    ).toBe(0);
  });

  it("(headless) TASKDESK_BOOTSTRAP_ADMIN_EMAIL lets the named address bootstrap with no token", async () => {
    const adminEmail = `operator-${randomUUID()}@example.com`;
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = adminEmail;

    const { app } = createApp();
    const response = await signUp(app, { email: adminEmail });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    expect(await roleOf(body.user.id)).toBe("admin");
    expect(await isSetupCompleted()).toBe(true);
  });

  it("(headless) a different address is still refused even when TASKDESK_BOOTSTRAP_ADMIN_EMAIL is set", async () => {
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = `operator-${randomUUID()}@example.com`;

    const { app } = createApp();
    const response = await signUp(app, {
      email: `someone-else-${randomUUID()}@example.com`,
    });

    expect(response.status).toBe(403);
    expect(await totalUserCount()).toBe(0);
  });

  it("(headless) TASKDESK_BOOTSTRAP_ADMIN_EMAIL is ignored once the instance is set up", async () => {
    const rawToken = (await ensureSetupToken()) as string;
    const { app } = createApp();
    const firstResponse = await signUp(app, { setupToken: rawToken });
    expect(firstResponse.status).toBe(200);
    expect(await isSetupCompleted()).toBe(true);

    // Deleting the only admin drops the user count back to zero, but the
    // durable marker must prevent this from re-opening the bootstrap window
    // -- even for the operator's own configured headless address.
    await db.delete(schema.userTable);
    expect(await totalUserCount()).toBe(0);
    expect(await isSetupCompleted()).toBe(true);

    const adminEmail = `operator-${randomUUID()}@example.com`;
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = adminEmail;
    // Registration is open by default in this suite, so this should behave
    // like an ORDINARY signup -- succeeding, but NOT auto-promoted to admin,
    // and not exempt from DISABLE_REGISTRATION either.
    const response = await signUp(app, { email: adminEmail });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    expect(await roleOf(body.user.id)).not.toBe("admin");
  });

  it("(d) deleting every admin from an already-set-up instance does not re-open the bootstrap window", async () => {
    const rawToken = (await ensureSetupToken()) as string;
    const { app } = createApp();
    const first = await signUp(app, { setupToken: rawToken });
    expect(first.status).toBe(200);
    expect(await isSetupCompleted()).toBe(true);

    await db.delete(schema.userTable);
    expect(await totalUserCount()).toBe(0);

    // No token was ever reissued (isSetupCompleted() is true, so
    // ensureSetupToken() below is a no-op) and none is presented here
    // either -- proving the zero-user state alone is not enough any more.
    const reissued = await ensureSetupToken();
    expect(reissued).toBeNull();

    // Registration is open by default in this suite, so an ordinary signup
    // still succeeds -- but it must land as an ORDINARY user, never
    // silently re-promoted to admin just because the count dropped to zero.
    const openResponse = await signUp(app);
    expect(openResponse.status).toBe(200);
    const openBody = (await openResponse.json()) as { user: { id: string } };
    expect(await roleOf(openBody.user.id)).not.toBe("admin");

    // And with registration locked down too (an operator who wants the
    // instance to genuinely stay closed after an admin wipe), the zero-user
    // count alone grants no exemption at all any more.
    await db.delete(schema.userTable);
    process.env.DISABLE_REGISTRATION = "true";
    const blockedResponse = await signUp(app);
    expect(blockedResponse.status).toBe(403);
    expect(await totalUserCount()).toBe(0);
  });

  it("(d) concurrent signups presenting the same valid setup token resolve to exactly one admin", async () => {
    const rawToken = (await ensureSetupToken()) as string;
    const { app } = createApp();

    // Registration is closed so the loser has no fallback path: whichever
    // racer does not win the single-use token is refused outright, rather
    // than quietly landing as an ordinary (non-admin) open-registration
    // signup once the winner's row has committed. That keeps this test's
    // outcome deterministic regardless of exactly how the two requests
    // interleave, while still exercising the real concurrency-sensitive
    // path: the atomic token consumption in `verifyAndConsumeSetupToken`
    // AND the advisory-locked promotion in auth.ts's `after` hook both run
    // for real, against a real Postgres, under a genuine race.
    process.env.DISABLE_REGISTRATION = "true";

    const emailA = `racer-a-${randomUUID()}@example.com`;
    const emailB = `racer-b-${randomUUID()}@example.com`;

    const [responseA, responseB] = await Promise.all([
      signUp(app, { email: emailA, setupToken: rawToken }),
      signUp(app, { email: emailB, setupToken: rawToken }),
    ]);

    const statuses = [responseA.status, responseB.status].sort();
    // Exactly one request wins the single-use token; the other is refused.
    expect(statuses).toEqual([200, 403]);
    expect(await totalUserCount()).toBe(1);
    expect(await isSetupCompleted()).toBe(true);

    const [winner] = await db.select().from(schema.userTable).limit(1);
    expect(winner?.role).toBe("admin");
  });
});

describe("issue #18: GET /api/instance/status no longer advertises setup state", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns the same constant body on a zero-user instance and on a claimed one", async () => {
    const { app } = createApp();

    const unclaimedResponse = await app.request("/api/instance/status");
    expect(unclaimedResponse.status).toBe(200);
    expect(await unclaimedResponse.json()).toEqual({ status: "ok" });

    const rawToken = (await ensureSetupToken()) as string;
    const signUpResponse = await signUp(app, { setupToken: rawToken });
    expect(signUpResponse.status).toBe(200);
    expect(await isSetupCompleted()).toBe(true);

    const claimedResponse = await app.request("/api/instance/status");
    expect(claimedResponse.status).toBe(200);
    expect(await claimedResponse.json()).toEqual({ status: "ok" });
  });
});
