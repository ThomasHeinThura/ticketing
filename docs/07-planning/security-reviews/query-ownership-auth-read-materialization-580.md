# Auth repository read materialization — issue #580

**Reviewed head:** `e52aa65d796121cbced07205f15db6db8e774642`

Fourteen remaining simple auth-repository reads now await and return materialized rows. Their statements, predicates, selections, transaction handles and supplied clocks are unchanged; every caller already awaits compatible results, including the existing Promise.all config reload. The fresh independent ordinary review and separate GPT-6.1 Sol confirmation classify this as the security-scope row that changes no authority or gate pass/fail semantics. The lightweight Sol confirmation is mandatory and was actually performed; no review is waived.

The first source-only reports honestly name dirty content hashes. Both reviewers then independently inspected the real normal commit and supplied separate exact-SHA binding confirmations. Those five authentic reports are preserved verbatim below. The earlier source-only reports were not rewritten to invent an existing commit.

Only diff/source checks were performed for this slice. Typecheck, real PostgreSQL, applicable hosted CI, image/browser evidence, current accepted-main composition and protected acceptance remain pending. Older PR #815 results do not test this new source. This note does not claim whole #580, checker activation, PA-15 compliance or stage completion. Inherited N1 creation action-row/advisory versus issuance advisory/action-row lock ordering remains unresolved. The Sol report preserves the minor synchronous-construction-throw scheduling distinction for the read-only Promise.all reload; no failure can swap configuration.

## Authentic report: auth-repository-read-materialization-author-luna.md

# TaskDesk #580 auth repository read materialization — author report

## Result and source

Expanded the bounded source-only slice to all 14 simple builder-returning reads in the auth repository: the originally assigned `getPendingActionForStepUp` plus the 13 additional exports enumerated by the conductor. Each is now `async` and `return await`s its existing Drizzle statement, so the query is awaited and the materialized rows leave the repository. This is an uncommitted patch, not a completion or review claim.

- Worktree: `/Users/heinthura/.codex/worktrees/remaining580-pending-action-preflight-luna`
- Branch: `codex/remaining580-pending-action-preflight`
- Exact source/base HEAD: `693d1ec7c3d49906d318c5f6f3da1752d0e72481`
- Accepted `origin/main`: `b78fd6853a890c6e2b10d17be18885e3b1612b2d`
- Working tree was clean before this bounded change. The only modified path is `apps/api/src/auth/repository.ts`.
- No commit or push was made.

## Exact inventory and caller audit

The full source inventory was read from `apps/api/src/auth/repository.ts` at the exact base. In addition to `getPendingActionForStepUp` (lines 60-82 at base), the 13 converted exports and all callers found by repository-wide `rg` across `apps`, `tests`, and `packages` are:

| Export | Call sites and consumption | Compatibility |
| --- | --- | --- |
| `getAuthUserLocale` | `apps/api/src/auth.ts:314`, awaited and destructured | Materialized row array |
| `countAuthUsers` | `apps/api/src/auth.ts:674,903`, awaited and indexed | Materialized row array |
| `countAuthUsersForExecutor` | `apps/api/src/auth.ts:794`, awaited with existing `tx` and indexed | Preserves transaction executor and row array |
| `getSetupCompletionMarker` | `apps/api/src/auth.ts:797`, awaited with existing `tx` and destructured | Preserves transaction executor and row array |
| `getFirstUserWorkspaceMembership` | `apps/api/src/auth.ts:1093`, awaited and indexed | Materialized row array |
| `getUserFactorEnabled` | `apps/api/src/auth/step-up-api.ts:686`, awaited and destructured | Materialized row array |
| `getUserId` | `apps/api/src/auth/step-up-api.ts:736,786`, awaited and destructured | Materialized row array |
| `getScimConnectionDetails` | `apps/api/src/auth/step-up-api.ts:952`, awaited and destructured | Materialized joined-row array |
| `getScimConfigVersion` | `apps/api/src/auth/step-up-api.ts:1009,1372,1388`, awaited and destructured | Materialized joined-row array |
| `getIdentityConfigVersion` | `apps/api/src/auth/step-up-api.ts:1092,1261`, awaited and destructured | Materialized row array |
| `getPasswordCredential` | `apps/api/src/auth/step-up-api.ts:1410`, awaited and destructured | Materialized row array |
| `getStoredAuthPluginConfigRows` | `apps/api/src/auth.ts:1162`, awaited as one member of `Promise.all` | Materialized row array; existing parallel aggregation retained |
| `getIdentityConnectionConfigVersions` | `apps/api/src/auth.ts:1163`, awaited as one member of `Promise.all` | Materialized row array; existing parallel aggregation retained |

