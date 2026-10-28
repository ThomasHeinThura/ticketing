# Whole-product feature catalogue

TaskDesk brings requests, tickets, projects and commitments into one self-hostable product: the **agent workspace**, **customer portal**, and **God Mode**. It replaces Planner, Power Apps ticketing, Jira, Plane and Azure DevOps when their corresponding journeys and migrations are verified.

This is the full destination, not a claim of implementation. P0–P7 preserve the original product sequence. P8–P9 organise the original later candidates into proposed future work; individual scope decisions are recorded below. Exact behavior remains traceable through [requirements](requirements.md). All areas retain the original Kaneo interface and real persisted APIs.

## P0 — Foundation and operation

| Feature | Included behavior | Where it belongs / visible result |
| --- | --- | --- |
| Installation and startup | Reproducible builds, migrations, first administrator, seeds, setup, health and separate agent/portal bundles | A fresh instance starts and shows working sign-in and setup |
| Tenant and access boundaries | Organisations/workspaces/projects, reach versus authority, route policies, host/session isolation, secure authentication and revocation | Each user sees only allowed records and controls |
| Persistence and concurrency | Versioned writes, transaction integrity, audit/events, realtime delivery and reconnect | Two sessions see durable changes without silently overwriting each other |
| Runtime configuration | Bootstrap-only environment, encrypted secrets, instance/workspace/project inheritance and plugin contracts | One image configured for different customers through administration |
| Storage and jobs | Filesystem/S3-compatible storage, attachment access rules, scheduling, safe retries, cleanup and monitoring | Files remain protected; scheduled work visibly executes |
| Operations and recovery | Logs, metrics, backup/encryption/offsite retention, restore, upgrades, rollback, signed source-identified images | Restore database and files into an isolated working instance |
| Deployment choices | Image-only Compose/reverse proxy/domains, amd64/arm64 images; Helm/Kubernetes packaging within the existing operations contracts | Documented install paths use the same application and configuration |
| Shared quality | URL state, accessibility, themes, responsive behavior, localisation framework, licences/attribution | Consistent navigation and controls across both applications |

## P1 — Core work management

| Feature | Included behavior | Kaneo placement / visible result |
| --- | --- | --- |
| Workspace and projects | Membership, project lifecycle, settings, types/states and project keys | Original sidebar, projects table and settings shell |
| Board, list, table and backlog | Shared persisted records, filtering/sorting, view switcher, grouping, column choice, drag ranking, bulk changes | Original project work surfaces; same data in every view |
| Calendar/Gantt/timeline continuity | Existing date-based views use the same canonical records | Existing Kaneo tabs show the dated seed; richer planning follows in P5 |
| Work-item editing | Full page and side pane, URL selections, title/description, priority, dates, version conflict handling | Original task composition and property controls |
| Hierarchy and relations | Parent/child constraints, Sub-tasks, progress, dependencies, blockers and typed relations | Original task sections and inline rows |
| Conversation and files | Public/internal comments, activity, watchers, attachments and access controls | Original task activity/editor/file sections |
| Daily productivity | Assignees/default assignment, labels/catalogues, templates/checklists, search/command palette, saved views, My work/inbox | Existing menus, task controls and personal navigation |
| Safe lifecycle | Pending-action deletion for items/comments/files/projects/workspaces, archive and restore where specified | Existing danger zones and confirmation surfaces with server enforcement |

## P2 — Service desk

| Feature | Included behavior | Kaneo placement / visible result |
| --- | --- | --- |
| Workflow engine | Versioned workflows, per-role transitions, required notes, guards and assignment rules | Project settings and task transition controls |
| SLA and calendars | Policy goals, business hours/holidays/cover preview, pause/resume, at-risk/breach events and scheduled evaluation | Settings, task SLA section and queue columns |
| Request catalogue and forms | Request types, versioned form authoring/publishing and validation | Settings editor with customer preview; real portal form |
| Intake and triage | Durable submissions, queues/filters, accept/decline/merge/clarify and conversion to work | Kaneo list header/table/filter composition |
| Approvals and CAB foundation | Request/candidates, approval policy, decisions/withdrawal/reminders and transition gates | Task sections and addressable approval queues |
| Engagement coordination | Milestones, prerequisites, stakeholders, contacts and escalation paths | Existing project overview/settings/task sections |
| Audit trail | Actor/action/context, protected history, scoped reads and verification | Task activity and existing audit administration |

