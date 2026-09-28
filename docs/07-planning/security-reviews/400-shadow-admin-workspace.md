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
