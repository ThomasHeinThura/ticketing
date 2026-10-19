# #580 finite repository result contracts — independent reviews

**Reviewed head:** `ecd47ba1ab184d41ff7a1461b06d464216c2efb1`
**Comparison base:** `945c768d1276646fa546f0f92f135c63f73b070a`

This bounded candidate narrows approval and saved-view callbacks to their actual finite results, types the existing invitation EXISTS expression as boolean without changing its SQL object, and preserves the original materialized portal JSON value at the repository boundary. The pre-existing record assertion remains field-local at the existing HTTP DTO boundary. Six source/test files change; no SQL, predicate, executor, lock, callback timing, effect, validation, decoder or public schema behavior changes.

One strong fresh independent GPT-6 Luna review passed. A further fresh full independent GPT-6.1 Sol security review cleared the exact source. Both inspected actual semantics and confirmed the bounded review tier; this is not a phase finalizer. Author/planner session `01a14a9d-3c92-73e3-8a6a-e0db3e1d07e9` used native `gpt-6-luna/medium`; ordinary reviewer session `01a14b4a-c050-7e00-9c65-05cc28ca2c06` used `gpt-6-luna/high`; security session `01a14b4e-4362-78d2-98a4-1432ac364ece` used `gpt-6.1-sol/high`. These are three distinct contexts. Native turn-context metadata corroborates model/effort; session_meta has no model field. Material advisers and the conductor supply no independent approval.

The authentic reports below are preserved verbatim. The ordinary report's original header was correct; its two mistaken 39-character prose references and parent-acceptance wording are explicitly corrected by that reviewer's appended clarification. Original bytes remain. The security report separately reopened the root receipts and verified their integrity. The ordinary report was initially saved under a mistakenly literal private-evidence shorthand in the primary checkout; root preserved its exact bytes outside the repository before removing only that owned artifact and empty directories. This affected no product source or verdict.

## Root verification and limits

Root ran all five API type projects, nine workspace type/build tasks (six executed, three unchanged dependency builds cached), and all three unchanged query-checker regression tests. Eight complete PostgreSQL files passed all 101 tests, native exit zero, with exact owned disposable PostgreSQL cleanup, conserved container/volume/network inventories and source hashes, and private ephemeral environment removal. The new test has six persisted JSON cases inside one test: object, array, number, ordinary string, JSON-looking string and JSON null. It compares raw driver, typed column, repository and own HTTP output plus exact response keys. It records existing materialization behavior, not a new malformed-record API contract.

Root OpenAPI matched 284 operations; permissions passed sixteen files / 107 tests; lint-ci passed 2,409 files with 240 existing warnings and one info, no fixes. These checks ran on frozen `484deb849dc04e7dde92838a421e11d29a059e68` plus the patch. Its entire parent tree equals accepted `945c768d1276646fa546f0f92f135c63f73b070a`; normal fast-forward and commit preserved all six bytes/status/verification inputs. Independent security review checked that conservation. These are reused source-equivalent results, not falsely described as executions on a later Git commit.

The unchanged full query diagnostic remains deliberately red and unwired: 2,787 overlapping instances across 147 paths / 1,542 path-line locations, five unresolved export modules, zero TypeScript diagnostics and zero explicit exported-builder rows. Five export findings disappeared and none were added. These are overlapping diagnostics, not unique queries or progress. Retained parser attempts were corrected without changing raw results. No checker exemption or activation occurred.

The malformed-record portal schema assumption remains unblessed. The security report's locally labelled N1 is this portal residual; it is separate from inherited pending-action N1, which remains unresolved and unwaived. The pre-existing anonymous-status discrepancy and nonempty/conditional form-schema behavior were not repaired. Current-publication hosted CI and shipping-image build/boot/health still must pass before protected acceptance. Carrier, remaining #580/#589, canonical signed combined release, exact-digest laptop SIT, consistent NONEMPTY-attachment backup, usable isolated application restore and final independent audit remain outstanding. No stage completion, UAT, production or gate waiver is claimed.

## Authentic strong ordinary review

# Strong ordinary review: #580 finite repository contracts