The two config reads are combined by `Promise.all`; both callers already awaited the helper results, so conversion preserves the resolved values and concurrent invocation. `countAuthUsersForExecutor` and `getSetupCompletionMarker` already receive the caller's transaction handle; they continue to use it. No caller chaining, mapping, direct builder composition, synchronous inspection, or other incompatible use was found. `getActiveSessionForStepUp`, `getCustomerPortalIdentityRow`, and the already-async step-up/operation repository functions were already materializing results and were not changed. `apps/api/src/auth/step-up-api.ts` and every caller file remain untouched.

## Preserved query behavior

Only function async declarations and `return await` were added. No Drizzle selection, table/join, where predicate, ordering, limit, clock argument, executor, result fields, transaction boundary, error path, or route behavior changed. The pending-action step-up preflight retains its explicit caller-provided `now` and strict `expiresAt > now`. No new transaction or lock was introduced.

## Hashes and diff evidence

- Pre-edit source file SHA-256 (`git show HEAD:apps/api/src/auth/repository.ts`): `38cacf6c4d9dd623caa77c07e0e064e9526590235580018341a9f691c77d4ec8`.
- Post-edit source file SHA-256: `f45bf7c5912fa5d571004d9608731edb07f53b8cd9d4d2bc788132a0a2a35b1e`.
- `git diff --stat`: one file, 28 insertions and 28 deletions (14 async declarations and 14 `await` additions).
- `git diff --name-only`: `apps/api/src/auth/repository.ts` only.
- `git diff --check`: passed.

## Commands and checks

In the explicit owned worktree, I ran `pwd`, `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse origin/main`, exact-file `sed`, full-export `rg`, repository-wide caller `rg` over `apps tests packages`, `git diff -- apps/api/src/auth/repository.ts`, `git diff --name-only`, `git diff --stat`, `git diff --numstat`, `git diff --check`, `git show HEAD:apps/api/src/auth/repository.ts | shasum -a 256`, and `shasum -a 256 apps/api/src/auth/repository.ts`.

No tests, typecheck, lint, build, database, Docker, browser, dependency installation, hooks, or CI were run. `git diff --check` is the only check pass reported. No other result is assumed; the carrier's heavy verification window is still owned by the root.

## Residuals and not done

- Preserve the inherited pending-action lock-order residual: creation follows action-row then advisory-lock order while issuance follows advisory-lock then action-row order, leaving a potential deadlock. This materialization batch does not touch either operation and does not resolve that risk.
- No tests were added or run, at the root's direction for this bounded extraction and while the heavy carrier window is active.
- No independent reviews, CI, merge-readiness, #580 completion, or checker enablement is claimed.
- No commit or push was made. If the normal commit hook needs unavailable dependencies, keep the patch uncommitted and report setup needs; do not bypass hooks.

## Authentic report: auth-repository-read-materialization-ordinary-luna.md

# Independent ordinary review — auth repository read materialization

## Verdict and scope

