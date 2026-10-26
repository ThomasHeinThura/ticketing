import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { ensureStaffPersonForUser } from "../../apps/api/src/utils/seed-internal-organisation";
import { withConfiguredAgentAuthority } from "./helpers/agent-authority";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";
import { makeApiKey } from "./helpers/reach-world";

function request(
  app: ReturnType<typeof createApp>["app"],
  path: string,
  init?: RequestInit,
) {
  const r = withConfiguredAgentAuthority(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  return app.request(r.input, r.init);
}

async function seedAdmin() {
  const member = await createWorkspaceMember({ userName: "Catalogue Admin" });
  await db
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, member.user.id));
  await ensureStaffPersonForUser(member.user.id);
  mockAuthenticatedSession({ ...member.user, role: "admin" });
  return member;
}

async function addOrganisation(id: string, key: string, active = true) {
  return requireRow(
    await db
      .insert(schema.organisationTable)
      .values({ id, key, name: `Customer ${key}`, active })
      .returning(),
    "customer organisation",
  );
}

async function makeRequestType(input: {
  workspaceId: string;
  key: string;
  workItemTypeId: string;
  published?: boolean;
  customerVisible?: boolean;
  autoAccept?: boolean;
  defaultProjectId?: string | null;
}) {
  const type = requireRow(
    await db
      .insert(schema.requestTypeTable)
      .values({
        workspaceId: input.workspaceId,
        key: input.key,
        name: input.key,
        group: "Support",
        workItemTypeId: input.workItemTypeId,
        formSchema: { fields: [] },
        published: input.published ?? true,
        customerVisible: input.customerVisible ?? true,
        defaultProjectId: input.defaultProjectId ?? null,
      })
      .returning(),
    "request type",
  );
  await db.insert(schema.requestTypeVersionTable).values({
    workspaceId: input.workspaceId,
    requestTypeId: type.id,
    number: 1,
    formSchema: { fields: [] },
    workItemTypeId: input.workItemTypeId,
    autoAccept: input.autoAccept ?? false,
    defaultProjectId: input.defaultProjectId ?? null,
  });
  return type;
}

beforeEach(async () => {
  await resetTestDatabase();
});

