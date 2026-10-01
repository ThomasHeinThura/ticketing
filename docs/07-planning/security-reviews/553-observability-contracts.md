# Security review — P0 observability contracts and design dispositions (#553)

**Reviewed head:** `ab92c7d8a8920436be1bea2f896d0c1bd158e708`
**Accepted comparison base:** `adf97f067c9b4f73b36f2a870a5e2c5319f93ebe`
**Verdict:** PASS for the documentation-level security contract and bounded design dispositions; no blocking finding in the exact reviewed source. This is not runtime acceptance, owning-review closure, or merge authorization.

## Independent reviews

Three fresh GPT-6 Luna ordinary reviewer contexts and one fresh GPT-6 Sol security-review context cleared the exact reviewed head. Each report describes a fresh reviewer context; the reviewers state they did not author, direct, or remediate this candidate. The Sol reviewer also states they did not direct or remediate the prior ordinary reviews.

- Luna ordinary review [5380832497](https://github.com/ThomasHeinThura/ticketing/pull/553#pullrequestreview-5380832497): PASS on the bounded five-file disposition delta, with prior full-contract coverage carried forward. Report: `/private/tmp/pr553-ab92-luna1-delta-review.md`.
- Luna ordinary review [5380798857](https://github.com/ThomasHeinThura/ticketing/pull/553#pullrequestreview-5380798857): COMMENTED / PASS on the five-file disposition/history delta, with no blocking finding. Report: `/private/tmp/pr553-ab92-luna2-delta-review.md`.
- Luna ordinary AUTH review [5380782972](https://github.com/ThomasHeinThura/ticketing/pull/553#pullrequestreview-5380782972): PASS on the 15-file contract remediation through `a48a481e63c0fac91d3570a28aff9a54751e3465`, the five-file delta to this head, current auth and route-policy source, owner docs, and cited reviews. Report: `/private/tmp/pr553-ab92-luna3-auth-review.md`.
- GPT-6 Sol security review [5380902002](https://github.com/ThomasHeinThura/ticketing/pull/553#pullrequestreview-5380902002): PASS on the full current documentation diff and disposition delta, current auth plugin and policy/route coverage source, AU-10/AU-14 and PA-11/PA-15 owner contracts, ordinary reports, and live GitHub review/check state. Report: `/private/tmp/pr553-ab92-sol-security.md`.

The review records were checked through the GitHub PR review API. Each is `COMMENTED` and has `commit_id` exactly `ab92c7d8a8920436be1bea2f896d0c1bd158e708`. The Sol report records the comparison base above and confirms the three ordinary reviews are on this exact head.

## Scope and security assessment

The reviews assessed the current contract and the five-file disposition/history delta. The Sol review found no blocking documentation defect across:

- Hash-only 32-byte metrics-token storage; one-time display; PostgreSQL reread on each scrape; fixed-length constant-time comparison; immediate rejection of the old digest for new requests after commit; and fail-closed behavior when token lookup fails.
- A future internal Node `GET /metrics` listener on port 9464 with no Traefik or host publishing, no Hono API mount, and a constructor manifest compared with the constructed listener. The present Hono route/fixture is explicitly a placeholder; the separate listener and manifest are not implemented.
- Allowlisted and redacted structured logs; finite metric labels and registered route templates; instance-wide business aggregates; and withheld job, database-operation, and plugin-instance dimensions whose producers lack finite owner contracts.
- Operation-bound step-up that preserves the pending-action ID and payload-hash binding, uses the single registered metrics-rotation operation, binds the fixed route/key/version and server-canonical parsed `{version}` body, and consumes confirmation atomically with authority/session rechecks, version CAS, and token-hash rotation. Unsupported required proof fails closed.
- Future SSO proof requirements, including challenge/session/subject/connection-bound state and nonce, `prompt=login`, signed bounded `auth_time`, a callback deadline, and mapped fresh `amr`/`acr` evidence when MFA is required. A static upstream-MFA setting is not proof.
- AU-14's mutation-success and pending-action self-read fail-closed behavior, safe counter/log signal, and separate unfinished durable notification requirement.

## Design-only dispositions

Exactly nine findings were removed from active owner tables and retained verbatim in their owning review-history sections. The reviews clear only these design clauses:

1. Architecture/operations: planned Pino and `prom-client` choices and dependency declaration.
2. Architecture/operations: RUM explicitly deferred with its future route, payload, privacy, and retention requirements.
3. Architecture/operations: public live/ready health-path consistency, already aligned on the reviewed base.
4. Architecture/operations: stale metrics command and port in the runbook.
5. Security: action-bound fresh step-up instead of a session-wide elevated window.
6. Security: log allowlisting/redaction and workspace-audit project-reach filtering.
7. Security: finite/withheld metrics labels, constant-time token comparison, and separate internal listener contract.
8. L2 RBAC/security: named pending-action step-up endpoint and preserved pending-action binding.
9. L8 operations: metrics token/port documentation consistent with the future listener and current unavailability.

## Residuals and limits

The upstream-MFA checkbox finding remains active. The current MFA owner/runtime resolution and God Mode security-posture treatment remain outstanding. Current source has no enabled `twoFactor`/passkey factor verifier or fresh SSO step-up adapter; no working MFA, enrollment, or rotation path is claimed. The actual Node listener, manifest, metrics producers, runtime tests, and operations verification remain unbuilt. AU-14 durable notification to every current instance administrator is unfinished; an alert or counter does not satisfy it. Unrelated findings remain open.

No human read is claimed. Owning-review acceptance, H1–H6 approval, ADR acceptance, implementation/runtime acceptance, and stage completion remain open. This note does not waive a gate or authorize merge.

## Checks actually performed

For the documentation candidate, the author ran and recorded these passing checks: `pnpm check:env` (32 reads registered), `pnpm check:events` (31 published event keys registered), `pnpm check:vocabulary` (73 table declarations registered), `pnpm check:reviews`, and `git diff --check`. The Sol reviewer independently reports `git diff --check adf97f0..HEAD` and `pnpm check:reviews`, `pnpm check:env`, `pnpm check:events`, and `pnpm check:vocabulary` passed, plus a programmatic comparison confirming all nine original rows are preserved verbatim and upstream-MFA remains active.

No runtime tests, installation, build, migration, scrape, token rotation, browser check, image build, or deployment was run for this documentation-only work. The Sol report's GitHub check observation at review time is not an acceptance claim: it reports several build/integration/route-policy/visual/gate-probe checks passing, while `pull request template + security review` and GitGuardian were failing and G11 was not enabled. Required checks and all later exact-head gates remain for the orchestrator to verify.