**Verdict: CLEAR for the reviewed source-only delta; no blocking or non-blocking code findings.** This is one fresh ordinary review of the exact uncommitted source content identified below. It does not claim typecheck, runtime, PostgreSQL, Docker, browser, CI, or build validation. The required independent GPT-6 Sol security review remains pending because this is under `apps/api/src/auth/**`, even though I found no authority or gate pass/fail change.

- Reviewer role/model: GPT-6 Luna, independent ordinary reviewer context.
- Worktree: `/Users/heinthura/.codex/worktrees/remaining580-pending-action-preflight-luna`
- Comparison base: `693d1ec7c3d49906d318c5f6f3da1752d0e72481`
- Candidate state: uncommitted working-tree delta; no commit SHA exists.
- Exact source: `apps/api/src/auth/repository.ts`, SHA-256 `f45bf7c5912fa5d571004d9608731edb07f53b8cd9d4d2bc788132a0a2a35b1e`.
- Delta: only this file; 14 functions gain `async` and `return await`; query expressions remain unchanged.

## Review performed

I read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the accepted `docs/04-engineering/coding-standards.md` query-ownership section, the current D1–D4 entry in `docs/07-planning/decision-log.md`, and `docs/01-architecture/auth-and-identity.md`. I inspected the complete diff, all 14 changed function bodies, all repository-wide matches for their names under `apps`, `tests`, and `packages`, and the relevant caller contexts in `apps/api/src/auth.ts` and `apps/api/src/auth/step-up-api.ts`.

The review found:

- All callers consume the repository results with `await`; destructuring/indexing remains compatible with the materialized row arrays. No caller composes a returned builder, inspects it synchronously, or depends on builder-specific methods.
- `countAuthUsersForExecutor(tx)` and `getSetupCompletionMarker(tx)` still receive and execute through the same transaction handle. Their sequential order inside the existing transaction is unchanged.
- `reloadAuthConfiguration` still starts both reads as members of the same `Promise.all`; the async repository wrappers preserve concurrent query initiation and resolved row values.
- At other call sites, existing surrounding `await`, condition, catch/error handling, audit ordering, and response paths remain unchanged. Query execution errors continue to reject the awaited operation and flow through existing caller handling.
- The statements' selections, joins, predicates, ordering/limits, explicit `now` value for pending-action expiry, and database executor are unchanged. No new transaction, lock, permission check, or authority source is introduced.
- The changed file is a named repository location under D3. The transaction handling follows D1; there is no raw SQL/fragment change under D2; and D4’s scripts exclusion is unaffected. The separate results rule is satisfied because each function awaits and returns rows. The checker remains outside this source delta and is not claimed as enforced.

The review independently confirmed the stated security classification: this is an auth security-scope path, but the diff changes no authority or gate pass/fail semantics. Therefore the applicable ordinary count is one fresh reviewer plus the mandatory separate Sol confirmation.

## Commands actually run

Every repository command used the explicit worktree above. I ran:

