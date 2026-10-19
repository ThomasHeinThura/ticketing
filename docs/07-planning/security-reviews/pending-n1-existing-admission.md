# N1 lifecycle admission — authentic review record

**Reviewed head:** `543738451f64933f1b822eeed7ca19f02f565ced`
**Comparison base:** accepted main `c0f3391558674996588a632ed605cb17736ca9e7`.

N1 serializes the existing challenge/proof producer and supported factor-policy writer boundaries, retains the actual enlisted executor through factor verification/finalization, and defers native authorization invalidation until the owning transaction commits. The seven production paths, two architecture contracts and two integration-test paths are unchanged from reviewed source433. No approval-consumption outer-transaction rewrite, new route, schema, dependency, capability or feature is introduced.

## Coverage and independence

Three independent native configured GPT-6 Luna/high ordinary contexts cover source `433e17a9bce7f4beeff846040b13260f1190b09c`: A01a14bcd-c24d-7192-9003-82ff7b93b56e, B01a14bf0-5c00-7723-9afb-69ebecb3c137, C01a14bf2-f662-7aa1-9d06-34562bba2b88. A's adverseb73 report and authentic impact qualification are retained before its source433 clearance; those are the same context, not extra reviewers. Further full independent source Sol01a14bf5-a286-79f1-bced-c445ead4b216, configured gpt-6.1-sol/high, cleared433 after all three ordinary reviews.

Fresh current-composition ordinary context01a14c1d-bce2-7022-a8e0-e59e6e92aac1 (gpt-6-luna/high) covers ca5 and543 in two reports; those are ONE additional context. Further fresh current-composition security context01a14c22-4752-7f80-9630-1b06b9fdb3a8 (gpt-6.1-sol/high) clears exact543 after current ordinary clearance, reusing authentic full433 source coverage and directly reinspecting relevant boundaries. It is a current-composition confirmation, not a repeated full repository audit. Each reviewer declares independence from author/fixer/conductor. Native metadata corroborates configured model/effort; no served-weight attestation is claimed. Original report self-visibility wording is preserved.

Original source/remediation uses the GPT-6 Luna context01a14b94-0d40-7ec0-afd3-4221ccca4180 and retained source handoffs. Conductor root01a14000-d9e0-7bb1-b3fd-2c0204a4834c owns composition, execution, refs and this transport wrapper; the conductor does not provide independent approval.

## Current composition and actual checks

543 has parents ca5d8c5d90a92c4da485f37ebbbb699f90c7deac and acceptedc0f3391558674996588a632ed605cb17736ca9e7, tree84d73ce6ce60bb5e1aca5abe8edaf5af1eec475e/3440entries. All eleven N1 blobs exactly equal reviewed433 and actually testedca5; all other accepted-main entries are conserved. ca5 imported four disjoint accepted833 startup paths;543 adds only three disjoint accepted834 planning records. No later product change is hidden in this note publication.

Actual runner HEADca5: workspace typecheck9tasks/native0/21.234641s, log3870B SHA25665a5aff39a4285a704f7433179f8cfdbcc6fe4726a0f4b895f0a3dc25a702873; six COMPLETE PostgreSQL files92/92/native0/24.383s, raw102827B SHA2561a6678d4f7d02e2f2ea8400a17dfd25b9cb93a472a7ddb95edfe89850efbe5ae. Files: local-factor-policy, local-factor-policy-concurrency, scim-admin, pending-action-credential-revocation, concurrent-startup-seed-race, label-bulk-rename-race. Source/cleanup/private-environment removal and complete Docker inventory conservation verified. Every non-planning input is unchanged through543, so reuse is source-bound; these were not executions launched at543 or the later publication SHA. Earlier four-file82/type9 source-equivalent checks and old-policy/old-hook counterfactuals keep their exact original sources and qualifications in the reports.

The old-policy negative demonstrates invalid minting/progress rather than waiting; later actual approval was403MFA with pending action/active target. No downstream protected-HTTP bypass was established. Original adverse impact overstatement and its authentic correction remain together. N1 source433 fixes the supported writer race; no waiver closes it.

## Carried finding and remaining gates

NB1 remains non-blocking: exported internal VerifiedStepUpAuthentication admits bare method strings that omit verifier-owned final revalidation. Current production HTTP issuers use structured closures; bare callers found are integration helpers, and no current HTTP bypass was identified. This candidate does not repair or waive that internal future-caller risk. The five local-factor-service query families remain unmoved; whole580/checker activation remains unfinished.

Exact final publication hosted checks, actual counts and candidate image build/boot/migration/health/isolation/cleanup are mandatory before merge. They were pending when this review record was prepared; expected future counts are not passes. No local browser journey was opened for this backend patch: BROWSER VERIFICATION: BLOCKED for later combined signed-image workflows. Carrier,810/811, whole589, signed combined prerelease, exact-digest laptop SIT, NONEMPTY attachment backup/usable isolated restore and final independent audit remain unfinished. No stage, UAT, production, gate waiver or verified after-turn scheduler is claimed.

## Authentic reports

The eight report bodies below are copied byte-for-byte, including adverse verdicts and labelled append-only qualifications. Headers between bodies are transport labels. The own-note publication changes only this regular100644 file; all source entries and every report are verified per commit.


### Authentic report 1

# Independent ordinary review A — N1 current composition

**Candidate:** `b73f703ab2ec3683ff0aba8a1e07933b9e2bc325`  
**Comparison base:** accepted `main` `e77e080646255f438bcb4ddca5c76390a7485ad3`  
**Independence:** fresh reviewer context; did not author, direct, or remediate the candidate.  
**Role:** ordinary review A (assigned Luna tier).  
**Model provenance:** platform context reports GPT-6; the exact Luna/Sol runtime variant is not exposed in this child context.  
**Review type:** read-only source, spec, dependency-source, and receipt inspection. No tests/probes/builds were run in this review.

## Scope checked

Reviewed the ten-path candidate diff, with focus on the four shared challenge-create/proof-issue entrypoints, pending-action lifecycle lock order, Better Auth provider enlistment and Drizzle savepoints, AsyncLocalStorage effect/audit isolation, final proof revalidation, and expiry/one-shot handling. Read the relevant PA-15 and local-factor/security contracts, the changed pending-action/security-model paragraphs, and the tests' new concurrency/provider scenarios. Inspected installed Better Auth `1.6.30` and `@better-auth/drizzle-adapter` `1.6.26` source: the plugin's `verifyTOTP` and `verifyBackupCode` use the configured adapter, and the Drizzle adapter's transaction callback opens `db.transaction`; the candidate's transaction-aware proxy therefore routes this through the enlisted Drizzle transaction and nested savepoint. The provider source confirms backup-code consumption uses a conditional update against the previously read backup-code value.

