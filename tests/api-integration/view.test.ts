import { createHash, randomUUID } from "node:crypto";
import { defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as auditWriter from "../../apps/api/src/audit/audit-writer";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import * as auditFailureNotifier from "../../apps/api/src/instance/observability/audit-failure-notifier";
import * as observabilityRuntime from "../../apps/api/src/instance/observability/runtime";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

async function expectPlainText422(response: Response, message: string) {
  expect(response.status).toBe(422);
  const contentType = response.headers.get("content-type") ?? "";
  const [mediaType, ...parameters] = contentType.split(";");
  expect(mediaType?.trim().toLowerCase()).toBe("text/plain");
  const charset = parameters
    .map((parameter) => parameter.trim().split("=", 2))
    .find(([name]) => name?.toLowerCase() === "charset")?.[1];
  expect(charset?.replace(/^"|"$/gu, "").toLowerCase()).toBe("utf-8");
  expect(await response.text()).toBe(message);
}

function hashApiKey(rawKey: string): string {
  return createHash("sha256")
    .update(rawKey)
    .digest()
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function createViewApiKey(
  userId: string,
  permissions: Record<string, string[]>,
) {
  const rawKey = `taskdesk_test_${randomUUID()}`;
  const now = new Date();
  const [key] = await db
    .insert(schema.apikeyTable)
    .values({
      referenceId: userId,
      userId,
      key: hashApiKey(rawKey),
      name: "saved view scope test key",
      start: rawKey.slice(0, 12),
      prefix: "taskdesk",
      permissions: JSON.stringify(permissions),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.apikeyTable.id });
  if (!key)
    throw new Error("Saved-view API-key fixture insert returned no row");
  return { id: key.id, rawKey };
}

/** Return the provisioned `person` row or create one for helpers that only seed users. */
async function addPerson(userId: string) {
  const existing = await db.query.personTable.findFirst({
    where: eq(schema.personTable.userId, userId),
  });
  if (existing) return existing;
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.personTable)
      .values({ userId, organisationId: organisation.id, side: "staff" })
      .returning(),
    "addPerson: person",
  );
}

