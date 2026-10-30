# Screen coverage

Maintained route inventory for automated coverage. 🟡 means built or in progress, never accepted (fresh feature/browser sign-off is pending; 25 Oct scripted login is authorized on the isolated audit copy); ⬜ means planned. All runtime and owner acceptance remains in [status.md](status.md). Retained original planned routes do not authorize parallel interfaces. Portal paths use the separate portal origin. Portal inventory lists host-root destinations; retained legacy redirects are compatibility checks, not separate screens.

| Screen | Route | Kind | Stage | Status |
| --- | --- | --- | --- | :-: |
| Sign in (legacy `/agent/sign-in` redirects) | `/auth/sign-in` | route | P0 | 🟡 |
| MFA challenge | `/auth/two-factor` | route | P0 | 🟡 |
| MFA enrolment | `/dashboard/settings/account/security` | route | P0 | 🟡 |
| Accept invitation | `/agent/invite` | route | P3 | ⬜ |
| Workspace home (default dashboard) | `/agent` | route | P1 | 🟡 |
| Inbox | `/agent/inbox` | route | P1 | 🟡 |
| My work | `/agent/my-work` | route | P1 | 🟡 |
| Global search results | `/agent/search` | route | P1 | 🟡 |
| Not found (agent origin) | `*` | route | P0 | ⬜ |
| Project overview | `/agent/projects/{key}` | route | P1 | 🟡 |
| Work — board | `/agent/projects/{key}/work?layout=board` | route | P1 | 🟡 |
| Work — list | `/agent/projects/{key}/work?layout=list` | route | P1 | 🟡 |
| Work — table | `/agent/projects/{key}/work?layout=table` | route | P1 | 🟡 |
| Work — calendar | `/agent/projects/{key}/work?layout=calendar` | route | P5 | ⬜ |
| Work — timeline | `/agent/projects/{key}/work?layout=timeline` | route | P5 | ⬜ |
| Backlog | `/agent/projects/{key}/backlog` | route | P1 | 🟡 |
| Cycles list | `/agent/projects/{key}/cycles` | route | P5 | 🟡 |
| Cycle detail | `/agent/projects/{key}/cycles/{cycleId}` | route | P5 | 🟡 |
| Modules list | `/agent/projects/{key}/modules` | route | P5 | 🟡 |
| Module detail | `/agent/projects/{key}/modules/{moduleId}` | route | P5 | 🟡 |
| Pages | `/agent/projects/{key}/pages` | route | P5 | 🟡 |
| Page view and editor | `/agent/projects/{key}/pages/{pageId}` | route | P5 | 🟡 |
| Milestones & prerequisites | `/agent/projects/{key}/plan` | route | P2 | ⬜ |
| Stakeholders | `/agent/projects/{key}/stakeholders` | route | P2 | ⬜ |
| Work item — full page | `/agent/work-items/{key}` | route | P1 | 🟡 |
| Intake queue and submission detail | `/agent/triage?state=new&ref={ref}` | route | P2 | 🟡 |
| Approvals inbox | `/agent/my-work?lens=approvals` | route | P2 | ⬜ |
| Services list | `/agent/service-management/services` | route | P5 | 🟡 |
| Service detail | `/agent/service-management/services/{id}` | route | P5 | 🟡 |
| Change calendar | `/agent/service-management/changes` | route | P5 | 🟡 |
| Releases | `/agent/service-management/releases` | route | P5 | 🟡 |
| Knowledge base list | `/agent/kb` | route | P5 | 🟡 |
| Article view | `/agent/kb/{id}` | route | P5 | 🟡 |
| Article editor | `/agent/kb/{id}/edit` | route | P5 | 🟡 |
| Reports index | `/agent/reports` | route | P5 | 🟡 |
| Report detail | `/agent/reports/{key}` | route | P5 | 🟡 |
| Report builder (tier 3) | `/agent/reports/new` | route | P5 | 🟡 |
| Report export (emailed link) | `/agent/reports/exports/{id}` | route | P5 | 🟡 |
| Dashboard | `/agent/dashboard` | route | P5 | 🟡 |
| Dashboard editor | `/agent/dashboard/edit` | route | P5 | 🟡 |
| Timesheet | `/agent/timesheet` | route | P5 | 🟡 |
| Saved views index | `/agent/views` | route | P1 | 🟡 |
| Saved view | `/agent/views/{id}` | route | P1 | 🟡 |
| Profile — general | `/dashboard/settings/account/information` | route | P1 | 🟡 |
| Profile — appearance | `/dashboard/settings/account/preferences` | route | P1 | 🟡 |
| Profile — notifications | `/dashboard/settings/account/notifications` | route | P4 | 🟡 |
| Profile — security & sessions | `/dashboard/settings/account/security` | route | P3 | ⬜ |
| Profile — pending actions (API/MCP-originated deletions awaiting my approval) | `/dashboard/settings/account/pending-actions` | route | P4 | 🟡 |
| Profile — pending action detail | `/dashboard/settings/account/pending-actions/{id}` | route | P4 | 🟡 |
| Profile — API keys | `/agent/settings/profile/api-keys` | route | P4 | ⬜ |
| Workspace — general | `/dashboard/settings/workspace/general` | route | P1 | 🟡 |
| Workspace — terminology | `/agent/settings/terminology` | route | P4 | ⬜ |
| Workspace — members | `/dashboard/settings/workspace/members` | route | P1 | 🟡 |
| Workspace — customer invitations | `/dashboard/settings/workspace/customer-invitations` | route | P5 | 🟡 |
| Workspace — teams | `/dashboard/settings/workspace/teams` | route | P4 | 🟡 |
| Team detail | `/dashboard/settings/workspace/teams/{id}` | route | P4 | 🟡 |
| **Workspace — roles** | `/dashboard/settings/workspace/roles` | route | P4 | 🟡 |
| **Role editor** | `/dashboard/settings/workspace/roles/{id}` | route | P4 | 🟡 |
| Workspace — work item types | `/dashboard/settings/workspace/work-item-types` | route | P2 | ⬜ |
| Workspace — states | `/dashboard/settings/workspace/states` | route | P1 | 🟡 |
| Workspace — workflows | `/dashboard/settings/workspace/workflows` | route | P2 | 🟡 |
| Workflow editor | `/dashboard/settings/workspace/workflows/{id}` | route | P2 | ⬜ |
| Workspace — SLA policies | `/dashboard/settings/workspace/sla-policies` | route | P2 | 🟡 |
| SLA policy editor | `/dashboard/settings/workspace/sla-policies/{id}` | route | P2 | 🟡 |
| Workspace — service calendars | `/dashboard/settings/workspace/calendars` | route | P2 | 🟡 |
| Service calendar editor | `/dashboard/settings/workspace/calendars/{id}` | route | P2 | 🟡 |
| Workspace request types and selected editor | `/dashboard/settings/workspace/request-types?requestTypeId={id}` | route | P2 | 🟡 |
| Workspace — custom fields (incl. sections) | `/dashboard/settings/workspace/custom-fields` | route | P4 | 🟡 |
| Custom field editor | `/dashboard/settings/workspace/custom-fields/{id}` | route | P4 | 🟡 |
| Workspace — labels | `/dashboard/settings/workspace/labels` | route | P1 | 🟡 |
| Workspace — canned responses | `/dashboard/settings/workspace/canned-responses` | route | P1 | 🟡 |
| Project — estimates (system, scale, cycle completion default) | `/agent/projects/{key}/settings/estimates` | route | P5 | 🟡 |
| Workspace — rates | `/dashboard/settings/workspace/rates` | route | P5 | 🟡 |
| Workspace — time activities | `/dashboard/settings/workspace/time-activities` | route | P5 | 🟡 |
| Workspace — cost types (Rates section) | `/dashboard/settings/workspace/rates` | section | P5 | 🟡 |
| Workspace — automations | `/dashboard/settings/workspace/automations` | route | P4 | 🟡 |
| Workspace — webhooks | `/dashboard/settings/workspace/webhooks` | route | P4 | 🟡 |
| Webhook editor | `/dashboard/settings/workspace/webhooks/{id}` | route | P4 | 🟡 |
| Webhook delivery history | `/dashboard/settings/workspace/webhooks/{id}/deliveries` | route | P4 | 🟡 |
| Workspace — import | `/dashboard/settings/workspace/import` | route | P6 | ⬜ |
| Workspace — danger zone | `/dashboard/settings/workspace/danger` | route | P1 | 🟡 |
| Project — general | `/agent/projects/{key}/settings` | route | P1 | 🟡 |
| Project — members | `/agent/projects/{key}/settings/members` | route | P1 | 🟡 |
| Project — states | `/agent/projects/{key}/settings/states` | route | P1 | 🟡 |
| Project — labels | `/agent/projects/{key}/settings/labels` | route | P1 | 🟡 |
| Project — SLA & calendar | `/agent/projects/{key}/settings/sla` | route | P2 | ⬜ |
| Project — features | `/agent/projects/{key}/settings/features` | route | P4 | 🟡 |
| Project — automations | `/agent/projects/{key}/settings/automations` | route | P4 | 🟡 |
| Project — budget | `/agent/projects/{key}/settings/budget` | route | P5 | 🟡 |
| Project — danger zone | `/agent/projects/{key}/settings/danger` | route | P1 | 🟡 |
| God Mode home / health | `/agent/god-mode` | route | P4 | 🟡 |
| Webhook security posture | `/agent/god-mode/webhooks` | route | P4 | 🟡 |
| General (incl. terminology) | `/agent/god-mode/general` | route | P4 | 🟡 |
| Branding | `/agent/god-mode/branding` | route | P4 | ⬜ |
| **Authentication providers** | `/agent/god-mode/authentication` | route | P3 | 🟡 |
| **Provider editor** | `/agent/god-mode/authentication/{id}` | route | P3 | 🟡 |
| Organisations | `/agent/god-mode/organisations` | route | P3 | ⬜ |
| Organisation detail | `/agent/god-mode/organisations/{id}` | route | P3 | ⬜ |
| **Organisation — Identity** (customer OIDC + SCIM connection) | `/agent/god-mode/organisations/{id}/identity` | route | P3 | 🟡 |
| Storage | `/agent/god-mode/storage` | route | P4 | 🟡 |
| Notification channels — SMTP configuration | `/agent/god-mode/notifications` | route | P4 | 🟡 |
| Deliveries (outbox, dead letters) | `/agent/god-mode/deliveries` | route | P4 | 🟡 |
| Workspace — features | `/dashboard/settings/workspace/features` | route | P4 | 🟡 |
| Feature flags | `/agent/god-mode/features` | route | P4 | 🟡 |
| Jobs | `/agent/god-mode/jobs` | route | P4 | 🟡 |
| Plugins | `/agent/god-mode/plugins` | route | P4 | 🟡 |
| Observability and instance MFA policy | `/god-mode/observability` | route | P0 | 🟡 |
| MCP usage | `/agent/god-mode/mcp` | route | P4 | 🟡 |
| Audit log | `/agent/god-mode/audit` | route | P2 | 🟡 |
| Import runs (shared P4 prerequisite) | `/agent/god-mode/imports?workspaceId={workspaceId}` | route | P6 | 🟡 |
| Import run detail | `/agent/god-mode/imports/{id}?workspaceId={workspaceId}` | route | P6 | 🟡 |
| Users | `/agent/god-mode/users` | route | P4 | 🟡 |
| Sign in | `/sign-in` | route | P3 | 🟡 |
| Accept invitation | `/invite/{id}` | route | P3 | 🟡 |
| Home | `/` | route | P3 | ⬜ |
| Request detail (work item) | `/submissions/{ref}` | route | P3 | ⬜ |
| Catalogue | `/catalogue` | route | P3 | ⬜ |
| Request form | `/catalogue?key={typeKey}` | route | P3 | ⬜ |
| Customer portal — request catalogue and selected form | `/catalogue?q=no-match&key=access` | route | P3 | 🟡 |
| Customer portal — submission detail | `/submissions/{ref}` | route | P3 | 🟡 |
| Approvals | `/approvals` | route | P3 | ⬜ |
| Projects list | `/projects` | route | P3 | ⬜ |
| Project detail | `/projects/{key}` | route | P3 | ⬜ |
| Knowledge base | `/kb` | route | P5 | 🟡 |
| Article | `/kb/{id}` | route | P5 | 🟡 |
| Satisfaction survey | `/submissions/{ref}` | route | P3 | ⬜ |
| Customer notification inbox and bell | `/notifications?filter=unread` | route | P4 | 🟡 |
| Account (mention/comment email notification preferences; remaining controls open) | `/account` | route | P3 | 🟡 |
| Not found (portal origin) | `*` | route | P3 | ⬜ |
| Portal home | `/` | route | P3 | 🟡 |
| Portal requests | `/requests` | route | P3 | 🟡 |
| Portal approval decision | `/approvals?approval={id}` | route | P3 | 🟡 |