- **Reviewed head:** `ecd47ba1ab184d41ff7a1461b06d464216c2efb1`
- **Comparison base:** `945c768d1276646fa546f0f92f135c63f73b070a`
- **Reviewer:** GPT-6 Luna, high reasoning; fresh independent context `01a14b4a-c050-7e00-9c65-05cc28ca2c06`, forked with no inherited turns. I did not author, direct, or remediate this candidate.
- **Worktree:** `/Users/heinthura/.codex/worktrees/query580-finite-contracts/Ticketing.v2`; HEAD matched the reviewed head and the worktree was clean at review start.
- **Scope:** static review of the exact six-file diff, directly relevant call sites and feature/API contracts. No source edits.
- **Tests/reproductions run by reviewer:** none. The review assignment explicitly called for static review. Root-reported verification is separate evidence and is not represented as my test run.

## Files and contracts checked

Reviewed all six changed files: `apps/api/src/approval/repository.ts`, `apps/api/src/intake/index.ts`, `apps/api/src/intake/repository.ts`, `apps/api/src/invitation/repository.ts`, `apps/api/src/view/repository.ts`, and `tests/api-integration/intake-portal-response-shape.test.ts`. Read `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/status.md`, `docs/07-planning/decision-log.md`, `docs/03-features/intake-queue.md`, `docs/03-features/approvals.md`, `docs/03-features/views.md`, `docs/03-features/request-types-and-catalogue.md`, and `docs/01-architecture/monorepo-layout.md`.

Checked all textual call sites for `withDueApprovalRows`, `withSavedViewTransaction`, `findPortalSubmission`, and `portalSubmissionResponseSchema`, including the reminder-scan callback and portal detail route.

## Verdict

**PASS — no blocking findings.** The candidate is a bounded finite-contract refactor at the reviewed head. `withDueApprovalRows` narrows its callback and result to the three outcomes actually returned by the sole consumer (`expired`, `reminded`, `unchanged`). `withSavedViewTransaction` narrows its callback/result to the concrete pinned-view mutation object used by its sole caller. No other callers rely on the removed generic contracts. `recipientMatchesCurrentUser` returns the same `exists(...)` SQL expression and the `SQL<boolean>` annotation/assertion is erased at runtime; it does not change query semantics. The portal detail handler now makes its existing schema-derived DTO explicit while preserving the repository-materialized JSON value. No authority, query, transaction/lock, event, decoder, or validation behavior changed in the inspected diff.

## Non-blocking residual

The portal response schema in `apps/api/src/intake/index.ts` declares `submission.formData` as `z.record(...)`, while the repository materializes the persisted column as `JsonValue`. The new integration cases intentionally seed array, scalar, string, and JSON-null values and assert their HTTP output; these values do not conform to that declared record shape. The record cast has moved from the repository result construction to the route DTO assignment, so it remains a compile-time assumption and does not validate or normalize the value at runtime. The prior implementation already made the same record assertion and sent the materialized value; this candidate does not introduce the runtime mismatch. The existing input contract also accepts only records. I treat this as a pre-existing, unblessed malformed-record HTTP assumption and do not count it as a blocker for the narrowly scoped refactor. The test documents observed persistence/driver materialization, not authorization of a new public response contract.

## Evidence provenance and limits

Root supplied exact-head conservation and acceptance evidence: source commit `ecd47ba1ab184d41ff7a1461b06d464216c2efb` on base `945c768d1276646fa546f0f92f135c63f73b070a`; composition onto accepted `945c768d1276646fa546f0f92f135c63f73b070a` preserved the six source paths byte-for-byte; native API/workspace/checker and focused PostgreSQL verification reportedly passed before protected acceptance. Root also reported protected #828 acceptance at `945c768d1276646fa546f0f92f135c63f73b070a` and cited its public acceptance comment: https://github.com/ThomasHeinThura/ticketing/pull/828#issuecomment-6239352324. These are root-provided facts, not runs or receipts independently reopened in this review context. The review covers only the six-file source diff and relevant contracts/callers; it does not claim hosted CI, image, browser, or full #580 readiness.

