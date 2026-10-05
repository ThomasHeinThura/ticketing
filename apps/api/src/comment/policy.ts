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
 * **`fromTaskId` and `fromComment` used to fall back to a client-supplied `?workspaceId=`
 * query parameter when the row lookup returned null** (task/comment not found) — see
 * `workspaceAccessMiddleware`'s `sources` array order in that file. That was pre-existing,
 * inherited behaviour, identical across every other `workspaceAccess.from*` consumer in this
 * codebase (label, timeEntry, column, workflowRule). Issue #256 removed the fallback from all
 * 8 `[lookup, query]`-shaped helpers, this pair included: a nonexistent task/comment id now
 * 404s directly from the middleware, before any authority decision is reached, never falling
 * through to a caller-supplied workspace. It was never exploitable here (every controller in
 * this router does its own authoritative lookup afterward), but it is closed at the source now.
 *
 * **Target capability vocabulary is `comment:*` (`docs/01-architecture/rbac.md` § Comments,
 * scope `work_item`); the RUNTIME check is `requireWorkspacePermission({ work_item: ["update"] })`
 * against the INHERITED `work_item` resource** (`apps/api/src/utils/require-workspace-permission.ts`,
 * re-keyed from the inherited `task` name — 2026-09-23 decision log entry, "shadow until clean,
 * then strict; rename `task:*` first") — the same transitional capability-vocabulary gap
 * `workspace/policy.ts` already documents for `workspace:update`/`organization:update`:
 * `comment:*` is declared, not enforced, until #8's runtime-integration obligation wires
 * `policyRegistry` into the live request path. Declaring the target string here does not
 * change what gates the request today; it is what the coverage/matrix tooling checks against,
 * and it is what will start being enforced, unchanged, once that wiring lands.
 *
 * **Ownership on update/delete is enforced structurally, not by a declared `orOwner` branch.**
 * `update-comment.ts`/`delete-comment.ts` (`apps/api/src/activity/controllers/*`, re-exported
 * by this router's own controllers) restrict their `WHERE` clause to
 * `taskActivityTable.userId = <caller>` unconditionally — there is no role, including `manager`
 * (who holds `comment:update_any`/`comment:delete_any` in rbac.md's target table), that can
 * reach another user's comment through this route. That is narrower than an `orOwner` fallback
 * (which models "capability X, OR capability Y plus this predicate") — here ownership is an
 * unconditional AND on top of the `work_item:update` gate, not a fallback path. Declaring the
 * broader `comment:update_any`/`comment:delete_any` as the primary capability here, with an
 * `orOwner` predicate, would therefore overclaim: it would say a `manager` can edit anyone's
 * comment through this route, which is false today and would stay false even once runtime
 * integration wires this file in (the controller's own `WHERE` clause does not change). The
 * narrower, honest target capability is declared instead: `comment:update_own`/
 * `comment:delete_own`, which matches what is actually reachable. Whether the update-any
 * variant should exist as a *different*, not-yet-built route is a product question, not decided
 * here.
 *
 * Comment reads require the declared `work_item:read` capability after task-row reach is
 * resolved. The capability represents the Comments group's implied work-item visibility.
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
  // Reads every comment on a task, oldest first. Requires `work_item:read` after row-derived
  // reach; there is no separate comment-read capability.
  "GET /api/comment/{taskId}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Adds a comment to a task. Runtime gate is `requireWorkspacePermission({ work_item: ["update"] })`
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
  // comment), on top of the same `work_item:update` middleware gate as create. `comment:update_own`
  // is the target capability, not `comment:update_any` — see file comment for why the "any"
  // variant would overclaim relative to what this route can actually do.
  "PUT /api/comment/{id}": {
    capability: "comment:update_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Deletes a comment. Same author-only structural restriction and `work_item:update` gate as
  // update, immediately above.
  "DELETE /api/comment/{id}": {
    capability: "comment:delete_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
