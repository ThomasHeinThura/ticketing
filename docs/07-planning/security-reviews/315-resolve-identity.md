# Security review — inert `resolveIdentity` adapter (issue #8 Slice 1)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `14e8fcc0d02fc9a906dcc47b75a8d4999cfcb54e`
**Reviewed SHA:** `14e8fcc0d02fc9a906dcc47b75a8d4999cfcb54e` (confirmed via `gh pr view 315 --json headRefOid`; PR code at `112fef1`, then merge `14e8fcc` with parents `112fef1` and `6061a9d` = `origin/main`)
**Pull request:** #315
**Date:** 2026-09-23


## Head verification

- `14e8fcc` is a two-parent merge of `112fef1` (PR tip) and `6061a9d` (`origin/main`).
- `git diff 6061a9d 14e8fcc` is byte-identical to `git diff 6aad350 112fef1` (the PR's own
  diff against its original base), so the merge introduced no conflict resolution and no
  change to PR-owned files. The PR diff is 4 files: `apps/api/src/permissions/resolve-identity.ts`,
  `apps/api/vitest.config.ts`, `tests/api/permissions/resolve-identity.test.ts`,
  `tests/api-integration/resolve-identity.test.ts`.

## Surfaces examined

- `apps/api/src/permissions/resolve-identity.ts` (all 419 lines)
- `packages/permissions/src/identity.ts`, `evaluator.ts` (`expandCapabilities`, `grantAppliesTo`,
  `authorityFor`, `can`, `reaches`, `evaluatePolicy`), `roles.ts` (`BUILT_IN_ROLES`)
- `apps/api/src/utils/workspace-member-roles.ts` (`resolveMembershipRoleFrom`),
  `require-workspace-capability.ts`, `is-instance-admin.ts`, `require-workspace-permission.ts`
  and `require-workspace-role-authority.ts` call sites, `authenticate-api-request.ts`,
  `verify-api-key.ts`, `seed-internal-organisation.ts`
- `apps/api/src/auth.ts` (plugins, `accountLinking`, `session.cookieCache`, `databaseHooks.user`)
- `apps/api/src/workspace/controllers/create-workspace-role.ts`, `update-workspace-member-role.ts`,
  `add-workspace-member.ts`, `create-workspace.ts`, `remove-workspace-member.ts`, `leave-workspace.ts`
- `apps/api/src/database/schema.ts`: `user`, `session`, `workspace`, `workspace_member`, `team`,
  `team_member`, `apikey`, `organisation`, `person` (incl. `person_user_unique`), `membership`
- `docs/01-architecture/rbac.md` (§ Roles are editable rows, § The customer role is special,
  § Reach, § Authority, § MCP), `auth-and-identity.md` (§ Sessions, § Portal boundary,
  § Identity resolution), `multi-tenancy.md` (§ Cross-organisation work), `data-model.md` (`membership`)

## Suites at this head

Private databases `pr315_opus_test` and `pr315_opus_probe_test` on td-lane-pg, both dropped afterwards.

- API unit (`vitest.config.ts`): **53 files, 375 tests, all passed.** The PR body's 372 predates
  the `main` merge, which brought in #302's boot tests.
- Integration (`vitest.integration.config.ts`, full suite): **75 files, 1037 tests, all passed.**
- `test:permissions`: **10 files, 80 tests, all passed.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, all passed.**

## Probes

I wrote two throwaway probe files in my worktree and did not commit them:
`tests/api/permissions/resolve-identity.opus-probe.test.ts` (pure mapper plus the real evaluator,
10 cases) and `tests/api-integration/resolve-identity.opus-probe.test.ts` (real HTTP routes plus the
real loader, 8 cases). Every result quoted below was observed, not inferred.

