import { randomUUID } from "node:crypto";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Client } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import type { Executor } from "../../apps/api/src/database/executor";
import { resolveIdentity } from "../../apps/api/src/permissions/resolve-identity";
import * as taskRepository from "../../apps/api/src/task/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  grantWorkItemProjectAccess,
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
const insertAsset = scopedExecutor(taskRepository.insertAsset);
const insertTask = scopedExecutor(taskRepository.insertTask);
const insertTaskActivity = scopedExecutor(taskRepository.insertTaskActivity);
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
const moveTaskAndAssetsForIdentity = scopedExecutor(
  taskRepository.moveTaskAndAssetsForIdentity,
);
const updateTaskRowReturningId = scopedExecutor(
  taskRepository.updateTaskRowReturningId,
);
const { findWorkspaceMembershipId } = taskRepository;

async function waitForBlockedPid(client: Client, blockerPid: number) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const { rows } = await client.query<{ pid: number }>(
      `SELECT pid FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock' AND $1 = ANY(pg_blocking_pids(pid))
       LIMIT 1`,
      [blockerPid],
    );
    const pid = rows[0]?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No PostgreSQL session blocked by pid ${blockerPid}`);
}

async function seed() {
  const a = await createWorkspaceMember({ role: "admin" });
  const b = await createWorkspaceMember({ role: "admin" });
  const { project: p1, columns: c1 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: p2 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: pb } = await createProjectFixture({
    workspaceId: b.workspace.id,
  });
  await grantWorkItemProjectAccess(a.user.id, p1.id);
  await grantWorkItemProjectAccess(a.user.id, p2.id);
  await grantWorkItemProjectAccess(b.user.id, pb.id);
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
    await grantWorkItemProjectAccess(a.user.id, project.id);
    const identity = await resolveIdentity({
      userId: a.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("expected resolved task insert identity");
    testIdentity = identity;
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
      startDate: new Date("2026-04-01T09:00:00.000Z"),
      dueDate: new Date("2026-04-05T17:00:00.000Z"),
      createdAt: new Date("2026-04-06T11:22:33.444Z"),
      updatedAt: new Date("2026-04-07T12:23:34.555Z"),
    });

    expect(omitted).toMatchObject({ position: 0, number: 1 });
    expect(explicitNulls).toMatchObject({ position: null, number: null });
    expect(supplied).toMatchObject({ position: 23, number: 77 });
    expect(supplied?.startDate?.toISOString()).toBe("2026-04-01T09:00:00.000Z");
    expect(supplied?.dueDate?.toISOString()).toBe("2026-04-05T17:00:00.000Z");
    expect(supplied?.createdAt.toISOString()).toBe("2026-04-06T11:22:33.444Z");
    expect(supplied?.updatedAt.toISOString()).toBe("2026-04-07T12:23:34.555Z");

    if (!supplied) throw new Error("expected supplied task insert");
    const activityCreatedAt = new Date("2026-04-08T13:24:35.666Z");
    const activityUpdatedAt = new Date("2026-04-09T14:25:36.777Z");
    const activityEventData = { event: "date-codec", occurrence: 2 };
    await insertTaskActivity(db, {
      id: "task-insert-codec-activity",
      taskId: supplied.id,
      type: "comment",
      userId: a.user.id,
      content: "Activity codec check",
      eventData: activityEventData,
      createdAt: activityCreatedAt,
      updatedAt: activityUpdatedAt,
    });
    const [activity] = await db
      .select()
      .from(schema.taskActivityTable)
      .where(eq(schema.taskActivityTable.id, "task-insert-codec-activity"));
    expect(activity?.createdAt.toISOString()).toBe(
      activityCreatedAt.toISOString(),
    );
    expect(activity?.updatedAt.toISOString()).toBe(
      activityUpdatedAt.toISOString(),
    );
    expect(activity?.eventData).toEqual(activityEventData);

    const assetCreatedAt = new Date("2026-04-10T15:26:37.888Z");
    const asset = await insertAsset(db, {
      workspaceId: a.workspace.id,
      projectId: project.id,
      taskId: supplied.id,
      objectKey: "task-insert-codec-asset",
      filename: "codec.png",
      mimeType: "image/png",
      size: 1,
      createdAt: assetCreatedAt,
    });
    if (!asset) throw new Error("expected asset insert");
    const [assetRow] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, asset.id));
    expect(assetRow?.createdAt.toISOString()).toBe(
      assetCreatedAt.toISOString(),
    );
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
    const { a, b, identityA, identityB, p1, p2, pb, c1 } = await seed();
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
    testIdentity = identityA;
    expect(await findProjectById(db, pb.id)).toBeUndefined();

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
    await db.transaction(async (tx) => {
      const [destinationColumn] = await listColumnsForMove(tx, p2.id);
      if (!destinationColumn) throw new Error("destination column");
      const movedTask = await moveTaskAndAssetsForIdentity(
        tx,
        t1.id,
        p1.id,
        p2.id,
        {
          status: destinationColumn.slug,
          columnId: destinationColumn.id,
          number: 2,
          position: 2,
        },
      );
      expect(movedTask?.projectId).toBe(p2.id);
    });
    const assets = await db.select().from(schema.assetTable);
    const [movedTask] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, t1.id));
    expect(movedTask?.projectId).toBe(p2.id);
    expect(assets.find((asset) => asset.taskId === t1.id)?.projectId).toBe(
      p2.id,
    );
    expect(
      assets.find((asset) => asset.taskId === otherTask.id)?.projectId,
    ).toBe(p1.id);
  });

  it("rejects unreachable or mismatched task and asset move destinations", async () => {
    const actor = await createWorkspaceMember({ role: "admin" });
    const { project: source } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    const { project: destination } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    await grantProjectRole(actor.user.id, source.id, ["work_item:update"]);
    await grantProjectRole(actor.user.id, destination.id, ["work_item:update"]);
    const identity = await resolveIdentity({
      userId: actor.user.id,
      credential: "session",
    });
    if (!identity) throw new Error("expected resolved move identity");
    testIdentity = identity;

    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: source.id,
        userId: actor.user.id,
        title: "Move boundary",
        status: "to-do",
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("expected task fixture");
    const [asset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: actor.workspace.id,
        projectId: source.id,
        taskId: task.id,
        objectKey: "move-boundary.png",
        filename: "move-boundary.png",
        mimeType: "image/png",
        size: 4,
      })
      .returning();
    if (!asset) throw new Error("expected asset fixture");

    const [destinationColumn] = await listColumnsForMove(db, destination.id);
    if (!destinationColumn) throw new Error("destination column");
    // A linked asset outside the task's source project blocks the entire move.
    await db
      .update(schema.assetTable)
      .set({ projectId: destination.id })
      .where(eq(schema.assetTable.id, asset.id));
    const mismatchedMove = await moveTaskAndAssetsForIdentity(
      db,
      task.id,
      source.id,
      destination.id,
      {
        status: destinationColumn.slug,
        columnId: destinationColumn.id,
        number: 2,
        position: 2,
      },
    );
    expect(mismatchedMove).toBeUndefined();
    const [assetAfterMismatchedDestination] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, asset.id));
    const [taskAfterMismatchedDestination] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    expect(taskAfterMismatchedDestination?.projectId).toBe(source.id);
    expect(taskAfterMismatchedDestination?.number).toBe(1);
    expect(assetAfterMismatchedDestination?.projectId).toBe(destination.id);
    await db
      .update(schema.assetTable)
      .set({ projectId: source.id })
      .where(eq(schema.assetTable.id, asset.id));

    // Revoke destination reach after identity resolution to exercise statement-time scope.
    const destinationReachBeforeRevocation =
      await findNotDeletedProjectInWorkspace(
        db,
        destination.id,
        actor.workspace.id,
      );
    expect(destinationReachBeforeRevocation?.id).toBe(destination.id);
    const revokedDestinationGrants = await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, identity.personId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, destination.id),
        ),
      )
      .returning({ id: schema.membershipTable.id });
    expect(revokedDestinationGrants).toHaveLength(1);
    expect(
      await findNotDeletedProjectInWorkspace(
        db,
        destination.id,
        actor.workspace.id,
      ),
    ).toBeUndefined();
    const moved = await moveTaskAndAssetsForIdentity(
      db,
      task.id,
      source.id,
      destination.id,
      {
        status: destinationColumn.slug,
        columnId: destinationColumn.id,
        number: 2,
        position: 2,
      },
    );
    expect(moved).toBeUndefined();

    const [taskAfterDeniedMove] = await db
      .select()
      .from(schema.taskTable)
      .where(eq(schema.taskTable.id, task.id));
    const [assetAfterDeniedMove] = await db
      .select()
      .from(schema.assetTable)
      .where(eq(schema.assetTable.id, asset.id));
    expect(taskAfterDeniedMove?.projectId).toBe(source.id);
    expect(taskAfterDeniedMove?.number).toBe(1);
    expect(assetAfterDeniedMove?.projectId).toBe(source.id);
  });

  it("moves the task and assets under one authorization snapshot during revocation", async () => {
    const { a, p1, p2, t1 } = await seed();
    const [taskAsset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: a.workspace.id,
        projectId: p1.id,
        taskId: t1.id,
        objectKey: "atomic-move-task.png",
        filename: "atomic-move-task.png",
        mimeType: "image/png",
        size: 3,
      })
      .returning();
    const [unrelatedAsset] = await db
      .insert(schema.assetTable)
      .values({
        workspaceId: a.workspace.id,
        projectId: p1.id,
        taskId: null,
        objectKey: "atomic-move-unrelated.png",
        filename: "atomic-move-unrelated.png",
        mimeType: "image/png",
        size: 5,
      })
      .returning();
    if (!taskAsset || !unrelatedAsset) throw new Error("asset fixtures");
    const [destinationColumn] = await listColumnsForMove(db, p2.id);
    if (!destinationColumn) throw new Error("destination column");
    expect(
      (await findNotDeletedProjectInWorkspace(db, p1.id, a.workspace.id))?.id,
    ).toBe(p1.id);
    expect(
      (await findNotDeletedProjectInWorkspace(db, p2.id, a.workspace.id))?.id,
    ).toBe(p2.id);

    const suffix = randomUUID().replaceAll("-", "");
    const triggerName = `task_asset_move_barrier_${suffix}`;
    const functionName = `${triggerName}_fn`;
    const barrierKey = `task-asset-move-${suffix}`;
    const blocker = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    const observer = new Client({
      connectionString: process.env.TASKDESK_DATABASE_URL,
    });
    await Promise.all([blocker.connect(), observer.connect()]);
    let barrierHeld = false;
    let movePromise: Promise<unknown> | undefined;
    try {
      await blocker.query("SELECT pg_advisory_lock($1, hashtext($2))", [
        4_010,
        barrierKey,
      ]);
      barrierHeld = true;
      const { rows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = rows[0]?.pid;
      if (blockerPid === undefined) throw new Error("barrier pid");
      await blocker.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.id = '${t1.id.replaceAll("'", "''")}' THEN
            PERFORM pg_advisory_xact_lock(4_010, hashtext('${barrierKey}'));
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await blocker.query(`CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);

      movePromise = db.transaction((tx) =>
        moveTaskAndAssetsForIdentity(tx, t1.id, p1.id, p2.id, {
          status: destinationColumn.slug,
          columnId: destinationColumn.id,
          number: 2,
          position: 2,
        }),
      );
      await waitForBlockedPid(observer, blockerPid);

      const revoked = await db
        .delete(schema.membershipTable)
        .where(
          and(
            eq(schema.membershipTable.personId, testIdentity.personId),
            eq(schema.membershipTable.scope, "project"),
            eq(schema.membershipTable.scopeId, p2.id),
          ),
        )
        .returning({ id: schema.membershipTable.id });
      expect(revoked).toHaveLength(1);
      expect(
        await findNotDeletedProjectInWorkspace(db, p2.id, a.workspace.id),
      ).toBeUndefined();
      expect(
        (await findNotDeletedProjectInWorkspace(db, p1.id, a.workspace.id))?.id,
      ).toBe(p1.id);

      await blocker.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
        4_010,
        barrierKey,
      ]);
      barrierHeld = false;
      const movedTask = await movePromise;
      expect(movedTask).toMatchObject({ id: t1.id, projectId: p2.id });

      const [taskAfterMove] = await db
        .select()
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, t1.id));
      const assetsAfterMove = await db
        .select()
        .from(schema.assetTable)
        .where(
          inArray(schema.assetTable.id, [taskAsset.id, unrelatedAsset.id]),
        );
      expect(taskAfterMove?.projectId).toBe(p2.id);
      expect(
        assetsAfterMove.find((asset) => asset.id === taskAsset.id)?.projectId,
      ).toBe(p2.id);
      expect(
        assetsAfterMove.find((asset) => asset.id === unrelatedAsset.id)
          ?.projectId,
      ).toBe(p1.id);
    } finally {
      if (barrierHeld) {
        await blocker.query("SELECT pg_advisory_unlock($1, hashtext($2))", [
          4_010,
          barrierKey,
        ]);
      }
      await Promise.allSettled([movePromise]);
      await blocker.query(`DROP TRIGGER IF EXISTS ${triggerName} ON task`);
      await blocker.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      await Promise.all([blocker.end(), observer.end()]);
    }
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