The current composed PostgreSQL receipt reports all four complete files and 78/78 tests passing on this exact candidate (20.992s); the current nine-project typecheck receipt reports success. These are inspected receipts, not executions by this reviewer. The current concurrency suite covers lifecycle admission and savepoint-failure cases, but not a local-factor-policy write racing between final revalidation and proof issuance.

## Blocking finding

**B1 — High: final factor-policy revalidation is not serialized with policy updates.**

`issueOperationTokenRecord` runs the revalidation and then updates the challenge to `issued` in the same savepoint (`apps/api/src/auth/repository.ts:879-924`). Password revalidation reads policy through `loadLocalFactorState` (`apps/api/src/auth/step-up-api.ts:1433-1456`), whose singleton policy read is an ordinary `SELECT` with no row lock (`apps/api/src/auth/local-factor-service.ts:67-73`). The step-up transaction holds `lockPendingActionLifecycle`, but the policy PATCH transaction does not acquire that gate; it independently locks/updates the singleton at `apps/api/src/instance/local-factor-policy.ts:121-134`.

Under PostgreSQL READ COMMITTED, this interleaving is possible: (1) a password proof's final revalidation reads policy `off` and passes; (2) the policy PATCH commits `required_everyone` or a required-role policy; (3) proof issuance updates the unrelated `step_up_confirmation` row and commits. The resulting password-authenticated token was minted after the stronger policy became current. A later pending-action approval consumes its bound token without loading/rechecking local-factor policy (`apps/api/src/pending-action/service.ts:787-809`), so the token can still authorize the protected deactivation. This defeats the candidate's stated post-verifier current-factor recheck for a concurrent policy change. The lifecycle advisory lock alone cannot close the race because the policy writer does not take it.

**Required correction:** serialize policy changes with the final policy read through issuance, for example by locking the singleton policy row for share/update in the admitted transaction (with a consistent lock order), or by making policy writers participate in the same lifecycle gate. Add a real PostgreSQL concurrency regression that commits a stronger policy after the revalidation read is reached and demonstrates that no password proof is issued under that new policy. No test was run for this review.

## Verdict

**BLOCKING.** The candidate's current revalidation can race with the authoritative local-factor-policy update. Other reviewed transaction/savepoint and provider-source claims were consistent with inspected code and receipts; no additional blocker is reported from this focused review. This verdict is limited to ordinary review A and does not provide security-review or merge approval.

## Exact-head qualification and disposition — 2026-10-18

The finding above identified a real proof-issuance race at `b73f703ab2ec3683ff0aba8a1e07933b9e2bc325`: the supported factor-policy writer was not serialized against final factor revalidation. The downstream-impact sentence was too strong. The old-writer PostgreSQL counterfactual did issue a password proof after the stronger policy committed, but an actual pending-action approval then returned `403 mfa_enrollment_required`; the action stayed pending and the target stayed active. The app's local-factor enrollment guard prevented the downstream operation. The counterfactual did not establish a protected-action bypass. This qualification narrows the impact claim; it does not alter the original report bytes or its exact-head verdict.


### Authentic report 2

# Independent ordinary review A — N1 current exact source

**Candidate:** `433e17a9bce7f4beeff846040b13260f1190b09c`  
**Comparison base:** accepted `main` `e77e080646255f438bcb4ddca5c76390a7485ad3`  
**Parent:** `b73f703ab2ec3683ff0aba8a1e07933b9e2bc325`  
**Independence:** reviewer did not author, direct, or remediate the candidate or its policy-gate repair. This context previously reviewed the parent head and is now reviewing the exact current head and full current scope.  
**Role/model:** ordinary review A, GPT-6 Luna, high reasoning.  
**Review type:** read-only source, contract, installed-provider, and receipt inspection. I ran no tests, probes, compilers, builds, database commands, or other dynamic checks.

## Scope and evidence

Reconfirmed all 11 candidate paths against the accepted base: `apps/api/src/auth.ts`, `apps/api/src/auth/local-factor-service.ts`, `apps/api/src/auth/repository.ts`, `apps/api/src/auth/step-up-api.ts`, `apps/api/src/auth/step-up-service.ts`, `apps/api/src/instance/local-factor-policy.ts`, `apps/api/src/pending-action/credential-invalidation.ts`, `docs/01-architecture/pending-actions.md`, `docs/01-architecture/security-model.md`, `tests/api-integration/local-factor-policy-concurrency.test.ts`, and `tests/api-integration/local-factor-policy.test.ts`. The seven original implementation paths and four-factor PostgreSQL scenarios are unchanged from the parent reviewed earlier; I rechecked the current source and the current 11-path diff. I read the relevant PA-15, local-factor, and authorization contracts and inspected the installed Better Auth and Drizzle adapter source in the prior pass; those paths are unchanged at this head.

The B1 repair is sound. The local-factor-policy PATCH now acquires the pending-action lifecycle advisory gate as the first statement inside its transaction (`apps/api/src/instance/local-factor-policy.ts:110-137`). Step-up final factor revalidation and proof issuance run while holding that same gate (`apps/api/src/auth/repository.ts:860-925`). Thus a policy write cannot commit between the final policy read and proof mint. For `required_role`, the existing role-row `FOR KEY SHARE` then singleton-row `FOR UPDATE` order remains intact after acquiring the gate. The added documentation states this same supported-writer boundary.

The new PostgreSQL regression cases cover both serialization orders: policy writer waits while final revalidation is held, and proof issuer waits behind a policy writer and then reads the committed required policy. In the latter case the real endpoint returns `403 step_up_unavailable`, leaves the challenge in `challenge` with its expiry at database time, stores no auth method, leaves the pending action pending, and leaves the target active. A further database regression checks the existing required-role row-lock order. The current four-file PostgreSQL receipt records 82/82 passing across the four complete files; the nine-project workspace typecheck receipt records success. These are root-produced receipts, not commands run by this reviewer. The PG log's process metadata reports parent `b73f...` with four uncommitted changed files; preflight/postflight source hashes are unchanged, and those four file hashes match the committed 433e source. The current commit differs from the tested frozen source only by committing those exact four files. This supports source-equivalent verification, not a claim that the runner launched with `HEAD=433e...`.

The retained old-writer counterfactual is bounded: two selected tests fail only because the issuer progressed instead of waiting; after actual policy PATCH 200 and proof 200, the pending-action approval returned `403 mfa_enrollment_required`, leaving the action pending and target active. The global enrollment guard in `apps/api/src/index.ts:219-239` explains that denial. This demonstrates the invalid-mint race and the fixed gate; it does **not** establish that the old proof bypassed the later protected-action guard. The other eight cases in that counterfactual were not run. The prior report has an appended qualification preserving its original bytes and correcting that impact claim.