## Appended clarification

Correction to the evidence-provenance paragraph above: the public #828 acceptance comment is for the previously accepted composition and does **not** accept or provide hosted verification for reviewed head `ecd47ba1ab184d41ff7a1461b06d464216c2efb`. Root clarified that the exact `ecd47` source was pushed and frozen with no PR yet; this review is the ordinary review of that exact head. The root-reported native results are corroboration from a separate root context only. Hosted CI and image evidence for this candidate remain unavailable at this review point.


## Final source and verification clarification (append-only)

The exact candidate reviewed in this report is **`ecd47ba1ab184d41ff7a1461b06d464216c2efb1`** (40 characters), compared with base **`945c768d1276646fa546f0f92f135c63f73b070a`**. This full SHA supersedes the 39-character abbreviated value `ecd47ba1ab184d41ff7a1461b06d464216c2efb` mistakenly repeated in the preceding evidence paragraphs. The PASS verdict above applies to the exact 40-character candidate.

The focused PostgreSQL verification mentioned above was run on the 484d input before protected acceptance and was reported as equivalent in the relevant source paths to the accepted #828 parent composition. It was not a test run on candidate `ecd47ba1ab184d41ff7a1461b06d464216c2efb1`. The candidate was pushed and frozen with no PR yet; it has not itself been accepted. I did not independently reopen the root receipts or run those checks.


## Authentic full independent security review

# Full independent security review — TaskDesk #580 finite contracts

