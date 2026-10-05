import type { PolicyMap } from "@taskdesk/permissions";

/**
 * External-link route policies (issue #8).
 *
 * An external link connects a task to a resource in a connected integration (GitHub, Gitea
 * issue, etc). `docs/01-architecture/inherited-features.md` names `external_link` as the
 * extension point future integrations attach to (the six inherited integration routers
 * themselves are removed at fork, but this router is `Keep` — "the mechanisms v2 assumes").
 * The one route here is capability-kind (kind 1), not `self`/`portal`/`public`/`delegated`,
 * and not `elevated` — `work_item:read` is not in `AUTHORITY_GRANTING`. No `sessionOnly`,
 * same reasoning as every other file in this batch.
 *
 * The read route enforces `work_item:read` after resolving reach from the task row. Global
 * instance reach does not grant a workspace capability.
 *
 * **Scope: `work_item`**, matching `task-relation/policy.ts`'s reasoning exactly — this route
 * addresses one specific task by `{taskId}`, and `work_item` is the nearest scope-enum tier
 * that IS the addressed resource (rbac.md's `'GET /api/work-items/{key}'` precedent).
 *
 * **scopeSource: `"row"`.** `workspaceAccess.fromTaskId("taskId")` issues a real `SELECT ...
 * FROM task JOIN project WHERE task.id = :taskId` — the task's own row is read to derive its
 * containment chain, never a trusted, unread path value.
 *
 * **`reach: "required"`**, same reasoning as every other file in this batch: the route
 * addresses an existing task, so its reach is a real question.
 */
export const externalLinkPolicies = {
  // All links from a task to connected-integration resources.
  "GET /api/external-link/task/{taskId}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
