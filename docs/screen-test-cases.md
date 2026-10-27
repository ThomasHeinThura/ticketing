# Screen test cases (P0–P5)

Manual and browser test cases per screen. Run on local SIT (agent `https://ticketing.localhost`, portal `https://portal.localhost`, port 443) with seeded data, never on the live `taskdesk_browser_journey_1022_test` database with resetting fixtures. Every screen also gets the **common checks** below. Result column: P pass, F fail, B blocked, blank = not run. Route inventory: [screens.md](screens.md).

Current scoped execution: [browser evidence](report/browser/) records real UI mutations and reload checks, including work-item editing, cycle/module/page creation and MFA. Blank results below remain unaccepted until the complete row and common checks pass.

## Common checks (every screen)

| ID | Check |
| --- | --- |
| C1 | Looks and behaves like original Kaneo (shell, sidebar, header, spacing, typography); no hand-built layout |
| C2 | Controls are library components (no raw button/input/select); keyboard reachable, visible focus |
| C3 | Loading, empty and error states shown; no blank panel, no console errors |
| C4 | Data persists after reload (real API, no mock data) |
| C5 | Light and dark theme readable; 375px width has no horizontal scroll |
| C6 | Permission: user without the capability sees no entry point and gets 403 on direct URL |
| C7 | Old or legacy URLs redirect; URL state (filters, layout, selected id) survives reload |

## P0 — Foundation and safety

| Screen | Route | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Sign in | `/auth/sign-in` (legacy `/agent/sign-in`) | Valid then invalid password | Valid lands on `/agent`; invalid shows error, no account hint | |
| MFA challenge | `/auth/two-factor` | Wrong then right code; backup code | Wrong rejected and rate-limited; right signs in | |
| MFA enrolment | `/dashboard/settings/account/security` | Enrol TOTP, reload, sign out and in | Code required next sign-in | |
| Observability / MFA policy | `/agent/god-mode/observability` | Toggle policy as instance admin; as non-admin | Admin saves and audit row written; non-admin 403 | |
| Delete anything (project, workspace, work item) | any danger zone | Request delete | 202 pending action, requester approves, typed project key / workspace name + step-up | |
| Pending actions | `/agent/settings/profile/pending-actions` | Approve, decline, open detail | State changes; failed executor shows terminal `failed` | |

## P1 — Work, hierarchy, search

| Screen | Route | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Workspace home | `/agent` | Open as agent | Dashboard shows persisted counts | |
| Inbox | `/agent/inbox` | Mention filter, assignment filter, mark read/unread, click a row | Filter in URL; row deep-links to `/agent/work-items/{key}` | |
| My work | `/agent/my-work` | Switch lenses incl. approvals | List changes, URL keeps lens | |
| Global search | `/agent/search` | Search key, title, comment text; project outside reach | Hits grouped; out-of-reach never shown | |
| Project overview | `/agent/projects/{key}` | Open parent and child project | Hierarchy and roll-up shown | |
| Work board | `/agent/projects/{key}/work?layout=board` | Drag card between states; blocked transition | Persists after reload; blocked move shows reason | |
| Work list | `…layout=list` | Sort, filter, open item | Same data as board | |
| Work table | `…layout=table` | Columns, filter, bulk select | Persisted; cursor paging has no duplicates | |
| Backlog | `/agent/projects/{key}/backlog` | Reorder, move to board | Order persists | |
| Work item page | `/agent/work-items/{key}` | Edit title, description, assignee, parent; add comment and attachment; move, archive | Saved; activity and History show changes; "State then" panel populated | |
| Saved views | `/agent/views`, `/agent/views/{id}` | Create, rename, share, delete | Pending-action delete; shared view respects reach | |
| Project members | `/agent/projects/{key}/settings/members` | Add roster member; child inherits parent member | Inherited reach and authority shown as inherited | |
| Project states / labels | `…/settings/states`, `…/labels` | Create, reorder, rename | Persisted | |
| Workspace members, states, labels, canned responses | `/agent/settings/*` | CRUD each | Persisted; deletes via pending action where required | |
| Danger zones | `/agent/settings/danger`, `…/settings/danger` | Delete with wrong then right project key / workspace name | Wrong blocked; right creates pending action | |
| Profile general / appearance | `/agent/settings/profile`, `…/appearance` | Change name, theme, language | Saved after reload | |

## P2 — Service desk

| Screen | Route | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Triage | `/agent/triage?state=new&ref={ref}` | Accept, decline with reason, request clarification | State changes; clarification auto-declines on expiry | |
| Saved intake queues | `/agent/triage?queue={id}` | Paired filter persistence, CAS, private visibility, responsive labels | Both saved queries remain distinct; stale writes refused; readable mobile table | Earlier26-check functional pass; deployed192375/1440dark labels/layout pass and mobile repair inspected. Remaining common/role/flag cases pending. [Evidence](report/browser/intake-queues192/readonly.json) |
| Approvals | `/agent/my-work?lens=approvals` | Approve, reject, expired approval | Decision recorded and audited | |
| Request types | `/agent/settings/request-types?requestTypeId={id}` | Edit form fields, intake window | Portal form reflects change | |
| SLA policies and editor | `/agent/settings/sla-policies/{id}` | Create policy, attach calendar, breach item | Clock, pause and breach shown; escalation notifies recipients | |
| Service calendars | `/agent/settings/calendars/{id}` | Edit hours and holidays | SLA due date respects calendar | |
| Workflows | `/agent/settings/workflows/{id}` | Add guarded edge; scheduled transition | A person may use any matching edge their roles hold (an ungated edge beside a gated one stays usable); a scheduled/system hop applies the most restrictive matching edge; transition fires on time | |
| Audit log | `/agent/god-mode/audit` | Filter by action, entity, date | Rows match actions; read is itself audited | |

