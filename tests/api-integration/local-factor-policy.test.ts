import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "../../apps/api/src/auth";
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
import * as observability from "../../apps/api/src/instance/observability/runtime";
import { lockPendingActionLifecycle } from "../../apps/api/src/pending-action/lifecycle-invalidation";
import { createPendingAction } from "../../apps/api/src/pending-action/service";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import {
  createCredentialBoundPendingAction,
  expectCredentialInvalidationPersisted,
} from "./helpers/pending-action";

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
let totpSignInAddress = 10;
function nextTotpTestIp() {
  return `198.51.100.${(++totpSignInAddress % 240) + 1}`;
}

async function waitForLifecycleWaiters(client: Client, count: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_locks
       WHERE locktype = 'advisory'
         AND classid = hashtext('taskdesk:pending-action-lifecycle')::oid
         AND objid = hashtext('global')::oid
         AND objsubid = 2 AND NOT granted`,
    );
    if (Number(result.rows[0]?.count ?? "0") >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${count} lifecycle gate waiters`);
}

function gate<T>() {
  let resolve = (_value: T | PromiseLike<T>) => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

vi.mock("@taskdesk/email", () => ({
  isSmtpConfigured: () => true,
  sendNotificationEmail: vi.fn(async () => ({ success: true })),
}));

beforeEach(async () => {
  await resetTestDatabase();
  await db.insert(schema.instanceSettingTable).values({ id: "singleton" });
});

async function prepareTotpEnrollmentFailureFixture(id: string) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: `TOTP ${id}`,
      email: `${id}@example.test`,
      role: "admin",
    })
    .returning();
  if (!user) throw new Error("TOTP failure user was not created");
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person) throw new Error("TOTP failure identity was not created");
  const password = `${id}-password`;
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(password, 4),
  });
  const { app } = createApp();
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextTotpTestIp(),
    },
    body: JSON.stringify({ email: user.email, password }),
  });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("TOTP failure session cookie was not issued");
  const enabled = await app.request("/api/auth/two-factor/enable", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-forwarded-for": nextTotpTestIp(),
    },
    body: JSON.stringify({ password, issuer: "TaskDesk" }),
  });
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const enrollment = (await enabled.json()) as { totpURI: string };
  const secret = new URL(enrollment.totpURI).searchParams.get("secret");
  if (!secret) throw new Error("TOTP failure fixture has no secret");
  const code = await createOTP(
    Buffer.from(base32.decode(secret)).toString("utf8"),
  ).totp();
  const [session] = await db
    .select()
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, user.id))
    .limit(1);
  if (!session) throw new Error("TOTP failure session was not persisted");
  const { workspace } = await createWorkspaceMember();
  const actionId = await createCredentialBoundPendingAction({
    requesterPersonId: person.id,
    workspaceId: workspace.id,
    organisationId: workspace.organisationId,
    credentialType: "session",
    credentialId: session.id,
  });
  return {
    app,
    user,
    session,
    cookie,
    code,
    actionId,
    verifyIp: nextTotpTestIp(),
  };
}

