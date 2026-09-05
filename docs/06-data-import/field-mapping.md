# Field mapping reference

Canonical mappings from each source system to TaskDesk. Proposed automatically by the
import wizard; always editable.

## TaskDesk target model

```
Organisation → Workspace → Project → Work item
                                       ├── type
                                       ├── state (→ state group)
                                       ├── priority
                                       ├── assignee, requester
                                       ├── labels
                                       ├── custom field values
                                       ├── comments (public | internal)
                                       ├── attachments
                                       ├── relations, parent
                                       └── activity  ← the journal
```

## Universal rules

| Rule | |
| --- | --- |
| **People** | Matched by email, case-insensitive. Unmatched become inactive placeholders — never dropped, never collapsed into "unknown" |
| **Timestamps** | Preserved. `created_at`, `updated_at`, `resolved_at` come from the source |
| **Authorship** | Preserved on comments and activity |
| **Provenance** | Every record gets an `external_link` row: system, id, URL |
| **Rich text** | Converted to Tiptap JSON. Unsupported constructs degrade to plain text and are flagged |
| **Unmapped values** | Block the import until mapped. Never guessed |

## State groups

Everything reduces to five groups. This is the mapping that matters most, because
reporting is built on it.

| Group | Meaning |
| --- | --- |
| `backlog` | Not committed to |
| `unstarted` | Committed, not begun |
| `started` | In progress |
| `completed` | Done successfully |
| `cancelled` | Done unsuccessfully — rejected, duplicate, won't do |

The distinction between `completed` and `cancelled` is important and frequently collapsed
by importers. A "Won't Fix" counted as completed inflates every throughput and attainment
number.

---

## Azure DevOps

| Source | Target | Notes |
| --- | --- | --- |
| Organization | Workspace | |
| Project | Project | |
| Area path | Project or module | A choice at mapping time. Deep hierarchies usually become modules |
| Iteration path | Cycle | |
| Epic / Feature | Epic-type work item | |
| User Story / Product Backlog Item | Story | |
| Task | Task | |
| Bug | Bug | |
| Issue / Impediment | Task, or a service type | |
| `System.State` | State | Per-process; see below |
| `System.Reason` | Activity note | No native equivalent |
| Priority 1–4 | Urgent / High / Medium / Low | |
| Severity | Custom field | |
| Tags | Labels | Semicolon-separated |
| Story Points / Effort | Estimate | |
| Original / Remaining / Completed Work | Time entries | Approximate — no per-day breakdown exists |
| Assigned To | Assignee | By email |
| Created By | Requester | |
| Comments | Comments, all **internal** | ADO has no public/internal distinction; internal is the safe default |
| Attachments | Attachments, staff-visible | |
| Related / Child / Duplicate | Relations | |
| Parent | Parent | |
| Revisions | Activity | This is what preserves history |
| Custom fields | Custom fields | Created if absent |

**State mapping** varies by process template:

| Agile | Scrum | CMMI | Group |
| --- | --- | --- | --- |
| New | New / To Do | Proposed | `unstarted` |
| Active | Approved / Committed / In Progress | Active | `started` |
| Resolved | — | Resolved | `started` |
| Closed | Done | Closed | `completed` |
| Removed | Removed | — | `cancelled` |

**Not imported:** boards and their column configuration, queries, dashboards, pipelines,
repositories, test plans, wiki (export separately to the knowledge base).

**Access:** REST API with a PAT scoped to `Work Items (Read)`, or a CSV export. The API is
strongly preferred — CSV loses history, comments and relations.

---

## Plane

The closest source model to ours, so the mapping is mostly one-to-one.

| Source | Target | Notes |
| --- | --- | --- |
| Workspace | Workspace | |
| Project | Project | |
| Issue | Work item | |
| Issue type | Work item type | |
| State | State | Plane's state groups map directly |
| Priority (urgent/high/medium/low/none) | Priority | `none` → Medium |
| Cycle | Cycle | |
| Module | Module | |
| Label | Label | |
| Estimate point | Estimate point | Preserve the system: points / categories / time |
| Sub-issue | Child work item | |
| Issue relation | Relation | Types map directly |
| Comment | Comment, **internal** | Plane has no public/internal distinction |
| Attachment | Attachment | |
| Issue activity | Activity | |
| Custom properties | Custom fields | |
| Page | Knowledge base article | Optional |
| Intake / Inbox issue | Submission | |
| Member role (Admin 20 / Member 15 / Guest 5) | Admin / Member / Viewer | Reviewed, not assumed |

**Access:** REST API with an API token, Plane's MCP server, or a direct read of its
Postgres. Direct database access is fastest for a large instance and is acceptable for a
one-time migration of an instance we control.

**Not imported:** views, dashboards, workspace settings, webhooks, integrations.

---

## Jira and Jira Service Management

| Source | Target | Notes |
| --- | --- | --- |
| Project | Project | |
| Issue type | Work item type | Per-project schemes need per-project mapping |
| Status | State | Via the status category |
| Status category (To Do / In Progress / Done) | State group | The reliable signal |
| Resolution | Distinguishes `completed` from `cancelled` | "Won't Do", "Duplicate" → `cancelled` |
| Priority | Priority | |
| Epic Link | Parent (epic) | |
| Sprint | Cycle | |
| Component | Module or label | A choice |
| Label | Label | |
| Story Points | Estimate | |
| Worklog | Time entries | Maps well — Jira worklogs are per-day |
| Comment, visibility public | Comment, public | JSM distinguishes; use it |
| Comment, internal | Comment, internal | |
| Attachment | Attachment | |
| Issue link | Relation | |
| Changelog | Activity | |
| Custom field | Custom field | |
| **JSM request type** | Request type | |
| **JSM SLA** | SLA policy | Goals map; calendars need re-authoring |
| **JSM approval** | Approval | Historic decisions preserved |
| **JSM organization** | Organisation | |
| **JSM customer** | Customer person | |

**Not imported:** workflow definitions, permission and notification schemes, screens,
field configurations, automation rules, dashboards, filters, add-ons.

---

## Microsoft Planner

Flat, so the mapping is simple and lossy in only one direction.

| Source | Target |
| --- | --- |
| Plan | Project |
| Bucket | State, or label |
| Task | Work item |
| Progress (Not started / In progress / Completed) | State group |
| Priority | Priority |
| Assigned to | Assignee — Planner allows several; the first becomes assignee, the rest watchers |
| Checklist | Description checklist |
| Labels (the six coloured ones) | Labels |
| Comments | Comments, internal |
| Attachments | Links, not files — Planner stores them in SharePoint |
| Due date | Due date |

**Access:** Microsoft Graph, or a CSV export per plan.

---

## Power Apps ticketing

Bespoke, so there is no canonical mapping. Export to CSV and use the
**agent-assisted path** — an agent can read the columns, infer intent, propose a mapping
and ask about anything ambiguous.

Likely mappings: ticket number → external reference; requester email → requester;
category → request type or label; status → state; description → description; resolution
notes → a public comment.

---

## Generic CSV

The universal fallback. Required columns:

```
external_id        required, unique — drives idempotency
title              required
description
type               mapped
state              mapped
priority           mapped
assignee_email
requester_email
created_at         ISO 8601
resolved_at
labels             semicolon-separated
parent_external_id
project_key        required
cf_<key>           any number of custom field columns
```

Anything not in this list is reported and ignored rather than silently dropped.

## Related

- [Import strategy](import-strategy.md) · [Azure DevOps](azure-devops.md) · [Plane](plane.md)
