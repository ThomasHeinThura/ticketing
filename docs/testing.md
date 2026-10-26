# Test on the laptop

Use laptop SIT first; cloud SIT at Technexus follows verified local journeys and the consolidated review. GitHub CI is not used as a gate. Thomas requires one active local deployment using only `deploy/compose.testing.yml`; superseded native and parallel test deployments stay stopped, with data preserved.

## Setup

Use the pinned pnpm version and Node 24+ for checks. Local SIT serves `https://ticketing.localhost` and `https://portal.localhost` on443 from one locally built image. Start it with `docker compose --env-file "$SIT_COMPOSE_ENV" -f deploy/compose.testing.yml up -d --wait`; the private environment file selects the built image and private configuration directory. Restore a verified testing copy before the first migration. Never rerun the existing SIT account seeder or reset a customer database.

API integration tests resolve `TASKDESK_DATABASE_URL`, then `.env`, then the per-worktree default. Use a separate disposable database whose name ends `_test`; never reset the deployed SIT database. Local integration does not automatically start the CI PostgreSQL Testcontainer. The optional test-only `TASKDESK_TEST_VALKEY_URL` lets isolated Linux runners use an authenticated Valkey service at the dedicated `taskdesk-test-valkey:6379` test-network alias; fixtures validate that boundary and do not stop or flush it. Without it, they create their own Testcontainers service. Keep synthetic databases and generated credentials separate from customer data. Do not start another persistent application deployment for these checks.

## During implementation

Run targeted unit tests after logic changes, PostgreSQL integration tests after persistence/API changes, permission tests after routes/auth changes, and affected browser journeys after UI changes. Fix failures and repeat the affected checks. Fixture browser tests help diagnose UI; they do not prove persisted integration.

```sh
pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts <affected-test-files>
pnpm test:permissions
pnpm --filter @taskdesk/web build
pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts <affected-specs>
```

Build the image with `VITE_API_URL=''` so each host uses its own `/api`; both entries are served through the API with separate configured origins. A development-default build cannot establish portal same-origin evidence. Use a separate `_test` database for integration resets.

The Playwright config starts preview on port 4178. Portal and full persisted-runtime journeys need their own configured origins and backend. Read the selected spec; do not assume a mocked response is the real API.

## At the phase boundary

```sh
pnpm lint:ci
pnpm typecheck
pnpm test
pnpm check:route-policy
pnpm test:permissions
pnpm check:tokens
```

Run Trivy filesystem/dependency and image scans, plus Gitleaks, locally. Keep runtime secrets out of reports and build contexts. Record scanner failures and assessed findings explicitly; a reviewed fixture finding is different from a clean scan.

Also run affected integration suites, persisted end-to-end journeys, design/parity and accessibility checks, and image build/boot when the shipping image changes. `pnpm lint` writes files; prefer read-only `lint:ci` for verification. Do not rerun unrelated expensive suites after every small edit.

Open every affected screen in a real browser. Check both agent and portal journeys against persisted data, reload, denial cases, and Kaneo reference images. Cover desktop/tablet/mobile and light/dark for parity; inspect every captured pair before calling it reviewed. Record URLs, screenshots, source and test results in the phase report.

## Integration databases and known baseline failures

- **Fresh scratch database per run.** P4/P5 migrations were edited in place before their first real apply, so the integration suite needs a freshly created `_test` database. A reused database keeps old foreign-key rules and gives false failures. Use scratch Postgres 62871 (never the native 62870 that holds the live database), create a new database per agent or run, and drop it at the end.
- **Full integration on the final tree** is required before a phase review (P4: 314 files / 4241 tests). Lane suites are not a substitute.
- **25 October repair evidence:** the contrast analyzer/manifest and CI-script defects have been repaired; scoped gate results are in the report. Re-run on the final tree. Port-bound MFA fixtures still require pausing only the task-owned stack; do not kill other processes. Never treat a historical baseline failure as a waiver.
- **Generators are coordinator-only:** `openapi:write`, matrix `REGEN_MATRIX`, `generate:route-metadata`, and any `vite build` (regenerates route trees). Lanes do not run them.

## Review and honest evidence

One fresh independent AI phase review includes functional integration, original Kaneo composition and security. The reviewer did not implement the phase; provide a neutral requirements/diff/evidence packet rather than a fork of the implementation conversation. Give it the actual diff, test output and browser evidence. Repair findings and verify those fixes within the same review. Thomas gets one consolidated report and selected walkthrough, then makes the acceptance decision.

Never report a test name, route, component, screenshot count or CI status as proof of a journey that was not executed. Record unavailable databases, browser/container tooling and real Entra credentials as blockers. Keep performance thresholds; diagnose failures rather than retrying until a lucky pass.

## Whole-product journey coverage

| Area | Local evidence needed as it is implemented |
| --- | --- |
| Core/service desk | Same persisted records across board/list/detail/scheduling; hierarchy/deletion/concurrency denials; submit/triage/SLA/workflow/approval journey |
| Portal/identity/governance | Public-only customer data, organisation/host/session isolation, deprovision/revoke; configuration/notification/retry/automation/key/MCP journeys |
| Planning/time/cost | Cycle scope/completion and honest burndown; keyboard timesheet/timer/reload/midnight; snapshotted costs, budgets and restricted rates |
| Reports/knowledge/change | Known-answer aggregates, all three report tiers, scoped export/drill-down and customer denials; publish/visibility/deflection; change freeze/CAB/rollback/release notes |
| Import/cutover | Dry-run mapping, provenance/history/files, interruption/resume/rerun, reconciled counts/losses and rollback against copies |
| Customer readiness | Fresh install/upgrade, supported browser/device/accessibility matrix, realistic load, translations/docs and isolated full restore |
| Selected extensions | Real provider/delivery/sync/revocation and failure handling; for advanced candidates define expected behavior before writing acceptance assertions |

Real Entra/provider credentials, marketplace registration and external penetration testing remain distinct external evidence. A local fake provider is useful for regression testing and cannot satisfy a real-provider acceptance claim.
