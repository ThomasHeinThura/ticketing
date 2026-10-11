import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InactiveFactorIdentityError,
  loadLocalFactorState,
} from "../../apps/api/src/auth/local-factor-service";
import {
  canonicalMfaResetBody,
  sha256,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
  compare(value: string, encrypted: string): Promise<boolean>;
};
const { base32 } = apiRequire("@better-auth/utils/base32") as {
  base32: { decode(value: string): Uint8Array };
};
const { createOTP } = apiRequire("@better-auth/utils/otp") as {
  createOTP(secret: string): { totp(): Promise<string> };
};

vi.mock("@taskdesk/email", () => ({
  isSmtpConfigured: () => true,
  sendNotificationEmail: vi.fn(async () => ({ success: true })),
}));

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

describe("instance local-factor policy API", () => {
  it("persists the realtime log-level module while accepting older module snapshots", async () => {
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-realtime-settings-admin",
        name: "Realtime Settings Admin",
        email: "factor-realtime-settings-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("realtime settings admin was not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${admin.id}`,
      token: `token-${admin.id}`,
      userId: admin.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updatedAt: now,
    });

    const legacyLevels = {
      default: "warn",
      modules: {
        http: "info",
        auth: "info",
        database: "info",
        jobs: "info",
        audit: "info",
        plugins: "info",
      },
    } as const;
    await db
      .update(schema.instanceSettingTable)
      .set({ observabilityLogLevels: legacyLevels })
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const [before] = await db
      .select({
        version: schema.instanceSettingTable.observabilityConfigVersion,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    if (!before) throw new Error("instance settings were not initialized");

    const cookie = `__Host-tdk_agent_session=token-${admin.id}`;
    const { app } = createApp();
    const response = await csrfRequest(
      app,
      "/api/instance/observability",
      {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          version: before.version,
          logLevels: {
            default: "warn",
            modules: { ...legacyLevels.modules, realtime: "debug" },
          },
        }),
      },
      cookie,
    );

    expect(response.status).toBe(200);
    expect(
      (
        (await response.json()) as {
          logLevels: { modules: Record<string, string> };
        }
      ).logLevels.modules.realtime,
    ).toBe("debug");
    const [stored] = await db
      .select({ logLevels: schema.instanceSettingTable.observabilityLogLevels })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(stored?.logLevels).toMatchObject({
      default: "warn",
      modules: { realtime: "debug" },
    });
  });

  it("denies an inactive identity as forbidden but keeps a missing identity fail-closed as unavailable", async () => {
    const [inactive] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-inactive-identity",
        name: "Inactive Identity",
        email: "factor-inactive-identity@example.test",
        role: "user",
      })
      .returning();
    const [missing] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-missing-identity",
        name: "Missing Identity",
        email: "factor-missing-identity@example.test",
        role: "user",
      })
      .returning();
    if (!inactive || !missing) throw new Error("fixtures were not created");
    await ensureStaffPersonForUser(inactive.id);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, inactive.id));

    await expect(loadLocalFactorState(inactive.id)).rejects.toBeInstanceOf(
      InactiveFactorIdentityError,
    );
    await expect(loadLocalFactorState(missing.id)).rejects.not.toBeInstanceOf(
      InactiveFactorIdentityError,
    );

    const { app } = createApp();
    mockAuthenticatedSession(inactive);
    const inactiveResponse = await app.request("/api/workspace");
    expect(inactiveResponse.status, await inactiveResponse.clone().text()).toBe(
      403,
    );
    mockAuthenticatedSession(missing);
    const missingResponse = await app.request("/api/workspace");
    expect(missingResponse.status, await missingResponse.clone().text()).toBe(
      503,
    );
  });

  it("denies an inactive identity as forbidden even when the factor policy store is unusable, including on the exempt status route", async () => {
    const [inactive] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-inactive-store",
        name: "Inactive Store",
        email: "factor-inactive-store@example.test",
        role: "user",
      })
      .returning();
    const [missing] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-missing-store",
        name: "Missing Store",
        email: "factor-missing-store@example.test",
        role: "user",
      })
      .returning();
    if (!inactive || !missing) throw new Error("fixtures were not created");
    await ensureStaffPersonForUser(inactive.id);
    await db
      .update(schema.personTable)
      .set({ active: false })
      .where(eq(schema.personTable.userId, inactive.id));
    const { app } = createApp();

    const probe = async (user: typeof inactive, path: string) => {
      mockAuthenticatedSession(user);
      return app.request(path);
    };

    // 1. The instance settings row is missing.
    await db.delete(schema.instanceSettingTable);
    await expect(loadLocalFactorState(inactive.id)).rejects.toBeInstanceOf(
      InactiveFactorIdentityError,
    );
    expect((await probe(inactive, "/api/workspace")).status).toBe(403);
    expect((await probe(inactive, "/api/me/security/factors")).status).toBe(
      403,
    );
    expect((await probe(missing, "/api/workspace")).status).toBe(503);
    expect((await probe(missing, "/api/me/security/factors")).status).toBe(503);
    // A stored policy that fails to parse is unreachable through SQL: the
    // instance_setting_local_factor_policy_shape CHECK constraint rejects it. The parse now
    // runs after the person check, so the missing-row case above covers the ordering.
  });

  it("applies evaluator key ceilings and refuses impersonation for admin settings", async () => {
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-api-key-admin",
        name: "Admin Key Owner",
        email: "factor-api-key-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("admin key owner was not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);

    const rawKey = "taskdesk_test_factor_admin_without_session";
    const hashedKey = createHash("sha256")
      .update(rawKey)
      .digest()
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/u, "");
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      referenceId: admin.id,
      userId: admin.id,
      key: hashedKey,
      name: "admin owner narrow key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify({ task: ["read"] }),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const { app } = createApp();
    const headers = { authorization: `Bearer ${rawKey}` };
    const [before] = await db
      .select({
        logLevels: schema.instanceSettingTable.observabilityLogLevels,
        version: schema.instanceSettingTable.observabilityConfigVersion,
        factorPolicy: schema.instanceSettingTable.localFactorPolicy,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    if (!before) throw new Error("instance settings were not initialized");
    const settings = await app.request("/api/instance/observability", {
      headers,
    });
    const patchSettings = await app.request("/api/instance/observability", {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        version: before.version,
        logLevels: {
          default: "debug",
          modules: {
            http: "debug",
            auth: "debug",
            database: "debug",
            jobs: "debug",
            audit: "debug",
            plugins: "debug",
            realtime: "debug",
          },
        },
      }),
    });
    const factorPolicy = await app.request(
      "/api/instance/local-factor-policy",
      { headers },
    );
    const patchFactorPolicy = await app.request(
      "/api/instance/local-factor-policy",
      {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ mode: "off", requiredRoleId: null }),
      },
    );
    expect(settings.status).toBe(403);
    expect(patchSettings.status).toBe(403);
    expect(factorPolicy.status).toBe(403);
    expect(patchFactorPolicy.status).toBe(403);

    mockAuthenticatedSession(admin, { impersonatedBy: "acting-admin" });
    const impersonatedSettings = await app.request(
      "/api/instance/observability",
    );
    expect(impersonatedSettings.status).toBe(403);
    const [after] = await db
      .select({
        logLevels: schema.instanceSettingTable.observabilityLogLevels,
        version: schema.instanceSettingTable.observabilityConfigVersion,
        factorPolicy: schema.instanceSettingTable.localFactorPolicy,
      })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    expect(after).toEqual(before);
  });

  it("requires TOTP enrollment verification and enforces one-use backup-code login", async () => {
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-lifecycle-user",
        name: "Factor User",
        email: "factor-lifecycle@example.test",
        role: "admin",
      })
      .returning();
    if (!user) throw new Error("factor user was not created");
    await ensureStaffPersonForUser(user.id);
    const password = "factor-lifecycle-password";
    await db.insert(schema.accountTable).values({
      id: "factor-lifecycle-account",
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(password, 4),
    });
    const { app } = createApp();
    const signIn = async () =>
      app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: user.email, password }),
      });
    const sessionCookie = (response: Response) =>
      response.headers
        .getSetCookie()
        .find((value) => value.startsWith("__Host-tdk_agent_session="))
        ?.split(";", 1)[0];

    const initialLogin = await signIn();
    expect(initialLogin.status).toBe(200);
    const initialCookie = sessionCookie(initialLogin);
    expect(initialCookie).toBeDefined();
    const enabled = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: { cookie: initialCookie!, "content-type": "application/json" },
      body: JSON.stringify({ password, issuer: "TaskDesk" }),
    });
    expect(enabled.status).toBe(200);
    const enrollment = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(enrollment.backupCodes.length).toBeGreaterThan(0);
    const totpSecret = new URL(enrollment.totpURI).searchParams.get("secret");
    expect(totpSecret).toBeTruthy();
    const rawSecret = Buffer.from(base32.decode(totpSecret!)).toString("utf8");
    const code = await createOTP(rawSecret).totp();
    const enrolled = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: { cookie: initialCookie!, "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(enrolled.status).toBe(200);
    expect(
      (
        await db
          .select({ enabled: schema.userTable.twoFactorEnabled })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, user.id))
      )[0]?.enabled,
    ).toBe(true);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, user.id)),
    ).toHaveLength(1);

    const factorLogin = await signIn();
    expect(factorLogin.status).toBe(200);
    expect(await factorLogin.json()).toMatchObject({
      twoFactorRedirect: true,
      twoFactorMethods: ["totp"],
    });
    expect(sessionCookie(factorLogin)).toMatch(/^__Host-tdk_agent_session=$/u);
    const challengeCookie = factorLogin.headers
      .getSetCookie()
      .find((value) => value.startsWith("better-auth.two_factor="))
      ?.split(";", 1)[0];
    expect(challengeCookie).toBeDefined();
    const verifiedLogin = await app.request(
      "/api/auth/two-factor/verify-backup-code",
      {
        method: "POST",
        headers: {
          cookie: challengeCookie!,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: enrollment.backupCodes[0] }),
      },
    );
    expect(verifiedLogin.status).toBe(200);
    const verifiedCookie = sessionCookie(verifiedLogin);
    expect(verifiedCookie).toBeDefined();
    const replay = await app.request(
      "/api/auth/two-factor/verify-backup-code",
      {
        method: "POST",
        headers: {
          cookie: challengeCookie!,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: enrollment.backupCodes[0] }),
      },
    );
    expect(replay.status).toBeGreaterThanOrEqual(400);
    const status = await app.request("/api/me/security/factors", {
      headers: { cookie: verifiedCookie! },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      enabled: true,
      required: false,
    });
  });

  it("returns a safe policy DTO and updates to an existing role only", async () => {
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-admin",
        name: "Factor Admin",
        email: "factor-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!user) throw new Error("admin fixture was not created");
    await ensureStaffPersonForUser(user.id);
    mockAuthenticatedSession(user);
    await db.insert(schema.roleTable).values({
      id: "factor-role",
      scope: "instance",
      key: "factor-required",
      name: "Factor required",
      rank: 10,
      capabilities: [],
    });
    const { app } = createApp();

    const initial = await app.request("/api/instance/local-factor-policy");
    const initialBody = await initial.json();
    expect(initial.status, JSON.stringify(initialBody)).toBe(200);
    expect(initialBody).toEqual({
      policy: { mode: "optional", requiredRoleId: null },
    });

    const updated = await app.request("/api/instance/local-factor-policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "required_role",
        requiredRoleId: "factor-role",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      policy: { mode: "required_role", requiredRoleId: "factor-role" },
    });

    const unknown = await app.request("/api/instance/local-factor-policy", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "required_role",
        requiredRoleId: "missing-role",
      }),
    });
    expect(unknown.status).toBe(400);
    const [stored] = await db
      .select({ policy: schema.instanceSettingTable.localFactorPolicy })
      .from(schema.instanceSettingTable);
    expect(stored?.policy).toEqual({
      mode: "required_role",
      requiredRoleId: "factor-role",
    });
  });

  it("resets MFA only with a substantive verification note and revokes sessions and keys", async () => {
    const now = new Date();
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-reset-admin",
        name: "Reset Admin",
        email: "reset-admin@example.test",
        role: "admin",
      })
      .returning();
    const [target] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-reset-target",
        name: "Protected User",
        email: "protected@example.test",
        twoFactorEnabled: true,
      })
      .returning();
    if (!admin || !target) throw new Error("reset users were not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const sessionId = `session-${admin.id}`;
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${admin.id}`,
      userId: admin.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.accountTable).values({
      id: "factor-reset-admin-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("test-password-credential", 4),
    });
    const [storedCredential] = await db
      .select({ password: schema.accountTable.password })
      .from(schema.accountTable)
      .where(eq(schema.accountTable.userId, admin.id));
    expect(
      storedCredential?.password &&
        (await bcrypt.compare(
          "test-password-credential",
          storedCredential.password,
        )),
    ).toBe(true);
    const adminFactor = await loadLocalFactorState(admin.id);
    expect({
      required: adminFactor.required,
      enabled: adminFactor.enabled,
    }).toEqual({ required: false, enabled: false });
    await db.insert(schema.twoFactorTable).values({
      id: "factor-reset-row",
      userId: target.id,
      secret: "encrypted-secret-fixture",
      backupCodes: "encrypted-backups-fixture",
      verified: true,
    });
    await db.insert(schema.sessionTable).values({
      id: "target-session-1",
      token: "opaque-session-fixture",
      userId: target.id,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.apikeyTable).values({
      id: "target-key-1",
      referenceId: target.id,
      userId: target.id,
      key: "opaque-key-fixture",
      createdAt: now,
      updatedAt: now,
    });
    const { app } = createApp();

    const rejected = await app.request(
      `/api/instance/users/${target.id}/reset-mfa`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verificationNote: "too short" }),
      },
    );
    expect(rejected.status).toBe(400);
    expect(
      (
        await db
          .select({ enabled: schema.userTable.twoFactorEnabled })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.enabled,
    ).toBe(true);

    const verificationNote =
      "Called the listed manager and verified the account recovery request.";
    const nonceChallengeResponse = await app.request(
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "mfa_reset",
          userId: target.id,
          verificationNote,
        }),
      },
    );
    const nonceChallenge = (await nonceChallengeResponse.json()) as {
      challengeId: string;
      nonce: string;
    };
    const wrongNonce = await app.request("/api/me/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "mfa_reset",
        userId: target.id,
        verificationNote,
        challengeId: nonceChallenge.challengeId,
        nonce: "A".repeat(43),
        method: "password",
        password: "test-password-credential",
      }),
    });
    expect(wrongNonce.status).toBe(403);

    const factorChallengeResponse = await app.request(
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "mfa_reset",
          userId: target.id,
          verificationNote,
        }),
      },
    );
    const factorChallenge = (await factorChallengeResponse.json()) as {
      challengeId: string;
      nonce: string;
    };
    const unavailableFactor = await app.request("/api/me/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "mfa_reset",
        userId: target.id,
        verificationNote,
        challengeId: factorChallenge.challengeId,
        nonce: factorChallenge.nonce,
        method: "totp",
        code: "000000",
      }),
    });
    expect(unavailableFactor.status).toBe(403);

    const challenge = await app.request("/api/me/step-up/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "mfa_reset",
        userId: target.id,
        verificationNote,
      }),
    });
    expect(challenge.status).toBe(200);
    const binding = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    expect(
      await db
        .select({
          id: schema.sessionTable.id,
          portal: schema.sessionTable.portal,
        })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, sessionId)),
    ).toEqual([{ id: sessionId, portal: "agent" }]);
    const [challengeRow] = await db
      .select({ bodyHash: schema.stepUpConfirmationTable.bodyHash })
      .from(schema.stepUpConfirmationTable)
      .where(eq(schema.stepUpConfirmationTable.id, binding.challengeId));
    expect(
      challengeRow?.bodyHash?.equals(
        sha256(canonicalMfaResetBody(target.id, verificationNote)),
      ),
    ).toBe(true);
    const proof = await app.request("/api/me/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "mfa_reset",
        userId: target.id,
        verificationNote,
        challengeId: binding.challengeId,
        nonce: binding.nonce,
        method: "password",
        password: "test-password-credential",
      }),
    });
    const proofText = await proof.text();
    const proofBody = (() => {
      try {
        return JSON.parse(proofText) as { message?: string; token?: string };
      } catch {
        return { message: proofText };
      }
    })();
    expect(
      proof.status,
      JSON.stringify({
        body: proofBody,
        challenge: await db
          .select({
            state: schema.stepUpConfirmationTable.state,
            operation: schema.stepUpConfirmationTable.operationKey,
            route: schema.stepUpConfirmationTable.routeKey,
            expectedVersion: schema.stepUpConfirmationTable.expectedVersion,
          })
          .from(schema.stepUpConfirmationTable),
      }),
    ).toBe(200);
    const { token } = proofBody as { token: string };
    const issuedAudit = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_issued"));
    expect(issuedAudit).toEqual([
      {
        after: {
          bindingKind: "operation",
          operation: "mfa_reset",
          route: "POST /api/instance/users/{id}/reset-mfa",
        },
      },
    ]);

    const wrongNote = await app.request(
      `/api/instance/users/${target.id}/reset-mfa`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({
          verificationNote: `${verificationNote} altered`,
        }),
      },
    );
    expect(wrongNote.status).toBe(403);
    let deniedAudits = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_denied"));
    expect(deniedAudits).toHaveLength(3);
    expect(JSON.stringify(deniedAudits)).not.toContain(verificationNote);
    expect(JSON.stringify(deniedAudits)).not.toContain(token);
    expect(
      (
        await db
          .select({ enabled: schema.userTable.twoFactorEnabled })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.enabled,
    ).toBe(true);

    await db
      .update(schema.stepUpConfirmationTable)
      .set({ tokenExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.stepUpConfirmationTable.id, binding.challengeId));
    const expired = await app.request(
      `/api/instance/users/${target.id}/reset-mfa`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ verificationNote }),
      },
    );
    expect(expired.status).toBe(403);
    deniedAudits = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_denied"));
    expect(deniedAudits).toHaveLength(4);

    const secondChallengeResponse = await app.request(
      "/api/me/step-up/challenges",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "mfa_reset",
          userId: target.id,
          verificationNote,
        }),
      },
    );
    const secondChallenge = (await secondChallengeResponse.json()) as {
      challengeId: string;
      nonce: string;
    };
    const secondProof = await app.request("/api/me/step-up", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "mfa_reset",
        userId: target.id,
        verificationNote,
        challengeId: secondChallenge.challengeId,
        nonce: secondChallenge.nonce,
        method: "password",
        password: "test-password-credential",
      }),
    });
    expect(secondProof.status).toBe(200);
    const secondToken = ((await secondProof.json()) as { token: string }).token;

    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: false })
      .where(eq(schema.userTable.id, target.id));
    const targetChanged = await app.request(
      `/api/instance/users/${target.id}/reset-mfa`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": secondToken,
        },
        body: JSON.stringify({ verificationNote }),
      },
    );
    expect(targetChanged.status).toBe(409);
    expect(
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "auth.step_up_consumed")),
    ).toHaveLength(0);
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: true })
      .where(eq(schema.userTable.id, target.id));

    const reset = await app.request(
      `/api/instance/users/${target.id}/reset-mfa`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": secondToken,
        },
        body: JSON.stringify({ verificationNote }),
      },
    );
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({
      reset: true,
      notificationEmailSent: true,
    });
    expect(
      (
        await db
          .select({ enabled: schema.userTable.twoFactorEnabled })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.enabled,
    ).toBe(false);
    expect(
      await db
        .select({ id: schema.twoFactorTable.id })
        .from(schema.twoFactorTable)
        .where(eq(schema.twoFactorTable.userId, target.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, target.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.apikeyTable.id })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, target.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ type: schema.notificationTable.type })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.userId, target.id)),
    ).toEqual([{ type: "security_alert" }]);
    const consumedAudit = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_consumed"));
    expect(consumedAudit).toEqual([
      {
        after: {
          bindingKind: "operation",
          operation: "mfa_reset",
          route: "POST /api/instance/users/{id}/reset-mfa",
        },
      },
    ]);
    expect(JSON.stringify(consumedAudit)).not.toContain(verificationNote);
    expect(JSON.stringify(consumedAudit)).not.toContain(secondToken);
    const replay = await app.request(
      `/api/instance/users/${target.id}/reset-mfa`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": secondToken,
        },
        body: JSON.stringify({ verificationNote }),
      },
    );
    expect(replay.status).toBe(403);
    deniedAudits = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_denied"));
    expect(deniedAudits).toHaveLength(6);
  });

  it("bounds repeated wrong step-up passwords and issues no reusable proof", async () => {
    const now = new Date();
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "factor-step-up-admin",
        name: "Step-up Admin",
        email: "step-up-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("step-up admin was not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await db.insert(schema.sessionTable).values({
      id: `session-${admin.id}`,
      token: `token-${admin.id}`,
      userId: admin.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.accountTable).values({
      id: "factor-step-up-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("the-correct-password", 4),
    });
    const { app } = createApp();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const challengeResponse = await app.request(
        "/api/me/step-up/challenges",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "operation",
            operation: "metrics_token_rotate",
            version: 1,
          }),
        },
      );
      expect(challengeResponse.status).toBe(200);
      const challenge = (await challengeResponse.json()) as {
        challengeId: string;
        nonce: string;
      };
      const proof = await app.request("/api/me/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "metrics_token_rotate",
          version: 1,
          challengeId: challenge.challengeId,
          nonce: attempt === 0 ? "A".repeat(43) : challenge.nonce,
          method: "password",
          password: attempt === 0 ? "the-correct-password" : "wrong-password",
        }),
      });
      expect(proof.status).toBe(403);
      expect(await proof.text()).toBe("step_up_unavailable");
    }
    const denialRows = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_denied"));
    expect(denialRows).toHaveLength(5);
    expect(JSON.stringify(denialRows)).not.toContain("wrong-password");
    expect(JSON.stringify(denialRows)).not.toContain("A".repeat(43));

    const limited = await app.request("/api/me/step-up/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "metrics_token_rotate",
        version: 1,
      }),
    });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      message: "step_up_attempt_limit",
      limit: 5,
      windowMinutes: 15,
    });
    const afterLimitRows = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_denied"));
    expect(afterLimitRows).toHaveLength(6);
    const rows = await db
      .select({
        state: schema.stepUpConfirmationTable.state,
        challengeExpiresAt: schema.stepUpConfirmationTable.challengeExpiresAt,
      })
      .from(schema.stepUpConfirmationTable)
      .where(
        eq(schema.stepUpConfirmationTable.sessionId, `session-${admin.id}`),
      );
    expect(rows).toHaveLength(5);
    expect(
      rows.every(
        (row) =>
          row.state === "challenge" && row.challengeExpiresAt <= new Date(),
      ),
    ).toBe(true);
    const setting = (
      await db
        .select({
          version: schema.instanceSettingTable.observabilityConfigVersion,
          tokenHash: schema.instanceSettingTable.metricsTokenHash,
        })
        .from(schema.instanceSettingTable)
    )[0];
    expect(setting).toEqual({ version: 1, tokenHash: null });
  });

  it("audits rotation consumption transactionally and preserves AU-14 on SQL failure", async () => {
    const now = new Date();
    const [admin] = await db
      .insert(schema.userTable)
      .values({
        id: "step-up-audit-rotation-admin",
        name: "Audit Rotation Admin",
        email: "step-up-audit-rotation-admin@example.test",
        role: "admin",
      })
      .returning();
    if (!admin) throw new Error("rotation administrator was not created");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await db.insert(schema.sessionTable).values({
      id: `session-${admin.id}`,
      token: `token-${admin.id}`,
      userId: admin.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.accountTable).values({
      id: "step-up-audit-rotation-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("rotation-test-password", 4),
    });
    const { app } = createApp();

    const issueToken = async (version: number) => {
      const challengeResponse = await app.request(
        "/api/me/step-up/challenges",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "operation",
            operation: "metrics_token_rotate",
            version,
          }),
        },
      );
      expect(challengeResponse.status).toBe(200);
      const challenge = (await challengeResponse.json()) as {
        challengeId: string;
        nonce: string;
      };
      const proof = await app.request("/api/me/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "operation",
          operation: "metrics_token_rotate",
          version,
          challengeId: challenge.challengeId,
          nonce: challenge.nonce,
          method: "password",
          password: "rotation-test-password",
        }),
      });
      expect(proof.status).toBe(200);
      return (await proof.json()) as { token: string };
    };

    const rotate = async (version: number, token: string) =>
      app.request("/api/instance/observability/metrics-token/rotate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ version }),
      });

    const firstToken = await issueToken(1);
    const firstRotation = await rotate(1, firstToken.token);
    expect(firstRotation.status).toBe(200);
    const firstConsumed = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.step_up_consumed"));
    expect(firstConsumed).toEqual([
      {
        after: {
          bindingKind: "operation",
          operation: "metrics_token_rotate",
          route: "POST /api/instance/observability/metrics-token/rotate",
        },
      },
    ]);

    const replay = await rotate(2, firstToken.token);
    expect(replay.status).toBe(403);
    expect(
      await db
        .select({ id: schema.auditLogTable.id })
        .from(schema.auditLogTable)
        .where(eq(schema.auditLogTable.action, "auth.step_up_denied")),
    ).toHaveLength(1);

    const secondToken = await issueToken(2);
    await db.execute(sql`
      CREATE FUNCTION fail_step_up_consumed_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'auth.step_up_consumed' THEN
          RAISE EXCEPTION 'fixture audit insert failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await db.execute(sql`
      CREATE TRIGGER fail_step_up_consumed_insert
      BEFORE INSERT ON audit_log
      FOR EACH ROW EXECUTE FUNCTION fail_step_up_consumed_insert()
    `);
    try {
      const secondRotation = await rotate(2, secondToken.token);
      expect(secondRotation.status).toBe(200);
      const [setting] = await db
        .select({
          version: schema.instanceSettingTable.observabilityConfigVersion,
          tokenHash: schema.instanceSettingTable.metricsTokenHash,
        })
        .from(schema.instanceSettingTable);
      expect(setting?.version).toBe(3);
      expect(setting?.tokenHash).not.toBeNull();
      expect(
        await db
          .select({ type: schema.notificationTable.type })
          .from(schema.notificationTable)
          .where(eq(schema.notificationTable.userId, admin.id)),
      ).toContainEqual({ type: "audit_write_failed" });
      expect(
        await db
          .select({ id: schema.auditLogTable.id })
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.action, "auth.step_up_consumed")),
      ).toHaveLength(1);
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS fail_step_up_consumed_insert ON audit_log`,
      );
      await db.execute(
        sql`DROP FUNCTION IF EXISTS fail_step_up_consumed_insert()`,
      );
    }
  });
});
