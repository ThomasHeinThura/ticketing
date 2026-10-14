import { and, eq, inArray, isNull, or } from "drizzle-orm";
import db from "../../database";
import { labelTable, taskTable } from "../../database/schema";

/**
 * The workspace's label list. A label DEFINITION (no task) is workspace-level and always
 * listed. A label bound to a task is listed only when that task's project is one of
 * `reachableProjectIds` (#740): a task-bound label names its task's project, so listing it for a
 * caller without reach to that project would disclose the task. The filter is in the SQL, so
 * a hidden label is never selected.
 */
function getLabelsByWorkspaceId(
  workspaceId: string,
  reachableProjectIds: readonly string[],
) {
  const reachableTask =
    reachableProjectIds.length === 0
      ? undefined
      : inArray(
          labelTable.taskId,
          db
            .select({ id: taskTable.id })
            .from(taskTable)
            .where(inArray(taskTable.projectId, [...reachableProjectIds])),
        );
  return db
    .select()
    .from(labelTable)
    .where(
      and(
        eq(labelTable.workspaceId, workspaceId),
        reachableTask
          ? or(isNull(labelTable.taskId), reachableTask)
          : isNull(labelTable.taskId),
      ),
    );
}

export default getLabelsByWorkspaceId;
