import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  databaseErrorCode,
  retryIdentityGrantClosure,
} from "../../apps/api/src/identity/repository";
import { createApp } from "../../apps/api/src/index";
import { createPendingAction } from "../../apps/api/src/pending-action/service";
import {
  ensureInternalOrganisation,
  ensureStaffPersonForUser,
} from "../../apps/api/src/utils/seed-internal-organisation";
import * as ws from "../../apps/api/src/ws";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

type App = ReturnType<typeof createApp>["app"];

function agentRequest(app: App, input: string, init?: RequestInit) {
  const request = withConfiguredAgentAuthority(input, init);
  return app.request(request.input, request.init);
}

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seedUser(id: string, role: string | null = null) {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: `User ${id}`, email: `${id}@example.test`, role })
    .returning();
  if (!user) throw new Error("user fixture was not created");
  return user;
}

async function seedSession(userId: string, suffix = "") {
  const now = new Date();
  const id = `session-${userId}${suffix}`;
  await db.insert(schema.sessionTable).values({
    id,
    token: `token-${userId}${suffix}`,
    userId,
    portal: "agent",
    expiresAt: new Date(now.getTime() + 3_600_000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function makeAdmin(id: string) {
  const user = await seedUser(id, "admin");
  const [person] = await ensureStaffPersonForUser(user.id).then(() =>
    db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, user.id)),
  );
  if (!person) throw new Error("admin person missing");
  const sessionId = await seedSession(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await bcrypt.hash("p4-test-password", 4),
  });
  return { user, person, sessionId };
}

async function makeTarget(id: string, role: string | null = null) {
  const user = await seedUser(id, role);
  await ensureStaffPersonForUser(user.id);
  const [person] = await db
    .select()
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, user.id));
  if (!person) throw new Error("target person missing");
  return { user, person };
}

const json = { "content-type": "application/json" };

async function requestDeactivation(app: App, targetId: string) {
  const response = await agentRequest(
    app,
    `/api/instance/users/${targetId}/deactivate`,
    { method: "POST", headers: json, body: "{}" },
  );
  expect(response.status).toBe(202);
  return ((await response.json()) as { pendingActionId: string })
    .pendingActionId;
}

async function pendingActionToken(app: App, pendingActionId: string) {
  const challengeResponse = await agentRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({ kind: "pending_action", pendingActionId }),
    },
  );
  expect(challengeResponse.status).toBe(200);
  const challenge = (await challengeResponse.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proofResponse = await agentRequest(app, "/api/me/step-up", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      kind: "pending_action",
      pendingActionId,
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      method: "password",
      password: "p4-test-password",
    }),
  });
  expect(proofResponse.status).toBe(200);
  return ((await proofResponse.json()) as { token: string }).token;
}

