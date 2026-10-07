# P4 integrated UI and API-client seam review — GPT-6 Luna

- **Reviewed head:** `d7254c47d3a0bf1c243d3c490ab98eae8a98832c`
- **Comparison base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Independence:** Fresh reviewer context; I did not author, direct, or remediate this candidate.
- **Scope:** God Mode Users list/detail and action dialogs; pending-action list/detail and approval recovery; typed fetchers/query cache/URL state; localization coverage; authentication connection screens and shared controls; calendar/SLA routes, query/mutation seams, and shared UI primitive use.
- **Risk:** Broad cross-package API/frontend integration including auth/identity/permissions and lifecycle authority. This is one of three required ordinary Luna panels. Independent GPT-6 Sol security review remains required after ordinary reviews clear.

## Verdict

**REQUEST CHANGES — one blocking finding.** The Users route and pending-action detail have the reported earlier UI corrections at this head: directory selection is a semantic URL link, action links compose through `Button`, approval invalidates the user query family, and terminal pending-action states offer a fresh request path. The exact typed email remains compared before proof creation and is sent as the approval body; step-up proof is action-bound and held locally. Users filters/selection and pending-action cursors are URL-backed. Calendar/SLA list and mutation seams use shared UI components, scoped query keys, and list/detail/preview invalidation patterns.

### Blocking finding

1. **P1 — Localization is incomplete across the changed administrative journeys.** The 19-catalogue work does not cover all visible and accessible copy in the integrated changes. The pending-action list still emits the literal English `Expires` label and converts unknown action identifiers to display text via `replaceAll("_", " ")` (`apps/web/src/routes/agent/_layout/_authenticated/agent/settings/profile/pending-actions.tsx:100-108`). The new Authentication list, editor, and provisioning-history components contain extensive visible and ARIA English literals, including load/error/retry/empty states, portal/status labels, editor validation and success messages (`god-mode/authentication.tsx:69-118`, `identity-connection-editor.tsx:153,228,283-344`, `identity-connection-events.tsx:80-100`). These paths are part of this candidate and remain English in non-English locales, so the administrator journey is not fully localized. Route all user-facing/status/accessibility copy and action labels through the app translation API and include the relevant keys in the supported catalogues with placeholder parity.

### Non-blocking findings

- None identified in the assigned scope beyond the localization blocker.

## Evidence inspected

- Repository guidance and required current status/decision context; packet `/Users/heinthura/.codex/taskdesk-evidence/2026-10-05/p4-person-deactivation-b58/d7254c47-bulk-review-packet.json`.
- Feature/contracts: God Mode, pending-actions, auth and identity, service calendars, SLA, routes and screen URL contracts.
- Current candidate source: Users route and fetchers/hooks; pending-action list/detail and proof fetcher; authentication list/editor/events and SCIM settings; service-calendar/SLA list/editor, query and mutation hooks; shared `@taskdesk/ui` compositions; 19 locale catalogues.
- Confirmed previously identified Users issues were addressed in source: keyboard reachable semantic user link, pending-action shared Button link, Users cache invalidation after approval, and terminal-state route to request another deactivation.
- Inspected route and query mutation structures for cursor navigation, exact target/action proof construction, pending-action error recovery, and calendar/SLA invalidation.

## Tests and checks

- **Tests run by this reviewer:** none. The source inspection directly confirmed a blocking untranslated-copy defect; rerunning suites would not change that verdict.
- **Author-attributed evidence from packet (not independently rerun):** web typecheck/build and i18n checks; route unit tests **1 file / 20 tests**; latest scoped Users Playwright **1/1**; localization inventory **2,862 values across 19 catalogues**. These results do not establish translation coverage for the hardcoded authentication and pending-action strings above.
- No browser session, Docker image/build/boot, complete suite, hosted CI, deployment, or stage acceptance was performed by this reviewer.

## Residuals and boundaries

This is a UI/integration panel only. I did not adjudicate the API/migration/outbox issues reported by other panels. The packet explicitly records no executable outbox drain/fanout and no current composed-head image/boot or hosted CI acceptance. No P4 completion or stage claim is made.
