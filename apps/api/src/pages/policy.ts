import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Project pages (feature-contracts-p5.md, "Project pages"). Reading is `project:read`; creating,
 * editing, restoring and requesting deletion is `project:update`, both evaluated at the project
 * after the caller's reach is established. Pages are staff-only (PG-2): the route middleware
 * answers a customer or portal session, an out-of-reach project and a missing page with one
 * constant-shape 404 before any capability is consulted, so a 403 is only ever seen by a staff
 * caller who reaches the project.
 *
 * `GET .../versions/{number}` is an addition to the contract's list: the history panel previews a
 * version's body before restoring it, under the same `project:read`.
 */
const read = {
  capability: "project:read",
  scope: "project",
  scopeSource: "row",
  reach: "required",
} as const;
const update = {
  capability: "project:update",
  scope: "project",
  scopeSource: "row",
  reach: "required",
} as const;

export const pagesPolicies = {
  "GET /api/projects/{projectId}/pages": read,
  "POST /api/projects/{projectId}/pages": update,
  "GET /api/projects/{projectId}/pages/{id}": read,
  "PATCH /api/projects/{projectId}/pages/{id}": update,
  "GET /api/projects/{projectId}/pages/{id}/versions": read,
  "GET /api/projects/{projectId}/pages/{id}/versions/{number}": read,
  "POST /api/projects/{projectId}/pages/{id}/restore": update,
  "POST /api/projects/{projectId}/pages/{id}/undelete": update,
  "DELETE /api/projects/{projectId}/pages/{id}": update,
} as const satisfies PolicyMap;
