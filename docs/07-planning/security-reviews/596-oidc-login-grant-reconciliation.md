# PR596 — complete login grant reconciliation and structural provenance repair

## Completed repository-read relocation delta

**Reviewed head:** `b78a0ff467ada896ae7e7586aeae62575692ba13`

Fresh independent Luna ordinary review and lightweight Sol confirmation are CLEAR on the complete three-file relocation delta from17c351cb. All nine reads retain their executor, query shape, lock and caller timing. No authority or gate pass/fail semantics changed. Author actual native acquisition passes2files16tests; each independent reviewer instead ran query gate, API four-project typecheck and diff checks, without claiming the author's PostgreSQL execution as their own. This source delta does not clear inherited hosted/integration, provider or phase gates.

### Independent ordinary report (verbatim)

# P3 OIDC query relocation review — GPT-6 Luna

- **Candidate:** `b78a0ff467ada896ae7e7586aeae62575692ba13`
- **Base:** `17c351cb52f2b092b6a4ebc24e6d26bd9f3920ed`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate.
- **Scope:** Exact three-file delta in `apps/api/src/identity/repository.ts`, `oidc-login.ts`, and `oidc-group-mapping-admin.ts`; specifically the nine Drizzle reads moved into repository helpers and their immediate transaction/locking call sites. This is a bounded relocation review, not a re-review of the unchanged OIDC feature.
- **Risk classification:** Security-scope identity paths. The reviewed delta only moves existing query expressions behind repository functions and does not alter authority decisions or gate semantics. Per the repository's lightest security-scope tier, one fresh ordinary Luna review plus an independent lightweight Sol confirmation is required.

## Verdict

**CLEAR — no blocking or non-blocking findings.** The nine moved reads preserve their filters, joins/projections, ordering, limits, row-lock clauses and execution context. The closure discovery → ordered lock → re-read path remains in the caller and unchanged. The post-commit cache invalidation/session issuance boundary is outside the changed query expressions and remains unchanged.

## Review details

Compared the baseline query expressions at the exact base SHA against the repository helpers and their call sites:

1. `getOidcConnectionSnapshot`: `tx`, all connection columns, id predicate, limit one.
2. `findOidcIdentityForClosure`: `tx`, same connection/issuer/subject predicates, same `{id, personId}` projection and limit one.
3. `listAdmissionFailedOidcGrants`: `tx`, same person/external-identity/connection/source/revocation filters, projection, id ordering and `FOR UPDATE`.
4. `getOidcPersonForSignIn`: `tx`, full person row, id predicate, limit one.
5. `listActiveOidcGrantsForSignIn`: `tx`, same person/connection/external-identity/source/revocation filters, selected grant fields, id ordering and `FOR UPDATE`.
6. `listOidcMappingsForReconciliation`: `tx`, same connection filter, full mapping rows and id ordering.
7. `getOidcRoleForReconciliation`: `tx`, full role row, id predicate, limit one.
8. `getOidcGroupMappingSnapshot`: global `db`, same connection+mapping predicates, full row and limit one. This matches the prior callback's global `db.select` executor; it was not changed to the transaction executor.
9. `listOidcMappingAffectedUserIds`: `tx`, person `userId` projection and `inArray(person.id, personIds)`. Copying the readonly id list to a mutable array for Drizzle typing preserves the input values and SQL semantics.

Login still performs non-authoritative connection/identity discovery before `lockScimGrantClosure`, then locks/revalidates the connection and identity before reconciliation. The mapping PATCH still uses its pre-existing global-db mapping/connection snapshots for closure discovery, then locks and re-reads through `tx`; no relocated helper acquires a new lock or changes that order. Group/admin invalidation remains after the transaction. No changed line touches session issuance.

## Checks actually run

- `pnpm check:queries` — passed: all recognized Drizzle read-method calls remain owned by `repository.ts` files.
- `pnpm --filter @taskdesk/api typecheck` — passed (all four configured API TypeScript projects).
- `git diff --check 17c351cb52f2b092b6a4ebc24e6d26bd9f3920ed..HEAD` — passed.
- PostgreSQL/integration was not rerun: this delta is query relocation only, and direct source comparison establishes executor and query-shape equivalence. No database or Docker work was performed.

No files in the candidate worktree were modified.

### Independent security confirmation (verbatim)

# P3 OIDC query relocation — independent GPT-6 Sol security confirmation

**Reviewed head:** b78a0ff467ada896ae7e7586aeae62575692ba13

