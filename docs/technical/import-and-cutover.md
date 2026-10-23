# Import and cutover contracts

P6 product requirements for moving existing work through real persisted APIs. These references preserve the four original import contracts; they do not prove an importer, cutover or rollback is implemented. Numbered definitions retain their wording; [requirement evidence](../requirements-index.json) and [status](../status.md) remain separate.

Use original Kaneo settings, table, mapping, progress and detail components. Keep editable mapping and loss reports visible. Customer configuration belongs in runtime administration; the one-image rule, current reach/capability checks, tenant isolation, agent/portal separation, audit, safe deletion and current owner decisions remain in force. Source credentials and direct database access are for read-only import; imported identities or role proposals cannot bypass the existing authority model. Historical project process and acceptance status are not restored.

- [Strategy, 12 numbered requirements, API and reconciliation](#import-strategy)
- [Complete field mapping: ADO, Plane, Jira/JSM, Planner, Power Apps and CSV](#field-mapping)
- [Azure DevOps access, history and verification](#azure-devops)
- [Plane access, privacy, roles and verification](#plane)
- [Names, source conflicts and cutover gaps](#reconciliation-and-cutover-gaps)

<a id="import-strategy"></a>
## Import strategy

- **Primary phase:** P6
- **Feature flag:** always on for administrators


<a id="import-strategy-purpose"></a>
### Purpose

Move existing work out of Jira, Plane, Azure DevOps, Microsoft Planner and the Power Apps
ticketing tool, once, without losing history and without creating duplicates.

<a id="import-strategy-the-realistic-model"></a>
### The realistic model

Every conventional importer makes the same wrong assumption: that the source schema maps
cleanly onto the destination schema. It never does. Real migrations are dominated by
judgement calls — which of these six Jira statuses maps to "In Progress"? is this
"Component" a module or a label? what do we do with the 40% of items that have no
assignee?

So the design is **two paths**:

| Path | For | How |
| --- | --- | --- |
| **Structured import** | Clean, high-volume, well-understood data | An `import.*` plugin with an explicit mapping |
| **Agent-assisted import** | Messy data, judgement calls, one-off systems | An AI agent reading the source and writing through the MCP server |

The second path is what makes this tractable. An agent can read a Plane database or an
Azure DevOps export, reason about the mapping, ask when unsure, and write through the same
authenticated API a person would use.

<a id="import-strategy-principles"></a>
### Principles

- `IM-1` **Idempotent.** Every imported record writes an `import_mapping` row linking
  source id to target id. Re-running maps to the same record rather than creating a second.
- `IM-2` **Dry-run first.** Every import can be run without writing, producing a full
  report of what would be created, updated, skipped and rejected.
- `IM-3` **Resumable.** Chunked, each chunk committed. A failure resumes from the last
  committed chunk.
- `IM-4` **Never partial-silent.** An import that could not map something reports it. It
  does not guess and it does not drop.
- `IM-5` **Preserve provenance.** Every imported record keeps a link to its source system,
  source id and source URL, so anyone can check the original.
- `IM-6` **Preserve authorship and timestamps** where the source provides them. An import
  that stamps everything with today's date and the importer's name destroys the history it
  was supposed to save.
- `IM-7` **Users are matched by email**, and unmatched users become inactive placeholder
  records rather than being dropped. Comments by departed staff still say who wrote them.

<a id="import-strategy-the-pipeline"></a>
### The pipeline

```
1. Connect      credentials, or a file
2. Discover     what exists: projects, types, states, fields, users
3. Map          source → target, proposed automatically, edited by a human
4. Dry run      full report; nothing written
5. Review       fix the mapping, repeat step 4
6. Import       chunked, resumable, live progress
7. Reconcile    counts compared; anything unmapped listed
8. Verify       spot-check against the source
```

Steps 3 to 5 are where the work is. The mapping screen is the product here — a generated
mapping that cannot be corrected by a person is worse than no importer.

<a id="import-strategy-mapping"></a>
### Mapping

Automatically proposed, always editable:

| Source | Target |
| --- | --- |
| Project / Team / Area path | Project |
| Issue type / Work item type | Work item type |
| Status / State | State, and its state group |
| Priority | Priority |
| Assignee / Created by | Person, matched by email |
| Labels / Tags | Labels |
| Components / Epics | Modules or epics — a choice |
| Sprints / Iterations | Cycles |
| Custom fields | Custom fields, created if needed |
| Comments | Comments, with author and timestamp |
| Attachments | Attachments, downloaded and re-uploaded |
| Links | Relations, by type |
| History | Activity rows, so the journal survives |

The mapping is saved, so a second run against the same source reuses it.

<a id="import-strategy-what-is-deliberately-not-imported"></a>
### What is deliberately not imported

Stated up front, because expectations here are the main source of disappointment.

- **Workflow definitions.** Source workflows rarely translate; define them fresh.
- **Permission schemes.** Model access in TaskDesk deliberately rather than inheriting a
  mess.
- **Dashboards, reports and saved filters.** Recreate them.
- **Automation rules.** Recreate them.
- **Attachments above the size limit.** Reported, with links to the originals.
- **Rich text formatting that has no equivalent.** Converted best-effort, flagged where
  lossy.

<a id="import-strategy-sources"></a>
### Sources

| Source | Access | Notes |
| --- | --- | --- |
| **Azure DevOps** | REST API, or a CSV export | See [azure-devops.md](#azure-devops) |
| **Plane** | REST API, MCP server, or direct database read | See [plane.md](#plane) |
| **Jira / JSM** | REST API, or a JSON export | Types, statuses and fields need real mapping work |
| **MS Planner** | Graph API, or CSV | Flat; becomes work items in one project |
| **Power Apps ticketing** | CSV export | Bespoke; agent-assisted is the realistic path |
| **Generic CSV** | Upload | The universal fallback |

<a id="import-strategy-agent-assisted-import"></a>
### Agent-assisted import

The path for anything messy.

```
AI agent
  ├── reads the source          (its MCP server, its API, or an export file)
  ├── proposes a mapping        (and explains its reasoning)
  ├── asks about ambiguities    ("6 statuses map to 'Done' — is that right?")
  └── writes to TaskDesk        via @taskdesk/mcp, with idempotency keys
```

Requirements that make this safe:

- `IM-8` Every MCP write tool requires an `Idempotency-Key`. Agents retry; retries must not
  duplicate.
- `IM-9` The agent uses an API key with an explicit capability subset. It cannot exceed the
  key owner's authority.
- `IM-10` `bulk_create_work_items` is capped and rate-limited.
- `IM-11` Every agent-originated write is audited and marked as such.
- `IM-12` The agent writes `import_mapping` rows through `create_import_mapping`, so its
  work is as resumable as a structured import.

<a id="import-strategy-screens"></a>
### Screens

**God Mode → Import** — run history, status, statistics, logs.

**Import wizard** — connect, discover, map, dry-run, review, execute, reconcile. Live
progress over the `instance` WebSocket topic.

The mapping step deserves real design attention. It is a table of source values against
target values, with the automatic proposal pre-filled, unmapped rows highlighted, and a
count of affected records per row. Someone should be able to see at a glance that 4,000
items depend on one uncertain mapping decision.

<a id="import-strategy-api"></a>
### API

```
POST /api/imports                              instance:admin
GET  /api/imports                              instance:admin
GET  /api/imports/{id}                         instance:admin
POST /api/imports/{id}/discover                instance:admin
POST /api/imports/{id}/mapping                 instance:admin
POST /api/imports/{id}/dry-run                 instance:admin
POST /api/imports/{id}/execute                 instance:admin
POST /api/imports/{id}/pause                   instance:admin
GET  /api/imports/{id}/report                  instance:admin
POST /api/imports/{id}/records                 instance:admin   (bulk write path — the MCP `bulk_create_work_items` tool lands here under `import.mcp`)
POST /api/imports/{id}/links                   instance:admin   (write `import_record_link` rows — MCP `create_import_link`)
GET  /api/imports/{id}/links                   instance:admin   (read them — MCP `get_import_link`)
```

The last three exist so the MCP server is a client of *this* API rather than a second import
path ([mcp-server.md](feature-contracts-p4.md#mcp-server)); an agent-driven import is an
`import_run` like any other, with the same ledger, audit and chunked bulk path.

<a id="import-strategy-edge-cases"></a>
### Edge cases

| Case | Behaviour |
| --- | --- |
| Same source imported twice | Mapping rows cause updates, not duplicates |
| Source record deleted after import | Target retained; the provenance link is marked stale |
| Circular parent references in the source | Detected; the cycle is broken and reported |
| Comment author not in the directory | Inactive placeholder person created, authorship preserved |
| Attachment download fails | Item imported, attachment reported as missing with the source URL |
| Source has more states than the target | Mapping is required; the import will not start until every state is mapped |
| 100,000 items | Chunked at 500; hours; resumable; progress visible |
| Import interrupted | Resumes from the last committed chunk |

<a id="import-strategy-testing"></a>
### Testing

Unit: mapping resolution; idempotency key derivation; cycle detection.

Integration: a second run creates nothing new; a failure mid-import resumes correctly; an
unmapped state blocks execution rather than guessing.

E2E: import a fixture export, verify counts, verify provenance links, re-run and confirm
no duplication.

<a id="import-strategy-related"></a>
### Related

- [MCP server](feature-contracts-p4.md#mcp-server) · [Field mapping](#field-mapping)
- [Azure DevOps](#azure-devops) · [Plane](#plane)

<a id="field-mapping"></a>
## Field mapping reference

Canonical mappings from each source system to TaskDesk. Proposed automatically by the
import wizard; always editable.

<a id="field-mapping-taskdesk-target-model"></a>
### TaskDesk target model

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

<a id="field-mapping-universal-rules"></a>
### Universal rules

| Rule | |
| --- | --- |
| **People** | Matched by email, case-insensitive. Unmatched become inactive placeholders — never dropped, never collapsed into "unknown" |
| **Timestamps** | Preserved. `created_at`, `updated_at`, `resolved_at` come from the source |
| **Authorship** | Preserved on comments and activity |
| **Provenance** | Every record gets an `external_link` row: system, id, URL |
| **Rich text** | Converted to Tiptap JSON. Unsupported constructs degrade to plain text and are flagged |
| **Unmapped values** | Block the import until mapped. Never guessed |

<a id="field-mapping-state-groups"></a>
### State groups

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

<a id="field-mapping-azure-devops"></a>
### Azure DevOps

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

<a id="field-mapping-plane"></a>
### Plane

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

<a id="field-mapping-jira-and-jira-service-management"></a>
### Jira and Jira Service Management

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

<a id="field-mapping-microsoft-planner"></a>
### Microsoft Planner

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

<a id="field-mapping-power-apps-ticketing"></a>
### Power Apps ticketing

Bespoke, so there is no canonical mapping. Export to CSV and use the
**agent-assisted path** — an agent can read the columns, infer intent, propose a mapping
and ask about anything ambiguous.

Likely mappings: ticket number → external reference; requester email → requester;
category → request type or label; status → state; description → description; resolution
notes → a public comment.

---

<a id="field-mapping-generic-csv"></a>
### Generic CSV

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

<a id="field-mapping-related"></a>
### Related

- [Import strategy](#import-strategy) · [Azure DevOps](#azure-devops) · [Plane](#plane)

<a id="azure-devops"></a>
## Importing from Azure DevOps

- **Plugin:** `import.azure-devops`
- **Primary phase:** P6

<a id="azure-devops-access"></a>
### Access

Two paths. The API is strongly preferred.

| Path | Gets | Loses |
| --- | --- | --- |
| **REST API** with a PAT | Everything: history, comments, attachments, relations | — |
| **CSV export** from a query | Fields only | History, comments, attachments, relations |

A CSV import of Azure DevOps is a last resort. It produces work items with no context,
which is often worse than leaving them where they are.

**PAT scopes:** `Work Items (Read)`, `Identity (Read)`, `Project and Team (Read)`.
Read-only throughout — the import never writes to Azure DevOps.

<a id="azure-devops-sequence"></a>
### Sequence

```
1. Connect        organisation URL + PAT → validate
2. Discover       projects, process templates, work item types, states,
                  area paths, iterations, custom fields, users
3. Map            proposed automatically; every state must be mapped
4. Dry run        full report, nothing written
5. Review         correct the mapping; repeat
6. Import         chunked at 200 work items, resumable
7. Reconcile      counts compared; unmapped items listed
```

<a id="azure-devops-discovery-output"></a>
### Discovery output

The wizard shows what it found, so the size of the job is visible before starting:

```
Organisation: contoso
  Projects            4
  Work item types    17   (Agile, Scrum in different projects)
  States             23   → 11 need mapping
  Area paths         62   → become modules, or split into projects?
  Iterations        118   → cycles
  Custom fields      31   → 12 already exist, 19 will be created
  Users             204   → 187 matched by email, 17 will be placeholders
  Work items     48,391
  Attachments    12,004   (7.2 GB)
  Revisions     412,880   → activity rows
```

<a id="azure-devops-decisions-the-wizard-asks-about"></a>
### Decisions the wizard asks about

These are the ones that actually take thought.

**Area paths.** A deep area path tree is either projects or modules. `Contoso\Platform\API`
could be a project called "Platform API", or a module "API" inside a project "Platform".
The wizard proposes modules for depth ≥ 2 and asks.

**Process templates.** Different projects may use Agile, Scrum and CMMI, with different
states. Each needs its own state mapping. The wizard groups them.

**Resolved versus Closed.** Agile has both. Both are usually `completed`, but some teams
use Resolved to mean "fixed, awaiting verification", which is `started`. The wizard asks
and shows how many items are in each.

**Removed.** Maps to `cancelled`, not `completed`. Getting this wrong inflates throughput.

**Effort fields.** `Original Estimate`, `Remaining Work` and `Completed Work` are point-in-
time aggregates, not a log. They can become an estimate plus a single time entry, or be
imported as custom fields. Neither is perfect; the wizard explains the trade and asks.

**Comment visibility.** Azure DevOps has no public/internal distinction. Everything imports
as **internal**, because the alternative risks exposing internal discussion to customers.
Stated plainly at mapping time.

<a id="azure-devops-attachments"></a>
### Attachments

- Downloaded from Azure DevOps and re-uploaded to our storage.
- Rate-limited; this is usually the slowest part of the import.
- Failures do not fail the item: it imports, and the attachment is reported with its source
  URL so it can be retrieved manually.
- Files above the size limit are reported, never silently dropped.

<a id="azure-devops-history"></a>
### History

`Revisions` become `activity` rows, which is what makes the journal — and therefore
point-in-time reconstruction — work after the import.

- Field changes map to activity rows with old and new values.
- Field names are translated using the mapping.
- The revision author and timestamp are preserved.
- Only revisions touching mapped fields are imported; the rest are counted and reported.

This is the highest-volume part of the import — roughly eight revisions per work item in
the example above — and it is chunked separately.

<a id="azure-devops-boards-queries-and-pipelines"></a>
### Boards, queries and pipelines

Not imported. States and their order are configured in TaskDesk; queries become saved
views; pipelines are out of scope.

The Azure DevOps wiki can be exported separately and imported into the knowledge base.

<a id="azure-devops-source-planning-estimates"></a>
### Source planning estimates

These inherited duration estimates are planning context, not measured performance, accepted budgets or evidence that the importer works. Existing performance budgets remain unchanged.

For roughly 50,000 work items with attachments:

| Stage | Time |
| --- | --- |
| Discovery | 2–5 minutes |
| Dry run | 10–20 minutes |
| Work items and comments | 1–2 hours |
| Revisions | 2–4 hours |
| Attachments | 2–6 hours, bandwidth-bound |

Resumable throughout, so it can be run overnight and continued.

<a id="azure-devops-verification"></a>
### Verification

After import:

- Required: Counts match, per project and per type
- Required: Spot-check 20 work items against the originals: title, state, assignee, dates
- Required: Comment counts match on those 20
- Required: Attachments open
- Required: Parent/child hierarchy is intact
- Required: Relations resolve
- Required: Activity shows history, not just a creation event
- Required: The provenance link opens the original in Azure DevOps
- Required: Placeholder users are marked inactive and are not assignable

<a id="azure-devops-related"></a>
### Related

- [Import strategy](#import-strategy) · [Field mapping](#field-mapping)

<a id="plane"></a>
## Importing from Plane

- **Plugin:** `import.plane`
- **Primary phase:** P6

Plane's model is the closest to ours, so this is the simplest of the imports — mostly
one-to-one, with three real decisions.

<a id="plane-access"></a>
### Access

| Path | Use when |
| --- | --- |
| **REST API** with a workspace API token | The normal case |
| **MCP server** driven by an agent | Messy data, or ad-hoc judgement needed |
| **Direct Postgres read** | A large self-hosted instance we control. Fastest |

Direct database access is acceptable here because it is a one-time migration of an
instance we own. It is read-only, against a snapshot or a replica, never against a live
production database mid-write.

<a id="plane-mapping"></a>
### Mapping

Almost everything maps directly. See [field mapping](#field-mapping) for the table.

```
Workspace       → Workspace
Project         → Project
Issue           → Work item
Issue type      → Work item type
State + group   → State + state group      ← groups align exactly
Priority        → Priority                 ← none → Medium
Cycle           → Cycle
Module          → Module
Label           → Label
Estimate point  → Estimate point           ← preserve the system
Sub-issue       → Child
Issue relation  → Relation                 ← types align
Comment         → Comment (internal)
Attachment      → Attachment
Issue activity  → Activity
Custom property → Custom field
Page            → Knowledge base article   ← optional
Intake issue    → Submission
```

<a id="plane-the-three-decisions"></a>
### The three decisions

**1 · Comment visibility.** Plane has no public/internal distinction. Everything imports as
**internal**. If some comments were customer-facing, they must be identified by another
signal — a label, a convention — and that is a mapping rule to be written deliberately.
The default never risks exposure.

**2 · Roles.** Plane's numeric roles do not map one-to-one onto ours, because ours are
richer.

| Plane | Proposed | Review |
| --- | --- | --- |
| Admin (20) | Admin | Usually right |
| Member (15) | Member | Usually right |
| Guest (5) | Viewer | **Check.** A Plane guest can often comment; our viewer cannot |

Do not accept the proposal without looking. This is an access decision, and inheriting it
carelessly is how a migration creates a permission problem.

**3 · Pages.** Plane pages are wiki-style documents. They can become knowledge base
articles, or be left behind. Articles are staff-only and unpublished on import — never
customer-visible by default, whatever their Plane visibility was.

<a id="plane-discovery-output"></a>
### Discovery output

```
Workspace: acme
  Projects            12
  Issue types          6
  States              38   → 5 distinct group patterns
  Cycles              84
  Modules             27
  Labels              63
  Custom properties   14
  Members             48   → 46 matched, 2 placeholders
  Issues          14,205
  Comments        31,880
  Attachments      2,140   (1.1 GB)
  Pages              192
  Intake issues      340
```

<a id="plane-direct-database-read"></a>
### Direct database read

For a large self-hosted instance:

```
Read-only connection to a snapshot or replica.
Tables of interest:
  workspaces · projects · issues · states · labels · issue_labels
  cycles · cycle_issues · modules · module_issues
  issue_comments · issue_activities · issue_attachments
  issue_relations · issue_properties · project_members · pages
```

Attachments still come through the object store or the API — the database holds only
references.

<a id="plane-source-planning-estimates"></a>
### Source planning estimates

These inherited duration estimates are planning context, not measured performance, accepted budgets or evidence that the importer works. Existing performance budgets remain unchanged.

For roughly 15,000 issues:

| Stage | Time |
| --- | --- |
| Discovery | under a minute |
| Dry run | 3–5 minutes |
| Issues and comments | 20–40 minutes |
| Activities | 30–60 minutes |
| Attachments | 30–90 minutes |

Much faster than Azure DevOps, because the models align and there is less translation.

<a id="plane-agent-assisted-variant"></a>
### Agent-assisted variant

Where the data needs judgement — inconsistent naming, projects that should be merged or
split, states used in ways their names do not suggest — drive the import through an agent:

```
Agent reads Plane (its MCP server or its API)
  → proposes a mapping, with reasoning
  → asks about ambiguities
  → writes through @taskdesk/mcp with idempotency keys
  → records import_mapping rows so the work is resumable
```

This is slower per item and far better at the messy 10% that a structured importer would
either drop or get wrong.

<a id="plane-verification"></a>
### Verification

- Required: Issue counts match per project
- Required: State group distribution matches — an item in `cancelled` here should be
      `cancelled` there
- Required: Cycle membership matches
- Required: Module membership matches
- Required: Estimates present and on the same scale
- Required: Sub-issue hierarchy intact
- Required: Relations resolve
- Required: Comment counts match; authors and timestamps preserved
- Required: Attachments open
- Required: **Roles reviewed by a person**, not accepted from the proposal
- Required: Pages imported as unpublished, staff-only
- Required: Provenance links open the original in Plane

<a id="plane-related"></a>
### Related

- [Import strategy](#import-strategy) · [Field mapping](#field-mapping)
- [MCP server](feature-contracts-p4.md#mcp-server)

<a id="reconciliation-and-cutover-gaps"></a>
## Names, source conflicts and cutover gaps

- **Idempotency ledger and provenance are distinct.** The maintained [data model](data-model.md) names `import_record_link` as the row-level ledger, formerly `import_mapping`; `import_mapping_profile` stores the operator-edited mapping. `external_link` holds source-system/id/URL provenance for entities. Preserve all three meanings rather than merging the ledger with the mapping profile or losing source links.
- **MCP tool-name reconciliation:** IM-12 retains the original `create_import_mapping` label. The strategy API and maintained [MCP tools](feature-contracts-p4.md#mcp-server-api) specify `create_import_link` / `get_import_link` through `/api/imports/{id}/links`. Resolve compatibility explicitly; this migration does not register an extra tool, route or permission. Agent-driven runs use the same persisted run, ledger, audit and bulk API as structured runs.
- **ADO Resolved mapping:** the field table proposes `started`; the ADO explanation discusses `completed` versus `started`. These are proposals requiring the operator's explicit per-process mapping, never permission for the importer to guess. Show affected counts and preserve the selected mapping in repeat runs.
- **Chunks and checkpoints:** the general example uses chunks of 500; ADO specifies 200 work items and separately chunked revisions. These source-specific limits are retained. IM-3 guarantees resumption from the last committed chunk; the four sources do not specify the persisted checkpoint shape, cursor ownership or stale-source reconciliation semantics. Those details need an explicit contract before claiming reliable recovery.
- **Whole-run rollback and cutover:** these four sources specify chunk commits, pause/resume, source-read-only access, idempotent re-runs, count/loss reconciliation and source spot-checking. They do not define a whole-run undo API, an atomic cross-system cutover, source freeze/delta capture, rollback window, deletion of imported target data or restoration of overwritten target values. Do not infer those guarantees from resumability, a successful dry run or backup availability. Define the cutover/recovery contract before a real migration; use the maintained backup/restore contract when available and report the current gap honestly.

## Reference coverage

All links from the four source contracts resolve to sections here or the maintained MCP reference. No additional external source contract remains required to read this import reference. The explicit cutover/checkpoint/tool-name gaps above remain open; migrating documentation does not close them or accept the 12 IM requirements.
