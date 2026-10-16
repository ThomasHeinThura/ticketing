import { defaultRolePayloads } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  deleteLabelsByIds,
  findLabelById,
  findLabelsByTaskId,
  findProjectWorkspaceId,
  findTaskInWorkspace,
  findTaskLabelByName,
  findTaskWithWorkspace,
  findWorkspaceLabelByName,
  insertTaskLabelOnConflictDoNothing,
  insertWorkspaceLabelOnConflictDoNothing,
  listLabelsByWorkspaceId,
  listTaskLabelCopiesWithTask,
  lockTaskLabelCopies,
  updateLabelsByIds,
} from "../../apps/api/src/label/repository";
import { resolveRequestIdentity } from "../../apps/api/src/permissions/resolve-request-identity";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

function must<T>(row: T | undefined, context: string): T {
  if (row === undefined) throw new Error(`${context}: no row`);
  return row;
}

async function identityFor(userId: string) {
  const identity = await resolveRequestIdentity({ userId });
  if (!identity) throw new Error(`identity missing for ${userId}`);
  return identity;
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
  for (const projectId of [projectA.id, projectA2.id])
    await grantProjectRole(a.user.id, projectId, []);
  await grantProjectRole(b.user.id, projectB.id, []);
  return { a, b, projectA, projectA2, projectB, taskA, taskA2, taskB };
}