1. **Reserved built-in names used as workspace roles, over real HTTP.** A workspace owner calls
   `POST /api/workspace/{id}/roles` with `role: "instance_admin"`, then `"customer"`, then
   `"manager"`. Each create returns **200**, because `create-workspace-role.ts:73-76` reserves
   only `"owner"`. The owner then assigns that role to an invited member with
   `PATCH …/members/{userId}/role`, which also returns **200**. `resolveIdentity` then returns:
   - `instance_admin`: a staff identity with the grant
     `{roleKey:"instance_admin", scope:"instance", scopeId:<workspaceId>, rank:1000, 5 instance:* caps}`;
   - `customer`: a **staff** identity with the grant
     `{roleKey:"customer", scope:"organisation", scopeId:<workspaceId>}`;
   - `manager`: the full built-in manager grant (57 capabilities), although the stored role's
     `permission` was only `{task:["read"]}`.

   Using the real evaluator, I checked every capability in `CAPABILITY_NAMES`. The
   instance-scope grant with a non-null `scopeId` matches nothing: `grantAppliesTo`,
   `evaluator.ts:194`, requires `scopeId === null`. `can()` is false at both instance and
   workspace scope. See S1.
2. **Escalation through minting a built-in name, over real HTTP.** The owner creates a custom
   role `roles-clerk` with `{ac:["create","read"], member:["update"], task:["read"]}` and assigns
   it to user X. X creates a role named `"manager"` with only `{task:["read"]}` (200), then assigns
   `"manager"` to themselves (200). `resolveIdentity(X)` returns the built-in manager grant with
   **57 capabilities**, which is far more than X's statements ever held. See S2.
3. **`sees_all` scope.** A pure-mapper membership in `ws-A` with `seesAll: true` gives
   `reach: {kind:"all"}`. `reaches()` is then true for a project in `ws-B` of a different
   organisation. See S3.
4. **Key credential with the `ApiKeyFact` omitted.** With `credential: "api_key"` and no
   `apiKey`, the identity is **non-null** and `keyCapabilities` is `[]`. `can()` is false for
   every capability at workspace scope. `evaluatePolicy` on a kind-2 (self) policy returns
   `{allowed:true}`, because self policies never consult `keyCapabilities`. See S4.
5. **Key clamp across both key kinds, on an instance-admin owner.** Both `api_key` and
   `mcp_key` were tested, each on an owner of `ws-1` who is also an instance admin. `can()` is
   false for **every** capability at workspace scope and at instance scope. `reach` stays
   `all`. `enabled:false` returns `null` for `mcp_key` too.
6. **Customer holding a key.** The fixture was `side:"customer"`, `credential:"api_key"`, plus
   workspace rows, teams, `seesAll:true` and `isInstanceAdmin:true`, all as noise. Memberships
   and teams come back `[]`, reach is `organisation:[own org]`, and authority is exactly
   `["customer"]`. The instance-admin bit is dropped. A kind-3 (portal) policy returns
   `{allowed:true}` despite `keyCapabilities: []`. See S6.
7. **Prototype and malformed role values.** `constructor`, `__proto__`, `toString`,
   `hasOwnProperty`, `Owner`, `" owner"` and `"owner,admin"` are all skipped: no membership and
   no grant. Duplicate rows for one pair are refused, both when identical (`admin`, `admin`) and
   when conflicting (`owner`, `viewer`).
8. **Team rows after leaving a workspace, over real HTTP.** A member is in the workspace's team
   and then calls `POST …/leave` (200). `resolveIdentity` returns `memberships: []`, but
   `teamIds` **still contains** the left workspace's team. See S5.
9. **Person lifecycle.** A user who signs up after boot resolves to `null` until
   `seedInternalOrganisationAndStaffPersons` runs again, which is the next boot. After that
   seed, a `banned: true` user and a user row with `isAnonymous: true` **both** resolve to a
   staff identity. A customer person in an organisation with `active:false`,
   `portal_access:false` and `deleted_at` set still resolves to a customer identity with the
   `customer` grant. See S6 and S7.
10. **Owner resolution for keys.** `authenticate-api-request.ts:69,86` sets `userId` from
    `verifyApiKey`'s `key.referenceId ?? key.userId`, which comes from the key row and not from
    the caller. `verify-api-key.ts:204-217` admits only `enabled = true` rows with a null or
    future `expires_at`. A revoked or deleted key has no row, so the request gets 401 before any
    identity exists. A deactivated owner returns `null` from the adapter (the PR's own tests,
    and I re-checked `resolve-identity.ts:217`).
