import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auditWriter from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as auditNotifier from "../../apps/api/src/instance/observability/audit-failure-notifier";
import * as auditRuntime from "../../apps/api/src/instance/observability/runtime";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

function hashApiKeyForTest(key: string): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createApiKeyFor(
  userId: string,
  permissions: string | null,
  expiresAt: Date | null = null,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "Work item export integration key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

async function exportWithKey(
  rawKey: string,
  workspaceId: string,
  query: Record<string, unknown> = {
    entity: "work_item",
    columns: ["key", "title"],
  },
): Promise<Response> {
  const { app } = createApp();
  return app.request("/api/work-items/export", {
    method: "POST",
    headers: {
      authorization: `Bearer ${rawKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workspaceId,
      query,
    }),
  });
}

describe("POST /api/work-items/export", () => {
  beforeEach(async () => resetTestDatabase());
  afterEach(() => vi.restoreAllMocks());

  it("requires work_item:export and records no audit row on denial", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        query: { entity: "work_item" },
      }),
    });
    expect(response.status).toBe(403);
    const audits = await db.select().from(schema.auditLogTable);
    expect(audits).toHaveLength(0);
  });

  it("masks a foreign workspace before checking export capability", async () => {
    const caller = await createWorkspaceMember({ role: "member" });
    const foreign = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(caller.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: foreign.workspace.id,
        query: { entity: "work_item" },
      }),
    });
    expect(response.status).toBe(404);
    expect(await db.select().from(schema.auditLogTable)).toHaveLength(0);
  });

  it("exports only requested columns and audits the completed export", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["key", "title"] },
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "work-items.csv",
    );
    expect(await response.text()).toBe('"Key","Title"\r\n');
    const audits = await db.select().from(schema.auditLogTable);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe("work_item.exported");
    expect(audits[0]?.after).toMatchObject({
      format: "csv",
      count: 0,
      columns: ["key", "title"],
    });
  });

  it("AU-14: preserves a completed CSV when its audit append fails", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    mockAuthenticatedSession(owner.user);
    vi.spyOn(auditWriter, "appendAuditLog").mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    const failureMetric = vi.spyOn(auditRuntime, "recordAuditWriteFailure");
    const notifyAdmins = vi
      .spyOn(auditNotifier, "notifyCurrentInstanceAdminsOfAuditFailure")
      .mockResolvedValue();
    const { app } = createApp();
    const response = await app.request("/api/work-items/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        query: { entity: "work_item", columns: ["key", "title"] },
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('"Key","Title"\r\n');
    expect(failureMetric).toHaveBeenCalledWith("mutation");
    expect(notifyAdmins).toHaveBeenCalledWith("mutation");
  });

  it("exports real reached rows for an owner API key with an explicit export scope", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const reachable = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const unreachable = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, reachable.project.id, [
      "work_item:export",
      "project:read",
    ]);
    const now = new Date();
    const [type] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `state-${randomUUID()}`,
        name: "Started",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!type || !template) throw new Error("Export fixture setup failed");
    await db.insert(schema.stateTable).values([
      {
        projectId: reachable.project.id,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: unreachable.project.id,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const reachableCreated = await app.request(
      `/api/projects/${reachable.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Reachable export row",
        }),
      },
    );
    expect(reachableCreated.status).toBe(200);
    const unreachableCreated = await app.request(
      `/api/projects/${unreachable.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Unreachable export row",
        }),
      },
    );
    expect(unreachableCreated.status).toBe(200);
    const key = await createApiKeyFor(
      owner.user.id,
      JSON.stringify({ work_item: ["export"] }),
    );

    const response = await exportWithKey(key, owner.workspace.id);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const csv = await response.text();
    expect(csv).toContain("Reachable export row");
    expect(csv).not.toContain("Unreachable export row");
    const audits = await db.select().from(schema.auditLogTable);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "work_item.exported",
      actorType: "api_key",
      apiKeyId: expect.any(String),
    });
  });

  it("requires project:read in key scope for a project-filtered export", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const reachable = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    await grantProjectRole(owner.user.id, reachable.project.id, [
      "work_item:create",
      "work_item:export",
      "project:read",
    ]);
    const now = new Date();
    const [type] = await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const [template] = await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: owner.workspace.id,
        key: `state-${randomUUID()}`,
        name: "Started",
        group: "started",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!type || !template) throw new Error("Export fixture setup failed");
    await db.insert(schema.stateTable).values({
      projectId: reachable.project.id,
      stateTemplateId: template.id,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const created = await app.request(
      `/api/projects/${reachable.project.id}/work-items`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          typeId: type.id,
          title: "Filtered reachable export row",
        }),
      },
    );
    expect(created.status).toBe(200);

    const filteredQuery = {
      entity: "work_item",
      filter: { field: "project", op: "eq", value: reachable.project.slug },
      columns: ["key", "title"],
    };
    const fullyScopedKey = await createApiKeyFor(
      owner.user.id,
      JSON.stringify({ work_item: ["export"], project: ["read"] }),
    );
    const allowed = await exportWithKey(
      fullyScopedKey,
      owner.workspace.id,
      filteredQuery,
    );
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("Filtered reachable export row");

    const exportOnlyKey = await createApiKeyFor(
      owner.user.id,
      JSON.stringify({ work_item: ["export"] }),
    );
    const denied = await exportWithKey(
      exportOnlyKey,
      owner.workspace.id,
      filteredQuery,
    );
    expect(denied.status).toBe(422);
    expect(
      (await db.select().from(schema.auditLogTable)).filter(
        (audit) => audit.action === "work_item.exported",
      ),
    ).toHaveLength(1);
  });

  it("keeps the key's export scope subordinate to the owner's current workspace role", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    const key = await createApiKeyFor(
      member.user.id,
      JSON.stringify({ work_item: ["export"], project: ["read"] }),
    );

    const response = await exportWithKey(key, member.workspace.id);

    expect(response.status).toBe(403);
    expect(
      (await db.select().from(schema.auditLogTable)).filter(
        (audit) => audit.action === "work_item.exported",
      ),
    ).toHaveLength(0);
  });

  it.each([
    ["read-only", JSON.stringify({ work_item: ["read"] })],
    ["narrow", JSON.stringify({ work_item: [] })],
    ["null", null],
    ["malformed", '{"work_item":"export"}'],
  ])(
    "denies an owner API key with %s scope without exporting",
    async (_label, permissions) => {
      const owner = await createWorkspaceMember({ role: "owner" });
      const key = await createApiKeyFor(owner.user.id, permissions);

      const response = await exportWithKey(key, owner.workspace.id);

      expect(response.status).toBe(403);
      expect(
        (await db.select().from(schema.auditLogTable)).filter(
          (audit) => audit.action === "work_item.exported",
        ),
      ).toHaveLength(0);
    },
  );

  it("refuses an expired owner API key without exporting", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const key = await createApiKeyFor(
      owner.user.id,
      JSON.stringify({ work_item: ["export"] }),
      new Date(Date.now() - 60_000),
    );

    const response = await exportWithKey(key, owner.workspace.id);

    expect(response.status).toBe(401);
    expect(
      (await db.select().from(schema.auditLogTable)).filter(
        (audit) => audit.action === "work_item.exported",
      ),
    ).toHaveLength(0);
  });
});
