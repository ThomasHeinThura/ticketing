# Screen inventory

Every screen in the product, its route, its kind, its phase, and its status.

**Kind:** `route` — has a URL in `lib/routes.ts` · `overlay` — a pane/palette over another
screen · `dialog` — modal · `section` — a region of a parent screen.
**Status:** ⬜ not started · 🟡 in progress · ✅ done · 🔒 blocked

Update this file as part of the work. It is the answer to "what is left?" Rewritten
2026-09-05: the [planning review](../07-planning/review-2026-09-05.md) found the counts
wrong in five of seven phases and about twenty screens the specs require missing. Routes
are written in full so a script can check them against `lib/routes.ts`.

---

## Agent — core

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Sign in | `/agent/sign-in` | route | P0 | ⬜ |
| Sign-in — provider chooser | `/agent/sign-in` | section | P0 | ⬜ |
| MFA challenge | `/agent/sign-in/mfa` | route | P0 | ⬜ |
| MFA enrolment | `/agent/sign-in/mfa/enrol` | route | P0 | ⬜ |
| Accept invitation | `/agent/invite` | route | P3 | ⬜ |
| Workspace home (default dashboard) | `/agent` | route | P1 | ⬜ |
| Inbox | `/agent/inbox` | route | P1 | ⬜ |
| My work | `/agent/my-work` | route | P1 | ⬜ |
| Triage | `/agent/triage` | route | P2 | ⬜ |
| Command palette | — | overlay | P1 | ⬜ |
| Pending action approval (every deletion — [pending-actions.md](../01-architecture/pending-actions.md)) | — | dialog | P1 | ⬜ |
| Global search results | `/agent/search` | route | P1 | ⬜ |
| Not found | `*` | route | P0 | ⬜ |
| Error boundary | — | overlay | P0 | ⬜ |

## Agent — project

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Project overview | `/agent/projects/{key}` | route | P1 | ⬜ |
| Work — board | `/agent/projects/{key}/work?layout=board` | route | P1 | ⬜ |
| Work — list | `/agent/projects/{key}/work?layout=list` | route | P1 | ⬜ |
| Work — table | `/agent/projects/{key}/work?layout=table` | route | P1 | ⬜ |
| Work — calendar | `/agent/projects/{key}/work?layout=calendar` | route | P5 | ⬜ |
| Work — timeline | `/agent/projects/{key}/work?layout=timeline` | route | P5 | ⬜ |
| Backlog | `/agent/projects/{key}/backlog` | route | P1 | ⬜ |
| Cycles list | `/agent/projects/{key}/cycles` | route | P5 | ⬜ |
| Cycle detail | `/agent/projects/{key}/cycles/{id}` | route | P5 | ⬜ |
| Modules list | `/agent/projects/{key}/modules` | route | P5 | ⬜ |
| Module detail | `/agent/projects/{key}/modules/{id}` | route | P5 | ⬜ |
| Pages | `/agent/projects/{key}/pages` | route | P5 | ⬜ |
| Milestones & prerequisites | `/agent/projects/{key}/plan` | route | P2 | ⬜ |
| Stakeholders | `/agent/projects/{key}/stakeholders` | route | P2 | ⬜ |

## Agent — work item

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Work item — full page | `/agent/work-items/{key}` | route | P1 | ⬜ |
| Work item — side pane | `?item={key}` on any list | overlay | P1 | ⬜ |
| Create work item | — | dialog | P1 | ⬜ |
| Bulk edit | — | overlay | P1 | ⬜ |
| Relations editor | — | section | P1 | ⬜ |
| Approvals panel | — | section | P2 | ⬜ |
| SLA panel | — | section | P2 | ⬜ |
| Time entries | — | section | P5 | ⬜ |
| Attachments | — | section | P1 | ⬜ |
| Activity & comments | — | section | P1 | ⬜ |

## Agent — service desk

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Intake queue | `/agent/triage?tab=intake` | route | P2 | ⬜ |
| Submission detail | `/agent/submissions/{ref}` | route | P2 | ⬜ |
| Approvals inbox | `/agent/my-work?lens=approvals` | route | P2 | ⬜ |
| Services list | `/agent/service-management/services` | route | P5 | ⬜ |
| Service detail | `/agent/service-management/services/{id}` | route | P5 | ⬜ |
| Change calendar | `/agent/service-management/changes` | route | P5 | ⬜ |
| Releases | `/agent/service-management/releases` | route | P5 | ⬜ |
| Knowledge base list | `/agent/kb` | route | P5 | ⬜ |
| Article view | `/agent/kb/{id}` | route | P5 | ⬜ |
| Article editor | `/agent/kb/{id}/edit` | route | P5 | ⬜ |