- Comparison base: `17c351cb52f2b092b6a4ebc24e6d26bd9f3920ed`; candidate worktree HEAD was verified equal to the reviewed head and clean.
- Independence: fresh GPT-6 Sol reviewer context; I did not author, direct, or remediate the candidate.
- Ordinary review: fresh GPT-6 Luna `p3-query-relocation-luna-b78a0ff4.md`, CLEAR on the same SHA.
- Classification: identity security-scope path, but this exact three-file delta only relocates nine reads to `identity/repository.ts`. It makes no authority or gate pass/fail change, so the lightweight Sol confirmation tier applies.

## Verdict

**CLEAR — no blocking or non-blocking findings in this bounded delta.** The nine helper calls use the same executors, selected fields, predicates, order, limit, and row-lock clauses as their inline predecessors. The closure-discovery, ordered-lock, re-read, and post-transaction invalidation/session-issuance ordering remains at the same caller positions.

## Source checked

I compared the exact base-to-head diff of `apps/api/src/identity/repository.ts`, `oidc-login.ts`, and `oidc-group-mapping-admin.ts`. In login, the connection and identity observations still use the transaction before `lockScimGrantClosure`, then the locked connection/identity are re-read before admission and grant changes. Both grant queries retain `personId`, connection, external identity, the two source kinds, non-revocation, `ORDER BY id`, and `FOR UPDATE`. Person, mappings, and JIT role reads remain in the transaction and keep their predicates/limits. The mapping PATCH discovery read still uses global `db` (as it did at base), followed by the same transaction closure lock and locked re-read. Affected-user lookup retains the transaction and person-id filter; copying the readonly input array preserves its values. No changed line moves a write, proof consumption, audit event, cache invalidation, or session issuance.

Relevant authority sources checked: `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, identity decision log, and `docs/01-architecture/rbac.md` identity-grant/connection rules. This confirms relocation equivalence only; it is not acceptance of the unchanged OIDC feature.

## Checks actually run

- `git diff --check 17c351cb..b78a0ff4`: passed.
- `pnpm check:queries`: passed; recognized Drizzle reads are owned by repository files.
- `pnpm --filter @taskdesk/api typecheck`: passed all four configured TypeScript projects.
- I did not run PostgreSQL integration, Docker, browser, or deployment checks. The author's reported native/domain/permissions tests are separate evidence and were not re-run or counted as my checks.

## Residual / merge boundary

This verdict is bound to the source SHA above. It does not clear the inherited OpenAPI, G8/G11, browser, deployment, full PR CI, or phase-finalizer obligations. A changed candidate head needs delta review at its actual risk tier; only the top-level orchestrator may assess merge gates.

---

**Reviewed head:** `bc03f460c9e52ca6ba8dc11b7fdcfe10c6dcd049`

This records the independent full review atb7 and the fresh independent current-head
security delta atbc03, verbatim below. The former stays BLOCKED historically; the latter
closes its sole remaining timestamp-based reason-classification blocker. No old full
verdict is relabeled current. Subsequent security-review-only descendants retain these
reviews through demonstrated executable/test source equivalence.

Three fresh ordinary panels independently reviewed the complete10-file login implementation
atc3 and identified the same reason-classification defect. One complete shared evidence and
classifier remediationb7 then cleared a fresh strong Luna delta review. The independent full
Sol pass found that display-only mapping edits were still mistaken for authority changes.
The finalbc03 structural fix compares current locked mapping/role/scope/eligibility facts
with grant provenance and uses no metadata timestamp as authority evidence. A real PA15
administrative display-snapshot PATCH plus validated callback proves the grant stays intact
until complete-set removal, then grant/event/audit all record claim_removed.

The AGENTS structural repeated-class rule permits this clean required Sol pass to close
narrower same-class remediation without another comfort ordinary panel. No gate is waived.
Author final isolated native1file7 passed with teardown; the fixture sequencing failure
before that run stays failed. Fresh Sol checks domain31, contracts2, four API typecheck
projects and diff; it inspects native regressions but does not rerun PostgreSQL.

Operator-visible Health overage warning remains unimplemented. Customer flow-state lacks
explicit organisation id without an established cross-tenant exploit in these reviews.
No full IP28, real provider, browser, container, hosted CI, protected merge or phase acceptance
claim. Human design review remains deferred to integrated P4.

Original full report SHA-256: `e86279982e102e740c4f43554da36d7aec8f6c47a54b10d78d9c5cbcc295126b`.
Original current delta report SHA-256: `ed6e5ec8db0793bde044daa6f7ae770d32d1b7d35ea73ef085843a37169a418a`.

---

## Historical full security review

# P3 complete OIDC validated-login grant/admission — independent GPT-6 Sol security review

- **Reviewer:** GPT-6 Sol, fresh independent context. I did not author, direct, or remediate this candidate.
- **Reviewed head:** `b7c90c87ba38e098470e1c228abff405801420b9`
- **Full implementation comparison base:** `5b3a33771f3c7194b419505137557d14be40dd7c`
- **Verdict:** **BLOCKED** by one reproducible source-level diagnostic-provenance defect. Grant authority still fails closed in the traced case.

## Scope

Reviewed all 11 changed files and traced the full callback → verified ID token → normalized group evidence → locked connection/admission → same-identity JIT/OIDC reconciliation → projection/events/audit → post-commit invalidation → session creation/provenance path. Read `AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, current status and decision log, IP-3/IP-7/IP-9/IP-22/IP-26/IP-27/IP-28, ADR 0015, data model, role/target validation, and existing mapping administration code. Checked previous three bulk Luna reports and the current reason-delta Luna report as context, not as substitutes for this review.

