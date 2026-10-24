# Full product roadmap — P0–P9

**Direction:** original Kaneo screens and components (library UI only), real persisted data, laptop verification, one Opus review at the end of each phase, then commit and push the feature branch. No rebuild. Status counts come from the requirement index and audit evidence, never invented percentages. Progress is shown in `docs/report/report.html`.

## Goal (set 22 October 2026, owner Thomas)

**Finish P0–P4 as fast as possible, starting tonight** (24 Oct: P0–P4 committed, P5 in review; see the phase status below). Each phase: implement and design → local gates → one Opus review → pass: commit/push and next phase; fail: `report.html` only and wait for Thomas. P5–P7 follow; P8/P9 stay proposed.

| Bucket | Items |
| --- | --- |
| Closable locally | Remaining P0–P4 implementation, UI parity with Kaneo, persisted browser journeys, local gates, backup/isolated restore |
| Externally blocked (reported, never marked done) | Real Entra tenant (25 cases), external penetration test, signed/digest-pinned image now that GitHub CI is off |
| Decided 22 Oct | "Git update" = commit + push the feature branch (never main). Technexus image: after local SIT passes, push → PR → CI scan/build → deploy that image. Archive items (retirement order, terminology overlay, engagement RAG) are added back only if verified needed |

**Approved by Thomas, 22 Oct:** all P0–P4 tasks in the [audit](report/audit) (`tonight_actions` and top gaps per phase) are approved as additional tasks on top of the rows below. Run phase by phase (P0 → P1 → P2 → P3 → P4), parallel inside a phase only on disjoint paths. No further approval is needed before starting a phase; the only stop is a failed Opus review.

**Updated 23 Oct (Thomas approved the full plan):** extend the same loop through **P5** (then P6–P7). P4 closes out its carries before its Opus review; P5 follows in lanes A–F (agile planning; time and cost; reports and dashboards; knowledge base; services, changes, releases; contracts then customer invitations / typed-domain SSO / Pages) with migrations 0148–0157 reserved, per [audit-P5](report/audit/audit-P5.json). Decisions taken as recommended: `task_time_entry` rename, inline-SVG charts with Table equivalents (no recharts), dnd-kit dashboard grid (no react-grid-layout), indented-list service impact, estimates in project settings, CAB workflow opt-in for existing workspaces, scratch DB before the live DB with `NOT VALID` foreign keys, staff-only project Pages, customer-scoped invitations that refuse staff roles. Old PRs #880 and #886/#888/#889 were closed as superseded.

Phase exit criteria are the visible-finish column below plus a passing Opus review. Update this Goal block and the report whenever it changes.

## Phase status (24 October 2026)

| Phase | State |
| --- | --- |
| P0–P3 | Done, Opus-reviewed (AI reviewed, not Thomas-accepted), committed and pushed |
| P4 | Committed `c02a0892b` and pushed (5 Opus rounds, round 5 pass); review notes in `1de552577` |
| P5 | Built, **not committed**. Opus rounds 1–4 failed, every medium fixed; round 5 (extra round) in progress |
| P6–P7 | Not started. P8/P9 proposed |

**Honest note: P0–P5 are only half finished.** "Reviewed" means code audit plus tests; nothing from P4 or P5 is browser-verified, and each phase carries partials, missing items and external blockers (P5 audit: 62 implemented and tested, 3 untested, 22 partial, 4 missing of 91). The `carry` lists per phase in [report data](report/data.json) are the open work, not a footnote. Detail in [status](status.md).

## Added priority: exact Kaneo work-item experience

**Thomas rejected the current work-item experience on 22 October.** Similar colours or reused cards do not meet the requirement. His board, sheet and full-page examples and upstream `42bb8011` are the baseline. These tasks extend P1 and take priority within the continuing P0–P4 integration; every existing feature and safety requirement remains in scope.

