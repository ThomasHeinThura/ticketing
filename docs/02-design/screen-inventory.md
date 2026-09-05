# Screen inventory

Every screen in the product, its route, its phase, and its status.

**Status:** ⬜ not started · 🟡 in progress · ✅ done · 🔒 blocked

Update this file as part of the work. It is the answer to "what is left?"

---

## Agent — core

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Sign in | `/agent/sign-in` | P0 | ⬜ |
| Sign-in — provider chooser | `/agent/sign-in` | P0 | ⬜ |
| MFA challenge | `/agent/sign-in/mfa` | P0 | ⬜ |
| MFA enrolment | `/agent/sign-in/mfa/enrol` | P0 | ⬜ |
| Accept invitation | `/agent/invite` | P3 | ⬜ |
| Workspace home | `/agent` | P1 | ⬜ |
| Inbox | `/agent/inbox` | P1 | ⬜ |
| My work | `/agent/my-work` | P1 | ⬜ |
| Triage | `/agent/triage` | P2 | ⬜ |
| Command palette | overlay | P1 | ⬜ |
| Global search results | `/agent/search` | P1 | ⬜ |
| Not found | `*` | P0 | ⬜ |
| Error boundary | — | P0 | ⬜ |

## Agent — project

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Project overview | `/agent/projects/{key}` | P1 | ⬜ |
| Work — board | `/agent/projects/{key}/work?layout=board` | P1 | ⬜ |
| Work — list | `…?layout=list` | P1 | ⬜ |
| Work — table | `…?layout=table` | P1 | ⬜ |
| Work — calendar | `…?layout=calendar` | P5 | ⬜ |
| Work — timeline | `…?layout=timeline` | P5 | ⬜ |
| Backlog | `/agent/projects/{key}/backlog` | P1 | ⬜ |
| Cycles list | `/agent/projects/{key}/cycles` | P5 | ⬜ |
| Cycle detail | `/agent/projects/{key}/cycles/{id}` | P5 | ⬜ |
| Modules list | `/agent/projects/{key}/modules` | P5 | ⬜ |
| Module detail | `/agent/projects/{key}/modules/{id}` | P5 | ⬜ |
| Pages | `/agent/projects/{key}/pages` | P5 | ⬜ |
| Milestones & prerequisites | `/agent/projects/{key}/plan` | P2 | ⬜ |
| Stakeholders | `/agent/projects/{key}/stakeholders` | P2 | ⬜ |

## Agent — work item

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Work item — full page | `/agent/work-items/{key}` | P1 | ⬜ |
| Work item — side pane | overlay on any list | P1 | ⬜ |
| Create work item | dialog | P1 | ⬜ |
| Bulk edit | overlay | P1 | ⬜ |
| Relations editor | section | P1 | ⬜ |
| Approvals panel | section | P2 | ⬜ |
| SLA panel | section | P2 | ⬜ |
| Time entries | section | P5 | ⬜ |
| Attachments | section | P1 | ⬜ |
| Activity & comments | section | P1 | ⬜ |

## Agent — service desk

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Intake queue | `/agent/triage?tab=intake` | P2 | ⬜ |
| Submission detail | `/agent/submissions/{ref}` | P2 | ⬜ |
| Approvals inbox | `/agent/my-work?lens=approvals` | P2 | ⬜ |
| Services list | `/agent/service-management/services` | P5 | ⬜ |
| Service detail | `/agent/service-management/services/{id}` | P5 | ⬜ |
| Change calendar | `/agent/service-management/changes` | P5 | ⬜ |
| Releases | `/agent/service-management/releases` | P5 | ⬜ |
| Knowledge base list | `/agent/kb` | P5 | ⬜ |
| Article view | `/agent/kb/{id}` | P5 | ⬜ |
| Article editor | `/agent/kb/{id}/edit` | P5 | ⬜ |

## Agent — insight

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Reports index | `/agent/reports` | P5 | ⬜ |
| Report detail | `/agent/reports/{key}` | P5 | ⬜ |
| Report builder (tier 3) | `/agent/reports/new` | P5 | ⬜ |
| Dashboard | `/agent/dashboard` | P5 | ⬜ |
| Timesheet | `/agent/timesheet` | P5 | ⬜ |
| Saved views index | `/agent/views` | P1 | ⬜ |
| Saved view | `/agent/views/{id}` | P1 | ⬜ |

