# Local-factor query ownership review

**Reviewed head:** `ec6ede3924c4a4778f9dd101b2dcea679cbed3f1`

**Accepted base:** `28fdb2c11f50449bcb5354a548b2774d6810860e` (protected #835).

## Scope and review tier

Five existing reads move from auth/local-factor-service.ts to the existing auth/repository.ts: active identity, inactive fallback, singleton policy, membership roles and configured-role existence. The exact executor, SQL, selected fields, joins, predicates, limits, serial order, short circuits, policy parsing, class identity, errors and public service API are preserved. No route, schema, capability, dependency or auth behavior is added.

One fresh strong ordinary Luna review and a further fresh lightweight Sol security confirmation independently find no authority or gate pass/fail semantics change. Both pass exact reviewed source. This is the applicable security-path relocation tier, not a waiver or inherited N1 approval. The authentic reports below remain verbatim; neither reviewer authored, directed or remediated this source.

## Native context provenance

The saved native metadata identifies source author context 01a14c17-cd4c-7293-a222-c24fff975e2f as configured gpt-6-luna/high; ordinary context 01a14c4a-ebbe-7412-a663-fe01ccc16900 as gpt-6-luna/high; and subsequent security context 01a14c4b-f780-7542-8a50-2a6df70b446f as gpt-6.1-sol/high. They are three distinct contexts. This records configured assignments, not an independent served-weights attestation. The reviewers accurately describe their own model-identifier visibility limits.

## Actual local verification and source conservation

Root ran Biome check with write enabled on both files: exit0, no changes. All nine workspace type tasks passed, native0/22.411s. Four entire PostgreSQL files passed82 tests, native0/22.899s: local-factor policy, its concurrency suite, SCIM administration and pending-action credential revocation. Source, disposable-container ownership/cleanup, private environment removal and complete Docker inventory conservation were verified. The reviewers ran no tests personally; their static inspections and the root runtime evidence are distinct.

Those checks executed on runner HEAD1615d4a38b093dbd22bec334f8ac7e9b380ef96d plus these exact two frozen file changes. Protected #835 main28f and runner base1615 have identical tree66a482a7f5bece570469a3c64804c8de6f386fbc. Normal fast-forward to accepted main conserved the dirty patch, then sourceec6e committed it. Every other accepted tree entry is unchanged. This supports source-equivalent reuse; it is not a claim of execution on runner HEADec6e or this later publication.

The actual ownership diagnostic remains red and unwired:2736 overlapping finding instances/140paths/1514path-line locations; zero unresolved-export, explicit exported-builder, type-diagnostic and owned-service-violation rows. These are not unique query counts, a percentage, or whole#580 completion. No checker exception or wiring changed.

## Publication and limits

This designated publication commit adds only this review note. All3441 reviewed source-tree entries and both report bodies must remain exact. Required hosted checks and exact-source shipping-image build/boot/migration/health proof remain mandatory on the final publication SHA; no hosted/image pass is claimed by these reports.

No UI screen changed. BROWSER VERIFICATION: BLOCKED — no manual browser screen was opened for this backend-only relocation; final included workflows remain part of laptop SIT acceptance.

The inherited bare-string verifier-result finding NB1 is unchanged, non-blocking, unfixed and unwaived. The security report refers to this residual as N1; that does not reverse protected #835 acceptance of the serialization repair at28f. Current production HTTP issuers inspected use structured verifier results; no current HTTP bypass was identified. No release, SIT, recovery, audit, stage or mission completion is claimed.

## Authentic independent report 1

# Strong ordinary review — #580 local-factor query ownership

- **Reviewed head:** `ec6ede3924c4a4778f9dd101b2dcea679cbed3f1`
- **Comparison base:** `28fdb2c11f50449bcb5354a548b2774d6810860e`
- **Reviewer/model:** GPT-6 Luna, ordinary-review role. This is a fresh independent reviewer context; I did not author, direct, or remediate the candidate. The platform does not expose a native session/model identifier to this report context, so none is invented.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query580-local-factor-ownership-20261018`; HEAD matched the reviewed SHA and the worktree was clean at review start.
- **Scope:** read-only static review of the complete two-file diff and both complete changed files, relevant local-factor callers, executor type, existing local-factor policy and concurrency integration coverage, schema/data-model contract, query-ownership decision, workflow and security-review path list. No source changes.
- **Tests/reproductions personally run:** none. This was a static review; root's separately reported runs below are not represented as my runs.

## Verdict

**PASS — no blocking finding introduced by this candidate.** The two changed files move five already-awaited local-factor reads from `loadLocalFactorState` into named repository helpers. I compared each query body against the parent implementation: selected fields, table sources, join kind and join condition, predicates, and limits are unchanged. Each new helper accepts the same `typeof db | StepUpExecutor` handle, defaults to `db` as before, and is awaited by the service in the original serial order.

The identity classification remains before instance-policy lookup and parsing. The inactive-person fallback still runs only when the active lookup has no usable staff/customer identity; the same inactive-specific error and generic unavailable error remain. Policy parsing, membership lookup, required-role existence validation, `isLocalFactorRequired`, enabled-state calculation, and returned fields retain their original order and conditions. I found no authority, policy-evaluation, transaction, public API, error mapping, or control-flow change in the diff.

## Risk classification and required next review

Both changed paths are in the mandatory security-review path list (`apps/api/src/auth/**`). The actual change is a bounded query-ownership relocation and changes neither authority nor any gate pass/fail semantics. Under `agent-workflow.md`'s security-scope row for that case, the applicable tier is one strong independent GPT-6 Luna ordinary review followed by a fresh lightweight GPT-6 Sol confirmation. This report supplies only the ordinary review; Sol confirmation remains required before merge. This is not a blanket approval from inherited N1 or any earlier candidate.

The relocation is consistent with the accepted query-ownership direction recorded in `decision-log.md` (feature queries belong in `repository.ts`) and the repository-layout guidance. The repository exports are internal module functions used by the service; I found no route or new external API introduced.

## Checks and relevant evidence

I inspected the exact diff and both complete source files; callers in `factor-status-api.ts`, `step-up-api.ts`, `auth.ts`, `index.ts`, `instance/reset-mfa.ts`, `instance/users/index.ts`, and `instance/observability/metrics-token-rotation.ts`; `StepUpExecutor`; and existing tests in `local-factor-policy.test.ts` and `local-factor-policy-concurrency.test.ts`. Existing coverage includes inactive versus missing identity outcomes, inactive denial when the settings row is unavailable, and policy/proof concurrency paths that invoke `loadLocalFactorState` with an enlisted executor. I did not execute these tests.

Root-provided receipts identify the exact two committed source hashes as `9015abc3fd14a308bcc836a32606432c9e61e64fa9805610b9134f9a5f90143a` (`local-factor-service.ts`) and `04fdf686ec0137bb80028e83c86bd544841db0b34bc385a3cffc4a4f7bd07cc2` (`repository.ts`). The root reports nine workspace type tasks and four complete PostgreSQL files / 82 tests passing on runner HEAD `1615d4a38b093dbd22bec334f8ac7e9b380ef96d`, with the exact two-file patch conserved. These are source-equivalent root results, not executions on runner HEAD `ec6ede...`, hosted CI, or acceptance. Root also reports the ownership diagnostic remains unwired/red with 2,736 overlapping instances across 140 paths / 1,514 locations; zero unresolved export, exported-builder, type-diagnostic, and service-violation rows. Those overlapping diagnostic counts are not unique query counts, a passing checker, or #580 progress.

## Non-blocking residual

The inherited pending-action N1 bare-string verifier result remains a recorded residual: the existing union permits a string result without a `revalidate` callback. This candidate does not change that contract or its behavior. I have not reopened that finding, treated it as fixed, waived it, or expanded this review to remediate it.

This review covers only the exact two-file source diff. It does not establish whole-#580 completion, current hosted checks, publication/image acceptance, merge readiness, release/SIT acceptance, or stage completion.

## Authentic independent report 2

# Independent security confirmation — #580 local-factor query ownership

**Model:** GPT-6 Sol
**Reviewed head:** ec6ede3924c4a4778f9dd101b2dcea679cbed3f1
**Comparison base:** 28fdb2c11f50449bcb5354a548b2774d6810860e
**Reviewer context:** /root/query580_ec6e_security_sol
**Role:** Fresh independent security reviewer, after ordinary review cleared.
**Model visibility:** Assigned GPT-6 Sol review context; the visible system identifies this assistant as GPT-6-based Codex. No independent runtime model/build identifier or native session identifier is exposed here; none is invented.
**Independence:** I did not author, direct, or remediate this candidate. The author was /root/query580_local_factor_ownership_plan_luna and the preceding ordinary reviewer was /root/query580_ec6e_ordinary_luna. I independently inspected source rather than treating the ordinary verdict as proof.
**Tests/reproductions personally run:** None. Static source and saved-receipt inspection only.

## Verdict and classification

**PASS — no blocking security finding introduced by this exact candidate.** No new non-blocking finding was identified. The applicable depth is mandatory lightweight security confirmation for security-scope files that provably change no authority or gate pass/fail semantics. I independently confirm that classification; escalation to the semantic auth-change tier is unnecessary for this diff.

Both changed paths are under `apps/api/src/auth/**`, so security review remains mandatory. This candidate relocates five existing awaited reads into five awaited, finite-projection repository helpers. It does not change authorization decisions, policy parsing, credential verification, transaction ownership, route access, or a machine gate. This report supplies the fresh Sol security confirmation after the saved ordinary PASS; it does not declare all merge gates satisfied.

## Scope and source binding

I read AGENTS.md, active-mission.md, agent-workflow.md, CLAUDE.md, the query-ownership standard and decision, the authoritative security-review path list, and relevant authentication/security-model contracts. I reviewed the entire parent-to-candidate diff, both complete changed files, the complete parent service and local-factor policy evaluator, the enrollment/status error mappings, transaction-bound step-up callers and lifecycle/finalization seam, and relevant existing unit/integration/concurrency test bodies.

Read-only Git inspection confirmed clean worktree HEAD `ec6ede3924c4a4778f9dd101b2dcea679cbed3f1`, its immediate parent `28fdb2c11f50449bcb5354a548b2774d6810860e`, and exactly two changed files: `apps/api/src/auth/local-factor-service.ts` and `apps/api/src/auth/repository.ts` (96 insertions, 50 deletions). Independent file hashing matched the committed-source and test preflight receipts:

- Service SHA-256: `9015abc3fd14a308bcc836a32606432c9e61e64fa9805610b9134f9a5f90143a`.
- Repository SHA-256: `04fdf686ec0137bb80028e83c86bd544841db0b34bc385a3cffc4a4f7bd07cc2`.

No source, tests, refs, dependencies, runtime, database, container, or shared records were changed by this review. Its sole write is this new private report.

## Security boundaries checked

**Identity and error classification.** The active lookup still joins person to its matching user, predicates on the supplied user ID and `active = true`, selects the same four fields, and limits to one. Unsupported person sides and absent active rows still take the same inactive fallback. That fallback remains subject-bound, selects only person ID, predicates `active = false`, and limits to one. The unchanged `InactiveFactorIdentityError` class remains in the service module, preserving `instanceof` classification in status/enrollment callers. Identity resolution and inactive denial still precede settings access; missing identity and policy/store failures retain the existing fail-closed error paths.

**Policy and scope.** The singleton settings lookup selects only local-factor policy and still requires ID `singleton`. Parsing uses the same closed-shape parser before memberships are loaded. Memberships remain restricted to the resolved person's ID and inner-joined to existing roles, returning only role IDs. This is evaluation of the subject's own factor population across supported membership scopes, as the authentication contract requires; it introduces no row-content access to another subject or workspace. Required-role existence is still checked only in `required_role` mode, using the same ID predicate, projection and limit, with the same missing-role error. No cache, permissive default, fallback policy, role-authority grant, or customer-specific condition is added.

**Executor, ordering and transaction seam.** Every helper receives the exact executor passed to `loadLocalFactorState`; none silently switches to global db when a transaction is supplied. The default remains db for ordinary callers. Helpers neither open nor finish transactions. Service reads remain serial and at their original conditional points. The `StepUpExecutor` type is unchanged. In `step-up-api.ts`, initial verification calls use the admitted executor and structured verification results re-read factor state with the final executor. The existing lifecycle wrapper and nested finalization savepoint in `step-up-service.ts` remain unchanged, as do session/admin rechecks and proof issuance in the repository. This extraction adds no pool escape, omitted revalidation, parallel query, lock-order change, new locking operation, or weakened catch path.

**SQL and return boundary.** I compared all five extracted statements with their parent service bodies: selected columns, sources, joins, predicates and limits match. Inputs continue through Drizzle equality expressions. No raw interpolation, secret projection, wildcard select or broadened result is introduced. Helpers use `return await` and return materialized rows, so the service receives arrays rather than composable query builders. The service returns the same policy, required flag, strict `enabled === true` result, person ID and staff/customer side. New internal helper exports are not routes or externally callable endpoints. Existing unrelated repository mutations and verifier contracts are unchanged.

## Existing coverage and evidence limits

Personally inspected coverage includes the closed persisted policy shape and required staff/role population unit cases; inactive versus missing identity with 403/503 HTTP outcomes; inactive denial when settings are absent, including factor status; and concurrency tests that forward the supplied executor, observe the enlisted backend, serialize policy PATCH against proof issuance, and require a policy-first password proof to fail with `step_up_unavailable`, an expired challenge, no auth method and no target mutation. These tests are existing coverage, not tests I executed or new tests added by this candidate.

I read root's `committed-source.json`, `local-verification-checkpoint.json`, `pg-spec.json`, `types-native.json`, `query-diagnostic-summary.json`, and the PostgreSQL sibling `root-verified-result.json`. They report nine workspace type tasks/native exit 0 in 22.411 seconds and four complete PostgreSQL files/82 tests/native exit 0 in 22.899 seconds, with source conservation and owned-runtime cleanup. PostgreSQL files are local-factor policy, local-factor policy concurrency, SCIM administration, and pending-action credential revocation. I inspected summary/binding receipts, not the full raw runtime logs or live Docker state; cleanup and execution claims remain attributed to root.

These runs occurred on runner HEAD `1615d4a38b093dbd22bec334f8ac7e9b380ef96d` plus the exact two-file patch, not runner HEAD `ec6ede...`. Independent Git tree reads confirmed that accepted parent `28fdb2c...` and runner base `1615d4a...` both have tree `66a482a7f5bece570469a3c64804c8de6f386fbc`; matching owned hashes and the saved conservation receipts support reuse as source-equivalent root evidence. They do not become fresh exact-head hosted checks.

The ownership diagnostic remains unwired and red: 2,736 overlapping instances across 140 paths/1,514 path-line locations, with zero unresolved export, explicit exported-builder, type-diagnostic, and owned-service-violation rows in the saved summary. These are neither unique query counts nor a passing gate or whole-#580 progress claim.

## Residual and exclusions

The inherited N1 bare-string verifier-result residual remains unchanged, non-blocking for this relocation, unresolved, unfixed and unwaived. The repository union still accepts bare auth-method strings, whose branch skips a `revalidate` callback. The inspected production HTTP verifier returns structured results with revalidation; this report demonstrates no production HTTP bypass and does not infer one. This limited review does not close N1 or broaden into its remediation.

This verdict covers only the exact two-file relocation. It makes no claim of current hosted CI success, image acceptance, merge readiness or merge, publication, release/SIT acceptance, stage closure, or completion of #580 or the integration mission.

