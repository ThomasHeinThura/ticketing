/**
 * Route keys covered by the project-scoped behavioural reach tables (#720). Pure data (no
 * DB): imported by the integration suites (which assert their table matches the list exactly)
 * AND by `tests/permissions/project-reach-guard.test.ts`, which requires every project-scoped
 * `reach: "required"` route to appear here or to carry a reasoned exemption.
 */

/** Writes addressed to one project, directly (`{id}`/`{projectId}`) or through a child row. */
export const PROJECT_WRITE_ROUTE_KEYS = [
  "PUT /api/project/{id}",
  "PATCH /api/project/{id}/health",
  "DELETE /api/project/{id}",
  "PUT /api/project/{id}/archive",
  "PUT /api/project/{id}/unarchive",
  "POST /api/project/{id}/milestones",
  "PATCH /api/project/{id}/milestones/{milestoneId}",
  "DELETE /api/project/{id}/milestones/{milestoneId}",
  "POST /api/project/{id}/prerequisites",
  "PATCH /api/project/{id}/prerequisites/{prerequisiteId}",
  "DELETE /api/project/{id}/prerequisites/{prerequisiteId}",
  "POST /api/project/{id}/stakeholders",
  "PATCH /api/project/{id}/stakeholders/{stakeholderId}",
  "POST /api/project/{id}/stakeholders/{stakeholderId}/stand-down",
  "POST /api/project/{id}/document-links",
  "DELETE /api/project/{id}/document-links/{documentLinkId}",
  "POST /api/projects/{projectId}/work-items",
  "POST /api/task/{projectId}",
  "POST /api/task/import/{projectId}",
  "POST /api/column/{projectId}",
  "PUT /api/column/reorder/{projectId}",
  "PUT /api/column/{id}",
  "DELETE /api/column/{id}",
  "PUT /api/workflow-rule/{projectId}",
  "DELETE /api/workflow-rule/{id}",
] as const;

/** Reads of one project's own data. */
export const PROJECT_READ_ROUTE_KEYS = [
  "GET /api/project/{id}",
  "GET /api/project/{id}/health",
  "GET /api/project/{id}/milestones",
  "GET /api/project/{id}/prerequisites",
  "GET /api/project/{id}/stakeholders",
  "GET /api/project/{id}/document-links",
  "GET /api/projects/{projectId}/assignable",
  "GET /api/projects/{projectId}/states",
  "GET /api/projects/{projectId}/work-items",
  "GET /api/task/tasks/{projectId}",
  "GET /api/task/export/{projectId}",
  "GET /api/column/{projectId}",
  "GET /api/workflow-rule/{projectId}",
] as const;

/**
 * Routes whose policy stays workspace-scoped (or reach-exempt: a list of ids) but which ACT ON
 * A SPECIFIC TASK, or on an asset's own project, and so carry project reach through their own
 * middleware (`task-target-reach.ts`, `requireBulkTaskReach`, `requireAssetProjectReach`).
 * Decision 720-A (`rbac.md` § Reach). The four time-entry routes and `GET /api/label/task/...`
 * are declared on the `work_item` scope and are covered by the work-item guard instead.
 */
export const TASK_TARGET_ROUTE_KEYS = [
  "POST /api/label",
  "GET /api/label/{id}",
  "PUT /api/label/{id}",
  "DELETE /api/label/{id}",
  "PUT /api/label/{id}/task",
  "DELETE /api/label/{id}/task",
  "GET /api/asset/{id}",
  "PATCH /api/task/bulk",
] as const;

/** The work-item-scoped routes #720 added to the existing work-item guard set. */
export const TASK_TARGET_WORK_ITEM_ROUTE_KEYS = [
  "GET /api/label/task/{taskId}",
  "GET /api/time-entry/task/{taskId}",
  "GET /api/time-entry/{id}",
  "POST /api/time-entry",
  "PUT /api/time-entry/{id}",
] as const;