## Agent — settings

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Profile — general | `/agent/settings/profile` | P1 | ⬜ |
| Profile — appearance | `…/appearance` | P1 | ⬜ |
| Profile — notifications | `…/notifications` | P4 | ⬜ |
| Profile — security & sessions | `…/security` | P3 | ⬜ |
| Profile — API keys | `…/api-keys` | P4 | ⬜ |
| Workspace — general | `/agent/settings` | P1 | ⬜ |
| Workspace — terminology | `…/terminology` | P4 | ⬜ |
| Workspace — members | `…/members` | P1 | ⬜ |
| Workspace — teams | `…/teams` | P4 | ⬜ |
| **Workspace — roles** | `…/roles` | P4 | ⬜ |
| **Role editor** | `…/roles/{id}` | P4 | ⬜ |
| Workspace — work item types | `…/work-item-types` | P2 | ⬜ |
| Workspace — workflows | `…/workflows` | P2 | ⬜ |
| Workflow editor | `…/workflows/{id}` | P2 | ⬜ |
| Workspace — SLA policies | `…/sla-policies` | P2 | ⬜ |
| SLA policy editor | `…/sla-policies/{id}` | P2 | ⬜ |
| Workspace — service calendars | `…/calendars` | P2 | ⬜ |
| Workspace — request types | `…/request-types` | P2 | ⬜ |
| Request type editor / form builder | `…/request-types/{id}` | P2 | ⬜ |
| Workspace — custom fields | `…/custom-fields` | P4 | ⬜ |
| Workspace — labels | `…/labels` | P1 | ⬜ |
| Workspace — estimates | `…/estimates` | P5 | ⬜ |
| Workspace — webhooks | `…/webhooks` | P4 | ⬜ |
| Workspace — import | `…/import` | P6 | ⬜ |
| Project — general | `/agent/projects/{key}/settings` | P1 | ⬜ |
| Project — members | `…/members` | P1 | ⬜ |
| Project — states | `…/states` | P1 | ⬜ |
| Project — features | `…/features` | P4 | ⬜ |
| Project — automations | `…/automations` | P4 | ⬜ |
| Project — danger zone | `…/danger` | P1 | ⬜ |

## Agent — God Mode

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| God Mode home / health | `/agent/god-mode` | P4 | ⬜ |
| General | `…/general` | P4 | ⬜ |
| Branding | `…/branding` | P4 | ⬜ |
| **Authentication providers** | `…/authentication` | P3 | ⬜ |
| **Provider editor** | `…/authentication/{id}` | P3 | ⬜ |
| Organisations | `…/organisations` | P3 | ⬜ |
| Organisation detail | `…/organisations/{id}` | P3 | ⬜ |
| Storage | `…/storage` | P4 | ⬜ |
| Notification channels | `…/notifications` | P4 | ⬜ |
| Feature flags | `…/features` | P4 | ⬜ |
| Jobs | `…/jobs` | P4 | ⬜ |
| Plugins | `…/plugins` | P4 | ⬜ |
| Audit log | `…/audit` | P4 | ⬜ |
| Import runs | `…/import` | P6 | ⬜ |
| Users | `…/users` | P4 | ⬜ |

## Portal

| Screen | Route | Phase | Status |
| --- | --- | --- | :-: |
| Sign in | `/portal/sign-in` | P3 | ⬜ |
| Accept invitation | `/portal/invite` | P3 | ⬜ |
| Home | `/portal` | P3 | ⬜ |
| My requests | `/portal/requests` | P3 | ⬜ |
| Request detail | `/portal/requests/{ref}` | P3 | ⬜ |
| Catalogue | `/portal/new` | P3 | ⬜ |
| Request form | `/portal/new/{typeKey}` | P3 | ⬜ |
| Approvals | `/portal/approvals` | P3 | ⬜ |
| Projects list | `/portal/projects` | P3 | ⬜ |
| Project detail | `/portal/projects/{key}` | P3 | ⬜ |
| Knowledge base | `/portal/kb` | P5 | ⬜ |
| Article | `/portal/kb/{id}` | P5 | ⬜ |
| Satisfaction survey | `/portal/requests/{ref}/rate` | P3 | ⬜ |
| Account | `/portal/account` | P3 | ⬜ |
| Not found | `*` | P3 | ⬜ |

---

## Counts

| Phase | Screens |
| --- | --- |
| P0 Foundation | 4 |
| P1 Core work | 27 |
| P2 Service desk | 15 |
| P3 Portal & identity | 20 |
| P4 Governance | 18 |
| P5 Insight & agile | 23 |
| P6 Import | 2 |
| **Total** | **109** |

For comparison, v1 had roughly 25 screens, each at perhaps 60% quality. The target here is
more screens at 100%, delivered a phase at a time — see
[Product principles](../00-overview/product-principles.md), principle 7.

## Rules

- A screen is not on this list until it is in `lib/routes.ts`.
- A screen is not ✅ until it passes every [UX quality gate](ux-quality-gates.md).
- Adding a screen means adding a row here in the same pull request.

## Related

- [Information architecture](information-architecture.md) · [Phases](../07-planning/phases.md)
