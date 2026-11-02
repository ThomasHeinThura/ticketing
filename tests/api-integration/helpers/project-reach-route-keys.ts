/**
 * Route keys covered by the project-scoped behavioural reach tables (#720). Pure data (no
 * DB): imported by the integration suites (which assert their table matches the list exactly)
 * AND by `tests/permissions/project-reach-guard.test.ts`, which requires every project-scoped
 * `reach: "required"` route to appear here or to carry a reasoned exemption.
 */

/** Writes addressed to one project, directly (`{id}`/`{projectId}`) or through a child row. */
export const PROJECT_WRITE_ROUTE_KEYS = [
  "PATCH /api/projects/{projectId}/settings/inheritance",
  "PATCH /api/projects/{projectId}/state-set",
  "PUT /api/project/{id}",
  "PATCH /api/project/{id}/health",
  "PATCH /api/project/{id}/summary",
  "PUT /api/project/{id}/contract",
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
  "PATCH /api/projects/{projectId}/ownership",
  "POST /api/projects/{projectId}/members",
  "PATCH /api/projects/{projectId}/members/{personId}",
  "DELETE /api/projects/{projectId}/members/{personId}",
  "POST /api/projects/{projectId}/states",
  "PATCH /api/projects/{projectId}/states/{stateId}",
  "PATCH /api/projects/{projectId}/features",
  "POST /api/projects/{key}/automations",
  "POST /api/projects/{projectId}/budgets",
  "POST /api/projects/{projectId}/costs",
  "POST /api/task/{projectId}",
  "POST /api/task/import/{projectId}",
  "POST /api/column/{projectId}",
  "PUT /api/column/reorder/{projectId}",
  "PUT /api/column/{id}",
  "DELETE /api/column/{id}",
  "PUT /api/workflow-rule/{projectId}",
  "DELETE /api/workflow-rule/{id}",
] as const;

/** Dedicated project-recovery.test.ts covers hidden reach and missing update capability. */
export const PROJECT_RECOVERY_ROUTE_KEYS = [
  "PUT /api/project/{id}/restore",
] as const;

