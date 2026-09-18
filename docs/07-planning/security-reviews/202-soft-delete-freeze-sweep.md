# Security review — PR #204 (issue #202: freeze a soft-deleted project on every remaining route)

**Reviewed head:** `55c398f12f8bcde5556053cc5e3f4fcec1cbdf0f`

## What this PR does

PR #200 established that a soft-deleted `project` (`deleted_at` set) is treated as gone
everywhere in ordinary use, but only applied that rule to the six routes its own review
happened to reach. Two more rounds of review on that PR found the same gap repeatedly in
new places (image uploads, workflow rules) rather than the sweep it claimed to be. Issue
#202 asked for one bounded, comprehensive pass instead: every route whose *subject* is a
project — the project itself, its columns, its tasks — applies the same `deletedAt` check,
routed through the shared `getProjectWorkspaceId` helper (`apps/api/src/utils/
assert-assignable-user.ts`) where possible rather than each route reinventing its own
lookup.

Four commits: `0a4b2d3` the sweep; `98b4a90` an image-upload pair a review found; `c7d8e31`
a workflow-rule trio a second review found, plus four new `404:` OpenAPI declarations;
`55c398f` comment-only corrections from that second review.

Implemented by a non-standard model, disclosed plainly in the PR body rather than mapped
onto this project's usual Sonnet/Opus tiers.

## Prior review rounds (both ordinary tier, before this pass)

- **Round 1** (at `98b4a90`): BLOCKING. `GET`/`PUT /workflow-rule/{projectId}` still read
  *and wrote* a soft-deleted project's automation; the upsert could leave a second
  `workflow_rule` row for an already-soft-deleted project. Remediated in `c7d8e31`.
- **Round 2** (delta `98b4a90..c7d8e31`): CLEAR WITH FINDINGS, all resolved. Proved the fix
  is load-bearing by neutralizing `getProjectWorkspaceId` and confirming every new test
  fails without the guard. Found three non-blocking issues: three of the PR's own comments
  overstated what the new 404 means (corrected in `55c398f`, comment-only); a third leaking
  route, `GET /external-link/task/{taskId}`, missed by the sweep (filed to #205); a wrong
  causal claim on issue #206 (corrected there).

## Mandatory Opus review (this pass)

**Verdict: CLEAR WITH FINDINGS — nothing blocks merge.**

Independently re-derived, not taken on trust:

- **Sweep comprehensiveness**: enumerated all 33 routes under `project/`, `column/`,
  `task/`, `workflow-rule/` and every file referencing `projectTable`. Every route whose
  subject is a project, its columns, or its tasks is guarded — no missed route found in
  this class. The `external-link` categorization (belongs in #205, not here) is correct —
  probed directly, along with five structurally identical one-hop routes (comment,
  activity, label, time-entry, task-relation), all still return 200 against a soft-deleted
  project's task, confirming they're genuinely a different class than this PR's scope.
- **`getProjectWorkspaceId` centralization**: correct at every call site. The
  confused-deputy case (a live `projectId` supplied for a task actually in a deleted
  project) was probed directly: 400, task unchanged.
- **The remediated workflow-rule bug**: live-verified, and the shipped test only covered
  the upsert's UPDATE branch. The reviewer probed the INSERT branch (a different
  `eventType`) directly: 404, `workflow_rule` still holds exactly one row. The fix genuinely
  prevents the second row rather than relocating the check.
- **Authorization/tenancy unchanged**: mechanically confirmed (zero diff lines match
  middleware/permission/policy/auth) and empirically confirmed — a viewer and a non-member
  both get 403 for a live *and* a soft-deleted project on every route checked; the new 404
  is unreachable without authorization already passing.
- **The deliberate choice not to route the check through `workspace-access-middleware.ts`**:
  verified as correct, not just argued. 8 of 12 `workspaceAccess.*` helpers carry a second,
  caller-controlled `?workspaceId=` fallback that only gets skipped on a truthy id from the
  primary lookup — a null return from a centralized check would fall through to exactly the
  fallback issue #6 already closed. No inconsistent ordering found: every guard sits after
  both `workspaceAccess.*` and `requireWorkspacePermission`.
- **`--no-verify` commit**: verified it smuggled nothing — per-commit file lists total
  exactly the 29 files in the combined diff; the untracked concurrent-lane file appears in
  none of them.
- **`55c398f` comment-only claim**: verified programmatically — every changed line in
  `apps/api/src` between `c7d8e31` and `55c398f` is a comment or blank.
- **Gates at head** (isolated worktree, pinned to `55c398f`, after a concurrent lane moved
  the shared checkout mid-review): typecheck clean, biome 0 errors, `check:openapi` clean
  (exactly 4 new 404s declared, 0 removed), permissions 10/79, full integration 57 files /
  508 tests — matching the PR's own claims exactly.

**Findings, all non-blocking:**
- **F1**: the PR body's "the route-level ones are two-sided" overstates it — only ~8 of 27
  tests carry an explicit live-project control. The stronger property was verified directly
  instead: reverting `apps/api/src` to `main` while keeping the new tests makes all 27 fail
  with `expected 200 to be 404`, ruling out a false-positive no-route 404. Every assertion
  is load-bearing; the sentence should be corrected.
- **F2**: two untested branches (the upsert's INSERT path, bulk delete) were probed
  directly and found correct — 404/one row; a frozen task survives a bulk delete while a
  live task in the same batch still deletes. Suggested as a test-coverage follow-up, not
  required for merge.
- **F3**: two more instances of the #205 class, found via push/read channels rather than
  routes: `due-date-reminders.ts` still fires reminders/emails for a task inside a
  soft-deleted project, surfacing its title for up to 30 days; `get-notifications.ts` leaves
  existing notifications with a working deep link into a frozen project. Added to #205 —
  #205's actual product question (should an audit trail disappear when its project is
  soft-deleted?) was not attempted.
- **F4**: informational only. The guard is a TOCTOU read-then-write at READ COMMITTED,
  inherent to the pattern PR #200 already established and not an authorization boundary
  (authorization is decided earlier, separately, and unaffected). `move-task`'s
  cross-workspace probe narrows an existing oracle rather than widening one. One PR-body
  sentence about a hypothetical 403-vs-404 case is slightly imprecise (would actually be
  400) but substantively right.

**Operational note**: mid-review, the shared checkout was moved to `main` by a concurrent
lane (which turned out to be issue #198 being picked up independently, committed cleanly as
`3f401c2` on its own branch). The reviewer caught this and re-derived every finding in an
isolated worktree pinned to this PR's exact head rather than trusting a tree that had moved
out from under it.
