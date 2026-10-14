/**
 * The route keys each behavioural reach table covers. Pure data (no DB), imported by the
 * integration tests (which assert their table matches the list exactly) AND by
 * `tests/permissions/work-item-reach-guard.test.ts`, which requires every route in its set to
 * appear here or in a reasoned exemption, so a reach marker without a behavioural row fails.
 */
export const ITEM_WRITE_ROUTE_KEYS = [
  "PATCH /api/work-items/{key}",
  "POST /api/work-items/{key}/assign",
  "DELETE /api/work-items/{key}/assign",
  "DELETE /api/work-items/{key}",
  "POST /api/work-items/{key}/rank",
  "POST /api/work-items/{key}/parent",
  "DELETE /api/work-items/{key}/parent",
  "POST /api/work-items/{key}/watch",
  "DELETE /api/work-items/{key}/watch",
  "POST /api/work-items/{key}/transition",
  "POST /api/work-items/{key}/comments",
  "POST /api/work-items/{key}/attachments/presign",
  "DELETE /api/attachments/{id}",
  "POST /api/attachments/{id}/complete",
  "POST /api/work-items/{key}/approvals",
  "PATCH /api/comments/{id}",
  "DELETE /api/comments/{id}",
] as const;

export const LEGACY_WRITE_ROUTE_KEYS = [
  "PUT /api/task/{id}",
  "PUT /api/v2/task/{id}",
  "PUT /api/task/status/{id}",
  "PUT /api/task/priority/{id}",
  "PUT /api/task/assignee/{id}",
  "PUT /api/task/due-date/{id}",
  "PUT /api/task/title/{id}",
  "PUT /api/task/description/{id}",
  "PUT /api/task/move/{id}",
  "PUT /api/task/image-upload/{id}",
  "POST /api/task/image-upload/{id}/finalize",
  "DELETE /api/task/{id}",
  "POST /api/comment/{taskId}",
  "PUT /api/comment/{id}",
  "DELETE /api/comment/{id}",
  "POST /api/activity/create",
  "POST /api/activity/comment",
  "PUT /api/activity/comment",
  "DELETE /api/activity/comment",
  "POST /api/task-relation",
  "DELETE /api/task-relation/{id}",
] as const;

export const READ_ROUTE_KEYS = [
  "GET /api/work-items/{key}",
  "GET /api/work-items/{key}/sla",
  "GET /api/work-items/{key}/activity",
  "GET /api/work-items/{key}/tree",
  "GET /api/work-items/{key}/transitions",
  "GET /api/work-items/{key}/attachments",
  "GET /api/work-items/{key}/comments/mention-candidates",
  "POST /api/work-items/{key}/comments/mention-preflight",
  "GET /api/work-items/{key}/comments/{id}/versions",
  "GET /api/attachments/{id}",
  "GET /api/task/{id}",
  "GET /api/comment/{taskId}",
  "GET /api/activity/{taskId}",
  "GET /api/task-relation/{taskId}",
  "GET /api/external-link/task/{taskId}",
] as const;

/** Covered by a dedicated test (`work-item-project-reach-credentials.test.ts`). */
export const OTHER_COVERED_ROUTE_KEYS = [
  "POST /api/work-items/search",
] as const;
