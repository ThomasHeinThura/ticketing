/**
 * P4 round-1 review fixes for webhook ownership (`P4R1-H1`, `P4R1-L1`; `WH-6`, `WH-8`, `WH-14`,
 * `WH-15`):
 *
 *  - A destination change is the owner's. A project-limited manager holding `webhook:manage`
 *    cannot repoint an instance administrator's receives-everything webhook (or any webhook they
 *    do not own); the administrator may repoint a receives-everything webhook only.
 *  - A delivery created before the destination or owner changed is never replayed to the new
 *    one: redelivery answers 409 and a stored retry is cancelled.
 *  - A re-own is elevated (step-up) and is for a webhook paused because its owner left, unless
 *    the caller is an instance administrator.
 */
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  webhookDeliveryTable,
  webhookTable,
} from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { encryptSecret } from "../../apps/api/src/notification-preferences/secrets";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { processNextWebhookDelivery } from "../../apps/api/src/webhook/delivery";
import type { WebhookSendResult } from "../../apps/api/src/webhook/safe-http";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";
import { addMember } from "./helpers/reach-world";

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
const PASSWORD = "p4-webhook-ownership-password";
const SECRET = "whsec_integration_secret_0000000";
const OLD_URL = "https://hooks.example.com/old";
const NEW_URL = "https://hooks.example.com/new";
const json = { "content-type": "application/json" };
let ipCounter = 40;
const nextIp = () => `198.51.100.${(++ipCounter % 250) + 1}`;

type App = ReturnType<typeof createApp>["app"];

beforeEach(async () => {
  await resetTestDatabase();
  await db
    .insert(schema.instanceSettingTable)
    .values({ id: "singleton", setupCompletedAt: new Date() });
});

