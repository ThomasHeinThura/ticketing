# Code audit — 22 October 2026

**Inspected:** checkout `d7be6d0bb`, branch `feat/batch1-hierarchy-and-parent-editing`, plus existing local edits. Three parallel read-only source audits covered P0/P1, P2/P3 and P4/tooling. This is a broad source/data-flow audit, not an exhaustive line-by-line security audit or runtime acceptance. Product tests and screens were not run by those auditors.

The supplied #889 screenshot report concerns `d17ae0e8`, compared with upstream `42bb8011`, reportedly CI run `39719374606` on `feat/kaneo-parity-harness`. The later integration verified the live PR head and adopted relevant source; the screenshots themselves were not independently reviewed. The local harness audit found capture failures could still exit successfully, mismatched seed content and no existing pixel gate. Only desktop/dark pairs were reportedly reviewed; the other sets and three timed-out captures remain unverified. Do not transfer that evidence to this checkout.

## Baseline findings and action

| Concern | Source finding | Action / owner phase |
| --- | --- | --- |
| Parallel Kaneo/work surfaces | `nav-projects.tsx` and `project-list/projects-page.tsx` select `/agent/projects/$projectKey/work`. Original board uses `useGetTasks` → `fetchers/task/get-tasks.ts` → `task/repository.ts` → `taskTable`; SIT seed writes `workItemTable`. | P1: one canonical persisted work model mounted in original Kaneo board/list/detail; redirect legacy URLs. A sidebar-only fix is insufficient. |
| Detail and triage design | `components/work-item/work-item-detail.tsx` is separate from `components/task/task-details-content.tsx`. Activity composer uses `border-warning/50 bg-warning/5`. `agent/triage.tsx` uses custom list/filter composition. | P1/P2: reuse Kaneo title, Sub-tasks, Relations, neutral composer, `Layout.Header`, table and filter controls. Sidebar glyph overlap needs browser reproduction on the chosen source. |
| Relations and hierarchy | Parent/tree/children controllers and pagination tests exist. `work-item/index.ts` describes partial `no_open_blockers` support because canonical `work_item_relation` persistence is absent. Original task relations are a separate domain. | P1: finish canonical relation persistence, guards and UI; verify hierarchy lifecycle and concurrency. |
| Seed hides features | `apps/api/scripts/seed-sit-users.ts` creates three default-state work items without the requested dates, assignees, hierarchy, relations, comments, SLA instances or approvals. | P1: realistic repeatable seed and actual Calendar/Gantt/board verification. |
| Deletion safety | Work-item/comment deletion directly soft-deletes/tombstones; attachment deletion acknowledges missing pending action. `pending-action/deletion-targets.ts` wires saved views/service calendars. | P1: cover item, comment, attachment, project and workspace browser deletion, bulk and legacy routes. P4: API/MCP approval paths. |
| Split settings | Kaneo dashboard settings coexist with agent settings. Roles already have Kaneo workspace settings; service settings use other routes. | P1–P4: one exposed navigation/shell, preserving working settings and old URLs. |
| Missing scheduled work | `apps/api/src/scheduler/index.ts` registers only due-date reminders, session cleanup, pending-action expiry and approval reminder scan. Domain SLA scan exists separately. | P0/P2/P4: schedule remaining jobs with observable execution and safe retries. |
| Test debt | Unit/integration/browser suites exist across core, identity and portal. Their presence does not close the 25 Entra cases, escalation/reopen, portal field/comment/cookie isolation or view acceptance. | Every phase: run local coverage against each retained requirement. P3 real Entra remains external until provisioned. |
| Policy and mock claim | Host guard, policy registry, permission tests and persisted repositories exist. No fresh complete mock sweep or runtime route-policy acceptance was performed by the source auditors. | P0: run gates and inspect reachable screens. Do not inherit the earlier “no mocks/no unpoliced routes” claim. |
| Deployment provenance | Backup/restore scripts, signed release pipeline and digest validation exist. Six pre-existing edits include SIT Compose; no host/image was inspected here. Backup script has DB/files/checksums, with no encryption/offsite transfer found. | P0/final handoff: encryption/offsite, real isolated restore and signed CI-image deployment evidence. |
| Missing parity gate | No `check:kaneo-parity` package command or local harness found in this checkout. | P1: obtain/reconcile supplied harness, add deterministic captures/diff and fail on missing screenshots. |

