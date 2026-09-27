# Security review — PR #392: rename legacy `task:*` capability key to `work_item:*`

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context that did not write or direct this change.
**Reviewed head:** `d61e1f5fe4aacd6e2c7e9b0aaf2d6cdaab0df0a0` (latest delta pass, below). Earlier pass: `83c60a3377aa7dd96fe6190201239cdb0967de48`.
**Verdict:** REQUEST CHANGES at `d61e1f5` (finding E1, below). The earlier CLEAR at `83c60a3` does not carry forward to this head.

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

## Delta pass, 2026-09-27, at `d61e1f5fe4aacd6e2c7e9b0aaf2d6cdaab0df0a0`: REQUEST CHANGES

Same reviewer context as the pass above. Scope: the two new first-parent commits since `83c60a3` (`99aa0a4`, `d61e1f5`). The other commits in the range are `main` merges (`d9335e8`, `3530dc0`) and the earlier review-note commit (`db90886`). I did not re-review `main`'s own content.

**`99aa0a4` (i18n): clean.** 19 locale files plus `i18n/schema.json`. The only change is renaming the key `task` to `work_item` under `settings.workspaceRoles.resources` and `.permissions`. The text values are unchanged. No code, no permission logic. The role editor looks up labels only for keys in the compiled `statement`, so this matches the renamed resource.

**`d61e1f5` (migration `0071` changed from rename to copy-and-keep): the SQL is correct, but it causes a new blocking regression (E1). It fixes a different gap from D1, and D1 is still open.**

### Q2: SQL correctness. Correct.

I checked these cases against PG 18, one pass and then two:

| Stored value | After one pass | After two passes |
| --- | --- | --- |
| `{"task":["read"]}` | `{"task":["read"],"work_item":["read"]}` | same |
| `{"work_item":["read"]}` | untouched (guard does not match) | same |
| `{"task":["read","delete"],"work_item":["read"]}` | `work_item` overwritten with `task`'s value (`task` wins, as documented) | same |
| `{"task":[],"project":["read"]}` | `work_item: []` added | same |
| `{"task":null}` | `work_item: null` added (read as deny) | same |

Running it twice gives the same result. `apikey` keeps its `IS NOT NULL` guard. D4's missing test for the tie-break is still missing, because the new test has no row with both keys.

### Q1: does anything need `task` gone? Yes: the role write validator (E1)

- **Access checks: nothing.** `satisfies()` in `require-workspace-permission.ts` and in `require-workspace-role-authority.ts`, and the API-key narrowing check, all start from the permission being required. They only look up the keys that permission names, so an extra `task` key is never read by the new code. There is no unique constraint on the JSON, and the `organization()` plugin that might have validated stored roles has been removed.
- **The write validator does need it gone.** `create-workspace-role.ts` and `update-workspace-role.ts` both reject any key not in the compiled `statement` (`invalidResources`, HTTP 400). After `0071`, every role migrated from before #392 contains `task`.

**E1 (BLOCKING). After the upgrade, no migrated role can be saved from the settings UI. That includes removing a permission.** `GET /api/workspace/{id}/roles` (`list-workspace-roles.ts` `parsePermission`) returns every stored key, including `task`. The edit form (`roles.tsx`, around line 662) copies every returned key into its state. It never shows `task`, but it sends it back on save. The server then answers `400 Unknown permission resource(s): task`.

I reproduced this against the real routes with a throwaway test on a private `_test` database (deleted afterwards):

1. Created a custom role, rewrote its row to the pre-#392 shape, and ran `0071`'s exact SQL.
2. GET returned `{"task":["read","delete"],"work_item":["read","delete"]}`.
3. I sent that back with `work_item:delete` removed, as the UI does. Result: **400**.
4. The same PATCH without `task` returned 200 and stored `{"work_item":["read"]}`.

Every seeded default role in every pre-#392 workspace, and every custom role, is affected until the later cleanup migration ships. That has no issue and no date.

