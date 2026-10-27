/**
 * P4 God Mode operations against the database and the real Better Auth stack:
 * impersonation (`GM-7`..`GM-11`), the secrets re-encryption trigger (`GM-13`) and webhook
 * step-up / deletion (`WH-15`, `AK-11`). Every actor holds a real cookie session.
 */
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import { runWithImpersonator } from "../../apps/api/src/auth/impersonation-context";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { sweepExpiredImpersonations } from "../../apps/api/src/instance/impersonation/finish";
import { impersonationRefusal } from "../../apps/api/src/instance/impersonation/guard";
import { createPendingAction } from "../../apps/api/src/pending-action/service";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";
import { makeTeam, workItemWorld } from "./helpers/p4-closeout";
import { approvePendingDeletionAsCookie } from "./helpers/pending-deletion";

// The destination guard resolves DNS; the SSRF client has its own suite (`tests/api/webhook`).
vi.mock("../../apps/api/src/webhook/safe-http", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../apps/api/src/webhook/safe-http")
  >()),
  assertWebhookDestination: async () => undefined,
}));

process.env.TASKDESK_ENCRYPTION_KEY ??= "e1".repeat(32);

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};
const PASSWORD = "p4-god-mode-password";
let ipCounter = 0;
const nextIp = () => `203.0.113.${(++ipCounter % 250) + 1}`;
const json = { "content-type": "application/json" };

type App = ReturnType<typeof createApp>["app"];

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

async function makeUser(id: string, role: string | null) {
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, name: `User ${id}`, email: `${id}@example.test`, role })
    .returning();
  if (!user) throw new Error("user fixture");
  await ensureStaffPersonForUser(user.id);
  await db.insert(schema.accountTable).values({
    id: `${id}-account`,
    accountId: id,
    providerId: "credential",
    userId: id,
    password: await bcrypt.hash(PASSWORD, 4),
  });
  return user;
}

async function signIn(app: App, email: string) {
  const login = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { ...json, "x-forwarded-for": nextIp() },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  expect(cookie).toBeDefined();
  return cookie as string;
}

async function post(
  app: App,
  cookie: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  method = "POST",
) {
  return csrfRequest(
    app,
    path,
    {
      method,
      headers: { ...json, cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    cookie,
  );
}

/** Mint a single-use PA-15 token for one operation with the local password method. */
async function stepUp(
  app: App,
  cookie: string,
  operation: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const challenge = await post(app, cookie, "/api/me/step-up/challenges", {
    kind: "operation",
    operation,
    ...fields,
  });
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proof = await post(app, cookie, "/api/me/step-up", {
    kind: "operation",
    operation,
    ...fields,
    challengeId: issued.challengeId,
    nonce: issued.nonce,
    method: "password",
    password: PASSWORD,
  });
  expect(proof.status, await proof.clone().text()).toBe(200);
  return ((await proof.json()) as { token: string }).token;
}

/** The cookie a browser ends up with: the last Set-Cookie for the name wins. */
function cookieFrom(response: Response, name: string) {
  return response.headers
    .getSetCookie()
    .filter((value) => value.startsWith(`${name}=`))
    .at(-1)
    ?.split(";", 1)[0];
}

function app_request(app: App, cookie: string) {
  return app.request("/api/instance/impersonate", { headers: { cookie } });
}

const REASON = "Customer reported a missing board column, reproducing it.";

async function auditRows(action: string) {
  return db
    .select()
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.action, action));
}

