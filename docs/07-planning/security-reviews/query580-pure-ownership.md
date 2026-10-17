# Pure declaration ownership — independent source reviews

**Reviewed head:** 3ed3c79eb7c48b8ed97f0dfa3cfc2186c74740e6

**Comparison base:** d61b6037427899f8ad26fdbb1e79fde68a71bdfd

This bounded #580 batch makes three projection objects private, moves five literal Error declarations and the existing grant-closure retry/helper into pure leaves, and updates their callers and contention mocks. Existing retry tests now cover the direct closure Error through recovery and exhaustion. It changes no SQL, callback body, lock, authority, schema, dependency or checker semantics. Remaining direct SQL and whole #580 are unblessed.

The reviewed source normally composes original beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d with accepted records main d61b6037427899f8ad26fdbb1e79fde68a71bdfd. All 21 product paths remain exact beb1; three incoming record paths are disjoint, and every other tree entry matches accepted main. The complete 22,355-byte product patch is identical across the composition. No new product runtime is inferred from the records merge.

Risk-sized review is one strong independent ordinary context plus the further full independent Sol security pass. Both independently confirm the literal ownership change adds no authority or gate semantics. Native configured contexts are GPT-6 Luna/high (session 01a14b77-5c0a-75f0-9eec-8d16c593acba) and GPT-6.1 Sol/high (fresh session 01a14b8c-5c4d-7f53-9575-a260a498b7e3). Configured metadata is not served-weight attestation. Neither reviewer authored, directed or remediated the product source; neither ran runtime checks.

Root verification stays source-bound: API five-config and workspace nine-task typechecks plus three checker tests passed on accepted a472 plus the frozen 21-file patch (the same product bytes); its diagnostic exited1 at 2,782 overlapping instances /142 paths /1,537 locations, zero unresolved export-module, explicit exported-builder or TypeScript-diagnostic rows. It remains red and unwired. Earlier 13 complete PostgreSQL files /280 tests passed on484d plus that patch; those are earlier-input results, not direct current combined-head PG execution. Earlier lint/permissions/OpenAPI likewise retain their original inputs. Exact-publication hosted checks and source-bound image build/boot/health remain mandatory; no release, SIT or completion claim is made here.

These three authentic reports are transported verbatim, preserving the original ordinary report and its append-only provenance clarification. This publication adds only this designated review note; all source bytes and other tree entries remain unchanged. N1, Carrier, #810/#811 and final delivery obligations remain unresolved; no gate is waived.

---

## Original strong independent ordinary review

# Independent ordinary review — #580 pure ownership batch

**Verdict: CLEAR for the ordinary review tier.** I found no blocker in the exact source diff. This is a static source review; it does not clear the separately required GPT-6 Sol security review, candidate CI, or merge gates.

## Provenance and scope

- Candidate: `beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d`.
- Comparison base: accepted `a472c4d5047eb7c71afc37cf9dfe462ea2a5832a`.
- Checkout: `/Users/heinthura/.codex/worktrees/query580-pure-ownership/Ticketing.v2`; HEAD matched the candidate and `git status --short --branch` showed a clean worktree tracking its origin branch.
- Independence: this was a fresh reviewer context with no inherited implementation discussion. I did not author, direct, or remediate the source.
- Model identity: the runtime exposed the GPT-6 family, but no exact Luna/version label. This report does not claim a served GPT-6 Luna attestation.
- I reviewed the complete 21-path diff, all five new error/retry leaves, changed callers and facades, projection references, test changes, repository/query ownership rules, executor contract, accepted #580 decision, identity/IP-22 contracts, and security-scope path list. I did not inspect the moving Carrier source or the primary checkout.

## Findings

No blocking or non-blocking findings.

The code changes are limited to moving existing error classes and retry logic into pure leaf modules, changing two projection constants and one user projection from exported to module-private, updating imports/facades, and adding direct retry-class coverage plus adjusting contention-error test mocks. The removed class/function declarations match the moved implementations by full diff inspection. Query statements, SQL fragments, transaction callbacks, lock order, retry count/recognition, throw identity, and authority logic have no source edits in this diff.