| ID | Additional task | Visible acceptance |
| --- | --- | --- |
| UI-01 | Normal board/list card click opens the original Kaneo task sheet through URL selection. Preserve genuine full-page links and modifier clicks. | Board remains in place with its scroll, filters and selection; Back/Forward restore the correct task. |
| UI-02 | Share the original sheet wrapper and retained-content lifecycle. Keep its existing motion primitives. | Original width, slide/fade, blurred backdrop, close animation, Escape, outside click, focus restoration and mobile scrolling; no flash or full-page jump. |
| UI-03 | Share the original task page/sheet presentation with canonical API adapters. | Matching header boundary, property strip/sidebar, label placement, content width, spacing, typography and title/description editing. |
| UI-04 | Restore original Activity composition and composer behavior. | Composer above history, original editor/attachment/send placement and comment cards; visibility, drafts, authorship, permissions and exact-comment links still work. |
| UI-05 | Place SLA, approvals and attachments into existing Kaneo disclosure slots. | Real features stay accessible; empty permanent cards do not displace the task or conversation. New open-section state is URL-backed. |
| UI-06 | Restore original task actions and keyboard behavior using safe canonical mutations. | Delete/expand/close/copy/edit appear and behave where Kaneo places them; pending confirmation, denial and concurrent-change handling remain real. |
| UI-07 | Reconcile create/open/expand/return flows across board, list, backlog, search and saved views. | One consistent task experience; no competing page/pane behavior or duplicate shells. |
| UI-08 | Restore Kaneo drag-and-drop using its existing DnD components and canonical rank/transition APIs. | Drag within a column to reorder; drag to a permitted column to change stage, including empty columns. Original overlay, placeholder, settling motion, auto-scroll and keyboard interaction; order/state survive reload. |
| UI-09 | Verify interaction parity, then recapture matching themes/viewports. | Open → edit → switch task → expand → return → close checked in a real browser; desktop/tablet/mobile × light/dark evidence and parity gate. Screenshots alone do not verify motion. |

| UI-10 | Remove the added Move up / Move down / Change state controls from board cards and drag previews. | Original uncluttered Kaneo cards remain during pointer, focus and drag interaction; keyboard operation uses the existing DnD affordances. |
| UI-11 | Diagnose and fix failed cross-column moves across workflow offers, version checks and rank persistence. | A permitted move succeeds and persists; a genuinely blocked transition explains its actual reason and restores the previous card/order. No blanket bypass of workflow, approvals or permissions. |
| UI-12 | Verify the complete board interaction locally against pinned Kaneo. | Reorder upward/downward, move across populated/empty columns, cancel a drag, keyboard move, auto-scroll, reload and concurrent-change/denial checks. No extra text buttons or generic failure treated as acceptance. |

| UI-13 | Audit touched surfaces for native-control or hand-built replacements of existing Kaneo UI/library behavior. | Restore the original component/library and retain all integrated capabilities, keyboard/focus/motion and persisted mutations. Semantic HTML inside these components is allowed; replacement screens or text-button workarounds are not. |

| UI-14 | Restore original Kaneo creation flow instead of the stacked Create work item form. | Shared original dialog/breadcrumb, title-first editor, compact real property controls, footer/Create more, keyboard/focus/motion and real persisted canonical creation. Required service-desk fields fit the original surface; unsupported controls are not faked. |

| UI-15 | Carry every original create capability into canonical persisted creation. | Real dates, assignment, labels and column/create-more behavior are retained through supported APIs and permissions. Missing API integration is an open task, never a reason to fake a chip or silently drop a feature. |
| UI-16 | Repair other lost original interactions discovered across touched screens. | Working canonical context menus, grouped-list drag/reorder, original activity/comment presentation and library disclosures; source reuse plus persisted browser journeys. Audit beyond the supplied examples. |

These tasks share the canonical Kaneo surface rather than creating another interface. Current implementation and verification are in [status](status.md), not inferred from a component or test name. The continuing creation slice restores memory-only attachment staging with real post-create uploads and honest partial outcomes; durable navigation continuation, inline completion and performance remain separately tracked. One consolidated independent phase review remains the boundary; these rows add no per-change approval rounds.

## Order

Start with P1's Kaneo/data unification because it produces the first visible result and sets the placement for everything else. Repair P0 safety/runtime issues alongside that work on disjoint files. Finish P0 and P1 acceptance before building P2 journeys. Then complete P2 → P3 → P4 → P5 → P6 → P7. Existing code is reused throughout. Import discovery can begin early, but final migration/cutover follows stable destination features. Accessibility, security, recovery and performance fixes happen in every phase; P7 verifies the complete customer-ready product. P8/P9 are unscheduled proposed groupings for the original later candidates, not prerequisites that delay P0–P7.

