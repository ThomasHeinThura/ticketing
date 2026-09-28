# PR #447 — views/saved-views mechanism (issue #24)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis, real Bash/git
access)
**Session:** subagent `ae8ef040b62a49bdf`

**Reviewed head:** `dc44a2dc6b3162d38137fa57b8b5e46666ed4690`

**Verdict: NOT CLEAR.** Found and live-exploited a real HIGH-severity cross-tenant data
leak: `update-view.ts`'s `sharedWithTeamId` validation checked only team membership, never
that the team belonged to the view's own workspace — a view owner in workspace B, also a
member of a team in unrelated workspace A, could `PATCH` their view to share it into that
foreign team, persisting `saved_view.shared_with_team_id` pointing cross-workspace. Also
found: a MEDIUM doc-drift (`data-model.md` still said `owner_id`, shipped column is
`created_by`) and a LOW test-coverage gap (no test for the `workspace:manage_settings`
admin-override success path).

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `ae09422628b2f5068`

**Reviewed head:** `46fff923b13d3ca2e8ca4f76e7fe8be511b24837`

**Verdict: CLEAR WITH FINDINGS.** Nothing blocking; the fix genuinely closes the leak.

Confirmed the fix in `update-view.ts` structurally matches `create-view.ts`'s existing
correct join exactly, and that the workspace it checks against comes from the stored view
row — not attacker-controlled (verified `updateViewBody`'s Zod schema has no `workspaceId`
field, and Zod strips unknown keys; live-tested 5 different request-body shapes attempting
to smuggle a workspace override, all correctly rejected or no-effect).

**Live-reproduced the original exploit is now closed**: before the fix, every attempted
PATCH shape returned 200 with the foreign team id persisted; after the fix, every shape
returned 403 with the row unchanged (`visibility=private`, `shared_with_team_id=null`).

**One severity correction to the ordinary review**: "any member of that foreign team" could
read the leaked view was overstated — reading a view still requires reach into the view's
own workspace, so only a foreign-team member who is ALSO in the view's own workspace could
actually read it. Still a real authorization bypass (widens the audience beyond the
intended team-membership/admin rule), just narrower than originally stated.

**No second instance of the bug found**: `teamTable` is joined only in create and update,
both now guarded; read/list check team membership without a workspace check, but this is
safe only because both write paths now guarantee stored data is correctly scoped — live
verified 8 additional adversarial shapes (outsider list/create/edit/delete/pin/read,
cross-workspace `scopeId`, non-member team-view sharing, unauthorized workspace-visibility
grant), all correctly rejected.

Confirmed the regression test is real (exact exploit shape, checks persisted state) and
the admin-override test genuinely exercises a different admin who didn't create the view.
Independently reproduced fail-then-pass (reverted just the fix, confirmed the test fails
with the exact wrong-status assertion; restored, confirmed it passes).

Full suites reproduced: integration 104/1354, permissions 13/83 — matching the lane's
claim. `tsc --noEmit` clean, `check-openapi.mjs` clean (139 operations, no drift).
Confirmed migration additive-only (two new tables only). Confirmed issues #444/#445
accurately scoped (though #444's own text overstates its status as "merged" when it isn't
yet).

**Five non-blocking findings:**
- **F1 (MEDIUM, latent):** deleting a team will 500 if a team-visibility view still points
  at it — the migration declares `ON DELETE SET NULL` but a CHECK constraint requires any
  `visibility='team'` row to have a non-null team id, so the FK's SET NULL action violates
  the CHECK. No team-delete route exists yet, so unreachable today, but will break the
  first one that lands. Fix in a follow-up: either cascade-delete the view with the team,
  or flip it to `private` alongside nulling the team id.
- **F2 (LOW):** `pin-view.ts` doesn't apply the same read-visibility rule `get-view.ts`
  does — a member can pin (200) a private view they can't read (404) if they know its id.
  No content leaks (only the id they already supplied comes back), but it's an existence
  oracle and stores an unreadable view in their preferences.
- **F3 (LOW, hardening):** the "view's team must be in the view's workspace" invariant is
  enforced only in application code (both write paths), not the database — a composite FK
  would make it structurally impossible to violate rather than depending on both write
  paths staying correct forever.
- **F4 (LOW, docs):** `docs/03-features/search-and-saved-views.md` line 17 still says
  `owner_id` (missed by the earlier doc fix, which only touched `data-model.md`); the
  `saved_view` row in `data-model.md` doesn't list the shipped `workspace_id` column.
