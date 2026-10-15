import { listLabelsByWorkspaceId } from "../repository";

/**
 * The workspace's label list. A label DEFINITION (no task) is workspace-level and always
 * listed. A label bound to a task is listed only when that task's project is one of
 * `reachableProjectIds` (#740); the filter lives in the repository statement, so a hidden
 * label is never selected.
 */
function getLabelsByWorkspaceId(
  workspaceId: string,
  reachableProjectIds: readonly string[],
) {
  return listLabelsByWorkspaceId(workspaceId, reachableProjectIds);
}

export default getLabelsByWorkspaceId;
