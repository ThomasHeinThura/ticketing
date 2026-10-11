# S1 identity slice — review record

**Reviewed head:** `512a6d851f4144395e2fb16f7914c84ad12a8ba8`

## Scope

S1 reconstructs the existing identity work from the #589 train (absorbing #595 and #596) onto accepted main by path ownership: external identity, identity connections, membership grants, SCIM, the portal identity boundary, OIDC mapping admin and login reconciliation.

Review-driven fixes:

- JIT first login repaired;
- guard and boundary regression tests;
- an owner-gated grant-projection repair for databases already at 0119;
- owner decision "SCIM link-and-activate" (decision log 2026-10-10);
- one shared IdP role predicate;
- JIT policy transitions retire grants;
- an honest implementation-status section listing the held gaps.

## Contexts

- **Implementation:** Claude Sonnet `a39fdb2c762dc3e20`.
- **Ordinary panel:** three Claude Sonnet contexts (A, B, C).
- **Security review:** Claude Opus 5.5 `added0c8ee37c9e11`, Sol tier. It is not a GPT-6 Sol review.
- **Rebase:** onto main `b704f707`; range-diff all `=`.

Reports written to files are inserted unmodified. Closure replies are extracted mechanically from the reviewer transcripts. Each carries its SHA-256.

<!-- BEGIN REPORT (agent a9424a8852915c142; model claude-sonnet-5-5; role ordinary A (port fidelity); candidate abe28aaf00a0fc8e7ae85e11af5ebe779a5d7065; sha256 d9db5f2e7a0d811e3fdcf8b0d24096440a240d39da2f13b4041f6b374bd48427) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: s1-review-a-sonnet (fresh independent context; did not author, direct or remediate; read-only, static, no Docker)
Candidate SHA: abe28aaf00a0fc8e7ae85e11af5ebe779a5d7065 (worktree /private/tmp/claude-501/s1, branch claude/s1-identity, 4 commits on main 24a48912)
Source train: #589 head 2350397b18f83ed417bf63d73970daacdbaae49c (merge-base with main: 3096cb04)
Focus: port fidelity and scope
Verdict: CHANGES REQUESTED (1 small BLOCKING documentation inconsistency; everything else clears)

## Summary

The port is faithful and the scope is clean. 82 of the 103 changed files are byte-identical to #589. The other 21 differ only by stripped non-S1 content or by preserving newer main content, and I explained every hunk. No S2/S3/S6/web/D5 code leaked in and nothing S1 needs is missing. One authority doc (data-model.md `outbox`) contradicts the S1 code and was not carried from #589.

## Method

- Classified every changed file (`git diff --name-status 24a48912 HEAD`) against `git diff 2350397b HEAD -- <file>`. 82 files are SAME. 21 DIFF.
- Found the files where main changed after the merge-base 3096cb04 and HEAD also touches them. There are exactly 7: `apps/api/package.json`, `apps/api/src/index.ts`, `apps/api/src/instance/observability/runtime.ts`, `docs/01-architecture/data-model.md`, `docs/01-architecture/rbac.md`, `tests/api-contract/openapi.json`, `tests/api/two-entry-host.test.ts`. I diffed each three ways (main, HEAD, 589).
- Ran these checks:
  - `tsc --noEmit` on apps/api `tsconfig.json`, `tsconfig.tests.json`, packages/domain and packages/libs: all clean, so no dangling imports.
  - `check:events`, `check:env`, `check:policy`, `check:vocabulary`, `check:inventory` and `check:reviews`: all pass.
  - Domain identity vitest: 7 files, 95 tests pass.
  - `vitest.permissions.config.ts`: 14 files, 88 tests pass (route coverage and matrix fixture).
- Not run: Postgres/integration tests, web, and `check:openapi`. The openapi export could not run because tsx cannot open its IPC socket in this sandbox (EPERM), so I verified the committed `openapi.json` structurally (see 4).

## 1. "Taken whole" files

82 files are identical to 2350397b. They include:

- all new `identity/*`
- `auth.ts`, `auth/configuration-version.ts`, `events/outbox.ts`
- the `ws/*` control-message changes
- `observability/metrics.ts`
- `require-instance-admin.ts`, `authenticate-api-request.ts`
- `packages/domain/src/identity/*`
- `packages/libs/src/identity-provisioning.ts`
- the 595/596 notes and the p3 docs
- most S1 tests

Main did not change any of these after the merge-base, so taking #589's version loses no newer main content.

## 2. Shared-file hunks (each diffed three ways)

- `apps/api/src/index.ts` — OK. The diff against main is S1 only: SCIM mount and OpenAPI merge, portal host allowlist (`matchesPortalPolicyRoute`, `isCustomerAuthEndpoint`), `hasCustomerPortalIdentity` 401, the three admin routers, `startAuthConfigRuntime`/`stopAuthConfigRuntime`, and the `migrateWithMembershipProvenanceCutover` migration step. Main's newer code is preserved: `ensurePolicyRequestId`/`strictPolicyWitness`, `publicOriginForKind`/`appPublicOrigin`, `capabilityCredential`, the plain `catch` in `enforceLocalFactorEnrollment`, and the inline project-reach query. #589's approval/sla/calendar/view/users routers and `findProjectWorkspaceUnderReach` are correctly absent.
- `policy-registry.ts` — OK. Only the 15 `delegated: "scim"` entries were added. #589's approval, service-calendar, sla-policy and view policy sources are not imported.
- `instance/policy.ts` — OK. Adds 13 identity/SCIM/OIDC policies. #589's `/api/instance/users*` (S6) entries are not ported.
- `step-up-api.ts`, `step-up-service.ts`, `step-up-audit.ts` — OK. All additions are for scim, oidc-mapping and identity-connection operations. The only removals from main are inline queries moved to `auth/repository.ts`, which is a pure refactor. `instance_admin_grant` and `appendPendingActionStepUpAudit` (S3/S6) are correctly absent. The new operation keys match the main schema CHECK (`schema.ts:5290`).
- `database/index.ts`, `relations.ts` — OK. Adds only the identity, SCIM, membership_grant and plugin-config tables and relations. The `savedView`, `sla*`, `userPreference` and flag tables are absent.
- `instance/observability/runtime.ts` — OK. Adds only `recordAuthReload`. Main's newer P0 code (`routeSourceEntries`, `requestId`, `strictPolicyWitness`) is preserved. #589's older version of this file was correctly NOT ported.
- `apps/api/package.json` — OK. `db:migrate` becomes `tsx scripts/migrate.ts` (the file is added) and `db:identity-provenance-preflight` is added. Main's MCP SDK bump is preserved. The only difference from 589 is key order.
- `domain/src/index.ts` — OK. Adds only the identity star-exports. The approvals and holiday-import exports are absent.
- `libs/src/index.ts`, `permissions/*` — OK. The `taskdesk-identity-oidc` plugin entry and `ALL /scim/v2/*` middleware key match the updated tests. `features.ts` and its exports (S-other) are not ported.
- `tests/api/two-entry-host.test.ts` — OK. The test removes #589's `/api/portal/approvals` case (S2) and keeps main's `spoofedHost` case.

## 3. Exclusions

- The 768 files in 589 but not in HEAD are web, e2e, i18n, approvals/sla/calendar/views/flags, pending-action, instance users, and CI/policy docs.
- The three drizzle files in that set are 0119 and the journal, which exist on main; #589's own journal/snapshots are not ported. S1 adds no migrations.
- Grep found no `approval`/`sla`/`view`/`serviceCalendar`/feature-flag/instance-users references in S1 code. The only `pendingAction` hit is a pre-existing `pendingActionId: null` in `step-up-service.ts`.
- tsc is clean, so nothing S1 imports is missing. All 13 instance policies and 15 SCIM routes are registered, and the added fixture and OpenAPI path counts match.

## 4. Generated artifacts

- `tests/permissions/matrix.fixture.json`: 186 routes on main, 214 at HEAD. Exactly 28 added (13 instance identity routes, 15 `/scim/v2`). Zero removed, zero changed. `capabilities` is identical. All 28 rows equal #589's rows.
- `tests/api-contract/openapi.json`: only additions.
  - 17 new paths: 10 `/instance/identity-connections*` and `/instance/organisations/{id}/identity` paths (13 operations) and 7 `/scim/v2/*`.
  - The `scimBearerAuth` security scheme.
  - The `/me/step-up` and `/me/step-up/challenges` `anyOf`/`oneOf` grow from 6 to 27 and from 2 to 9. Main's entries are an exact prefix, so none were altered.
  - Added 404, 409 and 422 responses on those two routes.
  - No existing path or component schema changed.
- Residual: I could not regenerate the export. #589's `retainStepUpChallengeOneOf`/`openapi-union.ts` is correctly not ported, because main has no such file.

## 5. Docs

- Authority homes: events (`identity.deprovisioned`, instance scope) are in events.md. `check:events` and `check:vocabulary` pass. The `delegated: 'scim'` policy kind is in rbac.md:538. The metrics are in observability.md. The `taskdesk-identity-oidc` plugin is in auth-and-identity.md:106. The new columns and tables already exist in main schema/migrations, so no new authority row is needed. The env vars used are all previously registered (`check:env` passes).
- Markdown links in the changed docs resolve. The one broken link is `data-model.md` `../../03-features/workflows.md`, which is also broken on main.
- Main's newer docs text is preserved: the data-model 0119 composite-FK text and rbac's 16 added lines.
- The 595/596 review notes and the p3-identity handoff are byte-identical to #589 (see N2).

## Findings

### BLOCKING

B1. `docs/01-architecture/data-model.md:472` says `outbox.workspace_id` is **not null**. The S1 code and docs say the opposite:

- `apps/api/src/events/outbox.ts` (the `instanceScopedKeys` branch) enqueues a null workspace for `identity.deprovisioned` and `pending_action.*`, and `eventScope()` returns `{}`.
- `identity/scim-lifecycle.ts:86-89` emits `identity.deprovisioned` with that scope.
- `schema.ts:1324` has `workspace_id` nullable, and `schema.ts:1353` has the CHECK allowing null for those kinds.
- `events.md:44-49` (added by this slice) documents instance-scoped envelopes.

#589's data-model row said "nullable only for the instance-scoped … events". The conflict resolution kept main's older sentence together with its 0119 text (`outbox_event_id_workspace_id_unique`, the `notification_delivery` composite FK). Fix: restore #589's nullable wording and keep main's 0119 composite-FK sentences.

### NON-BLOCKING

N1. `data-model.md:91` lists `instance_admin_grant` among the step-up operations, but this slice has no code for it (`StepUpOperation` in `step-up-audit.ts` omits it and there is no grant-admin policy). That code belongs to S6. The DB CHECK already permits the key (main migration 0108), so the doc is accurate about the schema but ahead of the code. Consider trimming it, or add "implemented in S6".

N2. `security-reviews/595-oidc-mapping-role-capabilities.md`, `596-oidc-login-grant-reconciliation.md`, `p3-identity-owning-findings-handoff.md` and the 544 addendum are verbatim copies. They carry `**Reviewed head:**` lines for heads that are not ancestors of this branch (595: 5b3a3377…; 596: b78a0ff4…, bc03f460…, b7c90c87…), and none has a banner saying "historical record of the #595/#596 train, not a review of abe28aaf".

- The CI gate reads only the note linked from the PR body, so the gate should be unaffected.
- agent-workflow.md says historical notes are append-only and must not be rewritten, so do not edit the copies.
- Put the "historical, not reviews of this candidate" statement in the PR body or a new `<this-pr>-s1-*.md` note.
- No current review note exists for this candidate.
- `p3-identity-owning-findings-handoff.md` cites private paths under `/Users/heinthura/.codex/...`. Check that this is intended.

N3. Consumers outside the slice:

- `PersonLifecycleCaller { kind: "administrative" }` (`identity/repository.ts`, around line 2190) and the `person_deactivated` reason have no caller in this slice. Their only consumer was #589's `pending-action/repository.ts` (S3/S6).
- The events.md and data-model text about "person deactivation approval lifecycle" likewise describes S3 behavior.
- `packages/libs/src/identity-provisioning.ts` and its `libs/index.ts` exports have no consumer, because the web UI is excluded.

All are harmless and tsc-clean. Decide whether to keep them or defer them to the consuming slice.

N4. Trivial: the `package.json` key order differs from #589 (the preflight script sits before `db:studio`). The broken `workflows.md` link in `data-model.md` exists on main too.

## Not verified

- `check:openapi` regeneration (sandbox EPERM on the tsx IPC socket).
- All Postgres and integration suites, web, hosted CI, and image boot.
- `auth.ts` is a whole-file rewrite identical to #589. I verified identity with 589 and tsc cleanliness but did not review its logic, which is outside the fidelity and scope focus.
<!-- END REPORT a9424a8852915c142 abe28aaf -->

<!-- BEGIN REPORT (agent a9424a8852915c142; model claude-sonnet-5-5; role ordinary A closure (from transcript); candidate 74718d6c9a367fe0426283dfe23a34ea540388f9; sha256 00ac890b229c2c8d2f6172cdaaf17a08e48a3f19b5c088b9fabb08a90a89fc93) -->
Reviewed head: 74718d6c9a367fe0426283dfe23a34ea540388f9
Label: Claude Sonnet (claude-sonnet-5-5), independent ordinary reviewer A, port fidelity and scope. Static only; no integration or Postgres tests were run.
Verdict: CLEAR on both checks, with no blocking findings.

**(1) B1 is closed.**
- `data-model.md:472` now says `outbox.workspace_id` is nullable only for `pending_action.requested`, `pending_action.decided`, `pending_action.executed` and `identity.deprovisioned`.
- The 0119 text is kept: `outbox_event_id_workspace_id_unique` is the parent key, and the `notification_delivery` composite FK is unchanged.
- The wording now matches `events/outbox.ts`, `scim-lifecycle.ts`, the schema CHECK and `events.md`.

