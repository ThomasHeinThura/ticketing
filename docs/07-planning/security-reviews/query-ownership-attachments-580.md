# #580 attachment query ownership — authentic source reviews

**Reviewed head:** `f2f78c921e2c337d52bacbdc63102fe2850e0be4`

Two independent ordinary contexts clear the full extraction/current boundary repair; a subsequent fresh independent full Sol security review clears this source. Explicit dispatches used GPT-6 Luna for authors/ordinary review and GPT-6 Sol for security; original reports retain their generic runtime identities/introspection limits. Original adverse builder-boundary report remains unchanged, followed by the materialized-output repair. API typecheck, Biome, diff checks and targeted structural analysis (eleven files, zero violations) pass; no current PostgreSQL, image or browser proof is claimed.

This is partial #580 source conversion, not attachment feature acceptance or #580 completion. The existing AT-7 immediate deletion/confirmation gap is unchanged and unwaived. Paired API-key HEAD `1bd6851496e286a111a83c658fe44bd116e11e74` includes actual authority clamp commit `00ce4b517f83587f0f46fa165b6d477dae187996`; it is intentionally absent here and its thirteen-line attachment guard delta must survive later composition. Reports preserve the original head-vs-commit confusion and author-appended clarification. #764 is reviewed but unaccepted; the #780 decision carried by unaccepted #791 remains an acceptance prerequisite. No merge, shipping-image, SIT, phase, or release claim.

---

Retained evidence file — 580-attachment-query-extraction-luna.md

# #580 attachment query ownership conversion

