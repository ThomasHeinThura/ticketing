import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canonicalInstanceAdminGrantBody,
  sha256,
} from "../../apps/api/src/auth/step-up-service";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

function agentRequest(
  app: ReturnType<typeof createApp>["app"],
  input: string,
  init?: RequestInit,
) {
  const request = withConfiguredAgentAuthority(input, init);
  return app.request(request.input, request.init);
}

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

async function seedUser(id: string, role: string | null = null) {
  const [user] = await db
    .insert(schema.userTable)
    .values({
      id,
      name: `User ${id}`,
      email: `${id}@example.test`,
      role,
    })
    .returning();
  if (!user) throw new Error("user fixture was not created");
  return user;
}

async function seedSession(userId: string) {
  const now = new Date();
  const id = `session-${userId}`;
  await db.insert(schema.sessionTable).values({
    id,
    token: `token-${userId}`,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createGrantToken(
  app: ReturnType<typeof createApp>["app"],
  targetUserId: string,
) {
  const challengeResponse = await agentRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "operation",
        operation: "instance_admin_grant",
        targetUserId,
      }),
    },
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const [challengeRow] = await db
    .select({
      operationKey: schema.stepUpConfirmationTable.operationKey,
      routeKey: schema.stepUpConfirmationTable.routeKey,
      expectedVersion: schema.stepUpConfirmationTable.expectedVersion,
      bodyHash: schema.stepUpConfirmationTable.bodyHash,
    })
    .from(schema.stepUpConfirmationTable)
    .where(eq(schema.stepUpConfirmationTable.id, challenge.challengeId));
  expect(challengeRow).toMatchObject({
    operationKey: "instance_admin_grant",
    routeKey: "POST /api/instance/users/{id}/grant-admin",
    expectedVersion: 1,
  });
  expect(
    challengeRow?.bodyHash?.equals(
      sha256(canonicalInstanceAdminGrantBody(targetUserId)),
    ),
  ).toBe(true);
  const proofResponse = await agentRequest(app, "/api/me/step-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "operation",
      operation: "instance_admin_grant",
      targetUserId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "password",
      password: "p4-test-password",
    }),
  });
  expect(proofResponse.status).toBe(200);
  return ((await proofResponse.json()) as { token: string }).token;
}

