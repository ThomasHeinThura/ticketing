# Status

**Updated:** 2026-10-21 · **Latest pre-release:** `v2.0.0-alpha.4`
Current inspected GitHub main: `2c4a8a51`; primary checkout refreshed to that source.
This is a dated snapshot; refresh live GitHub before acting.

## Where we are

| Stage | State | Remaining work |
| --- | --- | --- |
| P0 Foundation | Partial implementation; verification incomplete | Container seeding/recovery candidates verified locally; finish backup encryption/offsite/runtime recording, integrated recovery and owner walkthrough. |
| P1 Core work | Partial implementation | Finish task-page stack, labels/hierarchy/relations/uploads and legacy-work redirects. Board/list/table, bulk, backlog, saved views, inbox and My work have real implementations; full acceptance remains. |
| P2 Service desk | Partial implementation | Approval requests/candidates, authoring/configuration UI, canned responses, audit, milestones/stakeholders and integrated service-desk journeys. |
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
- #877 container seeding is merged with all 18 required checks green: real intake
  submissions repeat under the restricted credential; local image build/boot passed.
- Recovery targeting now resolves the selected mounted volume. An isolated internal-network
  drill restored an actual database row and non-empty file, denied egress and passed health.
  #878 is merged with all 18 required checks green; full application acceptance remains pending.
- The approved goal is active. Full sequence and acceptance checklist: [plan.md](plan.md).

## SIT

The existing Compose application is healthy, but its image revision is `unknown` and it
has not been verified against current main. It cannot prove current feature acceptance.
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
