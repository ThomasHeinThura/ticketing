# Handover — 30 October 2026

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md). Thomas's standing overnight authority supersedes historical approval clauses for this run.

## Current state

- Main is `32de6e7d9`: Planning [#978](https://github.com/ThomasHeinThura/ticketing/pull/978) merged after all25 non-G11 checks passed, including hosted G4/G8; #967/#968 closed. Independent Sol high source/UI review clear. No Technexus deployment.
- Stage 1 is complete: #933 → #934 → #931 → #932 merged in order. Stage 2 remains active. Scoped editor, core actions, datetime picker, portal, settings, Reports, God Mode, Service Desk and Calendar fixes are merged; the full route/role/state sweep remains open.
- Calendar evidence includes 22 source-matched SIT views, 12 Calendar E2E tests including disposable Postgres ICS persistence, nine pinned visuals and independent Sol high reviews. Latest [G11](https://github.com/ThomasHeinThura/ticketing/actions/runs/40984951775/job/123833691473): LCP **2950.4 ms**, list→detail **558.4 ms**, assignment **194.0 ms**, drag p95 **33.3 ms**. Existing retry sets ran and the diagnostic reached 180000 ms. **Zero qualifying LCP runs of three.**
- Account notification #966/#973–#975 merged in #976: 7,273 local units, nine type tasks, 15 focused checks, 18 actual owner/admin/member width/theme cases and27 public photographs. No persisted Save/Clear/delivery or wider-role acceptance. Latest G11 is 2963.6 / 510.2 / 182.6 / 16.8 ms; zero qualifying LCP runs.
- Planning #967/#968 merged in #978 with72 actual browser observations/12 canceled drafts; hosted exact-head G8 passed. Local Module G8 remains6/7 with identical46-pixel unchanged/candidate discrepancy and unproved cause. No baseline/threshold change; no persisted Create/Save/edit acceptance. Latest G11 LCP2916.6/detail233.9/assignment155.0/drag16.7ms; zero qualifying LCP runs.
- KB/Pages editor, label color controls and broader native-tooltip findings remain open.

## Authority and next order

Keep one coding owner and small PRs. Merge origin/main before each qualified squash merge; never rebase or force-push. Use `--match-head-commit`. Every non-G11 check must pass; high-risk changes need an independent Sol high review with no open high/medium findings. Only report-only G11 may use the existing admin bypass. Workflow speed-ups are authorized while retaining every check and its strength.

Finish Stage 2, then L-05 #919 for at most one day, L-02 memory/CI speed, #918/#920, persisted regression journeys, and ordered features. Inspect #919 at `ff7cf8e92` and its existing benchmark-file delta first; harness changes remain forbidden. The L-02 structural-client declaration experiment reduced a scratch web check from about 12.69 GB to 2.71 GB RSS, but needs a same-commit comparison and fresh declaration/source-check design. It is not shipped.

Budgets, thresholds, calibration, benchmark harness, protect-main ruleset, non-approved dependencies, customer-data deletion/rewrite, SIT seeder and Technexus actions remain forbidden. Record blockers and continue independent work.

## Runtime and evidence

- Local SIT integration `283867012`, owned app `b11e2dc343c1`, serves both HTTPS hosts after verified backup and seven unchanged counts; zero fixable HIGH/CRITICAL Trivy findings. Calendar alignment, labels and sort sources match their local branches. Superseded b4398751652a removed; original rollback/pre-existing services preserved.
- Superseded owned app `7fe5015f9c82` and temporary visual runners `399a689937f2`, `1f5379c39c1e`, `deb585d46ec6`, `2dd083209214`, `a42c3f31186a` were removed by exact id. Earlier Calendar runners and disposable Postgres/Ryuk are also removed. Original rollback app `6c0d8bd2e4ff` remains stopped; preserve pre-existing services. No temporary test container remains.
- Never touch live native PostgreSQL `taskdesk_browser_journey_1022_test` on 62870. Compose PostgreSQL is separate. Never rerun the account seeder or print private configuration/session values.
- Audit [#918](https://github.com/ThomasHeinThura/ticketing/pull/918) and report UI [#920](https://github.com/ThomasHeinThura/ticketing/pull/920) remain unmerged. Preserve the maintained audit worktree. Do not run its stale build-data script before integrating main's #932 fix; use the existing renderer for maintained data.
- DOM observations and unsaved drafts are not persisted journeys or full-product acceptance. Promote requirements only from named passing tests and role-specific persisted journeys.
- better-auth 1.7's OIDC callback is `/api/auth/callback/custom`; identity providers must use it. Real Entra validation and the external penetration test remain Thomas-only work.

- Calendar alignment #971:7,273 units,9 type tasks,5 focused,22 real views,6 pinned visual passes/zero baseline changes and independent Terra source/browser review clear. [Receipt](report/audit/calendar-alignment-verification-20261030.json). Hosted checks pending; no persisted Calendar Save/reload or actual drag execution. Work-title #980 spans light-list and table anchors, with24px candidate under local diagnosis.
