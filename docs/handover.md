# Handover — 30 October 2026

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md). Thomas's standing overnight authority supersedes the historical approval clauses for this run.

## Current state

- Main is `565baa3ff`: Service Desk [#965](https://github.com/ThomasHeinThura/ticketing/pull/965) merged after all 17 required non-G11 checks and every other non-G11 check passed. Its automatic [release](https://github.com/ThomasHeinThura/ticketing/actions/runs/40975568524) succeeded. No Technexus deployment was made.
- Stage 1 is complete: #933 → #934 → #931 → #932 merged in order. Stage 2 remains active. Scoped editor, core actions, datetime picker, portal, settings, Reports, God Mode and Service Desk fixes are merged; this does not complete the full route/role/state sweep.
- Calendar #961–#963 has local control replacements. Browser review added #969 (unreadable tablet time controls) and #970 (raw holiday pattern labels). Their responsive/translated-label corrections pass the source-matched browser recheck and independent Sol high review. The area PR is being prepared; #971 tracks remaining low label alignment. Preserve the original failures, transient pictures and explicit evidence limits.
- Quiet-hours #966 has a separate local candidate; cycle #967 and module #968 native dates remain queued. KB/Pages editor work and broader native-tooltip findings remain open.
- Latest valid [G11](https://github.com/ThomasHeinThura/ticketing/actions/runs/40973125872/job/123794508985): LCP **2983.9 ms**, list→detail **192.0 ms**, assignment **198.8 ms**, drag p95 **33.4 ms**. Existing LCP/state/drag retry sets ran; the diagnostic reached 180000 ms. **Zero qualifying LCP runs of three.**

## Authority and next order

Keep one coding owner and small PRs. Merge origin/main before each qualified squash merge; never rebase or force-push. Use `--match-head-commit`. Every non-G11 check must pass; high-risk changes also need an independent Sol high review with no open high/medium findings. Only report-only G11 may use the existing admin bypass. Workflow speed-ups are authorized while retaining every check and its strength.

Finish Stage 2, then L-05 #919 for at most one day, L-02 memory/CI speed, #918/#920, persisted regression journeys, and the ordered feature backlog. Inspect #919 at `ff7cf8e92` and its existing benchmark-file delta before changing it; harness changes remain forbidden. The L-02 structural-client declaration experiment reduced a scratch web check from about 12.69 GB to 2.71 GB RSS, but needs a same-commit comparison and a fresh declaration/source-check design. It is not shipped.

Budgets, thresholds, calibration, benchmark harness, protect-main ruleset, non-approved dependencies, customer-data deletion/rewrite, SIT seeder and Technexus actions remain forbidden. Record a precise blocker and continue independent work.

## Runtime and evidence

- Local SIT uses only [compose.testing.yml](../deploy/compose.testing.yml). Both HTTPS hosts are healthy on Calendar integration `23487ab9f`, owned app `1fd857b4106b`, after verified database/attachment/config backups and seven unchanged entity counts. Source matches Calendar e60a7749c. Eighteen role/theme/width views and four breakpoint views pass; no API writes or full acceptance.
- Superseded owned apps `2418695d6e50`/`5de83e141e50` and visual containers `11dc680e8015`, `d3dd9d00ba45`, `f826196b9a89`, `509416d46ba5`/`e0de15e8306c` were removed by exact id. Original rollback app `6c0d8bd2e4ff` remains stopped and preserved; pre-existing services stay. No disposable test container remains.
- Never touch live native PostgreSQL `taskdesk_browser_journey_1022_test` on 62870. Compose PostgreSQL is separate. Never rerun the account seeder or print private configuration/session values.
- Audit [#918](https://github.com/ThomasHeinThura/ticketing/pull/918) and report UI [#920](https://github.com/ThomasHeinThura/ticketing/pull/920) remain unmerged. Preserve the maintained audit worktree. Do not run its stale build-data script before integrating main's #932 fix; use the existing renderer for maintained data.
- Stage 2 DOM observations and unsaved drafts are not persisted journeys or full-product acceptance. Promote requirements only from named passing tests and role-specific persisted journeys.
- better-auth 1.7's OIDC callback is `/api/auth/callback/custom`; identity providers must use it. Real Entra validation and the external penetration test remain Thomas-only work.