The module graph remains straightforward: identity repositories and retry callers consume the same declarations from `identity/errors.ts`; the extracted retry module imports that same singleton, while the membership facade re-exports it. Notification persistence and outbox code import one declaration from the standalone delivery-error leaf, so there is no duplicate Error constructor or runtime import cycle. I found no remaining in-repository consumer of the three projection constants whose exports became private.

The candidate touches `apps/api/src/database/repositories/notification-delivery.repository.ts`, which is in the required security-review path list. The inspected changes do not alter authorization, tenant reach, identity authority, or a gate's pass/fail semantics. The required security review therefore remains a separate required confirmation at the exact candidate head.

## Commands and test provenance

Static inspection commands run in the candidate worktree:

- `git status --short --branch`
- `git rev-parse HEAD`
- `git rev-parse a472c4d5047eb7c71afc37cf9dfe462ea2a5832a`
- `git diff --stat a472c4d5047eb7c71afc37cf9dfe462ea2a5832a...beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d`
- Full path-scoped and complete `git diff --no-ext-diff --find-renames` / `--unified=0` inspection across the 21 changed paths.
- `rg` searches for every moved error/function/projection symbol and all in-repository consumers.
- `git diff --check a472c4d5047eb7c71afc37cf9dfe462ea2a5832a...beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d` (no output).

No tests, runtime commands, Node/compiler/AST checks, formatting, install, database, Docker, browser, ref, commit, push, PR, or source writes were performed by this reviewer. Test evidence supplied in the task handoff remains root-owned and is not represented as reviewer-run or as approval from this report.


## Provenance clarification (native session metadata)

The allowlisted native metadata confirms session `01a14b77-5c0a-75f0-9eec-8d16c593acba`, provider `openai`, and actual turn context `gpt-6-luna` at `high` effort. The session metadata has no model field. This refines the earlier provenance sentence: the configured platform turn context is observable as GPT-6 Luna/high; it is not a served-weight attestation. I inspected only these allowlisted metadata fields and did not disclose or inspect raw transcript content.

---

## Same independent ordinary context: accepted-main composition

# Ordinary review delta — accepted-main composition of #580 pure ownership

**Verdict: CLEAR.** The exact product patch remains the one previously reviewed and cleared. This composition introduces no additional product changes or ordinary-review findings. The independent full GPT-6 Sol security review and exact candidate gates remain separate requirements.

## Provenance and source

- Candidate source: `3ed3c79eb7c48b8ed97f0dfa3cfc2186c74740e6`.
- Accepted comparison base: `d61b6037427899f8ad26fdbb1e79fde68a71bdfd`.
- Candidate parents, verified from Git: `beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d` and `d61b6037427899f8ad26fdbb1e79fde68a71bdfd`.
- Candidate tree: `f12056906f0feeafb33ad5a4ee10408e942c5bce`, matching the supplied accepted-830 composition receipt.
- This is the same independent reviewer context that cleared `beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d` against `a472c4d5047eb7c71afc37cf9dfe462ea2a5832a`; I did not author, direct, or remediate the product source.
- Allowlisted native metadata confirms session `01a14b77-5c0a-75f0-9eec-8d16c593acba`, provider `openai`, actual turn context `gpt-6-luna` / `high`. This is configured platform turn-context provenance, not a served-weight attestation.

## Composition checks