async function prepareTotpLifecycleRaceFixture(id: string) {
  const { user, workspace } = await createWorkspaceMember({
    userName: `TOTP ${id}`,
    role: "admin",
  });
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: await bcrypt.hash(`${id}-password`, 4),
  });
  const projectFixture = await createProjectFixture({
    workspaceId: workspace.id,
    slug: `${id}-project`,
  });
  const project = projectFixture.project;
  const [projectRole] = await db
    .insert(schema.roleTable)
    .values({
      scope: "project",
      workspaceId: workspace.id,
      key: `${id}-delete-role`,
      name: "TOTP race delete role",
      rank: 100,
      capabilities: ["work_item:delete"],
      isSystem: false,
      isEditable: true,
    })
    .returning();
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!projectRole || !person)
    throw new Error("TOTP lifecycle race authority was not created");
  await db.insert(schema.membershipTable).values({
    personId: person.id,
    scope: "project",
    scopeId: project.id,
    roleId: projectRole.id,
    seesAll: false,
  });
  const now = new Date();
  const [type] = await db
    .insert(schema.workItemTypeTable)
    .values({
      workspaceId: workspace.id,
      key: `${id}-type`,
      name: "Work item",
      category: "delivery",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [template] = await db
    .insert(schema.stateTemplateTable)
    .values({
      workspaceId: workspace.id,
      key: `${id}-state`,
      name: "Backlog",
      group: "backlog",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!type || !template)
    throw new Error("TOTP race work item defaults missing");
  const [state] = await db
    .insert(schema.stateTable)
    .values({
      projectId: project.id,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!state) throw new Error("TOTP race work item state missing");
  const key = `${id.toUpperCase()}-1`;
  await db.insert(schema.workItemTable).values({
    projectId: project.id,
    workspaceId: workspace.id,
    typeId: type.id,
    stateId: state.id,
    number: 1,
    key,
    title: "TOTP lifecycle race target",
    createdAt: now,
    updatedAt: now,
  });

  const { app } = createApp();
  const password = `${id}-password`;
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": nextTotpTestIp(),
    },
    body: JSON.stringify({ email: user.email, password }),
  });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const cookie = signIn.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("TOTP lifecycle race cookie was not issued");
  const enabled = await app.request("/api/auth/two-factor/enable", {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/json",
      "x-forwarded-for": nextTotpTestIp(),
    },
    body: JSON.stringify({ password, issuer: "TaskDesk" }),
  });
  expect(enabled.status, await enabled.clone().text()).toBe(200);
  const enrollment = (await enabled.json()) as { totpURI: string };
  const secret = new URL(enrollment.totpURI).searchParams.get("secret");
  if (!secret) throw new Error("TOTP lifecycle race secret was not issued");
  const code = await createOTP(
    Buffer.from(base32.decode(secret)).toString("utf8"),
  ).totp();
  const [session] = await db
    .select()
    .from(schema.sessionTable)
    .where(eq(schema.sessionTable.userId, user.id))
    .limit(1);
  if (!session)
    throw new Error("TOTP lifecycle race session was not persisted");
  return {
    app,
    user,
    person,
    workspace,
    project,
    key,
    cookie,
    code,
    session,
    verifyIp: nextTotpTestIp(),
  };
}

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
    const { workspace } = await createWorkspaceMember({
      userName: "TOTP peer-session requester",
    });
    const [requester] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id));
    if (!requester) throw new Error("TOTP requester identity was not created");
    const password = "factor-lifecycle-password";
    await db.insert(schema.accountTable).values({
      id: "factor-lifecycle-account",
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(password, 4),
    });
    const { app } = createApp();
    const clientIp = nextTotpTestIp();
    const signIn = async () =>
      app.request("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": clientIp,
        },
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
    if (!initialCookie) throw new Error("TOTP login cookie was not issued");
    const [initialSession] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, user.id))
      .orderBy(schema.sessionTable.createdAt)
      .limit(1);
    if (!initialSession)
      throw new Error("TOTP login session was not persisted");
    const initialActionId = await createCredentialBoundPendingAction({
      requesterPersonId: requester.id,
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
      credentialType: "session",
      credentialId: initialSession.id,
    });
    const peerSessionId = "factor-lifecycle-peer-session";
    await db.insert(schema.sessionTable).values({
      id: peerSessionId,
      token: "factor-lifecycle-peer-token",
      userId: user.id,
      portal: "agent",
      expiresAt: new Date(Date.now() + 60 * 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const peerActionId = await createCredentialBoundPendingAction({
      requesterPersonId: requester.id,
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
      credentialType: "session",
      credentialId: peerSessionId,
    });
    const expiredPresentId = "factor-lifecycle-expired-present";
    const expiredPresentAt = new Date(Date.now() - 60_000);
    await db.insert(schema.sessionTable).values({
      id: expiredPresentId,
      token: `${expiredPresentId}-token`,
      userId: user.id,
      portal: "agent",
      expiresAt: expiredPresentAt,
      createdAt: expiredPresentAt,
      updatedAt: expiredPresentAt,
    });
    const expiredPresentActionId = await createCredentialBoundPendingAction({
      requesterPersonId: requester.id,
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
      credentialType: "session",
      credentialId: expiredPresentId,
    });
    const expiredCleanedId = "factor-lifecycle-expired-cleaned";
    await db.insert(schema.sessionTable).values({
      id: expiredCleanedId,
      token: `${expiredCleanedId}-token`,
      userId: user.id,
      portal: "agent",
      expiresAt: expiredPresentAt,
      createdAt: expiredPresentAt,
      updatedAt: expiredPresentAt,
    });
    const expiredCleanedActionId = await createCredentialBoundPendingAction({
      requesterPersonId: requester.id,
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
      credentialType: "session",
      credentialId: expiredCleanedId,
    });
    // Model ordinary expiry cleanup, which is intentionally nonterminal.
    await db
      .delete(schema.sessionTable)
      .where(eq(schema.sessionTable.id, expiredCleanedId));
    const enabled = await app.request("/api/auth/two-factor/enable", {
      method: "POST",
      headers: {
        cookie: initialCookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
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
    if (!totpSecret) throw new Error("TOTP enrollment URI has no secret");
    const rawSecret = Buffer.from(base32.decode(totpSecret)).toString("utf8");
    const code = await createOTP(rawSecret).totp();
    const enrolled = await app.request("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: {
        cookie: initialCookie,
        "content-type": "application/json",
        "x-forwarded-for": clientIp,
      },
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
    await expectCredentialInvalidationPersisted(peerActionId);
    await expectCredentialInvalidationPersisted(initialActionId);
    await expectCredentialInvalidationPersisted(expiredPresentActionId);
    expect(
      await db.query.pendingActionTable.findFirst({
        where: eq(schema.pendingActionTable.id, peerActionId),
      }),
    ).toMatchObject({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
    expect(
      await db.query.pendingActionTable.findFirst({
        where: eq(schema.pendingActionTable.id, expiredCleanedActionId),
      }),
    ).toMatchObject({ state: "pending", invalidationReason: null });

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
    if (!challengeCookie)
      throw new Error("Two-factor challenge cookie missing");
    const verifiedLogin = await app.request(
      "/api/auth/two-factor/verify-backup-code",
      {
        method: "POST",
        headers: {
          cookie: challengeCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: enrollment.backupCodes[0] }),
      },
    );
    expect(verifiedLogin.status).toBe(200);
    const verifiedCookie = sessionCookie(verifiedLogin);
    expect(verifiedCookie).toBeDefined();
    if (!verifiedCookie) throw new Error("Verified session cookie missing");
    const replay = await app.request(
      "/api/auth/two-factor/verify-backup-code",
      {
        method: "POST",
        headers: {
          cookie: challengeCookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code: enrollment.backupCodes[0] }),
      },
    );
    expect(replay.status).toBeGreaterThanOrEqual(400);
    const status = await app.request("/api/me/security/factors", {
      headers: { cookie: verifiedCookie },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      enabled: true,
      required: false,
    });
  });

  it("rolls back TOTP factor/session changes when the PA-9 outbox write fails", async () => {
    const fixture = await prepareTotpEnrollmentFailureFixture(
      "factor-totp-outbox-rollback",
    );
    const auditFailure = vi.spyOn(observability, "recordAuditWriteFailure");
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION fail_totp_pending_action_outbox()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = 'pending_action.decided' THEN
          RAISE EXCEPTION 'test TOTP pending-action outbox failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_totp_pending_action_outbox
      BEFORE INSERT ON outbox FOR EACH ROW
      EXECUTE FUNCTION fail_totp_pending_action_outbox();
    `),
    );
    try {
      const response = await fixture.app.request(
        "/api/auth/two-factor/verify-totp",
        {
          method: "POST",
          headers: {
            cookie: fixture.cookie,
            "content-type": "application/json",
            "x-forwarded-for": fixture.verifyIp,
          },
          body: JSON.stringify({ code: fixture.code }),
        },
      );
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(
        response.headers
          .getSetCookie()
          .some((cookie) => cookie.startsWith("__Host-tdk_agent_session=")),
      ).toBe(false);
      expect(
        await db.query.userTable.findFirst({
          where: eq(schema.userTable.id, fixture.user.id),
        }),
      ).toMatchObject({ twoFactorEnabled: false });
      expect(
        await db.query.sessionTable.findFirst({
          where: eq(schema.sessionTable.id, fixture.session.id),
        }),
      ).toBeDefined();
      expect(
        await db.query.pendingActionTable.findFirst({
          where: eq(schema.pendingActionTable.id, fixture.actionId),
        }),
      ).toMatchObject({ state: "pending", invalidationReason: null });
      expect(
        await db
          .select({ id: schema.outboxTable.eventId })
          .from(schema.outboxTable)
          .where(eq(schema.outboxTable.kind, "pending_action.decided")),
      ).toHaveLength(0);
      expect(auditFailure).not.toHaveBeenCalled();
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS fail_totp_pending_action_outbox ON outbox`,
      );
      await db.execute(
        sql`DROP FUNCTION IF EXISTS fail_totp_pending_action_outbox()`,
      );
      auditFailure.mockRestore();
    }
  });

  it("applies the same PA-9 boundary to Better Auth's direct verifyTOTP method", async () => {
    const fixture = await prepareTotpEnrollmentFailureFixture(
      "factor-totp-direct-api",
    );
    const result = await auth.api.verifyTOTP({
      body: { code: fixture.code, trustDevice: false },
      headers: new Headers({ cookie: fixture.cookie }),
    });
    expect(result.user.id).toBe(fixture.user.id);
    await expectCredentialInvalidationPersisted(fixture.actionId);
    expect(
      await db.query.pendingActionTable.findFirst({
        where: eq(schema.pendingActionTable.id, fixture.actionId),
      }),
    ).toMatchObject({
      state: "invalidated",
      invalidationReason: "credential_revoked",
    });
  });

  it.each(["create-first", "totp-first"] as const)(
    "serializes PA creation and TOTP enrollment when %s owns the lifecycle gate first",
    async (order) => {
      const fixture = await prepareTotpLifecycleRaceFixture(
        `factor-totp-race-${order}`,
      );
      const connectionString = process.env.TASKDESK_DATABASE_URL;
      if (!connectionString)
        throw new Error("TOTP lifecycle race needs the private test database");
      const observer = new Client({ connectionString });
      await observer.connect();
      const gateAcquired = gate<void>();
      const releaseGate = gate<void>();
      const blocker = db.transaction(async (tx) => {
        await lockPendingActionLifecycle(tx);
        gateAcquired.resolve();
        await releaseGate.promise;
      });
      await gateAcquired.promise;
      const createAction = () =>
        createPendingAction({
          requesterPersonId: fixture.person.id,
          credentialType: "session",
          credentialId: fixture.session.id,
          origin: "web",
          action: "delete",
          routeKey: "DELETE /api/work-items/{key}",
          targetType: "work_item",
          targetIds: [fixture.key],
          workspaceId: fixture.workspace.id,
          projectId: fixture.project.id,
          organisationId: fixture.workspace.organisationId,
          actorId: fixture.user.id,
          actorType: "person",
        });
      const enroll = () =>
        fixture.app.request("/api/auth/two-factor/verify-totp", {
          method: "POST",
          headers: {
            cookie: fixture.cookie,
            "content-type": "application/json",
            "x-forwarded-for": fixture.verifyIp,
          },
          body: JSON.stringify({ code: fixture.code }),
        });

      try {
        let createResult: ReturnType<typeof createPendingAction> | undefined;
        let enrollmentResult: Promise<Response> | undefined;
        if (order === "create-first") {
          createResult = createAction();
          await waitForLifecycleWaiters(observer, 1);
          enrollmentResult = Promise.resolve(enroll());
          await waitForLifecycleWaiters(observer, 2);
        } else {
          enrollmentResult = Promise.resolve(enroll());
          await waitForLifecycleWaiters(observer, 1);
          createResult = createAction();
          await waitForLifecycleWaiters(observer, 2);
        }
        releaseGate.resolve();
        await blocker;
        if (!enrollmentResult || !createResult)
          throw new Error("TOTP lifecycle race did not start both operations");
        const response = await enrollmentResult;
        expect(response.status, await response.clone().text()).toBe(200);
        if (order === "create-first") {
          const created = await createResult;
          await expectCredentialInvalidationPersisted(created.pendingActionId);
          expect(
            await db.query.pendingActionTable.findFirst({
              where: eq(schema.pendingActionTable.id, created.pendingActionId),
            }),
          ).toMatchObject({
            state: "invalidated",
            invalidationReason: "credential_revoked",
          });
        } else {
          await expect(createResult).rejects.toMatchObject({ status: 403 });
          expect(
            await db.select().from(schema.pendingActionTable),
          ).toHaveLength(0);
        }
      } finally {
        releaseGate.resolve();
        await blocker.catch(() => undefined);
        await observer.end();
      }
    },
  );

  it("reports TOTP PA-9 audit-only failures after its event and state commit", async () => {
    const fixture = await prepareTotpEnrollmentFailureFixture(
      "factor-totp-audit-failure",
    );
    const auditFailure = vi.spyOn(observability, "recordAuditWriteFailure");
    await db.execute(
      sql.raw(`
      CREATE OR REPLACE FUNCTION fail_totp_pending_action_audit()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'pending_action.decided' THEN
          RAISE EXCEPTION 'test TOTP pending-action audit failure';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER fail_totp_pending_action_audit
      BEFORE INSERT ON audit_log FOR EACH ROW
      EXECUTE FUNCTION fail_totp_pending_action_audit();
    `),
    );
    try {
      const response = await fixture.app.request(
        "/api/auth/two-factor/verify-totp",
        {
          method: "POST",
          headers: {
            cookie: fixture.cookie,
            "content-type": "application/json",
            "x-forwarded-for": fixture.verifyIp,
          },
          body: JSON.stringify({ code: fixture.code }),
        },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      expect(
        await db.query.pendingActionTable.findFirst({
          where: eq(schema.pendingActionTable.id, fixture.actionId),
        }),
      ).toMatchObject({
        state: "invalidated",
        invalidationReason: "credential_revoked",
      });
      expect(
        await db
          .select({ id: schema.outboxTable.eventId })
          .from(schema.outboxTable)
          .where(
            and(
              eq(schema.outboxTable.kind, "pending_action.decided"),
              sql`${schema.outboxTable.payload}->'payload'->>'pendingActionId' = ${fixture.actionId}`,
            ),
          ),
      ).toHaveLength(1);
      expect(auditFailure).toHaveBeenCalledWith("pending_action_decision");
      expect(auditFailure).toHaveBeenCalledTimes(1);
      expect(
        await db
          .select({ id: schema.auditLogTable.id })
          .from(schema.auditLogTable)
          .where(
            and(
              eq(schema.auditLogTable.action, "auth.mfa_enrolled"),
              eq(schema.auditLogTable.entityId, fixture.user.id),
            ),
          ),
      ).toHaveLength(1);
    } finally {
      await db.execute(
        sql`DROP TRIGGER IF EXISTS fail_totp_pending_action_audit ON audit_log`,
      );
      await db.execute(
        sql`DROP FUNCTION IF EXISTS fail_totp_pending_action_audit()`,
      );
      auditFailure.mockRestore();
    }
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
    const invalidChallenge = await app.request("/api/me/step-up/challenges", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "mfa_reset",
        userId: target.id,
        verificationNote,
        pendingActionId: "must-not-cross-union-branches",
      }),
    });
    expect(invalidChallenge.status).toBe(400);

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

    const { workspace } = await createWorkspaceMember();
    const requester = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, admin.id));
    const requesterPersonId = requester[0]?.id;
    if (!requesterPersonId) throw new Error("admin person was not created");
    const sessionActionId = await createCredentialBoundPendingAction({
      requesterPersonId,
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
      credentialType: "session",
      credentialId: "target-session-1",
    });
    const keyActionId = await createCredentialBoundPendingAction({
      requesterPersonId,
      workspaceId: workspace.id,
      organisationId: workspace.organisationId,
      credentialType: "api_key",
      credentialId: "target-key-1",
    });

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
    const invalidatedActions = await db
      .select({
        id: schema.pendingActionTable.id,
        state: schema.pendingActionTable.state,
        reason: schema.pendingActionTable.invalidationReason,
      })
      .from(schema.pendingActionTable)
      .where(
        inArray(schema.pendingActionTable.id, [sessionActionId, keyActionId]),
      );
    expect(
      Object.fromEntries(
        invalidatedActions.map(({ id, ...state }) => [id, state]),
      ),
    ).toEqual({
      [sessionActionId]: { state: "invalidated", reason: "credential_revoked" },
      [keyActionId]: { state: "invalidated", reason: "credential_revoked" },
    });
    await expectCredentialInvalidationPersisted(sessionActionId);
    await expectCredentialInvalidationPersisted(keyActionId);
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