## Findings

No blocking or non-blocking findings on `433e17a9bce7f4beeff846040b13260f1190b09c` in this ordinary review. The previously reported B1 source race is fixed at this head; its prior downstream-bypass claim is qualified above and in the append-only addendum to the prior report.

## Verdict

**CLEAR — ordinary review A only.** This does not fulfill the remaining ordinary review count, the independent GPT-6 Sol security review, hosted status checks, or merge authorization.


## Append-only metadata clarification (2026-10-18)

This note clarifies scope wording in the original report without changing its review findings or verdict. The candidate has seven production implementation paths in scope: six are unchanged from parent `b73f...`, and the seventh, `apps/api/src/instance/local-factor-policy.ts`, is the policy-writer path changed in this delta. The four-path repair delta also includes two documentation paths and the concurrency test; the existing test path among the seven original implementation paths is unchanged.

The assignment was GPT-6 Luna with high reasoning. This records the configured task/native-context assignment; I did not independently observe the served model weights or runtime label.


### Authentic report 3

# Independent ordinary review B — N1 exact source

**Candidate:** `433e17a9bce7f4beeff846040b13260f1190b09c`  
**Comparison base:** `e77e080646255f438bcb4ddca5c76390a7485ad3`  
**Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate.  
**Role/model:** Ordinary reviewer B; configured assignment GPT-6 Luna. This context cannot inspect a separate served-model/weights label, so the assignment is the available provenance.  
**Review type:** Read-only source, contract, installed Better Auth adapter, test-source, and receipt inspection.

## Scope and evidence

Reconfirmed exact HEAD and clean status in `/Users/heinthura/.codex/worktrees/pending-n1-existing-admission-20261018`; reviewed all 11 changed paths from the accepted comparison base: the seven production source paths, two architecture contracts, and two PostgreSQL integration test paths.

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the review packet, and PA-15/security-model requirements. Inspected the complete current policy PATCH and the step-up repository/service/API path, lifecycle lock implementation, AsyncLocalStorage transaction proxy and credential adapter wrapper, and installed Better Auth 1.6.30 TOTP and backup-code verifier source. The four actual challenge/proof producer entrypoints enter the lifecycle transaction before their first row lock. The policy PATCH takes the same advisory gate before the role-row then singleton lock sequence. Local-factor state, password lookup, and provider adapter writes use the admitted transaction; TOTP/backup-code calls run within savepoints, child-hook effects are merged only after savepoint success, and session-delete native authorization invalidation is queued until commit. Final revalidation checks the live session, factor/policy and instance-admin status before minting. The pending-action record also rechecks the bound action fields.

Static review commands included `git rev-parse HEAD`, `git status --short`, `git diff --stat`, `git diff --name-status`, scoped `git diff`, `rg`, `sed`, `nl`, and reads of installed package source and evidence files. I ran no tests, probes, compilers, formatters, builds, database commands, or mutations.

I inspected the root’s typecheck and PostgreSQL run receipts and logs. They report the nine-task workspace typecheck and four complete PostgreSQL files with 82/82 passing. The recorded runner candidate is parent `b73f703ab2ec3683ff0aba8a1e07933b9e2bc325`, with four changed files in its dirty worktree; the packet and source-hash records state that the complete 11-file candidate bytes were conserved through commit. This supports source-equivalent evidence, not a claim that the runner launched at `HEAD=433e17a9bce7f4beeff846040b13260f1190b09c`. These are root-produced receipts, not checks run by this reviewer. No hosted current-SHA checks were inspected or claimed.

## Findings

**Non-blocking — make final revalidation mandatory in the service type.** `VerifiedStepUpAuthentication` in `apps/api/src/auth/repository.ts` still accepts bare `"password" | "totp" | "backup_code"` values. Both issue-record functions skip `verification.revalidate(...)` for a bare string. Current production route wiring returns the structured object with revalidation, and the bare-string call sites found are integration-test helpers, so I found no present HTTP bypass. Keeping the bypass in the exported service contract weakens the documented invariant for future/internal callers; make the structured result mandatory and adapt helpers when convenient.

No blocking findings on the exact candidate.

## Verdict

**CLEAR WITH ONE NON-BLOCKING FINDING — ordinary review B only.** This does not fulfill the remaining ordinary review count, the required independent GPT-6 Sol security review, hosted checks, or merge authorization.


### Authentic report 4

# Independent ordinary review C — N1 exact source

**Candidate:** `433e17a9bce7f4beeff846040b13260f1190b09c`  
**Comparison base:** accepted `main` `e77e080646255f438bcb4ddca5c76390a7485ad3`  
**Independence:** Fresh review context; did not author, direct, or remediate this candidate.  
**Role/model:** Ordinary reviewer C; configured assignment GPT-6 Luna. The served-model/weights label is not exposed to this context.  
**Review type:** Read-only source, contract, test-source, and evidence-receipt inspection.

## Scope and evidence

Confirmed clean worktree and exact HEAD/base. Reviewed all 11 changed paths:

- `apps/api/src/auth.ts`
- `apps/api/src/auth/local-factor-service.ts`
- `apps/api/src/auth/repository.ts`
- `apps/api/src/auth/step-up-api.ts`
- `apps/api/src/auth/step-up-service.ts`
- `apps/api/src/instance/local-factor-policy.ts`
- `apps/api/src/pending-action/credential-invalidation.ts`
- `docs/01-architecture/pending-actions.md`
- `docs/01-architecture/security-model.md`
- `tests/api-integration/local-factor-policy-concurrency.test.ts`
- `tests/api-integration/local-factor-policy.test.ts`

Read `AGENTS.md`, the active mission, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the PA-15 section and the changed security-model implementation invariant. Also read the current review packet and both ordinary reports as evidence inputs, then verified relevant claims directly against source. Inspected the current endpoint wiring, all challenge/proof service callers found by static search, lifecycle lock implementation, local factor loading, transaction/savepoint wrappers, Better Auth hook-effect queueing, policy PATCH transaction, and changed HTTP/PostgreSQL regression scenarios.

The repair establishes a coherent serialization order. Each step-up producer enters `withTotpSessionEnrollment`, which obtains the existing lifecycle advisory gate before its first locked session/action/challenge row. Policy PATCH obtains that same gate as its first statement in the transaction, then retains the required-role `FOR KEY SHARE` followed by singleton `FOR UPDATE` order. Final proof creation rechecks the live session, binding and verifier state in a nested savepoint; denial expires the still-challenge row using the admitted outer transaction. The HTTP verifier returns structured revalidation closures for password, TOTP and backup code. Better Auth factor calls run in an enlisted nested savepoint, and child audit/effect queues are merged only after that savepoint succeeds. The session-delete native-authorization hook queues publication until outer commit.

