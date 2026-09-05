# Feature gap audit — OpenProject and six ITSM systems vs. TaskDesk v2

Source data: `subagents/workflows/wf_e78a9096-c46/journal.jsonl` (two feature-mining runs —
OpenProject; chatwoot/freescout/glpi/nocobase/osTicket/zammad). Checked against
`Ticketing.v2/docs/03-features/*`, `docs/01-architecture/*`, `docs/07-planning/roadmap.md`
and `docs/07-planning/review-2026-09-05.md` (read first to avoid duplicating its existing
gap list). CMDB/asset-inventory features and BIM features are out of scope per instructions
and are omitted below rather than scored.

Legend: **Present** = a v2 spec covers it (evidence file given). **Partial** = mentioned but
materially thinner than the reference system. **Missing** = no coverage anywhere in the
corpus, including the roadmap candidates table — a one-line recommendation and suggested
phase (P1–P7, or "candidate") is given, unless the item is already recorded elsewhere in the
corpus (marked "*(already recorded — see below)*" and excluded from Net new).

---

## Part 1 — OpenProject

### Present

| Feature | Evidence |
| --- | --- |
| Work packages (universal issue entity) | `work-items.md` |
| Project-based, human-readable IDs (`PROJ-123`) | `work-items.md` WI-2 |
| Multiple views (board/list/table/detail + side pane) | `views.md` |
| Table configuration (columns/filter/group, savable) | `views.md` Table layout, `search-and-saved-views.md` |
| Relations & hierarchies | `relations-and-hierarchy.md` |
| Bulk edit / duplicate / move / delete | `work-items.md` WI-21–27 |
| Baseline / point-in-time comparison | `audit-trail.md` AU-8/AU-9 (OpenProject's own journal design, explicitly credited) |
| Internal (private) comments | `comments-and-activity.md` CA-1–5 |
| Configurable per-type forms | `custom-fields.md` (sections + per-type visibility) + `request-types-and-catalogue.md` form builder |
| Date alerts (due-soon / overdue notifications) | `notifications.md` `work_item.due_soon` / `.overdue` |
| Attribute help texts | `custom-fields.md` field editor |
| Per-type × per-role workflows & statuses | `workflows.md` (explicitly modelled on, and called more expressive than, OpenProject's) |
| Portfolio/Program/Project hierarchy, incl. rollup | `projects-and-engagements.md` PR-1–5 (one hierarchy instead of three concepts) |
| Share project lists (team/workspace-scoped saved views) | `search-and-saved-views.md` SV-15–18 |
| Saved planner/view visibility (private/team/workspace) | `search-and-saved-views.md` SV-15–21 |
| Burndown charts, story points | `agile.md` CY-7, ES-1 |
| Agile/Kanban board | `views.md` Board layout |
| Calendar | `views.md` Calendar layout (VW-25/26) |
| Time & cost tracking + budgets, my-time view | `time-and-cost.md` (time vs. cost modelled separately, explicitly credited to OpenProject) |
| Project home overview | `projects-and-engagements.md` "overview" screen |
| Universal quick search / command palette | `search-and-saved-views.md` SV-1 (`⌘K`) |
| Activity module | `comments-and-activity.md` |
| Members management | `projects-and-engagements.md`, RBAC |
| Users/groups/permissions administration | God Mode → Users, `roles-and-permissions-ui.md` |
| OAuth/OIDC/MFA authentication | `auth-and-identity.md` |
| Custom branding / white-labeling | `god-mode.md` Branding section |
| Plugin management | `god-mode.md` Plugins section |
| System status/health page | `god-mode.md` Health section (landing page) |
| Webhook configuration | `webhooks-and-api-keys.md` |
| REST API | `api-design.md` |
| MCP server API | `mcp-server.md` |
| Grids/dashboard widget framework, My Page | `reports-and-dashboards.md` RP-13–16 |
| Background job status view | `god-mode.md` Jobs section |
| reCAPTCHA protection | `auth-and-identity.md` threat notes ("optional CAPTCHA plugin") |
| Avatars | referenced throughout (person-picker, profile settings) |
| Reporting engine (cost/time) | `reports-and-dashboards.md`, `time-and-cost.md` |
| Generic external storage abstraction (S3/Azure/filesystem) | `storage-and-attachments.md` `StorageBackend` plugin contract |

### Partial

| Feature | v2 spec | Gap |
| --- | --- | --- |
| Export work packages / Excel export module | `views.md` VW-23, `reports-and-dashboards.md` RP-10 | CSV only — no native XLSX |
| Read-only mode for a single work package | `work-items.md` WI-20, `projects-and-engagements.md` PR-15 | Only whole-project archive is read-only; no per-item lock without archiving |
| Custom fields across many entity types | `custom-fields.md` "Entities that support custom fields" | Work items (P4), projects/people (P5) only — OpenProject also covers spent-time entries and versions |
| Workspace templating & cloning | `settings-hierarchy.md` (one line: "default project template") | No described clone/templating workflow, unlike OpenProject's explicit project/portfolio cloning |
| User capacity/utilisation visualisation | `time-and-cost.md` TC-20–22 | Reporting-only percentage; no allocation UI, no over-allocation warning (see Resource management, Missing) |
| Non-working-day-aware scheduling in views | `service-calendars.md` (SLA-side), `views.md` Timeline | Calendars drive SLA math; the Timeline/board views don't describe blocking a drag onto a non-working day |
| Backlogs (Scrum) module | `agile.md` cycles (CY-1–9) | No named backlog buckets, no sprint-goal text field, no auto-created per-sprint board, no cross-project sprint sharing — the simpler cycle model covers the mechanics, not the ceremony |
| "All sprints" overview | `agile.md` (cycles list screen) | Present in spirit, not a named cross-status overview screen |
| Gantt chart + PDF export | `views.md` Timeline layout (VW-27–30) | Present as "Timeline"; no PDF export (only CSV, and only from Table) |
| Roadmap module (built from versions) | `agile.md` Modules (MO-1–4) | Progress/target-date tracking exists per-module; no dedicated roadmap view |
| Documents module | `projects-and-engagements.md` "Documents — links to external systems" | Links only, off by default for customers — no native repository, versions or folders |
| Application home page dashboard | `reports-and-dashboards.md` RP-13–16 (personal/workspace dashboards) | No instance-wide welcome/favourites/community-links landing widget set (God Mode Health is the closest, and is admin-only) |
| Third-party integrations (Slack et al.) | `webhooks-and-api-keys.md`, `notifications.md` (Slack/Teams/Discord channels) | Generic webhook + notify-Slack present; no Dialogflow/Shopify/Linear-specific connectors |

### Missing

| Feature | Recommendation | Phase |
| --- | --- | --- |
| Resource management: named allocation, over-allocation warning, skill-based unstaffed requests, staffing view, team planner calendar | Build on top of the existing capacity numbers (`time-and-cost.md` TC-20–22) and `service-calendars.md`'s non-working-day logic — a calendar-style per-assignee planner plus a "request by skill, staff later" work item state | P5 (extends Insight/agile), or candidate if P5 scope is already tight |
| Custom field types: hierarchy-structured, weighted-list | Extend `custom-fields.md`'s field-format table; distinct from the already-rejected formula/rollup fields | P4, or candidate |
| Custom (one-click) action buttons — a manually triggered bundle of field/state changes | Distinct from `automations.md` (trigger-based) and `workflows.md` transitions (state-only); add a manual-trigger action kind | P4, alongside automations |
| Meetings module (agendas/minutes), Wiki, Forums, News/announcement feed | Entirely absent from the corpus. Per the review's own "features inherited or dropped" process, decide explicitly rather than by omission; if kept, a lightweight wiki reusing the existing Tiptap editor is the cheapest slice | Candidate |
| Antivirus/malware scanning of uploaded attachments | `storage-and-attachments.md` only sniffs MIME/magic bytes today — add a `storage.antivirus` plugin (e.g. ClamAV) gating `attachments/{id}/complete` | P1/P2 hardening of an already-P1 feature; flag for the security review |
| Collision/"someone else has this open" indicator | Distinct from the optimistic-concurrency conflict-on-save v2 already has (`work-items.md` WI-7). Cheap given the WebSocket infrastructure every view already uses (`views.md` VW-5) | P1/P2 candidate |
| System-wide announcement banner | Add to God Mode → General, distinct from per-user notification channels | P4, low cost |
| Placeholder users (assign before a real account exists) | Candidate; revisit if contractor/onboarding gaps surface once MS Planner is retired | Candidate |
| Project templating/cloning as a first-class action | `settings-hierarchy.md` names it in passing only; make it a real action on `projects-and-engagements.md` | P1 extension |
| .well-known OAuth discovery endpoints (RFC 8414/9728) | Standards-compliance nicety for external MCP/OAuth clients auto-configuring against the instance | Candidate, low priority |

---

## Part 2 — chatwoot / freescout / glpi / nocobase / osTicket / zammad

### Present

| Feature | Evidence |
| --- | --- |
| Help Center / Knowledge Base portal | `knowledge-base.md` |
| Private notes & @mentions | `comments-and-activity.md` CA-12 |
| Labels/tagging | `work-items.md`, throughout |
| Command bar & keyboard shortcuts | `search-and-saved-views.md` SV-1 |
| Canned responses / text modules (snippets) | `comments-and-activity.md` CA-19/20 |
| Custom views & saved filters | `search-and-saved-views.md` |
| Business hours + out-of-hours behaviour | `service-calendars.md` |
| Teams + automation/business-rule engine | `automations.md`, `settings-hierarchy.md` Teams |
| Custom attributes/fields | `custom-fields.md` |
| Reporting suite incl. CSAT | `reports-and-dashboards.md` ("Satisfaction — CSAT by customer and by request type") |
| Module/plugin marketplace | `plugin-architecture.md`, ADR 0013 |
| Starred/followed conversations (watchers) | `work-items.md` WI-28/29 |
| Clipboard screenshot paste | `attachments.md` AT-11 |
| Push notifications (self-hosted) | `notifications.md` (ntfy/Gotify channels) |
| Zapier/Make/n8n-style automation integration | `webhooks-and-api-keys.md` (named explicitly as the integration story) |
| Migration importer | `06-data-import/*` (import-strategy, field-mapping, azure-devops, plane) |
| Impact analysis (service dependency graph) | `service-management.md` SV-5 — not CMDB, a service-to-service graph |
| Service catalogue + Service Level Management | `request-types-and-catalogue.md`, `service-management.md`, `sla.md` |
| Entity separation / hierarchical multi-tenancy | `multi-tenancy.md`, God Mode Organisations |
| Embedded AI agents with scoped, audited permissions (NocoBase pattern) | `mcp-server.md` MC-2/MC-4 — an agent's API key can never exceed its owner's authority, and every call is audited as agent-originated |
| Audit log of AI + human actions | `audit-trail.md` AU-5, `mcp-server.md` MC-4 |
| Open agent protocol surface (MCP + webhooks/API) | `mcp-server.md`, `webhooks-and-api-keys.md` |
| Realtime updates (GraphQL+ActionCable in Zammad's case) | `realtime.md`, `views.md` VW-5 — functionally equivalent via REST + WebSocket, not GraphQL specifically |

### Partial

| Feature | v2 spec | Gap |
| --- | --- | --- |
| Full ITIL suite (Incident/Problem/Change/Request Fulfillment) | `service-management.md` (Change is deep: CAB, freeze, release) | Problem management explicitly reduced to "a problem work item type," out of scope as a distinct workflow (known-error/root-cause tracking) |
| Multi-channel intake (web/email/phone) | `customer-portal.md`, `intake-queue.md` IQ-1 (names email as a future source) | Email is a named-but-unscheduled roadmap candidate; phone is not mentioned at all |
| WYSIWYG/no-code configuration mode | `request-types-and-catalogue.md` form builder, `roles-and-permissions-ui.md` role editor (both have live preview) | No universal drag-build-everything mode like NocoBase's usage/config toggle — scoped to forms and roles only |
| Ticket forward/merge/move | `relations-and-hierarchy.md` `duplicates` relation, `intake-queue.md` IQ-17 (merge at triage) | Post-acceptance merge of two live work items *(already recorded — see review-2026-09-05.md "Merge and split after acceptance")* |

### Missing

| Feature | Recommendation | Phase |
| --- | --- | --- |
| Email open tracking | Low priority; note if/when inbound email ships | Candidate |
| In-browser UI-string translation (JIPT-style) | Distinct from the roadmap's "Multi-language KB" (content, not UI chrome) | Candidate, low priority |
| Telephony as a native intake channel | Extension of the unscheduled "Inbound email to ticket" candidate | Candidate |
| Live supervisor view, agent-capacity caps, pre-chat forms, embeddable dashboard apps, outbound campaigns, CRM-style contact merge/history, on-site intervention/dispatch scheduling | Live-chat/CRM/field-service features that don't fit v2's ticket-and-portal architecture; no recommendation to schedule | N/A — architecture mismatch |
| Auto-assignment / round robin | **Not a gap** — deliberately rejected in `assignment.md` AS-15 ("rewards gaming, produces worse outcomes") | Decided against |

---

## Net new recommendations

Items below are the only ones **not** already present in `review-2026-09-05.md`'s "Product
gaps to schedule" table (Request participants/CC, Pending-until/snooze, Recurring work
items, Merge and split, GDPR export, SCIM provisioning, Developer-tool linking, Public
project boards), its kaneo inherited-features register, or `roadmap.md`'s candidates table
(Collaborative editing, SAML, LDAP/AD sync, Inbound email to ticket, Formula/rollup custom
fields, Mobile applications, AI classification/dedup/summarisation, AI-drafted articles,
Multi-language KB, Public status page, Asset management/CMDB, Multi-currency conversion,
Read replicas/sharding, Third-party plugin loading, Marketplace listings).

1. **Resource management / team planner** — named allocation with over-allocation warning,
   skill-based unstaffed resource requests, a staffing view, and a calendar-style team
   planner. OpenProject. Builds on `time-and-cost.md`'s existing capacity numbers and
   `service-calendars.md`'s non-working-day logic. **Phase: P5, or candidate.**
2. **Advanced custom field types** — hierarchy-structured and weighted-list, distinct from
   the already-rejected formula/rollup fields. OpenProject. Extend `custom-fields.md`'s
   field-format table. **Phase: P4, or candidate.**
3. **Custom fields on more entity types** — today work items (P4) and projects/people (P5)
   only; OpenProject also covers time entries and versions. Extend `custom-fields.md`.
   **Phase: P5.**
4. **Custom (one-click) action buttons** — a manually triggered bundle of field/state
   changes, distinct from `automations.md`'s trigger-based rules and a plain workflow
   transition. OpenProject. **Phase: P4, alongside automations.**
5. **Collaboration modules: Meetings, Wiki, Forums, News/announcements** — entirely absent
   from the corpus. OpenProject. Decide explicitly (keep/drop) rather than by omission, per
   the review's own process recommendation. **Phase: candidate.**
6. **Documents as a first-class internal repository** (versions, folders) — today only
   external links in `projects-and-engagements.md`. OpenProject. **Phase: candidate.**
7. **Antivirus/malware scanning of attachments** — `storage-and-attachments.md` only sniffs
   MIME/magic bytes; add a `storage.antivirus` plugin. OpenProject (Enterprise Corporate).
   **Phase: P1/P2 hardening; flag for the security review.**
8. **Collision detection / "someone else has this open" indicator** — distinct from the
   optimistic-concurrency conflict-on-save v2 already has; cheap given the existing
   WebSocket infrastructure. Chatwoot/FreeScout. **Phase: P1/P2 candidate.**
9. **System-wide announcement banner** — distinct from per-user notification channels; add
   to God Mode → General. OpenProject. **Phase: P4, low cost.**
10. **Placeholder users** — assign work to a stand-in before a real account exists.
    OpenProject (Enterprise Basic). **Phase: candidate.**
11. **Problem management as a genuine workflow** (root-cause/known-error tracking), not
    just a bare "Problem" work-item type — `service-management.md` explicitly puts this out
    of scope today. GLPI/ITIL. **Phase: candidate, revisit post-P5.**
12. **Project templating/cloning as a first-class action** — today one passing mention in
    `settings-hierarchy.md`. OpenProject. **Phase: P1 extension.**
13. **Native XLSX export** — today CSV only, across views/reports/attachments. OpenProject.
    **Phase: P5, low-cost addition alongside existing CSV export code.**
14. **Item-level read-only lock**, independent of archiving a whole project. OpenProject
    (Enterprise Basic). **Phase: candidate, low priority.**
15. **.well-known OAuth discovery endpoints** (RFC 8414/9728) for standards-based external
    client auto-configuration. OpenProject. **Phase: candidate, low priority.**
16. **Telephony as a native intake channel, email-open tracking, in-context UI-string
    translation** — each a low-priority extension of an already-scheduled or already-listed
    item (inbound email, multi-language KB); named here so they aren't silently assumed
    in scope when those ship. Zammad/FreeScout/osTicket. **Phase: candidate.**
