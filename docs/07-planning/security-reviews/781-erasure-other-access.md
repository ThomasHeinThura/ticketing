# PR #781 security review record: account erasure refuses while others have access (#734)

PR #781 closes #734 under Thomas's 2026-10-15 decision. Before deleting anything or invalidating credentials, account erasure checks whether any other person (directly, through SCIM/OIDC grants and mappings, or as a signed-in customer of a served organisation) has access to a workspace it would delete. If so it refuses with 409. The check shares its predicates with the delete helper. It runs first without a lock; only a passing erasure takes LOCK TABLE person, membership_grant, membership with a 3 s transaction-local lock_timeout and re-checks under the lock.

Claude Sonnet 5.5 lanes implemented the change and the review fixes. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review B by Claude Sonnet 5.5: APPROVE at ee165bf7 with gaps (arms, customers, race); REQUEST CHANGES at 861ecae3 (lock order, no timeout); APPROVE at 9707843f, 05f85db6 and fd4a8595.
- Ordinary review D by Claude Sonnet 5.5: APPROVE at ee165bf7, 861ecae3, 05f85db6 and fd4a8595 (lock_timeout restore verified on a scratch database).
- Security review by Claude Opus 5.5: CLEAR at 9707843f with a non-blocking abuse path (refused calls took the table lock), fixed at 05f85db6 (unlocked pre-check); CLEAR at 05f85db6 and fd4a8595.

**Reviewed head:** `fd4a85954e85699cea03c5d255190790a24d1528`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `781-ordinary-b-sonnet.md` | Ordinary review B (main..fd4a8595) | Claude Sonnet 5.5 | `fd4a8595` | APPROVE | `ab4c5ac65cd458d8d42aecf74e48983c62085f1100a01c72cb0f93388e93c163` |
| 2 | `781-ordinary-d-sonnet.md` | Ordinary review D (main..fd4a8595) | Claude Sonnet 5.5 | `fd4a8595` | APPROVE | `f53eeb336501a4bb3ac7dc40ff358bcb87f56000acf45d4e2fd5c5485fecd346` |
| 3 | `781-security-opus.md` | Security review (main..fd4a8595) | Claude Opus 5.5 | `fd4a8595` | CLEAR | `3d23c854264b480cf898022320c4406d24348fdd5e5268dce6db4ca27a457ffb` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/781-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 ab4c5ac65cd458d8d42aecf74e48983c62085f1100a01c72cb0f93388e93c163) -->
# Ordinary review B, PR #781 (#734: account erasure counts IdP-provisioned access)

**Reviewed head:** ee165bf7f4b1dca8f8ea775a51aad89af0b938dc
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** main 9297362b5f2dd1f17da935c8051c1562b473638a (merge base)
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; targeted tests only.

## Commands
- `gh pr view 781 --json headRefOid` = head above. Diff: account-deletion.ts (+10), delete-account-data.ts (+113/-1), data-model.md (the `role` row, one bold sentence added), two test files.
- `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/workspace-delete-role-dependents.test.ts`: 1 file, **17 tests passed**. `CI=true vitest run ../../tests/api/user/account-deletion.test.ts`: 1 file, **13 tests passed**.

## Rule versus the owner decision on #734
Decision: count SCIM/OIDC memberships in the sole-member check; if anyone else has access, erasure stops with a clear 409 and the workspace must be transferred or removed first; nobody else loses access silently. The code runs after the legacy sole-member plan and before any deletion or credential invalidation, inside the same transaction, and throws `APIError("CONFLICT")` (409, the same mechanism as the existing "only owner" message). It counts any `membership` row, and any non-revoked `membership_grant` row, held by a person other than the erasing user's own person(s), that targets the workspace, one of its projects, or a role the workspace owns. That is broader than "SCIM/OIDC only" (it also counts JIT and direct grants, as the data-model text says), which fits the decision's own test, "if anyone else has access". Revoked grants and rows of another scope that merely share the id (for example an organisation) are excluded, and tests cover: SCIM/OIDC row, project-scope membership, grant-only, revoked grant not blocking, sole member proceeding, access to a different workspace, and the organisation-scope false positive.

## Predicate parity with #732's delete helper
The check's three arms (workspace scope, project scope via the workspace's projects, role owned by the workspace) match the first three arms of the `membership`/`membership_grant` predicates in `deleteWorkspaceRoleDependents`, so what erasure would silently delete is what the check protects, for those tables. Two arms of the helper are not mirrored: grants reached only through an `oidc_group_mapping_id` or `scim_group_mapping_id` that belongs to the workspace. A grant whose own scope and role are elsewhere but which derives from a workspace mapping would be deleted without being counted. This should be impossible by the mapping validator (mapping role and scope are inside the workspace, and grants copy them), so it is a defence-in-depth gap rather than a live defect; non-blocking, but cheap to close by reusing one shared predicate.

## data-model.md text
The new bold paragraph sits inside the `role` row's delete-semantics text, states the rule ("besides the legacy `workspace_member` rows, every membership and non-revoked grant ... that targets the workspace, one of its projects or a role the workspace owns and belongs to a person other than the erasing user"), the 409-before-anything-deleted behaviour, and the scope exclusion. It is accurate to the code. The preceding sentence still says account erasure of a sole-member workspace is the one path where authority "is meant to go"; with the new paragraph that is now conditional and reads fine. Placement inside an already very long table cell is awkward; a short pointer from the `membership_grant` or erasure spec would be easier to find. Non-blocking.

## "Access" and the 409 message
- Counted as access: any membership or live grant for another person on the workspace or its projects, including inactive or deactivated people; this is conservative (a dormant account blocks erasure until the workspace is transferred or removed), which matches "nobody loses access silently".
- Not counted: organisation-scoped memberships (customers) of an organisation whose customer-serving projects live in the workspace. Deleting the workspace removes those projects, so such customers lose their portal access without a block. The decision speaks of IdP-provisioned members, so this is outside it; flagged as residual.
- Message: `Other people still have access to "X" through your identity provider. Transfer it or remove it before deleting your account.` Two wording issues: (1) it says "through your identity provider", but the check also counts direct and JIT rows, so for a non-IdP row the statement is wrong; (2) "your identity provider" is odd for the erasing person. Suggest "Other people still have access to "X". Transfer it or remove it before deleting your account." Status code and the quoted-names list format follow the existing message.

