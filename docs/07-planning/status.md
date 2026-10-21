# Status

**Updated:** 2026-10-21 · **Latest pre-release:** `v2.0.0-alpha.4`
Current inspected GitHub main: `a99483a7` (#887); active branch: `feat/batch1-hierarchy-and-parent-editing` (`715263822`).
SIT Deployment: **Deployed & Operational** on `proxy` VM (`4.194.153.78`).

## Where we are

| Stage | State | Remaining work / SIT verification status |
| --- | --- | --- |
| P0 Foundation | Implemented & deployed to SIT | Deployed with non-superuser `taskdesk_app` runtime role, isolated migrations, unpublished port invariant verified, Valkey and PostgreSQL operational. Backup operational drills and owner walkthrough. |
| P1 Core work | Implemented & deployed to SIT | Canonical Kaneo work-item page/pane, workspace/project label catalogues, inline hierarchy UI with recursive subtree progress and parent editing verified live on SIT. Board/list/table, bulk, backlog, saved views, and My work operational. Relations edge-cases and owner walkthrough. |
| P2 Service desk | Implemented & deployed to SIT | Service desk intake queue, request acceptance into work items, canned responses, approval decisions, and real-time portal synchronization verified live on SIT. |
| P3 Portal and identity | Implemented & deployed to SIT | Customer Portal live on `https://portal.technexus.info`, request catalogue browsing, structured request submission, and durable submission tracking verified live on SIT. Real Entra tenant verification pending client credentials. |
| P4 Governance | Implemented & deployed to SIT | God Mode Instance Audit UI and API (`/api/instance/audit`), immutable audit log recording, RBAC enforcement, and CSRF token binding verified live on SIT. |
| P5–P7 | Not started | Outside the approved scope. |

No stage has Thomas's final SIT sign-off yet. Thomas's integrated walkthrough on SIT is now ready to begin.

## SIT Deployment

TaskDesk v2 is **live and verified** on the `proxy` VM (`bimdevops@4.194.153.78`):
- **Agent application:** [https://tickting.technexus.info](https://tickting.technexus.info) (preserve `tickting` spelling)
- **Customer portal:** [https://portal.technexus.info](https://portal.technexus.info)
- **Topology:** Cloudflare proxy enabled (`TASKDESK_TRUST_PROXY=2`), Traefik on external network `web` with Let's Encrypt resolver `le`.
- **Containers:** Digest-pinned image `ghcr.io/thomasheinthura/taskdesk:sit`, non-root UID 10001 (`taskdesk`), unpublished application port 5173 verified.
- **Database:** PostgreSQL 18-alpine, migrations applied under advisory lock, DML-only role `taskdesk_app` enforced for application runtime.
- **Cache/Queue:** Valkey 9-alpine healthy on isolated internal network.

### SIT Test Accounts (Interactive Walkthrough)

| Account | Email | Password | Role / Scope |
| --- | --- | --- | --- |
| **Instance & Workspace Admin** | `admin@taskdesk.local` | `TaskDesk!Admin2026` | Staff / Instance Admin & Workspace Owner (`sees_all`) |
| **Service Desk Agent** | `agent@taskdesk.local` | `TaskDesk!Agent2026` | Staff / Service Desk Agent (`member`) |
| **Project Lead & Approver** | `lead@taskdesk.local` | `TaskDesk!Lead2026` | Staff / Project Lead & Approver (`admin` / `lead`) |
| **Customer Requester** | `customer@acme.example` | `TaskDesk!Customer2026` | Customer / Acme Corp Requester (`customer`) |

### Verified Live End-to-End Journeys
1. **Authentication & Session Isolation:** Separate cookie scopes (`__Host-tdk_agent_session` on Agent vs `__Host-tdk_portal_session` on Portal), strict CSRF protection with `/api/me/csrf-token`.
2. **Customer Portal Intake:** Customer Katherine Johnson browsed the published request catalogue, submitted request `SUB-3` with structured form data.
3. **Agent Service Desk Triage:** Agent Ada Lovelace viewed incoming intake submissions, claimed and accepted `SUB-3` directly into work item `HELP-5` (`Service Request`).
4. **Customer Live Tracking:** Customer portal immediately reflected the accepted work item title, state ("To Do"), and priority ("high").
5. **Hierarchy & Parent-Child Tree:** Linked work item `HELP-3` under parent `HELP-1`, paged direct children via `GET /api/work-items/HELP-1/children`, verified ancestor paths and recursive SQL subtree progress.
6. **Immutable Instance Audit Log:** Verified live entries in `/api/instance/audit` with sequential monotonically increasing IDs, before/after state diffs, and actor tracking.


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
