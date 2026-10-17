# Query ownership shorthand-member repair — authentic review records

**Reviewed head:** c54d265092e682c7ca1bbad6984965f363a00ffd

The bounded candidate adds only TypeScript ShorthandPropertyAssignment to the existing exported-member declaration filter, plus regression fixtures. No activation, exemption, source-query conversion or whole-#580 acceptance is claimed.

The original source19c7e9f661f48815d38219ea416db76163221d93 received one strong independent ordinary review and full independent Sol security review. Accepted main d924594290cf0317150c5c9cdd0a746bc0595202 was merged normally; both independent contexts separately cleared the exact c54d composition. Their original and delta reports follow verbatim. These are TWO independent contexts continuing their own deltas, not four reviewers. The author and conductor are neither reviewer.

Native platform turn_context metadata corroborates author /root/remaining580_type_boundary_plan_luna (session01a14a9d-3c92-73e3-8a6a-e0db3e1d07e9), gpt-6-luna/medium; ordinary /root/shorthand19c7_ordinary_luna (session01a14ade-21a3-7be3-b670-25f02d99e753), gpt-6-luna/high; security /root/shorthand19c7_security_sol (session01a14adf-90b2-7f81-8ae2-1983819f98c0), gpt-6.1-sol/high. Provider openai, distinct fresh initial contexts without inherited author conversation, parent conductor session01a14000-d9e0-7bb1-b3fd-2c0204a4834c. session_meta supplies identity/provider/spawn relationship, not a model field. The ordinary original's generic GPT-6 self-description remains untouched; native metadata separately identifies its actual model. No hidden serving fingerprint or cryptographic attestation is claimed.

Root verified genuine RED before the fix, GREEN3/3 after it and GREEN3/3 at exact c54d. The current built-dependency inventory remains red:2794 overlapping diagnostic instances/154paths/1549path-line locations,12 unresolved modules,0explicit builder rows,0TS diagnostic rows. Counts are not unique queries or query-migration progress. An earlier unbuilt-dependency capture is incomparable and retained. Pending-action N1 is unresolved and unwaived. All required hosted checks must still be green on the exact publication. Release/SIT/recovery/audit and whole580 remain incomplete.


## Original ordinary report

# Ordinary review — #580 shorthand repository output members

**Mode:** Integration Freeze acceptance repair; bounded ordinary review only.
**Model:** GPT-6 (the platform exposes no more specific model/version identifier in this context).
**Role/context:** Strong ordinary reviewer, `/root/shorthand19c7_ordinary_luna`.
**Reviewed head:** `19c7e9f661f48815d38219ea416db76163221d93`.
**Comparison base:** accepted `origin/main` `17b877c31136a89ef55ee872249fb7f1ce6d4813`; verified merge base matches.
**Checkout:** `/Users/heinthura/.codex/worktrees/query580-shorthand-member/Ticketing.v2`.
**Independence:** I did not author, direct, or remediate this candidate. This is a fresh independent context. I made no source edits, Git writes, commits, pushes, or PR changes.

**Verdict: CLEAR for this bounded candidate.** The checker fix and focused regression coverage address the shorthand-member blind spot without weakening the existing fail-closed type-boundary checks. No blocking or non-blocking code finding identified in this delta. This verdict does not accept the whole #580 unit, activate `check:queries`, or claim integration completion. A fresh full GPT-6 Sol security review remains required by the assigned review sequence.

## Scope inspected

- Confirmed the worktree was clean at the reviewed SHA and `origin/main` resolved to the stated comparison base.
- Inspected the complete base-to-head diff: exactly two paths, one added checker line in `scripts/ci/check-queries.mjs` and 61 added test lines in `scripts/ci/check-queries.test.mjs` (62 insertions total).
- Read the full `exportedQueryBoundary` member traversal and its surrounding handling for query builders, SQL fragments, unions/intersections, Promise type arguments/awaited results, signatures, `any`/`unknown`, and exported members.
- Read the relevant regression fixture and assertions for a materialized DTO with shorthand members and an intersection contract; shorthand members carrying nested query builders in objects and arrays; and shorthand `unknown` and `any` values.
- Read the accepted query ownership contract in `monorepo-layout.md` and `multi-tenancy.md`, the 2026-10-15 #580 implementation-decision entry, the Integration Freeze mission, the workflow review requirements, and the relevant existing #580 task review record.
- Read the supplied native test and inventory receipts as operator evidence. I did not execute those commands or independently reproduce their outputs.