**Reviewed head:** ecd47ba1ab184d41ff7a1461b06d464216c2efb1
**Comparison base:** 945c768d1276646fa546f0f92f135c63f73b070a
**Model:** GPT-6.1 Sol (`gpt-6.1-sol`), high reasoning.
**Context/session:** `/root/finite_ecd47_full_security_sol`, native session `01a14b4e-4362-78d2-98a4-1432ac364ece`; provider OpenAI; parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`. Fresh context with no inherited turns. I did not author, direct or remediate the candidate. This context fills only the full security-review role, not ordinary review or phase finalizer.
**Scope:** static, read-only review of the exact six-file candidate and directly relevant callers/contracts/installed driver source. No source edits or reviewer-run tests, probes, compiler, build, database, Docker, Git mutation, PR or hosted actions.

## Start record

At review start `git rev-parse HEAD` returned the reviewed head above and `git status --short` was empty. Read the complete six-file diff against the comparison base. Review is in progress; no verdict in this start record. Findings and completion will be appended without replacing these bytes.

## Completion — full security verdict

**CLEAR / PASS for the exact six-file source candidate `ecd47ba1ab184d41ff7a1461b06d464216c2efb1` against `945c768d1276646fa546f0f92f135c63f73b070a`. No candidate-introduced blocking finding.** This is a full independent security review, not a phase finalizer, merge-readiness verdict, gate waiver, whole-#580 acceptance or stage completion.

The change remains bounded type/result-contract work plus a persisted-JSON regression. Although several feature repositories are touched, it does not introduce an authority or API-schema change, cross-package contract redesign, migration, concurrency redesign or new trust boundary. One strong independent ordinary review plus this further full independent security pass is sufficient for this candidate's actual risk. No heavier ordinary panel is required by the inspected semantics. The intake `index.ts` change makes security review mandatory under the accepted CI/CD path list.

## Source and contracts inspected

All six changed files were reviewed in full diff and the relevant enclosing functions were read:

- `apps/api/src/approval/repository.ts`: finite callback/result, due-row selection, locks and guarded state/reminder writers.
- `apps/api/src/intake/index.ts`: existing response schema, schema-derived DTO, detail handler, route/middleware registration and ownership facts.
- `apps/api/src/intake/repository.ts`: materializers, portal identity, `findSubmission`, `findPortalSubmission`, linked work-item projection and output whitelist.
- `apps/api/src/invitation/repository.ts`: actual EXISTS predicate and every read/write using it.
- `apps/api/src/view/repository.ts`: concrete transaction result and full pin-toggle transaction.
- `tests/api-integration/intake-portal-response-shape.test.ts`: setup/cleanup and both existing/new tests, including all six persisted values.

Checked every textual production call site of `withDueApprovalRows`, `withSavedViewTransaction` and `findPortalSubmission`; inspected `approval/reminder-scan.ts`, `view/controllers/pin-view.ts`, `view/controllers/get-view.ts`, the pin route and policy, intake policy and schema, `database/executor.ts`, `database/index.ts`, relevant `database/schema.ts` declarations, `openapi.ts`, and strict terminal route registration. Inspected invitation accept/reject/refusal callers, including transaction-supplied executors and both pre/post-lock reads. Inspected relevant existing tests in `invitation-repository.test.ts`, `workspace-invitation-writes.test.ts`, `view.test.ts`, `approval-closure-and-clock.test.ts`, `intake-atomic-conversion.test.ts` and `intake-reach-negative.test.ts`. The latter is source-inspected coverage only; it is not among the root's eight focused files.

Read applicable `AGENTS.md`, active mission, agent workflow, `CLAUDE.md`, coding standards (including D1/query ownership and executor/result rules), CI/CD security scope, current status/decision-log entries, monorepo layout, intake IQ-1/IQ-3 and portal API/negative contracts, approval AP-12/AP-13, saved-view SV-15–SV-20/SV-22, and relevant RBAC/security-model text. Read-only GitHub refresh returned #580 OPEN; no current finite PR or hosted clearance is inferred from the limited open-PR listing.

Also read installed Drizzle 0.45.2 `sql/expressions/conditions.js`, `sql/sql.js`, `pg-core/columns/jsonb.js`, and installed `pg-types/lib/textParsers.js`. These confirm actual SQL object construction, default decoding and JSON/string behavior instead of assuming that a TypeScript assertion installs a runtime decoder.

## Security analysis

1. **Approval transaction invariant is preserved.** The only production consumer is `scanApprovalReminders`. Its callback returns exactly `expired`, `reminded` or `unchanged`; every branch and count comparison matches the new union. The same `db.transaction` still selects a bounded, ordered batch, uses `FOR UPDATE ... SKIP LOCKED` on approval rows only, awaits each callback serially, and commits/rolls back its state, outbox and audit work together. Existing workspace/id/pending predicates, clock source, transaction handle, lease, batch cap and event scope are untouched. The removed generic result cannot now advertise an arbitrary caller-defined builder/result type. This changes static expressiveness, not authority or lock behavior.

2. **Saved-view pin mutation is preserved.** `togglePinnedView` is the sole transaction-wrapper consumer, returning exactly `{ pinnedViewIds: string[], wasPinned: boolean, isPinned: boolean }`. The unchanged transaction first takes its person/workspace advisory lock, then checks/locks the view in that workspace, reads the caller's exact preference identity, and inserts/updates the same string array. Missing view still throws before preference writes. The route's existing workspace/project reach check and controller's private/team visibility check precede the transaction; actor/person ids remain server-derived. Audit/event calculations still use the same booleans. Existing private-view refusal test asserts 404 and no outsider preference, and the positive toggle test checks persisted state/audit. This candidate adds no permission or TOCTOU change and makes no claim of redesigning existing races.

3. **Invitation match is the identical SQL predicate.** `exists(...)` constructs the same `SQL` object; `as SQL<boolean>` and the type-only import are erased, with no `mapWith`, SQL replacement, coercion, interpolation or decoder change. PostgreSQL EXISTS is boolean and the installed pg parser decodes OID 16 to a JS boolean, matching the new static type. The predicate still binds the resolved user's stored id and current stored email, compares emails case-insensitively, and does not trust a request/IdP email. Acceptance still discovers workspace before the shared membership/role lock, re-reads after that lock using the same transaction, and rechecks current recipient/pending state in the guarded write. Reject/refusal paths still distinguish absent/false/terminal and fail closed after a lost guarded update; manager reach predicates are unchanged. No invitation-to-instance-admin path or new grant is added. Existing integration source covers true/false/missing, changed stored email, revoked manager reach and guarded failures.

4. **Portal ownership and JSON output are preserved.** `PortalSubmissionSource = row` is a type annotation assigning the same object. Returning `row.submission.formData` therefore returns the same materialized value previously read through `portalRow` and asserted to a record. The route only adds shallow copies of already constructed DTO objects and relocates that one field-local assertion into the existing response-schema-derived DTO. It does not add runtime validation, normalization, reparsing or filtering. `portalIdentity` still requires an active customer. `portalOwnSubmission` and the detail repository still select by the authenticated requester's person id; a foreign/missing row fails with 404 before detail construction. The linked work-item detail remains restricted by requester id and deletion predicate, and messages retain the same declared projection. No GET write was added; no storage key, claimant, internal row id, author id or extra private field is newly returned. The existing anonymous 401-versus-spec-404 discrepancy visible in the negative test remains pre-existing and grants no content; this candidate does not resolve or bless it.

5. **The new regression exercises the real data boundary.** It creates a submission through its own portal HTTP, persists each value via the database, and compares raw driver, typed column, repository and own HTTP output, with exact top-level/submission key checks. Six cases cover object, array, number, ordinary string, JSON-looking string and JSON null. Drizzle's JSONB decoder reparses strings that are valid JSON, so the JSON-looking scalar is raw string but typed/repository/HTTP object; ordinary text stays a string after the decoder's catch. JSON null uses explicit `'null'::jsonb` rather than SQL NULL. This is meaningful evidence for preserving the existing materialized value. It is six cases inside one new test, not six new tests, and is not exhaustive coverage of every JSON value or conditional-field schema.

## Non-blocking findings and unblessed residuals

**N1 — pre-existing malformed-record HTTP/schema mismatch, retained explicitly.** The public detail schema still declares `formData` as `z.record(z.string(), z.unknown())`, and public creation still accepts a record. Persisted arrays/scalars/null can nevertheless reach the existing detail handler; its assertion does not validate those values. The former repository cast was already erased and sent those same values. Moving it to the explicit DTO does not repair or newly create that runtime mismatch. The new test records observed persistence/decoder/HTTP behavior, not approval to broaden the public contract. I do not bless malformed-record output, claim response validation, or treat this as a completed contract repair. The new fixture has `fields: []`; it does not prove malformed values are safe for arbitrary nonempty/conditional schemas in `visibleFields`. Any future normalization, rejection or schema expansion requires its own contract decision and review. This residual is not a blocker for preserving the narrowly scoped runtime behavior here.

No other candidate-introduced non-blocking security finding. The anonymous status discrepancy noted above is a separately pre-existing source-visible limitation, not a new finding caused by this patch.

## Verification evidence reopened — root runs, not reviewer runs

Evidence root: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/takeover/query580-finite-root/`.

