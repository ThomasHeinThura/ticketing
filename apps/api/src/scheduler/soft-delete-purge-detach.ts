import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "../database/executor";
import { workItemTable } from "../database/schema";
import { recordWorkItemActivity } from "../work-item/activity";
import { WORK_ITEM_HIERARCHY_LOCK_NAMESPACE } from "../work-item/hierarchy-lock";

/**
 * P1-23 / `WI-22`: deleting a parent orphans its children. A soft-deleted parent keeps its
 * children attached for the 30-day restore window (restore needs no repair); when the window
 * ends, the purge detaches every remaining child (`parent_id` -> null) and journals one
 * `updated`/`parent` activity row per child, then the caller deletes the parent row. The
 * `parent_id` FK is RESTRICT, so without this a parent with any child was never purged.
 *
 * Runs inside the purge's hold-fenced transaction. Lock order matches the write routes: the
 * project hierarchy advisory lock first, then row locks (the purge takes the advisory lock
 * BEFORE `lockEligibleWorkItem`, so it cannot deadlock a concurrent `set-work-item-parent`).
 * Children share the parent's project (composite FK), so one project lock covers them.
 */
export async function lockWorkItemHierarchyForProject(
  tx: Transaction,
  projectId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${WORK_ITEM_HIERARCHY_LOCK_NAMESPACE}, hashtext(${projectId}))`,
  );
}

export async function detachChildrenForPurge(
  tx: Transaction,
  parent: { id: string; projectId: string },
): Promise<number> {
  // Already held when the purge took it before the row lock (re-entrant, same transaction).
  await lockWorkItemHierarchyForProject(tx, parent.projectId);
  const children = await tx
    .select({
      id: workItemTable.id,
      workspaceId: workItemTable.workspaceId,
    })
    .from(workItemTable)
    .where(eq(workItemTable.parentId, parent.id))
    .orderBy(workItemTable.id)
    .for("update");
  if (children.length === 0) return 0;

  const now = new Date();
  for (const child of children) {
    await tx
      .update(workItemTable)
      .set({
        parentId: null,
        updatedAt: now,
        version: sql`${workItemTable.version} + 1`,
      })
      .where(
        and(
          eq(workItemTable.id, child.id),
          eq(workItemTable.parentId, parent.id),
        ),
      );
  }
  await recordWorkItemActivity(
    tx,
    children.map((child) => ({
      workspaceId: child.workspaceId,
      workItemId: child.id,
      actorId: null,
      actorType: "system" as const,
      verb: "updated",
      field: "parent",
      oldValue: parent.id,
      newValue: null,
      payload: { reason: "parent_purged" },
      visibility: "internal" as const,
    })),
  );
  return children.length;
}
