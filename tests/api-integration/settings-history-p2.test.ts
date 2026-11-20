import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../apps/api/src/audit/repository";
import { entityHistoryRow } from "../../apps/api/src/audit/settings-history";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { buildRoster } from "../../apps/api/src/project/members/roster";
import { loadRosterRows } from "../../apps/api/src/project/members/roster.repository";
import getWorkspaceMembers from "../../apps/api/src/workspace/controllers/get-workspace-members";
import { workspaceMemberSchema } from "../../apps/api/src/workspace/response";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { signUpUser } from "./helpers/organization-http";
import { addMember } from "./helpers/reach-world";
import { addWorkspaceMemberNative } from "./helpers/workspace-membership-write-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

describe("P2 settings history current membership rows", () => {
  beforeEach(async () => resetTestDatabase());

  it("returns the inserted workspace row ID on POST while retaining the user ID", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "P2 members",
    });
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };
    const newcomer = await signUpUser(app);
    const added = await addWorkspaceMemberNative(
      app,
      owner.cookie,
      workspace.id,
      { userId: newcomer.user.id, role: "member" },
    );
    expect(added.status).toBe(200);
    const body = (await added.json()) as {
      joinedAt: string;
      id: string;
      workspaceMemberId: string;
    };
    expect(
      workspaceMemberSchema.safeParse({
        ...body,
        joinedAt: new Date(body.joinedAt),
      }).success,
    ).toBe(true);
    const member = requireRow(
      await db
        .select({ id: schema.workspaceUserTable.id })
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
            eq(schema.workspaceUserTable.userId, newcomer.user.id),
          ),
        )
        .limit(1),
      "added member",
    );
    expect(body).toMatchObject({
      id: newcomer.user.id,
      workspaceMemberId: member.id,
    });
    expect(member.id).not.toBe(newcomer.user.id);
    const listed = await app.request(`/api/workspace/${workspace.id}/members`, {
      headers: { cookie: owner.cookie },
    });
    expect(listed.status).toBe(200);
    const members = (await listed.json()) as Array<{
      id: string;
      workspaceMemberId: string;
    }>;
    expect(
      members.find((row) => row.id === newcomer.user.id)?.workspaceMemberId,
    ).toBe(member.id);
  });

  it("exposes workspace row IDs and hides no-op, removal and revoked-row history and actor names", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected staff identity");
    const member = requireRow(
      await db
        .select()
        .from(schema.workspaceUserTable)
        .where(
          and(
            eq(schema.workspaceUserTable.workspaceId, workspace.id),
            eq(schema.workspaceUserTable.userId, user.id),
          ),
        )
        .limit(1),
      "workspace member",
    );
    const wire = (await getWorkspaceMembers(workspace.id)).find(
      (row) => row.id === user.id,
    );
    expect(workspaceMemberSchema.safeParse(wire).success).toBe(true);
    expect(wire?.workspaceMemberId).toBe(member.id);
    expect(wire?.id).toBe(user.id);
    expect(wire?.workspaceMemberId).not.toBe(user.id);
    const duplicate = requireRow(
      await db
        .insert(schema.workspaceUserTable)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
          joinedAt: new Date(),
        })
        .returning(),
      "duplicate workspace member",
    );
    expect(
      new Set(
        (await getWorkspaceMembers(workspace.id))
          .filter((row) => row.id === user.id)
          .map((row) => row.workspaceMemberId),
      ),
    ).toEqual(new Set([member.id, duplicate.id]));
    for (const [beforeRole, afterRole, kind] of [
      ["member", "admin", "member_role_changed"],
      ["admin", "admin", "member_role_changed"],
      ["admin", "member", "member_removed"],
    ] as const)
      await appendAuditLog(db, {
        actorId: user.id,
        actorType: "person",
        workspaceId: workspace.id,
        action: "membership.changed",
        entityType: "workspace_member",
        entityId: user.id,
        before: { role: beforeRole },
        after: {
          kind,
          userId: user.id,
          role: afterRole,
          privateValue: "never return",
        },
      });
    const input = {
      identity,
      entityType: "workspace_member" as const,
      entityId: member.id,
      auditEntityId: user.id,
      workspaceId: workspace.id,
      projectId: null,
    };
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, duplicate.id));
    expect(
      requireRow(
        await db
          .select({ id: schema.workspaceUserTable.id })
          .from(schema.workspaceUserTable)
          .where(eq(schema.workspaceUserTable.id, member.id))
          .limit(1),
        "original workspace member",
      ).id,
    ).toBe(member.id);
    const rows = await listSettingsHistoryRows(input);
    expect(rows).toHaveLength(1);
    const names = await listSettingsHistoryActorNames(input, [user.id]);
    expect(names.get(user.id)).toBe(user.name);
    const projected = entityHistoryRow(
      rows[0] as NonNullable<(typeof rows)[number]>,
      names.get(user.id) ?? null,
    );
    expect(projected.changedFields).toEqual(["role"]);
    expect(JSON.stringify(projected)).not.toContain("never return");
    expect(JSON.stringify(projected)).not.toContain(member.id);
    await db
      .delete(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.id, member.id));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
  });

  it("exposes only a current direct-grant row ID and rechecks it for rows and actor names", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const target = await addMember(workspace.id, "member");
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const role = await grantProjectRole(target.user.id, project.id, [
      "project:read",
    ]);
    const membership = requireRow(
      await db
        .select()
        .from(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, target.personId),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, project.id),
          ),
        )
        .limit(1),
      "project membership",
    );
    const grant = requireRow(
      await db
        .insert(schema.membershipGrantTable)
        .values({
          membershipId: null,
          personId: target.personId,
          scope: "project",
          scopeId: project.id,
          roleId: role.id,
          sourceKind: "direct",
          directOrigin: "system_backfill",
        })
        .returning(),
      "direct grant",
    );
    const unbacked =
      (await loadRosterRows(db, [project.id])).get(project.id) ?? [];
    expect(
      buildRoster({ direct: unbacked, ancestors: [] }).find(
        (entry) => entry.personId === target.personId,
      )?.membershipId,
    ).toBeNull();
    await db
      .update(schema.membershipGrantTable)
      .set({ membershipId: membership.id })
      .where(eq(schema.membershipGrantTable.id, grant.id));
    const backed =
      (await loadRosterRows(db, [project.id])).get(project.id) ?? [];
    expect(
      buildRoster({ direct: backed, ancestors: [] }).find(
        (entry) => entry.personId === target.personId,
      )?.membershipId,
    ).toBe(membership.id);

    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected staff identity");
    for (const [beforeRole, afterRole, change] of [
      ["project-member", "project-lead", "role_changed"],
      ["project-lead", "project-lead", "role_changed"],
      ["project-lead", "project-member", "removed"],
    ] as const)
      await appendAuditLog(db, {
        actorId: user.id,
        actorType: "person",
        workspaceId: workspace.id,
        projectId: project.id,
        action: "membership.changed",
        entityType: "membership",
        entityId: target.personId,
        before: { scope: "project", scopeId: project.id, role: beforeRole },
        after: {
          source: "project_roster",
          change,
          scope: "project",
          scopeId: project.id,
          role: afterRole,
          granted: change !== "removed",
          privateValue: "never return",
        },
      });
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: project.id,
      action: "membership.changed",
      entityType: "membership",
      entityId: target.personId,
      before: { scope: "project", scopeId: project.id, role: "project-member" },
      after: {
        source: "identity_sync",
        change: "role_changed",
        scope: "project",
        scopeId: project.id,
        role: "project-lead",
        granted: true,
      },
    });
    const input = {
      identity,
      entityType: "project_membership" as const,
      entityId: membership.id,
      auditEntityId: target.personId,
      workspaceId: workspace.id,
      projectId: project.id,
    };
    const rows = await listSettingsHistoryRows(input);
    expect(rows).toHaveLength(1);
    const names = await listSettingsHistoryActorNames(input, [user.id]);
    expect(names.get(user.id)).toBe(user.name);
    expect(
      entityHistoryRow(
        rows[0] as NonNullable<(typeof rows)[number]>,
        names.get(user.id) ?? null,
      ).changedFields,
    ).toEqual(["role"]);

    await db
      .update(schema.membershipGrantTable)
      .set({ membershipId: null })
      .where(eq(schema.membershipGrantTable.id, grant.id));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
    await db
      .update(schema.membershipGrantTable)
      .set({ membershipId: membership.id, revokedAt: new Date() })
      .where(eq(schema.membershipGrantTable.id, grant.id));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(
      buildRoster({
        direct: (await loadRosterRows(db, [project.id])).get(project.id) ?? [],
        ancestors: [],
      }).find((entry) => entry.personId === target.personId)?.membershipId,
    ).toBeNull();

    const destination = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.membershipGrantTable)
      .set({ revokedAt: null })
      .where(eq(schema.membershipGrantTable.id, grant.id));
    await db
      .update(schema.projectTable)
      .set({ workspaceId: destination.workspace.id })
      .where(eq(schema.projectTable.id, project.id));
    const destinationIdentity = await resolveIdentity({
      userId: destination.user.id,
      credential: "session",
    });
    if (!destinationIdentity)
      throw new Error("Expected destination staff identity");
    const movedInput = {
      ...input,
      identity: destinationIdentity,
      workspaceId: destination.workspace.id,
    };
    expect(await listSettingsHistoryRows(movedInput)).toEqual([]);
    expect(await listSettingsHistoryActorNames(movedInput, [user.id])).toEqual(
      new Map(),
    );
    await appendAuditLog(db, {
      actorId: destination.user.id,
      actorType: "person",
      workspaceId: destination.workspace.id,
      projectId: project.id,
      action: "membership.changed",
      entityType: "membership",
      entityId: target.personId,
      before: { scope: "project", scopeId: project.id, role: "project-member" },
      after: {
        source: "project_roster",
        change: "role_changed",
        scope: "project",
        scopeId: project.id,
        role: "project-lead",
        granted: true,
      },
    });
    expect(await listSettingsHistoryRows(movedInput)).toHaveLength(1);
  });
});
