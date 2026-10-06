# Ordinary API/auth/authority review — P0 candidate

- **Candidate SHA:** `cf513e8b33bf79f6fa2e985188c386c9148286d9`
- **Reviewer:** fresh independent GPT-6 Luna context, reviewer A; did not author, direct, or remediate this candidate.
- **Verdict:** **CLEAR — no blocking or non-blocking substantive findings identified in the assigned scope.** This is an ordinary review verdict only; it is not the separate GPT-6 Sol security review, the P0 phase finalizer, CI acceptance, or a phase claim.
- **Checkout:** exact requested HEAD before and after review; worktree clean at both checks. No source changes or Git mutations.

## Scope inspected

Read the review packet and repository workflow/control guidance, plus the canonical auth-and-identity, security-model, RBAC, API design, data model, migration, audit and runbook contracts. Inspected full relevant implementation in `apps/api/src/permissions/{resolve-identity,shadow-evaluation,shadow-middleware}.ts`, shadow config/store, workspace capability and reach middleware, `auth.ts`, local-factor policy/service, step-up service, CSRF/origin middleware, MFA reset/admin checks, API request wiring, WebSocket Origin policy, and migrations 0080–0086 with Drizzle journal metadata. Reviewed native persisted event/outbox and reach-context seams in the changed source.

## Review observations

- Identity resolution builds authority from persisted user/person/membership/role facts; malformed/ambiguous workspace memberships are skipped. Customer identity cannot inherit workspace roles. Role scope and seeded-role provenance are checked. Instance-admin global reach does not mint workspace capabilities. Key identities carry a closed empty capability subset where the canonical key subset is unavailable, rather than inheriting owner authority.
- Shadow comparison keeps native authorization markers separate from canonical evaluator decisions. HTTP status is retained as diagnostic and only contradictory/missing markers become unknown; native allow/deny is not used as canonical authority. Work-item reach facts are loaded from persisted project/workspace rows. Evidence workspace IDs from request scope are independently verified before persistence; unverified IDs are nulled. Shadow mode off exits directly through `next()` before attribution, identity loading, evidence writes, or extra middleware queries. Shadow saturation is recorded as unevaluated rather than silently counted clean.
- Local-factor policy parsing/read paths fail closed on invalid or missing state; upstream MFA/passkeys are explicitly documented as unavailable and do not satisfy local verification. Step-up tokens bind actor, session, operation, route, body/version, expiry and one-time consumption. MFA reset rechecks current instance-admin/session authority, disallows impersonation, binds the target and verification note, consumes proof in the mutation transaction, revokes sessions and keys, creates in-app notice, and attempts the specified audit/notification handling.
- Cookie-domain host isolation is enforced; session portal is persisted and checked against selected host. Unsafe ambient-session requests require agent origin and matching CSRF cookie/header/session binding; API-key credentials are exempt only after actual resolution. WebSocket checks compare Origin and persisted session portal. Public portal API remains denied per packet.
- Journal verification: accepted baseline has 80 entries, candidate has 87; the first 80 entries compare exactly and the appended entries are 0080–0086. Inspected SQL is additive; 0086 adds the required-role delete trigger with the documented role-row/singleton lock ordering. This is prefix metadata/SQL inspection only, not a database migration run.

These are source-inspection conclusions, not claims that unavailable/explicitly future contracts (upstream-MFA verifier, passkeys, strict-policy cutover, or portal public API) have shipped.

## Reproductions and checks

- `git rev-parse HEAD` before and after: exact candidate SHA.
- `git status --short` before and after: clean.
- Journal prefix script: `baseCount=80`, `headCount=87`, `prefixExact=true`, tail exactly migrations 0080–0086.
- Attempted focused pure tests:
  `pnpm exec vitest run --config apps/api/vitest.config.ts tests/api/permissions/shadow-evaluation.test.ts tests/api/permissions/resolve-identity.test.ts tests/api/auth/local-factor-policy.test.ts`
  **Could not start:** `vitest` executable is not installed/available (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). No test cases ran; no result is represented as passing.

## Limits

No broad/Turbo/PG/browser/build/Docker checks were run, per packet coordination limits. No integration runtime was available in this review. Runtime author owns those heavy checks. No finding is inferred from prior reviewer verdicts or prior candidate scans. Full Sol review and P0 phase-finalizer remain separate required passes.
