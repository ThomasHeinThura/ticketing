# Current status — 28 October 2026

P0–P6 are delivered, AI-reviewed, accepted by Thomas (27 Oct, with open lows) and **merged to `main`** (PR 891, squash `692775bf7`, 28 Oct). Phases have ended; work continues as the linear backlog in the [roadmap](roadmap.md), handed over to Codex ([handover](handover.md)).

| Work | Current status |
| --- | --- |
| 29 Oct approved security fix (#927) | Legacy time-entry writes now use canonical create/own-or-any capabilities, persisted ownership, API-key scope and the project time-tracking gate, with transaction rechecks. Candidate checks: 7 integration files / 127 tests on a fresh disposable PostgreSQL 18 container (removed), 118 permission tests, route policy, typecheck, lint and API contract pass; independent Sol high review round 2 has no high/medium findings. Full root units still fail on fixture/boot/schema timeouts; new-source browser and hosted CI remain pending. No main merge, public deployment, customer-data rewrite or seeder run. |
| Merge | PR 891 merged 28 Oct with every required check green except G11 performance budgets. Thomas approved merging past G11 through a repository-admin bypass he added to the `protect-main` ruleset. G11 misses are backlog L-05. |
| CI at merge head | Green: build, typecheck, lint, unit, 4 integration shards, contract, permissions, gate checkers, e2e, visual G8, accessibility G4, bundle budgets (portal 189.1/200 KB), secret scan, CodeQL. Failing: G11 — work-list LCP 2921 ms (< 2500), list → detail 347 ms (< 300), board-drag p95 33.3 ms (< 20) on a runner calibrated 1.46× slower. |
| Release image | `release.yml` on `692775bf7` passed: multi-arch build, Trivy, SBOMs, cosign signature and GitHub attestation. GHCR `sha-692775bf…` / `edge`, index digest `sha256:3028f7ad…`. Signature and attestation verified locally against the main-branch release workflow identity. |
| Local SIT | One Compose deployment (`deploy/compose.testing.yml`) runs the `e00ec245c` tree (same source as the merge) on `https://ticketing.localhost` and `https://portal.localhost`. Agent board/table/list render persisted data; portal session, sign-in redirect and wrong-password handling verified. Not verified: a successful password sign-in and sign-out in the browser. |
| Technexus public SIT | Upgraded 28 Oct to the signed digest above (previous `sha256:8ba4fdc7…`). Backup taken first (database dump, data volume, env). Migrations 127 → 212 with exit 0; row counts unchanged (4 work items, 4 users, 1 project); container healthy; HTTPS valid on both hosts; agent and portal sign-in screens render without console errors. Not verified: a signed-in journey (needs Thomas's sign-in). Rollback needs the database restore because migrations advanced. |
| Operator action | better-auth 1.7 moved the OIDC callback to `/api/auth/callback/custom`; update the redirect URI at each identity provider (Entra app registration included). |
| Not yet covered | Full role matrix (lead/member/viewer), light theme, tablet/mobile matrix, full CSV import run in the browser, 500k-row export, palette timing at 10k items — backlog L-08. |
| Acceptance | P0–P6 accepted by Thomas 27 Oct. Real Entra validation and the external penetration test are Thomas's (T-1). |
| Next | Codex starts with backlog L-01 (baseline full audit), then L-02 onward. Thomas decides whether the `protect-main` admin bypass stays. |

Detailed evidence: [report](report/report.html), [audit](report/audit/), [browser evidence](report/browser/).