Security checks by inspection: exact issuer, tenant, audience, nonce, signature and selected connection; current locked admission; complete UUID group evidence only; source-specific mapping ownership, target/role/ceiling guards; identity and other-source isolation; closure lock/retry; denied-admission and invalid-token no-session behavior; post-commit invalidation and native/2FA session provenance. I found no claim-to-role elevation or cross-connection grant mutation in these traced paths.

## Blocking finding

**[P2] Display-only mapping edit falsely turns a later upstream group removal into `mapping_changed`.** `classifyOidcGrantRetirementReason` treats `mapping.updatedAt > grant.lastConfirmedAt` as an authority change (`apps/api/src/identity/oidc-login.ts:80-93`). A mapping PATCH that changes only `externalGroupNameSnapshot` sets `updatedAt` but expressly does **not** retire grants, because `authorityChanged` excludes this field (`apps/api/src/identity/oidc-group-mapping-admin.ts:483-532`). Sequence: validated login confirms group G and its grant; admin edits only G's display snapshot; next valid complete ID token omits G. The grant is correctly retired, but its `revocation_reason`, `group.member_removed.detail.reason`, and audit reason count say `mapping_changed`. IP-28/ADR 0015 require `claim_removed` for a removed group from complete evidence while the mapping remains authority-equivalent. The misleading event/audit provenance matters to incident response and is exactly the behavior this final delta adds. A regression should cover this sequence, including matching row/event/audit reason. Removing the timestamp heuristic is viable only if the independently locked mapping writer's immediate authority-change retirement invariant remains enforced.

## Residuals and limits

- The operator-visible God Mode → Health overage warning is still absent. This is an explicit IP-28 integration/phase acceptance residual, not evidence that the login's overage revocation preserves authority. Do not claim complete IP-28 or real-provider acceptance from this review.
- IP-7 specifies that customer OIDC state carries the persisted organisation id; the current `parseFlow`/state value records connection, portal, nonce, PKCE verifier and redirect URI, but no organisation id. Customer connection ownership is immutable and login uses the locked connection's organisation, so I did not establish a cross-tenant exploit from this omission. It remains a contract-completion item for the broader OIDC flow.
- No real Entra/JWKS runtime, PostgreSQL integration, concurrent-writer probe, Docker/image, browser, network, or performance execution was performed in this review. The integration file was inspected, not counted as a passing test. This is neither phase-finalizer nor production acceptance.

## Checks actually performed

