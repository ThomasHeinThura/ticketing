# Import strategy

- **Phase:** P6
- **Status:** ⬜
- **Feature flag:** always on for administrators

> **This is a feature, not the project.** TaskDesk v2 is a greenfield build. Importing
> from existing systems is one capability among many, used once during transition and
> occasionally thereafter.

## Purpose

Move existing work out of Jira, Plane, Azure DevOps, Microsoft Planner and the Power Apps
ticketing tool, once, without losing history and without creating duplicates.

## The realistic model

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

## Principles

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

## The pipeline

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

## Mapping

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

## What is deliberately not imported

Stated up front, because expectations here are the main source of disappointment.

- **Workflow definitions.** Source workflows rarely translate; define them fresh.
- **Permission schemes.** Model access in TaskDesk deliberately rather than inheriting a
  mess.
- **Dashboards, reports and saved filters.** Recreate them.
- **Automation rules.** Recreate them.
- **Attachments above the size limit.** Reported, with links to the originals.
- **Rich text formatting that has no equivalent.** Converted best-effort, flagged where
  lossy.

## Sources

| Source | Access | Notes |
| --- | --- | --- |
| **Azure DevOps** | REST API, or a CSV export | See [azure-devops.md](azure-devops.md) |
| **Plane** | REST API, MCP server, or direct database read | See [plane.md](plane.md) |
| **Jira / JSM** | REST API, or a JSON export | Types, statuses and fields need real mapping work |
| **MS Planner** | Graph API, or CSV | Flat; becomes work items in one project |
| **Power Apps ticketing** | CSV export | Bespoke; agent-assisted is the realistic path |
| **Generic CSV** | Upload | The universal fallback |

## Agent-assisted import

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

## Screens

**God Mode → Import** — run history, status, statistics, logs.

**Import wizard** — connect, discover, map, dry-run, review, execute, reconcile. Live
progress over the `instance` WebSocket topic.

The mapping step deserves real design attention. It is a table of source values against
target values, with the automatic proposal pre-filled, unmapped rows highlighted, and a
count of affected records per row. Someone should be able to see at a glance that 4,000
items depend on one uncertain mapping decision.

## API

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
```

## Edge cases

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

## Testing

Unit: mapping resolution; idempotency key derivation; cycle detection.

Integration: a second run creates nothing new; a failure mid-import resumes correctly; an
unmapped state blocks execution rather than guessing.

E2E: import a fixture export, verify counts, verify provenance links, re-run and confirm
no duplication.

## Related

- [MCP server](../03-features/mcp-server.md) · [Field mapping](field-mapping.md)
- [Azure DevOps](azure-devops.md) · [Plane](plane.md)
