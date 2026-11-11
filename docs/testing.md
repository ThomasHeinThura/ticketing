# Testing the whole product

Testing is whole-product, not per phase (Thomas, 28 Oct 2026). Three levels; each change goes through code → feature → design → browser testing ([AGENTS.md](../AGENTS.md)).

## Level 1 — every pull request

GitHub CI is a required gate. All required checks must pass; a failing gate is fixed, never exempted or retried until lucky.

| Area | CI job / local command |
| --- | --- |
| Code | `pnpm lint:ci`, `pnpm typecheck`, `pnpm test` (unit + component), integration on PostgreSQL 18 (4 shards, `vitest.integration.config.ts`), `pnpm test:permissions`, `pnpm check:route-policy`, domain coverage 90% |
| Contracts and registers | `pnpm test:contract` (OpenAPI drift; breaking changes need Thomas's approval in `scripts/ci/openapi-approved-breaks.json`), env/vocabulary/events/reviews/skips/overrides registers, gate checkers + red probes, CI matches `ci-cd.md` |
| Features | `pnpm test:e2e` (mock-backed and Testcontainers journeys, `apps/web/e2e/`) |
| Design | `pnpm check:ui:raw-elements` (raw controls, library `Input` date/time/checkbox/radio types, native `title` tooltips on interactive hosts), `pnpm check:tokens` (contrast), visual regression G8 (`pnpm test:visual` in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` container; regenerate baselines only for intended changes), accessibility G4 (axe) |
| Performance | G11 and G13 both run in the single `performance - budgets (G11)` job (`pnpm test:perf`). That job is not a required check on `main` (removed 5 Nov), so neither blocks a merge; read them as report-only and diagnose misses in the app. Bundle budgets are enforced by `pnpm check:bundle-size` in required fast CI. Thresholds never change without Thomas |
| Security | Gitleaks secret scan, dependency audit, CodeQL, Trivy (release image) |

Locally before opening the PR: run the affected targeted tests first, then the gates above that the change touches, then open every affected screen on local SIT (below). Integration tests use a fresh dedicated `_test` database — never the live `taskdesk_browser_journey_1022_test` (62870).

If calibration stops the performance job before G13 runs, G13 remains unmeasured. Qualify it with the unchanged test cases and budgets; report-only G11 status does not establish a G13 pass.

## Level 2 — every release (merge to `main`), before deploying

1. **Release smoke** — `pnpm sit:smoke` (read-only; signs in every account in `~/.taskdesk/sit-credentials.json`, checks the API and opens the main agent and portal screens in Chromium, failing on HTTP 5xx/429, page or console errors and error boundaries). Against Technexus: `NODE_EXTRA_CA_CERTS= pnpm sit:smoke -- --agent https://<agent host> --portal https://<portal host> --credentials <file>`.
2. **Release regression suite on local SIT** (to be built, backlog L-03a): persisted Playwright journeys against `https://ticketing.localhost` / `https://portal.localhost` with real API and database, covering every area per role. Seed specs live in `apps/web/e2e-sit/`.

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

Use the pinned pnpm and Node 24+. Local SIT: one deployment using only `deploy/compose.testing.yml`. After independently verifying the initial restored database/files, set absolute private `SIT_COMPOSE_ENV` and `SIT_PRIVATE_DIR` paths and run `scripts/deploy.sh local`; its private Compose inputs must pin `SIT_IMAGE` to a signed release digest and set `TASKDESK_IMAGE_TAG` to the matching signed tag. It verifies both provenance and the cosign signature before pulling, runs the isolated migration and checks readiness without seeding or generating secrets. Images are built with `VITE_API_URL=''`. Never rerun the SIT account seeder or reset customer data. Integration databases: scratch PostgreSQL 62871 or Testcontainers, one new `_test` database per run, dropped afterwards. Generators (`openapi:write`, matrix regen, `generate:route-metadata`, web builds) run one at a time; `pnpm check:tokens` rebuilds `dist`, so never run it during a bench.

The manually dispatched PR-candidate workflow uses a separate package, signature identity and attestation from `release.yml`. It binds an exact same-repository feature SHA to the trusted main workflow SHA, scans both image platforms before publication, and marks the output for local SIT only. A candidate image is never a production release. The workflow does not deploy or replace local SIT data; its first dispatch and candidate deployment require separate approval.

The PR-candidate selector is an offline safety foundation only; canonical local SIT continues to use only `deploy/compose.testing.yml`, while a candidate generation layers the candidate-only `deploy/compose.candidate.yml` overlay onto `deploy/compose.testing.yml`. Thomas approved `TASKDESK_ROLE=web` with `TASKDESK_CANDIDATE_READ_ONLY=1` for the candidate app only; canonical local SIT remains `all` and migration remains `migrate`. Candidate read-only mode fails closed on any role other than `web` or when `TASKDESK_POLICY_SHADOW` is enabled, skips serving-boot seed/repair/purge writes while requiring copied schema, baseline rows, an active workspace membership fixture and zero active impersonation sessions, disables autonomous scheduler/auth/observability pollers, realtime listeners, session refresh/expiry-delete writes and verification auto-cleanup, and restricts HTTP requests to the positive A8-3 API GET allowlist, declared sign-in/A8-3 HTML navigation routes, signed build static assets, and bounded agent password sign-in and existing TOTP sign-in verification. The selector validates generation-scoped database, attachment and Mailpit volumes, a pinned `internal: true` backend network with no external egress, a Traefik-only loopback ingress network with no backend host port bindings, candidate-only Valkey/Mailpit/Traefik/Postgres/TaskDesk containers, distinct candidate private configuration fingerprints and fresh secrets, and isolated browser profile/cookie state through repeated daemon container/volume/network inventories and a bounded lifecycle event fence. Rotating `TASKDESK_AUTH_SECRET` does not by itself invalidate copied Better Auth database sessions, and rotating `TASKDESK_ENCRYPTION_KEY` makes copied encrypted settings unreadable without a future scrub/re-encryption/copy adapter. Its real-engine behavior is unverified, and it has no candidate deployment command or restore/copy adapter. Local selection, installation and release share a fixed host bootstrap fence before Docker setup or mutation, then daemon and project leases. An uncertain mutation failure retains the locks for inspection; it is never an automatic retry or rollback. A future candidate browser run still needs independent review, first-run approval, a trusted runtime collector, a verified isolated copy/scrub adapter, a single active local SIT, and a proven return to the current release. The canonical local release helper continues to require the signed main release, canonical network and canonical volumes. Candidate read-only mode permits only password session creation, `POST /api/auth/sign-out` revocation of the caller's own non-impersonated session (session cookie and same-origin `Origin` required), and existing-factor TOTP verification (code only; `trustDevice` and `trust_device` cookies are rejected). Better Auth's intrinsic `two_factor` attempt/reset/lockout state and `2fa-attempts-*` challenge/attempt rows still change during that verification; magic-link and email-OTP sign-in are masked.

## Honest evidence

Never report a test name, screenshot count or CI status as proof of a journey that did not run. Distinguish mocked from persisted evidence. Record unavailable tooling and external credentials as blockers. Keep performance thresholds; diagnose failures.

Report maintenance: run `node --test scripts/report/build-data.test.mjs`, then `node scripts/report/build-data.mjs` and `node scripts/report/generate.mjs` from the repository root. The rebuild derives counts only from the per-ID requirement index, retains every maintained phase and its acceptance/review/evidence metadata, and preserves the report timestamp; update that timestamp explicitly when recording new evidence. Invalid input or contradictory locked counts fail before replacement. The optional historical audit-directory argument is accepted with a warning and ignored; it cannot promote verification. Review the data/HTML diff and open the report at desktop, tablet and mobile widths in both themes before committing.
