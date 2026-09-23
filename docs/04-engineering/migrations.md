# Migration convention

How the schema in [data-model.md](../01-architecture/data-model.md) becomes SQL, how it is
applied, and how it is undone. Written 2026-09-05 because the
[planning review](../07-planning/review-2026-09-05.md) found the mechanism asserted in four
sentences and specified nowhere.

## kaneo's history is inherited

TaskDesk's `apps/api/drizzle/` **starts from kaneo's 45 migrations** (`0000_confused_pixie.sql`
through `0044_needy_triathlon.sql`) and their `meta/_journal.json`, exactly as taken at the
snapshot commit. There is **no hand-made `0001_initial.sql`**: the first TaskDesk migration is
`0045_…`, generated like every one after it.

Every fork-time removal — the four billing tables, `integration`, `github_integration`,
`project.is_public` — is therefore a **new, additive migration** on top of that history,
generated from the post-strip `schema.ts`, not an edit to an inherited file. Inherited files
are never touched.

**Trade-off, stated honestly:** every fresh TaskDesk database replays kaneo's history —
creating and then dropping billing, integration and public-board columns — and kaneo's table
and enum names are baked into the early migrations. The alternative (squash to a generated
baseline and regenerate the journal) is cleaner and is one command. Inheriting wins because
the inherited journal is what kaneo's own integration suite was validated against, so it is
the only baseline the pre-copy test run can be attributed to
([repository-bootstrap.md](repository-bootstrap.md) §0). **This choice is recorded from
Thomas confirmed this on 2026-09-06: inherit the 45, no squashed baseline.** It remains
reversible until the first TaskDesk migration is written.

## Files

```
apps/api/drizzle/
  0000_confused_pixie.sql          inherited from kaneo, unchanged
  …                                45 inherited files, 0000 … 0044
  0044_needy_triathlon.sql
  0045_taskdesk_remove_billing.sql the first TaskDesk migration — generated, never hand-edited
  0046_…
  meta/                            drizzle-kit's journal, inherited and appended to
  snapshots/
    2.0.0.sql                      pg_dump --schema-only at each stable release (upgrade matrix)
```

- Generated migrations come from `pnpm db:generate` against `schema.ts`, are **reviewed by a
  human**, and committed. The reviewer checks the SQL, not the diff of `schema.ts`.
- **Hand-written SQL is appended into a generated migration file**, so the journal tracks it.
  There is no `custom/` directory and no interleaving runner: `drizzle-kit migrate` applies
  only what `meta/_journal.json` lists, and wrapping it in an entrypoint does not give it a
  second directory to scan. The `work_item.key` trigger, the extensions and the append-only
  grants each land at the end of the generated migration that introduces the table they
  concern.
- **Forward-only.** No down migrations exist. To undo, write a new migration that reverses
  the change. This is why destructive changes are two-phase (below).

## Applying at boot

The container entrypoint, before the API listens:

```
1. connect with the application role
2. SELECT pg_advisory_lock(7263849)          -- one constant for the whole product
3. run pending migrations in journal order, each in its own transaction
4. SELECT pg_advisory_unlock(7263849)
5. mark readiness true; start the HTTP listener and the scheduler
```

- Every other replica starting concurrently blocks at step 2 and proceeds after the first
  has finished — they then find nothing pending. No replica serves traffic against an
  unmigrated schema: readiness is false until step 4.