**(2) The delta stays in S1.**
- The delta is 14 files:
  - `migrate-membership-provenance.ts` (provenance migration runner) and the preflight script;
  - `oidc-login.ts`;
  - five new or extended identity and membership tests;
  - five docs: ADR 0015, `identity-provisioning.md`, `runbook.md`, `decision-log.md`, `data-model.md`.
- Nothing from approvals, SLA, calendars, views, instance users or pending-action was added.
- The only "approval" hits are the owner-reconciliation `approval.approverPersonId` field in the migration runner and its test.
- `tsc --noEmit` on the api sources and the api test config is clean.
- `check:policy` and `check:reviews` pass.

**Docs and identifiers are consistent.**
- **IP-19/IP-30.** The `identity-provisioning.md` text matches the `oidc-login.ts` first-login link-and-activate branch:
  - it matches on connection, issuer and subject only;
  - an address owned by another user refuses;
  - the user, account and person are linked and `is_placeholder` is cleared.
  - Inactive identities are refused. I did not trace that refusal in the code.
  - IP-30 still forbids claiming an import placeholder by address on the SSO path.
- **Decision log.** The entry is new at the top, an append with no edits to older entries. It states the same scope and names IP-19 and IP-30.
- **Runbook.**
  - The heading anchor matches the ADR link.
  - The refusal text ("incomplete grant projection") and the `--membership-provenance-reconciliation` flag match `migrate-membership-provenance.ts` lines 38 and 508.
  - `db:identity-provenance-preflight` and `db:migrate` exist in `package.json`.
  - The preflight now lists only unprojected memberships once the grant table exists, as the runbook says.
- **ADR 0015.** The "repair of a database already past the cutover" paragraph matches the runner and the runbook procedure.

**Non-blocking.** `identityAccountId()` replaces the NUL-separated `accountId`, and the code comment says no earlier row used the old format. I did not check that against stored data.
<!-- END REPORT a9424a8852915c142 74718d6c -->

<!-- BEGIN REPORT (agent a572cc58295c2ee46; model claude-sonnet-5-5; role ordinary B (runtime/tests); candidate abe28aaf00a0fc8e7ae85e11af5ebe779a5d7065; sha256 669905e8b7cabf9b74b78b0628339dc7baf93c586df09c8b2a58534744040d90) -->
# S1 identity: independent ordinary review B (runtime correctness and test adequacy)

- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), Luna-tier ordinary reviewer B. Fresh context; I did not author, direct or remediate the change. Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (reviewer B subagent of that session).
- Reviewed head: **abe28aaf00a0fc8e7ae85e11af5ebe779a5d7065** (export `/private/tmp/claude-501/s1`, clean tree), comparison base 24a48912, 103 files, +32679/-1567.
- Verdict: **APPROVE WITH NON-BLOCKING FINDINGS** (no blocking defect found; 6 findings, F1 and F2 should be triaged by the orchestrator before merge).

## 1. Commands and counts (all on the export, Postgres 18 in `s1-review-b-pg`)

| Check | Result |
|---|---|
| `tsc --noEmit` on all four configs (`npm run typecheck` in apps/api) | exit 0 |
| API unit (`vitest.config.ts`) | 96 files / 707 tests pass |
| `test:permissions` (`vitest.permissions.config.ts`) | 14 files / 88 tests pass |
| `check:route-policy` (turbo, 5 tasks) | pass (permissions suite 14 / 88) |
| `check:openapi` | pass, 208 operations match |
| `check:events` | pass, 31 event keys over 447 files, all registered |
| S1 integration files (identity-connection-admin, scim-admin, identity/oidc-group-mapping-admin, membership-provenance-cutover, boot-orchestration-success, node-server-websocket, helpers) | 8 files / 49 tests pass |
| Full integration suite, private `s1b_full_test` DB | **144 files / 1705 tests pass**, 870 s |

## 2. Identity behaviours covered end to end (and negative-test inventory)

Covered with real DB assertions:
- OIDC login reconciliation (identity-connection-admin "reconciles only the linked identity's..."): adds/retires oidc_group and jit_default grants, reasons claim_removed, claim_missing, claim_overage, admission_failed, mapping_changed; direct grants untouched; other-connection grant untouched (line ~1019-1106); session tagged with exact source connection, also through pending-2FA.
- SCIM: provisioning, PATCH/PUT, username filter, group CRUD, duplicate 409, deprovision with end_memberships vs keep_memberships (dormant then reprojected), session/key revocation, token rotation/revocation with PA-15 proof replay (403), stale version (409), cross-operation proof (403).
- Negative cases present: SCIM bad bearer shapes 401, cookie-only 401, disabled SCIM 401, disabled connection 401, group resource not allowed 403, foreign-connection user 404 (scim-admin ~885-942), portal probe on SCIM mount 404, non-admin on `/events` 403, API-key and impersonation refused on OIDC mapping routes (403), foreign mapping id 404, source-only disable cascade does not touch local/other-connection sessions.
- Portal boundary: host-selected tree, portal allowlist (404 for admin/sign-up/magic-link on portal host), copied agent session on portal host 401.

Gaps (tests that do not exist):
- No integration test of customer-portal OIDC login reconciliation or SCIM on a `portalScope: "customer"` connection (identity-connection-admin and scim-admin only use `agent`; only oidc-group-mapping-admin has a customer connection). The organisation binding in oidc-login/scim authority is therefore untested at runtime.
- No cross-organisation (tenant A admin/connection vs tenant B) test of OIDC login or SCIM; "cross-connection" is covered only for SCIM reads and session/grant retirement.
- Old/rotated and revoked SCIM bearer is never replayed against `/scim/v2/*`; revoke is asserted only as `tokenHash: null` in the DB.
- Revocation reasons mapping_disabled, role_deleted, scim_group_removed are never asserted anywhere in the test tree.
- Non-admin 403 is tested only for `/events`; not for the connection list, `/organisations/{id}/identity` (see F3).
- The `hasCustomerPortalIdentity` check (portal session with no customer identity) has no direct test (see F4).

## 3. Provenance migration (runtime, on real Postgres)

Findings are from my own scripts (`scratchpad/b/prov.ts`, `pre.ts`) with the migration pool at `max: 2`.
- Fresh DB: orchestrator runs 0000..0119 (120 journal rows), then a second invocation is a no-op. Idempotent, no hang at pool max 2.
- Pre-cutover DB (migrated to 0089, one legacy membership seeded):
  - `preflight-membership-provenance.ts` writes a 0600 report, prints counts, exit 2 when any row is unresolved.
  - `scripts/migrate.ts` (run via `runMigrationStep` with env set) without a reconciliation file exits 1; schema untouched (`membership_grant` absent, 90 migration rows). The cutover is atomic as advertised.
  - Note: `scripts/migrate.ts` imports `src/index.ts`, which runs `createApp()` at import time, so the migrate job needs `TASKDESK_AGENT_URL` and `TASKDESK_PORTAL_URL` with distinct hostnames. This is pre-existing and compose passes both.
- Max 1 to 2 change: safe and necessary. The advisory-lock client holds one connection; Drizzle's `dialect.migrate` and the cutover transaction each take one at a time (the cutover releases its client before the trailing `dialect.migrate`). No code path needs a third, so no deadlock. The existing cutover test uses a scratch pool with max 3, so the real max-2 configuration is not directly under test (I verified it manually, it works).
- DB already past the cutover (as any environment that ran main's #618 spine 0088-0119 with memberships): see F1.

## 4. Mutation spot checks (temp APFS clone, reverted; killed vs survived)

| # | Mutation | Result |
|---|---|---|
| M1 | scim-authentication: drop `!row.connectionEnabled` in `resolveScimBearer` | KILLED (scim-admin: expected 200 to be 401) |
| M4 | connection-admin: drop `requireCurrentInstanceAdmin` on `/events` (control) | KILLED (identity-connection-admin) |
| M3 | connection-admin: drop `requireCurrentInstanceAdmin` on `GET /api/instance/identity-connections` | **SURVIVED** unit 707, permissions 88, route-policy gate, identity integration |
| M5 | connection-admin: drop admin check on `GET /api/instance/organisations/{id}/identity` | **SURVIVED** identity integration |
| M6 | authenticate-api-request: drop `hasCustomerPortalIdentity` clause | **SURVIVED** unit 707, node-server-websocket, csrf, helpers, scim |
| M2 | index.ts auth handler: drop same clause | **SURVIVED** unit 707 and 4 integration files |
| M7 | scim-authentication: drop post-lock `portalScope`/`organisationId` recheck | **SURVIVED** (low value, a TOCTOU defence) |

M3/M5/M6/M2 survived in every test file that references those surfaces; I did not repeat the full 870 s suite per mutant.

## Findings

- **F1 (medium, upgrade path, needs orchestrator decision).** On a DB already beyond `0093` (journal `created_at >= cutoverEnd.when`), `migrate-membership-provenance.ts` fails startup with "Applied membership cutover has an incomplete grant projection" if ANY membership row lacks a matching grant. Reproduced: fully migrated DB + one membership inserted without a grant -> second run throws. Main's #618 spine already shipped 0090-0119 with no app code writing `membership_grant`, so any environment that applied the spine and has memberships will refuse to start, and the reconciliation-file path is only consulted before the cutover, so there is no documented remediation. Confirm no such environment exists (UAT status notes suggest UAT is at the pre-spine 80/87 hashes, so it would take the normal path), or document/automate a repair.
- **F2 (medium, test adequacy).** Admin-authorization checks on `GET /api/instance/identity-connections` and `GET /api/instance/organisations/{id}/identity` are not covered by any non-admin request test (M3, M5 survive; the permissions matrix does not drive live handlers). Add 403 tests for non-admin (and API-key) on both routes.
- **F3 (medium, test adequacy).** The customer-portal session identity check (`hasCustomerPortalIdentity`) in `authenticate-api-request.ts` and the `index.ts` auth handler is untested (M6, M2 survive). A `portal === "customer"` session with no admitted identity must yield 401; add a test for each call site (the `auth.ts` post-sign-in hook is covered by the websocket test).
- **F4 (low-medium, test adequacy).** No customer-portal-scope or cross-organisation tests for OIDC login reconciliation and SCIM; M7 survives. Add a customer connection test where a SCIM token/login for org A cannot read, provision or grant in org B.
- **F5 (low).** Old/rotated and revoked SCIM bearers are never replayed against `/scim/v2`; reasons mapping_disabled, role_deleted, scim_group_removed never asserted.
- **F6 (low).** The cutover test uses pool max 3 while production is max 2, and there is no test for the already-applied or idempotent re-run branch, nor the incomplete-projection branch in F1.

## Cleanup proof

- Container `s1-review-b-pg` stopped (it was `--rm`, so removed); `docker ps -a` shows no `s1-review-b*`.
- Container count: 19 at my start. It is now 20 only because another reviewer's `s1-sec-pg` exists; excluding that container it is the original 19. I touched no other container.
- Temp mutation clone `/private/tmp/claude-501/s1-mut-b`, patches and scratch logs removed; the candidate export `/private/tmp/claude-501/s1` is clean (`git status` empty, HEAD abe28aaf). My scratch scripts and the preflight report (contains only synthetic ids) remain in `scratchpad/b/`.
- No edits, commits or pushes were made.
<!-- END REPORT a572cc58295c2ee46 abe28aaf -->

<!-- BEGIN REPORT (agent a572cc58295c2ee46; model claude-sonnet-5-5; role ordinary B closure; candidate 74718d6c9a367fe0426283dfe23a34ea540388f9; sha256 af63c6abb1618f16d84234423a06a9ee07a396f7d192a98612fb5dc082150258) -->
# S1 identity: reviewer B closure check of F1-F3 and link-and-activate review

- Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), Luna-tier ordinary reviewer B, same fresh context as my first review (I did not author or direct the fixes).
- Exact head: **74718d6c9a367fe0426283dfe23a34ea540388f9** (claude/s1-identity), diff `abe28aaf..74718d6c` (14 files, +1746/-209). Clean `git archive` export; reviewed sources are unchanged by me.
- Container: one `--rm --tmpfs` Postgres 18 `s1-review-b2-pg`, stopped afterwards; `docker ps -a` = 19, no extra container left.
- **Verdict: CLEARED. F1, F2 and F3 are closed; no blocking finding in the link-and-activate code.** Two low, non-blocking test-adequacy notes below.

## Counts at 74718d6c

| Check | Result |
|---|---|
| API typecheck (4 tsconfigs) | exit 0 |
| API unit | 96 files / 707 tests pass |
| `test:permissions` | 14 files / 88 tests pass |
| `check:route-policy` | pass (5 tasks) |
| `check:openapi` | pass, 208 operations |
| `check:events` | pass, 31 keys over 447 files |
| Full integration suite (private DB) | **148 files / 1724 tests pass**, 551 s |

Versus abe28aaf (144 / 1705): +4 files (membership-projection-repair, portal-identity-boundary, identity/mapping-role-guards, identity/oidc-jit-login) and +19 tests (17 in those files, +1 identity-connection-admin, +1 scim-admin). Nothing skipped.

Note: my first attempt at unit/permissions failed only because my export lacked untracked `dist` build output and a git baseline; after supplying both (same as the first export), all pass.

## F1 closure (DB at 0119 with legacy memberships, runbook repair)