## P3 — Customer portal and identity

| Screen | Route (portal host) | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Portal sign in | `/sign-in` | Customer signs in; agent credentials on portal | Customer lands on `/`; agent/portal separation holds | |
| Portal home | `/` | Open as customer | Own and organisation requests listed | |
| Catalogue and form | `/catalogue?q=no-match&key=access` | Search, no-match, submit | Empty state shown; submit creates request and reference | |
| Requests | `/requests` | Open own and colleague request (same organisation) | Colleague visible only where organisation visibility is on | |
| Submission detail | `/submissions/{ref}` | Raise priority up, down; reopen; rate | Escalate-only priority; reopen allowed; rating saved once | |
| Approval decision | `/approvals?approval={id}` | Approve and reject as customer | Recorded; non-approver refused | |
| Portal host routing | `/requests` and `/account` | Open and reload on portal host; try agent session | Host-root routes load; staff credentials cannot authorize portal | |
| Authentication providers | `/agent/god-mode/authentication/{id}` | Add OIDC provider, test | IdP data never grants instance admin | |
| SCIM | God Mode identity | Rotate token, hit rate limit, health job | Token shown once; limit returns 429 | |

## P4 — Administration (implementation gaps and browser verification pending)

| Screen | Route | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Teams / detail | `/agent/settings/teams`, `…/{id}` | Create team, add members, set lead and allocation, second CAB team | Persisted; second CAB returns 409; lead can edit roster | |
| Roles / editor | `/agent/settings/roles`, `…/{id}` | Create, edit capabilities, delete role in use; remove last `ac:update` holder | Delete via pending action; last-holder change returns 409 | |
| Custom fields / editor | `/agent/settings/custom-fields`, `…/{id}` | Create field and section, reorder, delete and restore | Appears in work item properties and create dialog | |
| Required field | work item create / transition | Leave required field empty; move to started; cancel | Blocked on create and on started/completed; cancelled exempt | |
| API keys | `/dashboard/settings/account/developer` (`/agent/settings/profile/api-keys` redirects) | Create, copy once, revoke, IP allowlist, capability set | Secret shown once, never stored in idempotency replay | |
| Workspace service keys | workspace api-keys | Create, delete | Delete is pending action; service key cannot approve (403 `no_approver`) | |
| MCP | MCP client with a key | Create item with idempotency key twice; call a destructive tool | One item created; delete returns pending action | |
| Webhooks / editor / deliveries | `/agent/settings/webhooks/{id}/deliveries` | Create, send test, fail endpoint, replay | Signed delivery; failures retried then dead-lettered | |
| Automations (workspace, project) | `/agent/settings/automations`; project: `/agent/projects/{key}/settings/automations` (redirects to `/dashboard/settings/projects/{id}/automations`) | Create rule, trigger, loop guard | Action runs once; loops stopped | |
| God Mode home / health | `/agent/god-mode` | Open as instance admin | DB, secrets and outbox health shown | |
| Webhook security posture / incident rotation | `/agent/god-mode/webhooks` | List full-reach owners; refresh/paginate; enter one distinct replacement secret per current webhook; step-up; change set/version; replay proof | Metadata excludes URLs/secrets/bodies; current instance admin only; rotation all-or-nothing with digest-bound proof and 24h dual signatures | Posture empty state: six width/theme states pass on189; incident rotation source190, browser pending |
| General settings | `/agent/god-mode/general` | Change retention days, timezone | Saved; last-changed shown | |
| Feature flags | `/agent/god-mode/features`; project: `/agent/projects/{key}/settings/features` (redirects to `/dashboard/settings/projects/{id}/features`) | Lock at instance, override at project, clear override | Write below lock returns 409; stale version returns 409 | |
| Notification channels | `/agent/god-mode/notifications` | Configure SMTP, send test | Test email delivered | Scoped schema-form render/validation/cancel passes375/768/1440 light/dark; provider unchanged. Actual test-send journey remains pending. [Evidence](report/browser/gm5-schema-form/gm5-schema-form-20261026.json) |
| Customer notifications | `/notifications` (portal host) | Produce public comment; live update; read/unread; unread URL; comment link; bell | Own-request inbox updates without reload or polling; actions persist; exact public comment opens | Scoped186 browser journey passes18 assertions with a real customer cookie and one owned QA comment. Six complete-shell sizes/themes pass, each with one authenticated socket and bell menu. Broader negative/role/flag matrix pending. [Evidence](report/browser/portal-notifications186/journey.json) |
| Notifications | `/agent/inbox` | Quiet hours, digest, mark unread | Quiet hours defer except SLA breach; read state persists | |
| Users | `/agent/god-mode/users` | Deactivate user | Removed from rosters; sessions revoked | |

