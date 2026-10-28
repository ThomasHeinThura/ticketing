import { eq } from "drizzle-orm";
import db from "../database";
import type { Executor } from "../database/executor";
import { cycleTable, moduleTable } from "../database/schema-p5-agile";

/** The workspace and project a cycle or module row belongs to (row reach). */
export async function findCycleScope(id: string) {
  const [row] = await db
    .select({
      workspaceId: cycleTable.workspaceId,
      projectId: cycleTable.projectId,
    })
    .from(cycleTable)
    .where(eq(cycleTable.id, id))
    .limit(1);
  return row;
}

export async function findModuleScope(id: string) {
  const [row] = await db
    .select({
      workspaceId: moduleTable.workspaceId,
      projectId: moduleTable.projectId,
    })
    .from(moduleTable)
    .where(eq(moduleTable.id, id))
    .limit(1);
  return row;
}

/** Lock a cycle row for the deletion approval. */
export async function lockCycle(tx: Executor, id: string) {
  const [row] = await tx
    .select()
    .from(cycleTable)
    .where(eq(cycleTable.id, id))
    .for("update")
    .limit(1);
  return row;
}

export async function lockModule(tx: Executor, id: string) {
  const [row] = await tx
    .select()
    .from(moduleTable)
    .where(eq(moduleTable.id, id))
    .for("update")
    .limit(1);
  return row;
}