11. **Side and portal derivation.** `side` comes only from `person.side`, read by `user_id`.
    `person_user_unique` guarantees at most one row per user. Neither `resolveIdentityFromFacts`
    nor `resolveIdentity` takes a header, host, query parameter or session field, so a caller
    cannot influence `side`. `portal` is derived from `side`, so a staff person always gets
    `agent` and fails every kind-3 policy. An unknown `side` value returns `null`
    (`resolve-identity.ts:377-383`).
12. **Loader injection.** All three queries filter with drizzle `eq()` on bound parameters, and
    there is no raw SQL. The `user ⋈ person` left join with `.limit(1)` is deterministic,
    because `user.id` is the primary key and `person_user_unique` holds.

## Findings

**S1 — BLOCKING. The adapter turns a workspace role row into an `instance_admin` or `customer`
grant.** At `resolve-identity.ts:190-192` and `268-286`, `isBuiltInRoleKey` accepts **every**
key of `BUILT_IN_ROLES`, including `instance_admin` (scope `instance`) and `customer` (scope
`organisation`). Lines 280-286 then copy `builtIn.scope` but set `scopeId: workspaceId`. Probe 1
shows that a workspace owner can produce either row over real HTTP.

The output breaks three things this adapter exists to guarantee:
- `identity.ts:71`: an instance-scope grant carries `scopeId: null`.
- rbac.md § Roles: "`instance:admin` is not grantable through workspace roles at all".
- rbac.md § The customer role / `identity.ts:16`: a customer is never staff. Here a staff
  identity carries the `customer` grant.

Today the evaluator neutralises both grants (`grantAppliesTo`), so I found **no exploitable
path**. But this is the one place allowed to build a `ResolvedIdentity`, and every future
consumer trusts it. Examples are Slice 2's shadow diff, a rank comparison (rbac.md's rank
guardrails; `rank: 1000` is attached here), and any `roleKey === "instance_admin"` check. The
output should not depend on a downstream defence to stay safe.

Fix: accept only built-ins whose `scope === "workspace"`, for example
`isBuiltInRoleKey(r) && BUILT_IN_ROLES[r].scope === "workspace"`. Add a unit test for
`instance_admin` and one for `customer` as `workspace_member.role`, each asserting that the
workspace is skipped.

**S2 — NON-BLOCKING for this inert slice; BLOCKING before any cut-over from shadow to
enforcement. A custom role that takes a built-in name gets that built-in's full
capabilities.** The adapter assumes that a `workspace_member.role` string equal to a
`BUILT_IN_ROLES` key *is* that built-in role (`resolve-identity.ts:46-49`, `268-273`). In the
legacy `workspace_role` shape the name is the key. `create-workspace-role.ts` reserves only
`"owner"`, so `manager` and `lead` can be created freely. `admin`, `member` and `viewer` can be
created too, once the seeded row is deleted while unassigned. Probe 2 shows the escalation: a
holder of a custom role with `ac:create` and `member:update` mints `"manager"` and
self-assigns it. The adapter then grants 57 capabilities that the actor never held. That breaks
rbac.md's "You cannot grant a capability you do not hold" and its rank guardrail.

The same name-to-built-in mapping already exists in legacy `builtInRoleHasCapability`
(`require-workspace-capability.ts:194-196`). Today it is reached by `work_item:set_priority`
(`work-item/index.ts:283`) and `transfer-ownership`. So the class is **pre-existing**, but this
adapter would extend it to every route. Rows minted during the mixed legacy/adapter period also
persist after cut-over.

Needed before enforcement, outside this PR's file set:
- reserve every `BUILT_IN_ROLE_KEYS` name in create and rename (`create-workspace-role.ts`,
  `update-workspace-role.ts`);
- stop deletion and recreation of the seeded default names;
- audit existing `workspace_role` rows whose names collide with a built-in whose seeded
  permission set they do not match.