async function grantToken(app: App, targetUserId: string) {
  const challengeResponse = await agentRequest(
    app,
    "/api/me/step-up/challenges",
    {
      method: "POST",
      headers: json,
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
  const proofResponse = await agentRequest(app, "/api/me/step-up", {
    method: "POST",
    headers: json,
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

function approve(
  app: App,
  pendingActionId: string,
  typedName: string,
  token?: string,
) {
  return agentRequest(
    app,
    `/api/me/pending-actions/${pendingActionId}/approve`,
    {
      method: "POST",
      headers: {
        ...json,
        ...(token === undefined ? {} : { "x-taskdesk-step-up-token": token }),
      },
      body: JSON.stringify({ typedName }),
    },
  );
}

function grant(app: App, targetUserId: string, token: string) {
  return agentRequest(app, `/api/instance/users/${targetUserId}/grant-admin`, {
    method: "POST",
    headers: { ...json, "x-taskdesk-step-up-token": token },
    body: "{}",
  });
}

async function actionState(id: string) {
  const [row] = await db
    .select({
      state: schema.pendingActionTable.state,
      reason: schema.pendingActionTable.invalidationReason,
    })
    .from(schema.pendingActionTable)
    .where(eq(schema.pendingActionTable.id, id));
  return row;
}

async function personActive(userId: string) {
  const [row] = await db
    .select({ active: schema.personTable.active })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId));
  return row?.active;
}

async function auditActions(entityId: string) {
  return (
    await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, entityId))
  ).map((row) => row.action);
}

async function setupDeactivation(label: string) {
  const admin = await makeAdmin(`${label}-admin`);
  const target = await makeTarget(`${label}-target`);
  mockAuthenticatedSession(admin.user);
  const { app } = createApp();
  const pendingId = await requestDeactivation(app, target.user.id);
  return { admin, target, app, pendingId };
}

describe("approve route PA-15 negatives", () => {
  it.each([
    ["missing", async () => undefined],
    ["malformed", async () => "not-a-real-token"],
  ])(
    "refuses a %s token with 403 step_up_expired and audits the denial",
    async (_name, tokenFor) => {
      const { admin, target, app, pendingId } =
        await setupDeactivation("neg-a");
      const response = await approve(
        app,
        pendingId,
        target.user.email,
        await tokenFor(),
      );
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("step_up_expired");
      expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
      expect(await personActive(target.user.id)).toBe(true);
      expect(await auditActions(pendingId)).toContain("auth.step_up_denied");
      expect(admin.person.id).toBeTruthy();
    },
  );

  it("refuses a token issued for a different pending action", async () => {
    const { admin, target, app, pendingId } = await setupDeactivation("neg-b");
    const other = await makeTarget("neg-b-other");
    const otherPendingId = await requestDeactivation(app, other.user.id);
    const otherToken = await pendingActionToken(app, otherPendingId);
    const response = await approve(
      app,
      pendingId,
      target.user.email,
      otherToken,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("step_up_expired");
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    expect(await personActive(target.user.id)).toBe(true);
    expect(await actionState(otherPendingId)).toMatchObject({
      state: "pending",
    });
    expect(admin.user.id).toBeTruthy();
  });

  it("refuses a token bound to a different session", async () => {
    const { target, app, pendingId } = await setupDeactivation("neg-c");
    const token = await pendingActionToken(app, pendingId);
    const otherSession = await seedSession("neg-c-admin", "-other");
    await db
      .update(schema.stepUpConfirmationTable)
      .set({ sessionId: otherSession })
      .where(eq(schema.stepUpConfirmationTable.pendingActionId, pendingId));
    const response = await approve(app, pendingId, target.user.email, token);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("step_up_expired");
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    expect(await personActive(target.user.id)).toBe(true);
  });

  it("refuses a replayed (already consumed) token", async () => {
    const { target, app, pendingId } = await setupDeactivation("neg-d");
    const token = await pendingActionToken(app, pendingId);
    await db
      .update(schema.stepUpConfirmationTable)
      .set({ state: "consumed", consumedAt: new Date() })
      .where(eq(schema.stepUpConfirmationTable.pendingActionId, pendingId));
    const response = await approve(app, pendingId, target.user.email, token);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("step_up_expired");
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    expect(await personActive(target.user.id)).toBe(true);
  });

  it("refuses an expired token", async () => {
    const { target, app, pendingId } = await setupDeactivation("neg-e");
    const token = await pendingActionToken(app, pendingId);
    await db
      .update(schema.stepUpConfirmationTable)
      .set({ tokenExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.stepUpConfirmationTable.pendingActionId, pendingId));
    const response = await approve(app, pendingId, target.user.email, token);
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("step_up_expired");
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    expect(await personActive(target.user.id)).toBe(true);
  });

  it("rejects extra fields on the pending-action challenge branch", async () => {
    const { app, pendingId } = await setupDeactivation("neg-strict");
    const response = await agentRequest(app, "/api/me/step-up/challenges", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        kind: "pending_action",
        pendingActionId: pendingId,
        operation: "mfa_reset",
      }),
    });
    expect(response.status).toBe(400);
  });

  it("supersedes an earlier token when a new challenge is proven", async () => {
    const { target, app, pendingId } = await setupDeactivation("neg-f");
    const first = await pendingActionToken(app, pendingId);
    const second = await pendingActionToken(app, pendingId);
    const stale = await approve(app, pendingId, target.user.email, first);
    expect(stale.status).toBe(403);
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    const fresh = await approve(app, pendingId, target.user.email, second);
    expect(fresh.status).toBe(200);
    expect(await personActive(target.user.id)).toBe(false);
  });

  it.each([
    [
      "demoted",
      (userId: string) =>
        db
          .update(schema.userTable)
          .set({ role: null })
          .where(eq(schema.userTable.id, userId)),
    ],
    [
      "banned",
      (userId: string) =>
        db
          .update(schema.userTable)
          .set({ banned: true })
          .where(eq(schema.userTable.id, userId)),
    ],
    [
      "deactivated",
      (userId: string) =>
        db
          .update(schema.personTable)
          .set({ active: false })
          .where(eq(schema.personTable.userId, userId)),
    ],
  ])(
    "invalidates the action when the requester is %s after the token is issued",
    async (_name, change) => {
      const { admin, target, app, pendingId } = await setupDeactivation(
        `neg-g-${_name}`,
      );
      const token = await pendingActionToken(app, pendingId);
      await change(admin.user.id);
      const response = await approve(app, pendingId, target.user.email, token);
      if (_name === "demoted") {
        expect(response.status).toBe(409);
        expect(await response.text()).toContain(
          "pending_action_target_changed",
        );
        expect(await actionState(pendingId)).toEqual({
          state: "invalidated",
          reason: "capability_removed",
        });
      } else {
        // A banned or deactivated requester is already refused by the request identity
        // layer (401/403) before the service runs; nothing executes either way.
        expect([401, 403, 409]).toContain(response.status);
        expect((await actionState(pendingId))?.state).not.toBe("executed");
      }
      expect(await personActive(target.user.id)).toBe(true);
    },
  );

  it("refuses when the requester session is no longer current", async () => {
    const { admin, target, app, pendingId } = await setupDeactivation("neg-h");
    const token = await pendingActionToken(app, pendingId);
    await db
      .update(schema.sessionTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.sessionTable.id, admin.sessionId));
    const response = await approve(app, pendingId, target.user.email, token);
    expect(response.status).toBe(403);
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    expect(await personActive(target.user.id)).toBe(true);
  });

  it("refuses a second administrator approving someone else's action", async () => {
    const { target, app, pendingId } = await setupDeactivation("neg-i");
    const token = await pendingActionToken(app, pendingId);
    const second = await makeAdmin("neg-i-second");
    mockAuthenticatedSession(second.user);
    const response = await approve(app, pendingId, target.user.email, token);
    expect(response.status).toBe(404);
    expect(await actionState(pendingId)).toMatchObject({ state: "pending" });
    expect(await personActive(target.user.id)).toBe(true);
  });

  it("expires at approval time without deactivating", async () => {
    const { target, app, pendingId } = await setupDeactivation("neg-j");
    await db
      .update(schema.pendingActionTable)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.pendingActionTable.id, pendingId));
    const response = await approve(app, pendingId, target.user.email, "x");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: pendingId, state: "expired" });
    expect(await actionState(pendingId)).toMatchObject({ state: "expired" });
    expect(await personActive(target.user.id)).toBe(true);
  });
});

