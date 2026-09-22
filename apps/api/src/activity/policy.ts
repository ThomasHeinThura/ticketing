import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Activity route policies (issue #8, `activity` lane).
 *
 * `activity` and `comment` (`apps/api/src/comment/policy.ts`) are two routers over the same
 * `activityTable` — a comment is an activity row with `type: "comment"` — and three of these
 * five routes are literal duplicates of `comment`'s routes, sharing the same controller
 * functions. Read that file's header first; this one only restates what differs. Mounted at
 * `apps/api/src/index.ts:785`, below the app-wide auth guard (line 755) — H2 does not
 * constrain any route here.
 *
 * **`GET /api/activity/{taskId}` is the activity-feed twin of `GET /api/comment/{taskId}`** —
 * same `workspaceAccess.fromTaskId()`-only gate, same target capability (`work_item:read`,
 * scope `work_item`, `scopeSource: "row"`): the feed includes comments alongside system
 * events (status/assignee/priority/due-date changes, all written by the `subscribeToEvent`
 * handlers at the bottom of `apps/api/src/activity/index.ts`), but visibility is identical —
 * whatever can see the task's comments can see its full activity feed.
 *
 * **`POST /api/activity/create` records a system-generated event**, not a comment — importers
 * and integrations, per its own description. Same `workspaceAccess.fromTaskId()` +
 * `requireWorkspacePermission({ task: ["update"] })` gate as everything below, but there is no
 * `comment:*` capability that fits an arbitrary system event; `work_item:update` is the target
 * (rbac.md: "Edit title, description, dates, labels, custom fields; archive" — recording an
 * event about a work item's history is the same authority tier as editing it, and matches what
 * is actually checked, `task:update`, more closely than any `comment:*` string would).
 * `taskId` here is a **request body** field (`createActivityBody`, no path param on `/create`
 * at all) — `workspaceAccess.fromTaskId()`'s `lookup` source still does a genuine
 * `taskTable`/`projectTable` join to resolve and verify `workspaceId` before the handler runs
 * (same as the path-param case), so this is still `scopeSource: "row"`, not `"request"` — the
 * distinction workspace/policy.ts draws is whether the addressed row is genuinely loaded and
 * re-verified, not whether its id arrived via a path segment or a body field.
 *
 * **`POST /api/activity/comment` is `comment`'s create route under a different path**
 * (`createCommentRoute`'s own description: "Equivalent to `POST /comment/{taskId}`, kept for
 * the activity-feed client") — same gate (`fromTaskId` + `task:update`), same target capability
 * (`comment:create_internal`), same `scopeSource: "row"` reasoning as `POST /api/activity/create`
 * immediately above (`taskId` arrives in the body, but `fromTaskId` still re-verifies it via a
 * genuine join).
 *
 * **`PUT`/`DELETE /api/activity/comment` are `comment`'s update/delete routes under a different
 * path — but with a genuinely WEAKER gate than their `/api/comment/{id}` twins, found while
 * reading the actual middleware, not assumed from the shared controller.** Compare
 * `updateTaskCommentRoute`/`deleteTaskCommentRoute` in `apps/api/src/comment/index.ts`
 * (middleware: `[workspaceAccess.fromComment(), requireWorkspacePermission({ task: ["update"] })]`)
 * against `updateCommentRoute`/`deleteCommentRoute` here (middleware:
 * `[workspaceAccess.fromActivity("activityId")]` — **no `requireWorkspacePermission` at all**).
 * Both pairs call the identical `apps/api/src/activity/controllers/update-comment.ts` /
 * `delete-comment.ts`, whose `WHERE activityTable.userId = caller` still restricts either path
 * to the comment's own author — so no route here lets a caller touch someone else's comment —
 * but on THIS path, any workspace member can edit or delete **their own** comment without
 * holding `task:update`, where the `/api/comment/{id}` path additionally demands it. This is a
 * real, inherited asymmetry between two routes that do the same thing, not a construct of this
 * policy pass — **flagged here, not silently reconciled**: fixing it (adding the missing
 * middleware, or documenting the looser gate as the deliberately-correct one) is a product/
 * security decision outside a pure classification pass, and changing route middleware is not
 * this lane's job. The target capability declared below, `comment:update_own`/
 * `comment:delete_own`, is the SAME string declared in `comment/policy.ts` for the equivalent
 * routes — this file does not try to invent a weaker capability to match today's looser gate,
 * because rbac.md has no such weaker capability and inventing one here would be exactly the
 * kind of unreviewed vocabulary change `AGENTS.md` do-not 11 exists to prevent. The gap between
 * "declared capability" and "what's actually checked" is therefore wider on these two routes
 * than anywhere else in this file, and is called out again below on each entry so the Opus
 * security review does not miss it.
 *
 * Same `elevated`/`sessionOnly` reasoning as `comment/policy.ts`: nothing here is in
 * `AUTHORITY_GRANTING`, and these are kaneo-native routes with no inherited session-only
 * restriction to preserve.
 */
export const activityPolicies = {
  // Full activity feed for a task (comments + system events). Same visibility as
  // `GET /api/comment/{taskId}` — see file comment.
  "GET /api/activity/{taskId}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // Records a system-generated event (importers/integrations). See file comment for why
  // `work_item:update` is the target capability here rather than a `comment:*` string.
  "POST /api/activity/create": {
    capability: "work_item:update",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // `comment`'s create route under the activity-feed path. Same target capability and gate as
  // `POST /api/comment/{taskId}` (`comment/policy.ts`).
  "POST /api/activity/comment": {
    capability: "comment:create_internal",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // `comment`'s update route under the activity-feed path — WEAKER runtime gate than
  // `PUT /api/comment/{id}` (no `task:update` check; author-only ownership is still enforced
  // structurally by the shared controller). See file comment — flagged, not silently widened
  // or narrowed by this declaration.
  "PUT /api/activity/comment": {
    capability: "comment:update_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },

  // `comment`'s delete route under the activity-feed path. Same gap as the PUT route
  // immediately above.
  "DELETE /api/activity/comment": {
    capability: "comment:delete_own",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
