import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { appendAuditLog } from "../../apps/api/src/audit/audit-writer";
import {
  listSettingsHistoryActorNames,
  listSettingsHistoryRows,
} from "../../apps/api/src/audit/repository";
import { entityHistoryRow } from "../../apps/api/src/audit/settings-history";
import db, { schema } from "../../apps/api/src/database";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
} from "./helpers/fixtures";

describe("P4 current terminology and estimate history on fresh test database", () => {
  beforeEach(async () => resetTestDatabase());

  it("keeps a reset catalogue cell visible, but hides workspace rows and actors after capability revocation", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    await db
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, user.id));
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing owner identity");
    const cell = "project:agent:en-US";
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: null,
      action: "terminology.changed",
      entityType: "terminology_override",
      entityId: cell,
      before: null,
      after: { scope: "workspace" },
    });
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: null,
      projectId: null,
      action: "terminology.changed",
      entityType: "terminology_override",
      entityId: cell,
      before: null,
      after: { scope: "instance" },
    });
    const input = {
      identity,
      entityType: "terminology_override" as const,
      entityId: cell,
      workspaceId: workspace.id,
      projectId: null,
    };
    const rows = await listSettingsHistoryRows(input);
    expect(rows).toHaveLength(1);
    expect(
      (await listSettingsHistoryActorNames(input, [user.id])).get(user.id),
    ).toBe(user.name);
    expect(
      entityHistoryRow(rows[0] as NonNullable<(typeof rows)[number]>, user.name)
        .changedFields,
    ).toEqual([]);
    const instanceInput = { ...input, workspaceId: null };
    expect(await listSettingsHistoryRows(instanceInput)).toHaveLength(1);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspace.id),
          eq(schema.workspaceUserTable.userId, user.id),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
    expect(await listSettingsHistoryRows(instanceInput)).toHaveLength(1);
    await db
      .update(schema.userTable)
      .set({ role: "user" })
      .where(eq(schema.userTable.id, user.id));
    expect(await listSettingsHistoryRows(instanceInput)).toEqual([]);
    expect(
      await listSettingsHistoryActorNames(instanceInput, [user.id]),
    ).toEqual(new Map());
  });

  it("selects both replacement estimate rows, excludes work-item actions, and rechecks the effective flag and role", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "member" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    const projectRole = await grantProjectRole(user.id, project.id, [
      "project:read",
    ]);
    await db.insert(schema.workspaceFeatureFlagTable).values({
      workspaceId: workspace.id,
      featureKey: "feature.estimates",
      enabled: true,
    });
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing project identity");
    for (const action of [
      "estimate.configured",
      "estimate.system_changed",
    ] as const)
      await appendAuditLog(db, {
        actorId: user.id,
        actorType: "person",
        workspaceId: workspace.id,
        projectId: project.id,
        action,
        entityType: "estimate",
        entityId: `config-${randomUUID()}`,
        before: null,
        after: null,
      });
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: project.id,
      action: "estimate.work_item_set",
      entityType: "work_item",
      entityId: `work-item-${randomUUID()}`,
      before: null,
      after: null,
    });
    const input = {
      identity,
      entityType: "project_estimates" as const,
      entityId: project.id,
      workspaceId: workspace.id,
      projectId: project.id,
    };
    const rows = await listSettingsHistoryRows(input);
    expect(rows).toHaveLength(2);
    expect(
      (await listSettingsHistoryActorNames(input, [user.id])).get(user.id),
    ).toBe(user.name);
    await db
      .update(schema.workspaceFeatureFlagTable)
      .set({ enabled: false })
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, workspace.id),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.estimates"),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
    await db
      .update(schema.workspaceFeatureFlagTable)
      .set({ enabled: true })
      .where(
        and(
          eq(schema.workspaceFeatureFlagTable.workspaceId, workspace.id),
          eq(schema.workspaceFeatureFlagTable.featureKey, "feature.estimates"),
        ),
      );
    await db
      .update(schema.roleTable)
      .set({ capabilities: [] })
      .where(eq(schema.roleTable.id, projectRole.id));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(await listSettingsHistoryActorNames(input, [user.id])).toEqual(
      new Map(),
    );
  });
});
