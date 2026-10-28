/** WH-13: mounted incident endpoints expose every safe target and reject stale sets atomically. */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredAgentOrigin,
  getConfiguredCustomerOrigin,
} from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { webhookTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import {
  decryptSecret,
  encryptSecret,
} from "../../apps/api/src/notification-preferences/secrets";
import { webhookSecretRotationSetDigest } from "../../apps/api/src/webhook/rotate-all";
import { mockAuthenticatedSession } from "./helpers/auth";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const AGENT_HOST = new URL(getConfiguredAgentOrigin()).host;
const CUSTOMER_HOST = new URL(getConfiguredCustomerOrigin()).host;
const OLD_SECRET = "whsec_rotate_api_old_secret_000000000";
const PASSWORD = "wh13-rotate-all-password";
process.env.TASKDESK_ENCRYPTION_KEY ??= "e1".repeat(32);
const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(value: string, rounds: number): Promise<string>;
};

async function createWebhook(workspaceId: string, userId: string) {
  const person = requireRow(
    await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1),
    "webhook owner person",
  );
  const marker = randomUUID();
  const row = requireRow(
    await db
      .insert(webhookTable)
      .values({
        workspaceId,
        name: `Rotation target ${marker}`,
        url: `https://hooks.example.test/${marker}`,
        secret: encryptSecret(`${OLD_SECRET}${marker}`) as string,
        events: ["work_item.created"],
        createdBy: person.id,
      })
      .returning(),
    "webhook",
  );
  return { row, marker };
}

async function signIn(app: ReturnType<typeof createApp>["app"], email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("Sign-in did not issue an agent session");
  return cookie;
}

