# Security review — instance-admin forged `workspace_id` in shadow evidence (issue #400)

**Reviewer:** Opus 5.5 (`claude-opus-5-5`), fresh independent context, 2026-09-28. Did not
author, direct, or remediate this change.
**Reviewed head:** `d55869d8b33899744000cdef1b0764f0f6ea2c98`
**Pull request:** not yet opened — branch `fix/400-shadow-admin-workspace-id`

## Verdict

**CLEAR WITH FINDINGS.** R1 from the #381 review (`354-shadow-coverage-slice-2b.md`,
"Follow-up fix review: S1") is closed. It is closed for both instance-admin bypasses, for
session and API-key callers alike. No live-path change. One low, fail-safe telemetry
regression (F1) and one informational note (F2). Neither blocks the merge.

## Head and provenance

- Branch head is `d55869d`, one commit on top of `origin/main` `732cea2` (#457). The merge
  base equals `origin/main`, so there is nothing to rebase.
- It touches 3 files, +80/−24: `shadow-context.ts`, `shadow-middleware.ts`, and
  `permissions-shadow-mode.test.ts`. Nothing else rides along.

## What the fix does

`workspaceIdForShadowEvidence(id, verified)` keeps the id only when `verified` is true. The
caller no longer passes `legacyAllowed`, so no legacy "allowed" result counts as proof any
more.

In `runShadowEvaluation`:

- `workspaceIdVerified` starts true only for `workspaceIdSource === "row"`.
- For every `"request"` id, the existing `SELECT id FROM workspace WHERE id = $1` now runs
  always. Before, it ran only for `scopeSource: "row"` policies. A hit sets
  `workspaceIdVerified = true`.
- The policy-side `workspaceIdSource` is still promoted to `"row"` only under #381's exact
  condition (`scope === "workspace"` and `scopeSource === "row"`). So the policy comparison
  is unchanged for every route. Mutation M1 below pins this.
- All three event-write sites (two `writeErrorRecord` calls and `recordShadowOutcome`) read
  the id through the same closure. If the lookup throws, the id stays unverified and is
  nulled, which is the safe direction.

The `"row"` label is trustworthy. Every setter of `workspaceIdSource: "row"` sets it together
with an id taken from a real row: `workspaceAccessMiddleware`'s `lookup`/`lookupMany`,
`requireWorkItemReach`, and `requireAttachmentReach`. Four middlewares set `workspaceId`
without touching the source: canned-response reach, comment reach, invitation access, and
task-relation. All four write real row values, so none of them can pass a forged string
under an inherited `"row"` label.

## Probe results (live, ad-hoc, not committed)

The probe ran at `d55869d` on a private database (`opus400_review_test`, dropped afterwards)
with `TASKDESK_POLICY_SHADOW=on`. The forged id was the same 6,009-character
`attacker-xxxx…` string R1 used.

**P1 — instance-admin session, forged id.** Every event recorded `workspace_id = NULL`.

| Route | Status | Outcome / reason | `legacy_allowed` | `workspace_id` |
| --- | --- | --- | --- | --- |
| `GET /api/workspace/{workspaceId}` | 404 | `unevaluated` / `scope_source_unavailable` | true | NULL |
| `GET /api/label/workspace/{workspaceId}` | 200 | `legacy_allow_policy_deny` / `forbidden` | true | NULL |
| `GET /api/project?workspaceId=` | 200 | `legacy_allow_policy_deny` / `forbidden` | true | NULL |
| `PUT /api/project/reorder?workspaceId=` | 400 | `legacy_allow_policy_deny` / `forbidden` | true | NULL |
| `POST /api/label` (body id) | 500 | `legacy_allow_policy_deny` / `forbidden` | true | NULL |
| `POST /api/project` (body id) | 500 | `legacy_allow_policy_deny` / `forbidden` | true | NULL |

At #381's head, R1 recorded all 6,009 characters on the first three routes.

**P2 — the second bypass.** The last three rows are `workspaceAccess.fromQuery/fromBody()`
followed by `requireWorkspacePermission(...)`. On these routes the final legacy marker is set
by `requireWorkspacePermission`. For an instance admin that marker is `allowed` only because
of `hasWorkspacePermission`'s `isInstanceAdmin` shortcut (`require-workspace-permission.ts:100`),
which never reads a workspace row. All three are nulled. The fix closes this path by design,
not by special case: legacy authorization is no longer an input to the evidence decision at
all.

**P3 — admin-owned API key (`Authorization: Bearer`), forged id.** Probed on
`GET /api/label/workspace/{id}`, `GET /api/project?workspaceId=` and
`PUT /api/project/reorder`. All three recorded `identity_kind = api_key`,
`legacy_allowed = true`, and `workspace_id = NULL`.

**P4 — controls (real ids stay attributed).** An instance admin who is not a member of a
real workspace called `GET /api/label/workspace/{real}` and `PUT /api/project/reorder`. Both
recorded `legacy_allow_policy_deny` with the real `workspace_id`. The non-member denied
controls (`GET /api/label/workspace/{real}`, `GET /api/workspace/{real}`, both 403) agreed
with the policy, so they correctly wrote no event row.

**P5 — mutations.** Each mutation was run against the full `permissions-shadow-mode.test.ts`
plus the probe, then reverted. The worktree was verified clean afterwards.

| Mutation | Caught by the committed suite? |
| --- | --- |
| M0 — restore `\|\| legacy.allowed` trust (#381 semantics) | **yes** — the new #400 test fails, and so do P1 and P3 |
| M1 — promote policy-side source to `"row"` on every hit | **yes** — 3 tests (#323 S1 agree cases, "preserves…") |
| M2 — set verified without checking that the row exists | **yes** — the #381 S1 test and the #400 test |
| M3 — lookup gated back to `scopeSource: "row"` policies only | **yes** — "preserves a request-sourced workspace id…" |

## Root cause and class

The root cause in #381 was the premise that "legacy allowed" means "the id was verified".
That holds only while every "allowed" path reads a row naming that exact id. Two paths in
the codebase do not: `validateWorkspaceAccess`'s admin early return and
`hasWorkspacePermission`'s `isInstanceAdmin` shortcut. A future bypass could be a third.

This fix removes the premise instead of adding special cases. Evidence now trusts only a
row-derived source or a direct existence lookup on the exact id. So it closes the whole
class: any legacy path that says "allowed" without checking the row, including ones not yet
written. It is not limited to the path the issue names. My judgement is that this is the
right altitude.

## Findings

### F1 (low, fail-safe telemetry regression) — unlabelled row-derived ids now always record `NULL`

Four middlewares set a real, row-derived `workspaceId` without a `workspaceIdSource`:
`requireCannedResponseReach`, `requireCommentReach`, `requireInvitationWorkspaceAccess`, and
`task-relation`'s `scopeTo*`. On `main`, such an id with `source = null` was kept whenever
legacy was `allowed`. Now `workspaceIdVerified` is false, and the lookup does not run,
because it is gated on `=== "request"`. So the id is always nulled.

In practice this drops attribution from non-`agree` events on:

- `PATCH` and `DELETE /api/canned-responses/{id}` (the capability gate sets `allowed`);
- `DELETE /api/invitation/{id}` (the membership and permission gates set `allowed`).

This widens I-b from the #381 review. It never records a forged value. It only loses a real
one, so it is not a security defect and does not block the merge.

**Suggested follow-up (either one):**

- Label those four middlewares `workspaceIdSource: "row"`, which I-b already suggested.
- Or run the evidence lookup for `workspaceIdSource !== "row"`, while still promoting the
  policy-side source only when it was `"request"`.

Add one allowed-disagreement test that pins the id on one of these routes.

### F2 (informational) — one extra indexed query per request-sourced id

The existence lookup now runs on every shadow evaluation with a request-sourced id. Before,
it ran only on `scopeSource: "row"` routes. It is a single primary-key `SELECT … LIMIT 1`,
inside the S5-bounded shadow queue (8 in flight, 128 pending, overflow counted as
`shadow_saturated`), and it runs after the response. It adds nothing when shadow is `off`,
and it has no effect on the live response. No action needed.

### Not re-raised

T1's untested `writeErrorRecord` sites (#381 review) are still untested. Their failure mode
is now safe by construction: the flag defaults to false and becomes true only after a real
row hit. Nothing more is required here.

## Tests at this head

Workspace packages were built first
(`pnpm --filter @taskdesk/permissions --filter @taskdesk/domain --filter @taskdesk/email build`).
The integration tests ran on the private database `opus400_review_test`, which was dropped
afterwards.

| Suite | Files | Tests |
| --- | --- | --- |
| `@taskdesk/permissions` | 13 | 262 passed |
| `apps/api test:unit` | 63 | 518 passed |
| `apps/api test:permissions` | 13 | 83 passed |
| `permissions-shadow-mode.test.ts` (integration) | 1 | 18 passed (17 + 1 new) |
| `apps/api test:integration` (full) | 115 | 1435 passed |
| `tsc --noEmit` (`tsconfig.json`, `tsconfig.permissions.json`, `tsconfig.tests.json`) | — | clean |

Live-tested: P1–P5 above, and every suite in this table. Read-only (not live-exercised): the
F1 routes. F1 follows directly from the code (`source = null` means no lookup and
`verified = false`), but no disagreement was constructed on those routes.

## Delta review: F1 (Opus 5.5)

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context, 2026-09-28. It
is not the context that wrote the review above, and it did not author, direct or fix this
change.
**Reviewed head:** `ec79ee0f676b4f914d87ba3ad606a490189fc8a9`
**Previous review:** `d55869d8b33899744000cdef1b0764f0f6ea2c98` (recorded at `8a8eae9`)
**Fix under review:** `ec79ee0`, "fix(permissions): label row-derived workspace ids on four
middlewares (#400 F1)"

**How the head was confirmed.** `git rev-parse HEAD` and `origin/fix/400-shadow-admin-workspace-id`
(after `git fetch`) both return `ec79ee0f…`. The merge base is still `origin/main` `732cea2`,
which has not moved.

### Verdict

**CLEAR.** F1 is closed. The new `"row"` labels are correct at all five call sites, and they
cannot be applied to an id the caller controls. Nothing new is opened. One informational note
(D1) below. It needs no action.

### What changed

The change touches 5 files, +97/−0: four middlewares and one test. Nothing else rides along.
Each middleware gains exactly one `c.set("workspaceIdSource", "row")`, directly after its
existing `c.set("workspaceId", …)`:

| Call site | Where the id comes from |
| --- | --- |
| `requireCannedResponseReach` | `canned_response.workspace_id`, read by `id` |
| `requireCommentReach` | `comment.workspace_id`, read by `id` (joined to `work_item` and a live `project`) |
| `requireInvitationWorkspaceAccess` | `invitation.workspace_id`, read by `id` |
| `task-relation` `scopeToSourceTask` | `project.workspace_id` from `workspaceIdOfTask(body.sourceTaskId)` (a join of `task` and `project`) |
| `task-relation` `scopeToRelation` | `task_relation` read by `id` to get `sourceTaskId`, then the same `workspaceIdOfTask` join |

### Can a caller get a `"row"` label on an id they control?

No. I checked each site line by line:

- **The labelled value is always a column from the row the query returned.** It is never the
  caller's input. The caller supplies only the key in the `WHERE` clause (a path `id`, or the
  body's `sourceTaskId`). Every query uses drizzle's parameterised `eq(...)`.
- **Every key is checked before the query runs.** All four path-id sites call `rejectNulByte`.
  `scopeToSourceTask` accepts `sourceTaskId` only if it is a string, then calls `rejectNulByte`.
  `scopeToRelation` calls `rejectNulByte` when the id is present. When it is absent, the query
  looks up `""`, finds nothing, and returns 404.
- **An empty lookup never falls through.** Every site throws 404 or 400 before its
  `c.set("workspaceId", …)` whenever the row, or the joined task or project, is missing. There
  is no path that sets an unchecked id and then labels it.
- **Access checks run before the label.** `validateWorkspaceAccess` runs on the row's id, and
  invitations also check `workspace_member`. Both run before the label is set. The label is
  never written on a request that fails them.
- **Nothing later overwrites the id and leaves a stale label.** The only middleware after these
  five is the permission, membership, capability and role-authority gates, and none of them
  writes `workspaceId`. Across `apps/api/src`, the only writers of `workspaceId` are the setters
  listed in the prior review plus these five, and no handler writes it.

A caller can choose *which* real row they address. On the admin-bypass paths
(`validateWorkspaceAccess`'s early return) that can be a row in a workspace they are not a
member of. The id recorded is then that row's real `workspace_id`. That is exactly what `"row"`
means here: the id names a real workspace, not that the caller belongs to it. This is the same
meaning `requireWorkItemReach` and `requireAttachmentReach` already carry. So it is not a
forgery.

### Live tests at `ec79ee0`

The tests ran on a private database, `opus400_delta_test`, which was dropped afterwards.
Workspace packages were built first. The worktree was verified clean after every revert.

1. **The new test on its own** passes (1 passed, 18 skipped).
2. **The mutation check.** I reverted only the four middleware files to `8a8eae9`, kept the
   test, and reran it alone. It **fails** with `expected false to be true` on the
   `workspaceId === owner.workspace.id` assertion. I then restored the files. This confirms the
   implementer's own report.
3. **An ad-hoc probe of all five call sites** (not committed). It used the **real** policy
   registry: an owner session, shadow `on`, one request to each route. I ran it with the labels
   and again with them reverted:

   | Route | Labels reverted (`8a8eae9`) | With labels (`ec79ee0`) |
   | --- | --- | --- |
   | `PATCH /api/canned-responses/{id}` | `unevaluated` / `scope_source_unavailable`, `workspace_id` NULL | `agree` (tally only, no event row) |
   | `DELETE /api/invitation/{id}` | `unevaluated` / `scope_source_unavailable`, `workspace_id` NULL | `agree` (tally only) |
   | `POST /api/task-relation` | `unevaluated` / `row_scope_unavailable`, NULL | same outcome, **real** `workspace_id` |
   | `DELETE /api/task-relation/{id}` | `unevaluated` / `row_scope_unavailable`, NULL | same outcome, **real** `workspace_id` |
   | `PATCH /api/comments/{id}` | `unevaluated` / `row_scope_unavailable`, NULL | same outcome, **real** `workspace_id` |

   Every response was 200 in both runs. The live path is unchanged.

4. **Whether the committed test exercises the fixed path.** It does. It swaps the route's policy
   for one with `scope: "project"`. That forces `row_scope_unavailable` on the real
   `PATCH /api/canned-responses/{id}` route, through the real `requireCannedResponseReach`, so
   an event row is written through `evidenceWorkspaceId()`. The only thing that changes the
   recorded id is `workspaceIdVerified`, which the new label sets. Step 2 proves this.

### D1 (informational): the label also changes the policy side on two routes, for the better

`workspaceIdSource` feeds `buildShadowPolicySide` as well as evidence. For a `scope: "workspace"`
policy it becomes `scopeIdSource`. `PATCH`/`DELETE /api/canned-responses/{id}` and
`DELETE`/`GET /api/invitation/{id}` declare `scopeSource: "row"`. With `null` they always
stopped at `scope_source_unavailable`. With `"row"` the policy is now actually evaluated. The
probe shows both reaching `agree` for an owner.

This is correct. The declaration is honest and the id really is row-derived, which is the
match #323 S1's provenance check was built to require. Shadow mode also never affects a live
response. The commit message does not mention this effect. The committed test uses a mocked
policy, so it does not pin the `unevaluated` → `agree` change. That change is visible in shadow
tallies, but it is an improvement in coverage, not a defect. The `work_item`-scoped routes
(comments, task-relation) are unaffected, because `scopeIdSource` is fixed to `"row"` for that
scope. No action required. If someone wants it pinned, a real-registry `agree` tally assertion
on one of those two routes would do it.

### Suites at `ec79ee0`

| Suite | Files | Tests |
| --- | --- | --- |
| `@taskdesk/permissions` | 13 | 262 passed |
| `apps/api test:unit` | 63 | 518 passed |
| `apps/api test:permissions` | 13 | 83 passed |
| `permissions-shadow-mode.test.ts` (integration) | 1 | 19 passed (18 + 1 new) |
| `apps/api test:integration` (full) | 115 | 1436 passed (1435 + 1 new) |
| `tsc --noEmit` (`tsconfig.json`, `tsconfig.permissions.json`, `tsconfig.tests.json`) | — | clean |

The first full integration run had one failure in an unrelated file:
`workspace-rbac.test.ts`, "lets a workspace_role row override the built-in viewer
permissions". That test hits task creation, which this change does not touch. The file passed
3 out of 3 times run alone, and the whole suite passed on a second full run, which is the
result in the table. I am recording it as an existing flake under load, not a result of this
change.

**Live-tested:** steps 1–4, the probe of all five call sites, and every suite in the table.
**Read only:** the forged-id analysis above. It is read from source, not probed with hostile
input. I sent no crafted ids to these five middlewares, because none of them ever writes the
caller's input into `workspaceId`.
