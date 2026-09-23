# Security review — reserve built-in role names, `workspace_role.is_system` (issue #318)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `fb92bff0de9e061991dff5d14e2c8026b4e7c346`
**Pull request:** #322 (closes #318)
**Date:** 2026-09-23
**Verdict:** CLEAR WITH FINDINGS. No finding blocks.

## Head verification

- `gh pr view 322 --json headRefOid` returned `fb92bff0de9e061991dff5d14e2c8026b4e7c346`. I checked
  it again after a mid-review interruption and it had not moved. Branch `fix/318-reserve-role-names`,
  `MERGEABLE`.
- The merge base with `origin/main` is `dd067e21`, which is the current tip of `origin/main`.
- I reviewed these commits: `8f8e9d6` (fix), `a1fcf92` (round-2 backfill), `4f61703` (merge of
  `main`) and `fb92bff` (decision-log entry only). `git diff 4f61703 fb92bff` touches only
  `docs/07-planning/decision-log.md`, with 17 lines added.

## Surfaces examined

- `apps/api/drizzle/0068_workspace_role_is_system.sql` and `meta/_journal.json`
- `apps/api/src/database/schema.ts` (`workspace_role.is_system`)
- `apps/api/src/utils/require-workspace-capability.ts`, which covers `builtInRoleHasCapability`,
  `isGenuineBuiltInRoleAssignment` and `assertCallerHasCapability`
- `apps/api/src/utils/workspace-member-roles.ts` (`isGenuineBuiltInRoleGrant`,
  `resolveMembershipRoleFrom`)