## Assessment

The previous member walk only admitted recognized declaration kinds before obtaining a member’s resolved type. TypeScript can expose an object-literal shorthand property as `ShorthandPropertyAssignment`; omitting that kind made the walk return `member-declaration-unavailable`, so an ordinary materialized DTO could be rejected despite containing no live builder.

The one-line addition admits that declaration kind into the existing visibility and member-type path. It does not classify shorthand values as safe. The checker still resolves the symbol type with `getTypeOfSymbolAtLocation` and recursively visits it. Consequently the added negative fixtures exercise the important boundary: a builder hidden under shorthand object/array members remains rejected, while shorthand members resolving to `unknown` or `any` still produce unresolved findings at the member path. The positive fixture checks an awaited selected-ID DTO whose `reachFacts` and literal `source` members use shorthand syntax and whose declared output is an intersection. This is aligned with the existing type-walk design and does not create a path-specific or spelling-based exemption.

This gate enforces repository query ownership only. The accepted tenancy contract explicitly assigns identity-derived predicate correctness to scoped repository functions; this change makes no broader tenant-scope proof claim.

## Evidence read (not run by this reviewer)

The supplied source-bound receipts report:

- Before-fix focused test: `node --test scripts/ci/check-queries.test.mjs`, native exit 1, with the new valid DTO assertion as the regression; input hashes were conserved.
- After-fix focused test: same command, native exit 0; the native receipt records `HEAD` as base SHA `17b877c31136a89ef55ee872249fb7f1ce6d4813`, with candidate worktree input hashes `3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244` (checker) and `bd840e80148c9699f9923f38bf6628512417692f2f37eed06f9141768c8805d5` (test). I independently compared those hashes with the exact frozen candidate tree; both match. The receipt says inputs/status were conserved.
- Frozen candidate commit receipt: exact head `19c7e9f661f48815d38219ea416db76163221d93`, clean status, 1 checker line and 61 test lines added; commit-time Biome reported two files checked and no fixes.
- Actual inventory receipt: `node scripts/ci/check-queries.mjs` exited 1 on the base source with `diagnosticOnly: true` and `activation: false`. The assigned task reports that the checker remains red for genuine unrelated existing queries/types. No activation or full #580 acceptance is evidenced by this receipt.

I ran no tests, Node commands, compiler/typecheck, build, Docker, formatter, browser, or runtime probe. Static commands used by me were read-only Git inspection (`pwd`, `git status --short`, `git rev-parse`, `git diff --stat`, `git diff --no-ext-diff --unified=80`), source/document reads (`git show`, `sed`, `rg`), and evidence-file reads (`find`, `cat`).

## Findings and residuals

**Blocking:** none.

**Non-blocking findings:** none in the reviewed delta.

**Residuals / not done:** This review covers only the shorthand-member repair. The checker’s actual repository inventory still has unrelated findings and remains unactivated; the supplied diagnostic receipt is red. No CI status, hosted result, whole-#580 completion, runtime acceptance, or merge readiness is claimed. A root-owned focused runtime/test probe may be useful if the conductor needs additional evidence, but the supplied red/green test receipts already establish the bounded regression; I recommend no further runtime probe for this narrow fix before the required Sol pass.

**Verdict:** CLEAR for ordinary review of exact head `19c7e9f661f48815d38219ea416db76163221d93` against `17b877c31136a89ef55ee872249fb7f1ce6d4813`, within the scope stated above.


## Original full security report

# Full independent security review — #580 shorthand output members

