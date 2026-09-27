# Security review — #269: exact-match unique-violation constraint names (PR #404)

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `6f41659f391ae7f68c69e7af04f75a6e634d0b33`
**Reviewed SHA:** `6f41659f391ae7f68c69e7af04f75a6e634d0b33` (confirmed via `gh pr view 404 --json headRefOid` and `git ls-remote` at start and end of review)
**Base:** `f8096cffc8d044277d5907167eb2549f295bb059` (merge-base with `origin/main`; `origin/main` was `ed2507236c52305c71325f72cd7f727b4f603172` at review time)
**Branch:** `fix/269-unique-violation-exact-match`
**Pull request:** #404 (single commit `6f41659`)
**Implemented by (as recorded in the PR body):** Sonnet 5, session `lane-269`
**Date:** 2026-09-27

Any later change to #404's head (rebase, base merge, code or test commit) invalidates this attestation; only a commit touching `docs/07-planning/security-reviews/` alone is exempt.

## Surfaces examined

- `apps/api/src/utils/is-unique-violation.ts` (whole file)
- All six callers, found by grep, not taken from the PR body: `create-work-item.ts`, `create-workspace.ts`, `update-workspace.ts`, `create-project.ts`, `update-project.ts`, and `utils/seed-internal-organisation.ts` (no constraint argument, so its behaviour is unchanged)
- `apps/api/src/database/schema.ts`: `workspaceTable`, `projectTable`, `projectSlugClaimTable`, `workItemKeyClaimTable`
- Migrations `0004` (`workspace_slug_unique`), `0055` (`work_item_key_claim` and the `work_item_claim_key()` trigger), `0064`, `0065`
- `tests/api/utils/is-unique-violation.test.ts`, plus the integration tests that drive these catch blocks

## Verdict

**CLEAR WITH FINDINGS. No finding is BLOCKING.**

- **Every hardcoded name is the real one.** I migrated a fresh Postgres 18 database (`opus404_test` on td-lane-pg) through every migration and read `pg_constraint` and `pg_index` myself. Then I raised each violation for real through `drizzle-orm/node-postgres` and passed the resulting error to the PR's own `isUniqueViolation`. The driver error sits one `cause` link below `DrizzleQueryError`, `code=23505`. The reported names are `workspace_slug_unique` (insert and update), `project_slug_unique` (insert and update), `project_slug_claim_pkey` (direct insert), and `work_item_key_claim_pkey`. The last one comes from the BEFORE INSERT trigger when a key is already claimed by another work item id. Each matched `true`.
- **No real race is lost (question 1).** Each call site can reach these unique violations:
  - `create-workspace.ts`: under the old `"slug"` substring, the only slug constraint written in that transaction was `workspace_slug_unique`. The internal-organisation seed handles its own violations inside a savepoint. So the old and new rules catch exactly the same things.
  - `update-workspace.ts`: the same, `workspace_slug_unique` only.
  - `create-project.ts`: this can reach both names; see the next bullet. The old substring also matched both, so behaviour is identical.
  - `update-project.ts`: only `project_slug_unique` can be raised. The claim insert is `ON CONFLICT (slug) DO NOTHING`, with the PK as arbiter. I confirmed live that a duplicate claim is silently absorbed. Dropping `project_slug_claim_pkey` here loses nothing.
  - `create-work-item.ts`: the old `"key"` substring also matched `work_item_key_unique`, `work_item_pkey`, `activity_pkey`, and every other `*_pkey`. Only `work_item_key_claim_pkey` is reachable:
    - Every `work_item` row with key K has a claim on K (composite FK plus trigger).
    - A new row has a fresh id, so the trigger's claim insert fails on the PK before the heap or index insert that would hit `work_item_key_unique`. Under concurrency the second writer waits on the first writer's claim PK entry and then raises the same PK error.
    - The trigger's `ON CONFLICT ("key", work_item_id)` absorbs `work_item_key_claim_key_work_item_id_unique`.
    - `work_item_project_number_unique` was never matched by either rule.
  - **What a miss does:** at every site the error is rethrown to `app.onError`, which gives a 500. Nothing proceeds silently or writes anything partial, because the transaction rolls back. At `create-workspace.ts` a miss would also turn off the auto-slug retry. The names are verified, and that path has integration coverage (below). The narrowing is also a small correctness gain: an unrelated `*_pkey` collision no longer becomes a misleading "key already claimed" 409.