async function postWithCookie(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  cookie: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return csrfRequest(
    app,
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...headers },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

async function mintRotationProof(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  replacementSetDigest: string,
) {
  const binding = {
    kind: "operation",
    operation: "webhook_rotate_all",
    replacementSetDigest,
  };
  const challenge = await postWithCookie(
    app,
    "/api/me/step-up/challenges",
    cookie,
    binding,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const { challengeId, nonce } = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
    expiresAt?: string;
  };
  const proof = await postWithCookie(app, "/api/me/step-up", cookie, {
    ...binding,
    challengeId,
    nonce,
    method: "password",
    password: PASSWORD,
  });
  expect(proof.status, await proof.clone().text()).toBe(200);
  return ((await proof.json()) as { token: string }).token;
}

describe("mounted WH-13 rotate-all endpoints", () => {
  beforeEach(async () => resetTestDatabase());

  it("lists the exact current set, including non-full-reach owners, without secret material", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const ordinary = await createWorkspaceMember({ role: "owner" });
    const adminHook = await createWebhook(admin.workspace.id, admin.user.id);
    const ordinaryHook = await createWebhook(
      ordinary.workspace.id,
      ordinary.user.id,
    );
    mockAuthenticatedSession({ ...admin.user, role: "admin" });
    const { app } = createApp();

    const collected: { id: string; version: number }[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: "1" });
      if (cursor) query.set("cursor", cursor);
      const response = await app.request(
        `/api/instance/webhooks/rotation-targets?${query.toString()}`,
        { headers: { host: AGENT_HOST } },
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const text = await response.text();
      expect(text).not.toContain(
        `https://hooks.example.test/${adminHook.marker}`,
      );
      expect(text).not.toContain(
        `https://hooks.example.test/${ordinaryHook.marker}`,
      );
      expect(text).not.toContain(`${OLD_SECRET}${adminHook.marker}`);
      expect(text).not.toContain(`${OLD_SECRET}${ordinaryHook.marker}`);
      const body = JSON.parse(text) as {
        data: { id: string; version: number }[];
        page: { nextCursor: string | null; hasMore: boolean };
      };
      collected.push(...body.data);
      cursor = body.page.nextCursor ?? undefined;
    } while (cursor);

    expect(collected.map(({ id }) => id).sort()).toEqual(
      [adminHook.row.id, ordinaryHook.row.id].sort(),
    );
    expect(new Set(collected.map(({ id }) => id)).size).toBe(collected.length);

    const posture = await app.request(
      "/api/instance/webhooks/security-posture?limit=100",
      { headers: { host: AGENT_HOST } },
    );
    expect(posture.status).toBe(200);
    const postureBody = (await posture.json()) as {
      data: { id: string }[];
    };
    expect(postureBody.data.map(({ id }) => id)).toContain(adminHook.row.id);
    expect(postureBody.data.map(({ id }) => id)).not.toContain(
      ordinaryHook.row.id,
    );
  });

  it("rejects ordinary/customer access and refuses changed snapshots before proof spend", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const ordinary = await createWorkspaceMember({ role: "owner" });
    const first = await createWebhook(admin.workspace.id, admin.user.id);
    const second = await createWebhook(ordinary.workspace.id, ordinary.user.id);
    const { app } = createApp();

    mockAuthenticatedSession({ ...ordinary.user, role: null });
    expect(
      (
        await app.request("/api/instance/webhooks/rotation-targets", {
          headers: { host: AGENT_HOST },
        })
      ).status,
    ).toBe(403);

    mockAuthenticatedSession(
      { ...admin.user, role: "admin" },
      { portal: "customer" },
    );
    expect(
      (
        await app.request("/api/instance/webhooks/rotation-targets", {
          headers: { host: CUSTOMER_HOST },
        })
      ).status,
    ).toBe(404);

    mockAuthenticatedSession({ ...admin.user, role: "admin" });
    const replacements = [
      {
        webhookId: first.row.id,
        expectedVersion: first.row.version,
        secret: "whsec_rotate_api_replacement_first_0001",
      },
      {
        webhookId: second.row.id,
        expectedVersion: second.row.version,
        secret: "whsec_rotate_api_replacement_second_002",
      },
    ];
    await db
      .update(webhookTable)
      .set({ version: second.row.version + 1 })
      .where(eq(webhookTable.id, second.row.id));
    const stale = await app.request("/api/instance/webhooks/rotate-secrets", {
      method: "POST",
      headers: {
        host: AGENT_HOST,
        "content-type": "application/json",
      },
      body: JSON.stringify({ webhooks: replacements }),
    });
    expect(stale.status, await stale.clone().text()).toBe(409);
    const staleText = await stale.text();
    expect(staleText).not.toContain(replacements[0]!.secret);
    expect(staleText).not.toContain(replacements[1]!.secret);

    const after = await db
      .select({ secret: webhookTable.secret, version: webhookTable.version })
      .from(webhookTable)
      .where(eq(webhookTable.id, first.row.id));
    expect(after[0]).toMatchObject({
      secret: first.row.secret,
      version: first.row.version,
    });
  });

  it("consumes digest-only step-up for the exact replacement set and audits no secrets", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    await db.insert(schema.accountTable).values({
      id: `${admin.user.id}-account`,
      accountId: admin.user.id,
      providerId: "credential",
      userId: admin.user.id,
      password: await bcrypt.hash(PASSWORD, 4),
    });
    const ordinary = await createWorkspaceMember({ role: "owner" });
    const first = await createWebhook(admin.workspace.id, admin.user.id);
    const second = await createWebhook(ordinary.workspace.id, ordinary.user.id);
    const { app } = createApp();
    const cookie = await signIn(app, admin.user.email);
    const replacements = [
      {
        webhookId: first.row.id,
        expectedVersion: first.row.version,
        secret: "whsec_confirmed_replacement_first_00001",
      },
      {
        webhookId: second.row.id,
        expectedVersion: second.row.version,
        secret: "whsec_confirmed_replacement_second_0002",
      },
    ];
    const replacementSetDigest = webhookSecretRotationSetDigest({
      webhooks: replacements,
    });
    expect(replacementSetDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(replacementSetDigest).not.toContain(replacements[0]!.secret);
    const token = await mintRotationProof(app, cookie, replacementSetDigest);

    const tampered = replacements.map((entry, index) =>
      index === 0
        ? { ...entry, secret: "whsec_tampered_replacement_first_00001" }
        : entry,
    );
    const denied = await postWithCookie(
      app,
      "/api/instance/webhooks/rotate-secrets",
      cookie,
      { webhooks: tampered },
      { "x-taskdesk-step-up-token": token },
    );
    expect(denied.status, await denied.clone().text()).toBe(403);
    const deniedText = await denied.text();
    expect(deniedText).not.toContain(tampered[0]!.secret);
    expect(deniedText).not.toContain(replacements[0]!.secret);

    const rotated = await postWithCookie(
      app,
      "/api/instance/webhooks/rotate-secrets",
      cookie,
      { webhooks: replacements },
      { "x-taskdesk-step-up-token": token },
    );
    expect(rotated.status, await rotated.clone().text()).toBe(200);
    const responseText = await rotated.text();
    expect(responseText).not.toContain(replacements[0]!.secret);
    expect(responseText).not.toContain(replacements[1]!.secret);
    expect(JSON.parse(responseText)).toMatchObject({ rotatedCount: 2 });

    const stored = await db
      .select({
        id: webhookTable.id,
        secret: webhookTable.secret,
        secretPrevious: webhookTable.secretPrevious,
        version: webhookTable.version,
      })
      .from(webhookTable);
    expect(stored).toHaveLength(2);
    expect(stored.map(({ id }) => id).sort()).toEqual(
      [first.row.id, second.row.id].sort(),
    );
    const storedById = new Map(stored.map((row) => [row.id, row]));
    for (const row of stored) {
      expect(row.secret).not.toContain(replacements[0]!.secret);
      expect(row.secret).not.toContain(replacements[1]!.secret);
      expect(row.secretPrevious).toBeTruthy();
      expect(row.version).toBe(2);
    }
    expect(decryptSecret(storedById.get(first.row.id)?.secret ?? null)).toBe(
      replacements[0]!.secret,
    );
    expect(decryptSecret(storedById.get(second.row.id)?.secret ?? null)).toBe(
      replacements[1]!.secret,
    );
    expect(storedById.get(first.row.id)?.secretPrevious).toBe(first.row.secret);
    expect(storedById.get(second.row.id)?.secretPrevious).toBe(
      second.row.secret,
    );
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "webhook.secret_rotated"));
    const auditText = JSON.stringify(audits, (_key, value) =>
      typeof value === "bigint" ? Number(value) : value,
    );
    expect(audits).toHaveLength(2);
    expect(auditText).not.toContain(replacements[0]!.secret);
    expect(auditText).not.toContain(replacements[1]!.secret);
    expect(auditText).not.toContain("hooks.example.test");

    const replayEntries = replacements.map((entry, index) => ({
      ...entry,
      expectedVersion: entry.expectedVersion + 1,
      secret: `whsec_replay_secret_${index}_000000000000`,
    }));
    const replay = await postWithCookie(
      app,
      "/api/instance/webhooks/rotate-secrets",
      cookie,
      { webhooks: replayEntries },
      { "x-taskdesk-step-up-token": token },
    );
    expect(replay.status, await replay.clone().text()).toBe(403);
  });
});