describe("God Mode organisation request catalogue", () => {
  it("lists eligible organisations, replaces mappings, and rejects a stale editor", async () => {
    const admin = await seedAdmin();
    const customer = await addOrganisation("catalogue-customer", "CAT");
    const inactive = await addOrganisation(
      "catalogue-inactive",
      "CATOFF",
      false,
    );
    const [deleted] = await db
      .insert(schema.organisationTable)
      .values({
        id: "catalogue-deleted",
        key: "CATDEL",
        name: "Deleted customer",
        deletedAt: new Date(),
      })
      .returning();
    const [internal] = await db
      .select({ id: schema.organisationTable.id })
      .from(schema.organisationTable)
      .where(eq(schema.organisationTable.isInternal, true))
      .limit(1);
    if (!deleted || !internal || !inactive) throw new Error("fixture missing");

    const workItemType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: admin.workspace.id,
          key: "catalogue-type",
          name: "Task",
          category: "delivery",
        })
        .returning(),
      "work item type",
    );
    const type = await makeRequestType({
      workspaceId: admin.workspace.id,
      key: "catalogue-published",
      workItemTypeId: workItemType.id,
    });
    const legacyPrivate = await makeRequestType({
      workspaceId: admin.workspace.id,
      key: "catalogue-existing-private",
      workItemTypeId: workItemType.id,
      customerVisible: false,
    });
    await db.insert(schema.organisationRequestTypeTable).values({
      organisationId: customer.id,
      requestTypeId: legacyPrivate.id,
    });
    const { app } = createApp();
    const list = await request(app, "/api/instance/organisations");
    expect(list.status).toBe(200);
    const data = (await list.json()) as {
      data: Array<{
        id: string;
        catalogue: { etag: string; requestTypeIds: string[] };
        assignedRequestTypes: Array<{ id: string }>;
      }>;
      options: Array<{ id: string }>;
    };
    expect(data.data.map((row) => row.id)).toContain(customer.id);
    expect(data.data.map((row) => row.id)).toContain(inactive.id);
    expect(data.data.map((row) => row.id)).not.toContain(deleted.id);
    expect(data.data.map((row) => row.id)).not.toContain(internal.id);
    expect(data.options.map((row) => row.id)).toContain(type.id);
    expect(data.options.map((row) => row.id)).not.toContain(legacyPrivate.id);
    const initial = data.data.find((row) => row.id === customer.id);
    if (!initial) throw new Error("customer was not listed");
    expect(initial.catalogue.requestTypeIds).toEqual([legacyPrivate.id]);
    expect(initial.assignedRequestTypes.map((row) => row.id)).toEqual([
      legacyPrivate.id,
    ]);

    const save = await request(
      app,
      `/api/instance/organisations/${customer.id}/catalogue`,
      {
        method: "PUT",
        body: JSON.stringify({
          requestTypeIds: [legacyPrivate.id, type.id],
          expectedCatalogueEtag: initial.catalogue.etag,
        }),
      },
    );
    expect(save.status).toBe(200);
    const saved = (await save.json()) as {
      data: { catalogue: { etag: string; requestTypeIds: string[] } };
    };
    expect(saved.data.catalogue.requestTypeIds).toEqual(
      [legacyPrivate.id, type.id].sort(),
    );

    const noOp = await request(
      app,
      `/api/instance/organisations/${customer.id}/catalogue`,
      {
        method: "PUT",
        body: JSON.stringify({
          requestTypeIds: [type.id, legacyPrivate.id],
          expectedCatalogueEtag: saved.data.catalogue.etag,
        }),
      },
    );
    expect(noOp.status).toBe(200);
    expect((await noOp.json()).data.catalogue.etag).toBe(
      saved.data.catalogue.etag,
    );

    const stale = await request(
      app,
      `/api/instance/organisations/${customer.id}/catalogue`,
      {
        method: "PUT",
        body: JSON.stringify({
          requestTypeIds: [],
          expectedCatalogueEtag: initial.catalogue.etag,
        }),
      },
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ message: "catalogue_conflict" });
    const mappings = await db
      .select({
        requestTypeId: schema.organisationRequestTypeTable.requestTypeId,
      })
      .from(schema.organisationRequestTypeTable)
      .where(
        eq(schema.organisationRequestTypeTable.organisationId, customer.id),
      );
    expect(mappings.map((row) => row.requestTypeId).sort()).toEqual(
      [legacyPrivate.id, type.id].sort(),
    );
    const audit = await db
      .select({ action: schema.auditLogTable.action })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "instance.settings_changed"),
          eq(schema.auditLogTable.entityId, customer.id),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("rejects unpublished, private, unknown, and auto-accept cross-organisation types", async () => {
    const admin = await seedAdmin();
    const customer = await addOrganisation(
      "catalogue-invalid-customer",
      "CATINV",
    );
    const foreign = await addOrganisation(
      "catalogue-foreign-customer",
      "CATFOREIGN",
    );
    const workspaceId = admin.workspace.id;
    const workItemType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId,
          key: "catalogue-invalid-type",
          name: "Task",
          category: "delivery",
        })
        .returning(),
      "work item type",
    );
    const unpublished = await makeRequestType({
      workspaceId,
      key: "catalogue-unpublished",
      workItemTypeId: workItemType.id,
      published: false,
    });
    const privateType = await makeRequestType({
      workspaceId,
      key: "catalogue-private",
      workItemTypeId: workItemType.id,
      customerVisible: false,
    });
    const { project } = await createProjectFixture({ workspaceId });
    await db
      .update(schema.projectTable)
      .set({ organisationId: foreign.id })
      .where(eq(schema.projectTable.id, project.id));
    const crossOrgAutoAccept = await makeRequestType({
      workspaceId,
      key: "catalogue-cross-org-auto",
      workItemTypeId: workItemType.id,
      autoAccept: true,
      defaultProjectId: project.id,
    });
    const { app } = createApp();
    const list = await request(app, "/api/instance/organisations");
    const payload = (await list.json()) as {
      data: Array<{ id: string; catalogue: { etag: string } }>;
    };
    const state = payload.data.find((row) => row.id === customer.id);
    if (!state) throw new Error("customer was not listed");

    for (const requestTypeIds of [
      [unpublished.id],
      [privateType.id],
      ["unknown-request-type"],
      [crossOrgAutoAccept.id],
    ]) {
      const response = await request(
        app,
        `/api/instance/organisations/${customer.id}/catalogue`,
        {
          method: "PUT",
          body: JSON.stringify({
            requestTypeIds,
            expectedCatalogueEtag: state.catalogue.etag,
          }),
        },
      );
      expect(response.status, String(requestTypeIds)).toBe(422);
    }
    const [unchanged] = await db
      .select({ count: schema.organisationRequestTypeTable.requestTypeId })
      .from(schema.organisationRequestTypeTable)
      .where(
        eq(schema.organisationRequestTypeTable.organisationId, customer.id),
      );
    expect(unchanged).toBeUndefined();
  });

  it("serializes concurrent replacements so only one exact ETag wins", async () => {
    const admin = await seedAdmin();
    const customer = await addOrganisation(
      "catalogue-race-customer",
      "CATRACE",
    );
    const workItemType = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: admin.workspace.id,
          key: "catalogue-race-type",
          name: "Task",
          category: "delivery",
        })
        .returning(),
      "work item type",
    );
    const first = await makeRequestType({
      workspaceId: admin.workspace.id,
      key: "catalogue-race-first",
      workItemTypeId: workItemType.id,
    });
    const second = await makeRequestType({
      workspaceId: admin.workspace.id,
      key: "catalogue-race-second",
      workItemTypeId: workItemType.id,
    });
    const { app } = createApp();
    const listed = await request(app, "/api/instance/organisations");
    const payload = (await listed.json()) as {
      data: Array<{ id: string; catalogue: { etag: string } }>;
    };
    const current = payload.data.find((row) => row.id === customer.id);
    if (!current) throw new Error("customer was not listed");

    const responses = await Promise.all(
      [first, second].map((type) =>
        request(app, `/api/instance/organisations/${customer.id}/catalogue`, {
          method: "PUT",
          body: JSON.stringify({
            requestTypeIds: [type.id],
            expectedCatalogueEtag: current.catalogue.etag,
          }),
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const mappings = await db
      .select({
        requestTypeId: schema.organisationRequestTypeTable.requestTypeId,
      })
      .from(schema.organisationRequestTypeTable)
      .where(
        eq(schema.organisationRequestTypeTable.organisationId, customer.id),
      );
    expect(mappings).toHaveLength(1);
    expect([first.id, second.id]).toContain(mappings[0]?.requestTypeId);
  });

  it("denies non-admin and customer-portal sessions", async () => {
    const { user: admin } = await seedAdmin();
    const member = await createWorkspaceMember();
    const { app } = createApp();
    mockAuthenticatedSession(member.user);
    expect((await request(app, "/api/instance/organisations")).status).toBe(
      403,
    );
    mockAnonymousSession();
    const key = await makeApiKey(admin.id, { work_item: ["read"] });
    expect(
      (
        await request(app, "/api/instance/organisations", {
          headers: { "x-api-key": key },
        })
      ).status,
    ).toBe(403);
    mockAuthenticatedSession(admin, { portal: "customer" });
    expect([401, 403]).toContain(
      (await request(app, "/api/instance/organisations")).status,
    );
  });
});
