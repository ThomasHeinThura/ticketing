# S2 auth hardening — review record

**Reviewed head:** `49bc18eff760472d77d077cf00cd098858a5cdfc` (first round)
**Reviewed head:** `859d250e5b61101615cb5bc6df328f717ee93cec` (remediation closure)
**Reviewed head:** `737e0925e4a117c1a662ca529c55ecd46748c1ed` (final)
**Reviewed head:** `fbf38d4da227f7fa067dd0ed5d5fe3c34d6c18e4` (rebind after merging main; S2 delta byte-identical)

## The slice

Port the remaining reviewed S2 work from #589 (`2350397b`) onto main. Most S2 scope (API-key scope enforcement) already landed through #602. The slice adds:

- **Inactive identities:** they get 403 before the factor policy is evaluated. The person check runs before the settings read and the policy parse, including on the factor-exempt `GET /api/me/security/factors`.
- **API keys:**
  - shadow and strict modes share one `resolveRequestIdentity`, which clamps the key's scope;
  - `verifyApiKey` refuses keys whose owner is banned, inactive or missing, on every route family and with enforcement off. Before this, it accepted them in the default configuration.
- **Records:** the 2026-10-07 test-role-seeding decision is carried from #589 `99528ca5`, plus AK-9 docs and a hermetic seed-cli test.

`29433523` (registration-refusal unification) is held: it has no owner decision and no review evidence.

## Contexts

**Implementation:** Claude Sonnet `ad21d281a4c1f4db4`.

**Ordinary review** (Claude Sonnet):
- `a8fc712742cc73fe3` (port fidelity): PASS at `49bc18ef`.
- `ac15bf960665f5c7c` (runtime and tests): APPROVE at `49bc18ef`.
- `a6a5e4b38733b04b5` (closure): CHANGES REQUIRED at `859d250e`, for a stray decision-log fragment.
- `a6e8716d20f7cff14` (final): PASS at `737e0925`, with rebinds at `7ac604ac` and `fbf38d4d`.

