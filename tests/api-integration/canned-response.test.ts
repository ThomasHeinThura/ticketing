/**
 * `docs/03-features/comments-and-activity.md` `CA-19`/`CA-20`: canned-response CRUD.
 */
import { createHash, randomUUID } from "node:crypto";
import { can } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
  await db
    .delete(schema.membershipTable)
    .where(
      and(
        eq(schema.membershipTable.personId, person.id),
        eq(schema.membershipTable.scope, "project"),
        eq(schema.membershipTable.scopeId, projectId),
      ),
    );
}

describe("API integration: canned responses (#27)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
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
    expect(
      (
        await app.request(`/api/canned-responses?workItemKey=${key}`, {
          headers: { "x-api-key": positiveKey },
        })
      ).status,
    ).toBe(200);
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
