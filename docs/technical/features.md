# Features and plugins

Feature switches use persisted runtime administration. Resolution is project → workspace → instance → built-in default. An instance lock short-circuits lower scopes. Disabled features are enforced by the API and UI; hiding navigation alone is insufficient. Enabling a flag is not implementation or acceptance evidence.

Enforcement reads the same levels the settings screens offer (27 Oct, P4R2-M2). Where a project is in context the project level decides; otherwise the workspace level does. **Instance-only flags:** `feature.scim` and `feature.mcp` guard surfaces that belong to no workspace or project (`/scim/v2/*`, MCP-flagged API keys), so they exist at instance level only: the workspace and project screens do not offer them, a workspace or project write answers 422 `feature_instance_only` and stores nothing, and any lower row already stored is ignored.

## Feature catalogue

| Flag | Hides | Stage |
| --- | --- | --- |
| Feature `feature.cycles` | Cycles/sprints | P5 |
| Feature `feature.modules` | Modules | P5 |
| Feature `feature.estimates` | Story points / estimates | P5 |
| Feature `feature.intake` | Intake queue, request types, catalogue | P2 |
| Feature `feature.sla` | SLA policies, service calendars, SLA badges, SLA reports. Clock start, the scanner, badges and the portal SLA view resolve per project (project override first). SLA policies and service calendars are workspace configuration: their settings pages, navigation and pickers follow the workspace value, so a project switched on inside an off workspace runs clocks on policies configured earlier | P2 |
| Feature `feature.approvals` | Approval request creation and CAB requests; existing requests remain actionable per approvals.md | P2 |
| Feature `feature.time_tracking` | Timesheets, time entries, timer | P5 |
| Feature `feature.cost_tracking` | Rates, budgets, cost reports | P5 |
| Feature `feature.knowledge_base` | KB, deflection | P5 |
| Feature `feature.service_catalogue` | Services, changes, freezes, releases | P5 |
| Feature `feature.customer_portal` | The portal router returns 404 and the portal host serves a disabled notice — a flag cannot unbind a hostname from Traefik. The host answers while the flag is on anywhere (instance, a workspace or a project); the notice is the portal app's own feature-off state (404). A flag that cannot be read answers 503 "temporarily unavailable" with `Retry-After`. A signed-in customer's data routes (requests, submissions, catalogue, approvals, knowledge base, releases) also need the flag on for one of the organisation's engaged projects or request-type workspaces, and a submission follows its own project or workspace. Host lookups are cached in process for 5 s and cleared on every flag write | P3 |
| Feature `feature.reports` | Reports index, dashboards, tier 2/3 reports | P5 |
| Feature `feature.automations` | Automation rules (the engine is inherited from kaneo; flagged off until spec-aligned) | P4 |
| Feature `feature.timeline` · `feature.calendar` · `feature.pages` | Original Kaneo Gantt, Calendar and Pages views (`feature.timeline` is the internal Gantt flag key). Gantt and Calendar are enforced in the UI only (tab hidden, feature-off state on the route): they read the general project and work-item APIs the List and Board views also need, so there is no view-specific API to refuse | P5 |
| Feature `feature.mcp` | MCP-flagged API keys are refused with 404. Instance-only | P4 |
| Feature `feature.scim` | The `/scim/v2/*` endpoint answers; off ⇒ 404 for every SCIM call. Default **on** from P3; a connection must also be enabled (identity-provisioning.md). Instance-only | P3 |
| Feature `feature.import` | Import runs and the import UI; locked on for administrators by default | P6 |
| Feature `feature.public_boards` | **Reserved, no code behind it.** kaneo's anonymous public boards are *removed* at fork (inherited-features.md); the flag exists so a future spec'd, security-reviewed re-implementation has its switch | reserved |
| Feature `feature.dev_links` | **Reserved, no code behind it.** Developer-tool linking (GitHub → GitLab → Gitea → Bitbucket → Azure DevOps) is future scope; kaneo's GitHub/Gitea routers are removed at fork | reserved |

## Default values

| Flag | Enabled | Locked |
| --- | --- | --- |
| `feature.cycles` | false | false |
| `feature.modules` | false | false |
| `feature.estimates` | false | false |
| `feature.intake` | false | false |
| `feature.sla` | false | false |
| `feature.approvals` | false | false |
| `feature.time_tracking` | false | false |
| `feature.cost_tracking` | false | false |
| `feature.knowledge_base` | false | false |
| `feature.service_catalogue` | false | false |
| `feature.customer_portal` | false | false |
| `feature.reports` | false | false |
| `feature.automations` | false | false |
| `feature.timeline` | false | false |
| `feature.calendar` | false | false |
| `feature.pages` | false | false |
| `feature.mcp` | false | false |
| `feature.scim` | true | false |
| `feature.import` | true | true |
| `feature.public_boards` | false | false |
| `feature.dev_links` | false | false |

## Plugin kinds

| Kind | Contract |
| --- | --- |
| `auth` | Runtime identity providers; connection, portal scope and mapping rules cannot mint forbidden authority. |
| `storage` | Runtime attachment backends; persisted access rules, retention and legal holds remain effective. |
| `notify` | Notification transports share current eligibility, reach, preferences and durable delivery semantics. |
| `devlink` | Reserved developer linking; removed inherited integration routers stay removed. |
| `import` | Runtime import adapters; normal identity, reach and write policies apply. |
| `search` | Search backend adapters retain tenant and field visibility checks. |
| `ai` | Optional assistance; no independent authority or model-approved destructive actions. |
| `license` | Entitlement/metering adapters; one shipping image and runtime configuration. |

New plugin configuration belongs in runtime administration, with secrets protected and audited configuration changes. A feature flag is not a new capability and cannot bypass permissions. Existing approvals remain actionable when new approval creation is disabled. Public boards and developer links are reserved; their flags do not restore removed routers. See [configuration](configuration.md) for bootstrap/runtime configuration boundaries.
