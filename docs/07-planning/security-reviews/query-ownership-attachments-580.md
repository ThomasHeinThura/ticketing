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


## Accepted-main composition — 2026-10-16

**Reviewed head:** `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c`

Normal merge parents are accepted main1a34 and retained source92d; treebf9d471ea90ee6b31aeec642287eb25deb029155 equals preflight. The accepted API-key project-authority clamp and repository lookup coexist. Existing PR branch was restored by fast-forward; both references and original source remain. The four reports below are authentic and unedited, including the branch erratum. Original preparation report came from the10/16 evidence directory, copied byte-exact into canonical10/15 custody (SHA c9cf37c5f7c5ba0290256955e3e2cb2dec0df0ab6d84a8926f100547ca5ff37c). Author/ordinary dispatch usedgpt-6-luna; fresh security dispatch usedgpt-6.1-sol. Prior source reviews retain their actual coverage. AT-7 is inherited and UNWAIVED; no whole-feature/runtime/merge acceptance follows.

### Retained report attachment799-accepted1a-composition-preparation-luna.md

# #799 accepted-1a composition preparation

## Result

Composed the existing #799 attachment query-ownership source onto the exact accepted #796 main input, without importing #785, #790, #798 or Carrier. The normal merge commit is `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c` on `codex/attachment-799-compose-accepted1a`.

