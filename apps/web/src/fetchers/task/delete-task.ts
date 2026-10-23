import requestWorkItemDeletion from "@/fetchers/work-item/request-work-item-deletion";

/**
 * The legacy `DELETE /api/task/{id}` answers 410. Deletion goes through
 * `DELETE /api/work-items/{key}`, keyed by the work item key (for example `PROJ-12`), and
 * only creates a pending action.
 */
async function requestTaskDeletion(workItemKey: string) {
  return requestWorkItemDeletion(workItemKey);
}

export default requestTaskDeletion;
