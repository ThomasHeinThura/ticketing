# Security review — PR #392: rename legacy `task:*` capability key to `work_item:*`

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context that did not write or direct this change.
**Reviewed head:** `83c60a3377aa7dd96fe6190201239cdb0967de48`
**Verdict:** CLEAR, with non-blocking findings (D1–D5).

## First pass, at `675e12faf38166e14163be900da590f64cd7e8c1`: REQUEST CHANGES

- **Finding 1 (BLOCKING).** Renaming the `task` statement key to `work_item` in code left every stored `workspace_role.permission` row keyed `task`. `customRoleStatements()` reads that column directly, with no fallback to the compiled default (issue #66: a missing key means DENY). So every non-owner role written by a pre-rename binary would silently lose all work-item access on upgrade. Reproduced end to end: seeded pre-rename roles, ran the boot tasks, and `POST /api/task/{projectId}` returned 403 where it should return 200. Same defect class as #318/#322.
- **Finding 2 (LOW).** Same gap for `apikey.permissions`: `hasWorkspacePermission()` uses it to narrow the key's access, so a `task`-keyed key is denied.

## Delta pass, at `83c60a3377aa7dd96fe6190201239cdb0967de48`

The one new commit adds migration `0071_workspace_role_apikey_permission_task_to_work_item.sql`, its journal entry, a comment-only correction in `legacy-better-auth-access-control.ts`, and `tests/api-integration/workspace-role-apikey-permission-rekey-backfill.test.ts`. Nothing else changed.

- **The SQL is correct.** It removes `task` and adds `work_item` with the same value for both columns (`apikey` guarded `IS NOT NULL`). It is idempotent: it only touches rows that still have a `task` key, and a second run through the real migrator is a no-op. The tie-break is correct (`task`'s value wins; checked in PG 18). Rows keyed only `work_item` are left untouched.
- **Ordering claim confirmed.** No shipped setup lets new code serve before the migration runs. Helm runs it as an initContainer; Compose makes the app wait for `migrate` to finish successfully; `deploy.sh` runs the migration explicitly on upgrade and rollback; `runApiBootTasks()` never migrates.
- **Finding 1 re-tested on the fixed code**, with the real Drizzle migrator and `0071` marked unapplied, then boot tasks, then HTTP: 200 for a built-in role, a custom role and an API key. With the migration skipped (an order no shipped setup allows): 403, so the original exploit reproduces. **Finding 1 fixed.**
- **Finding 2 fixed** the same way and tested.
- **Tests:** integration suite 92 files / 1,240 tests pass at this head (1,242 on a trial merge with main). Mutation testing: leaving out either statement, or keeping the `task` key, makes the new tests fail. Flipping the tie-break does not (D4).

## Non-blocking findings

- **D1 (LOW).** The old binary still serves while the migration runs: Helm's rolling update, and `deploy.sh` running migrate before replacing the container. It also serves throughout a rollback to a pre-#392 image. Anything it writes in that time — new-workspace default roles, custom-role edits, API keys — is keyed `task`. After `0071` is recorded as applied, nothing rewrites those rows, and `seedDefaultWorkspaceRoles()` only inserts missing rows. Result: silent DENY for those rows (reproduced). Access is never widened, and an admin can repair it by re-saving the role. Only deployments that cross #392 itself are exposed. Recommended follow-up: add the same idempotent re-key as a boot-time self-heal in `seedDefaultWorkspaceRoles()` (same pattern as the `is_system` self-heal already there), and correct the migration comment's "correct to apply before or after that code change lands".
- **D2 (INFO).** Helm `migrate.enabled: false` removes the only migration runner. Data-only migrations would then be skipped silently.
- **D3 (INFO).** No CI check pins the initContainer or `depends_on` ordering. Suggested general guard: at boot, assert the latest journal entry is recorded in `drizzle.__drizzle_migrations`.
- **D4 (LOW).** The "`task` wins" tie-break has no test. Add a case with a row holding both keys.
- **D5 (INFO).** A malformed row makes `0071` throw and stop the deploy. Access checks already treat such rows as deny, and no application path writes them.