| Phase | Implementation, integration and design | Visible finish and local proof |
| --- | --- | --- |
| **P0 Foundation** | Preserve host/auth/tenant/route-policy boundaries. Make laptop startup, migration, seed and both bundles repeatable. Replace docs-dependent process machinery with concise technical contracts and phase reporting. Finish missing job execution/recovery infrastructure, encrypted/offsite backup and safe restore. Reconcile source branches before adopting #889. | Fresh laptop stack; agent and portal on separate origins; rejected cross-tenant/host/session access; database plus uploaded file restored into an isolated instance. Local lint/types/unit/permissions and relevant integration tests pass. |
| **P1 Core work** | Connect original Kaneo board/list/task components to canonical work-item APIs, including reads and mutations. Sidebar/project click opens that board. Redirect `/agent/.../work` while preserving filters, selections and old links. One settings navigation. Complete hierarchy, relations/blockers, attachments, comments/activity, assignment, labels, ranking/backlog, saved views/search, inbox/My work, realtime and pending-action deletion. | A team creates, assigns, schedules, ranks, discusses, relates and safely deletes work through Kaneo. Board/list/detail/Calendar/Gantt show the same persisted dated records. Reload and a second session retain changes. Permission, concurrency and hierarchy journeys pass. |
| **P2 Service desk** | Keep existing domain engines. Finish workflow/role guards and authoring, SLA policies/calendars/pauses/breaches with scheduled scan, request-type/form versioning, triage accept/decline/merge/clarify, durable submissions, approval request/candidates/decisions/CAB, audit, milestones/prerequisites/stakeholders/escalation. Mount in Kaneo settings, project tabs and task sections. | Submit → triage → work item → SLA clock/pause/breach → approval → resolution. Agent can configure it through Kaneo and see persisted results. Real timer/job execution and denial tests pass. |
| **P3 Portal and identity** | Complete portal home, requests/detail, catalogue/form, approvals, projects and account. Use Kaneo composition adapted to customer permissions. Finish escalation-only priority, own-backlog rank, public conversation/files, satisfaction, reopen, invitation/onboarding and private/organisation visibility. Finish agent/customer-scoped OIDC/SCIM, God Mode identity/organisation navigation, MFA/sessions and deprovisioning. | Customer raises/tracks/approves/rates/reopens within policy and cannot see internal fields or another organisation. Agent cookie cannot authorize portal access. Local identity fixtures pass; all 25 real Entra acceptance cases are separately run when a tenant is available. |
| **P4 Governance** | Complete role/reach administration, teams, custom fields, hierarchical flags/locks and God Mode configuration. Wire notification delivery worker, destinations, preferences, quiet hours/digests. Finish automations/dry-run behind flags; signed webhooks/retries/history/SSRF controls; bounded personal/service keys; read-only-default MCP and destructive pending actions; audited impersonation; identity operations and config export. | Configure a fresh instance for a customer through existing Kaneo settings/God Mode without source edits. Exercise delivery/retry, dry-run, key revocation, MCP approval and audit evidence locally. |
| **P5 Planning, insight and knowledge** | Cycles/modules/estimates, advanced Calendar/Gantt, timer/manual time and weekly timesheet, rates/costs/budgets/capacity; all 20 fixed reports, saved tables, custom chart builder and dashboards; versioned knowledge/deflection; service catalogue, changes/freezes/CAB and releases. Define Pages behavior before its implementation. Reuse Kaneo project tabs, work views, task sections, tables/editor and settings. | Plan and complete a cycle; log a week and inspect budget; answer an SLA/customer question with drill-down; publish an article and observe portal deflection; schedule a change with a real freeze/approval; publish selected release notes. Every result persists and respects reach. |
| **P6 Import and cutover** | Structured and bounded agent-assisted import for ADO, Plane, Jira/JSM, Planner, Power Apps and generic CSV. Editable mappings, dry-run, authorship/history/files/relations, provenance, chunking/idempotency/resume and reconciliation. God Mode run history/mapping tables. Rehearse backups, rollback and source retirement. | Import representative real exports/copies; interrupt/resume/rerun without duplicates; reconcile counts and every reported loss; open original-looking work items with history and files. Retire each old tool only after its replacement and migration are accepted. |
| **P7 Customer readiness** | Complete accessibility/responsive/localisation/onboarding, realistic performance/load, external penetration test, data protection/retention, full recovery rehearsal, stable installer, multi-architecture packaging, Compose/Helm operations, user/admin/API/migration documentation and commercial handoff. | A new customer installs, configures and upgrades the same image; users complete agent/portal journeys on supported devices; an operator restores it. Published docs match shipped behavior. Measured budgets and unresolved external findings are reported honestly. |
| **P8 Integrations and enterprise extensions — proposed** | Original later candidates: chat/developer integrations, additional identity and conditional delegated/Bulk provisioning, inbound email, malware protection and marketplace distribution. Choose provider-specific behavior and resolve external credentials/registration per slice. | Demonstrate one real provider journey end-to-end with scoped access, delivery/sync/retry, revocation and failure visibility using existing settings/task surfaces. Unspecific or unselected candidates stay recorded, not marked implemented. |
| **P9 Advanced collaboration and scale — proposed** | Original candidates: collaborative editing, formula/rollup fields, opt-in AI, multilingual KB, native mobile, public status, currency conversion, measured scale and third-party plugins. Keep excluded native CMDB/public boards and adjacent products as explicit product decisions. | Each selected feature has defined behavior, original-interface placement, actual persistence and multi-user/security/failure evidence. Scaling has recorded load/failover proof. No invented completion date or automatic acceptance. |