## Agent — insight

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Reports index | `/agent/reports` | route | P5 | ⬜ |
| Report detail | `/agent/reports/{key}` | route | P5 | ⬜ |
| Report builder (tier 3) | `/agent/reports/new` | route | P5 | ⬜ |
| Dashboard | `/agent/dashboard` | route | P5 | ⬜ |
| Dashboard editor | `/agent/dashboard/edit` | route | P5 | ⬜ |
| Timesheet | `/agent/timesheet` | route | P5 | ⬜ |
| Saved views index | `/agent/views` | route | P1 | ⬜ |
| Saved view | `/agent/views/{id}` | route | P1 | ⬜ |

## Agent — settings

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Profile — general | `/agent/settings/profile` | route | P1 | ⬜ |
| Profile — appearance | `/agent/settings/profile/appearance` | route | P1 | ⬜ |
| Profile — notifications | `/agent/settings/profile/notifications` | route | P4 | ⬜ |
| Profile — security & sessions | `/agent/settings/profile/security` | route | P3 | ⬜ |
| Profile — pending actions (API/MCP-originated deletions awaiting my approval) | `/agent/settings/profile/pending-actions` | route | P4 | ⬜ |
| Profile — API keys | `/agent/settings/profile/api-keys` | route | P4 | ⬜ |
| Workspace — general | `/agent/settings` | route | P1 | ⬜ |
| Workspace — terminology | `/agent/settings/terminology` | route | P4 | ⬜ |
| Workspace — members | `/agent/settings/members` | route | P1 | ⬜ |
| Workspace — teams | `/agent/settings/teams` | route | P4 | ⬜ |
| Team detail | `/agent/settings/teams/{id}` | route | P4 | ⬜ |
| **Workspace — roles** | `/agent/settings/roles` | route | P4 | ⬜ |
| **Role editor** | `/agent/settings/roles/{id}` | route | P4 | ⬜ |
| Workspace — work item types | `/agent/settings/work-item-types` | route | P2 | ⬜ |
| Workspace — states | `/agent/settings/states` | route | P1 | ⬜ |
| Workspace — workflows | `/agent/settings/workflows` | route | P2 | ⬜ |
| Workflow editor | `/agent/settings/workflows/{id}` | route | P2 | ⬜ |
| Workspace — SLA policies | `/agent/settings/sla-policies` | route | P2 | ⬜ |
| SLA policy editor | `/agent/settings/sla-policies/{id}` | route | P2 | ⬜ |
| Workspace — service calendars | `/agent/settings/calendars` | route | P2 | ⬜ |
| Workspace — request types | `/agent/settings/request-types` | route | P2 | ⬜ |
| Request type editor / form builder | `/agent/settings/request-types/{id}` | route | P2 | ⬜ |
| Workspace — custom fields (incl. sections) | `/agent/settings/custom-fields` | route | P4 | ⬜ |
| Custom field editor | `/agent/settings/custom-fields/{id}` | route | P4 | ⬜ |
| Workspace — labels | `/agent/settings/labels` | route | P1 | ⬜ |
| Workspace — canned responses | `/agent/settings/canned-responses` | route | P1 | ⬜ |
| Workspace — estimates | `/agent/settings/estimates` | route | P5 | ⬜ |
| Workspace — rates | `/agent/settings/rates` | route | P5 | ⬜ |
| Workspace — time activities | `/agent/settings/time-activities` | route | P5 | ⬜ |
| Workspace — cost types | `/agent/settings/cost-types` | route | P5 | ⬜ |
| Workspace — automations | `/agent/settings/automations` | route | P4 | ⬜ |
| Workspace — webhooks | `/agent/settings/webhooks` | route | P4 | ⬜ |
| Webhook editor | `/agent/settings/webhooks/{id}` | route | P4 | ⬜ |
| Webhook delivery history | `/agent/settings/webhooks/{id}/deliveries` | route | P4 | ⬜ |
| Workspace — import | `/agent/settings/import` | route | P6 | ⬜ |
| Workspace — danger zone | `/agent/settings/danger` | route | P1 | ⬜ |
| Project — general | `/agent/projects/{key}/settings` | route | P1 | ⬜ |
| Project — members | `/agent/projects/{key}/settings/members` | route | P1 | ⬜ |
| Project — states | `/agent/projects/{key}/settings/states` | route | P1 | ⬜ |
| Project — labels | `/agent/projects/{key}/settings/labels` | route | P1 | ⬜ |
| Project — SLA & calendar | `/agent/projects/{key}/settings/sla` | route | P2 | ⬜ |
| Project — features | `/agent/projects/{key}/settings/features` | route | P4 | ⬜ |
| Project — automations | `/agent/projects/{key}/settings/automations` | route | P4 | ⬜ |
| Project — budget | `/agent/projects/{key}/settings/budget` | route | P5 | ⬜ |
| Project — danger zone | `/agent/projects/{key}/settings/danger` | route | P1 | ⬜ |