- **Branch:** `codex/query-ownership-580-attachments`
- **Base:** `629cb54f8f68293de58bc7b98a5e408a9f679427` (`e9df2294` plus accepted shared #580 contract `0627093`)
- **Commit:** `11cb75b5fcea3bb709c73b32935950ec1fe12bef`
- **Scope:** existing attachment index, controllers, reach helpers and repository module only.

Moved Drizzle query construction for attachment and submission attachment routes into `apps/api/src/attachment/repository.ts`. The controller/reach code now calls semantic repository functions; transaction callbacks continue to pass their actual `tx` executor. The moved queries retain their prior filters, parent/workspace constraints, selected fields, ordering, row locks, guarded updates, and transaction placement. Upload finalization/deletion, storage calls, activity recording, and audit calls remain in their existing sequence. Portal and staff submission list projections are separate to retain each original DTO.

The current `attachment/repository.ts` already contained `getAttachmentSettings`; this change extends that module, without adding dependencies, schema, route or policy changes. All direct `.select/.insert/.update/.delete` constructions were removed from the scoped `index.ts`, controller files and reach helpers.

**Full changed-file list:**

- `apps/api/src/attachment/controllers/complete-attachment.ts`
- `apps/api/src/attachment/controllers/complete-submission-attachment.ts`
- `apps/api/src/attachment/controllers/delete-attachment.ts`
- `apps/api/src/attachment/controllers/download-attachment.ts`
- `apps/api/src/attachment/controllers/list-work-item-attachments.ts`
- `apps/api/src/attachment/controllers/presign-attachment.ts`
- `apps/api/src/attachment/controllers/presign-submission-attachment.ts`
- `apps/api/src/attachment/index.ts`
- `apps/api/src/attachment/repository.ts`
- `apps/api/src/attachment/require-attachment-reach.ts`
- `apps/api/src/attachment/require-submission-attachment-reach.ts`

**Checks run:**

- `pnpm install --frozen-lockfile` — passed; installed the existing locked workspace dependencies only.
- `pnpm --filter @taskdesk/domain build`, `pnpm --filter @taskdesk/permissions build`, `pnpm --filter @taskdesk/email build` — passed as API typecheck prerequisites.
- `pnpm --filter @taskdesk/api typecheck` — passed (all five configured TypeScript projects).
- `pnpm exec biome check` on all 11 changed TypeScript files — passed.
- Scoped direct-query source scan — clean.
- `git diff --check` — passed.

**Not run:** PostgreSQL/API integration suites (Docker/PG explicitly unavailable in this task), browser verification, full lint/test suites, image build, and the planned/unwired `check:queries` gate. No runtime query behavior is claimed from unrelated storage tests; no test files were added or changed.

**Dependency and composition note:** this branch intentionally excludes the separate selected API-key authority delta from #783/#784. Composition must preserve that delta in `require-attachment-reach.ts` when the later branch pair is integrated; this conversion only delegates the original query and leaves surrounding authority logic unchanged.

**Pre-existing feature gap noticed, not changed:** attachment soft-delete remains immediate in the existing controller even though AT-7 says deletion requires a pending-action confirmation. The controller already documents that no pending-action mechanism exists. This conversion does not add or alter that behavior; track/disposition it separately under the feature contract.

No push, pull request, or acceptance claim was made. Security-sensitive upload/reach code still requires the independent review tier on the final exact candidate SHA.

## Handoff correction — base/contract acceptance status

The base is still the exact commit `629cb54f8f68293de58bc7b98a5e408a9f679427`. Correction to the parenthetical above: shared #580 contract `0627093df3ef9a7cf6784d242642a22cf887a077` is **reviewed but unaccepted** (PR #764); it must not be described as an accepted contract. Accepted `main` is `e9df2294fa580fd2885343bbef0cec28e81ead4c` only. This source conversion remains review pending and claims no acceptance.

---

Retained evidence file — 580-attachment-query-ordinary-a-luna.md

# #580 Attachment query extraction — independent ordinary review A

- **Verdict:** BLOCKING FINDING
- **Reviewed head:** `11cb75b5fcea3bb709c73b32935950ec1fe12bef`
- **Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate.
- **Model identity:** GPT-6 (platform-reported family); this context does not expose a more specific model/version or dispatch metadata. I do not claim a Luna label.
- **Scope checked:** All eleven changed files, with focused review of `repository.ts`, all repository call sites, and the source queries at the comparison base. Read the attachment feature/storage contracts, RBAC and reach rules, `coding-standards.md` § Query ownership, `multi-tenancy.md` § Query scoping, and the current #580 mission/decision context.
- **Checks/reproductions:** Exact SHA and base verified; reviewed the full repository implementation and route/controller/reach diffs; `git diff --check` passed. No tests were run in this read-only review. PostgreSQL, browser, Docker/image verification were not run or claimed. The author-reported typecheck, Biome and source-scan results remain attributed to the author and were not independently rerun.

## Blocking finding

**Repository functions expose un-awaited Drizzle query builders to callers.** `apps/api/src/attachment/repository.ts` declares many functions that directly return `executor.select(...)`, `insert(...)`, `update(...)`, or `delete(...)` chains. Examples include `getAttachmentSettings`, `findAttachment`, `findReachableSubmissionAttachment`, `insertWorkItemAttachment`, `softDeleteAttachment`, and `listWorkItemAttachments`. Their controllers/reach middleware then await and consume those builders outside the repository. The new `getAttachmentSizeLimit` and `getSubmissionAttachmentSizeLimit` follow the same pattern. `findIntakeFeatureFlags` is a separate `Promise.all` case and resolves its two query promises.

This violates the explicit result-boundary rule in `docs/04-engineering/coding-standards.md` § Query ownership: repository functions “await their statement and return rows, DTOs or scalars, never an un-awaited query builder, so a caller cannot keep composing the statement.” It also defeats the intended repository boundary: the callers retain a composable statement rather than receiving query results. The direct-query location scan alone cannot establish compliance with this result rule. The exact-head structural checker run by the conductor reported 43 instances in these changed files (repository builder boundaries and outside callers); source inspection confirms the builder-return class is real, not a scanner artifact.

This is a query-ownership contract failure in the candidate, independent of the fact that the moved SQL predicates appear equivalent to the base. It blocks ordinary clearance for #580. I did not edit source or prescribe a repair.

## Semantic comparison and residuals

I compared the moved statements and call-site behavior against the base. I found no introduced change to the reviewed query semantics: the work-item reach join and liveness predicates, submission/requester/workspace filters, accepted-submission parent alternatives, portal `customer_visible` and undeleted filters, list projections and ordering, size/count filters, lock modes and `FOR UPDATE OF submission`, guarded pending/deleted state updates, and transaction executor placement remain represented. Upload storage calls, activity/audit ordering and route response/error handling remain in their prior controller flow. The unscoped-by-primary-key `findAttachment` uses remain behind existing reach checks and are followed by the same workspace/parent comparisons where applicable; I found no newly reachable cross-object response from this conversion.

The immediate soft-delete versus pending-action confirmation gap described by AT-7 is explicitly pre-existing and unchanged by this conversion. It is a feature-acceptance residual, not a defect introduced by this diff, and this review does not treat it as waived or accepted. The shared #580 contract at `0627093df3ef9a7cf6784d242642a22cf887a077` is reviewed but unaccepted; this report makes no acceptance claim.

---

Retained evidence file — 580-attachment-builder-boundary-repair-luna.md

# #580 attachment repository output repair

- **Model/role:** GPT-6 Luna implementation context; not an independent review.
- **Worktree:** `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- **Branch:** `codex/query-ownership-580-attachments`
- **Original source commit:** `11cb75b5fcea3bb709c73b32935950ec1fe12bef`
- **Repair commit:** `f2f78c921e2c337d52bacbdc63102fe2850e0be4`
- **Parent:** `11cb75b5fcea3bb709c73b32935950ec1fe12bef`
- **Frozen source base:** `629cb54f8f68293de58bc7b98a5e408a9f679427` (accepted main `e9df2294fa580fd2885343bbef0cec28e81ead4c`; #764 contract `0627093df3ef9a7cf6784d242642a22cf887a077` remains reviewed but unaccepted).

Addressed the ordinary-review blocker reported in `580-attachment-query-ordinary-a-luna.md`. The attachment repository now imports the canonical `Executor` from `database/executor.ts` and every exported database helper explicitly awaits/materializes its statement before returning. This includes the original `getAttachmentSettings` helper. JSONB-backed submission outputs retain their runtime values and result projections while exposing bounded JSON types to TypeScript. The staff audit-actor lookup used by the attachment route now passes through the attachment repository boundary. No schema, policy, dependency, route, workflow, checker, or other product files changed.

**Structural check:** ran the actual `analyzeQueryOwnership` implementation from checker source commit `4a69fc25194622494a7c1102b9f86f42e6b58edf` via the retained `query-checker-580` worktree against the exact 11 scoped files and the repair working tree. Result: **0 violations**. No checker suppressions or exceptions were added. Temporary diagnostic copies under the checker worktree were removed afterward.

**Checks run:**

- `pnpm --filter @taskdesk/api typecheck` — passed all five configured TypeScript projects.
- `pnpm exec biome check` over all 11 scoped files — passed; a final check of both changed files passed with no fixes applied.
- `git diff --check` — passed.
- Targeted query-ownership analyzer — 11 files, 0 violations.

**Not run:** PostgreSQL/API integration tests, Docker, browser checks, and image build, as explicitly excluded by the task. No relevant non-database test directly exercises this type-only repository boundary repair; no tests were added or changed.

The implementation remains review pending; this report is not independent ordinary or Sol review and does not authorize push/PR. Preserve the separately selected #783/#784 API-key authority delta in `require-attachment-reach.ts` when composing branches. The documented AT-7 pending-action discrepancy is unchanged.

---

Retained evidence file — 580-attachment-boundary-delta-ordinary-a-luna.md

# #580 attachment query extraction — ordinary review A delta

- **Verdict:** CLEAR FOR THIS REVIEW TIER
- **Reviewed head:** `f2f78c921e2c337d52bacbdc63102fe2850e0be4`
- **Parent / comparison base:** `11cb75b5fcea3bb709c73b32935950ec1fe12bef`
- **Frozen feature base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Independence:** Independent of the implementation author and remediation. This is a source review of the exact delta; the preceding adverse report remains preserved as evidence for its original head.
- **Model identity:** GPT-6 (platform-reported family); this context does not expose a more specific model/version or dispatch metadata. I do not claim a Luna label.
- **Scope:** Entire two-file delta (`apps/api/src/attachment/repository.ts`, `apps/api/src/attachment/index.ts`), every changed helper's call sites, and the original eleven-file extraction compared to its frozen base for query/filter/projection/lock/transaction/storage/audit conservation.
- **Checks/reproductions:** Verified exact head and parent. Independently invoked checker-source `analyzeQueryOwnership` from `query-checker-580` commit `4a69fc25194622494a7c1102b9f86f42e6b58edf` against the exact eleven scoped files using the candidate worktree's TypeScript project: **11 files, 0 violations**. `git diff --check` passed. No tests were run. PostgreSQL/API integration, Docker/image and browser verification remain unrun and unclaimed. Author-reported API typecheck and Biome checks were not independently rerun.

## Delta findings

The prior blocking result-return-boundary defect is corrected in this exact delta. Each exported attachment repository query helper now awaits/materializes its statement before returning. `findIntakeFeatureFlags` awaits both query promises through `Promise.all`. The previously existing `getAttachmentSettings` helper is included. The new `findAttachmentAuditActor` wrapper awaits the existing active-staff-person repository result, and the staff submission download route now calls that wrapper rather than importing the other repository directly. `Executor` is imported from the canonical `database/executor.ts` contract. The targeted checker independently reports zero violations for the full eleven-file scope.

I inspected the JSON result mapping changes in `findSubmissionAttachmentParent` and `findSubmissionFormSchema`. They spread/map the existing rows and cast the JSONB values for bounded TypeScript output types; no runtime transformation or field removal is apparent. The same route guards and consumers remain. The repository helper executions preserve the same Drizzle statements, query order, concurrent flag reads, transaction handle placement, projections, locks and result shapes. I found no introduced semantic or authorization defect in the two-file delta and no regression in the original eleven-file query move.

The original adverse review remains valid for `11cb75b5fcea3bb709c73b32935950ec1fe12bef`; this clearance applies only to `f2f78c921e2c337d52bacbdc63102fe2850e0be4`. It does not itself grant merge/acceptance clearance: the unaccepted shared #580 contract and remaining review/CI gates still apply. The separate API-key authority pair `1bd6851496e286a111a83c658fe44bd116e11e74` remains a later composition/conservation requirement. AT-7's pending-action confirmation discrepancy is unchanged and remains a feature-acceptance residual, with no waiver or completion claim.

---

Retained evidence file — 580-attachment-query-ordinary-b-gpt6.md

# #580 attachment query extraction — independent ordinary review B

- **Verdict:** CLEAR FOR THIS ORDINARY REVIEW TIER
- **Reviewed head:** `f2f78c921e2c337d52bacbdc63102fe2850e0be4`
- **Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Parent:** `11cb75b5fcea3bb709c73b32935950ec1fe12bef`
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate. I read earlier review reports as evidence pointers, then re-verified their claims against source.
- **Model identity:** GPT-6 (platform-reported family); this context does not expose a more specific model/version or dispatch metadata. I do not claim a Luna label.
- **Scope checked:** All eleven changed files and the complete original extraction against its frozen base. Focused on repository materialization, query/predicate/projection conservation, transaction executor placement and locks, parent/workspace/reach predicates, upload completion and deletion order, storage cleanup, activity writes, and download audit order. Read the attachment, storage, audit, query-ownership, and tenancy contracts plus the current mission/workflow.
- **Checks/reproductions:** Verified exact `HEAD`, base and clean worktree; inspected full base-to-head diffs and current repository/call sites; `git diff --check` passed; a direct query-construction scan over the scoped controller/index/reach files found no remaining `.select/.insert/.update/.delete` statements. No tests were run. The earlier independent targeted checker result (11 scoped files, 0 violations) and author-reported typecheck/Biome results were inspected as evidence but not claimed as runs by this context. PostgreSQL/API integration, Docker/image and browser verification were not run or claimed.

## Findings

I found no blocking defect introduced by this extraction. The earlier query-builder result-boundary defect is corrected at this head: exported attachment repository helpers await/materialize their statements, including the original `getAttachmentSettings`; flag reads still resolve together with `Promise.all`; and staff audit-actor lookup is awaited through the attachment repository boundary. The canonical `Executor` is used and transaction callbacks pass their actual `tx` handle into repository operations.

The full original-source comparison found the moved statements retain their previous filters, joins, projections, ordering, lock modes, and guarded writes, with one harmless projection widening noted below. In particular, submission-number/requester scope, request-type workspace scope, attachment workspace and parent checks, accepted-submission parent alternatives, portal visibility/deleted filters, liveness predicates, `FOR UPDATE OF submission`, attachment `FOR UPDATE`, shared work-item locks, pending-only completion/deletion guards, and the delete-own uploader predicate remain. Storage finalization and rejected-object cleanup stay in the same relative order; activity recording remains inside the successful work-item completion/delete transactions; audit writes remain after download URL creation and before redirect. Response/error branches retain their prior placement and status/message behavior on the reviewed paths.

The conversion keeps the existing primary-key-only `findAttachment` read followed by the same workspace/parent comparisons and the preceding route reach middleware. This is preserved source behavior, with no new cross-object response path found in this diff. It should not be cited as a newly added tenant-scope improvement.

## Non-blocking observation and residuals

`lockAttachmentWorkItem` adds `work_item.id` to the selected projection when `workspaceId` is supplied (`repository.ts`, around line 500). The original rejected-pending-upload cleanup lock selected only `projectId`, `deletedAt`, and `archivedAt`; the extra id is unused and does not alter its lock or predicate. This is a small query-shape difference, not a blocker.

The immediate soft-delete versus AT-7 pending-action confirmation discrepancy predates this candidate and remains unchanged. It is a feature-acceptance residual; this review does not waive it or claim AT-7 completion.

The conversion's `require-attachment-reach.ts` change contains only the query extraction. It does not contain the separately selected API-key authority clamp. I checked the supplied hash `1bd6851496e286a111a83c658fe44bd116e11e74`: in this checkout it resolves to a fixture typing change, not that authority delta. The authority change visible in history is commit `00ce4b517f83587f0f46fa165b6d477dae187996` (the `projectCapabilityRefused` guard). Preserve that authority delta in the later paired composition and review it at its required tier.

This report clears only this ordinary review role at the exact reviewed head. It does not supply the required fresh GPT-6 Sol security review for the security-scope reach paths, any CI/runtime/browser evidence, shared-contract acceptance, or #580/carrier completion.

## Factual clarification — paired API-key authority head

The prior paragraph identified the supplied object `1bd6851496e286a111a83c658fe44bd116e11e74` by its tip commit subject, which is indeed the final fixture-typing commit. That observation did **not** establish that the paired PR head lacked the earlier authority change. I verified the full head range: `00ce4b517f83587f0f46fa165b6d477dae187996` is an ancestor of `1bd6851496e286a111a83c658fe44bd116e11e74` (`git merge-base --is-ancestor` exit 0). The common base with the reviewed extraction base is `c35666c531c4b84c300bac5432fd4dc8dca3ed4f`; the `c35666..1bd68514` diff contains the 13-line `require-attachment-reach.ts` authority delta (9 insertions, 4 deletions) routing refusal through `projectCapabilityRefused`. Therefore paired PR head `1bd68514` does include the authority delta, while the attachment-query candidate reviewed here does not. Preserve the paired PR head's full delta during composition. No source files or review verdict were changed by this clarification.

---

Retained evidence file — 580-attachment-query-security-sol.md

# #580 attachment query extraction — independent full security review

**Verdict: CLEAR for this security review tier at the exact reviewed head.** I found no new authority, tenant-isolation, upload-finalization, deletion, or audit defect introduced by the query extraction. This is a source verdict, not runtime or feature acceptance.

- **Reviewed head:** `f2f78c921e2c337d52bacbdc63102fe2850e0be4`
- **Comparison base:** `629cb54f8f68293de58bc7b98a5e408a9f679427`
- **Role and independence:** Fresh, independent full security reviewer. I did not author, direct, remediate, or ordinarily review this candidate. I read both ordinary review records, then independently checked their material claims against the source.
- **Model provenance:** Dispatched as `GPT-6 Sol`; this context has no platform runtime model/version introspection, so dispatch identity is recorded without asserting intrinsic verification.
- **Scope:** All eleven changed files, their original statements at the frozen base, repository callers and the attachment reach, storage, permissions, audit, and pending-action contracts. I checked source semantics, not a composed candidate or deployed system.

## Checks performed

`git rev-parse HEAD` returned the reviewed head; the worktree was clean. `git diff --check 629cb54f... f2f78c...` passed. A query-builder scan of the ten changed controller, route, and reach files returned no `.select`, `.insert`, `.update`, `.delete`, or `.execute` calls. I ran `pnpm --filter @taskdesk/api typecheck`; all five configured TypeScript projects passed. I inspected the full base-to-head diff, the complete extracted repository and callers, and the exact statements in the frozen base. No PostgreSQL tests, Docker/image boot, browser verification, hosted checks, or runtime acceptance were performed in this review. The earlier author/checker report states 11 scoped files and zero checker violations; I did not rerun that checker and do not claim it as my result.

## Security assessment

The extracted queries keep the original submission number and requester checks, request-type workspace join, accepted-submission parent alternative, portal customer-visibility and deletion filters, work-item/project liveness filters, row-lock modes, and pending-state write guards. The repository helpers receive the actual `tx` handle in each transaction and await/materialize rows before returning. `findSubmissionAttachmentParent` and `findSubmissionFormSchema` cast JSONB output types without changing the decoded runtime values; downstream guards continue to inspect the same data. `findIntakeFeatureFlags` retains concurrent reads and the same feature-gate decision.

Work-item upload completion still finalizes storage first, verifies size and magic bytes at the final key, rechecks the live parent under a shared row lock, and records `attachment.added` in the same transaction as the guarded pending-to-ready update. Submission completion still locks submission and attachment rows, verifies bytes, and uses a pending-only update or deletion with the same cleanup branches. Soft delete still checks uploader ownership, locks the live parent, updates only a non-deleted row, and records activity only for a winning update. Downloads still require a ready row after reach middleware, create a storage URL, append `attachment.downloaded`, then redirect or return the URL. The staff submission audit actor continues to resolve through `getActiveStaffPerson`; its repository wrapper adds an await without changing actor choice.

The generic `findAttachment` helper reads by id before the existing caller-side workspace/parent checks, and submission-download routes read again after their guarded middleware. This pattern existed at the frozen base. I found no new route from the extracted helper to an unauthorized response; the extraction does not establish stronger tenant predicates or remove the original read-to-use window. That is a residual design boundary, not a new clearance claim.

## Residuals and composition

AT-7 requires a pending action and explicit requester confirmation for attachment deletion. The existing route immediately soft-deletes; the candidate preserves that discrepancy. It remains a feature-acceptance residual and is neither waived nor fixed by this verdict.

This exact candidate excludes the separate API-key attachment-reach authority clamp. The supplied current pair head `1bd6851496e286a111a83c658fe44bd116e11e74` is a later fixture-typing commit and descends from the actual clamp commit `00ce4b517f83587f0f46fa165b6d477dae187996`. Later composition must preserve and review that authority delta at its own exact head; this review does not cover it. The shared #764 query-ownership contract remains unaccepted in the described integration train. No #580, AT-7, #764, carrier, image, or runtime acceptance follows from this review.

**Blocking findings introduced by this candidate:** none. **Non-blocking findings:** the generic id-only lookup retains the original caller-enforced tenant boundary; the conditional work-item lock projection adds an unused `id` when `workspaceId` is supplied but changes no predicate or lock.