**Security review** (Claude Opus 5.5, Sol-tier under Thomas's routing; not GPT-6 Sol):
- `a40453c91609ae2db`: PASS at `49bc18ef`. It found the banned-owner API-key gap on main.
- `a606ed9a5cc3af456`: PASS at `859d250e`, with C1–C4.
- `ab8f3b6968dbb70ff`: PASS at `737e0925`, with rebinds at `7ac604ac` and `fbf38d4d`.

Each report is inserted unmodified, with its SHA-256. Reports that were later extended with rebind sections are inserted in their final form.

<!-- BEGIN REPORT (agent a8fc712742cc73fe3; model claude-sonnet-5-5; role ordinary review A (port fidelity); candidate 49bc18eff760472d77d077cf00cd098858a5cdfc; sha256 077635b6f780ff0ba48d2c57192d9a31c9e7ad49bc5c576b6c74d63c31bd786f) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh, read-only, static; did not author or direct the work)
Reviewed head: 49bc18eff760472d77d077cf00cd098858a5cdfc (verified with `git rev-parse HEAD`; 3 commits on main 954eb84094e009658943af1e294d3b8a48d17f69; #589 = 2350397b18f83ed417bf63d73970daacdbaae49c, merge-base with main 3096cb04)
Worktree: /private/tmp/claude-501/s2 (branch claude/s2-auth-hardening)
Focus: port fidelity, scope, "already on main / superseded" claims

VERDICT: PASS (ordinary review, port fidelity and scope). No BLOCKING findings. Four NON-BLOCKING findings, N1 (decision-log provenance) should be fixed before merge. The security-scope Sol-tier review is still required and is not replaced by this review. I ran no tests (static only); the author's test counts are unverified by me.

## 1. Provenance, commit by commit (three-way diff main / HEAD / 2350397b)

Commit 85b9a89f vs #589 27fb81fe: FAITHFUL.
- apps/api/src/auth/local-factor-service.ts:17-23 (InactiveFactorIdentityError) and :54-67 (inactive probe) are the same logic as 27fb81fe. The only change is the query being inlined instead of calling `hasInactivePersonFactorIdentity` in auth/repository.ts. Main has no repository layer for this file, and the repository move belongs to #603 (S3). Correct and justified.
- apps/api/src/index.ts:205-211: the diff of HEAD against 2350397b contains exactly this one hunk for the factor path. It matches 27fb81fe (403 "Forbidden" for inactive, 503 `factor_policy_unavailable` otherwise).
- The test in tests/api-integration/local-factor-policy.test.ts is new; 27fb81fe had none. The test-title diff against #589 shows only this added case. Good addition.

Commit c38b8484 vs #589 8c3ca82c plus 2d438767 (non-export hunks) plus the f4789aef test: FAITHFUL.
- apps/api/src/permissions/resolve-request-identity.ts: byte-identical to 2350397b (empty git diff of the two blobs).
- shadow-middleware.ts: the diff against main is only the identity hunk (import swap, ApiKeyContextValue = AuthenticatedApiKey, resolveRequestIdentity call at :373-379). Main's `ensurePolicyRequestId` and `db`/`schema` usage are kept. #589's reversion to the older `normaliseTraceId` and the repository calls (#603) were correctly not taken.
- strict-policy-enforcement.ts: only the `identityFor` refactor (:109-119) is taken. The behaviour is the same as main (credential kind, `apiKeyCapabilitySubset`). Main's witness/requestId/inline-query code is untouched.
- resolve-identity.ts: only the 2d438767 doc-comment hunks (:64-66, :79-87, :202-205). The 589 version of the `getIdentityBase` repository refactor is not leaked in.
- apps/api/src/work-item/search/repository.ts (8c3ca82c/2d438767) does not exist on main (S7 work-item search/export). Not ported. Correct.
- The `apiKeyCapabilitySubset` hunk of 2d438767 is already on main, in the same file. No action is needed.
- The new shadow test uses `GET /api/project` instead of #589's /api/work-items/export (S7). Sound substitution; the test-title diff shows only that swap.

Commit 49bc18ef vs #589 99528ca5, c40fbe36, f4789aef: FAITHFUL for docs/test.
- webhooks-and-api-keys.md "Self-row ownership..." paragraph, testing-strategy.md and the decision-log entry are byte-identical to 2350397b (git diff 2350397b..HEAD shows no difference for these hunks).
- apps/api/scripts/seed-cli.test.ts is identical to #589. main's seed-cli.ts already has the `loadEnvironment` second parameter (seed-cli.ts:14-18), so the hermetic-env test compiles and the change is meaningful.
- notifications.md: only the first hunk (AK-9 wording) is taken. The "Open questions" hunk (S4 outbox text) is correctly excluded: `git diff 2350397b HEAD` shows it as the only remaining difference.
- Commit trailers: all 3 commits carry Co-Authored-By.

## 2. "Already on main / superseded" claims: VERIFIED, nothing S2-owned dropped

Verified by diffing 2350397b against HEAD per file and by reading the main code:
- f4789aef: audit/index.ts, notification-preferences/index.ts, user/index.ts and the three policy.ts files are identical to #589 (0 diff lines). tests api-key-self-mutations.test.ts and audit-read.test.ts have identical it/describe lists. require-workspace-capability.ts on main is a newer design (`capabilityCredential`, explicit `CapabilityCredential`), and main's notification/index.ts has `credentialCanReadTask`. So f4789aef is superseded by newer main code, not dropped.
- 9abde834: `capabilityCredential` is on main (index.ts import in 954eb840 context). The websocket test file's test list is identical. get-capabilities.ts and work-item/index.ts differences are S7/#603 content (`manageServiceCalendars`, `shareSavedViews`, repository calls).
- 46d05601, a0015ac8, d8557d0e, 517737d8, 08842235: workspace/policy.ts and asset/repository.ts are identical to #589. strict-policy-enforcement.ts differs from #589 only by the #603 repository refactor and main's witness code. api-key-bearer test titles are identical. `apiKeyScopeFromStoredPermissions` is on main (used by pending-action/service.ts). Only `parseApiKeyPermissionScope` (#603/S7, fail-closed to `{}`) is not on main; main's strict check treats a missing/invalid scope as no grants (`apiKeyScopeSatisfies`, require-api-key-permission-scope.ts:77-85), so there is no widening.
- Test-title diff of every S2-relevant test file (#589 against HEAD) shows only: the two missing tests discussed in section 4, the export tests (S7), the intentional shadow-test swap, and the added tests.

## 3. Exclusions and the 29433523 HOLD: CORRECT

- The 14 changed files contain no S3 (`approval`, `view`, `users`, SLA, service-calendar mounts), S6 or S7 code. index.ts has one hunk only (confirmed: the mount hunks, realtime request-id, public-origin and capabilityCredential hunks were not applied).
- 29433523 (`apps/api/src/auth.ts`) replaces the nuanced registration refusal messages with one generic string on the unauthenticated signup path. The record of this exists only as the "standing authorization" status text and status.md:773 says "integrated independent review remains pending". Holding it for a conductor decision and its own security review is justified. It also adds a boot-probe fixture and a test, so it is not a trivial port.
- The author's claim that no step-up delta is S2-owned is plausible (S1 landed them; instance_admin_grant is S6). Not independently re-verified beyond the file list showing no step-up files.

## 4. The dropped test and the member to admin change: main's behaviour IS the accepted contract

- Dropped "canonical self-assignment" test: main's strict-runtime-enforcement.test.ts:296-392 (from #602, the P0 closure) already tests exactly this with a scoped key. A key {project:[read], work_item:[read,update]} gets 403 while the project-scoped role lacks `work_item:update` (:362 expectation 403), then 200 after the role is given `work_item:update` (:366-392). That matches the spec: assignment.md:122 `work_item:assign · orSelfTarget(body.assigneeId, work_item:update)`, assignment.md:29 (AS-2), and rbac.md (RBAC ∩ key scope; membership capabilities come from the role). #589's test expected 200 with a project role lacking `work_item:update`, which contradicts that intersection. Main's version is the accepted, more precise contract. The omission is correct.
- Residual coverage loss (NON-BLOCKING N2): #589's second half ("key scope `work_item:assign` cannot widen a member role, state and activity unchanged") has no exact twin on main. Main's test at :201-292 covers key-denial before mutation, and the 403-then-200 case covers role-limited widening, so the gap is small.
- member to admin: rbac.md:406 lists the `member` capabilities without `project:create`, and `admin` (rbac.md role table) holds it. apps/api/src/project/policy.ts:99-101 declares `capability: "project:create"`. Under main's strict policy a `member` can never get 200, so the change is required by the spec, not a weakening. The new test still covers null scope, malformed scope, valid scope (200) and viewer role denial (403).
- The HEAD test uses `createApp()` (the file's helper on main, line 50) rather than #589's `createStrictApp()`, which does not exist on main. Consistent with the file.

## 5. Docs: decision-log entry

The entry is NOT invented. It is a verbatim copy of the entry Thomas himself committed in #589 99528ca5 (author Thomas Hein Thura, 2026-10-07, "chore: keep manual role seeding private"); git shows the same text. It contains Thomas's quoted instruction. It is not on main today (grep of 954eb840 finds nothing). Main's 2026-10-06 entry it sits beside (decision-log.md:418) exists. Identifiers: AK-9 is named in its authority doc (webhooks-and-api-keys.md); `pnpm test:seed` exists (package.json:17); no new env var, table, event key or capability is introduced.

Defects of the entry as it now stands on main (all NON-BLOCKING, see N1/N3):
- AGENTS.md:52-57 says a decision-log record must carry its source (when, where, exact scope). The entry's source is "orchestrator, Thomas's explicit instruction relayed for this task, 2026-10-07". It cites no commit or PR, and "this task" is a different session from the one porting it. Recording a Thomas decision from an unmerged branch is fine, but the entry should cite #589 / 99528ca5 as the source and say it was carried into main during the S2 integration.
- The entry says "Remove the test-only role-user seeder ... from the repository delivery candidate". Main contains no such seeder (checked: no seed-test-users files in main). The sentence describes an action in #589, not on main. Also it points to a private path `/Users/heinthura/.codex/taskdesk-evidence/...` (a developer home path), an archive the log cannot verify.
- Placement: inserted at decision-log.md:~416 before the 2026-10-06 entry, below the 2026-10-09/10 entries. The file is already not strictly sorted, so this is acceptable, but the new entry should be marked as a carried-forward record.

## Findings

BLOCKING: none.

NON-BLOCKING:
- N1 (docs/07-planning/decision-log.md:~418-440). Add an explicit Source line naming #589 commit 99528ca5 (Thomas-authored) and the date it was carried into main; fix the "Recorded" line (it names a past orchestrator and "this task"); consider dropping or marking the ~/.codex archive path as an external, unverifiable reference; say the "remove" clause was executed in #589 and is a no-op on main. Reason: AGENTS.md:52-57 requires the source; without it the entry cannot be treated as a verifiable Thomas decision.
- N2 (tests/api-integration/strict-runtime-enforcement.test.ts). #589's "key scope cannot widen a member's assign role (state and activity unchanged)" half of the dropped test has no exact twin on main. Optional: add it to the existing assignment test (:201-392) if the conductor wants the coverage back.
- N3 (docs/04-engineering/testing-strategy.md:~446-451). The new "### Manual role verification" heading is followed by the unrelated "Three sizes: minimal/realistic/hostile" paragraph, which now reads as part of that section. This structure is inherited verbatim from #589. Consider moving the heading below the sizes paragraph (docs-only).
- N4 (shadow-middleware.ts:327-328, :467). Shadow still records `identityKind` as "session" for an impersonated session while the resolved identity credential is now "impersonation". Same as #589; harmless today, worth a note for the Sol reviewer.
- Pre-existing observation, not S2: the author's report names `allowDormantDefaultRole` (#589 047cf99f) as an S1 residual. I did not verify it; route to the S1 owner.

## What I did not check
Test execution (static review only; author-reported counts not re-run), identity/connection-admin.ts S1 residual, the 0092/0094/0106 step-up claim beyond the file list, the OpenAPI/route-policy checks.
<!-- END REPORT (sha256 077635b6f780ff0ba48d2c57192d9a31c9e7ad49bc5c576b6c74d63c31bd786f) -->

<!-- BEGIN REPORT (agent ac15bf960665f5c7c; model claude-sonnet-5-5; role ordinary review B (runtime/tests); candidate 49bc18eff760472d77d077cf00cd098858a5cdfc; sha256 f0e8a0b9452e7e6b39a68fd23ea8d7b081052e3a7b714c0433c32747cccaa559) -->
# S2 auth hardening - independent ordinary reviewer B

- Model: Claude Sonnet 5.5 (claude-sonnet-5-5), Luna-tier ordinary reviewer. Context id: session 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh review subagent; did not author/direct/remediate).
- **Reviewed head:** 49bc18eff760472d77d077cf00cd098858a5cdfc (verified; base 954eb84094e009658943af1e294d3b8a48d17f69, 3 commits)
- Verdict: **APPROVE, no blocking findings.** Three non-blocking findings and test-adequacy notes below.

## Setup
`git archive HEAD` exported to scratchpad/exp-b, node_modules symlinked from the candidate's own install (/private/tmp/claude-501/s2). The main checkout's node_modules is stale (no pino/prom-client) and was not used. A throwaway `git init -b main` snapshot was made inside the export only so git-baseline permission tests can resolve a merge base.
Container `s2-review-b-pg`: postgres:18-alpine, `--rm`. NOTE: the mandated `--tmpfs /var/lib/postgresql/data` makes the pg18 image exit at startup (pg18 wants the mount at /var/lib/postgresql), so I used `--tmpfs /var/lib/postgresql`. DB `taskdesk_test`, port 55432.

## Commands and counts (export, sandbox disabled for port binding)
- API typecheck (4 tsconfigs: main, permissions, tests, rls-prototype): all exit 0.
- Unit (`apps/api` test:unit): 96 files / 707 tests passed.
- test:permissions: 14 files / 88 tests passed.
- check:route-policy: passed (exit 0). check:openapi: "matches the API (208 operations)".
- Changed integration files (local-factor-policy[+concurrency], permissions-shadow-mode, strict-runtime-enforcement): 4 files / 55 tests passed. seed config: 2 files / 18 passed. seed-cli unit: 1 file / 6 passed.
- Full integration suite on private `taskdesk_test` DB: 149 files / 1737 tests passed, 0 failed.
- (Earlier failures with the stale node_modules or in the network sandbox / no .git were environmental and vanished on correct setup.)

## Mutation checks (temp copy, deleted afterwards)
1. Revert 403-before-503 (`if (false && error instanceof InactiveFactorIdentityError)`): local-factor-policy test fails "expected 503 to be 403". Caught.
2. Revert shared identity in shadow (key passed with enabled:true, no capabilities = old behaviour): shadow test "records agreement for a key whose stored scope includes the route capability" fails (no `agree` tally). Caught.
3a. Remove scope subset from resolveRequestIdentity (`capabilities: []`): 3 tests fail (shadow agree test; strict API-key assignment test; strict new "intersects legacy project writes" test, 403 vs expected 200). Caught.
3b. Remove the evaluator's key-subset clamp (widening mutation, `can()`): only the pre-existing strict "API-key assignment ... terminal route boundary" test fails (200 vs 403). The NEW strict test does NOT fail, and the shadow test does not fail (see finding 2).

## Runtime probe of resolveRequestIdentity (temp integration test, real DB)
| credential | result |
|---|---|
| session | credential=session, no keyCapabilities |
| impersonation (impersonatedBy) | credential=impersonation, no keyCapabilities |
| scoped key {project:[read], bogus:[x], work_item:[share]} | api_key, keyCapabilities=[project:read] (unknown pairs dropped) |
| unscoped key (permissions null) | api_key, [] (fail closed) |
| malformed scope | api_key, [] |
| disabled key (enabled=false) | null identity |
| key whose userId != request userId | null |
| key + impersonatedBy | api_key (key wins), subset kept |
| owner person inactive, key | null |
| inactive session user | null |
Shadow and strict now call the identical function with the same inputs (apiKey object from c.get("apiKey"), session.impersonatedBy), so identity and subset are the same in both modes. No path found where a key exceeds its scope or its owner: authority is owner RBAC, then clamped by `can()` to the key subset; null/malformed/unknown scope yields empty subset. Revoked/expired keys never reach identity: `verifyApiKey` returns invalid and `authenticateApiRequest` throws 401 before `apiKey` is set (code-read; no new runtime test of those two states in this change).

## 403-before-503 analysis
- Not an enumeration oracle: `enforceLocalFactorEnrollment` only acts on the caller's own authenticated agent-portal session (`userId` from the session); the 403/503 difference reveals only the caller's own account state. No input-supplied identifier is looked up. Unauthenticated callers get 401 earlier.
- Applies at all five call sites (the /api middleware, the other http group, and the three websocket upgrade paths) because they share the one helper; the integration test exercises only `GET /api/workspace`. API-key and portal (customer) sessions skip this check entirely (unchanged).

## Findings
1. (Non-blocking, claim gap) Ordering is only partial. In `loadLocalFactorState` the instance-settings read and `parseLocalFactorPolicy` run BEFORE the person lookup, so an inactive identity still gets 503 when the instance setting row is missing or the stored policy fails to parse. The commit message/decision wording "denied with 403 before a factor-policy 503" is true only for the missing/inactive-person branch. Either reorder (resolve person first) or narrow the wording. No test covers this.
2. (Non-blocking, test adequacy) Evaluator-clamp mutation 3b is not caught by the new strict test: its null/malformed-scope cases are denied by the legacy `apiKeyScopeSatisfies` middleware and the viewer case by RBAC, so only the "valid scope returns 200" assertion exercises the new identity path. Shadow coverage is a single agree case; there is no shadow negative (key lacking scope -> expected policy deny/agree-deny) and no test that shadow and strict yield the same subset. No direct unit test for `resolveRequestIdentity` (disabled, owner-mismatch, impersonation, inactive owner, unknown-resource dropping are only covered by my probe, not the repo). Suggest a small table-driven test equal to the probe above.
3. (Non-blocking, behaviour note) Shadow now sets credential `impersonation` for impersonated sessions (previously always `session`), while `identityKind` recorded by `credentialKindFor` still says `session` for those; cosmetic mismatch in shadow telemetry only. Also better-auth scope pairs with no registered capability (e.g. `work_item:share`) are dropped, so strict/shadow are fail-closed stricter than legacy for such keys (documented in the docs diff).

## Cleanup proof
- `docker stop s2-review-b-pg` (--rm removes it); `docker ps -a --format '{{.Names}}' | grep -c s2-review` = 0.
- Baseline before I started: 19 containers (`docker ps -aq | wc -l` = 19). Afterwards: 20, the extra one is `s3-pg` (postgres:18-alpine, Up) belonging to another lane, started during my review; not mine and untouched. Mine: 19 + 0 = 19 containers of the original set intact.
- Candidate dir /private/tmp/claude-501/s2: HEAD still 49bc18ef, `git status` clean. No edits, commits or pushes. Mutation copy exp-m deleted; export kept at scratchpad/exp-b.
<!-- END REPORT (sha256 f0e8a0b9452e7e6b39a68fd23ea8d7b081052e3a7b714c0433c32747cccaa559) -->

<!-- BEGIN REPORT (agent a40453c91609ae2db; model claude-opus-5-5; role Sol-tier security review; candidate 49bc18eff760472d77d077cf00cd098858a5cdfc; sha256 36c9cfd0e1d47a1378b92e43894339287c58822aa6adae345a232414f559c707) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:s2-sec-opus@3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh subagent context; the ID is the parent session's, because the harness exposes no separate subagent ID)
**Reviewed head:** 49bc18eff760472d77d077cf00cd098858a5cdfc

**Verdict: PASS. No blocking findings at this exact head.** The candidate adds no path where an API key acts beyond (key scope ∩ owner's current capabilities). The new strict and shadow code builds the identity through one shared function. The 403-before-503 change denies correctly and keeps a missing identity fail-closed. There are five non-blocking findings. One of them (N1) is a pre-existing gap on `main` that this review confirmed by running it. It should be filed as its own security issue.

- Base: `main` 954eb84094e009658943af1e294d3b8a48d17f69. Diff: `git diff 954eb840..49bc18ef` (3 commits, 14 files, +368/−67).
- Source train: #589 2350397b18f83ed417bf63d73970daacdbaae49c. The merge-base with `main` is 3096cb04.
- Policy read: `main` 954eb840 `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, and `docs/01-architecture/rbac.md` (the session-only, elevated and MCP sections).
- The author's report `/private/tmp/claude-501/s2-out.md` was **not used as evidence**. Every claim below was checked against source or by running it.
- I did not author, direct or fix this candidate.

---

## Scope examined

- `apps/api/src/permissions/resolve-request-identity.ts` (new), `shadow-middleware.ts`, `strict-policy-enforcement.ts`, `resolve-identity.ts` (comment and type changes only).
- `apps/api/src/auth/local-factor-service.ts` and `apps/api/src/index.ts` (`enforceLocalFactorEnrollment`).
- Unchanged code read for context:
  - `utils/authenticate-api-request.ts`, `utils/verify-api-key.ts`, `utils/require-api-key-permission-scope.ts`, `utils/require-workspace-capability.ts`, `utils/workspace-access-middleware.ts`, `utils/has-project-reach.ts`.
  - `instance/require-instance-admin.ts`, `pending-action/service.ts`, `ws/native-work-item-realtime.ts`, `auth/factor-status-api.ts`.
  - `identity/repository.ts` (person lifecycle), `auth.ts` (apiKey and admin plugin config).
  - `packages/permissions/src/evaluator.ts` (`can`, `evaluatePolicy` sessionOnly/elevated).
  - `@better-auth/api-key@1.6.25` create endpoint (`permissions` is server-only).
- Tests: `local-factor-policy`, `permissions-shadow-mode`, `strict-runtime-enforcement`, `api-key-self-mutations`, `resolve-identity` (integration and unit), `require-api-key-permission-scope` unit, and `seed-cli`.

## Adversarial questions — answers

1. **Can a key exceed key scope ∩ the owner's current capabilities?** No, not in the candidate, in strict or shadow mode.
   - **Strict:** `strict-policy-enforcement.ts:103-119` calls `resolveRequestIdentity`. That projects the stored scope through `apiKeyCapabilitySubset`, which accepts only exact registered `resource:action` pairs. `can()` in `evaluator.ts` then intersects the result with authority loaded live (`resolveIdentity` re-reads roles on every request).
   - **Legacy:** `assertCallerHasCapability` (`require-workspace-capability.ts:177`) refuses before the role check.
   - **Probes run at this head, strict mode:**
     - downgrading the owner admin→viewer after issuing the key: 200 → **403**;
     - expired key: **401**; disabled (revoked) key: **401**;
     - inactive owner: **401**; banned owner: **401**;
     - key scoped `{"instance":["admin"]}` on an instance-admin owner, `GET /api/instance/identity-connections`: **403**;
     - instance-admin owner whose key has `project:create`, creating in a workspace the owner is not a member of: **403**;
     - key on `POST /api/me/step-up/challenges`: **403**; key on `POST /api/instance/observability/metrics-token/rotate`: **403**.
   - **Keys never satisfy step-up.** Elevated policies must be `sessionOnly`. `evaluatePolicy` refuses any credential other than `session` before evaluating anything else.
   - **Keys cannot reach `instance:admin`.** `require-instance-admin.ts:43` builds the identity without a capability subset, so `keyCapabilities = []`.
   - **Portal:** keys on the customer host get `403 session_required` (`authenticate-api-request.ts:80-85`).
   - **SCIM:** uses its own bearer (`resolveScimBearer`). API keys are not accepted there.
   - **Who can set scope:** clients cannot set key scopes. `permissions` is a server-only property in `@better-auth/api-key`, so client-created keys have null scope, which means zero grants.
2. **Mode divergence.** Strict and shadow now resolve keys identically. Mutation M3a proves shadow no longer uses an un-subsetted identity. Six other callers still call `resolveIdentity` with no capability subset (N2). All of them fail **closed**, with `keyCapabilities = []`; none falls back to the owner's RBAC.
3. **403 before 503.**
   - **Ordering:** authentication runs first (`authenticateApiRequest`). The factor gate runs after it, so an unauthenticated request still gets 401.
   - **Oracle:** the 403/503 difference is visible only to the authenticated principal about their own account, so there is no cross-account account-state oracle.
   - **Missing identity:** stays 503.
   - **Inactive identities that still get through:**
     - the exempt route `GET /api/me/security/factors` still answers 503 rather than 403 (N3, fail-closed);
     - portal customers are blocked earlier by `hasCustomerPortalIdentity`, which requires `active = true`;
     - on the default legacy-only config, an inactive or **banned** owner's *still-enabled* API key is honoured (N1, pre-existing).
4. **The author's claim "API key scope enforcement already on main via #602, superseded" is true for every surface that exists on `main`.**
   - `main`'s `require-api-key-permission-scope.ts`, `require-workspace-capability.ts` and `require-workspace-permission.ts` are equivalent to or stricter than #589's. `main` has an explicit `CapabilityCredential` kind; #589 has an implicit `apiKey?`.
   - The session-only self-write policies from f4789aef (notification, notification-preferences, user) are byte-identical on `main`.
   - The inactive-identity commit 27fb81fe was ported faithfully, with the repository query inlined.
   - #589's key-scope fixes for service-calendar (fdaef1ce), saved views (7163ad86) and export search (2d438767, part of 8c3ca82c) apply to modules that **do not exist on `main`** (`service-calendar/`, `view/`, `work-item/search/`). They are not lost. They must land together with those features. That is a tracking obligation for the later lanes, not a defect here.
5. **Mutations:** see the table below. Every mutation that targets the candidate's own changes was killed. Two fail-open variants survive the candidate's *new* tests and are caught, or not caught, only by older tests (N4).

## Findings

**N1 — NON-BLOCKING (pre-existing on `main` 954eb840, not changed by this diff; file a security issue). Legacy authorization does not check whether the person is active or banned, so a banned owner's API key keeps working under the default config.**

- Where: `apps/api/src/utils/require-workspace-capability.ts:171-205` (no `person.active` or `user.banned` check), `apps/api/src/utils/verify-api-key.ts:39-55` (no ban check), and `apps/api/src/permissions/strict-policy-enforcement.ts:629` (`enforcedPolicySources.size === 0` → `next()`). `TASKDESK_POLICY_ENFORCE` defaults to empty (`configuration-reference.md:86`).
- Attack:
  1. An instance admin bans user U through Better Auth's admin plugin. It is reachable through `api.on(..., "/auth/*")` in `index.ts`.
  2. Better Auth revokes U's sessions but not U's API keys. `identity/repository.ts:2500` disables keys only on the person-lifecycle deactivation path, and only where `referenceId = userId`.
  3. U keeps using an existing scoped key on every route that is not strictly enforced.
- Reproduced at this head with `TASKDESK_POLICY_ENFORCE=""`: a banned owner's key `{project:[create,read]}` got `POST /api/project` → **200** and the project row was created. An inactive owner whose key was still enabled got 200/200.
- With strict enforcement on, both get 401, because `resolveIdentity` refuses them.
- The `resolve-identity.ts` S6 comment assumes it is "the one place that resolves identity for BOTH paths". That is untrue while legacy-only mode is the default.
- Recommended fix: an active-and-not-banned gate for key credentials in `authenticateApiRequest`, or ban disabling the user's keys, plus regression tests.

**N2 — NON-BLOCKING (fail-closed, pre-existing). Six un-subsetted `resolveIdentity` callers remain, so correctly scoped keys are wrongly denied and shadow now records divergences.**

- Where: `utils/has-project-reach.ts:85`, `instance/require-instance-admin.ts:43`, `pending-action/service.ts:247,336,387`, `ws/native-work-item-realtime.ts:118,195`. None passes `capabilities`, so `resolve-identity.ts:306` yields `[]`.
- No escalation is possible: `[]` denies every capability.
- Effect: a key with `{work_item:["read"]}` is refused 403 on any `requireProjectReach` route. `workspace-access-middleware.ts:467-481` and `require-work-item-reach.ts:193-208` reach this through `projectReadDecision`. Native realtime is refused the same way.
- Consequence for this candidate: shadow (now subsetted) will log `legacy_deny_policy_allow` for those routes, where it previously "agreed". This is a fidelity and availability issue, not a security one.
- Recommended fix: route these callers through `resolveRequestIdentity` in a follow-up. `require-instance-admin` must stay fail-closed, or must explicitly decide whether a key with `instance:admin` scope may use non-elevated instance GET/PATCH. rbac.md:834 allows it; the runtime currently forbids it.

**N3 — NON-BLOCKING (fail-closed inconsistency). The exempt route `GET /api/me/security/factors` still answers 503, not 403, for an inactive identity.**

- Where: `index.ts:197` skips the gate for this path. `auth/factor-status-api.ts:47-48` catches every error, including `InactiveFactorIdentityError`, as 503.
- Scenario: a deactivated staff member signs in again (session creation has no active-person check), then calls this route and gets 503 `Factor policy is unavailable` instead of 403.
- No data is exposed. But the slice's stated contract ("inactive → 403 before factor-policy failure") does not hold on this one route, and no test covers it.

**N4 — NON-BLOCKING (test strength). The new tests do not catch fail-open variants of the very change they cover.**

- `strict-runtime-enforcement.test.ts:395` ("intersects legacy project writes…") still **passes** when keys resolve as `session`, i.e. at full owner RBAC (mutation M1b). The legacy `assertCallerHasCapability` also denies null-scope, malformed-scope and viewer keys, so the test cannot tell which layer refused.
  - M1b and M4 are killed only by the older test "denies an API-key assignment at the terminal route boundary".
- `permissions-shadow-mode.test.ts:406` asserts only agreement on an *allowed* key. Mutation M3b (shadow evaluates the owner's identity with no key clamp) **survives**.
- Recommended additions:
  - a strict test on a route whose legacy layer has no key-scope check, or one asserting the strict witness or denial code;
  - a shadow test with an out-of-scope key that expects the policy side to deny and the outcome to be `agree`.

**N5 — NON-BLOCKING (diagnostics only).** `shadow-middleware.ts:327,467` still labels `identityKind` with `credentialKindFor`, which returns `"session"` for impersonation. The identity itself is now resolved as `"impersonation"`, so shadow records can carry a mismatched credential label. No authorization effect.

No BLOCKING findings.

## Mutation results (temp copy of the exact head; each mutation applied alone and then reverted)

| ID | Mutation | Result |
|---|---|---|
| M1a | drop `capabilities: apiKeyCapabilitySubset(apiKey)` (scope → `[]`) | **killed** — 3 failed (new shadow test, new strict test, existing assignment test) |
| M1b | keys resolve as `credential: "session"` (no clamp, full owner RBAC) | **killed** — 1 failed (existing assignment test only); the new strict and shadow tests passed (N4) |
| M2a | remove `if (inactivePerson) throw new InactiveFactorIdentityError()` | **killed** — new local-factor test |
| M2b | remove the 403 branch in `enforceLocalFactorEnrollment` | **killed** — new local-factor test |
| M2c | mapper ignores `person.active` | survived the 4 S2 files; **killed** by `resolve-identity.test.ts` (2 tests) |
| M3a | shadow passes the key with `permissions: null` (the old un-subsetted behaviour) | **killed** — new shadow test |
| M3b | shadow passes `apiKey: undefined` (owner RBAC) | **survived** (N4) |
| M4 | strict `identityFor` passes `apiKey: undefined` | **killed** — existing assignment test only |

## Commands run

```
git -C /private/tmp/claude-501/s2 rev-parse HEAD            # 49bc18eff760472d77d077cf00cd098858a5cdfc
git log --oneline 954eb840..HEAD ; git diff --stat 954eb840..HEAD ; git diff 954eb840..HEAD
git archive 49bc18ef | tar -x -C /tmp/claude-501/s2rev      # clean export; node_modules symlinked read-only from the worktree
git merge-base 2350397b 954eb840 ; git log --oneline 3096cb04..2350397b -- <auth/permissions paths>
git show 27fb81fe | 8c3ca82c | 9abde834 | f4789aef | d8557d0e | 2d438767 | 7163ad86 | fdaef1ce   (stat and diffs)
git diff 954eb840 2350397b -- apps/api/src/utils/{require-api-key-permission-scope,require-workspace-capability,require-workspace-permission,verify-api-key,authenticate-api-request}.ts
git cat-file -e 954eb840:apps/api/src/{service-calendar,view,work-item/search}   # all absent on main
docker run -d --rm --name s2-sec-pg --tmpfs /var/lib/postgresql:rw -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=s2sec_test -p 127.0.0.1:55871:5432 postgres:18-alpine
TASKDESK_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55871/s2sec_test \
  npx vitest run --config vitest.integration.config.ts local-factor-policy permissions-shadow-mode \
  strict-runtime-enforcement api-key-self-mutations          # 4 files, 54/54 passed
npx vitest run --config vitest.integration.config.ts resolve-identity.test.ts   # 1 file, 21/21 passed
npx vitest run --config vitest.config.ts scripts/seed-cli.test.ts tests/api/permissions/resolve-identity.test.ts \
  tests/api/utils/require-api-key-permission-scope.test.ts   # 3 files, 70/70 passed
npx tsc --noEmit -p tsconfig.json ; npx tsc --noEmit -p tsconfig.tests.json     # both clean
scratchpad/mut.sh <M1a..M4>                                  # mutation table above; logs /tmp/claude-501/mut-*.log
ad-hoc probe test (temp copy only), strict env and empty env # /tmp/claude-501/probe-results{,-legacy}.txt
docker stop s2-sec-pg                                        # --rm removed it
```

**Container count:**

- Before my run: 20 (the 19 baseline plus `s2-review-b-pg`, which belongs to another lane).
- After I stopped `s2-sec-pg`: 21 = 19 baseline + `s2-review-b-pg` + `s3-pg`. `s3-pg` was created at 16:11 by another lane.
- `s2-sec-pg` is gone. **19 baseline containers are confirmed unchanged by this review.**
- The temp copies `/tmp/claude-501/s2rev` and `/tmp/claude-501/s2mut` were deleted. Nothing was edited, committed or pushed in the candidate worktree, whose `git status` is clean.

## Residual risk

- N1 is the material residual. On a default deployment (strict enforcement off), a key's validity is not tied to whether its owner is banned, and only partly tied to whether the owner is active. Keys are disabled on lifecycle deactivation only where `referenceId = userId`; a key with `referenceId` NULL relies on the boot-time `migrateApiKeyReferenceId` backfill.
- Session creation does not refuse inactive staff persons. The agent-portal factor gate is now the only general inactive-session denial for staff, and N3 is its one exemption.
- N2 means the shadow comparison for project-reach routes will be noisy for keys. Read divergence buckets for key traffic carefully before any strict cutover.

## Not checked

- An MCP-key-specific path. `is_mcp` is not modelled yet (resolve-identity KNOWN GAP 2).
- The SCIM bearer implementation beyond confirming that it does not accept API keys.
- Better Auth's internal ban and session-refresh behaviour, beyond the source reads described above.
- The OIDC sign-in path's handling of inactive persons.
- A full integration-suite run, the Docker image build, and UAT.
- The route-by-route list of which sources the deployment actually enforces.
- Typecheck of `tsconfig.permissions.json` and `tsconfig.rls-prototype.json`.
- The docs-only changes, reviewed for accuracy only: `notifications.md` and `webhooks-and-api-keys.md` AK-9 move the text without changing its meaning, and the decision-log entry is appended newest-first.
<!-- END REPORT (sha256 36c9cfd0e1d47a1378b92e43894339287c58822aa6adae345a232414f559c707) -->

<!-- BEGIN REPORT (agent a6a5e4b38733b04b5; model claude-sonnet-5-5; role ordinary closure review; candidate 859d250e5b61101615cb5bc6df328f717ee93cec; sha256 510d0632c45e678b4af0b491fabcaeffb7b507ac8899faff7d27f3bb3ec8eba7) -->
# S2 auth hardening: closure review (ordinary tier)

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent closure-review subagent context (Sonnet 5.5, Luna tier); no prior involvement in authoring, directing or remediating this work.
**Reviewed head:** 859d250e5b61101615cb5bc6df328f717ee93cec
Comparison base: 49bc18eff760472d77d077cf00cd098858a5cdfc (delta = 4 commits, 11 files, +540/-23)

## Verdict: CHANGES REQUIRED (one BLOCKING docs defect; code remediations are all correct)

All code remediations verify. The one blocker is a corrupted decision-log file at this head. It is a 5-line fix.

## Findings

### BLOCKING
**B1. docs/07-planning/decision-log.md has a stray 5-line fragment prepended at line 1 of the file.**
Commit 859d250e adds this ahead of the first real entry (`### 2026-10-10 · Owner decision: SCIM-provisioned...`):

    The
    role-seeder source, tests, and review evidence are preserved as an immutable private archive
    outside the repository; that archive contains no generated credentials or operational
    secrets. This is a user-directed scope change, not a test-gate waiver. The general
    seed-profile test suite remains in place.

It is a leftover of a botched edit. The properly reworded text is also present in the 2026-10-07 "Keep test role seeding private-only" entry (about line 433), so the fragment duplicates it.

- Verified with `git show 859d250e:docs/07-planning/decision-log.md | head`, and with `git show 49bc18ef:...`, which begins cleanly at `### 2026-10-10`.
- The log is append-only and its first lines are the newest entry. A headless paragraph at the top of the file is a defect in the control-plane record, and the CLAUDE.md "check newest entries first" convention reads it as part of the top entry.
- Fix: delete lines 1-6 (the fragment plus the blank line) so the file starts at `### 2026-10-10 · Owner decision: SCIM-provisioned...`.

(Note: the author's worktree, /private/tmp/claude-501/s2, now has uncommitted edits to decision-log.md, resolve-identity.ts and api-key-owner-state.test.ts that appeared while I was reviewing. They look like in-progress fixes. I did not review them. They are not in 859d250e, and this verdict applies only to the committed head, which I exported with `git archive`.)

### NON-BLOCKING
**N1. Stale security comment at HEAD, apps/api/src/permissions/resolve-identity.ts lines 357-360.** It still says the API-key path (`verifyApiKey`) "does not check it [banned] at all". That is now false because af1363fb added the owner check. It is a comment-only defect in a security-scope file. The uncommitted worktree edit appears to rewrite it; make sure that lands.

**N2. The new owner check is a strict subset of strict `resolveIdentity`.** `apiKeyOwnerIsActive` checks user exists, not banned, person exists and active. `resolveIdentity` also refuses when the organisation row is missing, inactive or has portal access off. A key whose owner's organisation is suspended therefore still passes `verifyApiKey` with enforcement OFF. The delta's stated target (banned/inactive owner) is closed. Strict mode still covers the organisation case, and the legacy layers cover the other cases. Worth a docs note, not a gate.

**N3. Test coverage is slightly narrower than the "every route family" comment.** The owner-state test covers agent project list, instance-admin identity-connections, pending-actions, asset bearer and a mutating POST. There is no test for native ws realtime. All three callers of `verifyApiKey` flow through `authenticate-api-request.ts`, so the shared point does cover it by construction.

**N4. Carry-over from the author's own list (not a regression):** the Opus N2 six non-subset resolvers and N5 `identityKind` labelling stay open. They are acknowledged, fail closed, and out of scope here.

## Check 1: are the remediations correct and complete?

- **Opus N1 / banned or inactive owner key (af1363fb): CLOSED, CORRECT.** `verifyApiKey` returns null (so 401) when the user is missing or banned, or the person is missing or inactive. The check sits after the enabled/expiry key lookup and before the key object is built.
  - Valid keys with an active owner: behaviour unchanged. The control request in the new test returns 200 before the owner is disabled, in both enforcement modes.
  - The asset bearer path (`resolveAssetBearerOrCookie`) and `authenticateApiRequest` both call `verifyApiKey` four times in total. Those are the only callers, so every route family is covered.
  - Cost: one extra indexed query per key-authenticated request. `user.id` is the PK and `person_userId_idx` is a btree index on `person.user_id`, limit 1. It is a single join, with no N+1. Session requests are untouched. Acceptable.
  - Fail-closed edge cases are correct: an empty owner id returns false, and `referenceId ?? userId ?? ""` is the same owner derivation the returned object already used.
- **B#1 / Opus N3 (61080130): CLOSED.** In `loadLocalFactorState` the person lookup (and the `InactiveFactorIdentityError` throw) now runs before the instance-setting read and policy parse. `GET /api/me/security/factors` now maps `InactiveFactorIdentityError` to 403.
  - OpenAPI 403 addition: correct. The route declares 403 with a `{message: string}` body matching what the handler returns. `tests/api-contract/openapi.json` carries exactly that and nothing else changed. `check:openapi` passes (208 operations, matching).
  - Missing identity still returns 503.
- **B#2 / Opus N4 (43694c47): CLOSED.** There are three new test files/blocks, all non-vacuous per check 3.
  - Strict clamp on `PUT /api/activity/comment`.
  - Shadow negative with an out-of-scope key.
  - `resolve-request-identity.test.ts`, 10 cases.
- **A N1 / N3 (859d250e): PARTIALLY CLOSED.**
  - The 2026-10-07 entry now carries a `**Source:**` line citing #589 `99528ca5`, and a `**Carried to main:**` line. The private `~/.codex` path is gone, and the "Recorded" session line is gone. It adds no new decision.
  - The testing-strategy "Three sizes" paragraph is moved back above "Manual role verification". That is correct.
  - BUT the commit also introduced the stray fragment (B1).
- **Regressions:** none in code. The one regression in the delta is the decision-log fragment (B1), plus the stale comment (N1).

## Check 3: mutations (each applied alone, in an isolated export, then reverted and cmp-verified against HEAD)

| Mutation | Test file(s) run | Result |
| --- | --- | --- |
| verifyApiKey owner check disabled (`if (false && ...)`) | api-key-owner-state | 4 failed / 4 (banned/inactive x enforcement off/on) |
| M1b: key credential resolved as session in `resolveRequestIdentity` | resolve-request-identity, strict-runtime-enforcement, permissions-shadow-mode | 9 failed / 55, including the new strict clamp test and new shadow negative |
| M3b: shadow-middleware passes `apiKey: undefined` | the same three files | 1 failed: "records an agreeing denial, not a policy allow, for a key lacking the route capability" (shadow negative) |
| M4: strict `identityFor` passes `apiKey: undefined` | strict-runtime-enforcement | 2 failed / 10: the new "clamps a key to its stored scope..." test AND the older terminal-route API-key assignment test |
| Ordering: instance-setting read moved back above the person lookup | local-factor-policy | 1 failed / 9: "denies an inactive identity as forbidden even when the factor policy store is unusable, including on the exempt status route" |

All five mutations are killed. The author's claim that the new strict test kills M4 is confirmed.

## Check 4: decision-log append-only
- vs 49bc18ef: the only removed lines are the 7 lines of the 2026-10-07 entry the author added in that same branch (49bc18ef). Those are the old archive-path wording and the "Recorded" line. No pre-existing main entry was touched.
- vs main 954eb840: the net diff to decision-log.md is 32 insertions, 0 deletions. No existing entry was rewritten.
- The new provenance text adds no new decision. The log passes `check:policy`.
- The only defect is the prepended fragment (B1).

## Check 2: commands run (on a `git archive` export of 859d250e, packages rebuilt with tsc)

Because the export has no git history, 5 tests of test:permissions (git-baseline/monotonicity, merge-base needs history) fail on the export. They are artefacts of the archive, not the candidate. I ran the gate on the real worktree to confirm.

| Command | Where | Result |
| --- | --- | --- |
| `npm run typecheck` (apps/api, 4 tsconfigs) | export | exit 0, clean |
| `npm run test:unit` | export | 96 files, 707 tests, all pass |
| `node scripts/ci/route-policy-gate.mjs` (runs test:permissions) | worktree at HEAD (it had no tracked changes at that moment) | 14 files, 88 tests, 5 turbo tasks pass |
| `npm run test:permissions` | export | 3 files / 5 tests fail on missing git history; this is an export artefact only (run on the worktree above) |
| `node scripts/ci/check-openapi.mjs` | export | pass, 208 operations |
| `check-vocabulary`, `check-env`, `check-events`, `check-policy` | export | all exit 0 (31 event keys / 448 files; 8 policy files coherent) |
| `biome ci .` | export | 1925 files, 0 errors, 174 warnings, 1 info |
| 5 new/changed integration files (api-key-owner-state, local-factor-policy, permissions-shadow-mode, resolve-request-identity, strict-runtime-enforcement) | export + private DB | 5 files, 68 tests, all pass |
| FULL integration suite (`npm run test:integration`) | export + private `s2c_test` DB | **151 files, 1752 tests, all pass** (731 s) |
| mutations | see table above | all killed |

Sandbox note: unit tests need `listen` and so had to be re-run with the sandbox disabled (EPERM otherwise); this is a sandbox effect, not a candidate defect.

## Cleanup proof
- Container: one only, `s2-close-pg` (postgres:18-alpine, `-d --rm --tmpfs /var/lib/postgresql`, 127.0.0.1:55444, DB `s2c_test`). `docker stop s2-close-pg` then `docker ps -a | grep -c s2-close-pg` = 0 and `docker volume ls | grep -c s2c` = 0. The container list afterwards is identical to the list before (5 pre-existing containers, none touched).
- Export (`/private/tmp/claude-501/s2-closure-export`) and all scratch logs/scripts deleted.
- No edit, commit or push was made to the candidate worktree.

## Merge guidance
Fix B1 (delete the 6 stray lines at the top of decision-log.md), fix N1 (comment), then the head needs a new SHA and a re-confirmation of the exact new head. The code at 859d250e is otherwise approved: all remediations correct, no code regressions, and the full suite, mutations and gates pass.
<!-- END REPORT (sha256 510d0632c45e678b4af0b491fabcaeffb7b507ac8899faff7d27f3bb3ec8eba7) -->

<!-- BEGIN REPORT (agent a606ed9a5cc3af456; model claude-opus-5-5; role Sol-tier security closure; candidate 859d250e5b61101615cb5bc6df328f717ee93cec; sha256 6439334651cb421a2ee8f3e76f32a3efc312624253f835ecd32a843404799e17) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:s2-secclose-opus@3a9e9ce4-8409-47d4-b1be-1f1544697e70 (a fresh subagent context; the ID is the parent session's, because the harness exposes no separate subagent ID)
**Reviewed head:** 859d250e5b61101615cb5bc6df328f717ee93cec

**Verdict: PASS. There are no blocking security findings at this exact head.**

- **N1 is closed.** af1363fb closes N1 for every consumer of API keys. All key verification goes through `verifyApiKey`, and nothing bypasses it.
- **The 61080130 reordering is safe.** It adds no oracle and no bypass, and a missing identity still returns 503.
- **Mutations.** The required mutations (N1, M1b, M3b and M4) are all killed now, and so are the new M5 and M6. M3b survived at 49bc18ef and M1b was caught only by an older test there.
- **Diff shape.** The full diff from `main` keeps the shape of my prior PASS and adds no capability path.
- **Non-blocking findings.** There are four, listed below. **C1 is a corrupted top of `decision-log.md`. It should be fixed before merge.** It is docs-only.

Other context:
- **Base:** `main` 954eb84094e009658943af1e294d3b8a48d17f69.
- **Prior review:** the PASS at 49bc18eff760472d77d077cf00cd098858a5cdfc, with findings N1–N5.
- **Delta reviewed:** `git diff 49bc18ef..859d250e`, which is af1363fb, 61080130, 43694c47 and 859d250e. It touches 11 files, +540/−23.
- **Full diff from main:** `954eb840..859d250e` touches 19 files, +895/−77.
- **Independence:** I did not author, direct or fix this candidate. No author report was used as evidence.

---

## 1. Does af1363fb close N1 for every key consumer?

**Yes.**

**The gate.** `apps/api/src/utils/verify-api-key.ts:39-56,85-88` adds `apiKeyOwnerIsActive`. It is a join from `user` to `person` keyed by `referenceId ?? userId`. It returns `null`, which callers turn into 401, when:
- the owner id is empty;
- the user row is missing;
- `user.banned = true`;
- the person row is missing, so `personActive` is null;
- `person.active = false`.

`person_user_unique` (`schema.ts:1809`) guarantees at most one person per user, so `limit(1)` cannot pick between an active and an inactive row. The refusal set matches `resolveIdentity` (`resolve-identity.ts:353-362`). It refuses on `banned === true` whatever `banExpires` says, the same as the strict path.

**Every consumer reaches the gate.** I grepped the whole API for `x-api-key`, `Bearer`, `apikeyTable` and `verifyApiKey`.

| Consumer | Path to `verifyApiKey` | Result for a banned or inactive owner |
|---|---|---|
| Legacy layer (default `TASKDESK_POLICY_ENFORCE=""`) | `authGuard` → `authenticateApiRequest` (`authenticate-api-request.ts:89,108`) | 401 (tested, enforcement off) |
| Strict mode | same guard, then `resolveIdentity` (defence in depth) | 401 (tested, enforcement on) |
| Shadow mode | runs inside the same guard after authentication | not reached; 401 first |
| Asset bearer | `resolveAssetBearerOrCookie` (`authenticate-api-request.ts:151,162`) | 401 (tested: `/api/asset/:id`) |
| Instance admin | `authGuard` | 401 (tested) |
| Pending action | `authGuard` | 401 (tested: `/api/me/pending-actions`) |
| Realtime `/ws`, `/ws/user`, `/ws/:projectId` | `authenticateApiRequest` on upgrade (`index.ts:1411,1490,1560`) | refused at upgrade. Native `/ws` also re-authenticates on a timer (`native-work-item-realtime.ts:263,333`), so an open native connection is closed after a ban. See R2 for the other two. |
| MCP | `packages/mcp` is an external HTTP client that sends `Authorization: Bearer <TASKDESK_API_KEY>` (`taskdesk/client.ts:27`). It goes through `authGuard`. | 401 |
| SCIM | own bearer (`resolveScimBearer`, `scim-protocol.ts:53`); does not accept API keys | not applicable |
| Better Auth `/auth/*` with `x-api-key` | `enableSessionForAPIKeys: false` (`auth.ts:408`). The plugin's `verify` endpoint is `serverOnly` (`@better-auth/api-key@1.6.26 dist/index.mjs:1954`). `create`, `get`, `list`, `update` and `delete` require a session. No app code calls `auth.api.verifyApiKey`. | the key gives no authority here |

**Paths that bypass `verifyApiKey`.** None was found.
- `validate-workspace-access.ts:13-21` and `workspace-access-middleware.ts:524-530` read `apikeyTable` only to re-check that a key id already set by the guard belongs to the user.
- `pending-action/service.ts:277-357,737` reads key names and scope for display and approval.
- `identity/repository.ts:2499` and `instance/reset-mfa.ts:159` write to the table; they do not authenticate.

**TOCTOU inside one request.** The key lookup and the owner lookup are two non-transactional reads (`verify-api-key.ts:61-88`). They run before the handler. A ban committed after the owner read but before the handler's write is not seen by that one in-flight request. Session requests have the same millisecond window. Strict mode narrows it, because `resolveIdentity` re-reads later in the request. No caching exists, so the next request is refused. Non-blocking (R1).

**Ban after issue.** Covered. The key stays `enabled = true` in the table, but `verifyApiKey` refuses it on every request while the ban holds.

**Reactivation semantics.** Explanation only, not a defect:
- *Unban:* the owner's still-enabled keys work again, because ban does not disable keys.
- *Person reactivation:* keys stay disabled where deactivation disabled them (`repository.ts:2499-2507` acts only on `referenceId = userId`). A key with a NULL `referenceId` and `userId` set is not disabled on deactivation. It was refused while the person was inactive, and it comes back on reactivation.
- *Expired temporary ban* (`banned = true` with `banExpires` in the past): the key keeps returning 401 until Better Auth clears `banned`, which it does lazily at sign-in. This fails closed and matches the strict resolver.
- Whether unban or reactivation should bring keys back is a product decision for Thomas, if he wants one recorded. Today they come back.

## 2. Does the 61080130 reordering create an oracle or a bypass?

**No.**

- **Ordering.** `loadLocalFactorState` (`local-factor-service.ts:24-71`) now reads the person before it reads the instance setting.
  - It runs only for an already-authenticated agent-portal **session** (`index.ts:196-201`). API keys skip it. An unauthenticated caller gets 401 from `authenticateApiRequest` before it runs.
  - So the 403 / 503 / 200 difference is visible only to the principal, about their own account.
- **No cross-account oracle.** The key path returns the same bare 401 `Unauthorized` for an unknown, disabled, expired, banned-owner or inactive-owner key. The owner query runs only after a key hash matches, so any timing difference requires already holding the key.
- **A missing identity still returns 503.** No person row, or a person whose `side` is neither staff nor customer, reaches the plain `Error` path (`local-factor-service.ts:57-59`). It maps to 503 `factor_policy_unavailable` (`index.ts:212`). A database failure in either query also throws a plain error and returns 503.
- **Exempt route (closes N3).** `GET /api/me/security/factors` (`factor-status-api.ts:54-58`) now returns 403 for an inactive identity and 503 for everything else. The contract changes only in the 403 response added to `tests/api-contract/openapi.json`. A key caller cannot reach the 403, because an inactive owner's key already fails with 401. Customer sessions are blocked earlier by `hasCustomerPortalIdentity`.
- **No bypass.** The reordering only changes which error is raised first. The active-person filter still requires `active = true` (`:39-44`) before the function returns any state.

## 3. Tests and mutations

**Tests.** All runs used the clean `git archive` export of 859d250e and the private database `s2close_test` in `s2-secclose-pg`.

| Run | Result |
|---|---|
| Integration: `api-key-owner-state`, `api-key-self-mutations`, `local-factor-policy`, `local-factor-policy-concurrency`, `permissions-shadow-mode`, `resolve-identity`, `resolve-request-identity`, `strict-runtime-enforcement` | 8 files, **92/92 passed** |
| Unit: `tests/api/permissions/resolve-identity.test.ts`, `tests/api/utils/require-api-key-permission-scope.test.ts` | 2 files, **64/64 passed** |
| Typecheck: `tsc --noEmit` for `tsconfig.json`, `tsconfig.tests.json` and `tsconfig.permissions.json` | clean |

**Mutations.** Each was applied alone to a separate copy, run against those 8 integration files, then reverted.

| ID | Mutation | Result |
|---|---|---|
| **N1** | `verifyApiKey` skips the owner check | **killed**: 4 failures (banned and inactive, with enforcement off and on) |
| N1b | ignore `banned` | **killed**: 2 |
| N1c | ignore `person.active` | **killed**: 2 |
| N1d | missing person accepted (`personActive !== false`) | **survived** (C2) |
| N1e | missing user row accepted | **survived** (C2) |
| **M1b** | keys resolve as `session` with no clamp | **killed**: 9 failures across shadow, `resolve-request-identity` and strict (including the new "clamps a key to its stored scope…") |
| **M3b** | shadow passes `apiKey: undefined` | **killed**: new shadow test "records an agreeing denial, not a policy allow…" (closes N4 for shadow) |
| **M4** | strict `identityFor` passes `apiKey: undefined` | **killed**: 2 (the new clamp test plus the existing assignment test; closes N4 for strict) |
| M5 | remove the factor-status 403 branch | **killed**: local-factor "denies an inactive identity as forbidden even when the factor policy store…" |
| M6 | revert 61080130 (setting read before the person read) | **killed**: same test |

## 4. Shape of the full diff since main

`git diff --stat 954eb840..859d250e` changes these runtime files:
- `auth/factor-status-api.ts`, `auth/local-factor-service.ts`, `index.ts` (factor gate);
- `permissions/{resolve-identity,resolve-request-identity,shadow-middleware,strict-policy-enforcement}.ts`;
- `utils/verify-api-key.ts`.

The rest is tests, docs and the openapi contract.

- **No new capability path.** No route is added. No policy-registry or `*/policy.ts` file changes. No capability or scope grant is widened.
- **The only new response is a 403** on an existing session-only route.
- **Every runtime change since my prior PASS is a denial:** a 401 for a banned, inactive or missing owner, and a 403 for an inactive identity.
- **This is consistent with the prior PASS.** Keys still act only within key scope ∩ the owner's current capabilities, and the owner must now also be active and not banned on every path.

## Findings

No BLOCKING findings.

**C1: NON-BLOCKING for security; fix before merge (docs, control plane). `docs/07-planning/decision-log.md:1-5` starts with a stray fragment before the first heading.**

- **What it is:** the text begins `The` / `role-seeder source, tests, and review evidence are preserved…`. It duplicates part of the 2026-10-07 entry's paragraph.
- **Where it came from:** 859d250e, an edit misapplied at the top of the file.
- **Why it matters:** it is not part of any entry. The log is append-only and newest-first, so a headless paragraph at the top reads as an unattributed decision.
- **Fix:** delete lines 1–6. That is docs-only and changes the head, so a lightweight Sol re-confirmation of the new SHA is needed under the exact-head rule.

**C2: NON-BLOCKING (test strength). The af1363fb cases for a "missing owner user" and a "missing owner person" are in the code but have no test.**

- **Evidence:** mutations N1d and N1e survive the whole security suite.
- **What is safe today:** the code fails closed (`verify-api-key.ts:53-55`).
- **What could regress silently:** the condition `personActive === true` could be relaxed to `!== false`. A key owned by a user with no person row (for example a legacy user before the identity backfill) would then be honoured on the legacy layer.
- **Fix:** add one `api-key-owner-state` case that deletes, or never creates, the owner's person row, and one where `referenceId` names a user that does not exist.

**C3: NON-BLOCKING (stale comment). `apps/api/src/permissions/resolve-identity.ts:358-360` is now wrong.**

- It still says the API-key path (`verifyApiKey`) "does not check it at all" and that `resolveIdentity` is "the one place" that refuses a ban on both paths.
- After af1363fb that is false. A future reader could remove the `verifyApiKey` gate as redundant.
- **Fix:** update the comment to name both enforcement points.

**C4: NON-BLOCKING (process note).** The decision-log edit in 859d250e rewrites the body of the 2026-10-07 entry. It removes the private archive path and the "Recorded" line.

- This is within the PR: that entry is new in this diff and absent on `main`, so this is not an append-only violation against `main`.
- The note "carries the recorded decision forward unchanged" is accurate about the decision. The wording differs from #589 99528ca5.

Prior findings, rechecked:
- **N1:** closed.
- **N3:** closed.
- **N4:** closed. M1b, M3b and M4 are each killed by a test written for that mutation.
- **N2 and N5:** unchanged and still non-blocking. Nothing in the delta touches them.

## Commands run

```
git -C /private/tmp/claude-501/s2 rev-parse HEAD             # 859d250e5b61101615cb5bc6df328f717ee93cec
git log --oneline 954eb840..HEAD ; git diff --stat 49bc18ef..HEAD ; git diff 49bc18ef..HEAD -- apps/ docs/
git diff --stat 954eb840..859d250e ; git diff 954eb840..859d250e -- apps/api/src/index.ts docs/07-planning/decision-log.md
grep -rn "verifyApiKey|apikeyTable|x-api-key|Bearer|reauthenticate|resolveScimBearer" apps/api/src packages/mcp/src
grep createAuthEndpoint node_modules/.pnpm/@better-auth+api-key@1.6.26_*/.../dist/index.mjs   # verify = serverOnly
git archive 859d250e | tar -x -C /tmp/claude-501/s2close     # clean export; node_modules symlinked from the worktree; mutation copy /tmp/claude-501/s2closemut
docker run -d --rm --name s2-secclose-pg --tmpfs /var/lib/postgresql:rw -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=s2close_test -p 127.0.0.1:55873:5432 postgres:18-alpine
TASKDESK_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55873/s2close_test npx vitest run \
  --config vitest.integration.config.ts api-key-owner-state local-factor-policy permissions-shadow-mode \
  strict-runtime-enforcement api-key-self-mutations resolve-request-identity resolve-identity.test.ts   # 8 files, 92/92
npx vitest run --config vitest.config.ts tests/api/permissions/resolve-identity.test.ts \
  tests/api/utils/require-api-key-permission-scope.test.ts   # 2 files, 64/64
npx tsc --noEmit -p tsconfig.json && -p tsconfig.tests.json && -p tsconfig.permissions.json   # clean
python3 -I scratchpad/closemut.py <N1|N1b|N1c|N1d-missingperson|N1e-missinguser|M1b|M3b|M4|M5-statusroute|M6-ordering> ...
docker stop s2-secclose-pg                                   # --rm removed it
```

**Containers:**
- 6 were running before I started; `s2-secclose-pg` is now gone.
- 8 were running afterwards. The two new ones, `m0120-pg` and `s4-pg`, were started by other lanes during this run.
- No pre-existing container was touched.

**Cleanup:** the temp copies `/tmp/claude-501/s2close` and `/tmp/claude-501/s2closemut` were deleted. Nothing was edited, committed or pushed. The candidate worktree's `git status` is clean at 859d250e.

## Residual risk

- **R1.** The owner state is read once per request, outside any transaction. A ban committed during an in-flight request does not stop that one request. Sessions have the same window.
- **R2 (pre-existing, outside the delta).** `/ws/user` and `/ws/:projectId` authenticate only at upgrade and never re-authenticate. A connection opened before a ban or deactivation keeps receiving broadcasts until it disconnects. This applies to sessions and keys alike. Only native `/ws` re-authenticates on a timer.
- **R3.** Unban, and reactivation of keys that were not disabled, bring the keys back silently. This is a policy question, not a defect.
- **R4.** N2 (six `resolveIdentity` callers with no capability subset, fail-closed) and N5 (the shadow `identityKind` label) are still open from the prior review.
- **R5.** A customer-side person, or an inactive or suspended organisation, is not checked in `verifyApiKey`. Keys are minted only on the agent portal and refused on the customer host, so I found no reachable path. The strict resolver checks the organisation; the legacy key path does not.

## Not checked

- The full integration suite, the Docker image build, and UAT redeploy.
- `tsconfig.rls-prototype.json` typecheck.
- Live verification of Better Auth's lazy unban on an expired `banExpires` (I read the source only).
- The OIDC sign-in path's handling of inactive persons.
- The MCP package's own tests: it was treated as an HTTP client of the guarded API.
- The SCIM bearer implementation, beyond confirming it does not accept API keys.
- The docs-only changes, beyond C1 and C4: `testing-strategy.md` moves one paragraph and keeps its meaning.
<!-- END REPORT (sha256 6439334651cb421a2ee8f3e76f32a3efc312624253f835ecd32a843404799e17) -->

<!-- BEGIN REPORT (agent a6e8716d20f7cff14; model claude-sonnet-5-5; role ordinary final review and rebinds; candidate 737e0925e4a117c1a662ca529c55ecd46748c1ed; rebinds 7ac604ac3d2dedbf7bfe78546b1924df0c89c42c, fbf38d4da227f7fa067dd0ed5d5fe3c34d6c18e4; sha256 549115bcccbe67fd9f4590c51907de9eabfa55fe3b98556734c4a168d9a82b5c) -->
# S2 auth hardening: final delta review (Sonnet, Luna tier)

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent final-review subagent context (Sonnet 5.5, Luna tier); no part in authoring, directing or remediating this work.
**Reviewed head:** 737e0925e4a117c1a662ca529c55ecd46748c1ed
Delta reviewed: `git diff 859d250e..737e0925` (one commit, "fix(docs,test): remove stray decision-log fragment, cover missing owner rows, update ban comment")

## Verdict: PASS (no blocking findings, no non-blocking findings requiring change)

B1 (stray fragment) and N1 (stale comment) from my prior closure are resolved. Opus C1, C2 and C3 are resolved.

## Check results

1. Decision-log fragment: gone. The file at 737e0925 starts with `### 2026-10-10 · Owner decision: SCIM-provisioned ...`. The delta removes exactly the 6 stray lines. Against main 954eb840, `git diff --numstat -- docs/07-planning/decision-log.md` is `26 0` (26 insertions, 0 deletions). The only added heading is `### 2026-10-07 · Keep test role seeding private-only`, inserted mid-file (hunk @@ -415).
2. resolve-identity.ts comment: accurate. It now says better-auth's ban enforcement is session-only, `verifyApiKey` refuses a banned or inactive owner's key at verification on every route (strict or not), and the resolver refuses again for strict and shadow evaluation. I checked it against `apps/api/src/utils/verify-api-key.ts` (`apiKeyOwnerIsActive`: user missing, banned, or person not active returns null, which gives 401) and `resolveIdentityFromFacts` (`if (facts.banned) return null`). Code change in that file is comment-only (7 lines, no logic).
3. New owner-state cases (both run under strict off and on, 4 test executions):
   - "owner user with no person row": passes. Mutation `owner.personActive === true` -> `!== false` in verify-api-key.ts: this case FAILS (1 failed, 7 passed). It fails in the strict-off variant only; under strict-on the resolver independently refuses, so the second layer still gives 401. That is expected, not a gap.
   - "referenceId names a nonexistent user": passes. Mutation `owner !== undefined && ...` -> `owner === undefined || ...` (accept missing user): FAILS in both variants (2 failed, 6 passed).
   - Baseline file: 8 tests pass. Mutations were applied on the export only and restored (`cmp` against the worktree file: identical).
4. Commands, on a `git archive` export of 737e0925 (node_modules copied; packages domain/email/permissions/mcp rebuilt with tsc, all exit 0), private DB `s2f_test` in container `s2-final-pg`:

| Command | Result |
| --- | --- |
| apps/api `npm run typecheck` (4 tsconfigs) | clean |
| apps/api `npm run test:unit` | 96 files, 707 tests, all pass |
| `biome ci .` | 1925 files, 0 errors, 174 warnings, 1 info (no change in counts from prior closure) |
| integration: api-key-owner-state, resolve-request-identity, strict-runtime-enforcement, permissions-shadow-mode, local-factor-policy (name filter matched one extra file) | 6 files, 74 tests, all pass |
| FULL integration suite, run 1 | 150 passed, 1 failed (151 files); 1755 passed, 1 failed (1756 tests). The failure was `pending-action-expire.test.ts` "caps eligible rows per run at 1,000", a 60 s timeout in a 1,000-row test, 754 s total run. |
| `pending-action-expire` alone | 11/11 pass in 10 s |
| FULL integration suite, run 2 | **151 files, 1756 tests, all pass** (430 s) |

The run-1 failure is a load-related timeout in a file the branch does not touch (no pending-action or expire path in the diff against main, and the delta touches only 3 files). It passed in isolation and in the full rerun, so I treat it as a flake, not a candidate defect. Prior closure counts were 151 files, 1752 tests; the +4 are the two new cases times two enforcement modes.

5. Nothing else changed: `git diff 859d250e..737e0925 --stat` is exactly 3 files (resolve-identity.ts comment, decision-log.md -6, api-key-owner-state.test.ts +35), 39 insertions, 9 deletions. One commit in the range. Worktree `git status` is clean.

## Findings

None blocking. One observation only: the first new test's mutation is killed only under strict-off, by design (strict-on has the resolver as a second refusal layer).

Not checked: `test:permissions` and the repo-wide check scripts (check-openapi/env/events/policy), since the delta touches no policy, route or env surface; they passed on 859d250e in the prior closure and the delta is a comment, a doc deletion and tests.

## Cleanup proof

- One container only, `s2-final-pg`. After `docker stop`, `docker ps -a | grep -c s2-final-pg` = 0, and `docker volume ls | grep -c s2f` = 0.
- Container-name list afterwards matches the list from before my run, except that `m0120-ra-pg` is no longer listed. That is a `--rm` container I never touched (my only docker commands were run/stop on `s2-final-pg`); it was most likely stopped by another session.
- Export directory and all `s2f-*` scratch files deleted (0 remain). Candidate worktree /private/tmp/claude-501/s2 untouched: HEAD 737e0925e4a117c1a662ca529c55ecd46748c1ed, 0 status lines. No edits, commits or pushes.

## Rebind at 7ac604ac

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** 7ac604ac3d2dedbf7bfe78546b1924df0c89c42c

Verdict: PASS. The merge is a clean rebind with no interaction.

1. `git diff 7cf4bc1f 7ac604ac` equals `git diff 954eb840 737e0925`: both are 19 files, 928 insertions, 80 deletions, with identical per-file numstat. With `index` lines and the decision-log file excluded, the two diffs are byte-identical (1291 lines, `cmp` clean). The decision-log hunk differs only in offset (@@ -415 became @@ -430) and blob ids; its added text is byte-identical.
2. Decision log against main 7cf4bc1f: numstat `26 0` (26 insertions, 0 deletions), one hunk, no `-` lines. The only added heading is `### 2026-10-07 · Keep test role seeding private-only`. The file still starts with main's `### 2026-10-10 · Owner decisions for slice S3 approvals` heading.
3. No interaction. Main since 954eb840 (#623 and #625) changed: install.sh, scripts/ci/install.test.mjs, docs, and for #625 `apps/api/drizzle/0120_approval_workspace_anchor.sql`, its snapshot, `meta/_journal.json`, `apps/api/src/database/schema.ts`, and two tests (approval-workspace-anchor-migration, unanchored-tables-unreferenced). The only file overlapping S2's 19 changed files is `decision-log.md`, which merged textually clean. S2 touches no schema, migration or journal file. Because #625 adds a migration, I also ran the merged tree (below). 7cf4bc1f is an ancestor of 7ac604ac; parents are 737e0925 and 7cf4bc1f; worktree clean.

Commands (on a `git archive` export of 7ac604ac, private DB `s2m_test` in `s2-final-pg`; packages rebuilt with tsc):
- `git rev-parse HEAD`; `git log -1 --format=%P`; `git status --short`
- `git diff --stat/--numstat` for both ranges, sorted and compared
- `git diff <range> -- . ':!docs/07-planning/decision-log.md' | grep -v '^index '` for both ranges, then `cmp`
- `git diff <range> --numstat` and hunk/added-text extraction on decision-log.md for both ranges
- `git diff 954eb840 7cf4bc1f --name-only` against `git diff 954eb840 737e0925 --name-only` via `comm -12`
- `git merge-base --is-ancestor 7cf4bc1f 7ac604ac`
- apps/api `npm run typecheck`: clean (exit 0)
- apps/api `npm run test:unit`: 96 files, 707 tests, all pass
- integration, the five S2 files plus approval-workspace-anchor-migration: 7 files, 77 tests, all pass
- FULL integration suite: **152 files, 1759 tests, all pass** (413 s)

Cleanup: `s2-final-pg` stopped (0 left), export and scratch files removed, candidate worktree untouched. An earlier draft of this section wrongly said main changed nothing under apps/; that was a grep error, corrected above after I saw the #625 migration files.

## Rebind at fbf38d4d

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** fbf38d4da227f7fa067dd0ed5d5fe3c34d6c18e4

Verdict: PASS. Clean rebind, no interaction.

1. `git diff ba88413d fbf38d4d` matches `git diff 7cf4bc1f 7ac604ac`: 19 files with identical per-file numstat, and with `index` lines and decision-log.md excluded the two diffs are byte-identical (1291 lines, `cmp` clean). The decision-log hunk differs only in offset (@@ -430 became @@ -450); its added text is byte-identical.
2. Decision log against main ba88413d: numstat `26 0` (26 insertions, 0 deletions), one hunk, no `-` lines. The only added heading is `### 2026-10-07 · Keep test role seeding private-only`.
3. No interaction with #624. Main's delta 7cf4bc1f..ba88413d is docs and records only: CHANGELOG.md, docs/02-design/screen-inventory.md, decision-log.md, p0-phase-finalizer-record.md, p0-stage-review.md, phases.md and status.md. Its only overlap with S2's changed files is decision-log.md, which merged textually clean (main's new top entry is "Owner decisions recorded late: #602 template-check ..."; S2's 26 lines are intact below it). No source, test, schema or migration file changed. Parents are 7ac604ac and ba88413d (both ancestors of fbf38d4d); worktree clean.

Commands: `git rev-parse HEAD`; `git log -1 --format=%P`; `git status --short`; `git diff --numstat` for both ranges, sorted and diffed; `git diff <range> -- . ':!docs/07-planning/decision-log.md' | grep -v '^index '` for both ranges plus `cmp`; `git diff ba88413d fbf38d4d --numstat` and hunk/`+###`/`-` grep on decision-log.md; added-text extraction compared with `cmp` against the 7cf4bc1f..7ac604ac range; `git diff 7cf4bc1f ba88413d --name-only` and `comm -12` against S2's file list; `git merge-base --is-ancestor` for both parents. No tests re-run: main's delta is docs only and the code delta is byte-identical to the one fully tested at 7ac604ac (152 files, 1759 tests).
<!-- END REPORT (sha256 549115bcccbe67fd9f4590c51907de9eabfa55fe3b98556734c4a168d9a82b5c) -->

<!-- BEGIN REPORT (agent ab8f3b6968dbb70ff; model claude-opus-5-5; role Sol-tier final re-confirmation and rebinds; candidate 737e0925e4a117c1a662ca529c55ecd46748c1ed; rebinds 7ac604ac3d2dedbf7bfe78546b1924df0c89c42c, fbf38d4da227f7fa067dd0ed5d5fe3c34d6c18e4; sha256 4453bc1828d91993c6afebbf1245a5998e0503c37e82a46e669ac28510df521e) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:s2-final-sec-opus@3a9e9ce4-8409-47d4-b1be-1f1544697e70 (a fresh subagent context; the ID is the parent session's, because the harness exposes no separate subagent ID)
**Reviewed head:** 737e0925e4a117c1a662ca529c55ecd46748c1ed

**Verdict: PASS. No blocking security findings at this exact head. C1, C2 and C3 from the prior closure are resolved.**

- **Base:** `main` 954eb84094e009658943af1e294d3b8a48d17f69.
- **Prior closure:** PASS at 859d250e5b61101615cb5bc6df328f717ee93cec, with findings C1–C4.
- **Delta reviewed:** `git diff 859d250e..737e0925`. That is one commit, 737e0925. It touches 3 files, +39/−9.
- **Independence:** I did not author, direct or fix this candidate. I used no author report as evidence.
- **Scope:** this is a lightweight exact-head re-confirmation. It is not a full re-review.

## Findings

### 1. The delta changes no runtime behaviour beyond C1–C3: CONFIRMED

The delta touches exactly three files.

| File | Change | Item |
|---|---|---|
| `docs/07-planning/decision-log.md` | Deletes the 6 stray lines at the top of the file. The file now starts with `### 2026-10-10 · Owner decision: SCIM-provisioned…`, the same first line as `main`. | C1 |
| `tests/api-integration/api-key-owner-state.test.ts` | Adds two `it` cases inside the existing `describe.each(["off","on"])`, so 4 runs. It adds no new imports: `randomUUID` and `eq` were already imported. | C2 |
| `apps/api/src/permissions/resolve-identity.ts:357-361` | Comment only. It now names both enforcement points: `verifyApiKey` on every route, and the resolver for strict and shadow. | C3 |

- **Comments only in `apps/`.** `git diff 859d250e..737e0925 -- apps/` has no changed line that is not a `//` comment.
- **The C3 wording is accurate.** It matches `verify-api-key.ts:39-56,85-88`, which I re-read at this head.
- **No runtime change.** The executable code at 737e0925 is identical to the head the prior PASS covered.

### 2. C2's tests kill mutations N1d and N1e: CONFIRMED

Both mutations were applied to `apps/api/src/utils/verify-api-key.ts` in the `apiKeyOwnerIsActive` return expression.

| Mutation | Change | Result on the 8-file S2 security set |
|---|---|---|
| N1d | `owner.personActive === true` → `owner.personActive !== false` | **Killed.** 1 failed, 95 passed. The failing test is "refuses a key whose owner user has no person row", with enforcement **off**. |
| N1e | `owner !== undefined && …` → `owner === undefined \|\| (…)`, so a missing user is accepted | **Killed.** 2 failed, 94 passed. The failing test is "refuses a key whose referenceId names a nonexistent user", with enforcement **off** and **on**. |

- **Why N1d fails in one mode only.** With enforcement on, `resolveIdentity` still refuses a missing person. That is the intended defence in depth. The off-mode case is the one that proves the gate in `verifyApiKey`.
- **What the N1e test does.** It points `referenceId` at a ghost user and leaves the legacy `userId` column on a real user. That matches the `referenceId ?? userId` precedence in `verify-api-key.ts:84`, so it exercises the missing-user branch, not a lookup miss.
- **Both new tests check the baseline.** Each asserts a 200 before it changes the data, so neither passes vacuously.
- **The file was restored after mutation.** I diffed it against `git show 737e0925:…`: it is identical.

### 3. The decision log is insert-only against `main` 954eb840: CONFIRMED

- **No removals.** `git diff 954eb840..737e0925 -- docs/07-planning/decision-log.md` has 0 removed lines.
- **One insertion.** There is a single hunk, `@@ -415,6 +415,32 @@`. It is the 2026-10-07 "Keep test role seeding private-only" entry, followed by a `---` separator.
- **Correct position.** The entry sits on an entry boundary, between the 2026-10-09 entry and the 2026-10-06 entry, so it keeps the newest-first order.
- **Same top line as `main`.** The first line of the head file equals the first line of `main`.

### 4. The full S2 diff adds no capability path: CONFIRMED

- **Size.** `git diff --stat 954eb840..737e0925` touches 19 files, +928/−80.
- **Same runtime file set as the prior PASS:**
  - `factor-status-api.ts`, `local-factor-service.ts` and `index.ts` (factor gate);
  - `resolve-identity.ts`, `resolve-request-identity.ts` (new), `shadow-middleware.ts` and `strict-policy-enforcement.ts`;
  - `verify-api-key.ts`.
- **No new routes.** I grepped the added lines under `apps/`. There are no new route registrations and no `.use(` or middleware additions that grant access.
- **The OpenAPI change is narrowing.** Its only change is a new **403** response on the factor-status route.
- **`resolve-request-identity.ts` adds no authority.** It only carries `apiKeyCapabilitySubset(apiKey)` into `resolveIdentity`. That narrows a key to its stored scope.
- **All the other runtime changes refuse access.** They add 401, 403 and 503 paths:
  - the owner-state gate;
  - the inactive-identity 403 in the factor paths;
  - the scope clamp for keys in strict and shadow modes.
- **None grants authority.** The delta since 859d250e is comments only, so the prior shape analysis still holds unchanged.

### Non-blocking

- **C4 (from the prior closure, process note).** It still stands as recorded. Nothing in this delta touches the body of the 2026-10-07 entry.
- **O1 (new, process observation).** The inserted entry's "Carried to main" line names Claude Sonnet 5.5 as the carrier.
  - This is attribution of fact, not a security matter.
  - The control plane now routes Sonnet roles to GPT-6 Luna. The orchestrator may want to confirm that the attribution is accurate.

## Commands

```
git -C /private/tmp/claude-501/s2 rev-parse HEAD 859d250e 954eb840
  # 737e0925e4a117c1a662ca529c55ecd46748c1ed / 859d250e5b61101615cb5bc6df328f717ee93cec / 954eb84094e009658943af1e294d3b8a48d17f69
git log --oneline 954eb840..737e0925                 # 8 commits; top is 737e0925
git diff --stat 859d250e..737e0925 ; git diff 859d250e..737e0925
git diff 859d250e..737e0925 -- apps/ | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*//'   # empty
git diff 954eb840..737e0925 -- docs/07-planning/decision-log.md                      # 0 removed lines; 1 hunk @415
git diff --stat 954eb840..737e0925 ; git diff 954eb840..737e0925 -- apps/ | grep route/use/capability/scope
git archive 737e0925… | tar -x -C /tmp/claude-501/s2final    # node_modules symlinked from the worktree
docker run -d --rm --name s2-final-sec-pg --tmpfs /var/lib/postgresql:rw -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=s2final_test -p 127.0.0.1:55874:5432 postgres:18-alpine
TASKDESK_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55874/s2final_test npx vitest run \
  --config vitest.integration.config.ts api-key-owner-state local-factor-policy permissions-shadow-mode \
  strict-runtime-enforcement api-key-self-mutations resolve-request-identity resolve-identity.test.ts
  # 8 files, 96/96 passed (the prior PASS had 92; +4 = 2 new cases x 2 modes)
npx vitest run --reporter=verbose ... api-key-owner-state          # 8/8, both new cases in both modes
npx vitest run --config vitest.config.ts tests/api/permissions/resolve-identity.test.ts \
  tests/api/utils/require-api-key-permission-scope.test.ts          # 2 files, 64/64
npx tsc --noEmit -p tsconfig.json ; npx tsc --noEmit -p tsconfig.tests.json   # both clean
python3 -I scratchpad/finalmut.py N1d   # 1 failed | 95 passed: KILLED
python3 -I scratchpad/finalmut.py N1e   # 2 failed | 94 passed: KILLED
docker stop s2-final-sec-pg             # --rm removed it
```

**Containers:**
- I started and stopped only `s2-final-sec-pg`, and it is gone now.
- The set of other containers changed during the run. `m0120-ra-pg` and `s4-pg` disappeared. `m0120-sec-pg`, `s2-final-pg`, `s4-review-b-pg` and `s4-sec-pg` appeared.
- Other lanes made those changes. I issued no docker command against any of them.

**Cleanup:**
- I deleted `/tmp/claude-501/s2final`.
- Nothing was edited, committed or pushed.
- The candidate worktree is clean at 737e0925.

## Residual risk

These are unchanged from the prior closure. The delta neither addresses nor worsens any of them.

- **R1.** The owner state is read once per request, outside a transaction. A ban committed during an in-flight request does not stop that one request.
- **R2 (pre-existing).** `/ws/user` and `/ws/:projectId` authenticate only at upgrade. A connection that is already open survives a ban or deactivation.
- **R3.** Unbanning or reactivating a user silently revives their keys that are still enabled. This is a policy question.
- **R4.** N2 and N5 from the earlier review are still open and non-blocking.
- **R5.** `verifyApiKey` does not check organisation or customer-side state. I found no reachable path to exploit this.

## Not checked

- The full integration suite, the Docker image build and boot, health endpoints, and the UAT redeploy.
- The `tsconfig.permissions.json` and `tsconfig.rls-prototype.json` typechecks. I ran only the main and tests configs.
- A re-run of the earlier mutations (N1, N1b, N1c, M1b, M3b, M4, M5, M6). The executable code is identical to 859d250e, where all of them were killed.
- Any re-review of the non-delta S2 code, beyond confirming that its shape has not changed.
- GitHub PR state, CI status checks and branch protection. Those belong to the orchestrator's merge check.

## Rebind at 7ac604ac

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:s2-final-sec-opus@3a9e9ce4-8409-47d4-b1be-1f1544697e70 (the same context as the review above)
**Reviewed head:** 7ac604ac3d2dedbf7bfe78546b1924df0c89c42c

**Verdict: PASS. The PASS at 737e0925 carries to merge commit 7ac604ac. There are no blocking findings and no new ones.**

- **Head.** I verified the head as `7ac604ac3d2dedbf7bfe78546b1924df0c89c42c`. Its parents are 737e0925e4a117c1a662ca529c55ecd46748c1ed and `main` 7cf4bc1fe756d1c9008da7c383e4d9afcd147d4e. The worktree is clean.
- **Main since the old base.** 954eb840 is an ancestor of 7cf4bc1f. `main` advanced by exactly two commits: f4f6b011 (#623) and 7cf4bc1f (#625).

### 1. The S2 delta is unchanged: CONFIRMED

- I compared `git diff 954eb840 737e0925` with `git diff 7cf4bc1f 7ac604ac`. With the `index` and `@@` lines removed, the two are byte-identical (`cmp`).
- The only differences are in the decision-log hunk:
  - the blob ids (`ddf981b4..e62b68da` became `0f19a7f9..351ceb77`);
  - the line offset (`@@ -415` became `@@ -430`).
- So the merge resolved with no textual change to S2's code or tests.

### 2. #623 and #625 do not interact with S2's auth surfaces: CONFIRMED

- **Only one file overlaps.** `git diff --name-only 954eb840 7cf4bc1f` and the S2 file list share only `docs/07-planning/decision-log.md`.
- **#625 (0120) touches only the `approval` table:**
  - the SQL adds `approval.workspace_id`, backfills it from `work_item`, and sets it NOT NULL;
  - it adds the FK to `workspace` and the composite FK `(workspace_id, work_item_id)` to `work_item`, and drops the old single-column FK;
  - it adds an index.
- **The `schema.ts` diff matches the SQL.** It touches only the `approval` table definition. It does not touch `user`, `person`, `apikey` or session tables.
- **S2 has no approval code.** No S2-changed runtime file contains "approval", and no added S2 line mentions it. S2's surfaces are:
  - `verify-api-key.ts`, `resolve-identity.ts`, `resolve-request-identity.ts`, `shadow-middleware.ts` and `strict-policy-enforcement.ts`;
  - the factor gate in `index.ts`, `factor-status-api.ts` and `local-factor-service.ts`.
- **#623 does not touch the API runtime.** It changes `install.sh`, `scripts/ci/install.test.mjs`, operations docs and a review note.

### 3. The merged decision log is still insert-only against `main`: CONFIRMED

- **No removals.** `git diff 7cf4bc1f 7ac604ac -- docs/07-planning/decision-log.md` has 0 removed lines and 1 hunk.
- **The S2 entry keeps its place.** "2026-10-07 · Keep test role seeding private-only" sits at line 433, between the 2026-10-09 "Integration Freeze" entry (line 401) and the 2026-10-06 entry (line 459). That is an entry boundary in newest-first order.
- **`main`'s new entry is intact at the top.** The first line at 7ac604ac is #625's entry, "2026-10-10 · Owner decisions for slice S3 approvals…", the same as the first line of 7cf4bc1f.

### 4. The S2 security integration files pass at 7ac604ac: 96/96

- **Integration:** the same 8 files as above, on a fresh database that ran migrations through 0120. Result: **8 files, 96/96 passed**, 0 failed.
- **Typecheck:** `tsc --noEmit -p tsconfig.json` is clean.
- **Mutations not re-run.** The S2 code and tests are byte-identical to 737e0925, where N1d and N1e were killed.

### Commands

```
git -C /private/tmp/claude-501/s2 rev-parse HEAD 7cf4bc1f ; git log -1 --format=%P 7ac604ac ; git status --short
git merge-base --is-ancestor 954eb840 7cf4bc1f ; git log --oneline 954eb840..7cf4bc1f      # f4f6b011 (#623), 7cf4bc1f (#625)
git diff 954eb840 737e0925 > a ; git diff 7cf4bc1f 7ac604ac > b
grep -vE '^(index |@@)' a > a2 ; grep -vE '^(index |@@)' b > b2 ; cmp a2 b2                 # identical
diff a b                                                                                    # index + @@ -415→-430 only
git diff --stat 954eb840 7cf4bc1f ; comm -12 <main-side names> <S2 names>                   # decision-log.md only
git diff 954eb840 7cf4bc1f -- apps/api/src/database/schema.ts ; git show 7cf4bc1f:apps/api/drizzle/0120_approval_workspace_anchor.sql
git diff --name-only 954eb840 737e0925 -- apps/ | xargs grep -il approval                    # none
git diff 7cf4bc1f 7ac604ac -- docs/07-planning/decision-log.md                               # 0 removed, 1 hunk
git show 7ac604ac:docs/07-planning/decision-log.md | grep -n '^### '
git archive 7ac604ac… | tar -x -C /tmp/claude-501/s2rebind   # node_modules symlinked from the worktree
docker run -d --rm --name s2-final-sec-pg --tmpfs /var/lib/postgresql:rw -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=s2final_test -p 127.0.0.1:55874:5432 postgres:18-alpine
TASKDESK_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55874/s2final_test npx vitest run \
  --config vitest.integration.config.ts api-key-owner-state local-factor-policy permissions-shadow-mode \
  strict-runtime-enforcement api-key-self-mutations resolve-request-identity resolve-identity.test.ts   # 8 files, 96/96
npx tsc --noEmit -p tsconfig.json                              # clean
docker stop s2-final-sec-pg                                    # --rm removed it
```

**Containers and cleanup:**
- `s2-final-sec-pg` was the only container I touched, and it is gone.
- I deleted `/tmp/claude-501/s2rebind`.
- Nothing was edited, committed or pushed. The worktree is clean at 7ac604ac.

### Not checked in this rebind

- Mutation re-runs, the full integration suite, the 0120 migration's own tests, #623's installer tests, an image build, and a UAT redeploy.
- The O1 note above may be moot now. `main`'s decision log contains a 2026-10-09 entry titled "Owner directive: model tiers by availability; no fixed GPT-6 Sol requirement". I did not re-check the CLAUDE.md routing against it. That belongs to the orchestrator.
- GitHub PR state, CI and branch protection.

## Rebind at fbf38d4d

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:s2-final-sec-opus@3a9e9ce4-8409-47d4-b1be-1f1544697e70 (the same context as the reviews above)
**Reviewed head:** fbf38d4da227f7fa067dd0ed5d5fe3c34d6c18e4

**Verdict: PASS. The PASS at 737e0925, carried to 7ac604ac, carries again to merge commit fbf38d4d. There are no blocking findings and no new ones.**

- **Head.** I verified the head as `fbf38d4da227f7fa067dd0ed5d5fe3c34d6c18e4`. Its parents are 7ac604ac3d2dedbf7bfe78546b1924df0c89c42c and `main` ba88413d980f0fa2897c0db09b91f658df461ecb. The worktree is clean.
- **Main since the last rebind.** 7cf4bc1f is an ancestor of ba88413d. `main` advanced by exactly one commit, ba88413d (#624).

### 1. The S2 delta is unchanged: CONFIRMED

- I compared `git diff ba88413d fbf38d4d` with `git diff 7cf4bc1f 7ac604ac`. With the `index` and `@@` lines removed, the two are byte-identical (`cmp`).
- The only differences are in the decision-log hunk:
  - the blob ids (`0f19a7f9..351ceb77` became `b5c98a87..1df5886a`);
  - the line offset (`@@ -430` became `@@ -450`).
- This chains to the earlier result: the diff from 954eb840 to 737e0925 has the same S2 content, so the code and tests are still byte-identical to the head where N1d and N1e were killed.

### 2. #624 does not interact with S2: CONFIRMED

- **Docs and records only.** #624 (ba88413d) changes 7 files, +838/−1:
  - `CHANGELOG.md`;
  - `docs/02-design/screen-inventory.md`;
  - `docs/07-planning/{decision-log,p0-phase-finalizer-record,p0-stage-review,phases,status}.md`.
- **No code, tests, migrations, CI or dependency files.** Nothing under `apps/`, `packages/`, `tests/`, `scripts/`, `.github/` or any lockfile.
- **One file overlaps.** The only file both #624 and the S2 delta touch is `docs/07-planning/decision-log.md`.
- **Integration suite not re-run.** No runtime input changed since 7ac604ac, where the S2 files passed 96/96.

### 3. The decision log is insert-only against ba88413d: CONFIRMED

- **No removals.** `git diff ba88413d fbf38d4d -- docs/07-planning/decision-log.md` has 0 removed lines and 1 hunk.
- **The S2 entry keeps its place.** "2026-10-07 · Keep test role seeding private-only" sits at line 453, between the 2026-10-09 "Integration Freeze" entry (line 421) and the 2026-10-06 entry (line 479). That is an entry boundary in newest-first order.
- **`main`'s newest entry is intact at the top.** The first line at fbf38d4d is #624's entry, "2026-10-10 · Owner decisions recorded late: #602 template-check lift, second infrastructure re-run, P0 stage-gate waiver". It is the same as the first line of ba88413d.

### Commands

```
git -C /private/tmp/claude-501/s2 rev-parse HEAD ba88413d ; git log -1 --format=%P fbf38d4d ; git status --short   # clean
git merge-base --is-ancestor 7cf4bc1f ba88413d ; git log --oneline 7cf4bc1f..ba88413d    # ba88413d (#624) only
git diff --stat 7cf4bc1f ba88413d                                                        # 7 docs files, +838/-1
git diff 7cf4bc1f 7ac604ac > a ; git diff ba88413d fbf38d4d > b
grep -vE '^(index |@@)' a > a2 ; grep -vE '^(index |@@)' b > b2 ; cmp a2 b2               # IDENTICAL
diff a b                                                                                  # index + @@ -430→-450 only
comm -12 <(git diff --name-only 7cf4bc1f ba88413d) <(git diff --name-only ba88413d fbf38d4d)   # decision-log.md only
git diff ba88413d fbf38d4d -- docs/07-planning/decision-log.md                            # 0 removed, 1 hunk
git show fbf38d4d:docs/07-planning/decision-log.md | grep -n '^### '
```

**Containers and edits:**
- No container was started for this rebind.
- Nothing was edited, committed or pushed.

### Not checked in this rebind

- I did not re-run tests, typechecks or mutations. Runtime inputs are unchanged since 7ac604ac.
- I did not review the content of #624's records, including its "P0 stage-gate waiver" entry. That is outside S2's security scope.
- GitHub PR state, CI and branch protection.
<!-- END REPORT (sha256 4453bc1828d91993c6afebbf1245a5998e0503c37e82a46e669ac28510df521e) -->