**S3 — NON-BLOCKING, must be settled before the `seesAll: false` literal becomes a real read.
`sees_all` becomes global reach.** At `resolve-identity.ts:299-303`, a `sees_all` flag on *any*
workspace membership yields `reach: {kind:"all"}`, which covers every workspace and every
organisation (probe 3). rbac.md § Reach step 2 says "sees_all grant on their **workspace**
membership", and multi-tenancy.md frames it as a workspace-membership flag for triage roles.

The shared `Reach` type (`identity.ts:90-93`) cannot express a workspace-scoped `sees_all`, and
`reaches()` (`evaluator.ts:348-351`) expects the flag folded into `all`. So the adapter matches
today's contract, but that contract may itself be wider than the spec. The file comment says
"the day a write path exists this file needs no change beyond that one literal"
(`resolve-identity.ts:78-81`). That claim is unsafe: flipping the literal would give a
single-workspace triage grant instance-wide reach. This needs a shared-contract decision (for
example `reach.kind: "workspaces", ids`) or an explicit decision-log entry that `sees_all` is
instance-wide.

**S4 — NON-BLOCKING, fix before Slice 2 wires the loader. The key facts are optional and not
bound to the key's owner.**
- `resolve-identity.ts:222` refuses only when `apiKey?.enabled === false`. For a key
  credential with `apiKey` omitted, the adapter returns a non-null identity (probe 4). That
  identity is not inert: kind-2 (self) and kind-3 (portal) policies never consult
  `keyCapabilities` (`evaluator.ts:954-1023`).
- `ResolveIdentityInput` (`resolve-identity.ts:326-332`) takes `userId`, `credential` and
  `apiKey` as three independent caller-supplied values. `ApiKeyFact` has no owner id, so the
  loader cannot check that the key belongs to `userId`, and `credential` is trusted as given.

Today's only real source (`authenticate-api-request.ts`) derives both from the key row, and
`verifyApiKey` has already enforced `enabled` and expiry, so nothing is wrong yet. Recommended
changes:
- make `apiKey` required for key credentials, for example with a discriminated union;
- refuse when `apiKey` is absent, using `enabled !== true` as the test;
- carry `ownerUserId` on `ApiKeyFact` and refuse on a mismatch with `userId`.

**S5 — NON-BLOCKING, fix before `project.owner_team_id` exists. `teamIds` is not tied to
current membership.** At `resolve-identity.ts:400-403` and `415`, every `team_member` row for
the user is loaded, across every workspace. `remove-workspace-member.ts` and `leave-workspace.ts`
delete only `workspace_member` rows, so a removed member keeps the team (probe 8). Reach step 5
has no data source yet (no `owner_team_id` column), so this is inert today. Once that column
exists, a removed member would keep reach to projects their old team owns. rbac.md § MCP says
"membership removal … take[s] effect on the next call".

Fix: join `team` and keep only teams whose `workspace_id` is among the resolved memberships.
That is still three queries. Alternatively, delete `team_member` rows on removal.

**S6 — NON-BLOCKING, before customer persons or keys for them exist. Some fail-closed inputs
are not read.** The adapter does not read:
- `organisation.active`, `organisation.portal_access` or `organisation.deleted_at` (probe 9).
  god-mode.md § Organisation suspended and multi-tenancy.md § Portal access both expect these
  to cut access;
- `user.banned` (probe 9). Legacy is the same, since better-auth bans sessions but
  `verifyApiKey` ignores bans;
- key credentials on the customer side (probe 6). auth-and-identity.md says customers may
  never hold keys, and a customer identity on `api_key` passes portal policies.

Each is a cheap refusal on data the loader's first query already joins or could join.

**S7 — NON-BLOCKING, factual. The PR body and the file comment misstate the anonymous and
provisioning facts.**
- At this head the `anonymous()` plugin is **removed** (`auth.ts:213-216`), `cookieCache` is
  **disabled** (`auth.ts:303-305`), and account linking is disabled (`auth.ts:169-182`). The PR
  body says the first two are enabled.
