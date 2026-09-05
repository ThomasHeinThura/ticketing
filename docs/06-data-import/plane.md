# Importing from Plane

- **Plugin:** `import.plane`
- **Phase:** P6

Plane's model is the closest to ours, so this is the simplest of the imports — mostly
one-to-one, with three real decisions.

## Access

| Path | Use when |
| --- | --- |
| **REST API** with a workspace API token | The normal case |
| **MCP server** driven by an agent | Messy data, or ad-hoc judgement needed |
| **Direct Postgres read** | A large self-hosted instance we control. Fastest |

Direct database access is acceptable here because it is a one-time migration of an
instance we own. It is read-only, against a snapshot or a replica, never against a live
production database mid-write.

## Mapping

Almost everything maps directly. See [field mapping](field-mapping.md) for the table.

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

## The three decisions

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

## Discovery output

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

## Direct database read

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

## Performance

For roughly 15,000 issues:

| Stage | Time |
| --- | --- |
| Discovery | under a minute |
| Dry run | 3–5 minutes |
| Issues and comments | 20–40 minutes |
| Activities | 30–60 minutes |
| Attachments | 30–90 minutes |

Much faster than Azure DevOps, because the models align and there is less translation.

## Agent-assisted variant

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

## Verification

- [ ] Issue counts match per project
- [ ] State group distribution matches — an item in `cancelled` here should be
      `cancelled` there
- [ ] Cycle membership matches
- [ ] Module membership matches
- [ ] Estimates present and on the same scale
- [ ] Sub-issue hierarchy intact
- [ ] Relations resolve
- [ ] Comment counts match; authors and timestamps preserved
- [ ] Attachments open
- [ ] **Roles reviewed by a person**, not accepted from the proposal
- [ ] Pages imported as unpublished, staff-only
- [ ] Provenance links open the original in Plane

## Related

- [Import strategy](import-strategy.md) · [Field mapping](field-mapping.md)
- [MCP server](../03-features/mcp-server.md)