## Findings
**Blocking:** none.
**Non-blocking:** message wording above; mirror the two mapping arms for parity; note the customer-organisation residual; a concurrent SCIM provisioning between the check and the delete is not locked (the check runs in the same transaction but takes no lock on the workspace's membership rows), a narrow race that would silently delete a just-created row; consider locking the workspace row FOR UPDATE or re-running the check just before delete; data-model placement.

## Residual risk
Real SCIM/OIDC provisioning end to end and concurrency not exercised; full integration suite not run.

**Verdict:** APPROVE

---
## Delta review (ee165bf7 to 861ecae3)

**Reviewed head:** 861ecae325aade21ea57a021090d959b7af1a711
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Delta: account-deletion.ts, delete-account-data.ts, delete-workspace-role-dependents.ts, data-model.md, two test files.
- Targeted tests: `workspace-delete-role-dependents.test.ts` plus `api-integration/account-deletion.test.ts` (2 files, **35 passed**), `tests/api/user/account-deletion.test.ts` (**13 passed**). No test exercises the table lock or a concurrent writer.

## Findings from my first review: status
- Predicate parity: fixed. `workspaceDependentPredicates` is now the single definition (role ownership, workspace scope, project scope, and for grants both mapping-derived arms) used by both `deleteWorkspaceRoleDependents` and the erasure check. Good structural change; delete behaviour is unchanged by the refactor.
- Customers: fixed in line with the owner's "anyone else has access". An active, signed-in customer person of an organisation that one of the workspace's projects is bound to now blocks erasure. This is conservative (any such customer blocks, even one who never used the portal) but defensible, and the rbac.md Reach step it cites is the real access path. The `inArray(..., subquery as never)` cast is a type escape; non-blocking.
- 409 message: fixed (neutral, no "identity provider").
- Race between check and delete: addressed with a table lock; this is the part I judge below.

## The table lock: `LOCK TABLE membership, membership_grant, person IN SHARE ROW EXCLUSIVE MODE`
What it does: blocks every INSERT/UPDATE/DELETE on the three tables (and a second such lock) until the erasure transaction ends; plain reads, `SELECT ... FOR UPDATE/SHARE` and foreign-key checks (which take ROW SHARE) are unaffected. Taken only when the erasure is about to delete at least one workspace. The design reason (provisioning writers take no workspace-level lock and the polymorphic scope rows have no FK to lock through) is correct, and it does close the race completely, including orphan rows.

Duration: from the check until commit, so it covers the cascade deletion of the workspace. Because the workspaces in question are, by construction, ones with no other member (and now no other access), they are small, so the window is normally short. That is the main thing making a table lock tolerable here.

Problems, in order of weight:
1. **Lock-order deadlock with the natural writer order.** The statement acquires `membership`, then `membership_grant`, then `person`. JIT login and SCIM user create insert or update `person` first and then write `membership`/`membership_grant`. A writer holding a `person` lock that then needs `membership` waits on the erasure, which holds `membership` and waits on that writer's `person` lock: a deadlock. Postgres resolves it after `deadlock_timeout` by aborting one side, so the user sees an erasure failure or the IdP sees a failed provisioning call. The window is small but real, and trivially avoided by listing the tables in the writers' order (`person, membership, membership_grant`). I found no other `LOCK TABLE` in application code (only the migration's ACCESS EXCLUSIVE locks), so there is no existing lock-order convention to contradict except the writers' own write order.
2. **Unbounded wait and queue convoy.** `LOCK TABLE` waits indefinitely, and while it waits behind any long-running writer every later writer to those tables queues behind it, so one slow transaction turns into an instance-wide write stall on `person`, `membership` and `membership_grant`. The database layer sets no `lock_timeout` or `statement_timeout` (grep of apps/api/src/database). A `SET LOCAL lock_timeout` of a few seconds before the lock, mapped to the existing erasure retry path (`AccountDeletionRetryError` / `requestAccountDeletionRetry`), bounds this and makes failure clean.
3. **Same-user interleaving.** The erasure already holds `SELECT ... FOR UPDATE` on the user row and the per-workspace advisory pair before it asks for the table lock; an IdP sync that is updating this user's `person` and then touching the `user` row would also deadlock. Item 1's ordering and item 2's timeout reduce but do not remove this; it is rare.
4. Blast radius when it does bite: every write path on those three tables (project creation's creator grant, invitation accept, role changes, SCIM, JIT) for the duration; the doc states "reads are unaffected" accurately.

Narrower mechanisms that exist:
- The codebase's own convention is the per-workspace advisory pair (`lockWorkspaceRoleAssignment`, namespaces 4_002 then 4_003) already taken here and by workspace deletion and the native member flows. Extending the identity-provisioned writers (membership projection in `identity/repository.ts`, SCIM and JIT paths, project-creator grant) to take the same workspace lock (shared form for writers, exclusive for deletion) would be exact and local to the one workspace, but it touches several writers and is a larger change.
- A cheaper bounded variant of the present approach: same table lock but ordered `person, membership, membership_grant`, with `lock_timeout`, and acquired as late as possible (just before the check) so the lock is held for the shortest span.
I would not ask for the advisory redesign in this PR given the owner's priority and the rarity, but the ordering and the timeout are cheap, and without them the lock introduces a new, avoidable failure mode into provisioning.

## Docs
data-model.md now describes the shared predicates, the customer rule, the 409 and the lock (accurate to the code). Add "bounded by a lock timeout" once that exists.

## Findings
**Blocking:** (1) lock order and (2) no lock timeout, as above. Both are one-line changes: list `person, membership, membership_grant`, and `SET LOCAL lock_timeout` with a retryable failure. A concurrency test (a writer holding `person` then inserting `membership` while an erasure runs) would prove the ordering, but a small unit assertion of the executed SQL plus the timeout setting is the minimum.
**Non-blocking:** `as never` cast; customer rule is conservative; concurrency otherwise untested.

**Verdict:** REQUEST CHANGES

---
## Delta review 2 (861ecae3 to 9707843f)

**Reviewed head:** 9707843f0632e8ed0f9bfcbab74c83494a5c0abb
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Delta: delete-account-data.ts (+32), new `utils/is-lock-not-available.ts`, data-model.md (one sentence), `workspace-delete-role-dependents.test.ts` (+102).
- Tests: `CI=true vitest run --config vitest.integration.config.ts` on workspace-delete-role-dependents and api-integration/account-deletion: 2 files, **37 passed**; `tests/api/user/account-deletion.test.ts`: **13 passed**.

## Lock order: their reasoning checked against the code
I had proposed `person, membership, membership_grant` from the writers' general shape; the lane chose `person, membership_grant, membership`. Checked in source:
- Every caller of `projectMembershipKeys` (oidc-login.ts, scim and repository.ts paths, project-creator-grant.ts, workspace-admin-reach.ts) writes `membership_grant` rows (INSERT or UPDATE, which takes ROW EXCLUSIVE even if no row matches) before projecting; the projection function itself starts with `SELECT ... FOR UPDATE OF membership_grant` and only then writes `membership` (and later updates grants again). A transaction therefore already holds ROW EXCLUSIVE on `membership_grant` before it first touches `membership`, which is the order the lane states. `workspace-admin-reach.ts` row-locks `person` (`FOR UPDATE`) before writing grants; OIDC JIT and SCIM create insert/update `person` first.
- So their order matches the actual first-acquisition order, and mine would have been the one at risk: a writer holding `membership` and still needing a stronger lock on `membership_grant` (the later grant updates inside the projection) would deadlock against an erasure that already held `membership_grant`. I withdraw my suggested order. The OIDC admission-denial branch writes grants then returns before any `person` write, so it does not invert the order within one transaction.
- Limits of this check: a code reading across the identity writers, not an exhaustive audit of every code path or a lock-graph proof; the new no-deadlock test covers the `person`-first writer. Within the same order, a writer that takes `membership_grant` before `person` in one transaction would still conflict; I found none.

## Lock timeout and failure mapping
- `set_config('lock_timeout', '3s', true)` is transaction-local and set immediately before `LOCK TABLE`; it is reset with `set_config('lock_timeout','0',true)` afterwards so later statements are unbounded again. This bounds the queue-convoy window to 3 s and removes the unbounded wait. Note `'0'` means "no timeout", not "restore the prior value"; the repository sets no default `lock_timeout`/`statement_timeout`, so it is equivalent today, but a future server or role default would be overridden for the remainder of the erasure (non-blocking).
- `isLockNotAvailable` detects SQLSTATE 55P03 by walking the `cause` chain (same pattern as the existing helpers, no message matching, depth-bounded). On timeout the transaction rolls back (nothing deleted) and the caller receives the existing `CONFLICT` 409 with "Your account cannot be deleted right now because the system is busy updating access. Nothing was deleted; try again in a moment." The status code is consistent with the other refusals in this function and the text is clear and retryable. Other errors, including a deadlock (40P01), are rethrown unchanged.
- New tests: a writer holding `person` then writing `membership` while an erasure runs does not deadlock; a held writer makes the erasure give up with 409 and nothing deleted while the writer stays untouched (commit/rollback behaviour of the writer asserted). The timeout test depends on a real 3-second wait, so it adds a few seconds to the file; acceptable.

## Docs
data-model.md now states the order and the bound (accurate to the code). Nothing else changed in the contract.

## Findings
**Blocking:** none. Both blockers from my previous delta are resolved.
**Non-blocking:** the `'0'` reset semantics; a coarse 3 s timeout under heavy provisioning load will surface as a retryable 409 to the user (acceptable and clearly worded); the broader narrower-lock alternative (workspace advisory lock in the identity writers) remains available for later if erasure-with-workspace becomes common.

**Verdict:** APPROVE

---
## Delta review 3 (9707843f to 05f85db6)

**Reviewed head:** 05f85db656bd3378d39d4bdcff7de605d0ad0b9c
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Delta: delete-account-data.ts (+22/-12), data-model.md (one sentence), two test files (+146).
- Tests: `CI=true vitest run --config vitest.integration.config.ts` on workspace-delete-role-dependents, pending-action-credential-revocation and account-deletion: 3 files, **74 passed**; `tests/api/user/account-deletion.test.ts`: **13 passed**.

## What changed and whether it is right
- The access check is now a closure, `refuseIfOthersHaveAccess`, run once with no table lock and, if it passes and a workspace is about to be deleted, a second time after the lock is held. A refused erasure therefore performs only reads, takes no instance-wide lock and cannot be used to stall provisioning writers by repeating a refused call (the abuse path the Opus review raised). The passing path still locks (order `person, membership_grant, membership`, 3 s `lock_timeout`, 55P03 mapped to the 409), then re-checks under the lock, so the race guard I judged earlier is unchanged: nothing can grant access between the second check and the delete. A passing erasure deletes the account, so the lock cannot be repeated by the same user.
- Ordering relative to side effects is intact: both checks run before `invalidateAccountDeletionCredentials` and before any delete, so a refusal at either point leaves sessions, keys and pending actions untouched (the new HTTP-level test asserts exactly that for the session, API key, pending action and account). When no workspace is deleted, `workspacesWithOtherAccess` returns early on an empty id list, and the second run is skipped, so the common erasure pays nothing extra.
- Cost: a passing erasure runs the cheap check twice; negligible.
- Tests: the timing test asserts a refused call returns in under 1.5 s while a conflicting writer holds a lock (the old code would wait for the 3 s timeout, about 6 s with the surrounding waits as the author reports). A wall-clock threshold can flake on a very slow runner, but the gap between 1.5 s and the failure mode is wide; non-blocking.
- data-model.md updated to describe the two-pass check; accurate.

## Sequencing note (#788)
The plan to land #781 first and then rebase batch 7 (#788) so that `refuseIfOthersHaveAccess`, `workspacesWithOtherAccess` and the lock statements move into `user/repository.ts` addresses my cross-PR finding. Reminder for that rebase: the closure now owns the two-pass structure and the lock block holds the order, timeout and error mapping; the repository functions should take an executor first and the controller should keep only orchestration (the pre-check, the lock call and the re-check).

## Findings
**Blocking:** none.
**Non-blocking:** wall-clock timing test margin; statements added by this PR still sit in a controller until #788 moves them (tracked by the sequencing plan).

**Verdict:** APPROVE

---
## Delta review 4 (05f85db6 to fd4a8595)

**Reviewed head:** fd4a85954e85699cea03c5d255190790a24d1528
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

- Live head confirmed by `gh pr view`. Delta: `delete-account-data.ts` (+9/-4) and `workspace-delete-role-dependents.test.ts` (+7/-3); nothing else.
- Tests: workspace-delete-role-dependents, pending-action-credential-revocation, account-deletion (integration): 3 files, **74 passed**; `tests/api/user/account-deletion.test.ts`: **13 passed**.
- Timing test (my non-blocking flake note): the bound is now `ERASURE_LOCK_TIMEOUT_MS - 500` (2.5 s against the 3 s lock timeout), exported as a constant from the controller so test and code share one number. The previous assertion's own message check is the real discriminator (a call that had tried the lock would answer the "busy" message after waiting out the timeout; a refused call answers the other-access 409 text), and the comment says so; the elapsed bound is a loose backstop that no longer sits close to normal runner jitter. Nothing in the assertions was weakened: the message check is unchanged and the bound is looser only in the safe direction relative to the failure mode it guards.
- Lock timeout restore: the code now reads `current_setting('lock_timeout')` before setting the bounded value and, after the lock is acquired, sets it back to that captured value (`'0'` only if nothing was returned) with `set_config(..., true)` (transaction-local), instead of unconditionally writing `'0'`. This fixes the case I noted, where a server or role default would have been overridden for the rest of the erasure. `current_setting` returns the same unit-bearing text that `set_config` accepts, and on the failure path (55P03) the transaction aborts and the transaction-local setting disappears with it, so no restore is needed there.
- Unchanged and still correct: two-pass check, lock order, 409 mapping, data-model text.

## Findings
**Blocking:** none.
**Non-blocking:** none new.

**Verdict:** APPROVE
<!-- END REPORT (sha256 ab4c5ac65cd458d8d42aecf74e48983c62085f1100a01c72cb0f93388e93c163) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/781-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 f53eeb336501a4bb3ac7dc40ff358bcb87f56000acf45d4e2fd5c5485fecd346) -->
# #781 (#734) ordinary review D (line-level)

**Reviewed head:** ee165bf7f4b1dca8f8ea775a51aad89af0b938dc
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** merge-base with origin/main (9297362b); 5 files: `user/controllers/delete-account-data.ts` (+113), `user/account-deletion.ts` (message), `data-model.md` (role row), two test files.

## Commands
- `pnpm install --frozen-lockfile --prefer-offline`; (typecheck for this PR's tree not re-run; the delta is two files and the integration run compiles them).
- `CI=true vitest run --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts`: **17 tests passed** (10 pre-existing + 7 new). Unit `tests/api/user/account-deletion.test.ts`: 13 passed.
- Mutations (scratch, reverted): M1 drop `isNull(revokedAt)`: "not blocked by another person's revoked grant" fails (killed). M2 drop the project-scope arm of `inScope`: "project-scope membership" test fails (killed).

## The access query
- Correct tables: `membership` (materialised effective membership) and `membership_grant` (the grant ledger incl. SCIM/OIDC/JIT/direct), resolved through the erasing user's own `person` ids; `workspace_user` is the legacy count already used by `planAccountDeletion`. A row counts when it targets (a) `scope='workspace' AND scope_id=workspace`, (b) `scope='project'` and the project belongs to the workspace, or (c) a role the workspace owns (`inArray(roleId, roleIds)`), and belongs to a person other than the user's own. This mirrors exactly what `deleteWorkspaceRoleDependents` would delete (workspace/project scope OR role ownership), so the guard and the destruction cover the same set; that is the right invariant. Organisation-scoped rows that merely share an id are excluded and not deleted (test "does not count, or delete, another person's organisation-scoped row").
- Revocation: grants require `revoked_at IS NULL`; there is no other expiry column on `membership_grant` (checked schema), and a `membership` row's presence is the active state per data-model.md, so no further filter is needed. Soft-deleted projects still count (conservative, fine).
- Edge: if the user has no person row, `others()` is `undefined` and every access row counts; that is the safe direction (a membership cannot exist without a person, so it only blocks when someone else's row does).

## Ordering and transaction
- The check runs after the plan and the owner-block check and **before** `invalidateAccountDeletionCredentials`, before the workflow/role-dependent/workspace deletes and before leave-handling. It throws `APIError("CONFLICT")` inside the transaction (own or ambient), so nothing is written. Ordering verified by reading; the tests call `deleteAccountData(userId)` directly (the non-ambient path), so the "no credential invalidation on refusal" half is not exercised by a test (only DB snapshot equality: workspaces, roles, memberships, grants, mappings, scim members, users, legacy members). Non-blocking gap: snapshot does not include sessions/accounts, and the `accountDeletion=true` ambient path is untested for this branch.
- Concurrency: the function first takes the per-workspace `lockWorkspaceRoleAssignment` advisory locks and re-reads memberships (retry on change), but that lock is only taken by the legacy workspace-member controllers and invitation acceptance. SCIM/OIDC provisioning writers (`identity/repository.ts`, `identity/scim-protocol.ts`, `oidc-login.ts`) lock per `taskdesk:membership:<person>:<scope>:...` keys, not the workspace lock, so a provisioning insert can land between the access check and `deleteWorkspaceRoleDependents`. Outcome in that window: if committed before the dependents delete it is silently removed (the thing the PR exists to prevent); if after, the RESTRICT role FK aborts the transaction (safe, a 500-class failure). Default READ COMMITTED. The window is narrow and the failure mode is bounded to a just-provisioned member; non-blocking, but worth recording and ideally closing by taking the workspace role lock in the provisioning writers or re-running the access query under `FOR SHARE`/after the dependents delete as an assertion (delete returns rows that were not seen by the check).
- Per-workspace loop does up to three queries each; acceptable (erasure is rare).

## Message and docs
- `formatOtherAccessMessage` is unit-tested for 1 and several names and says "through your identity provider", but the rows counted also include direct grants and project-creator grants (the doc text lists SCIM, OIDC, JIT or direct). Wording is slightly narrower than behaviour; non-blocking.
- data-model.md text matches behaviour (counts `membership` and non-revoked `membership_grant` targeting workspace, its projects or an owned role; 409 before anything is deleted; organisation rows do not count; no migration).

## Tests
Seven new cases cover SCIM/OIDC rows, project-scope-only membership (via a global role, which genuinely isolates scope from role ownership), grant-only, revoked grant not blocking, true sole member proceeding with own provisioned rows removed, another person's access to a different workspace, organisation-scoped shared-id row. Both mutations above are caught. Missing: concurrent-grant race, ambient/credential ordering, membership owned by an inactive person (counts today; behaviour untested but conservative).

## Verdict
No blocking defect found; the race and the untested ordering are residual risks recorded above.

**Verdict:** APPROVE

---

## Delta review: ee165bf7 -> 861ecae3 (my first review was complete at ee165bf7; this covers the follow-up)

**Reviewed head:** 861ecae325aade21ea57a021090d959b7af1a711
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Commands: `pnpm turbo typecheck` 9/9; `CI=true vitest run --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts`: **23 passed** (17 before); unit `account-deletion.test.ts`: 13 passed. Mutations (scratch, reverted): remove the table lock: the two-connection test fails (killed); remove the customer arm: the customer test fails (killed); remove the two group-mapping arms from the shared grant predicate: both mapping-only tests fail (killed).

- **Predicate sharing:** `workspaceDependentPredicates(tx, ids)` is now the single definition (membership: role-owned OR workspace/project scope; grant: those two plus grants derived from an OIDC or SCIM group mapping that itself qualifies by role or scope). `deleteWorkspaceRoleDependents` and the erasure check both consume `membershipWhere` / `grantWhere`, so what deletion removes and what erasure protects cannot drift; the earlier gap (a grant linked only through its group mapping, which deletion removed but the check ignored) is closed and tested for both OIDC and SCIM, with the test isolating the mapping arm by moving the person's own scope and role elsewhere. Deletion behaviour is unchanged (same arms, same order; the `grantIds` snapshot is built from `grantWhere`). Correct.
- **Customer query:** counts an `active` `customer`-side person with a `user_id`, not the erasing user, whose `organisation_id` is among the non-null organisation ids of the workspace's projects. That matches the reach rule (customer organisation reach to bound projects) and the consequence (the workspace delete removes those projects). Tests: blocked for a signed-in active customer; not blocked for an inactive customer or a customer of an organisation bound only to another workspace's project. Notes: (a) soft-deleted/archived projects still count (conservative); (b) an inactive customer is ignored while an inactive staff person is counted (the deactivated-person test), a defensible asymmetry (an inactive customer cannot sign in) but worth stating in the doc; (c) the subquery is passed with `as never`, a type escape that hides a mismatch if the column type ever changes.
- **Lock placement and scope:** `LOCK TABLE membership, membership_grant, person IN SHARE ROW EXCLUSIVE MODE` runs inside the erasure transaction, after the owner/plan checks, only when a workspace is about to be deleted, and before the access check, credential invalidation and any delete; it is held to commit/rollback (a 409 rolls back and releases). SHARE ROW EXCLUSIVE conflicts with every writer (ROW EXCLUSIVE) and itself but not with reads, so concurrent provisioning, invitation acceptance, project-creator grants and person updates all queue until this transaction ends, which closes the race I recorded in the first review (writers that take no workspace lock). Residual (non-blocking, but a real operational trade-off): (1) it stalls every writer to those three tables instance-wide for the duration of an erasure, and the account-deletion path runs in the longer ambient transaction; the statement waits with no `lock_timeout`, so it can queue behind a long writer and, while waiting, block new writers queued behind it; consider `SET LOCAL lock_timeout` with a retryable error; (2) lock ordering against writers that hold row locks and then wait on a lock this transaction already holds (workspace advisory locks, user row `FOR UPDATE`) can deadlock; Postgres will abort one side, which for the writer is a retry and for erasure an error, so acceptable but untested. Erasure of a sole-member workspace is rare, so the blast radius is bounded.
- **Two-connection test:** an uncommitted grant insert is held open on one connection; erasure on another asserts it is still waiting after 800 ms (proof it is blocked on the lock, not just slow), then the writer commits and erasure must refuse with the access message, the workspace remain and the grant exist. Meaningful and mutation-killing (no lock: erasure finishes without seeing the uncommitted row). The 800 ms wait is timing-based, which can only produce a false "finished" if the erasure does not wait, i.e. the failure direction is correct; slow CI could not make it pass wrongly.
- **Message/docs:** message no longer claims "through your identity provider" (my earlier wording finding), unit tests updated; data-model.md describes the shared predicates, the customer rule, the 409 and the table lock accurately.

**Verdict:** APPROVE

---

## Delta review: 861ecae3 -> 9707843f (lock order, bounded wait)

**Reviewed head:** 9707843f0632e8ed0f9bfcbab74c83494a5c0abb
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Commands: `pnpm turbo typecheck` 9/9; `CI=true vitest run --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts`: **25 passed** (23 before). Mutations (scratch, reverted): lock order changed back to membership, grant, person: the no-deadlock test fails (killed); removal of the `lock_timeout` reset to '0': **all 25 still pass (survives)**.

- **Lock order:** `LOCK TABLE person, membership_grant, membership IN SHARE ROW EXCLUSIVE MODE`, with the comment documenting that the provisioning writers touch `person` first, grants parent-first, and only then project into `membership`. The deadlock test reproduces the dangerous interleaving (a writer holds a `person` row update, erasure queues, the writer then inserts into `membership`): with the old order erasure would already hold `membership` and the pair deadlocks; with the new order the writer completes first and erasure then sees the row and refuses. The mutation proves the test is sensitive to the order. I spot-read the cited writers and the order claim is consistent with them; I did not exhaustively prove every writer path.
- **Timeout scope:** `set_config('lock_timeout', '3s', true)` is transaction-local (third argument true), so it cannot leak to the pooled connection after commit or rollback, including the ambient better-auth transaction. It is set immediately before the `LOCK TABLE` and applies to any lock wait in that window only.
- **Reset to '0':** correct only if the connection's default is no timeout. `lock_timeout` is not configured anywhere in the application (no connection option, no `SET` in the code), so '0' equals the default today; if an operator ever sets `lock_timeout` per role or database, '0' would disable it for the rest of this transaction instead of restoring it. A more exact reset is `SET LOCAL lock_timeout TO DEFAULT` or capturing `current_setting('lock_timeout')` first. Non-blocking. The reset itself is untested (mutation survives): a later statement waiting more than 3 s for a lock would otherwise raise 55P03 as an unmapped 500; add a test asserting `current_setting('lock_timeout')` after the lock, or a slow later write.
- **Timeout error and retry loops:** `55P03` is detected by walking the `cause` chain for `code` (same shape as the sibling helpers), and mapped to `APIError("CONFLICT")` thrown immediately; no further statement runs on the aborted transaction. The only retry loop on this path, `withAccountDeletionTransaction`, retries solely `AccountDeletionRetryError` (up to 4 attempts) and rethrows everything else, so the 409 escapes after the transaction rolls back and nothing is deleted. A retry (re-run in a new transaction) re-sets the timeout in that new transaction. The message is neutral ("busy updating access, nothing was deleted, try again").
- **Tests:** the timeout test holds an uncommitted grant, runs erasure with the real 3 s bound, asserts a `CONFLICT` with the busy message, then releases the writer and asserts the snapshot equals the start state plus only the writer's grant and the workspace still exists; it also proves the writer is untouched. Meaningful and mutation-relevant (the `55P03` mapping, via the real database path), though it costs about 3 s of real time (30 s test timeout) and is wall-clock dependent in the safe direction. The deadlock test uses a fixed 500 ms wait, whose only failure mode is a false pass if erasure were somehow slower than the wait; the mutation shows it does fail on the wrong order.
- **Docs:** data-model.md states the order, the 3 s bound, the 55P03 to 409 mapping and the message accurately.

**Verdict:** APPROVE

---

## Delta review: 9707843f -> 05f85db6 (unlocked pre-check before the table lock)

**Reviewed head:** 05f85db656bd3378d39d4bdcff7de605d0ad0b9c
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Commands: typecheck 9/9 (turbo, partly cached); `CI=true vitest run --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts pending-action-credential-revocation.test.ts`: **62 passed**. Mutations (scratch, reverted): drop the unlocked first-pass check: the new timing test fails (killed); drop the re-check under the lock: the concurrent-grant test and the deadlock-order test fail (killed); move `invalidateAccountDeletionCredentials` ahead of the first check: the new HTTP-level refusal test fails (killed).

- **Race guard intact:** the check is now a single closure `refuseIfOthersHaveAccess` (same `workspacesWithOtherAccess(tx, plan.workspaceIdsToDelete, userId)` call, same 409 builder) invoked twice: once before the lock and, when a workspace is going to be deleted, again after the lock is taken and the timeout reset. Because it is one function, the two predicates cannot drift. The re-check runs in a new statement after the lock under READ COMMITTED, so it sees every write committed before the lock was granted, which is exactly what the earlier race test proves (and the no-recheck mutation kills it). When no workspace is to be deleted the helper returns immediately (`workspaceIds.length === 0`), so no query and no lock; the former unconditional post-lock check is now a conditional repeat with the same effect.
- **Refused path takes no lock:** a refusal in the first pass throws before the `set_config`/`LOCK TABLE` block, so a caller who repeats a refused request cannot stall provisioning writers (the stated motivation). Credential invalidation and every delete still come after both checks. A passing request still locks, but it then proceeds to delete (it cannot be repeated cheaply as an attack).
- **Tests meaningful:** (1) timing test: a committed access row makes the first pass refuse while an unrelated writer holds a conflicting row lock on `membership_grant`; erasure must answer the access 409 in under 1.5 s, with the "busy" message absent and the state unchanged except the writer's own grant. The lock timeout is 3 s, so a call that had reached the lock would take about 3 s and answer "busy"; the mutation (removing the pre-check) fails it at 3346 ms. The 1.5 s bound leaves a 2x margin below the lock timeout and slow CI can only fail it, not pass it wrongly. (2) HTTP-level test drives the real `/api/auth/delete-user` through better-auth (the ambient-transaction path I flagged as untested in my first review): 409 with the access message, and afterwards the session, API key (enabled), pending action (still `pending`, no invalidation reason), user and workspace are intact and the session still works. This closes my earlier note about credential invalidation ordering not being exercised.
- Docs: data-model.md updated consistently (unlocked first pass, lock only when it passes, same check re-run under the lock).

**Verdict:** APPROVE

---

## Delta review: 05f85db6 -> fd4a8595 (looser timing bound, restore prior lock_timeout)

**Reviewed head:** fd4a85954e85699cea03c5d255190790a24d1528
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Commands: typecheck 9/9; `CI=true vitest run --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts pending-action-credential-revocation.test.ts`: **62 passed**. Mutation reproducing 9707843f's behaviour for the refused path (remove the unlocked first-pass check): the refused-erasure test fails with `expected 3012 to be less than 2500` (3.0 s is the lock timeout, so the call waited for the lock and, per the message assertion, would have answered "busy"). Note: running the new test file against the literal 9707843f tree would fail for a different reason (the exported constant does not exist there, so the bound becomes `NaN`), which is why I used the behavioural mutation instead.

- **Restore is correct, in the transaction:** the code reads `current_setting('lock_timeout')` into `priorLockTimeout` first, sets `lock_timeout` to `3000ms` with `is_local = true`, takes the lock, then `set_config('lock_timeout', <prior>, true)`. I verified the semantics on a scratch Postgres 18 container (removed by exact id) with the database default set to `7s`: `current_setting` returns `7s`; the local bound shows `3s`; restoring `7s` shows `7s`; after COMMIT the setting is `7s`; and the old `set_config('lock_timeout','0',true)` showed `0` inside the transaction, i.e. it would have disabled a configured timeout for the rest of the erasure. So the new behaviour fixes the concern from my previous delta. It is transaction-local either way (nothing leaks to the pooled connection), a value already set locally by a caller is also preserved, and an absent value falls back to `"0"`. The result row is read as `.rows[0]?.value` (the node-postgres result shape; typecheck and the passing integration run confirm it). The restore itself has no direct test (the suite's default is `0`, indistinguishable from the old reset); acceptable given the SQL check above, a test setting a non-default timeout would pin it.
- **Timing test:** the bound is now `ERASURE_LOCK_TIMEOUT_MS - 500` (2500 ms) using the exported constant the code itself uses, so the test cannot drift from the production timeout. It is a loose backstop: the discriminating assertions are the access-409 message and the absence of the "busy" message, which fail for a call that reached the lock. The mutation shows both the time and the message route catch the regression; slow CI can only make it fail, not pass wrongly.

**Verdict:** APPROVE
<!-- END REPORT (sha256 f53eeb336501a4bb3ac7dc40ff358bcb87f56000acf45d4e2fd5c5485fecd346) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/781-security-opus.md; Claude Opus 5.5; sha256 3d23c854264b480cf898022320c4406d24348fdd5e5268dce6db4ca27a457ffb) -->
# PR #781 (#734) security review — account erasure refuses while others have access

**Reviewed head:** 9707843f0632e8ed0f9bfcbab74c83494a5c0abb
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge base 9297362b5f2dd1f17da935c8051c1562b473638a (origin/main at review time 9bb28099a69d1e599e1d7451ebdf6225e380546c; `git merge-tree` against main: clean)
**Role:** did not author, direct or remediate this change. Ordinary reviews B/D and the lock-fix note read as context only; claims re-verified against source.

## Surfaces examined
- `apps/api/src/user/controllers/delete-account-data.ts` — full `deleteAccountDataInTransaction` order of operations, `workspacesWithOtherAccess`.
- `apps/api/src/workspace/controllers/delete-workspace-role-dependents.ts` — extracted `workspaceDependentPredicates`, confirmed the delete now uses the same `membershipWhere` / `grantWhere` objects (five grant arms, two membership arms).
- `apps/api/src/user/account-deletion.ts` — `formatOtherAccessMessage`.
- `apps/api/src/utils/is-lock-not-available.ts`.
- `apps/api/src/auth.ts` (`deleteUser` hook, rate limit), `apps/api/src/index.ts` (delete-user routing) — who can trigger erasure.
- Lock-order cross-check: every caller of `lockWorkspaceRoleAssignment` / the 4_002 membership advisory lock (`accept-invitation`, `add-workspace-member`, `invite-workspace-member`, `update-workspace-member-role`, `remove-workspace-member`, `leave-workspace`, `transfer-workspace-ownership`) takes the advisory lock as its first statement, before writing `person`/`membership`/`membership_grant`.
- `docs/01-architecture/data-model.md` paragraph; the two test files.

## Commands (scratch worktree, CI=true Testcontainers Postgres 18)
- `pnpm install --frozen-lockfile --prefer-offline` — exit 0. `pnpm turbo typecheck` — exit 0 (turbo cache hit).
- `vitest run --config vitest.integration.config.ts workspace-delete-role-dependents.test.ts account-deletion.test.ts` — 2 files, 37 tests passed, exit 0.
- Same config over every integration file referencing `delete-user`/`deleteAccountData` (account-deletion, pending-action-credential-revocation, project-creator-lead, work-item-activity-table, workspace-delete-role-dependents, workspace-owner-admin-reach) — 6 files, 429 tests passed, exit 0.
- `vitest run tests/api/user/account-deletion.test.ts` (unit) — 1 file, 13 tests passed, exit 0.
- PR checks at this head: mostly still pending at review time (1 success, 20 not yet concluded). Merge must wait for them.

## Findings
1. **No deletion or credential invalidation before the refusal — confirmed.** Before the new block the transaction only takes advisory locks, a `FOR UPDATE` on the user row and reads. Both refusals (lock timeout → 409, other access → 409) are thrown before `invalidateAccountDeletionCredentials`, the workflow delete, `deleteWorkspaceRoleDependents`, the workspace delete and leave-handling. The tests snapshot nine tables and assert equality after refusal, including the timeout case. Gap (non-blocking): tests call `deleteAccountData` directly, so the ambient `accountDeletion=true` path (sessions/accounts untouched on refusal) is proven by reading, not by a test.
2. **409 message content — no leak.** It lists only names of workspaces the caller is the sole legacy member of (their own workspaces). It names no person, no count, no access type. The busy message is generic.
3. **Predicate parity — confirmed.** Check and delete are built from the same predicate objects, so a grant reached only through a workspace OIDC/SCIM mapping is now both counted and deleted. The check is deliberately broader (counts inactive people; customer arm) — conservative direction.
4. **Deadlock reasoning — sound for the writers in this repo.** Erasure holds workspace advisory locks and the user row, then requests the table lock. All workspace-membership writers take the advisory lock first, holding no table lock while waiting, so no cycle. Order `person, membership_grant, membership` matches the provisioning writers; the concurrency test (writer holds `person`, then writes `membership`) passes. Any other cycle (e.g. a writer that writes `person` and then waits on the erasing user's row) would be broken by Postgres deadlock detection; the transaction rolls back with nothing deleted, surfacing as a non-409 error. Non-blocking.
5. **Availability of the instance-wide lock — non-blocking, recommend a follow-up.** Any signed-in user who is the sole legacy member of a workspace can call delete-user (fresh session required by the auth library; global limiter 100 requests / 10 s per client). When their workspace still has other people, every call takes the table lock, then refuses with 409 and keeps the account, so the call can be repeated. While uncontended the lock is held only for the short check; when a writer is in flight, the request queues and new writers to these three tables queue behind it for at most 3 s per call. Repeated calls can therefore degrade provisioning/login writes but cannot hold the lock indefinitely, and the caller gains no data. Suggested follow-up: run the cheap `workspacesWithOtherAccess` check once without the lock and refuse early, taking the lock only when the unlocked check passes (the locked re-check stays authoritative), and/or a per-user throttle on delete-user. Not a merge blocker given the 3 s bound, authentication requirement and existing rate limit.
6. `set_config('lock_timeout','0',true)` resets to "no timeout" rather than restoring a prior value; equivalent today (no role/database default is set by the application). Non-blocking, as ordinary review noted.

## Residual risk / not checked
- No HTTP-level test through `/api/auth/delete-user` for the new refusals.
- No load measurement of the convoy effect in finding 5.
- Image not booted (API-only change, no new env or migration).

**Verdict:** CLEAR

---

## Security delta review — finding 5 remediation

**Reviewed head:** 05f85db656bd3378d39d4bdcff7de605d0ad0b9c
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context (same reviewer as above; did not author or direct the fix)
**Comparison base:** 9707843f0632e8ed0f9bfcbab74c83494a5c0abb (previous reviewed head); one commit `05f85db6`.

### Surfaces examined
`apps/api/src/user/controllers/delete-account-data.ts` (delta), `data-model.md` sentence, the two new tests in `workspace-delete-role-dependents.test.ts` and `pending-action-credential-revocation.test.ts`.

### Checks
- **Race guard unchanged.** The same `workspacesWithOtherAccess` call (same `workspaceDependentPredicates`, same customer arm), wrapped in `refuseIfOthersHaveAccess`, now runs once without the lock and once more after `LOCK TABLE` whenever a workspace is to be deleted. The locked re-check is in the same position as before (after the lock, before invalidation/deletes). Under READ COMMITTED it takes a fresh snapshot after the lock is granted, so rows committed by writers that held the lock are seen.
- **Nothing deleted or invalidated before the locked re-check.** Between the two checks there are only `set_config` and `LOCK TABLE`. `invalidateAccountDeletionCredentials` and every delete still follow the locked re-check.
- **DoS note closed.** A refused call (others have access) now returns before any table lock is requested. The lock is taken only by a call that passes the unlocked check; such a call either completes the erasure (one-shot, the account is gone) or loses a race and is refused under the lock, which requires a concurrent grant and cannot be repeated cheaply.

### Commands (scratch worktree, CI=true Testcontainers)
- `pnpm install --frozen-lockfile --prefer-offline` exit 0; `pnpm turbo typecheck` exit 0.
- Integration: `workspace-delete-role-dependents`, `pending-action-credential-revocation`, `account-deletion` — 3 files, 74 tests passed, exit 0. Unit `tests/api/user/account-deletion.test.ts` — 13 passed, exit 0.
- Mutation M1 (remove the unlocked pre-check): the new timing test fails (3486 ms, ran into the lock), exit 1. Mutation M2 (remove the locked re-check): "a grant written concurrently, while erasure waits for its lock, is seen by the check" and the lock-order test fail, exit 1. Source restored after each; worktree clean.

### Findings
- Tests are meaningful: the timing test is non-vacuous (M1), the existing concurrent-grant test still guards the locked re-check (M2), and the new HTTP-level test drives `/api/auth/delete-user` with a password and asserts 409, pending action still `pending`, session row present and usable, API key still enabled, user and workspace present.
- Non-blocking: the 1500 ms timing bound could flake on a very slow runner, but the 3 s lock timeout leaves margin. The earlier `lock_timeout '0'` reset note is still open and non-blocking.

**Verdict:** CLEAR

---

## Security delta review — non-blocking notes follow-up

**Reviewed head:** fd4a85954e85699cea03c5d255190790a24d1528
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context (same reviewer; did not author or direct the fix)
**Comparison base:** 05f85db656bd3378d39d4bdcff7de605d0ad0b9c; one commit `fd4a8595`, 2 files (`delete-account-data.ts`, `workspace-delete-role-dependents.test.ts`).

### Checks
- **No security-relevant behaviour change.** The timeout value is unchanged (`"3s"` → `` `${3000}ms` ``). Both access checks, the lock statement, the lock order, the 55P03 → 409 mapping and the position of invalidation/deletes are unchanged.
- **Restore cannot leave a session-level timeout behind.** The prior value is read with `current_setting('lock_timeout')` before the change. Both the bounded set and the restore use `set_config(..., true)`, which is transaction-local, so neither outlives the transaction on a pooled connection. If `LOCK TABLE` throws, the restore is skipped but the transaction aborts, which discards the local value. The restored value is the server's own string from `current_setting`, not caller input.
- **Timing test still discriminates.** The bound is now `ERASURE_LOCK_TIMEOUT_MS - 500` (2500 ms), and the assertions that the message is the access message, not the busy one, are kept. Re-ran mutation M1 (remove the unlocked pre-check): the test fails (8283 ms under load, and the busy message), exit 1. Source restored; worktree clean.

### Commands (scratch worktree, CI=true Testcontainers)
- `pnpm install --frozen-lockfile --prefer-offline` exit 0; `pnpm turbo typecheck` exit 0.
- Integration: `workspace-delete-role-dependents`, `pending-action-credential-revocation`, `account-deletion` — 3 files, 74 tests passed, exit 0.

### Findings
None. Both earlier non-blocking notes (timing-bound flake, `'0'` reset) are resolved.

**Verdict:** CLEAR
<!-- END REPORT (sha256 3d23c854264b480cf898022320c4406d24348fdd5e5268dce6db4ca27a457ffb) -->
