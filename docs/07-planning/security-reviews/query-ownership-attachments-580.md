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