I read the receipt at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-17/takeover/query580-pure-root/accepted830-composition/receipt.json` and independently checked the commit and tree with Git. The candidate has 3,435 entries; its 21 owned product paths match the original `beb1` source entries, the three accepted record paths are present, and every other tree entry matches accepted main. The three record paths have no overlap with the 21 product paths. Against accepted main, the candidate diff contains exactly those 21 product paths; the three record entries are already on the accepted base.

I independently compared the full binary product patch from `a472c4d5047eb7c71afc37cf9dfe462ea2a5832a...beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d` with the product patch from `d61b6037427899f8ad26fdbb1e79fde68a71bdfd...3ed3c79eb7c48b8ed97f0dfa3cfc2186c74740e6`; they are byte-identical (22,355 bytes). Thus the earlier source review covers the same exact 21-file product patch at this accepted-main composition. The accepted status, queue, and review-record content is on the comparison base and does not alter the source patch.

## Checks and limits

Static commands/checks performed: `git status --short --branch`, `git rev-parse HEAD`, `git show -s --format='%H%n%P%n%T' HEAD`, `git diff --stat` and `--name-status` against the old and accepted bases, tree-entry comparisons using `git ls-tree`, exact binary diff comparison for the 21 owned product paths, and `git diff --check` against both bases. No output indicated whitespace errors.

No tests or runtime commands were run by this reviewer for the composition. This report makes no inherited/current CI, typecheck, checker, PostgreSQL, image, browser, or deployability claim; those remain root-owned evidence bound to their recorded sources. No repository source, refs, commits, pushes, PRs, or product files were changed by this review.

No blocking or non-blocking findings.

---

## Further fresh full independent security review

# Independent full security review — #580 pure ownership source

**Reviewed head:** 3ed3c79eb7c48b8ed97f0dfa3cfc2186c74740e6
**Comparison base:** d61b6037427899f8ad26fdbb1e79fde68a71bdfd
**Model:** GPT-6.1 Sol
**Verdict:** CLEAR for this bounded full security source review. No blocking or non-blocking findings introduced by the candidate were found. This verdict does not establish CI, deployability, runtime acceptance, or completion of #580.

## Independence and provenance

I am the fresh independent security reviewer `/root/pure3ed3_full_security_sol`. I did not author, direct, or remediate the candidate, and did not inherit the author's conversation. My task was a full security pass after ordinary clearance, including independent inspection of the changed source and its security-sensitive consumers; the ordinary conclusion was not used as a substitute for that inspection.

Allowlisted native metadata identifies session `01a14b8c-5c4d-7f53-9575-a260a498b7e3`, provider `openai`, configured turn-context model `gpt-6.1-sol`, effort `high`. This reports observable platform configuration, not served-weight attestation. Only those metadata fields were inspected; raw transcript content was not inspected or published.

The reviewed checkout was `/Users/heinthura/.codex/worktrees/query580-pure-ownership/Ticketing.v2`. Git confirmed the exact head above, parents `beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d` and `d61b6037427899f8ad26fdbb1e79fde68a71bdfd`, and tree `f12056906f0feeafb33ad5a4ee10408e942c5bce`. The worktree remained clean and at that head at the end of inspection.

I read AGENTS.md, agent-workflow.md, CLAUDE.md, the active mission, the latest status/queue and blocked entries, the newest decision-log entries including the #580 D1–D4 decision, coding-standards.md's ownership/executor/scoping contract, monorepo-layout.md, database/executor.ts, the authoritative security path list, identity-provisioning.md IP-22, notification delivery rules NO-8–11, and multi-tenancy.md's query-scoping/404 rules. The review remained static and within the integration-freeze mission.

Ordinary clearance was established by reading both authentic reports in full: `pure-beb1-strong-ordinary-luna.md` (4,276 bytes, SHA256 `cd3cdaaa30850c827b61d8a2010735c0fa28cb04ed0c285ad3198c3acd6a421a`) and the same independent context's composition delta `pure-3ed3-ordinary-composition-luna.md` (3,185 bytes, SHA256 `420ee0dab3378013173da35adce942b88cabd73cae554db222da3b94f3833545`). Their configured native Luna/high provenance and scope remain theirs. This is a separate security context.

## Complete changed surface

I inspected the entire 21-path diff against the accepted comparison base, all moved declarations, imports, facades and test changes:

- `apps/api/src/database/repositories/notification-delivery.repository.ts`
- `apps/api/src/identity/errors.ts`
- `apps/api/src/identity/grant-closure-retry.ts`
- `apps/api/src/identity/membership-projection.ts`
- `apps/api/src/identity/oidc-login.ts`
- `apps/api/src/identity/repository.ts`
- `apps/api/src/identity/scim-group-sync.ts`
- `apps/api/src/instance/users/repository.ts`
- `apps/api/src/notification/delivery-errors.ts`
- `apps/api/src/notification/outbox-drain.ts`
- `apps/api/src/service-calendar/errors.ts`
- `apps/api/src/service-calendar/index.ts`
- `apps/api/src/service-calendar/repository.ts`
- `apps/api/src/sla-policy/errors.ts`
- `apps/api/src/sla-policy/index.ts`
- `apps/api/src/sla-policy/repository.ts`
- `tests/api-integration/helpers/notification-outbox-suite.ts`
- `tests/api-integration/instance-users-guards.test.ts`
- `tests/api-integration/notification-outbox-delivery-ahead-of-utc.test.ts`
- `tests/api-integration/notification-outbox-delivery-behind-utc.test.ts`
- `tests/api-integration/notification-outbox-delivery.test.ts`

I also traced the eleven production `retryIdentityGrantClosure` call sites: pending-action user deactivation; identity connection configuration; SCIM administration; the SCIM lifecycle wrapper; SCIM active-state, PUT and PATCH operations; OIDC mapping create/update; SCIM group writes; and OIDC sign-in. I inspected the actual relevant callbacks and their SQL, transaction/lock, authority, source/tenant predicates and post-commit boundaries, including the grant-closure revalidation and group-write throw sites. Calendar/SLA conflict throw/catch paths, workspace reach and conflict responses, notification reservation acquisition and the complete drain, and the namespace-import consumer of identity/repository were checked directly.

## Security assessment

1. **One constructor per error, with conserved prototypes and fields.** Each of the five moved Error classes has exactly one source declaration. Constructors, superclass, messages, names where originally assigned, readonly status/code/version fields and the notification `retryable = true` field are preserved. Neither a facade nor a caller defines a substitute class. Identity repository and retry helper resolve `IdentityGrantClosureChangedError` to the same `identity/errors.ts`; membership-projection re-exports that binding. SCIM repository throws the same `ScimGroupWriteError` re-exported by scim-group-sync and caught by scim-protocol. Notification persistence, drain, integration helper and three hoisted mock factories all resolve to one `notification/delivery-errors.ts` binding. Calendar/SLA repositories and routes similarly share their error leaf. No stale caller of a removed repository error/function export or private projection was found. No new prototype manipulation, side effect or duplicate `instanceof` identity was introduced.

2. **Retry semantics and transaction placement are unchanged.** `databaseErrorCode` still examines at most five objects, accepts only the same uppercase five-character SQLSTATE shape, follows the same cause chain, and recognizes the same first valid code. The retry helper still invokes `work` at most three times, retries the same direct closure Error or SQLSTATE set (`40P01`, `40001`, `23503`, `23505`), and rethrows the same final error instance. A wrapped closure Error with no matching SQLSTATE is not newly recognized. Every existing production call still creates its transaction inside `work`, so a retry requests the existing whole transaction rather than resuming a partially committed callback. The helper has no new database, clock, configuration, authority or network access. The direct class success/exhaustion assertions use the same instance and assert three attempts; existing wrapped-driver and unrelated-error assertions remain. These tests were inspected, not executed by me.

3. **Authority, tenancy and IP-22 operations are conserved.** OIDC still locks/revalidates connection and identity state, checks portal/organisation/source/role constraints, writes external grants with `seesAll: false`, reprojects and invalidates after the transaction. SCIM keeps same-connection group/member restrictions, locked authority verification, source/mapping/lifecycle re-reads and closure-change throws. Administration and pending-action consumers retain their current proof/CAS/session/last-admin checks and lifecycle/advisory locking positions. No query, SQL fragment, predicate, lock order, callback body, audit/outbox operation, return value or post-commit publication is changed by this patch. This is conservation of the existing mechanisms; it does not certify that all inherited authorization or concurrency code is free of defects.

4. **Notification contention remains fail-closed.** I read the full reservation repository and drain. The separate six-cycle row-acquisition budget remains distinct from six provider attempts. Exhaustion still throws the shared contention class; the drain recognizes it, backs off without consuming an attempt and returns before provider authorization/I/O. Delivery-first locking, tuple collision checks, random token/owner fences, post-lock database clock sampling, recent-success exclusion of the same child, pre-provider eligibility/reach recheck and durable attempt authorization are unchanged. Provider calls remain outside the authorization transaction; renewal/completion paths are unchanged. The three hoisted mocks dynamically import the pure error leaf after importing the original repository, preserving the same Error identity without accessing a removed mock export.

5. **Conflict handling and module graph do not acquire authority.** Calendar and SLA routes still check workspace reach and return the same 409 fields for the same repository-thrown version errors. Making `connectionProjection`, `scimUserProjection` and `userDirectoryProjection` private changes only their export visibility; their contents and all selects remain unchanged. The four error leaves have no imports. The retry leaf imports only identity/errors. Existing membership/scim facades retain persistence exports but re-export the pure bindings directly. Thus the newly introduced dependency edges terminate at pure leaves and add no runtime cycle or database/secret/configuration initialization. No dependency, schema, route policy, environment variable, security checker or gate semantics changed.

The diff touches mandatory security-scope paths, including notification persistence and the two route index files. This full pass satisfies the requested review depth for the bounded ownership change. Its actual semantics do not require escalating the ordinary panel to an auth/permissions redesign tier: it relocates literal declarations and imports while preserving authority and control flow. The existing strong ordinary context plus this independent full security context remain distinct roles.

## Independent static conservation checks

Beyond reading the diff, I performed plain-text/byte comparisons with Git and Python; no TypeScript/AST or product code was executed:

- Every moved class declaration matched its old literal declaration; the retry/helper implementation matched the removed source literally.
- After excluding only inspected import declarations, the extracted declaration spans, and the three changed `export` keywords, every remaining byte of the nine changed existing production modules matched the accepted base. The two small facades were inspected in full separately. This independently binds unchanged SQL, callbacks, locks and authority code rather than inferring conservation from a title or summary.
- The complete binary diff from `a472c4d5047eb7c71afc37cf9dfe462ea2a5832a` to `beb1c5eff2b1168b1e3ed01ec54d21454c22bf5d` is byte-identical to the diff from the stated accepted base to the reviewed head: 22,355 bytes, SHA256 `9b3732b270560fa1100a57ab78d7089bbc80174d50bbadc62d63c55eaede2800`.
- Independently compared all 3,435 Git tree entries with the composition receipt: all 21 owned paths exactly match beb1; all other candidate entries exactly match accepted d61b. The accepted incoming records are disjoint from the product paths. No incoming product behavior is hidden by the merge.
- `git diff --check <base> <head>` produced no output. `git status --short` was empty and `git rev-parse HEAD` matched the reviewed head at completion.

The first plain-text comparison attempt stopped on a reviewer-script whitespace reconstruction assertion before producing any conservation claim. I corrected that string reconstruction and the complete comparison then passed. This was a static inspection helper mistake, not a product test failure or source modification.

Other inspection commands were `git diff --stat/--name-only/--no-ext-diff/--no-renames`, `git show`, `git ls-tree`, `rg`, `sed`, `cat`, and allowlisted metadata extraction. Live `gh pr list --state open` was read. `gh pr view 580` correctly failed because #580 is an issue, not a PR; no PR/check clearance is inferred from it.

## Findings, retained residuals and execution limits

**Blocking findings introduced by this candidate:** none.

**Non-blocking findings introduced by this candidate:** none.

The eleven existing retry call sites are not newly made compliant with D1. Direct SQL remaining in non-repository callbacks/services is still unfinished #580 work, with no baseline, exemption or blessing from this report. Moving the retry callback's owner into a leaf does not move its SQL. The diagnostic checker remains red and unwired. Existing pending-action N1 and the separately recorded lock/concurrency concerns remain unresolved and unwaived; no reproduction or clearance of them is claimed here.

**Reviewer-run tests:** none. This was deliberately static only: no Node, compiler, AST runner, tests, formatter, install, runtime, database, Docker or browser work. No repository source, records, refs, commits, pushes, PRs or children were created or changed. Only this private report was created outside the checkout.

Root-supplied typecheck/checker and diagnostic evidence belongs to its recorded inputs and execution provenance, not this review. The supplied earlier 13 PostgreSQL files/280 tests ran on an earlier source with the frozen patch, not as direct current combined-head PostgreSQL execution. Earlier lint, permissions and OpenAPI results likewise retain their old inputs. I have not treated any supplied counts as reviewer execution or as current hosted/image proof. Required hosted checks and candidate image/build/boot/health evidence on the eventual exact publication remain separate conductor gates. This report authorizes no merge, gate waiver, release, stage closure, #580 completion or SIT acceptance.


**Reviewed head:** `3ed3c79eb7c48b8ed97f0dfa3cfc2186c74740e6`