describe("God Mode Users API", () => {
  it("returns an allowlisted stable cursor directory and refuses a cursor under changed filters", async () => {
    const admin = await seedUser("users-directory-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await seedUser("users-directory-a");
    await seedUser("users-directory-b");
    const { app } = createApp();

    const first = await agentRequest(
      app,
      "/api/instance/users?limit=1&q=directory",
    );
    expect(first.status).toBe(200);
    const page1 = (await first.json()) as {
      data: Array<Record<string, unknown>>;
      page: { nextCursor: string | null; hasMore: boolean };
    };
    expect(page1.data).toHaveLength(1);
    expect(page1.page.hasMore).toBe(true);
    expect(page1.page.nextCursor).toBeTruthy();
    const nextCursor = page1.page.nextCursor;
    if (!nextCursor) throw new Error("Expected another page");
    expect(Object.keys(page1.data[0] ?? {}).sort()).toEqual([
      "createdAt",
      "email",
      "emailVerified",
      "id",
      "isInstanceAdmin",
      "isSuspended",
      "locale",
      "name",
      "person",
      "suspensionExpiresAt",
      "twoFactorEnabled",
    ]);
    const second = await agentRequest(
      app,
      `/api/instance/users?limit=1&q=directory&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(second.status).toBe(200);
    const page2 = (await second.json()) as { data: Array<{ id: string }> };
    expect(page2.data[0]?.id).not.toBe(page1.data[0]?.id);
    const changed = await agentRequest(
      app,
      `/api/instance/users?limit=1&q=other&cursor=${encodeURIComponent(nextCursor)}`,
    );
    expect(changed.status).toBe(400);
  });

  it("suspends with a bounded reason, revokes sessions and native keys, and never exposes the reason", async () => {
    const admin = await seedUser("users-suspend-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const target = await seedUser("users-suspend-target");
    await seedSession(target.id);
    await db.insert(schema.apikeyTable).values({
      id: "users-suspend-key",
      referenceId: target.id,
      userId: target.id,
      key: createHash("sha256").update("fixture-key").digest("base64url"),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = createApp();
    const oversizedReason = await agentRequest(
      app,
      `/api/instance/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "😀".repeat(501) }),
      },
    );
    expect(oversizedReason.status).toBe(400);
    const expired = await agentRequest(
      app,
      `/api/instance/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
        }),
      },
    );
    expect(expired.status).toBe(400);
    expect(
      (
        await db
          .select({ banned: schema.userTable.banned })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.banned,
    ).toBe(false);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, target.id)),
    ).toHaveLength(1);
    const response = await agentRequest(
      app,
      `/api/instance/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reason: "  security investigation  ",
          expiresAt: null,
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ suspended: true, expiresAt: null });
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
    const [stored] = await db
      .select({
        banned: schema.userTable.banned,
        banReason: schema.userTable.banReason,
        banExpires: schema.userTable.banExpires,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, target.id));
    expect(stored).toEqual({
      banned: true,
      banReason: "security investigation",
      banExpires: null,
    });
    const detail = await agentRequest(app, `/api/instance/users/${target.id}`);
    expect(detail.status).toBe(200);
    expect(await detail.text()).not.toContain("security investigation");
    const [audit] = await db
      .select({
        action: schema.auditLogTable.action,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "auth.user_suspended"));
    expect(audit?.after).toEqual({
      outcome: "suspended",
      finiteExpiry: false,
      revokedSessions: 1,
    });
  });

  it("unsuspends without restoring credentials and sign-out leaves API keys unchanged", async () => {
    const admin = await seedUser("users-session-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    const target = await seedUser("users-session-target");
    const originalSession = await seedSession(target.id);
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: "users-session-key",
      referenceId: target.id,
      userId: target.id,
      key: createHash("sha256").update("fixture-key2").digest("base64url"),
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.userTable)
      .set({
        banned: true,
        banReason: "expired reason",
        banExpires: new Date(now.getTime() - 1000),
      })
      .where(eq(schema.userTable.id, target.id));
    const { app } = createApp();
    const unsuspend = await agentRequest(
      app,
      `/api/instance/users/${target.id}/unsuspend`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(unsuspend.status).toBe(200);
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, target.id)),
    ).toHaveLength(1);
    const signOut = await agentRequest(
      app,
      `/api/instance/users/${target.id}/sign-out`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(signOut.status).toBe(200);
    expect(await signOut.json()).toEqual({ revokedSessions: 1 });
    expect(
      await db
        .select({ id: schema.sessionTable.id })
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.id, originalSession)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.apikeyTable.id })
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.referenceId, target.id)),
    ).toHaveLength(1);
  });

  it("grants administrator with target/body/session-bound one-use proof and commits alerts atomically", async () => {
    const admin = await seedUser("users-grant-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    const actorSessionId = await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-grant-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const target = await seedUser("users-grant-target");
    await ensureStaffPersonForUser(target.id);
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const token = await createGrantToken(app, target.id);
    const wrongTarget = await agentRequest(
      app,
      `/api/instance/users/${admin.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(wrongTarget.status).toBe(403);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBeNull();
    const grant = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(grant.status).toBe(200);
    expect(await grant.json()).toEqual({ outcome: "granted" });
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBe("admin");
    expect(
      await db
        .select({ side: schema.personTable.side })
        .from(schema.personTable)
        .where(eq(schema.personTable.userId, target.id)),
    ).toEqual([{ side: "staff" }]);
    expect(
      await db
        .select({ userId: schema.notificationTable.userId })
        .from(schema.notificationTable)
        .where(eq(schema.notificationTable.type, "security_alert")),
    ).toHaveLength(2);
    const replay = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(replay.status).toBe(403);
    expect(actorSessionId).toBe(`session-${admin.id}`);
  });

  it("refuses an admin grant if first-run setup is no longer complete", async () => {
    const admin = await seedUser("users-grant-setup-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-grant-setup-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const target = await seedUser("users-grant-setup-target");
    await ensureStaffPersonForUser(target.id);
    mockAuthenticatedSession(admin);
    const { app } = createApp();
    const token = await createGrantToken(app, target.id);
    await db
      .update(schema.instanceSettingTable)
      .set({ setupCompletedAt: null })
      .where(eq(schema.instanceSettingTable.id, "singleton"));

    const response = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );

    expect(response.status).toBe(403);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBeNull();
    expect(
      await db
        .select({ id: schema.notificationTable.id })
        .from(schema.notificationTable),
    ).toHaveLength(0);
  });

  it("rejects grants to unlinked and customer targets without changing authority", async () => {
    const admin = await seedUser("users-grant-negative-admin", "admin");
    await ensureStaffPersonForUser(admin.id);
    mockAuthenticatedSession(admin);
    await seedSession(admin.id);
    await db.insert(schema.accountTable).values({
      id: "users-grant-negative-account",
      accountId: admin.id,
      providerId: "credential",
      userId: admin.id,
      password: await bcrypt.hash("p4-test-password", 4),
    });
    const unlinkedTarget = await seedUser("users-grant-unlinked-target");
    const { app } = createApp();
    const unlinkedToken = await createGrantToken(app, unlinkedTarget.id);
    const unlinkedResult = await agentRequest(
      app,
      `/api/instance/users/${unlinkedTarget.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": unlinkedToken,
        },
        body: "{}",
      },
    );
    expect(unlinkedResult.status).toBe(409);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, unlinkedTarget.id))
      )[0]?.role,
    ).toBeNull();

    const target = await seedUser("users-grant-negative-target");
    const internalOrganisation = await ensureInternalOrganisation();
    await db.insert(schema.personTable).values({
      id: "users-grant-negative-person",
      userId: target.id,
      side: "customer",
      organisationId: internalOrganisation.id,
      active: true,
      isPlaceholder: false,
    });
    const token = await createGrantToken(app, target.id);
    const result = await agentRequest(
      app,
      `/api/instance/users/${target.id}/grant-admin`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: "{}",
      },
    );
    expect(result.status).toBe(409);
    expect(
      (
        await db
          .select({ role: schema.userTable.role })
          .from(schema.userTable)
          .where(eq(schema.userTable.id, target.id))
      )[0]?.role,
    ).toBeNull();
  });
});
