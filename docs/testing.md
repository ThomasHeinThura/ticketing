# Test on the laptop

Use laptop SIT first; cloud SIT at Technexus follows verified local journeys and the consolidated review. Use the local feedback loop while building. GitHub CI is not used as a gate and is not waited on; the local gates below are the gate. Local SIT runs under OrbStack/native processes; public SIT is reached via the SSH proxy.

## Setup

Use the pinned pnpm version in `package.json`, Node 24+, PostgreSQL and the API environment. `pnpm install`, then `pnpm dev`; start `pnpm --filter @taskdesk/web dev:portal` for the separate portal entry when needed. `pnpm seed` and the SIT seeder serve different purposes: inspect their inputs before using either. Never seed a customer database.

API integration tests resolve `TASKDESK_DATABASE_URL`, then `.env`, then the per-worktree default. Use a dedicated database whose name ends `_test`. Local integration does not automatically start the CI PostgreSQL Testcontainer. Some browser journeys also require a container runtime; document that prerequisite rather than treating an unavailable runtime as a pass. Use isolated native PostgreSQL and application processes for laptop SIT when appropriate. Keep synthetic databases and generated credentials separate from customer data.

## During implementation

Run targeted unit tests after logic changes, PostgreSQL integration tests after persistence/API changes, permission tests after routes/auth changes, and affected browser journeys after UI changes. Fix failures and repeat the affected checks. Fixture browser tests help diagnose UI; they do not prove persisted integration.

```sh
pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts <affected-test-files>
pnpm test:permissions
pnpm --filter @taskdesk/web build
pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts <affected-specs>
```

For a native production-like laptop SIT, build with `VITE_API_URL='' pnpm --filter @taskdesk/web build` so each host uses its own `/api`; serve both built entries through the API with separate configured agent and portal origins. A plain development-default build points at localhost and cannot establish portal same-origin evidence. Pause the task-owned SIT API during unit fixtures that reserve its metrics port; use a separate `_test` database for integration resets.

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
- **Known failures at HEAD, not caused by phase work:** `pnpm check:tokens` fails on the `packages/ui` `pairs.json` contrast pairs (G3); three ci-script tests are stale; port-bound MFA fixture tests fail while a local stack holds the ports (pause the task-owned stack, do not kill other processes). Report them, do not exempt them.
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