describe("API integration: saved views", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("lists only same-workspace teams the authorized caller can share with", async () => {
    const owner = await createWorkspaceMember({ role: "owner" });
    const visibleId = `team-share-visible-${randomUUID()}`;
    const hiddenId = `team-share-hidden-${randomUUID()}`;
    await db.insert(schema.teamTable).values([
      {
        id: visibleId,
        name: "Visible service team",
        workspaceId: owner.workspace.id,
        createdAt: new Date(),
      },
      {
        id: hiddenId,
        name: "Hidden service team",
        workspaceId: owner.workspace.id,
        createdAt: new Date(),
      },
    ]);
    await db.insert(schema.teamMemberTable).values({
      id: `team-member-visible-${randomUUID()}`,
      teamId: visibleId,
      userId: owner.user.id,
      createdAt: new Date(),
    });
    mockAuthenticatedSession(owner.user);
    const { app } = createApp();
    const response = await app.request(
      `/api/views/team-audiences?workspaceId=${owner.workspace.id}`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: visibleId, name: "Visible service team" }],
    });
  });

  it("rejects unauthenticated access", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/views?workspaceId=whatever");
    expect(response.status).toBe(401);
  });

  it("creates a private saved view and returns it in the owner's list", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "My triage queue",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item", filter: { state: "started" } },
      }),
    });

    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as {
      id: string;
      visibility: string;
    };
    expect(created.visibility).toBe("private");

    const listResponse = await app.request(
      `/api/views?workspaceId=${member.workspace.id}`,
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as { id: string }[];
    expect(list.map((v) => v.id)).toContain(created.id);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted).toMatchObject({
      workspaceId: member.workspace.id,
      name: "My triage queue",
      visibility: "private",
    });

    const auditRow = await db.query.auditLogTable.findFirst({
      where: (row, { and, eq }) =>
        and(eq(row.action, "saved_view.created"), eq(row.entityId, created.id)),
    });
    expect(auditRow).toMatchObject({
      actorId: member.user.id,
      actorType: "person",
      workspaceId: member.workspace.id,
      action: "saved_view.created",
      entityType: "saved_view",
      entityId: created.id,
      before: null,
    });
    expect(auditRow?.after).toMatchObject({
      visibility: "private",
      sharedWithTeamId: null,
    });
  });

  it("runs and counts a project view within its required project scope", async () => {
    const member = await createWorkspaceMember({ role: "member" });
    await addPerson(member.user.id);
    const target = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "saved-view-target",
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "saved-view-other",
    });
    await grantProjectRole(member.user.id, target.project.id, [
      "work_item:read",
      "project:read",
    ]);
    await grantProjectRole(member.user.id, other.project.id, [
      "work_item:read",
      "project:read",
    ]);

    const now = new Date();
    const type = requireRow(
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: member.workspace.id,
          key: `saved-view-${randomUUID()}`,
          name: "Saved view task",
          category: "delivery",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "saved-view work-item type",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: member.workspace.id,
          key: `saved-view-${randomUUID()}`,
          name: "Started",
          group: "started",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
      "saved-view state template",
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createItem = async (projectId: string, title: string) => {
      await db.insert(schema.stateTable).values({
        projectId,
        stateTemplateId: template.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      });
      const response = await app.request(
        `/api/projects/${projectId}/work-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ typeId: type.id, title, priority: "high" }),
        },
      );
      expect(response.status).toBe(200);
      return (await response.json()) as { id: string };
    };
    const targetItem = await createItem(target.project.id, "Target queue item");
    await createItem(other.project.id, "Other project item");

    const created = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Target project queue",
        scope: "project",
        scopeId: target.project.id,
        layout: "list",
        query: {
          entity: "work_item",
          filter: { field: "priority", op: "eq", value: "high" },
        },
      }),
    });
    expect(created.status).toBe(200);
    const view = (await created.json()) as { id: string };

    const count = await app.request(`/api/views/${view.id}/count`);
    expect(count.status).toBe(200);
    await expect(count.json()).resolves.toEqual({ count: 1 });

    const run = await app.request(`/api/views/${view.id}/run?limit=50`, {
      method: "POST",
    });
    expect(run.status).toBe(200);
    const result = (await run.json()) as {
      data: { id: string }[];
      meta: { total: number };
    };
    expect(result.data.map((item) => item.id)).toEqual([targetItem.id]);
    expect(result.meta.total).toBe(1);
  });

  it("keeps create successful and reports an AU-14 audit append failure", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const auditFailure = new Error("audit database unavailable");
    const appendAuditSpy = vi
      .spyOn(auditWriter, "appendAuditLog")
      .mockRejectedValueOnce(auditFailure);
    const metricSpy = vi.spyOn(observabilityRuntime, "recordAuditWriteFailure");
    const notifySpy = vi
      .spyOn(auditFailureNotifier, "notifyCurrentInstanceAdminsOfAuditFailure")
      .mockResolvedValueOnce();

    try {
      const response = await app.request("/api/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          name: "Audit outage queue",
          scope: "workspace",
          scopeId: member.workspace.id,
          layout: "list",
          query: { entity: "work_item" },
        }),
      });

      expect(response.status).toBe(200);
      const created = (await response.json()) as { id: string };
      expect(
        await db.query.savedViewTable.findFirst({
          where: eq(schema.savedViewTable.id, created.id),
        }),
      ).toMatchObject({ id: created.id, name: "Audit outage queue" });
      expect(appendAuditSpy).toHaveBeenCalledOnce();
      expect(metricSpy).toHaveBeenCalledWith("mutation");
      expect(notifySpy).toHaveBeenCalledWith("mutation");
      expect(
        await db.query.auditLogTable.findFirst({
          where: (row, { and, eq }) =>
            and(
              eq(row.action, "saved_view.created"),
              eq(row.entityId, created.id),
            ),
        }),
      ).toBeUndefined();
    } finally {
      appendAuditSpy.mockRestore();
      metricSpy.mockRestore();
      notifySpy.mockRestore();
    }
  });

  it("requires saved_view:share as well as team membership to publish views", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    const teamId = `team-view-share-denied-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Member Team",
      workspaceId: member.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `team-member-view-share-denied-${randomUUID()}`,
      teamId,
      userId: member.user.id,
      createdAt: new Date(),
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const teamBody = {
      workspaceId: member.workspace.id,
      name: "Member's shared view",
      scope: "workspace",
      scopeId: member.workspace.id,
      visibility: "team",
      sharedWithTeamId: teamId,
      layout: "list",
      query: { entity: "work_item" },
    };

    const teamCreate = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(teamBody),
    });
    expect(teamCreate.status).toBe(403);
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.workspaceId, member.workspace.id),
      }),
    ).toBeUndefined();

    const privateCreate = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...teamBody,
        visibility: "private",
        sharedWithTeamId: undefined,
      }),
    });
    expect(privateCreate.status).toBe(200);
    const privateView = (await privateCreate.json()) as { id: string };

    const publishUpdate = await app.request(`/api/views/${privateView.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "team", sharedWithTeamId: teamId }),
    });
    expect(publishUpdate.status).toBe(403);
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, privateView.id),
      }),
    ).toMatchObject({
      id: privateView.id,
      visibility: "private",
      sharedWithTeamId: null,
    });
  });

  it("keeps API-key ceilings on view share and workspace-visibility checks", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    await addPerson(member.user.id);
    const teamId = `team-view-key-scope-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Key scope team",
      workspaceId: member.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `team-member-view-key-scope-${randomUUID()}`,
      teamId,
      userId: member.user.id,
      createdAt: new Date(),
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const privateViewResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Private view for key-scope check",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(privateViewResponse.status).toBe(200);
    const privateView = (await privateViewResponse.json()) as { id: string };
    const key = await createViewApiKey(member.user.id, {
      saved_view: ["create"],
    });
    const keyHeaders = {
      authorization: `Bearer ${key.rawKey}`,
      "content-type": "application/json",
    };

    const teamCreate = await app.request("/api/views", {
      method: "POST",
      headers: keyHeaders,
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Must not publish without key scope",
        scope: "workspace",
        scopeId: member.workspace.id,
        visibility: "team",
        sharedWithTeamId: teamId,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(teamCreate.status).toBe(403);

    const workspaceCreate = await app.request("/api/views", {
      method: "POST",
      headers: keyHeaders,
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Must not publish workspace-wide without key scope",
        scope: "workspace",
        scopeId: member.workspace.id,
        visibility: "workspace",
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(workspaceCreate.status).toBe(403);

    const teamUpdate = await app.request(`/api/views/${privateView.id}`, {
      method: "PATCH",
      headers: keyHeaders,
      body: JSON.stringify({ visibility: "team", sharedWithTeamId: teamId }),
    });
    expect(teamUpdate.status).toBe(403);

    const workspaceUpdate = await app.request(`/api/views/${privateView.id}`, {
      method: "PATCH",
      headers: keyHeaders,
      body: JSON.stringify({ visibility: "workspace" }),
    });
    expect(workspaceUpdate.status).toBe(403);
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, privateView.id),
      }),
    ).toMatchObject({ visibility: "private", sharedWithTeamId: null });
  });

  it("rejects a scopeId naming a project outside the workspace", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Bad scope",
        scope: "project",
        scopeId: "project-does-not-exist",
        layout: "board",
        query: { entity: "work_item" },
      }),
    });

    expect(response.status).toBe(400);
  });

  it("hides a private view from another workspace member, and 404s the direct read", async () => {
    const owner = await createWorkspaceMember();
    await addPerson(owner.user.id);
    const otherUserId = "user-view-other";
    const other = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: otherUserId,
          email: `${otherUserId}@example.com`,
          emailVerified: true,
          name: "Other Member",
        })
        .returning(),
      "other user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: other.id,
      role: "member",
      joinedAt: new Date(),
    });
    // `owner` already seeded the "member" `workspace_role` row via `createWorkspaceMember`
    // (default role); a second row for the same (workspaceId, role) pair would violate
    // its own unique constraint.
    await addPerson(other.id);

    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const createResponse = await ownerApp.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "Private queue",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(other);
    const { app: otherApp } = createApp();

    const listResponse = await otherApp.request(
      `/api/views?workspaceId=${owner.workspace.id}`,
    );
    const list = (await listResponse.json()) as { id: string }[];
    expect(list.map((v) => v.id)).not.toContain(created.id);

    const getResponse = await otherApp.request(`/api/views/${created.id}`);
    expect(getResponse.status).toBe(404);
  });

  it("refuses an edit from a non-owner without workspace:manage_settings", async () => {
    const owner = await createWorkspaceMember();
    await addPerson(owner.user.id);
    const editorUserId = "user-view-editor";
    const editor = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: editorUserId,
          email: `${editorUserId}@example.com`,
          emailVerified: true,
          name: "Editor",
        })
        .returning(),
      "editor user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: editor.id,
      role: "member",
      joinedAt: new Date(),
    });
    await addPerson(editor.id);

    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const createResponse = await ownerApp.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "Owner's view",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(editor);
    const { app: editorApp } = createApp();
    const updateResponse = await editorApp.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Hijacked name" }),
    });
    expect(updateResponse.status).toBe(403);

    const deleteResponse = await editorApp.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(403);
  });

  it("deletes a saved view only after the owner's pending action is approved", async () => {
    const member = await createWorkspaceMember();
    const person = await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const sessionId = `session-${member.user.id}`;
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: sessionId,
      token: `token-${member.user.id}`,
      userId: member.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Original name",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    const pinResponse = await app.request(`/api/views/${created.id}/pin`, {
      method: "POST",
    });
    expect(pinResponse.status).toBe(200);

    const deleteResponse = await app.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(202);
    const pending = (await deleteResponse.json()) as {
      pendingActionId: string;
      confirmation: string;
      summary: { name: string };
    };
    expect(pending).toMatchObject({
      confirmation: "click",
      summary: { name: "Original name" },
    });
    const pendingRow = await db.query.pendingActionTable.findFirst({
      where: eq(schema.pendingActionTable.id, pending.pendingActionId),
    });
    expect(pendingRow).toMatchObject({
      requestedByPersonId: person.id,
      action: "delete",
      targetType: "saved_view",
      targetIds: [created.id],
      routeKey: "DELETE /api/views/{id}",
      workspaceId: member.workspace.id,
      confirmationRequired: "click",
      state: "pending",
    });
    expect(pendingRow?.targetVersions).toMatchObject({
      [created.id]: expect.any(Number),
    });
    const duplicate = await app.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.text()).resolves.toContain(pending.pendingActionId);
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, created.id),
      }),
    ).toBeDefined();
    const pinnedBeforeApproval = await db.query.userPreferenceTable.findFirst({
      where: and(
        eq(schema.userPreferenceTable.personId, person.id),
        eq(schema.userPreferenceTable.key, "pinned_view_ids"),
      ),
    });
    expect(pinnedBeforeApproval?.value).toEqual([created.id]);

    const assertedVersion = Number(
      (pendingRow?.targetVersions as Record<string, unknown> | undefined)?.[
        created.id
      ],
    );
    const viewBeforeApproval = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(viewBeforeApproval?.updatedAt.getTime()).toBe(assertedVersion);

    const approval = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    const approvalFailure =
      approval.status === 200
        ? ""
        : `${await approval.clone().text()}; pending=${JSON.stringify(await db.query.pendingActionTable.findFirst({ where: eq(schema.pendingActionTable.id, pending.pendingActionId) }))}; view=${JSON.stringify(await db.query.savedViewTable.findFirst({ where: eq(schema.savedViewTable.id, created.id) }))}`;
    expect(approval.status, approvalFailure).toBe(200);
    await expect(approval.json()).resolves.toMatchObject({
      id: pending.pendingActionId,
      state: "executed",
    });
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, created.id),
      }),
    ).toBeUndefined();
    const pinnedAfterApproval = await db.query.userPreferenceTable.findFirst({
      where: and(
        eq(schema.userPreferenceTable.personId, person.id),
        eq(schema.userPreferenceTable.key, "pinned_view_ids"),
      ),
    });
    expect(pinnedAfterApproval?.value).toEqual([]);
    expect(
      await db.query.outboxTable.findFirst({
        where: and(
          eq(schema.outboxTable.kind, "saved_view.deleted"),
          eq(schema.outboxTable.workspaceId, member.workspace.id),
        ),
      }),
    ).toBeDefined();
    expect(
      await db.query.auditLogTable.findFirst({
        where: and(
          eq(schema.auditLogTable.action, "saved_view.deleted"),
          eq(schema.auditLogTable.entityId, created.id),
        ),
      }),
    ).toBeDefined();
  });

  it("invalidates a key-originated saved-view deletion when its key scope is narrowed", async () => {
    const member = await createWorkspaceMember();
    const person = await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${member.user.id}`,
      token: `token-${member.user.id}`,
      userId: member.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Key request with revocable scope",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(createResponse.status).toBe(200);
    const view = (await createResponse.json()) as { id: string };
    const key = await createViewApiKey(member.user.id, {
      saved_view: ["create"],
    });
    const deletion = await app.request(`/api/views/${view.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${key.rawKey}` },
    });
    expect(deletion.status).toBe(202);
    const pending = (await deletion.json()) as { pendingActionId: string };

    await db
      .update(schema.apikeyTable)
      .set({ permissions: JSON.stringify({ saved_view: ["read"] }) })
      .where(eq(schema.apikeyTable.id, key.id));

    const approval = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approval.status).toBe(409);
    expect(
      await db.query.pendingActionTable.findFirst({
        where: eq(schema.pendingActionTable.id, pending.pendingActionId),
      }),
    ).toMatchObject({
      requestedByPersonId: person.id,
      state: "invalidated",
      invalidationReason: "capability_removed",
    });
    expect(
      await db.query.outboxTable.findFirst({
        where: eq(schema.outboxTable.kind, "pending_action.decided"),
      }),
    ).toMatchObject({
      payload: {
        payload: {
          outcome: "invalidated",
          invalidationReason: "capability_removed",
        },
      },
    });
    expect(
      await db.query.auditLogTable.findFirst({
        where: and(
          eq(schema.auditLogTable.action, "pending_action.decided"),
          eq(schema.auditLogTable.entityId, pending.pendingActionId),
        ),
      }),
    ).toMatchObject({
      action: "pending_action.decided",
      after: {
        state: "invalidated",
        invalidationReason: "capability_removed",
      },
    });
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, view.id),
      }),
    ).toBeDefined();
  });

  it("invalidates pending deletion when the saved view changes before approval", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${member.user.id}`,
      token: `token-${member.user.id}`,
      userId: member.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Changed before approval",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { id: string };
    const deleteResponse = await app.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(202);
    const pending = (await deleteResponse.json()) as {
      pendingActionId: string;
    };

    await db
      .update(schema.savedViewTable)
      .set({
        name: "Changed after request",
        updatedAt: new Date(Date.now() + 1_000),
      })
      .where(eq(schema.savedViewTable.id, created.id));
    const approval = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/approve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(approval.status).toBe(409);
    const [invalidated] = await db
      .select()
      .from(schema.pendingActionTable)
      .where(eq(schema.pendingActionTable.id, pending.pendingActionId));
    expect(invalidated).toMatchObject({
      state: "invalidated",
      invalidationReason: "version_changed",
    });
    const remaining = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(remaining?.name).toBe("Changed after request");
  });

  it("cancels a saved-view deletion without removing its view or pin and permits a fresh request", async () => {
    const member = await createWorkspaceMember();
    const person = await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const now = new Date();
    await db.insert(schema.sessionTable).values({
      id: `session-${member.user.id}`,
      token: `token-${member.user.id}`,
      userId: member.user.id,
      portal: "agent",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: now,
      updatedAt: now,
    });
    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Keep after cancelling",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(createResponse.status).toBe(200);
    const view = (await createResponse.json()) as { id: string };
    const pinResponse = await app.request(`/api/views/${view.id}/pin`, {
      method: "POST",
    });
    expect(pinResponse.status).toBe(200);

    const deleteResponse = await app.request(`/api/views/${view.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(202);
    const pending = (await deleteResponse.json()) as {
      pendingActionId: string;
    };
    const cancelResponse = await app.request(
      `/api/me/pending-actions/${pending.pendingActionId}/cancel`,
      { method: "POST" },
    );
    expect(cancelResponse.status, await cancelResponse.clone().text()).toBe(
      200,
    );
    await expect(cancelResponse.json()).resolves.toMatchObject({
      id: pending.pendingActionId,
      state: "cancelled",
    });
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, view.id),
      }),
    ).toBeDefined();
    const preference = await db.query.userPreferenceTable.findFirst({
      where: and(
        eq(schema.userPreferenceTable.personId, person.id),
        eq(schema.userPreferenceTable.key, "pinned_view_ids"),
      ),
    });
    expect(preference?.value).toEqual([view.id]);

    const freshDelete = await app.request(`/api/views/${view.id}`, {
      method: "DELETE",
    });
    expect(freshDelete.status).toBe(202);
    const freshPending = (await freshDelete.json()) as {
      pendingActionId: string;
    };
    expect(freshPending.pendingActionId).not.toBe(pending.pendingActionId);
    const deletedEvents = await db.query.outboxTable.findMany({
      where: and(
        eq(schema.outboxTable.kind, "saved_view.deleted"),
        eq(schema.outboxTable.workspaceId, member.workspace.id),
      ),
    });
    expect(deletedEvents).toHaveLength(0);
  });

  it("toggles a view's pin state, persisted per person per workspace", async () => {
    const member = await createWorkspaceMember();
    const person = await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Pin me",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    const secondCreateResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Not pinned",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const secondCreated = (await secondCreateResponse.json()) as { id: string };

    const pinResponse = await app.request(`/api/views/${created.id}/pin`, {
      method: "POST",
    });
    expect(pinResponse.status).toBe(200);
    expect(
      (await pinResponse.json()) as { pinnedViewIds: string[] },
    ).toMatchObject({ pinnedViewIds: [created.id] });

    const persisted = await db.query.userPreferenceTable.findFirst({
      where: (row, { eq }) => eq(row.personId, person.id),
    });
    expect(persisted?.value).toEqual([created.id]);
    const firstPinAudit = await db.query.auditLogTable.findFirst({
      where: (row, { and, eq }) =>
        and(eq(row.action, "saved_view.pinned"), eq(row.entityId, created.id)),
    });
    expect(firstPinAudit).toMatchObject({
      actorId: member.user.id,
      action: "saved_view.pinned",
      entityType: "saved_view",
      entityId: created.id,
      workspaceId: member.workspace.id,
      before: { pinned: false },
      after: { pinned: true },
    });

    // GET /api/views is the persisted read/restore path: callers can restore sidebar
    // pin state and pinned items are ordered before unpinned items after a reload.
    const restoredResponse = await app.request(
      `/api/views?workspaceId=${member.workspace.id}`,
    );
    const restored = (await restoredResponse.json()) as {
      id: string;
      isPinned: boolean;
    }[];
    expect(restored[0]).toMatchObject({ id: created.id, isPinned: true });
    expect(
      restored.find((view) => view.id === secondCreated.id)?.isPinned,
    ).toBe(false);

    const unpinResponse = await app.request(`/api/views/${created.id}/pin`, {
      method: "POST",
    });
    expect(
      (await unpinResponse.json()) as { pinnedViewIds: string[] },
    ).toMatchObject({ pinnedViewIds: [] });

    const unpinnedListResponse = await app.request(
      `/api/views?workspaceId=${member.workspace.id}`,
    );
    const unpinnedList = (await unpinnedListResponse.json()) as {
      id: string;
      isPinned: boolean;
    }[];
    expect(unpinnedList.find((view) => view.id === created.id)?.isPinned).toBe(
      false,
    );
    const pinAudits = await db
      .select({
        before: schema.auditLogTable.before,
        after: schema.auditLogTable.after,
      })
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "saved_view.pinned"),
          eq(schema.auditLogTable.entityId, created.id),
        ),
      )
      .orderBy(schema.auditLogTable.seq);
    expect(pinAudits).toEqual([
      { before: { pinned: false }, after: { pinned: true } },
      { before: { pinned: true }, after: { pinned: false } },
    ]);
  });

  it("refuses to pin a private view the caller cannot read", async () => {
    const owner = await createWorkspaceMember();
    await addPerson(owner.user.id);
    const otherUserId = `user-view-pin-outsider-${randomUUID()}`;
    const other = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: otherUserId,
          email: `${otherUserId}@example.com`,
          emailVerified: true,
          name: "Pin Outsider",
        })
        .returning(),
      "pin outsider user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: other.id,
      role: "member",
      joinedAt: new Date(),
    });
    const outsiderPerson = await addPerson(other.id);

    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const createResponse = await ownerApp.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "Private pinned view",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(other);
    const { app: otherApp } = createApp();
    const pinResponse = await otherApp.request(`/api/views/${created.id}/pin`, {
      method: "POST",
    });
    expect(pinResponse.status).toBe(404);
    const preference = await db.query.userPreferenceTable.findFirst({
      where: eq(schema.userPreferenceTable.personId, outsiderPerson.id),
    });
    expect(preference).toBeUndefined();
  });

  it("refuses team deletion while a shared view references the team (TM-7)", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    await addPerson(member.user.id);
    const teamId = `team-view-delete-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Saved View Team",
      workspaceId: member.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `team-member-view-delete-${randomUUID()}`,
      teamId,
      userId: member.user.id,
      createdAt: new Date(),
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Team-owned view",
        scope: "workspace",
        scopeId: member.workspace.id,
        visibility: "team",
        sharedWithTeamId: teamId,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { id: string };

    // TM-7 says deletion is refused while the team owns a shared view. The restrictive
    // FK enforces that invariant and avoids SET NULL violating the view's visibility CHECK.
    await expect(
      db.delete(schema.teamTable).where(eq(schema.teamTable.id, teamId)),
    ).rejects.toThrow();
    const survivingView = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(survivingView).toMatchObject({
      visibility: "team",
      sharedWithTeamId: teamId,
    });

    // A workspace deletion cascades both rows from their workspace parents; NO ACTION
    // permits that single-statement cleanup, unlike an immediate RESTRICT action.
    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, member.workspace.id));
    expect(
      await db.query.teamTable.findFirst({
        where: eq(schema.teamTable.id, teamId),
      }),
    ).toBeUndefined();
    expect(
      await db.query.savedViewTable.findFirst({
        where: eq(schema.savedViewTable.id, created.id),
      }),
    ).toBeUndefined();
  });

  // HIGH: `update-view.ts`'s `sharedWithTeamId` check only verified team membership, not
  // that the team belongs to the VIEW's own workspace -- a view owner in workspace B who
  // happens to be a member of a team in unrelated workspace A could re-share their own
  // view into that foreign team, leaking it (including its stored query) to every member
  // of A's team. Mirrors `create-view.ts`'s `assertScopeBelongsToWorkspace`-adjacent
  // team-membership-plus-workspace check.
  it("rejects sharing a view with a team from a different workspace, even if the caller is a member of that team", async () => {
    const owner = await createWorkspaceMember({
      role: "admin",
      workspaceName: "Workspace B",
    });
    await addPerson(owner.user.id);

    // An unrelated workspace A, containing the team the caller happens to belong to.
    const foreignWorkspace = await createWorkspaceMember({
      workspaceName: "Workspace A",
    });
    const foreignTeamId = `team-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: foreignTeamId,
      name: "Foreign Team",
      workspaceId: foreignWorkspace.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `tm-${randomUUID()}`,
      teamId: foreignTeamId,
      userId: owner.user.id,
      createdAt: new Date(),
    });

    mockAuthenticatedSession(owner.user);
    const { app } = createApp();

    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "My private view",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    const updateResponse = await app.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visibility: "team",
        sharedWithTeamId: foreignTeamId,
      }),
    });
    expect([400, 403]).toContain(updateResponse.status);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted?.sharedWithTeamId).toBeNull();
    expect(persisted?.visibility).toBe("private");
  });

  it("lets workspace administrators edit and request deletion of another member's view", async () => {
    const owner = await createWorkspaceMember({ role: "member" });
    await addPerson(owner.user.id);

    const adminUserId = `user-${randomUUID()}`;
    const admin = requireRow(
      await db
        .insert(schema.userTable)
        .values({
          id: adminUserId,
          email: `${adminUserId}@example.com`,
          emailVerified: true,
          name: "Workspace Admin",
        })
        .returning(),
      "admin user",
    );
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: owner.workspace.id,
      userId: admin.id,
      role: "admin",
      joinedAt: new Date(),
    });
    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: owner.workspace.id,
      role: "admin",
      permission: JSON.stringify(defaultRolePayloads.admin),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    await addPerson(admin.id);
    const teamId = `team-view-admin-share-${randomUUID()}`;
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "Admin Share Team",
      workspaceId: owner.workspace.id,
      createdAt: new Date(),
    });
    await db.insert(schema.teamMemberTable).values({
      id: `team-member-view-admin-share-${randomUUID()}`,
      teamId,
      userId: admin.id,
      createdAt: new Date(),
    });

    mockAuthenticatedSession(owner.user);
    const { app: ownerApp } = createApp();
    const createResponse = await ownerApp.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: owner.workspace.id,
        name: "Owner's view",
        scope: "workspace",
        scopeId: owner.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };

    mockAuthenticatedSession(admin);
    const { app: adminApp } = createApp();

    const updateResponse = await adminApp.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed by admin" }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()) as { name: string }).toMatchObject({
      name: "Renamed by admin",
    });

    const shareResponse = await adminApp.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visibility: "team",
        sharedWithTeamId: teamId,
      }),
    });
    expect(shareResponse.status).toBe(200);
    const updateAudits = await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.action, "saved_view.updated"),
          eq(schema.auditLogTable.entityId, created.id),
        ),
      );
    const shareAudit = updateAudits.find(
      (row) =>
        (row.after as { visibility?: string } | null)?.visibility === "team",
    );
    expect(shareAudit).toBeDefined();
    expect(shareAudit?.before).toMatchObject({
      visibility: "private",
      sharedWithTeamId: null,
    });
    expect(shareAudit?.after).toMatchObject({
      visibility: "team",
      sharedWithTeamId: teamId,
    });

    const unshareResponse = await adminApp.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visibility: "private" }),
    });
    expect(unshareResponse.status).toBe(200);
    const unshared = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(unshared).toMatchObject({
      visibility: "private",
      sharedWithTeamId: null,
    });
    const reshareResponse = await adminApp.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        visibility: "team",
        sharedWithTeamId: teamId,
      }),
    });
    expect(reshareResponse.status).toBe(200);

    const deleteResponse = await adminApp.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(202);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted).toMatchObject({
      id: created.id,
      name: "Renamed by admin",
      visibility: "team",
      sharedWithTeamId: teamId,
    });
  });

  it("serializes first-time concurrent pins for different views", async () => {
    const member = await createWorkspaceMember();
    const person = await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createView = async (name: string) => {
      const response = await app.request("/api/views", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: member.workspace.id,
          name,
          scope: "workspace",
          scopeId: member.workspace.id,
          layout: "list",
          query: { entity: "work_item" },
        }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { id: string };
    };
    const [first, second] = await Promise.all([
      createView("First concurrent pin"),
      createView("Second concurrent pin"),
    ]);

    const responses = await Promise.all(
      [first, second].map((view) =>
        app.request(`/api/views/${view.id}/pin`, { method: "POST" }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const preference = await db.query.userPreferenceTable.findFirst({
      where: and(
        eq(schema.userPreferenceTable.personId, person.id),
        eq(schema.userPreferenceTable.scope, "workspace"),
        eq(schema.userPreferenceTable.scopeId, member.workspace.id),
        eq(schema.userPreferenceTable.key, "pinned_view_ids"),
      ),
    });
    expect(preference?.value).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
  });

  it("preserves disjoint fields from concurrent partial view updates", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Before concurrent edits",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    expect(createResponse.status).toBe(200);
    const created = (await createResponse.json()) as { id: string };

    const responses = await Promise.all([
      app.request(`/api/views/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Name update" }),
      }),
      app.request(`/api/views/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: {
            entity: "work_item",
            filter: { field: "priority", op: "eq", value: "high" },
          },
        }),
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted?.name).toBe("Name update");
    expect(persisted?.query).toEqual({
      entity: "work_item",
      filter: { field: "priority", op: "eq", value: "high" },
    });
  });

  it("fails closed when a persisted saved query contains unknown execution semantics", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const createResponse = await app.request("/api/views", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: member.workspace.id,
        name: "Future query",
        scope: "workspace",
        scopeId: member.workspace.id,
        layout: "list",
        query: { entity: "work_item" },
      }),
    });
    const created = (await createResponse.json()) as { id: string };
    await db
      .update(schema.savedViewTable)
      .set({ query: { entity: "work_item", futureExecutionMode: "grouped" } })
      .where(eq(schema.savedViewTable.id, created.id));

    const response = await app.request(`/api/views/${created.id}/run`, {
      method: "POST",
    });
    await expectPlainText422(
      response,
      "Saved view query contains unsupported properties",
    );
    const countResponse = await app.request(`/api/views/${created.id}/count`);
    await expectPlainText422(
      countResponse,
      "Saved view query contains unsupported properties",
    );
  });
});
