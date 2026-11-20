import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../apps/api/src/audit/repository";
import db, { schema } from "../../apps/api/src/database";
import { apiKeyExtensionTable } from "../../apps/api/src/database/schema";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { servicePrincipalFromFacts } from "../../apps/api/src/permissions/service-principal";
import { setProjectParent } from "../../apps/api/src/project/hierarchy.repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createProjectLimitedWorkspaceMember,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

describe("settings history rechecks current reach at each data SELECT", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("hides workspace rows and correlated actor names after membership revocation", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected staff identity");
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      action: "workspace.settings_updated",
      entityType: "workspace",
      entityId: workspace.id,
      after: { changedFields: ["name"] },
    });
    const input = {
      identity,
      entityType: "workspace" as const,
      entityId: workspace.id,
      workspaceId: workspace.id,
    };
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);
    expect(
      (await listSettingsHistoryActorNames(input, [user.id])).get(user.id),
    ).toBe(user.name);

    // Retain the identity resolved by the earlier request guard, then remove its grant.
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.userId, user.id),
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
  });

  it("hides project history after its direct project membership is revoked", async () => {
    const { user, workspace } = await createProjectLimitedWorkspaceMember({
      role: "admin",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, ["project:manage_settings"]);
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected staff identity");
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: project.id,
      action: "project.general_settings_updated",
      entityType: "project",
      entityId: project.id,
      after: { changedFields: ["name"] },
    });
    const input = {
      identity,
      entityType: "project" as const,
      entityId: project.id,
      workspaceId: workspace.id,
      projectId: project.id,
    };
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, identity.personId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
  });

  it("hides owner-team history after team removal or workspace revocation", async () => {
    const { user, workspace } = await createProjectLimitedWorkspaceMember({
      role: "admin",
    });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const teamId = `team-${randomUUID()}`;
    const teamMemberId = `team-member-${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.teamTable).values({
      id: teamId,
      name: "History owner team",
      workspaceId: workspace.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.teamMemberTable).values({
      id: teamMemberId,
      teamId,
      userId: user.id,
      createdAt: now,
    });
    await db
      .update(schema.projectTable)
      .set({ ownerTeamId: teamId })
      .where(eq(schema.projectTable.id, project.id));
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity?.teamIds.includes(teamId))
      throw new Error("Expected owner-team reach");
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: project.id,
      action: "project.general_settings_updated",
      entityType: "project",
      entityId: project.id,
      after: { changedFields: ["name"] },
    });
    const input = {
      identity,
      entityType: "project" as const,
      entityId: project.id,
      workspaceId: workspace.id,
      projectId: project.id,
    };
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);

    await db
      .delete(schema.teamMemberTable)
      .where(eq(schema.teamMemberTable.id, teamMemberId));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );

    await db.insert(schema.teamMemberTable).values({
      id: teamMemberId,
      teamId,
      userId: user.id,
      createdAt: now,
    });
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      );
    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.scope, "workspace"),
          eq(schema.membershipTable.scopeId, workspace.id),
          eq(schema.membershipTable.personId, identity.personId),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
  });

  it("preserves inherited project reach and current instance-admin reach", async () => {
    const member = await createProjectLimitedWorkspaceMember({ role: "admin" });
    const parent = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const child = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await setProjectParent(db, child.project.id, parent.project.id);
    await grantProjectRole(member.user.id, parent.project.id, [
      "project:manage_settings",
    ]);
    await appendAuditLog(db, {
      actorId: member.user.id,
      actorType: "person",
      workspaceId: member.workspace.id,
      projectId: child.project.id,
      action: "project.general_settings_updated",
      entityType: "project",
      entityId: child.project.id,
      after: { changedFields: ["name"] },
    });
    const inherited = await resolveIdentity({
      userId: member.user.id,
      credential: "session",
    });
    if (!inherited) throw new Error("Expected inherited identity");
    const target = {
      entityType: "project" as const,
      entityId: child.project.id,
      workspaceId: member.workspace.id,
      projectId: child.project.id,
    };
    expect(
      await listSettingsHistoryRows({ ...target, identity: inherited }),
    ).toHaveLength(1);

    const admin = await createWorkspaceMember({ role: "member" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, admin.user.id));
    const instanceAdmin = await resolveIdentity({
      userId: admin.user.id,
      credential: "session",
    });
    if (instanceAdmin?.reach.kind !== "all")
      throw new Error("Expected instance administrator");
    expect(
      await listSettingsHistoryRows({ ...target, identity: instanceAdmin }),
    ).toHaveLength(1);
  });

  it("keeps moved-project history inside its current workspace", async () => {
    const first = await createWorkspaceMember({ role: "owner" });
    const second = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: first.workspace.id,
    });
    await appendAuditLog(db, {
      actorId: first.user.id,
      actorType: "person",
      workspaceId: first.workspace.id,
      projectId: project.id,
      action: "project.general_settings_updated",
      entityType: "project",
      entityId: project.id,
      after: { changedFields: ["name"] },
    });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: second.workspace.id,
      userId: first.user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    await db
      .update(schema.projectTable)
      .set({ workspaceId: second.workspace.id })
      .where(eq(schema.projectTable.id, project.id));
    await appendAuditLog(db, {
      actorId: second.user.id,
      actorType: "person",
      workspaceId: second.workspace.id,
      projectId: project.id,
      action: "project.general_settings_updated",
      entityType: "project",
      entityId: project.id,
      after: { changedFields: ["name"] },
    });
    const identity = await resolveIdentity({
      userId: first.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Expected staff identity");
    const input = {
      identity,
      entityType: "project" as const,
      entityId: project.id,
      workspaceId: second.workspace.id,
      projectId: project.id,
    };
    const rows = await listSettingsHistoryRows(input);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspaceId).toBe(second.workspace.id);
    const names = await listSettingsHistoryActorNames(input, [
      first.user.id,
      second.user.id,
    ]);
    expect(names.has(first.user.id)).toBe(false);
    expect(names.get(second.user.id)).toBe(second.user.name);
  });

  it("hides service-key workspace rows and actor names after the key is disabled", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const keyId = `key-${randomUUID()}`;
    const now = new Date();
    await db.insert(schema.apikeyTable).values({
      id: keyId,
      referenceId: user.id,
      userId: user.id,
      name: "history test key",
      key: `opaque-${keyId}`,
      permissions: JSON.stringify({ workspace: ["manage_settings"] }),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(apiKeyExtensionTable).values({
      apikeyId: keyId,
      workspaceId: workspace.id,
      capabilities: ["workspace:manage_settings"],
    });
    const identity = servicePrincipalFromFacts({
      apiKeyId: keyId,
      workspaceId: workspace.id,
      capabilities: ["workspace:manage_settings"],
      organisationId: workspace.organisationId,
    });
    if (!identity) throw new Error("Expected service identity");
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      action: "workspace.settings_updated",
      entityType: "workspace",
      entityId: workspace.id,
      after: { changedFields: ["name"] },
    });
    const input = {
      identity,
      entityType: "workspace" as const,
      entityId: workspace.id,
      workspaceId: workspace.id,
    };
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: project.id,
      action: "project.general_settings_updated",
      entityType: "project",
      entityId: project.id,
      after: { changedFields: ["name"] },
    });
    expect(
      await listSettingsHistoryRows({
        identity,
        entityType: "project",
        entityId: project.id,
        workspaceId: workspace.id,
        projectId: project.id,
      }),
    ).toEqual([]);
    await db
      .update(schema.apikeyTable)
      .set({ enabled: false })
      .where(eq(schema.apikeyTable.id, keyId));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
  });
});