- A failing migration exits the process non-zero **without** unlocking a partial state (the
  failed statement's transaction rolled back); the deploy stops at that replica, the
  previous digest keeps serving, and the operator reads the log. Resume by fixing forward.
- `drizzle-kit migrate` does none of this on its own; the entrypoint wraps it.

## Two-phase destructive changes

Renaming or dropping a column that a running replica may still read:

1. Add the new column; dual-write from the application (release N).
2. Backfill in a migration or a job; switch reads to the new column (release N+1).
3. Drop the old column (release N+2).

At every intermediate point the previous image still works against the current schema —
which is what makes a **rollback of the image** safe while the schema stays.

## The `work_item.key` assignment

Not a generated column. On insert, a trigger does

```sql
update project set last_work_item_number = last_work_item_number + 1
  where id = new.project_id returning last_work_item_number into n;
new.number := n;  new.key := (select key from project where id = new.project_id) || '-' || n;
```

The `UPDATE … RETURNING` serialises concurrent inserts on the project row — deliberate: two
inserts in one project must not collide, and a per-project row lock is the cheapest correct
mechanism. The trigger writes `number` and `key` only: it touches neither `version` nor
`updated_at`, so it can never be mistaken for a concurrent edit by optimistic locking or by
the activity feed. A cross-project move re-keys (new number in the new project) and writes a
`work_item_key_alias` row so the old key redirects.

**Firing order against `work_item_claim_key` (#191).** `work_item` also carries
`work_item_claim_key`, the `BEFORE INSERT OR UPDATE OF "key"` trigger that populates the
`work_item_key_claim` registry (see that table's comment in `schema.ts`). When more than one
`BEFORE ROW` trigger is defined for the same table and event, PostgreSQL fires them in
**alphabetical order by trigger name** — not declaration order, and not migration order. This
key-assignment trigger must be named so it sorts BEFORE `work_item_claim_key`; otherwise the
claim trigger runs first and reads `NEW."key"` before this trigger has set it. Verify the
actual order with `SELECT tgname FROM pg_trigger WHERE tgrelid = 'work_item'::regclass ORDER
BY tgname;` against the migrated schema before shipping either trigger.

## Append-only tables

`audit_log` is append-only by absence of an endpoint and by two triggers, migration `0067`:
`audit_log_append_only` (`BEFORE UPDATE OR DELETE ... FOR EACH ROW` /
`audit_log_reject_mutation()`), which raises on every UPDATE/DELETE attempt except `AU-7`'s
`organisation_id`-to-NULL tombstone; and `audit_log_append_only_truncate` (`BEFORE TRUNCATE
... FOR EACH STATEMENT` / `audit_log_reject_truncate()`), which raises unconditionally,
because a row-level trigger never fires for `TRUNCATE` at all (verified live: without it, a
`TRUNCATE audit_log` emptied the table with no error). The
`taskdesk_app`/`taskdesk_maint` role split this section used to describe — a lesser-privileged
app role with `INSERT, SELECT` and no `UPDATE, DELETE`, and a separate maintenance role for
`audit-purge` — is **not implemented**: `compose.yml`, `charts/taskdesk/**` and `deploy/**`
provision exactly one Postgres role, which owns every table it migrates and so keeps full DML
regardless of any `REVOKE` (decision log, 2026-09-23, "`audit_log` is append-only by trigger,
not by grant"). It could still land later as `audit-purge`'s own infrastructure work, at which
point the grant becomes the primary control and the trigger a second one. `activity` gets the
same trigger-based treatment the next time it is touched; it is not append-only today.

## Seeds

`pnpm seed minimal|realistic|hostile` runs **after** migrations, through the application's
own repositories — never raw SQL — so seeded data obeys the same invariants as real data.
Seeds are idempotent per dataset name.

## Testing

- Every PR: migrations applied from empty against **Testcontainers Postgres 18** — the whole
  journal, inherited files included; schema drift test (`drizzle-kit check`) fails if
  `schema.ts` and the migrations disagree. Note that kaneo's own CI validated these 45
  migrations on **Postgres 16**, so the first run on 18 is new information: any difference it
  surfaces is inherited, not caused by us, and belongs in the fork's verification record.
- Every release: the **upgrade matrix** — restore `snapshots/<N-1>.sql` and
  `snapshots/<N-2>.sql`, apply all migrations forward against synthetic data, run the
  integration suite. This is what proves [release-plan.md](../07-planning/release-plan.md)'s
  "upgrades cleanly from the two preceding minors."
- The production-copy dry run is an **operator** step in the [runbook](../05-operations/runbook.md)
  against a restored, anonymised backup — never a CI job, because CI holds no production
  data.

## Related

- [Data model](../01-architecture/data-model.md) · [CI/CD](ci-cd.md) · [Release plan](../07-planning/release-plan.md)
- [Backup and restore](../05-operations/backup-and-restore.md)
