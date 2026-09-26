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
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

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

describe("GET /api/workspaces/{workspaceId}/audit — project reach (#344, AU-10)", () => {
  async function seedProjectScopedRow(
    workspaceId: string,
    projectId: string | null,
    action: string,
  ) {
    return appendAuditLog(db, {
      actorId: null,
      actorType: "system",
      workspaceId,
      projectId,
      action,
      entityType: "work_item",
      entityId: `wi-${randomUUID()}`,
    });
  }

  async function addPersonForUser(userId: string): Promise<string> {
    const organisation = await ensureInternalOrganisation();
    const now = new Date();
    const person = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          userId,
          organisationId: organisation.id,
          side: "staff",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "addPersonForUser",
    );
    return person.id;
  }

  async function addMembership(
    personId: string,
    scope: "workspace" | "project",
    scopeId: string,
    seesAll = false,
  ) {
    const now = new Date();
    const role = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope,
          key: `role-${randomUUID()}`,
          name: "Audit Test Role",
          rank: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "addMembership: role",
    );
    await db.insert(schema.membershipTable).values({
      personId,
      scope,
      scopeId,
      roleId: role.id,
      seesAll,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function readActions(user: unknown, workspaceId: string) {
    mockAuthenticatedSession(user as never);
    const { app } = createApp();
    const response = await app.request(`/api/workspaces/${workspaceId}/audit`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rows: { action: string }[];
    };
    return body.rows.map((row) => row.action);
  }

  it("a manager sees non-project rows and their own projects' rows — never a project they have no membership on", async () => {
    const manager = await createWorkspaceMember({ role: "admin" });
    const { project: reachable } = await createProjectFixture({
      workspaceId: manager.workspace.id,
    });
    const { project: unreachable } = await createProjectFixture({
      workspaceId: manager.workspace.id,
    });
    const personId = await addPersonForUser(manager.user.id);
    await addMembership(personId, "project", reachable.id);

    await seedProjectScopedRow(manager.workspace.id, null, "auth.sign_out");
    await seedProjectScopedRow(
      manager.workspace.id,
      reachable.id,
      "plugin.changed",
    );
    await seedProjectScopedRow(
      manager.workspace.id,
      unreachable.id,
      "plugin.tested",
    );

    const actions = await readActions(manager.user, manager.workspace.id);
    expect(actions).toContain("auth.sign_out");
    expect(actions).toContain("plugin.changed");
    // The rows of the project outside their reach are invisible even though the caller
    // holds `workspace:manage_settings` (Thomas, 2026-09-23: "restrict audit reads to
    // owner, admin or sees_all" was the REJECTED alternative).
    expect(actions).not.toContain("plugin.tested");
  });

  it("the per-workspace sees_all grant lifts the filter for THIS workspace (#319/#334)", async () => {
    const manager = await createWorkspaceMember({ role: "admin" });
    const { project: unreachable } = await createProjectFixture({
      workspaceId: manager.workspace.id,
    });
    const personId = await addPersonForUser(manager.user.id);
    // No project membership at all -- only the workspace-scoped sees_all grant.
    await addMembership(personId, "workspace", manager.workspace.id, true);

    await seedProjectScopedRow(
      manager.workspace.id,
      unreachable.id,
      "plugin.tested",
    );

    const actions = await readActions(manager.user, manager.workspace.id);
    expect(actions).toContain("plugin.tested");
  });

  it("a manager with no person row and no sees_all sees only non-project rows (fail-closed)", async () => {
    const manager = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: manager.workspace.id,
    });

    await seedProjectScopedRow(manager.workspace.id, null, "auth.sign_out");
    await seedProjectScopedRow(
      manager.workspace.id,
      project.id,
      "plugin.changed",
    );

    const actions = await readActions(manager.user, manager.workspace.id);
    expect(actions).toEqual(["auth.sign_out"]);
  });
});