The changed tests include real HTTP policy-writer/step-up races for both serialization orders, actual session-cookie/CSRF requests, required-role/delete lock-order cases, verifier and provider rollback cases, and one-shot challenge cases after post-check denial or recovered mint failure. The policy-first pending-action case checks the response and stored challenge/action/target state; it does not claim a downstream authorization bypass. The old-writer negative receipt likewise supports the lock/progress distinction and its reports correctly preserve that no later protected-action bypass was established.

Read the root-produced receipts but ran no checks myself. They report workspace typecheck exit 0 for nine tasks and four complete PostgreSQL integration files with 82/82 tests passing. The PG invocation ran with parent `b73f703ab2ec3683ff0aba8a1e07933b9e2bc325` and four dirty files; pre/post source manifests match, and the root packet states the complete candidate bytes were conserved through commit. This is source-equivalent evidence, not a test claim launched at `HEAD=433e...`, and it is not hosted current-SHA status. Static commands used here were `git rev-parse`, `git status`, `git diff`, `git show`, `rg`, `nl`, `sed`, `wc`, and reads of the cited reports/receipts. No tests, probes, compiler, formatter, build, database, or mutation commands were run.

## Findings

**Non-blocking — make the structured revalidation result mandatory for proof issuers.** `VerifiedStepUpAuthentication` in `apps/api/src/auth/repository.ts:18-25` still includes bare `"password" | "totp" | "backup_code"` alternatives. Both issue-record functions skip `verification.revalidate(...)` for those alternatives (`repository.ts:561-564, 878-881`). The current production HTTP route returns the structured object (`step-up-api.ts:1431-1457, 1485-1505`); the bare-string callers I found are integration-test service helpers, so this inspection found no present HTTP bypass. The exported issuer contract nevertheless allows a future/internal caller to mint without final factor, identity, session and admin revalidation, contrary to the PA-15 invariant now documented for these entrypoints. Require the structured result at the issuer boundary and adapt the helpers, or isolate any deliberately weaker test seam.

No blocking findings on the exact candidate.

## Verdict

**CLEAR WITH ONE NON-BLOCKING FINDING — ordinary review C only.** This does not fulfill remaining review requirements, the independent GPT-6 Sol security review, hosted checks, or merge authorization.


### Authentic report 5

# Independent full security review — N1 lifecycle admission and policy serialization

**Reviewed head:** 433e17a9bce7f4beeff846040b13260f1190b09c
**Comparison base:** e77e080646255f438bcb4ddca5c76390a7485ad3
**Worktree:** /Users/heinthura/.codex/worktrees/pending-n1-existing-admission-20261018
**Role/model provenance:** Required full independent security reviewer, assigned GPT-6 Sol; native task context `/root/n1_433e_full_security_sol`. The assignment is the available configured identity. This context cannot independently inspect served model weights or a separate runtime model label.
**Independence:** Fresh review context. I did not author, materially design, direct, or remediate this candidate. I reviewed after the three ordinary reports cleared. No child reviewers were spawned.
**Review boundary:** Static, read-only review of the complete 11-path candidate and necessary adjacent contracts/callers/provider internals. I made no product-source changes and ran no tests, probes, Node/AST/compiler, formatter, installation, build, database, Docker, commit, push, or ref mutation. The only write is this report outside the repository.

## Verdict

**CLEAR WITH ONE NON-BLOCKING FINDING — full security review of the exact head above.** No blocking security finding identified. This verdict is not merge authorization, hosted CI clearance, runtime/browser acceptance, or approval of a subsequent product/composition SHA.

## Scope inspected

Confirmed exact HEAD and clean worktree at both the start and end. Read AGENTS.md, agent-workflow.md, CLAUDE.md, active-mission.md, current status and newest decision-log entries, the relevant CI security scope, auth-and-identity local-factor requirements, PA-15 and lifecycle lock-order requirements, and the security-model session/step-up contract. Read the source packet and authentic ordinary A/B/C reports as evidence, then checked their relevant claims against the source.

Reviewed all candidate paths against the accepted comparison base:

- apps/api/src/auth.ts
- apps/api/src/auth/local-factor-service.ts
- apps/api/src/auth/repository.ts
- apps/api/src/auth/step-up-api.ts
- apps/api/src/auth/step-up-service.ts
- apps/api/src/instance/local-factor-policy.ts
- apps/api/src/pending-action/credential-invalidation.ts
- docs/01-architecture/pending-actions.md
- docs/01-architecture/security-model.md
- tests/api-integration/local-factor-policy-concurrency.test.ts
- tests/api-integration/local-factor-policy.test.ts

Adjacent inspection included the actual HTTP auth wrapper and global factor guard in index.ts; lifecycle lock implementation; pending-action creation and user-deactivation approval transaction; reset-MFA and administrative session/suspension paths; require-current-instance-admin; credential-aware Drizzle adapter and AsyncLocalStorage proxy; database-clock helper; required-role deletion trigger; and production issuer callers found by repository-wide static search. Inspected installed Better Auth 1.6.30 TOTP, backup-code, verify-two-factor, internal-adapter and database hook code, the installed Drizzle transaction adapter, and Better Auth core transaction/hook queues. No dependency was downloaded or changed.

## Security assessment

The four shared producer families now obtain the existing global pending-action lifecycle advisory gate before their first row lock. Service orchestration passes the admitted executor through repository/password/factor reads and retains it through proof finalization. This removes the earlier producer-held-row versus lifecycle-gate inversion without rewriting approval consumption's outer transaction. Administrative deactivation/suspension continues to take its instance-admin serialization lock before the lifecycle gate; the reviewed producer path does not acquire that admin lock in reverse order.

The policy PATCH repair is necessary and effective for the supported writer. Its first transaction statement obtains the same lifecycle gate. Required-role validation still locks the role FOR KEY SHARE before locking/updating the singleton FOR UPDATE, matching the existing role-delete trigger's role-to-singleton dependency. Thus this PATCH cannot commit between admitted final policy revalidation and minting. Policy updates after an already-issued proof remain outside retroactive invalidation, as expressly documented. I found no newly introduced lock-order cycle in the inspected paths.

