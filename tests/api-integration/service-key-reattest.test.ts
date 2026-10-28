import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createServiceApiKey } from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { csrfRequest } from "./helpers/csrf";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(password: string, rounds: number): Promise<string>;
};
const PASSWORD = "ak7-reattest-password";
const JSON_HEADERS = { "content-type": "application/json" };

type App = ReturnType<typeof createApp>["app"];

async function addCredential(userId: string) {
  await db.insert(schema.accountTable).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: await bcrypt.hash(PASSWORD, 4),
  });
}

async function signIn(app: App, email: string) {
  const response = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-forwarded-for": "203.0.113.85" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  expect(response.status, await response.clone().text()).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("__Host-tdk_agent_session="))
    ?.split(";", 1)[0];
  if (!cookie) throw new Error("Agent session cookie missing after sign-in");
  return cookie;
}

function post(
  app: App,
  cookie: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return csrfRequest(
    app,
    path,
    {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie, ...headers },
      body: JSON.stringify(body),
    },
    cookie,
  );
}

async function operationProof(
  app: App,
  cookie: string,
  fields: { workspaceId: string; keyId: string; expectedVersion: number },
) {
  const operation = {
    kind: "operation",
    operation: "service_key_reattest",
    ...fields,
  };
  const challenge = await post(
    app,
    cookie,
    "/api/me/step-up/challenges",
    operation,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const { challengeId, nonce } = (await challenge.json()) as {
    challengeId: string;
    nonce: string;
  };
  const verified = await post(app, cookie, "/api/me/step-up", {
    ...operation,
    challengeId,
    nonce,
    method: "password",
    password: PASSWORD,
  });
  expect(verified.status, await verified.clone().text()).toBe(200);
  return ((await verified.json()) as { token: string }).token;
}

describe("workspace service-key re-attestation (AK-7)", () => {
  beforeEach(async () => resetTestDatabase());

  it("requires a reachable api_key:manage session and step-up, uses CAS, and changes no credential authority", async () => {
    const admin = await createWorkspaceMember({ role: "owner" });
    const key = await createServiceApiKey(
      { userId: admin.user.id },
      admin.workspace.id,
      { name: "CI service key", capabilities: ["workspace:read"] },
    );
    const transferredAt = new Date("2026-10-24T12:00:00Z");
    await db
      .update(apiKeyExtensionTable)
      .set({
        adminOwnershipTransferredAt: transferredAt,
        formerCreatorAt: transferredAt,
        reattestationRequiredAt: transferredAt,
      })
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));

    await addCredential(admin.user.id);
    const ordinary = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: ordinary.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    await addCredential(ordinary.user.id);
    const outsider = await createWorkspaceMember({ role: "owner" });
    await addCredential(outsider.user.id);

    const { app } = createApp();
    const adminCookie = await signIn(app, admin.user.email);
    const ordinaryCookie = await signIn(app, ordinary.user.email);
    const outsiderCookie = await signIn(app, outsider.user.email);
    const path = `/api/workspaces/${admin.workspace.id}/api-keys/${key.id}/re-attest`;
    const body = { expectedVersion: 1 };

    const noProof = await post(app, adminCookie, path, body);
    expect(noProof.status, await noProof.clone().text()).toBe(403);
    const notManager = await post(app, ordinaryCookie, path, body);
    expect(notManager.status, await notManager.clone().text()).toBe(403);
    const noWorkspaceReach = await post(app, outsiderCookie, path, body);
    expect([403, 404]).toContain(noWorkspaceReach.status);

    const [credentialBefore] = await db
      .select({
        keyHash: schema.apikeyTable.key,
        permissions: schema.apikeyTable.permissions,
      })
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, key.id));

    const staleToken = await operationProof(app, adminCookie, {
      workspaceId: admin.workspace.id,
      keyId: key.id,
      expectedVersion: 1,
    });
    await db
      .update(apiKeyExtensionTable)
      .set({ accountabilityVersion: 2 })
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    const stale = await post(app, adminCookie, path, body, {
      "x-taskdesk-step-up-token": staleToken,
    });
    expect(stale.status, await stale.clone().text()).toBe(409);

    const currentToken = await operationProof(app, adminCookie, {
      workspaceId: admin.workspace.id,
      keyId: key.id,
      expectedVersion: 2,
    });
    const accepted = await post(
      app,
      adminCookie,
      path,
      { expectedVersion: 2 },
      { "x-taskdesk-step-up-token": currentToken },
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const acceptedBody = (await accepted.json()) as Record<string, unknown>;
    expect(acceptedBody).toMatchObject({
      id: key.id,
      capabilities: ["workspace:read"],
      ownedByWorkspaceAdmins: true,
      requiresReattestation: false,
      accountabilityVersion: 3,
    });
    expect(Object.keys(acceptedBody)).not.toContain("key");
    const [credentialAfter] = await db
      .select({
        keyHash: schema.apikeyTable.key,
        permissions: schema.apikeyTable.permissions,
      })
      .from(schema.apikeyTable)
      .where(eq(schema.apikeyTable.id, key.id));
    expect(credentialAfter?.keyHash === credentialBefore?.keyHash).toBe(true);
    expect(credentialAfter?.permissions === credentialBefore?.permissions).toBe(
      true,
    );

    const [stored] = await db
      .select({
        capabilities: apiKeyExtensionTable.capabilities,
        reattestationRequiredAt: apiKeyExtensionTable.reattestationRequiredAt,
        reattestedAt: apiKeyExtensionTable.reattestedAt,
        reattestedByPersonId: apiKeyExtensionTable.reattestedByPersonId,
        accountabilityVersion: apiKeyExtensionTable.accountabilityVersion,
      })
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, key.id));
    expect(stored).toMatchObject({
      capabilities: ["workspace:read"],
      reattestationRequiredAt: null,
      reattestedByPersonId: expect.any(String),
      accountabilityVersion: 3,
    });
    expect(stored?.reattestedAt).toBeInstanceOf(Date);
    const [audit] = await db
      .select()
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.action, "api_key.reattested"));
    expect(audit).toMatchObject({
      actorId: admin.user.id,
      workspaceId: admin.workspace.id,
      entityType: "api_key",
      entityId: key.id,
    });
    const serializedAudit = JSON.stringify(audit, (_field, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serializedAudit.includes(key.key)).toBe(false);
  });
});
