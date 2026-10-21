/**
 * `docs/03-features/comments-and-activity.md` `CA-19`/`CA-20`: canned-response CRUD.
 */
import { createHash, randomUUID } from "node:crypto";
import { BUILT_IN_ROLES, can } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { cannedResponsePolicies } from "../../apps/api/src/canned-response/policy";
import {
  deleteCannedResponseInWorkspace,
  findCannedResponseWorkspaceId,
  insertCannedResponse,
  listCannedResponsesForWorkItem,
  updateCannedResponseInWorkspace,
} from "../../apps/api/src/canned-response/repository";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { evaluateProjectRead } from "../../apps/api/src/utils/has-project-reach";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  grantWorkItemProjectAccess,
  requireRow,
} from "./helpers/fixtures";

async function identityFor(userId: string) {
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) throw new Error("Expected an active fixture identity");
  return identity;
}

async function createWorkItem(
  admin: Awaited<ReturnType<typeof createWorkspaceMember>>,
  app: ReturnType<typeof createApp>["app"],
) {
  const { project } = await createProjectFixture({
    workspaceId: admin.workspace.id,
  });
  await grantWorkItemProjectAccess(admin.user.id, project.id);
  const now = new Date();
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId: admin.workspace.id,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "canned response work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId: admin.workspace.id,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "canned response state template",
  );
  await db.insert(schema.stateTable).values({
    projectId: project.id,
    stateTemplateId: template.id,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  });
  const response = await app.request(`/api/projects/${project.id}/work-items`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ typeId: type.id, title: "Support request" }),
  });
  if (response.status !== 200)
    throw new Error(
      `Work item fixture failed: ${response.status} ${await response.text()}`,
    );
  return ((await response.json()) as { key: string }).key;
}

function hashApiKeyForTest(key: string) {
  return createHash("sha256")
    .update(key)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createScopedApiKey(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: hashApiKeyForTest(rawKey),
    name: "canned response reach test key",
    start: rawKey.slice(0, 12),
    prefix: "taskdesk",
    permissions: JSON.stringify(permissions),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return rawKey;
}

async function addAdminWorkspaceMembership(
  userId: string,
  workspaceId: string,
) {
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId,
    role: "admin",
    joinedAt: new Date(),
  });
}

async function removeProjectMembership(userId: string, projectId: string) {
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  if (!person)
    throw new Error("Expected fixture person before reach revocation");
  const removed = await db
    .delete(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, person.id),
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, projectId),
      ),
    )
    .returning({ id: schema.membershipTable.id });
  expect(removed).toHaveLength(1);
}