- `pwd`, `git status --short`, `git rev-parse HEAD`, and `shasum -a 256 apps/api/src/auth/repository.ts` to bind the checkout and exact content.
- `git diff -- apps/api/src/auth/repository.ts` to inspect the full source delta.
- `rg` searches for D1–D4/coding-standard references and for every changed export name across `apps tests packages`.
- `sed` reads of the changed repository functions, relevant caller contexts, the accepted query-ownership standard, current decision entry, and auth/identity architecture.
- Read the author handoff at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/auth-repository-read-materialization-author-luna.md` as a navigation aid, then verified its source claims against the worktree.

No tests, typecheck, lint, build, database, Docker, browser, dependency installation, hook, or CI run was performed. I make no pass claim for any of them.

## Residual and source binding

The inherited pending-action lock-order residual remains: action creation takes the action-row lock before the advisory lock, while issuance takes the advisory lock before the action row. This patch does not modify either operation and does not resolve that potential deadlock. This is not a new finding against the materialization delta.

This verdict is bound to the exact file hash and base above, not to a future commit SHA. If the normal commit adds only surrounding review metadata and leaves this file byte-identical, the review content remains equivalent for this file; the conductor must verify the committed blob/hash and record the actual commit SHA. Any product-source change requires reassessment at its exact head.

## Authentic report: auth-repository-read-e52aa65-ordinary-binding-luna.md

# Ordinary review source binding — auth read materialization

## Verdict

**CONFIRMED: the ordinary review remains bound to this commit's product source.** I independently inspected the actual commit parent, complete changed-path list, committed file content, and current worktree state. The committed repository file is byte-identical to the exact file reviewed earlier. This is a source-binding confirmation, not a second full review.

- Reviewer: GPT-6 Luna, the same independent ordinary reviewer context that authored the prior report; no implementation or remediation work was performed by this reviewer.
- Commit: `e52aa65d796121cbced07205f15db6db8e774642`
- Exact parent: `693d1ec7c3d49906d318c5f6f3da1752d0e72481`
- Complete commit path list: one path, `apps/api/src/auth/repository.ts` (28 insertions, 28 deletions).
- Committed blob content SHA-256: `f45bf7c5912fa5d571004d9608731edb07f53b8cd9d4d2bc788132a0a2a35b1e`.
- Current worktree file SHA-256: `f45bf7c5912fa5d571004d9608731edb07f53b8cd9d4d2bc788132a0a2a35b1e`; worktree is clean.
- Prior ordinary report: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/auth-repository-read-materialization-ordinary-luna.md`, SHA-256 `6d68385e84de7283ac99049acb3c5d1d59c300893719b4b6b575a2935ebcb71e`.

## Verification performed

In the explicit worktree `/Users/heinthura/.codex/worktrees/remaining580-pending-action-preflight-luna`, I ran `pwd`, `git status --short --branch`, `git rev-parse HEAD`, `git rev-parse HEAD^`, `git diff-tree --no-commit-id --name-status -r HEAD`, `git show HEAD:apps/api/src/auth/repository.ts | shasum -a 256`, `shasum -a 256 apps/api/src/auth/repository.ts`, `shasum -a 256` on the prior report, `git diff HEAD^ HEAD --stat`, and inspected the complete `git diff HEAD^ HEAD -- apps/api/src/auth/repository.ts`.

The parent matches the base named in the original review, the only committed path is the reviewed file, and the committed bytes match its previously reviewed source hash. Thus the earlier caller, eager execution, `Promise.all`, error propagation, transaction executor, clock argument, and unchanged query-expression analysis still covers the product source in this commit. The commit introduces no intervening product-source or other covered-input change.

## Limits

No tests, typecheck, lint, build, dependency installation, database, Docker, browser, or CI were run or are claimed. The original verdict's limits and the inherited pending-action lock-order residual remain unchanged. Required independent GPT-6 Sol security confirmation is still a separate gate; this binding confirmation does not satisfy it.

## Authentic report: auth-repository-read-materialization-security-61-sol.md

# Independent security confirmation — auth repository read materialization

