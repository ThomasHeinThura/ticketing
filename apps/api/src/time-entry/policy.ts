import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Time-entry route policies (issue #8 classification pass).
 *
 * All four routes are mounted below the app-wide auth guard (`apps/api/src/index.ts`,
 * `const timeEntryApi = api.route("/time-entry", timeEntry);` at line 787, well after the
 * `api.use("*", ...)` guard at line 755) — so, unlike this lane's six inline routes, none of
 * these are subject to H2's above-guard refusal and all four are honestly `capability`.
 *
 * **Capability names are rbac.md's own worked example, not this lane's invention.**
 * `docs/01-architecture/rbac.md` §"Route policies" gives `DELETE /api/time-entries/{id}` as
 * its illustrative `PolicyMap` entry: `{ capability: 'time_entry:delete_any', scope:
 * 'workspace', orOwner: { predicate: 'row.person_id === identity.personId', capability:
 * 'time_entry:delete_own' } }`. `scope: 'workspace'` below matches that example exactly. The
 * `orOwner` **own/any split does not**, for two independent reasons, both checked against the
 * actual runtime rather than assumed from the doc:
 *
 * 1. **The closed `OwnerPredicate` set has no member for this row.** `time_entry` rows key
 *    ownership on `time_entry.user_id` (`apps/api/src/database/schema.ts`), and
 *    `packages/permissions/src/policy.ts`'s `OWNER_PREDICATES` admits exactly three strings —
 *    `row.person_id`, `row.created_by`, `row.requester_id` — none of which is `row.user_id`.
 *    Declaring `orOwner` here would mean either lying about which column is checked or adding
 *    a fourth predicate unilaterally; `policy.ts` is explicit that a new predicate is a
 *    decision-log change, not an edit at the keyboard. Not done in this lane.
 * 2. **The runtime enforces no own/any split at all today.** `createTimeEntryRoute` and
 *    `updateTimeEntryRoute` (`./index.ts`) both gate on
 *    `requireWorkspacePermission({ task: ["update"] })` — the single INHERITED kaneo `task`
 *    resource permission (`packages/permissions/src/legacy-better-auth-access-control.ts`),
 *    which every seeded `member` row holds (`task: ["create", "read", "update"]`, no
 *    ownership scoping). A workspace member with that permission can update or (via the two
 *    GET routes) read **any** time entry in the workspace, not only entries they logged
 *    themselves. So `_any`, not `orOwner`-qualified `_own`, is the honest capability for the
 *    mutation route, and is recorded as-is rather than papered over with a predicate the
 *    runtime does not check.
 *
 * **This is a real, documented gap against the target model**, parallel to every transitional
 * gap `apps/api/src/workspace/policy.ts` already records: rbac.md's `MEMBER_CAPABILITIES`
 * (`packages/permissions/src/roles.ts`) gives `member` only `time_entry:create`,
 * `time_entry:update_own` and `time_entry:delete_own` — no `_any` variant — so the intended
 * target is that an ordinary member can only touch their own logged time. The actual runtime
 * permission (`task:update`, no ownership check) is wider than that target for every route
 * below. Re-keying `requireWorkspacePermission`'s call sites to the canonical `time_entry:*`
 * vocabulary AND adding the ownership check the target model assumes are both #7-shaped work,
 * not this lane's; flagged here, and in the PR description, for that follow-up.
 *
 * **The two GET routes carry no `requireWorkspacePermission` call whatsoever** — only
 * `workspaceAccess.fromTaskId()` / `.fromTimeEntry()`, i.e. workspace membership alone.
 * `time_entry:read_any` (rbac.md: "See anyone's entries") is the only read capability in the
 * vocabulary — there is no `time_entry:read_own` to prefer instead — so it is the nearest
 * honest name, and is declared with the same gap noted: `MEMBER_CAPABILITIES` does not grant
 * `time_entry:read_any` (only `lead` and above do), so today's runtime is wider than the
 * target for these two routes as well.
 *
 * **`scopeSource: "row"` on all four.** `workspaceAccess.fromTaskId()` / `.fromTimeEntry()`
 * (`apps/api/src/utils/workspace-access-middleware.ts`) resolve the workspace id by looking up
 * the addressed `time_entry`/`task` row and joining through to its owning `project`, in the
 * same query, before comparing against the caller's memberships — never by trusting a
 * request-supplied id as the primary path. (Both middlewares used to fall back to an optional
 * `?workspaceId=` query parameter when the row lookup itself found nothing — i.e. only for an
 * id that did not exist. That was shared, pre-existing `workspace-access-middleware.ts`
 * behaviour, not specific to this router, and never widened real data exposure here: every one
 * of these controllers re-queries strictly by the same addressed id afterwards, so a
 * fabricated `workspaceId` on a nonexistent id could only yield an empty result, never another
 * tenant's row. Issue #256 has since removed that fallback from all 8 `[lookup, query]`-shaped
 * helpers, this pair included: a nonexistent id now 404s directly from the middleware, before
 * any authority decision runs, rather than falling through to a caller-supplied workspace.)
 *
 * **`reach: "required"` on all four**, `POST /api/time-entry` included: although the route
 * creates a new row, it addresses an *existing* task (`taskId` in the request body, resolved
 * to a real row by the same lookup), so — exactly like `POST
 * /api/workspace/{workspaceId}/members` in `apps/api/src/workspace/policy.ts` — the thing this
 * request references must still be reach-checked, even though the row it creates is new.
 *
 * **No `sessionOnly`.** Unlike the native S2/S4/S5 workspace routes, these are inherited kaneo
 * routes with no `require-session-only.ts` call anywhere on their middleware chains, and
 * `hasWorkspacePermission` explicitly reads `c.get("apiKey")` to honor an API key's own scoped
 * permissions — so API keys are genuinely accepted here today. Declaring `sessionOnly: true`
 * would be exactly the declared-and-inert metadata `packages/permissions/src/policy.ts`'s own
 * doc comment calls out as "a documented control that does not exist" — not declared.
 *
 * **No `elevated` field.** None of `time_entry:read_any`, `time_entry:create` or
 * `time_entry:update_any` is in `AUTHORITY_GRANTING` (`packages/permissions/src/elevated.ts`),
 * so the elevation coverage test demands no declaration either way on any of these four.
 */
export const timeEntryPolicies = {
  // List every time entry logged against one task. Membership-gated only (no capability
  // check in the runtime today) — see file comment for the `time_entry:read_any` gap.
  "GET /api/time-entry/task/{taskId}": {
    capability: "time_entry:read_any",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Read a single time entry by id. Same membership-only gate as the route above.
  "GET /api/time-entry/{id}": {
    capability: "time_entry:read_any",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Log time against an existing task. Runtime check is
  // `requireWorkspacePermission({ task: ["update"] })` — see file comment for why
  // `time_entry:create` (not `task:update`) is the declared name, and for the create-still-
  // addresses-an-existing-resource reasoning behind `reach: "required"`.
  "POST /api/time-entry": {
    capability: "time_entry:create",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },

  // Replace a time entry's start/end/description. Same `requireWorkspacePermission({ task:
  // ["update"] })` runtime gate as create; see file comment for why this is declared
  // `time_entry:update_any` rather than an `orOwner`-qualified `_own` — the runtime checks no
  // ownership predicate at all, so `_any` is the honest name, not `_own`.
  "PUT /api/time-entry/{id}": {
    capability: "time_entry:update_any",
    scope: "workspace",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