## P5 — Planning, time, knowledge, service management (implementation gaps and browser verification pending)

Fresh feature acceptance pending. Scripted sign-in on the audit copy is authorized and has succeeded. Routes are registered in `apps/web/src/lib/routes.ts`; screen rows are in [screens.md](screens.md). Cost types/entries and available hours are built and need browser checks; typed-domain SSO routing is implemented with scoped local tests; real Entra validation is reserved for Thomas.

| Screen | Route | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Cycles / detail | `/agent/projects/{key}/cycles`, `…/{id}` | Create cycle, drag from backlog, complete with carry-over | Scope persists after reload; completion dialog moves unfinished work; burndown honest | |
| Modules / detail | `/agent/projects/{key}/modules`, `…/{id}` | Create module, add and remove items | Membership persists; list shown only while `feature.modules` is on | |
| Estimates | `/agent/projects/{key}/settings/estimates` | Change system and scale, preview, save | Preview shows effect before save; existing values handled as previewed | |
| Timesheet | `/agent/timesheet` | Weekly grid by keyboard, start and stop timer, reload, edit past week | Entries persist; locked period refuses edit | |
| Time entries | work item section | Add manual entry, edit, delete | Totals update; delete follows pending action where required | |
| Rates / time activities | `/agent/settings/rates`, `/agent/settings/time-activities` | Set rate, add activity; open as user without rate capability | Rates hidden and 403 for restricted user | |
| Budget | `/agent/projects/{key}/settings/budget` | Set budget, log time, reload | Time and cost actuals reconcile; thresholds shown; currency and rate visibility enforced | |
| Knowledge base (agent) | `/agent/kb`, `/agent/kb/{id}`, `/agent/kb/{id}/edit` | Create, publish, version, set visibility | Version history kept; draft invisible to customers | |
| Knowledge base (portal) | `/kb`, `/kb/{id}` and request form | Search; type request title in form | Only customer-visible articles; deflection suggestions appear | |
| Services / detail | `/agent/service-management/services`, `…/{id}` | Create service with owner team, dependency, link | Persisted; dependency impact shown | |
| Changes | `/agent/service-management/changes` | View windows and freezes; schedule two changes on one service; override a freeze | Overlap flagged; override recorded and audited | |
| CAB template | Workflows editor, CAB panel | Apply template, move change to Approved | CAB approval required; bypass edges removed | |
| Releases | `/agent/service-management/releases`, `…/{id}` | Create release, attach changes, publish notes | Persisted; customer release page not built | |
| Reports | `/agent/reports`, `…/{key}` | Open each tier, filter, export CSV | Known-answer aggregates; scoped to reach; customer denied | |
| Report builder | `/agent/reports/new` | Build custom chart, save | Saved table reloads with same result | |
| Dashboards / editor | `/agent/dashboard`, `/agent/dashboard/edit` | Add, drag and resize widgets, save, reload | Layout persists | |
| Customer invitations | `/agent/settings/customer-invitations` | Invite, resend, revoke; open invalid and expired link | Lifetime and limits as shipped; revoked link refused | |
| Portal accept / sign-up | `/invite/{id}` (portal host) | Accept as new and existing customer | Account linked to organisation; needs customer password provider on | |
| Pages / editor | `/agent/projects/{key}/pages`, `…/{id}` | Create nested page, edit, move, restore | Tree persists; move respects permission | |

## P6 shared prerequisite (approved for P4)

| Screen | Route | Test | Expected | Result |
| --- | --- | --- | --- | :-: |
| Import history/detail | `/agent/god-mode/imports`, `…/{id}` | Create an own run; reload; direct link; Back; selected workspace; non-admin | Persisted run; matching workspace retained in URL; non-admin API/UI denied | Scoped192 pass: creation/persistence, direct detail/Back,375/768/1440 light/dark and non-admin denial. Remaining common/role/empty/error cases pending. [Evidence](report/browser/imports192/journey.json), [denial](report/browser/imports192/non-admin.json) |
| Large import approval | Profile pending-action dialog/detail | Preview and submit51 records/links; exact count and fresh authentication; retry | No targets before owner approval; exactly-once commit | 51-record owner browser approval passes at375/768/1440 light/dark; wrong count/missing proof blocked; retry leaves51 targets/links and totals unchanged. Temporary key revoked, flag restored.51-link browser approval remains pending. |

## Not testable yet

P6 import history/detail is built as the approved P4 prerequisite. The structured wizard, source adapters, cutover and P7 readiness remain unbuilt. P4 pages now have varying implementation and scoped browser evidence; remaining feature/role/flag cases must be checked individually, including terminology and impersonation. Real Entra/provider acceptance remains external; local typed-domain routing is implemented. Cost types live under Rates, available hours under time settings; test their persisted flows.