- `source-commit/receipt.json` binds the six conserved file hashes and successful normal commit to exact `ecd47ba1ab184d41ff7a1461b06d464216c2efb1`; `accepted828-fast-forward-composition.json` preserves the dirty six-file status/diff and all verification inputs from `484deb849dc04e7dde92838a421e11d29a059e68` through accepted parent `945c768d1276646fa546f0f92f135c63f73b070a`. Independently recomputed current six file hashes match all six receipt hashes. Independently read Git tree ids: both parent commits have tree `e296711a3a8026f3b4322bb938bddc22701cfd00`.
- Read `local-verification-v1/{api-types,workspace-types,checker-tests,inventory}/receipt.json` and successful-run stdout summaries; read `inventory-comparison-v3.json`. Root native API typecheck passed all five projects; workspace typecheck passed nine tasks (three cached unchanged dependencies); checker regression passed three tests. The full query diagnostic deliberately returned native 1, with 2,787 overlapping diagnostic instances / 147 paths / 1,542 locations, five unresolved exported-type module rows, zero TS diagnostics and zero explicit exported-builder rows. It remains unwired and red. The corrected v3 comparison records exactly five export findings removed, zero added; retained parser attempts are not additional checker runs or evidence of completion.
- Read `pg-focused8-frozen484d/{vitest-invocation,vitest-result,candidate-source-preflight,candidate-source-postflight,native-log-integrity,container-cleanup,docker-inventory-conservation}.json`, and the end of `vitest.full.log`. Root passed all eight complete focused files / 101 tests, native 0, 38.769 seconds process duration. Those files are invitation repository, workspace invitation writes, approval lifecycle, approval tenant checks, approval closure/clock, view, intake portal shape and intake atomic conversion. The source remained frozen across the run. Cleanup returned 0 for the exact owned container and all container/volume/network inventory deltas were empty. This is a root-run focused PG result on **484d plus the frozen patch before commit**, not a direct test run on the later ecd47 commit and not full integration-suite/runtime acceptance.
- Read `required-local-checks/{lint-ci,openapi,permissions}/receipt.json` and stdout summaries. Root `lint:ci` passed 2,409 files, no fixes, 240 existing warnings/one info; OpenAPI matched 284 operations; permissions passed 16 files / 107 tests, five tasks (four unchanged dependency tasks cached).
- Independently verified every stored stdout/stderr hash/length in those seven local-check receipts, and all three stored logs listed by the focused PG integrity receipt. These are evidence-integrity checks only, not re-execution of any test. Read the aggregate `finite-and-pure-root-frozen-verification-1908.json`; only its finite section is relevant. The separate pure candidate is outside this review.

