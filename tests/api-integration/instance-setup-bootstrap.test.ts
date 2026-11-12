import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { count, eq, sql } from "drizzle-orm";
import { Client } from "pg";
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

const bootstrapPassword =
  randomBytes(24).toString("hex") + String.fromCharCode(65, 97, 49, 33);
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const { base32 } = apiRequire("@better-auth/utils/base32") as {
  base32: { decode(value: string): Uint8Array };
};
const { createOTP } = apiRequire("@better-auth/utils/otp") as {
  createOTP(secret: string): { totp(): Promise<string> };
};

function invalidTotpForUri(uri: string) {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("TOTP enrollment has no secret");
  const selectedAt = Date.now();
  const counter = Math.floor(selectedAt / 30_000);
  const forbidden = new Set(
    [-2, -1, 0, 1, 2].map((offset) => {
      const bytes = Buffer.alloc(8);
      bytes.writeBigUInt64BE(BigInt(counter + offset));
      const digest = createHmac("sha1", base32.decode(secret))
        .update(bytes)
        .digest();
      const index = (digest.at(-1) ?? 0) & 0x0f;
      return String(
        (digest.readUInt32BE(index) & 0x7fffffff) % 1_000_000,
      ).padStart(6, "0");
    }),
  );
  const code = [
    "000000",
    "111111",
    "222222",
    "333333",
    "444444",
    "555555",
  ].find((candidate) => !forbidden.has(candidate));
  if (!code) throw new Error("Could not choose an invalid test code");
  return { code, selectedAt };
}

function agentCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("Agent session cookie was not issued");
  return cookie;
}

async function verifyFirstAdminTotp(
  app: ReturnType<typeof createApp>["app"],
  signup: Response,
  checkUnverifiedMarker = false,
) {
  const cookie = agentCookie(signup);
  const clientIp = nextClientIp();
  const enabled = await app.request("/api/auth/two-factor/enable", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({ password: bootstrapPassword, issuer: "TaskDesk" }),
  });
  expect(enabled.status).toBe(200);
  if (checkUnverifiedMarker) {
    expect(await isSetupCompleted()).toBe(false);
  }
  const enrollment = (await enabled.json()) as { totpURI: string };
  const secret = new URL(enrollment.totpURI).searchParams.get("secret");
  if (!secret) throw new Error("TOTP enrollment has no secret");
  const code = await createOTP(
    Buffer.from(base32.decode(secret)).toString("utf8"),
  ).totp();
  const verified = await app.request("/api/auth/two-factor/verify-totp", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify({ code }),
  });
  expect(verified.status).toBe(200);
  return verified;
}

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

