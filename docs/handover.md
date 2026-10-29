# Handover to Codex — 29 October 2026

Read [AGENTS.md](../AGENTS.md) (the rulebook), then this file, then the backlog in the [roadmap](roadmap.md). This file records the current state; it is rewritten at each handover.

## State

- **Code:** P0–P6 merged to `main` on 28 Oct (squash of PR 891, merge commit `692775bf7`). Thomas accepted P0–P6 on 27 Oct with the open lows listed in the [report](report/report.html) and backlog row L-06. Phases have ended; work is the linear backlog.
- **CI at merge:** every required check green except G11 performance budgets. Thomas approved merging past it; the misses and their numbers are backlog row L-05. Thomas added a repository-admin bypass to the `protect-main` ruleset for that merge — ask him whether it stays before relying on it.
- **Release:** merging to `main` runs `release.yml` (multi-arch image, Trivy, SBOMs, cosign signature, GitHub attestation, GHCR `edge` and `sha-<commit>` tags). Deploy only a signed image by digest.
- **Current work:** main remains `2553612ee`. L-01 audit is draft PR 918; L-05 implementation is draft PR 919 (`fix/l05-performance`); report UI/evidence is stacked draft PR 920. Latest hosted application candidate `d174057ee` passes 25 checks; G11 has 21 passing tests and only LCP failing at 2692.4 ms. Detail/assignment still miss required headroom; zero qualifying runs. The compatible Seroval patch is separate draft PR 925 and included in this candidate. See [status](status.md) and the [report](report/report.html) for source-bound results and retained failures.
- **Local SIT:** one Docker Compose deployment (`deploy/compose.testing.yml`, project `taskdesk-codex-testing`) serves both local HTTPS hosts on 443, running candidate `01c47cb65`. A decoded database backup preceded the swap; previous application/data are preserved. Private env, sessions and backups remain under `~/Library/Application Support/TaskDesk/codex-sit-20261025/`; never print their values. Approved isolated workspace-admin authority and ordinary owner/lead/member/viewer/customer scope are verified; the scoped matrix is not full-product acceptance.
- **Technexus public SIT:** see [status](status.md) for the deployed digest and verification. Reached through the SSH proxy; hosts, keys and credentials are never written to docs, logs or PRs. Runtime directory holds only compose files and private env; no source checkout.
- **better-auth 1.7:** the OIDC callback path is now `/api/auth/callback/custom`. Every identity provider's registered redirect URI must use it (Thomas's Entra app registration included).
- **Live database:** `taskdesk_browser_journey_1022_test` (native PostgreSQL 62870) holds Thomas's work despite its name. Never reset, seed or run fixtures against it.

## First steps for Codex

1. Read AGENTS.md, this file, [status](status.md), the [roadmap](roadmap.md) backlog and [testing](testing.md).
2. Inspect the existing feature branches/PRs and source-bound evidence before rerunning work. Preserve the protected native database, existing customer records, stopped deployments and private files; never rerun the SIT account seeder.
3. Continue **L-05**. Hosted d174 has only LCP over budget; source-bound profiles now complete all five phases. Private earlier-import experiments improve interaction readiness but show mixed LCP results; they are not shipping changes. Verify canonical LCP observer overhead with matched captures while retaining every readiness predicate, then use measured application changes. The report preserves prior failed runs. Budgets, calibration, workload and workflows remain unchanged.
4. Then L-02, L-03a, L-03 and L-04 onward in order, as Thomas authorized. His named priorities remain settings separation and a Plane/Notion-quality Pages editor (official `@tiptap/*` extensions only). Keep coherent changes in separate PRs; ask before merging or any reserved action.

## Known fragile spots

- G11 LCP remains over budget on hosted d174; detail and assignment pass their budgets but lack the required 15% headroom. Board drag, board render and state meet their targets. Zero qualifying runs of three (L-05).
- `tsc` uses ~10 GB per package; root `typecheck` runs serially to keep CI runners alive (L-02).
- CI takes ~30 min per push; Thomas wants it faster without dropping checks (L-02). Workflow edits need his approval.
- Portal first paint uses a fetch-only auth client (`apps/web/src/lib/portal-auth-client.ts`) to stay under the 200 KB portal bundle budget; the full better-auth client loads lazily for factors and providers.
- Visual baselines (G8) are generated only in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` container.
