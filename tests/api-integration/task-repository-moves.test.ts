import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import type { Executor } from "../../apps/api/src/database/executor";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import * as taskRepository from "../../apps/api/src/task/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

let testIdentity: ResolvedIdentity;
const scoped =
  <Args extends unknown[], Result>(
    fn: (identity: ResolvedIdentity, ...args: Args) => Promise<Result>,
  ) =>
  (...args: Args) =>
    fn(testIdentity, ...args);
const scopedExecutor =
  <Args extends unknown[], Result>(
    fn: (
      executor: Executor,
      identity: ResolvedIdentity,
      ...args: Args
    ) => Promise<Result>,
  ) =>
  (executor: Executor, ...args: Args) =>
    fn(executor, testIdentity, ...args);

const deleteTaskLabelByName = scopedExecutor(
  taskRepository.deleteTaskLabelByName,
);
const deleteTaskReturningId = scopedExecutor(
  taskRepository.deleteTaskReturningId,
);
const findLabelInWorkspaceScope = scopedExecutor(
  taskRepository.findLabelInWorkspaceScope,
);
const findLiveUnarchivedProjectInWorkspace = scopedExecutor(
  taskRepository.findLiveUnarchivedProjectInWorkspace,
);
const findMaxTaskPositionInColumnOrStatus = scopedExecutor(
  taskRepository.findMaxTaskPositionInColumnOrStatus,
);
const findMaxTaskPositionInStatusAndColumn = scopedExecutor(
  taskRepository.findMaxTaskPositionInStatusAndColumn,
);
const findNotDeletedProjectInWorkspace = scopedExecutor(
  taskRepository.findNotDeletedProjectInWorkspace,
);
const findProjectById = scopedExecutor(taskRepository.findProjectById);
const findProjectFreezeState = scopedExecutor(
  taskRepository.findProjectFreezeState,
);
const findProjectIdentity = scopedExecutor(taskRepository.findProjectIdentity);
const findTaskLabelByName = scopedExecutor(taskRepository.findTaskLabelByName);
const insertTask = scopedExecutor(taskRepository.insertTask);
const insertTaskLabelOnConflictDoNothing = scopedExecutor(
  taskRepository.insertTaskLabelOnConflictDoNothing,
);
const listColumnsForMove = scopedExecutor(taskRepository.listColumnsForMove);
const listWorkspaceScopedTasks = scoped(
  taskRepository.listWorkspaceScopedTasks,
);
const lockLiveProjectForMove = scopedExecutor(
  taskRepository.lockLiveProjectForMove,
);
const reassignTaskAssetsToProject = scopedExecutor(
  taskRepository.reassignTaskAssetsToProject,
);
const updateTaskRowReturningId = scopedExecutor(
  taskRepository.updateTaskRowReturningId,
);
const { findWorkspaceMembershipId } = taskRepository;

async function seed() {
  const a = await createWorkspaceMember({ role: "admin" });
  const b = await createWorkspaceMember({ role: "admin" });
  const identityA = await resolveIdentity({
    userId: a.user.id,
    credential: "session",
  });
  const identityB = await resolveIdentity({
    userId: b.user.id,
    credential: "session",
  });
  if (!identityA || !identityB)
    throw new Error("expected resolved test identities");
  testIdentity = identityA;
  const { project: p1, columns: c1 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: p2 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: pb } = await createProjectFixture({
    workspaceId: b.workspace.id,
  });
  const t1 = await insertTask(db, {
    projectId: p1.id,
    userId: a.user.id,
    title: "T1",
    status: "to-do",
    priority: "medium",
    number: 1,
    position: 1,
  });
  const t2 = await insertTask(db, {
    projectId: p2.id,
    userId: a.user.id,
    title: "T2",
    status: "to-do",
    priority: "medium",
    number: 1,
    position: 7,
  });
  const [tb] = await db
    .insert(schema.taskTable)
    .values({
      projectId: pb.id,
      userId: b.user.id,
      title: "TB",
      status: "to-do",
      priority: "medium",
      number: 1,
      position: 1,
    })
    .returning();
  if (!t1 || !t2 || !tb) throw new Error("seed");
  return { a, b, identityA, identityB, p1, p2, pb, c1, t1, t2, tb };
}