describe("API integration: canned responses (#27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it.each([
    ["owner", 200],
    ["admin", 200],
    ["manager", 200],
    ["lead", 403],
    ["member", 403],
    ["viewer", 403],
    ["customer", 403],
  ] as const)(
    "management listing enforces %s authority without needing a work item",
    async (role, expected) => {
      const member = await createWorkspaceMember({ role });
      // The shared fixture seeds only the legacy default role rows. Reserved
      // TaskDesk roles need a genuine system row before canonical authority is
      // honored (rbac.md); a bare membership alias intentionally fails closed.
      if (role === "manager" || role === "lead" || role === "customer") {
        await db.insert(schema.workspaceRoleTable).values({
          workspaceId: member.workspace.id,
          role,
          permission: JSON.stringify({}),
          isSystem: true,
        });
      }
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      await db.insert(schema.cannedResponseTable).values({
        workspaceId: member.workspace.id,
        name: "Workspace-only reply",
        body: { type: "doc", content: [] },
      });
      const response = await app.request(
        `/api/canned-responses/manage?workspaceId=${member.workspace.id}`,
      );
      expect(response.status).toBe(expected);
      const text = await response.text();
      if (expected === 200)
        expect(JSON.parse(text)).toEqual([
          expect.objectContaining({ name: "Workspace-only reply" }),
        ]);
      else expect(text).not.toContain("Workspace-only reply");
    },
  );

  it("management listing refuses an unbacked reserved manager alias", async () => {
    const member = await createWorkspaceMember({ role: "manager" });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/canned-responses/manage?workspaceId=${member.workspace.id}`,
    );
    expect(response.status).toBe(403);
  });

  it("management listing refuses a customer-side person even with a legacy admin membership", async () => {
    const customer = await createWorkspaceMember({ role: "admin" });
    await db
      .update(schema.personTable)
      .set({ side: "customer" })
      .where(eq(schema.personTable.userId, customer.user.id));
    await db.insert(schema.cannedResponseTable).values({
      workspaceId: customer.workspace.id,
      name: "Internal configuration",
      body: { type: "doc", content: [] },
    });
    mockAuthenticatedSession(customer.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/canned-responses/manage?workspaceId=${customer.workspace.id}`,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Internal configuration");
  });

  it("management listing excludes other workspaces and clamps API keys", async () => {
    const manager = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ role: "admin" });
    await db.insert(schema.cannedResponseTable).values([
      {
        workspaceId: manager.workspace.id,
        name: "Own snippet",
        body: { type: "doc", content: [] },
      },
      {
        workspaceId: other.workspace.id,
        name: "Other tenant secret",
        body: { type: "doc", content: [] },
      },
    ]);
    mockAuthenticatedSession(manager.user);
    const { app } = createApp();
    const path = `/api/canned-responses/manage?workspaceId=${manager.workspace.id}`;
    const allowed = await app.request(path);
    expect(allowed.status).toBe(200);
    const rows = await allowed.json();
    expect(rows).toEqual([expect.objectContaining({ name: "Own snippet" })]);
    const foreign = await app.request(
      `/api/canned-responses/manage?workspaceId=${other.workspace.id}`,
    );
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).not.toContain("Other tenant secret");
    const readKey = await createScopedApiKey(manager.user.id, {
      work_item: ["read"],
    });
    const denied = await app.request(path, {
      headers: { "x-api-key": readKey },
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("Own snippet");
    const manageKey = await createScopedApiKey(manager.user.id, {
      workspace: ["manage_settings"],
    });
    const keyAllowed = await app.request(path, {
      headers: { "x-api-key": manageKey },
    });
    expect(keyAllowed.status).toBe(200);
    expect(await keyAllowed.json()).toEqual(rows);
    expect((await app.request("/api/canned-responses/manage")).status).toBe(
      400,
    );
  });

  it("CA-19: an admin creates, lists, updates and deletes a canned response", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Thanks for reaching out",
        body: { type: "doc", content: [] },
      }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { id: string };
    expect(createdBody).toMatchObject({
      name: "Thanks for reaching out",
      visibilityDefault: "internal",
    });

    const workItemKey = await createWorkItem(creator, app);
    const list = await app.request(
      `/api/canned-responses?workItemKey=${workItemKey}`,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as unknown[];
    expect(listBody).toHaveLength(1);

    const updated = await app.request(
      `/api/canned-responses/${createdBody.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      },
    );
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { name: string }).name).toBe("Renamed");

    const deleted = await app.request(
      `/api/canned-responses/${createdBody.id}`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);

    const [row] = await db
      .select()
      .from(schema.cannedResponseTable)
      .where(eq(schema.cannedResponseTable.id, createdBody.id));
    expect(row).toBeUndefined();
  });

  it("CA-19a resolves authorized item context without modifying reusable templates", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();
    const key = await createWorkItem(creator, app);
    // External customer contacts need no login or workspace-user membership.
    const [customerOrganisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: `canned-customer-${randomUUID()}`,
        name: "External requester organisation",
      })
      .returning();
    if (!customerOrganisation)
      throw new Error("Expected customer organisation");
    const [requester] = await db
      .insert(schema.personTable)
      .values({
        organisationId: customerOrganisation.id,
        side: "customer",
        displayName: "Customer <Name> {{work_item.key}}",
      })
      .returning();
    if (!requester) throw new Error("Expected requester fixture");
    await db
      .update(schema.workItemTable)
      .set({
        requesterId: requester.id,
        dueDate: new Date("2026-10-25T15:30:00.000Z"),
      })
      .where(eq(schema.workItemTable.key, key));
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "{{requester.name}}: {{work_item.key}} due {{work_item.due_date}} {{unknown}}",
            },
          ],
        },
      ],
    };
    const [template] = await db
      .insert(schema.cannedResponseTable)
      .values({
        workspaceId: creator.workspace.id,
        name: "Context template",
        body,
      })
      .returning();
    const listed = await app.request(
      `/api/canned-responses?workItemKey=${key}`,
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      expect.objectContaining({
        id: template?.id,
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `Customer <Name> {{work_item.key}}: ${key} due 2026-10-25 {{unknown}}`,
                },
              ],
            },
          ],
        },
      }),
    ]);
    const [staffRequester] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, creator.user.id))
      .limit(1);
    if (!staffRequester) throw new Error("Expected linked staff requester");
    await db
      .update(schema.personTable)
      .set({ displayName: null })
      .where(eq(schema.personTable.id, staffRequester.id));
    await db
      .update(schema.workItemTable)
      .set({ requesterId: staffRequester.id })
      .where(eq(schema.workItemTable.key, key));
    const fallback = await app.request(
      `/api/canned-responses?workItemKey=${key}`,
    );
    expect(fallback.status).toBe(200);
    expect(JSON.stringify(await fallback.json())).toContain(
      `${creator.user.name}: ${key} due 2026-10-25`,
    );
    const managed = await app.request(
      `/api/canned-responses/manage?workspaceId=${creator.workspace.id}`,
    );
    expect(managed.status).toBe(200);
    expect(await managed.json()).toEqual([expect.objectContaining({ body })]);
    await db
      .update(schema.workItemTable)
      .set({ requesterId: null, dueDate: null })
      .where(eq(schema.workItemTable.key, key));
    const missing = await app.request(
      `/api/canned-responses?workItemKey=${key}`,
    );
    expect(missing.status).toBe(200);
    expect(JSON.stringify(await missing.json())).toContain(
      `: ${key} due  {{unknown}}`,
    );
    const [stored] = await db
      .select()
      .from(schema.cannedResponseTable)
      .where(eq(schema.cannedResponseTable.id, template?.id ?? ""));
    expect(stored?.body).toEqual(body);
  });

  it("403s a member without workspace:manage_settings", async () => {
    const creator = await createWorkspaceMember({ role: "member" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const response = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Nope",
        body: { type: "doc", content: [] },
      }),
    });
    expect(response.status).toBe(403);
    await response.text();
  });

  it("409s a duplicate name within the same workspace", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const body = {
      workspaceId: creator.workspace.id,
      name: "Duplicate",
      body: { type: "doc", content: [] },
    };
    const first = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    await first.text();

    const second = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(second.status).toBe(409);
    await second.text();
  });

  it("404s a PATCH against another tenant's canned response", async () => {
    const creator = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(creator.user);
    const { app } = createApp();

    const created = await app.request("/api/canned-responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: creator.workspace.id,
        name: "Mine",
        body: { type: "doc", content: [] },
      }),
    });
    const { id } = (await created.json()) as { id: string };

    const otherTenant = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(otherTenant.user);
    const { app: otherApp } = createApp();

    const response = await otherApp.request(`/api/canned-responses/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked" }),
    });
    expect(response.status).toBe(404);
  });

  it("DELETE against another tenant's canned response 404s and leaves the row", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const created = await insertCannedResponse(
      await identityFor(owner.user.id),
      {
        workspaceId: owner.workspace.id,
        name: "Keep me",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
        createdBy: owner.user.id,
      },
    );
    expect(created).toBeDefined();

    const otherTenant = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(otherTenant.user);
    const { app } = createApp();

    const response = await app.request(`/api/canned-responses/${created?.id}`, {
      method: "DELETE",
    });
    expect(response.status).toBe(404);
    await response.text();

    const rows = await db
      .select()
      .from(schema.cannedResponseTable)
      .where(eq(schema.cannedResponseTable.id, created?.id ?? ""));
    expect(rows).toHaveLength(1);
  });

  it("PATCH and DELETE of a canned response that does not exist 404", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const patched = await app.request("/api/canned-responses/missing-id", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nothing" }),
    });
    expect(patched.status).toBe(404);
    await patched.text();

    const deleted = await app.request("/api/canned-responses/missing-id", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(404);
    await deleted.text();
  });

  it("lists only responses available to the requested work item, ordered by name", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ role: "admin" });
    for (const [workspaceId, name, createdBy] of [
      [admin.workspace.id, "Zulu", admin.user.id],
      [admin.workspace.id, "Alpha", admin.user.id],
      [other.workspace.id, "Foreign", other.user.id],
    ] as const) {
      await insertCannedResponse(
        await identityFor(
          (workspaceId === admin.workspace.id ? admin : other).user.id,
        ),
        {
          workspaceId,
          name,
          body: { type: "doc", content: [] },
          visibilityDefault: "public",
          createdBy,
        },
      );
    }

    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const workItemKey = await createWorkItem(admin, app);
    const response = await app.request(
      `/api/canned-responses?workItemKey=${workItemKey}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string }[];
    expect(body.map((row) => row.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("HTTP listing requires a reachable item and the owner's project capability", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const key = await createWorkItem(admin, app);
    const [item] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key));
    if (!item) throw new Error("Expected the live work-item fixture");

    expect((await app.request("/api/canned-responses")).status).toBe(400);
    expect(
      (
        await app.request(
          `/api/canned-responses?workItemKey=missing-${randomUUID()}`,
        )
      ).status,
    ).toBe(404);

    const reader = await createWorkspaceMember({ role: "admin" });
    await addAdminWorkspaceMembership(reader.user.id, admin.workspace.id);
    await grantProjectRole(reader.user.id, item.projectId, ["project:read"]);
    const readerIdentity = await identityFor(reader.user.id);
    expect(
      readerIdentity.memberships.some(
        (membership) =>
          membership.scope === "project" &&
          membership.scopeId === item.projectId,
      ),
    ).toBe(true);
    expect(
      can(readerIdentity, "project:read", "project", {
        projectId: item.projectId,
        workspaceId: admin.workspace.id,
      }),
    ).toBe(true);
    expect(
      can(readerIdentity, "work_item:read", "work_item", {
        workItemId: item.id,
        workItemProjectId: item.projectId,
        projectId: item.projectId,
        workspaceId: admin.workspace.id,
      }),
    ).toBe(false);
    expect(
      can(await identityFor(admin.user.id), "work_item:read", "work_item", {
        workItemId: item.id,
        workItemProjectId: item.projectId,
        projectId: item.projectId,
        workspaceId: admin.workspace.id,
      }),
    ).toBe(true);
    mockAuthenticatedSession(reader.user);
    expect(
      (await app.request(`/api/canned-responses?workItemKey=${key}`)).status,
    ).toBe(403);

    mockAuthenticatedSession(admin.user);
    const sameWorkspaceNoReach = await createWorkspaceMember({ role: "admin" });
    await addAdminWorkspaceMembership(
      sameWorkspaceNoReach.user.id,
      admin.workspace.id,
    );
    const outsiderKey = await createScopedApiKey(sameWorkspaceNoReach.user.id, {
      work_item: ["read"],
    });
    expect(
      (
        await app.request(`/api/canned-responses?workItemKey=${key}`, {
          headers: { "x-api-key": outsiderKey },
        })
      ).status,
    ).toBe(404);

    const positiveKey = await createScopedApiKey(admin.user.id, {
      work_item: ["read"],
    });
    const positiveRow = await insertCannedResponse(
      await identityFor(admin.user.id),
      {
        workspaceId: admin.workspace.id,
        name: "API key visible",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
        createdBy: admin.user.id,
      },
    );
    if (!positiveRow)
      throw new Error("Expected API-key-visible response fixture");
    const positiveList = await app.request(
      `/api/canned-responses?workItemKey=${key}`,
      { headers: { "x-api-key": positiveKey } },
    );
    expect(positiveList.status).toBe(200);
    const positiveBody = (await positiveList.json()) as {
      id: string;
      name: string;
    }[];
    expect(positiveBody).toEqual([
      expect.objectContaining({ id: positiveRow.id, name: "API key visible" }),
    ]);
    const scopeDeniedKey = await createScopedApiKey(admin.user.id, {
      work_item: [],
    });
    expect(
      (
        await app.request(`/api/canned-responses?workItemKey=${key}`, {
          headers: { "x-api-key": scopeDeniedKey },
        })
      ).status,
    ).toBe(403);

    const ownerClampedKey = await createScopedApiKey(reader.user.id, {
      work_item: ["read"],
    });
    expect(
      (
        await app.request(`/api/canned-responses?workItemKey=${key}`, {
          headers: { "x-api-key": ownerClampedKey },
        })
      ).status,
    ).toBe(403);
  });

  it("refuses a reachable customer-side principal before exposing internal snippets", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const workItemKey = await createWorkItem(owner, app);
    const [workItem] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, workItemKey));
    if (!workItem) throw new Error("Expected canned-response work item");

    const [customerOrganisation] = await db
      .insert(schema.organisationTable)
      .values({
        key: `canned-customer-${randomUUID()}`,
        name: "Canned response customer",
        isInternal: false,
        active: true,
        portalAccess: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    if (!customerOrganisation)
      throw new Error("Expected canned-response customer organisation");
    const customerRole = requireRow(
      await db
        .insert(schema.roleTable)
        .values({
          scope: BUILT_IN_ROLES.customer.scope,
          workspaceId: null,
          key: BUILT_IN_ROLES.customer.key,
          name: "Customer",
          rank: BUILT_IN_ROLES.customer.rank,
          capabilities: [...BUILT_IN_ROLES.customer.capabilities],
          isSystem: true,
          isEditable: false,
        })
        .returning(),
      "canned-response customer role",
    );

    const reachableCustomer = await createWorkspaceMember({ role: "member" });
    const [customerPerson] = await db
      .update(schema.personTable)
      .set({
        organisationId: customerOrganisation.id,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .where(eq(schema.personTable.userId, reachableCustomer.user.id))
      .returning({ id: schema.personTable.id });
    if (!customerPerson) throw new Error("Expected linked customer person");
    await db.insert(schema.membershipTable).values({
      personId: customerPerson.id,
      scope: "organisation",
      scopeId: customerOrganisation.id,
      roleId: customerRole.id,
      seesAll: false,
    });
    await db
      .update(schema.projectTable)
      .set({ organisationId: customerOrganisation.id })
      .where(eq(schema.projectTable.id, workItem.projectId));

    const internalBody = {
      type: "doc",
      content: [{ type: "text", text: "internal-only-canned-response-807" }],
    };
    const snippet = await insertCannedResponse(
      await identityFor(owner.user.id),
      {
        workspaceId: owner.workspace.id,
        name: "Internal support note",
        body: internalBody,
        visibilityDefault: "internal",
        createdBy: owner.user.id,
      },
    );
    if (!snippet) throw new Error("Expected internal canned-response insert");

    const reachableIdentity = await identityFor(reachableCustomer.user.id);
    expect(reachableIdentity.reach).toEqual({
      kind: "organisation",
      ids: [customerOrganisation.id],
    });
    const policy = cannedResponsePolicies["GET /api/canned-responses"];
    const projectRead = evaluateProjectRead(
      reachableIdentity,
      policy.capability,
      policy.scope,
      {
        projectId: workItem.projectId,
        workspaceId: owner.workspace.id,
        organisationId: customerOrganisation.id,
        workItemId: workItem.id,
      },
    );
    expect(projectRead).toMatchObject({ reachable: true, capable: false });
    // Relative app requests use the configured agent host. Keep an agent session so
    // authentication reaches this route; persisted person side and org membership make
    // resolveIdentity classify this caller as a customer principal.
    mockAuthenticatedSession(reachableCustomer.user);
    const reachableResponse = await app.request(
      `/api/canned-responses?workItemKey=${workItemKey}`,
    );
    const reachableText = await reachableResponse.text();
    expect(reachableResponse.status).toBe(403);
    expect(reachableText).not.toContain("internal-only-canned-response-807");
    expect(reachableText).not.toContain(owner.user.id);

    const otherOrganisation = requireRow(
      await db
        .insert(schema.organisationTable)
        .values({
          key: `canned-customer-${randomUUID()}`,
          name: "Another canned response customer",
          isInternal: false,
          active: true,
          portalAccess: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning(),
      "unreachable canned-response customer organisation",
    );
    const unreachableCustomer = await createWorkspaceMember({ role: "member" });
    const [unreachablePerson] = await db
      .update(schema.personTable)
      .set({
        organisationId: otherOrganisation.id,
        side: "customer",
        active: true,
        isPlaceholder: false,
      })
      .where(eq(schema.personTable.userId, unreachableCustomer.user.id))
      .returning({ id: schema.personTable.id });
    if (!unreachablePerson)
      throw new Error("Expected unreachable customer person");
    await db.insert(schema.membershipTable).values({
      personId: unreachablePerson.id,
      scope: "organisation",
      scopeId: otherOrganisation.id,
      roleId: customerRole.id,
      seesAll: false,
    });
    mockAuthenticatedSession(unreachableCustomer.user);
    const unreachableResponse = await app.request(
      `/api/canned-responses?workItemKey=${workItemKey}`,
    );
    expect(unreachableResponse.status).toBe(404);
    const unreachableText = await unreachableResponse.text();
    expect(unreachableText).not.toContain("internal-only-canned-response-807");
    expect(unreachableText).not.toContain(owner.user.id);
  });

  it("refuses a reachable workspace-customer principal on the agent snippet list", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const workItemKey = await createWorkItem(owner, app);
    const [workItem] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, workItemKey));
    if (!workItem) throw new Error("Expected canned-response work item");

    const snippet = await insertCannedResponse(
      await identityFor(owner.user.id),
      {
        workspaceId: owner.workspace.id,
        name: "Internal support note",
        body: { type: "doc", content: [{ type: "text", text: "private 807" }] },
        visibilityDefault: "internal",
        createdBy: owner.user.id,
      },
    );
    if (!snippet) throw new Error("Expected internal canned-response insert");

    const customer = await createWorkspaceMember({ role: "customer" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: customer.user.id,
      role: "customer",
      joinedAt: new Date(),
    });
    await grantProjectRole(customer.user.id, workItem.projectId, [
      "work_item:read",
    ]);
    const customerIdentity = await identityFor(customer.user.id);
    const policy = cannedResponsePolicies["GET /api/canned-responses"];
    const projectRead = evaluateProjectRead(
      customerIdentity,
      policy.capability,
      policy.scope,
      {
        projectId: workItem.projectId,
        workspaceId: owner.workspace.id,
        organisationId: null,
        workItemId: workItem.id,
      },
    );
    expect(projectRead).toMatchObject({ reachable: true, capable: true });

    mockAuthenticatedSession(customer.user);
    const response = await app.request(
      `/api/canned-responses?workItemKey=${workItemKey}`,
    );
    const text = await response.text();
    expect(response.status).toBe(403);
    expect(text).not.toContain("private 807");
    expect(text).not.toContain(owner.user.id);
  });

  it("list SQL enforces same-workspace project reach and live-item state at read time", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const unreachableMember = await createWorkspaceMember({ role: "admin" });
    await addAdminWorkspaceMembership(
      unreachableMember.user.id,
      admin.workspace.id,
    );
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();
    const reachableKey = await createWorkItem(admin, app);
    const [reachable] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, reachableKey));
    if (!reachable) throw new Error("Expected reachable work-item row");
    const response = await insertCannedResponse(
      await identityFor(admin.user.id),
      {
        workspaceId: admin.workspace.id,
        name: "Reach limited",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
        createdBy: admin.user.id,
      },
    );
    if (!response) throw new Error("Expected reachable canned-response insert");

    const outsiderIdentity = await identityFor(unreachableMember.user.id);
    expect(
      (
        await listCannedResponsesForWorkItem(
          await identityFor(admin.user.id),
          reachableKey,
        )
      ).map((row) => row.id),
    ).toEqual([response.id]);
    expect(
      outsiderIdentity.memberships.some(
        (membership) =>
          membership.scope === "workspace" &&
          membership.scopeId === admin.workspace.id,
      ),
    ).toBe(true);
    expect(
      outsiderIdentity.memberships.some(
        (membership) =>
          membership.scope === "project" &&
          membership.scopeId === reachable.projectId,
      ),
    ).toBe(false);
    expect(
      await listCannedResponsesForWorkItem(outsiderIdentity, reachableKey),
    ).toEqual([]);

    const archivedKey = await createWorkItem(admin, app);
    const deletedKey = await createWorkItem(admin, app);
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.workItemTable.key, archivedKey));
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.workItemTable.key, deletedKey));
    expect(
      await listCannedResponsesForWorkItem(
        await identityFor(admin.user.id),
        archivedKey,
      ),
    ).toEqual([]);
    expect(
      await listCannedResponsesForWorkItem(
        await identityFor(admin.user.id),
        deletedKey,
      ),
    ).toEqual([]);

    await removeProjectMembership(admin.user.id, reachable.projectId);
    expect(
      await listCannedResponsesForWorkItem(
        await identityFor(admin.user.id),
        reachableKey,
      ),
    ).toEqual([]);
  });

  describe("repository tenant predicates", () => {
    it("foreign identity cannot bootstrap, insert, update or delete using the victim workspace", async () => {
      const victim = await createWorkspaceMember({ role: "admin" });
      const foreign = await createWorkspaceMember({ role: "admin" });
      const victimIdentity = await identityFor(victim.user.id);
      const foreignIdentity = await identityFor(foreign.user.id);
      expect(
        foreignIdentity.memberships.some(
          (membership) =>
            membership.scope === "workspace" &&
            membership.scopeId === victim.workspace.id,
        ),
      ).toBe(false);
      const row = await insertCannedResponse(victimIdentity, {
        workspaceId: victim.workspace.id,
        name: "Victim row",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
        createdBy: victim.user.id,
      });
      if (!row) throw new Error("Expected victim-owned canned response");

      expect(
        await findCannedResponseWorkspaceId(foreignIdentity, row.id),
      ).toBeUndefined();
      expect(
        await insertCannedResponse(foreignIdentity, {
          workspaceId: victim.workspace.id,
          name: "Foreign insert",
          body: { type: "doc", content: [] },
          visibilityDefault: "internal",
          createdBy: foreign.user.id,
        }),
      ).toBeUndefined();
      expect(
        await updateCannedResponseInWorkspace(
          foreignIdentity,
          row.id,
          victim.workspace.id,
          { name: "Foreign update" },
        ),
      ).toBeUndefined();
      expect(
        await deleteCannedResponseInWorkspace(
          foreignIdentity,
          row.id,
          victim.workspace.id,
        ),
      ).toBeUndefined();
      const [unchanged] = await db
        .select()
        .from(schema.cannedResponseTable)
        .where(eq(schema.cannedResponseTable.id, row.id));
      expect(unchanged).toMatchObject({
        workspaceId: victim.workspace.id,
        name: "Victim row",
      });
      const victimRows = await db
        .select()
        .from(schema.cannedResponseTable)
        .where(eq(schema.cannedResponseTable.workspaceId, victim.workspace.id));
      expect(victimRows).toHaveLength(1);
    });

    it("update and delete by id only act inside the supplied workspace", async () => {
      const owner = await createWorkspaceMember({ role: "admin" });
      const other = await createWorkspaceMember({ role: "admin" });
      const ownerIdentity = await identityFor(owner.user.id);
      const otherIdentity = await identityFor(other.user.id);
      const created = await insertCannedResponse(ownerIdentity, {
        workspaceId: owner.workspace.id,
        name: "Original",
        body: { type: "doc", content: [] },
        visibilityDefault: "internal",
        createdBy: owner.user.id,
      });
      const id = created?.id ?? "";

      expect(
        await updateCannedResponseInWorkspace(
          otherIdentity,
          id,
          other.workspace.id,
          {
            name: "Hijacked",
          },
        ),
      ).toBeUndefined();
      expect(
        await deleteCannedResponseInWorkspace(
          otherIdentity,
          id,
          other.workspace.id,
        ),
      ).toBeUndefined();
      expect(await findCannedResponseWorkspaceId(ownerIdentity, id)).toEqual({
        workspaceId: owner.workspace.id,
      });
      expect(
        await findCannedResponseWorkspaceId(ownerIdentity, "missing"),
      ).toBeUndefined();

      const renamed = await updateCannedResponseInWorkspace(
        ownerIdentity,
        id,
        owner.workspace.id,
        { name: "Renamed", visibilityDefault: "public" },
      );
      expect(renamed).toMatchObject({
        id,
        name: "Renamed",
        visibilityDefault: "public",
      });
      expect(
        await deleteCannedResponseInWorkspace(
          ownerIdentity,
          id,
          owner.workspace.id,
        ),
      ).toMatchObject({ id });
    });
  });
});
