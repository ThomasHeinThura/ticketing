# Independent ordinary review — PR #579 runtime/migrations slice

- **Candidate:** `add896ebbce5c827d30f89d80fed5e48c87b3552`
- **Base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Context:** `/root/p0_bulk_runtime_review`, fresh independent review context; GPT-6 Luna ordinary-review lane. Exact model build/session identifier is not exposed in this tool context.
- **Scope:** additive migrations / schema closure; Pino and Prometheus privacy bounds; settings CAS and runtime refresh; metrics listener digest reread, rotation and lifecycle; audit failure handling, pending-action transactions and expiry batches.
- **Verdict:** **Changes requested** for one bounded runtime consistency defect (P2); no P1/P0 blocker found in the assigned slice by inspection. Candidate still requires the independent Sol security review and integrated acceptance gates.

## Finding

### P2 — overlapping refreshes can roll settings back to an older snapshot

[apps/api/src/instance/observability/runtime.ts:125](/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2/apps/api/src/instance/observability/runtime.ts:125) launches a new database refresh every five seconds without awaiting or serializing the previous refresh. Each successful response applies its snapshot at line 133. If refresh A reads the old row and stalls, a later refresh B can read and apply a newer committed configuration, then A can complete and reapply the stale configuration. A sufficiently delayed query can overwrite several later refreshes and leave that replica stale until a later successful query. This violates the stated complete-snapshot refresh behavior and can make log-level changes revert transiently or for an unbounded interval while an old query remains pending.

Serialize refreshes or reject stale completions (for example, with a monotonically increasing refresh generation); retain the existing last-known-safe snapshot on failure. Add a focused ordering regression when this candidate is remediated.

## Review notes by assigned area

- **Migrations:** `0080`–`0086` are additive and append journal indices 80–86. Inherited entries remain present; no inherited SQL was edited in this slice. The new SQL contains the portal constraint, service-calendar table/index/FK, comment-visibility closed check, step-up/local-factor/settings columns and constraints, closed log-level JSON check, and required-role-delete trigger. The final trigger takes the singleton row lock and the policy writer first takes a `KEY SHARE` lock on a selected role before the singleton lock, matching the role-delete → singleton lock order. No concrete migration or lock-order defect found by inspection. I did not run the migration chain.
- **Logging/metrics:** Pino event construction is a typed allowlist; routes are constrained to the registry or `unmatched`; metric labels use finite method/status/operation sets and a dedicated registry. No raw request, exception, token, identity or tenant labels enter these surfaces in the reviewed code. The core logger/metrics/listener/settings tests passed.
- **CAS/rotation/listener:** settings updates and token rotation use `observability_config_version` compare-and-swap. The listener checks exact `GET /metrics`, rejects malformed/duplicate Authorization values before DB access, reads the digest on each authorized scrape, uses fixed-length timing-safe digest comparison, and closes via the lifecycle stop path. No plaintext digest/token logging path found in assigned files. Existing evidence in status is author-provided evidence for earlier SHA(s), not reviewer-run proof for this SHA.
- **Audit and pending actions:** pending-action request and decision paths catch nested audit append failures while preserving transaction state/outbox behavior; self-read audit failure records the signal, attempts admin notification, then fails closed. The expiry worker counts every failed append and emits one log/notification per failed batch. AU-13 audit reads preserve read success after audit append failure. No concrete defect found in these paths by inspection.

## Checks actually run

- Node: `v24.19.0` from the supplied local runtime path.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts` with `logger.test.ts`, `metrics.test.ts`, `metrics-listener.test.ts`, and `settings.test.ts`: **4 files, 21 tests passed**.
- Focused integration selection (`pending-action-expire.test.ts`, `pending-action-service.test.ts`, `audit-read.test.ts`): **43 tests failed before test execution could use the database**, with PostgreSQL `password authentication failed for user "postgres"`. This is an environment/setup failure, not evidence of a candidate defect; those cases remain unverified by this review.
- No full unit/integration suite, image build, container boot, browser check, live migration, GitHub status/review, or author evidence replay was performed.

## Residual acceptance gaps

The supplied status snapshot reports image/migration/listener/CAS evidence at an earlier SHA and explicitly distinguishes later code/tooling changes from that image proof. I did not treat that evidence as testing this exact SHA. The assigned transaction integration tests could not connect to PostgreSQL in this environment. This report is limited to the assigned runtime/migration slice and does not clear other candidate areas or the required GPT-6 Sol review.