- **F5 (LOW, test coverage):** no committed tests for cross-workspace team-share creation
  (only the update path got a regression test), team members reading a team view, or the
  `workspace:manage_settings` rule on workspace-visible views — all verified live by the
  reviewer as correct, none guarded in CI.

**Forward note for #444**: when a "run this saved view" route lands, it must run the
stored query under the viewer's own reach, not the creator's.

**Process note (not a code finding):** the PR conflicted with `main` (`tests/permissions/matrix.fixture.json`
only) at review time — CI has not fully run on this exact SHA. Resolving the conflict
changes the head; this clearance needs a mechanical reconfirmation on the resolved head
(the code itself is not affected, only a generated fixture).

Nothing blocking. F1-F5 are all reasonable follow-ups, none required before merge.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `31609c59dfd1e2d60bafc4141bf4ee5eb3fad3c5`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Real two-parent merge with `origin/main` (which had advanced
with #432's hierarchy routes), resolving the conflict the Opus reviewer already flagged in
the GENERATED `tests/permissions/matrix.fixture.json` only — regenerated via `REGEN_MATRIX=1`,
not hand-edited. `git diff 46fff923b13d3ca2e8ca4f76e7fe8be511b24837..31609c59dfd1e2d60bafc4141bf4ee5eb3fad3c5`
scoped to every application file this PR touches (`apps/api/src/view/**`, `data-model.md`,
`tests/api-integration/view.test.ts`) is empty. Re-verified after the merge: full permissions
suite 13/83, `tsc --noEmit` clean, `check-openapi.mjs` clean (142 operations, contract
auto-merged correctly with no drift).

---

## Independent verification after a second, substantive branch update (2026-09-27)

**Reviewed head:** `014b5250bfbfb57a42acc2a41dc0e2890a0bda23`
**Reviewer:** Opus 5.5, fresh independent context (subagent `a8a07d35efcee0133`) — a
genuine independent pass, not a self-declared mechanical reconfirmation, because this
merge was NOT a no-op: `main` had advanced past PR #443 (workflow persistence), which
independently generated its own migration numbered `0073`, colliding with this branch's
own `0073_saved_view_user_preference.sql`. The orchestrating session resolved this by
renumbering this branch's migration to `0074` (regenerated fresh via `drizzle-kit
generate` against the merged `schema.ts`, confirmed byte-identical to the original
`0073_saved_view_user_preference.sql`) and combining both sides' additions in five
shared files (`database/index.ts`, `relations.ts`, `src/index.ts`, `policy-registry.ts`,
`workspace-access-middleware.ts`).

**Verdict: CLEAR.** Confirmed live: the view feature's own application code
(`apps/api/src/view/**`, `tests/api-integration/view.test.ts`, `data-model.md`) has an
EMPTY diff from the last-reviewed head (`46fff92`) — the merge changed nothing about the
reviewed feature itself. Confirmed PR #443's own content survived whole (every diff
between main's tip and this merge head is an addition, nothing altered or dropped).
Confirmed the migration renumbering is sound: the regenerated `0074` migration and its
snapshot are byte-identical to the original; migrating a fresh database through 0000-0074
and, separately, upgrading a database already at main's tip through just 0074, produce
byte-identical `saved_view`/`user_preference` schemas (4 check constraints, 2 primary
keys, 4 foreign keys, 6 indexes, including both partial unique indexes); `drizzle-kit
generate`/`check` both confirm no drift. Confirmed the five hand-spliced shared files have
zero cross-wiring (the `savedView` case queries only `savedViewTable`, `workflow`/
`workflowVersion` cases query only their own tables; both `viewApi` and `workflowApi` are
correctly mounted, destructured and exported; both policy sources are registered).

Full suites reproduced on this head: unit 60 files/494 tests, permissions 13 files/83
tests, integration 106 files/1374 tests — all green, including `view.test.ts` and
`workflow.test.ts` together. `tsc --noEmit` clean on all three tsconfigs. `check-openapi.mjs`
clean, 147 operations, no drift. `check-events.mjs` clean, 33 keys.

One informational note (not a finding): a throwaway lane database that already ran the
pre-merge branch's own old `0073_saved_view` migration would, under drizzle's own
timestamp-ordering rule, skip main's `0073_workflow` and fail applying `0074` — no
deployed environment ran the unmerged branch, so nothing is actually affected.

Clear to merge.

Clear to merge.