**Model:** GPT-6.1 Sol (`gpt-6.1-sol`), reasoning `high`, provider `openai`.
**Model provenance:** The system description visible within this context says GPT-6. The conductor supplied a bounded native platform metadata receipt, `shorthand19c7-native-provenance-initial.json`, which I read: it records this context's actual `turn_context` pair as `gpt-6.1-sol/high`, session `01a14adf-90b2-7f81-8ae2-1983819f98c0`, agent path `/root/shorthand19c7_security_sol`, fresh child of conductor session `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`. This is platform metadata corroboration, not a claim about hidden serving infrastructure or cryptographic attestation.
**Role/context:** Fresh independent full security reviewer, `/root/shorthand19c7_security_sol`.
**Mode:** Integration Freeze; bounded CI-gate acceptance repair.
**Reviewed head:** 19c7e9f661f48815d38219ea416db76163221d93
**Comparison base:** `17b877c31136a89ef55ee872249fb7f1ce6d4813` (accepted base supplied by conductor; local `origin/main` and merge base both match).
**Checkout:** `/Users/heinthura/.codex/worktrees/query580-shorthand-member/Ticketing.v2`.
**Independence:** I did not author, direct, or remediate this candidate. I reviewed after reading the prior ordinary CLEAR report. I made no source changes, Git writes, commits, pushes, PR mutations, or product/runtime probes. Only this private review report was written.

**Verdict: CLEAR for full security review of this bounded exact-head candidate.** No blocking or non-blocking security finding identified in the delta. This verdict does not activate the checker, clear the remaining query inventory, accept all of #580, establish current hosted gates, or declare merge readiness.

## Scope and authority checked

I read the accepted checkout's AGENTS.md, active mission, canonical agent workflow including review counts/model policy/evidence reuse, provider adapter, query-ownership section of coding standards, relevant monorepo repository convention, multi-tenancy query scoping, security-model query contract, CI/CD security-review trigger, Definition of Done levels, relevant current queue/status and query-ownership decision-log entries. The complete candidate diff changes only two CI checker files; policy/specification documents are unchanged from the stated base.

The risk tier is the workflow's bounded CI/gate fix affecting one narrow pass/fail case: one strong independent ordinary review followed by a full independent Sol-tier security pass. `scripts/ci/**` is explicitly security scope. I read the authentic `shorthand19c7-ordinary-luna.md` CLEAR in full. Its original self-label is generic GPT-6; the separate native provenance receipt records that ordinary context as `gpt-6-luna/high`. I did not edit or relabel its report.

I inspected the complete base-to-head diff and the whole checker, with particular attention to the full exported-type walk, builder and SQL-fragment classification, visibility, imported/public members, unions/intersections, generic arguments and awaited results, callable/constructor results, indexes, export aliases/namespaces, unresolved types and inspection limits. I also read the complete test file and all added fixtures/assertions, plus the supplied native test, commit and inventory receipts.

## Security assessment

The production change adds only `ts.SyntaxKind.ShorthandPropertyAssignment` to the existing member-declaration-kind filter at the repository's public output boundary. Before this fix a compiler-recognized shorthand member could produce `member-declaration-unavailable`, rejecting an already materialized DTO. The fix admits that declaration form to the same visibility resolution and symbol-type recursion used by explicit property assignments. It does not return `safe` for shorthand syntax, skip the member's value, or trust a property name.

I traced the adversarial cases enabled by that change:

- A shorthand member containing a pending Drizzle statement reaches `getTypeOfSymbolAtLocation` and recursive `exportedQueryBoundary`. Executable builder families are classified before the SQL-fragment leaf and before traversal limits/visited-node handling, so shorthand does not make a builder an opaque permitted SQL fragment.
- Nested shorthand object members follow the same public-property graph. Array members also follow generic element arguments. The added object and array fixtures require the specific `exposes a query builder` rejection, which cannot be satisfied merely by a TypeScript semantic error or an unresolved-declaration diagnostic.
- Shorthand `unknown` and `any` retain unresolved results at the exact member path. The added assertions require their respective `unknown-type` and `any-type` reasons; they do not accept an arbitrary failure as proof.
- The positive fixture awaits the selected-ID query through `Promise.all`, constructs an ID/reach-facts DTO with shorthand fields and an intersection `satisfies` contract, and requires no diagnostic for that file. That assertion also excludes semantic/parse failures masquerading as a successful materialized result.

The existing full walk still rejects missing/error/any/unknown and unproven type-parameter outputs; traverses every union/intersection constituent, generic payload, awaited output, callable/constructor return, public member and index value; and propagates unresolved visibility/type lookups. Private/protected filtering is unchanged. A shorthand object-literal property is a public declaration and now receives the ordinary member inspection rather than an exemption.