describe("impersonation (GM-7..GM-11)", () => {
  async function world() {
    const admin = await makeUser("gm-admin", "admin");
    const otherAdmin = await makeUser("gm-admin-2", "admin");
    // The target owns a workspace so it can make an ordinary, audited write.
    const member = await createWorkspaceMember({ role: "owner" });
    const target = member.user;
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);
    return {
      admin,
      otherAdmin,
      target,
      workspace: member.workspace,
      app,
      cookie,
    };
  }

  /** Starts an impersonation as `world().admin` and returns the cookie jar a browser would hold. */
  async function startImpersonation(w: Awaited<ReturnType<typeof world>>) {
    const token = await stepUp(w.app, w.cookie, "impersonation_start", {
      targetUserId: w.target.id,
      reason: REASON,
    });
    const started = await post(
      w.app,
      w.cookie,
      `/api/instance/users/${w.target.id}/impersonate`,
      { reason: REASON },
      { "x-taskdesk-step-up-token": token },
    );
    expect(started.status, await started.clone().text()).toBe(200);
    const jar = new Map<string, string>();
    for (const value of started.headers.getSetCookie()) {
      const [pair = ""] = value.split(";", 1);
      const name = pair.split("=", 1)[0] ?? "";
      if (/;\s*max-age=0/iu.test(value) || /=;/u.test(`${pair};`))
        jar.delete(name);
      else jar.set(name, pair);
    }
    return [...jar.values()].join("; ");
  }

  async function impersonationSessions(adminId: string) {
    return db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.impersonatedBy, adminId));
  }

  it("ends the session on the next request once the impersonating administrator is suspended, demoted or deactivated (P4R1-M3)", async () => {
    for (const change of ["suspended", "demoted", "deactivated"] as const) {
      await resetTestDatabase();
      await db
        .insert(schema.instanceSettingTable)
        .values({ id: "singleton", setupCompletedAt: new Date() });
      const w = await world();
      const impersonationCookie = await startImpersonation(w);
      const before = await app_request(w.app, impersonationCookie);
      expect(before.status, change).toBe(200);

      if (change === "suspended")
        await db
          .update(schema.userTable)
          .set({ banned: true })
          .where(eq(schema.userTable.id, w.admin.id));
      if (change === "demoted")
        await db
          .update(schema.userTable)
          .set({ role: null })
          .where(eq(schema.userTable.id, w.admin.id));
      if (change === "deactivated")
        await db
          .update(schema.personTable)
          .set({ active: false })
          .where(eq(schema.personTable.userId, w.admin.id));

      const after = await app_request(w.app, impersonationCookie);
      expect(after.status, change).toBe(401);
      expect(await impersonationSessions(w.admin.id), change).toHaveLength(0);
      const [ended] = await auditRows("impersonation.ended");
      expect(ended?.after, change).toMatchObject({
        reason: "impersonator_ineligible",
      });
    }
  });

  it("refuses an administrator target and the actor itself at challenge time (GM-10)", async () => {
    const { otherAdmin, admin, app, cookie } = await world();
    for (const [targetUserId, status] of [
      [otherAdmin.id, 403],
      [admin.id, 409],
      ["missing-user", 404],
    ] as const) {
      const response = await post(app, cookie, "/api/me/step-up/challenges", {
        kind: "operation",
        operation: "impersonation_start",
        targetUserId,
        reason: REASON,
      });
      expect(response.status, targetUserId).toBe(status);
    }
  });

  it("starts audited and capped, records the impersonator on every action, and ends with a notification", async () => {
    const { admin, target, workspace, app, cookie } = await world();
    const token = await stepUp(app, cookie, "impersonation_start", {
      targetUserId: target.id,
      reason: REASON,
    });
    const started = await post(
      app,
      cookie,
      `/api/instance/users/${target.id}/impersonate`,
      { reason: REASON },
      { "x-taskdesk-step-up-token": token },
    );
    expect(started.status, await started.clone().text()).toBe(200);
    const body = (await started.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toMatch(/token/iu);
    // A browser holds every cookie the start response set; the last value per name wins.
    const jar = new Map<string, string>();
    for (const value of started.headers.getSetCookie()) {
      const [pair = ""] = value.split(";", 1);
      const name = pair.split("=", 1)[0] ?? "";
      if (/;\s*max-age=0/iu.test(value) || /=;/u.test(`${pair};`))
        jar.delete(name);
      else jar.set(name, pair);
    }
    const impersonationCookie = [...jar.values()].join("; ");
    expect(jar.has("__Host-tdk_agent_session")).toBe(true);
    expect(jar.size).toBeGreaterThanOrEqual(2);

    const [session] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.impersonatedBy, admin.id));
    const impersonation = requireRow([session], "impersonation session");
    expect(impersonation.userId).toBe(target.id);
    const lifetime = impersonation.expiresAt.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(29 * 60_000);
    expect(lifetime).toBeLessThanOrEqual(30 * 60_000 + 5_000);

    const [startedRow] = await auditRows("impersonation.started");
    expect(startedRow?.actorId).toBe(admin.id);
    expect(startedRow?.entityId).toBe(target.id);
    expect(startedRow?.impersonatorId).toBeNull();
    expect(startedRow?.after).toMatchObject({
      sessionId: impersonation.id,
      reason: REASON,
    });

    // The status route describes the session; GET is an ordinary read.
    const status = await app.request("/api/instance/impersonate", {
      headers: { cookie: impersonationCookie },
    });
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      impersonating: true,
      impersonator: { id: admin.id },
      target: { id: target.id },
      reason: REASON,
    });

    // Session refresh must never stretch the 30-minute cap (GM-7).
    const [afterUse] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, impersonation.id));
    expect(afterUse?.expiresAt.getTime()).toBe(
      impersonation.expiresAt.getTime(),
    );

    // GM-9: restricted classes are refused with a 403 naming impersonation.
    for (const [method, path, payload] of [
      ["DELETE", "/api/webhooks/anything", undefined],
      [
        "POST",
        `/api/instance/users/${admin.id}/impersonate`,
        { reason: REASON },
      ],
      ["POST", "/api/instance/plugins/rotate-secrets", {}],
      ["POST", "/api/webhooks", { name: "x" }],
      ["POST", "/api/me/pending-actions/anything/approve", {}],
      ["POST", "/api/work-items/export", {}],
    ] as const) {
      const refused = await post(
        app,
        impersonationCookie,
        path,
        payload,
        {},
        method,
      );
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(await refused.text(), `${method} ${path}`).toMatch(
        /impersonation/iu,
      );
    }
    // Better Auth credential changes are refused as well; sign-out is not.
    const changePassword = await post(
      app,
      impersonationCookie,
      "/api/auth/change-password",
      { currentPassword: PASSWORD, newPassword: "another-password-123" },
    );
    expect(changePassword.status).toBe(403);

    // GM-9 is default-deny: configuration that moves authority (a team's CAB flag, roles, keys,
    // membership) is refused even though the target could make the change themselves.
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantWorkItemProjectAccess(target.id, project.id);
    const rows = await workItemWorld(workspace.id, project.id);
    const item = await rows.makeItem("Impersonated work");
    const { id: teamId } = await makeTeam(workspace.id, [target.id]);
    for (const [method, path, payload] of [
      ["POST", "/api/teams", { workspaceId: workspace.id, name: "Another" }],
      ["PATCH", `/api/teams/${teamId}`, { isCab: true }],
      ["POST", `/api/teams/${teamId}/members`, { userId: target.id }],
      [
        "POST",
        `/api/workspace/${workspace.id}/roles`,
        { role: "Escalation", capabilities: ["project:read"] },
      ],
      [
        "PATCH",
        `/api/workspace/${workspace.id}/members/${target.id}/role`,
        { role: "admin" },
      ],
      ["POST", `/api/workspaces/${workspace.id}/api-keys`, { name: "key" }],
      ["POST", "/api/workflows", { name: "Flow" }],
      ["PATCH", `/api/workspaces/${workspace.id}/features`, { changes: [] }],
    ] as const) {
      const refused = await post(
        app,
        impersonationCookie,
        path,
        payload,
        {},
        method,
      );
      expect(refused.status, `${method} ${path}`).toBe(403);
      expect(await refused.text(), `${method} ${path}`).toMatch(
        /impersonation/iu,
      );
    }
    const [unchanged] = await db
      .select({ isCab: schema.teamTable.isCab })
      .from(schema.teamTable)
      .where(eq(schema.teamTable.id, teamId));
    expect(unchanged?.isCab).toBe(false);

    // GM-9: an ordinary work-item write succeeds as the target, and GM-8: the audit row it
    // writes names the impersonator, through the real auth guard.
    const write = await post(
      app,
      impersonationCookie,
      `/api/work-items/${item.key}/comments`,
      {
        visibility: "public",
        body: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "hello" }] },
          ],
        },
      },
    );
    expect(write.status, await write.clone().text()).toBe(200);
    const [commentRow] = await auditRows("work_item.commented");
    expect(commentRow?.actorId).toBe(target.id);
    expect(commentRow?.impersonatorId).toBe(admin.id);
    // A write by the administrator themself carries no impersonator.
    expect(
      (await auditRows("impersonation.started"))[0]?.impersonatorId,
    ).toBeNull();

    // GM-11: the session endpoint exposes the field the shell mounts the banner on.
    const sessionResponse = await app.request("/api/auth/get-session", {
      headers: { cookie: impersonationCookie },
    });
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as {
      session?: { impersonatedBy?: string | null };
    };
    expect(sessionBody.session?.impersonatedBy).toBe(admin.id);

    // GM-9: requesting any pending action (a deletion, single or bulk) is refused as the
    // impersonator, at the one place every route creates one.
    await expect(
      runWithImpersonator(admin.id, () =>
        createPendingAction({
          requesterPersonId: "person-x",
          credentialType: "session",
          credentialId: "session-x",
          origin: "web",
          action: "bulk_delete",
          routeKey: "POST /api/work-items/bulk",
          targetType: "work_item",
          targetIds: ["a", "b"],
          actorId: target.id,
          actorType: "person",
        } as never),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);

    // GM-11: the exit control restores the administrator and records the end.
    const ended = await post(
      app,
      impersonationCookie,
      "/api/instance/impersonate",
      undefined,
      {},
      "DELETE",
    );
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(await ended.json()).toMatchObject({
      ended: true,
      reason: "exit",
      restored: true,
    });
    expect(cookieFrom(ended, "__Host-tdk_agent_session")).toBeDefined();
    const [endedRow] = await auditRows("impersonation.ended");
    expect(endedRow?.actorId).toBe(admin.id);
    expect(endedRow?.after).toMatchObject({
      sessionId: impersonation.id,
      reason: "exit",
    });
    const notices = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, target.id));
    expect(notices).toHaveLength(1);
    expect(notices[0]?.content).toContain(REASON);
    const remaining = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, impersonation.id));
    expect(remaining).toHaveLength(0);
  });

  it("burns no session without a valid, body-bound step-up proof", async () => {
    const { target, app, cookie } = await world();
    const wrongBinding = await stepUp(app, cookie, "impersonation_start", {
      targetUserId: target.id,
      reason: `${REASON} (different)`,
    });
    for (const headers of [
      { "x-taskdesk-step-up-token": wrongBinding },
      { "x-taskdesk-step-up-token": "A".repeat(43) },
    ]) {
      const response = await post(
        app,
        cookie,
        `/api/instance/users/${target.id}/impersonate`,
        { reason: REASON },
        headers,
      );
      expect(response.status).toBe(403);
    }
    expect(await auditRows("impersonation.started")).toHaveLength(0);
    const sessions = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, target.id));
    expect(sessions).toHaveLength(0);
  });

  it("ends a session that outlived its 30-minute cap with reason cap (sweep)", async () => {
    const { admin, target } = await world();
    await appendAuditLog(db, {
      action: "impersonation.started",
      actorId: admin.id,
      actorType: "person",
      impersonatorId: null,
      workspaceId: null,
      entityType: "user",
      entityId: target.id,
      after: {
        sessionId: "expired-session",
        reason: REASON,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(await sweepExpiredImpersonations()).toBe(1);
    expect(await sweepExpiredImpersonations()).toBe(0);
    const [ended] = await auditRows("impersonation.ended");
    expect(ended?.after).toMatchObject({
      sessionId: "expired-session",
      reason: "cap",
    });
    const notices = await db
      .select()
      .from(schema.notificationTable)
      .where(eq(schema.notificationTable.userId, target.id));
    expect(notices).toHaveLength(1);
  });

  it("classifies the GM-9 route matrix", () => {
    expect(impersonationRefusal("DELETE /api/instance/impersonate", true)).toBe(
      null,
    );
    expect(impersonationRefusal("GET /api/work-items/{key}", false)).toBeNull();
    expect(
      impersonationRefusal("PATCH /api/work-items/{key}", false),
    ).toBeNull();
    expect(impersonationRefusal("DELETE /api/comment/{id}", false)).toMatch(
      /deletions/u,
    );
    expect(
      impersonationRefusal("POST /api/approvals/{id}/decide", false),
    ).toMatch(/approval/u);
    expect(
      impersonationRefusal("GET /api/instance/users/{id}/export", false),
    ).toMatch(/export/u);
    expect(
      impersonationRefusal("POST /api/workspaces/{id}/api-keys", false),
    ).toMatch(/ordinary work/u);
    expect(
      impersonationRefusal(
        "PATCH /api/projects/{projectId}/members/{personId}",
        false,
      ),
    ).toMatch(/ordinary work/u);
    expect(impersonationRefusal("GET /api/webhooks", false)).toBeNull();
    expect(
      impersonationRefusal("GET /api/instance/config-export", false),
    ).toMatch(/export/u);
    expect(
      impersonationRefusal("PATCH /api/projects/{projectId}/ownership", false),
    ).toMatch(/ordinary work/u);
    // Default-deny (GM-9): authority-affecting writes and unlisted routes are closed; reads and
    // ordinary work stay open.
    for (const key of [
      "POST /api/teams",
      "PATCH /api/teams/{id}",
      "POST /api/teams/{id}/members",
      "POST /api/workspace/{workspaceId}/roles",
      "PATCH /api/workspace/{workspaceId}/members/{userId}/role",
      "POST /api/workspaces/{id}/api-keys",
      "POST /api/me/api-keys",
      "POST /api/workflows/{id}/versions",
      "POST /api/some-future-route",
    ])
      expect(impersonationRefusal(key, false), key).toMatch(/ordinary work/u);
    for (const key of [
      "GET /api/teams",
      "POST /api/work-items/{key}/comments",
      "PATCH /api/work-items/{key}",
      "POST /api/projects/{projectId}/work-items",
      "POST /api/work-items/{key}/transition",
      "PUT /api/time-entry/{id}",
      "PATCH /api/notification/{id}/read",
    ])
      expect(impersonationRefusal(key, false), key).toBeNull();
    expect(impersonationRefusal("POST /api/anything", true)).toMatch(
      /elevated/u,
    );
  });
});

describe("secrets re-encryption trigger (GM-13)", () => {
  it("is elevated, instance-admin only, returns 202 and runs the leased job", async () => {
    const admin = await makeUser("gm-rotator", "admin");
    const plain = await makeUser("gm-plain", null);
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);

    const noProof = await post(
      app,
      cookie,
      "/api/instance/plugins/rotate-secrets",
      {},
    );
    expect(noProof.status).toBe(400);

    const plainCookie = await signIn(app, plain.email);
    const denied = await post(
      app,
      plainCookie,
      "/api/instance/plugins/rotate-secrets",
      {},
      { "x-taskdesk-step-up-token": "A".repeat(43) },
    );
    expect(denied.status).toBe(403);
    const plainChallenge = await post(
      app,
      plainCookie,
      "/api/me/step-up/challenges",
      {
        kind: "operation",
        operation: "secrets_rotate",
      },
    );
    expect(plainChallenge.status).toBe(403);

    const token = await stepUp(app, cookie, "secrets_rotate", {});
    const accepted = await post(
      app,
      cookie,
      "/api/instance/plugins/rotate-secrets",
      {},
      { "x-taskdesk-step-up-token": token },
    );
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    const body = (await accepted.json()) as {
      status: string;
      progress: {
        complete: boolean;
        total: Record<string, number>;
        pending: Record<string, number>;
        expiredInvitationDeliveryEnvelopes: number;
      };
    };
    expect(body.status).toBe("accepted");
    // Webhook signing secrets and notification tokens are counted too (not stripped by the schema).
    expect(typeof body.progress.total.textSecrets).toBe("number");
    expect(typeof body.progress.pending.textSecrets).toBe("number");
    // The one declared envelope field is a non-negative count (rotate-secrets schema), never
    // an envelope; everything else must carry no envelope or secret material.
    const { expiredInvitationDeliveryEnvelopes, ...otherProgress } =
      body.progress;
    expect(Number.isInteger(expiredInvitationDeliveryEnvelopes)).toBe(true);
    expect(expiredInvitationDeliveryEnvelopes).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify({ ...body, progress: otherProgress })).not.toMatch(
      /envelope|secret_value/iu,
    );

    // A spent proof is not reusable.
    const replay = await post(
      app,
      cookie,
      "/api/instance/plugins/rotate-secrets",
      {},
      { "x-taskdesk-step-up-token": token },
    );
    expect(replay.status).toBe(403);

    // The job writes counts only.
    let rows: Awaited<ReturnType<typeof auditRows>> = [];
    for (let attempt = 0; attempt < 50 && rows.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      rows = await auditRows("secrets.rekeyed");
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(admin.id);
  });
});