describe("task repository: create, move and bulk statements (#580 b9b)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("task INSERT SELECT preserves omitted defaults, explicit nulls, and supplied values", async () => {
    const { a, p2 } = await seed();
    const { project } = await createProjectFixture({
      workspaceId: a.workspace.id,
    });
    const otherProjectBefore = await db
      .select({ id: schema.taskTable.id, number: schema.taskTable.number })
      .from(schema.taskTable)
      .where(eq(schema.taskTable.projectId, p2.id));

    const omitted = await insertTask(db, {
      projectId: project.id,
      title: "Defaults",
    });
    const explicitNulls = await insertTask(db, {
      projectId: project.id,
      title: "Explicit nulls",
      position: null,
      number: null,
    });
    const supplied = await insertTask(db, {
      projectId: project.id,
      title: "Supplied values",
      position: 23,
      number: 77,
    });

    expect(omitted).toMatchObject({ position: 0, number: 1 });
    expect(explicitNulls).toMatchObject({ position: null, number: null });
    expect(supplied).toMatchObject({ position: 23, number: 77 });
    expect(
      await db
        .select({ id: schema.taskTable.id, number: schema.taskTable.number })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.projectId, p2.id)),
    ).toEqual(otherProjectBefore);
  });

  it("workspace-scoped task lookup keeps the workspace, archived and deleted predicates", async () => {
    const { a, b, identityA, identityB, p1, p2, t1, t2, tb } = await seed();
    const insertedTasks = await db
      .select({
        id: schema.taskTable.id,
        projectId: schema.taskTable.projectId,
      })
      .from(schema.taskTable)
      .where(
        and(
          inArray(schema.taskTable.projectId, [p1.id, p2.id]),
          inArray(schema.taskTable.id, [t1.id, t2.id]),
        ),
      );
    expect(insertedTasks).toHaveLength(2);
    expect(insertedTasks).toEqual(
      expect.arrayContaining([
        { id: t1.id, projectId: p1.id },
        { id: t2.id, projectId: p2.id },
      ]),
    );
    const ids = [t1.id, t2.id, tb.id];
    expect(
      (await listWorkspaceScopedTasks(ids, a.workspace.id))
        .map((r) => r.id)
        .sort(),
    ).toEqual([t1.id, t2.id].sort());
    testIdentity = identityB;
    expect(
      (await listWorkspaceScopedTasks(ids, b.workspace.id)).map((r) => r.id),
    ).toEqual([tb.id]);
    testIdentity = identityA;

    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, p1.id));
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, p2.id));
    expect(await listWorkspaceScopedTasks(ids, a.workspace.id)).toEqual([]);
  });

  it("membership and label scope lookups", async () => {
    const { a, b } = await seed();
    expect(
      (await findWorkspaceMembershipId(a.user.id, a.workspace.id))?.id,
    ).toBeDefined();
    expect(
      await findWorkspaceMembershipId(a.user.id, b.workspace.id),
    ).toBeUndefined();
    expect(
      await findWorkspaceMembershipId(b.user.id, a.workspace.id),
    ).toBeUndefined();

    const [own] = await db
      .insert(schema.labelTable)
      .values({ name: "Own", color: "#111111", workspaceId: a.workspace.id })
      .returning();
    const [foreign] = await db
      .insert(schema.labelTable)
      .values({
        name: "Foreign",
        color: "#222222",
        workspaceId: b.workspace.id,
      })
      .returning();
    expect(
      (await findLabelInWorkspaceScope(db, own?.id ?? "", a.workspace.id))?.id,
    ).toBe(own?.id);
    // another workspace's label is not found
    expect(
      await findLabelInWorkspaceScope(db, foreign?.id ?? "", a.workspace.id),
    ).toBeUndefined();
  });

  it("task writes: update/delete return the id, task labels are per task and name", async () => {
    const { a, b, t1, t2, tb } = await seed();
    const updated = await db.transaction((tx) =>
      updateTaskRowReturningId(tx, t1.id, { priority: "high" }),
    );
    expect(updated).toEqual({ id: t1.id });
    const rows = await db.select().from(schema.taskTable);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(t1.id)).toMatchObject({
      priority: "high",
      version: t1.version + 1,
    });
    expect(byId.get(t2.id)?.priority).toBe("medium");

    expect(
      await updateTaskRowReturningId(db, tb.id, {
        title: "must not cross project reach",
      }),
    ).toBeUndefined();
    expect(await deleteTaskReturningId(db, tb.id)).toBeUndefined();
    const [foreignAfterDeniedWrites] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, tb.id));
    expect(foreignAfterDeniedWrites).toMatchObject({
      title: "TB",
      version: tb.version,
    });

    const label = await insertTaskLabelOnConflictDoNothing(db, {
      name: "L",
      color: "#111111",
      workspaceId: a.workspace.id,
      taskId: t1.id,
    });
    expect(label?.id).toBeDefined();
    expect(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "L",
        color: "#999999",
        workspaceId: a.workspace.id,
        taskId: t1.id,
      }),
    ).toBeUndefined();
    expect((await findTaskLabelByName(db, t1.id, "L"))?.id).toBe(label?.id);
    expect(await findTaskLabelByName(db, t2.id, "L")).toBeUndefined();
    expect(
      await deleteTaskLabelByName(db, {
        workspaceId: b.workspace.id,
        name: "L",
        taskId: t1.id,
      }),
    ).toBeUndefined();
    expect((await findTaskLabelByName(db, t1.id, "L"))?.id).toBe(label?.id);
    expect(
      await deleteTaskLabelByName(db, {
        workspaceId: a.workspace.id,
        name: "L",
        taskId: t2.id,
      }),
    ).toBeUndefined();
    expect(
      (
        await deleteTaskLabelByName(db, {
          workspaceId: a.workspace.id,
          name: "L",
          taskId: t1.id,
        })
      )?.id,
    ).toBe(label?.id);

    expect(await deleteTaskReturningId(db, t2.id)).toEqual({ id: t2.id });
    expect(await deleteTaskReturningId(db, t2.id)).toBeUndefined();
  });

  it("position lookups are per project and column/status", async () => {
    const { p1, p2, t1, t2 } = await seed();
    const column = (await listColumnsForMove(db, p2.id))[0];
    expect(column).toBeDefined();
    await db
      .update(schema.taskTable)
      .set({ columnId: column?.id ?? null })
      .where(eq(schema.taskTable.id, t2.id));

    expect(
      (await findMaxTaskPositionInColumnOrStatus(db, p1.id, "to-do", undefined))
        ?.maxPosition,
    ).toBe(t1.position);
    expect(
      (await findMaxTaskPositionInColumnOrStatus(db, p2.id, "to-do", undefined))
        ?.maxPosition,
    ).toBe(7);
    // by column: a column of another project holds nothing of this project's tasks
    expect(
      (
        await findMaxTaskPositionInColumnOrStatus(
          db,
          p1.id,
          "to-do",
          column?.id,
        )
      )?.maxPosition,
    ).toBeNull();
    expect(
      (
        await findMaxTaskPositionInStatusAndColumn(
          db,
          p2.id,
          "to-do",
          column?.id ?? "",
        )
      )?.maxPosition,
    ).toBe(7);
    expect(
      (
        await findMaxTaskPositionInStatusAndColumn(
          db,
          p2.id,
          "doing",
          column?.id ?? "",
        )
      )?.maxPosition,
    ).toBeNull();
  });

  it("move preflights: freeze flags, workspace-scoped destination, lock modes and identities", async () => {
    const { a, b, identityB, p1, p2, pb, c1 } = await seed();
    expect((await findProjectById(db, p1.id))?.id).toBe(p1.id);
    expect((await findProjectById(db, p2.id))?.id).toBe(p2.id);
    expect(await findProjectById(db, "missing")).toBeUndefined();
    await db
      .update(schema.columnTable)
      .set({ position: 30 })
      .where(eq(schema.columnTable.id, c1.todo.id));
    await db
      .update(schema.columnTable)
      .set({ position: 10 })
      .where(eq(schema.columnTable.id, c1.inProgress.id));
    await db
      .update(schema.columnTable)
      .set({ position: 40 })
      .where(eq(schema.columnTable.id, c1.inReview.id));
    await db
      .update(schema.columnTable)
      .set({ position: 20 })
      .where(eq(schema.columnTable.id, c1.done.id));
    expect(
      (await listColumnsForMove(db, p1.id)).map((column) => column.id),
    ).toEqual([c1.inProgress.id, c1.done.id, c1.todo.id, c1.inReview.id]);

    expect(await findProjectFreezeState(db, p1.id)).toMatchObject({
      id: p1.id,
      workspaceId: a.workspace.id,
      archivedAt: null,
      deletedAt: null,
    });
    expect(
      (await findLiveUnarchivedProjectInWorkspace(db, p2.id, a.workspace.id))
        ?.id,
    ).toBe(p2.id);
    // a foreign project is indistinguishable from a missing one
    expect(
      await findLiveUnarchivedProjectInWorkspace(db, pb.id, a.workspace.id),
    ).toBeUndefined();
    expect(
      (await findNotDeletedProjectInWorkspace(db, p2.id, a.workspace.id))?.name,
    ).toBeDefined();
    expect(
      await findNotDeletedProjectInWorkspace(db, pb.id, a.workspace.id),
    ).toBeUndefined();
    expect(await findProjectIdentity(db, pb.id)).toBeUndefined();
    testIdentity = identityB;
    expect((await findProjectIdentity(db, pb.id))?.workspaceId).toBe(
      b.workspace.id,
    );

    await db.transaction(async (tx) => {
      expect(
        (
          await lockLiveProjectForMove(tx, p2.id, {
            mode: "update",
            workspaceId: a.workspace.id,
          })
        )?.id,
      ).toBe(p2.id);
      expect(
        await lockLiveProjectForMove(tx, p2.id, {
          mode: "update",
          workspaceId: b.workspace.id,
        }),
      ).toBeUndefined();
      expect(
        (await lockLiveProjectForMove(tx, p1.id, { mode: "share" }))?.id,
      ).toBe(p1.id);
    });

    await db
      .update(schema.projectTable)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projectTable.id, p1.id));
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date() })
      .where(eq(schema.projectTable.id, p2.id));
    expect(
      (await findProjectFreezeState(db, p1.id))?.archivedAt,
    ).not.toBeNull();
    expect(
      await findLiveUnarchivedProjectInWorkspace(db, p1.id, a.workspace.id),
    ).toBeUndefined();
    expect(
      await findNotDeletedProjectInWorkspace(db, p2.id, a.workspace.id),
    ).toBeUndefined();
    await db.transaction(async (tx) => {
      expect(
        await lockLiveProjectForMove(tx, p1.id, { mode: "share" }),
      ).toBeUndefined();
      expect(
        await lockLiveProjectForMove(tx, p2.id, { mode: "update" }),
      ).toBeUndefined();
    });
  });

  it("the destination project is held with an exclusive lock and the source with a shared one", async () => {
    const { p1, p2 } = await seed();
    await db.transaction(async (holder) => {
      await lockLiveProjectForMove(holder, p2.id, { mode: "update" });
      await lockLiveProjectForMove(holder, p1.id, { mode: "share" });
      // another connection can share-lock the source but not the destination
      expect(await lockedByOther(p1.id, "for share nowait")).toBe(false);
      expect(await lockedByOther(p1.id, "for update nowait")).toBe(true);
      expect(await lockedByOther(p2.id, "for share nowait")).toBe(true);
    });
  });

  it("assets follow the task to its new project", async () => {
    const { a, p1, p2, t1 } = await seed();
    const otherTask = await insertTask(db, {
      projectId: p1.id,
      userId: a.user.id,
      title: "Other task",
      status: "to-do",
      priority: "medium",
      number: 2,
      position: 2,
    });
    if (!otherTask) throw new Error("other task");
    await db.insert(schema.assetTable).values({
      workspaceId: a.workspace.id,
      projectId: p1.id,
      taskId: t1.id,
      objectKey: "k1",
      filename: "a.png",
      mimeType: "image/png",
      size: 1,
      kind: "image",
      surface: "task_description",
      createdBy: a.user.id,
    });
    await db.insert(schema.assetTable).values({
      workspaceId: a.workspace.id,
      projectId: p1.id,
      taskId: otherTask.id,
      objectKey: "k2",
      filename: "b.png",
      mimeType: "image/png",
      size: 1,
      kind: "image",
      surface: "task_description",
      createdBy: a.user.id,
    });
    await db.transaction((tx) => reassignTaskAssetsToProject(tx, t1.id, p2.id));
    const assets = await db.select().from(schema.assetTable);
    expect(assets.find((asset) => asset.taskId === t1.id)?.projectId).toBe(
      p2.id,
    );
    expect(
      assets.find((asset) => asset.taskId === otherTask.id)?.projectId,
    ).toBe(p1.id);
  });
});

async function lockedByOther(projectId: string, clause: string) {
  try {
    await db.transaction(async (other) => {
      await other.execute(
        sql.raw(`select 1 from "project" where id = '${projectId}' ${clause}`),
      );
    });
    return false;
  } catch (error) {
    const chain: string[] = [];
    for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
      chain.push(
        String((e as { code?: unknown }).code ?? ""),
        String((e as { message?: unknown }).message ?? ""),
      );
    }
    const text = chain.join(" ");
    if (text.includes("55P03") || text.includes("could not obtain lock")) {
      return true;
    }
    throw error;
  }
}