Depth 20 and 512-node/type-export inspection bounds remain unchanged and fail closed. The addition can cause a formerly rejected graph to be inspected further, but that work remains bounded. TypeScript syntax/semantic diagnostic handling, missing project/source failure, runtime export enumeration/alias failures and zero-source refusal remain unchanged. Query construction detection, Drizzle/pg aliases, call/apply/bind handling, raw SQL detection and the permitted empty transaction orchestration path are unchanged. The exact 14 persistence-infrastructure paths and repository-name rules are unchanged; there is no per-site allowlist, wildcard expansion, baseline, exception or activation change.

No application route, permission, tenancy predicate, secret handling, dependency, executor, transaction ordering or deployment authority changes in this candidate. The accepted contract distinguishes structural ownership from tenant-predicate correctness: this checker does not prove authorized caller reach. Nothing in this verdict converts it into such a proof.

## Evidence read versus commands executed

I executed read-only static inspection commands only: `pwd`, `git status --short`, `git rev-parse`, `git merge-base`, `git diff` (complete diff and numstat), `cat`, `sed`, `rg`/`rg --files`, and `shasum -a 256`. I then used a shell heredoc with restrictive umask and noclobber to write this private report. No tests, Node execution, compiler, typecheck, build, Docker, formatter, browser, database or runtime probe was run by me. One static `rg` named nonexistent `scripts/ci/test.mjs` and reported that missing path; it was a source-search error, not a test result.

Direct static checks found a clean checkout at the exact head, the stated merge base, exactly one checker insertion and 61 test insertions, and these source hashes matching the supplied green-run input hashes:

- Checker: `3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244`.
- Test: `bd840e80148c9699f9923f38bf6628512417692f2f37eed06f9141768c8805d5`.

The following are conductor-run receipts I read, not independent reproductions:

- `query580-shorthand-root/red/{native-receipt.json,stdout.log}`: `node --test scripts/ci/check-queries.test.mjs`, native exit 1, 3 tests / 2 pass / 1 fail / zero skip or cancellation. The actual failure is the new materialized shorthand DTO assertion. Before/after input hashes were conserved.
- `query580-shorthand-root/green-first/{native-receipt.json,stdout.log}`: same command, native exit 0, 3 pass / zero fail, skip or cancellation. The receipt was captured while Git HEAD still named the base and the candidate changes were uncommitted; the exact frozen candidate files independently match its recorded input hashes. I do not relabel that receipt as having run under committed HEAD 19c7.
- `query580-shorthand-root/source-commit-native.json`: commit 19c7, clean status, 62 insertions in two files, commit-time Biome checked two files with no fixes.
- `query580-shorthand-root/inventory/{native-receipt.json,parsed-summary.json}`: diagnostic-only native exit 1, activation false, 1,779 overlapping diagnostic instances, five unresolved module rows plus one explicit builder module row. The summary explicitly states the new worktree's dependency build outputs were not built before capture. This is not comparable to the earlier built-worktree 2,799 inventory and proves no migration-progress reduction. I did not read every line of its 299,199-byte raw stderr or validate a whole-repository census.

The existing and added tests plus source tracing suffice for this bounded review; I request no additional root runtime probe. That does not replace any required full CI or integration gate.

## Findings, residuals and limits

**Blocking findings:** none in this candidate.

**Non-blocking findings:** none in this candidate.

**Residuals:** Existing genuine query/type-boundary findings remain. Dependency-build-comparable whole-source inventory is outstanding and owned by the conductor. `check:queries` remains unwired; the static workflow search still describes it as an absent planned job. This review covers the shorthand repair and the surrounding security mechanism needed to assess its effect, not a new exhaustive audit of all API query predicates or all inherited checker limitations. No HTTP exploit, tenant-scope proof, product runtime acceptance, whole-#580 completion, stage closure or merge-readiness claim is made.

**Final verdict:** CLEAR — full independent security review of `19c7e9f661f48815d38219ea416db76163221d93` against `17b877c31136a89ef55ee872249fb7f1ce6d4813`, within the bounded scope above.


## Accepted-main ordinary delta report

# Ordinary delta review — #580 shorthand checker on accepted main

