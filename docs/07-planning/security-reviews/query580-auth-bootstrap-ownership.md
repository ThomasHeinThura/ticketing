# First-user bootstrap statement ownership — authentic reviews

**Reviewed head:** `78358baee2ee8fd9333ce9789a1825cd96d013d6`

Accepted comparison base: `a909c69e504bff408b0ef16e39ec2b6c2242e228`. The source changes only auth.ts and auth/repository.ts. Three existing bootstrap statements move to finite awaited repository helpers; the same transaction, advisory2026 lock, count/marker reads, eligibility predicate, role update, canonical singleton upsert, errors and three Date evaluations remain.

Author context01a14c17-cd4c-7293-a222-c24fff975e2f: native configured gpt-6-luna/high. Fresh independent ordinary reviewer01a14c73-908f-7a60-9761-a1234f66e17c: gpt-6-luna/high. Further fresh independent security reviewer01a14c74-a360-7d40-b570-a91607cf0044: gpt-6.1-sol/high. Root verified all three distinct native session/turn-context assignments; configured metadata is not served-weight attestation. The conductor materially directs/publishes and supplies no independent approval.

Both reviewers independently classify this as a pure statement relocation with no authority or gate pass/fail change. One strong ordinary review plus mandatory lightweight Sol confirmation is the applicable semantic tier; neither report waives a gate. The Sol report follows ordinary clearance.

Actual local root evidence: workspace9type tasks successful(5cached), complete existing bootstrap PostgreSQL file19/19/native0 with source/privateenv/ownedcontainer/Dockerinventory conservation. Those executions were at runnerab4 plus the exact two-file dirty patch. Accepted836 has the identical base tree; accepted837 changes only three dated records. Every runtime code/test/config/dependency entry and the exact patch remain conserved through the reviewed source. This is source-equivalent local reuse, not execution at source/publication HEAD. Exact-publication hosted suites and image gates are pending at publication.

The query diagnostic remains red/unwired:2727 overlapping instances/140paths/1510locations, including eight rows for two other auth hooks. No unique-query/progress or whole-file/580 completion. Existing #231 zero-admin liveness and verified-MFA completion residuals remain unchanged; inherited NB1 remains unfixed/unwaived. No new authority, stage/mission/release/SIT/recovery/final-audit acceptance is claimed.

The following authentic reports are embedded byte-for-byte. This designated note is the sole post-reviewed-source commit path.

## Ordinary review

Authentic report SHA256 `4738be0b0816a86dadd747727e396e21161c991294a252a0fc2e1c3bd24428e0`.

---

# Ordinary review — first-user bootstrap query relocation