| Summary | Count |
| --- | --- |
| **Total** | **147** (131 routes + 16 overlays, dialogs and sections) |

## Overlays, dialogs and embedded sections

Retained journey coverage beyond URL routes. These rows do not claim screen acceptance. The customer submission uses its current portal URL; legacy detail-link compatibility still needs verification.

| Screen | Route / context | Kind | Stage | Status |
| --- | --- | --- | --- | :-: |
| Sign-in — provider chooser | `/auth/sign-in` | section | P0 | ⬜ |
| Command palette | — | overlay | P1 | 🟡 |
| Pending action approval (every deletion — [pending-actions.md](technical/safety-and-runtime.md#pending-actions)) | — | dialog | P1 | 🟡 |
| Error boundary | — | overlay | P0 | ⬜ |
| Work item — side pane | `?item={key}` on any list | overlay | P1 | 🟡 |
| Create work item | — | dialog | P1 | 🟡 |
| Bulk edit | — | overlay | P1 | 🟡 |
| Relations editor | — | section | P1 | 🟡 |
| Approvals panel | — | section | P2 | ⬜ |
| SLA panel | — | section | P2 | ⬜ |
| Time entries | — | section | P5 | 🟡 |
| Attachments | — | section | P1 | 🟡 |
| Activity & comments | — | section | P1 | 🟡 |
| Section manager (reorder sections, move fields between them — [custom-fields.md](technical/feature-contracts-p4.md#custom-fields)) | — | section | P4 | ⬜ |
| Submission page (pre-acceptance, same URL) | `/submissions/{ref}` | section | P3 | ⬜ |