- `git rev-parse HEAD` confirmed the 40-character head above; `git status --short` was clean.
- `git diff --stat` and changed-file list from full base confirmed 11 files, 1,371 insertions and 219 deletions.
- `git diff --check 5b3a3377..HEAD` passed.
- `pnpm --filter @taskdesk/domain exec vitest run src/identity/identity.test.ts`: **1 file, 31/31 tests passed**.
- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/oidc-group-mapping-contract.test.ts`: **1 file, 2/2 tests passed**.
- An initial root `pnpm exec vitest ...` invocation failed because no root `vitest` binary exists; the package-local commands above succeeded. This failed invocation is not a test failure or a pass.

The finding requires a new candidate head and exact-head delta review at the applicable tier. I made no source edits, merge, CI, or phase claim.

---

## Fresh current-head security delta

# P3 OIDC login structural provenance correction — independent GPT-6 Sol security review

- **Reviewer:** GPT-6 Sol, fresh independent context. I did not author, direct, or remediate this candidate.
- **Reviewed head:** bc03f460c9e52ca6ba8dc11b7fdcfe10c6dcd049
- **Delta comparison base:** b7c90c87ba38e098470e1c228abff405801420b9
- **Full implementation base:** 5b3a33771f3c7194b419505137557d14be40dd7c
- **PR:** #596; GitHub's head matched the reviewed head when checked.
- **Verdict:** **CLEAR for the exact-head security delta and the previously blocking diagnostic-provenance class.** No new blocking source finding. This is not a statement that CI, provider acceptance, or the phase is complete.

## Scope and reasoning

Read AGENTS/workflow/CLAUDE, the current status and newest decision-log entries, IP-22/IP-27/IP-28 and related IP-7/IP-26 mapping rules, ADR 0015, the data-model provenance and mapping entries, the prior full Sol review at `b7c90c87` and the independent Luna delta report. The prior **full** Sol report remains historically **BLOCKED** at that old head; it is not relabeled clear. This report reviews the new exact-head correction against that previously traced full path.

Inspected the complete two-file `b7c90c87..bc03f460` diff and re-traced the current classifier and callers in `oidc-login.ts`, verified-token claim normalization, the current locked mapping/role eligibility checks and closure retry, the mapping administration writer, and the callback integration regression. The classifier now uses overage/missing/malformed/complete claim evidence and the current mapping's existence, enabled/eligible state, role, scope and target. It no longer treats `mapping.updatedAt` or `grant.lastConfirmedAt` as proof of changed authority. A complete valid array omitting the group with a still-eligible authority-equivalent mapping yields `claim_removed`; an absent, malformed or overage group claim retires with its distinct reason; an absent, disabled, ineligible or mismatched mapping yields `mapping_changed` for complete evidence. The selected reason is used for the grant row, removal event and audit reason count. No changed code grants from an unverified token or from non-complete group evidence.

The mapping writer's display-snapshot PATCH updates metadata and configuration version but does not retire grants; its authority-changing role/target/enable edits immediately retire the mapping's grants in its transaction. Thus removing the timestamp heuristic does not defer an actual administrative authority change. The added regression performs a real PA-15 step-up and PATCH, checks the active grant survives the display-only edit, then submits a valid complete empty group list and checks `claim_removed` through the existing row/event/audit helper. Existing integration cases cover missing/malformed/overage, changed role, disabled mapping, invalid token, negative admission, and source isolation. The new delta does not change keep/add/revoke decisions, transaction boundaries, post-commit invalidation or session creation/binding; the source trace found no new authority boundary or cross-identity mutation.

## Checks actually performed

- `git rev-parse HEAD` and `git status --short`: exact 40-character head above and clean worktree.
- `git diff --check b7c90c87..HEAD` and full-base diff check: passed; delta is 2 files, 49 insertions and 6 deletions.
- `pnpm --filter @taskdesk/domain exec vitest run src/identity/identity.test.ts`: **1 file, 31/31 tests passed**.
- `pnpm --filter @taskdesk/api exec vitest run ../../tests/api/oidc-group-mapping-contract.test.ts`: **1 file, 2/2 tests passed**.
- `pnpm --filter @taskdesk/api typecheck`: passed all four API TypeScript projects.
- GitHub PR #596 head matched the local SHA. At inspection, required checks were still in progress and several were red, so this report is **not merge approval** or a claim that the protected gates are green.

The PostgreSQL callback integration test was inspected but **not run by this reviewer**. The orchestrator reports a separate one-file/seven-test local pass; its actual output and environment remain for the orchestrator to verify and cite independently. I did not run PostgreSQL, Docker, a real provider, browser, network, performance, or concurrency probes.

## Residuals and limits

- The operator-visible God Mode Health overage warning remains absent, an IP-28 integration/phase residual with no demonstrated grant retention in the traced login path.
- IP-7 customer OIDC flow state does not explicitly carry persisted organisation id. Locked connection ownership is used at login; this review did not establish a cross-tenant exploit, but the contract item remains.
- CI currently has red/in-progress checks at the exact head. The orchestrator must resolve or accurately disposition those checks through the normal protected flow; this security verdict waives none.
- This is exact-head PR security-delta review, not a whole-P3 phase finalizer, full real-provider certification, deployability acceptance, or permission to merge.

**Reviewed head:** bc03f460c9e52ca6ba8dc11b7fdcfe10c6dcd049
