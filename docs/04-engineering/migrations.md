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

`audit_log` is append-only by absence of an endpoint, by two triggers, AND (issue #296) by
grant — three independent controls, not one:

- **Triggers, migration `0067`:** `audit_log_append_only` (`BEFORE UPDATE OR DELETE ... FOR
  EACH ROW` / `audit_log_reject_mutation()`), which raises on every UPDATE/DELETE attempt
  except `AU-7`'s `organisation_id`-to-NULL tombstone; and `audit_log_append_only_truncate`
  (`BEFORE TRUNCATE ... FOR EACH STATEMENT` / `audit_log_reject_truncate()`), which raises
  unconditionally, because a row-level trigger never fires for `TRUNCATE` at all (verified
  live: without it, a `TRUNCATE audit_log` emptied the table with no error).
- **Grant, issue #296:** the application role `taskdesk_app` holds `SELECT, INSERT` and no
  `UPDATE, DELETE` on `audit_log` (and on `activity`) — no `TRUNCATE`, no DDL, either. This
  was the primary control this section originally described as unbuilt (decision log,
  2026-09-23, "`audit_log` is append-only by trigger, not by grant") — it is now built.

The two are deliberately redundant: the trigger closes the gap for any role that DOES hold
UPDATE/DELETE (a future maintenance role, an operator connected directly), and the grant
closes it for `taskdesk_app` specifically, which no longer has the privilege to attempt the
mutation the trigger would otherwise have to reject. `AU-7`'s tombstone survives the grant
restriction: it fires from `audit_log.organisation_id`'s own `ON DELETE SET NULL` foreign-key
action when a row is deleted from `organisation`, and Postgres enforces a referential action
using the privileges checked when the constraint was created, not the deleting session's own
grants on the referencing table — verified live: a role granted only `SELECT, INSERT` on the
child table still received the `SET NULL` when the parent row was deleted.

**`activity` has no trigger yet, and its grant only covers direct DML (S4, independent Opus
5.5 review of PR #308).** `activity.work_item_id` is `ON DELETE CASCADE` to `work_item`
(migration `0066`), and `taskdesk_app` holds ordinary `DELETE` on `work_item` and `project`
(neither is append-only). **Decided behaviour, not a regression, not revoked:** deleting a
work item, or a project or workspace whose deletion cascades to its work items, removes that
work item's `activity` rows as a side effect of the cascade — the table owner runs it, with
no privilege check against `activity` itself, exactly the same mechanism that lets `AU-7`'s
tombstone through above. The `SELECT, INSERT`-only grant on `activity` stops a direct
`UPDATE`/`DELETE`/`TRUNCATE` issued against `activity`; it was never a claim that `activity`
rows are immortal once their parent work item is gone. Reproduced live: a scratch parent/child
pair with the same grant shape (child `SELECT, INSERT` only) denied a direct `DELETE` on the
child and allowed `DELETE` on the parent to remove every child row.

**Mechanism (issue #296).** Not a grant hand-written into each table's own generated
migration, as this section once proposed. That approach could not carry `taskdesk_app`'s
password (deployment-specific, rotatable) and could not stay correct once a table's
append-only status changes without a further migration. Instead `ensureApplicationRole`
(`apps/api/src/database/ensure-application-role.ts`) runs as the **migration/owner role**,
in the separate, one-shot **migrate step** (`TASKDESK_ROLE=migrate`; see "Two processes,
never one credential in both" below) immediately after Drizzle's `migrate()`: it
creates/repairs `taskdesk_app` (never a superuser, never a table owner — enforced further by
`assertApplicationRoleIsNotPrivileged` in the separate serving process), then re-derives
every table's grant from `APPEND_ONLY_TABLES`
(`apps/api/src/database/append-only-tables.ts`) — `SELECT, INSERT` for a table named there,
`SELECT, INSERT, UPDATE, DELETE` for every other ordinary table — and sets
`ALTER DEFAULT PRIVILEGES` so a table a *future* migration creates gets the ordinary grant
automatically. `activity` gets the same grant restriction as `audit_log`; it does not yet
have `audit_log`'s trigger pair (tracked separately — "gets the same trigger-based treatment
the next time it is touched").

**Two processes, never one credential in both (issue #296, S1, independent Opus 5.5 review of
PR #308).** The migrate step above and the API's own serving boot used to be one function in
one long-running process, which meant that process had to be started with
`TASKDESK_MIGRATION_DATABASE_URL` — the owner/superuser credential — in its environment for
its whole life, reachable by any process-level compromise regardless of what the code did
with the connection afterwards. They are now two separate entry points, selected the same way
`TASKDESK_ROLE=web`/`jobs` already are
(`docs/05-operations/container-image.md`): `TASKDESK_ROLE=migrate` runs migrations and
`ensureApplicationRole` against the owner connection and exits; the ordinary serving process
(`web`/`jobs`/`all`) never receives that variable at all, and refuses to start if it ever
does. In compose this is a one-shot `migrate` service the `taskdesk` service `depends_on`
(`service_completed_successfully`); in Helm it is a hook Job. See
[configuration-reference.md](../05-operations/configuration-reference.md) for the exact
variables and the local-development path.

The retention purge running as a separate `taskdesk_maint` role from the `audit-purge` job's
own connection is unbuilt scope, tracked on the audit-log work, not issue #296.

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