async function waitForPromotionLockWaiters(
  client: Client,
  ownerPid: number,
  expected: number,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await client.query("SELECT pg_stat_clear_snapshot()");
    const result = await client.query<{ waiting: number }>(
      `SELECT count(*)::integer AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event = 'advisory'
         AND $1 = ANY(pg_blocking_pids(pid))`,
      [ownerPid],
    );
    if ((result.rows[0]?.waiting ?? 0) >= expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

function signUp(
  app: ReturnType<typeof createApp>["app"],
  overrides: {
    email?: string;
    setupToken?: string;
    invitationId?: string;
  } = {},
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
      password: bootstrapPassword,
      name: "Bootstrap Candidate",
      ...(overrides.invitationId
        ? { invitationId: overrides.invitationId }
        : {}),
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

  it("(D1) the refusal stays byte-identical even when the request carries an invitationId", async () => {
    // Delta-confirmation review of PR #227 (finding D1, blocking): B1's
    // first fix hard-coded ONE fixed message for the zero-user refusal,
    // which matched checkRegistrationAllowed's "no invitation attempted"
    // message -- but that function has a SECOND, different message for "an
    // invitationId was given but didn't resolve to anything", and a claimed
    // instance reaches that function (and so can return either message)
    // while an unclaimed instance used to short-circuit before ever
    // reaching it, always with the fixed one. Adding an invitationId to the
    // request reopened the exact same oracle B1 closed for the plain case.
    // The fix calls checkRegistrationAllowed with the SAME arguments in
    // both branches, so whichever of its two messages comes back is
    // identical for identical inputs, regardless of claimed/unclaimed state.
    process.env.DISABLE_REGISTRATION = "true";
    const bogusInvitationId = "not-a-real-invitation";

    const { app: unclaimedApp } = createApp();
    const unclaimedResponse = await signUp(unclaimedApp, {
      invitationId: bogusInvitationId,
    });
    const unclaimedBody = await unclaimedResponse.json();

    await resetTestDatabase();
    const { app: claimedApp } = createApp();
    const claimToken = (await ensureSetupToken()) as string;
    await signUp(claimedApp, { setupToken: claimToken });
    const claimedResponse = await signUp(claimedApp, {
      invitationId: bogusInvitationId,
    });
    const claimedBody = await claimedResponse.json();

    expect(unclaimedResponse.status).toBe(403);
    expect(claimedResponse.status).toBe(403);
    expect(unclaimedBody.message).toBe(claimedBody.message);
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
    expect(await isSetupCompleted()).toBe(false);

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
    expect(setting?.setupCompletedAt).toBeNull();
  });

  it("(b) a used token is invalidated at the storage layer -- a second consume attempt fails", async () => {
    // Directly prove the storage-layer single-use rule.
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

  it("(c) no token is issued and registration stays closed while an uncompleted user exists", async () => {
    // An anomalous pre-existing user without a completion marker cannot
    // reopen the first-user slot or receive a new setup token.
    await db.insert(schema.userTable).values({
      id: `seed-${randomUUID()}`,
      email: `seed-${randomUUID()}@example.com`,
      emailVerified: true,
      name: "Pre-existing user",
    });
    expect(await totalUserCount()).toBe(1);
    expect(await isSetupCompleted()).toBe(false);

    const rawToken = await ensureSetupToken();
    expect(rawToken).toBeNull();

    // With registration wide open, the pending state still refuses signup.
    process.env.DISABLE_REGISTRATION = "false";
    const { app } = createApp();
    const openEmail = `ordinary-${randomUUID()}@example.com`;
    const openResponse = await signUp(app, {
      email: openEmail,
    });
    expect(openResponse.status).toBe(403);
    expect(await totalUserCount()).toBe(1);

    // And with registration disabled, the very same token does NOT bypass
    // that control the way the zero-user window used to bypass everything.
    process.env.DISABLE_REGISTRATION = "true";
    const blockedEmail = `blocked-${randomUUID()}@example.com`;
    const blockedResponse = await signUp(app, {
      email: blockedEmail,
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
    expect(await isSetupCompleted()).toBe(false);
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

  it("serializes distinct token and headless credentials and rolls the loser back", async () => {
    const token = (await ensureSetupToken()) as string;
    const headlessEmail = `headless-${randomUUID()}@example.com`;
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = headlessEmail;
    const { app } = createApp();
    const tokenEmail = `token-${randomUUID()}@example.com`;

    const responses = await Promise.all([
      signUp(app, { email: tokenEmail, setupToken: token }),
      signUp(app, { email: headlessEmail }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 403,
    ]);
    const users = await db.select().from(schema.userTable);
    expect(users).toHaveLength(1);
    expect(users[0]?.role).toBe("admin");
    expect([tokenEmail, headlessEmail]).toContain(users[0]?.email);
    expect(await isSetupCompleted()).toBe(false);
    expect(await ensureSetupToken()).toBeNull();

    // The rejected credential did not leave an ordinary user, account or
    // staff person behind. Only the admitted administrator has these rows.
    const accounts = await db.select().from(schema.accountTable);
    const people = await db.select().from(schema.personTable);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.userId).toBe(users[0]?.id);
    expect(people).toHaveLength(1);
    expect(people[0]?.userId).toBe(users[0]?.id);
  });

  it("headless wins a queued token race and completes only after valid TOTP with policy off", async () => {
    const token = (await ensureSetupToken()) as string;
    await db
      .update(schema.instanceSettingTable)
      .set({ localFactorPolicy: { mode: "off", requiredRoleId: null } });
    const headlessEmail = `headless-winner-${randomUUID()}@example.com`;
    const tokenEmail = `token-loser-${randomUUID()}@example.com`;
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = headlessEmail;
    const { app } = createApp();

    // Hold the real promotion lock, then observe each signup queue on it.
    // PostgreSQL grants that advisory lock in waiter order, making the
    // headless winner deterministic while both requests are in flight.
    const lockClient = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await lockClient.connect();
    const requests: Promise<Response>[] = [];
    let transactionOpen = false;
    let responses: Response[] = [];
    try {
      await lockClient.query("BEGIN");
      transactionOpen = true;
      const owner = await lockClient.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid, pg_advisory_xact_lock(2026)",
      );
      const ownerPid = owner.rows[0]?.pid;
      if (ownerPid === undefined)
        throw new Error("Promotion lock owner missing");

      requests.push(Promise.resolve(signUp(app, { email: headlessEmail })));
      expect(await waitForPromotionLockWaiters(lockClient, ownerPid, 1)).toBe(
        true,
      );
      requests.push(
        Promise.resolve(signUp(app, { email: tokenEmail, setupToken: token })),
      );
      expect(await waitForPromotionLockWaiters(lockClient, ownerPid, 2)).toBe(
        true,
      );
      await lockClient.query("COMMIT");
      transactionOpen = false;
      responses = await Promise.all(requests);
    } finally {
      if (transactionOpen) await lockClient.query("ROLLBACK");
      await Promise.allSettled(requests);
      await lockClient.end();
    }

    const [headless, tokenAttempt] = responses;
    if (!headless || !tokenAttempt)
      throw new Error("Both bootstrap requests must complete");
    expect(headless.status).toBe(200);
    expect(tokenAttempt.status).toBe(403);
    const [user] = await db.select().from(schema.userTable);
    expect(user).toMatchObject({ email: headlessEmail, role: "admin" });
    expect(await db.select().from(schema.userTable)).toHaveLength(1);
    expect(await db.select().from(schema.accountTable)).toHaveLength(1);
    expect(await db.select().from(schema.personTable)).toHaveLength(1);
    expect(await isSetupCompleted()).toBe(false);
    expect(await ensureSetupToken()).toBeNull();
    expect(
      (await signUp(app, { email: tokenEmail, setupToken: token })).status,
    ).toBe(403);

    const cookie = agentCookie(headless);
    const factors = await app.request("/api/me/security/factors", {
      headers: { cookie },
    });
    expect(factors.status).toBe(200);
    expect(await factors.json()).toMatchObject({
      enabled: false,
      required: true,
      policyMode: "off",
    });
    const protectedApi = await app.request("/api/instance/users", {
      headers: { cookie },
    });
    expect(protectedApi.status).toBe(403);
    expect(await protectedApi.text()).toBe("mfa_enrollment_required");

    const clientIp = nextClientIp();
    const enable = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ password: bootstrapPassword, issuer: "TaskDesk" }),
    });
    expect(enable.status).toBe(200);
    expect(await isSetupCompleted()).toBe(false);
    const enrollment = (await enable.json()) as { totpURI: string };
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    if (!secret) throw new Error("TOTP enrollment has no secret");
    const code = await createOTP(
      Buffer.from(base32.decode(secret)).toString("utf8"),
    ).totp();
    const invalidCode = invalidTotpForUri(enrollment.totpURI);
    const invalid = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ code: invalidCode.code }),
    });
    expect(Date.now() - invalidCode.selectedAt).toBeLessThan(30_000);
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(await isSetupCompleted()).toBe(false);

    const verified = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ code }),
    });
    expect(verified.status).toBe(200);
    expect(await isSetupCompleted()).toBe(true);
    const [setting] = await db.select().from(schema.instanceSettingTable);
    expect(setting?.setupTokenHash).toBeNull();
    expect(setting?.setupTokenExpiresAt).toBeNull();
    expect(setting?.localFactorPolicy).toEqual({
      mode: "off",
      requiredRoleId: null,
    });
  });

  it("holds the marker until verified TOTP and restricts the pending admin even with policy off", async () => {
    const token = (await ensureSetupToken()) as string;
    await db
      .update(schema.instanceSettingTable)
      .set({ localFactorPolicy: { mode: "off", requiredRoleId: null } });
    const { app } = createApp();
    const signup = await signUp(app, { setupToken: token });
    expect(signup.status).toBe(200);
    const cookie = agentCookie(signup);
    expect(await isSetupCompleted()).toBe(false);
    expect(await ensureSetupToken()).toBeNull();

    const factors = await app.request("/api/me/security/factors", {
      headers: { cookie },
    });
    expect(factors.status).toBe(200);
    expect(await factors.json()).toMatchObject({
      enabled: false,
      required: true,
      policyMode: "off",
    });
    const denied = await app.request("/api/instance/users", {
      headers: { cookie },
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("mfa_enrollment_required");
    const authDenied = await app.request("/api/auth/list-sessions", {
      headers: { cookie },
    });
    expect(authDenied.status).toBe(403);
    expect(await authDenied.text()).toBe("mfa_enrollment_required");

    const verified = await verifyFirstAdminTotp(app, signup, true);
    expect(await isSetupCompleted()).toBe(true);
    const availableAfterVerification = await app.request(
      "/api/auth/list-sessions",
      { headers: { cookie: agentCookie(verified) } },
    );
    expect(availableAfterVerification.status).toBe(200);
    const [setting] = await db.select().from(schema.instanceSettingTable);
    expect(setting?.setupTokenHash).toBeNull();
    expect(setting?.setupTokenExpiresAt).toBeNull();
    expect(setting?.localFactorPolicy).toEqual({
      mode: "off",
      requiredRoleId: null,
    });
  });

  it("keeps the marker unset after a failed TOTP proof", async () => {
    const token = (await ensureSetupToken()) as string;
    const { app } = createApp();
    const signup = await signUp(app, { setupToken: token });
    expect(signup.status).toBe(200);
    const cookie = agentCookie(signup);
    const clientIp = nextClientIp();
    const enabled = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ password: bootstrapPassword, issuer: "TaskDesk" }),
    });
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as { totpURI: string };
    const invalidCode = invalidTotpForUri(enrollment.totpURI);
    const invalid = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ code: invalidCode.code }),
    });
    expect(Date.now() - invalidCode.selectedAt).toBeLessThan(30_000);
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    expect(await isSetupCompleted()).toBe(false);
  });

  it("keeps an anomalous pending session restricted with an extra user and enabled factor", async () => {
    const token = (await ensureSetupToken()) as string;
    await db
      .update(schema.instanceSettingTable)
      .set({ localFactorPolicy: { mode: "off", requiredRoleId: null } });
    const { app } = createApp();
    const signup = await signUp(app, { setupToken: token });
    expect(signup.status).toBe(200);
    const { user } = (await signup.clone().json()) as { user: { id: string } };
    const cookie = agentCookie(signup);
    await db.insert(schema.userTable).values({
      name: "Anomalous second user",
      email: `anomalous-${randomUUID()}@example.test`,
    });

    const enable = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": nextClientIp(),
      },
      body: JSON.stringify({ password: bootstrapPassword, issuer: "TaskDesk" }),
    });
    expect(enable.status).toBe(200);
    // Model a stale or anomalous factor flag. An unset completion marker must
    // remain the access gate regardless of factor status or user count.
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.userTable.id, user.id));
    const factors = await app.request("/api/me/security/factors", {
      headers: { cookie },
    });
    expect(factors.status).toBe(200);
    expect(await factors.json()).toMatchObject({
      enabled: true,
      required: true,
    });
    const custom = await app.request("/api/instance/users", {
      headers: { cookie },
    });
    expect(custom.status).toBe(403);
    expect(await custom.text()).toBe("mfa_enrollment_required");
    const auth = await app.request("/api/auth/list-sessions", {
      headers: { cookie },
    });
    expect(auth.status).toBe(403);
    expect(await auth.text()).toBe("mfa_enrollment_required");
    expect(await isSetupCompleted()).toBe(false);
  });

  it("fails TOTP finalization and rolls back verification if a second user appears", async () => {
    const token = (await ensureSetupToken()) as string;
    const { app } = createApp();
    const signup = await signUp(app, { setupToken: token });
    expect(signup.status).toBe(200);
    const { user } = (await signup.clone().json()) as { user: { id: string } };
    const cookie = agentCookie(signup);
    const clientIp = nextClientIp();
    const enable = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ password: bootstrapPassword, issuer: "TaskDesk" }),
    });
    expect(enable.status).toBe(200);
    const enrollment = (await enable.json()) as { totpURI: string };
    const secret = new URL(enrollment.totpURI).searchParams.get("secret");
    if (!secret) throw new Error("TOTP enrollment has no secret");
    const code = await createOTP(
      Buffer.from(base32.decode(secret)).toString("utf8"),
    ).totp();

    await db.insert(schema.userTable).values({
      name: "Anomalous second user",
      email: `anomalous-${randomUUID()}@example.test`,
    });
    const verification = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
      body: JSON.stringify({ code }),
    });
    expect(verification.status).toBe(500);
    expect(await isSetupCompleted()).toBe(false);
    const [admin] = await db
      .select({ twoFactorEnabled: schema.userTable.twoFactorEnabled })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, user.id));
    expect(admin?.twoFactorEnabled).toBe(false);
    const factors = await db
      .select({ verified: schema.twoFactorTable.verified })
      .from(schema.twoFactorTable)
      .where(eq(schema.twoFactorTable.userId, user.id));
    expect(factors.some((factor) => factor.verified)).toBe(false);
    const protectedApi = await app.request("/api/instance/users", {
      headers: { cookie },
    });
    expect(protectedApi.status).toBe(403);
    expect(await protectedApi.text()).toBe("mfa_enrollment_required");
  });

  it("(F4/D2) isBootstrapAdminEmail is not fooled by a Unicode case-folding trick", () => {
    // Security review of PR #227 (finding F4, non-blocking): plain
    // `.toLowerCase()` maps U+212A KELVIN SIGN to ordinary "k", so
    // "operator@example.com" and "operator@example.com" with a KELVIN SIGN
    // in place of the K used to compare equal under the bare comparison this
    // replaces. NFKC-normalizing first closes it. (Not exploitable end to
    // end even before this fix, since better-auth's own email validator
    // rejects such inputs first -- this test exercises the function
    // directly, on its own terms, not through the HTTP path.)
    process.env.TASKDESK_BOOTSTRAP_ADMIN_EMAIL = "koperator@example.com";
    const kelvinSignVariant = "\u212Aoperator@example.com";
    // This must be the actual U+212A code point, not merely an ASCII "K" --
    // an earlier version of this test built its variant by prepending
    // U+212A to "operator@example.com" (an entirely different, longer
    // string than the configured "operator@example.com", not a
    // same-length substitution of a look-alike character for the real k),
    // so it passed for the trivial reason that the two strings had
    // different lengths, regardless of whether the underlying Unicode
    // case-folding bug was present. This version substitutes U+212A for
    // the leading "k" of a same-length configured address instead.
    expect(kelvinSignVariant.codePointAt(0)).toBe(0x212a);
    expect(kelvinSignVariant.length).toBe("koperator@example.com".length);

    expect(isBootstrapAdminEmail(kelvinSignVariant)).toBe(false);
    expect(isBootstrapAdminEmail("koperator@example.com")).toBe(true);
    expect(isBootstrapAdminEmail("KOPERATOR@EXAMPLE.COM")).toBe(true);
  });

  it("(headless) TASKDESK_BOOTSTRAP_ADMIN_EMAIL is ignored once the instance is set up", async () => {
    const rawToken = (await ensureSetupToken()) as string;
    const { app } = createApp();
    const firstResponse = await signUp(app, { setupToken: rawToken });
    expect(firstResponse.status).toBe(200);
    await verifyFirstAdminTotp(app, firstResponse);
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
    await verifyFirstAdminTotp(app, first);
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

    // Both requests reach the real PostgreSQL admission transaction. Only one
    // may consume the token, create a user and receive the grant.
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
    expect(await isSetupCompleted()).toBe(false);

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
    expect(await isSetupCompleted()).toBe(false);

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

    // userTable.id has its own $defaultFn, so no explicit id is needed here.
    await db.insert(schema.userTable).values({
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
    const backfillStatement = statements.at(-1);
    if (!backfillStatement) {
      throw new Error("migration 0061 has no back-fill statement");
    }
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

describe("upgrade: migration 0218 marks a database that already has users as set up", () => {
  // resetTestDatabase() has already applied every migration to an empty database, so each case
  // arranges the state an older instance would be in and re-runs exactly the statement 0218
  // ships, as the (F2) case above does for migration 0061.
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function runSetupMarkerBackfill() {
    const statements = readFileSync(
      new URL(
        "../../apps/api/drizzle/0218_backfill_setup_marker.sql",
        import.meta.url,
      ),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    await db.execute(sql.raw(statements[0] as string));
  }

  async function insertExistingUser() {
    await db.insert(schema.userTable).values({
      name: "Existing User",
      email: `existing-${randomUUID()}@example.com`,
      emailVerified: true,
    });
  }

  async function settingRow() {
    const [row] = await db
      .select()
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    return row;
  }

  it("sets the marker and clears the setup token when users exist and the marker is unset", async () => {
    // A seeded database: the boot-time token row exists, then users arrive without a first sign-up.
    expect(await ensureSetupToken()).not.toBeNull();
    await insertExistingUser();
    expect(await isSetupCompleted()).toBe(false);

    await runSetupMarkerBackfill();

    expect(await isSetupCompleted()).toBe(true);
    expect(await settingRow()).toMatchObject({
      setupTokenHash: null,
      setupTokenExpiresAt: null,
    });
  });

  it("creates the setting row when users exist and there is no row at all", async () => {
    await db
      .delete(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    await insertExistingUser();

    await runSetupMarkerBackfill();

    expect(await isSetupCompleted()).toBe(true);
  });

  it("leaves a database with no users alone, so the verified first-run flow still applies", async () => {
    const token = await ensureSetupToken();
    expect(token).not.toBeNull();

    await runSetupMarkerBackfill();

    expect(await isSetupCompleted()).toBe(false);
    expect(await verifyAndConsumeSetupToken(token)).toBe(true);
  });

  it("never rewrites a marker that is already set", async () => {
    const earlier = new Date("2026-01-02T03:04:05.000Z");
    await db
      .insert(schema.instanceSettingTable)
      .values({ id: "singleton", setupCompletedAt: earlier })
      .onConflictDoUpdate({
        target: schema.instanceSettingTable.id,
        set: { setupCompletedAt: earlier },
      });
    await insertExistingUser();

    await runSetupMarkerBackfill();

    expect((await settingRow())?.setupCompletedAt?.getTime()).toBe(
      earlier.getTime(),
    );
  });
});