describe("deactivation execution", () => {
  it("ends direct memberships, audits step-up consumption and invalidates native authorization", async () => {
    const invalidate = vi.spyOn(ws, "invalidateNativeAuthorization");
    const { admin, target, app, pendingId } = await setupDeactivation("exec-a");
    const internalOrg = await ensureInternalOrganisation();
    await db.insert(schema.workspaceTable).values({
      id: "exec-a-workspace",
      organisationId: internalOrg.id,
      name: "Exec workspace",
      slug: "exec-a-workspace",
      createdAt: new Date(),
    });
    await db.insert(schema.roleTable).values({
      id: "exec-a-role",
      scope: "workspace",
      workspaceId: "exec-a-workspace",
      key: "exec-a-role",
      name: "Exec role",
      rank: 1,
      capabilities: [],
    });
    await db.insert(schema.membershipGrantTable).values({
      id: "exec-a-grant",
      personId: target.person.id,
      scope: "workspace",
      scopeId: "exec-a-workspace",
      roleId: "exec-a-role",
      sourceKind: "direct",
      directOrigin: "admin",
      grantedByPersonId: admin.person.id,
    });
    const token = await pendingActionToken(app, pendingId);
    const response = await approve(app, pendingId, target.user.email, token);
    expect(response.status).toBe(200);
    const [grantRow] = await db
      .select({ revokedAt: schema.membershipGrantTable.revokedAt })
      .from(schema.membershipGrantTable)
      .where(eq(schema.membershipGrantTable.id, "exec-a-grant"));
    expect(grantRow?.revokedAt).not.toBeNull();
    const actions = await auditActions(pendingId);
    expect(actions).toEqual(
      expect.arrayContaining([
        "auth.step_up_issued",
        "auth.step_up_consumed",
        "pending_action.executed",
      ]),
    );
    const [deprovision] = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "identity.deprovisioned"));
    expect(deprovision?.after).toMatchObject({ membershipsEnded: 1 });
    expect(invalidate).toHaveBeenCalledWith({ userId: target.user.id });
  });
});

