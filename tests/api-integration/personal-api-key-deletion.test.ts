import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { personalKeyDeletionTarget } from "../../apps/api/src/api-key/personal-key-deletion-target";
import {
  createPersonalApiKey,
  createServiceApiKey,
} from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

const apiRequire = createRequire(
  new URL("../../apps/api/package.json", import.meta.url),
);
const bcrypt = apiRequire("bcryptjs") as {
  hash(password: string, rounds: number): Promise<string>;
};

async function fixture(options: { name?: string; isMcp?: boolean } = {}) {
  const member = await createWorkspaceMember({ role: "owner" });
  const key = await createPersonalApiKey(
    { userId: member.user.id },
    { name: options.name ?? "Personal key", isMcp: options.isMcp },
  );
  const person = requireRow(
    await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, member.user.id)),
    "requester person",
  );
  const session = requireRow(
    await db
      .insert(schema.sessionTable)
      .values({
        id: `session-${member.user.id}`,
        token: randomUUID(),
        userId: member.user.id,
        portal: "agent",
        expiresAt: new Date(Date.now() + 3_600_000),
      })
      .returning(),
    "requester session",
  );
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  const proof = async (pendingActionId: string) => {
    const password = "delete-local-password";
    await db
      .insert(schema.accountTable)
      .values({
        id: randomUUID(),
        accountId: member.user.id,
        providerId: "credential",
        userId: member.user.id,
        password: await bcrypt.hash(password, 4),
      })
      .onConflictDoNothing();
    const request = (url: string, body: unknown) => {
      const req = withConfiguredAgentAuthority(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return app.request(req.input, req.init);
    };
    const challenge = await request("/api/me/step-up/challenges", {
      kind: "pending_action",
      pendingActionId,
    });
    expect(challenge.status, await challenge.clone().text()).toBe(200);
    const details = (await challenge.json()) as {
      challengeId: string;
      nonce: string;
    };
    const verified = await request("/api/me/step-up", {
      kind: "pending_action",
      pendingActionId,
      challengeId: details.challengeId,
      nonce: details.nonce,
      method: "password",
      password,
    });
    expect(verified.status, await verified.clone().text()).toBe(200);
    return ((await verified.json()) as { token: string }).token;
  };
  return { app, member, key, person, session, proof };
}

async function pendingAction(id: string) {
  return requireRow(
    await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, id)),
    "pending action",
  );
}

