# Status

**Updated:** 2026-10-21 · **Latest pre-release:** `v2.0.0-alpha.4`
Current inspected GitHub main: `892385ff`; primary checkout refreshed to that source.
This is a dated snapshot; refresh live GitHub before acting.

## Where we are

| Stage | State | Remaining work |
| --- | --- | --- |
| P0 Foundation | Implemented; verification incomplete | Reproducible container seeding/host config, integrated recovery and owner walkthrough. |
| P1 Core work | Partial implementation | Finish task-page stack, labels/hierarchy/relations/uploads and legacy-work redirects. Board/list/table, bulk, backlog, saved views, inbox and My work have real implementations; full acceptance remains. |
| P2 Service desk | Partial implementation | Approval requests/candidates, authoring/configuration UI, canned responses, audit, milestones/stakeholders and integrated service-desk journeys. |
| P3 Portal and identity | Partial implementation | Full portal, invitation/admission/discovery contracts and implementation, identity administration and real Entra verification. |
| P4 Governance | Partial implementation | Missing APIs/UI, notification runtime, automations, God Mode, MCP and #580 query ownership. |
| P5–P7 | Not started | Outside the approved scope. |

No stage has Thomas's SIT sign-off. Earlier #863 completion claims were withdrawn by the
2026-10-20 lean reset; its mock UI was reverted and SIT seed accounts preserved.

## Current implementation

- #864–#869 and #872–#873 are merged. Agent/settings Kaneo shells, real Inbox/My work,
  SLA/attachment panels, redirect/seed fixes and dependency remediation are on main.
- #870 approvals decide is open at `e12bc1b7`: PostgreSQL integration passed; G8 failed on
  search-sidebar rendering, and G11 failed its runner calibration stability check.
- #871 Kaneo task-page integration is open at `be06bb92` and conflicts with its base.
- CI run 39528122579 spent 31m22s in serial integration (233 files); browser jobs took
  roughly 2–8 minutes. Four isolated integration shards are under implementation.
- The approved goal is active. Full sequence and acceptance checklist: [plan.md](plan.md).

## SIT

The existing Compose application is healthy, but its image revision is `unknown` and it
has not been verified against current main. It cannot prove current feature acceptance.
Before handoff: deploy the reviewed SHA/digest, verify both HTTPS origins, seed accounts and
realistic submissions, exercise all journeys, and verify backup/restore. Supply credentials
privately. Thomas performs the final integrated stage walkthrough.

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