describe("last-administrator and self-target guard", () => {
  it("refuses self-suspend and self-deactivate outright", async () => {
    const admin = await makeAdmin("guard-self");
    await makeAdmin("guard-self-other");
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const suspend = await agentRequest(
      app,
      `/api/instance/users/${admin.user.id}/suspend`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(suspend.status).toBe(409);
    expect(await suspend.text()).toContain("self_target_refused");
    const deactivate = await agentRequest(
      app,
      `/api/instance/users/${admin.user.id}/deactivate`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(deactivate.status).toBe(409);
    expect(await deactivate.text()).toContain("self_target_refused");
    const [row] = await db
      .select({ banned: schema.userTable.banned })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, admin.user.id));
    expect(row?.banned).not.toBe(true);
    expect(await personActive(admin.user.id)).toBe(true);
    expect(
      await db
        .select({ id: schema.pendingActionTable.id })
        .from(schema.pendingActionTable),
    ).toHaveLength(0);
  });

  it("refuses suspend and deactivate request that would leave no usable administrator", async () => {
    const actor = await makeAdmin("guard-last-actor");
    await db
      .update(schema.userTable)
      .set({ banned: true })
      .where(eq(schema.userTable.id, actor.user.id));
    const victim = await makeTarget("guard-last-victim", "admin");
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const suspend = await agentRequest(
      app,
      `/api/instance/users/${victim.user.id}/suspend`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(suspend.status).toBe(409);
    expect(await suspend.text()).toContain("last_instance_admin");
    const deactivate = await agentRequest(
      app,
      `/api/instance/users/${victim.user.id}/deactivate`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(deactivate.status).toBe(409);
    expect(await deactivate.text()).toContain("last_instance_admin");
    const [row] = await db
      .select({ banned: schema.userTable.banned })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, victim.user.id));
    expect(row?.banned).not.toBe(true);
    expect(await personActive(victim.user.id)).toBe(true);
  });

  it("allows suspending an administrator while another usable administrator remains", async () => {
    const actor = await makeAdmin("guard-ok-actor");
    const victim = await makeTarget("guard-ok-victim", "admin");
    mockAuthenticatedSession(actor.user);
    const { app } = createApp();
    const suspend = await agentRequest(
      app,
      `/api/instance/users/${victim.user.id}/suspend`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(suspend.status).toBe(200);
  });

  it("refuses an approval whose target is the approver", async () => {
    const admin = await makeAdmin("guard-selfapprove");
    await makeAdmin("guard-selfapprove-other");
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const requested = await createPendingAction({
      requesterPersonId: admin.person.id,
      credentialType: "session",
      credentialId: null,
      origin: "web",
      action: "delete",
      routeKey: "POST /api/instance/users/{id}/deactivate",
      targetType: "user",
      targetIds: [admin.user.id],
      workspaceId: null,
      projectId: null,
      organisationId: null,
      actorId: admin.user.id,
      actorType: "person",
      actorIp: null,
      userAgent: null,
    });
    const token = await pendingActionToken(app, requested.pendingActionId);
    const response = await approve(
      app,
      requested.pendingActionId,
      admin.user.email,
      token,
    );
    expect(response.status).toBe(409);
    expect(await response.text()).toContain("self_target_refused");
    expect(await actionState(requested.pendingActionId)).toMatchObject({
      state: "pending",
    });
    expect(await personActive(admin.user.id)).toBe(true);
  });
});

describe("grant-admin", () => {
  it("audits consumed and denied step-up, the granted and already_admin outcomes", async () => {
    const admin = await makeAdmin("grant-a-admin");
    const target = await makeTarget("grant-a-target");
    const existing = await makeTarget("grant-a-existing", "admin");
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const token = await grantToken(app, target.user.id);
    const wrongTarget = await grant(app, existing.user.id, token);
    expect(wrongTarget.status).toBe(403);
    expect(
      (
        await db
          .select({ action: schema.auditLogTable.action })
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.entityId, admin.person.id))
      ).map((row) => row.action),
    ).toContain("auth.step_up_denied");
    const granted = await grant(app, target.user.id, token);
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ outcome: "granted" });
    expect(await auditActions(target.user.id)).toContain(
      "auth.instance_admin_granted",
    );
    expect(
      (
        await db
          .select({ action: schema.auditLogTable.action })
          .from(schema.auditLogTable)
          .where(eq(schema.auditLogTable.entityId, admin.person.id))
      ).map((row) => row.action),
    ).toContain("auth.step_up_consumed");
    const again = await grant(
      app,
      existing.user.id,
      await grantToken(app, existing.user.id),
    );
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ outcome: "already_admin" });
    const [alreadyAudit] = await db
      .select({ after: schema.auditLogTable.after })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, existing.user.id),
          eq(schema.auditLogTable.action, "auth.instance_admin_granted"),
        ),
      );
    expect(alreadyAudit?.after).toMatchObject({ outcome: "already_admin" });
  });

  it("rechecks the actor inside the transaction (demoted after the pre-check)", async () => {
    const admin = await makeAdmin("grant-b-admin");
    const target = await makeTarget("grant-b-target");
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const token = await grantToken(app, target.user.id);
    const blocker = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await blocker.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
        admin.user.id,
      ]);
      const pid = Number(
        (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid,
      );
      const pending = grant(app, target.user.id, token);
      const deadline = Date.now() + 5_000;
      let blocked = false;
      while (!blocked && Date.now() < deadline) {
        const result = await blocker.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND $1 = ANY(pg_blocking_pids(pid))`,
          [pid],
        );
        blocked = (result.rowCount ?? 0) > 0;
        if (!blocked) await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked).toBe(true);
      await blocker.query('UPDATE "user" SET role = NULL WHERE id = $1', [
        admin.user.id,
      ]);
      await blocker.query("COMMIT");
      const response = await pending;
      expect(response.status).toBe(403);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      await blocker.end();
    }
    const [row] = await db
      .select({ role: schema.userTable.role })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, target.user.id));
    expect(row?.role).toBeNull();
  });

  it("does not deadlock or 500 when racing a deactivation approval for the same target", async () => {
    const statuses: number[] = [];
    for (let round = 0; round < 12; round += 1) {
      const admin = await makeAdmin(`race-admin-${round}`);
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();
      const target = await makeTarget(`race-target-${round}`);
      const pendingId = await requestDeactivation(app, target.user.id);
      const approveToken = await pendingActionToken(app, pendingId);
      const gToken = await grantToken(app, target.user.id);
      const calls = [
        () => approve(app, pendingId, target.user.email, approveToken),
        () => grant(app, target.user.id, gToken),
      ];
      if (round % 2) calls.reverse();
      const responses = await Promise.all(calls.map((call) => call()));
      for (const response of responses) statuses.push(response.status);
    }
    expect(statuses.filter((status) => status >= 500)).toEqual([]);
    expect(new Set(statuses)).toContain(200);
  });
});

describe("audit and credential invalidation", () => {
  it("audits unsuspend and sign-out and invalidates native authorization", async () => {
    const invalidate = vi.spyOn(ws, "invalidateNativeAuthorization");
    const admin = await makeAdmin("aud-admin");
    const target = await makeTarget("aud-target");
    await seedSession(target.user.id);
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const suspend = await agentRequest(
      app,
      `/api/instance/users/${target.user.id}/suspend`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(suspend.status).toBe(200);
    expect(invalidate).toHaveBeenCalledWith({ userId: target.user.id });
    invalidate.mockClear();
    const unsuspend = await agentRequest(
      app,
      `/api/instance/users/${target.user.id}/unsuspend`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(unsuspend.status).toBe(200);
    await seedSession(target.user.id, "-again");
    const signOut = await agentRequest(
      app,
      `/api/instance/users/${target.user.id}/sign-out`,
      { method: "POST", headers: json, body: "{}" },
    );
    expect(signOut.status).toBe(200);
    expect(invalidate).toHaveBeenCalledWith({ userId: target.user.id });
    expect(await auditActions(target.user.id)).toEqual(
      expect.arrayContaining([
        "auth.user_suspended",
        "auth.user_unsuspended",
        "auth.sessions_revoked",
      ]),
    );
  });
});

describe("retryIdentityGrantClosure", () => {
  it("reads the SQLSTATE from a wrapped driver error and retries", async () => {
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("deadlock detected"), { code: "40P01" }),
    });
    expect(databaseErrorCode(wrapped)).toBe("40P01");
    expect(databaseErrorCode(new Error("plain"))).toBeUndefined();
    let attempts = 0;
    const result = await retryIdentityGrantClosure(async () => {
      attempts += 1;
      if (attempts < 3) throw wrapped;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    let exhausted = 0;
    await expect(
      retryIdentityGrantClosure(async () => {
        exhausted += 1;
        throw wrapped;
      }),
    ).rejects.toBe(wrapped);
    expect(exhausted).toBe(3);
    let unrelated = 0;
    await expect(
      retryIdentityGrantClosure(async () => {
        unrelated += 1;
        throw new Error("not retryable");
      }),
    ).rejects.toThrow("not retryable");
    expect(unrelated).toBe(1);
  });
});