**Model:** GPT-6.1 Sol (`gpt-6.1-sol`).
**Role:** Fresh independent security-tier reviewer; lightweight confirmation after ordinary review.
**Context:** `/root/auth_read_materialization_security_sol`, dispatched by `/root` for this bounded deliverable. No author conversation was inherited. I did not author, direct or remediate the candidate. I made no repository source edits.
**Comparison base:** `693d1ec7c3d49906d318c5f6f3da1752d0e72481`.
**Candidate:** Uncommitted working-tree bytes; no candidate commit SHA exists for this delta. The base SHA is not a claim that this patch was reviewed as committed source.
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-pending-action-preflight-luna`.
**Reviewed path:** `apps/api/src/auth/repository.ts`.
**Reviewed SHA-256:** `f45bf7c5912fa5d571004d9608731edb07f53b8cd9d4d2bc788132a0a2a35b1e`.
**Base file SHA-256:** `38cacf6c4d9dd623caa77c07e0e064e9526590235580018341a9f691c77d4ec8`.

## Verdict

**CLEAR for the exact source-only materialization delta. No new blocking or non-blocking security finding.** The change touches a mandatory security-review path but changes no authority, security decision predicate or gate pass/fail semantics. One fresh ordinary review plus this separate lightweight security confirmation is the applicable tier. I found no semantic reason to elevate this 14-function wrapper conversion to the full auth redesign tier.

This is not merge readiness or runtime acceptance. The conductor must complete normal commit/publication, bind the actual committed blob and exact SHA, and satisfy the applicable checks. Nothing here waives a required gate or clears the inherited N1 residual.

## Source and contracts inspected

I read the worktree's AGENTS.md, active mission, canonical agent workflow including review tiers/evidence binding, CLAUDE.md, coding standards' query ownership/results and executor rules, the current D1–D4 decision-log entry and continuation context, the current status/queue opening and blocked state, CI security-path policy, monorepo repository convention, authentication/identity architecture, and the relevant PA-15 pending-action contract. The decision-log entry contains historical wording that the expanded query contract was proposed; I used the actual coding-standards contents present at the reviewed base and did not infer gate activation from the decision record.

I read the authentic author and fresh ordinary reports at `auth-repository-read-materialization-author-luna.md` and `auth-repository-read-materialization-ordinary-luna.md` in the same private evidence directory, then independently checked their source claims. Ordinary verdict is CLEAR for these same bytes. I also inspected the prior pending-action security note's preserved N1 and scope limits; earlier review evidence does not silently approve this new delta.

The full diff contains only the 14 `export function` to `export async function` changes and corresponding `return` to `return await` additions. A read-only Python source comparison reconstructed those changes from the exact base and matched the entire resulting file byte-for-byte. This verifies that every query expression, selection, join, predicate, supplied clock, limit, executor and unchanged function body is conserved; it is not a runtime test.

## Connected security assessment

- **All 14 reads and callers:** I inspected the changed bodies and searched all `apps`, `tests` and `packages` references using symbol boundaries. Production callers occur in `auth.ts` and `auth/step-up-api.ts`. They await the result directly or include both configuration reads in the existing awaited Promise.all. None composes a returned builder, calls builder-only methods or inspects it synchronously. Related repository imports in step-up-service reference other, unchanged lifecycle functions. The converted exports are locale, both user counts, setup marker, first workspace membership, pending-action preflight, factor-enabled status, user id, SCIM details/version, identity version, password credential and both reload reads.
- **Bootstrap and setup transaction:** The pre-registration count and durable completed-setup check, bootstrap email/token paths and refusal decisions stay in their existing order. The post-create hook still enters the same transaction, takes advisory lock 2026, awaits `countAuthUsersForExecutor(tx)`, then awaits `getSetupCompletionMarker(tx)` before the existing count-one/marker-absent promotion. Both repository functions use the supplied tx. No global connection substitution, detached read, new commit or authority grant occurs.
- **Session and pending-action preflight:** `getActiveSessionForStepUp` was already async and is unchanged. The current agent-session/user/portal/expiry gate still precedes challenge handling. `getPendingActionForStepUp` retains exact action id, requesting person id, pending state and strict expiry against the already supplied Date. Both challenge and issuance API paths still await it before checking action kind, target, confirmation and route binding. No action-row lock, new transaction, clock substitution or preflight-as-issuance authority is introduced. The lifecycle persistence functions remain byte-identical.
- **Other step-up targets:** Factor status and user-id lookups retain current instance-admin gates and the same missing/disabled denial behavior. SCIM reads still inner-join the SCIM child to the exact identity connection; the identity read still uses the exact connection id. Current-version comparisons and 404/409 paths remain before challenge/proof operations. No new SCIM-derived administrator authority is added.
- **Password proof:** The credential read still matches exact user id and providerId credential. The verifier first loads current factor state, refuses password when a factor is enabled or required, awaits the stored credential and compares the supplied proof through bcrypt. Missing credentials fail closed. This patch changes neither identity binding nor proof method policy.
- **Workspace and locale:** Both queries retain their existing exact user/email predicates and caller result consumption. The workspace read still finishes before the existing session update. No broader scope or extra data leaves the repository.
- **Parallel reload and failure behavior:** The two read-only configuration statements remain the members of one awaited Promise.all. The version/fingerprint processing, constructing both auth instances before swap, catch/rethrow, failure telemetry and finally clearing the shared reload promise are untouched. Async functions convert a synchronous query-construction throw into a rejected promise. Thus if construction of the first configuration read throws synchronously, the second read can now still be constructed/started before Promise.all rejects; previously a direct throw could stop array construction. Both operations are reads, and a rejection still prevents every configuration swap and records failure. This observable scheduling detail creates no authority or fail-open change and is not a finding. Other call sites immediately await, so rejection propagates through the same awaited decision boundary. I do not claim identical stack traces, precise microtask timing, or a deterministic winner between simultaneous read failures.

## Inherited residual retained

**N1 — unchanged pending-action creation/issuance lock-order inversion.** Creation locks the requester-owned action row before the session/action advisory lock. Issuance takes that advisory lock, then the active-session row, then the action row. Concurrent requests for the same session/action can therefore form a wait cycle and PostgreSQL may abort one transaction. I verified these current bodies and proved them unchanged by the whole-file transformation comparison. This remains the prior non-blocking availability residual for the statement-preserving ownership work. It is not reproduced here, resolved, waived, or a newly introduced issue in materialization. This report neither claims PA-15 compliance as a whole nor disposes of that risk.

## Commands and evidence actually produced

Every shell command used the explicit worktree above. Read-only commands included `pwd`, `git status --short`, `git rev-parse HEAD`, `git diff -- apps/api/src/auth/repository.ts`, `git diff --check`, `git hash-object apps/api/src/auth/repository.ts`, `shasum -a 256`, `cat`/`sed` reads of guidance, exact source and private reports, and `rg`/`rg --files` source and document searches. Python read the candidate and `git show` of the exact base to verify the complete 14-wrapper-only transformation and both SHA-256 values. `git diff --check` succeeded. Final observed status remained only the assigned repository file modified, with HEAD and content hash unchanged.

I used read-only `gh pr list --state open` and `gh pr view 815 --json headRefName,headRefOid,mergeable,reviewDecision,statusCheckRollup` to establish live context. PR #815's reported head is the comparison base, not the uncommitted materialization candidate. Its visible CI results cannot validate these new bytes; I make no CI pass or readiness claim from that output.

No tests, typecheck, lint, dependency installation, hook, Node execution, database/PostgreSQL work, build, Docker, browser, application runtime or CI execution was performed. The read-only Python comparison is source evidence only. The conductor retains its heavy verification window. No whole-#580 closure, checker enforcement, concurrency correctness, image/health result, feature/stage completion, deployment or SIT acceptance is claimed. The primary checkout was never accessed or modified.

## Binding required after the normal commit

This report currently binds to the base and exact SHA-256 above. After normal commit, the conductor must compare the committed repository blob's SHA-256, inspect the candidate's complete source delta and record its actual commit SHA. I can then provide a reviewer-authored exact-SHA binding confirmation for unchanged bytes; no author may rewrite this report to pretend a commit already existed. Any product-source or covered-input change requires appropriate reassessment. Publishing this authentic review record does not itself change this verdict.

## Authentic report: auth-repository-read-e52aa65-security-binding-61-sol.md

# Security review exact-SHA binding — auth read materialization

**Model:** GPT-6.1 Sol (`gpt-6.1-sol`).
**Role and provenance:** The same independent security reviewer context `/root/auth_read_materialization_security_sol`, dispatched by `/root`, that authored the original confirmation. No implementation, material direction or remediation was performed by this reviewer. This is a binding confirmation after inspecting the actual normal commit, not a new independent review context or another full audit.
**Reviewed head:** e52aa65d796121cbced07205f15db6db8e774642
**Comparison base / sole parent:** `693d1ec7c3d49906d318c5f6f3da1752d0e72481`.
**Worktree:** `/Users/heinthura/.codex/worktrees/remaining580-pending-action-preflight-luna`.

## Verdict

**CONFIRMED — CLEAR for the exact committed materialization delta at the reviewed head.** My original source-only security confirmation now binds to actual commit `e52aa65d796121cbced07205f15db6db8e774642`. The commit contains precisely the source bytes reviewed earlier, on precisely the earlier comparison base, with no additional changed path or covered-input change. No new blocking or non-blocking finding was found by this binding verification. The mandatory lightweight security confirmation remains the appropriate tier; the change alters no authority or gate pass/fail semantics.

## Independent verification

I verified HEAD and the actual commit's sole parent, inspected the complete raw changed-path/mode/blob list, numstat and complete source diff, and read the fresh ordinary reviewer's independent binding report. The sole changed path is `apps/api/src/auth/repository.ts`, mode 100644 retained, with 28 insertions and 28 deletions. Its committed Git blob is `f0b1a801c0f2cb78d0161a69b4fd6686ffc9cf6d`; committed content SHA-256 is `f45bf7c5912fa5d571004d9608731edb07f53b8cd9d4d2bc788132a0a2a35b1e`.

I independently read the committed blob through Git, calculated its SHA-256, compared it byte-for-byte with the clean working-tree file, and confirmed the exact earlier reviewed source hash. A Python source-binding check asserted the actual parent, full changed-file list, clean status, equality and expected hashes. Because this is one direct child of the original base and only the reviewed file differs, every other source, caller, contract, dependency, test, build configuration and review input remains unchanged from that base. The commit introduces exactly the already reviewed 14 async/return-await wrappers.

Original report: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/auth-repository-read-materialization-security-61-sol.md`.
Original report SHA-256: `e3116e4a640df285cd525e985cf5a7d6985127d97a254d38d0acca9c1bd65074`.
I rechecked that hash and preserved the original report byte-for-byte. This separate reviewer-authored note supplies its previously pending exact-SHA binding without rewriting its history.

