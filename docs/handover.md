# Handover to Codex — 28 October 2026

Read [AGENTS.md](../AGENTS.md) (the rulebook), then this file, then the backlog in the [roadmap](roadmap.md). This file records the current state; it is rewritten at each handover.

## State

- **Code:** P0–P6 merged to `main` on 28 Oct (squash of PR 891, merge commit `692775bf7`). Thomas accepted P0–P6 on 27 Oct with the open lows listed in the [report](report/report.html) and backlog row L-06. Phases have ended; work is the linear backlog.
- **CI at merge:** every required check green except G11 performance budgets. Thomas approved merging past it; the misses and their numbers are backlog row L-05. Thomas added a repository-admin bypass to the `protect-main` ruleset for that merge — ask him whether it stays before relying on it.
- **Release:** merging to `main` runs `release.yml` (multi-arch image, Trivy, SBOMs, cosign signature, GitHub attestation, GHCR `edge` and `sha-<commit>` tags). Deploy only a signed image by digest.
- **Local SIT:** one Docker Compose deployment (`deploy/compose.testing.yml`, project `taskdesk-codex-testing`) serving `https://ticketing.localhost` and `https://portal.localhost` on 443, running the `e00ec245c` tree (same source as the merge). Private env, sessions and backups live under `~/Library/Application Support/TaskDesk/codex-sit-20261025/`; never print their values. Pre-upgrade dump: `compose-testing195/backup-20261028-pre-e00ec24/`.
- **Technexus public SIT:** see [status](status.md) for the deployed digest and verification. Reached through the SSH proxy; hosts, keys and credentials are never written to docs, logs or PRs. Runtime directory holds only compose files and private env; no source checkout.
- **better-auth 1.7:** the OIDC callback path is now `/api/auth/callback/custom`. Every identity provider's registered redirect URI must use it (Thomas's Entra app registration included).
- **Live database:** `taskdesk_browser_journey_1022_test` (native PostgreSQL 62870) holds Thomas's work despite its name. Never reset, seed or run fixtures against it.

## First steps for Codex

1. Read AGENTS.md, this file, [status](status.md), the [roadmap](roadmap.md) backlog and [testing](testing.md).
2. Start the local toolchain (pinned pnpm, Node 24+), confirm `pnpm typecheck`, `pnpm lint:ci` and `pnpm test` on `main`, and open both local SIT hosts.
3. Work **L-01 (baseline full audit)** first, with a high-tier model: full code audit, full code test run, feature tests, design tests and browser tests per [testing](testing.md), against `docs/requirements-index.json` and the open GitHub issues. Its findings may re-order the backlog.
4. Then L-02 onward in order. Thomas's named priorities: **L-03 settings split** (account settings under the user menu, project settings in the project "…" menu, workspace settings under the workspace menu, God Mode on its own URL with its own sign-in) and **L-04 Pages markdown editor** at Plane/Notion quality (official `@tiptap/*` extensions pre-approved).

## Known fragile spots

- G11 work-list LCP, list → detail transition and board-drag p95 are over budget on CI (L-05); task-assignment click is within 5 ms of its budget.
- `tsc` uses ~10 GB per package; root `typecheck` runs serially to keep CI runners alive (L-02).
- CI takes ~30 min per push; Thomas wants it faster without dropping checks (L-02). Workflow edits need his approval.
- Portal first paint uses a fetch-only auth client (`apps/web/src/lib/portal-auth-client.ts`) to stay under the 200 KB portal bundle budget; the full better-auth client loads lazily for factors and providers.
- Visual baselines (G8) are generated only in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` container.
