# Independent GPT-6 Sol security delta review — PR #583

**Reviewed head:** `8f6ca5375171eb0740fae7d4eecfe56deaef2c0b`  
**Comparison base:** prior Sol-cleared `d479a72a3dd3f4f48473e62d5d933ad83c94fa2c`  
**Reviewer and independence:** GPT-6 Sol in the prior security-review context; I did not author, direct or remediate the candidate or this delta. No source edit, commit, merge, deployment or phase finalizer was performed.  
**Verdict:** **Security delta clear on the exact current head. No blocking or non-blocking delta finding.** The previous d479 security report is source-bound to its own head; this review covers every later changed file and does not relabel it.

## Scope and contract

I verified the clean checkout and live PR #583 both resolve to the reviewed SHA. The delta is exactly eight files: `apps/api/src/utils/workspace-access-middleware.ts`, five project-read router declarations (`column`, `project`, `task`, `work-item`, `workflow-rule`), generated OpenAPI JSON and the project-reach integration test. I read the 2026-10-04 canonical project-reach decision and prior ordinary Luna delta report, then inspected the entire diff, shared middleware branch order, all eleven route call sites, the reach/capability regression matrix, and the author-retained PostgreSQL result.

The authoritative decision preserves project reach separate from workspace membership. For a project lookup with no row after the existing reachable-workspace predicate, the new 404 occurs only when `requireProjectReach` is true. The lookup still rejects NUL IDs before SQL. A resolved project still passes through `projectReadDecision`; denied reach gives a masked 404 and reached but incapable callers get 403. The delta changes no lookup predicate, role, capability, policy registration, grant, write handler or mutation route's `requireProjectReach` setting. Mutations therefore retain the unresolved-project 400. The eleven GET declarations now describe malformed/NUL 400 and missing/out-of-reach 404; OpenAPI snapshot follows those descriptions.

The integration test sends existing foreign and valid missing IDs to all eleven routes and asserts byte-identical 404 `Project not found`; it sends encoded NUL to all eleven and asserts 400. It compares audit and outbox counts before and after. Its earlier persisted-fixture matrix tests plain membership denied, direct/sees-all reach allowed, reached but missing capability 403, global-admin-only reach denied, and shadow agreement. No new side effect is introduced by the changed branch; the unresolved lookup throws before `next()`.

## Checks and evidence limits

- I ran `git diff --check d479a72a..8f6ca537` — pass.
- I ran `pnpm check:openapi` — pass, **173 operations**.
- I inspected `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/p0-project-denial-integration.log`: author-run focused PostgreSQL test **1 file, 1/1 passed** at this source. I did not run that integration test myself. The independent Luna reviewer attempted it, but local PostgreSQL authentication failed in setup; that attempt is not a test pass.
- At live inspection, PR #583 matched this exact SHA; route-policy/permission, OpenAPI, static, visual, build and gate-probe jobs were green. Integration, E2E and G11 were in progress; template/security-review was red. No full-CI or performance acceptance is inferred.

**Blocking delta findings:** none.  
**Non-blocking delta findings:** none.

The original author packet was accidentally overwritten by the ordinary reviewer. I do not use its present contents as original author evidence or claim its original bytes remain. The independent Luna report and retained author PostgreSQL log are identified separately above. Prior security source clearance, this exact-head delta clearance and remaining hosted/runtime/phase gates are distinct. This verdict does not resolve G11, the native-project-count versus RBAC status ambiguity beyond the tested denial behavior, configuration evidence, dates, strict/rollback acceptance, protected merge or the independent Sol P0 finalizer.