- "Anonymous resolves to `null` because it has no person row" is also not true in general.
  `seedInternalOrganisationAndStaffPersons` runs on **every boot** (`index.ts:1016`) and creates
  a staff `person` for every `user` row, anonymous or banned included (probe 9). The adapter
  never checks `user.isAnonymous`.
- The same fact has an availability side: a user who signs up after boot resolves to `null`
  until the next restart (probe 9), so under enforcement every new user would be locked out
  until the next boot.

Recommendations: refuse `isAnonymous = true` in the first query, and provision `person` at
sign-up before any cut-over. Neither is a present security hole, since the anonymous plugin is
gone and new users fail closed.

**S8 — Informational. The instance-admin disagreement (PR disagreement 4).** The adapter follows
rbac.md: reach `all` plus `instance:*` only. Under `can()` an instance admin holds **no**
workspace capability in a workspace where they have no role. Once a router is cut over, every
admin workflow that relies on `require-workspace-permission.ts:96,199` or
`require-workspace-role-authority.ts:57` will return **403**. Because reach is `all`, it will be
403 rather than 404. Examples are managing members, roles or settings in a workspace the admin
does not belong to.

In security terms, the adapter can only narrow. The wider side is the legacy bypass, and it is
wider than the PR says. `is-instance-admin.ts:8-21` falls back to a database read when
`c.get("user")` is null, which is the API-key path. So today an admin's **API key** bypasses
every `requireWorkspacePermission` check, unclamped. That is pre-existing and not introduced
here, but Slice 2's shadow log should expect it and classify it. Per the decision log's #8
runtime rules there is no exception to carve out. I raise it only so the break is anticipated.

**S9 — Informational, for Slice 2. The loader's reads are not one snapshot.** The loader issues
three separate autocommit statements under READ COMMITTED (`resolve-identity.ts:347-403`), so
person state, memberships and teams can come from different instants. I found no ordering that
yields authority the user never held at some instant, apart from races with the writer
itself. Still:
- The shadow comparison will compare the adapter's snapshot with legacy middleware reads taken
  at other moments. Rare diffs during concurrent roster writes are race noise and should be
  labelled as such, not read as defects.
- Recommended: run the loader inside one `REPEATABLE READ READ ONLY` transaction. The
  `executor` parameter already allows it.
- The identity must never replace the locked, in-transaction re-reads in
  `transfer-workspace-ownership.ts`, `remove-workspace-member.ts` and `leave-workspace.ts`.

**S10 — Informational. `mcp_key` versus `api_key` (disagreement 2) never produces more
authority.** Both kinds are in `KEY_CREDENTIAL_KINDS` and are clamped identically:
- `can()` at `evaluator.ts:295-318`: absent means deny, and `[]` expands to the empty set, so
  **every** capability policy denies;
- `sessionOnly` at `evaluator.ts:929-938` refuses both.

The only difference is the diagnostic `source` label. One correction to the PR's wording: `[]`
does not mean "no extras". For capability policies it means **no capability at all**, whatever
the owner's RBAC (probe 5). It does not clamp kind-2 or kind-3 policies (see S4 and S6).

## Verdict

**CHANGES NEEDED**, for S1 only. It is an in-file, one-condition fix plus two unit tests. S1 is
not exploitable through today's evaluator. It is blocking because the adapter's output breaks
`identity.ts`'s documented invariant and rbac.md's "not grantable through workspace roles", on
input that a workspace owner can create over real HTTP.

Everything else I probed holds:
- fail-closed on a missing or deactivated person;
- disabled keys refused;
- the key clamp never widened, for either key kind;
- a customer never gains agent roles, workspace memberships, teams or instance authority;
- `side` and `portal` cannot be influenced by the caller;
- duplicate and malformed role rows refused;
- queries parameterised, with a fixed query count.

S2 must be closed before any router moves from shadow to enforcement. S3, S4, S5 and S7's
provisioning gap must be closed before Slice 2 relies on the loader for those inputs. A follow-up
SHA that changes only S1's guard and adds its tests needs a narrow delta re-check, not a full
re-review.
