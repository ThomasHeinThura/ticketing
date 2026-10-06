import { randomUUID } from "node:crypto";
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
import { createWorkspaceMember, requireRow } from "./helpers/fixtures";

/** `saved_view.created_by`/`user_preference.person_id` need a real `person` row for the
 * member's own `user_id` -- `createWorkspaceMember` seeds `workspace_member`, not
 * `person`. */
async function addPerson(userId: string) {
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
    expect(deleteResponse.status).toBe(404);
  });

  it("does not expose saved-view deletion before shared pending-action support exists", async () => {
    const member = await createWorkspaceMember();
    await addPerson(member.user.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

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

    const updateResponse = await app.request(`/api/views/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json()) as { name: string }).toMatchObject({
      name: "Renamed",
    });

    const deleteResponse = await app.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(404);

    const persisted = await db.query.savedViewTable.findFirst({
      where: eq(schema.savedViewTable.id, created.id),
    });
    expect(persisted).toMatchObject({
      id: created.id,
      name: "Renamed",
    });
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

  // LOW: the `workspace:manage_settings` admin-override branch of `assertCanEditView` was
  // reviewed and confirmed correct by hand but had no committed test exercising its
  // edit path -- an admin (holds `workspace:manage_settings` but did not create the view)
  // can edit it. Deletion is not exposed until shared pending-action support exists.
  it("lets workspace administrators edit another member's view while deletion is unavailable", async () => {
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

    const deleteResponse = await adminApp.request(`/api/views/${created.id}`, {
      method: "DELETE",
    });
    expect(deleteResponse.status).toBe(404);

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
});