describe("personal API-key deletion through a pending action", () => {
  beforeEach(() => resetTestDatabase());

  it("keeps the key until its same human owner types the exact name and passes step-up", async () => {
    const f = await fixture({ name: "Personal build key", isMcp: true });
    const original = requireRow(
      await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, f.key.id)),
      "personal API key",
    );
    const request = await f.app.request(`/api/me/api-keys/${f.key.id}`, {
      method: "DELETE",
    });
    expect(request.status, await request.clone().text()).toBe(202);
    const body = (await request.json()) as {
      pendingActionId: string;
      confirmation: string;
      summary: Record<string, unknown>;
    };
    expect(body.confirmation).toBe("typed_name_step_up");
    expect(body.summary).toMatchObject({
      name: "Personal build key",
      kind: "personal",
      isMcp: true,
    });
    const pending = await pendingAction(body.pendingActionId);
    const currentTarget = await db.transaction((tx) =>
      personalKeyDeletionTarget.load(tx, f.key.id),
    );
    expect(pending).toMatchObject({
      routeKey: "DELETE /api/me/api-keys/{id}",
      targetType: "api_key",
      workspaceId: null,
      projectId: null,
      organisationId: null,
    });
    expect(currentTarget).toBeDefined();
    expect(pending.targetVersions).toEqual({
      [f.key.id]: currentTarget?.version,
    });
    expect(JSON.stringify(body)).not.toContain(f.key.key);
    expect(JSON.stringify(body)).not.toContain(original.key);
    expect(
      await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, f.key.id)),
    ).toHaveLength(1);

    const otherOwner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(otherOwner.user);
    const { app: otherOwnerApp } = createApp();
    const otherOwnerApproval = await otherOwnerApp.request(
      `/api/me/pending-actions/${body.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typedName: "Personal build key" }),
      },
    );
    expect([403, 404]).toContain(otherOwnerApproval.status);
    expect((await pendingAction(body.pendingActionId)).state).toBe("pending");
    mockAuthenticatedSession(f.member.user);

    const wrongName = await f.app.request(
      `/api/me/pending-actions/${body.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typedName: "Wrong key name" }),
      },
    );
    expect(wrongName.status, await wrongName.clone().text()).toBe(400);

    const missingProof = await f.app.request(
      `/api/me/pending-actions/${body.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typedName: "Personal build key" }),
      },
    );
    expect(missingProof.status).toBe(403);
    expect((await pendingAction(body.pendingActionId)).state).toBe("pending");

    const lastUsedAt = new Date();
    await db
      .update(schema.apikeyTable)
      .set({ lastRequest: lastUsedAt, requestCount: 7, remaining: 3 })
      .where(eq(schema.apikeyTable.id, f.key.id));
    await db
      .update(apiKeyExtensionTable)
      .set({ lastUsedAt, lastUsedIp: "192.0.2.7" })
      .where(eq(apiKeyExtensionTable.apikeyId, f.key.id));

    const token = await f.proof(body.pendingActionId);
    const approved = await f.app.request(
      `/api/me/pending-actions/${body.pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-taskdesk-step-up-token": token,
        },
        body: JSON.stringify({ typedName: "Personal build key" }),
      },
    );
    expect(approved.status, await approved.clone().text()).toBe(200);
    expect((await pendingAction(body.pendingActionId)).state).toBe("executed");
    expect(
      await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, f.key.id)),
    ).toHaveLength(0);
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, f.key.id));
    expect(audit.map(({ action }) => action)).toContain("api_key.revoked");
    const pendingAudit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(eq(schema.auditLogTable.entityId, body.pendingActionId));
    expect(pendingAudit.map(({ action }) => action)).toContain(
      "pending_action.executed",
    );
  });

  it("hides another person's key and refuses personal, MCP, and service-key credentials", async () => {
    const f = await fixture();
    const other = await createWorkspaceMember({ role: "owner" });
    const otherKey = await createPersonalApiKey(
      { userId: other.user.id },
      { name: "Other person's key" },
    );
    const foreign = await f.app.request(`/api/me/api-keys/${otherKey.id}`, {
      method: "DELETE",
    });
    expect(foreign.status).toBe(404);
    const serviceKey = await createServiceApiKey(
      { userId: f.member.user.id },
      f.member.workspace.id,
      { name: "Service key", capabilities: ["work_item:read"] },
    );
    const serviceTarget = await f.app.request(
      `/api/me/api-keys/${serviceKey.id}`,
      { method: "DELETE" },
    );
    expect(serviceTarget.status).toBe(404);

    const mcpKey = await createPersonalApiKey(
      { userId: f.member.user.id },
      { name: "MCP key", isMcp: true },
    );
    mockAnonymousSession();
    const { app: anonymousApp } = createApp();
    for (const key of [f.key.key, mcpKey.key, serviceKey.key]) {
      const refused = await anonymousApp.request(
        `/api/me/api-keys/${f.key.id}`,
        {
          method: "DELETE",
          headers: { "x-api-key": key },
        },
      );
      expect([401, 403, 404]).toContain(refused.status);
    }
    expect(
      await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, f.key.id)),
    ).toHaveLength(1);
  });

  it("preserves immediate revoke and invalidates a pending delete whose target changed", async () => {
    const f = await fixture();
    const request = await f.app.request(`/api/me/api-keys/${f.key.id}`, {
      method: "DELETE",
    });
    expect(request.status, await request.clone().text()).toBe(202);
    const { pendingActionId } = (await request.json()) as {
      pendingActionId: string;
    };

    const revoked = await f.app.request(`/api/me/api-keys/${f.key.id}/revoke`, {
      method: "POST",
    });
    expect(revoked.status, await revoked.clone().text()).toBe(200);
    const stillStored = requireRow(
      await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, f.key.id)),
      "revoked personal API key",
    );
    expect(stillStored.enabled).toBe(false);

    const approval = await f.app.request(
      `/api/me/pending-actions/${pendingActionId}/approve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ typedName: "Personal key" }),
      },
    );
    expect(approval.status, await approval.clone().text()).toBe(409);
    expect((await pendingAction(pendingActionId)).state).toBe("invalidated");
    expect(
      await db
        .select()
        .from(schema.apikeyTable)
        .where(eq(schema.apikeyTable.id, f.key.id)),
    ).toHaveLength(1);
  });
});
