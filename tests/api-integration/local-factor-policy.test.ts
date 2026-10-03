import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocalFactorState } from "../../apps/api/src/auth/local-factor-service";
import {
  canonicalMfaResetBody,
  sha256,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
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
    expect(
      (
        await db
          .select({ enabled: schema.userTable.twoFactorEnabled })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.enabled,
    ).toBe(true);

    const reset = await app.request(
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
          nonce: challenge.nonce,
          method: "password",
          password: "wrong-password",
        }),
      });
      expect(proof.status).toBe(403);
      expect(await proof.text()).toBe("step_up_unavailable");
    }

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
});
