/**
 * Decision log 2026-10-13 "Recovered record: Bind customer-serving projects at creation"
 * (issue #701): `project.organisation_id` is chosen at project creation -- an active
 * customer organisation only -- and no general update can rebind it. An intake submission
 * can then be accepted into the freshly bound project without touching the database.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { acceptSubmission } from "../../apps/api/src/intake/repository";
import { purgeSoftDeletedProject } from "../../apps/api/src/scheduler/soft-delete-purge";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  grantProjectManageAccess,
  createWorkspaceMember as makeWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { projectKey } from "./helpers/project-key";

type ProjectRow = typeof schema.projectTable.$inferSelect;

// Most existing binding cases exercise a first link and therefore need an instance admin.
async function createWorkspaceMember(
  options: Parameters<typeof makeWorkspaceMember>[0],
) {
  const member = await makeWorkspaceMember(options);
  if (options?.role === "admin") {
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, member.user.id));
  }
  return member;
}

async function makeOrganisation(
  overrides: Partial<typeof schema.organisationTable.$inferInsert> = {},
) {
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({
        key: `customer-${randomUUID()}`,
        name: "Customer",
        ...overrides,
      })
      .returning(),
    "organisation",
  );
}

async function createProjectRequest(
  workspaceId: string,
  body: Record<string, unknown> = {},
) {
  const { app } = createApp();
  return app.request("/api/project", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId,
      name: "Customer support",
      icon: "Folder",
      slug: projectKey(),
      ...body,
    }),
  });
}

async function projectOrganisation(projectId: string) {
  const row = await db.query.projectTable.findFirst({
    where: eq(schema.projectTable.id, projectId),
  });
  return row?.organisationId;
}

async function waitForBlockedConnections(
  observer: Client,
  blockerPid: number,
  expected: number,
) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    await observer.query("SELECT pg_stat_clear_snapshot()");
    const result = await observer.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
       AND $1 = ANY (pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (Number(result.rows[0]?.count) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Expected ${expected} database connections waiting on test blocker`,
  );
}

describe("API integration: project customer-organisation binding", () => {
  beforeEach(async () => resetTestDatabase());

  it("limits managers to served customers and audits an instance admin's first link", async () => {
    const caller = await createWorkspaceMember({
      role: "manager",
      seedDefaultRoleRow: false,
    });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: caller.workspace.id,
      role: "manager",
      permission: JSON.stringify({ project: ["create", "read"] }),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, caller.user.id));
    const served = await makeOrganisation({ name: "Served" });
    const other = await makeOrganisation({ name: "Other" });
    mockAuthenticatedSession(caller.user);
    const first = await createProjectRequest(caller.workspace.id, {
      organisationId: served.id,
    });
    expect(first.status, await first.clone().text()).toBe(200);
    const audits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        eq(schema.auditLogTable.action, "project.customer_organisation_linked"),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      workspaceId: caller.workspace.id,
      organisationId: served.id,
      actorType: "person",
    });
    const actor = await db.query.personTable.findFirst({
      where: eq(schema.personTable.userId, caller.user.id),
    });
    expect(audits[0]?.actorId).toBe(actor?.id);
    const { app } = createApp();
    const adminList = await app.request(
      `/api/project/organisations?workspaceId=${caller.workspace.id}`,
    );
    expect(
      ((await adminList.json()) as { id: string }[])
        .map((row) => row.id)
        .sort(),
    ).toEqual([served.id, other.id].sort());
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, caller.user.id));
    const list = await app.request(
      `/api/project/organisations?workspaceId=${caller.workspace.id}`,
    );
    expect(list.status).toBe(200);
    expect(
      ((await list.json()) as { id: string }[]).map((row) => row.id),
    ).toEqual([served.id]);
    const refused = await createProjectRequest(caller.workspace.id, {
      organisationId: other.id,
    });
    expect(refused.status).toBe(403);
    expect(await refused.text()).toContain(
      "instance_admin_required_for_new_customer_organisation",
    );
    const allowed = await createProjectRequest(caller.workspace.id, {
      organisationId: served.id,
    });
    expect(allowed.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.auditLogTable)
        .where(
          eq(
            schema.auditLogTable.action,
            "project.customer_organisation_linked",
          ),
        ),
    ).toHaveLength(1);
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(),
        purgeAfter: new Date(Date.now() + 86400000),
      })
      .where(eq(schema.projectTable.organisationId, served.id));
    const afterDeletion = await app.request(
      `/api/project/organisations?workspaceId=${caller.workspace.id}`,
    );
    expect(
      ((await afterDeletion.json()) as { id: string }[]).map((row) => row.id),
    ).toEqual([served.id]);
    // A manager can still create against the recoverable project.
    expect(
      (
        await createProjectRequest(caller.workspace.id, {
          organisationId: served.id,
        })
      ).status,
    ).toBe(200);
    // Expire and purge every project, including the one just created by the manager.
    const rows = await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(Date.now() - 86400000),
        purgeAfter: new Date(Date.now() - 1000),
      })
      .where(eq(schema.projectTable.organisationId, served.id))
      .returning({ id: schema.projectTable.id });
    for (const row of rows)
      expect((await purgeSoftDeletedProject(row.id)).result).toBe("purged");
    const afterPurge = await app.request(
      `/api/project/organisations?workspaceId=${caller.workspace.id}`,
    );
    expect(await afterPurge.json()).toEqual([]);
    expect(
      (
        await createProjectRequest(caller.workspace.id, {
          organisationId: served.id,
        })
      ).status,
    ).toBe(403);
  });

  it("does not reveal whether an unserved organisation ID exists", async () => {
    const caller = await createWorkspaceMember({
      role: "manager",
      seedDefaultRoleRow: false,
    });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: caller.workspace.id,
      role: "manager",
      permission: JSON.stringify({ project: ["create", "read"] }),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    const existing = await makeOrganisation();
    const inactive = await makeOrganisation({ active: false });
    const deleted = await makeOrganisation({ deletedAt: new Date() });
    const internal = requireRow(
      await db
        .select()
        .from(schema.organisationTable)
        .where(eq(schema.organisationTable.isInternal, true)),
      "internal organisation",
    );
    mockAuthenticatedSession(caller.user);
    const responses = await Promise.all(
      [
        existing.id,
        inactive.id,
        deleted.id,
        internal.id,
        `missing-${randomUUID()}`,
      ].map((organisationId) =>
        createProjectRequest(caller.workspace.id, { organisationId }),
      ),
    );
    const bodies = await Promise.all(
      responses.map((response) => response.text()),
    );
    expect(responses.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403,
    ]);
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).toContain(
      "instance_admin_required_for_new_customer_organisation",
    );
  });

  it("serializes concurrent first links and writes one link audit", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();
    mockAuthenticatedSession(admin.user);
    const blocker = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await blocker.connect();
    await observer.connect();
    let open = false;
    try {
      await blocker.query("BEGIN");
      open = true;
      await blocker.query("SELECT pg_advisory_xact_lock(1524, hashtext($1))", [
        admin.workspace.id,
      ]);
      const pid = Number(
        (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      );
      const requests = [
        createProjectRequest(admin.workspace.id, {
          organisationId: organisation.id,
        }),
        createProjectRequest(admin.workspace.id, {
          organisationId: organisation.id,
        }),
      ];
      await waitForBlockedConnections(observer, pid, 2);
      await blocker.query("COMMIT");
      open = false;
      const results = await Promise.all(requests);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      const audit = await db
        .select()
        .from(schema.auditLogTable)
        .where(
          eq(
            schema.auditLogTable.action,
            "project.customer_organisation_linked",
          ),
        );
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        workspaceId: admin.workspace.id,
        organisationId: organisation.id,
      });
    } finally {
      if (open) await blocker.query("ROLLBACK");
      await blocker.end();
      await observer.end();
    }
  });

  it("refuses an ordinary create racing the permanent deletion of its last serving project", async () => {
    const caller = await createWorkspaceMember({
      role: "manager",
      seedDefaultRoleRow: false,
    });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: caller.workspace.id,
      role: "manager",
      permission: JSON.stringify({ project: ["create", "read"] }),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    const organisation = await makeOrganisation();
    const project = requireRow(
      await db
        .insert(schema.projectTable)
        .values({
          workspaceId: caller.workspace.id,
          organisationId: organisation.id,
          name: "Existing",
          slug: projectKey(),
        })
        .returning(),
      "existing project",
    );
    mockAuthenticatedSession(caller.user);
    const writer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await writer.connect();
    await observer.connect();
    let open = false;
    try {
      await writer.query("BEGIN");
      open = true;
      await writer.query('DELETE FROM "project" WHERE id = $1', [project.id]);
      const pid = Number(
        (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      );
      const request = createProjectRequest(caller.workspace.id, {
        organisationId: organisation.id,
      });
      await waitForBlockedConnections(observer, pid, 1);
      await writer.query("COMMIT");
      open = false;
      const response = await request;
      expect(response.status).toBe(403);
      expect(await response.text()).toContain(
        "instance_admin_required_for_new_customer_organisation",
      );
      expect(
        await db
          .select()
          .from(schema.projectTable)
          .where(eq(schema.projectTable.workspaceId, caller.workspace.id)),
      ).toHaveLength(0);
    } finally {
      if (open) await writer.query("ROLLBACK");
      await writer.end();
      await observer.end();
    }
  });

  it("rolls back project creation when the first-link audit insert fails", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();
    mockAuthenticatedSession(admin.user);
    const tables = [
      schema.projectTable,
      schema.projectSlugClaimTable,
      schema.columnTable,
      schema.stateTable,
      schema.membershipTable,
      schema.membershipGrantTable,
      schema.auditLogTable,
      schema.outboxTable,
    ] as const;
    const counts = async () =>
      Promise.all(
        tables.map(async (table) => (await db.select().from(table)).length),
      );
    const before = await counts();
    await db.execute(
      sql.raw(
        `CREATE FUNCTION td_test_fail_customer_link_audit() RETURNS trigger AS $$ BEGIN IF NEW.action = 'project.customer_organisation_linked' THEN RAISE EXCEPTION 'injected link audit failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
      ),
    );
    try {
      await db.execute(
        sql.raw(
          "CREATE TRIGGER td_test_fail_customer_link_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION td_test_fail_customer_link_audit()",
        ),
      );
      const response = await createProjectRequest(admin.workspace.id, {
        organisationId: organisation.id,
      });
      expect(response.status).toBe(500);
      expect(await counts()).toEqual(before);
    } finally {
      await db.execute(
        sql.raw(
          "DROP TRIGGER IF EXISTS td_test_fail_customer_link_audit ON audit_log",
        ),
      );
      await db.execute(
        sql.raw("DROP FUNCTION IF EXISTS td_test_fail_customer_link_audit()"),
      );
    }
  });

  it("does not let an impersonated instance admin extend workspace reach", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();
    mockAuthenticatedSession(admin.user, { impersonatedBy: "other-admin" });
    const response = await createProjectRequest(admin.workspace.id, {
      organisationId: organisation.id,
    });
    expect(response.status).toBe(403);
  });

  it("binds a new project to an active customer organisation", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();
    mockAuthenticatedSession(admin.user);

    const response = await createProjectRequest(admin.workspace.id, {
      organisationId: organisation.id,
    });
    expect(response.status).toBe(200);
    const created = (await response.json()) as ProjectRow;
    expect(created.organisationId).toBe(organisation.id);
    await expect(projectOrganisation(created.id)).resolves.toBe(
      organisation.id,
    );
  });

  it("copies workspace-local organisation defaults once and preserves an explicit calendar override", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();
    mockAuthenticatedSession(admin.user);
    const calendars = await db
      .insert(schema.serviceCalendarTable)
      .values(
        ["Original", "Replacement"].map((name) => ({
          workspaceId: admin.workspace.id,
          name,
          timezone: "UTC",
          windows: {},
          holidays: [],
        })),
      )
      .returning();
    const policies = await db
      .insert(schema.slaPolicyTable)
      .values(
        ["Original", "Replacement"].map((name) => ({
          workspaceId: admin.workspace.id,
          name,
        })),
      )
      .returning();
    const firstCalendar = requireRow(
      calendars.slice(0, 1),
      "original calendar",
    );
    const nextCalendar = requireRow(calendars.slice(1), "replacement calendar");
    const firstPolicy = requireRow(policies.slice(0, 1), "original policy");
    const nextPolicy = requireRow(policies.slice(1), "replacement policy");
    await db.insert(schema.organisationProjectDefaultTable).values({
      organisationId: organisation.id,
      workspaceId: admin.workspace.id,
      serviceCalendarId: firstCalendar.id,
      slaPolicyId: firstPolicy.id,
    });
    const initialResponse = await createProjectRequest(admin.workspace.id, {
      organisationId: organisation.id,
      kind: "managed_service",
      supportLevel: "L1",
    });
    expect(initialResponse.status, await initialResponse.clone().text()).toBe(
      200,
    );
    const initial = (await initialResponse.json()) as ProjectRow;
    expect(initial.serviceCalendarId).toBe(firstCalendar.id);
    expect(initial.slaPolicyId).toBe(firstPolicy.id);

    const explicitResponse = await createProjectRequest(admin.workspace.id, {
      organisationId: organisation.id,
      serviceCalendarId: null,
    });
    expect(explicitResponse.status).toBe(200);
    expect(
      ((await explicitResponse.json()) as ProjectRow).serviceCalendarId,
    ).toBeNull();
    await db
      .update(schema.organisationProjectDefaultTable)
      .set({
        serviceCalendarId: nextCalendar.id,
        slaPolicyId: nextPolicy.id,
      })
      .where(
        and(
          eq(
            schema.organisationProjectDefaultTable.organisationId,
            organisation.id,
          ),
          eq(
            schema.organisationProjectDefaultTable.workspaceId,
            admin.workspace.id,
          ),
        ),
      );
    const nextResponse = await createProjectRequest(admin.workspace.id, {
      organisationId: organisation.id,
    });
    expect(nextResponse.status).toBe(200);
    const next = (await nextResponse.json()) as ProjectRow;
    expect(next.serviceCalendarId).toBe(nextCalendar.id);
    expect(next.slaPolicyId).toBe(nextPolicy.id);
    const stored = await db.query.projectTable.findFirst({
      where: eq(schema.projectTable.id, initial.id),
    });
    expect(stored?.serviceCalendarId).toBe(firstCalendar.id);
    expect(stored?.slaPolicyId).toBe(firstPolicy.id);
    const internalResponse = await createProjectRequest(admin.workspace.id);
    expect(internalResponse.status).toBe(200);
    const internal = (await internalResponse.json()) as ProjectRow;
    expect(internal.serviceCalendarId).toBeNull();
    expect(internal.slaPolicyId).toBeNull();
  });

  it("lists the calendar each organisation inherits, and create agrees: chosen calendar succeeds, none fails PR-9 (decision 4 Nov 2026)", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const withCalendar = await makeOrganisation({ name: "A with calendar" });
    const slaOnly = await makeOrganisation({ name: "B SLA only" });
    const noDefaults = await makeOrganisation({ name: "C no defaults" });
    mockAuthenticatedSession(admin.user);
    const calendars = await db
      .insert(schema.serviceCalendarTable)
      .values(
        ["Organisation hours", "Workspace hours"].map((name) => ({
          workspaceId: admin.workspace.id,
          name,
          timezone: "UTC",
          windows: {},
          holidays: [],
        })),
      )
      .returning();
    const organisationCalendar = requireRow(
      calendars.slice(0, 1),
      "organisation calendar",
    );
    const workspaceCalendar = requireRow(
      calendars.slice(1),
      "workspace calendar",
    );
    const policy = requireRow(
      await db
        .insert(schema.slaPolicyTable)
        .values({ workspaceId: admin.workspace.id, name: "Policy" })
        .returning(),
      "policy",
    );
    await db.insert(schema.organisationProjectDefaultTable).values([
      {
        organisationId: withCalendar.id,
        workspaceId: admin.workspace.id,
        serviceCalendarId: organisationCalendar.id,
        slaPolicyId: null,
      },
      {
        organisationId: slaOnly.id,
        workspaceId: admin.workspace.id,
        serviceCalendarId: null,
        slaPolicyId: policy.id,
      },
    ]);
    const { app } = createApp();
    const listInherited = async () => {
      const response = await app.request(
        `/api/project/organisations?workspaceId=${admin.workspace.id}`,
      );
      expect(response.status).toBe(200);
      const rows = (await response.json()) as {
        id: string;
        inheritedServiceCalendarId: string | null;
      }[];
      return Object.fromEntries(
        rows.map((row) => [row.id, row.inheritedServiceCalendarId]),
      );
    };
    const managed = (organisationId: string, body = {}) =>
      createProjectRequest(admin.workspace.id, {
        organisationId,
        kind: "managed_service",
        supportLevel: "L2",
        ...body,
      });

    // No workspace default: only the organisation with its own calendar resolves.
    await expect(listInherited()).resolves.toEqual({
      [withCalendar.id]: organisationCalendar.id,
      [slaOnly.id]: null,
      [noDefaults.id]: null,
    });
    const inherits = await managed(withCalendar.id);
    expect(inherits.status, await inherits.clone().text()).toBe(200);
    for (const organisation of [slaOnly, noDefaults]) {
      const refused = await managed(organisation.id);
      expect(refused.status).toBe(422);
      await expect(refused.text()).resolves.toContain("PR-9");
      // The dialog's chosen calendar makes the same create succeed.
      const chosen = await managed(organisation.id, {
        serviceCalendarId: workspaceCalendar.id,
      });
      expect(chosen.status, await chosen.clone().text()).toBe(200);
      expect(((await chosen.json()) as ProjectRow).serviceCalendarId).toBe(
        workspaceCalendar.id,
      );
    }

    // A workspace default applies only where no organisation default row exists: the
    // SLA-only row still resolves no calendar, exactly as the create check does.
    await db
      .update(schema.workspaceTable)
      .set({ defaultServiceCalendarId: workspaceCalendar.id })
      .where(eq(schema.workspaceTable.id, admin.workspace.id));
    await expect(listInherited()).resolves.toEqual({
      [withCalendar.id]: organisationCalendar.id,
      [slaOnly.id]: null,
      [noDefaults.id]: workspaceCalendar.id,
    });
    expect((await managed(noDefaults.id)).status).toBe(200);
    const stillRefused = await managed(slaOnly.id);
    expect(stillRefused.status).toBe(422);
    await expect(stillRefused.text()).resolves.toContain("PR-9");
  });

  it("leaves a project internal (null) when no organisation is supplied or null is", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(admin.user);

    const omitted = (await (
      await createProjectRequest(admin.workspace.id)
    ).json()) as ProjectRow;
    const explicitNull = (await (
      await createProjectRequest(admin.workspace.id, { organisationId: null })
    ).json()) as ProjectRow;
    expect(omitted.organisationId).toBeNull();
    expect(explicitNull.organisationId).toBeNull();
  });

  it.each([
    ["an unknown organisation id", async () => `missing-${randomUUID()}`],
    [
      "an inactive organisation",
      async () => (await makeOrganisation({ active: false })).id,
    ],
    [
      "a soft-deleted organisation",
      async () => (await makeOrganisation({ deletedAt: new Date() })).id,
    ],
    [
      "the internal organisation",
      async () => {
        const [internal] = await db
          .select()
          .from(schema.organisationTable)
          .where(eq(schema.organisationTable.isInternal, true));
        return requireRow([internal], "internal organisation").id;
      },
    ],
  ])("refuses %s with one 422 and creates nothing", async (_label, pick) => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisationId = await pick();
    mockAuthenticatedSession(admin.user);
    const before = await db.select().from(schema.projectTable);

    const response = await createProjectRequest(admin.workspace.id, {
      organisationId,
    });
    expect(response.status).toBe(422);
    await expect(response.text()).resolves.toContain(
      "organisation_must_be_an_active_customer_organisation",
    );
    const after = await db.select().from(schema.projectTable);
    expect(after).toHaveLength(before.length);
    const claims = await db.select().from(schema.projectSlugClaimTable);
    expect(claims).toHaveLength(before.length);
  });

  it("refuses a workspace that does not belong to the internal organisation (fail closed)", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const foreign = await makeOrganisation({ name: "Foreign tenant" });
    const target = await makeOrganisation({ name: "Target" });
    await db
      .update(schema.workspaceTable)
      .set({ organisationId: foreign.id })
      .where(eq(schema.workspaceTable.id, admin.workspace.id));
    mockAuthenticatedSession(admin.user);

    const response = await createProjectRequest(admin.workspace.id, {
      organisationId: target.id,
    });
    expect(response.status).toBe(422);
  });

  it("refuses a caller without project:create, and never reaches another workspace", async () => {
    const viewer = await createWorkspaceMember({ role: "viewer" });
    const other = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();

    mockAuthenticatedSession(viewer.user);
    const forbidden = await createProjectRequest(viewer.workspace.id, {
      organisationId: organisation.id,
    });
    expect(forbidden.status).toBe(403);

    // The caller names a workspace they are not a member of.
    const crossWorkspace = await createProjectRequest(other.workspace.id, {
      organisationId: organisation.id,
    });
    expect([400, 403, 404]).toContain(crossWorkspace.status);
    await expect(db.select().from(schema.projectTable)).resolves.toHaveLength(
      0,
    );
  });

  // The legacy better-auth statements give `member` (and, for these seeded rows, `lead`)
  // `project:create`; the permission matrix (rbac.md) grants it to owner/admin/manager only.
  // Both the customer-organisation list and an organisation binding follow the matrix.
  describe("strict project:create capability", () => {
    async function memberWithRole(role: string) {
      const member = await createWorkspaceMember({
        role,
        seedDefaultRoleRow: false,
      });
      const now = new Date();
      await db.insert(schema.workspaceRoleTable).values({
        workspaceId: member.workspace.id,
        role,
        permission: JSON.stringify({ project: ["create", "read"] }),
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      });
      await db
        .update(schema.userTable)
        .set({ role: "user" })
        .where(eq(schema.userTable.id, member.user.id));
      return member;
    }

    it.each(["member", "lead", "viewer"])(
      "%s is refused (403) on the list and on create with an organisationId",
      async (role) => {
        const caller = await memberWithRole(role);
        const organisation = await makeOrganisation({ name: "SecretCo" });
        mockAuthenticatedSession(caller.user);
        const { app } = createApp();

        const list = await app.request(
          `/api/project/organisations?workspaceId=${caller.workspace.id}`,
        );
        expect(list.status).toBe(403);
        expect(await list.text()).not.toContain("SecretCo");

        const bound = await createProjectRequest(caller.workspace.id, {
          organisationId: organisation.id,
        });
        expect(bound.status).toBe(403);
        // Refused before any organisation lookup: an unknown id gets the same answer.
        const unknown = await createProjectRequest(caller.workspace.id, {
          organisationId: `missing-${randomUUID()}`,
        });
        expect(unknown.status).toBe(403);
        await expect(
          db.select().from(schema.projectTable),
        ).resolves.toHaveLength(0);
      },
    );

    it.each(["owner", "admin", "manager"])(
      "%s can list organisations and bind a project",
      async (role) => {
        const caller = await memberWithRole(role);
        const organisation = await makeOrganisation();
        mockAuthenticatedSession(caller.user);
        const { app } = createApp();

        const list = await app.request(
          `/api/project/organisations?workspaceId=${caller.workspace.id}`,
        );
        expect(list.status).toBe(200);
        await db
          .update(schema.userTable)
          .set({ role: "admin" })
          .where(eq(schema.userTable.id, caller.user.id));
        const first = await createProjectRequest(caller.workspace.id, {
          organisationId: organisation.id,
        });
        expect(first.status).toBe(200);
        await db
          .update(schema.userTable)
          .set({ role: "user" })
          .where(eq(schema.userTable.id, caller.user.id));
        const bound = await createProjectRequest(caller.workspace.id, {
          organisationId: organisation.id,
        });
        expect(bound.status).toBe(200);
        expect(((await bound.json()) as ProjectRow).organisationId).toBe(
          organisation.id,
        );
      },
    );

    it.each(["member", "lead", "viewer"])(
      "refuses %s (403) on creating an internal project (no organisationId) (#708)",
      async (role) => {
        const caller = await memberWithRole(role);
        mockAuthenticatedSession(caller.user);
        const omitted = await createProjectRequest(caller.workspace.id);
        expect(omitted.status).toBe(403);
        const explicitNull = await createProjectRequest(caller.workspace.id, {
          organisationId: null,
        });
        expect(explicitNull.status).toBe(403);
        await expect(
          db.select().from(schema.projectTable),
        ).resolves.toHaveLength(0);
      },
    );

    it("refuses a customer-side person (403) on organisation list and project creation even if a workspace_member row exists (#708)", async () => {
      const caller = await memberWithRole("admin");
      await db
        .update(schema.personTable)
        .set({ side: "customer" })
        .where(eq(schema.personTable.userId, caller.user.id));
      mockAuthenticatedSession(caller.user);
      const { app } = createApp();

      const list = await app.request(
        `/api/project/organisations?workspaceId=${caller.workspace.id}`,
      );
      expect(list.status).toBe(403);

      const created = await createProjectRequest(caller.workspace.id);
      expect(created.status).toBe(403);
    });
  });

  it("serializes a concurrent organisation deactivation against the create (FOR SHARE)", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const organisation = await makeOrganisation();
    mockAuthenticatedSession(admin.user);
    const writer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await writer.connect();
    await observer.connect();
    let open = false;
    try {
      // An uncommitted deactivation holds the organisation row.
      await writer.query("BEGIN");
      open = true;
      await writer.query(
        "UPDATE organisation SET active = false WHERE id = $1",
        [organisation.id],
      );
      const writerPid = Number(
        (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
      );

      const create = createProjectRequest(admin.workspace.id, {
        organisationId: organisation.id,
      });

      // Deterministic: poll until a backend is lock-waiting on the writer for the
      // organisation `FOR SHARE` select, instead of sleeping.
      let blocked = false;
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline && !blocked) {
        await observer.query("SELECT pg_stat_clear_snapshot()");
        const result = await observer.query<{ waiting: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity a
             WHERE a.datname = current_database()
               AND a.wait_event_type = 'Lock'
               AND a.query ILIKE '%from "organisation"%'
               AND a.query ILIKE '%for share%'
               AND $1 = ANY (pg_blocking_pids(a.pid))
           ) AS waiting`,
          [writerPid],
        );
        blocked = result.rows[0]?.waiting === true;
        if (!blocked) await new Promise((r) => setTimeout(r, 25));
      }
      expect(blocked).toBe(true);

      await writer.query("COMMIT");
      open = false;
      // After the deactivation commits, the create sees it and is refused.
      const response = await create;
      expect(response.status).toBe(422);
      await expect(db.select().from(schema.projectTable)).resolves.toHaveLength(
        0,
      );
    } finally {
      if (open) await writer.query("ROLLBACK").catch(() => undefined);
      await writer.end();
      await observer.end();
    }
  });

  it("cannot rebind a project through the general update route", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const first = await makeOrganisation({ name: "First" });
    const second = await makeOrganisation({ name: "Second" });
    mockAuthenticatedSession(admin.user);
    const created = (await (
      await createProjectRequest(admin.workspace.id, {
        organisationId: first.id,
      })
    ).json()) as ProjectRow;
    // Creating a project grants the creator no project membership; updating it needs the
    // project-level capability (#720).
    await grantProjectManageAccess(admin.user.id, created.id);
    const { app } = createApp();

    for (const organisationId of [second.id, null]) {
      const update = await app.request(`/api/project/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Renamed",
          icon: "Folder",
          slug: created.slug,
          description: "d",
          organisationId,
        }),
      });
      expect(update.status).toBe(200);
      const body = (await update.json()) as ProjectRow;
      expect(body.name).toBe("Renamed");
      expect(body.organisationId).toBe(first.id);
      await expect(projectOrganisation(created.id)).resolves.toBe(first.id);
    }
  });

  it("lists only active, live customer organisations for a project creator", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const viewer = await createWorkspaceMember({ role: "viewer" });
    await makeOrganisation({ name: "Beta" });
    await makeOrganisation({ name: "Alpha" });
    await makeOrganisation({ name: "Inactive", active: false });
    await makeOrganisation({ name: "Deleted", deletedAt: new Date() });
    const { app } = createApp();

    mockAuthenticatedSession(admin.user);
    const ok = await app.request(
      `/api/project/organisations?workspaceId=${admin.workspace.id}`,
    );
    expect(ok.status).toBe(200);
    const rows = (await ok.json()) as { id: string; name: string }[];
    expect(rows.map((row) => row.name)).toEqual(["Alpha", "Beta"]);
    // Only what the create dialog needs: no profile, quota or other default fields.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "id",
      "inheritedServiceCalendarId",
      "name",
    ]);

    mockAuthenticatedSession(viewer.user);
    const denied = await app.request(
      `/api/project/organisations?workspaceId=${viewer.workspace.id}`,
    );
    expect(denied.status).toBe(403);
  });

  it("lets intake accept a submission into a project bound at creation", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const staff = requireRow(
      await db
        .select()
        .from(schema.personTable)
        .where(
          and(
            eq(schema.personTable.userId, admin.user.id),
            eq(schema.personTable.side, "staff"),
          ),
        ),
      "staff actor",
    );
    const organisation = await makeOrganisation();
    const requester = requireRow(
      await db
        .insert(schema.personTable)
        .values({
          organisationId: organisation.id,
          side: "customer",
          displayName: "Requester",
        })
        .returning(),
      "requester",
    );
    mockAuthenticatedSession(admin.user);
    const bound = (await (
      await createProjectRequest(admin.workspace.id, {
        organisationId: organisation.id,
      })
    ).json()) as ProjectRow;
    const unbound = (await (
      await createProjectRequest(admin.workspace.id)
    ).json()) as ProjectRow;

    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: admin.workspace.id,
          key: `type-${randomUUID()}`,
          name: "Task",
          category: "delivery",
        })
        .returning(),
      "work-item type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: admin.workspace.id,
          key: `state-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
        })
        .returning(),
      "state template",
    );
    for (const project of [bound, unbound]) {
      await db.insert(schema.stateTable).values({
        projectId: project.id,
        stateTemplateId: template.id,
        isDefault: true,
      });
    }
    const formSchema = {
      fields: [
        {
          key: "title",
          type: "text" as const,
          label: "Title",
          required: true,
          mapsTo: { field: "title" as const },
        },
      ],
    };
    const requestType = requireRow(
      await db
        .insert(schema.requestTypeTable)
        .values({
          workspaceId: admin.workspace.id,
          key: `req-${randomUUID()}`,
          name: "Help",
          group: "General",
          workItemTypeId: type.id,
          defaultProjectId: bound.id,
          formSchema,
        })
        .returning(),
      "request type",
    );
    const version = requireRow(
      await db
        .insert(schema.requestTypeVersionTable)
        .values({
          workspaceId: admin.workspace.id,
          requestTypeId: requestType.id,
          number: 1,
          formSchema,
          workItemTypeId: type.id,
          defaultProjectId: bound.id,
        })
        .returning(),
      "request type version",
    );
    const makeSubmission = async () =>
      requireRow(
        await db
          .insert(schema.submissionTable)
          .values({
            organisationId: organisation.id,
            requesterId: requester.id,
            requestTypeId: requestType.id,
            requestTypeVersionId: version.id,
            formData: { title: "Printer is broken" },
            state: "new",
            submittedAt: new Date(),
          })
          .returning(),
        "submission",
      );

    const refused = await makeSubmission();
    await expect(
      acceptSubmission(
        `SUB-${refused.number}`,
        admin.workspace.id,
        staff.id,
        unbound.id,
        type.id,
        async () => true,
      ),
    ).rejects.toMatchObject({ status: expect.any(Number) });

    const accepted = await makeSubmission();
    const converted = await acceptSubmission(
      `SUB-${accepted.number}`,
      admin.workspace.id,
      staff.id,
      bound.id,
      type.id,
      async () => true,
    );
    expect(converted.workItem.projectId).toBe(bound.id);
  });
});