**Mode:** Integration Freeze; bounded accepted-main composition delta review.
**Model:** GPT-6 Luna, reasoning effort high (as reported by the native review assignment receipt).
**Role/context:** Fresh ordinary delta reviewer, `/root/shorthand19c7_ordinary_luna`.
**Exact reviewed head:** `c54d265092e682c7ca1bbad6984965f363a00ffd`.
**Comparison sources:** prior reviewed candidate `19c7e9f661f48815d38219ea416db76163221d93`; accepted main parent `d924594290cf0317150c5c9cdd0a746bc0595202`.
**Parents:** `19c7e9f661f48815d38219ea416db76163221d93`, `d924594290cf0317150c5c9cdd0a746bc0595202`.
**Checkout:** `/Users/heinthura/.codex/worktrees/query580-shorthand-member/Ticketing.v2`.
**Independence:** I did not author, direct, or remediate this composition. I reviewed the exact current merge and delta independently. No source edits, commits, pushes, or PR changes were made.

**Verdict: CLEAR for the exact accepted-main composition and the original shorthand checker scope.** The composition preserves the previously reviewed checker/test blobs and adds the accepted-main helper materialization change and its original review record. The helper awaits the same advisory-lock statement; all four callers already await it. I found no blocking or non-blocking issue in this delta. This is not whole-#580 acceptance, activation, runtime acceptance, or merge-readiness for any later candidate. A fresh full Sol delta review remains required by the assigned sequence.

## Scope checked

- Verified clean worktree, exact HEAD, both parent SHAs, and accepted `origin/main` at `d924594290cf0317150c5c9cdd0a746bc0595202`.
- Read the native composition receipt. It records the corrected two-parent composition, clean status, and checker/test blob conservation. The first merge commit message was rejected by the commit-msg hook; the existing staged merge was then completed with the accepted `chore` type, without bypass, abort, or history rewrite.
- Compared `19c7e9f661f48815d38219ea416db76163221d93..c54d265092e682c7ca1bbad6984965f363a00ffd`: exactly two paths changed, `apps/api/src/instance/users/repository.ts` (4 additions, 2 deletions) and the new 85-line admin-lock review record.
- Compared accepted main `d924594290cf0317150c5c9cdd0a746bc0595202..c54d265092e682c7ca1bbad6984965f363a00ffd`: exactly the original checker and checker-test paths differ. The actual diff is the previously reviewed one-line `ShorthandPropertyAssignment` addition plus the 61 regression lines. The composition receipt confirms the reviewed checker/test blobs were conserved.
- Read the complete six-line helper source delta and all four call sites: three in `apps/api/src/instance/users/index.ts`, one in `apps/api/src/pending-action/service.ts`. Each call already awaits `lockInstanceAdminSerialization`.
- Read the added admin-lock review record to confirm it identifies the source SHA it covers (`34c7c3aae014af407491fd137ffba077c2aa93ad`) and does not represent that older review as coverage of the current composition. Its retained N1 and whole-#580 limits remain explicit.
- Continued the original review’s accepted query ownership contract, checker algorithm, and regression assessment without repeating the full initial review. The prior report remains unchanged.

## Assessment

The merge composition keeps the original shorthand fix intact: the checker now recognizes shorthand object members as declarations and still recurses through the type checker to evaluate their resolved type. The positive materialized DTO and negative nested-builder, `unknown`, and `any` fixtures are byte-for-byte preserved from the reviewed head. Therefore this composition does not add a new exemption or change the behavior previously cleared by ordinary review.

The accepted-main helper change changes `lockInstanceAdminSerialization` to `async`, awaits the same `executor.execute` statement (`SELECT pg_advisory_xact_lock(2026)`), and returns `Promise<void>`. It does not change SQL, key, executor, transaction boundary, or call order. All four consumers already use `await`, so they continue waiting for lock acquisition before subsequent work; statement rejection still rejects the transaction callback. The change materializes the statement result at the repository boundary and does not alter authority or gate semantics. The review record is appropriately source-bound and retains the prior N1 limitation.

## Tests and verification

I read the unchanged checker regression coverage and the root’s source-composition receipt. I ran no tests, Node commands, typecheck/compiler, build, formatter, inventory checker, Docker, browser, or runtime probe. The conductor owns current-head focused tests and inventory execution, which this report does not preempt or claim.

The accepted-main merge itself is recorded as protected PR #825 at `d924594290cf0317150c5c9cdd0a746bc0595202`, with 18 required checks green per the assignment. I did not independently query GitHub or re-run those checks; this is accepted-main context, not a new check result for `c54d265`.