The production HTTP verifier returns structured results for password, TOTP and backup code. Password finalization checks that the same password hash remains current, that factor policy still permits password-only proof, that the same active person remains, that the original agent session is still live, and that the actor remains a current active-staff instance administrator. Local-factor results recheck the active person, enabled factor, original live session and administrator status. The final repository pass also rechecks the challenge's exact person/session/binding, nonce, state and wall-clock expiry; pending-action issuance additionally rechecks owner, pending state, expiry and the expected deactivation action/type/confirmation/route. Operation finalization rechecks operation/route/version and canonical body hash. Existing server-owned binding construction remains in place. Session expiry uses clock_timestamp rendered as UTC for the schema's timestamp-without-time-zone session column; challenge and token timestamps use their proper database-clock convention.

Real provider calls are enlisted in a nested savepoint on the admitted backend. The database proxy supplies the current Drizzle transaction to adapter statements and nests adapter transactions rather than opening a detached backend. Installed backup-code verification uses an atomic compare-and-set of the encrypted backup-code set; the caller requests disableSession:true. TOTP verifies the real installed provider and cannot use a different returned user. Existing refusal of Better Auth admin endpoints and factor-disable/replacement shortcuts remains in place.

Child audit counters and after-commit effects merge into the parent only after provider-savepoint success. A provider rejection or SQL error discards that child's queue. The session-delete native-authorization hook now queues against the current child/root enrollment context and executes only after outer commit; outside that context it retains immediate behavior. Better Auth's own pending hook execution is still enclosed by the TaskDesk provider callback/savepoint, so provider failure does not publish the queued native effect. Outbox/state writes use the enlisted executor. Pending-action audit failures remain post-commit reporting, including the newly propagated enrollment-context count.

Proof minting has a separate savepoint after a successful verifier. A final denial expires the still-challenge row; a recovered mint-savepoint failure also expires it through the admitted outer executor, then rethrows only after that outer transaction completes. Successful provider-side effects, including consumed backup codes, therefore remain committed on those outcomes while no proof is returned. The documented outer-transaction/connection-failure limitation is accurate: this is not a persistence guarantee if the outer transaction cannot commit. Invalid nonce/verification and challenge replays remain fail-closed; no fallback from required factor to password was found.

The changed regression sources meaningfully observe database progress and row availability, rather than treating a timeout as success. They cover all four admitted producer families; one-shot behavior after recovered mint failure; real provider backend identity and successful-factor persistence after mint failure; real provider SQL rollback; administrator post-check denial; discarded publication when an expired original session is deleted and rolled back; policy-first verifier rejection; issuer-first policy serialization; and role-before-singleton order. The policy-first test delegates the real factor loader and records that the enlisted verifier sees required_role/required:true/enabled:false; it checks database-clock expiry while state remains challenge, 403 step_up_unavailable, no auth method, pending action unchanged, and active target.

The old policy writer race was a real invalid-mint/serialization defect. Its retained counterfactual shows completed policy/proof responses and an issuer progressing while the final factor read was held. The same evidence explicitly shows the later pending-action approval was refused by the enrollment guard with 403, leaving the action pending and target active. I do not infer or claim a downstream protected-HTTP bypass from that counterfactual.

## Findings

**NB1 — Non-blocking: require structured verifier results at the exported issuer boundary.** `VerifiedStepUpAuthentication` in auth/repository.ts:18–26 still accepts bare password/totp/backup_code strings. Both issuer-record functions condition final verifier revalidation on the result being an object (repository.ts:561–564 and 878–881). Bare results still receive repository session/challenge/binding checks, but omit the verifier-owned current factor/person/admin checks. All production issuer callers found under apps/packages use the HTTP closure that returns the structured object; bare-string callers found are integration-test helpers. There is therefore no demonstrated current external authentication bypass, and this does not block the current candidate. The exported contract nonetheless permits a future/internal caller to omit a documented proof-issuance invariant. Follow up by requiring the structured result at the issuer boundary and adapting test helpers, or isolating an explicitly test-only weaker seam. I independently assessed this finding rather than inheriting its severity from ordinary B/C.

**Blocking findings: none.** The earlier B1 policy writer race is fixed by this head. No gate is waived by that disposition.

## Commands and evidence attribution

I actually ran read-only `pwd`, `git status`, `git rev-parse`, `git log -1`, `git diff --stat/--name-only` and scoped full diffs, `rg`/`rg --files`, `sed`, `cat`, `ls`, and Python standard-library JSON/hash inspection. Live `gh pr list --state open` and `gh issue list --state open` were read; no N1 PR appeared in that inventory. I did not inspect or claim hosted checks for this head.

Root-produced receipts inspected:

- `pending-n1-policy-final-pg-preparation-root/types-native.json` and types.log record native exit 0 for pnpm typecheck, 9 successful tasks, with 3 cached. Wall duration 21.374 seconds; raw log 3,870 bytes, SHA256 28dda1653edae8ff6c0bc54bccf8c006ce1ed4ab91371006daa24b3ee6d1717f.
- `pending-n1-policy-final-pg-root/vitest-result.json`, invocation, pre/postflight manifests, log-integrity record and log show four entire integration files (local-factor-policy, local-factor-policy-concurrency, scim-admin, pending-action-credential-revocation), 82/82 pass, native exit 0, 22.643 seconds process duration. Raw log 102,064 bytes, SHA256 2aed8fbbb851d3a45df7bf3fe39f70a6cb96be7e4788abd8c1818ce6eb041243.
- The PG runner metadata says HEAD b73f703ab2ec3683ff0aba8a1e07933b9e2bc325 with four dirty repair files. I independently hashed all 11 current candidate files: every SHA256 matches both the recorded preflight and postflight owned-file manifests. This supports source-equivalent reuse, not a claim that execution launched at HEAD 433e17a, and not hosted exact-head status.
- `pending-n1-old-policy-negative-root` result, raw failure excerpt, disposition and selected-source-conservation receipt show 2 selected failures, native exit 1, 5.518 seconds, no timeout; 8 cases were not selected. Both failures differ on progressed versus waiting. Raw log 10,866 bytes, SHA256 24b14779246741cb673eb04400588c369f7a22229713ee331a08f09ac4998d47. The source-conservation receipt bounds reuse to the selected issuer-case prefix, not the later changed whole file.

I recomputed the three raw-log hashes listed above. These are inspected root executions, not tests run by this reviewer. Earlier 78-test/provider-hook and clock-neighbor evidence is referenced by the packet; I have not relabelled those historical executions as current runner-head evidence or independently rerun them.

## Limits and remaining gates

This review covers the complete candidate diff plus the adjacent boundaries named above, not a new full-repository audit. No browser screen or deployed runtime was opened by this reviewer. No new migration, dependency, capability, route, schema or approval-consumption rewrite is introduced by this candidate. The broader query-ownership work, Carrier acceptance, stage completion, exact-head hosted checks, required source-bound image build/boot/health evidence, signed release, laptop SIT, backup/restore and final audit are not certified here. A later composition or product change requires its applicable exact-current review coverage. Authentic report publication must preserve this report and the normal review-record rules.


