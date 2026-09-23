import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Comment route policies (issue #8, `comment` lane).
 *
 * All four routes attach to a task (kaneo's row for the target `work_item` concept — there is
 * no separate `work_item` table today, `taskTable` is it) and are mounted below the app-wide
 * auth guard (`ALL /api/*`, `apps/api/src/index.ts:755`; `comment` mounts at line 786, well
 * below), so H2 (`isWithinAuthGuardScope`) does not constrain any of these.
 *
 * **Containment chain, read from the actual middleware, not assumed from the path.**
 * `apps/api/src/utils/workspace-access-middleware.ts`'s `fromTaskId`/`fromComment` sources run
 * a genuine DB lookup — `taskActivityTable`/`taskTable` joined to `projectTable` — to resolve the
 * task's (or comment's) own `workspaceId` before the handler runs. That lookup is a **row
 * read**, the same reasoning `workspace/policy.ts` uses for `PATCH /api/workspace/{id}`, so
 * `scopeSource: "row"` throughout this file, not `"request"` — the workspace containment is
 * verified against the database, never trusted from the path alone.
 *
 * **Two of the four sources (`fromTaskId`, `fromComment`) fall back to a client-supplied
 * `?workspaceId=` query parameter when the row lookup returns null** (task/comment not found)
 * — see `workspaceAccessMiddleware`'s `sources` array order in that file. This is pre-existing,
 * inherited behaviour, identical across every other `workspaceAccess.from*` consumer in this
 * codebase (label, timeEntry, column, workflowRule), not something introduced or fixable by a
 * policy declaration — recorded here for the security review rather than silently relied upon.
 * It cannot widen a comment/task an attacker does not already have a valid id for into "found";
 * it can only let a caller who supplies a *nonexistent* id additionally claim any workspace
 * they are themselves a member of, which is what the row-lookup-failure path already reduces
 * to (a 400/404 either way once the handler re-validates the id) — worth a second look, not
 * blocking this classification.
 *
 * **Target capability vocabulary is `comment:*` (`docs/01-architecture/rbac.md` § Comments,
 * scope `work_item`); the RUNTIME check is `requireWorkspacePermission({ task: ["update"] })`
 * against the INHERITED `task` resource** (`apps/api/src/utils/require-workspace-permission.ts`)
 * — the same transitional capability-vocabulary gap `workspace/policy.ts` already documents for
 * `workspace:update`/`organization:update`: re-keying the seeded `workspace_role` rows and the
 * runtime evaluator to the canonical `Capability` union is #7's capability migration, not this
 * lane's. Declaring the target string here does not change what gates the request today; it is
 * what the coverage/matrix tooling checks against, and it is what will start being enforced,
 * unchanged, the day #7's re-keying lands and the runtime-integration section of #8 wires
 * `policyRegistry` into the live request path.
 *
 * **Ownership on update/delete is enforced structurally, not by a declared `orOwner` branch.**
 * `update-comment.ts`/`delete-comment.ts` (`apps/api/src/activity/controllers/*`, re-exported
 * by this router's own controllers) restrict their `WHERE` clause to
 * `taskActivityTable.userId = <caller>` unconditionally — there is no role, including `manager`
 * (who holds `comment:update_any`/`comment:delete_any` in rbac.md's target table), that can
 * reach another user's comment through this route. That is narrower than an `orOwner` fallback
 * (which models "capability X, OR capability Y plus this predicate") — here ownership is an
 * unconditional AND on top of the `task:update` gate, not a fallback path. Declaring the
 * broader `comment:update_any`/`comment:delete_any` as the primary capability here, with an
 * `orOwner` predicate, would therefore overclaim: it would say a `manager` can edit anyone's
 * comment through this route, which is false today and would stay false even once runtime
 * integration wires this file in (the controller's own `WHERE` clause does not change). The
 * narrower, honest target capability is declared instead: `comment:update_own`/
 * `comment:delete_own`, which matches what is actually reachable. Whether the update-any
 * variant should exist as a *different*, not-yet-built route is a product question, not decided
 * here.
 *
 * Comment reads (`GET /api/comment/{taskId}`) require no capability at all beyond workspace
 * membership — `getTaskCommentsRoute`'s only middleware is `workspaceAccess.fromTaskId()`, no
 * `requireWorkspacePermission`. `work_item:read` is the target capability (every built-in role
 * from `viewer` up holds it; `rbac.md`'s Comments group has no dedicated read capability of its
 * own — seeing a work item's comments is implied by being able to see the work item, matching
 * `comment:create`'s own `implies: ["work_item:read"]`).
 *
 * No route here is in `AUTHORITY_GRANTING` (`packages/permissions/src/elevated.ts`) — comments
 * mint no fresh authority — so `elevated` is omitted throughout, and no route declares
 * `sessionOnly`: unlike the former better-auth `organization()` plugin surface (`workspace`,
 * `invitation`, `capabilities`), these are kaneo-native routes that never had a
 * session-vs-API-key distinction to preserve (retrofit plan risk R10: every route below the
 * app-wide guard is reachable by API key by default, and that default is correct here, not a
 * gap — declaring `sessionOnly` with nothing enforcing it would be the "declared-and-inert"
 * shape `policy.ts`'s own `ElevationFlags` doc warns against).
 */
export const commentPolicies = {
  // Reads every comment on a task, oldest first. `workspaceAccess.fromTaskId()` is the only
  // gate — any workspace member may read; no `task:*` or `comment:*` permission is additionally
  // required. `work_item:read` is the closest target capability: rbac.md has no standalone
  // "read comments" capability, and `comment:create` itself `implies: ["work_item:read"]`,
  // i.e. seeing a work item's comments is treated as part of seeing the work item.
  "GET /api/comment/{taskId}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Adds a comment to a task. Runtime gate is `requireWorkspacePermission({ task: ["update"] })`
  // — see the file comment for why the target capability declared here, `comment:create_internal`
  // (a staff-side comment, this route is not under `/api/portal/*`), does not match what
  // actually runs today.
  "POST /api/comment/{taskId}": {
    capability: "comment:create_internal",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Edits a comment. Only the author may succeed (structural `WHERE userId = caller`, see file
  // comment), on top of the same `task:update` middleware gate as create. `comment:update_own`
  // is the target capability, not `comment:update_any` — see file comment for why the "any"
  // variant would overclaim relative to what this route can actually do.
  "PUT /api/comment/{id}": {
    capability: "comment:update_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Deletes a comment. Same author-only structural restriction and `task:update` gate as
  // update, immediately above.
  "DELETE /api/comment/{id}": {
    capability: "comment:delete_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
