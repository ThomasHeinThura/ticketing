# Handover — 30 October 2026

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md). Thomas's standing overnight authority supersedes historical approval clauses for this run.

## Current state

- Main is `bda77ab64`: Calendar [#972](https://github.com/ThomasHeinThura/ticketing/pull/972) merged after all 17 required non-G11 and every other non-G11 check passed. It closed #961–#963/#969/#970. Low alignment issue #971 remains open. Automatic [release](https://github.com/ThomasHeinThura/ticketing/actions/runs/40987852505) is in progress. No Technexus deployment.
- Stage 1 is complete: #933 → #934 → #931 → #932 merged in order. Stage 2 remains active. Scoped editor, core actions, datetime picker, portal, settings, Reports, God Mode, Service Desk and Calendar fixes are merged; the full route/role/state sweep remains open.
- Calendar evidence includes 22 source-matched SIT views, 12 Calendar E2E tests including disposable Postgres ICS persistence, nine pinned visuals and independent Sol high reviews. Latest [G11](https://github.com/ThomasHeinThura/ticketing/actions/runs/40984951775/job/123833691473): LCP **2950.4 ms**, list→detail **558.4 ms**, assignment **194.0 ms**, drag p95 **33.3 ms**. Existing retry sets ran and the diagnostic reached 180000 ms. **Zero qualifying LCP runs of three.**
- Account notification #966/#973–#975: 7,273 units, nine typecheck tasks, 15 focused tests and 18 actual owner/admin/member × width × theme browser cases pass. Independent Sol high source/browser review has no high/medium findings. [Public receipt](report/audit/notification-controls-verification-20261030.json) contains 27 screenshots and explicit persistence/role limits. Hosted CI is pending.
- Planning #967/#968: 7,277 units, nine typecheck tasks and 18 focused tests pass; final browser evidence is pending. The integrated Module visual fails by 46 pixels identically on unchanged and candidate source. Actual images, diffs and geometry are byte-identical in a controlled pinned A/B; the rendering cause remains unresolved. No baseline, threshold or test changed. Original failure logs/pixel measurements and fresh A/B traces remain; the diagnostic's default output directory overwrote the original candidate screenshots.
- KB/Pages editor, label color controls and broader native-tooltip findings remain open.

## Authority and next order

Keep one coding owner and small PRs. Merge origin/main before each qualified squash merge; never rebase or force-push. Use `--match-head-commit`. Every non-G11 check must pass; high-risk changes need an independent Sol high review with no open high/medium findings. Only report-only G11 may use the existing admin bypass. Workflow speed-ups are authorized while retaining every check and its strength.

Finish Stage 2, then L-05 #919 for at most one day, L-02 memory/CI speed, #918/#920, persisted regression journeys, and ordered features. Inspect #919 at `ff7cf8e92` and its existing benchmark-file delta first; harness changes remain forbidden. The L-02 structural-client declaration experiment reduced a scratch web check from about 12.69 GB to 2.71 GB RSS, but needs a same-commit comparison and fresh declaration/source-check design. It is not shipped.

Budgets, thresholds, calibration, benchmark harness, protect-main ruleset, non-approved dependencies, customer-data deletion/rewrite, SIT seeder and Technexus actions remain forbidden. Record blockers and continue independent work.

## Runtime and evidence

- Local SIT integration `e3564bb52`, owned app `b4398751652a`, serves both HTTPS hosts after verified backup and seven unchanged entity counts. Account source `ca35364cc` and planning `9485935a5` match. Fixable HIGH/CRITICAL Trivy findings: zero.
- Superseded owned app `7fe5015f9c82` and temporary visual runners `399a689937f2`, `1f5379c39c1e`, `deb585d46ec6`, `2dd083209214`, `a42c3f31186a` were removed by exact id. Earlier Calendar runners and disposable Postgres/Ryuk are also removed. Original rollback app `6c0d8bd2e4ff` remains stopped; preserve pre-existing services. No temporary test container remains.
- Never touch live native PostgreSQL `taskdesk_browser_journey_1022_test` on 62870. Compose PostgreSQL is separate. Never rerun the account seeder or print private configuration/session values.
- Audit [#918](https://github.com/ThomasHeinThura/ticketing/pull/918) and report UI [#920](https://github.com/ThomasHeinThura/ticketing/pull/920) remain unmerged. Preserve the maintained audit worktree. Do not run its stale build-data script before integrating main's #932 fix; use the existing renderer for maintained data.
- DOM observations and unsaved drafts are not persisted journeys or full-product acceptance. Promote requirements only from named passing tests and role-specific persisted journeys.
- better-auth 1.7's OIDC callback is `/api/auth/callback/custom`; identity providers must use it. Real Entra validation and the external penetration test remain Thomas-only work.
