# Status

**Updated:** 2026-10-21 · **Latest pre-release:** `v2.0.0-alpha.4`
Current inspected GitHub main: `a99483a7` (#887); primary checkout refreshed to that source.
This is a dated snapshot; refresh live GitHub before acting.

## Where we are

| Stage | State | Remaining work |
| --- | --- | --- |
| P0 Foundation | Partial implementation; verification incomplete | Container seeding and isolated recovery merged and verified; finish backup encryption/offsite/runtime recording, integrated recovery and owner walkthrough. |
| P1 Core work | Partial implementation | Project label catalogues merged; finish hierarchy/relations/uploads and legacy-work redirects. Board/list/table, bulk, backlog, saved views, inbox and My work have real implementations; full acceptance remains. |
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
  136.5 ms and 500-row render 425.8 ms. The diagnostic failed on that historical run; #885 subsequently repaired signed sample
  timestamps. Prior failed runs remain visible.
- #884 project label catalogues merged to `f7a24732` on independently reviewed
  `94eb6795`, all 18 required checks. PostgreSQL, 152 browser tests, G8, G11 (22/22),
  accessibility and shipping-image boot passed. Workspace/own-project assignment and
  permission-scoped Kaneo settings are integrated; this does not complete P1.
- #885 is merged: signed V8 sample timestamps are reconstructed in arrival order.
  Both hosted CPU diagnostics passed; original timing failures remain adverse evidence.
- #880 image-build candidate `046e4964` remains unmerged (17/18 checks; palette
  243.2 ms > 200 ms). Actual amd64/arm64 release, scanning and signing remain unverified.
- #886 observer correction `2adfb88c` remains unmerged: palette passed 195.1 ms,
  but 500-row list rendering failed 528.7 ms > 500 ms. Do not merge or blindly rerun.
- #887 hierarchy pagination API merged to `a99483a7` on reviewed `2007b480`,
  all 18 required checks. PostgreSQL, G8, G11, 152 browser tests and shipping-image
  smoke passed. It supplies bounded per-parent pages, exact position cursors, ancestor
  context and complete live-descendant progress; full hierarchy/P1 acceptance remains.
- #888 inline hierarchy UI is a separate reviewed candidate in
  `~/.codex/worktrees/taskdesk-hierarchy-ui`: original Kaneo disclosures/rows/progress,
  independent pagination, URL persistence, bounded automatic replay and access-loss cleanup.
  Five fixture browser journeys, 1,446 web unit tests, typecheck/lint and 428 contrast pairs
  passed. Independent bounds/security and contrast reviews found no remaining blockers.
  A real PostgreSQL browser journey is authored but not yet run; accepted-main import delta review,
  hosted checks and image verification remain. Full parent editing/lifecycle/relations
  are still unfinished. An initial native unit run hit two unchanged process-lock timeouts;
  its 11-test isolated diagnostic and the complete sequential recheck (12 tasks) passed.
- #888 accepted-main candidate `b4958b59` passed fast CI. G8 found the intended
  work-item-detail change but its new hierarchy endpoint lacked a visual fixture, leaving
  a loading skeleton in the capture. A valid parent/child fixture and explicit readiness
  assertion are prepared; generate, inspect and independently review its Linux baseline
  before committing it. Candidate `fcd1abee` stopped at visual-scope validation because
  its chained locator is unsupported there; a direct equivalent assertion now passes
  all 43 local screenshot cases. The earlier `a9db0121` G11 failed closed on calibration 0.739
  below 0.75 before budgets. No thresholds or retries changed.
- Parent editing is being prepared separately in `~/.codex/worktrees/taskdesk-parent-editing`,
  branch `codex/parent-editing`: required If-Match for attach/detach, locked version checks
  and stale/concurrent-write integration regressions. The Kaneo parent property control
  and typed client are drafted; API/web typechecks and nine fetcher unit tests passed.
  PostgreSQL, OpenAPI regeneration, component/browser/contrast checks and review remain.
  This uncommitted draft is not a completed feature or accepted code.
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
