import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import type { Executor } from "../../apps/api/src/database/executor";
import {
  insertTaskLabelOnConflictDoNothing,
  lockLabelRow,
  lockTaskLabelCopies,
  lockWorkspaceLabelNames,
  WORKSPACE_LABEL_NAME_LOCK_NAMESPACE,
} from "../../apps/api/src/label/repository";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

/**
 * Lock-order properties of the label repository (#580). Two are asserted without timing:
 * - the family advisory lock takes its names in sorted, de-duplicated order (a stub executor
 *   records each statement's bound parameters, so no database timing is involved);
 * - a row lock is observable from a second pooled connection with `FOR UPDATE NOWAIT`, which
 *   fails immediately with 55P03 while the first transaction holds the row.
 */
describe("label repository lock order (#580)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("the family lock takes names sorted and de-duplicated, under the label namespace", async () => {
    const dialect = new PgDialect();
    const taken: unknown[][] = [];
    const recorder = {
      execute: async (query: Parameters<Executor["execute"]>[0]) => {
        taken.push(dialect.sqlToQuery(query as never).params);
      },
    } as unknown as Executor;

    await lockWorkspaceLabelNames(recorder, "ws-1", ["b", "a", "b", "c"]);

    expect(taken).toHaveLength(3);
    expect(taken.map((params) => params[0])).toEqual([
      WORKSPACE_LABEL_NAME_LOCK_NAMESPACE,
      WORKSPACE_LABEL_NAME_LOCK_NAMESPACE,
      WORKSPACE_LABEL_NAME_LOCK_NAMESPACE,
    ]);
    expect(taken.map((params) => params[1])).toEqual([
      "ws-1:a",
      "ws-1:b",
      "ws-1:c",
    ]);

    taken.length = 0;
    await lockWorkspaceLabelNames(recorder, null, ["a"]);
    await lockWorkspaceLabelNames(recorder, undefined, ["a"]);
    expect(taken).toEqual([]);
  });

  it("lockLabelRow holds a row lock that a second connection cannot take", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const [label] = await db
      .insert(schema.labelTable)
      .values({
        name: "Locked",
        color: "#111111",
        workspaceId: owner.workspace.id,
      })
      .returning();
    if (!label) throw new Error("seed label");

    await db.transaction(async (holder) => {
      expect((await lockLabelRow(holder, label.id))?.id).toBe(label.id);
      expect(await rowLockedByOther("label", label.id)).toBe(true);
    });
    // released with the transaction
    expect(await rowLockedByOther("label", label.id)).toBe(false);
  });

  it("lockTaskLabelCopies locks the copies in (task id, label id) order and holds their row locks", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const tasks: (typeof schema.taskTable.$inferSelect)[] = [];
    for (const number of [1, 2, 3]) {
      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: owner.user.id,
          title: `T${number}`,
          status: "to-do",
          priority: "medium",
          number,
          position: number,
        })
        .returning();
      if (!task) throw new Error("seed task");
      tasks.push(task);
    }
    // insert the copies in descending task-id order so heap order differs from lock order
    const byIdDesc = [...tasks].sort((a, b) => (a.id < b.id ? 1 : -1));
    const copies: { taskId: string; id: string }[] = [];
    for (const task of byIdDesc) {
      const copy = await insertTaskLabelOnConflictDoNothing(db, {
        name: "Family",
        color: "#111111",
        taskId: task.id,
        workspaceId: owner.workspace.id,
      });
      if (!copy) throw new Error("seed copy");
      copies.push({ taskId: task.id, id: copy.id });
    }
    const expected = [...copies]
      .sort((a, b) =>
        a.taskId === b.taskId
          ? a.id < b.id
            ? -1
            : 1
          : a.taskId < b.taskId
            ? -1
            : 1,
      )
      .map((copy) => copy.id);

    await db.transaction(async (tx) => {
      // Force a sequential scan so rows come back in heap (insertion) order unless the
      // statement itself sorts them; otherwise an index scan could hide a missing ORDER BY.
      await tx.execute(sql`set local enable_indexscan = off`);
      await tx.execute(sql`set local enable_bitmapscan = off`);
      await tx.execute(sql`set local enable_indexonlyscan = off`);
      const locked = await lockTaskLabelCopies(
        tx,
        owner.workspace.id,
        "Family",
        tasks.map((task) => task.id),
      );
      expect(locked.map((row) => row.id)).toEqual(expected);
      for (const copy of copies) {
        expect(await rowLockedByOther("label", copy.id)).toBe(true);
      }
    });
    for (const copy of copies) {
      expect(await rowLockedByOther("label", copy.id)).toBe(false);
    }
  });
});

/** True when another pooled connection cannot immediately lock the row (SQLSTATE 55P03). */
async function rowLockedByOther(table: string, id: string) {
  try {
    await db.transaction(async (other) => {
      await other.execute(
        sql.raw(
          `select 1 from "${table}" where id = '${id}' for update nowait`,
        ),
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