## Findings and limits

**Blocking:** none.

**Non-blocking findings:** none in the composition delta.

**Residuals / not done:** The actual checker inventory remains a separate diagnostic and is not accepted or activated by this review. The helper review record retains unresolved N1, which this composition does not change. No whole-#580 completion, hosted status on `c54d265`, image/runtime, SIT, release, or merge-readiness claim is made.

**Verdict:** CLEAR for the exact composition `c54d265092e682c7ca1bbad6984965f363a00ffd`, comparing the prior reviewed candidate `19c7e9f661f48815d38219ea416db76163221d93` and accepted main `d924594290cf0317150c5c9cdd0a746bc0595202`.


## Accepted-main full security delta report

# Full independent Sol security delta review — #580 accepted-main composition

**Model:** GPT-6.1 Sol (`gpt-6.1-sol`), reasoning `high`, provider `openai`.
**Provenance/context:** `/root/shorthand19c7_security_sol`, session `01a14adf-90b2-7f81-8ae2-1983819f98c0`. The native platform receipt `shorthand19c7-native-provenance-initial.json`, read in my initial review, corroborates that actual model/context. This is the same independent reviewer continuing a bounded delta review, not a second independent context or a claim about hidden serving infrastructure.
**Mode:** Integration Freeze; accepted-main composition of the bounded checker repair.
**Reviewed head:** c54d265092e682c7ca1bbad6984965f363a00ffd
**Prior reviewed candidate:** `19c7e9f661f48815d38219ea416db76163221d93`.
**Accepted-main parent/base:** `d924594290cf0317150c5c9cdd0a746bc0595202`.
**Actual parents:** prior candidate 19c7, then accepted main d924, in that order.
**Checkout:** `/Users/heinthura/.codex/worktrees/query580-shorthand-member/Ticketing.v2`.
**Independence:** I did not author, direct or remediate either the shorthand candidate or this composition. The conductor performed the merge. I made no repository changes, commits, pushes, PR mutations or runtime probes. Only this separate private report was written. I reviewed after reading `shorthandc54d-ordinary-delta-luna.md`, whose exact-head ordinary verdict is CLEAR.

**Verdict: CLEAR — full security delta review for exact c54d.** My original full security CLEAR for the unchanged shorthand checker/test scope continues; the accepted-main import and its interaction with that checker are clear at this exact composition. No blocking or new non-blocking security finding identified. This does not declare hosted gates green, merge readiness, checker activation or all of #580 accepted.

## Actual scope and conservation

I directly inspected clean status, exact HEAD/parents, the complete prior-candidate-to-current diff, the accepted-main-to-current diff and file identities. From 19c7 the only changes are the six-line helper transformation in `apps/api/src/instance/users/repository.ts` (four additions/two deletions) and its 85-line authentic review note. From accepted d924 the only changes are the original checker addition and 61 regression-test lines. No policy, dependency, build or workflow configuration is changed by this composition.

The checker/test SHA-256 values remain exactly those recorded and reviewed at 19c7:

- `scripts/ci/check-queries.mjs`: `3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244`.
- `scripts/ci/check-queries.test.mjs`: `bd840e80148c9699f9923f38bf6628512417692f2f37eed06f9141768c8805d5`.

I carry forward the full initial review in `shorthand19c7-security-sol.md`, including its builder/SQL classification, public-member visibility and type recursion, fail-closed unresolved types, bounds, export traversal and test assessment. I did not repeat that unchanged whole-file audit. No added shorthand declaration form has become an exemption through this composition.

## Full security assessment of the imported delta

I read the helper delta, its complete imported review record, all four callers with transaction context, `Executor`, the relevant God Mode lock contract, and installed Drizzle `execute`, `PgRaw` and `QueryPromise` declarations/implementation. The accepted query-ownership contract and review/evidence policy remain those read for the original pass; the complete diff proves they did not change.

The helper now returns `Promise<void>` and awaits exactly `executor.execute(sql`SELECT pg_advisory_xact_lock(2026)`)`. Previously it returned the query thenable. Drizzle `execute` constructs `PgRaw` around `prepared.execute`; `PgRaw` extends `QueryPromise`, whose `then` invokes `execute`. The new helper therefore waits for the statement before resolving and propagates rejection rather than swallowing it. It does not open/commit/rollback a transaction or substitute a connection. Discarding the query result is appropriate because no caller uses it.

