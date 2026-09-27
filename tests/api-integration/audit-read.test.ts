/**
 * Integration tests for audit-trail.md's read API (§ API + § Access).
 *
 * - AU-11: instance administrators see the instance-wide log (`instance:read_audit`).
 * - AU-10: workspace administrators see their own workspace's rows; the tenant filter
 *   holds even with a second workspace's rows present.
 * - AU-12: a non-instance-admin never gets the instance route (403).
 * - AU-13: every successful read writes exactly one `audit.read` row (no batching).
 * - The canonical capability check: a `member` (no `workspace:manage_settings`) is
 *   refused the workspace route.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

beforeEach(async () => {
  await resetTestDatabase();
});

async function seedAuditRow(workspaceId: string | null, action: string) {
  const row = await appendAuditLog(db, {
    actorId: null,
    actorType: "system",
    workspaceId,
    action,
    entityType: "audit_log",
    entityId: workspaceId ?? "instance",
  });
  return row;
}

async function auditReadCount(workspaceId: string | null): Promise<number> {
  const rows = await db
    .select()
    .from(schema.auditLogTable)
    .where(
      and(
        eq(schema.auditLogTable.action, "audit.read"),
        workspaceId === null
          ? undefined
          : eq(schema.auditLogTable.workspaceId, workspaceId),
      ),
    );
  return rows.filter((r) => r.workspaceId === workspaceId).length;
}

describe("GET /api/instance/audit (AU-11/AU-12/AU-13)", () => {
  it("an instance admin (user role admin) reads every row, and the read itself is audited", async () => {
    await seedAuditRow(null, "auth.sign_in_succeeded");

    const admin = {
      id: "user-audit-admin",
      email: "audit-admin@example.com",
      name: "Audit Admin",
      emailVerified: true,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.userTable).values(admin);
    mockAuthenticatedSession(admin);
    const { app } = createApp();

    const before = await auditReadCount(null);
    const response = await app.request("/api/instance/audit");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: { action: string; seq: string }[];
    };
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.rows[0]?.seq).toMatch(/^\d+$/); // bigint as decimal string
    expect(body.rows.some((r) => r.action === "auth.sign_in_succeeded")).toBe(
      true,
    );

    // AU-13: the successful read added exactly one audit.read row.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await auditReadCount(null)).toBe(before + 1);
  });

  it("a non-instance-admin is refused (AU-12 — customers/agents never reach the log)", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/instance/audit");
    expect(response.status).toBe(403);
  });

  it("the action prefix filter matches dotted groups", async () => {
    await seedAuditRow(null, "auth.sign_in_failed");
    await seedAuditRow(null, "plugin.changed");

    const admin = {
      id: "user-audit-admin-2",
      email: "audit-admin2@example.com",
      name: "Audit Admin 2",
      emailVerified: true,
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.insert(schema.userTable).values(admin);
    mockAuthenticatedSession(admin);
    const { app } = createApp();

    const response = await app.request("/api/instance/audit?action=auth.");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rows: { action: string }[] };
    expect(body.rows.length).toBeGreaterThanOrEqual(1);
    expect(body.rows.every((r) => r.action.startsWith("auth."))).toBe(true);
  });
});

describe("GET /api/workspaces/{workspaceId}/audit (AU-10 + tenant isolation)", () => {
  it("a workspace owner reads their workspace's rows only, and the read is audited with the workspace id", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const other = await createWorkspaceMember();
    await seedAuditRow(workspace.id, "role.created");
    await seedAuditRow(other.workspace.id, "role.deleted");

    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/workspaces/${workspace.id}/audit`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: { action: string; workspaceId: string }[];
    };
    expect(body.rows.some((r) => r.action === "role.created")).toBe(true);
    // Tenant isolation: the other workspace's row never appears.
    expect(body.rows.some((r) => r.action === "role.deleted")).toBe(false);
    expect(body.rows.every((r) => r.workspaceId === workspace.id)).toBe(true);

    // AU-13 with the workspace id on the audit.read row.
    await new Promise((resolve) => setTimeout(resolve, 200));
    const reads = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "audit.read"),
          eq(schema.auditLogTable.workspaceId, workspace.id),
        ),
      );
    expect(reads.length).toBeGreaterThanOrEqual(1);
  });

  it("a member without workspace:manage_settings is refused", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(user);
    const { app } = createApp();

    const response = await app.request(`/api/workspaces/${workspace.id}/audit`);
    expect(response.status).toBe(403);
  });

  it("a non-member is refused by the membership gate", async () => {
    const { workspace } = await createWorkspaceMember({ role: "owner" });
    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const response = await app.request(`/api/workspaces/${workspace.id}/audit`);
    expect(response.status).toBe(403);
  });
});