describe("label repository (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("findTaskInWorkspace keeps the workspace predicate in the statement", async () => {
    const { a, b, taskA, taskB } = await seedTwoWorkspaces();
    const identityA = await identityFor(a.user.id);
    const identityB = await identityFor(b.user.id);
    expect(
      (await findTaskInWorkspace(identityA, taskA.id, a.workspace.id))
        ?.workspaceId,
    ).toBe(a.workspace.id);
    // a foreign task id is indistinguishable from a missing one
    expect(
      await findTaskInWorkspace(identityA, taskB.id, a.workspace.id),
    ).toBeUndefined();
    expect(
      (await findTaskInWorkspace(identityB, taskB.id, b.workspace.id))?.id,
    ).toBe(taskB.id);
    // A reachable project lookup reports its owning workspace.
    expect(
      (await findTaskWithWorkspace(identityB, taskB.id))?.workspaceId,
    ).toBe(b.workspace.id);
    expect(
      await findTaskWithWorkspace(identityB, "missing-task"),
    ).toBeUndefined();
  });

  it("resolves task and workspace label names through current-reach SQL", async () => {
    const { a, b, taskA } = await seedTwoWorkspaces();
    const identityA = await identityFor(a.user.id);
    const identityB = await identityFor(b.user.id);
    const definition = must(
      await insertWorkspaceLabelOnConflictDoNothing(db, identityA, {
        name: "Scoped",
        color: "#111111",
        workspaceId: a.workspace.id,
      }),
      "definition",
    );
    const taskLabel = must(
      await insertTaskLabelOnConflictDoNothing(db, identityA, {
        name: "Scoped",
        color: "#222222",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "task label",
    );

    expect(
      (await findWorkspaceLabelByName(db, identityA, a.workspace.id, "Scoped"))
        ?.id,
    ).toBe(definition.id);
    expect(
      (await findTaskLabelByName(db, identityA, taskA.id, "Scoped"))?.id,
    ).toBe(taskLabel.id);
    expect(
      await findWorkspaceLabelByName(db, identityB, a.workspace.id, "Scoped"),
    ).toBeUndefined();
    expect(
      await findTaskLabelByName(db, identityB, taskA.id, "Scoped"),
    ).toBeUndefined();
  });

  it("listLabelsByWorkspaceId lists definitions, hides task copies outside reach, never crosses workspaces", async () => {
    const { a, b, taskA, taskA2 } = await seedTwoWorkspaces();
    const identityA = await identityFor(a.user.id);
    const identityB = await identityFor(b.user.id);
    const workspaceOnly = await createWorkspaceMember({ role: "member" });
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: a.workspace.id,
      userId: workspaceOnly.user.id,
      role: "member",
      joinedAt: new Date(),
    });
    const missingCanonicalRoleIdentity = await identityFor(
      workspaceOnly.user.id,
    );
    const missingCanonicalRoleRows = await db
      .select({ id: schema.workspaceRoleTable.id })
      .from(schema.workspaceRoleTable)
      .where(
        and(
          eq(schema.workspaceRoleTable.workspaceId, a.workspace.id),
          eq(schema.workspaceRoleTable.role, "member"),
          eq(schema.workspaceRoleTable.isSystem, true),
        ),
      );
    expect(missingCanonicalRoleRows).toHaveLength(0);
    const definition = must(
      await insertWorkspaceLabelOnConflictDoNothing(db, identityA, {
        name: "Bug",
        color: "#111111",
        workspaceId: a.workspace.id,
      }),
      "definition",
    );
    const reachableCopy = must(
      await insertTaskLabelOnConflictDoNothing(db, identityA, {
        name: "Bug",
        color: "#222222",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "reachableCopy",
    );
    await insertTaskLabelOnConflictDoNothing(db, identityA, {
      name: "Bug",
      color: "#333333",
      taskId: taskA2.id,
      workspaceId: a.workspace.id,
    });
    await insertWorkspaceLabelOnConflictDoNothing(db, identityB, {
      name: "Foreign",
      color: "#444444",
      workspaceId: b.workspace.id,
    });

    expect(
      await listLabelsByWorkspaceId(
        missingCanonicalRoleIdentity,
        a.workspace.id,
      ),
    ).toEqual([]);

    const now = new Date();
    await db.insert(schema.workspaceRoleTable).values({
      workspaceId: a.workspace.id,
      role: "member",
      permission: JSON.stringify(defaultRolePayloads.member),
      isSystem: true,
      createdAt: now,
      updatedAt: now,
    });
    const identityWorkspaceOnly = await identityFor(workspaceOnly.user.id);
    expect(
      identityWorkspaceOnly.authority.filter(
        (grant) =>
          grant.scope === "workspace" &&
          grant.scopeId === a.workspace.id &&
          grant.roleKey === "member",
      ),
    ).toHaveLength(1);
    expect(
      identityWorkspaceOnly.authority.filter(
        (grant) => grant.scope === "project",
      ),
    ).toEqual([]);

    const noProjects = await listLabelsByWorkspaceId(
      identityWorkspaceOnly,
      a.workspace.id,
    );
    expect(noProjects.map((label) => label.id)).toEqual([definition.id]);
    const all = await listLabelsByWorkspaceId(identityA, a.workspace.id);
    expect(all).toHaveLength(3);
    expect(all.map((label) => label.id)).toContain(reachableCopy.id);
    expect(
      await listLabelsByWorkspaceId(identityB, a.workspace.id),
    ).toHaveLength(0);
    expect(all.every((label) => label.workspaceId === a.workspace.id)).toBe(
      true,
    );
    const familyCopies = await listTaskLabelCopiesWithTask(
      db,
      a.workspace.id,
      "Bug",
    );
    expect(familyCopies).toHaveLength(2);
    await updateLabelsByIds(
      db,
      familyCopies.map(({ labelId }) => labelId),
      {
        name: "Renamed family",
        color: "#abcdef",
      },
    );
    const hiddenActorRows = await listLabelsByWorkspaceId(
      identityWorkspaceOnly,
      a.workspace.id,
    );
    expect(hiddenActorRows.map(({ id }) => id)).toEqual([definition.id]);
    const persistedCopies = await db
      .select({ name: schema.labelTable.name, color: schema.labelTable.color })
      .from(schema.labelTable)
      .where(eq(schema.labelTable.workspaceId, a.workspace.id));
    expect(
      persistedCopies.filter((row) => row.name === "Renamed family"),
    ).toHaveLength(2);
  });

  it("insert helpers are idempotent on the unique keys and return nothing on conflict", async () => {
    const { a, taskA } = await seedTwoWorkspaces();
    const identityA = await identityFor(a.user.id);
    const first = await insertWorkspaceLabelOnConflictDoNothing(db, identityA, {
      name: "Dup",
      color: "#111111",
      workspaceId: a.workspace.id,
    });
    expect(first).toBeDefined();
    expect(
      await insertWorkspaceLabelOnConflictDoNothing(db, identityA, {
        name: "Dup",
        color: "#999999",
        workspaceId: a.workspace.id,
      }),
    ).toBeUndefined();

    const task = await insertTaskLabelOnConflictDoNothing(db, identityA, {
      name: "Dup",
      color: "#111111",
      taskId: taskA.id,
      workspaceId: a.workspace.id,
    });
    // a task copy with the same name coexists with the workspace definition
    expect(task?.id).not.toBe(first?.id);
    expect(
      await insertTaskLabelOnConflictDoNothing(db, identityA, {
        name: "Dup",
        color: "#999999",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
    ).toBeUndefined();
  });

  it("rechecks current project reach in content reads after the resolved identity becomes stale", async () => {
    const { a, projectA, taskA } = await seedTwoWorkspaces();
    const identity = await identityFor(a.user.id);
    const definition = must(
      await insertWorkspaceLabelOnConflictDoNothing(db, identity, {
        name: "Public definition",
        color: "#111111",
        workspaceId: a.workspace.id,
      }),
      "definition",
    );
    const copy = must(
      await insertTaskLabelOnConflictDoNothing(db, identity, {
        name: "Project label",
        color: "#222222",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "copy",
    );
    expect((await findLabelById(identity, copy.id))?.id).toBe(copy.id);
    expect(
      (await findLabelsByTaskId(identity, taskA.id)).map((row) => row.id),
    ).toEqual([copy.id]);

    await db
      .delete(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.personId, identity.personId),
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, projectA.id),
        ),
      );

    expect(await findLabelById(identity, copy.id)).toBeUndefined();
    expect(await findLabelsByTaskId(identity, taskA.id)).toEqual([]);
    expect(
      (await listLabelsByWorkspaceId(identity, a.workspace.id)).map(
        (row) => row.id,
      ),
    ).toEqual([definition.id]);
  });

  it("family statements are scoped to one workspace and one name", async () => {
    const { a, b, taskA, taskA2, taskB } = await seedTwoWorkspaces();
    const identityA = await identityFor(a.user.id);
    const identityB = await identityFor(b.user.id);
    const copyA = must(
      await insertTaskLabelOnConflictDoNothing(db, identityA, {
        name: "Fam",
        color: "#111111",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "copyA",
    );
    const copyA2 = must(
      await insertTaskLabelOnConflictDoNothing(db, identityA, {
        name: "Fam",
        color: "#111111",
        taskId: taskA2.id,
        workspaceId: a.workspace.id,
      }),
      "copyA2",
    );
    const otherName = must(
      await insertTaskLabelOnConflictDoNothing(db, identityA, {
        name: "Other",
        color: "#111111",
        taskId: taskA.id,
        workspaceId: a.workspace.id,
      }),
      "otherName",
    );
    const foreign = must(
      await insertTaskLabelOnConflictDoNothing(db, identityB, {
        name: "Fam",
        color: "#111111",
        taskId: taskB.id,
        workspaceId: b.workspace.id,
      }),
      "foreign",
    );

    const listed = await listTaskLabelCopiesWithTask(db, a.workspace.id, "Fam");
    expect(listed.map((entry) => entry.labelId).sort()).toEqual(
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