Independent repro on a DB migrated by a plain Drizzle `migrate()` to 0119 (as main's spine does), then two memberships inserted with no grants, driven through the real `scripts/preflight-membership-provenance.ts` and `scripts/migrate.ts` CLI:

| Step | Outcome |
|---|---|
| Preflight (post-grant-table mode) | lists exactly the 2 unprojected rows, 0600 report, exit 2 |
| Migrate, no file | exit 1, message now names the count and the runbook steps; 0 grants written |
| Partial file (1 of 2 rows) | refused `missing_decision`; 0 written |
| Approver not an instance admin | refused; 0 written |
| Stale row digest | refused `stale_digest`; 0 written |
| File mode 0644 | refused (private regular file required); 0 written |
| Good file | exit 0, 2 `direct`/`admin` grants (granted_by = approver) in one transaction |
| Rerun without file / with file | exit 0, still 2 grants (idempotent) |
| Preflight after repair | 0 rows, exit 0 |

Code review of the repair (`repairMembershipProjection`): same gate as the cutover (shared `approveLegacyReconciliation`), runs under the parent-first table locks, refuses a conflicting active direct grant, re-checks that nothing is left unprojected before COMMIT, and is a no-op on a fully projected DB. The `derived_from IS NULL` is never trusted. Runbook section matches the observed behaviour. F1 closed.

Residual (informational, not blocking): the startup predicate treats any membership lacking an exact active grant (same person, scope, role, sees_all) as unprojected, so a healthy post-S1 DB must always keep that invariant. The app writers appear to maintain it (projection prefers the single direct grant, else the top-rank external grant, so a matching grant always exists), but I only verified this by reading `membership-projection.ts`, not by an end-to-end app-written DB.

## F2 / F3 closure: the surviving mutants, re-run on a clone

| Mutation | Result at 74718d6c |
|---|---|
| M3 drop admin check on `GET /api/instance/identity-connections` | KILLED (new test "refuses non-administrators on the connection list and organisation identity reads", 200 vs 403) |
| M5 drop admin check on `GET /api/instance/organisations/{id}/identity` | KILLED (same test) |
| M6 drop `hasCustomerPortalIdentity` in `authenticate-api-request.ts` | KILLED (portal-identity-boundary, 200 vs 401) |
| M2 drop the same check in the `index.ts` auth handler | KILLED (portal-identity-boundary, 200 vs 401) |

The previously vacuous SCIM portal probe now sends the portal `Host` header and also asserts a portal-host SCIM write is 404 with no person created, and a new test rechecks a rotated SCIM token under the connection lock (401). F2 and F3 closed.

## Link-and-activate review (oidc-login.ts, owner decision 2026-10-10)

Read the code path in `signInAdmittedIdentity` and the 7 tests in `oidc-jit-login.test.ts`.

Correct:
- The link only fires for an `existing` identity matched by connection + issuer + subject (row locked `FOR UPDATE`, so concurrent first logins serialise), with no email or userName selection of a person.
- Inactive identity, inactive person, wrong side for the portal, or customer in another organisation are refused before any write, and the whole transaction rolls back (a later `currentPerson` re-check also holds).
- An address already owned by another user refuses; the user is created `emailVerified: false`; the account id is the new NUL-free `identityAccountId` (percent-encoded issuer and subject), also used for the JIT path, which fixes the earlier PostgreSQL NUL-rejection of the JIT first login.
- The person gets `userId` and `is_placeholder = false` in the same transaction, the identity gets `userId` afterwards, and grant reconciliation and session-after-commit ordering are unchanged. The agent-branch validator now receives a null organisation as its contract requires.
- Tests cover agent link, customer link, same subject on another connection (no link), no email-only claim of a placeholder, email-only refused with JIT disabled, deprovisioned/inactive identity not reactivated, and a customer of another organisation refused. Mutating the placeholder clear (L2) and the account subject (L6) is caught.

Gaps (low, non-blocking):
- **N1:** removing the email-owner refusal in the link path survives all 9 tests (mutant L1). Safety is still held by the `user.email` unique constraint (the insert would abort the transaction), but the intended clean 401 refusal for "address already owned by another user" has no test. Add a test where another user already owns the address.
- **N2:** removing the individual `existing.active`, `existing.personActive` and customer-organisation checks also survives, because later checks (`currentPerson` re-check, active filter in the lookup) are redundant backstops. This is defence in depth, not a gap in behaviour, but those lines are not independently pinned.

## Cleanup proof

- `s1-review-b2-pg` stopped (and removed by `--rm`); no other container touched; `docker ps -a` count 19 and the only names are the original taskdesk/synapta/wso2 sets.
- Export `/private/tmp/claude-501/s1b2`, mutation clone, mutation scripts and the full-suite log removed. Scratch repro files (synthetic ids only) remain in `scratchpad/b/`.
- No edits, commits or pushes to the repository.
<!-- END REPORT a572cc58295c2ee46 74718d6c -->

<!-- BEGIN REPORT (agent ac416c8dd980556eb; model claude-sonnet-5-5; role ordinary C (spec conformance); candidate 74718d6c9a367fe0426283dfe23a34ea540388f9; sha256 e05ae45cc80f540bf8b8a45bb94053fba2d093ec2f2111d446c70730e6fa207e) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: s1-review-c-sonnet (fresh context, session 3a9e9ce4-8409-47d4-b1be-1f1544697e70; no authoring, direction or remediation of S1)
Reviewed head: 74718d6c9a367fe0426283dfe23a34ea540388f9 (verified with `git rev-parse HEAD` in /private/tmp/claude-501/s1, branch claude/s1-identity; slice = 24a48912..HEAD, 8 commits)
Review type: ordinary reviewer C, spec conformance, static and read-only. Nothing was run, built or edited. No Docker.
Verdict: CHANGES REQUESTED. Three blocking spec contradictions, below. Do-not 13 (no IdP path to `instance:admin` or `sees_all`) HOLDS.

Paths below are relative to /private/tmp/claude-501/s1. Line numbers are from HEAD.

## 1. Do-not 13: IdP data granting instance:admin or sees_all (PASS)

- The DB CHECK `membership_grant_source_shape_check` forces `sees_all = false` for every `jit_default`, `oidc_group` and `scim_group` row, and forbids direct-grant fields on them (apps/api/src/database/schema.ts:2728-2730).
- Every external grant insert hard-codes `seesAll: false` (oidc-login.ts JIT insert; repository.ts:3050 SCIM insert).
- `projectMembershipKeys` (apps/api/src/identity/repository.ts:1988-2130) lets a direct grant alone choose the effective role. It takes `seesAll` only from the winner, which is direct whenever one exists.
- `instance:admin` is `user.role = 'admin'`. No identity code writes it. The OIDC `userTable` inserts (oidc-login.ts, link-and-activate and JIT branches) omit `role`, and SCIM never creates a `user` row.
- Mapping and role validators refuse `instance:*` capabilities:
  - `validateOidcMappingRole`: repository.ts:805-906, which also rejects `sees_all`, role keys `admin` and `owner`, and composition problems.
  - `validateScimMappingRole`: repository.ts:3082-3171.
- The OIDC group-mapping DTO is strict (oidc-group-mapping-contract.ts). Role capability corruption is TESTED (oidc-group-mapping-admin.test.ts:377).
- Residual: the SCIM validator is weaker than the OIDC one (blocking finding B3). It still cannot reach `instance:admin`, because the `instance:` prefix check is present.

## 2. Requirements table

Legend: IMPL = implemented (file:line). TESTED = test name, or NOT TESTED. NI = not implemented. OOS = out of S1 scope, with reason.

### Connections and scope

| Rule | Status | Evidence |
| --- | --- | --- |
| IP-1 scope agent/customer, org binding | IMPL | connection-contract.ts:56-92 superRefine (customer needs org, no workspace, no rank; agent has no org, needs rank); `validateConnectionReferences` connection-admin.ts:~450-490. TESTED: identity-connection-admin.test.ts "creates a disabled version-one connection..." (:1259). |
| IP-2 customer connection limited to customer people and the Customer role | IMPL | `validateOidcMappingRole`/`validateScimMappingRole` customer branch (`role.key === 'customer'`, `workspaceId === null` only on OIDC); JIT customer branch oidc-login.ts (`role.key !== 'customer'`). TESTED: mapping-role-guards.test.ts:157, :165; oidc-jit-login.test.ts:304, :591. |
| IP-3 agent: internal-org workspace only, ceiling, JIT target, ceiling-decrease transition | IMPL (ceiling decrease), PARTIAL (rest) | Workspace/internal-org check repository.ts:~840-880 and 3115-3140. Decrease retires JIT/OIDC/SCIM grants above the ceiling: connection-admin.ts:964-972 -> `retireConnectionGrantsAboveRoleRank` repository.ts:1924-1975. TESTED: identity-connection-admin.test.ts:496 (ceiling subcase at :1090-1170). JIT target and role change retirement is NOT IMPLEMENTED (B1). |
| IP-4 payload scope/role/capability/portal is `400 forbidden_attribute`, denial is a provisioning event | PARTIAL, CONTRADICTED | Refused: `FORBIDDEN_SCIM_KEYS` packages/domain/src/identity/identity.ts:275-307 (recursive, case/separator-insensitive). But the HTTP response is a generic `400 "Invalid SCIM user resource"` with no `scimType`/`forbidden_attribute` (scim-protocol.ts:~800, 1001, 1170), and no provisioning event is written for the denial (B2). TESTED: domain unit only (identity.test.ts, "forbidden"); no API-level test. |
| IP-5 only instance admin configures connections | IMPL | instance/policy.ts:12-160 (`instance:admin`); handlers re-check `isCurrentInstanceAdmin` and refuse impersonation (connection-admin.ts:~640). TESTED: identity-connection-admin.test.ts:380; oidc-group-mapping-admin.test.ts:742. |
| IP-6 create/configure elevated, session-only, PA-15 per operation, CAS, create-disabled, secret encrypted and never returned | IMPL | connection-admin.ts:~640-780 (create), 826-1015 (configure CAS `configVersion`); `consumeIdentityConnectionProof`; `encryptIdentityClientSecret` (client-secret.ts); create starts `enabled:false`. TESTED: identity-connection-admin.test.ts:1259, :1406; tests/api/identity/client-secret.test.ts. |
| IP-6 connection delete is a pending action (typed name + step-up) | NI | No DELETE route in connection-admin.ts; `pending-action/payload.ts:126` only knows the target type. The identity-connection-admin.test.ts:1644 "source-only delete cascade" test exercises a cascade, not a route. |
| IP-6 SCIM token rotate/revoke, PA-15, one version bump, old token dead | IMPL | scim-admin.ts:310-380 (routes) and handlers; instance/policy.ts:144-166. TESTED: scim-admin.test.ts "authenticates the delegated discovery mount with only its enabled connection bearer" (:679) and the CAS test (:1610). |
| IP-6 `PATCH /scim` route-wide elevated, session-only, `scim_admin_update`, strict DTO, shared parent CAS | IMPL | instance/policy.ts:133-143; scim-admin.ts:266-306. TESTED: scim-admin.test.ts:1610. |
| IP-6 `matchAttributes` / `attribute_mapping` variants | IMPL | packages/domain/src/identity/scim-match-attributes.ts, profile-mapping.ts. TESTED: domain unit tests; scim-admin.test.ts:548. |

### OIDC login

| Rule | Status | Evidence |
| --- | --- | --- |
| IP-7 PKCE S256, single-use state, nonce, exact redirect, sig/iss/aud/exp | IMPL | oidc-login.ts:278-420 (state in cookie + `verification` row; consumed in a transaction; exact redirect compare); oidc-token.ts:49-120 (RS256, kid, iss, aud, tid, nonce, exp, nbf). TESTED: tests/api/identity/oidc-token.test.ts (token floor). NOT TESTED: PKCE mismatch, replayed state, wrong-portal state, expired state (no match in tests). |
| IP-7 "any failure is audited" | PARTIAL | Protocol failures only `logTaskDesk` + `safeFailure` (oidc-login.ts:~420-480). A `provisioning_event` `auth.failed` is written only for admission failure (:646) (non-blocking N2). |
| IP-8 callback per portal origin, session carries `session.portal` | IMPL | `originForPortal` oidc-login.ts:124; host guard apps/api/src/index.ts:~540-580; session create with `{ portal }` (oidc-login.ts end). TESTED: tests/api/two-entry-host.test.ts, tests/api/auth/portal-cookie-boundary.test.ts, portal-identity-boundary.test.ts. |
| IP-9 typed-domain home-realm routing at customer login | NI / OOS | No endpoint resolves a typed email domain to a connection; only `start` by connection id (oidc-login.ts:282). Presumed portal-login-UI slice. Needs confirmation that it is outside S1. |
| IP-9 state binds connection/portal/org; callback email cannot reselect | IMPL | State row stores `connectionId`, `portal`; callback requires equality (oidc-login.ts:~385-400). Org is read from the persisted connection. |
| IP-9 post-validation domain collision is deny-only | IMPL (deny), PARTIAL (reporting) | identity.ts:~160-205 (`domain_bound_elsewhere`, ambiguity fails closed). The spec edge case wants `409` + `request.denied` + admin notification; the code returns a generic redirect failure and writes no event (N3). TESTED: domain unit only. |
| IP-10 JIT per connection, links not duplicates, `jit_default` source | IMPL | oidc-login.ts:~680-860 (JIT branch only when no identity), grant `sourceKind: 'jit_default'`. TESTED: oidc-jit-login.test.ts:296, :304, :510. "Off by default for customer when SCIM on" is not enforced anywhere; it is a default, not a guard (non-blocking N9). |
| IP-26 tenant-specific issuer; `/common` refused; `iss` and `tid` both checked | IMPL | tenantId must be a UUID (connection-contract.ts), consumer tenant GUID refused (identity.ts:238); issuer stored from the discovery document (connection-admin.ts:~700), `discovery.issuer === stored` at start/callback/enable; token iss + tid (oidc-token.ts:93-103). TESTED: oidc-token.test.ts; identity.test.ts. |
| IP-27 admission at every login (exact app role, `acct===0`), closed `jit_policy`, fail closed | IMPL | packages/domain/src/identity/jit-policy.ts:40-68; oidc-login.ts:~560-680 (existing and JIT-disabled identities included); denial retires only that identity's OIDC+JIT grants with `admission_failed`. TESTED: jit-policy.test.ts, identity-connection-admin.test.ts (admission_failed x3, acct x4). `required_entra_app_role` is checked at save by the strict schema (min 1) (connection-contract.ts:12-18). |
| IP-27 `claim_mapping` closed profile-only | IMPL | connection-contract.ts:5-10; claim-mapping.ts. TESTED: claim-mapping.test.ts. |
| IP-27 address only metadata | MOSTLY IMPL | Fixed email -> preferred_username -> upn precedence (identity.ts:~125-150). Invented strictness: an existing, admitted identity with no usable address, or `email_verified === false`, is refused at login, before admission (identity.ts:150-158), although the spec limits the address requirement to JIT person creation (N5). |
| IP-29 limited home-realm disclosure | OOS / NI | Same as IP-9 routing; no code. |

### SCIM endpoint

| Rule | Status | Evidence |
| --- | --- | --- |
| IP-11 endpoint family, `application/scim+json`, agent origin only | IMPL | scim-protocol.ts routes :213-690; `/scim/v2` mounted index.ts (hunk "scimProtocolApi"); host guard `isScimPath && selected !== 'agent'` index.ts:~545. TESTED: scim-admin.test.ts:679; tests/api/two-entry-host.test.ts. |
| IP-12 bearer per connection, hashed, shown once, rotate kills old | IMPL (rotate/revoke), NI (create) | Digest lookup scim-authentication.ts:60-97; rotate/revoke scim-admin.ts. There is no `POST /identity-connections/{id}/scim` (create SCIM child + first token): no route and no `insert(scimConnectionTable)` in apps/api/src; SCIM cannot be enabled through the API (N1). |
| IP-12 failed token is `401` + `auth.failed` event, anonymous rate class | PARTIAL | 401 IMPL (scim-protocol.ts:52-58, onError :74). No `auth.failed` event and no rate limit anywhere in identity/ (B2). TESTED: 401 only. |
| IP-13 Users CRUD, filter, pagination, Groups CRUD, discovery, no Bulk, DELETE = deactivate | IMPL | scim-protocol.ts:213-420 routes; bulk `supported:false` :1580; DELETE :1203. TESTED: scim-admin.test.ts:477, :548, :661 (discovery/pagination/filters); pagination (`startIndex` 7 hits). |
| IP-13 filter contract (single `eq`, closed list, `invalidFilter`, 503 on bad config) | IMPL | scim-protocol.ts:709-745; `parseScimUserFilter`; `effectiveScimMatchAttributes`. TESTED: scim-admin.test.ts:548; scim-match-attributes.test.ts. |
| IP-14 strict schemas, unknown/forbidden attrs, oversize rejected, per-connection rate limit | PARTIAL | Strict allow-list identity.ts:~330-345; oversize: not verified (no SCIM-specific body limit found); rate limit NI (B2). |
| IP-15 deactivation: person inactive, sessions, API keys, all external grants, direct grants by policy, preserve history, event | IMPL | scim-lifecycle.ts:34-117 via `transitionPersonLifecycleInTransaction`; sessions/keys revoked repository.ts:~2400-2440; outbox `identity.deprovisioned` + audit. TESTED: scim-admin.test.ts:153 (keep_memberships), :266. |
| IP-16 reactivation: same identity, no duplicate, no grant restore | IMPL | scim-lifecycle.ts (`user.reactivated`, no grant insert); group re-derivation by sync. TESTED: scim-admin.test.ts:153. |
| IP-17 profile PATCH/PUT only touches permitted profile fields | IMPL | scim-protocol.ts:947-1200; `mapScimProfile`; forbidden attrs refused. TESTED: scim-admin.test.ts:618, :661. |
| IP-18 no email auto-link (OIDC) | IMPL | Match is connection + issuer + subject only (`getOidcIdentityForSignIn`); `findOidcEmailOwner` refuses. TESTED: oidc-jit-login.test.ts:457, :479, :510. SCIM POST cross-connection email -> 409: `findScimCreateEmailConflict` scim-protocol.ts:~880 (same generic 409 as IP-32). NOT TESTED at API level (no `uniqueness` hit in scim-admin test). |
| IP-19 / decision log 2026-10-10 link-and-activate | IMPL | oidc-login.ts:~705-740: only for the existing active identity on the same connection+issuer+subject, creates user+account, links, clears `is_placeholder`, refuses an owned address, refuses inactive identity/person/other side/other org. TESTED: oidc-jit-login.test.ts:399, :457, :479, :541, :569, :591. |
| IP-30 SSO never claims an import placeholder by address | IMPL | Only a user-less identity with the exact subject is activated; nothing reads placeholders by address. TESTED: oidc-jit-login.test.ts:479. |
| IP-31 Entra quirks (op case, "True"/"False", enterprise ext ignored) | IMPL | identity.ts:309-314 (`readActive`), :480-483 (op), allow-list includes enterprise URN. TESTED: identity.test.ts (op case, "True"/"False"); NOT TESTED at the HTTP layer; enterprise-ext ignore has no test. |
| IP-32 same-connection duplicate -> generic 409 `uniqueness`, no id | IMPL | scim-protocol.ts:~890-935, 985, 1317-1330; unique-violation fallback. TESTED: scim-admin.test.ts:450 (groups). User POST 409 NOT TESTED at API level. |

### Groups and projection

| Rule | Status | Evidence |
| --- | --- | --- |
| IP-20 SCIM groups, allowlisted mapping, directory rows, soft removal, `scim_group_removed` | IMPL | scim-group-sync.ts; repository.ts:2480-3060 (`writeScimGroup`), `retireScimGroupGrants` :2127. TESTED: scim-admin.test.ts:477 (collection), :450. `scim_group_removed` retirement is NOT TESTED (no test references it). |
| IP-21 customer groups -> customer roles; agent <= ceiling; no admin/sees_all | IMPL | See section 1; SCIM weaker (B3). TESTED: mapping-role-guards.test.ts:143-181 (SCIM only on the customer case). |
| IP-22 single shared validity/projection and total lock order | PARTIAL | `lockScimGrantClosure`/`retryIdentityGrantClosure` repository.ts:963-1100; used by OIDC login, OIDC mapping admin, SCIM admin/protocol/lifecycle, connection admin. Not applied to JIT-policy edits, role edits, org/workspace/portal_access lifecycle, role deletion, direct-grant writers (B1). |
| IP-22 one-role projection, no union, equal-rank tie fails closed, SCIM>OIDC>JIT tie-break | IMPL | repository.ts:1988-2130; domain mirror membership-projection.ts:30-86. TESTED: membership-projection.test.ts (equal_rank x2). The DB-layer projector re-implements the domain function instead of calling it, so the tested function is not the executed one (flagged for port-fidelity reviewer A). |
| IP-22 valid_now (org active, enabled connection, enabled SCIM child with `groups`, current mapping/JIT, live target) | PARTIAL | Checked at login/sync time (`validate*MappingRole`), not at projection time; no re-validation when parents change (B1). |
| IP-23 nested groups out of scope | OOS | n/a |
| IP-28 OIDC group re-derivation each login, canonical UUID, overage/missing/malformed retire OIDC grants, JIT kept, one transaction, session after commit | IMPL | oidc-login.ts:~890-1140; domain `canonicalEntraGroupObjectId`, overage detection identity.ts:~165-195; `classifyOidcGrantRetirementReason`; session created after commit (:~1215-1264); authority invalidation after commit. TESTED: identity-connection-admin.test.ts:496 (overage x4). |
| IP-28 operator-visible Health warning on overage | NI | `oidc-login.ts` only classifies `claim_overage`; no health state write, no dedicated event (N4). |
| IP-28 opposite-source cannot re-enable | IMPL | OIDC reconcile touches only `oidc_group`/`jit_default` (`sourceKinds`); SCIM sync touches `scim_group`. TESTED: oidc-group-mapping-admin.test.ts:819 (partial). |
| IP-34 OIDC mapping admin GET/POST/PATCH, strict DTO, CAS, elevated, 404 shape, immediate retire on disable/role/target change | IMPL | oidc-group-mapping-admin.ts:108-659; instance/policy.ts:83-118; retire repository.ts:~915-960. TESTED: oidc-group-mapping-admin.test.ts:581, :819, :1026, :1094, :1182, :1253, :1346. |

### Audit and health

| Rule | Status | Evidence |
| --- | --- | --- |
| IP-24 provisioning events and audit for every change/denial; grant deltas safe | PARTIAL | Config, mapping, SCIM user/group, lifecycle, admission events exist (kinds list schema.ts:2844). Missing: SCIM `auth.failed`, `request.denied` (forbidden attribute, domain collision, rate), overage warning (B2/N3/N4). Audit failures follow the nested-savepoint exception (connection-admin.ts:525; oidc-login.ts). Provisioning event read API IMPL (`GET .../events`, connection-admin.ts:141). TESTED: identity-connection-admin.test.ts:231. |
| IP-25 plugin-health pings discovery | NI | No health job for identity connections (only `healthState` columns surfaced) (N1). |
| Edge: connection disabled revokes sessions immediately, retires only this connection's external grants | IMPL | connection-admin.ts:950-962 (retire + delete tagged sessions + SCIM child disabled). TESTED: identity-connection-admin.test.ts:1406, :1644. Spec says SCIM calls then return `403 connection_disabled`; code returns 401 at bearer resolution because the connection is disabled (scim-authentication.ts:76-82) (N6). |
| Edge: two connections for one customer org refused | IMPL | `findIdentityConnectionForOrganisation` -> 409 (connection-admin.ts:~671). TESTED: create test :1259. |
| Edge: last admin SCIM deactivation | IMPL | No special case present (correct per spec). NOT TESTED. |

### Permissions / API table

| Item | Status | Evidence |
| --- | --- | --- |
| GET list, GET events, GET org identity, POST, PATCH | IMPL | connection-admin.ts:92, 141, 231, 259, 297. TESTED: :231, :380, :1259. |
| POST `/{id}/test`, POST `/{id}/scim/test` | NI | No routes (N1). |
| POST `/{id}/scim` create | NI | See IP-12. |
| GET `/{id}/scim`, `/scim/mapping-options`, rotate, revoke, PATCH | IMPL | scim-admin.ts:162, 246, 266, 310, 351. |
| `/scim/v2/*` delegated bearer, org/portal from token | IMPL | scim-authentication.ts; middleware scim-protocol.ts:52. |
| rbac.md identity rows (connection/SCIM-token/mapping/PATCH elevated routes) | IMPL | instance/policy.ts rows match the rbac.md table (docs/01-architecture/rbac.md:806-810). Route-coverage and matrix fixtures updated (packages/permissions/src/route-coverage.ts; tests/permissions/matrix.fixture.json). |

### ADR 0015 (membership grant provenance)

| Item | Status | Evidence |
| --- | --- | --- |
| Ledger shape, source CHECK, ext `sees_all=false` | IMPL | schema.ts:2689-2735. |
| Effective selection: direct alone; else rank; tie `SCIM>OIDC>JIT` only for same role id; distinct role ids fail closed; no union | IMPL | repository.ts:1988-2130. |
| Every source change preserves a grant row | IMPL | Retirement is `revokedAt` + reason; no deletes. |
| Writer validates person/parent/connection/mapping/side/role/org/ceiling under the IP-22 lock protocol | PARTIAL | See B1/B3. |
| Legacy preflight + all-or-nothing cutover runner | IMPL | membership-provenance-preflight.ts; migrate-membership-provenance.ts; the preflight is covered by tests/api/identity/membership-provenance-preflight.test.ts, and the cutover by membership-provenance-cutover.test.ts and membership-projection-repair.test.ts. |
| Failure/rollback and 25-test ADR evidence | NOT TESTED | None of the 25 acceptance test files named in identity-provisioning.md "Testing" exist under tests/api-integration/identity/ (only 3 files + helpers). No real-Entra run (spec: gate). |

### Customer portal (CP) identity and boundary rules

| Rule | Status | Evidence |
| --- | --- | --- |
| CP-17 org SSO bound to the org and the portal only; instance admins configure | IMPL | IP-1/IP-5 above. |
| CP-18 login page: no provider list, domain-specific disclosure | OOS / NI | No portal login-page or domain-routing code in the slice (see IP-9). |
| CP-19 portal origin admits only exact auth endpoints and registered `kind: portal` policies; agent API unreachable; websocket denied | IMPL | index.ts `CUSTOMER_AUTH_ENDPOINTS`, `isCustomerAuthEndpoint`, `matchesPortalPolicyRoute`, non-GET gating; `/scim` agent-only; ws upgrade agent-only. TESTED: tests/api/two-entry-host.test.ts; tests/api/auth/portal-cookie-boundary.test.ts. |
| Portal session requires an admitted customer identity (extra, hardens CP-19) | IMPL | `hasCustomerPortalIdentity` auth.ts:167; index.ts handleAuthRequest (now 401, was 403); session after-hook auth.ts:855. TESTED: portal-identity-boundary.test.ts:81, :111. Whether a 401 instead of 403 for a wrong-portal session is intended is not stated in the spec (non-blocking N7). |
| CP-1/CP-2 (reach, 404) | OOS | Portal data routes are not part of S1. |

## 3. Findings

### BLOCKING

B1. IP-22 transition matrix is only partly implemented; stale external authority can commit.
- Spec: IP-22 requires every TaskDesk-controlled write to connection grant policy, mapping eligibility, role eligibility or role priority to retire invalid grants and reproject in the same transaction. It also names parent lifecycle sweeps (portal_access close, org or workspace delete, person lifecycle) and ends with "A policy or role write cannot commit while leaving an affected grant or winner stale."
- Code: `PATCH /identity-connections/{id}` (connection-admin.ts:826-1015) retires grants only for (a) disable and (b) a lowered ceiling. When `jitPolicy.enabled` goes true to false, or `default_role_id` or `defaultWorkspaceId` changes, the connection's active `jit_default` grants are NOT retired with `mapping_changed`. The word `jit_default` appears in connection-admin.ts only in the lock set (:841).
- Outside identity/ nothing references the IP-22 seam (`projectMembershipKeys`, `lockScimGrantClosure`, `retryIdentityGrantClosure` have no caller outside apps/api/src/identity/). So role capability and rank edits, role deletion and organisation, workspace and portal_access lifecycle (and non-SCIM person lifecycle) do not sweep or reproject external grants.
- Effect: a JIT default (staff authority) survives an administrator turning JIT off until that identity next logs in, and projection is never re-validated against current parents. No decision-log entry defers these.
- Required: either implement the JIT transition in the configure transaction and the role/parent sweeps, or record an explicit owner deferral naming each uncovered writer, plus tests for IP-22 JIT disable/default-role/target change (spec test 23) and role-rank swap (test 12).

B2. SCIM denial and authentication-failure audit, the `forbidden_attribute` surface and rate limiting are missing.
- IP-4: refused payloads must return `400 forbidden_attribute` and the denial must be a provisioning event. Code refuses (domain parser) but returns generic `400 "Invalid SCIM user resource"` and writes no event (scim-protocol.ts POST/PUT/PATCH handlers).
- IP-12 edge ("Token used after rotation"), IP-24: a bad or rotated token must produce `401` plus a `provisioning_event` `auth.failed`, counted against the anonymous rate class. The SCIM middleware (scim-protocol.ts:52-58) and `resolveScimBearer` (scim-authentication.ts:60-97) write nothing.
- IP-14: per-connection request rate limiting. There is no rate-limit code in apps/api/src/identity/.
- Authority is not at risk (the requests are refused), but this contradicts explicit MUST text and spec tests 17, 21 and 09. NOT TESTED at the API layer.

B3. The SCIM mapping-role validator is weaker than the OIDC one for the same grant class.
- IP-22 requires one `valid_now` predicate and that capability sets pass RL-3/4/6/7/14 plus forbidden-capability guards. `validateOidcMappingRole` (repository.ts:805-906) checks role scope/side, `roleCompositionProblems`, `capability !== 'sees_all'`, role key `admin`/`owner`, and exact workspace anchoring (`role.workspaceId === scopeId`).
- `validateScimMappingRole` (repository.ts:3082-3171) checks only the rank ceiling, an `instance:` capability prefix and (customer) key `customer`. It skips composition problems, allows keys `admin`/`owner`, and accepts a role with `workspaceId = null` under a workspace scope (`role.workspaceId !== null && role.workspaceId !== input.scopeId` at :3147).
- Effect: an agent SCIM mapping can target a role the OIDC path refuses, under the same ceiling and capability rules. `instance:admin` and `sees_all` remain impossible (section 1), so do-not 13 holds, but the guards diverge. NOT TESTED: mapping-role-guards.test.ts covers SCIM only for the customer-role case.

### NON-BLOCKING

N1. Spec'd routes and jobs not present: `POST /identity-connections/{id}/scim` (SCIM child + first token; SCIM cannot be enabled through the API), `DELETE /identity-connections/{id}` (pending action), `POST .../test`, `POST .../scim/test`, and the IP-25 plugin-health discovery ping. Confirm that these are outside S1 or are tracked as a separate slice.

N2. IP-7 "any failure is audited": token, state, PKCE and nonce failures are logged only (oidc-login.ts:~420-480); no `auth.failed` event except admission failure. NOT TESTED: PKCE mismatch, replayed, wrong-portal and expired state (spec test 15).

N3. IP-9 edge case: a domain-collision refusal should be `409` with `request.denied` and an admin notification. The code returns the generic safe failure and writes no event. NOT TESTED at the API layer.

N4. IP-28 overage: no operator-visible God Mode Health warning is raised, and no dedicated provisioning event beyond the grant-retirement events. The `claim_overage` reason is internal.

N5. Invented strictness at IP-27: login is refused for an existing, otherwise admitted identity when no usable address exists or `email_verified === false` (identity.ts:150-158). The spec scopes the address requirement to JIT creation. This fails closed and is low risk, but it is not authorised for repeat or SCIM-linked logins. Related invention: refusing the consumer-tenant GUID `9188040d-...` (identity.ts:238) is safe and reasonable but unspecified.

N6. Disabled connection and SCIM: the spec says SCIM calls return `403 connection_disabled`. The code returns 401 from bearer resolution (scim-authentication.ts:76-82) and `403 "Connection disabled"` only for a mid-flight lock re-check. Tests assert the actual behaviour, not the spec text.

N7. Wrong-portal session on the portal host now returns 401 where it was 403 (index.ts handleAuthRequest). The spec does not state the status. Record the intent.

N8. IP-31 and IP-32 are covered only by domain unit tests; the HTTP-layer SCIM tests do not exercise op-case, string booleans, the enterprise extension, user `POST` duplicate or cross-connection 409 bodies, or `scim_group_removed` retirement.

N9. IP-10 "off by default for customer connections when SCIM is enabled" is not enforced or defaulted anywhere (the create DTO requires an explicit `jitPolicy`).

N10. Test inventory: none of the 25 named acceptance test files exist under tests/api-integration/identity/, and no real-Entra-tenant run is recorded; both are P3 gate criteria, not S1 merge criteria, and should be stated in the PR "Not done" section. The domain `projectEffectiveMembership` is tested, but `projectMembershipKeys` (repository.ts:1988) re-implements the algorithm instead of calling it, so the unit test does not cover the executed code (for reviewer A).

### Invented behaviour not authorised by a spec rule (all fail closed)

- Refusal of `email_verified === false` and of no-address logins for existing identities (N5).
- OIDC mapping validator refusing role keys `admin`/`owner` (stricter than IP-3's rank-only text; sensible, but it should be written into IP-3 or the SCIM path should match it).
- `multiple_direct` conflict kind in the domain projector and a thrown invariant in the repository projector (defensive; the spec presumes uniqueness).
- `Cache-Control: no-store` and `scim+json; charset=utf-8` on all SCIM responses (benign).

### Spec rules the code contradicts

- IP-22 JIT-policy transition (B1); IP-4/IP-12/IP-14/IP-24 SCIM denial, auth-failure events, error code and rate limit (B2); IP-22 single validity predicate (B3). The disabled-connection `403 connection_disabled` text (N6) is the only other direct textual mismatch.

## 4. What I did not check

I did not run any tests, builds or migrations. I did not review the Drizzle migrations (0089-0119) line by line, the SCIM `PATCH /Users` op translation beyond the allow-list, the `scim-admin.ts` strict DTO field by field, `apps/api/src/auth/step-up-api.ts`, `apps/web`, or the markdown contract documents beyond the diffs for rbac.md and the decision log. Body-size limits on SCIM requests were not located (assumed app-wide; unverified). I did not verify the concurrency and lock-order claims at runtime; that falls to reviewer B.
<!-- END REPORT ac416c8dd980556eb 74718d6c -->

<!-- BEGIN REPORT (agent ac416c8dd980556eb; model claude-sonnet-5-5; role ordinary C closure (from transcript); candidate 7b3508a746772cb0367bbe0165fdd8dceade9ad0; sha256 ae7371367790486017763539641300889fd04816be3de5ec9fe0dc41a746cc1d) -->
Reviewed head: 7b3508a746772cb0367bbe0165fdd8dceade9ad0 (claude/s1-identity; `git diff 74718d6c..7b3508a7`, static only, nothing run).

**Verdict: the two fixes are correct and tested, and the held items are recorded as gaps. The status section should be tightened.** The tightening is non-blocking.

**C-B3 (one shared IdP role validator): fixed.**
- `validateScimMappingRole` is now a thin wrapper over the same `validateIdpMappingRole` that `validateOidcMappingRole` uses (repository.ts). One predicate now covers OIDC groups, JIT defaults and SCIM groups.
- The SCIM agent path now rejects:
  - the `admin` and `owner` role keys;
  - null-workspace roles and roles anchored in another workspace;
  - `sees_all` and `instance:*` capabilities;
  - role composition problems;
  - a rank above the connection ceiling.
- A customer SCIM mapping must now target the connection's own organisation, and only the Customer role is accepted.
- `mapping-role-guards.test.ts` adds five tests for the SCIM path: admin/owner, null or foreign workspace, instance or `sees_all` authority, and customer scope mismatch. The existing positive control remains.

**C-B1 inside S1's configure path: fixed.**
- `retireConnectionJitGrants` retires the connection's active `jit_default` grants with the existing `mapping_changed` reason and reprojects the affected keys. It runs inside the configure transaction, after the version CAS, and its user ids are merged into the authority-cache invalidation set (`affectedUserIds`).
- It fires on JIT enabled to disabled, on a `default_role_id` change, and on a `defaultWorkspaceId` change. Re-enabling or a new default creates nothing.
- `jit-policy-transition.test.ts` covers JIT off, default role change, default workspace change, and an unrelated edit that leaves the grant untouched.
- One minor edge: a `default_role_id` change is not detected if the stored `jit_policy` fails to parse. That case fails closed at login anyway.

**No rule text altered.** The docs diff is 35 pure additions, with no removed lines: the new "Implementation status (2026-10-10)" section only.

**Status section against my table.** It correctly records, as held and unimplemented:
- the IP-22 cross-module sweeps;
- IP-4 `forbidden_attribute` and `request.denied`;
- the IP-12/IP-24 `auth.failed` events;
- the IP-14 SCIM rate limit and body bounds;
- IP-25;
- the IP-9/IP-29/CP-18 home-realm endpoint;
- the missing routes (`POST /scim`, connection `DELETE`, both `/test`);
- the 25 named acceptance test files and the real-Entra run;
- the 401-vs-403 and no-address behaviour differences, and the wrong-portal 401.

**Three corrections for the section:**
1. It omits these gaps from my table:
   - IP-7 protocol failures are logged but not audited;
   - the IP-9 domain collision should be 409 with `request.denied` and an admin notification;
   - IP-28 overage raises no God Mode Health warning;
   - IP-22 `valid_now` is not re-evaluated at projection time;
   - IP-10 "customer JIT off by default when SCIM is on" is unenforced;
   - the IP-31 and IP-32 HTTP-layer tests are missing.
2. Its "Implemented and tested" list slightly overclaims: IP-7 (no PKCE, replayed-state or expired-state tests), IP-28 (no Health warning) and IP-20 (no `scim_group_removed` test).
3. Its heading should say the "disabled connection answers 401, not 403" item is a mismatch from the text, as it already does. The only other change needed is adding the omissions above to the held list.

No authority-safety regression is visible in the diff.
<!-- END REPORT ac416c8dd980556eb 7b3508a7 -->

<!-- BEGIN REPORT (agent added0c8ee37c9e11; model claude-opus-5-5; role Sol-tier security review, closures and rebind; candidate 512a6d851f4144395e2fb16f7914c84ad12a8ba8; sha256 73c450d85af88f49ad722732e98e1c3ba862f77db19e0ac32fd9295c924c1cdb) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:added0c8ee37c9e11
**Reviewed head:** abe28aaf00a0fc8e7ae85e11af5ebe779a5d7065

**Verdict: BLOCKED (changes required).** I found no exploitable path by which IdP data (OIDC claims or groups, SCIM attributes or groups) grants `instance:admin`, `sees_all` or cross-tenant membership. Tenant isolation of SCIM tokens holds. The portal/agent boundary holds in source. The block is on evidence and correctness:

- B1: the SCIM portal-host regression test is vacuous.
- B2: several IdP role-restriction guards have no test that fails when they are removed.
- B3: JIT first login is broken in both portals and untested. This is a fail-closed correctness defect, not a security hole.

---

# S1 identity: independent security review (sampled big reviewer role)

- **Candidate:** worktree `/private/tmp/claude-501/s1`, HEAD `abe28aaf00a0fc8e7ae85e11af5ebe779a5d7065` (verified with `git rev-parse HEAD`; the worktree was clean before and after).
- **Comparison base:** `24a48912` (main). Diff `24a48912..HEAD`: 103 files, +32,679/−1,567, 4 commits (`92267ee0`, `132aba70`, `90613972`, `abe28aaf`).
- **Source train:** #589 `2350397b`. The copied 595/596 review notes in `docs/07-planning/security-reviews/` are historical. I did not count them as current evidence.
- **Independence:** fresh context. I did not author, direct or remediate this candidate.
- **Policy read:** `AGENTS.md`, `CLAUDE.md`, `docs/01-architecture/rbac.md` (IdP authority rule at lines 167–171; ledger at lines 284–312; step-up at lines 806–809), `docs/03-features/identity-provisioning.md` (IP-1 to IP-3, IP-14, IP-15, IP-20 to IP-22, IP-34) and `p3-identity-owning-findings-handoff.md`.
- **Role label:** this is the role-model label the caller assigned. Under CLAUDE.md the Opus 5.5 big-reviewer role is a sample and does not replace a required GPT-6 Sol review. The orchestrator must decide whether this report satisfies or only supplements the Sol gate.

## Findings

### B1. BLOCKING (test evidence): the SCIM portal-host guard has a vacuous regression test

- **Guard:** `apps/api/src/index.ts:545`. The line is `if (isScimPath && selected !== "agent") return denyByHost(c);`. The source is correct.
- **Test:** `tests/api-integration/scim-admin.test.ts:741-748`. It sends `new Request("http://portal.localhost:5174/scim/v2/ServiceProviderConfig", …)` with no `Host` header. Host selection reads `Host`, so the request resolves to `"invalid"` and gets 404 whether or not the guard exists.
- **Mutation M5** (delete line 545): all 9 `scim-admin` integration tests and all 701 `tests/api` unit tests still pass.
- **Mutation M5b:** I copied the same test and added `host: "portal.localhost:5174"`.
  - Unmutated, the probe returns 404 and passes.
  - With line 545 removed, the probe gets **200**. A valid SCIM bearer is served on the customer portal origin.
- **Attack scenario if this guard regresses:** the SCIM protocol, including user and group writes that drive grants, becomes reachable through the customer portal origin. No test would catch it. Its exposure policy is agent-origin only.
- **Fix:** give the probe an explicit portal `Host` header and assert 404 for GET and for a write method (POST `/scim/v2/Users`). Also assert that no row changes.

### B2. BLOCKING (test evidence): IdP role-restriction guards survive deletion

Each of these source guards enforces IP-2, IP-3 or IP-21. In each case all S1 integration suites stay green after the guard is deleted.

| Mutation | Guard (file:line) | Result |
| --- | --- | --- |
| M11 | `repository.ts:882`. OIDC customer mapping must be `role.key === "customer"` and global; replaced with `return true` | 16/16 pass |
| M10 | `repository.ts:3148`. SCIM customer mapping must be `roleKey === "customer"`; replaced with `return true` | 9/9 pass |
| M1 | `repository.ts:886`. OIDC agent role anchoring `role.workspaceId !== input.scopeId` removed | 25/25 pass |
| M2 | `repository.ts:887-888`. OIDC agent `admin`/`owner` exclusion removed | 25/25 pass |

**Attack scenario (M10/M11 regression).** A customer-scope connection maps a customer IdP group to any organisation-scope role that passes the composition and capability checks. IP-2 says a customer connection may only ever hold the customer role. The guard is the only server-side enforcement of that rule. Admin UI choice does not count.

**Mitigation today.** An instance administrator must create the mapping under a step-up proof. The guards are present and correct in source. This is why the finding concerns test evidence and not live exploitability. The repository rule still applies: "Every rule that closes a code defect gets a test."

**Fix:** add negative integration tests:

- a customer mapping to a non-`customer` organisation role is rejected on create, on enable, and at login or SCIM reconciliation;
- an agent mapping to a role anchored in another workspace is rejected;
- an agent mapping to an `admin` or `owner` role is rejected.

### B3. BLOCKING (correctness; fails closed, not a security hole): JIT first login cannot succeed in either portal, and nothing tests it

There are two independent defects. I confirmed both empirically with a probe test on a temp copy.

1. **Agent portal.** `apps/api/src/identity/oidc-login.ts:757-765` calls `validateOidcMappingRole` with `organisationId` set to the internal organisation id (from line 742). The agent branch at `repository.ts:841-846` returns `false` whenever `input.organisationId !== null`. So every agent JIT first login is denied.
2. **All portals.** `oidc-login.ts:802` inserts `accountId: \`${connection.issuer}\0${subject}\``. PostgreSQL `text` rejects a NUL byte (error `22021 invalid byte sequence`), so the JIT transaction always rolls back. It reports a generic `sign_in_failed`.

**Probe evidence:**

- On the candidate, an agent JIT first login is denied and no `external_identity` is created.
- With only the organisation argument fixed, the login still fails with SQLSTATE 22021.
- With both fixed, the login succeeds (302 `/agent`).

**Coverage gap:** existing tests pre-insert the `external_identity`, so the JIT creation branch never runs. This fails closed, so it is not a privilege risk. But it makes the IP-9/IP-10 JIT claim false at this head, and a later "fix" of the agent organisation check would reach a path no test has ever executed.

**Related observation (not verified at runtime).** A SCIM-provisioned identity has no `userId` and a placeholder person. The existing-identity OIDC branch (`oidc-login.ts:691`, then `832`) throws when `userId` is null. The customer portal identity check (`auth/repository.ts:145`) also requires `isPlaceholder = false`. So SCIM-provisioned people may be unable to sign in. This fails closed.

### N1. NON-BLOCKING (spec deviation, IP-14): SCIM has no per-connection rate limit and no body or member-count bound

- `scim-protocol.ts:52` authenticates and nothing throttles. `parseScimGroup` (`scim-protocol.ts:562-578`) accepts an unbounded `members` array. No body limit is mounted for `/scim/v2`.
- IP-14 requires per-connection rate limits and rejection of oversized bodies.
- **Risk:** low.
  - Tokens are 256-bit (`randomBytes(32)`), stored as SHA-256 and looked up by digest, so brute force is infeasible.
  - Unauthenticated abuse costs one indexed lookup per request.
  - A holder of a valid token, or a compromised IdP connector, can send very large group payloads. These cause long transactions under the IP-22 closure locks, which is lock contention and denial of service on that tenant's grant writers.
- **Action:** implement the limit or record IP-14 under `## Not done`.

### N2. NON-BLOCKING (hardening): SCIM and OIDC role validators have diverged

`validateScimMappingRole` (`repository.ts:3082-3166`) is weaker than `validateOidcMappingRole`:

- it allows `role.workspaceId === null` for agent workspace roles (line 3150);
- it does not exclude `admin`/`owner` keys or `rank < 0`;
- it does not apply `roleCompositionProblems`;
- in the customer branch it does not compare the mapping `scopeId` with `connection.organisationId`. The caller forces this at create and update (`scim-admin.ts:560-569`, `615-628`), but reconciliation (`repository.ts:2817`) trusts the stored row.

**Why it is not exploitable today:**

- `organisationId` and `portalScope` are absent from the PATCH contract (`connection-contract.ts:93-110`), so they are immutable.
- The DB CHECK forces `sees_all = false` for every external source (`drizzle/0090…sql:77-79`).
- The evaluator clamps instance-tier capabilities out of workspace roles.

**Recommendation:** share one validator, or at least the anchoring and customer-target checks. That way a corrupt mapping row or a future mutable organisation cannot become a cross-tenant grant.

### N3. NON-BLOCKING: the SCIM credential recheck under lock is untested

Mutation **M6** replaced the comparison in `scim-authentication.ts:33-36` (stored token hash vs. request digest, under `FOR UPDATE`) with `false`. All tests still pass. This recheck closes the rotate- or revoke-during-request race (`scim-protocol.ts:808-816`, `repository.ts:2688`). **Fix:** add a test that rotates the token between bearer resolution and the write, and expects 401 with no change.

### N4. NON-BLOCKING: OIDC login audit failures are swallowed without the durable alert

`oidc-login.ts:665` and `1118` catch audit-append failures and only `logTaskDesk`. The admin routes call `recordAuditWriteFailure` and `notifyCurrentInstanceAdminsOfAuditFailure` (for example `scim-admin.ts:739/793`, `scim-lifecycle.ts`). Grant changes from login reconciliation can therefore commit without an audit row and without an AU-14 alert.

## Adversarial focus: results

1. **IdP to `instance:admin`, `sees_all` or cross-tenant membership: none found.**
   - Instance admin is `user.role = 'admin'`. No IdP path writes `user.role`. JIT inserts `user` without a role, and SCIM never writes `userTable`.
   - External grants are inserted only with `seesAll: false`, and a DB CHECK enforces it per source kind.
   - The projection (`repository.ts:1988-2118`) carries `seesAll` only from the winner, and only a direct grant can carry `true`.
   - OIDC mappings use `hasSafeOidcRoleCapabilities` (registered capabilities plus `roleCompositionProblems`). Mutation M3 removed it and a test failed.
   - SCIM rejects `instance:*`. Mutation M7 removed that check and a test failed.
   - The evaluator also clamps tier. Grant scope is only `workspace`/`organisation`.
   - Customer SCIM members must be customer-side persons of the connection's organisation (`repository.ts:2648-2656`).
2. **Tenant isolation: holds.**
   - SCIM tokens are 32 random bytes, stored as `bytea` SHA-256 (CHECK `octet_length = 32`) and looked up by exact digest. A constant-time compare is unnecessary for a 256-bit pre-image lookup.
   - The token is revalidated under lock. Revocation nulls the hash, and a CHECK forbids an enabled connection without a hash.
   - Every user and group query is scoped to `authority.connectionId` with `provisionedVia = 'scim'`. Mutation M4 removed that scoping and 2 tests failed.
   - Group membership resolves only same-connection SCIM identities.
   - Mutation M8 (removing the connection filter in `getScimExternalIdentity`) survived. That is defense in depth: callers already resolve the id through scoped predicates.
3. **Portal boundary: holds in source; the test is vacuous (B1).**
   - The customer host rejects bearer tokens and API keys (`authenticate-api-request.ts`).
   - The customer host admits only an allow-list of auth endpoints and `portal`-kind policy routes.
   - Customer sessions additionally require `hasCustomerPortalIdentity`.
   - SCIM is bearer-only, so CSRF does not apply, and it never sets cookies (tested).
   - There is no SCIM rate limit (N1). Better Auth's global limiter covers `/api/auth/identity/*/start|callback`.
4. **Step-up and audit: present.**
   - Every connection, mapping and SCIM mutation is `elevated: true, sessionOnly: true` with operation-bound PA-15 proofs. Proofs bind route, operation, version and a canonical body hash, and are consumed `FOR UPDATE` inside the mutating transaction.
   - Mutation M9 removed the body-hash check and 2 tests failed.
   - Step-up consumption is audited in-transaction. Audit gaps are noted in N4.
5. **Login reconciliation: correct ordering; fails safe.**
   - Discovery, then the IP-22 closure lock, then a locked re-read with config-version CAS. Grant reconciliation runs in one transaction, and the session is issued only after commit.
   - `bindOidcSessionProvenance` relocks the connection and the active identity, so a racing disable or SCIM deactivation either revokes the tagged session or makes the bind fail (and the session is deleted).
   - Group loss, missing groups and overage all retire OIDC grants. Mutation M12 removed the group match and a test failed.
   - Admission failure (missing app role or guest) commits retirement before denial.
   - **Residual:** if login fails for another reason (invalid token or configuration, inactive person), the transaction rolls back and existing grants stay until the next successful validated login. This matches IP-27's "next validated login" contract. Existing sessions stay valid under the documented cache/session split.
6. **Auth runtime reload: no attacker input.** `reloadAuthConfiguration` reads only DB rows that `instance:admin` controls (plugin config and connection `configVersion`). It swaps both Better Auth instances atomically after construction and polls every 10 seconds. The OIDC flow reads the connection row live at callback time.

## Mutation summary (temp copy only; each mutation reverted and a clean diff verified)

| ID | Mutation | Killed? |
| --- | --- | --- |
| M1 | OIDC agent anchoring removed | **No** (B2) |
| M2 | OIDC admin/owner exclusion removed | **No** (B2) |
| M3 | OIDC `hasSafeOidcRoleCapabilities` removed | Yes |
| M4 | SCIM user connection predicate removed | Yes |
| M5 | SCIM portal-host guard removed | **No**: test vacuous (B1); M5b proves the exposure |
| M6 | SCIM token recheck under lock disabled | **No** (N3) |
| M7 | SCIM `instance:*` filter disabled | Yes |
| M8 | `getScimExternalIdentity` connection filter removed | No (defense in depth) |
| M9 | Step-up body-hash check removed | Yes |
| M10 | SCIM customer role-key check removed | **No** (B2) |
| M11 | OIDC customer role-key check removed | **No** (B2) |
| M12 | Login group-membership match removed | Yes |
| M13 | Domain projection external `seesAll` rejection removed | Yes |

## Commands actually run

- `git rev-parse HEAD`, `git status --short`, `git diff --stat 24a48912..HEAD`, plus targeted `git diff` and `sed`/`grep` reads of the files cited.
- Container: `docker run -d --rm --name s1-sec-pg --tmpfs /var/lib/postgresql -p 127.0.0.1:55451:5432 postgres:18-alpine`, then stopped with `docker stop s1-sec-pg`.
  - Before: 20 containers in total. That included another reviewer's `s1-review-b-pg`.
  - After: `docker ps -a | count` = **19**, and no `s1-*` container remains.
- Temp copy: `rsync -a --exclude .git` of the worktree into scratchpad `s1copy/`. Every test and mutation ran there. The candidate worktree was not modified.
- Baseline integration run: `TASKDESK_DATABASE_URL=…/s1sec_test vitest run --config vitest.integration.config.ts` on `identity-connection-admin`, `identity/oidc-group-mapping-admin`, `scim-admin` and `membership-provenance-cutover`. **4 files, 26 tests passed.**
- Baseline unit run: `vitest run tests/api/identity tests/api/auth/configuration-version tests/api/auth/portal-cookie-boundary tests/api/two-entry-host tests/api/oidc-group-mapping-contract`. **10 files, 55 tests passed.**
- Domain run: `packages/domain vitest run src/identity`. **7 files, 95 tests passed.**
- Full `tests/api` unit run under M5: **95 files, 701 tests passed.**
- Mutation runner: `scratchpad/mutate.sh` (perl patch, then targeted vitest, then restore). Results are in the table above.
- JIT probe: a temporary test file in the copy, with debug instrumentation in the copy only. It was removed afterwards and the copy was diffed clean against the candidate.

## Residual risk / not checked

- I did not run real Entra, browser or E2E checks. I ran no CSRF negative E2E, no OpenAPI or contract checks, no `check:*` scripts, no typecheck or lint, and no image or boot or deployment.
- I did not review in depth:
  - `migrate-membership-provenance.ts` and the preflight cutover runner. I only checked that their test passes.
  - `normaliseEntraClaims` domain-owner routing and `validateEntraIdToken` internals (I read the unit tests only).
  - The SCIM User PATCH and PUT profile-mapping edge cases.
  - The WebSocket broadcast adapter changes.
  - `step-up-api.ts` beyond proof consumption.
  - The OpenAPI diff.
- I did not test concurrency (two parallel logins, or login racing SCIM group removal). I verified lock order and retry only by reading.
- I did not check hosted CI, GitHub review state or live PR head.
- I did not check status/decision-log for this slice's `## Not done` entries. N1 may already be recorded there.

---

# Closure check at 74718d6c

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:added0c8ee37c9e11
**Reviewed head:** 74718d6c9a367fe0426283dfe23a34ea540388f9

**Verdict: CLEAR (security), with non-blocking items.**

- B1, B2, B3 and N3 are closed. Every previously surviving security mutant is now killed.
- I found no exploitable defect in the new link-and-activate path or in the F1 repair path.
- N1, N2 and N4 were not in scope for this delta and remain open as non-blocking.

## Scope

- **Delta:** `git diff abe28aaf..74718d6c`, 4 commits:
  - `e0440fd2`: JIT repair, guard tests and boundary tests;
  - `be70177e`: F1 repair for databases already at 0119;
  - `aa7b2dcb`: typed portal probe app;
  - `74718d6c`: SCIM first-login link and activate.
- **Changes:** 14 files, +1,746/−209.
- **Head and worktree:** HEAD verified as 74718d6c; the worktree was clean before and after.
- **Read in full:**
  - the `oidc-login.ts` delta and the surrounding existing-identity branch (`oidc-login.ts:700-749`);
  - `getOidcIdentityForSignIn` and `findOidcEmailOwner` (`repository.ts:1633-1665`, `1804-1810`);
  - the `migrate-membership-provenance.ts` refactor and `repairMembershipProjection`;
  - the preflight query change;
  - the runbook and ADR 0015 addenda;
  - the decision-log top entry (owner decision, 2026-10-10);
  - IP-19/IP-30;
  - all new and changed tests.

## Closure of earlier findings

| Finding | Status | Evidence |
| --- | --- | --- |
| B1 | Closed | The probe now sends `host: portal.localhost:5174` and also tries a portal-host `POST /scim/v2/Users`, asserting no row change. M5 is killed. |
| B2 | Closed | `tests/api-integration/identity/mapping-role-guards.test.ts`. M1, M2, M10 and M11 are each killed by a dedicated test. These are validator-level tests. Every create, enable and reconciliation boundary calls the same validator, so this is sufficient. |
| B3 | Closed | Agent JIT passes `organisationId: null` (`oidc-login.ts:803-805`). `identityAccountId` percent-encodes issuer and subject and joins them with `:`, so there is no NUL byte. `oidc-jit-login.test.ts` creates agent and customer users end to end. |
| N3 | Closed | A new test rotates the hash between `resolveScimBearer` and `lockAndVerifyScimMutation` and expects 401. M6 is killed. |
| N1, N2, N4 | Open (non-blocking) | Not addressed in this delta. |

## Adversarial review of link-and-activate (`oidc-login.ts:717-749`)

**Account takeover via subject reuse: not found.**
- The match is `identity_connection_id + issuer + subject` on an existing `external_identity`, locked `FOR UPDATE` after the IP-22 closure lock and re-read under CAS.
- A SCIM subject is fixed at create time (`scim-protocol.ts:869`). No SCIM PUT or PATCH rewrites `subject`.
- Linking only happens when both `identity.userId` and `person.userId` are null. An identity that already has a user can never be relinked to a different oid.
- Only two code paths insert `external_identity`:
  - JIT, which always sets `userId`;
  - SCIM `POST /Users`, which leaves `userId` null.
  So a user-less identity is necessarily SCIM-created on the same connection. No migration or script inserts identities.
- Concurrent first logins serialize on the identity row lock. The second sees the updated `userId` and takes the ordinary path.
- **Residual:** the link is only as trustworthy as the SCIM client's `externalId`. A connection's SCIM token holder (its own IdP) can pre-create an identity whose `externalId` equals any oid in that tenant and choose its groups. That is within the IdP's existing authority for that connection, and it cannot cross connections.
- **Functional residual (not security):** Entra's default SCIM `externalId` mapping is not the objectId. Linking happens only when the IdP maps `externalId` to `objectId`. That is an operator configuration requirement worth documenting.

**Email collisions: refused, but the refusal itself is untested.**
- An address already owned by any user refuses the link (`findOidcEmailOwner`).
- Mutation **M14** removed that check and all tests still pass. The `user.email` UNIQUE constraint still rejects an exact duplicate, rolls back the transaction and fails the login closed.
- **Non-blocking:** both checks are case-sensitive. The login address is lowercased (`identity.ts:63`), but an existing user stored with mixed case (for example `Alice@x`) would not collide, and a second user `alice@x` would be created. There is no takeover path, because email-based flows deliver to the real mailbox and the SSO user has no password. But it duplicates identities, and the same gap already exists on the JIT path.
- **Recommendation:** compare `lower(email)` and add a link-path collision test.

**Cross-connection and cross-organisation linking: refused.**
- The lookup is scoped by connection, so the same subject on another connection does not link (tested).
- A customer link requires `person.organisation_id = connection.organisation_id` (tested).
- The side check `existing.side` vs. portal is present. Mutation **M16** removed it and it survived. That is defense in depth: SCIM sets the side from the immutable connection portal scope, and the org check already refuses the cross-portal fixture.

**Inactive or deprovisioned identities: refused, never reactivated.**
- `!existing.active || !existing.personActive` throws before the link (tested for both an inactive identity and an inactive person).
- The login never writes `active`.

**Placeholder claim by a non-SCIM path: not possible.**
- The link updates only the person bound to the matched identity row (`existing.personId`).
- Email-only and placeholder matches never select a person (tested with JIT on, which creates a separate JIT identity and leaves the placeholder unclaimed, and with JIT off, which refuses).
- Import placeholders have no `external_identity`, so this path cannot reach them, consistent with IP-30.
- Clearing `isPlaceholder` is tested (M15 killed), which also unblocks `hasCustomerPortalIdentity` for linked customers.

**Grants:** linking creates no grant itself. Grants come only from the unchanged IP-22 reconciliation in the same transaction, and the session is issued after commit.

## F1 repair path (`repairMembershipProjection`)

**Scope.** It runs only when the journal is already past the cutover, inside the existing transaction that holds ACCESS EXCLUSIVE locks on organisation, workspace, person, role and membership. With no unprojected memberships it is a no-op (tested, including the journal count).

**It cannot grant more than the legacy memberships had.** Each inserted grant is `source_kind='direct'`, `direct_origin='admin'`, with exactly the locked membership's `role_id`, `scope`, `scope_id` and `sees_all`. This is checked twice, against the digest-bound inventory and against the locked row.
- The role is re-anchored: an organisation role must have a null workspace, and a workspace role must belong to that workspace.
- The target and the person (same organisation, active, not a placeholder) are re-verified under lock.
- External source fields are rejected.
- No membership row is created or changed, so effective authority is unchanged.
- Rows that conflict with an existing active direct grant are refused.
- The post-insert check requires that zero unprojected rows remain.

**Who approves.** The record's `approverPersonId` must be an active, non-placeholder person whose user has `role='admin'`. M17 removed that check and the test caught it (killed).
- **Residual:** this is attestation, not authentication. Whoever can run the migration process with a hand-written file can name any current admin. That operator already holds migration database credentials, which are strictly more powerful, so I do not classify it as an escalation.
- **Non-blocking:**
  - the approver query does not require `person.side = 'staff'`, unlike `isCurrentInstanceAdmin`;
  - `grantedByPersonId` is only required to be a staff person and is not bound to the approver, although the error text says "current approver as actor". This behavior is inherited from the cutover gate.
- **Non-blocking test gaps:**
  - M18 removed the conflicting-direct-grant refusal and it survived. No test covers this, and the projection's direct-uniqueness invariant would otherwise throw later;
  - M19 removed the second-loop `sees_all` comparison and it survived. That comparison is redundant with the first-loop and digest checks.

## Mutations re-run at 74718d6c (temp copy; each mutation reverted; copy diffed clean)

| ID | Mutation | Result |
| --- | --- | --- |
| M1 | OIDC agent anchoring removed | Killed (`mapping-role-guards`) |
| M2 | OIDC admin/owner exclusion removed | Killed |
| M5 | SCIM portal-host guard removed | Killed (`scim-admin` delegated-discovery test) |
| M6 | SCIM token recheck disabled | Killed (new recheck test) |
| M10 | SCIM customer role key | Killed |
| M11 | OIDC customer role key | Killed |
| M14 | Link-path email-owner refusal removed | Survived (DB UNIQUE backstop; non-blocking) |
| M15 | Link does not clear `isPlaceholder` | Killed (2 tests) |
| M16 | Existing-identity side check removed | Survived (defense in depth; non-blocking) |
| M17 | F1 approver admin check removed | Killed |
| M18 | F1 conflicting-direct-grant refusal removed | Survived (non-blocking) |
| M19 | F1 second `sees_all` comparison removed | Survived (redundant check) |

## Commands

- `git rev-parse HEAD`, `git status --short`, `git log abe28aaf..HEAD`, `git diff abe28aaf..74718d6c` (targeted files).
- Clean copy: `rsync -a --exclude .git` of the clean worktree into scratchpad `s1copy2/`, removed afterwards.
- Container: `docker run -d --rm --name s1-sec2-pg --tmpfs /var/lib/postgresql -p 127.0.0.1:55452:5432 postgres:18-alpine`, then `docker stop`.
  - Before: 20 containers in total, including another reviewer's `s1-review-b2-pg`.
  - After: 20. `s1-sec2-pg` is gone, and the only `s1-*` container left is `s1-review-b2-pg`, which is not mine. My container footprint is zero. The 19-container baseline plus that reviewer's container accounts for the count.
- Integration baseline: `identity-connection-admin`, `identity/` (mapping-role-guards, oidc-group-mapping-admin, oidc-jit-login), `scim-admin`, `membership-provenance-cutover`, `membership-projection-repair` and `portal-identity-boundary`. **8 files, 45 tests passed.**
- Unit `tests/api`: 699/701 on the first run. The 2 failures were 5-second timeouts in `notification-preferences/delivery-ssrf.test.ts`, which is unrelated to S1 and untouched by the delta. That file re-run alone: **4/4 passed.** Domain `src/identity`: **95/95 passed.**
- Mutations: `scratchpad/mutate2.sh`. Results are in the table above.

## Residual / not checked

- Real Entra: whether `externalId` maps to `objectId` in practice, and live link behavior.
- No browser checks. No CI, typecheck or lint. No image or boot.
- No real concurrency run of two simultaneous first logins (lock reasoning only).
- I did not review `preflight-membership-provenance.ts` beyond the query change.
- The F1 repair against a real schema-spine database snapshot (I relied on the synthetic test).
- N1 (SCIM rate and size limits), N2 (validator parity) and N4 (login audit alert) are still open.

**Reviewed head:** 74718d6c9a367fe0426283dfe23a34ea540388f9

---

# Delta check at 7b3508a7

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:added0c8ee37c9e11
**Reviewed head:** 7b3508a746772cb0367bbe0165fdd8dceade9ad0

**Verdict: CLEAR (security), with non-blocking items.**

- N2 is closed at grant time. Every grant-creating and reconciling path for OIDC groups, JIT defaults and SCIM groups now runs through one shared predicate.
- The JIT transitions retire completely and reproject under the IP-22 closure locks.
- I found no blocking defect.

## Scope

- **Delta:** `git diff 74718d6c..7b3508a7`, one commit (`7b3508a7`).
- **Files:**
  - `connection-admin.ts` (+27);
  - `membership-projection.ts` (+1);
  - `repository.ts` (+177/−90 net);
  - `identity-provisioning.md` (status section);
  - new `jit-policy-transition.test.ts`;
  - extended `mapping-role-guards.test.ts`.
- **Head and worktree:** HEAD verified as 7b3508a7; the worktree was clean before and after.
- **Read:**
  - the full shared predicate `validateIdpMappingRole` (`repository.ts:830-906`);
  - `hasSafeOidcRoleCapabilities` and `roleCompositionProblems` (`packages/permissions/src/roles.ts:319`);
  - `validateScimMappingRole` (`repository.ts:3153-3163`);
  - every caller (`grep`);
  - `retireConnectionJitGrants`;
  - the configure transaction (`connection-admin.ts:800-1050`);
  - `lockScimGrantClosure` discovery and its under-lock recheck (`repository.ts:1015-1470`).

## (1) Shared IdP mapping role predicate

**Coverage.** Every IdP grant path calls `validateIdpMappingRole`:
- OIDC mapping admin create, update and enable (`oidc-group-mapping-admin.ts:202`, `step-up-api.ts:620/1084`);
- login reconciliation of mappings and the JIT default, plus JIT first-user creation (`oidc-login.ts:800/946/979`);
- SCIM mapping admin (`scim-admin.ts:572/634`);
- SCIM options and reconciliation (`repository.ts:2888/3286/3403`).

**Enforced rules.**
- Agent mappings:
  - the target must be a live workspace of the active internal organisation;
  - the role must be anchored to exactly that workspace, so a null-workspace role is now refused for SCIM too;
  - the role rank must be at least 0 and at most the connection ceiling;
  - `admin` and `owner` are refused.
- Customer mappings: the scope must equal the connection's organisation (this closes the N2 reconciliation gap), and the role must be the global `customer` role.
- Capabilities, for every mapping:
  - only registered strings;
  - no `sees_all`;
  - `roleCompositionProblems` must be empty, which refuses instance-tier authority in organisation and workspace roles.

**Remaining weaker path (NON-BLOCKING, configure time only).** `validateConnectionReferences` (`connection-admin.ts:446-509`) still checks the JIT default role with its own `safeRoleCapabilities`. That check refuses only `instance:admin` and `sees_all`; it does not check composition or that capabilities are registered.
- **Effect:** an administrator could save a JIT default role that the shared predicate later rejects. That role never produces a grant, because both JIT creation and reconciliation call the shared predicate. So it fails closed, with a "saved but inert" configuration.
- **Recommendation:** call `validateIdpMappingRole` there as well.

**Mutations.**
- J5 (customer scope check removed) and J6 (shared capability check removed) are killed. J6 is caught by 3 tests across SCIM and OIDC.
- M1, M2, M10 and M11 sit on the same shared lines and stay killed.
- J7 removed the `role.rank < 0` check and **survived**. This is non-blocking: it only matters for a corrupt negative-rank role.

## (2) JIT transitions (`retireConnectionJitGrants`)

**Lock order: sound.**
- The configure transaction first runs `lockScimGrantClosure` with `sourceKinds: ["jit_default", "oidc_group", "scim_group"]`, plus the proposed role, scope and organisation. That takes the IP-22 order: organisations, workspaces, persons, roles, the `identity_connection` row `FOR UPDATE`, mappings and SCIM rows, identities, projection keys.
- It then re-reads the connection under lock with config-version CAS.
- `retireConnectionJitGrants` locks the affected grant rows last (`FOR UPDATE OF membership_grant`), which matches IP-22's "mutated grant rows last".
- The whole transaction is wrapped in `retryIdentityGrantClosure`. On retry, the step-up proof consumption rolls back with everything else.

**Race with a concurrent login: sound.** Login calls the same closure on the same connection (`jit_default`, `oidc_group`), so both sides contend on the `identity_connection` row lock.
- **Login commits first.** It may add a JIT grant between configure's discovery and its lock. Configure's under-lock re-read of active grants (`repository.ts:1440-1466`) then sees a different set, throws `IdentityGrantClosureChangedError`, and retries. The retry retires the new grant too.
- **Configure holds the lock first.** Login blocks. After configure commits, login's own check `currentConnection.configVersion !== observedConnection.configVersion` (`oidc-login.ts`, under lock) forces a retry under the new policy, so no stale `jit_default` grant is re-minted.
- I verified this by reasoning only. I ran no parallel test.

**Partial retirement: none found.**
- Retirement selects every active `jit_default` grant of that connection.
- The closure's discovered keys are exactly the active grants of that connection for those source kinds, and the recheck guarantees they have not changed. So every retired grant's projection key is in `grantClosure`, and all of them are reprojected in the same transaction.
- Other connections' and other sources' grants are untouched.
- Mutations J1 (no retirement), J2 (no reprojection), J3 (no role-change clause), J4 (no workspace-change clause) and J8 (no JIT-off clause) are all killed by `jit-policy-transition.test.ts`, which also asserts the unrelated-change no-op.

**Non-blocking items.**
- (a) The transition clauses require the *stored* policy to parse (`lockedJit.ok`). If a stored `jit_policy` were corrupt, a PATCH that changes the role or turns JIT off would not retire old `jit_default` grants. This needs direct database corruption, but failing toward retirement would be safer: treat an unparseable stored policy as "changed".
- (b) After commit, only per-user authority is invalidated (`affectedUserIds`). The login path also invalidates the affected `workspaceIds`. The configure path does not, so workspace-level caches may stay stale until TTL.
- (c) Retired JIT grants get no per-grant `provisioning_event` (`group.member_removed`). Only the connection audit row records the change.

## (3) Status section

The held gaps in `identity-provisioning.md` are stated plainly. One of them matters for security:

**IP-22 cross-module sweeps are not implemented.** Role editors and other writers outside the identity module do not retire or reproject external grants. A later role edit (for example renaming a role to `admin` or adding capabilities) would leave existing IdP-derived memberships projected until the next login or SCIM reconciliation.
- **Mitigations:**
  - no new-shape role editor exists yet;
  - the evaluator clamps instance-tier capabilities;
  - `sees_all` is enforced at grant level by a DB CHECK.
- **Classification:** documented and held, so not blocking this slice. It must be closed before a role editor ships.
- **Also listed:** IP-14 (my N1) is recorded as held. N4 is not listed and is still open.

## Commands

- `git rev-parse HEAD`, `git status --short`, `git log`, `git diff --stat 74718d6c..7b3508a7`, `git diff 74718d6c..7b3508a7 -- apps/api/src tests docs`.
- Clean copy: `rsync -a --exclude .git` of the clean worktree into scratchpad `s1copy3/`, diffed clean against the worktree after the mutations, then removed.
- Container:
  - Before: 19 containers in total.
  - `docker run -d --rm --name s1-sec3-pg --tmpfs /var/lib/postgresql -p 127.0.0.1:55453:5432 postgres:18-alpine`, then `docker stop`.
  - After: **19**, with no `s1-*` container left.
- Integration baseline: `identity-connection-admin`, `identity/` (jit-policy-transition, mapping-role-guards, oidc-group-mapping-admin, oidc-jit-login), `scim-admin`, `membership-provenance-cutover`, `membership-projection-repair` and `portal-identity-boundary`. **9 files, 53 tests passed.**
- Mutations: `scratchpad/mutate3.sh`.
  - Killed: J1, J2, J3, J4, J5, J6 and J8.
  - Survived: J7 (rank < 0).

## Residual / not checked

- No real parallel login-vs-configure execution (lock reasoning only).
- I did not re-run the unit or domain suites at this head; the delta touches no unit-tested module.
- No CI, typecheck or lint. No real Entra. No browser.
- The IP-22 cross-module sweep, IP-14 (N1) and N4 remain open.

**Reviewed head:** 7b3508a746772cb0367bbe0165fdd8dceade9ad0

---

# Final closure and rebind at 512a6d85

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:added0c8ee37c9e11
**Reviewed head:** 512a6d851f4144395e2fb16f7914c84ad12a8ba8

**Verdict: CLEAR (security), with non-blocking test gaps.**

- The rebind is clean: all 10 commits are patch-identical, and #621 touches no S1 file.
- The `c3c11eb6` delta (`0a6cabfc..512a6d85`) closes my 7b3508a7 configure-path item and item (a).
- The dormant-default allowance cannot grant anything. It cannot be used to save a new over-ceiling default, and both login paths re-apply the real ceiling.

## Rebind verification

- **Head:** HEAD is `512a6d851f4144395e2fb16f7914c84ad12a8ba8` and the worktree is clean.
- **Base:** `origin/main` is `b704f7078be1790a2b95c00272106e79b64607bb` (#621). `git log` shows the 10 S1 commits directly on `b704f707`.
- **Range-diff:** `git range-diff 24a48912..c3c11eb6 origin/main..512a6d85` reports all 10 pairs as `=`. That covers my previously reviewed heads: `abe28aaf`→`991ede4a`, `74718d6c`→`2a151f16`, `7b3508a7`→`0a6cabfc`.
- **Tree equivalence:** `git diff 7b3508a7 0a6cabfc -- <the 110 S1 files>` is empty, so the reviewed content is unchanged by the rebase.
- **#621 overlap:**
  - `git diff --name-only 24a48912..b704f707` lists 14 files;
  - `git diff --name-only b704f707..512a6d85` lists 110 S1 files;
  - the `comm -12` intersection is **empty**.

## Delta `0a6cabfc..512a6d85`

**Changed files:**
- `connection-admin.ts`;
- `repository.ts` (export only);
- `identity-provisioning.md` (status);
- `jit-policy-transition.test.ts` (+2 tests).

**Configure uses the shared predicate.**
- `safeRoleCapabilities` is removed.
- The JIT default saved at create and configure now goes through `validateIdpMappingRole`. Agent defaults pass `organisationId: null`, `scopeId = defaultWorkspaceId` and the connection ceiling. Customer defaults pass `scopeId = organisationId` and `maxRoleRank: null`.
- So the anchoring, `admin`/`owner`, rank ≥ 0, registered-capability, `sees_all` and composition rules now apply at save time too.
- My earlier "saved but inert" item is closed.
- D3 (configure bypasses the shared predicate) is **killed** by "refuses to save a default role the shared IdP role predicate rejects".

**Unreadable stored policy.** `jitTransition = !disabling && (!lockedJit.ok || jitDisabled || jitRoleChanged || jitWorkspaceChanged)`.
- D2 (dropping `!lockedJit.ok`) is **killed**.
- Precision note (not a defect): with a corrupt stored policy, a PATCH that does not supply a valid `jitPolicy` is refused (422) by `validateConnectionReferences` before reaching the retirement step. So "any configure" in the code comment really means "any configure that supplies a readable policy". The other configures fail closed.
- **Residual:** while the stored policy is unreadable, existing `jit_default` grants stay active until an admin saves a valid policy. Login fails closed for that connection meanwhile. Reaching this state requires direct database corruption.

**Dormant-default allowance: safe.**
- **When it applies.** `allowDormantDefaultRole` is true only when the PATCH supplies neither `jitPolicy` nor `defaultWorkspaceId`, so the stored default role and target are unchanged. In that case only the rank ceiling is lifted (`Number.MAX_SAFE_INTEGER`); every other shared rule still applies to the preserved default.
- **Empirical probe** (temporary test, removed afterwards; seed default role R1 rank 2, ceiling ≥ 2):

  | Step | Result |
  | --- | --- |
  | PATCH `maxRoleRank: 1` | 200; the existing `jit_default` grant is retired (`mapping_changed`) and its membership is removed (0 rows) |
  | Unrelated PATCH (`displayName`) | 200 (dormant default preserved) |
  | Re-saving the same over-ceiling default (`jitPolicy` R1) | **422** |
  | Saving a new over-ceiling default (R2) | **422** |

  So the allowance never lets a new or re-submitted over-ceiling default be stored.
- **At login it grants nothing.**
  - Reconciliation computes `validJit` with `validateOidcMappingRole(... maxRoleRank: currentConnection.maxRoleRank ...)` (`oidc-login.ts:976-987`). An over-ceiling default is therefore invalid, no `jit_default` grant is inserted, and any existing one is retired.
  - JIT first-user creation refuses `role.rank > currentConnection.maxRoleRank` inline (`oidc-login.ts:771`) and then calls the shared predicate with the real ceiling.
- **Test gaps (non-blocking):**
  - D1 (always lift the ceiling at configure) **survived**. My probe shows the source behaves correctly, but no committed test asserts that a new over-ceiling default returns 422.
  - D4b (lift the ceiling for agents in the login reconciliation `validJit` call) **survived**. No committed test proves that a dormant over-ceiling default grants nothing at an agent login. The source is correct by reading.
  - A customer-ceiling variant (D4) is killed by the customer JIT test.
  - Recommendation: add both tests before the IP-22 sweep work.

**Docs.**
- The status section now carries an explicit **Precondition**: the IP-22 cross-module sweep must land before any role editor or person, workspace, organisation or `portal_access` lifecycle writer can change IdP-derived authority.
- It adds partial or held items: IP-7 negative protocol tests, IP-20 retirement test, IP-22 `valid_now` not re-evaluated at projection, IP-9/IP-10, IP-31/IP-32 HTTP tests, and AU-14 (my N4).
- This matches my residuals. IP-14 (N1) and N4 are now recorded as held.

## J/D mutants at 512a6d85 (configure path)

| ID | Mutation | Result |
| --- | --- | --- |
| J1 | No JIT retirement on transition | Killed (4 tests) |
| J3 | Drop the role-change clause | Killed |
| J4 | Drop the workspace-change clause | Killed |
| J8 | Drop the JIT-off clause | Killed |
| D2 | Drop the unreadable-policy clause | Killed |
| D3 | Configure skips the shared predicate (agent) | Killed |
| D1 | Always lift the ceiling at configure | **Survived** (source verified by probe) |
| D4 | Lift the ceiling in login `validJit` (all portals) | Killed (customer JIT test) |
| D4b | Lift the ceiling in login `validJit` (agent only) | **Survived** (source verified by reading) |

## Commands

- `git status --short`, `git rev-parse HEAD`, `git fetch origin`, `git rev-parse origin/main`, `git log --oneline -12`, `git range-diff 24a48912..c3c11eb6 origin/main..512a6d85`.
- `git diff --name-only` overlap check using `comm -12`, `git diff --stat 7b3508a7 0a6cabfc -- <S1 files>` (empty), `git diff 0a6cabfc..512a6d85`.
- Clean copy: `rsync -a --exclude .git` of the clean worktree into scratchpad `s1copy4/`. After the mutations and the probe it was diffed clean (`apps/api/src`, `tests`) and removed.
- Container:
  - Before: 19 containers in total.
  - `docker run -d --rm --name s1-sec4-pg --tmpfs /var/lib/postgresql -p 127.0.0.1:55454:5432 postgres:18-alpine`, then `docker stop`.
  - After: **19**, with no `s1-*` container left.
- Integration baseline: `identity-connection-admin`, `identity/` (jit-policy-transition, mapping-role-guards, oidc-group-mapping-admin, oidc-jit-login), `scim-admin`, `membership-provenance-cutover`, `membership-projection-repair` and `portal-identity-boundary`. **9 files, 55 tests passed.**
- Mutations: `scratchpad/mutate4.sh`. Probe: a temporary file `zz-dormant-probe.test.ts` in the copy, which wrote results to `/tmp/claude/dormant.json`.

## Residual / not checked

- No real parallel login-vs-configure run.
- No CI, typecheck, lint, image or boot, real Entra, or browser checks.
- I did not re-run the unit or domain suites at this head (no unit-tested module changed).
- I did not review #621's own content beyond confirming it does not overlap S1's files.
- Held items now documented in the status section: IP-22 cross-module sweep (with the precondition), IP-14 (N1), AU-14 (N4).
- The D1 and D4b test gaps remain.

**Reviewed head:** 512a6d851f4144395e2fb16f7914c84ad12a8ba8
<!-- END REPORT added0c8ee37c9e11 512a6d85 -->

