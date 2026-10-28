import type { ActivityRow } from "@taskdesk/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { type Executor, executorOrDefault } from "../database/executor";
import {
  activityTable,
  auditLogTable,
  workItemTable,
} from "../database/schema";
import { activityValueToString } from "./activity-value";

/** Rows returned for one entity's audit history; the full journal stays in `activity`. */
export const ENTITY_AUDIT_HISTORY_LIMIT = 200;
/** Upper bound on activity rows replayed for one reconstruction. */
export const RECONSTRUCTION_MAX_ROWS = 20000;

/**
 * The work item's complete `activity` journal, oldest first, plus the item's present values
 * as the reconstruction baseline (AU-8, AU-9). The whole journal is needed, not only the rows
 * up to `at`: a field's creation value is the old value of its first change, which may be
 * later than `at`. `reconstructAt` itself stops at `at`.
 */
export async function listActivityForReconstruction(
  workspaceId: string,
  workItemId: string,
  _at: Date,
  executor?: Executor,
): Promise<{
  rows: ActivityRow[];
  truncated: boolean;
  current: Record<string, string | null>;
}> {
  const tx = executorOrDefault(executor);
  const [journal, [item]] = await Promise.all([
    tx
      .select({
        seq: activityTable.seq,
        verb: activityTable.verb,
        field: activityTable.field,
        oldValue: activityTable.oldValue,
        newValue: activityTable.newValue,
        payload: activityTable.payload,
        createdAt: activityTable.createdAt,
      })
      .from(activityTable)
      .where(
        and(
          eq(activityTable.workspaceId, workspaceId),
          eq(activityTable.workItemId, workItemId),
        ),
      )
      .orderBy(asc(activityTable.createdAt), asc(activityTable.seq))
      .limit(RECONSTRUCTION_MAX_ROWS + 1),
    tx
      .select({
        stateId: workItemTable.stateId,
        assigneeId: workItemTable.assigneeId,
        priority: workItemTable.priority,
        title: workItemTable.title,
      })
      .from(workItemTable)
      .where(eq(workItemTable.id, workItemId))
      .limit(1),
  ]);
  const truncated = journal.length > RECONSTRUCTION_MAX_ROWS;
  const picked = truncated
    ? journal.slice(0, RECONSTRUCTION_MAX_ROWS)
    : journal;
  return {
    truncated,
    current: item
      ? {
          stateId: item.stateId,
          assigneeId: item.assigneeId,
          priority: item.priority,
          title: item.title,
        }
      : {},
    rows: picked.map((row) => ({
      sequence: Number(row.seq ?? 0n),
      verb: row.verb,
      field: row.field,
      oldValue: activityValueToString(row.oldValue),
      newValue: activityValueToString(row.newValue),
      payload: row.payload,
      createdAt: row.createdAt,
    })),
  };
}

/** One entity's audit rows, newest first, in its own workspace only (AU-10 reach was already
 * proven by the route's work-item reach middleware). */
export async function listEntityAuditRows(
  workspaceId: string,
  entityType: string,
  entityId: string,
  executor?: Executor,
) {
  const tx = executorOrDefault(executor);
  return tx
    .select()
    .from(auditLogTable)
    .where(
      and(
        eq(auditLogTable.workspaceId, workspaceId),
        eq(auditLogTable.entityType, entityType),
        eq(auditLogTable.entityId, entityId),
      ),
    )
    .orderBy(desc(auditLogTable.seq))
    .limit(ENTITY_AUDIT_HISTORY_LIMIT);
}
