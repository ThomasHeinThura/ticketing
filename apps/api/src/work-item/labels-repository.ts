import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  labelTable,
  workItemLabelTable,
  workItemTable,
} from "../database/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function listWorkItemLabels(key: string, workspaceId: string) {
  const [item] = await db
    .select({ id: workItemTable.id, projectId: workItemTable.projectId })
    .from(workItemTable)
    .where(
      and(
        eq(workItemTable.key, key),
        eq(workItemTable.workspaceId, workspaceId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
      ),
    );
  if (!item) throw new HTTPException(404, { message: "Work item not found" });
  const rows = await db
    .select({
      id: labelTable.id,
      name: labelTable.name,
      color: labelTable.color,
      projectId: labelTable.projectId,
      assignedId: workItemLabelTable.labelId,
    })
    .from(labelTable)
    .leftJoin(
      workItemLabelTable,
      and(
        eq(workItemLabelTable.labelId, labelTable.id),
        eq(workItemLabelTable.workItemId, item.id),
      ),
    )
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        isNull(labelTable.taskId),
        or(
          isNull(labelTable.projectId),
          eq(labelTable.projectId, item.projectId),
        ),
      ),
    )
    .orderBy(labelTable.name, labelTable.id);
  return rows.map(({ assignedId, ...label }) => ({
    ...label,
    assigned: assignedId !== null,
  }));
}

// The caller holds the work-item row lock and has already checked its version.
export async function replaceWorkItemLabels(
  tx: Transaction,
  workItemId: string,
  workspaceId: string,
  projectId: string,
  labelIds: string[],
) {
  const after = [...labelIds].sort();
  const valid = after.length
    ? await tx
        .select({ id: labelTable.id })
        .from(labelTable)
        .where(
          and(
            inArray(labelTable.id, after),
            eq(labelTable.workspaceId, workspaceId),
            isNull(labelTable.taskId),
            or(
              isNull(labelTable.projectId),
              eq(labelTable.projectId, projectId),
            ),
          ),
        )
        .for("key share")
    : [];
  if (valid.length !== after.length)
    throw new HTTPException(422, {
      message: "Labels must belong to this workspace or project catalogue",
    });
  const before = (
    await tx
      .select({ id: workItemLabelTable.labelId })
      .from(workItemLabelTable)
      .where(eq(workItemLabelTable.workItemId, workItemId))
  )
    .map((row) => row.id)
    .sort();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    await tx
      .delete(workItemLabelTable)
      .where(eq(workItemLabelTable.workItemId, workItemId));
    if (after.length)
      await tx
        .insert(workItemLabelTable)
        .values(after.map((labelId) => ({ workItemId, labelId })));
  }
  return { before, after };
}

export async function lockLabelWorkItems(
  tx: Transaction,
  workspaceId: string,
  labelId: string,
) {
  return tx
    .select({ item: workItemTable })
    .from(workItemTable)
    .innerJoin(
      workItemLabelTable,
      eq(workItemLabelTable.workItemId, workItemTable.id),
    )
    .where(
      and(
        eq(workItemLabelTable.labelId, labelId),
        eq(workItemTable.workspaceId, workspaceId),
      ),
    )
    .orderBy(workItemTable.id)
    .for("update", { of: workItemTable });
}

export async function listAssignedLabelIds(
  tx: Transaction,
  workItemId: string,
) {
  return (
    await tx
      .select({ id: workItemLabelTable.labelId })
      .from(workItemLabelTable)
      .where(eq(workItemLabelTable.workItemId, workItemId))
  )
    .map((row) => row.id)
    .sort();
}

export async function advanceLabelWorkItemVersion(
  tx: Transaction,
  workItemId: string,
) {
  await tx
    .update(workItemTable)
    .set({ version: sql`${workItemTable.version} + 1` })
    .where(eq(workItemTable.id, workItemId));
}