## Agent — God Mode

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| God Mode home / health | `/agent/god-mode` | route | P4 | ⬜ |
| General (incl. terminology) | `/agent/god-mode/general` | route | P4 | ⬜ |
| Branding | `/agent/god-mode/branding` | route | P4 | ⬜ |
| **Authentication providers** | `/agent/god-mode/authentication` | route | P3 | ⬜ |
| **Provider editor** | `/agent/god-mode/authentication/{id}` | route | P3 | ⬜ |
| Organisations | `/agent/god-mode/organisations` | route | P3 | ⬜ |
| Organisation detail | `/agent/god-mode/organisations/{id}` | route | P3 | ⬜ |
| **Organisation — Identity** (customer OIDC + SCIM connection) | `/agent/god-mode/organisations/{id}/identity` | route | P3 | ⬜ |
| Storage | `/agent/god-mode/storage` | route | P4 | ⬜ |
| Notification channels | `/agent/god-mode/notifications` | route | P4 | ⬜ |
| Deliveries (outbox, dead letters) | `/agent/god-mode/deliveries` | route | P4 | ⬜ |
| Feature flags | `/agent/god-mode/features` | route | P4 | ⬜ |
| Jobs | `/agent/god-mode/jobs` | route | P4 | ⬜ |
| Plugins | `/agent/god-mode/plugins` | route | P4 | ⬜ |
| Observability | `/agent/god-mode/observability` | route | P4 | ⬜ |
| MCP usage | `/agent/god-mode/mcp` | route | P4 | ⬜ |
| Audit log | `/agent/god-mode/audit` | route | P2 | ⬜ |
| Import runs | `/agent/god-mode/import` | route | P6 | ⬜ |
| Users | `/agent/god-mode/users` | route | P4 | ⬜ |

## Portal

| Screen | Route | Kind | Phase | Status |
| --- | --- | --- | --- | :-: |
| Sign in | `/portal/sign-in` | route | P3 | ⬜ |
| Accept invitation | `/portal/invite` | route | P3 | ⬜ |
| Home | `/portal` | route | P3 | ⬜ |
| My requests | `/portal/requests` | route | P3 | ⬜ |
| Request detail (work item) | `/portal/requests/{ref}` | route | P3 | ⬜ |
| Submission page (pre-acceptance, same URL) | `/portal/requests/{ref}` | section | P3 | ⬜ |
| Catalogue | `/portal/new` | route | P3 | ⬜ |
| Request form | `/portal/new/{typeKey}` | route | P3 | ⬜ |
| Approvals | `/portal/approvals` | route | P3 | ⬜ |
| Projects list | `/portal/projects` | route | P3 | ⬜ |
| Project detail | `/portal/projects/{key}` | route | P3 | ⬜ |
| Knowledge base | `/portal/kb` | route | P5 | ⬜ |
| Article | `/portal/kb/{id}` | route | P5 | ⬜ |
| Satisfaction survey | `/portal/requests/{ref}/rate` | route | P3 | ⬜ |
| Account (incl. notification preferences) | `/portal/account` | route | P3 | ⬜ |
| Not found | `*` | route | P3 | ⬜ |

---

## Counts

Recomputed by `scripts/check-inventory.mjs` in CI from the rows above; the table fails the
build if it drifts.

| Phase | Screens |
| --- | --- |
| P0 Foundation | 6 |
| P1 Core work | 33 |
| P2 Service desk | 18 |
| P3 Portal & identity | 21 |
| P4 Governance | 28 |
| P5 Insight & agile | 28 |
| P6 Import | 2 |
| **Total** | **136** |

For comparison, v1 had roughly 25 screens, each at perhaps 60% quality. The target here is
more screens at 100%, delivered a phase at a time — see
[Product principles](../00-overview/product-principles.md), principle 7.

## Rules

- Every row of kind `route` is in `lib/routes.ts`; `G5` checks exactly those rows.
- A screen is not ✅ until it passes every automated gate (`G1`–`G13`) and the human gates
  at review (`H1`–`H6`); the phase-level checks (`P1`–`P6`) apply at phase close.
- Adding a screen means adding a row here in the same pull request — and every screen a
  feature spec names must have a row.

## Related

- [Information architecture](information-architecture.md) · [Phases](../07-planning/phases.md)
