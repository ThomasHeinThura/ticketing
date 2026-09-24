# Security review — shadow coverage for Slice 2b (issue #324)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `78dba72ab5133a52807d23a6e73abe45099d9514`
**Pull request:** #354 (`fix/324-shadow-coverage`), issue #8 Slice 2b / #324
**Builds on:** #323 (`323-policy-shadow-mode.md`), #334 (`334-sees-all-scope.md`), #338
**Date:** 2026-09-24

## Verdict

**CLEAR WITH FINDINGS.** Shadow mode still cannot change a live decision, status code or
response latency. The new route coverage passes correct row-derived identity. 158ca30's reach
handling matches `reaches()` for all four reach kinds. One low finding (S1) is a regression in
evidence hygiene. It does not block merge, but it should be fixed before shadow mode is
switched on in a shared deployment. I1–I4 are informational.

## Head and merge integrity

- `gh pr view 354 --json headRefOid` = `78dba72ab5133a52807d23a6e73abe45099d9514`, and that is
  the commit reviewed. Merge base with `origin/main` is `c4e18107` (#338).
- The PR diff against its merge base covers 21 files, +1178/−132. There are no migrations, no
  journal changes and no dependency changes.
- `78dba72` merges `c4e1810` (#338). `git show --remerge-diff` shows one real conflict, in
  `workspace-access-middleware.ts`. The resolution keeps #338's single-query SQL reach lookups
  (`lookupWorkspaceId(resource, id, userId, apiKeyId)`) and the `lookupMany` reach filter.
  The lane's older per-row `validateWorkspaceAccess` block was dropped. The lane's only
  additions are the widened `select` columns and the `{workspaceId, projectId, workItemId}`
  return shape. The reach predicates are byte-identical to main.
- `a7f402f` (an earlier main merge) only removes content that main had already superseded.
- `origin/main` has since moved one docs-only commit (`1731fe4`, `status.md`).
  `git merge-tree` shows it merges cleanly.

## Check 1 — shadow never affects the live request

- `runNextWithPolicyShadow` awaits `next()`, reads the marker and status, then queues
  `runShadowEvaluation` fire-and-forget inside the #323 S5 bounded queue (8 in flight,
  128 pending, the rest dropped and counted). The new workspace-row lookup in
  `shadow-middleware.ts` runs inside that queued task, after the response. It is inside the
  existing `try` that writes an `evaluator_error` record, and the outer `.catch` still wraps
  the task.
- Every new `try/catch` in the gates (`workspaceAccessMiddleware`,
  `requireWorkspaceCapability`, `requireWorkspaceRoleAuthority`, `requireWorkItemReach`,
  bulk task update, leave/transfer workspace) re-throws the same error object. The only added
  side effect is `c.set("legacyAuthorization", …)`. Status codes and messages are unchanged.
- `workspaceAccessMiddleware` and `requireWorkItemReach` now call `c.set("workspaceId", …)`
  **before** validation. I checked every reader of `workspaceId`, `workspaceIdSource`,
  `projectId`, `workItemId`, `projectIdFromRequest` and `legacyAuthorization` in `apps/api/src`.
  Each one is a downstream middleware or handler, which never runs after a thrown denial.
  `app.onError` (`index.ts:284`) reads none of them. So there is no live-path change.
- `resolveIdentity` has no live caller. The `work-item/*` hits are comments only, so the new
  `person` rows affect shadow evidence alone.

## Check 2 — identity passed on the newly covered routes

- Lookup sources (`project`, `task`, `timeEntry`, `activity`, `comment`, `column`,
  `workflowRule`) take `projectId`/`workItemId` from the same reach-filtered row that
  supplied `workspaceId`. For `timeEntry`, `activity` and `comment`, the work item is the
  parent task, which is the correct scope. `projectIdFromRequest` is set before the lookup,
  but a failed lookup leaves `workspaceId` null, so the policy side answers
  `row_scope_unavailable`. It never pairs a caller-supplied project with an unrelated
  workspace. Every `workspaceAccess.from*` helper has exactly one source, so a failed lookup
  cannot fall through to a caller-supplied `workspaceId`.
- `task-relation`'s `scopeTo*` middlewares set `workspaceId` with no provenance. Their
  policies therefore resolve `scope_source_unavailable`, which is conservative.
- **Legacy outcome is now explicit, not taken from the status code.** A missing marker, or an
  `unknown` one, is recorded as `legacy_outcome_unknown`. `allowed` together with a 401/403,
  or `denied` together with a 2xx/3xx, is downgraded to unknown. A masked 404 from a lookup
  (#290/#338) leaves the marker `unknown`, so no false "denied" is recorded, and the probe
  cannot tell an unreachable row from a missing one (covered by the new unit tests).
- The only path I found that could record a misleading `agree` is covered in I3 below. It is
  not reachable on today's routes in a way that changes the comparison.

## Check 3 — records, growth, migration

- There is no new table or migration. The new reason code `delegated_to_handler` needs no
  schema change, because `reason_code` is free text and only `outcome` is `CHECK`-constrained
  (`0069`). Growth is still bounded by #323's mechanisms: one tally row per
  day/route/outcome/reason, at most 50 event rows per bucket per day, and a daily bounded
  prune. `route_key` comes from the matched route template, not the raw path.
- **S1 below:** on denied request-sourced routes, `workspace_id` in an event row is now the
  raw caller-supplied string.
- The `diagnostic` value on the new lookup's error path is a driver error message. It can
  echo the (id-shaped) bound parameter and nothing else.

## Check 4 — 158ca30 reach handling

Compared with `packages/permissions/src/evaluator.ts` `reaches()` and the #334 `Reach` union:

| Reach kind | Workspace scope | Project / work-item scope | Matches `reaches()` |
| --- | --- | --- | --- |
| `all` | `true` | `true` | yes (step 1). See I2 for private items |
| `organisation` | `false` | `reach_unavailable` | yes. The project's customer organisation is not loaded, so the shadow declines to guess |
| `membership` | workspace membership row | `reach_unavailable` | yes. Project, ancestor and team facts are not loaded |
| `membership_with_workspaces` | workspace membership row (a sees_all workspace always carries one) | `true` only when `workspaceIds` includes the **row-derived** workspace; otherwise `reach_unavailable` | yes. Not being in the list is correctly treated as no evidence, not as a denial |

`workspaceId` on these paths always comes from the same reach-filtered row as the project or
work item (see Check 2), so a caller cannot pair a sees_all workspace with a foreign project.
The real loader still always resolves `seesAll: false` (#315 known gap 3), so this branch has
no live effect today. It is unit-tested for both the match and the mismatch.

## Check 5 — tests run at the reviewed head

Workspace packages built first. Private database `opus354b_test`, dropped afterwards.

| Suite | Files | Tests |
| --- | --- | --- |
| `@taskdesk/permissions` (`vitest run`) | 13 passed | 261 passed |
| `apps/api test:permissions` | 10 passed | 80 passed |
| `apps/api test:unit` | 58 passed | 488 passed |
| Integration: `permissions-shadow-mode.test.ts` + `p1-identity-schema-seed.test.ts` | 2 passed | 31 passed |

I also ran an ad-hoc probe, not committed, to reproduce S1. Its output is quoted below.

## Check 6 — CI at `78dba72`

Every required status check is green except `pull request template + security review`. That
check fails only on the unticked "Opus security review completed and recorded" item, which
this note closes. CodeQL is green. `GitGuardian Security Checks` is red and is not required.
It is a **false positive**: the flagged `passwordKey: postgres_uri`
(`charts/taskdesk/values.yaml:228,245`, from #308 on main) is the *name* of a key inside a
Kubernetes Secret, not a credential. It sits next to an empty `password: ""`, and this PR
does not touch the chart.

## Findings

### S1 (low) — caller-supplied workspace id is persisted in shadow evidence on denied requests

`workspaceAccessMiddleware` now sets `c.set("workspaceId", raw)` for `query`, `body` and
`param` sources before `validateWorkspaceAccess`. On #323, `workspaceId` was only set after
validation passed, so a denied request recorded `workspace_id = NULL`. It now records
whatever string the caller sent.

**Failure scenario, reproduced:** any authenticated user sends
`GET /api/workspace/attacker-xxxx…` with a 6,009-character id. The response is a 403, which is
unchanged. The shadow lookup finds no workspace row, so the id stays request-sourced, and the
route's `scopeSource: "row"` policy then gives `unevaluated / scope_source_unavailable`. An
event row is written with `workspace_id` = the full 6,009-character attacker string. The
probe's output:
`[{"route":"GET /api/workspace/{workspaceId}","outcome":"unevaluated","reason":"scope_source_unavailable","wsLen":6009,…}]`.

**Impact:** limited. The caller writes only their own text, and the 50-row cap per bucket
still holds. But the evidence store now holds arbitrary, unbounded-length (up to the request
size) and possibly PII-bearing free text in a column that analysis treats as an id. That
breaks #323's premise that record fields are ids, and it lets one caller use roughly
50 × request-size of storage per bucket per day. A `body` source whose policy is left
unevaluated would be bounded only by the body size. `POST /api/project` and `POST /api/label`
record `agree` on denial, so they write no event row today.

**Fix (small):** in `runShadowEvaluation`, store `workspaceId` in the record only when
`workspaceIdSource === "row"`, or when legacy explicitly allowed the request. Alternatively,
drop any value that does not match the id format. Add a regression test using the probe above.
Leave the policy-side input unchanged.

### I1 — the sign-up hook is a live write (informational)

`auth.ts` now calls `ensureStaffPersonForUser` in the `user.create.after` hook for
`/sign-up/email`. This is a live change, not a shadow-only one. It adds one or two queries,
and if it throws, sign-up fails after the user row exists. It is idempotent
(`ON CONFLICT (user_id) DO NOTHING`), safe under concurrent sign-ups
(`ensureInternalOrganisation` handles the unique-violation race), and it gives exactly what
the boot backfill already gives every user. `person` is read only by `resolveIdentity`, which
has no live caller, so no live authority changes. Revisit it when a customer portal gains
local password sign-up, because this hook would label those customers `staff`.

### I2 — the reach shortcuts skip `visibleToPersonIds` (informational)

`reaches()` checks `project.visibleToPersonIds` (CP-16 private items) *before* the switch.
That check applies even to `all`. The shadow's `inReach = true` shortcuts for `all` and
`membership_with_workspaces` do not. Nothing in `apps/api` loads `visibleToPersonIds` today,
so the result is currently identical. Once CP-16 private visibility lands, these shortcuts
must defer to `reaches()`, or they will record a false `agree` for a private item.

### I3 — a handler-level masked 404 after a gate allow is recorded as a gate allow (informational)

`markerConflictsWithResponse` downgrades `allowed` + 401/403, but not `allowed` + 404. If a
handler performs its own masked-404 reach check after an earlier gate allowed, the request is
recorded as legacy-allowed, with status 404. For workspace-scoped policies that is the correct
gate-level comparison. A future route whose policy is narrower than its gate should mark
`denied` in the handler, as bulk update and leave-workspace now do.

### I4 — after #338, lookup routes produce no deny evidence (informational)

Because #338 folds reach into the lookup SQL, an out-of-reach row is indistinguishable from a
missing one, and the marker stays `unknown`. Denials on every `workspaceAccess.from<Resource>`
route are therefore `legacy_outcome_unknown`, never compared. This is honest, not misleading.
But cut-over evidence for those routes covers only the allow side.