## First visible implementation slice

1. Reconcile this checkout with #889 without overwriting another session's work. Record the chosen source; do not assume PR screenshots describe this checkout.
2. Adapt original Kaneo board/list/detail to `work_item` data and permissions. Remove duplicate composition only after all its working actions are carried over. Do not create shadow `task` copies to make the old board look populated.
3. Route project navigation to that working board. Use Kaneo Filter, Sort and Board/List controls. Fix search glyph spacing in the existing sidebar.
4. Use Kaneo title wrapping, Sub-tasks and Relations sections; replace the tinted composer with the original composition. Finish missing canonical relation persistence alongside it.
5. Recompose triage with Kaneo `Layout.Header`, table and filter control while retaining its real actions.
6. Seed dated items across states, assignees, comments, parent/child, relation, SLA and pending approval. Seed twice safely; do not modify customer data.
7. Open all changed screens locally, repair failures and recapture upstream/candidate pairs. No review request for each bullet.

## Cross-cutting completion work

- Wire the missing SLA scan, attachment cleanup, retention, outbox/digest delivery and retry execution with eligibility, idempotency and failure tests. Preserve the original triggers: position rebalance is on demand when rank gaps are too small; audit verification is on-demand CLI/God Mode; webhook retries belong to outbox-drain. Assign each to its owning phase.
- Close the seven audit concerns in [audit.md](audit.md), including deletion targets, one settings shell, identity/portal/view test debt, query ownership and deployment provenance.
- Add `check:kaneo-parity`: pinned upstream `42bb8011`, deterministic comparable scenarios, 20 screens × three sizes × two themes for each implementation, missing-capture failure, screenshot diffs and documented intentional additions. Use readiness assertions instead of blanket `networkidle`. Resolve the three reported timeouts. A captured image is not a reviewed image.
- Verify all agent and portal navigation, empty/error/loading states and keyboard paths. Keep existing performance budgets; measure laptop performance on recorded hardware. The 2-vCPU SIT server provides functional evidence only.

## One phase review, then decision

Implement → local tests → repair → local tests → phase journeys finished → one independent AI review covering UI/design/integration/security → repair and verify findings within that review → consolidated report → Thomas's selected walkthrough and decision → update the next phase plan.

Each report lists source, commands/results, opened URLs/screenshots, unresolved findings and external blockers. No new approval round for every small edit. An externally blocked phase may be reported as implemented/local verification complete; it stays unaccepted until its missing evidence and Thomas's walkthrough exist.

## Final SIT handoff

After local integration and the phase review, deploy to Technexus public SIT through the SSH proxy (`tickting.technexus.info`, `portal.technexus.info`, Cloudflare proxy enabled). GitHub CI is no longer used, so signed/digest-pinned image provenance needs a Thomas decision on the build path (open). Verify the actual source/digest, HTTPS, separate sessions, real data, backup → isolated restore and rollback. Report implemented / locally verified / SIT verified / blocked separately. No production deployment or automatic stage sign-off.

## Visible delivery sequence

| Next integrated demonstration | What Thomas can actually see |
| --- | --- |
| 1. Kaneo restored with real work | Sidebar opens populated original board; list/task/triage match Kaneo; realistic seed appears across views |
| 2. Reliable team work | Hierarchy/relations/files, bulk/ranking, search/views, permissions and safe deletion work after reload |
| 3. Support queue | Customer submission becomes triaged work with SLA, workflow, assignment and approvals |
| 4. Customer self-service | Complete portal and identity journeys with no internal data exposure |
| 5. Customer configuration | A fresh instance is configured in God Mode with real notifications, flags, roles and automations |
| 6. Delivery and management insight | Cycle, timesheet, budget, all reporting tiers, knowledge and change/release journeys |
| 7. Reconciled migration | Source history imported/resumed/repeated safely; old systems can be retired deliberately |
| 8. Customer-ready release | Install/upgrade/recovery, documentation, access/mobile/security/performance evidence and signed image |
| 9 onward. Selected extensions | Provider integrations first; advanced candidates only with defined behavior and visible demand |

The [feature catalogue](features.md) is the complete scope; [alignment](alignment.md) explains its original sources and remaining decisions. The [status](status.md) records evidence rather than inferring completion from this sequence. P0–P4 have the existing source audit; P5–P7 need implementation discovery before estimating their remaining work. P8/P9 are unscheduled candidates, not an accepted implementation promise for every listed idea.