/** Reads of one project's own data. */
export const PROJECT_READ_ROUTE_KEYS = [
  "GET /api/projects/{projectId}/settings/inheritance",
  "GET /api/project/{id}",
  "GET /api/project/{id}/health",
  "GET /api/project/{id}/overview",
  "GET /api/project/{id}/contract",
  "GET /api/project/{id}/milestones",
  "GET /api/project/{id}/prerequisites",
  "GET /api/project/{id}/stakeholders",
  "GET /api/project/{id}/document-links",
  "GET /api/projects/{projectId}/assignable",
  "GET /api/projects/{projectId}/states",
  "GET /api/projects/{projectId}/state-templates",
  "GET /api/projects/{projectId}/members",
  "GET /api/projects/{projectId}/members/candidates",
  "GET /api/projects/{projectId}/ownership/preview",
  "GET /api/projects/{projectId}/features",
  "GET /api/projects/{key}/automations",
  "GET /api/projects/{projectId}/budget",
  "GET /api/projects/{projectId}/costs",
  "GET /api/features/resolved",
  "GET /api/projects/{projectId}/work-items",
  "GET /api/projects/{projectId}/work-items/combined",
  "POST /api/projects/{projectId}/work-items/combined",
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

/**
 * WebSocket upgrade routes addressed to one project (#745). Their policy is `delegated:
 * "websocket"` (there is no Hono response for a policy middleware to shape), so the upgrade
 * handler itself must decide PROJECT reach and carries the reach mark the guard reads.
 * `ws-project-reach.test.ts` drives every key here against the real listener.
 */
export const PROJECT_SOCKET_ROUTE_KEYS = ["GET /api/ws/{projectId}"] as const;

/**
 * Workspace-level LIST and SEARCH routes that return rows from more than one project (#740).
 * Each declares `requireReachFilteredList` and restricts its rows to the caller's reachable
 * projects in SQL; `project-reach-reads.test.ts` drives them for sessions and API keys.
 */
export const PROJECT_LIST_ROUTE_KEYS = [
  "GET /api/label/workspace/{workspaceId}",
  "GET /api/project",
  "GET /api/search",
  "GET /api/views",
  "GET /api/submissions/{ref}/duplicates",
] as const;

/**
 * Writes whose target project is named in the body or chosen by the handler, not addressed by
 * a path id (#741). Each declares `requireReachContext`; an unreachable project is answered
 * exactly like a missing one. `project-reach-writes.test.ts` drives them.
 */
export const PROJECT_BODY_TARGET_ROUTE_KEYS = [
  "POST /api/views",
  "POST /api/submissions/{ref}/accept",
  "POST /api/submissions/{ref}/duplicate",
  "GET /api/submissions/{ref}",
  "GET /api/submissions/{ref}/attachments",
  "GET /api/submissions/{ref}/attachments/{id}",
] as const;

/**
 * Every route that addresses a saved view by id. The reach check lives in the shared
 * `workspaceAccess.fromSavedView()` lookup: a project-scoped view of a project the caller
 * does not reach is answered exactly like a missing view, before any gate or write.
 */
export const SAVED_VIEW_BY_ID_ROUTE_KEYS = [
  "GET /api/views/{id}",
  "PATCH /api/views/{id}",
  "DELETE /api/views/{id}",
  "POST /api/views/{id}/pin",
  "POST /api/views/{id}/run",
  "GET /api/views/{id}/count",
] as const;

/** Driven by the catalogue CRUD/isolation cases in work-item-labels.test.ts. */
export const PROJECT_LABEL_ROUTE_KEYS = [
  "GET /api/label/project/{projectId}/catalogue",
  "POST /api/label/project/{projectId}/catalogue",
  "PATCH /api/label/project/{projectId}/catalogue/{id}",
  "DELETE /api/label/project/{projectId}/catalogue/{id}",
] as const;

/**
 * P5 agile planning (cycles, modules, estimates, WIP limits, dependency edges): project-scoped
 * routes driven by the per-route reach and capability table in p5-agile-reach.test.ts, which
 * asserts its table matches this list exactly.
 */
export const PROJECT_AGILE_ROUTE_KEYS = [
  "GET /api/projects/{key}/cycles",
  "POST /api/projects/{key}/cycles",
  "GET /api/cycles/{id}",
  "PATCH /api/cycles/{id}",
  "DELETE /api/cycles/{id}",
  "POST /api/cycles/{id}/complete",
  "POST /api/cycles/{id}/work-items",
  "DELETE /api/cycles/{id}/work-items/{workItemKey}",
  "GET /api/cycles/{id}/burndown",
  "GET /api/projects/{key}/modules",
  "POST /api/projects/{key}/modules",
  "GET /api/modules/{id}",
  "PATCH /api/modules/{id}",
  "DELETE /api/modules/{id}",
  "POST /api/modules/{id}/work-items",
  "DELETE /api/modules/{id}/work-items/{workItemKey}",
  "GET /api/projects/{key}/estimates",
  "PATCH /api/projects/{key}/estimates",
  "GET /api/projects/{key}/agile-settings",
  "PATCH /api/projects/{key}/agile-settings",
  "GET /api/projects/{key}/wip-limits",
  "PUT /api/projects/{key}/wip-limits/{stateId}",
  "GET /api/projects/{key}/dependencies",
] as const;

/**
 * P5 project pages: staff-only, project-scoped routes driven by the per-route table in
 * p5-pages-reach.test.ts, which asserts its table matches this list exactly.
 */
export const PROJECT_PAGES_ROUTE_KEYS = [
  "GET /api/projects/{projectId}/pages",
  "POST /api/projects/{projectId}/pages",
  "GET /api/projects/{projectId}/pages/{id}",
  "PATCH /api/projects/{projectId}/pages/{id}",
  "GET /api/projects/{projectId}/pages/{id}/versions",
  "GET /api/projects/{projectId}/pages/{id}/versions/{number}",
  "POST /api/projects/{projectId}/pages/{id}/restore",
  "POST /api/projects/{projectId}/pages/{id}/undelete",
  "DELETE /api/projects/{projectId}/pages/{id}",
] as const;

/** The item-scoped agile routes, covered by the same table (the work-item reach guard reads them). */
export const PROJECT_AGILE_ITEM_ROUTE_KEYS = [
  "GET /api/work-items/{key}/estimate",
  "PUT /api/work-items/{key}/estimate",
  "PUT /api/work-items/{key}/cycle",
  "PUT /api/work-items/{key}/module",
] as const;