- `apps/api/src/permissions/resolve-identity.ts` (the mapper, plus the loader's new fourth query)
- `apps/api/src/utils/seed-default-workspace-roles.ts` (the self-heal and the insert)
- `apps/api/src/utils/require-workspace-permission.ts`, which is unchanged. It resolves authority
  from the row's `permission` for everything except `owner`, never from the name.
- The workspace controllers: `create-workspace-role.ts`, `update-workspace-role.ts`,
  `delete-workspace-role.ts`, `create-workspace.ts`, `transfer-workspace-ownership.ts`,
  `add-workspace-member.ts`, `update-workspace-member-role.ts`, `invite-workspace-member.ts`,
  `list-workspace-roles.ts`, and `workspace/schema.ts` (the Zod bodies)
- `apps/api/src/invitation/controllers/accept-invitation.ts`
- `apps/api/src/auth.ts` (plugin list)
- `apps/api/scripts/audit-reserved-workspace-role-names.ts`
- `docs/01-architecture/rbac.md` (the new reservation section), the newest decision-log entry,
  `security-reviews/315-resolve-identity.md` (S1, S2) and issue #318
- The PR body and comments: alignment review ALIGNED WITH NOTES, ordinary review CHANGES NEEDED at
  `8f8e9d6`, then APPROVE WITH NOTES at `4f61703`

## Suites at this head

I used private database `pr322_opus_test` (and `pr322_opus_probe_test` for the probes) on
td-lane-pg. I dropped both afterwards.

- API unit: **55 files, 441 tests, all passed.**
- Integration (full): **80 files, 1107 tests, all passed.**
- `test:permissions`: **10 files, 80 tests, all passed.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, all passed.**

These counts match the PR body's.

## Probes

The probe file was `tests/api-integration/zz-pr322-opus-probe.test.ts`. It was a throwaway file and
was not committed. I ran it at this head, and ran a copy against `origin/main` `dd067e2` as a
control. Every result below was observed, not inferred.

1. **Creating a role with a built-in name, over real HTTP (`POST /api/workspace/{id}/roles`).**
   - I tried all 8 `BUILT_IN_ROLE_KEYS` and 8 variants of each: exact, UPPER, Capitalised,
     space-padded, tab/newline, NBSP-padded, ideographic-space-prefixed and BOM-prefixed. **All 64
     were refused.** Zod `.trim()` plus the controller's `.trim().toLowerCase()` strips all of those
     whitespace forms.
   - Unicode variants were **accepted but stored verbatim**, so they never equal a key: `manager` with
     a zero-width space (ZWSP) on either side, a fullwidth `ｍanager`, Cyrillic `managеr` and `leаd`,
     `ADMİN` (stored as `admi̇n`), and `owner` with a zero-width joiner (ZWJ). Both resolvers match
     with an exact `Object.hasOwn`, so none of them can resolve to a built-in. These are confusable
     display names, not an escalation.
   - `admin\u0000` returns 500 instead of 400. This is pre-existing: NUL is rejected by Postgres in a
     text column. Nothing is written, so it fails closed.
   - **Control on `main`:** `instance_admin` was accepted with 200. That is the known #315 S1/#318
     state.
2. **Renaming.** No route changes `workspace_role.role`.
   - `update-workspace-role.ts:94-97` sets only `permission` and `updatedAt`.
   - `updateWorkspaceRoleBody` has no `role` field.
   - Delete-then-recreate is the only "rename". At this head, deleting the unassigned seeded `admin`
     returns 200, and recreating a custom `admin` returns **400, reserved**. On `main`, the same
     recreate returns **200**; see finding S1.
3. **better-auth plugin routes.** `organization()` is no longer in `auth.ts`'s `plugins`. S10
   phase 1 removed it (`b5ecdf6`, 2026-09-16). `POST /api/auth/organization/{create-role,
   update-role, update-member-role, add-member, invite-member, create}` all returned **404** at this
   head.
4. **Assigning a built-in name directly as `workspace_member.role`.**
   - `PATCH …/members/{id}/role` returned **400** for each of `manager`, `lead`, `customer`,
     `instance_admin`, `owner`, `Owner`, ` owner`, `owner,admin` and `admin,owner`. The owner forms
     are refused by `roleGrantsOwner`, and the rest by the "must be an existing `workspace_role`
     row" check.
   - The DB constraint `workspace_member_role_single_value` also rejects comma and space values at
     insert.
   - Add-member and invite apply the same two checks, and accept-invitation inserts only the role
     the invite already validated.
   - If a built-in name is planted with no row, both resolvers deny it (probe 8).
5. **Can anything set `is_system = true`?**
   - No API writes it. Custom create omits it, so it takes the column default of `false`, and no
     Zod body carries it.
   - The only writers are `create-workspace.ts:156`, the `seed-default-workspace-roles.ts` insert
     (`:124`) and the self-heal (`:62-72`). All three touch only `viewer`, `member` and `admin`.
   - `list-workspace-roles` now *exposes* `isSystem` in its response. It is read-only, which is fine.
6. **Workspace scoping.**
   - The legacy lookup filters on `(workspace_id, role)`: `require-workspace-capability.ts:238-247`.
   - The adapter keys on `workspaceId + NUL + role` (`resolve-identity.ts:630-633`) and reads it back
     with the member's own `workspaceId` (`:655-657`).
   - **Probe:** user M is a genuine admin in workspace A. M has an `admin` membership in workspace B,
     and B's genuine `admin` row was removed. Result: legacy A allowed, legacy B **denied**, adapter
     grants `["admin@A"]` only.
7. **Fail-closed.**
   - When the executor's `select` throws, `builtInRoleHasCapability` **rethrows**. So does a rejected
     query promise. Both propagate out of the middleware as a 500, never a grant.
   - A missing row gives `row?.isSystem === true`, which is false, so the request is denied.
   - `owner` short-circuits before any query, so it still resolves with a broken executor.
   - **Call sites:** `builtInRoleHasCapability` has two production callers,
     `require-workspace-capability.ts:163` and `transfer-workspace-ownership.ts:95-100`. Both are
     awaited. `assertCallerHasCapability` is called at `:85` and `work-item/index.ts:287`, both
     awaited. `isGenuineBuiltInRoleGrant` is called at `require-workspace-capability.ts:249` and
     `resolve-identity.ts:424`.
   - A missing `await` would **not** be caught by `tsc` or by Biome's recommended preset; see S3.
8. **Parity table, legacy `assertCallerHasCapability` vs. adapter `resolveIdentity`.** I planted
   one real membership plus one row per case, checked 5 capabilities (`work_item:read`, `create`,
   `set_priority`, `workspace:transfer_ownership`, `workspace:delete`), and ran both resolvers.
   There were **18 cases × 5 capabilities, and 1 mismatch.**

   | Case | Legacy / Adapter |
   | --- | --- |
   | admin with `is_system=true` | read, create, set_priority: Y/Y. The rest: n/n |
   | admin with `is_system=false` | all n/n |
   | admin with no row | all n/n |
   | member, genuine | read, create, set_priority: Y/Y |
   | viewer, genuine | read: Y/Y |
   | viewer with `is_system=false` | all n/n |
   | manager with `is_system=false` (the #318 repro) | all n/n |
   | manager with a planted `is_system=true` row | read, create, set_priority: Y/Y |
   | lead with no row | all n/n |
   | customer with no row | all n/n |
   | **customer with a planted `is_system=true` row** | **read: Y/n**, the rest n/n (S2) |
   | instance_admin with a planted `is_system=true` row | all n/n |
   | owner, no row | all Y/Y |
   | `Admin` (case), `toString`, `__proto__`, custom `triage` | all n/n |

   The only mismatch is in a state that no code path can produce (probe 5).
9. **Backfill and self-heal.**
   - I planted a custom `admin` row with `is_system=false` and `permission={"task":["read"]}` and
     assigned it to a member. Before any boot, `builtInRoleHasCapability(…, "admin",
     "work_item:create")` returned `false`.
   - After `seedDefaultWorkspaceRoles()` it returned `true`. The row was now `is_system=true`, and its
     permission JSON was still `{"task":["read"]}`.
   - So the self-heal trusts the name for `viewer`, `member` and `admin`, every boot. This is exactly
     the disclosed residual.
   - **Control on `main`:** the same custom `admin`, created natively and assigned, **already gets**
     `work_item:create` and every other admin capability through the name-only legacy check. So
     "no new access" holds.

## Findings

### S1 — NON-BLOCKING. The residual is wider than the decision log states; the "no new access" conclusion still holds

`docs/07-planning/decision-log.md:26` says the only window for planting a custom
`viewer`/`member`/`admin` row was *before S4*, through better-auth's `create-role`. That is not the
only window. **On `main` today**, the native routes allow the same thing:

1. `DELETE /api/workspace/{id}/roles/{seededAdminId}` succeeds when no member holds `admin`.
2. `POST …/roles {"role":"admin"}` succeeds, because only `owner` is reserved.

Both were observed on `dd067e2`. The next boot after this PR deploys then marks that row
`is_system = true`, through both `0068`'s `UPDATE … WHERE role IN (…)` (`0068…sql:61-63`) and the
self-heal (`seed-default-workspace-roles.ts:62-72`).

I judge it non-blocking for three reasons:

- The only effect is to preserve what `main` already grants through #318's own bug (probe 9).
- A genuine seeded `admin` row, or a workspace's own owner, already holds that authority.
- Once this PR deploys, the path is closed: recreate is refused.

It remains true that, after the backfill, the audit script can no longer tell such a row from a
genuine one.

**Recommendation:** amend the "Known residual" paragraph so it says the window runs **until #322
deploys**, not just before S4, and names the native delete-then-recreate path. A separate follow-up
could extend the audit with a hint for `viewer`/`member`/`admin` rows whose `permission` differs from
`defaultRolePayloads[name]`. It would be only a hint, because an administrator can legitimately edit
a seeded row. Recording the residual in the decision log is otherwise adequate, since it grants no
new access.

### S2 — NON-BLOCKING. The legacy check lacks the adapter's scope filter, so it diverges in one state no code path can produce

`builtInRoleHasCapability` (`require-workspace-capability.ts:202`) accepts any `BUILT_IN_ROLES` key.
`resolve-identity.ts` adds `scope === "workspace"` (`isBuiltInWorkspaceRoleKey`, #315 S1).

For `customer` with a planted `is_system = true` row, legacy grants `work_item:read` and the adapter
does not (probe 8). The #320 S4 closure therefore depends on no `customer` row ever being genuine.
That is true today, because every `is_system` writer is limited to `viewer`/`member`/`admin`. But the
two resolvers are no longer identical by construction, and #323's shadow comparison would log this
state as a diff.

**Recommendation:** in a follow-up, or in #323, add the same `scope === "workspace"` guard to
`builtInRoleHasCapability`, or share `isBuiltInWorkspaceRoleKey`.

### S3 — NON-BLOCKING. A dropped `await` would fail open, and no tool would catch it

`builtInRoleHasCapability` is now async. `!builtInRoleHasCapability(…)` without `await` evaluates a
Promise, which is truthy, so the check would **grant**. I confirmed that neither `tsc` (7.0.2,
strict) nor Biome's recommended preset flags that pattern.

All current call sites await it (probe 7). The HTTP-level negative tests would go red if a
regression dropped one: the S2 repro tests, and the transfer-ownership non-owner tests.

**Recommendation (hardening):** for future callers, consider a lint rule for misused promises, or a
narrow wrapper that returns a branded result.

## Things checked and found sound

- **`owner` cannot be claimed or forged.**
  - Add, invite and update-member-role all refuse it through the comma-aware `roleGrantsOwner`.
  - The DB constraint `workspace_member_role_single_value` blocks multi-value strings.
  - `owner` is written only by `create-workspace.ts` (the creator) and by
    `transfer-workspace-ownership.ts`.
  - Transfer's caller check still requires `workspace:transfer_ownership`, which only `owner` holds.
    It now reads through `tx` inside the same advisory-locked transaction.
- **The shared predicate is used by both resolvers.** The loader's fourth query is bounded (one
  `IN` over distinct workspace ids) and is skipped when there are no memberships.
- **The migration is additive**, and its backfill is idempotent. The audit script only reads: one
  `select`, and no `insert`, `update` or `delete`.
- **No other source of built-in-named rows exists** outside test fixtures. I found no import path,
  no seed script and no data migration that writes `workspace_role`. The only non-test writers are
  create-workspace, the seed, and custom create.

## Verdict

**CLEAR WITH FINDINGS.** The escalation in #318 is closed on every path reachable over HTTP at this
head:

- **creation**: every built-in key and its whitespace and case variants are refused;
- **renaming**: there is no route, and recreate is refused;
- **plugin routes**: they are unmounted and return 404;
- **direct assignment**: it is refused, and denied if planted;
- **cross-workspace**: lookups are scoped;
- **owner**: it cannot be claimed.

The check fails closed on a missing row and on a DB error. Legacy and adapter agree on every
reachable case. S1, S2 and S3 are non-blocking. I recommend correcting S1's decision-log wording
before or soon after the merge, and taking S2 into #323.