## P3 — Customer portal and identity

| Feature | Included behavior | Kaneo placement / visible result |
| --- | --- | --- |
| Complete customer navigation | Home, requests/detail, catalogue/form, approvals, projects/engagements and account | Customer-safe Kaneo shell, list/detail/settings composition |
| Request collaboration | Public comments/files, status and due time, withdrawal, priority escalation only, own-backlog ranking | Request detail actions; internal fields stay absent |
| Request lifecycle | Satisfaction, reopen window, invitations/onboarding, private/organisation visibility | Customer request/account surfaces with policy enforcement |
| Enterprise sign-in | Agent Entra OIDC and organisation-bound customer Entra OIDC, typed-domain routing and admission/JIT rules | Sign-in plus God Mode authentication/organisation settings |
| Provisioning | SCIM users/groups, allowlisted role mapping, grant provenance, deactivation and session/key revocation | Identity administration with real provisioning history |
| Account protection | MFA, session policy/security, connection tests and safe token rotation | Existing profile security and God Mode settings |

## P4 — Governance and administration

| Feature | Included behavior | Kaneo placement / visible result |
| --- | --- | --- |
| Roles and teams | Capability editor, reach/authority, sees-all rules, memberships and team administration | Workspace settings and existing member controls |
| Custom fields | Field types, sections, required/per-type visibility and scoped access | Settings plus original task properties |
| Feature controls | Instance/workspace/project flags, inheritance, locks and safe enable/disable | Existing settings hierarchy; hidden features retain data |
| God Mode | General, branding, organisations/catalogues/quotas, storage, notifications, features, jobs, plugins, users, audit and health | One Kaneo settings shell, no parallel admin design |
| Notifications | In-app inbox, core email, provider settings, preferences, delivery worker/history, quiet hours/digests and retries | Inbox/profile settings and God Mode delivery controls |
| Automations | Bounded trigger/condition/action rules, dry-run, eligibility, audit and flag control | Existing project workflow/settings surfaces |
| Webhooks and API keys | Signed delivery, SSRF controls, retry/history, bounded personal/service keys and revocation | Existing integration/profile/workspace settings |
| MCP | Read-only defaults, bounded writes, destructive pending actions, idempotency and import tooling hooks | Existing API plus profile pending-action pages |
| Administration safety | Audited impersonation, provisioning health/events, config export and secret-safe administration | God Mode and profile/session surfaces |
| Data protection | Person export/anonymisation, organisation erasure, retention, legal holds/e-discovery and subprocessor visibility; deprovisioning is distinct from erasure | Existing profile/organisation/admin settings with permissioned, auditable actions |

## P5 — Planning, insight and knowledge