describe("webhook step-up and deletion (WH-15, AK-11)", () => {
  async function webhookWorld() {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.accountTable).values({
      id: `${user.id}-account`,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(PASSWORD, 4),
    });
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    return { user, workspace, app, cookie };
  }

  const create = {
    name: "Ops hook",
    url: "https://hooks.example.com/in",
    events: ["work_item.created"],
  };
  const secret = "whsec_integration_secret_0000000";

  it("creates only with a proof bound to workspace, name, url and events", async () => {
    const { workspace, app, cookie } = await webhookWorld();
    const headers = { "x-workspace-id": workspace.id };

    const missing = await post(
      app,
      cookie,
      "/api/webhooks",
      { ...create, secret },
      headers,
    );
    expect(missing.status).toBe(403);
    expect(await missing.text()).toMatch(/step_up_required/u);

    const wrong = await stepUp(app, cookie, "webhook_create", {
      workspaceId: workspace.id,
      ...create,
      url: "https://hooks.example.com/other",
    });
    const mismatched = await post(
      app,
      cookie,
      "/api/webhooks",
      { ...create, secret },
      { ...headers, "x-taskdesk-step-up-token": wrong },
    );
    expect(mismatched.status).toBe(403);

    const token = await stepUp(app, cookie, "webhook_create", {
      workspaceId: workspace.id,
      ...create,
    });
    const created = await post(
      app,
      cookie,
      "/api/webhooks",
      { ...create, secret },
      { ...headers, "x-taskdesk-step-up-token": token },
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const row = (await created.json()) as { id: string };
    expect(JSON.stringify(row)).not.toContain(secret);

    // Single use.
    const replay = await post(
      app,
      cookie,
      "/api/webhooks",
      { ...create, secret },
      { ...headers, "x-taskdesk-step-up-token": token },
    );
    expect(replay.status).toBe(403);

    // A workspace member without webhook:manage cannot even obtain a challenge.
    const viewer = await makeUser("wh-viewer", null);
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: workspace.id,
      userId: viewer.id,
      role: "viewer",
      joinedAt: new Date(),
    });
    const viewerCookie = await signIn(app, viewer.email);
    const viewerChallenge = await post(
      app,
      viewerCookie,
      "/api/me/step-up/challenges",
      {
        kind: "operation",
        operation: "webhook_create",
        workspaceId: workspace.id,
        ...create,
      },
    );
    expect(viewerChallenge.status).toBe(403);

    // PATCH needs a proof only when the destination changes; rotate always needs one.
    const rename = await post(
      app,
      cookie,
      `/api/webhooks/${row.id}`,
      { name: "Renamed" },
      {},
      "PATCH",
    );
    expect(rename.status, await rename.clone().text()).toBe(200);
    const moveWithoutProof = await post(
      app,
      cookie,
      `/api/webhooks/${row.id}`,
      { url: "https://hooks.example.com/moved" },
      {},
      "PATCH",
    );
    expect(moveWithoutProof.status).toBe(403);
    const moveToken = await stepUp(app, cookie, "webhook_update_url", {
      workspaceId: workspace.id,
      webhookId: row.id,
      url: "https://hooks.example.com/moved",
    });
    const moved = await post(
      app,
      cookie,
      `/api/webhooks/${row.id}`,
      { url: "https://hooks.example.com/moved" },
      { "x-taskdesk-step-up-token": moveToken },
      "PATCH",
    );
    expect(moved.status, await moved.clone().text()).toBe(200);

    const rotateWithoutProof = await post(
      app,
      cookie,
      `/api/webhooks/${row.id}/rotate-secret`,
      { secret: `${secret}1` },
    );
    expect(rotateWithoutProof.status).toBe(403);
    const rotateToken = await stepUp(app, cookie, "webhook_rotate_secret", {
      workspaceId: workspace.id,
      webhookId: row.id,
    });
    const rotated = await post(
      app,
      cookie,
      `/api/webhooks/${row.id}/rotate-secret`,
      { secret: `${secret}1` },
      { "x-taskdesk-step-up-token": rotateToken },
    );
    expect(rotated.status, await rotated.clone().text()).toBe(200);
  });

  it("deletes only through a typed-name + step-up pending action", async () => {
    const { workspace, app, cookie } = await webhookWorld();
    const headers = { "x-workspace-id": workspace.id };
    const token = await stepUp(app, cookie, "webhook_create", {
      workspaceId: workspace.id,
      ...create,
    });
    const created = await post(
      app,
      cookie,
      "/api/webhooks",
      { ...create, secret },
      { ...headers, "x-taskdesk-step-up-token": token },
    );
    const row = (await created.json()) as { id: string };

    const requested = await post(
      app,
      cookie,
      `/api/webhooks/${row.id}`,
      undefined,
      {},
      "DELETE",
    );
    expect(requested.status, await requested.clone().text()).toBe(202);
    const pending = (await requested.json()) as {
      pendingActionId: string;
      confirmation: string;
      action: string;
      summary: Record<string, unknown>;
    };
    expect(pending.confirmation).toBe("typed_name_step_up");
    expect(
      await db.select().from(webhookTable).where(eq(webhookTable.id, row.id)),
    ).toHaveLength(1);

    const wrongName = await approvePendingDeletionAsCookie(
      app,
      cookie,
      { ...pending, approveUrl: undefined, summary: pending.summary },
      { typedName: "not the name", password: PASSWORD },
    );
    expect(wrongName.status).not.toBe(200);
    expect(
      await db.select().from(webhookTable).where(eq(webhookTable.id, row.id)),
    ).toHaveLength(1);

    const approved = await approvePendingDeletionAsCookie(
      app,
      cookie,
      { ...pending, approveUrl: undefined },
      { typedName: "Ops hook", password: PASSWORD },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect(
      await db.select().from(webhookTable).where(eq(webhookTable.id, row.id)),
    ).toHaveLength(0);
    const [deleted] = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "webhook.deleted"),
          eq(schema.auditLogTable.entityId, row.id),
        ),
      );
    expect(deleted).toBeDefined();
  });
});