### Authentic report 6

# Independent ordinary review — N1 current composition

**Candidate:** `ca5d8c5d90a92c4da485f37ebbbb699f90c7deac`  
**Tree:** `8270163896e82340449c8bd2e7b45a12334f5ba0`  
**Parents:** N1 source `433e17a9bce7f4beeff846040b13260f1190b09c`; accepted source `cf67fefc3957f00032d89f13056d9b8d585aa609`.  
**Independence:** Fresh ordinary-review context; I did not author, direct, or remediate N1 or the accepted incoming change.  
**Role/model:** Ordinary composition reviewer; configured assignment GPT-6 Luna, high reasoning. This context cannot independently attest served weights.  
**Review type:** Static and read-only. No tests or probes were run.

## Scope and composition identity

I read the repository instructions, active mission, workflow, adapter guide, current status/decision records, and the relevant PA-15, pending-action, security-model, local-factor, executor, and column-startup contracts. I inspected the exact merge parents/tree, the composition receipt, the three original ordinary reports and original full Sol report for 433, the retained adverse-parent disposition, the two incoming source files, the relocated startup repository, its existing migration entry point, the changed PostgreSQL test source, and the exact-head receipts.

I independently recomputed SHA-256 for all eleven N1-owned files in the receipt: all match the 433 source pins exactly. The merge tree is the candidate tree recorded in the receipt. The four incoming accepted paths are disjoint from those eleven files:

- `apps/api/src/database/repositories/column-migration.repository.ts`
- `apps/api/src/migrations/column-migration.ts`
- `docs/07-planning/security-reviews/query580-column-startup.md`
- `tests/api-integration/concurrent-startup-seed-race.test.ts`

A tree-entry comparison of accepted parent `cf67fef` with this candidate found exactly the eleven intended N1-owned file differences; the other 3,428 accepted-parent entries are identical. The candidate is clean at the pinned SHA. The current composition therefore preserves the reviewed N1 source bytes while adding the four accepted startup-seed files.

## Review assessment

The incoming code extracts the existing column seed operation into a repository and makes its transaction-local helper accept the repository `Executor`. The migration module keeps exporting `migrateColumns` and `COLUMN_SEED_LOCK_NAMESPACE`; the existing API startup caller still imports the same migration entry point. The per-project transaction still takes the same advisory transaction lock before selecting/inserting columns, and task mapping remains after that transaction with the same project/status/null-or-distinct predicate. The added integration assertions cover task mapping after the concurrent seed, project-specific same-slug mapping, intentionally incomplete existing columns, unknown statuses, and repeat-run row/version stability. I found no behavioral conflict with N1's lifecycle admission, factor verification, policy serialization, or enlisted executor/provider-savepoint paths: the incoming migration has no shared source paths or changed auth call graph.

The original three ordinary reports and full Sol report covered the unchanged eleven-path N1 source and left one non-blocking finding open. The original ordinary-A blocker was resolved by 433; its retained report remains separately qualified as to downstream impact. On this composition I found no new blocking or non-blocking finding. The prior NB1 remains open because its source is byte-identical: the exported step-up issuer type still accepts bare factor-result strings, and issuer functions skip verifier-owned final revalidation for those values. Reviewed production HTTP callers use the structured result, and earlier source review found bare-string callers only in integration helpers, so no current HTTP bypass was demonstrated. Require a structured verifier result at the issuer boundary or isolate the weaker test seam in later work.

## Receipts and limits

I inspected, but did not rerun, the exact-candidate receipts. The recorded typecheck completed with native exit 0 across nine tasks in 21.234641 seconds; its 3,870-byte raw log hashes to `65a5aff39a4285a704f7433179f8cfdbcc6fe4726a0f4b895f0a3dc25a702873`. The PostgreSQL run records the exact candidate SHA, six complete integration files, 92/92 passing, native exit 0, and 24.383 seconds. Its 102,827-byte raw Vitest log hashes to `1a6678d4f7d02e2f2ea8400a17dfd25b9cb93a472a7ddb95edfe89850efbe5ae`. The preflight and postflight source manifests match at the candidate; cleanup returned zero and the inventory-conservation receipt records no added or missing containers, volumes, or networks. These are root-produced receipts, not tests I ran.

Static commands actually run: `pwd`, `git status`, `git rev-parse`, `git show`, `git diff`, `rg`, `sed`, `cat`, `tail`, and a Python standard-library SHA/tree comparison. I ran no tests, probes, AST/compiler, formatter, install, build, database, Docker, browser, or mutating Git command. No hosted exact-head checks, full image build/boot/health, runtime/browser acceptance, merge readiness, release, or stage completion is claimed.

## Verdict

**CLEAR WITH ONE CARRIED NON-BLOCKING FINDING — ordinary review of the current composition only.** This review covers composition compatibility and the incoming startup delta. It does not replace the fresh independent GPT-6 Sol review required for the current candidate, confer merge approval, or certify other gates.


### Authentic report 7

# Independent ordinary review — N1 current records composition

**Candidate:** `543738451f64933f1b822eeed7ca19f02f565ced`  
**Tree:** `84d73ce6ce60bb5e1aca5abe8edaf5af1eec475e`  
**Comparison base:** accepted main `c0f3391558674996588a632ed605cb17736ca9e7`.  
**Prior reviewed composition:** `ca5d8c5d90a92c4da485f37ebbbb699f90c7deac`.  
**Parents:** `ca5d8c5d90a92c4da485f37ebbbb699f90c7deac`, `c0f3391558674996588a632ed605cb17736ca9e7`.  
**Independence:** Same fresh context as the ca5 composition review. I did not author, direct, or remediate N1, PR #834, or these accepted records.  
**Role/model:** Ordinary current-composition reviewer; configured assignment GPT-6 Luna, high reasoning. Served weights are not independently visible here.  
**Review type:** Static and read-only. No tests or probes were run.

## Scope and composition identity

I reviewed only the three newly composed records paths against the exact merge parents and the prior ca5 report: `docs/07-planning/integration-execution-queue.md`, `docs/07-planning/status.md`, and `docs/07-planning/security-reviews/conductor-833-n1-policy-checkpoint.md`. I read the complete incoming additions, the dated snapshots and historical suffixes they preserve, the prior N1 ordinary A/B/C and full Sol reports, the ca5 composition report and receipt, PR #834's protected-acceptance receipt, and the ca5 typecheck/PostgreSQL source receipts.