| Feature | Included behavior | Kaneo placement / visible result |
| --- | --- | --- |
| Cycles | Project timeboxes, non-overlap, backlog/bulk assignment, scope changes, burndown, completion policy and velocity | Project tabs using the same original board/list |
| Modules and estimates | Leads/targets/progress, independent cycle/module membership, points/categories/time, previews and hierarchy roll-up | Project sections/settings and task estimate picker |
| Advanced schedule views | Calendar, Gantt/timeline planning, dates/dependencies and shared URL filters | Extend existing Kaneo view switcher |
| Time tracking | Manual integer-minute entries, activity/billable types, reload-safe timer, weekly keyboard-friendly timesheet and roll-ups | Task time section and Kaneo list/table-based timesheet |
| Rates, costs and budgets | Effective/snapshotted rates, cost types/entries, planned/actual/committed budgets, thresholds, capacity/utilisation | Workspace rates and project budget sections; currency totals separated |
| Twenty fixed reports | Promises, customer outcomes, delivery, people and leadership; exact list below | Kaneo report index/detail composition, filters, accessible table and drill-down |
| Saved table reports | Choose/order columns, filters/sorts and team/workspace sharing | Reuse table views and saved views |
| Custom reports and dashboards | Entity/filter/group/aggregate/chart preview; saved charts; personal/workspace resizable widgets and defaults | Existing layout/header/settings patterns; bounded builder, no scripting |
| Knowledge base | Draft/review/publish/archive, immutable versions, categories, owner/review date, search, article references and customer preview | Kaneo list/editor/detail composition in agent and portal |
| Deflection and feedback | Inline published-article suggestions, triage suggestions, view/deflection/helpfulness signals | Existing request form and triage conversation |
| Service catalogue | Service owner/support level/calendar/status, project/docs/KB links, dependencies and impact | Kaneo list/detail and project/task sections |
| Change management | Work-item change type, risk/window/rollback plan, CAB, freezes/overrides and conflict calendar | Original task detail and Calendar, with audited controls |
| Releases | Changes grouped by service/date, checklists, editable generated notes and optional portal publication | Project/service tabs and customer-safe release detail |
| Pages | Staff-only project Pages with history and undelete, specified as PG-1–PG-8 in [feature-contracts-p5.md](technical/feature-contracts-p5.md) | Project tab on the Kaneo editor/layout |

The twenty reports are: **SLA attainment, SLA trend, breach analysis, at-risk now; performance by customer, customer volume trend, satisfaction; throughput, work mix, cycle time, ageing, flow; workload, stale work, utilisation, capacity; portfolio health, predictability, cost to deliver, escalations.**

Every report states reach, window and as-of time; insufficient data is explicit; charts have table equivalents; drill-down and CSV respect permissions. Customers cannot access agent reports. Cost visibility is separately restricted. The recorded 20 October rate/timer decisions take precedence over contradictory old prose; see [alignment](alignment.md).

## P6 — Import, migration and cutover

| Feature | Included behavior | Kaneo placement / visible result |
| --- | --- | --- |
| Structured import | Connect/discover/map/dry-run/execute/pause/resume/reconcile, progress/logs and run history | God Mode import list and table-based mapping wizard |
| Source coverage | Azure DevOps, Plane, Jira/JSM, Planner, Power Apps exports and generic CSV | Appropriate source adapter; direct or CSV/agent-assisted path as originally specified |
| Preserved history | Source links, people/placeholders, authors/timestamps, hierarchy, relations, comments, files, fields and activity | Imported records appear in the same original Kaneo surfaces |
| Safe repetition | Idempotency, mapping ledger, chunking, retries, failures/unmapped/lossy conversions visibly reported | Rerun/resume without duplicates or silent losses |
| Agent-assisted import | Bounded MCP tools, explicit mapping decisions, idempotency and audit | Same API/import ledger rather than a second privileged write path |
| Cutover | Rehearsal against copies, counts/spot checks, backup/rollback, source read-only and agreed retirement | Switch each old tool off only after replacement and imported history are verified |

Workflow definitions, source permission schemes, dashboards/saved filters and automations are recreated deliberately, not silently imported. Oversized/unavailable attachments and lossy formatting are reported with source references.

## P7 — Customer readiness and reliable operation

| Feature | Included behavior | Visible result |
| --- | --- | --- |
| Accessibility and responsive polish | Complete keyboard/focus/screen-reader/browser coverage, reduced motion, contrast and mobile agent/portal fixes | Real journeys work on the supported devices and input methods |
| Localisation and onboarding | Translation completion beyond en-US, usable first-run/empty/error states and terminology | A new user can understand and operate the product |
| Performance and security | Realistic data/load baselines, dependency/attack-surface fixes and external penetration test | Measured budgets and resolved findings, not an idle server demonstration |
| Disaster recovery | Operational restore rehearsal, documented recovery limits, upgrade/rollback and alerting | Recover a usable instance with database/files and known source identity |
| Distribution and documentation | Hardened stable one-line installer, published user/admin/API docs, packaging/support runbooks | A customer installs, configures, upgrades and troubleshoots without source edits |
| Commercial readiness | Branding/name/licensing/contribution decisions and support expectations | Customer handoff backed by documented operating evidence |