The complete source search finds four calls, all already awaited: suspend, sign-out and deactivate in `instance/users/index.ts`, and pending-action approval execution in `pending-action/service.ts`. Each passes its existing transaction handle. Lock acquisition still completes before subsequent work, including the existing user/admin checks and lifecycle locks where present. No call position, SQL/key, authorization check, transaction lifetime or lock order changes. This preserves the God Mode contract requiring shared key-2026 serialization for administrator-reducing operations. The inherited pending-action N1 lock-order availability/deadlock residual is neither repaired nor waived.

This import removes an exported live query-like result by materializing the same statement. The unchanged checker now sees a concrete `Promise<void>` boundary while retaining all original rejection rules. This is compatible with the shorthand fix, with no additional path exception, baseline or visibility exemption. There is no route, capability, tenancy scope, secret or release-authority expansion.

The imported review note binds its original reports to source `34c7c3aae014af407491fd137ffba077c2aa93ad` and base 17b877. It explicitly retains N1 and unwired/whole-#580 limits; it does not misrepresent its historical reports as current composition review. Its actual review/evidence provenance remains separate from this report.

## Commands and evidence

I ran read-only static Git inspection (`status`, `rev-parse`, `show`, `diff` including quiet/raw/numstat), `cat`, `sed`, `rg`/`rg --files`, `shasum -a 256` and installed-source reads. Initial guessed God Mode directories and root-level Drizzle paths did not exist; I corrected them to `docs/03-features/god-mode.md` and the actual `.pnpm` package paths. These were static lookup errors, not failed tests. I wrote this report using a restrictive shell heredoc. I ran no Node, test, compiler/typecheck, formatter, build, Docker, browser, database or other product/runtime command.

Conductor-run evidence read, not independently reproduced:

- `accepted825-composition-native.json` records the clean two-parent merge and conserved blobs. The first merge message was rejected for unsupported conventional type `merge`; the staged merge was completed using `chore` with normal hooks. No hook bypass, abort or history rewrite is represented.
- `825-402c-protected-acceptance.json` records protected #825 acceptance at 17:22:03Z, accepted d924, reviewed-publication tree equality and normal protection. It points to the separate readiness receipt. I did not query GitHub or independently re-read the full eighteen-check rollup; those are accepted-main contextual claims, not check results for c54d.
- `composed-checks/tests-native-receipt.json` and `tests-stdout.log` bind the actual focused run to HEAD c54d, native exit 0 in 4.601 seconds: three tests pass, zero failures/skips/cancellations; hashes conserved and clean afterward. Both current source hashes independently match that receipt.
- `composed-checks/inventory-native-receipt.json` and `inventory-parsed-summary.json` bind the built-dependency diagnostic to HEAD c54d, native exit 1 in 18.277 seconds: 2,794 overlapping diagnostic instances / 154 paths / 1,549 path-line locations, twelve unresolved exported-type module rows, zero explicit-builder rows and zero TypeScript diagnostic instances. The checker remains unwired and genuine unknowns remain fail closed. I did not audit every raw diagnostic or rerun the inventory. These counts are not unique queries, migration progress or an activation result, and are not promoted from the earlier incomplete-dependency 1,779 capture.

## Findings and residuals

**Blocking findings:** none in the reviewed composition delta.

**Non-blocking findings:** none newly introduced by this delta.

**Retained residuals:** Pending-action N1 remains unresolved and unwaived. Twelve unresolved type-boundary modules and the broader query inventory remain open. The structural ownership checker cannot prove tenant-predicate correctness. Exact-publication required hosted checks and the normal protected flow remain conductor responsibilities; no current publication result, image/runtime/SIT/release/recovery proof, stage closure, whole-#580 completion or merge-readiness claim is made here.

**Final verdict:** CLEAR for full independent Sol security delta review of `c54d265092e682c7ca1bbad6984965f363a00ffd`, carrying forward the original full security review at `19c7e9f661f48815d38219ea416db76163221d93` and independently assessing the imported accepted-main `d924594290cf0317150c5c9cdd0a746bc0595202` delta and interactions described above.
