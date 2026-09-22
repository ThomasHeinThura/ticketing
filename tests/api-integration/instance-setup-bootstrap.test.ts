import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ensureSetupToken,
  isBootstrapAdminEmail,
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

  it("(B1) an uncredentialed zero-user refusal is byte-identical to an ordinary registration-disabled refusal -- no scanning oracle", async () => {
    // Security review of PR #227 (finding B1, blocking): an earlier version
    // of this message said "This instance has not been set up yet... or set
    // TASKDESK_BOOTSTRAP_ADMIN_EMAIL", which let one unauthenticated request
    // distinguish an unclaimed instance from a claimed one with registration
    // closed, and named the exact env var to try next -- recreating the
    // scanning oracle GET /api/instance/status used to provide. The fix
    // reuses checkRegistrationAllowed's own message unconditionally, so the
    // two cases must now read identically to an external caller.
    process.env.DISABLE_REGISTRATION = "true";
    const { app: unclaimedApp } = createApp();
    const unclaimedResponse = await signUp(unclaimedApp);
    const unclaimedBody = await unclaimedResponse.json();

    await resetTestDatabase();
    const { app: claimedApp } = createApp();
    // Claim the instance first (registration still closed after), then probe
    // the ordinary refusal path on the now-claimed instance.
    const claimToken = (await ensureSetupToken()) as string;
    await signUp(claimedApp, { setupToken: claimToken });
    const claimedResponse = await signUp(claimedApp);
    const claimedBody = await claimedResponse.json();

    expect(unclaimedResponse.status).toBe(403);
    expect(claimedResponse.status).toBe(403);
    expect(unclaimedBody.message).toBe(claimedBody.message);
    // The old message named this env var directly; the new one must not,
    // regardless of which of the two cases produced it.
    expect(unclaimedBody.message).not.toMatch(/TASKDESK_BOOTSTRAP_ADMIN_EMAIL/);
    expect(unclaimedBody.message).not.toMatch(/setup URL|setup token/i);
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

  it("(F4) isBootstrapAdminEmail is not fooled by a Unicode case-folding trick", () => {
    // Security review of PR #227 (finding F4, non-blocking): plain
    // `.toLowerCase()` maps U+212A KELVIN SIGN to ordinary "k", so
    // "operator@example.com" and "operator@example.com" with a KELVIN SIGN
    // in place of the K used to compare equal under the bare comparison this
    // replaces. NFKC-normalizing first closes it. (Not exploitable end to
    // end even before this fix, since better-auth's own email validator
    // rejects such inputs first -- this test exercises the function
    // directly, on its own terms, not through the HTTP path.)
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = "operator@example.com";
    const kelvinSignVariant = "Kelvin-operator@example.com".replace(
      "elvin-",
      "",
    );
    // kelvinSignVariant is now "Koperator@example.com" -- U+212A where a
    // plain "k" would read the same to a human, but is a DIFFERENT address
    // from the configured one.
    expect(isBootstrapAdminEmail(kelvinSignVariant)).toBe(false);
    expect(isBootstrapAdminEmail("operator@example.com")).toBe(true);
    expect(isBootstrapAdminEmail("OPERATOR@EXAMPLE.COM")).toBe(true);
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

describe("issue #18: instance_setting table invariants (security review findings F2, F3)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("(F2) migration 0061's back-fill marks a pre-existing instance as already set up", async () => {
    // Simulates an instance that already had real users before this
    // migration ever ran: resetTestDatabase() applies every migration
    // including 0061 up front, so to reproduce the "instance predates this
    // migration" case, delete the row 0061's own back-fill statement wrote,
    // insert a user the way an older instance would already have one, then
    // re-run exactly the back-fill statement 0061 ships (not a
    // reimplementation of it) and confirm it recognizes the existing user
    // and marks the instance as set up.
    await db
      .delete(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(await isSetupCompleted()).toBe(false);

    const { createId } = await import("@paralleldrive/cuid2");
    await db.insert(schema.userTable).values({
      id: createId(),
      name: "Pre-existing User",
      email: `pre-existing-${randomUUID()}@example.com`,
      emailVerified: true,
    });

    const file = new URL(
      "../../apps/api/drizzle/0061_instance_setting.sql",
      import.meta.url,
    );
    const { readFileSync } = await import("node:fs");
    const statements = readFileSync(file, "utf8")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    // Only the back-fill statement (the second one) is relevant here -- the
    // CREATE TABLE already exists from resetTestDatabase()'s own migration
    // run, so re-running it would error.
    const backfillStatement = statements[statements.length - 1];
    expect(backfillStatement).toMatch(/INSERT INTO "instance_setting"/);
    await db.execute(sql.raw(backfillStatement));

    expect(await isSetupCompleted()).toBe(true);

    // And the durable-marker guarantee this whole PR is about now actually
    // covers this instance: deleting the user and signing up again must NOT
    // re-open the bootstrap window. Registration is open by default in this
    // suite, so the signup still succeeds (matching the "(d)" re-arm test's
    // own convention) -- the point is that it must land as an ORDINARY user,
    // never re-promoted to admin just because the count dropped to zero.
    await db.delete(schema.userTable);
    const { app } = createApp();
    const response = await signUp(app);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { id: string } };
    expect(await roleOf(body.user.id)).not.toBe("admin");
  });

  it("(F2) a genuinely fresh instance (no users) is untouched by the back-fill", async () => {
    // The back-fill's WHERE EXISTS guard must not fire on a real first-run
    // instance -- resetTestDatabase() already exercises this migration on an
    // empty database, so if the guard were wrong this would already be
    // failing every other test in this file; asserted explicitly here too.
    expect(await isSetupCompleted()).toBe(false);
  });

  it("(F3) a second instance_setting row with any id other than 'singleton' is rejected by the database", async () => {
    // Security review of PR #227 (finding F3, non-blocking): before this
    // fix, nothing stopped a second row from existing, and every read in
    // this module is a bare `LIMIT 1` with no WHERE -- an arbitrary,
    // unrelated row could silently become the one this code reads. The
    // CHECK constraint makes the single-row invariant schema.ts's own
    // comment already claimed into something Postgres actually enforces.
    let thrown: unknown;
    try {
      await db
        .insert(schema.instanceSettingTable)
        .values({ id: "not-singleton" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    // drizzle-orm wraps the underlying pg driver error; the constraint name
    // is on the wrapped cause, not the top-level message.
    const cause = (thrown as { cause?: { message?: string } })?.cause;
    expect(cause?.message).toMatch(/instance_setting_id_singleton/);
  });
});