- Parent 1 (accepted main): `1a34e5792ee9c42b15004b032e3c5410e5def44e`
- Parent 2 (#799 source): `92d0128035d1e2cf5361ad26e00d8fba3a913061`
- Tree: `bf9d471ea90ee6b31aeec642287eb25deb029155` (identical to the clean read-only merge-tree preflight)
- Worktree is clean after composition.

## Payload and conservation

The accepted-main-relative payload is the 11 attachment implementation paths below plus the retained review note. `apps/api/src/database/executor.ts`, `tests/api/database-executor.test.ts`, and `tests/api-integration/database-executor.test.ts` are already equivalent on accepted main and therefore correctly do not appear as unique added changes. No source-history-only #580 payload was replayed separately.

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
- `docs/07-planning/security-reviews/query-ownership-attachments-580.md`

The overlapping `require-attachment-reach.ts` composition conserves the accepted #784 API-key project-capability guard: imports and calls `projectCapabilityRefused`, passes `deferCapability`, `deferApiKeyCapability`, and `isApiKey: Boolean(apiKey)`, and obtains the row via `findAttachmentWorkItemForReach(db, id)`. The final blob is `fb64319ba0d061685fbd498afddb821c1786204e`, matching the preflight result; it is not the uncomposed source blob.

## Checks run

- `pnpm --filter @taskdesk/api typecheck` — passed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts ../../tests/api/attachment/magic-bytes.test.ts` — 2 files, 17 tests passed.
- `pnpm exec biome check` on the 11 changed API attachment implementation files — passed, no fixes.
- Tree, parents, full-tree identity with the preflight, guard semantics, and clean worktree checked after merge.

No PG-backed integration suite, app build, Docker, browser or CI run was performed. No test was altered or skipped.

## Adverse findings and limits

The merge was clean; no conflict resolution or manual source edit was needed. AT-7 remains an inherited, unwaived discrepancy: the feature spec requires requester-approved pending-action confirmation before attachment soft deletion, while the existing delete path performs immediate soft deletion. This query-ownership composition does not change that behavior and does not close attachment feature acceptance. Retained original reviews cover the original source SHA only; they are not review evidence for composition SHA `36ce9b6...`. Authoring this preparation/composition is not an independent review.

No PR, push, review assertion, feature acceptance claim, gate waiver, or control-plane edit was made.

### Retained report attachment799-existing-branch-restoration-luna.md

# #799 existing branch restoration erratum

## Correction

The preparation report dated 2026-10-16 described composition on a new branch as the result, which did not preserve the existing #799 PR branch as the canonical lane. Per the conductor's follow-up, I restored the composed merge commit onto the existing branch by fast-forward. The original preparation report remains unchanged.

## Evidence

- Before the operation, `refs/heads/codex/query-ownership-580-attachments` resolved to source head `92d0128035d1e2cf5361ad26e00d8fba3a913061`. `git worktree list --porcelain` showed that branch was not checked out in another worktree.
- The composed commit already existed locally as `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c`, with parents `1a34e5792ee9c42b15004b032e3c5410e5def44e` and `92d0128035d1e2cf5361ad26e00d8fba3a913061`, and tree `bf9d471ea90ee6b31aeec642287eb25deb029155`.
- Commands run: `git worktree list --porcelain`; `git show-ref --verify refs/heads/codex/query-ownership-580-attachments`; `git show -s` on the source and composition commits; `git switch codex/query-ownership-580-attachments`; `git merge --ff-only 36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c`; and post-operation `git status --short --branch` / `git show -s` on both refs.
- The original branch now resolves to `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c`. The preparation branch ref `codex/attachment-799-compose-accepted1a` remains at that same commit. Both therefore retain the same parents and tree. Fast-forward added no commit and changed no tree.
- The original branch reports `ahead 90` of its configured remote tracking ref. No push was made. This local ancestry state is recorded as observed; no remote state was changed.
- Worktree is clean. No tests were rerun, as requested.

No reset, force, update-ref, history rewrite, push, new PR or additional commit was attempted. No additional adverse attempt occurred.

### Retained report attachment799-accepted1a-ordinary-luna.md

# #799 accepted-main composition — independent strong ordinary review

- **Verdict:** CLEAR for the bounded composition delta reviewed; this is not feature acceptance.
- **Reviewed head:** `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c`
- **Comparison base:** accepted-main parent `1a34e5792ee9c42b15004b032e3c5410e5def44e`; source parent `92d0128035d1e2cf5361ad26e00d8fba3a913061`; tree `bf9d471ea90ee6b31aeec642287eb25deb029155`.
- **Independence/model:** Fresh reviewer context; did not author, direct or remediate the composition. Assigned strong ordinary GPT-6 Luna role by the conductor. The runtime did not expose a more specific model/version identifier to this context.
- **Scope:** Current composition delta for #799, centered on `apps/api/src/attachment/require-attachment-reach.ts`; conservation of the already accepted #784 API-key project-capability clamp alongside the attachment repository lookup; consistency with the retained independent full source reviews at `f2f78c921e2c337d52bacbdc63102fe2850e0be4`. This is not a fresh whole-feature review of every source behavior.
- **Repository instructions/specs read:** `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `docs/07-planning/status.md`, `docs/07-planning/decision-log.md`, `docs/03-features/attachments.md`, and retained #799 source review note `docs/07-planning/security-reviews/query-ownership-attachments-580.md`.

## Checks and review evidence

- Verified clean worktree and exact `HEAD`, both parents and tree.
- Compared `require-attachment-reach.ts` from source parent to reviewed head. The composed code retains `projectCapabilityRefused`, `deferCapability`, `deferApiKeyCapability`, and `isApiKey: Boolean(apiKey)`, and calls `findAttachmentWorkItemForReach(db, id)` for the repository-owned lookup.
- Read the shared `projectCapabilityRefused` implementation. For ordinary sessions and non-deferred API keys it refuses when `decision.capable` is false; for API keys whose capability decision is deferred downstream it still requires `decision.ownerCapable`; full deferral remains limited to the explicit `deferCapability` option. The attachment integration passes the options and key identity signal through unchanged.
- `pnpm --filter @taskdesk/api typecheck` — passed (all five configured TypeScript projects).
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts ../../tests/api/attachment/magic-bytes.test.ts` — 2 files, 17 tests passed.
- `git diff --check 1a34e5792ee9c42b15004b032e3c5410e5def44e 36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c` — passed; worktree remained clean.
- No API integration/PG suite, image, browser or CI run was performed in this review.

## Findings

No blocking or non-blocking defect found in the bounded composition delta. The attachment-specific authority clamp remains intact with the accepted #784 helper semantics, while the attachment-row lookup uses the extracted repository function. The source review note preserves two independent ordinary source reviews and a full Sol source clearance at their stated source head; those reports are not relabelled as reviews of this composition head.

The existing AT-7 discrepancy remains: the route immediately soft-deletes although the feature spec calls for requester-approved pending-action confirmation. This composition does not change or resolve it; it remains unwaived and prevents attachment feature acceptance. This review does not cover the rest of #784's broad authority changes beyond verifying the clamp at the attachment call site.

**Security review remains required:** obtain fresh independent GPT-6 Sol review on exact head `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c` after ordinary clearance. No merge, push, gate waiver, image/runtime claim, or #799/#580 acceptance is authorized by this report.

### Retained report attachment799-accepted1a-security-61-sol.md

# #799 accepted-main composition — independent security confirmation

**Verdict: CLEAR for the bounded composition at the exact reviewed head.** No introduced blocking or non-blocking security defect found. This is source review, not feature or runtime acceptance.

**Reviewed head:** 36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c

- Comparison base / accepted-main parent: `1a34e5792ee9c42b15004b032e3c5410e5def44e`.
- Source parent: `92d0128035d1e2cf5361ad26e00d8fba3a913061`; tree: `bf9d471ea90ee6b31aeec642287eb25deb029155`.
- Original fully reviewed source: `f2f78c921e2c337d52bacbdc63102fe2850e0be4`.
- Role/model: fresh independent GPT-6 Sol security context, dispatched for this role; runtime model/version introspection unavailable. I did not author, direct, advise on implementation, remediate, or ordinarily review this candidate. I read the fresh ordinary CLEAR report before this review.

## Depth and scope

This is the required fresh security confirmation of a bounded import/composition, retaining the two independent ordinary reviews and full Sol source review recorded in `docs/07-planning/security-reviews/query-ownership-attachments-580.md` at their original source SHA. Those earlier verdicts are not relabelled as exact-current-head reviews. The current composition does not redesign authority: relative to accepted main it extracts the attachment lookup while preserving the already accepted owner-capability clamp; relative to the source attachment tree the only production difference is that clamp. Accordingly a focused independent confirmation is appropriate, rather than repeating the entire source full-review panel. Security-scope controller/router paths still receive this explicit Sol pass.

Read AGENTS.md, agent workflow, CLAUDE.md, current status and decision-log portions, CI security path policy, attachment feature/storage contracts, retained source review records and fresh ordinary report. Independently examined both-parent diffs, current reach middleware, actual repository lookup and executor contract, shared project decision/refusal helper, route deferral call sites, completion/delete and download ordering.

## Findings and conservation

The accepted-main comparison changes only the attachment subtree and its retained review note: no accepted-main file outside that set is changed or lost. A scripted byte comparison confirms all 14 source attachment files other than the intentionally composed reach file are identical to original reviewed source. Thus repository transaction/lock/storage/audit code is conserved rather than rewritten by composition.

The extracted lookup selects the same attachment/work-item/workspace/project/organisation fields, joins the same tables, and retains id equality, work-item deleted/archived exclusion, project deleted exclusion and limit 1. It receives the actual shared db executor and awaits materialized rows. The row-derived workspace/project/work-item identifiers still feed workspace validation and project policy evaluation; reach failure remains 404 and capability/customer refusal 403. No caller-supplied tenant scope replaces these values.

`projectCapabilityRefused` and its inputs match accepted-main behavior. Normal sessions/nondeferred keys require capable; API keys deferring their stored-scope check still require ownerCapable in the target project; full capability deferral requires the existing explicit option. Complete/delete retain downstream workspace/key checks; download retains nondeferred project capability evaluation. Query extraction does not restore the old API-key owner-ceiling bypass.

Completion/delete continue supplying tx to repository statements, retaining shared parent locks and guarded state writes with activity in the winning transaction. Storage finalization/rejected-byte cleanup ordering and download URL then mandatory audit then response ordering are unchanged, confirmed through byte conservation and targeted source inspection. No new storage or audit escape is introduced.

No introduced blockers or non-blocking findings. Existing id-only attachment reads retain caller-enforced workspace/parent checks and the original read-to-use boundary; this review claims no stronger tenant guarantee. Existing AT-7 immediate soft deletion remains UNWAIVED: requester-approved pending-action confirmation is not implemented by this composition and prevents attachment feature acceptance. It is not new scope or a new fix in this review.

## Commands actually run and limits

- git status / show: clean exact head, parents and tree verified.
- git diff accepted parent to head, source parent to head; focused original-source attachment diff: inspected.
- Python subprocess git assertions: accepted-parent changed-path conservation PASS; original-source 14 attachment-file byte comparisons PASS.
- git diff --check HEAD^1 HEAD: PASS.
- pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/database-executor.test.ts ../../tests/api/attachment/magic-bytes.test.ts: PASS, 2 files / 17 tests. These are focused executor/magic-byte checks, not authorization or PostgreSQL proof.
- gh pr list / issue list and gh pr view 799: inspected live. Published #799 still pointed to `92d0128035d1e2cf5361ad26e00d8fba3a913061` at inspection; this report covers the local prepared composition, not a claim that it was already published.

The ordinary reviewer separately ran API typecheck; I did not rerun it and do not claim that as my execution. No PG/integration, image/build/boot/health, browser, hosted CI or deployment run in this security review. No source edits, commit, push or merge performed. No whole #580/attachment feature/stage acceptance, gate waiver, or merge authority is conferred.


# Structural scope repair and accepted805 composition — 2026-10-16

Reviewed head: `480e53d8aa62964823213f608d7d38bac0e5ee05`

This continuation supersedes the historical id/precheck-only repository claim without altering its authentic reports. The original scope adjudication was BLOCKED. Structural resolved-credential/current-SQL-reach repair, stored-key/owner ceiling preservation, minimal bootstrap facts and captured authorized rollback key replaced that mechanism. Three full ordinary reports at42f10 retain their own scope; full42f10 Sol B1 then BLOCKED persisted completion-parent correlation. a097 adds the correlated persisted requester/workspace and accepted exact-item link; ordinary A/B inspections retain their actual verdicts, including B's test-oracle blocker. Test-only02a/04bc establish visible accepted-transfer positive plus distinct hidden negative and nonnull foreign customer. Fresh strong04bc test-delta ordinary and fresh FULL04bc Sol CLEAR dispose B1 at that source. None of the earlier clear reports overrides its later blocker.

Actual04bc focused PostgreSQL passed5files/93tests/native0/42.27s, including the two existing API-key project-role-clamp suites. Earlier89/92,two91/92,42f10 92/92,a09792/93 and readonly-zsh-wrapper failure remain preserved. Fullcurrent hosted CI/image are required after publication; old93/93 is not new execution on480e.

Normal merge480e has parents04bc6edd57d48816f43994f82fbf722d05aa70d7 and actual protected accepted805 mainf77f89d9a6eb862cbf9d601c7868ca009b04d5e1. All16 own source/test/note entries match04bc; all other paths matchmain. Fresh independent ordinary and GPT-6.1 Sol accepted804/805 composition confirmations below verify actual project-creator/fixture/authority/transaction and optional-host seams; their bounded scope retains FULL04bc rather than pretending to be another whole-source/full-main review. Root authored/composed/published and is not an independent reviewer.

AT-7 immediate deletion without requester-approved pending action remains separate and UNWAIVED. No whole attachment-feature,580,589,stage,SIT,release or phase-completion claim. No skipped test, threshold/clock relaxation, gate waiver, direct-main/force/admin path or new query-builder escape.

The following reports are authentic byte-exact retained files. Author/operator/advisory reports are not independent approvals; actual models, roles, heads, adverse verdicts and runtime limits remain their own. No report is edited to align history with the final result.

| Report | SHA256 |
| --- | --- |
| attachment799-query-scope-adjudication-sol.md | `3f24d2471d392b7916c132b5fbc5cd6feaa4deafb85dfde551cb532185e8a5c8` |
| attachment799-resolved-scope-repair-plan-luna.md | `7d0fdf553652e3501b8e5516e61547285a048948a0adaacda2d4e2d14dc0bac1` |
| attachment799-resolved-scope-repair-author-luna.md | `a1077d79358c75060c12885687fb920c92189cc19e6bb1f4b86ddef901548f76` |
| attachment799-resolved-scope-adverse-matrix-luna.md | `65625109a1d7f698901c6450f8ace4814e2795a9b7ba40df38a607fcce545e63` |
| attachment799-resolved-scope-focused-pg-luna.md | `29be17e38988f48ab4b5f62994af06735be0ca476c247aaa0ae66c7580554013` |
| attachment799-pg-scope-failures-adjudication-sol.md | `fa0746cc8cbd49fe50bf90b36ea00cbb4e311e3c9f37599001d4d5b0dc49b5cd` |
| attachment799-pg-fixture-remediation-luna.md | `ccbcd10315c7d28ecebd0e946f10771227c4593e01095979cabf6aab07c09e78` |
| attachment799-repaired-fixtures-focused-pg-luna.md | `f159d2f8fa22a4cd7de709ecb4d9d80e11eedfe5deff1b8b9352df7f40fd7ca7` |
| attachment799-canonical-staff-fixture-and-pg-luna.md | `73233cd9c189f8697ffcd24d3e0b583840a6240d9f64fc2e8b5928846d4f965c` |
| attachment799-canonical-staff-fixture-focused-pg-result-luna.md | `cf8bf0c05a796f0ab520fbb38c56f058cb858821c18ab6c642e7140ce59b01e2` |
| attachment799-new-tests-structural-oracle-advice-luna.md | `576debf9a7305fb9b2d09910666008385dd50c79356e0ffed19349db71f89f5a` |
| attachment799-captured-key-focused-pg-luna.md | `9bc4bb27657718fe7619b3aba5783d290f5c0eb7f45572aeeacd896917c481f3` |
| attachment799-captured-key-focused-pg-result-luna.md | `99bc50c7fa7ec7cdae107dd2b9619991b436b756df1be0f351cee7dde598fe54` |
| attachment799-current-42f10-ordinary-a-luna.md | `ea45c4b52ba8354114bc6cc4a9f461fcfbd01fb1a6726217d3e3b3be0ed074ee` |
| attachment799-current-42f10-ordinary-b-luna.md | `6c3d81e29bf06e908ac6511824bf83823770a7f7fa4320c9c9d90fbae3147ee2` |
| attachment799-current-42f10-ordinary-c-luna.md | `aeabf2e09130cb2929b3eb67aa429c50dd30cdfe87ae8dcb8abd1f79b5691847` |
| attachment799-current-42f10-full-security-61-sol.md | `e249aedc19537b71302c097528806b6956f60b7ad6c9c8b131544cc89064dc56` |
| attachment799-persisted-completion-scope-author-luna.md | `e0620ae39a8fab6cf4c648f21db90beec50f843764d83ac0cf76c8598378372b` |
| attachment799-a097-delta-ordinary-a-luna.md | `b1342c294eefc6ddd762d4632aacd4e8f98eb7d120382f5eccd125fc72123a05` |
| attachment799-a097-delta-ordinary-b-luna.md | `cf96c80ebd0b2be78db7deab1eeab3e1e6cac01306427c45720a5f5226f80a15` |
| attachment799-a09724b7-focused-pg-result-luna.md | `2562491ec1c8d879ea62910a0c4985fc98277205213ffd0ac42f04a662acfc51` |
| attachment799-a09724b7-test-oracle-correction-luna.md | `562931d0b52c630dfa89bf1dbd3dd96785c79e97b178d73b2778be45a5b6e067` |
| attachment799-foreign-customer-fixture-precondition-luna.md | `6b23a78ca305ce0f8fc4fa71a9ec0ba774c4c3ef5f320c71a006ae8181e9ccd4` |
| attachment799-04bc6edd-focused-pg-result-luna.md | `d5cc357da6b21e3cc8852250b1ebc502166c03245081a378eb4ce51523529572` |
| attachment799-04bc-test-delta-ordinary-luna.md | `88e1a6f1aa9a9d098e79de6d8442318e7fcc43da23517b594e5d0a9041a50112` |
| attachment799-04bc-current-full-security-61-sol.md | `4de9b724d51503a522476ed725548d7d3725f55d304e17fe2123ec85e9e5a414` |
| attachment799-accepted805-ordinary-luna.md | `800281ac0eaec22c5d86dc3e6db942fc301767cd77d4dcbb98eeac126ebe0f23` |
| attachment799-accepted805-security-61-sol.md | `e27fd5609ec873f718453026de327b68a4371f0bad67f7842244a8cadbc686b2` |


## Authentic retained report — attachment799-query-scope-adjudication-sol.md

# Attachment799 query-scope adjudication — GPT-6 Sol

**Reviewed head:** 819520527d808158249df3cef1142a87d5b3c4fd

**Verdict: TRUE CONTRACT BLOCKER for acceptance of the #580 attachment extraction.** This is independent read-only adjudication/advice, not an approval of a future repair. I did not author or remediate this candidate. No HTTP cross-tenant disclosure is reproduced or claimed.

## Exact scope and provenance

Worktree `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2` is clean at the reviewed head. Its difference from source composition `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c` is only 144 review-note lines, so the examined production problem also exists at that source. Live PR799 still publishes `92d0128035d1e2cf5361ad26e00d8fba3a913061`; this report does not relabel the local head as published. Parent supplied accepted-main checkpoint `3d43b717b353c6cc0f5c098a0ce51b2e2a2d41b5` is context, not something independently fetched here.

Read AGENTS, agent workflow, CLAUDE, latest status/decision portions, coding standards query contract, multi-tenancy/security-model scoping sections, attachments AT rules and intake IQ-5a/IQ-9. Inspected actual repository SQL, route/controller calls, attachment/submission reach middleware, callerReach and linked-work-item handling. Read the retained accepted1a Sol report and committed review delta. Live open PR/issue lists and PR799 head were read. No tests, PG, browser, build, Docker, CI execution, capture, source edits, branch operations, commit or push occurred. Only this private report is written, mode 0600.

## Authoritative rule

`coding-standards.md:119-123,157-165`, `multi-tenancy.md:50-64`, and `security-model.md:114-122` explicitly require a repository query returning cross-organisation content to receive resolved identity and apply caller reach in SQL. An additional id alone is not authoritative scope. The decision log also preserves that convention while distinguishing the structural checker from predicate correctness. The checker being location-only does not make a semantically unscoped extraction complete. There is no authoritative caller-precheck exception in the inspected contracts.

## Actual SQL and callers

* `attachment/repository.ts:638` listWorkItemAttachments(executor, workItemId) selects complete attachment rows with only workItemId plus nondeleted predicates. `controllers/list-work-item-attachments.ts:10` forwards db and an id; `index.ts:358` maps these rows into user-readable attachment responses. No identity is accepted or applied.
* `repository.ts:389` listPortalSubmissionAttachments accepts submissionId/workItemId, returns filenames, metadata, ids and state, predicates `(submissionId OR workItemId) AND customerVisible AND deletedAt IS NULL`. `:423` staff variant returns similar content plus visibility, with parent/deleted predicates only. Routes `index.ts:450,475` pass middleware ids, not identity. Both OR arms require authorized scope; adding only a workspace equality would remain insufficient.
* `repository.ts:321` findAttachment(executor,id) selects the complete row solely by id. Work-item download/complete/delete use it, and submission download routes `index.ts:458,483` reread it after middleware. This same content-read class should be repaired together, rather than fixing just the named lists.
* `repository.ts:630` findAttachmentObjectKey(executor,id) reads the storage locator solely by id. `controllers/complete-submission-attachment.ts:108` invokes it outside the rolled-back transaction when a 400 occurs, then deletes the corresponding finalized object. The scoped lock/completion lookup inside the transaction is real, but does not scope this separate statement. This storage-content/action input is not merely identity bootstrap metadata. Do not turn cleanup into a new unscoped content lookup; retain the previously authorized locator safely through rollback, or use a properly scoped reread.

## Existing protections and classification

The middleware is substantive. Work-item reach resolves the row, checks workspace access and canonical project policy, preserves the accepted owner-capability clamp, and rejects customer principals on the agent path. Work-item download additionally checks the returned row against workspace/workItem and ready state. Submission middleware resolves the portal requester via portalIdentity, filters parent by requester, checks intake flags, and supplies accepted-only work-item links; staff links go through reachableLinkedWorkItemId/callerReach. Download prechecks verify workspace, parent relation, customer visibility and ready state before the route reread. Completion locks the current submission and narrows its attachment read by workspace/requester/parent. These prevent asserting an exposed HTTP exploit just from an id-only signature.

Nevertheless, these checks precede separate content statements and do not satisfy the required repository invariant. A direct call with a foreign parent/id can materialize its content without any identity input; that is evident from the SQL, even though no database repro was run. Identifier provenance and globally unique ids do not supply an exception.

Narrow bootstrap reads needed to discover ownership for authorization are a different category: findAttachmentWorkItemForReach projects ownership ids/project/organisation facts used to make the policy decision, and settings/feature-flag reads are instance/configuration inputs. They are not the filename/full-row/object-key content lists above. Do not mechanically require a caller identity before resolving that identity or discoverable ownership facts. Conversely findSubmissionAttachmentParent currently selects an entire submission (including formData), and findReachableSubmissionAttachment selects complete attachment rows during reach checking: classify/minimize these to actual authorization facts or make content reads scoped; do not label their whole payload bootstrap merely because they run in middleware.

## Minimum structural repair and proof

Use a single authoritative identity-to-SQL reach predicate/helper at the repository boundary, taking actual resolved identity and the execution handle, with parent narrowing and fail-closed missing identity. Preserve canonical reach semantics (session/key distinctions and owner ceiling, organisation/project/workspace scope, customer requester ownership, accepted-only portal transfer and staff converted-project reach). No new capability, route, schema or policy exception is justified. Preserve DTO fields/order/state/deleted filtering and existing storage/audit/transaction contracts. A shared helper from notification785 is a possible dependency only AFTER its actual acceptance; do not import unaccepted code as though main guarantees it.

Meaningful PostgreSQL tests must call the repositories directly, with real seeded rows and identities, not only mocks or HTTP prechecks. Demonstrate accessible nonempty list/read results; foreign organisation/workspace/project parents return no content; an unreached project in the same workspace returns none; null/unresolved identity fails closed; correct identity plus forged parent/id fails. Exercise both submission OR arms, own versus other requester, customerVisible false, duplicate/nonaccepted links, accepted transfer, and staff hidden versus reachable converted project. Assert no foreign filename/id/objectKey appears. Preserve successful API-key owner-clamp and negative owner-insufficient cases. For cleanup, use a real failure/rollback case showing only the previously authorized upload locator can be deleted, never another row chosen by an id-only reread. Prove no regressions to ready/deleted and audit ordering; tests must include positive controls so empty output cannot pass vacuously.

This is advice, not implemented code or test evidence. Once the repair exists, follow its actual ordinary/full independent Sol review tier on the new exact head, run scoped PG and required checks, and complete image build/boot/health before acceptance. This adviser context has materially directed repair and cannot approve it independently.

## Preserved boundaries

Original two ordinary/full Sol reports and accepted1a composition CLEAR remain authentic evidence of their stated executions/conservation. Qualify their coverage: conservation of existing id-only content reads does not establish compliance with the canonical scoped-repository contract. The previous report itself explicitly disclaimed a stronger guarantee. Do not erase or fabricate replacement historical verdicts.

AT-7 requester-approved pending-action deletion is inherited, UNWAIVED and still prevents full attachment acceptance. This finding does not authorize implementing that deletion feature or claiming whole attachments, #580 or any stage complete. No merge/release/SIT/remote deployment authority, gate waiver, unavailable runtime proof or future-fix approval is conferred.



## Authentic retained report — attachment799-resolved-scope-repair-plan-luna.md

# #799 resolved-scope repair plan — GPT-6 Luna

**Classification:** bounded read-only implementation plan; no code or test changes made.
**Reviewed source:** local worktree `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`, HEAD `819520527d808158249df3cef1142a87d5b3c4fd`; production source `36ce9b609d53592ebe74fc44c1cc2e0b5c3abd8c`; published #799 head remains `92d0128035d1e2cf5361ad26e00d8fba3a913061`. Full authentic adjudication read: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/attachment799-query-scope-adjudication-sol.md`.

## Governing contract and decisions

`docs/04-engineering/coding-standards.md` § Query ownership, `docs/01-architecture/multi-tenancy.md` § Query scoping, and `docs/01-architecture/security-model.md` §5 require cross-organisation content queries to take resolved identity and enforce caller reach in the statement predicate; extra workspace/project/parent IDs narrow scope only after being checked against identity. The structural checker does not prove predicate semantics. The 2026-10-15 decision-log entry confirms the accepted baseline convention and disclaims a universal type-level scoped wrapper. The 2026-10-15 owner decision #724 requires API-key authority to be stored key scope intersected with the owner's current project authority (workspace and project role); key never exceeds owner. No latest decision authorizes a bypass, capability, or new policy.

`ResolvedIdentity` is the actual type in `packages/permissions/src/identity.ts`: includes `personId`, `side`, `organisationId`, `portal`, `credential`, memberships, reach, authority and optional key capabilities. Use the request's resolved DB-backed identity (the same source used by current authorization), not user ID, raw credential claims, or a fabricated scope object. Missing identity must yield no rows. Keep route capability checks and existing API-key owner clamp intact; repository reach filtering is an additional content constraint, not an authority grant.

The canonical shared SQL scope helper proposed in #785 at `98a04f25a915893adb9c5e2cc211f96185270321` was not present in this worktree/object database and remains unaccepted. It may be considered only after accepted availability and independent inspection. Do not add an import/dependency to that candidate now. Until then the repair must use accepted-main utilities/contracts or a helper in this bounded attachment repository change whose semantics are reviewed and tested; do not duplicate divergent reach rules across query sites.

## Exact content-query surface and bounded changes

All changes can stay in `apps/api/src/attachment/repository.ts`, its direct controllers/middleware and corresponding `tests/api-integration` coverage; preserve existing extraction files and review records.

1. `listWorkItemAttachments` (`repository.ts`, current line ~638), called by `controllers/list-work-item-attachments.ts` and route `attachment/index.ts`: accept resolved identity plus work-item parent. Apply caller project reach in SQL for the joined live work-item/project row, with the given work-item ID as an additional predicate; retain non-deleted/state behavior, full projection and creation ordering. Controller currently only receives the ID, so pass `c.get('identity')` through the controller seam. A forged/unreached work-item ID returns `[]`.
2. `listPortalSubmissionAttachments` (~389) and `listStaffSubmissionAttachments` (~423), called by route lines ~451/~476: accept resolved identity and parent facts. Apply caller reach and exact parent scope to **each** arm of `(submission_id = S OR work_item_id = W)`, never a workspace-only predicate around the OR. Portal arm requires the caller's own resolved customer identity/requester ownership plus `customer_visible=true`; the linked-work-item arm is permitted only for accepted transfer and only the caller-reachable linked item. Staff submission arm requires staff reach to the submission's request-type workspace/triage scope as defined by current route policy, and the linked item arm additionally requires current project reach. Preserve deleted filtering, projections, order. Both list routes must pass the middleware-resolved identity.
3. `findAttachment(executor,id)` (~321), consumed by work-item download, complete and delete controllers and both submission download routes: replace with narrowly purposed scoped content reads (or a single identity-aware function with explicit parent mode), not an identity-free generic fetch. Work-item route binds authorized workspace and work-item and project reach. Submission portal binds caller requester + submission parent, accepted-only transferred parent, customer visibility and ready state for download. Staff binds staff-reachable submission and, when the attachment is on converted work item, current reachable project. Completion remains transactionally locked and parent-bound. Delete/complete must retain their existing state/ownership and API-key capability behavior. Do not add object key to DTOs.
4. `findAttachmentObjectKey` (~630), used only after transaction failure by `complete-submission-attachment.ts:108`: remove the unscoped post-rollback ID reread. Capture the already-authorized `finalKey`/object locator in the transaction callback result or a narrowly scoped failure result before throwing across rollback, then after rollback delete only that captured locator. The locator may be used only after `lockSubmissionForCompletion` and `findSubmissionCompletionAttachment` have established caller/requester, workspace, submission (or valid accepted linked item), row ID, pending state and authorized upload ownership. On errors before that authorization, do not look up any object by bare ID and do not delete anything. Preserve the transaction rollback, finalization cleanup, pending-row deletion behavior, and never let one caller choose another row's object.
5. Minimize authorization bootstrap reads instead of treating them as content. `findAttachmentWorkItemForReach` should remain only the facts required to evaluate reach (attachment/work item/workspace/project/org identifiers and liveness), with no filename/object key/content. `findSubmissionAttachmentParent` currently selects the full submission including `formData`; narrow to id, number, requesterId, organisationId, state, linked workItemId and workspaceId needed for route scope. `findReachableSubmissionAttachment` currently returns complete attachment content in middleware; either turn it into a scoped content read satisfying identity contract, or project only authorization facts there and leave the actual content/locator read to the identity-scoped route repository. Keep intake feature flags/settings as configuration reads, not attachment content.

The controller `complete-attachment.ts` and `delete-attachment.ts` currently rely on `findAttachment` for later row checks. Pass identity from route/context through inputs and preserve their existing row comparisons and state checks while narrowing in SQL. Ensure `downloadAttachment` passes identity and continues audit only after successful ready attachment resolution. Submission middleware already computes requester identity, accepted-only work-item link, and staff `reachableLinkedWorkItemId`; that context is useful but must not substitute for identity at repository boundary.

## Direct PostgreSQL proof plan

Add meaningful repository-level tests to `tests/api-integration/attachment.test.ts` or a focused attachment query-scope integration test, using real seeded DB fixtures/identities and direct repository calls. No mocked authorization-only checks. Include positive controls producing nonempty, uniquely named rows, then assert result IDs, filenames and locator values never reveal foreign rows.

- Work item list/read: same caller sees a reachable project attachment; different organisation/workspace and an unreached project in the same workspace return empty; forged workItemId plus a foreign row ID returns empty; unresolved/null identity returns empty.
- Submission list/read: exercise both OR arms independently. Portal own requester sees own visible submission attachment; other requester and `customer_visible=false` are excluded. A duplicate/nonaccepted submission link never exposes another requester's linked work-item attachments. Accepted transfer permits only the accepted, currently reachable work item. Staff list/read proves a hidden converted project is absent while a reachable converted project is present. Exercise foreign workspace/org and forged parent/id denials.
- API keys: positive owner with project authority sees only rows within stored key scope; a key whose stored capabilities exceed the owner's current project role remains clamped; insufficient owner authority returns no content even if key scope names that project. Keep relevant route capability tests and do not infer broader permissions from read reach.
- Cleanup: force a real verification failure after finalization inside a transaction, assert rollback occurs and only the locator captured from that already-authorized pending row is deleted. Seed a foreign row/object with a distinctive key and prove it remains untouched; an identity-less or forged-ID path must not trigger a locator query/deletion. Include the successful completion positive control and ready/deleted state controls.

Tests should assert meaningful counts/IDs and no foreign filename/id/objectKey, including the submission OR-arm adversarial combinations. Verify audit order/behavior remains: only successful download writes `attachment.downloaded`; failures do not. Existing request-level reach tests remain useful but cannot replace direct repository PG tests.

## Scope and evidence boundaries

Do not alter pending-action semantics: AT-7 requester-approved deletion is a separate inherited, unwaived blocker. Do not implement it or claim attachment/#580/stage completion. Preserve the original ordinary and full Sol CLEAR reports and accepted1a conservation records verbatim; qualify their coverage because they did not establish caller-scoped repository content queries. The later repair author/planner context (this report) materially directs implementation and cannot independently review or approve it. Future ordinary/security review tier, current exact-head PG, and image/runtime proof remain separate gates.



## Authentic retained report — attachment799-resolved-scope-repair-author-luna.md

# #799 resolved-scope repository repair — GPT-6 Luna author report

**Result:** implementation committed; PostgreSQL acceptance evidence pending the conductor's exclusive PG window.

- Worktree: `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- Branch: `codex/query-ownership-580-attachments`
- Preserved original local head: `819520527d808158249df3cef1142a87d5b3c4fd`, retained at `archive/attachment799-pre-accepted9f-8195205`.
- Accepted main merged normally: `9f736c39d4310cde458d76e561b245619d08c3bd` (merge parents include prior local source and accepted main).
- Repair commit / exact current head: `f3ee1f91053abd6df44721baef7c6b180f098d2f`.
- Working tree clean after commit; no push or PR created.

## Repair

Changed only the attachment query extraction implementation and direct integration tests. Actor-facing work-item list/read repository calls now receive a DB-resolved `ResolvedIdentity` from the request's credential path and put live project reach in SQL alongside exact workspace/work-item identifiers. Work-item read, complete, delete and post-delete concurrency reread share the scoped repository read. Existing `requireAttachmentReach` API-key scope and owner authority clamp remain intact; no new grant, capability, route, schema or dependency was introduced.

Portal and staff submission lists now take the resolved identity and apply parent-scoped reach independently to the submission and accepted converted-work-item arms. Download/complete middleware reads were split: the bootstrap query returns only attachment authorization facts, and the subsequent download content query independently binds identity, exact parent, accepted transfer, live project/workspace reach, visibility and ready/deleted state. Submission bootstrap now selects only id/reference/requester/organisation/state/work-item/workspace facts instead of the full row including `formData`.

Submission completion checks resolved customer identity against the requester before the transaction's scoped pending-row lock. The post-rollback cleanup no longer rereads an object key by bare attachment ID: it uses the finalized locator captured only after the identity/requester/workspace/parent-scoped locked attachment row was authorized. This keeps storage cleanup after rollback and preserves the existing finalization, transaction and audit sequence.

Repository predicates use the accepted `apps/api/src/database/repositories/identity-scope.repository.ts` helper merged from #785, specifically `currentProjectReachPredicate` and `currentWorkspaceReachPredicate`. No unaccepted source was imported. The helper expresses reach; key capabilities and owner authority continue to be enforced by existing route guards, including #724/#750 behavior.

Direct PostgreSQL integration coverage was added for a reachable work-item list/content positive case, null identity, forged parent and wrong-parent lookup negatives. The accepted-submission conversion integration fixture now directly calls the portal and staff list repositories and asserts both the submission and accepted work-item OR arms return populated attachment IDs. Existing ready/deleted behavior and audit writes remain in their current controllers and SQL predicates. These tests have not yet been executed against PostgreSQL.

## Conservation and review evidence

The only pre-merge source integration was the normal merge of accepted `9f736c39d4310cde458d76e561b245619d08c3bd`. The intentionally preserved attachment/API-key clamp source in `require-attachment-reach.ts` remains unchanged from the original local head. Existing published/review-note paths and findings were not rewritten; prior ordinary and Sol CLEAR records remain authentic evidence for their original coverage only and are not treated as clearance of this repair. The original notes' narrow source-conservation scope does not establish caller-scoped content reads. This author context materially directed and implemented the fix and cannot serve as an independent reviewer.

AT-7 pending-action deletion remains a separate inherited, unwaived acceptance blocker. No deletion workflow was added. No #799/feature/stage completion or merge-to-main claim is made.

## Verification and next gate

- `pnpm --filter @taskdesk/api typecheck` — passed after implementation (all five configured TypeScript projects).
- Biome on the 10 changed implementation/test files — passed with existing non-failing complexity and environment-variable warnings; no test was disabled or skipped.
- `git diff --check` — passed.
- PostgreSQL/API integration suites, browser, Docker/image, CI, push and PR — not run/performed. PostgreSQL was explicitly withheld pending the conductor's exclusive focus window.

**Concrete next action:** conductor grants/coordinates the isolated PostgreSQL scope, then run the direct attachment and intake conversion repository integration tests on exact head `f3ee1f91053abd6df44721baef7c6b180f098d2f`. The planned broader adverse matrix (foreign organisation/workspace, same-workspace unreachable project, other requester, hidden attachments, duplicate/nonaccepted links, staff hidden converted project, and API-key owner-insufficient cases) still needs explicit runnable fixture coverage/results before treating PostgreSQL scope as complete. Follow with independent ordinary/full security review of this exact candidate and all remaining required gates; this author cannot review it.



## Authentic retained report — attachment799-resolved-scope-adverse-matrix-luna.md

# #799 adverse query-scope coverage — GPT-6 Luna

**Result:** bounded test matrix added and committed; no PostgreSQL/runtime execution performed.

- Worktree: `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- Branch: `codex/query-ownership-580-attachments`
- Repair source commit retained unchanged: `f3ee1f91053abd6df44721baef7c6b180f098d2f`.
- Adverse-matrix commit: `36391ef9c0daa1a81b98e03765d50e167c82324c`.
- Current exact head: `36391ef9c0daa1a81b98e03765d50e167c82324c`; working tree clean; no push/PR/merge.
- Files changed by this follow-up: `tests/api-integration/attachment.test.ts`, `tests/api-integration/intake-atomic-conversion.test.ts`, `tests/api-integration/intake-attachment-duplicate-reach.test.ts`.

## Added coverage

Direct work-item repository tests now seed a positive reachable row, a deleted control row, a real same-workspace project row after revoking the tested identity's project membership, and a real foreign-workspace/project row bound to a different customer organisation. They assert the positive row appears and deleted, same-workspace-unreached, foreign-workspace/org, null-identity, and forged-parent reads do not return content.

The API-key integration test uses the real API-key route for three cases: a stored `work_item:read` key for an owner with project authority succeeds; a key with empty stored scope is denied with no filename; and a key granting `work_item:read` to an owner with no project reach is denied as not found with no filename. Its direct repository positive also constructs the identity through `resolveIdentity` from the persisted key row and the same `apiKeyCapabilitySubset` projection used by request resolution. The repository predicate remains a reach predicate. Capability scope and owner authority stay at the existing route/evaluator layer; the test does not mislabel reach as authority or require a new policy.

Direct submission repository tests now cover own requester positive, other requester negative, `customer_visible=false`, accepted linked-work-item visibility for portal and staff, duplicate/nonaccepted linked-item denial, null identity, and staff loss of access to the converted project's project membership while retaining the workspace triage context. The existing cross-request duplicate route tests remain unchanged.

A real transaction test now injects storage calls after the authorized pending attachment is locked. It forces verification failure, asserts the transaction leaves the attachment pending, and asserts post-rollback deletion receives exactly the final locator captured from that authorized row. The unauthorized staff-owned row is a negative control and triggers no locator deletion. The test restores all spies after each case.

## Checks and limits

`pnpm --filter @taskdesk/api typecheck` passed after the test additions. Biome formatting/check on the changed tests and `git diff --check` passed; Biome reports only the pre-existing `TASKDESK_STORAGE_*` environment declarations as warnings. No tests were run because the conductor's PostgreSQL window remains reserved. These are authored test cases, not observed runtime results. The fixture behavior and generated SQL still require execution against PostgreSQL.

**Requested focused runtime window:** on exact head `36391ef9c0daa1a81b98e03765d50e167c82324c`, run only these suites first:

- `tests/api-integration/attachment.test.ts` — direct work-item scope and real API-key positive/stored-scope/owner-ceiling cases;
- `tests/api-integration/intake-attachment-duplicate-reach.test.ts` — direct submission scope arms and accepted/nonaccepted/staff reach cases;
- `tests/api-integration/intake-atomic-conversion.test.ts` — transaction rollback and authorized locator cleanup assertions.

Any failing case should be investigated on its exact source; do not waive or skip. Further review and image/runtime gates remain separate. AT-7 pending-action deletion remains untouched and unwaived. This author context implemented the source repair and directed its test matrix; it cannot independently review either commit.



## Authentic retained report — attachment799-resolved-scope-focused-pg-luna.md

# Attachment #799 focused PostgreSQL run

- Revision: `36391ef9c0daa1a81b98e03765d50e167c82324c` (verified before container creation; worktree clean).
- Database: dedicated PostgreSQL 18 Alpine container, dynamically mapped to loopback port 32782, temporary `/var/lib/postgresql` tmpfs. Container ID: `b29df46b68c4cdc851284efd11ddaaa12ea33b116df9d23516df09355c60ecec`; task/revision ownership labels were checked before tests and again before teardown. Writable container layer at teardown: 201660 bytes.
- Harness: existing API integration Vitest config; `CI` unset, `TASKDESK_DATABASE_URL` pointed to this owned container and a database ending `_test`. Exact five requested files only. Full unmodified Vitest output retained at `attachment799-resolved-scope-focused-pg-luna.full.log` (mode 0600); run environment file and runner removed.
- Counts: 5 files, 2 passed / 3 failed; 92 tests, 89 passed / 3 failed; Vitest duration 32.00s; command exit 1.

## Failed assertions

1. `attachment.test.ts:411`, “keeps attachment list API keys inside both stored scope and owner reach”: API-key positive HTTP list returned 401 (expected 200). Direct repository read using the test-constructed resolved identity had already found the row; the route response is `Unauthorized`. The route policy requires `work_item:read`; the existing request middleware also needs to resolve the actual API-key caller. This needs an exact check of the test auth fixture / resolved request identity before treating this as a repository predicate defect. The later stored-scope and owner-reach assertions in this same test were not reached.
2. `intake-atomic-conversion.test.ts:1258`, “attributes auto-accept conversion to the system while retaining the customer requester”: expected the two inserted attachment IDs from `listPortalSubmissionAttachments`, got an empty array. The repository’s portal list early-returns for non-customer identities and its SQL requires the actual submission requester plus matching submission/work-item parent arm. Resolve which fact the fixture fails before changing this contract.
3. `intake-attachment-duplicate-reach.test.ts:240`, “direct repository reads bind both parent arms to the actual requester and acceptance state”: after removing project membership, the direct staff query expected `[]` but returned two attachments attached directly to the accepted submission (one customer-visible and one hidden). The method’s direct-submission arm is independently gated by current workspace reach, and this fixture retains workspace membership; removing project membership alone does not remove that reach. Confirm the spec’s intended workspace-vs-project authorization before changing SQL or the expected outcome.

## Passed files

- `api-key-project-role-clamp.test.ts`
- `api-key-project-role-clamp-strict.test.ts`

These suites passed as part of this invocation; this is not a substitute for the attachment route positive case above.

## Cleanup

The owned container was removed by its exact ID and a subsequent exact-ID inspect confirmed it no longer exists. Its environment file (containing the temporary database password) and runner were deleted; the temporary directory was removed. No other containers or services were inspected for cleanup or modified. No browser, full suite, or alternate PG harness was used.



## Authentic retained report — attachment799-pg-scope-failures-adjudication-sol.md

# Attachment #799 focused PostgreSQL failure adjudication

**Role:** independent read-only technical adjudication, not security clearance.
**Context:** /root/attachment799_pg_scope_failure_adjudication_sol, dispatched by /root. Platform identity: GPT-6 family; no more specific runtime identity exposed to this context. Sol-tier task designation is dispatch provenance, not a claim of a different runtime model.
**Exact inspected head:** 36391ef9c0daa1a81b98e03765d50e167c82324c.
**Accepted comparison main supplied by conductor:** 9f736c39d4310cde458d76e561b245619d08c3bd.
**Source state:** HEAD verified; worktree clean. No source, tests, refs, shared state, or services modified.
**Verdict:** all three observed failures have concrete test-fixture/oracle causes established by source inspection. None demonstrates a production SQL defect. This is advice for a bounded repair, not proof that the resulting candidate passes or that remaining repository scope is clear.

## Evidence and contract

Read AGENTS.md, active-mission.md, agent-workflow.md, CLAUDE.md; coding-standards.md query ownership; customer-portal.md CP-10/CP-16 and Permissions; intake-queue.md IQ-5a/IQ-9 and permission table; current decision-log newest entries including 2026-10-15 #724 owner ceiling and #580 query ownership. Inspected attachment repository and relevant test/helper/auth/resolver code. Read private repair-author, adverse-matrix and focused-PG summaries. Did not print or publish raw logs, credentials or request secrets.

The reported PG result remains attributed to its runner: five files, 92 tests, 89 passed, three failed. No tests, PostgreSQL, Docker, browser or additional runtime were run here. The prior original scope adjudication remains historical evidence for its own source; this report does not supersede it with a future clearance.

Query ownership requires resolved identity in SQL, exact parent binding and materialized repository outputs. Customer admission requires a customer-side person plus canonical built-in customer role through an organisation-scoped membership in the person's organisation. Requester ownership and accepted transfer then govern these own-submission attachment methods. These are different checks: requester ownership is not a substitute for customer admission; a customer does not need staff project membership for their own accepted-submission transfer. Staff workspace triage reach and current converted-project reach are distinct arms. CP-16 never permits a duplicate link to expose a different request's work-item files. API-key authority remains stored scope intersected with the owner's current authority.

## 1. API-key positive HTTP 401

**Cause: proven missing request credential; confidence high.**
attachment.test.ts sets reach-world ambient headers and calls raw app.request at line 410. helpers/reach-world.ts setAmbientHeaders only sets a local variable consumed by its exported json() helper. It does not patch app.request or globally inject headers. The raw positive request therefore has no x-api-key header while mockAnonymousSession returns null. A 401 is the expected unauthenticated response before the attachment repository. The later raw requests similarly omit their intended stored-scope/owner-ceiling credentials.

The successful direct resolved-identity repository assertion proves a different path and cannot authenticate an HTTP request. Existing clamp suites use reach-world json(), explaining why those pass without contradicting this failure.

**Minimum repair:** send each intended minted key explicitly as x-api-key on its own app.request, or use the existing json() wrapper consistently. Keep anonymous-session setup. Do not change authenticateApiRequest, verifyApiKey, permission policy, resolver, or attachment guards.

**Required proof:** positive HTTP 200 containing the fixture filename; insufficient stored scope 403 with no filename; owner lacking project authority 404 with no filename. Assert the actual requests carry the intended credential without printing it. Preserve the direct repository positive and existing key-clamp suites.

## 2. Auto-accept portal list returned []

**Cause: proven absent canonical customer admission fixture; confidence high.**
intake-atomic-conversion.test.ts's auto-accept case creates a user, customer-side person and organisation, but no role or membership. resolveIdentity customer branch explicitly returns null when hasCanonicalCustomerMembership rejects the loaded scoped memberships. listPortalSubmissionAttachments explicitly returns [] for null/noncustomer identities. Thus this test cannot reach the attachment SQL predicate.

The requester person ID does match submission and converted work-item ownership; accepted state and parent association were already established in the test. Nothing here establishes a mismatch in the new SQL. The existing approval-fixtures admitted-customer helper documents and creates the missing canonical organisation role/membership; use equivalent existing fixture machinery without changing the requester identity or accepted-transfer relation.

**Minimum repair:** seed the canonical built-in customer role and membership for this exact requester/organisation, using existing helper conventions. Assert requesterIdentity is nonnull, customer-side, and has the expected person ID before calling repositories. Keep actual resolveIdentity; do not fabricate ResolvedIdentity or loosen repository admission.

**Required proof:** both direct submission and accepted converted work-item attachment IDs appear for the admitted requester; other requester/null identity remain denied, hidden portal files remain absent, duplicate/nonaccepted links remain denied. Execute the rest of this previously interrupted test, including storage-failure rollback and cleanup assertions. Staff list must independently retain its valid workspace/project reach; do not grant the customer a staff project role to make this pass.

## 3. Staff project-membership revocation expected []

**Cause: proven incorrect all-or-nothing test oracle; confidence high.**
The fixture inserts own-submission.txt and hidden-submission.txt directly under the accepted submission. It then removes only project membership and retains the staff caller's workspace membership. listStaffSubmissionAttachments deliberately has two separately scoped arms: direct submission rows use currentWorkspaceReachPredicate for request-type workspace; converted work-item rows require accepted state, exact persisted transfer and currentProjectReachPredicate. Source and actual returned row kinds agree: the two direct-submission rows survive, while the converted privateAttachment is withheld.

IQ-5a restricts converted work-item exposure to project reach; intake triage is workspace-scoped. No contract requires revoking workspace triage access when a single project membership is removed. Staff may see hidden submission attachments; customerVisible is a portal filter. Forcing [] by adding project reach to the direct arm would conflate the two authorities and narrow supported triage behavior.

**Minimum repair:** after project revocation assert the exact two direct-submission IDs/filenames remain, and explicitly assert converted privateAttachment is absent. Keep duplicate linked-work-item denial. Add a distinct workspace-reach revocation control for the direct arm: with no applicable workspace or project reach, direct and converted rows must both be absent. Assert resolved identities and membership preconditions so the control is not vacuous.

**Required proof:** both arms populated initially, workspace-only staff sees direct visible and hidden files but no converted file, loss of all relevant reach denies both, duplicate/nonaccepted links deny converted content. If exercising a retained stale resolved identity, label it explicitly and require SQL to reflect the changed persisted membership.

## Bounded next action and limits

Repair these three test fixtures/oracles together, without production authorization changes, freeze a new SHA, then rerun the same five focused files against an exclusively owned PostgreSQL database. Do not disable, skip, delete, weaken the negative tests, or reinterpret the earlier 89/92 as green. Subsequent source review must still consider the complete repair and adversarial matrix; passing corrected fixtures does not clear unrelated repository defects.

No owner decision is missing for these three failures. A new requirement to remove staff workspace triage on project revocation would be a product change requiring its own owner contract, and is not needed here. AT-7 remains inherited and unwaived. No merge, feature/stage completion, image/browser/SIT acceptance or security CLEAR is claimed.

Because this context materially advises the repair, it is not an independent reviewer of any resulting candidate.




## Authentic retained report — attachment799-pg-fixture-remediation-luna.md

# Attachment #799 PostgreSQL fixture remediation

- Exact parent: `36391ef9c0daa1a81b98e03765d50e167c82324c`.
- New commit: `9ce81dc48fc9e0ad4ed356f58a08841ea092b9d3` (`test(attachments): correct resolved scope fixtures`).
- Worktree: `codex/query-ownership-580-attachments`; clean after commit.
- Scope: only the three authorized integration test files changed. No production files, route policy, schema, shared identity contracts, dependencies, skips, or weakened assertions changed.

## Corrections

- `attachment.test.ts`: explicitly supplies each minted API key in the actual raw `app.request` headers for the positive, insufficient-stored-scope, and owner-ceiling HTTP requests. The helper asserts the header value on the same `Headers` object passed to the request. The anonymous session remains in place; direct repository positive and expected HTTP statuses/content checks remain.
- `intake-atomic-conversion.test.ts`: admits the exact existing customer-side requester with the canonical built-in organisation customer role and membership, validates the role facts, and asserts `resolveIdentity` returns a customer identity for that requester person before querying. It retains the accepted conversion and original upload/rollback/cleanup path, which must execute in the next focused PG run.
- `intake-attachment-duplicate-reach.test.ts`: captures the hidden direct-submission attachment ID; asserts initial staff identity and both populated parent arms; after project membership revocation, asserts exactly the two direct workspace-triage rows remain (including hidden) while the converted work-item row is absent. Then verifies and removes the actual workspace membership and checks both arms are absent using the deliberately stale pre-revocation resolved identity, proving SQL observes current persisted reach. Duplicate and portal-owner/null controls remain.

## Checks

- `pnpm exec biome check --write` on the three named files: passed formatting; reported the same three existing undeclared `TASKDESK_STORAGE_FILESYSTEM_ROOT` / `TASKDESK_STORAGE_DRIVER` environment warnings in `attachment.test.ts`.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`: passed.
- `git diff --check`: passed.
- Commit hook reran Biome on the changed files and produced the same three warnings; commit succeeded.
- No runtime or PostgreSQL tests were run for this candidate. The prior 89/92 run remains preserved in `attachment799-resolved-scope-focused-pg-luna.md` and its full log; it is not represented as green or superseded.

## Next gate

Request the same five-file focused PostgreSQL run at exact candidate `9ce81dc48fc9e0ad4ed356f58a08841ea092b9d3` once the root grants a fresh exclusive window. Do not interpret this fixture repair as production SQL clearance or broader review. AT-7 remains unchanged and unwaived.



## Authentic retained report — attachment799-repaired-fixtures-focused-pg-luna.md

# Attachment #799 repaired-fixture focused PostgreSQL run

- Exact revision: `9ce81dc48fc9e0ad4ed356f58a08841ea092b9d3` (verified clean before run; worktree unchanged during this run).
- Exact files: `attachment.test.ts`, `intake-attachment-duplicate-reach.test.ts`, `intake-atomic-conversion.test.ts`, `api-key-project-role-clamp.test.ts`, `api-key-project-role-clamp-strict.test.ts`, via the existing API integration Vitest config.
- Database: dedicated PostgreSQL 18 Alpine, loopback dynamic port `32785`, `/var/lib/postgresql` tmpfs, task-owned container ID `efb747dd0b8d56ef5c2a3cac58bdb13166480d0da511d99692fcb50d42b62847`. Ownership/task/revision labels verified before test setup and cleanup. Full raw Vitest log preserved at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/attachment799-repaired-fixtures-focused-pg-luna.full.log` (mode 0600).
- Counts: 5 test files, 4 passed / 1 failed; 92 tests, 91 passed / 1 failed; duration 35.01s; Vitest exit 1. The interrupted auto-accept test ran through its portal repository assertions and failed later at the staff-list assertion; its rollback/storage-cleanup assertions later in that test were therefore not reached.
- Environment: test runner used a private environment file and task-specific environment variables. `CI` was assigned an empty string (Vitest setup's `if (!process.env.CI)` took the local path); it was not removed from the environment entirely. The database URL and password are not included in this report or the preserved log.

## Remaining failure (no source change made)

`intake-atomic-conversion.test.ts`, “attributes auto-accept conversion to the system while retaining the customer requester”, failed at line 1321: `staffRows` contained only one of the two expected upload IDs. Earlier portal-list checks passed after adding canonical customer admission. The separate staff fixture is created with `createWorkspaceMember({ role: "admin" })`; this test does not grant that staff user project membership. `listStaffSubmissionAttachments` admits the direct submission arm via workspace reach, but its accepted converted-work-item arm requires current project reach. The single visible row is consistent with workspace-only reach and the persisted-arm contract; this is a staff-fixture reach gap, distinct from the customer admission issue repaired in this commit. Per task instruction, I made no source or test edits after observing this failure.

## Cleanup and scope

The container was re-checked by exact task/revision labels, removed by its exact ID, and `docker inspect` confirmed the ID absent. Before/after Docker ID inventories reconciled exactly: 24 IDs before cleanup, 23 after; the sole removed ID was `efb747dd0b8d56ef5c2a3cac58bdb13166480d0da511d99692fcb50d42b62847`, with no IDs added. Temporary environment/runner files and the temporary directory were deleted. No other containers or services were changed. No full suite, browser, alternate database framework, or retry was run. The prior 89/92 run and independent Sol adjudication remain unaltered; this report does not claim candidate-wide clearance. No production change, push, PR, or merge occurred.



## Authentic retained report — attachment799-canonical-staff-fixture-and-pg-luna.md

# Attachment #799 canonical staff read fixture

- Exact parent: `9ce81dc48fc9e0ad4ed356f58a08841ea092b9d3`.
- New clean commit: `3a587676fb6281d49a197e8d37a3463dcf3fafc3` (`test(attachments): grant canonical staff read fixture`).
- Scope: test-only changes in `tests/api-integration/helpers/approval-fixtures.ts` and `tests/api-integration/intake-atomic-conversion.test.ts`; no production authorization or repository SQL changed.

## Fixture changes

- Extracted canonical customer role resolution/validation into the existing shared approval-fixture module and added `grantCustomerOrganisationMembership(organisationId, personId)`. Existing `addCustomer()` now uses that same fixture helper. The auto-accept test admits its actual customer requester through this helper and still asserts actual `resolveIdentity` is customer-side for the requester person.
- Added minimal `project:read` and `work_item:read` authority for the distinct staff reader via existing `grantProjectRole(staffUser.id, project.id, ...)`; workspace admin remains unchanged. The test resolves the staff identity and asserts `reaches(...)` plus `can(..., "work_item:read", "work_item", ...)` are true before expecting both staff attachment parent arms. It asserts the customer identity does not gain `work_item:read`.
- The separate workspace-only denial matrix in `intake-attachment-duplicate-reach.test.ts` is untouched.

## Cheap checks

- `pnpm exec biome check --write tests/api-integration/helpers/approval-fixtures.ts tests/api-integration/intake-atomic-conversion.test.ts`: passed; formatter made one formatting adjustment.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`: passed.
- `git diff --check`: passed.
- Worktree clean at the commit above.

## Focused PostgreSQL history and next step

- At `36391ef9…`, the initial five-file run was 89/92 (3 failed), preserved in `attachment799-resolved-scope-focused-pg-luna.md` plus its full log. Independent Sol adjudication identified fixture/oracle causes; that record remains unchanged.
- At `9ce81dc…`, fixture corrections produced 91/92 (1 failed). The only failure was the staff converted-work-item expectation with workspace reach but no project membership; report and full log remain unchanged in `attachment799-repaired-fixtures-focused-pg-luna.md` plus its full log. No code edits were made after that failed run.
- The same five-file PG run on `3a587676…` has not yet been authorized/executed. Root has the exact new SHA and clean-tree check; report will be completed with actual five-file/92-test results and the new run's container/resource cleanup after the exclusive focused PostgreSQL window is granted.



## Authentic retained report — attachment799-canonical-staff-fixture-focused-pg-result-luna.md

# Attachment #799 canonical staff fixture: focused PostgreSQL result

- Exact revision: `3a587676fb6281d49a197e8d37a3463dcf3fafc3`; clean before the test run and unchanged after it.
- Exact five files: `attachment.test.ts`, `intake-attachment-duplicate-reach.test.ts`, `intake-atomic-conversion.test.ts`, `api-key-project-role-clamp.test.ts`, `api-key-project-role-clamp-strict.test.ts`, using existing integration Vitest config.
- Result: 5 files, 4 passed / 1 failed; 92 tests, 91 passed / 1 failed; Vitest duration 49.65s. Full unmodified private log: `attachment799-canonical-staff-fixture-focused-pg-result-luna.full.log` (mode 0600).
- Run resources: owned PostgreSQL 18 Alpine container `3047f59ec801e1c2b7e6f6c63e63c67cc23f6d44b008c508e37bac4fc2a9d12b`, loopback dynamic port 32786, `/var/lib/postgresql` tmpfs, unique task/revision/run labels checked before test setup and cleanup. The runner verified `CI` absent and wrote `unset` before invoking Vitest. Database password, database URL, and environment file are omitted here; the full private test log contains no database password.
- The shell wrapper attempted to assign the post-Vitest process code to zsh’s readonly special variable `status`, so the wrapper itself emitted an error after Vitest completed. The Vitest summary in its full log reports the test result above. No second attempt was made.

## Remaining test failure; no edit made

`intake-atomic-conversion.test.ts`, “attributes auto-accept conversion to the system while retaining the customer requester”, failed at line 1322 in the rollback cleanup assertion. The verification-failure path ran and the delete spy recorded one authorized final-object cleanup call. The expected value calls `toFinalAttachmentObjectKey(pendingRequesterUpload.objectKey)` after the controller call; that helper creates a fresh random token on each invocation, so the recomputed expected key differs from the already-captured cleanup key. The failure is in the test oracle’s comparison timing. The later row rollback and unauthorized staff-upload checks were not reached. Per instruction, work stopped without further edits after this failure.

Failure history remains immutable: the original 89/92 report and its adjudication remain in their prior private files; the intermediate 91/92 run documenting missing staff project read remains in its own report and full log; the latest 91/92 run and cleanup mismatch are recorded here. No production defect or candidate-wide clearance is inferred from this test run.

## Cleanup

The task/revision labels were rechecked and the exact owned container ID was removed. Exact inspect confirmed it absent. Docker inventory before creation was 23 IDs; before cleanup it was 24; after cleanup it was restored to the exact 23-ID baseline: the sole difference was the owned ID above, and no IDs were added. Temporary credential/environment files, runner, and directory were removed. No other container or service was changed. No source changes, reruns, full suite, browser, push, PR, or merge occurred.



## Authentic retained report — attachment799-new-tests-structural-oracle-advice-luna.md

# Attachment #799 new-test fixture and oracle audit

- Role: bounded, read-only Luna advisory audit; not an independent merge-gate review.
- Source inspected: `3a587676fb6281d49a197e8d37a3463dcf3fafc3`.
- Comparison base: accepted composition `9f736c39d4310cde458d76e561b245619d08c3bd`.
- Scope: all new test deltas in `attachment.test.ts`, `intake-attachment-duplicate-reach.test.ts`, and `intake-atomic-conversion.test.ts`; attachment, intake, query/reach contracts and the reported focused PostgreSQL result.
- No source, test, database, container, branch, PR, or remote was changed by this audit.

## Verdict

The new attachment repository and API-key tests are substantially contract-shaped and have concrete adverse controls. The duplicate-reach fixture is similarly persuasive: it establishes an accepted submission and a duplicate linking the same work item, exercises both requester identities and staff reach, and checks membership revocation against current reach. The latest reported run has one remaining deterministic test-oracle bug in the atomic conversion test. Do not treat the test file as green or its later negative assertions as executed.

## Findings

### Blocking for the focused suite — atomic cleanup expected key is regenerated

In `intake-atomic-conversion.test.ts`, the test spies on `deleteStorageObject`, then compares the observed cleanup argument with `toFinalAttachmentObjectKey(pendingRequesterUpload.objectKey)` after the controller returns. The helper generates a random final token, so this expected value is a second generated key, not the key passed through the actual `finalizeStorageObject` call. The test's expected value is therefore nondeterministic relative to the operation even when production behavior is correct. The latest focused run reports exactly this mismatch.

Smallest structural oracle correction: capture the `finalizeStorageObject` invocation and assert that cleanup receives the exact final target captured from that invocation (ideally also assert the source pending locator was the expected one). Keep `finalizeStorageObject` and `getObjectSizeAndHeader` mocked at the storage boundary; keep the real controller path and real database transaction. This makes the oracle follow the actual generated value rather than duplicate production's key-generation algorithm.

After that assertion, retain the database state assertion proving rollback left the requester row pending. Then call completion with the unauthorized staff-owned work-item attachment and assert 404 plus that the delete call count/arguments did not change. That is the necessary negative cleanup oracle: a rejected reach check must not trigger deletion. The current test places the staff case after the failing key assertion, so it has not executed in the reported run.

Confidence: high; directly follows the helper's generated value and the controller's captured `authorizedFinalKey`.

### Focused-run evidence must retain its limitation

The existing focused result note records 5 files, 4 passed / 1 failed; 92 tests, 91 passed / 1 failed. It also states the zsh wrapper failed after Vitest because it assigned to the readonly special variable `status`. Preserve both facts. Do not describe the result as a wrapper-captured reliable exit code. For the next authorized focused run, use the existing focused operator path and have Python's `subprocess.run(...).returncode` (or another already-available native process result) capture the child exit status; do not introduce a new runner/framework or reuse shell special variable names. Preserve the complete private output and report the Vitest summary separately from wrapper status.

Confidence: high; the private result note states these exact limitations.

## Fixture and assertion review

- `attachment.test.ts` direct repository test creates a genuinely reachable work item/attachment, a deleted control row, an unreachable same-workspace project whose membership is removed before identity resolution, and a separate workspace/organisation/project row. It verifies reachable inclusion plus deleted, unreachable, foreign-parent, null-identity, nonexistent-parent and mismatched-parent exclusion. This is a meaningful owner-reach matrix.
- The API-key test checks the actual `x-api-key` header, confirms the readable key succeeds, confirms an empty-capability key returns 403 without leaking the filename, and confirms a key with read scope cannot exceed its owner's current project reach (404). The production response path is exercised; the direct repository identity check supplements it.
- `intake-attachment-duplicate-reach.test.ts` uses two real customer identities and an accepted/duplicate pair sharing the work item. Its positive and negative assertions cover requester binding, customer visibility, acceptance-state parent selection, project reach and subsequent workspace-membership revocation. It first confirms project-level staff reach and then workspace-only reach after deleting project membership, with exact positive rows. I found no additional fixture/oracle defect in this delta.
- Atomic conversion's preconditions are explicit: actual customer organisation membership is granted and resolved; the staff identity is resolved and asserted to reach/read the target project; requester inability to read the work item is asserted; and the rows represent customer submission and staff work-item attachments. The test preserves the actual controller transaction and database state assertions. Its failure is isolated to expected-key recomputation; downstream staff-denial and later event/activity assertions were not reached in the reported run.

## Recommendation

Batch the atomic test correction as one closed contract: capture finalization source and generated target, assert deletion of that exact target on injected verification failure, assert transaction rollback leaves the row pending, and assert unauthorized staff completion returns 404 without any cleanup call. Then run the same five-file focused operator path with reliable native child-return-code capture. Retain the original 89/92 and both 91/92 adverse reports and logs unchanged. This advisory materially directs repair and cannot serve as independent review of the repaired candidate.



## Authentic retained report — attachment799-captured-key-focused-pg-luna.md

# Attachment #799 captured-key test-oracle repair

- Base: `3a587676fb6281d49a197e8d37a3463dcf3fafc3`.
- Exact clean candidate: `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3` (`test(attachments): assert captured rollback cleanup key`).
- Change: test-only correction in `tests/api-integration/intake-atomic-conversion.test.ts`. The test captures the actual `finalizeStorageObject` source and generated target, asserts injected verification failure deletes that captured target, asserts the database row rolls back to `pending`, and then asserts unauthorized staff completion is 404 without additional object deletion. It does not recompute the random final key and changes no production source.
- Cheap checks passed: Biome format, `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json`, `git diff --check`; commit hook Biome check passed. Worktree is clean.
- The one authorized five-file PostgreSQL run is pending at this SHA. All prior 89/92 and 91/92 run reports/logs and the earlier zsh readonly-variable wrapper error remain unchanged.



## Authentic retained report — attachment799-captured-key-focused-pg-result-luna.md

# Attachment #799 captured-key repair: focused PostgreSQL result

- Exact candidate: `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`; clean before and after run. The test-only oracle repair commit is `test(attachments): assert captured rollback cleanup key`.
- Exact files: `attachment.test.ts`, `intake-attachment-duplicate-reach.test.ts`, `intake-atomic-conversion.test.ts`, `api-key-project-role-clamp.test.ts`, `api-key-project-role-clamp-strict.test.ts`, existing API integration Vitest config.
- Result: Vitest `subprocess.run(...).returncode = 0`; 5/5 files passed and 92/92 tests passed. Duration 29.99s. Full unmodified private Vitest output: `attachment799-captured-key-focused-pg-result-luna.full.log` (mode 0600).
- The complete auto-accept conversion test passed, including the actual finalization source/target capture, deletion of that exact target after injected verification failure, DB rollback retaining `pending`, unauthorized staff completion 404, and no extra storage deletion.
- Environment: Python removed `CI` from the child environment and verified it absent before running Vitest. Database URL and password were held only in the private process environment / mode-0600 env file, not printed or included in the report or full log.
- Runtime: dedicated owned PostgreSQL 18 Alpine container ID `67ccce61cc7d2f8b81337fccc3ce358b2f8899864fdf9f799605308a6d9ed6cb`; dynamic loopback port 32787; tmpfs `/var/lib/postgresql`. Ownership/task/revision labels were verified before test setup and again before cleanup.

## Cleanup and limits

Docker ID baseline was 23 before container creation, 24 immediately before tests and cleanup, and exactly 23 after cleanup. Both inventories reconciled to the baseline plus only the owned ID; the exact owned ID was removed and `docker inspect` confirmed absence. Temporary credential/env file, task directory, and run artifacts under `/tmp` were removed after preserving the private log. No other container or service was modified. No full suite, browser, production code change, push, PR, or merge was performed. The three earlier adverse run reports and the independent fixture/oracle advice remain unchanged. This run proves the five specified integration files at this exact candidate only; it is not candidate-wide review or security clearance, and AT-7 remains unwaived.



## Authentic retained report — attachment799-current-42f10-ordinary-a-luna.md

# Attachment #799 current-source ordinary review A

**Verdict:** CLEAR for ordinary source review of the exact candidate and comparison base below. No blocking or non-blocking findings.

**Candidate:** `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`  
**Comparison accepted main:** `9f736c39d4310cde458d76e561b245619d08c3bd`  
**Branch/worktree:** `codex/query-ownership-580-attachments`, `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`  
**Role/context:** Fresh independent ordinary review A; dispatched as Luna-tier ordinary review. Platform exposed this session as GPT-6 family without a more specific served-variant label. This report does not claim a more specific model identity. I did not author, direct, advise, or remediate this candidate.  
**Source state:** HEAD matched the candidate SHA and the worktree was clean at inspection. No source, tests, refs, services, or shared state were changed. This report is mode 0600.

## Scope and method

Read the repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the full private current review packet, the attachment feature contract, coding standards query-ownership rules, multi-tenancy and security-model query-scoping rules, intake IQ-5a/IQ-9, customer-portal attachment rules, RBAC, and the accepted #785 identity-scope repository implementation. Read the preserved original #799 scope adjudication and all named repair/adverse-history reports, including their stated limits. Read the complete 16-path net diff from accepted main, including all changed attachment production modules, tests/helpers, and the retained review note; traced the affected controllers, middleware, route setup, and identity/capability resolver.

Commands personally run:

- `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat <base>...<candidate>`, `git diff --name-status <base>...HEAD` — confirmed exact head, clean worktree, and 16-path scope (11 attachment production modules, 4 test/helper paths, 1 review note).
- `git diff --find-renames --unified=3 <base>...HEAD --` on repository, route, and reach middleware files; then `git diff --unified=1 <base>...HEAD --` on all changed attachment controllers and reach middleware.
- Read the full attachment repository in sections and inspected the full accepted identity-scope helper and actual `resolveCallerIdentity` / API-key capability projection path.
- `git diff --check <base>...HEAD` — passed.
- `rg` for Drizzle imports/statements in the changed attachment controllers, index and reach middleware — no matches; query construction is in the named repository.
- `git status --porcelain=v1` — empty.

No tests, PostgreSQL, browser, build, Docker, CI, or network/remote checks were run by this reviewer. The focused five-file PostgreSQL result of **5/5 files, 92/92 tests, Python-captured child return code 0** is attributed to the author’s exact-source report `attachment799-captured-key-focused-pg-result-luna.md` and its private log; I did not independently execute or inspect the database run. Earlier 89/92 and 91/92 adverse runs and the original scope blocker remain preserved and are not reclassified by this source review.

## Review findings

I found no remaining instance of the original blocker in the current delta. Work-item listing and full-row attachment lookup (`listWorkItemAttachments`, `findWorkItemAttachment`) fail closed for absent/non-staff identity, bind the exact work item and workspace, reject deleted/archived parents, and apply the accepted current project-reach predicate in SQL. The controller and route callers resolve the actual request credential. Existing route authorization continues to enforce capability separately; the resolver projects a key’s stored permissions through `apiKeyCapabilitySubset`, and the existing key owner-capability clamp remains in the reach/capability path. The repository predicate is not incorrectly used as an authority grant.

Submission content reads retain identity and parent constraints in the statement. Customer list/read paths require customer identity and requester ownership, hide non-customer-visible rows, and admit the converted-work-item arm only when the submission is accepted and its exact `workItemId` equals the persisted submission link. Staff direct-submission rows use current workspace reach; the converted-work-item arm independently requires accepted state, exact transfer linkage, live work item/project, and current project reach. The distinct arms preserve workspace triage after project membership removal while withholding converted project content. Submission download content is selected separately from its minimized authorization-fact check and includes identity, workspace, parent, ready/deleted state, portal visibility, and the applicable reach arm.

The submission middleware’s first lookup now projects only authorization facts needed to locate and evaluate the parent (id, number, requester, organisation, state, linked work item, workspace); it no longer materializes the full submission/form data. Its customer path includes requester identity in that lookup. The attachment reach lookup selects only authorization facts, not filename/object key. Authorized submission completion checks the resolved customer identity/person and locked current submission before selecting/locking the exact permitted pending row. On rollback, object cleanup uses the final locator captured from that authorized row; it does not perform a bare-ID locator reread. The transaction, pending-row rollback, and deletion guards remain in the existing controller flow.

I checked the remaining extracted query functions and callers for behavior conservation: file limits and flags are instance configuration, parent/count/schema and locked mutation statements are keyed to the already admitted parent, and uploader/audit lookups return only the person identifier needed by the existing behavior. The controller extraction preserves the prior filters, DTO projections/order, ready/deleted behavior, state guards, locks, storage finalization sequence and audit path. The final test delta captures the actual randomized finalization target and checks rollback state plus unauthorized cleanup non-occurrence; the previous false-positive expected-key recomputation is gone.

The retained test matrix provides positive and adverse direct repository controls for same-workspace unreachable and foreign project parents, missing identity, forged parent, API-key stored scope and owner ceiling, requester ownership, hidden portal rows, duplicate/nonaccepted links, both submission OR arms, project-only and workspace-reach revocation, and cleanup after a real controller transaction failure. Runtime execution is author-attributed as above; test source presence is not presented as independently observed runtime proof.

## Residuals and limits

This verdict covers ordinary source correctness and alignment on this exact 16-path delta only. It is not the required full independent Sol security review, not a phase finalizer, not a full feature/#580/stage/SIT clearance, and not merge or hosted-CI approval. AT-7 pending-action deletion remains the separately documented unwaived acceptance gap. Image build/boot/health, browser, hosted checks, accepted-main composition and later acceptance remain outside this review. The current code review does not erase or upgrade the preserved original adverse query-scope adjudication; it concludes only that the inspected current source addresses its stated blocker.



## Authentic retained report — attachment799-current-42f10-ordinary-b-luna.md

# Attachment #799 current candidate — ordinary review B (GPT-6 Luna)

- Candidate SHA: `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`
- Comparison base: accepted source `9f736c39d4310cde458d76e561b245619d08c3bd`
- Worktree: `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- Independence: fresh reviewer context. I did not author, direct, or remediate this candidate; read-only review.
- Scope: all 16 changed paths, with focused review of the new repository SQL, attachment reach middleware, callers/controllers, identity-scope predicates, submission transfer/download parent arms, storage-finalize rollback cleanup, and adverse regression coverage.

## Verdict

**CLEAR — no blocking or non-blocking candidate findings.** The original scoped-content-query contract blocker is structurally addressed on this exact head. This is one ordinary review only; it is not the required GPT-6 Sol security review, merge readiness, or broader feature/stage/SIT acceptance.

## Review evidence

Read `AGENTS.md`, the active mission, agent workflow, coding standards, multi-tenancy rules, attachment and intake contracts (including IQ-5a/IQ-9), the original GPT-6 Sol query-scope adjudication, the current review packet, prior implementation/adverse-matrix notes, and the recorded focused PostgreSQL result. Verified clean worktree and exact HEAD. Inspected the complete repository implementation and all changed attachment controllers/callers; traced every attachment repository call and compared consequential controller extractions to the accepted base.

Static commands run:

- `git status --short` — clean.
- `git rev-parse HEAD` — exact candidate SHA above.
- `git diff --stat` and `git diff --name-only <base>..<candidate>` — confirmed 16-path scope.
- `rg` call-site/test searches across attachment source and API integration tests.
- `git diff --check <base>..<candidate>` — passed.

No tests, database, browser, build, Docker, CI, or source modifications were performed by this reviewer. The author-provided independent runtime record `attachment799-captured-key-focused-pg-result-luna.md` reports a native Python-captured Vitest exit code 0, 5/5 files and 92/92 tests passing on this exact candidate. I attribute that run to its recorded operator; I did not execute or independently reproduce it.

## Findings and rationale

- Work-item content reads now take resolved identity and bind the attachment row to the supplied parent plus live work item/project and `currentProjectReachPredicate`; null/non-staff identities fail closed. The direct tests have positive, null, forged-parent, foreign parent, deleted, and same-workspace-but-unreached controls. The route-level API-key test separately proves positive stored `work_item:read` scope, insufficient stored scope denial, and the owner’s project-reach ceiling.
- Submission lists and content reads enforce requester ownership for the submission arm, and use accepted-only equality to the submission’s actual linked work item for the transfer arm. Staff uses current workspace reach for submission-owned attachments and current project reach for transferred work-item attachments. Portal rows also require customer visibility; staff retains internal rows. Existing HTTP download tests exercise both project-reached and workspace-only staff behavior, including identical 404s for unreachable linked attachments and no audit writes on denial. New direct list tests cover requester, hidden, duplicate, accepted, and revoked project/workspace reach cases.
- Completion uses the locked persisted submission to establish the accepted parent, then obtains the pending attachment under requester identity, parent, workspace, uploader, visibility, and row lock constraints. Its finalization target is captured from that authorized row and retained across transaction rollback. The exact-head PostgreSQL test captures the actual finalize target, proves only that target is deleted after injected verification failure, verifies the row remains pending after rollback, and proves an unauthorized staff-owned upload causes no additional storage deletion.
- Extracted settings/count/insert/lock/update/delete/audit queries preserve their prior transaction boundaries and predicates on inspected paths. DTO projection/order, ready/deleted filters, download audit behavior, and activity writes remain intact. I found no new query outside the repository in the changed attachment routes.

## Limits and preserved boundaries

The historical AT-7 requirement for requester-approved pending-action deletion remains explicitly unwaived and separate; this review does not claim that deletion requirement or the full attachment feature is complete. This verdict does not claim #580, a stage, or SIT acceptance. Candidate-wide runtime, hosted CI, image/boot/health, source-import validation, and the fresh full GPT-6 Sol pass remain outstanding gates.



## Authentic retained report — attachment799-current-42f10-ordinary-c-luna.md

# Attachment #799 current candidate — ordinary review C

**Verdict: CLEAR for ordinary source review of this exact candidate and comparison base.** I found no blocking or non-blocking candidate findings.

- **Candidate:** `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`
- **Comparison base:** accepted main `9f736c39d4310cde458d76e561b245619d08c3bd`
- **Worktree/branch:** `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`, `codex/query-ownership-580-attachments`
- **Role/independence:** Fresh ordinary review C context, dispatched at the Luna tier. I did not author, direct, advise, or remediate this candidate.
- **Model provenance/fingerprint limit:** Platform identifies this context only as GPT-6 family; no served-variant/version introspection is available here. The dispatch role is Luna-tier, but I do not claim a more specific model identity than the platform exposed.

## Scope and method

Read the repository's canonical operating instructions, the full private current-source review packet, the preserved original GPT-6 Sol scoped-query adjudication, prior repair/runtime reports, and relevant coding-standards, multi-tenancy, security-model, RBAC, attachment, intake IQ-5a/IQ-9, and API-key contracts. Independently inspected the complete 16-path diff from accepted main, the full extracted attachment repository, changed routes/reach middleware/controllers, canonical identity-scope SQL helpers, and direct/API regression coverage. Traced every new attachment repository function to its callers and compared extracted query semantics with the base.

Commands/evidence personally checked:

- `git status --short --branch`, `git rev-parse HEAD`, `git diff --stat`, and `git diff --name-only <base>...<candidate>` — exact SHA, clean worktree, and all 16 paths confirmed (11 attachment production files, 4 test/helper files, 1 retained review note).
- `git diff --unified=3 <base>...<candidate>` over changed controllers, route and reach middleware, and tests; direct source reads of the entire attachment repository and relevant identity-scope helpers.
- `rg` call-site tracing for each new repository read and inspection of direct repository and HTTP tests.
- `git diff --check <base>...<candidate>` — passed.

No source, test, ref, database, service, or shared state was changed. I ran no tests, PostgreSQL, browser, build, Docker, CI, network, or GitHub checks. The author-reported focused PostgreSQL result remains attributed to `attachment799-captured-key-focused-pg-result-luna.md` and its private log: Python-captured child return code 0, 5/5 files and 92/92 tests. I did not execute or independently reproduce it. Earlier 89/92 and 91/92 adverse results and the prior Sol contract blocker remain preserved; this verdict does not erase them.

## Findings and reasoning

The current source resolves the original content-query contract blocker on this exact head. The work-item attachment list and full-row read require a resolved staff identity, exact work-item/workspace parent, live work item/project, and canonical current project-reach predicate in the SQL. Null identities fail closed. The route continues to check authority independently; the API-key identity carries its stored subset, and the existing route path retains the owner's live project-capability ceiling. The integration coverage contains direct positive reads plus null, forged parent, foreign organisation, deleted, same-workspace-but-unreached and API-key owner/scope controls.

Submission reads preserve the distinct ownership and transfer semantics. Customer list/content queries bind submission-owned rows to the caller's requester id and filter customer visibility; transferred rows require the persisted accepted state and exact submission-to-work-item link. Staff submission-owned content uses current workspace reach, while transferred work-item content uses current project reach in its own SQL arm. Both list and content reads keep the parent/workspace constraints, and visibility remains distinct between staff and portal projections. The direct list tests include own/other requester, hidden content, duplicate/nonaccepted link, accepted transfer, project-reach revocation with retained workspace triage, and workspace-reach revocation. HTTP download routes call the scoped content repository after middleware checks; the middleware's attachment reach read is also minimized and applies the same parent arms and reach predicates.

The parent bootstrap lookup now selects only authorization facts (submission id/reference, requester/organisation, state/link, workspace), not `formData` or the whole submission. The reach-time attachment lookup selects only id, parent, state, visibility and uploader facts. The full content select is separate and identity-scoped. Settings and feature flags remain configuration reads, and locked parent/count/insert/update/delete/audit operations retain their parent constraints and transaction executor. The submission completion handler locks the current submission, derives accepted transfer only from its persisted state/link, verifies the resolved customer identity matches the requester, and selects the pending row under that parent, uploader and visibility. On a 400 rollback path it deletes only the final key captured from that locked authorized row; it no longer rereads a locator by bare id. The updated test captures the actual random finalize target, verifies that exact target is deleted, verifies transaction rollback leaves the row pending, and proves the foreign staff upload returns 404 without an additional storage deletion.

Controller extraction preserves inspected projections/order, ready/deleted handling, lock modes, pending/deleted state guards, storage finalization sequence, activity transaction placement and audit ordering. No new non-repository query construction was found in the changed attachment route/controller/reach modules.

## Limits and boundaries

This is ordinary source review C only; it is not the required full independent GPT-6 Sol review, a phase finalizer, hosted-CI approval, merge readiness, image/boot/health evidence, browser verification, #580 acceptance, or feature/stage/SIT clearance. AT-7 pending-action deletion remains explicitly unwaived and separate. No HTTP exploit is inferred from the earlier source-level unscoped-query contract blocker; the current source finding is limited to the repair of that contract on this exact candidate.



## Authentic retained report — attachment799-current-42f10-full-security-61-sol.md

# Attachment #799 — independent FULL security review

**Reviewed head:** 42f10eaa5de6426dc03dc47ec4b88e24768f4cc3

**Comparison base:** 9f736c39d4310cde458d76e561b245619d08c3bd

**Verdict: BLOCKED — one remaining scoped-content-query contract finding.** No HTTP cross-tenant exploit is reproduced or claimed. This exact-head verdict is independent of the three ordinary CLEAR reports.

## Provenance and scope

Fresh independent security reviewer context `/root/attachment799_current_full_security_sol`, dispatched by the conductor as GPT-6.1 Sol full security reviewer. The runtime identifies this assistant as GPT-6; no independently introspectable served variant or provider fingerprint is exposed. The dispatch label is recorded, not asserted as a measured fingerprint. I did not author, direct, advise on remediation, fix, or perform ordinary review of this candidate. No subagents were used.

Verified HEAD and clean frozen worktree `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`. Actual net scope is 16 paths: eleven attachment production modules (repository, router, two reach middleware, seven controllers), four integration/helper paths, and the retained query-ownership review note. This is FULL review of that actual security delta and its accepted identity/key composition, not a lightweight conservation confirmation. Read canonical AGENTS/workflow/CLAUDE, status and newest decision portions, coding standards, multi-tenancy/security scoping rules, attachments, intake IQ-5a/IQ-9, portal CP-16 and RBAC; inspected canonical accepted #785 identity-scope helper and current resolver/key owner-ceiling logic. Read original adverse scope adjudication, current packet, three authentic ordinary reports and current focused runtime result/log. Prior historical reviews are retained at their own scope/heads.

## B1 — completion full-row repository lookup does not establish persisted own-request / accepted-parent scope

**Blocking contract defect:** `apps/api/src/attachment/repository.ts:519–557`, `findSubmissionCompletionAttachment`.

The function rejects missing/noncustomer identity and checks `identity.personId === input.requesterId`. Its full-row SELECT then filters attachment id, supplied workspace, `uploadedBy = input.requesterId`, visibility and nondeleted status. However its parent predicate is solely `(attachment.submissionId = input.submissionId OR attachment.workItemId = input.acceptedParentId)` when the latter is supplied. It does not read or correlate the persisted submission at all.

Both arms therefore depend on unverified parent parameters at this repository boundary. The submission arm does not establish `submission.requesterId = identity.personId`; the converted arm does not establish persisted accepted state or equality to that submission's actual work-item link. Uploader identity is a useful extra restriction but is not the own-request relation. In particular, take a real customer identity and any customer-visible, nondeleted attachment uploaded by that person and already transferred to item W. Passing that attachment's id/workspace, requesterId equal to the identity, acceptedParentId W, and a nonexistent, other-requester or duplicate submissionId still satisfies this SELECT. Its complete row, including filename/objectKey, can materialize even though the supplied request has no accepted relationship to W. This is static predicate analysis, not an executed database reproduction.

The corresponding direct submission case similarly trusts a supplied submission id and upload ownership without checking the persisted request owner. The same missing relation is one defect class, rather than two independent findings. Null identity and mismatched requester checks do not close it.

**Contract basis:** coding-standards.md:119–123 and157–165, multi-tenancy.md:50–63, security-model.md:114–122 require resolved caller reach in the content statement; ids alone do not prove scope. Portal upload is own_request; IQ-9 transfer and CP-16/accepted-only handling distinguish actual owning accepted request from duplicate links. The preserved original adjudication requires exact parent authorization and both OR arms at content boundaries, with no caller-precheck exception.

**Protected exposed boundary:** `controllers/complete-submission-attachment.ts:33–57` first locks the real submission with requester and request-type workspace equality through `lockSubmissionForCompletion`, derives acceptedParentId from current accepted state and exact persisted link, checks allowed submission states, then calls this lookup inside the same transaction. Router and reach middleware additionally resolve portal identity and parent. Those are real protections. This review does not claim a route permits arbitrary client acceptedParentId, an observed foreign storage deletion, or an HTTP disclosure. The blocker is incomplete structural repository contract repair, precisely the distinction preserved by the original adjudication.

No repair was designed or implemented by this reviewer, and no future repair is approved by this report.

## Remaining full-scope assessment

- Work-item full-row/list content functions accept resolved staff identity, bind actual attachment-to-work-item-to-project relationships, reject dead/archived parents, and apply canonical current project reach in SQL. Exact supplied workspace/work-item narrows the lookup. The tombstone-capable lookup preserves authorized idempotent delete semantics while list/download retain their deleted/ready checks.
- Portal/staff submission lists and `findSubmissionAttachmentContent` correlate persisted submission/requester for customers or current workspace reach for staff on direct submission rows. The transferred arm independently checks accepted state, exact persisted link, and current live project reach for staff. Portal visibility and download ready/deleted filters remain. Forged work-item input cannot substitute an unrelated persisted link in those functions. Customer ownership is deliberately requester-based, not general organisation visibility.
- `findReachableSubmissionAttachment` is minimized to id/parent/state/visibility/uploader facts and has current submission/project reach. Initial submission discovery now returns only needed parent authorization facts, without form data. Work-item bootstrap returns only ownership/reach identifiers. Settings, feature flags and person-id resolution are not mislabeled attachment content.
- Accepted #784 authority clamp survives: projectCapabilityRefused still requires ownerCapable when a key scope decision is deferred; current resolver projects stored key permissions through apiKeyCapabilitySubset. SQL reach helpers do not grant capabilities. Existing route checks retain stored key subset intersected with owner authority. Accepted #785 helper reads current canonical memberships, workspace seesAll and active instance-admin facts; this candidate uses it without altering that contract.
- Mutation statements preserve transaction executors, parent share/update locks, pending/deleted guards, winning activity writes and audit-before-response ordering. Counts/settings/form snapshots and mutation helpers continue operating within admitted parent orchestration; no new side-effect ordering defect found in the extraction. Storage validation/finalization sequence is conserved.
- Submission verification rollback cleanup now uses only the finalized locator captured from the admitted, locked row, with no bare-id postrollback objectKey reread. This materially repairs the original cleanup issue. The externally reachable controller authorization remains as described above; B1 is about its content repository statement, not a claim that cleanup now acts on client-selected locators.

## Tests, actual execution and coverage limits

Personally ran read-only git status/rev-parse, diff stat/numstat, diff/source inspections, rg/cat/sed/nl, live `gh pr list --state open`, `gh issue list --state open`, `gh pr view 799`, and `git diff --check <base> HEAD` (PASS). The list reads used limit5. Live PR799 remained published at92d0128035d1e2cf5361ad26e00d8fba3a913061; this local source is not relabeled published. No tests, PostgreSQL, Docker, browser, build, full suite, CI execution or source mutation were performed by me. One attempted tail used a nonexistent guessed log basename; corrected to the actual result-luna.full.log, whose summary was read. No runtime retry occurred.

Author/operator-attributed runtime record `attachment799-captured-key-focused-pg-result-luna.md` reports Python-captured Vitest child returncode0, five files /92 tests PASS at exact42f10. Actual log ends with5 passed files and92 passed tests,29.99s. This is not my independent reproduction. Earlier89/92, two91/92, and the zsh readonly-status wrapper error remain authentic adverse history, not erased by the final pass.

Inspected test changes for nonvacuity: work-item direct tests seed reachable, deleted, same-workspace unreached and foreign-organisation rows, with positive filename control and null/forged-parent negatives. Real API-key HTTP tests include nonempty allowed read and missing-scope/owner-reach denials; existing strict clamp files are part of the attributed run. Submission direct tests seed both parent arms, visibility variants and another requester, then actually remove nonempty project/workspace memberships and assert distinct surviving content. Rollback test mocks storage only, executes the real controller DB transaction, captures actual randomized finalize target, asserts exactly that deletion, pending-row rollback and foreign-staff404/no extra deletion. The repaired final assertion avoids recomputing a random key.

Coverage limitation relevant to B1: the added direct submission matrix calls listPortalSubmissionAttachments/listStaffSubmissionAttachments, not findSubmissionCompletionAttachment. The added direct reads also do not exercise findSubmissionAttachmentContent. Passing those92 tests does not demonstrate forged-parent rejection at the completion content repository boundary. Test presence and successful route orchestration cannot substitute for that absent relation in SQL.

## Residuals and authority

No other blocking or nonblocking candidate finding identified in this full source pass. B1 remains open on the exact reviewed head. AT-7 inherited immediate deletion without requester-approved pending action remains separate, UNWAIVED, and prevents full attachment acceptance; this review neither implements nor waives it. No whole feature/#580/stage/SIT, merge-ready, hosted-CI or image claim. Future actual-main composition, exact-head CI, image build/boot/health and applicable browser evidence remain conductor-owned gates. BROWSER VERIFICATION: BLOCKED (outside this read-only source review).

Only this private report is written, mode0600. No source edits, commit, push, PR or merge.



## Authentic retained report — attachment799-persisted-completion-scope-author-luna.md

# Attachment #799 persisted completion-scope repair — author report

Candidate HEAD: `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9`
Prior reviewed head: `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`
Worktree: `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`

## Change

`findSubmissionCompletionAttachment` now keeps its single-table row return shape and `FOR UPDATE` behavior, but its parent condition uses correlated `EXISTS` subqueries. Both branches require the persisted submission id, requester equal to the actual resolved customer person and caller requester, and the request type's persisted workspace equal to the requested workspace. The transfer branch additionally requires persisted `accepted` state, equality between persisted work-item id and the passed accepted-parent id, and equality between the attachment work-item id and that persisted work-item id. Thus neither submitted ids nor upload ownership alone authorize full-row materialization. The content function itself was already correlated; it was not changed.

No controller, transaction, row-lock ordering, DTO, storage cleanup, route, schema, capability, dependency, policy, or AT-7 behavior changed. Accepted paths from the base are retained.

## Regression coverage

Added direct repository tests in `intake-attachment-duplicate-reach.test.ts` using identities returned by `resolveIdentity`, persisted customer-owned accepted and duplicate submissions, and real seeded attachments. Tests cover positive direct-submission and accepted-transfer lookup; missing and other-requester/duplicate submission ids; same-requester nonaccepted submission; forged accepted-parent and linked-work-item ids; workspace mismatch; requester mismatch; and null identity. `findSubmissionAttachmentContent` is exercised directly for both positive arms and the corresponding transfer negatives, including nonaccepted and forged link.

## Validation and provenance

- API test TypeScript config: `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — exit 0.
- Biome on both touched files — exit 0; reports five pre-existing `useOptionalChain` suggestions in repository guards (the changed code has no non-null assertion); no automatic unrelated fixes.
- `git diff --check` — passed.
- Commit: `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9`; worktree clean after commit.
- No PostgreSQL or other heavy runtime was launched in this author step. The conditional five-file PG window is requested from the conductor for this exact clean SHA.

This is author evidence only, not independent review or feature acceptance. Earlier ordinary CLEAR reports, the 42f10 Sol BLOCKED report, and all prior adverse runs remain authentic and unaltered; this change requires fresh exact-head ordinary review and Sol security review. AT-7 remains separately inherited and UNWAIVED. No push, PR, or merge was performed.



## Authentic retained report — attachment799-a097-delta-ordinary-a-luna.md

# Attachment #799 candidate delta — ordinary review A

**Verdict: CLEAR for the exact two-path delta** on the prior three-ordinary-cleared scope. The full security review at the prior head was BLOCKED on this repository boundary; this report clears only that stated finding against the current source. It is not a security review, merge approval, runtime result, or broader #580/feature/stage/SIT clearance.

- **Candidate:** `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9`
- **Prior reviewed head:** `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`
- **Accepted comparison base:** `9f736c39d4310cde458d76e561b245619d08c3bd`
- **Worktree:** `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- **Role and independence:** Fresh ordinary review A context, dispatched in the Luna tier. I did not author, direct, advise, or remediate this delta.
- **Model identity:** The platform identifies this session as GPT-6 family without an independently inspectable served-variant/version fingerprint. The assignment is Luna-tier; I do not claim a more specific model identity.

## Scope and evidence

Read the canonical repository instructions and workflow, active mission, the current #799 packet, all three authentic ordinary reports, the prior full Sol B1 blocker, and the author’s delta report. The packet’s relevant contract is that the full-row completion lookup must prove persisted own-request and accepted-transfer relationships in each parent arm; ids and uploader ownership alone do not establish scope. The prior Sol report also identifies route/controller checks as protections while explicitly locating B1 in the repository statement.

Commands personally run:

- `git status --porcelain=v1`, `git rev-parse HEAD` — clean worktree at the exact candidate SHA.
- `git diff --stat 9f736c39d4310cde458d76e561b245619d08c3bd...HEAD` — confirmed the original 16-path source scope remains.
- `git diff --name-status 42f10eaa5de6426dc03dc47ec4b88e24768f4cc3...HEAD` — exactly the two assigned paths changed: `apps/api/src/attachment/repository.ts` and `tests/api-integration/intake-attachment-duplicate-reach.test.ts`.
- `git diff --check 42f10eaa5de6426dc03dc47ec4b88e24768f4cc3...HEAD` — passed.
- Read the full changed repository function and the new test case; inspected imports and surrounding seed/helper definitions.

No source, tests, refs, database, services, or shared state were changed. I did not run tests, PostgreSQL, browser, build, Docker, CI, or remote checks. The author reports only API test TypeScript config, Biome and diff-check validation, and says the conditional five-file PostgreSQL run is separately executing under the author’s exclusive window. I do not attribute an actual runtime result to this review.

## Finding disposition

**Prior B1 is resolved in the inspected source.** `findSubmissionCompletionAttachment` still fails closed unless the resolved identity is a customer whose person id equals the supplied requester. Its full-row attachment statement now requires an `EXISTS` relation to the persisted submission and request type, including the exact submission id, requester equal to both resolved identity and input, and persisted request-type workspace equal to the requested workspace.

The direct-submission arm correlates the attachment’s submission id to that persisted submission. The transfer arm additionally requires persisted `accepted` state, persisted work-item id equal to the accepted-parent input, and attachment work-item id equal to the persisted link. Both arms remain inside the same full-row attachment SELECT, alongside attachment id/workspace, uploader, customer visibility, and nondeleted constraints. Thus neither a nonexistent/other/duplicate request id nor a caller-supplied accepted-parent id alone can cause the full row to materialize. The outer SELECT retains its `FOR UPDATE` and return shape.

The added direct integration coverage uses resolved customer identity and persisted fixtures. It exercises positive direct-submission and accepted-transfer repository reads; rejects missing/duplicate and same-requester nonaccepted submissions, forged/null transfer ids, null identity, mismatched workspace/requester, and a private row through the direct arm. It also directly exercises the content repository’s positive direct and transfer arms plus duplicate/nonaccepted/forged-link negatives. The identity assertion and real inserted rows make the positive controls non-vacuous. These tests are structurally relevant to B1; their execution remains unverified by me.

I found no change in this delta to DTOs, row shape/lock behavior, controller transaction order, storage cleanup, routes, schemas, capabilities, dependencies, policy, or AT-7 behavior. The prior full-scope review remains necessary evidence for the unchanged 14 paths; this delta does not alter them. The accepted comparison remains the specified base.

## Limits

This is a static ordinary delta review only. It does not replace the required fresh full Sol security pass on the current exact head. The author’s pending PostgreSQL run has no result established here. Hosted checks, image/boot/health, browser evidence, future accepted-main composition and all broader acceptance remain outside scope. AT-7 remains separately documented and unwaived. No whole attachment feature, #580, stage, or SIT acceptance is claimed.



## Authentic retained report — attachment799-a097-delta-ordinary-b-luna.md

# Attachment #799 candidate delta — ordinary review B

**Verdict: BLOCKED for the exact two-path delta.** The production repair appears to satisfy the prior B1 repository contract, but the newly added focused PostgreSQL test has a failing assertion on the exact candidate. This is a test expectation defect, not evidence of a production authorization defect. The candidate needs a corrected, rerun test before this review tier clears.

- **Candidate:** `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9`
- **Prior reviewed head:** `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`
- **Accepted comparison base:** `9f736c39d4310cde458d76e561b245619d08c3bd`
- **Worktree:** `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- **Role and independence:** Fresh ordinary reviewer B context, dispatched in the Luna tier. I did not author, direct, advise on remediation, fix, or perform the earlier ordinary review of this delta.
- **Model identity:** The platform identifies this session as GPT-6 family without an independently inspectable served-variant/version fingerprint. The assignment is Luna-tier; I do not claim a more specific model identity.

## Scope and evidence

Read `AGENTS.md`, agent workflow and `CLAUDE.md`, the current #799 packet, the prior full Sol B1 report, the author’s delta report, and ordinary review A’s exact-head delta report. Checked the exact two-path diff against `42f10eaa5de6426dc03dc47ec4b88e24768f4cc3`, the new repository function and test, surrounding content lookup and controller behavior, and the actual author-attributed focused PostgreSQL result and its retained full log.

Commands personally run:

- `git status --short --branch`, `git rev-parse HEAD` — exact requested HEAD; tracked worktree clean.
- `git diff --stat` / `--name-status 42f10eaa...a09724b7` — exactly `apps/api/src/attachment/repository.ts` and `tests/api-integration/intake-attachment-duplicate-reach.test.ts` changed (190 insertions, 7 deletions).
- `git diff --check 42f10eaa...a09724b7` — passed.
- Read the complete changed function and added integration test, relevant `findSubmissionAttachmentContent` predicate, and completion controller transaction/lock flow.
- Read `attachment799-a09724b7-focused-pg-result-luna.md`; searched its retained full log around the failed test and assertion.

No source, tests, refs, database, or shared state were changed by me. I did not run tests, PostgreSQL, browser, build, Docker, CI, or remote checks. The runtime evidence below is attributed to its recorded operator, not my execution.

## Prior B1 disposition

**The source repair resolves the stated B1 contract defect by inspection.** The outer full-row attachment SELECT retains id/workspace, uploader, customer visibility, nondeleted constraints and `FOR UPDATE`. Its parent predicate now contains two correlated `EXISTS` branches against the persisted submission joined to its request type. Both require the supplied submission id, persisted requester equal to resolved customer identity and input requester, and persisted request-type workspace equal to the supplied workspace. The direct branch correlates attachment submission id to that persisted submission. The transfer branch additionally requires persisted accepted state, persisted work-item id equal to the passed accepted-parent id, and attachment work-item id equal to the persisted link. The completion controller still locks the submission before deriving acceptedParentId and entering this lookup in the same transaction.

The changed test has useful real-fixture positive and adverse controls, including direct completion, accepted transfer, missing/duplicate/nonaccepted submission, forged transfer link, null identity, workspace mismatch, requester mismatch, and direct content lookup arms. The prior panel’s coverage remains applicable to the unchanged paths: net change from accepted main remains the original 16-path scope, with only the two stated paths changed since the exact reviewed base. This delta does not alter the other 14 paths.

## Blocking finding — contradictory assertion for the valid accepted transfer

The added test `completion and content lookups require the persisted own submission or its accepted link` at `tests/api-integration/intake-attachment-duplicate-reach.test.ts:384–389` calls `findSubmissionCompletionAttachment` with `completionInput` for the actual accepted owner submission and exact linked work item, changing only the attachment id to `s.privateAttachment.id`, then expects `[]`. That row is a customer-visible attachment on precisely the accepted submission’s linked work item, uploaded by the same owner; it is the allowed transfer arm. The immediately following `findSubmissionAttachmentContent` call uses the same persisted accepted submission, attachment, requester identity and linked work item and expects one row. Thus the completion assertion contradicts the contract and the same test’s positive content assertion.

The captured PostgreSQL output confirms this assertion fails: the returned attachment object is compared with expected `[]`. The operator report records native Vitest return code 1, 4/5 files passed, 92/93 tests passed, with this single failure. The failure is consistent with the production query correctly admitting the valid accepted transfer. It does not demonstrate an unauthorized lookup or an HTTP exploit. However, a red exact-head focused suite means this candidate cannot clear ordinary review; the failed result must remain adverse evidence until a corrected candidate is rerun.

## Limits and outstanding gates

This is a static ordinary delta review plus inspection of an operator-attributed runtime result, not an independent database reproduction and not a security review. The required fresh full GPT-6 Sol pass remains mandatory after ordinary review clears on a corrected exact head. Earlier adverse runs remain recorded. AT-7 requester-approved pending-action deletion remains separate and unwaived. No whole attachment feature, #580, stage, SIT, image/runtime, merge-readiness, or hosted-CI clearance is claimed.



## Authentic retained report — attachment799-a09724b7-focused-pg-result-luna.md

# Attachment #799 a09724b7 focused PostgreSQL result

Exact candidate: `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9` (clean before run). Exact scope was the authorized five files: `attachment.test.ts`, `intake-attachment-duplicate-reach.test.ts`, `intake-atomic-conversion.test.ts`, `api-key-project-role-clamp.test.ts`, and `api-key-project-role-clamp-strict.test.ts`.

## Result

The native Python `subprocess.run(...).returncode` for Vitest was **1**. Vitest executed all requested files: 4/5 passed, 1/5 failed; 92/93 tests passed, 1 failed. Duration 36.00s. The failure is at `intake-attachment-duplicate-reach.test.ts:384–389`, in the new test `completion and content lookups require the persisted own submission or its accepted link`. The assertion expects `findSubmissionCompletionAttachment` to return `[]` for `s.privateAttachment.id` while using the real accepted submission and its exact linked work item. The query returned the persisted `owner-private.pdf` attachment. This row is precisely the valid accepted-transfer positive; the test expectation is inconsistent with the authorized contract and with the immediately following direct content positive for that same transfer row. No production SQL defect is indicated by this failure. Per the one-run authorization, no follow-up edit or rerun was made.

All other 92 tests passed, including the four other requested files and the remainder of the duplicate/reach file. Full unmodified private Vitest output is retained at `attachment799-a09724b7-focused-pg.full.log` (mode 0600).

## Runtime ownership and cleanup

The run used dedicated owned PostgreSQL 18 Alpine container ID `06d9238569c1d24d1abeea968ea703f95410dc0045bd839d052036edc36c937f`, labeled task `attachment799`, exact revision `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9`, run `attachment799-a09724b7`; labels and tmpfs `/var/lib/postgresql` were verified before tests and before cleanup. Port was dynamically assigned and loopback-bound at `127.0.0.1:32788`. `CI` was removed from the Python child environment and verified absent. The randomized credential was supplied through a mode-0600 temporary env file and process environment; the env file was removed. Docker baseline was 23 IDs before creation; immediately before tests it was exactly baseline plus the owned ID; after exact-ID removal it returned to exactly 23. The owned ID is absent. No other runtime was touched.

This result is not a green focused runtime or candidate-wide clearance. Earlier adverse-run reports and the independent 42f10 Sol BLOCKED report remain unchanged. No source follow-up, push, PR, or merge was performed.



## Authentic retained report — attachment799-a09724b7-test-oracle-correction-luna.md

# Attachment #799 focused lookup test-oracle correction

Candidate: `02a36d03fe2748a9b60e66ffe720be72ff6e2279`
Prior candidate/result: `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9` (native focused Vitest return code 1; 92/93 passed, retained unchanged in `attachment799-a09724b7-focused-pg-result-luna.md` and `.full.log`).

## Exact test delta

Only `tests/api-integration/intake-attachment-duplicate-reach.test.ts` changed. The historical seed variable `privateAttachment` refers to an attachment on a private work item; the row is customer-visible. The new test now uses the explicit local alias `acceptedTransferredAttachment` and expects the real accepted submission + exact work-item transfer arm to return that exact row from both completion lookup and content lookup. A distinct persisted hidden direct-submission attachment was added and is expected to be refused by both completion and portal content lookup. All prior missing/duplicate/nonaccepted/forged-parent/link/null-identity/requester/workspace negatives remain. Content lookup additionally directly tests missing submission, foreign workspace and other resolved customer identity.

| Persisted fixture / input | Completion lookup expectation | Content lookup expectation |
| --- | --- | --- |
| Owner's accepted submission + own direct visible row | exact row returned | exact row returned |
| Same owner's accepted submission + actual customer-visible attachment transferred to its exact linked work item | exact transferred row returned | exact transferred row returned |
| Distinct hidden direct-submission row | empty | empty (portal) |
| Missing / other-requester duplicate / same-requester nonaccepted submission on transferred row | empty | empty |
| Forged accepted-parent or linked-work-item id | empty | empty |
| Missing/foreign workspace, requester mismatch, foreign resolved identity, or null identity as applicable | empty | empty |

## Cheap verification

- `pnpm exec biome check --write tests/api-integration/intake-attachment-duplicate-reach.test.ts` — exit 0; one file checked and formatted.
- `pnpm --filter @taskdesk/api exec tsc --noEmit -p tsconfig.tests.json` — exit 0.
- `git diff --check` — passed.
- Commit `02a36d03fe2748a9b60e66ffe720be72ff6e2279`; worktree clean.
- No runtime launched after correction. Awaiting conductor's independent read of this exact test delta before the already-authorized single five-file PostgreSQL run.

Author evidence only. The earlier 92/93 result remains adverse history, not overwritten or reinterpreted as passing. No production SQL changed in this correction. The existing production delta still requires fresh ordinary and full Sol exact-head reviews after runtime. No push, PR, or merge.



## Authentic retained report — attachment799-foreign-customer-fixture-precondition-luna.md

# Attachment #799 foreign-customer fixture precondition

Candidate: `04bc6edd57d48816f43994f82fbf722d05aa70d7`
Parent candidate: `02a36d03fe2748a9b60e66ffe720be72ff6e2279`

Added an explicit assertion that the independently resolved `otherIdentity` is a customer identity for `s.other.person.id` before using it in the direct content lookup foreign-requester negative. This prevents an unresolved null identity from satisfying that denial vacuously. No production source changed.

Cheap checks passed: Biome on the changed integration test, `git diff --check`, and API test TypeScript config. Normal commit completed; worktree clean at exact candidate above. No runtime launched. Report mode 0600.



## Authentic retained report — attachment799-04bc6edd-focused-pg-result-luna.md

# Attachment #799 04bc6edd focused PostgreSQL result

Exact candidate: `04bc6edd57d48816f43994f82fbf722d05aa70d7`; clean before and after run. The exact authorized files were `attachment.test.ts`, `intake-attachment-duplicate-reach.test.ts`, `intake-atomic-conversion.test.ts`, `api-key-project-role-clamp.test.ts`, and `api-key-project-role-clamp-strict.test.ts`.

## Result

Python `subprocess.run(...).returncode` captured the actual Vitest child exit as **0**. Vitest reports **5/5 files and 93/93 tests passed**, duration 42.27 seconds. Full unmodified output is retained at `attachment799-04bc6edd-focused-pg.full.log` (mode 0600).

The corrected direct repository matrix executed both real positives: actual accepted customer's direct submission attachment and the actual customer-visible transfer attachment on its persisted accepted submission's exact work item. It also executed the distinct hidden-row negatives and missing/other-requester/duplicate/nonaccepted/forged parent-or-link/null identity/foreign workspace/requester adversarial cases, including the explicit resolved foreign-customer identity precondition. The complete atomic conversion test passed through its late rollback assertions: captured finalization target deleted exactly once after injected verification failure, pending DB row retained after rollback, unauthorized staff completion returned 404, and no extra storage delete occurred. Both API-key project-role clamp files passed.

## Runtime ownership and cleanup

Dedicated owned PostgreSQL 18 Alpine container ID `b3b6c2fc240ba51645db1aedd89dd81201cebe00b9e34a18d5692f0b338bbd89`, labels task `attachment799`, exact revision `04bc6edd57d48816f43994f82fbf722d05aa70d7`, run `attachment799-04bc6edd`. Ownership labels and tmpfs `/var/lib/postgresql` were verified before tests and before cleanup. Dynamic port `32789` was loopback-bound (`127.0.0.1`). `CI` was removed from and verified absent in the Python child environment. A randomized credential was passed through a private mode-0600 temporary env file/process environment and the file was removed. Docker baseline was 23 IDs before creation, exactly baseline plus the owned container before tests, and exactly 23 after exact-ID cleanup; the owned container is absent. No other runtime was touched.

Earlier `a09724b7` 92/93 failure and all prior adverse run reports remain unmodified and recorded. This is focused runtime evidence at this exact candidate, not candidate-wide review, security clearance, feature acceptance, or merge readiness. The production SQL correlation delta still needs fresh exact-head ordinary review and full Sol security review. AT-7 remains separate and unwaived. No push, CI, PR, or merge was performed.



## Authentic retained report — attachment799-04bc-test-delta-ordinary-luna.md

# Attachment #799 — 04bc focused test delta ordinary review

**Verdict: CLEAR for the exact test-only delta** on the prior a097 source review, including its test-oracle blocker. This report does not clear the full candidate, provide security approval, or claim feature or stage acceptance.

- **Candidate:** `04bc6edd57d48816f43994f82fbf722d05aa70d7`
- **Comparison base:** accepted main `9f736c39d4310cde458d76e561b245619d08c3bd`
- **Immediate parent:** `02a36d03fe2748a9b60e66ffe720be72ff6e2279`
- **Prior reviewed test/source head:** `a09724b7df673ff6a5a20b3e7db3d6ed7a2cb1f9`
- **Worktree:** `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`
- **Role / independence:** Fresh ordinary test-delta reviewer dispatched in the Luna tier. I did not author, direct, advise on, or remediate the candidate. The platform does not expose an independently inspectable served-variant fingerprint; this records the dispatch tier, not a measured model identity.

## Scope and checks

Read repository workflow instructions, the current #799 packet, prior full-scope ordinary reports, the prior full Sol report, both a097 delta reports, the oracle-correction report, foreign-customer fixture-precondition report, candidate test diff, relevant seed helpers, and actual focused PostgreSQL result plus retained log.

Commands personally run:

- `git rev-parse HEAD`, `git status --porcelain=v1` — exact candidate, clean tracked worktree.
- `git diff --name-only 02a36d03..04bc6edd` — only `tests/api-integration/intake-attachment-duplicate-reach.test.ts` changed.
- `git diff --check 02a36d03..04bc6edd` — passed.
- `git diff --quiet a09724b7 04bc6edd -- apps/api/src/attachment/repository.ts` — exit 0; the production repository source is byte-identical across these heads.
- Inspected the exact test delta, seed definition for `privateAttachment`, and all assertions in the completion/content lookup matrix.
- Read the operator result and actual log `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/attachment799-04bc6edd-focused-pg.full.log`; its tail reports 5/5 files and 93/93 tests passed, 42.27 seconds. I did not run this suite myself; execution and runtime ownership are attributed to the operator report.

No files, refs, database, services, or shared state were changed by me. No tests, PostgreSQL, browser, build, Docker, CI, or remote checks were run by me.

## Findings

The 04bc delta adds an explicit positive identity assertion before using `otherIdentity` in the direct content-lookup foreign-requester denial. The resolved identity must match `{ side: "customer", personId: s.other.person.id }`, so the negative case cannot silently pass because identity resolution returned null or a non-customer identity. This closes the fixture-precondition concern without changing production code.

The corrected a097 oracle is also present in the exact candidate: the seed comment and row show `privateAttachment` is a ready, customer-visible attachment uploaded by the owner and attached to the linked work item. The test aliases it as `acceptedTransferredAttachment` and expects the exact persisted accepted-submission/exact-linked-work-item transfer row from both completion and content lookup. A distinct `customerVisible: false` direct-submission row is expected to be rejected by both. The prior contradictory expectation is therefore corrected and the actual focused run is green.

The test retains substantive negative controls: missing and other-requester duplicate submissions; same-requester nonaccepted submission; forged, absent, or mismatched linked-parent inputs; foreign workspace and requester; null identity; and hidden-row denial. The resolved foreign-customer assertion is now a real precondition for its associated denial. The operator-attributed run also covers the full five-file focused suite, including conversion rollback assertions, but I do not independently reproduce those results.

## Disposition and limits

**The ordinary test-delta tier is clear at 04bc.** The previous a097 review B blocker was the contradictory accepted-transfer expectation; the corrected fixture and assertion are supported by source inspection and by the recorded exact-head 93/93 run. The intervening 02a36 test-oracle correction was independently read in this review as part of assessing the exact candidate; this report’s verdict covers the complete test-only delta from a097 through 04bc.

The full Sol review at 42f10 was BLOCKED on B1, and the production repair at a097 remains subject to the fresh full Sol pass required on the current exact head. This review is not that pass. The focused runtime result is operator-attributed evidence, not my execution. Hosted checks, full candidate acceptance, AT-7 (still UNWAIVED), #580, stage, and SIT remain outside this verdict. No merge-readiness or broader attachment-feature claim is made.



## Authentic retained report — attachment799-04bc-current-full-security-61-sol.md

# Attachment #799 — fresh independent FULL security review

**Reviewed head:** 04bc6edd57d48816f43994f82fbf722d05aa70d7

**Comparison base:** 9f736c39d4310cde458d76e561b245619d08c3bd

**Verdict: CLEAR for this exact full source security review.** No blocking or nonblocking candidate finding identified. Prior B1 is resolved at this head. This is not merge readiness or feature acceptance.

## Provenance and independence

Fresh context `/root/attachment799_04bc_current_full_security_sol`, dispatched by the conductor as GPT-6.1 Sol FULL security reviewer. The platform identifies this assistant as GPT-6; no independently inspectable served variant/version or provider fingerprint is exposed. The dispatch label records assignment provenance, not a measured fingerprint. I authored, directed, advised on and remediated none of this candidate or its repairs, and performed none of its ordinary reviews. No subagents used.

Verified the exact clean frozen worktree `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`. The base-to-head scope is sixteen paths: eleven attachment production modules, four integration/helper test paths and the retained historical review note. This is a fresh full review of the current scope and accepted #785 identity-helper / #784 key-clamp composition, not a lightweight confirmation or merely approval of the last test edit.

Read canonical AGENTS/workflow/CLAUDE, status and newest decision context, coding-standards query ownership/materialization, multi-tenancy and security-model scoped-query rules, attachments, intake IQ-5a/IQ-9, portal CP-16 and RBAC/key authority contracts. Inspected the actual attachment repository, route setup, both reach middleware and all seven controllers; compared extraction/controller diffs to the accepted base, inspected all changed test/helper paths and retained review evidence. Read the complete private current packet, original adverse scope adjudication, prior three full ordinary reports, prior full Sol B1 report, a097 ordinary A/B, persisted-completion author report, oracle correction, foreign-identity precondition, current ordinary test-delta report and current runtime report/log; also read the named structural repair/adverse-matrix/fixture/oracle history reports. Historical reports retain their original heads and limits.

## B1 disposition and current content boundaries

`findSubmissionCompletionAttachment` now rejects absent/noncustomer identity and mismatched requester before query execution. Each correlated EXISTS branch in its full-row SELECT joins the persisted submission to its request type and requires the exact supplied submission, requester equal to actual resolved customer person and supplied requester, and persisted request-type workspace equal to supplied workspace. The direct arm correlates attachment.submissionId to that persisted submission. The transfer arm additionally requires persisted accepted state, persisted workItemId equal to the accepted-parent input, and attachment.workItemId equal to that persisted link. Outer attachment id/workspace, uploader, customer visibility, nondeleted filters and FOR UPDATE remain. Thus uploader ownership or invented parent identifiers alone no longer materialize content. Missing, other-requester, duplicate/nonaccepted and forged linked-parent inputs cannot satisfy the transfer relation. The prior B1 source-contract defect is closed; no HTTP exploit is inferred from that historical finding.

Work-item full-row/list reads accept resolved staff identity and apply current canonical project reach in the same SQL statement, correlated through the actual attachment/work-item/project relation. Null/nonstaff identities fail closed; dead/archived work items and deleted projects are excluded. Exact parent/workspace narrows the individual read. The individual lookup intentionally admits authorized tombstones for uploader-only idempotent deletion, while list/download retain their respective deleted/ready handling.

Submission list/content reads independently scope both parent arms. Customer direct content requires persisted requester ownership; accepted transfer requires the exact persisted submission-to-item link and customer visibility. Staff direct submission content uses current request-type workspace reach; converted content separately requires accepted state, exact persisted link, live work item/project and current project reach. A forged supplied linked item cannot replace the persisted link. The minimized reach-time attachment query exposes authorization facts rather than filename/objectKey; the initial submission discovery projects needed ownership/state/link/workspace facts rather than formData. Settings, flags and person identifiers remain configuration/bootstrap inputs. No remaining bare-id storage-locator reread was found.

The accepted identity SQL helper is used as reach, not a capability grant: current canonical memberships, workspace seesAll and active instance-admin checks remain in the accepted helper. Route identity comes through resolveCallerIdentity and the stored API-key subset projection. The attachment middleware still passes both deferral options and isApiKey into projectCapabilityRefused: deferred key scope still requires ownerCapable; nondeferred paths require capable. Existing downstream stored-scope checks remain. The candidate does not restore the owner project-capability bypass or invent new authority.

## Transactions, storage, output and side effects

Repository exports await/materialize their statements, retaining transaction executor handles. Extracted pending/deleted guards, parent share/update locks and single-winner activity writes remain. Submission completion locks the persisted submission, derives the accepted parent from its current state/link, and locks the scoped attachment before finalization. Storage size/magic-byte verification and guarded ready update order remain. Rollback cleanup uses only authorizedFinalKey captured from that admitted locked row; it performs no postrollback bare-id/objectKey lookup. A rejected foreign row cannot populate that locator. The captured target remains the same value passed to finalize.

Inspected DTO mapping, list ordering/projections, customer visibility, ready/deleted filters and audit/activity placement. Download still creates its URL, writes the required audit, then redirects; work-item activity stays inside the winning transaction. No additional security regression identified in the extraction or composition.

## Evidence and tests

Personally ran read-only git rev-parse/status, diff stat/numstat and source/diff reads, rg/cat/sed, git diff --check against the accepted base (PASS), live gh pr list --state open and gh issue list --state open (limit 5), and gh pr view 799. Published draft #799 still pointed at 92d0128035d1e2cf5361ad26e00d8fba3a913061 during inspection; this report does not relabel the local reviewed head as published. One contract search used the nonexistent intake.md filename and was corrected via rg --files to actual intake-queue.md; no runtime retry or mutation followed.

No tests, PostgreSQL, Docker, browser, build, full suite or CI execution by this reviewer. Current operator-attributed `attachment799-04bc6edd-focused-pg-result-luna.md` records Python subprocess native returncode 0. Its actual retained `attachment799-04bc6edd-focused-pg.full.log` ends with 5/5 files and 93/93 tests passed, 42.27 seconds. The five files are attachment, duplicate-reach, atomic-conversion and both API-key project-role-clamp suites. This is inspected operator evidence, not my independent reproduction. Prior 89/92, two 91/92, 42f10 92/92, a097 92/93 and the zsh readonly-status wrapper error remain authentic history.

Test-source nonvacuity: reachable work-item filename positive plus real same-workspace-unreached and foreign organisation/project rows; real credential-bearing positive HTTP key request plus empty stored scope and owner-reach denials; both initially populated submission parent arms; persisted project/workspace membership removal with nonempty removal assertions and exact surviving direct rows using a stale identity; real resolved requester and explicitly nonnull distinct foreign customer identity. Current completion/content matrix now calls both actual repository methods: direct and exact accepted transferred positives, a separate hidden row denied, missing/duplicate/same-requester nonaccepted submission, forged/missing transfer link, foreign workspace/requester and null identity controls. The previous valid-transfer-as-negative oracle is corrected without production relaxation. Rollback coverage mocks storage only, preserves the real DB transaction, captures actual randomized finalize target, checks exactly that deletion and pending-row rollback, then checks unauthorized staff completion 404 with no additional deletion. These are meaningful tests of the identified boundaries; the focused run does not establish full candidate-wide runtime coverage.

## Residuals and authority

AT-7 inherited immediate deletion without requester-approved pending action remains separate and UNWAIVED. It is neither implemented nor waived here and prevents whole attachment-feature acceptance. No whole #580, feature, stage, SIT, phase-finalizer, merge-ready or shipping-image claim. Current-main import/composition and exact-head CI, image build/boot/health and applicable browser evidence remain conductor-owned future gates. BROWSER VERIFICATION: BLOCKED (outside this read-only review). Review applies only to the exact source above and does not approve future changes.

Only this new private report written, mode 0600; no source edit, commit, push, PR, merge, database or shared-runtime operation.



## Authentic retained report — attachment799-accepted805-ordinary-luna.md

# Attachment #799 accepted-main composition — ordinary review

**Verdict: CLEAR for the bounded composition/seam review at this exact head.** I found no blocking candidate finding. This review retains, and does not replace, the three prior full ordinary source reviews and the full Sol security review of their respective exact heads. It is not a new full-source review of the attachment implementation.

- **Candidate:** `480e53d8aa62964823213f608d7d38bac0e5ee05`
- **Comparison base:** `f77f89d9a6eb862cbf9d601c7868ca009b04d5e1` (accepted main, merge parent 2)
- **Attachment source parent:** `04bc6edd57d48816f43994f82fbf722d05aa70d7` (merge parent 1)
- **Worktree/branch:** `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2`, `codex/query-ownership-580-attachments`
- **Model/context:** GPT-6 Luna ordinary-review assignment; fresh context `/root/attachment799_accepted805_ordinary_luna`. The platform reports GPT-6 family but exposes no independently verifiable served-variant fingerprint; “Luna” records the assigned review tier.
- **Independence:** I did not author, direct, advise on, or remediate this candidate. I did not spawn subagents.

## Scope and method

Read the full accepted805 composition packet and JSON proof, the full prior `attachment799-04bc-current-full-security-61-sol.md`, prior full ordinary reports A/B/C at `42f10eaa`, and the `04bc` test-delta report. Read the repository `AGENTS.md` (also supplied in the task), agent workflow, `CLAUDE.md`, active mission, current status context, attachments and projects feature specs, query-ownership executor/coding standard, relevant project-creator decision, and related RBAC/realtime contracts. Inspected both merge parents and the actual first-parent import, with focused reads of the extracted project-create and creator-grant repositories/service, create caller, creator lifecycle callers, test delta, and isolated cross-instance test/helper.

Commands personally run (all read-only):

- `git status --short --branch`, `git rev-parse HEAD`, `git show --stat --oneline HEAD`, `git diff --check 04bc... HEAD`.
- `git diff --name-status 04bc... HEAD` and `git diff --unified` over imported project and realtime files; inspected the resulting source and test callsites.
- Read `attachment799-accepted805-composition-proof.json`; independently compared the 16 attachment-owned path blob IDs at `04bc` and `480e53d` with a Python read-only Git script. All 16 matched.
- `git diff --check f77f89d... HEAD`; read-only searches for project repository callsites and check scripts.

Worktree status was clean. No source, tests, refs, services, or shared state were modified. I ran no tests, PostgreSQL, Docker, browser, build, CI, or remote/GitHub checks.

## Composition and seam findings

The merge has the expected two parents. The 16 attachment-owned blobs are byte-identical to `04bc`; the merge introduces no attachment production or attachment test/helper edits. The imported first-parent delta consists of the accepted-main project creation/creator-grant extraction and its coverage, plus the isolated cross-instance WebSocket test/helper and hostname option, and their review records. The supplied proof states every other path matches accepted main and that production attachment code did not change during import; I did not independently hash the complete repository tree against every non-owned path.

I traced the project seam rather than treating import ancestry as approval. `createProjectRow` still opens one transaction, calls repository functions with that transaction executor, and keeps customer-organisation validation, advisory ordering lock, permanent slug claim, project/default-column insertion, default-state seeding, creator grant, and audit/projection on that transaction. The extracted repository functions await and return/materialize their statements; they do not open transactions or return query builders. The same ordering lock remains used by `reorderProjects`. Creator revocation repository predicates scope candidate projects to the supplied workspace (and exact project where applicable); the service locks people and grants, then performs revocation, membership projection, and audit on its caller transaction. The added tests exercise wrong-workspace rejection and transaction rollback of grant, projection, and audit effects. I found no composition seam that bypasses the intended executor or changes project-creation authority.

The imported `createNodeServer` hostname option is optional and only used by the new isolated child helper, which explicitly binds and verifies `127.0.0.1`; it leaves the default server binding unchanged. The cross-instance test uses an owned loopback Valkey container and child API process to exercise real delivery and revocation across processes. I inspected its startup/cleanup paths and retained project-grant reach after workspace-member removal; I did not run it. Its runtime and cleanup claims remain unverified by this review.

No new attachment runtime claim follows from the old 93/93 focused run; that remains evidence for its recorded `04bc` source only. The prior 42f10 full Sol B1 blocker remains authentic historical evidence and is resolved only by the subsequent full Sol CLEAR at exact `04bc` recorded in the packet. That Sol result is not widened into a fresh full current-source Sol review by this composition report. AT-7's pending-action immediate-delete requirement remains separately unwaived and outside this verdict.

## Finding and limits

No blocking or non-blocking semantic composition finding. `git diff --check 04bc...480e53d` reports trailing Markdown hard-break spaces and a blank line at EOF in imported accepted-main review records; the imported lines preserve their documented formatting. The comparison against the second parent has no whitespace diagnostics. This is a record-format observation, not a product-source defect.

This verdict covers only the import/seam scope described above and the exact candidate SHA. It is not another full attachment-source review, full security review, test execution, candidate-wide runtime evidence, hosted CI, image/boot/health, browser verification, merge readiness, AT-7 acceptance, #580 completion, or feature/stage/SIT acceptance. BROWSER VERIFICATION: BLOCKED (outside this read-only composition review).



## Authentic retained report — attachment799-accepted805-security-61-sol.md

# Attachment #799 — accepted805 security composition confirmation

**Reviewed head:** 480e53d8aa62964823213f608d7d38bac0e5ee05

**Comparison base:** f77f89d9a6eb862cbf9d601c7868ca009b04d5e1 (accepted main, second parent)

**Prior full-reviewed source:** 04bc6edd57d48816f43994f82fbf722d05aa70d7 (first parent; prior full-review base 9f736c39d4310cde458d76e561b245619d08c3bd)

**Verdict: CLEAR for this bounded import/security composition confirmation.** No blocking or nonblocking composition finding identified. The prior FULL04bc security clearance remains preserved with its original scope, provenance and exact source. This report adds accepted804/805 seam coverage; it is not a relabelled full-main or new whole-attachment-source review.

## Provenance and independence

Fresh independent context `/root/attachment799_accepted805_security_sol`, dispatched by the conductor as GPT-6.1 Sol security composition reviewer after ordinary composition clearance. The platform identifies this assistant as GPT-6; no independently inspectable served variant/version fingerprint is exposed. The GPT-6.1 Sol label records the assigned dispatch, not an independently measured provider fingerprint. I did not author, direct, advise on, remediate, or ordinarily review this candidate. No child agents used.

Read the complete private accepted805 packet, accepted805 ordinary report, FULL04bc security report and composition-proof JSON. Read canonical AGENTS, workflow, CLAUDE and active mission, current status/decision context, attachments and projects-and-engagements contracts and relevant RBAC creator-grant/key-owner provisions. Source inspection was bounded to the import and its actual attachment authority/fixture/transaction seams. No live GitHub query or mutation was performed under this assignment.

## Independent conservation and semantic inspection

Verified clean worktree `/Users/heinthura/.codex/worktrees/580-attachment-query-extraction/Ticketing.v2` at the exact head above and both expected parents. Independently enumerated complete Git trees using `git ls-tree -rz` in a read-only Python subprocess script. All sixteen owned attachment source/test/note entries match04bc, including mode/type/blob. Every other path in the union of candidate and accepted-main trees matches f77f89d, including additions/deletions and mode/type/blob. This establishes complete tree conservation rather than trusting supplied hashes alone. It does not establish reviewer independence by hash.

Inspected actual imported project-create and project-creator-grant diffs and resulting repositories/service/caller. Customer-organisation validation retains active/noninternal/nondeleted predicates and share lock; workspace ownership validation retains the internal-organisation condition. The orchestrator still opens the single transaction and passes its executor through ordering advisory lock, permanent slug claim, project and column insertion, default-state seeding, creator lock/grant, membership projection and audit. The extracted functions await/materialize their statements; no escaping builder or independent transaction was introduced. Project creator role selection remains workspace/project-scope/key constrained, rejects an untrusted nonsystem same-key row, creates the built-in lead role when needed, skips existing workspace seesAll, and preserves direct project_creator origin. Revocation selects exact workspace projects (and exact supplied project when applicable), locks people before grants, and writes revoke/projection/audit on the caller transaction. Imported wrong-workspace and rollback tests inspect these boundaries. Existing lifecycle callers still supply their transaction/workspace. No import-created authority widening or transaction split was found.

Traced actual attachment fixture callsites: createProjectFixture inserts project rows directly and does not call the imported production project-create function, so the new extraction does not silently inject creator grants into those fixtures. buildTenant and attachment setup explicitly persist project authority through grantProjectRole/grantWorkItemProjectAccess. The canonical customer helper selects and verifies the system organisation customer role, null workspace, exact rank/capability list; customer users/persons/organisation memberships remain distinct from staff and project roles. The duplicate/accepted fixture tests use actual resolved customer identities, positive populated parent arms and explicit nonempty removal assertions; their source is unchanged by the import. No new vacuous fixture/creator-reach seam identified.

Spot-checked retained security boundaries against actual current source, not merely the previous verdict: work-item attachment content still gates staff identity and joins actual attachment/work-item/project with currentProjectReachPredicate in the content SELECT; current helper uses canonical live project membership/workspace seesAll or checked active staff admin. Attachment reach passes both deferral flags plus isApiKey to projectCapabilityRefused, whose deferred-key branch requires ownerCapable. Creator membership is reach and does not replace the stored key scope or owner authority ceiling. Submission completion still requires customer identity matching requester and correlates persisted submission/requester/request-type workspace in both direct and accepted-linked parent EXISTS arms. The transfer arm requires accepted state and the exact persisted workItem link. Captured authorizedFinalKey is populated only after the scoped locked content read, reused for finalize/cleanup, with no rollback bare-id locator read. Download still scopes the row and writes audit before returning the redirect target. Imported804 does not alter these modules or their identity/storage/audit dependencies.

Inspected805's actual optional hostname addition and isolated child/test code. createNodeServer forwards hostname only when supplied, leaving existing default binding unchanged. The new helper explicitly binds and verifies127.0.0.1, and the test starts an owned loopback-bound Valkey and child process, preserves a noncreator direct project membership in its workspace-removal control, and performs bounded owned-child cleanup. The change introduces no attachment runtime configuration or authorization branch. No larger newly coupled semantic security redesign was found requiring expansion beyond this confirmation.

## Actual commands and evidence limits

Personally ran read-only `git status --short`, `git rev-parse HEAD`, `git diff --name-status 04bc6edd HEAD`, project/index/test import diffs, `git diff --check f77f89d9a6eb862cbf9d601c7868ca009b04d5e1 HEAD` (no diagnostics), the complete-tree Python/Git comparison, and cat/sed/rg source, contract and report reads. An initial search used nonexistent projects.md and was corrected through `rg --files` to projects-and-engagements.md. Some combined tool displays were truncated; focused source ranges were subsequently read where needed. No tests, build, PostgreSQL, Docker, browser, CI, service, source/ref or GitHub operation was run or changed. Only this unique private report is written, mode0600.

The old five-file93/93 run belongs to04bc only, as the retained full report states. It is not execution on480e53d and was not independently reproduced here. Original adverse B1 and oracle/PG failures remain authentic historical evidence; this report neither erases nor relabels them. B1's disposition remains the subsequent FULL04bc CLEAR and its preserved scoped repair. Current-candidate runtime, exact required hosted checks, image build/boot/health and applicable browser evidence remain outstanding conductor-owned gates.

AT-7 immediate deletion without requester-approved pending action remains separate and UNWAIVED. This confirmation grants no waiver, downgrade, merge authority, merge readiness, attachment-feature acceptance, #580 completion, stage/finalizer/SIT or release acceptance. BROWSER VERIFICATION: BLOCKED (outside this read-only composition review). Future source changes are not approved.



## Current publication boundary

Reviewed head: `480e53d8aa62964823213f608d7d38bac0e5ee05`

The subsequent publication commit may change only this regular100644 own review note, appending these authentic records to the existing prefix. Per-commit source/tree/byte conservation is verified before push. Exact-head required checks, applicable runtime/image and normal protected expected-head merge remain mandatory; this note supplies no advance merge approval or waiver.


**Reviewed head:** `480e53d8aa62964823213f608d7d38bac0e5ee05`
