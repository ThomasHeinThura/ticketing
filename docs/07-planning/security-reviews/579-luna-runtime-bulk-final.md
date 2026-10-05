# Independent ordinary review — P0 bulk runtime/migrations scope

- **Candidate:** `19a9bcbad8c0cc8b2af65fa4f6aa5606de37f855`
- **Accepted base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`
- **Original reviewed candidate:** `add896ebbce5c827d30f89d80fed5e48c87b3552`
- **Context:** fresh independent GPT-6 Luna reviewer; did not author, direct, or remediate this candidate. Model build/session identifier is not exposed in this tool context.
- **Working tree:** clean `codex/p0-bulk-integration`; Git HEAD verified equal to requested candidate.
- **Verdict:** **No blocking findings in assigned scope.** The prior P2 overlapping-refresh stale-snapshot finding is structurally addressed. This report clears only the runtime/migrations/CI areas inspected here, not the complete P0 candidate or its other review scopes.

## Finding disposition

The original report identified that a slow earlier poll could complete after a newer poll and reapply stale logger settings. `config-refresh-version.ts` now assigns every read a sequence, accepts only completions at least as new as the latest completed read, validates positive safe-integer config versions, and applies only versions greater than the current applied version. Thus a later-started read that completes first prevents an earlier completion from rolling back its snapshot. Failed latest reads retain the last applied settings; an older delayed success cannot clear a newer failure interval. A successful validated same-version read does clear a prior warning interval without needlessly reapplying settings. `stop()` invalidates pending completions before listener shutdown. The four added regression cases cover newer-before-older completion, failure/recovery and warning re-arming, stale success after newer failure, and completion after stop.

No further issue was found in this fix by source inspection or the focused unit run.

## Inspected scope

- Refresh sequencing, initial version capture, persisted version CAS path, runtime start/stop and logger application.
- Finite HTTP/audit metric labels and route allowlisting; dedicated metrics registry.
- Internal listener exact path/method, duplicate/malformed bearer handling, per-request database digest reread, fixed-length timing-safe digest comparison, and shutdown.
- Audit failure notification and caller behavior across observability settings/token rotation, audit reads, pending-action requests/decisions/self-reads, and expiry batches. `appendAuditLog(tx, ...)` uses a nested Drizzle transaction/savepoint on the same session, so callers can catch an append failure without leaving the surrounding PostgreSQL transaction aborted. Expiry batches count each failed append, aggregate their log/notification by batch, and preserve the expiry/outbox mutation. Durable notification retries are bounded; metric/log signals remain the fallback if notification persistence is unavailable.
- Migration journal: accepted base has 80 entries; candidate has 87 and preserves the exact accepted 80-entry prefix, followed by migrations 0080–0086.
- API test TypeScript include now explicitly includes the cross-tree `tests/e2e/helpers/mfa-csrf-app-fixture.ts` helper.
- CI web build steps supply `VITE_API_URL: ""` consistently for build, visual and G11 jobs. The canonical G11 budgets and test manifest were not modified in the remediation delta. The board drag measurement still waits for exactly 100 writes and asserts all 100 responses are HTTP 200 with CSRF headers, then checks persisted state; its measurement interval and existing limits are unchanged.

## Checks actually run

Command (from repository root):

```text
pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/observability-config-refresh-version.test.ts ../../tests/api/observability/logger.test.ts ../../tests/api/observability/metrics-listener.test.ts ../../tests/api/observability/metrics.test.ts ../../tests/api/observability/settings.test.ts
```

**Exit 0 — 5 files passed, 25 tests passed.** Vitest emitted its existing esbuild/oxc options notice.

Read-only journal comparison against the accepted base: **80 accepted entries; 87 candidate entries; accepted prefix exact.**

## Limitations and residual acceptance

No PostgreSQL integration test was run: no concrete remaining defect from this inspection justified starting a fresh isolated database, and the owning actor is running isolated PG work. I did not rerun full suites, image proof, browser baselines, G11, or hosted CI; concurrent actors own those checks, and the supplied current image/G11 results are author evidence, not reviewer execution or hosted exact-head CI. No GitHub review/check state was inspected. No secret values were read into or copied to this report. No tracked files, commits, PRs, or persistent deployments were changed.