async function withPassword(userId: string) {
  await db.insert(schema.accountTable).values({
    id: `${userId}-account`,
    accountId: userId,
    providerId: "credential",
    userId,
    password: await bcrypt.hash(PASSWORD, 4),
  });
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

async function send(
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

async function stepUp(
  app: App,
  cookie: string,
  operation: string,
  fields: Record<string, unknown>,
): Promise<string> {
  const challenge = await send(app, cookie, "/api/me/step-up/challenges", {
    kind: "operation",
    operation,
    ...fields,
  });
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const issued = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const proof = await send(app, cookie, "/api/me/step-up", {
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

async function personOf(userId: string) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  return requireRow([person], "person").id;
}

async function world() {
  const { workspace } = await createWorkspaceMember({ role: "owner" });
  const adminUser = requireRow(
    await db
      .insert(schema.userTable)
      .values({
        id: "wh-admin",
        name: "Admin",
        email: "wh-admin@example.test",
        role: "admin",
      })
      .returning(),
    "admin",
  );
  await ensureStaffPersonForUser(adminUser.id);
  await withPassword(adminUser.id);
  await db.insert(schema.workspaceUserTable).values({
    workspaceId: workspace.id,
    userId: adminUser.id,
    role: "admin",
    joinedAt: new Date(),
  });
  // A manager holds webhook:manage but has no project reach and does not see everything.
  const manager = await addMember(workspace.id, "manager");
  await withPassword(manager.user.id);
  const otherManager = await addMember(workspace.id, "manager");
  await withPassword(otherManager.user.id);
  const { app } = createApp();
  const adminCookie = await signIn(app, adminUser.email);
  const managerCookie = await signIn(app, manager.user.email);
  const adminPersonId = await personOf(adminUser.id);
  return {
    workspace,
    app,
    adminUser,
    adminPersonId,
    adminCookie,
    manager,
    managerCookie,
    otherManager,
  };
}

async function makeWebhook(
  workspaceId: string,
  ownerPersonId: string,
  overrides: Partial<typeof webhookTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(webhookTable)
      .values({
        workspaceId,
        name: "Ops hook",
        url: OLD_URL,
        secret: encryptSecret(SECRET) as string,
        events: ["work_item.created"],
        createdBy: ownerPersonId,
        ...overrides,
      })
      .returning(),
    "webhook",
  );
}

async function patchUrl(
  app: App,
  cookie: string,
  workspaceId: string,
  webhookId: string,
  url: string,
) {
  const token = await stepUp(app, cookie, "webhook_update_url", {
    workspaceId,
    webhookId,
    url,
  });
  return send(
    app,
    cookie,
    `/api/webhooks/${webhookId}`,
    { url },
    { "x-taskdesk-step-up-token": token },
    "PATCH",
  );
}

async function urlOf(id: string) {
  const [row] = await db
    .select()
    .from(webhookTable)
    .where(eq(webhookTable.id, id));
  return requireRow([row], "webhook");
}

describe("webhook destination ownership (P4R1-H1, WH-14, WH-15)", () => {
  it("refuses a project-limited manager repointing an administrator's receives-everything webhook", async () => {
    const w = await world();
    const hook = await makeWebhook(w.workspace.id, w.adminPersonId);
    const response = await patchUrl(
      w.app,
      w.managerCookie,
      w.workspace.id,
      hook.id,
      NEW_URL,
    );
    expect(response.status, await response.clone().text()).toBe(403);
    expect(await response.text()).toMatch(/webhook_url_requires_owner/u);
    const row = await urlOf(hook.id);
    expect(row.url).toBe(OLD_URL);
    expect(row.destinationChangedAt).toBeNull();
  });

  it("refuses a manager repointing another manager's webhook, even one that is not receives-everything", async () => {
    const w = await world();
    const hook = await makeWebhook(w.workspace.id, w.otherManager.personId);
    const response = await patchUrl(
      w.app,
      w.managerCookie,
      w.workspace.id,
      hook.id,
      NEW_URL,
    );
    expect(response.status).toBe(403);
    expect((await urlOf(hook.id)).url).toBe(OLD_URL);
  });

  it("lets the owner repoint their own webhook and stamps the destination change", async () => {
    const w = await world();
    const hook = await makeWebhook(w.workspace.id, w.manager.personId);
    const response = await patchUrl(
      w.app,
      w.managerCookie,
      w.workspace.id,
      hook.id,
      NEW_URL,
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await urlOf(hook.id);
    expect(row.url).toBe(NEW_URL);
    expect(row.destinationChangedAt).toBeInstanceOf(Date);
  });

  it("lets an instance administrator repoint a receives-everything webhook but not a manager's", async () => {
    const w = await world();
    const mine = await makeWebhook(w.workspace.id, w.adminPersonId);
    const ok = await patchUrl(
      w.app,
      w.adminCookie,
      w.workspace.id,
      mine.id,
      NEW_URL,
    );
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await urlOf(mine.id)).url).toBe(NEW_URL);

    const managers = await makeWebhook(w.workspace.id, w.manager.personId);
    const refused = await patchUrl(
      w.app,
      w.adminCookie,
      w.workspace.id,
      managers.id,
      NEW_URL,
    );
    expect(refused.status, await refused.clone().text()).toBe(403);
    expect((await urlOf(managers.id)).url).toBe(OLD_URL);
  });

  it("refuses redelivery of a delivery created before the destination changed, and cancels a stored retry", async () => {
    const w = await world();
    const hook = await makeWebhook(w.workspace.id, w.manager.personId);
    const [before] = await db
      .insert(webhookDeliveryTable)
      .values({
        webhookId: hook.id,
        workspaceId: w.workspace.id,
        eventId: "evt_before",
        eventKind: "work_item.created",
        source: "event",
        requestBody: { secret: "payload for the old destination" },
        state: "delivered",
        nextAttemptAt: new Date(),
      })
      .returning();
    const first = await send(
      w.app,
      w.managerCookie,
      `/api/webhooks/deliveries/${before?.id}/redeliver`,
      undefined,
      { "x-workspace-id": w.workspace.id },
    );
    // The destination is unchanged: the redelivery is queued (the real send is outside this test).
    expect([200, 201]).toContain(first.status);

    const moved = await patchUrl(
      w.app,
      w.managerCookie,
      w.workspace.id,
      hook.id,
      NEW_URL,
    );
    expect(moved.status).toBe(200);
    const count = async () =>
      (await db.select().from(webhookDeliveryTable)).length;
    const rowsBefore = await count();
    const refused = await send(
      w.app,
      w.managerCookie,
      `/api/webhooks/deliveries/${before?.id}/redeliver`,
      undefined,
      { "x-workspace-id": w.workspace.id },
    );
    expect(refused.status).toBe(409);
    expect(await refused.text()).toMatch(/webhook_destination_changed/u);
    expect(await count()).toBe(rowsBefore);

    // A retry whose body was stored before the change is cancelled rather than sent.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const [stale] = await db
      .insert(webhookDeliveryTable)
      .values({
        webhookId: hook.id,
        workspaceId: w.workspace.id,
        eventId: "evt_stale",
        eventKind: "work_item.created",
        source: "event",
        requestBody: { stored: true },
        state: "pending",
        nextAttemptAt: new Date(),
        createdAt: new Date(Date.now() - 60_000),
      })
      .returning();
    const sent: string[] = [];
    const result = await processNextWebhookDelivery(
      {
        now: () => new Date(),
        send: async ({ url }): Promise<WebhookSendResult> => {
          sent.push(url);
          return {
            statusCode: 200,
            durationMs: 1,
            responseBody: "ok",
            error: null,
            success: true,
          };
        },
      },
      stale?.id,
    );
    expect(result.kind).toBe("cancelled");
    expect(sent).toEqual([]);
  });
});

describe("webhook re-own (P4R1-L1, WH-14, WH-15)", () => {
  it("refuses a manager taking over an active webhook, and a re-own without a proof", async () => {
    const w = await world();
    const active = await makeWebhook(w.workspace.id, w.adminPersonId);
    const token = await stepUp(w.app, w.managerCookie, "webhook_update_url", {
      workspaceId: w.workspace.id,
      webhookId: active.id,
      url: active.url,
    });
    const refused = await send(
      w.app,
      w.managerCookie,
      `/api/webhooks/${active.id}`,
      { reown: true },
      { "x-taskdesk-step-up-token": token },
      "PATCH",
    );
    expect(refused.status).toBe(403);
    expect(await refused.text()).toMatch(/webhook_reown_requires_owner_left/u);
    expect((await urlOf(active.id)).createdBy).toBe(w.adminPersonId);

    const paused = await makeWebhook(w.workspace.id, w.otherManager.personId, {
      active: false,
      disabledAt: new Date(),
      disabledReason: "owner_left",
    });
    const noProof = await send(
      w.app,
      w.managerCookie,
      `/api/webhooks/${paused.id}`,
      { reown: true, active: true },
      {},
      "PATCH",
    );
    expect(noProof.status).toBe(403);
    expect(await noProof.text()).toMatch(/step_up_required/u);
    expect((await urlOf(paused.id)).createdBy).toBe(w.otherManager.personId);
  });

  it("re-owns a webhook paused because its owner left, with a proof, and stamps the change", async () => {
    const w = await world();
    const paused = await makeWebhook(w.workspace.id, w.otherManager.personId, {
      active: false,
      disabledAt: new Date(),
      disabledReason: "owner_left",
    });
    const token = await stepUp(w.app, w.managerCookie, "webhook_update_url", {
      workspaceId: w.workspace.id,
      webhookId: paused.id,
      url: paused.url,
    });
    const response = await send(
      w.app,
      w.managerCookie,
      `/api/webhooks/${paused.id}`,
      { reown: true, active: true },
      { "x-taskdesk-step-up-token": token },
      "PATCH",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const row = await urlOf(paused.id);
    expect(row.createdBy).toBe(w.manager.personId);
    expect(row.active).toBe(true);
    expect(row.destinationChangedAt).toBeInstanceOf(Date);
  });

  it("lets an instance administrator take over an active webhook, with a proof", async () => {
    const w = await world();
    const active = await makeWebhook(w.workspace.id, w.manager.personId);
    const token = await stepUp(w.app, w.adminCookie, "webhook_update_url", {
      workspaceId: w.workspace.id,
      webhookId: active.id,
      url: active.url,
    });
    const response = await send(
      w.app,
      w.adminCookie,
      `/api/webhooks/${active.id}`,
      { reown: true },
      { "x-taskdesk-step-up-token": token },
      "PATCH",
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect((await urlOf(active.id)).createdBy).toBe(w.adminPersonId);
  });
});
