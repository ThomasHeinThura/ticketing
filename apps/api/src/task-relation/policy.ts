import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Task-relation route policies (issue #8).
 *
 * A task relation links two tasks (kaneo's `task`, the pre-migration table behind the target
 * `work_item` — `docs/01-architecture/data-model.md`'s `work_item` entry is the native
 * replacement; nothing in this batch migrates the table, only classifies the routes that read
 * and write it today). All three routes are capability-kind (kind 1); none is
 * `self`/`portal`/`public`/`delegated`, and none is `elevated` — no Work-items-group
 * capability declared below is in `AUTHORITY_GRANTING`. No `sessionOnly`, same reasoning as
 * `project/policy.ts` and `column/policy.ts`: kaneo never restricted `/api/task-relation/*` to
 * a browser session, and this batch does not start narrowing reach on inherited routes that
 * were never native S2/S4/S5 workspace-management surfaces.
 *
 * **Legacy resource key mismatch: `task`, not `work_item`.** The runtime check on the two
 * mutation routes is `requireWorkspacePermission({ task: ["update"] })` — `task` is the legacy
 * `statement` key (`legacy-better-auth-access-control.ts`: `task: ["create", "read", "update",
 * "delete", "assign"]`), a plain rename of what the target `Capability` union calls
 * `work_item:*`. This is the same shape of gap `workspace/policy.ts` documents for
 * `organization:update` vs `workspace:update` — a same-precision renaming, not a granularity
 * gap like `column/policy.ts`'s `project:manage_settings` note — and it closes automatically
 * the day #7 re-keys the seeded `workspace_role` rows and the evaluator to `work_item:*`.
 * `work_item:update` is declared below because it is the exact target-vocabulary name for what
 * `task: ["update"]` enforces today; there is no more specific "link two tasks" capability in
 * rbac.md's Work-items group to reach for instead.
 *
 * **Scope: `work_item`, not `project`.** Every route here is scoped to a specific TASK (the
 * one named by `{taskId}`, or, for the two mutation routes, the relation's own *source* task —
 * `create-task-relation.ts`'s doc comment: "Authorization is scoped to the source task's
 * workspace"), never merely to the project the task lives in. `work_item` is the nearest
 * scope-enum tier that IS the addressed resource here, matching rbac.md's own
 * `'GET /api/work-items/{key}': { capability: 'work_item:read', scope: 'work_item' }` example
 * — a route addressing one work item by id declares `scope: 'work_item'`, not `'project'`.
 *
 * **scopeSource: `"row"` throughout.** None of the three routes takes its scope id from an
 * unread path/query/header value:
 * - `GET /api/task-relation/{taskId}` resolves through `workspaceAccess.fromTaskId("taskId")`,
 *   which issues a real `SELECT ... FROM task JOIN project WHERE task.id = :taskId` — the
 *   task's own row is read to derive its containment.
 * - `POST /api/task-relation` resolves through this file's own `scopeToSourceTask` middleware,
 *   which reads `sourceTaskId` from the body and then queries `workspaceIdOfTask` — the same
 *   task+project join, this time against the SOURCE task the relation is being created from.
 *   `create-task-relation.ts`'s controller re-reads the full source (and target) task row
 *   itself (`id`, `projectId`, `workspaceId`) in the same call, so every fact
 *   `workItemScopeFromRow` needs (`workItemId`, `projectId`, `workspaceId`) is genuinely
 *   available from a loaded row, not merely the path.
 * - `DELETE /api/task-relation/{id}` resolves through this file's own `scopeToRelation`
 *   middleware, which loads the addressed `task_relation` row itself (by `{id}`) to get its
 *   `sourceTaskId`, then the same `workspaceIdOfTask` join. Two hops, but both are real row
 *   reads, never a trusted request value.
 *
 * **`reach: "required"` throughout**, matching `project/policy.ts`'s and `column/policy.ts`'s
 * reasoning: every route addresses an existing task (directly, or via the relation that
 * references it), so its reach is a real question, not the `no_single_resource` exemption.
 */
export const taskRelationPolicies = {
  // Every relation where the task is the source or the target, each with a linked-task
  // summary. `workspaceAccess.fromTaskId("taskId")` is the only middleware -- no
  // `requireWorkspacePermission` call, same "reach alone, capability declared for the target
  // model anyway" shape as the column and project read routes: every seeded role holds
  // `task: ["read"]` unconditionally, so no role that reaches the task lacks read authority
  // over it.
  "GET /api/task-relation/{taskId}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Link two tasks. `scopeToSourceTask` resolves workspace access from the body's
  // `sourceTaskId`, then `requireWorkspacePermission({ task: ["update"] })` runs -- an exact
  // match for `work_item:update` under the legacy `task` key.
  "POST /api/task-relation": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Remove a link between two tasks. `scopeToRelation` resolves workspace access from the
  // addressed relation's own source task, then `requireWorkspacePermission({ task: ["update"]
  // })` runs -- same capability and reasoning as create.
  "DELETE /api/task-relation/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