## P8 — Integrations and enterprise extensions (proposed grouping)

These features were recorded beyond the original release scope. They are included in the whole-product catalogue; provider order and exact behavior need an implementation decision before their slice starts.

| Feature | Original intent / proposed scope boundary | Placement and finish evidence |
| --- | --- | --- |
| Chat notifications | After core email: Teams → Slack → Telegram → Viber → others; Discord requires a provider decision | Notification plugins/settings, real delivery/retry/revocation |
| Developer integrations | GitHub → GitLab → Gitea → Bitbucket → Azure DevOps, through explicit links/plugins | Existing integration settings and task links; scoped sync and real source journeys |
| Additional identity | Okta, Keycloak, Google Workspace, generic OIDC/other SCIM; SAML and LDAP/AD remain separate design decisions | Existing identity settings; prove provider-specific admission/revocation |
| Advanced SCIM and delegated identity | `/Bulk` only if interoperability needs it; customer-managed IdP needs its own authority/validation model | Extend current administration rather than bypass instance controls |
| Inbound email | Ticket creation, sender admission, threading, parsing, spam/spoofing handling | Existing intake/conversation; verify real threaded messages and rejected spoofing |
| Attachment malware protection | Original deferral recorded; reassess before unknown external uploaders or a customer/security requirement | Existing upload/storage controls with observable scan/quarantine behavior, defined before build |
| Marketplace distribution | AWS BYOL/contract preferred; Azure/GCP after distribution approach is proven | Packaging/licensing using the same image; seller/provider prerequisites are external |

Never restore removed Kaneo integration routers as a shortcut. Build each provider through the current permission/plugin contracts. Marketplace listing is distinct from the P7 customer-ready product.

## P9 — Advanced collaboration and scale (proposed grouping)

| Feature | Original candidate / decision needed | Kaneo placement and finish evidence |
| --- | --- | --- |
| Collaborative editing | CRDT/Hocuspocus-style co-editing; confirm demand and conflict model | Existing rich-text editor, multi-user/reconnect/data-loss proof |
| Formula/rollup custom fields | Bounded expression semantics, dependencies and resource limits need definition | Existing field configuration and task properties |
| AI assistance | Classification, duplicate detection, summarisation and draft KB articles; customer opt-in/data-provider controls | Existing triage/task/editor sections; measured quality and human publication control |
| Multilingual knowledge | Translation ownership/version/publication/search rules | Existing KB article/editor/portal composition |
| Native mobile apps | Decide after measuring responsive portal; preserve familiar task/navigation behavior | Real offline/session/sync rules need definition before implementation |
| Public status / public surfaces | Public status page is an adjacent-product candidate. Public boards and unauthenticated KB remain separate scope/security decisions | Explicit data exposure model; never expose internal agent routes |
| Asset/CMDB connection | Full asset discovery/CMDB was excluded; links to an external CMDB fit original service intent | Existing service links; a native CMDB requires a changed product decision |
| Currency conversion | Source of rates, effective dates and rounding need definition; invoicing/payroll were excluded | Existing budget/report screens with auditable valuation |
| Scale architecture | Read replicas, sharding, multi-region and HA based on measured workload/recovery needs | Same application/operations controls with load/failover evidence |
| Third-party plugins | Loading, isolation, compatibility, signing/supply chain and upgrade policy need definition | Existing plugin administration; prove isolation and safe failure |

P8/P9 grouping is new planning, not a claim that these phases existed or that every candidate is already specified. Excluded/conditional items remain explicitly visible rather than silently promised. Cross-project cycles, automatic sprint rollover/assignment, automated deployment of managed services, payroll/invoicing and automatic time capture are not added by this catalogue.

## Required interface correction

Task opening, sheet/full-page composition, animation, activity and editing must match original Kaneo in use, including normal navigation and return behavior. The UI-01–UI-16 parity tasks were delivered in P1 ([roadmap](roadmap.md#delivered-phases-history)). They are part of the existing core work scope, and do not replace the documented P0–P9 features.
