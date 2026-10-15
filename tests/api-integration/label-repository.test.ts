import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteLabelsByIds,
  findProjectWorkspaceId,
  findTaskInWorkspace,
  findTaskWithWorkspace,
  insertTaskLabelOnConflictDoNothing,
  insertWorkspaceLabelOnConflictDoNothing,
  listLabelsByWorkspaceId,
  listTaskLabelCopiesWithTask,
  lockTaskLabelCopies,
  updateLabelsByIds,
} from "../../apps/api/src/label/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

function must<T>(row: T | undefined, context: string): T {
  if (row === undefined) throw new Error(`${context}: no row`);
  return row;
}

async function seedTask(userId: string, projectId: string, number = 1) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        userId,
        title: `Seed ${number}`,
        status: "to-do",
        priority: "medium",
        number,
        position: number,
      })
      .returning(),
    "seedTask",
  );
}

/**
 * Two workspaces, each with a project and a task, so every tenant predicate in the label
 * repository can be isolated from the controller-level checks that normally sit in front of
 * it (issue #580: the statement itself must keep the predicate).
 */
async function seedTwoWorkspaces() {
  const a = await createWorkspaceMember({ role: "admin" });
  const b = await createWorkspaceMember({ role: "admin" });
  const { project: projectA } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: projectA2 } = await createProjectFixture({
    workspaceId: a.workspace.id,
  });
  const { project: projectB } = await createProjectFixture({
    workspaceId: b.workspace.id,
  });
  const taskA = await seedTask(a.user.id, projectA.id);
  const taskA2 = await seedTask(a.user.id, projectA2.id);
  const taskB = await seedTask(b.user.id, projectB.id);
  return { a, b, projectA, projectA2, projectB, taskA, taskA2, taskB };
}

describe("label repository (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("findTaskInWorkspace keeps the workspace predicate in the statement", async () => {
    const { a, b, taskA, taskB } = await seedTwoWorkspaces();

    expect(
      (await findTaskInWorkspace(taskA.id, a.workspace.id))?.workspaceId,
    ).toBe(a.workspace.id);
    // a foreign task id is indistinguishable from a missing one
    expect(await findTaskInWorkspace(taskB.id, a.workspace.id)).toBeUndefined();
    expect((await findTaskInWorkspace(taskB.id, b.workspace.id))?.id).toBe(
      taskB.id,
    );
    // the unscoped lookup does not apply the predicate and reports the owning workspace
    expect((await findTaskWithWorkspace(taskB.id))?.workspaceId).toBe(
      b.workspace.id,
    );
    expect(await findTaskWithWorkspace("missing-task")).toBeUndefined();
  });

  it("listLabelsByWorkspaceId lists definitions, hides task copies outside reach, never crosses workspaces", async () => {
    const { a, b, projectA, projectA2, taskA, taskA2 } =
      await seedTwoWorkspaces();
    const definition = must(
      await insertWorkspaceLabelOnConflictDoNothing(db, {
        name: "Bug",
        color: "#111111",
        workspaceId: a.workspace.id,
      }),
      "definition",
    );
    const reachableCopy = must(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "Reachable",
        color: "#222222",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "reachableCopy",
    );
    await insertTaskLabelOnConflictDoNothing(db, {
      name: "Hidden",
      color: "#333333",
      taskId: taskA2.id,
      workspaceId: a.workspace.id,
    });
    await insertWorkspaceLabelOnConflictDoNothing(db, {
      name: "Foreign",
      color: "#444444",
      workspaceId: b.workspace.id,
    });

    const none = await listLabelsByWorkspaceId(a.workspace.id, []);
    expect(none.map((label) => label.id)).toEqual([definition.id]);

    const some = await listLabelsByWorkspaceId(a.workspace.id, [projectA.id]);
    expect(some.map((label) => label.id).sort()).toEqual(
      [definition.id, reachableCopy.id].sort(),
    );

    const all = await listLabelsByWorkspaceId(a.workspace.id, [
      projectA.id,
      projectA2.id,
    ]);
    expect(all).toHaveLength(3);
    expect(all.every((label) => label.workspaceId === a.workspace.id)).toBe(
      true,
    );
  });

  it("insert helpers are idempotent on the unique keys and return nothing on conflict", async () => {
    const { a, taskA } = await seedTwoWorkspaces();
    const first = await insertWorkspaceLabelOnConflictDoNothing(db, {
      name: "Dup",
      color: "#111111",
      workspaceId: a.workspace.id,
    });
    expect(first).toBeDefined();
    expect(
      await insertWorkspaceLabelOnConflictDoNothing(db, {
        name: "Dup",
        color: "#999999",
        workspaceId: a.workspace.id,
      }),
    ).toBeUndefined();

    const task = await insertTaskLabelOnConflictDoNothing(db, {
      name: "Dup",
      color: "#111111",
      taskId: taskA.id,
      workspaceId: a.workspace.id,
    });
    // a task copy with the same name coexists with the workspace definition
    expect(task?.id).not.toBe(first?.id);
    expect(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "Dup",
        color: "#999999",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
    ).toBeUndefined();
  });

  it("family statements are scoped to one workspace and one name", async () => {
    const { a, b, taskA, taskA2, taskB } = await seedTwoWorkspaces();
    const copyA = must(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "Fam",
        color: "#111111",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "copyA",
    );
    const copyA2 = must(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "Fam",
        color: "#111111",
        taskId: taskA2.id,
        workspaceId: a.workspace.id,
      }),
      "copyA2",
    );
    const otherName = must(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "Other",
        color: "#111111",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "otherName",
    );
    const foreign = must(
      await insertTaskLabelOnConflictDoNothing(db, {
        name: "Fam",
        color: "#111111",
        taskId: taskB.id,
        workspaceId: b.workspace.id,
      }),
      "foreign",
    );

    const listed = await listTaskLabelCopiesWithTask(db, a.workspace.id, "Fam");
    expect(listed.map((entry) => entry.label.id).sort()).toEqual(
      [copyA.id, copyA2.id].sort(),
    );

    await db.transaction(async (tx) => {
      const locked = await lockTaskLabelCopies(tx, a.workspace.id, "Fam", [
        taskA.id,
        taskA2.id,
        taskB.id,
      ]);
      expect(locked.map((row) => row.id).sort()).toEqual(
        [copyA.id, copyA2.id].sort(),
      );
      const onlyA = await lockTaskLabelCopies(tx, a.workspace.id, "Fam", [
        taskA.id,
      ]);
      expect(onlyA.map((row) => row.id)).toEqual([copyA.id]);
    });

    await updateLabelsByIds(db, [copyA.id], { name: "Renamed", color: "#abc" });
    const deleted = await deleteLabelsByIds(db, [copyA2.id]);
    expect(deleted.map((row) => row.id)).toEqual([copyA2.id]);

    const rows = await db.select().from(schema.labelTable);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(copyA.id)).toMatchObject({
      name: "Renamed",
      color: "#abc",
    });
    expect(byId.get(otherName.id)?.name).toBe("Other");
    expect(byId.get(foreign.id)?.name).toBe("Fam");
    expect(byId.has(copyA2.id)).toBe(false);
  });

  it("findProjectWorkspaceId resolves the owning workspace", async () => {
    const { b, projectB } = await seedTwoWorkspaces();
    expect((await findProjectWorkspaceId(db, projectB.id))?.workspaceId).toBe(
      b.workspace.id,
    );
    expect(await findProjectWorkspaceId(db, "missing")).toBeUndefined();
  });
});
