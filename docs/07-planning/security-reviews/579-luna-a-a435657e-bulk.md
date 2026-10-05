# Ordinary review A — P0 bulk candidate

- **Model / role:** Official GPT-6 Luna, fresh independent ordinary reviewer A.
- **Reviewed head:** `a435657e747b8c12ceb5784e1c991a70a175c51c`
- **Comparison:** accepted remote `main` `8ddb9de8d4d242a0832f6f91e12872300480a905` → candidate (merge base verified at accepted-main SHA).
- **Independence:** No authorship, direction, or remediation of this candidate. Historical review verdicts and authored status notes were treated as claims/evidence to challenge, not clearance.
- **Worktree:** Exact requested HEAD verified before and after; source worktree clean before and after. Report written only to the requested private evidence directory.

## Scope checked

Read the supplied review packet and repository operating instructions (`AGENTS.md`, `agent-workflow.md`, `CLAUDE.md`, status and current decision log). Read the relevant identity/authentication, security, RBAC, multi-tenancy, portal-origin ADR, pending-action, realtime, observability and audit contracts. Reviewed the accepted-main-to-candidate API/security delta, including:

- Identity resolution, runtime route policy enforcement, route registration/coverage, strict-vs-shadow configuration, independent persisted scope facts, shadow outcome attribution/recording, and native-vs-policy result separation.
- Native work-item realtime subscription, reauthorization, topic scoping, event payload minimization, session/origin checks and delivery filtering.
- CSRF/session origin binding; dual Better Auth instances and persisted session portal; local factor policy/enrollment/session invalidation; operation-bound step-up and MFA reset; observer/CAS and audit paths.
- Metrics listener token handling, failure behavior and bind/exposure configuration.
- All migration SQL and snapshots in the candidate: 0080–0086 plus journal. The candidate contains no migration 0087; “80→87” was checked against the actual journal and source delta.
- Focused API integration regressions for strict policy, shadow mode, CSRF, MFA, realtime and valid outsider/member authorization. The packet’s corrected runtime fixture was considered; the earlier bootstrap-owner/stale-workspace attribution was not treated as a product defect. Existing real-outsider regressions were inspected as valid evidence.

## Checks and evidence

- Inspected source and tests; **no tests or runtime checks were run** in this review. This follows the packet’s instruction to avoid the owned heavy runtime window and does not claim a test pass.
- The packet records author-run checks and counts, including API typecheck, shadow PostgreSQL 35/35, production-listener PostgreSQL 13/13, strict/policy and other focused suites, but those are reported as author evidence only; I did not independently reproduce them.
- Current runtime image, hosted CI, migration execution, browser journey, performance run, and security scanner disposition were not independently run or verified here.

## Findings

No blocking or non-blocking substantive defects found in the inspected API/auth/authority/migration scope.

Specific risk checks: identity grants are derived from persisted identity/membership facts and fail closed on ambiguous or malformed authority; instance-admin global reach does not become workspace capability authority; canonical shadow facts are not inferred from native allow/deny, and shadow observer work is gated off when shadow mode is off; unevaluated/error/saturation evidence remains distinct from agreement. Strict enforcement requires complete registered authority evidence and rejects when evidence/identity cannot be built. Session portal binding and host isolation are explicit; CSRF requires same-origin evidence plus a session-bound signed token for ambient agent-session writes. Step-up proofs bind session, person, operation, route, version and request body, are consumed under row lock, and mutation proof consumption is transactionally coupled to protected writes. MFA policy writes serialize on the singleton row and the role-delete trigger preserves the required-role invariant. Native realtime reauthorizes subscriptions and limits the emitted payload to a work-item key while filtering internal events from customer credentials. Migrations 0080–0086 preserve intended legacy-null session compatibility and add constraints/indexes for the new persisted state.

The packet’s invalid owner/nonmember fixture attribution was not repeated as a finding. Valid outsider/member route regressions were inspected and no corresponding production reach defect was identified.

## Verdict

**CLEAR — no findings** for this assigned ordinary API/auth/authority/migration review scope at the exact candidate SHA.

This verdict is not hosted/runtime acceptance, does not disposition CodeQL alerts, and does not replace the required independent GPT-6 Sol security review or any broader phase finalizer. It also does not imply completion of P0 or authorize merge in the absence of the repository’s other required gates.

## Limits

No live GitHub checks/review state were queried; no test suite, PostgreSQL runtime, image, browser, benchmark, or scanner was run. Large generated/UI/artifact-only parts of the 669-file delta received no exhaustive visual/product review; this pass was deliberately risk-focused on the requested API/auth/authority/migration surfaces.
