import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  advanceProjectTaskNumber,
  clearTaskReminders,
  countProjectTasks,
  deleteTaskById,
  findColumnBySlug,
  findLiveProject,
  findProjectWorkspaceContext,
  findTaskAssigneeId,
  insertAsset,
  listColumnSlugs,
  listLabelsForTasks,
  listProjectColumns,
  listProjectTasks,
  listProjectTasksForExport,
  listTaskRelations,
  lockLiveProjectRow,
  lockTaskRow,
  updateAssetById,
  updateTaskRow,
} from "../../apps/api/src/task/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function seedTask(
  userId: string,
  projectId: string,
  number: number,
  overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      userId,
      title: `Task ${number}`,
      status: "to-do",
      priority: "medium",
      number,
      position: number,
      ...overrides,
    })
    .returning();
  if (!task) throw new Error("seed task");
  return task;
}

async function seed() {
  const a = await createWorkspaceMember({ role: "admin" });
  const { project: p1 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: p2 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  return { a, p1, p2 };
}

describe("legacy task repository (#580 b9a)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("task listing, count and export are scoped to the project and apply every filter", async () => {
    const { a, p1, p2 } = await seed();
    const high = await seedTask(a.user.id, p1.id, 1, {
      priority: "high",
      status: "doing",
      dueDate: new Date("2026-03-01T00:00:00Z"),
    });
    const low = await seedTask(a.user.id, p1.id, 2, {
      priority: "low",
      dueDate: new Date("2026-06-01T00:00:00Z"),
    });
    await seedTask(a.user.id, p2.id, 1, { priority: "high" });

    expect(Number((await countProjectTasks(p1.id, {}))?.count)).toBe(2);
    const all = await listProjectTasks(p1.id, {}, {});
    expect(all.map((t) => t.id)).toEqual([high.id, low.id]);
    expect(all.every((t) => t.projectId === p1.id)).toBe(true);
    expect((await listProjectTasksForExport(p1.id)).map((t) => t.id)).toEqual([
      high.id,
      low.id,
    ]);

    const ids = async (filters: Parameters<typeof listProjectTasks>[1]) =>
      (await listProjectTasks(p1.id, filters, {})).map((t) => t.id);
    expect(await ids({ priority: "high" })).toEqual([high.id]);
    expect(await ids({ status: "doing" })).toEqual([high.id]);
    expect(await ids({ assigneeId: a.user.id })).toHaveLength(2);
    expect(await ids({ assigneeId: "nobody" })).toEqual([]);
    expect(await ids({ dueBefore: "2026-04-01T00:00:00Z" })).toEqual([high.id]);
    expect(await ids({ dueAfter: "2026-04-01T00:00:00Z" })).toEqual([low.id]);
    expect(
      Number((await countProjectTasks(p1.id, { priority: "high" }))?.count),
    ).toBe(1);

    const sorted = await listProjectTasks(
      p1.id,
      {},
      { sortBy: "priority", sortOrder: "desc" },
    );
    expect(sorted.map((t) => t.id)).toEqual([high.id, low.id]);
    const page = await listProjectTasks(
      p1.id,
      {},
      { sortBy: "number", sortOrder: "desc" },
      { limit: 1, offset: 1 },
    );
    expect(page.map((t) => t.id)).toEqual([high.id]);
  });

  it("labels are looked up only for the given task ids", async () => {
    const { a, p1 } = await seed();
    const t1 = await seedTask(a.user.id, p1.id, 1);
    const t2 = await seedTask(a.user.id, p1.id, 2);
    await db.insert(schema.labelTable).values([
      {
        name: "L1",
        color: "#111111",
        taskId: t1.id,
        workspaceId: a.workspace.id,
      },
      {
        name: "L2",
        color: "#222222",
        taskId: t2.id,
        workspaceId: a.workspace.id,
      },
    ]);
    expect((await listLabelsForTasks([t1.id])).map((l) => l.name)).toEqual([
      "L1",
    ]);
  });

  it("project reads: live-project lookup hides soft-deleted, the row lock skips deleted and archived, the number advances by count", async () => {
    const { a, p1, p2 } = await seed();
    expect((await findLiveProject(p1.id))?.id).toBe(p1.id);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, p1.id));
    expect(await findLiveProject(p1.id)).toBeUndefined();
    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, p2.id));

    await db.transaction(async (tx) => {
      expect(await lockLiveProjectRow(tx, p1.id)).toBeUndefined();
      expect(await lockLiveProjectRow(tx, p2.id)).toBeUndefined();
    });
    const { project: p3 } = await createProjectFixture({
      workspaceId: a.workspace.id,
    });
    await db.transaction(async (tx) => {
      expect((await lockLiveProjectRow(tx, p3.id))?.id).toBe(p3.id);
      const first = await advanceProjectTaskNumber(tx, p3.id, 3);
      const second = await advanceProjectTaskNumber(tx, p3.id, 2);
      expect((second?.lastTaskNumber ?? 0) - (first?.lastTaskNumber ?? 0)).toBe(
        2,
      );
      expect(await advanceProjectTaskNumber(tx, "missing", 1)).toBeUndefined();
    });
    expect((await findProjectWorkspaceContext(db, p3.id))?.workspaceId).toBe(
      a.workspace.id,
    );
    expect(await findProjectWorkspaceContext(db, "missing")).toBeUndefined();
  });

  it("column lookups are per project; task row writes bump the version and only touch their own row", async () => {
    const { a, p1, p2 } = await seed();
    const col1 = await findColumnBySlug(db, p1.id, "to-do");
    const col2 = await findColumnBySlug(db, p2.id, "to-do");
    expect(col1?.projectId).toBe(p1.id);
    expect(col2?.projectId).toBe(p2.id);
    expect(col1?.id).not.toBe(col2?.id);
    const slugs = await listColumnSlugs(db, p1.id);
    expect(slugs.map((c) => c.slug)).toEqual(
      (await listProjectColumns(p1.id)).map((c) => c.slug),
    );
    const onlyP1 = await listColumnSlugs(db, p1.id);
    const withP2 = (await listProjectColumns(p2.id)).length;
    expect(onlyP1).toHaveLength(withP2);
    expect(
      (await listProjectColumns(p1.id)).every((c) => c.projectId === p1.id),
    ).toBe(true);

    const t1 = await seedTask(a.user.id, p1.id, 1);
    const t2 = await seedTask(a.user.id, p1.id, 2);
    const updated = await db.transaction(async (tx) => {
      expect((await lockTaskRow(tx, t1.id))?.id).toBe(t1.id);
      expect(await lockTaskRow(tx, "missing")).toBeUndefined();
      return updateTaskRow(tx, t1.id, { title: "Renamed" });
    });
    expect(updated?.title).toBe("Renamed");
    expect(updated?.version).toBe(t1.version + 1);
    const [untouched] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, t2.id));
    expect(untouched?.title).toBe("Task 2");
    expect(untouched?.version).toBe(t2.version);
    expect((await findTaskAssigneeId(t1.id))?.userId).toBe(a.user.id);
    expect(await findTaskAssigneeId("missing")).toBeUndefined();
  });

  it("relations, reminders and delete are per task", async () => {
    const { a, p1 } = await seed();
    const t1 = await seedTask(a.user.id, p1.id, 1);
    const t2 = await seedTask(a.user.id, p1.id, 2);
    const t3 = await seedTask(a.user.id, p1.id, 3);
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: t1.id,
      targetTaskId: t2.id,
      relationType: "relates_to",
    });
    expect(await listTaskRelations(db, t2.id)).toHaveLength(1);
    expect(await listTaskRelations(db, t3.id)).toHaveLength(0);

    await db.insert(schema.taskReminderSentTable).values([
      { taskId: t1.id, reminderType: "due_soon" },
      { taskId: t3.id, reminderType: "due_soon" },
    ]);
    await clearTaskReminders(db, t1.id);
    const left = await db.select().from(schema.taskReminderSentTable);
    expect(left.map((r) => r.taskId)).toEqual([t3.id]);

    expect((await deleteTaskById(db, t3.id))?.id).toBe(t3.id);
    expect(await deleteTaskById(db, t3.id)).toBeUndefined();
    expect(
      (await db.select().from(schema.taskTable)).map((t) => t.id).sort(),
    ).toEqual([t1.id, t2.id].sort());
  });

  it("asset helpers insert and update by id", async () => {
    const { a, p1 } = await seed();
    const t1 = await seedTask(a.user.id, p1.id, 1);
    const base = {
      workspaceId: a.workspace.id,
      projectId: p1.id,
      taskId: t1.id,
      filename: "a.png",
      mimeType: "image/png",
      size: 10,
      kind: "image" as const,
      surface: "task_description" as const,
      createdBy: a.user.id,
    };
    const inserted = await insertAsset(db, { ...base, objectKey: "key-1" });
    expect(inserted?.id).toBeDefined();
    const updated = await updateAssetById(db, inserted?.id ?? "", {
      ...base,
      size: 99,
    });
    expect(updated?.id).toBe(inserted?.id);
    const [row] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, inserted?.id ?? ""));
    expect(row?.size).toBe(99);
  });
});
