import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Task route policies (issue #8, `task` sub-router — `apps/api/src/task/index.ts`, mounted at
 * `/api/task` in `apps/api/src/index.ts`).
 *
 * Covers the 17 routes `tests/permissions/inherited-uncovered.json` lists under `/api/task`
 * (the sibling `task-relation` router, mounted separately at `/api/task-relation`, is a
 * different lane's file and is untouched here). All 17 are registered well below
 * `AUTH_GUARD_KEY` (`ALL /api/*` at index 38 in `apps/api/src/index.ts`; `task` mounts at
 * line 783, the guard is at line 755) — verified directly rather than assumed, per H2 (#163):
 * none of these routes are constrained by registration order.
 *
 * **Capability strings are the TARGET vocabulary; the runtime is still the legacy resource-map
 * shape, now re-keyed to match it.** Same transitional shape `workspace/policy.ts` already
 * documents for `organization:update`/`workspace:update`. `packages/permissions/src/
 * capabilities.ts` has no `task:*` capability at all; the five capabilities used below
 * (`work_item:read`, `work_item:create`, `work_item:update`, `work_item:delete`,
 * `work_item:assign`) are the "Work items" group in `docs/01-architecture/rbac.md`. The
 * RUNTIME check on every mutating route is `requireWorkspacePermission({ work_item: [...] })`
 * (`apps/api/src/utils/require-workspace-permission.ts`) against the INHERITED `work_item`
 * resource the seeded `workspace_role` rows and the compiled built-in roles actually carry
 * (`packages/permissions/src/legacy-better-auth-access-control.ts`: `work_item: ["create", "read",
 * "update", "delete", "assign"]`) — re-keyed from the inherited `task` name to `work_item`
 * (2026-09-23 decision log entry, "shadow until clean, then strict; rename `task:*` first"),
 * a prerequisite for this router's shadow-mode soak. The declaration and the runtime resource
 * NAME now agree; the runtime is still this legacy resource-map shape, not the new
 * capability-string evaluator — wiring the registry into the request path is #8's own,
 * separately tracked runtime-integration obligation, not this rename's.
 *
 * The task reads enforce their declared `work_item:read` capability after row-derived reach.
 * Instance-wide reach does not replace the caller's workspace role.
 *
 * **Scope.** Per `evaluator.ts` (`GRANT_SCOPES_FOR`, `requiredIdFor`), a `work_item`-scope
 * policy is authority-checked against the work item's own CONTAINING PROJECT (there is no
 * per-work-item role scope; `docs/01-architecture/rbac.md`'s own worked example is `can(id,
 * 'work_item:assign', 'project', { projectId })`), and constructing a `work_item`-kind
 * `ResolvedScope` (`workItemScopeFromRow`/`FromRequest`, `evaluator.ts`) requires an actual
 * `workItemId`. So:
 * - a route addressing ONE existing task by `{id}` declares `scope: "work_item"` —
 *   `workspaceAccess.fromTask()` joins `task → project → workspace` and returns the task's
 *   own containing workspace, and the route's own controller separately loads the task row
 *   itself (id, and usually more), so the work item's id, project id and workspace id are
 *   all read off real persisted rows in the course of handling the request — `scopeSource:
 *   "row"`, matching `apps/api/src/project/policy.ts`'s identical reasoning for `GET /api/
 *   project/{id}`.
 * - a route addressing a project's collection (list, export) or creating/importing INTO a
 *   project, by `{projectId}`, has no single work-item id to construct a `work_item`-kind
 *   scope from at all — these declare `scope: "project"` instead, which is
 *   authority-equivalent for a workspace- or instance-level grant (`GRANT_SCOPES_FOR` is the
 *   same set, `["instance", "workspace", "project"]`, for both `"project"` and `"work_item"`)
 *   and is the only one that is structurally constructible here.
 *   `workspaceAccess.fromProject("projectId")` queries `projectTable` for the project's own
 *   `workspaceId` and 400s if the project does not exist — `scopeSource: "row"`, same
 *   middleware and same reasoning `apps/api/src/project/policy.ts` already uses for `GET
 *   /api/project/{id}`.
 * - `PATCH /bulk` addresses neither one project nor one task — see its own entry below.
 *
 * **`workspaceAccess.fromTask()` no longer has a query-param fallback (issue #256).**
 * `fromTask`'s source list used to be `[{lookup: task}, {query: "workspaceId"}]`
 * (`apps/api/src/utils/workspace-access-middleware.ts`): if the path's task id did not
 * resolve to a real row, the middleware fell through to an ATTACKER-SUPPLIED
 * `?workspaceId=` query param and validated membership against THAT instead. #256 removed
 * that second source from all 8 `[lookup, query]`-shaped helpers, `fromTask` included — a
 * nonexistent task id now 404s directly from the middleware itself (`"Task not found"`),
 * before any authority decision runs, never falling through to a caller-supplied
 * workspace. This was never exploitable here (every controller in this file does its own
 * authoritative task lookup afterward and 404s independently), but it is closed at the
 * source now rather than merely relied upon to stay benign.
 *
 * **No `work_item:*` capability is in `AUTHORITY_GRANTING`** (`packages/permissions/src/
 * elevated.ts`), so no route in this file declares `elevated`/`elevationExemptionReason` —
 * omitted throughout, matching `workspace/policy.ts`'s own `member:invite` precedent for a
 * capability outside that set.
 *
 * **No `sessionOnly` declared anywhere in this file, unlike `workspace/policy.ts`.** That
 * file restricted its (newly native) routes to session-only to preserve a restriction the
 * REPLACED better-auth `organization()` plugin actually had. These 17 routes are not
 * replacements of that plugin — they are kaneo's original task CRUD surface, already
 * reachable by API key today, and `requireWorkspacePermission`/`hasWorkspacePermission`
 * already have a documented, exercised API-key-scoping code path (`apiKey?.permissions` /
 * `satisfies(...)`). Restricting these to session-only now would be a behaviour change this
 * lane was not asked to make, not a preservation of one.
 */
export const taskPolicies = {
  // Read one task by id, with its assignee's name resolved (`controllers/get-task.ts`).
  // Runtime checks row-derived reach and the declared `work_item:read` capability.
  "GET /api/task/{id}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // A project's board: columns, each with its tasks, plus archived/planned buckets
  // (`controllers/get-tasks.ts`, route path `/tasks/{projectId}`). Addresses one project by
  // path id; the returned board is that project's own contained collection, not multiple
  // top-level resources — same "addresses one container, returns what's inside it" shape
  // `workspace/policy.ts` uses for `GET /api/workspace/{workspaceId}/invitations`. Runtime
  // runtime checks project-row reach and the declared `work_item:read` capability.
  "GET /api/task/tasks/{projectId}": {
    capability: "work_item:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Retired (`410 Gone` under Decision 20 / P-15). Runtime checks project-row reach and
  // `work_item:read` capability (returning 400/403/404 as before) and then returns 410 Gone
  // for live projects under the compatibility Deprecation/Sunset/Link headers. Successor:
  // `GET /api/work-items/export`.
  "GET /api/task/export/{projectId}": {
    capability: "work_item:read",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Create a task in a project (`controllers/create-task.ts`). Addresses the EXISTING
  // project by path id (`workspaceAccess.fromProject`, which 400s if the project does not
  // exist); the task itself has no row yet, which is exactly why scope is `"project"`
  // (the addressed, existing container) rather than `"work_item"`. Runtime gate is
  // `requireWorkspacePermission({ work_item: ["create"] })`.
  //
  // NOTE, not a separate branch: the request body may set an initial `userId` (assignee).
  // `create-task.ts` does not additionally require `work_item:assign` for that — assigning at
  // creation time is bundled under create authority as this route is actually implemented.
  // There is no `orSelfTarget`/owner-branch shape that represents "this capability also
  // covers a body field," so this is recorded here in prose rather than in the policy
  // structure.
  "POST /api/task/{projectId}": {
    capability: "work_item:create",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Retired (`410 Gone` under Decision 20 / P-15). Addresses the project by path id; runtime
  // checks reach and `requireWorkspacePermission({ work_item: ["create"] })` (returning
  // 400/403/404 as before) and then returns 410 Gone for live projects under the compatibility
  // Deprecation/Sunset/Link headers. Successor: `POST /api/instance/imports`.
  "POST /api/task/import/{projectId}": {
    capability: "work_item:create",
    scope: "project",
    scopeSource: "row",
    reach: "required",
  },

  // Delete a task and its comments, labels and time entries (`controllers/delete-task.ts`).
  // Addresses one task by id; runtime gate is `requireWorkspacePermission({ work_item: ["delete"]
  // })`.
  "DELETE /api/task/{id}": {
    capability: "work_item:delete",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Move a task to another project (optionally into a named column;
  // `controllers/move-task.ts`). Addresses the SOURCE task by id; runtime gate is
  // `requireWorkspacePermission({ work_item: ["update"] })`. The controller separately loads both
  // the source and destination project rows and 400s unless they share one workspace
  // (`sourceProject.workspaceId !== destinationProject.workspaceId`), so scope stays bound to
  // the addressed task's own (source) workspace — a caller cannot use the destination-project
  // field to redirect authority elsewhere.
  "PUT /api/task/move/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Replace every field of a task (`controllers/update-task.ts`). Addresses one task by id;
  // the ALWAYS-RUNNING gate is `requireWorkspacePermission({ work_item: ["update"] })`, so
  // `work_item:update` is the correct primary declaration.
  //
  // NOT fully captured by a single capability, and recorded here rather than guessed away:
  // `requireTaskAssigneePermission` (`controllers/require-task-permission.ts`) runs AFTER the
  // update check and ADDITIONALLY requires `work_item:assign` whenever the request body's `userId`
  // differs from the task's existing assignee — an AND, not an OR, and not representable by
  // `orOwner`/`orSelfTarget` (those are alternate-path branches, not "also requires this other
  // capability when this field changes"). `work_item:assign` does not imply `work_item:update`
  // (`capabilities.ts`), so a role holding only `work_item:update` (e.g. `member`) can call
  // this route successfully for a non-reassigning edit but will be refused 403 the moment the
  // body also reassigns the task. The generated permission matrix, being driven off the single
  // declared capability, will read `member → allow` for this whole route; that is optimistic
  // for the reassignment case specifically, not a runtime hole (the runtime is the STRICTER of
  // the two, so no capability check is actually bypassed) but worth the reviewer knowing about.
  //
  // Also worth noting, not changing the classification: `docs/01-architecture/rbac.md` (line
  // ~283) and `assignment.md` describe a DIFFERENT, TARGET design where self-assignment by a
  // `member` is meant to need only `work_item:update` via an `orSelfTarget` predicate, not
  // `work_item:assign` — but that carve-out belongs to the not-yet-built `/api/work-items/
  // {key}/assign` routes. `requireTaskAssigneePermission` on THIS inherited route has no such
  // carve-out: it requires `work_item:assign` for ANY reassignment, including a member assigning
  // the task to themselves. Declaring `orSelfTarget` here would be dishonest — the runtime
  // would still 403 a self-assigning `member` who lacks `work_item:assign` — so this file declares
  // the stricter, actually-enforced shape. This is a known product gap for a future change to
  // align with `assignment.md`'s intent, not a security hole (the current behaviour is
  // over-restrictive, not under-restrictive).
  "PUT /api/task/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  "PUT /api/v2/task/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Move a task to another column in the same project (`controllers/update-task-status.ts`).
  // Runtime gate is `requireWorkspacePermission({ work_item: ["update"] })`.
  "PUT /api/task/status/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Set a task's priority (`controllers/update-task-priority.ts`). Runtime gate is
  // `requireWorkspacePermission({ work_item: ["update"] })`.
  "PUT /api/task/priority/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Assign a task to a workspace member, or unassign (null) it
  // (`controllers/update-task-assignee.ts`). This is the ONE task route whose sole runtime
  // gate is `requireWorkspacePermission({ work_item: ["assign"] })` — `work_item:assign` is exact.
  "PUT /api/task/assignee/{id}": {
    capability: "work_item:assign",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Set or clear a task's due date (`controllers/update-task-due-date.ts`). Runtime gate is
  // `requireWorkspacePermission({ work_item: ["update"] })`.
  "PUT /api/task/due-date/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Rename a task (`controllers/update-task-title.ts`). Runtime gate is
  // `requireWorkspacePermission({ work_item: ["update"] })`.
  "PUT /api/task/title/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Mint a presigned URL for uploading an image used in a task description or comment
  // (`index.ts`'s `createTaskImageUploadRoute` handler — no separate controller file).
  // Runtime gate is `requireWorkspacePermission({ work_item: ["update"] })`, same as the finalize
  // route below.
  "PUT /api/task/image-upload/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Record an uploaded image as a private asset (`index.ts`'s `finalizeTaskImageUploadRoute`
  // handler). Runtime gate is `requireWorkspacePermission({ work_item: ["update"] })`.
  "POST /api/task/image-upload/{id}/finalize": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Replace a task's description (`controllers/update-task-description.ts`). Runtime gate is
  // `requireWorkspacePermission({ work_item: ["update"] })`.
  "PUT /api/task/description/{id}": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