**Model:** GPT-6 Luna
**Role:** Independent ordinary reviewer
**Reviewed head:** `78358baee2ee8fd9333ce9789a1825cd96d013d6`
**Comparison base:** `a909c69e504bff408b0ef16e39ec2b6c2242e228` (accepted #836/#837 main)
**Context / independence:** Fresh reviewer context assigned by the orchestrator for #580. I did not author, direct, or remediate this candidate. Author context: `/root/query580_local_factor_ownership_plan_luna`; the root conductor is not the author-reviewer for this report.

## Scope and checks

Reviewed the complete two-file diff and relevant surrounding source in `apps/api/src/auth.ts` and `apps/api/src/auth/repository.ts`; compared the prior callback and imports at the base; traced the new helpers, `StepUpExecutor`, the setup-token singleton constant and its module imports; checked the first-run/bootstrap contract in `docs/01-architecture/auth-and-identity.md`, the active mission and the security-scope path list in `docs/04-engineering/ci-cd.md`; checked `git status` and `git diff --check`.

The change moves the existing advisory-lock statement, role update and setup-marker upsert into awaited repository helpers. The same transaction executor is passed to every helper; the lock remains transaction-scoped. In the hook, the sequence remains lock → total-user count → setup-marker read → unchanged `totalUserCount === 1 && !setupAlreadyCompleted` predicate → role update → setup-marker upsert. SQL, Drizzle predicates/targets, singleton id, conflict behavior, nulling of token fields, and all three separate `new Date()` calls are preserved. The helpers propagate query errors by awaiting the statements, as the inline code did. The new setup-token import has no reverse repository import and introduces no cycle in the inspected module graph.

I made no source changes. I did not run tests, typechecking, a compiler, CI, or runtime checks. Root-provided test/type evidence was not executed or independently validated by this review.

## Verdict

**PASS — no blocking or non-blocking findings.** The reviewed delta is a pure query-ownership relocation: I found no change to authorization, bootstrap eligibility, transaction/lock lifetime, query ordering, or gate pass/fail semantics. This supports the one-strong-Luna ordinary-review tier for this bounded candidate.

Because the candidate touches `apps/api/src/auth*`, a fresh lightweight GPT-6 Sol security confirmation is still required by the repository path policy, even though this review found no semantic security change. This report does not claim that confirmation, tests, CI, PR acceptance, or merge readiness.

## Residual limits

Static review cannot establish runtime equivalence or type compatibility. Root reports native bootstrap suite 19/19 and typecheck evidence for this exact source lineage; those results remain root-owned evidence and are not my test execution.


## Security confirmation

Authentic report SHA256 `3418fb67860bf47b705f700341ee5038360c75fc81c374909a69244f9ba66499`.

---

# Security review — first-user bootstrap statement ownership

**Model:** GPT-6.1 Sol
**Role:** Independent security reviewer; lightweight confirmation after ordinary review cleared
**Reviewed head:** 78358baee2ee8fd9333ce9789a1825cd96d013d6
**Comparison base:** a909c69e504bff408b0ef16e39ec2b6c2242e228
**Context:** /root/bootstrap7835_security_sol; native context 01a14c74-a360-7d40-b570-a91607cf0044
**Provenance:** Fresh context without inherited author conversation. Native configured assignment is gpt-6.1-sol/high, as recorded in query580-auth-bootstrap-preparation-root/native-review-provenance.json; this is configured assignment evidence, not served-weight attestation. Parent conductor context is 01a14000-d9e0-7bb1-b3fd-2c0204a4834c.
**Independence:** I did not author, direct or remediate this candidate. Author /root/query580_local_factor_ownership_plan_luna (01a14c17-cd4c-7293-a222-c24fff975e2f), ordinary reviewer /root/bootstrap7835_ordinary_luna (01a14c73-908f-7a60-9761-a1234f66e17c), and this security reviewer are distinct contexts. The conductor materially directed the candidate and is not its approving reviewer.

## Scope and method

Read repository AGENTS.md, active mission, workflow review/model/evidence rules, CLAUDE.md, the CI security-scope list, current status and recent decision-log entries, relevant auth-and-identity Break-glass contract and security-model setup-token contract. Read the cleared ordinary report bootstrap7835-ordinary-luna.md before issuing this security confirmation. Inspected the entire exact two-file diff and surrounding before/after user-creation hooks, auth repository helpers and their callers, setup-token module, database initialization/import dependencies, instance-setting schema and existing bootstrap integration test source. Verified HEAD, clean status, diff scope and git diff --check; inspected live open PR heads (this source branch had no open PR in that inventory). No source/ref changes were made.

## Independent security assessment

PASS. The appropriate tier is the workflow row for a security-scope path that provably changes no authority or gate pass/fail: one independent ordinary review plus a lightweight independent Sol confirmation. Both changed paths are security scope; their semantics, rather than their names alone, justify the lightweight depth. This delta relocates three existing statements and neither adds bootstrap policy nor redesigns an authorization mechanism.

- The after-hook still rejects anonymous users and customer portal processing before entering the unchanged db.transaction callback. The before-hook's token/headless admission, registration checks and error messages are unchanged.
- The advisory statement remains exactly SELECT pg_advisory_xact_lock(2026), executed and awaited using the callback's same tx. No global-db fallback, nested transaction, release, retry, independent connection or detached promise was introduced. The transaction-scoped lock therefore remains held through the callback's writes and transaction end.
- Order remains lock, total-user count, durable setup-marker read, unchanged totalUserCount === 1 && !setupAlreadyCompleted predicate, user-role update, setup-marker upsert. The existing count and marker projections/results/defaults remain unchanged, including the marker LIMIT 1 read. The singleton CHECK constraint still restricts instance_setting.id to 'singleton'.
- Promotion uses the identical user table, role: 'admin', and equality against the original hook user.id. The helper requires a transaction executor and a string user id; the actual sole caller passes tx and user.id. No caller-controlled policy selector or expanded authority input was added.
- Setup completion retains the canonical SETUP_TOKEN_SINGLETON_ID ('singleton'), insertion fields, conflict target and conflict update fields. It clears both token hash and expiry on either path. Three distinct new Date() evaluations remain at the same statement construction positions and order; none became module-level, cached, shared or eagerly evaluated before the predicate.
- Each helper awaits its statement and returns Promise<void>. The original statement results were ignored, so discarding them introduces no result-contract change. Rejections still propagate through the awaited callback and abort the transaction; no catch, transformed error, partial-commit path or new top-level query was introduced.
- The StepUpExecutor type is the existing transaction-callback parameter type derived from db.transaction. New helpers have no optional executor/default db. Other repository methods are unchanged. The new setup-token import resolves the same canonical constant previously imported by auth.ts. setup-token imports database/schema and external libraries, with no reverse auth-repository import; inspected database/schema/relations dependencies do not lead back to this repository. No new import cycle or token-generation/query side effect is introduced by loading that module.

## Evidence examined, not executed by this reviewer

I ran only read-only git/GitHub/source inspection and Python hashing/comparison. I did not run Node, a compiler, tests, CI, Docker, PostgreSQL, browser verification, installs or formatters.

Root's complete existing bootstrap PostgreSQL suite ran on ab4e2a82dc4da1b88b96d5b2e38d0a247da16886 plus the exact dirty two-file patch, not on this later source commit. I independently checked that ab4 and accepted d923f7b323444c7c2d259afa4bf8dd267a76cd19 have identical complete git trees; the base delta from ab4 to a909 touches only the queue, status and authentic post836 review record. The reviewed candidate has only the two declared source changes. Candidate SHA256s for both changed source files and tests/api-integration/instance-setup-bootstrap.test.ts match the root PG receipt. Raw vitest.full.log SHA256 matches that receipt and its summary shows one file, 19 tests passed. Raw types.log SHA256 matches types-native.json and its summary shows nine successful tasks, five cached. These establish source-equivalent reuse of root-owned local evidence, not new test execution or exact-candidate hosted status results.

Read root query-diagnostic-summary.json: it retains native exit 1, eight diagnostic instances for two other auth hooks, and explicitly remains unwired. No whole-file/whole-580 completion or unique-query progress is established.

## Verdict and limits

**PASS — no blocking or non-blocking findings in this candidate delta.** This independently confirms preservation of the inspected security-relevant semantics and the lightweight review classification at exact source 78358baee2ee8fd9333ce9789a1825cd96d013d6.

Existing zero-admin bootstrap race #231 and the documented gap between the target verified-MFA completion contract and the current bootstrap-marker sequence remain residuals; this relocation neither fixes nor expands them. Static review plus conserved local receipts does not establish release, runtime/SIT acceptance, browser behavior, full required CI, image build/boot, merge readiness or formal stage completion. No acceptance waiver is granted. Any source change requires the applicable exact-head review/evidence discipline.


