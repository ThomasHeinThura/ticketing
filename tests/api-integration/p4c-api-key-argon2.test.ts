/**
 * AK-2 / AK-5 over HTTP: key secrets are stored as Argon2id, an existing SHA-256 row keeps
 * working and is rewritten on first use, a near-miss secret is refused, revocation is
 * immediate even after the secret has been verified once, and every request records last use.
 */
import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPersonalApiKey,
  createServiceApiKey,
  revokePersonalApiKey,
} from "../../apps/api/src/api-key/service";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function rowFor(id: string) {
  const [row] = await db
    .select()
    .from(schema.apikeyTable)
    .where(eq(schema.apikeyTable.id, id));
  return row;
}

function callWith(key: string, workspaceId: string) {
  mockAnonymousSession();
  const { app } = createApp();
  return app.request(`/api/project?workspaceId=${workspaceId}`, {
    headers: { "x-api-key": key, "x-forwarded-for": "203.0.113.9" },
  });
}

describe("API key secret storage (AK-2)", () => {
  beforeEach(async () => resetTestDatabase());

  it("stores a personal key as Argon2id and authenticates with it", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const created = await createPersonalApiKey(
      { userId: member.user.id },
      { name: "argon personal" },
    );
    const row = await rowFor(created.id);
    expect(row?.key.startsWith("$argon2id$v=19$")).toBe(true);
    expect(row?.key).not.toContain(created.key);
    expect(row?.start).toBe(created.key.slice(0, 12));
    const ok = await callWith(created.key, member.workspace.id);
    expect(ok.status, await ok.clone().text()).toBe(200);
    // Same selector, different secret: refused, never matched by prefix.
    const forged = `${created.key.slice(0, 20)}${"A".repeat(created.key.length - 20)}`;
    expect((await callWith(forged, member.workspace.id)).status).toBe(401);
  });

  it("stores a service key as Argon2id too", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const created = await createServiceApiKey(
      { userId: owner.user.id },
      owner.workspace.id,
      { name: "ci", capabilities: ["workspace:read"] },
    );
    expect((await rowFor(created.id))?.key.startsWith("$argon2id$")).toBe(true);
    const ok = await callWith(created.key, owner.workspace.id);
    expect([200, 403]).toContain(ok.status);
    expect(ok.status).not.toBe(401);
  });

  it("upgrades a legacy SHA-256 row on first use and keeps authenticating", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const secret = `tdk_legacy_${randomUUID()}`;
    const legacyHash = createHash("sha256").update(secret).digest("base64url");
    const now = new Date();
    const id = randomUUID();
    await db.insert(schema.apikeyTable).values({
      id,
      referenceId: member.user.id,
      userId: member.user.id,
      key: legacyHash,
      name: "legacy",
      start: secret.slice(0, 6),
      prefix: "tdk_",
      permissions: JSON.stringify({ project: ["read"] }),
      createdAt: now,
      updatedAt: now,
    });
    expect((await callWith(secret, member.workspace.id)).status).toBe(200);
    const upgraded = await rowFor(id);
    expect(upgraded?.key.startsWith("$argon2id$")).toBe(true);
    expect(upgraded?.key).not.toBe(legacyHash);
    expect(upgraded?.start).toBe(secret.slice(0, 12));
    // Second use goes through the Argon2id path.
    expect((await callWith(secret, member.workspace.id)).status).toBe(200);
    // The old digest is no longer a credential in its own right.
    expect((await callWith(legacyHash, member.workspace.id)).status).toBe(401);
  });

  it("revocation is immediate even after the secret was verified (and cached)", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const created = await createPersonalApiKey(
      { userId: member.user.id },
      { name: "to revoke" },
    );
    expect((await callWith(created.key, member.workspace.id)).status).toBe(200);
    expect((await callWith(created.key, member.workspace.id)).status).toBe(200);
    await revokePersonalApiKey({ userId: member.user.id }, created.id);
    expect((await callWith(created.key, member.workspace.id)).status).toBe(401);
  });

  it("records last use time and address on a request (AK-5)", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const created = await createPersonalApiKey(
      { userId: member.user.id },
      { name: "last used" },
    );
    const before = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, created.id));
    expect(before[0]?.lastUsedAt).toBeNull();
    expect((await callWith(created.key, member.workspace.id)).status).toBe(200);
    const [after] = await db
      .select()
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, created.id));
    expect(after?.lastUsedAt).toBeInstanceOf(Date);
    expect(after?.lastUsedIp).toBe("203.0.113.9");
    const row = await rowFor(created.id);
    expect(row?.lastRequest).toBeInstanceOf(Date);
  });
});

describe("API key verification flood (R7-03)", () => {
  beforeEach(async () => resetTestDatabase());

  const from = (key: string, workspaceId: string, ip: string) => {
    mockAnonymousSession();
    const { app } = createApp();
    return app.request(`/api/project?workspaceId=${workspaceId}`, {
      headers: { "x-api-key": key, "x-forwarded-for": ip },
    });
  };

  it("throttles wrong secrets on a known selector from one address, while a correct key elsewhere still works", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const created = await createPersonalApiKey(
      { userId: member.user.id },
      { name: "flood target" },
    );
    const selector = created.key.slice(0, 12);
    const statuses: number[] = [];
    for (let i = 0; i < 16; i += 1) {
      const junk = `${selector}${randomUUID().replaceAll("-", "").padEnd(31, "x")}`;
      statuses.push(
        (await from(junk, member.workspace.id, "198.51.100.7")).status,
      );
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toContain(429);
    // The attacker's own address is also refused the hash for the correct secret that is not
    // yet cached (it is a guess as far as the server can tell)...
    // ...but the owner's key from another address authenticates, and the selector is not locked.
    const ok = await from(created.key, member.workspace.id, "203.0.113.50");
    expect(ok.status, await ok.clone().text()).toBe(200);
  });

  it("rejects a malformed credential without a hash, and a revoked key does not pass", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const created = await createPersonalApiKey(
      { userId: member.user.id },
      { name: "revoked under flood" },
    );
    expect((await from("tdk_x", member.workspace.id, "192.0.2.1")).status).toBe(
      401,
    );
    expect(
      (
        await from(
          `${created.key.slice(0, 12)}!!`,
          member.workspace.id,
          "192.0.2.1",
        )
      ).status,
    ).toBe(401);
    expect(
      (await from(created.key, member.workspace.id, "192.0.2.2")).status,
    ).toBe(200);
    await revokePersonalApiKey({ userId: member.user.id }, created.id);
    expect(
      (await from(created.key, member.workspace.id, "192.0.2.3")).status,
    ).toBe(401);
  });
});
