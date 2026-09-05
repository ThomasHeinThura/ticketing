# Importing from Azure DevOps

- **Plugin:** `import.azure-devops`
- **Phase:** P6

## Access

Two paths. The API is strongly preferred.

| Path | Gets | Loses |
| --- | --- | --- |
| **REST API** with a PAT | Everything: history, comments, attachments, relations | — |
| **CSV export** from a query | Fields only | History, comments, attachments, relations |

A CSV import of Azure DevOps is a last resort. It produces work items with no context,
which is often worse than leaving them where they are.

**PAT scopes:** `Work Items (Read)`, `Identity (Read)`, `Project and Team (Read)`.
Read-only throughout — the import never writes to Azure DevOps.

## Sequence

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

## Discovery output

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

## Decisions the wizard asks about

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

## Attachments

- Downloaded from Azure DevOps and re-uploaded to our storage.
- Rate-limited; this is usually the slowest part of the import.
- Failures do not fail the item: it imports, and the attachment is reported with its source
  URL so it can be retrieved manually.
- Files above the size limit are reported, never silently dropped.

## History

`Revisions` become `activity` rows, which is what makes the journal — and therefore
point-in-time reconstruction — work after the import.

- Field changes map to activity rows with old and new values.
- Field names are translated using the mapping.
- The revision author and timestamp are preserved.
- Only revisions touching mapped fields are imported; the rest are counted and reported.

This is the highest-volume part of the import — roughly eight revisions per work item in
the example above — and it is chunked separately.

## Boards, queries and pipelines

Not imported. States and their order are configured in TaskDesk; queries become saved
views; pipelines are out of scope.

The Azure DevOps wiki can be exported separately and imported into the knowledge base.

## Performance

For roughly 50,000 work items with attachments:

| Stage | Time |
| --- | --- |
| Discovery | 2–5 minutes |
| Dry run | 10–20 minutes |
| Work items and comments | 1–2 hours |
| Revisions | 2–4 hours |
| Attachments | 2–6 hours, bandwidth-bound |

Resumable throughout, so it can be run overnight and continued.

## Verification

After import:

- [ ] Counts match, per project and per type
- [ ] Spot-check 20 work items against the originals: title, state, assignee, dates
- [ ] Comment counts match on those 20
- [ ] Attachments open
- [ ] Parent/child hierarchy is intact
- [ ] Relations resolve
- [ ] Activity shows history, not just a creation event
- [ ] The provenance link opens the original in Azure DevOps
- [ ] Placeholder users are marked inactive and are not assignable

## Related

- [Import strategy](import-strategy.md) · [Field mapping](field-mapping.md)
