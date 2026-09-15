# Pre-merge security review — PR #119 (#118 evaluator half: fail-closed on ambiguous `workspace_role`)

**Reviewed head:** `3e21f06e678ebd636cf36cac7884cae9cbe17b53`

**Verdict: CLEAR FOR MERGE.** Zero blocking findings.

**Reviewer independence.** A fresh Opus context, spawned explicitly via the `Agent` tool with
an explicit model pin, that authored no part of the change under review — including no part
of the merge-conflict resolution with PR #110, and no part of the post-#122-merge rework of
`tests/api-integration/workspace-role-duplicate-rows.test.ts` (both already reviewed by two
independent Sonnet contexts across prior rounds, at this same head).

## Scope

`workspaceRolePermission` in `apps/api/src/utils/workspace-member-roles.ts` — the shared read
both `customRoleStatements` (`require-workspace-permission.ts`) and `ownRoleStatements`
(`require-workspace-role-authority.ts`) now call — refuses (returns `null`, which both callers
already treat as DENY) when a `(workspace_id, role)` pair resolves to anything other than
exactly one row, instead of picking one via an unordered `.limit(1)`. This is the evaluator
half of issue #118; PR #122 (merged first, `main@4aec6ed`) is the database half, adding the
`UNIQUE (workspace_id, role)` constraint that prevents new ambiguity from being written.

## What was established by demonstration, not by reading

- **The refusal predicate is exactly right, including the zero-rows case.** `rows.length !== 1`
  denies on 0 rows (a role name with no definition at all — already the DENY case pre-#118) and
  on 2+ rows (the ambiguous case #118 exists to close), and grants only on exactly 1. Confirmed
  by reading every call site: both evaluators already treat `null` as DENY on every path that
  reaches them, verified by tracing the return value through to the HTTP response in both
  files.
- **Merge-conflict resolution with PR #110 is correct.** The import block in
  `require-workspace-permission.ts` and `require-workspace-role-authority.ts` keeps
  `resolveMembershipRole`/`MembershipRoleResolution` (from #110, unrelated to this table) and
  `workspaceRolePermission` (from this PR), and drops `isUnambiguousMembership`/
  `workspaceMemberRoles`, confirmed unused in these two files by direct grep both locally and
  across the rest of the codebase (still referenced elsewhere: `remove-workspace-member.ts`,
  `leave-workspace.ts`, `transfer-workspace-ownership.ts`, `update-workspace-member-role.ts`,
  `require-workspace-capability.ts` — none of those files or their behavior changed by this
  PR).
- **Q1 — does the post-#122 drop/restore sequence in the test actually work, checked by
  breaking it, not by reading it.** Forced the in-`try` assertion to fail
  (`toBe(403)` → `toBe(999)`) and measured what the `finally` block actually left behind by
  querying `pg_constraint` and the table directly afterward:

  ```
  AssertionError: expected 403 to be 999
  workspace_role_workspace_id_role_unique | UNIQUE (workspace_id, role)  <- restored
  planted_rows_left: 0                                                   <- cleaned
  ```

  The safety property (a failed assertion must not leave the constraint dropped for every
  other test in the same process) holds under a real failure, not just on inspection. The
  restored constraint was confirmed definitionally identical to migration `0051`'s (same name,
  same columns), and confirmed to survive a full run of the entire integration suite, not just
  the one file.
- **Q2 — does P2 still test the evaluator, or did it quietly become a test of the DB
  constraint?** Tested by mutation, not by reading the intent. Both `rows.length !== 1` →
  `rows.length < 1` and deleting the guard entirely still produce `expected 200 to be 403` —
  the constraint drop only builds the ambiguous-row scenario; the assertion still keys on the
  evaluator's own refusal, independent of whatever the database would otherwise allow.
- **P1's deletion is genuinely covered elsewhere, not just asserted to be.** Confirmed
  `tests/api-integration/workspace-role-uniqueness.test.ts` (PR #122) already exercises both
  the pre-constraint reachable-duplicate state and the post-constraint refusal, on the
  migration's own terms — so P1's removal here is a supersession, not a coverage loss.
- **Gates reconciled independently, not accepted from the reported count.** Full integration
  run: **56 files / 525 tests**, 0 failures, against a lane-private database. Reconciled as
  521 (pre-existing) + 5 (uniqueness suite, measured standalone) − 1 (P1, deleted) = 525;
  55 pre-existing files + 1 = 56. Exact match. `test:permissions` 76/76. `tsc --noEmit` clean
  at 0 errors across 3 invocations. `biome check` clean. Combined run alongside #122's own
  test file passes in both file orders (order-independence, ruling out load-order coupling).
  `fileParallelism: false` / `maxWorkers: 1` in `vitest.integration.config.ts` (confirmed
  still true at this head) rules out the one real risk this drop/restore pattern would
  otherwise carry — a concurrently-running file observing the constraint transiently absent.

## Findings

None blocking. Two forward-looking notes, neither a defect in what this PR ships:

- The drop/restore test pattern has an unstated dependency on single-worker sequential
  integration execution. If integration parallelism is ever enabled, this would open a window
  where another file's insert that should be rejected could transiently succeed. A one-line
  comment naming the coupling would make this survivable later; not required now because the
  config that makes it safe is itself asserted in the module and unlikely to change silently.
- `workspaceRolePermission`'s doc comment (`apps/api/src/utils/workspace-member-roles.ts`) has
  one stale line describing the constraint as landing "with the migration" in future tense,
  now that #122 has actually merged to `main`. Cosmetic; fold into the next natural touch of
  that file.
- Issue #136 (the still-mounted plugin's `has-permission` unioning duplicate `workspace_role`
  rows) stays open, narrowed but not closed by #122: migration `0051` refuses to apply while a
  conflicting duplicate pair exists, which is exactly the window this PR's evaluator refusal
  is the only protection for — the reason this PR still earns its place now that the
  constraint has landed.

## What this review does not claim

This review clears PR #119's evaluator change — the refusal predicate, both call sites, the
merge-conflict resolution with #110, and the post-#122 test rework — against the threat model
issue #118 exists to close. It does not extend to PR #122 (the database half, reviewed and
cleared separately, `docs/07-planning/security-reviews/122-workspace-role-unique.md`) or to
issue #136, which stays open by design.
