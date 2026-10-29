# Testing the whole product

Testing is whole-product, not per phase (Thomas, 28 Oct 2026). Three levels; each change goes through code → feature → design → browser testing ([AGENTS.md](../AGENTS.md)).

## Level 1 — every pull request

GitHub CI is a required gate. All required checks must pass; a failing gate is fixed, never exempted or retried until lucky.

| Area | CI job / local command |
| --- | --- |
| Code | `pnpm lint:ci`, `pnpm typecheck`, `pnpm test` (unit + component), integration on PostgreSQL 18 (4 shards, `vitest.integration.config.ts`), `pnpm test:permissions`, `pnpm check:route-policy`, domain coverage 90% |
| Contracts and registers | `pnpm test:contract` (OpenAPI drift; breaking changes need Thomas's approval in `scripts/ci/openapi-approved-breaks.json`), env/vocabulary/events/reviews/skips/overrides registers, gate checkers + red probes, CI matches `ci-cd.md` |
| Features | `pnpm test:e2e` (mock-backed and Testcontainers journeys, `apps/web/e2e/`) |
| Design | `pnpm check:ui:raw-elements`, `pnpm check:tokens` (contrast), visual regression G8 (`pnpm test:visual` in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` container; regenerate baselines only for intended changes), accessibility G4 (axe) |
| Performance | G11/G13 budgets (`apps/web/e2e/performance.bench.ts`), bundle budgets; thresholds never change without Thomas |
| Security | Gitleaks secret scan, dependency audit, CodeQL, Trivy (release image) |

Locally before opening the PR: run the affected targeted tests first, then the gates above that the change touches, then open every affected screen on local SIT (below). Integration tests use a fresh dedicated `_test` database — never the live `taskdesk_browser_journey_1022_test` (62870).

## Level 2 — every release (merge to `main`), before deploying

1. **Release regression suite on local SIT** (to be built, backlog L-03a): persisted Playwright journeys against `https://ticketing.localhost` / `https://portal.localhost` with real API and database, covering every area per role. Seed specs live in `apps/web/e2e-sit/`.

| Area | Journeys |
| --- | --- |
| Core work | create/assign/schedule/rank/relate/comment/attach/delete (pending action) across board, list, detail, Calendar, Gantt; reload and a second session; hierarchy and concurrency denials |
| Service desk | portal submit → triage → work item → SLA clock/pause/breach → approval/CAB → resolution; request types, calendars, workflows, audit |
| Portal and identity | customer raise/track/approve/rate/reopen; no internal data or other organisation visible; invitations, OTP/magic link, SSO with a test IdP, MFA, sessions, deprovisioning; agent cookie never authorises portal |
| Governance | roles/teams/custom fields/flags; notifications, digests, quiet hours; automations dry-run; webhooks retry/SSRF; API keys, MCP approval; impersonation audit; God Mode |
| Planning, time, cost | cycle plan/complete and burndown; timer/manual/weekly timesheet; rates, budgets, capacity |
| Reports, KB, change | 20 fixed reports with drill-down and export; dashboards; KB publish/visibility/deflection; change freeze/CAB/rollback; release notes |
| Import | CSV and each adapter dry-run → mapping → run → interrupt/resume/rerun → reconciliation |

2. **Image:** CI builds, scans (Trivy), signs and publishes; deploy only that signed digest.
3. **Technexus smoke** after deploy: health, HTTPS on both hosts, separate sessions, sign-in, one journey per area.

## Level 3 — scheduled (weekly and before 1.0)

Load test (k6, realistic data), backup → isolated restore rehearsal, upgrade from the previous release, full accessibility pass (keyboard and screen reader), full role × light/dark × desktop/tablet/mobile browser matrix, Trivy/dependency re-scan, Kaneo `42bb8011` parity review. Real Entra (25 cases), external penetration test and marketplace/provider registration are Thomas's external evidence; local fakes never satisfy them.

## Setup

Use the pinned pnpm and Node 24+. Local SIT: one deployment, `docker compose --env-file "$SIT_COMPOSE_ENV" -f deploy/compose.testing.yml up -d --wait`, image built with `VITE_API_URL=''`. Never rerun the SIT account seeder or reset customer data. Integration databases: scratch PostgreSQL 62871 or Testcontainers, one new `_test` database per run, dropped afterwards. Generators (`openapi:write`, matrix regen, `generate:route-metadata`, web builds) run one at a time; `pnpm check:tokens` rebuilds `dist`, so never run it during a bench.

## Honest evidence

Never report a test name, screenshot count or CI status as proof of a journey that did not run. Distinguish mocked from persisted evidence. Record unavailable tooling and external credentials as blockers. Keep performance thresholds; diagnose failures.

Report maintenance: run `node --test scripts/report/build-data.test.mjs`, then `node scripts/report/build-data.mjs` and `node scripts/report/generate.mjs` from the repository root. The rebuild derives counts only from the per-ID requirement index, retains every maintained phase and its acceptance/review/evidence metadata, and preserves the report timestamp; update that timestamp explicitly when recording new evidence. Invalid input or contradictory locked counts fail before replacement. The optional historical audit-directory argument is accepted with a warning and ignored; it cannot promote verification. Review the data/HTML diff and open the report at desktop, tablet and mobile widths in both themes before committing.