The source/parent/input conservation supports reuse of those root results at this exact candidate under the accepted evidence-reuse rule. None of the accepted #828 parent's prior hosted/image evidence is attributed to or accepts this six-file candidate.

## Ordinary review, provenance and limits

Read the entire authentic ordinary report `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/takeover/finite-ecd47-strong-ordinary-luna.md` (6,042 bytes, SHA256 `5c1d0a4ef7aa874320453aa3173e5d7a843f68382f097b7da6ad2717c1e79534`), including both append-only clarifications. Its PASS is bound by its correct header and final correction to the exact 40-character candidate above. The earlier two 39-character prose values and ambiguous parent-acceptance wording remain in the original bytes; the correction separates accepted parent #828 from this unaccepted candidate. That Luna context reviewed source/callers and ran no tests or reopened receipts. I do not attribute root verification to it.

Read `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/takeover/finite-ecd47-native-provenance.json` (2,182 bytes, SHA256 `0dabd9c83897baf105baae837a7959e0c5d4cf835a369e19774083124ed1f528`). It records distinct author/planner, ordinary and security sessions. Independently extracted only native session metadata and turn-context model/effort pairs from this review's own session file: session_meta reports the expected independent child path/provider/session and has no model field; actual turn_context reports `gpt-6.1-sol` / `high`. No transcript material is copied into this report. The task was dispatched to a fresh context with no inherited author turns; this reviewer performed no implementation/remediation.

**Reviewer-run tests/reproductions: none.** Review was static as assigned. A few initial text searches addressed nonexistent filenames/globs and produced read errors; subsequent source reads used discovered actual paths. Those attempts are retained in this session and are not presented as checks or passes. No source, MOVING Carrier script, Node/compiler/AST/test/probe/formatter/build/install/database/Docker/ref/commit/push/PR action was performed by this reviewer. The only write was this private report, initially created with `O_EXCL` and mode 0600, then appended.

At completion the candidate worktree remains clean at the exact reviewed SHA. No current finite hosted CI, image build/boot, browser or protected acceptance is established by this review; required gates remain required. This clearance does not enable `check:queries`, waive residuals or close #580, any stage, release or SIT acceptance.

Completion recorded: 2026-10-17T19:22:49.447865+00:00

## Final readback clarification

The final paragraph's shorthand “No source ... action” means **no source mutation or execution**; source and installed dependency files were read as documented above. A final readback additionally inspected the full remaining invitation-repository tests and the stored-email-change HTTP regression in `workspace-invitation-writes.test.ts` (real read, subsequent stored-email update, guarded rejection 403, invitation remains pending and no membership written). Final `git status --short` is empty and HEAD remains `ecd47ba1ab184d41ff7a1461b06d464216c2efb1`. Verdict and limits are unchanged.