The checkout is clean at exact HEAD `5437384`; `origin/main` is exact accepted parent `c0f3391`. The candidate tree matches the composition receipt. The only differences from ca5 are the three listed documentation paths; they are disjoint from all eleven N1-owned paths. I independently recomputed all eleven owned-file SHA-256 values: every value matches the receipt and remains unchanged from both ca5 and reviewed source 433. Tree comparison against accepted parent c0f shows exactly those eleven N1-owned paths differing; all other accepted-main entries are identical. Tree comparison against ca5 shows exactly the three documentation additions/updates, with all other prior candidate entries unchanged.

The accepted-parent receipt records PR #834's normal protected merge at 2026-10-17 23:09:09Z, exact published candidate `29d03ada8051ac006e2ef6f532b1bdac7f3c7f59`, accepted main `c0f3391`, equal publication tree, and no bypass, force push, or direct main push. The new status and queue snapshots accurately describe #833 as accepted and N1's next step as current-composition review/gates. They keep the earlier 22:17 and 22:29 observations dated separately and do not backdate later facts into those snapshots. The checkpoint note preserves its factual-review chronology and qualifiers; it introduces no product behavior, policy, or gate semantics.

## Source-bound evidence and finding

The ca5 typecheck receipt records nine successful tasks and native exit 0. Its six complete PostgreSQL files record 92/92 passing at exact candidate ca5, with source preflight/postflight manifests matching. Those tests were not launched at 543. Reuse is source-bound only: this composition changes the three records paths above, while all product, test, and startup-review inputs in the ca5 receipts remain byte-identical. No runtime or hosted result at 543 is claimed.

The earlier three ordinary reviews and full independent Sol review covered the unchanged N1 source and left NB1 open: the exported proof-issuer type still permits bare factor-result strings that omit verifier-owned final revalidation. Earlier source review found present production HTTP callers use the structured result and did not demonstrate a current HTTP bypass. This records-only delta does not alter or resolve NB1. I found no new blocking or non-blocking finding in these three documentation paths.

## Commands and limits

Read-only commands used: `git status`, `git rev-parse`, `git show`, `git diff`, `sed`, `cat`, and a Python standard-library SHA-256/Git-tree comparison. I ran no tests, probes, compiler, formatter, install, build, database, Docker, browser, or mutating Git command. I make no claim about hosted checks, image/runtime acceptance at 543, merge readiness, or stage completion. This review does not replace the further independent Sol confirmation required on the exact current candidate.

## Verdict

**CLEAR WITH ONE CARRIED NON-BLOCKING FINDING — bounded review of the three documentation paths in current composition 543 only.** No new findings. NB1 remains open. This is not merge approval or approval of any later publication/report delta.


### Authentic report 8

# Independent security review — N1 exact current composition

**Reviewed head:** 543738451f64933f1b822eeed7ca19f02f565ced
**Comparison base:** accepted main c0f3391558674996588a632ed605cb17736ca9e7
**Prior full-source security coverage:** 433e17a9bce7f4beeff846040b13260f1190b09c, comparison base e77e080646255f438bcb4ddca5c76390a7485ad3
**Prior runtime-tested composition:** ca5d8c5d90a92c4da485f37ebbbb699f90c7deac
**Tree:** 84d73ce6ce60bb5e1aca5abe8edaf5af1eec475e; 3,440 entries.
**Parents:** ca5d8c5d90a92c4da485f37ebbbb699f90c7deac and c0f3391558674996588a632ed605cb17736ca9e7.
**Role/model:** Further independent current-composition security reviewer; configured assignment GPT-6.1 Sol (`gpt-6.1-sol`), high reasoning. Native task context `/root/n1_543_composition_security_sol`. Configuration is the available provenance; this context cannot independently attest served model weights or inspect a separate runtime model/version label.
**Independence:** Fresh reviewer context. I did not author, materially direct, or remediate N1 or the accepted incoming work. I reviewed after the current ordinary composition reports cleared. No children were spawned.
**Depth:** Current-composition security confirmation using authentic prior full-source Sol coverage, with direct static reinspection of the composition and relevant authentication boundaries. This is not a freshly repeated full review of unchanged N1 sources or a full-repository audit.

## Verdict

**CLEAR WITH ONE CARRIED NON-BLOCKING FINDING — security confirmation of exact current composition 543738451f64933f1b822eeed7ca19f02f565ced.** No new blocking or non-blocking security finding. NB1 remains open. This is neither merge authorization nor approval of an unseen later publication SHA.

## Identity, evidence integrity and source coverage

Read AGENTS.md, active mission, agent workflow, CLAUDE.md, current dated status, newest decision-log entries, authoritative CI security scope, PA-15, security-model step-up/session requirements, local-factor requirements in auth-and-identity.md, and the repository Executor contract. Read the bounded current review packet and composition receipt, all three original ordinary reports, original full Sol report, retained adverse b73 ordinary-A report with its impact qualification, and both ca5/current543 ordinary composition reports.

I independently recomputed the packet's SHA-256: 5,417 bytes, `c5dc2e85d893b74453b1296ccb84ed54ab3cb4da7a7ef1157ae00b9de867cd81`. All five authentic original/adverse report byte counts and SHA-256 values match the review-input manifest. I inspected native review provenance: separate recorded contexts/configured assignments corroborate the ordinary A/B/C and further full Sol roles at 433, and the current ordinary composition context. Hash equality identifies bytes; the reports' independence declarations and native provenance are distinct evidence, not proof of served weights.

Confirmed clean exact HEAD at the start and end, stated merge parents and tree. Recomputed all eleven N1-owned working-file hashes and all corresponding Git blobs at 433, ca5 and 543: every SHA-256 matches the composition receipt at all three sources. These are seven production paths (auth.ts; auth/local-factor-service.ts; auth/repository.ts; auth/step-up-api.ts; auth/step-up-service.ts; instance/local-factor-policy.ts; pending-action/credential-invalidation.ts), two architecture contracts and two local-factor integration test files. Original ordinary-A's append-only metadata clarification distinguishes seven production paths from its earlier ambiguous implementation-path wording.

Full tree-entry comparisons, including modes and object identities, establish:

- Against accepted c0f3391, exactly the eleven intended N1-owned entries differ; every other accepted-main entry is identical.
- Against ca5, exactly three incoming records paths differ: status.md, integration-execution-queue.md and security-reviews/conductor-833-n1-policy-checkpoint.md. All other ca5 entries are identical.
- Against 433, exactly seven entries differ: those three records plus column-migration.repository.ts, the migration re-export, concurrent-startup-seed-race.test.ts and the accepted column review note.

Inspected the intervening graph and per-parent merge diffs rather than relying only on a final net diff. The first-parent compositions introduce the four accepted startup paths, then the three accepted planning paths; neither edits an N1-owned input. The later three-path delta contains 133 additions and zero deletions. It preserves dated chronology and historical reports, introduces no policy or check-read contract, and does not convert original433 or ca5 evidence into tests/reviews launched at543. I do not treat the accepted records as fresh authority.