This is security-relevant: an admin cannot narrow a role through the product. The only workarounds are a raw API call or deleting the role and creating it again. The editor also counts permissions twice for these roles, because `permissionCount` adds up `task` too. That is minor, but it misleads an admin checking a role.

The original rename version of `0071` did not have this problem, because it left no `task` key behind.

**Recommended fix (small).** In `list-workspace-roles.ts`'s `parsePermission`, drop any key not in `Object.keys(statement)`. Doing this on the server covers every client that reads a role and writes it back, not only this UI. Add one regression test: seed `{task, work_item}`, GET, PATCH back exactly what GET returned, expect 200, and check the stored row has no `task`.

**Do not fix this by having `update`/`create` keep or merge `task`.** See Q3 for why that would be the one real security problem.

### Q3: will the cleanup migration ever happen, and does keeping `task` forever matter?

- **Real risk that it never happens.** The decision-log entry says a later migration "may" remove `task`, but there is no issue, tripwire or date for it. Recommendation: open a tracking issue now. Its condition should be that no pre-#392 image is still serving or is a rollback target.
- **Keeping `task` forever is tech debt, not a security hole, as long as every write replaces the whole value.** The new code never reads `task`. Both role writes replace the whole JSON and refuse `task`, so any edit made with new code removes it. There is no app path that edits API-key permissions after the key is created.
  - A role not edited since the upgrade has `task` equal to `work_item`. Rolling back gives the same access.
  - A role edited since the upgrade has no `task`. Rolling back gives *less* access, never more.
  - The only way to get an old, broader grant back on rollback would be a write that merges instead of replacing, or that keeps `task`. Nothing enforces that. Recommend a test that an update removes a stored `task` key; the E1 regression test above can do this.

### Q4 / D1: is D1 fixed? No. `d61e1f5` fixes a different, opposite gap

- **What `d61e1f5` fixes: old code reading migrated rows.** With the rename version, every old pod during a Helm rolling update, and every rollback to a pre-#392 image, lost all work-item access, because `task` was gone. Keeping `task` fixes that. It is a real improvement, and it covers the "throughout a rollback" part of D1 for roles that have not been edited.
- **What D1 is: old code writing rows after `0071` has run, which new code then reads.** Examples are a new workspace's default roles, an old pod's role edit, and a new API key. Those rows have `task` only. `0071` is already recorded as applied, so nothing adds `work_item` to them, and new pods deny them. `d61e1f5` does not change this. **D1 is still open, still LOW** (access is only ever reduced, and only deployments crossing #392 are affected).
- **Correction to my earlier D1 text.** I wrote that "an admin can repair it by re-saving the role". That is wrong for the UI: a `task`-only row has the same E1 problem. The `parsePermission` fix above makes repair work: the role shows as empty, and the admin grants it again.
- **Better D1 fix than the boot-time repair I suggested before.** Re-keying at each boot still misses rows written by old pods between the last new pod starting and the last old pod stopping. The complete fix is for the new code to fall back to `task` only when `work_item` is absent. The places are `customRoleStatements()`, `ownRoleStatements()`, and `verifyApiKey()`'s `parsePermissions()`. Remove the fallback in the same cleanup migration.
  - This is safe for the same reason as Q3: only old code ever writes a row with `task` and no `work_item`, and new-code writes replace the whole value.
  - This stays a non-blocking recommendation. The boot-time repair is an acceptable smaller alternative if the gap it leaves is written down.

### Checks

- CI at `d61e1f5`: every required job is green, including `integration - Postgres 18`, except `pull request template + security review`. That job is expected to fail until the gate table names a review cleared at this head.
- Local: the throwaway reproduction above, plus the SQL case table. I did not re-run the full integration suite locally; CI's run at this head is the evidence.

### To clear

Fix E1 as recommended, with its regression test. Then a fresh delta pass on the new head. D1 (now scoped as above), D4 and the cleanup tracking issue are non-blocking.
