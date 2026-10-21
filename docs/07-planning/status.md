# Status

**Updated:** 2026-10-21 · **Latest pre-release:** `v2.0.0-alpha.4`
Current inspected GitHub main: `0f121c4e`; primary checkout refreshed to that source.
This is a dated snapshot; refresh live GitHub before acting.

## Where we are

| Stage | State | Remaining work |
| --- | --- | --- |
| P0 Foundation | Partial implementation; verification incomplete | Container seeding and isolated recovery merged and verified; finish backup encryption/offsite/runtime recording, integrated recovery and owner walkthrough. |
| P1 Core work | Partial implementation | Finish project label catalogues, hierarchy/relations/uploads and legacy-work redirects. Board/list/table, bulk, backlog, saved views, inbox and My work have real implementations; full acceptance remains. |
| P2 Service desk | Partial implementation | Approval requests/candidates, authoring/configuration UI, audit, milestones/stakeholders and integrated service-desk journeys. |
| P3 Portal and identity | Partial implementation | Full portal, invitation/admission/discovery contracts and implementation, identity administration and real Entra verification. |
| P4 Governance | Partial implementation | Missing APIs/UI, notification runtime, automations, God Mode, MCP and #580 query ownership. |
| P5–P7 | Not started | Outside the approved scope. |

No stage has Thomas's SIT sign-off. Earlier #863 completion claims were withdrawn by the
2026-10-20 lean reset; its mock UI was reverted and SIT seed accounts preserved.

## Next

- #864–#869 and #872–#873 are merged. Agent/settings Kaneo shells, real Inbox/My work,
  SLA/attachment panels, redirect/seed fixes and dependency remediation are on main.
- #875 is merged: all 18 required checks passed. Four isolated integration shards reduce
  the slowest partition to 8m43s from the former 31m22s serial step; the collector fails closed.
- #870 approvals decide is merged after all 18 required checks passed on its reviewed
  final source. Prior G11 calibration, warm-up and slow-runner budget failures remain
  adverse evidence; #876/#711 track them. Passive phase timing now accompanies failures.
- #871 is merged after all 18 required checks passed on reviewed head `bf3c6b95`.
  Canonical Kaneo full-page/side-pane editing preserves project-scoped controls and queued
  edits. Sidebar download overlap and parent-route preloading repaired the observed G11
  candidate failures without changing budgets. Full P1 feature completion remains outstanding.
- #881 canonical workspace-label assignment is merged after all 18 required checks passed
  on reviewed head `a871a853`. The Kaneo properties picker persists through versioned writes;
  catalogue deletion advances affected item versions and records internal activity/events.
  Project-scoped label catalogues remain separate unfinished work.
- #877 container seeding is merged with all 18 required checks green: real intake
  submissions repeat under the restricted credential; local image build/boot passed.
- Recovery targeting now resolves the selected mounted volume. An isolated internal-network
  drill restored an actual database row and non-empty file, denied egress and passed health.
  #878 is merged with all 18 required checks green; full application acceptance remains pending.
- #882 is merged after all 18 required checks passed on independently reviewed
  `ff85f0bc`: Kaneo canned-response management, literal placeholders and fresh authorized
  insertion. Hosted PostgreSQL and 138 browser tests passed, including settings persistence,
  due-date changes without reload, editable insertion and durable send. G8, G11 budgets
  (22/22) and Linux amd64 image build/migrate/boot/health passed. This closes this change,
  not P2 or its integrated owner acceptance.
- #883 is merged on reviewed `2bbfb21d` after all 18 required checks passed. Project
  creation controls use the displayed project's capabilities; sidebar navigation downloads
  overlap, and the closed project form loads on creation intent. Native keyboard/focus and
  form journeys passed. Hosted G11 passed 22/22: palette 107.6 ms, keyboard navigation
  136.5 ms and 500-row render 425.8 ms. The non-gating CPU diagnostic still fails on clock
  alignment/negative deltas and is not complete attribution. Prior failed runs remain visible.
- #880 imported accepted main without changing its three authored files. Native
  Dockerfile structural verification passed. On `c3ca7047`, PostgreSQL, G8 and accessibility
  passed, but G11 palette timing failed (209.3 ms against 200 ms); do not merge or blindly
  rerun. Actual multiarch release verification remains required before claiming the
  35-minute image-build defect fixed.
- Project label catalogues are in #884, in a separate worktree. Migration,
  scoped CRUD/assignment and Kaneo settings reuse exist on the candidate; 884 API unit
  tests, 107 permission checks and typechecks passed. Independent backend review is clean;
  UI/security review is clean. Six native browser journeys and 53 URL/navigation tests
  passed, including workspace regression and mobile/dark presentation. PostgreSQL,
  concurrency/migration, real-API browser and required CI evidence remain open. First hosted
  run found an API-path ambiguity and two legacy task-label insert projections needing the
  new nullable column; repairs are prepared, including a reviewed legacy-bulk catalogue
  isolation finding and regression. Five intended Linux baselines were inspected.
- #885 is merged on reviewed `5e201dbe` after all 18 required checks passed. Both hosted
  CPU diagnostics passed with sampled profiles retained; G11 passed 22/22. #880 still
  requires a performance repair: reviewed `046e4964` passed 17/18 checks but palette timing
  failed at 243.2 ms against 200 ms. No blind rerun or release-fix claim.
- #884 reviewed `329cfe36` passed 17/18 checks, including PostgreSQL, real browser, G8 and
  G11. Static failed stale contrast occurrence bindings. The source-grounded repair and
  explicit existing `bg-card` surface passed all 418 native contrast pairs and independent
  review; final-head hosted checks remain required.
- The approved goal is active. Full sequence and acceptance checklist: [plan.md](plan.md).
- Continue from [handover.md](handover.md) for active branches, checks and deployment
  constraints. It is a dated snapshot, not policy or proof that pending checks passed.

## SIT

The earlier local Compose installation reported revision `unknown`; OrbStack is now
stopped, so that installation is not current runtime evidence. TaskDesk has **not yet
been deployed to the proxy VM**. No current hosted SIT acceptance is claimed.
Before handoff: deploy the reviewed SHA/digest, verify both HTTPS origins, seed accounts and
realistic submissions, exercise all journeys, and verify backup/restore. Supply credentials
privately. Thomas performs the final integrated stage walkthrough.

Hosted SIT assessment (Thomas's additional request): `proxy` has 2 vCPUs, 7.7 GiB RAM,
4.5 GiB available and 166 GiB free. Suitable for light functional SIT using synthetic
scenarios. Thomas selected `tickting.technexus.info` and `portal.technexus.info`.
DNS is now present with Cloudflare proxy enabled. Reviewed proxy integration and image-only
Compose deployment remain outstanding; OrbStack is stopped. Existing
Traefik uses `web`/`le`; stock TaskDesk assumptions differ. No remote changes made.
See [plan.md § Hosted SIT addition](plan.md#hosted-sit-addition--2026-10-21).

## Open obligations

- Some specs and inventory statuses remain stale; reconcile each with code and runtime
  evidence. The notification runtime and portal admission contract have real missing work.
- #580 remains open: complete repository query ownership and activate `check:queries`.
- #626 remains open: deferred manual/accessibility/browser/load/recovery activities must
  have actual evidence before closure; routine approval does not satisfy them.
- P3 requires all 25 named tests against a real Entra tenant; credentials remain external.
- #811 and #773 are closed; the 2026-10-19 D4 decision settled their listed valuation,
  midnight and timezone questions. Do not carry them forward as unanswered owner questions.
- No bulk repository cleanup, P5–P7 development or production deployment is authorized.
