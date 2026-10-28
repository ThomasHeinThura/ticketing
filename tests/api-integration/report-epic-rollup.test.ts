import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import {
  drillCustomReport,
  runCustomReport,
} from "../../apps/api/src/report/custom";
import { resolveWindow } from "../../apps/api/src/report/logic";
import { resetTestDatabase } from "./helpers/database";
import { type ReportsWorld, reportsWorld } from "./helpers/p5-reports";

let world: ReportsWorld;
beforeEach(async () => {
  await resetTestDatabase();
  world = await reportsWorld();
});

describe("RH-15 epic roll-up in custom reports", () => {
  it("groups stable epic handles, counts the current filter/window, and rolls up the full live subtree", async () => {
    const now = new Date();
    const epicType = (
      await db
        .insert(schema.workItemTypeTable)
        .values({
          workspaceId: world.workspaceId,
          key: `epic-${randomUUID()}`,
          name: "Epic",
          category: "delivery",
          isEpic: true,
        })
        .returning()
    )[0];
    if (!epicType) throw new Error("epic type insert returned no row");

    const epic = await world.addItem({
      createdDaysAgo: 1,
      priority: "high",
      title: "Q3 release",
    });
    const completedChild = await world.addItem({
      createdDaysAgo: 2,
      resolvedDaysAgo: 1,
      priority: "high",
      title: "Shipped story",
    });
    const olderOpenGrandchild = await world.addItem({
      createdDaysAgo: 40,
      priority: "low",
      title: "Older open task",
    });
    const cancelledChild = await world.addItem({
      createdDaysAgo: 40,
      priority: "low",
      title: "Cancelled task",
    });
    const archivedChild = await world.addItem({
      createdDaysAgo: 2,
      resolvedDaysAgo: 1,
      priority: "high",
      title: "Archived story",
    });
    const leafEpic = await world.addItem({
      createdDaysAgo: 1,
      priority: "high",
      title: "Empty epic",
    });
    await world.addItem({
      createdDaysAgo: 1,
      priority: "high",
      title: "Loose item",
    });
    const hiddenParent = await world.addItem({
      createdDaysAgo: 1,
      priority: "low",
      title: "Archived parent",
    });
    const hiddenChild = await world.addItem({
      createdDaysAgo: 1,
      priority: "high",
      title: "Child of archived parent",
    });

    await db
      .update(schema.workItemTable)
      .set({ typeId: epicType.id })
      .where(eq(schema.workItemTable.id, epic.id));
    await db
      .update(schema.workItemTable)
      .set({ typeId: epicType.id })
      .where(eq(schema.workItemTable.id, leafEpic.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: epic.id })
      .where(eq(schema.workItemTable.id, completedChild.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: completedChild.id })
      .where(eq(schema.workItemTable.id, olderOpenGrandchild.id));
    const cancelledTemplate = (
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: world.workspaceId,
          key: `st-cancelled-${randomUUID()}`,
          name: "Cancelled",
          group: "cancelled",
        })
        .returning()
    )[0];
    if (!cancelledTemplate)
      throw new Error("cancelled state template insert returned no row");
    const cancelledState = (
      await db
        .insert(schema.stateTable)
        .values({
          projectId: world.projectA.id,
          stateTemplateId: cancelledTemplate.id,
        })
        .returning()
    )[0];
    if (!cancelledState)
      throw new Error("cancelled state insert returned no row");
    await db
      .update(schema.workItemTable)
      .set({ parentId: epic.id, stateId: cancelledState.id })
      .where(eq(schema.workItemTable.id, cancelledChild.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: epic.id, archivedAt: now })
      .where(eq(schema.workItemTable.id, archivedChild.id));
    await db
      .update(schema.workItemTable)
      .set({ archivedAt: now })
      .where(eq(schema.workItemTable.id, hiddenParent.id));
    await db
      .update(schema.workItemTable)
      .set({ parentId: hiddenParent.id })
      .where(eq(schema.workItemTable.id, hiddenChild.id));

    const identity = await resolveRequestIdentity({
      userId: world.owner.user.id,
    });
    if (!identity) throw new Error("owner identity missing");
    const resolved = resolveWindow({ window: "7" }, now);
    if (!resolved.ok) throw new Error(resolved.reason);
    const query = {
      entity: "work_item" as const,
      groupBy: "epic",
      filter: { priority: "high" },
      aggregate: { fn: "count" },
    };
    const caps = { readAll: true, showRates: false, readAnyTime: false };
    const report = await runCustomReport({
      title: "Epic roll-up",
      query,
      workspaceId: world.workspaceId,
      identity,
      caps,
      window: resolved.window,
      chartType: "table",
      now,
    });

    const epicRow = report.rows.find((row) => row._drill === `epic:${epic.id}`);
    expect(epicRow).toMatchObject({
      group: `${epic.key} — Q3 release`,
      value: 3,
      progressCompleted: 2,
      progressTotal: 3,
    });
    expect(epicRow?.progressPercent).toBeCloseTo(200 / 3);
    expect(epicRow?._drill).toBe(`epic:${epic.id}`);
    const leafRow = report.rows.find(
      (row) => row._drill === `epic:${leafEpic.id}`,
    );
    expect(leafRow).toMatchObject({
      value: 1,
      progressCompleted: 0,
      progressTotal: 0,
      progressPercent: null,
    });
    expect(report.columns.map((column) => column.key)).toEqual([
      "group",
      "value",
      "progressCompleted",
      "progressTotal",
      "progressPercent",
    ]);

    const noneRow = report.rows.find((row) => row._drill === "epic-none");
    const unavailableRow = report.rows.find(
      (row) => row._drill === "epic-unavailable",
    );
    expect(noneRow).toMatchObject({
      group: "No epic",
      progressCompleted: null,
      progressTotal: null,
      progressPercent: null,
    });
    expect(unavailableRow).toMatchObject({
      group: "Epic unavailable",
      progressCompleted: null,
      progressTotal: null,
      progressPercent: null,
    });

    const matching = await drillCustomReport({
      query,
      handle: `epic:${epic.id}`,
      limit: 20,
      workspaceId: world.workspaceId,
      identity,
      caps,
      window: resolved.window,
      now,
    });
    expect(matching.map((item) => item.key)).toHaveLength(3);
    expect(matching.map((item) => item.key)).toContain(epic.key);
    expect(matching.map((item) => item.key)).toContain(completedChild.key);
    expect(matching.map((item) => item.key)).toContain(archivedChild.key);
    expect(matching.map((item) => item.key)).not.toContain(
      olderOpenGrandchild.key,
    );

    const invalidHandle = await drillCustomReport({
      query,
      handle: `epic:${world.stranger.workspace.id}`,
      limit: 20,
      workspaceId: world.workspaceId,
      identity,
      caps,
      window: resolved.window,
      now,
    });
    expect(invalidHandle).toEqual([]);
  });
});
