/**
 * Decision log 2026-10-13 "Recovered record: Bind customer-serving projects at creation"
 * (issue #701): `project.organisation_id` is chosen at project creation -- an active
 * customer organisation only -- and no general update can rebind it. An intake submission
 * can then be accepted into the freshly bound project without touching the database.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { acceptSubmission } from "../../apps/api/src/intake/repository";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

type ProjectRow = typeof schema.projectTable.$inferSelect;

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
      slug: `cs-${randomUUID().slice(0, 6)}`,
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

describe("API integration: project customer-organisation binding", () => {
  beforeEach(async () => resetTestDatabase());

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
        const bound = await createProjectRequest(caller.workspace.id, {
          organisationId: organisation.id,
        });
        expect(bound.status).toBe(200);
        expect(((await bound.json()) as ProjectRow).organisationId).toBe(
          organisation.id,
        );
      },
    );

    it("still lets a member create an internal project (no organisationId), as before", async () => {
      const member = await memberWithRole("member");
      mockAuthenticatedSession(member.user);
      const omitted = await createProjectRequest(member.workspace.id);
      expect(omitted.status).toBe(200);
      expect(((await omitted.json()) as ProjectRow).organisationId).toBeNull();
      const explicitNull = await createProjectRequest(member.workspace.id, {
        organisationId: null,
      });
      expect(explicitNull.status).toBe(200);
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
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(["id", "name"]);

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
      ),
    ).rejects.toMatchObject({ status: expect.any(Number) });

    const accepted = await makeSubmission();
    const converted = await acceptSubmission(
      `SUB-${accepted.number}`,
      admin.workspace.id,
      staff.id,
      bound.id,
      type.id,
    );
    expect(converted.workItem.projectId).toBe(bound.id);
  });
});
