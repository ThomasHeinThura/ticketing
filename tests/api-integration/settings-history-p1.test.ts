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
import { automationTable } from "../../apps/api/src/database/schema";
import {
  budgetTable,
  costTypeTable,
  hourlyRateTable,
  timeActivityTable,
} from "../../apps/api/src/database/schema-p5-time";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

describe("P1 settings history current target and closed projection", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("binds all six current row types, workspace/project scopes and closed actions", async () => {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: workspace.id,
    });
    await grantProjectRole(user.id, project.id, [
      "project:read",
      "budget:read",
    ]);
    const identity = await resolveIdentity({
      userId: user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing staff identity");
    const role = requireRow(
      await db
        .select({ id: schema.roleTable.id })
        .from(schema.roleTable)
        .where(
          and(
            eq(schema.roleTable.workspaceId, workspace.id),
            eq(schema.roleTable.scope, "workspace"),
          ),
        )
        .limit(1),
      "workspace role",
    );
    const workspaceRule = requireRow(
      await db
        .insert(automationTable)
        .values({
          workspaceId: workspace.id,
          projectId: null,
          name: "Private workspace rule",
          trigger: "work_item.created",
          effectiveRoleId: role.id,
          createdBy: identity.personId,
        })
        .returning(),
      "workspace automation",
    );
    const projectRule = requireRow(
      await db
        .insert(automationTable)
        .values({
          workspaceId: workspace.id,
          projectId: project.id,
          name: "Private project rule",
          trigger: "work_item.created",
          effectiveRoleId: role.id,
          createdBy: identity.personId,
        })
        .returning(),
      "project automation",
    );
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: workspace.id,
          key: `p1-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
        })
        .returning(),
      "state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId: project.id, stateTemplateId: template.id })
        .returning(),
      "state",
    );
    const activity = requireRow(
      await db
        .insert(timeActivityTable)
        .values({ workspaceId: workspace.id, name: "Private activity" })
        .returning(),
      "activity",
    );
    const costType = requireRow(
      await db
        .insert(costTypeTable)
        .values({
          workspaceId: workspace.id,
          name: "Private cost",
          currency: "USD",
        })
        .returning(),
      "cost type",
    );
    const rate = requireRow(
      await db
        .insert(hourlyRateTable)
        .values({
          workspaceId: workspace.id,
          projectId: project.id,
          personId: identity.personId,
          rateMinor: 12000,
          currency: "USD",
          effectiveFrom: "2026-11-17",
        })
        .returning(),
      "rate",
    );
    const budget = requireRow(
      await db
        .insert(budgetTable)
        .values({
          workspaceId: workspace.id,
          projectId: project.id,
          name: "Private budget",
          plannedAmountMinor: 15000,
          currency: "USD",
          periodStart: "2026-11-01",
          periodEnd: "2026-11-30",
        })
        .returning(),
      "budget",
    );
    const cases = [
      {
        entityType: "automation",
        entityId: workspaceRule.id,
        projectId: null,
        action: "automation.created",
        before: null,
        after: { name: "Private workspace rule" },
        fields: [],
      },
      {
        entityType: "automation",
        entityId: projectRule.id,
        projectId: project.id,
        action: "automation.updated",
        before: { name: "old" },
        after: { name: "Private project rule" },
        fields: ["name"],
      },
      {
        entityType: "state",
        entityId: state.id,
        projectId: project.id,
        action: "state.wip_limit_changed",
        before: { wipLimit: 1 },
        after: { wipLimit: 2 },
        fields: ["wipLimit"],
      },
      {
        entityType: "time_activity",
        entityId: activity.id,
        projectId: null,
        action: "time_activity.created",
        before: null,
        after: { name: "Private activity" },
        fields: ["name"],
      },
      {
        entityType: "cost_type",
        entityId: costType.id,
        projectId: null,
        action: "cost_type.created",
        before: null,
        after: {
          name: "Private cost",
          unit: "unit",
          currency: "USD",
          billable: true,
          hasDefaultRate: false,
        },
        fields: ["name", "unit", "currency", "billable", "hasDefaultRate"],
      },
      {
        entityType: "hourly_rate",
        entityId: rate.id,
        projectId: project.id,
        action: "hourly_rate.created",
        before: null,
        after: {
          rateSet: true,
          personId: identity.personId,
          effectiveFrom: "2026-11-17",
        },
        fields: ["rateSet"],
      },
      {
        entityType: "budget",
        entityId: budget.id,
        projectId: project.id,
        action: "budget.created",
        before: null,
        after: { name: "Private budget", plannedAmountMinor: 15000 },
        fields: [],
      },
    ] as const;
    for (const item of cases) {
      await appendAuditLog(db, {
        actorId: user.id,
        actorType: "person",
        workspaceId: workspace.id,
        projectId: item.projectId,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        before: item.before,
        after: item.after,
      });
      const input = {
        identity,
        entityType: item.entityType,
        entityId: item.entityId,
        workspaceId: workspace.id,
        projectId: item.projectId,
      };
      const rows = await listSettingsHistoryRows(input);
      expect(rows).toHaveLength(1);
      const names = await listSettingsHistoryActorNames(input, [user.id]);
      expect(names.get(user.id)).toBe(user.name);
      const projected = entityHistoryRow(
        rows[0] as NonNullable<(typeof rows)[number]>,
        names.get(user.id) ?? null,
      );
      expect(projected.changedFields).toEqual(item.fields);
      expect(JSON.stringify(projected)).not.toContain("Private");
      expect(JSON.stringify(projected)).not.toContain(identity.personId);
      expect(JSON.stringify(projected)).not.toContain("15000");
    }
    await appendAuditLog(db, {
      actorId: user.id,
      actorType: "person",
      workspaceId: workspace.id,
      projectId: null,
      action: "automation.updated",
      entityType: "automation",
      entityId: projectRule.id,
      before: { name: "old" },
      after: { name: "wrong scope" },
    });
    expect(
      await listSettingsHistoryRows({
        identity,
        entityType: "automation",
        entityId: projectRule.id,
        workspaceId: workspace.id,
        projectId: project.id,
      }),
    ).toHaveLength(1);
  });

  it("hides a moved project's old state history and actor name, then honours revocation", async () => {
    const first = await createWorkspaceMember({ role: "owner" });
    const second = await createWorkspaceMember({ role: "owner" });
    const { project } = await createProjectFixture({
      workspaceId: first.workspace.id,
    });
    const template = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: first.workspace.id,
          key: `p1-${randomUUID()}`,
          name: "Backlog",
          group: "backlog",
        })
        .returning(),
      "state template",
    );
    const state = requireRow(
      await db
        .insert(schema.stateTable)
        .values({ projectId: project.id, stateTemplateId: template.id })
        .returning(),
      "state",
    );
    await appendAuditLog(db, {
      actorId: first.user.id,
      actorType: "person",
      workspaceId: first.workspace.id,
      projectId: project.id,
      action: "state.wip_limit_changed",
      entityType: "state",
      entityId: state.id,
      before: { wipLimit: null },
      after: { wipLimit: 2 },
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
      action: "state.wip_limit_changed",
      entityType: "state",
      entityId: state.id,
      before: { wipLimit: 2 },
      after: { wipLimit: 3 },
    });
    const identity = await resolveIdentity({
      userId: first.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("Missing staff identity");
    const input = {
      identity,
      entityType: "state" as const,
      entityId: state.id,
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
    await db
      .delete(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, second.workspace.id),
          eq(schema.workspaceUserTable.userId, first.user.id),
        ),
      );
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(
      await listSettingsHistoryActorNames(input, [second.user.id]),
    ).toEqual(new Map());
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: second.workspace.id,
      userId: first.user.id,
      role: "owner",
      joinedAt: new Date(),
    });
    expect(await listSettingsHistoryRows(input)).toHaveLength(1);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, project.id));
    expect(await listSettingsHistoryRows(input)).toEqual([]);
    expect(
      await listSettingsHistoryActorNames(input, [second.user.id]),
    ).toEqual(new Map());
  });
});