- **The `create-project.ts` array is correct (question 2).** Both names are live and both can be reached:
  - `project_slug_unique`: two concurrent creates of slug S in different workspaces. The advisory lock is per workspace, so it does not serialise them. The second one's project insert waits and then raises.
  - `project_slug_claim_pkey`: T1 creates S and commits. T1′ renames that project away from S, or hard-deletes its workspace, and commits. Both happen between T2's claim pre-check and T2's project insert. T2's project insert then succeeds, and its claim insert raises on the claim PK.
  - Neither name is stale.
- **The caller audit is complete (question 3).** The grep finds six callers, the five in the PR plus `seed-internal-organisation.ts` with no argument. Outside the helper, no other code in `apps/` or `packages/` tests for `23505`.
- **The regression test really discriminates (question 4).**
  - At this head: 8/8 pass.
  - With only the helper's `expected.has()` changed back to `.includes()`: 1 test fails ("does NOT match by substring").
  - With `origin/main`'s whole helper restored: 2 fail (the substring test and the array test). Restoring the fix brings it back to 8/8.
  - I also changed two call-site names on purpose (`work_item_key_claim_pkeyX`, `workspace_slug_uniqueX`). Three integration tests failed: `project-slug-claim-permanence` "defence in depth … 409, not a raw 500", `workspace-write-create-contract` A2-P4, and the concurrent-race test A2-P4b. So a wrong name at those two sites cannot pass CI.
  - `project-slug-claim-permanence`, `project-slug-unique`, `workspace-write-create-contract` and `work-item-create-read-list` pass at this head: 4 files, 42 tests.
- **One Opus pass is the right tier (question 5).** This is a narrow, mechanical change to how existing defence-in-depth error mapping picks out an error. It changes no authority, permission, or gate-semantics rule. It adds no migration and no new write path, and it does not cross a shared contract.

| # | Severity | Summary |
| --- | --- | --- |
| F1 | NON-BLOCKING (test gap) | The catch blocks in `create-project.ts`, `update-project.ts` and `update-workspace.ts` have no integration coverage, because their pre-checks answer the common case first. A wrong name there would pass CI and turn a race-time 409 into a 500 (fails closed). I verified those names live by hand. A future constraint rename needs the same check. |
| F2 | NON-BLOCKING (pre-existing, not introduced here) | `update-project.ts` absorbs a claim conflict with `ON CONFLICT DO NOTHING`. In the same narrow race as the `project_slug_claim_pkey` case above, a rename can take slug S while the claim for S stays with another project. That project's burned keys then hit `create-work-item.ts`'s 409, which this PR keeps working. `create-project.ts` has the same race and rejects it; `update-project.ts` does not. Worth a follow-up issue, e.g. check `RETURNING`, or re-read the claim holder after the insert and throw `ProjectSlugTakenError` if it is not `id`. |
| F3 | NIT | Edge semantics changed with no caller affected. `""` used to match any 23505 and now matches none. `[]` matches none. A caller passing either would silently never match. |
| F4 | NIT | The doc comment says the name comes from "`pg_constraint`'s own name". For a unique index that has no constraint behind it (for example `work_item_key_unique`), Postgres reports the index name. No current caller targets one. |

## Environment notes

- The worktree used symlinked `node_modules` from the main checkout. `tsc --noEmit` on `apps/api` reported 2 errors in `assign-work-item.ts` (`@taskdesk/domain` exports). They come from that symlink setup and are in no file this PR touches. CI `static` is green at this head.
- The probe database was dropped afterwards. No probe or mutation was committed.
- At review time CI was green on every required check except `integration - Postgres 18`, which was still pending. The PR body's ordinary-review section still reads PENDING. Both are outside this note.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `79d0093bc80e17ecd1eb964c031f9fb1f1ff6e9f`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. `git show --remerge-diff` empty; brings in already-reviewed
main content (#394's check:tokens gate), zero overlap with this PR's own files.

---

## Lightweight re-confirmation after branch update, round 2 (2026-09-27)

**Reviewed head:** `1a374e0fd1d32485376b4433165c2221d35a865a`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty remerge-diff; brings in #346's already-reviewed P3
identity domain code, zero overlap with this PR's own files.