## Existing capability to retain

- **P0:** host guard before auth/CORS, route policies, auth restrictions, migration/image/release/backup scripts. Run them; do not rebuild from scratch.
- **P1:** work-item CRUD/assignment/ranking/hierarchy/labels/comments/attachments/activity, search/views/inbox and extensive tests. Integration and deletion safety remain incomplete.
- **P2:** `packages/domain/src/{sla,calendar,workflow,approvals,assignment,intake}`; real SLA/calendar/request-type settings and APIs. Approval request/candidate authoring and milestone/stakeholder UI were not found in the inspected web inventory. Verify all workflow/approval/escalation journeys.
- **P3:** actual portal paths cover catalogue, requests, submission detail and sign-in; home redirects. Approvals, projects and account screens are absent from the inspected portal allowlist. Escalate, reopen, satisfaction and customer backlog actions were not found. OIDC/SCIM and administration have substantial implementation; real Entra acceptance is unverified.
- **P4:** roles, audit chains/read APIs, identity administration, pending actions, inbox/preferences and notification delivery primitives exist. No complete team/custom-field administration or general/branding/storage/features/jobs/plugins God Mode interface found.
- **P4 runtime gaps:** no caller found for `notification/outbox-drain.ts`; eligibility contains unresolved quiet hours/customer destinations. `plugins/registry.ts` returns no active integrations. General automation dry-run, webhook retry/history, read-only-default MCP with destructive pending actions and complete audited impersonation remain unfinished. `packages/mcp/src/register.ts` includes direct destructive legacy tools and needs a dedicated authorization audit.

## Audit limits

Every P0–P4 requirement remains unverified until its implementation, passing test and real screen/journey evidence are linked. Source absence findings are scoped to the searched inventory, not a proof that no alternative implementation exists. No blanket “full audit passed”, completion percentage, stage sign-off, security clearance or SIT claim is made.

These findings describe the pre-integration baseline. Product changes and local verification are now underway; [status](status.md) records actual results, including populated Kaneo views, realistic seed and relations integration. Rows are not closed by source changes alone. See [roadmap](roadmap.md) for the remaining implementation order.

## Whole-product planning follow-up

The follow-up expanded documentation to all original features and operating/import requirements. See [features](features.md), [alignment](alignment.md) and the full [roadmap](roadmap.md). Original sources define P0–P7; P8/P9 are proposed later-candidate groups. This is scope reconciliation, not additional runtime or line-by-line code-audit evidence for later phases.


## Original interaction gaps discovered during the 22 October repair

Read-only source discovery across the touched surfaces; this is not runtime acceptance or the independent phase review. UI-13/16 track repairs beyond Thomas's screenshots.

- Activity still renders custom comment/event rows instead of original Activity/Timeline/CommentCard presentation; native grouped-change disclosure, author/avatar hover, edit/delete permission affordances and linked composer attachments need reconciliation. Shared original presentation and Collapsible repair assigned; missing persisted actions stay open.
- Board context-menu callback is a no-op, original column add icon is missing, and hardcoded display preferences suppress labels/item counts. Preserve real canonical permissions/projections while restoring original menus/column controls/preferences.
- Grouped List mounts DndContext without handlers and disables row dragging; original list drag/reorder and context-menu behavior remain owed.
- Full-page detail lacks original TaskCrumbSelect task switching. Property popovers lack original numbered keyboard shortcuts.
- Create dialog is a stacked form rather than original title-first modal. UI-14 repairs presentation/controller reuse; UI-15 carries dates/assignment/labels and column/create-more behavior through real APIs.

No raw native control replacements were found in the God Mode notification form: existing SettingsShell/Card/Input/Switch/Checkbox/Button are used. Semantic form/fieldset, native validity reporting and hidden upload inputs are necessary browser structure, not replacement UI.