All original connected-source analysis continues to apply, including bootstrap transaction/executor ordering, current-session gates, pending-action owner/state/clock predicates, SCIM/identity versions, current-factor password eligibility, Promise.all reload failure handling and the documented synchronous-construction-error scheduling nuance.

## Commands and limits

Every command used the explicit worktree above. Commands were `git status --short`, `git rev-parse HEAD`, `git show -s --format=...`, `git diff-tree --raw/--numstat -r --no-renames`, the complete `git diff <base> <head> -- apps/api/src/auth/repository.ts`, `shasum -a 256` on the preserved report, and `cat` of the ordinary binding report. Read-only Python invoked Git to verify parent, complete path list, clean status and committed blob, then computed source/report hashes. The only write was this new evidence note created with O_EXCL and mode 0600.

No runtime, Node, tests, typecheck, lint, PostgreSQL/database, dependencies, build, image, Docker, browser or CI execution was performed. I did not edit source, commit or push. I make no claim about commit-hook or test execution from the normal-commit receipt; the actual committed content is what I verified.

**Inherited N1 remains unresolved:** pending-action creation takes action-row then advisory lock, while issuance takes advisory then session/action-row locks. The possible deadlock remains the prior source-derived availability residual, not a reproduced result, fix, waiver or new issue in this delta. Original scope limits remain: this is not whole #580 closure, checker enforcement, whole PA-15 correctness, concurrency proof, merge readiness, stage closure, image/health or SIT acceptance. Applicable exact-head gates and runtime acceptance remain separate obligations. The primary checkout was never accessed or modified.