The authentic 433 full Sol report covers the complete eleven-path source plus adjacent authorization, lifecycle, installed Better Auth 1.6.30 and adapter boundaries. Those covered N1/adjacent source inputs are unchanged here. I reuse that report only for its original source scope and provide this separate current composition confirmation. Its original verdict is not relabeled as a review performed at543.

## Direct composition and security assessment

Inspected the actual accepted column repository, direct migration facade, startup caller, shared Executor definition, changed PostgreSQL test source, and the original-to-current extraction diff. `migrateColumns` still resolves through the same public migration import. Its type-only Executor import adds no runtime module initialization. The helper receives the real per-project transaction and uses that handle for the advisory lock, column read and inserts. Namespace4_004, project predicates, default values, insertion order, seed-only-if-empty rule, post-commit task mapping, version increment and IS DISTINCT FROM predicate are preserved. The startup caller retains application-role checks before running the seed. There is no new actor-facing route, credential/configuration path, authorization decision, or auth/provider hook connection. Its existing create-versus-startup and duplicate-slug residuals remain unchanged; this review does not clear them as wider guarantees.

Directly rechecked relevant unchanged N1 boundaries: the four challenge/proof producer families enter withStepUpLifecycle/withTotpSessionEnrollment; the outer transaction takes the existing lifecycle advisory gate before row locking. Policy PATCH takes that same gate as its first transaction statement, then required-role KEY SHARE before singleton UPDATE. The admitted executor reaches factor/password reads and final proof checks. The finalizer uses a nested savepoint, expires a still-challenge row through the outer executor on denial/recovered mint failure, and rethrows a recovered finalization error after the outer transaction completes. The composition changes none of these lock, expiry or outer-transaction semantics.

The credential database proxy enlists adapter statements in the current transaction and nests provider transactions. Provider child audit/effect queues merge only after successful savepoint completion. auth.ts's session-delete native-authorization hook uses runOrAfterTotpEnrollmentCommit; without an active enrollment context the existing immediate behavior remains. The current composition does not alter these provider/savepoint/effect boundaries or the dependency inputs reviewed by the earlier full Sol pass. I did not independently repeat that pass's complete installed-provider inspection.

Rechecked both record issuers and all production issuer references found by static search under apps/packages. The single production HTTP verifier supplies a structured result for password, TOTP and backup code. Its password closure rechecks the current credential hash, factor policy, identity, live original session and current instance-admin status. Factor closures recheck identity, enabled factor, original session and current administrator. All operation branches and the pending-action issuer pass that same verifier. The service wrappers pass it into the two record issuer families. No new production caller using a bare verifier string was found.

The earlier policy writer race remains independently dispositioned by the authentic433 reviews and the unchanged current gate. Its adverse report is retained. The reported old-policy counterfactual supports invalid minting/serialization failure; later actual approval was403 mfa_enrollment_required with action pending and target active. It establishes no downstream protected-HTTP bypass. The retained old-hook negative is distinct evidence about leaked publication. Neither result is recast as an execution by this reviewer or at543.

## Finding retained

**NB1 — Non-blocking internal issuer contract permits omitted final verifier revalidation.** `VerifiedStepUpAuthentication` at auth/repository.ts:18–25 still permits bare password/totp/backup_code strings. Both record issuers condition verifier-owned final revalidation on an object result (lines561–564 and878–881). Repository session, challenge and binding checks still run, but a bare result omits the closure's current factor/person/admin/password checks. Current production HTTP callers inspected here pass the structured result; the bare-return callers found are integration helpers. I found no demonstrated current HTTP bypass, so the carried non-blocking classification remains justified. The exported internal contract still permits a future caller to omit a documented invariant. This candidate neither fixes nor waives NB1; require structured results or isolate the weaker test seam in separately authorized work.

**Blocking findings: none. New non-blocking findings: none.**

## Actual commands and test attribution

This reviewer ran static read-only `pwd`, `git status`, `git show`, `git diff`, `git log -m`, `git rev-parse`, `git ls-tree` through Python subprocesses, `rg`/`rg --files`, `sed`, `cat`, `head`, `ls`, `wc`, and Python standard-library JSON/hash/tree comparisons. An initial whole-preflight/postflight-object equality assertion failed because postflight deliberately has different metadata fields; subsequent inspection established equal head/owned source hashes/checker hash and verified all fifteen pinned files against current working bytes. That was a corrected evidence-parser assumption, not a product or test failure.

I ran no tests, probes, Node/AST/compiler, formatter, installation, build, database, Docker, browser, credential/environment inspection, ref mutation, commit, push or merge. No source file was edited; the sole write is this report outside the repository. No live hosted-status clearance is claimed by this static task.

Inspected ca5 root receipts and independently recomputed both raw log hashes:

- Typecheck: nine successful tasks, native exit0, 21.234641 seconds; types.log is3,870 bytes, SHA-256 `65a5aff39a4285a704f7433179f8cfdbcc6fe4726a0f4b895f0a3dc25a702873`.
- PostgreSQL: six entire files,92/92 passed, native exit0,24.383 seconds; vitest.full.log is102,827 bytes, SHA-256 `1a6678d4f7d02e2f2ea8400a17dfd25b9cb93a472a7ddb95edfe89850efbe5ae`. The six files are local-factor-policy, local-factor-policy-concurrency, scim-admin, pending-action-credential-revocation, concurrent-startup-seed-race and label-bulk-rename-race.
- The PG invocation names exact ca5; pre/post head and all fifteen source hashes agree and match543. Cleanup records native0; inventory conservation records no added/missing containers, volumes or networks. The only ca5-to543 changes are the three planning records, so this is source-bound reuse of actualca5 execution, never new543 execution or reused required GitHub checks.

## Limits and remaining gates

The current-composition security gate has the bounded clearance stated above. This does not approve a later own-note publication commit: the conductor must verify authentic report bytes and every intervening commit's designated-note-only additions, with source/tree conservation. Required hosted checks must be genuinely green on that exact final candidate; expected future counts are not observed passes.

I certify no image build/boot/health, browser or runtime acceptance, PR existence, protected merge, formal stage closure, whole580 completion, query-checker activation, Carrier acceptance, release, SIT, recovery or final audit. The five existing local-factor query families remain unmoved; the wider580 checker remains unfinished/unwired. Source-bound shipping-image proof, exact-publication CI, canonical signed combined release, laptop HTTPS workflows, nonempty attachment backup and usable isolated restore, fresh final audit and the mission report/Hold remain separate obligations. No gate is waived.

