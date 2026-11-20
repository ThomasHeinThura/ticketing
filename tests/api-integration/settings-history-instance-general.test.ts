/**
 * The General settings History (`type=instance`, id `singleton`) lists only settings changes:
 * observability, local-factor and rekey events share the entity but are not General settings.
 * Written against a fresh dedicated `_test` PostgreSQL; the repository owner runs it (the author
 * did not execute it: assumptions are listed in the review packet).
 */
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@taskdesk/domain";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../apps/api/src/audit/repository";
import { settingsHistoryScope } from "../../apps/api/src/audit/settings-history";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceMember,
  prepareAuthenticatedApiFixture,
} from "./helpers/fixtures";

const path = "/api/audit?entity_type=instance&entity_id=singleton";

async function seedAdmin() {
  const admin = {
    id: `general-admin-${randomUUID()}`,
    email: `general-admin-${randomUUID()}@example.com`,
    name: "General Admin",
    emailVerified: true,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(schema.userTable).values(admin);
  await prepareAuthenticatedApiFixture(admin.id);
  const token = `token-${admin.id}`;
  await db.insert(schema.sessionTable).values({
    id: `session-${admin.id}`,
    token,
    userId: admin.id,
    portal: "agent",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  mockAuthenticatedSession(admin);
  return {
    admin,
    headers: {
      host: "localhost:1337",
      cookie: `__Host-tdk_agent_session=${token}`,
    },
  };
}

const write = (actorId: string, action: string, after: JsonValue) =>
  appendAuditLog(db, {
    actorId,
    actorType: "person",
    workspaceId: null,
    action,
    entityType: "instance",
    entityId: "singleton",
    after,
  });

async function auditReads() {
  const rows = await db
    .select()
    .from(schema.auditLogTable)
    .where(eq(schema.auditLogTable.action, "audit.read"));
  return rows.length;
}

describe("instance General History excludes unrelated instance events", () => {
  beforeEach(async () => resetTestDatabase());

  it("keeps only settings changes in rows, lastChanged and actor names, with the read audited", async () => {
    const { admin, headers } = await seedAdmin();
    const other = await createWorkspaceMember({ role: "owner" });
    await write(admin.id, "instance.settings_changed", {
      changedKeys: ["mcpWriteCeilingPerMinute", "notASettingKey"],
    });
    // Newer, unrelated writers of the same entity (a different person for the actor-name check).
    await write(other.user.id, "instance.observability_changed", {
      changedKeys: ["logLevel"],
    });
    await write(other.user.id, "instance.local_factor_policy_changed", {
      changedKeys: ["policy"],
    });
    await write(other.user.id, "secrets.rekeyed", { counts: { plugins: 1 } });

    const identity = await resolveIdentity({
      userId: admin.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing admin identity");
    const query = {
      identity,
      entityType: "instance" as const,
      entityId: "singleton",
      workspaceId: null,
    };
    const rows = await listSettingsHistoryRows(query);
    expect(rows.map((row) => row.action)).toEqual([
      "instance.settings_changed",
    ]);
    const names = await listSettingsHistoryActorNames(query, [
      admin.id,
      other.user.id,
    ]);
    expect([...names.keys()]).toEqual([admin.id]);

    const before = await auditReads();
    const { app } = createApp();
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain(other.user.name);
    const body = JSON.parse(text) as {
      rows: Array<{ action: string; actor: { name: string }; at: string }>;
      lastChanged: { actor: { name: string }; at: string } | null;
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      action: "instance.settings_changed",
      changedFields: ["mcpWriteCeilingPerMinute"],
      actor: { kind: "person", name: admin.name },
    });
    expect(body.lastChanged).toEqual({
      actor: body.rows[0]?.actor,
      at: body.rows[0]?.at,
    });
    // The route awaits the audit write before it answers, so the row is already counted.
    expect(await auditReads()).toBe(before + 1);
  });

  it("is empty, not misattributed, when only unrelated instance events exist", async () => {
    const { admin, headers } = await seedAdmin();
    await write(admin.id, "instance.observability_changed", {
      changedKeys: ["logLevel"],
    });
    await write(admin.id, "secrets.rekeyed", { counts: { plugins: 1 } });
    const { app } = createApp();
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [],
      lastChanged: null,
    });
  });

  it("keeps the current-admin contract", async () => {
    const { admin, headers } = await seedAdmin();
    await write(admin.id, "instance.settings_changed", {
      changedKeys: ["mcpWriteCeilingPerMinute"],
    });
    const { app } = createApp();
    expect((await app.request(path, { headers })).status).toBe(200);
    // Another id is not this selector.
    expect(
      (
        await app.request("/api/audit?entity_type=instance&entity_id=other", {
          headers,
        })
      ).status,
    ).toBe(403);
    // A person who is not an instance administrator is refused.
    const member = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(member.user);
    expect((await app.request(path, { headers })).status).toBe(403);
  });

  // Full mounted flow. The retained fail-closed global factor-policy guard
  // (enforceLocalFactorEnrollment -> loadLocalFactorState) reads the same singleton row, so with the
  // core row gone the mounted app answers 503 before the History scope can answer 404.
  it("fails closed with 503 factor_policy_unavailable, and no audit read, when the core singleton row is missing", async () => {
    const { admin, headers } = await seedAdmin();
    const { app } = createApp();
    expect((await app.request(path, { headers })).status).toBe(200);
    await db
      .delete(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const before = await auditReads();
    mockAuthenticatedSession(admin);
    const response = await app.request(path, { headers });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("factor_policy_unavailable");
    expect(await auditReads()).toBe(before);
  });

  // Scope-level witness, NOT the mounted flow: the real settingsHistoryScope middleware (real
  // identity resolution and SQL on this database, nothing mocked) in a minimal Hono app that only
  // supplies the request context the production auth middleware would set. It shows the History
  // scope itself answers 404 for a live administrator when the singleton row is absent.
  it("scope middleware answers 404 History not found for a live admin without the singleton row, and never reaches the read", async () => {
    const { admin } = await seedAdmin();
    let reached = 0;
    const harness = new Hono<{
      Variables: { userId: string; session: { id: string; portal: string } };
    }>();
    harness.get(
      "/history",
      async (c, next) => {
        c.set("userId", admin.id);
        c.set("session", { id: `session-${admin.id}`, portal: "agent" });
        await next();
      },
      settingsHistoryScope,
      (c) => {
        reached += 1;
        return c.json({});
      },
    );
    const target = "/history?entity_type=instance&entity_id=singleton";
    // Control: with the row present the same harness admits the request and reaches the read.
    expect((await harness.request(target)).status).toBe(200);
    expect(reached).toBe(1);

    await db
      .delete(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"));
    const before = await auditReads();
    const response = await harness.request(target);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("History not found");
    expect(reached).toBe(1);
    expect(await auditReads()).toBe(before);
  });
});