describe("step-up proofs are spent with the write (P4 review M1)", () => {
  async function consumedCount() {
    return (await auditRows("auth.step_up_consumed")).length;
  }

  /** The proof was minted with a password; the person then enrols a second factor. */
  async function setSecondFactor(userId: string, enabled: boolean) {
    await db
      .update(schema.userTable)
      .set({ twoFactorEnabled: enabled })
      .where(eq(schema.userTable.id, userId));
  }

  it("a rejected sign-in method does not spend the webhook-create proof", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.accountTable).values({
      id: `${user.id}-account`,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(PASSWORD, 4),
    });
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const body = {
      name: "Ops hook",
      url: "https://hooks.example.com/in",
      events: ["work_item.created"],
    };
    const token = await stepUp(app, cookie, "webhook_create", {
      workspaceId: workspace.id,
      ...body,
    });
    const send = () =>
      post(
        app,
        cookie,
        "/api/webhooks",
        { ...body, secret: "whsec_integration_secret_0000000" },
        {
          "x-workspace-id": workspace.id,
          "x-taskdesk-step-up-token": token,
        },
      );

    await setSecondFactor(user.id, true);
    const refused = await send();
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/step_up_unavailable/u);
    expect(await db.select().from(webhookTable)).toHaveLength(0);
    expect(await consumedCount()).toBe(0);

    // The same proof is still good once the method is acceptable again, and then it is spent
    // together with the insert, exactly once.
    await setSecondFactor(user.id, false);
    const created = await send();
    expect(created.status, await created.clone().text()).toBe(201);
    expect(await db.select().from(webhookTable)).toHaveLength(1);
    expect(await consumedCount()).toBe(1);
    expect((await send()).status).toBe(403);
  });

  it("a stale-version URL change does not spend its proof, and the retry does", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db.insert(schema.accountTable).values({
      id: `${user.id}-account`,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password: await bcrypt.hash(PASSWORD, 4),
    });
    const { app } = createApp();
    const cookie = await signIn(app, user.email);
    const body = {
      name: "Ops hook",
      url: "https://hooks.example.com/in",
      events: ["work_item.created"],
    };
    const createToken = await stepUp(app, cookie, "webhook_create", {
      workspaceId: workspace.id,
      ...body,
    });
    const created = await post(
      app,
      cookie,
      "/api/webhooks",
      { ...body, secret: "whsec_integration_secret_0000000" },
      {
        "x-workspace-id": workspace.id,
        "x-taskdesk-step-up-token": createToken,
      },
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const row = (await created.json()) as { id: string; version: number };
    const consumedBefore = await consumedCount();

    const url = "https://hooks.example.com/moved";
    const token = await stepUp(app, cookie, "webhook_update_url", {
      workspaceId: workspace.id,
      webhookId: row.id,
      url,
    });
    const patch = (version: number) =>
      post(
        app,
        cookie,
        `/api/webhooks/${row.id}`,
        { url, version },
        { "x-taskdesk-step-up-token": token },
        "PATCH",
      );
    const stale = await patch(row.version + 5);
    expect(stale.status, await stale.clone().text()).toBe(409);
    expect(await consumedCount()).toBe(consumedBefore);

    const ok = await patch(row.version);
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect(await consumedCount()).toBe(consumedBefore + 1);
  });

  it("a rejected sign-in method does not spend the secrets-rotate proof", async () => {
    const admin = await makeUser("gm-rotator-m1", "admin");
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);
    const token = await stepUp(app, cookie, "secrets_rotate", {});
    const send = () =>
      post(
        app,
        cookie,
        "/api/instance/plugins/rotate-secrets",
        {},
        { "x-taskdesk-step-up-token": token },
      );
    await setSecondFactor(admin.id, true);
    const refused = await send();
    expect(refused.status).toBe(403);
    expect(await consumedCount()).toBe(0);
    await setSecondFactor(admin.id, false);
    const accepted = await send();
    expect(accepted.status, await accepted.clone().text()).toBe(202);
    expect(await consumedCount()).toBe(1);
  });

  it("a rejected sign-in method does not spend the impersonation proof or create a session", async () => {
    const admin = await makeUser("gm-admin-m1", "admin");
    const target = await makeUser("gm-target-m1", null);
    const { app } = createApp();
    const cookie = await signIn(app, admin.email);
    const token = await stepUp(app, cookie, "impersonation_start", {
      targetUserId: target.id,
      reason: REASON,
    });
    const send = () =>
      post(
        app,
        cookie,
        `/api/instance/users/${target.id}/impersonate`,
        { reason: REASON },
        { "x-taskdesk-step-up-token": token },
      );
    await setSecondFactor(admin.id, true);
    const refused = await send();
    expect(refused.status).toBe(403);
    expect(
      await db
        .select()
        .from(schema.sessionTable)
        .where(eq(schema.sessionTable.impersonatedBy, admin.id)),
    ).toHaveLength(0);
    expect(await consumedCount()).toBe(0);
    await setSecondFactor(admin.id, false);
    const started = await send();
    expect(started.status, await started.clone().text()).toBe(200);
    expect(await consumedCount()).toBe(1);
    expect((await send()).status).toBe(403);
  });
});
