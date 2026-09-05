# Glossary

Terms mean exactly this throughout the codebase, the UI and these documents. If you need
a new term, add it here first.

## Tenancy and structure

| Term | Meaning |
| --- | --- |
| **Instance** | One deployment of TaskDesk. Owns instance-level settings, identity providers, and the God Mode surface. |
| **Organisation** | A tenant boundary. Customers belong to an organisation. Cross-organisation reads return 404. |
| **Workspace** | A container for projects, members and roles. An instance may have many. Inherited from kaneo. |
| **Team** | A grouping of staff within a workspace, with capacity. Owns queues and saved views. |
| **Project** | A dated engagement with a start, an end, a backlog and optional cycles. |
| **Managed service** | An indefinite engagement with a support level (L1/L2/L3) and a cover window. Has no end date and no cycles. |
| **Engagement** | Umbrella term for *project or managed service* when the distinction doesn't matter. |

## Work

| Term | Meaning |
| --- | --- |
| **Work item** | The universal unit of work. Everything is a work item: ticket, task, bug, story, epic, change, problem. |
| **Work item type** | Determines which fields, workflow and SLA policy apply. Configurable per workspace. |
| **Ticket** | A work item of a service-desk type (Incident, Service Request, Change, Problem). Not a separate table. |
| **Key** | Human-readable identifier, `PROJ-123`. Unique per instance, stable forever. |
| **State** | Where a work item sits in its workflow. Belongs to a state group. |
| **State group** | `backlog` · `unstarted` · `started` · `completed` · `cancelled`. Reporting groups by this, not by state name. |
| **Column** | A board column. Maps to one state. |
| **Relation** | A typed link between two work items: `relates`, `blocks`, `duplicates`, `precedes`, `requires`. |
| **Parent / child** | Hierarchy. Modelled separately from relations, deliberately. |

## Service desk

| Term | Meaning |
| --- | --- |
| **Request type** | A customer-facing template: a name, an icon, a form, a target work item type, a workflow and an SLA policy. |
| **Catalogue** | The set of request types a given customer can see in the portal. |
| **Intake** | The queue of submissions that have not yet become work items. |
| **Submission** | A customer's raw request before triage. Has its own reference (`SUB-123`) and its own message thread. |
| **SLA policy** | A named set of goals. Each goal is (request type × priority) → duration, measured in covered time. |
| **Service calendar** | Which hours count as covered: 8×5, 12×5, 24×7, plus holidays. |
| **Covered time** | Elapsed time counted only within the service calendar. All SLA durations are in covered time, never wall-clock. |
| **SLA state** | `ok` · `at-risk` (75% consumed) · `breached` · `met` · `missed` · `none`. |
| **Approval** | A request for a decision from a named approver, with an expiry. Blocks a transition if the workflow says so. |
| **CAB** | Change Advisory Board. An internal approval gate on change-type work items. |

## Access

| Term | Meaning |
| --- | --- |
| **Reach** | *Which* engagements a person can see. One of the two RBAC axes. |
| **Authority** | *What* a person may change. The other RBAC axis. Never derived from reach. |
| **Capability** | A single named permission, e.g. `work_item:assign`. The atom of authorization. |
| **Role** | A named, editable set of capabilities, stored as a row. Admins create and edit roles in settings. |
| **Policy** | The capability requirement declared by a route. Every route must have one. |
| **Side** | `staff` or `customer`. Determined by the directory, never by a token claim. |
| **Portal** | `agent` or `customer`. Which of the two front-ends. Each has its own origin and session. |
| **God Mode** | The instance administration surface. Requires the `instance:admin` capability. |
| **Impersonation** | An instance admin acting as another user. Always audited, always banner-visible. |

## Configuration and extension

| Term | Meaning |
| --- | --- |
| **Plugin** | A runtime-registered implementation of a capability contract — an auth provider, storage backend, notification channel, importer. |
| **Registry** | The in-process map of plugin id → implementation, populated at boot from built-ins and from DB configuration. |
| **Provider config** | A DB row holding one plugin's settings for this instance, edited in God Mode. Secrets encrypted at rest. |
| **Feature toggle** | A per-project or per-workspace switch that hides a whole feature. |
| **Lifecycle engine** | The one state + workflow mechanism used by every work item type — service or delivery alike. See [ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md). |
| **Terminology overlay** | Admin-renameable label for a fixed, enumerated set of domain nouns (work item, project, cycle, …), per instance or workspace. Never changes an API key or a stored value. See [ADR 0012](../01-architecture/adr/0012-terminology-overlay.md). |
| **License plugin** | A `license.*` plugin resolving marketplace entitlement and reporting usage. `license.none` by default — nothing reports anywhere unless an administrator enables one. See [ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md). |

## Engineering

| Term | Meaning |
| --- | --- |
| **Primitive** | A UI component in `packages/ui`. The only legal source of UI building blocks. |
| **Fetcher** | A typed function calling the API, in `apps/web/src/fetchers/`. |
| **Query hook / mutation hook** | TanStack Query wrappers in `src/hooks/queries` / `src/hooks/mutations`. |
| **Route registry** | The single declaration of every URL in the app, with a round-trip test. |
| **Permission matrix test** | The CI test asserting every role × route allow/deny. |
| **UX gate** | A CI check enforcing a design rule. See [UX quality gates](../02-design/ux-quality-gates.md). |

## Terms we do not use

| Don't say | Say |
| --- | --- |
| Issue, task, card, ticket *(as a table name)* | **Work item** |
| Status | **State** |
| Tenant | **Organisation** |
| Permission *(as a role)* | **Capability** for the atom, **role** for the set |
| Client | **Customer** |
| Agent *(as a person)* | **Staff**. "Agent" means the agent *portal*, or an AI agent. |
