/**
 * `DELETE /api/task/{id}` is gone (P0 deletion audit). It used to hard-delete the legacy `task`
 * row and fire-and-forget its S3 assets with no pending action, approval or recovery window.
 *
 * It is not re-routed to the work-item deletion pending action because that flow is keyed by a
 * `work_item.key` and operates on the `work_item` table; a legacy `task.id` addresses the
 * separate inherited `task` table and there is no task→work-item mapping to resolve it through.
 * The route keeps its reach/permission middleware (an unknown or unreachable id still answers
 * 404/403 exactly as before) and then answers 410 (built from the route context, not thrown, so
 * the middleware's `Deprecation`/`Sunset`/`Link` headers survive — the app's `onError` rebuilds
 * a thrown HTTPException's response without them). Successor: `DELETE /api/work-items/{key}`.
 */
export const LEGACY_TASK_DELETION_GONE_MESSAGE =
  "task_delete_gone: DELETE /api/task/{id} no longer deletes. Request deletion through DELETE /api/work-items/{key}, which records a pending action for approval.";
