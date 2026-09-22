# Pre-merge security review — PR #239 (fix #192: work_item/workspace tenant-attribution schema)

**Reviewed head:** `0088189810d6c88e667c55dd08e7a015b8c39bcf`

**Reviewer:** mandatory independent Opus pass, fresh context — did not author, orchestrate
or previously review this change. Closing gate of a full three-round tier (ordinary Sonnet
review: APPROVE; project-alignment Sonnet check: ALIGNED WITH NOTES). Every claim in the PR
body and in the two prior rounds was re-verified against source, and the authority-boundary
claims were re-verified against a live PostgreSQL 16 database rather than by reading DDL.

**Review method.** Isolated detached worktree at the exact head above (not `main`, not the
implementation worktree). A private database `opusrev192_test` on `td-lane-pg`
(`127.0.0.1:55440`), created fresh, with all 62 migrations applied by the real
`drizzle-kit migrate`. All FK definitions read back out of `pg_constraint`, not out of the
migration file. Attack shapes executed as real SQL. The `ON UPDATE NO ACTION` claim
mutation-tested by rebuilding the same FKs with `ON UPDATE CASCADE` and replaying the
attacks.

**Status: CLEAR WITH FINDINGS (non-blocking).** The authority boundary this migration
exists to create genuinely holds under real SQL, against every attack shape tried,
including the exact PR #191 O1 shape. Three non-blocking findings are recorded below; none
of them weakens the boundary, and none needs to close before merge.

---

## 1. The core authority-boundary claim — VERIFIED (live SQL, not DDL reading)

### 1.1 The constraints that actually exist in the database

Read back from `pg_constraint` on a freshly migrated database (PostgreSQL omits
`ON UPDATE NO ACTION` from `pg_get_constraintdef` because it is the default — its absence
is the positive confirmation, not a gap):

```
work_item_workspace_id_project_id_project_workspace_id_id_fk
  FOREIGN KEY (workspace_id, project_id) REFERENCES project(workspace_id, id) ON DELETE CASCADE
work_item_workspace_id_type_id_work_item_type_workspace_id_id_f
  FOREIGN KEY (workspace_id, type_id) REFERENCES work_item_type(workspace_id, id) ON DELETE RESTRICT
work_item_type_workspace_id_id_unique   UNIQUE (workspace_id, id)
workspace_organisation_id_organisation_id_fk
  FOREIGN KEY (organisation_id) REFERENCES organisation(id) ON UPDATE CASCADE ON DELETE RESTRICT
```

`work_item.workspace_id`, `type_id` and `project_id` are all `NOT NULL` in the catalog.
Neither new composite FK carries `ON UPDATE CASCADE`. The old single-column
`work_item_type_id_work_item_type_id_fk` is dropped by the migration and is absent. The old
single-column `work_item_project_id_project_id_fk` is deliberately retained alongside the
new composite one, as the schema comment says; both hold, which is sound.

`workspace.organisation_id`'s `ON UPDATE CASCADE` is **not** an instance of the O1 hazard:
its referenced column is `organisation.id`, an immutable primary key, not a mutable non-PK
column. O1 is specifically about composite FKs whose referenced column set contains a
mutable column. The distinction is drawn correctly in the schema comment and is correct.

### 1.2 The PR #191 O1 attack, executed for real

Real rows inserted: two organisations, two workspaces (`wsA`/`wsB`), a project and a
`work_item_type` and a `state_template`/`state` in each, and a `work_item` in `wsA`. Every
attack shape was then run as raw SQL. All were rejected by the database:

| # | Attack | Result |
| --- | --- | --- |
| A | Insert `work_item` with matching `(wsA, pA, tA)` | **accepted** (control — the constraint is not merely rejecting everything) |
| B | `project` from `wsA` + `type` from `wsB`, `workspace_id = wsA` | rejected — `..._type_..._fk`, `Key (workspace_id, type_id)=(wsA, tB) is not present` |
| C | Same pair, `workspace_id = wsB` | rejected — `..._project_..._fk` |
| D | Truthful `project_id`/`type_id`, lying `workspace_id` | rejected — `..._project_..._fk` |
| E | **O1 shape 1:** `UPDATE work_item_type SET workspace_id = wsB` while referenced | rejected — `Key (workspace_id, id)=(wsA, tA) is still referenced from table "work_item"` |
| F | **O1 shape 2:** `UPDATE project SET workspace_id = wsB` while referenced | rejected — same shape |
| G | Both moves inside one transaction | rejected at the first statement; transaction rolled back |
| H | Both moves plus a direct `work_item` move, after `SET CONSTRAINTS ALL DEFERRED` | rejected — the constraints are `NOT DEFERRABLE`, so deferral is a no-op and the check still fires at statement end |
| I | Direct `UPDATE work_item SET workspace_id = wsB` | rejected — `..._project_..._fk` |
| K | `DELETE FROM work_item_type` while referenced | rejected — `violates RESTRICT setting` (pre-existing behaviour preserved) |
| L | `DELETE FROM project` | accepted, cascaded, `work_item` count 0 (pre-existing behaviour preserved) |

After E–I the work item was re-read and was still `(pA, wsA, tA)`; `project.workspace_id`
and `work_item_type.workspace_id` were both unchanged. No partial application anywhere.

**Conclusion: the O1 failure mode is genuinely closed for both new FKs, proven by
execution rather than by inspection.**

### 1.3 Cross-tenant write attempts at the application layer (adversarial, item 5)

The question asked was whether the composite FKs catch only the *specific* mismatches they
were designed for, or the general case. They catch the general case, and the reason is
structural: both FKs anchor on the *same* `work_item.workspace_id` column. FK1 forces
`project_id` to belong to that workspace; FK2 forces `type_id` to belong to that same
workspace. There is no assignment of the triple `(workspace_id, project_id, type_id)` that
satisfies both while the project and the type live in different workspaces — case B above
is exactly that attempt, and it is rejected. A caller cannot pick a `project_id` from
workspace A and a `type_id` from workspace B under any `workspace_id` value.

No application-layer path can influence these columns today in any case: there is no
`work_item` write path in this codebase (see §2). `create-workspace.ts` is the only
application code the PR changes that writes a tenant-attribution column, and it takes
`organisationId` from `ensureInternalOrganisation(tx)`, never from caller input — verified
by reading the controller; the create input type carries no organisation field.

A residual observation, not a defect: `state_id` and `parent_id` remain scoped to
`project_id` (PR #191's design), and `project_id` is now itself pinned to `workspace_id`, so
those are transitively workspace-scoped too. The chain is consistent.

---

## 2. The empty-`work_item` claim — VERIFIED

This was the claim most worth distrusting, and it holds.

- No `INSERT INTO work_item` exists in any of the 62 migration files. (`0055` inserts into
  `work_item_key_claim`, a different table.)
- No `.insert(workItemTable)` / `.insert(schema.workItemTable)` exists anywhere outside
  `tests/api-integration/**`. Enumerating every `.insert(` target across `apps/api/src`
  yields 25 distinct tables; `workItemTable` is not among them.
- The one live import path that looked dangerous — `apps/api/src/task/controllers/import-tasks.ts`,
  a real, reachable, kaneo-inherited route — writes `taskTable`, the legacy kaneo table, not
  `work_item`. Confirmed by reading its imports and its single `.insert(taskTable)` call.
- No deployed instance of this schema exists to hold data. The `taskdesk-uat-postgres-1`
  container on this host carries the **v1** application's schema (76 PascalCase tables,
  no `work_item`, no `drizzle.__drizzle_migrations`), not this codebase's.

`ALTER TABLE work_item ADD COLUMN workspace_id text NOT NULL` with no backfill is therefore
safe. If the claim were ever wrong on some instance, the failure mode is a loud migration
abort inside drizzle's single migration transaction, not silent data corruption.

---

## 3. The organisation backfill's concurrency safety — VERIFIED, with one clarification

The partial index the migration relies on is real and covers exactly this case
(`0052_hesitant_black_bolt.sql:87`):

```sql
CREATE UNIQUE INDEX "organisation_is_internal_unique" ON "organisation" ("is_internal")
  WHERE "organisation"."is_internal" = true;
```

At most one row can carry `is_internal = true`, ever. Consequences for the migration:

- **A silent duplicate row is impossible.** A concurrent replica whose `WHERE NOT EXISTS`
  also saw an empty table would fail the `INSERT` with `23505`, aborting its own migration
  transaction loudly. Loud, not silent.
- **A silent wrong backfill target is impossible.** The `UPDATE ... SET organisation_id =
  (SELECT id FROM organisation WHERE is_internal = true LIMIT 1)` cannot be ambiguous —
  the partial index guarantees the subquery matches at most one row. The `LIMIT 1` is
  defensive, not load-bearing.
- **A `NULL` backfill is impossible to leave behind.** If the subquery somehow returned no
  row, the following `ALTER COLUMN ... SET NOT NULL` fails and the whole migration rolls
  back.
- The literals the migration seeds (`'internal'`, `'Internal'`, `is_internal = true`) are
  byte-identical to `INTERNAL_ORGANISATION_KEY`/`INTERNAL_ORGANISATION_NAME` in
  `seed-internal-organisation.ts`, so the later boot-level seed finds the row rather than
  racing it. Verified by reading both.

**Clarification on the ordering argument.** The PR's reasoning — that migrations always run
to completion before the app's boot seed — was checked against `drizzle-orm@0.45.2`'s real
migrator (`pg-core/dialect.cjs`): it creates the migrations table, reads the last applied
migration, then runs **every** pending migration inside **one** `session.transaction(...)`.
So the reasoning is right, and the migration correctly does not assume a prior boot seeded
the organisation.

The same source shows the migrator takes **no advisory lock**. Two replicas migrating the
same database concurrently is therefore already unsafe in this codebase generally — the
second replica re-runs `ALTER TABLE ... ADD COLUMN` after the first commits and dies on
"column already exists". That is a pre-existing property of the migration mechanism, not
something #192 introduces or worsens, and it fails loudly and idempotently on restart.
Recorded as context for the concurrency question asked, not as a finding against this PR.

---

## 4. The SAVEPOINT claim — VERIFIED against the installed driver

`drizzle-orm@0.45.2`, `node-postgres/session.cjs`, `class NodePgTransaction`:

```js
async transaction(transaction) {
  const savepointName = `sp${this.nestedIndex + 1}`;
  const tx = new NodePgTransaction(this.dialect, this.session, this.schema, this.nestedIndex + 1);
  await tx.execute(sql.raw(`savepoint ${savepointName}`));
  try {
    const result = await transaction(tx);
    await tx.execute(sql.raw(`release savepoint ${savepointName}`));
    return result;
  } catch (err) {
    await tx.execute(sql.raw(`rollback to savepoint ${savepointName}`));
    throw err;
  }
}
```

The claim is exactly true: a nested `.transaction()` on an existing `tx` emits a real
`SAVEPOINT` / `RELEASE SAVEPOINT` / `ROLLBACK TO SAVEPOINT`, reusing `this.session` — the
same physical connection, which is what makes the savepoint apply to the enclosing
transaction. A unique violation inside it is rolled back to the savepoint and rethrown, so
`ensureInternalOrganisation`'s `catch` runs on a transaction that is no longer poisoned and
its re-read (a fresh statement snapshot under `READ COMMITTED`) sees the row the winner
committed. The outer workspace-create transaction cannot partially commit: it is still one
Postgres transaction, and the savepoint only ever *narrows* what is undone.

(Live end-to-end verification in §7.)

---

## 5. Findings

### F1 (non-blocking, test rigour) — the two `ON UPDATE NO ACTION` tests are mutation-insensitive

`tenant-attribution-schema.test.ts`'s third describe block names itself
"the two new composite FKs are ON UPDATE NO ACTION, never CASCADE" and asserts that
`UPDATE work_item_type SET workspace_id` and `UPDATE project SET workspace_id` are
rejected. Both assertions are true — but they would be **equally true against a schema
where both FKs were `ON UPDATE CASCADE`**, so they do not test the property they name.

Proven, not inferred. Rebuilding both FKs with `ON UPDATE CASCADE` on the live database and
replaying the attacks:

- `UPDATE work_item_type SET workspace_id='wsB'` → still **rejected**, this time by the
  *project* FK (`Key (workspace_id, project_id)=(wsB, pA2) is not present`).
- `UPDATE project SET workspace_id='wsB'` → still **rejected**, by the *type* FK.

The two FKs pin each other: a cascade through either one immediately violates the other.
Dropping the project FK — i.e. the original decision's literal text, before the addendum —
and leaving the type FK `ON UPDATE CASCADE` reproduces the O1 hole exactly:

```
UPDATE 1
 id  | project_id | workspace_id | type_id
-----+------------+--------------+---------
 wiM | pA2        | wsA -> wsB   | tA
```

The work item silently moved to `wsB` while its project stayed in `wsA`.

Two things follow. First, **the addendum FK is genuinely load-bearing**, not
belt-and-braces — Thomas's 2026-09-22 addendum decision is vindicated by direct
reproduction, and the security property is real. Second, the tests assert the *property*
(a work item cannot be dragged across a tenant boundary) rather than the *mechanism*
(`ON UPDATE NO ACTION`), while claiming the latter. This is the same shape as the #227/D2
finding. It is non-blocking because the property they do prove is the one that matters, and
because the mechanism is independently confirmed in `pg_constraint` (§1.1). A future
regression that flipped one FK to `CASCADE` would not be caught by these tests, only by the
other's presence.

*Suggested, not required:* assert the constraint name or SQLSTATE in the rejection (each
attack above names a specific constraint), or add a case where only one FK is in play.

### F2 (non-blocking, latent) — a constraint name is silently truncated by PostgreSQL

The migration writes:

```sql
ADD CONSTRAINT "work_item_workspace_id_type_id_work_item_type_workspace_id_id_fk"
```

That identifier is 64 bytes. PostgreSQL's `NAMEDATALEN` limit is 63, so it is silently
truncated on creation; the catalog holds
`work_item_workspace_id_type_id_work_item_type_workspace_id_id_f` (63 bytes, trailing `k`
lost). The constraint itself is entirely correct and enforcing — every rejection in §1.2
cites the truncated name — so there is **no security impact**.

The latent risk is a future migration: `apps/api/drizzle/meta/0062_snapshot.json` records
the untruncated 64-byte name, so a later drizzle-kit-generated `DROP CONSTRAINT
"...\_fk"` would fail with "constraint does not exist". No current migration or test
depends on the name. Recorded so it is not rediscovered as a mystery later. This is the
first name in the schema to cross 63 bytes (the next-longest, from PR #191, is 60).

### F3 (non-blocking, observation) — the project FK's `ON DELETE CASCADE` narrows a future choice

The new `(workspace_id, project_id)` FK is `ON DELETE CASCADE`, matching the retained
single-column `project_id` FK exactly. This is correct as argued in the schema comment —
`RESTRICT` would have blocked project deletion that the existing FK already permits, a real
behaviour regression — and §1.2 case L confirms project deletion still cascades. Noted only
because the decision-log addendum specifies the addendum FK's `ON UPDATE` but is silent on
its `ON DELETE`; the implementation chose the only non-regressing option. No action.

### F4 (non-blocking, comment accuracy) — a new comment in `fixtures.ts` states something untrue

`tests/api-integration/helpers/fixtures.ts` gains:

> `resetTestDatabase` re-establishes the internal organisation after every truncate, so
> this is a plain lookup in practice

`resetTestDatabase` (`tests/api-integration/helpers/database.ts`) does exactly two things:
`ensureTestDatabaseMigrated()`, then `TRUNCATE TABLE <every public table> RESTART IDENTITY
CASCADE`. It does **not** reseed anything. The `ensureInternalOrganisation()` call there is
a real create-on-first-use, not a lookup. No functional impact — the function is an
idempotent get-or-create either way, and all 595 integration tests pass — but the comment
would mislead a future reader into assuming an internal organisation is guaranteed present
after a reset, which is the kind of assumption this migration's own reasoning depends on
elsewhere. One-line comment correction; not worth a re-review round on its own.

---

## 6. Scope check — VERIFIED

`git diff origin/main..HEAD --stat` at the reviewed head: 16 files, +6206/−74. Nothing
outside the claimed surface:

- `apps/api/drizzle/0062_fast_blob.sql`, `meta/0062_snapshot.json`, `meta/_journal.json`
  (idx 62, tag `0062_fast_blob`, sequential, no renumbering of existing entries)
- `apps/api/src/database/schema.ts`
- `apps/api/src/utils/seed-internal-organisation.ts`, `apps/api/src/workspace/controllers/create-workspace.ts` — the two application files
- `docs/01-architecture/data-model.md` — required, not extra: `AGENTS.md` do-not 11 makes
  this the one authoritative home for table/column identifiers, and the new column and both
  new constraints are recorded there accurately
- nine test files, all under `tests/api-integration/**`

No `package.json`, no lockfile, no `pnpm-workspace.yaml`, no CI/gate machinery, no
`packages/permissions`, no route or policy file. The `create-workspace.ts` change adds no
authorization logic: `organisationId` comes from `ensureInternalOrganisation(tx)`, never
from caller input, and the create input type carries no organisation field.

`drizzle-kit check` reports "Everything's fine"; `drizzle-kit generate` emits no migration,
confirming `schema.ts` and the committed `0062` snapshot agree — there is no drift that
would surface as a surprise migration later.

The PR body's `## Gates` table cites **no waived gate** (every row is pass or n/a).

---

## 7. Tests — run, counts confirmed, and mutation-probed

Run by this reviewer on a private database (`opusrev192_test`), at the reviewed head:

| Suite | Result |
| --- | --- |
| unit (`vitest.config.ts`) | **323 passed** (48 files) |
| permissions (`vitest.permissions.config.ts`) | **80 passed** (10 files) |
| integration (`vitest.integration.config.ts`) | **595 passed** (65 files) |

All three counts match the claim exactly.

### The concurrency fix is load-bearing, and its test genuinely catches its absence

`workspace-write-create-contract.test.ts`'s A2-P4b fires 12 simultaneous workspace creates.
Because `resetTestDatabase` truncates `organisation` along with every other table, each run
starts with **no internal organisation**, so all 12 requests race to create it inside their
own transactions — the exact race the SAVEPOINT exists for. This is a non-vacuous probe.

Mutation-tested rather than taken on trust. Removing the nested `dbOrTx.transaction(...)`
from `ensureInternalOrganisation` (replacing it with a plain inline call, leaving everything
else identical) and re-running that one test:

```
AssertionError: expected [ 200, 200, 500, 500, 500, 500, …(6) ]
                to deeply equal [ 200, 200, 200, 200, 200, 200, …(6) ]
```

Ten of twelve concurrent creates become unhandled 500s — precisely the "handled race turned
into an unhandled 500" failure the PR body describes, caused by the aborted-transaction
poisoning that a `ROLLBACK TO SAVEPOINT` confines. Restored, the same test passes. The outer
transaction also completes correctly rather than partially: the test additionally asserts 12
workspaces with 12 distinct slugs, each with its full 3 roles and 1 team, so no inconsistent
half-created state survives.

The mutation was made and reverted inside this reviewer's own isolated detached worktree;
that worktree is clean at `0088189810d6c88e667c55dd08e7a015b8c39bcf`, and no file in the
repository was modified by this review except this note.

### Judgement on the new test file

`tests/api-integration/tenant-attribution-schema.test.ts` (399 lines, 11 tests) was read in
full. Most of it is genuine:

- The cross-tenant insert tests use **raw SQL**, deliberately bypassing Drizzle's typing, so
  they can send combinations the ORM would not — that is the right instinct, and it is what
  makes them real.
- Each rejection test is paired with a **positive control** ("permits a workspace_id that
  matches…", "permits a type_id belonging to the SAME workspace"), so a constraint that
  rejected everything would be caught. This is the specific defence against the #227/D2
  shape, and it is present.
- The `ON DELETE RESTRICT`, NOT NULL, dangling-FK and backfill-idempotence tests all assert
  something real; the idempotence test checks the resulting count is `"1"`, not merely that
  the statement did not throw.

The one genuine weakness is F1 above: the `rejects.toThrow()` assertions are untyped, so the
two tests that name `ON UPDATE NO ACTION` pass for a different reason than the one they
claim. The property is nonetheless proven — by the other FK, and by §1.1's catalog read.

---

## 8. What this review did not do

- It did not merge this pull request, edit the PR body, touch `## Gates`, or waive anything.
- It did not re-review the two prior Sonnet rounds' own reasoning as reasoning; every claim
  was re-derived from source, live SQL, or the installed driver instead.
- It did not review `#23`'s future write path, which does not exist. The obligation that
  path inherits — set `work_item.workspace_id` from `project.workspace_id` on every insert —
  is recorded in the decision log's Consequences and fails closed (`NOT NULL`) if forgotten.
- It did not exercise RLS, which this change makes *writable* but does not deliver.
- It did not test a multi-replica concurrent migration end to end. §3 establishes from the
  migrator's source that this is a pre-existing property of the mechanism, unchanged by this
  PR, and that the specific failure mode asked about (silent duplicate / silent wrong
  backfill target) is impossible here.

---

## 9. Verdict

**CLEAR WITH FINDINGS (non-blocking).**

The change does what it claims, and the claim is the right one. The authority boundary is
enforced by the database, proven by executing the PR #191 O1 attack and six other shapes
against real rows rather than by reading DDL. The `ON UPDATE NO ACTION` choice is present on
both new composite FKs and verified in `pg_constraint`. The decision-log addendum's third FK
is not decorative: removing it and flipping the remaining FK to `CASCADE` reproduces the O1
cross-tenant move in one statement, which this review demonstrated directly. The
empty-`work_item` claim — the one most worth distrusting — survives an exhaustive search of
migrations, application source, routes and the only live database on this host. The
SAVEPOINT claim is true of the installed driver's actual source and is load-bearing in
practice, shown by mutation. Scope is exactly what was claimed, with no dependency-graph,
CI-machinery or permissions surface touched, and no gate waived.

F1, F2 and F4 are recorded for the record and for whoever next touches this schema. None of
them weakens the boundary; none needs to close before merge. F1 in particular should be read
as "these two tests prove the right property for the wrong reason", not as "the property is
unproven" — §1.1 and §1.2 prove it independently.

**Cleared at `0088189810d6c88e667c55dd08e7a015b8c39bcf`.** Any rebase, conflict resolution,
`main`-merge or further commit invalidates this clearance and requires the reviewer's own
re-confirmation — not a diff-stat performed by the implementing or orchestrating session
(PR #191's note records why that distinction is enforced).

---

# Delta re-confirmation — 2026-09-22 (after the `main` sync)

**Reviewed head:** `503c32c510f43b8dadf11f58b7a78681c26c2b37`

**Reviewer:** independent Opus pass, fresh context — did not author, orchestrate or
previously review this change, and did not perform the review above. Dispatched because §9's
clearance is scoped to `0088189810d6c88e667c55dd08e7a015b8c39bcf` and explicitly refuses a
diff-stat performed by the implementing or orchestrating session.

**Scope.** This is a narrow delta confirmation of one claim — *the `main` sync is
content-inert to everything the review above examined* — not a re-derivation of the eleven
attack shapes. Those are not re-run; they do not need to be if, and only if, the reviewed
material is genuinely byte-identical. That is what was checked, and checked in a way that
cannot miss a file.

## What changed since `0088189`, established independently

Isolated detached worktree at `503c32c5…`, created fresh from a re-fetched `origin` — not
`main`, not the implementation worktree.

- **Ancestry.** `git merge-base --is-ancestor` confirms both
  `0088189810d6c88e667c55dd08e7a015b8c39bcf` (the reviewed implementation commit) and
  `353e5c94d536ea4b0379b21b9c6b5cccf0f235db` (the note-only commit that added this file) are
  real ancestors of the current head. Nothing was rebased away or replayed.
- **Shape of the head.** `503c32c5…` is a true merge commit with parents `353e5c9`
  (the branch) and `f84df0e` (PR #238). `f84df0e` is byte-for-byte `origin/main` at the time
  of the sync — verified by resolving both refs, not by reading the PR.
- **No hand edits in the merge.** `git show --cc` on the merge commit produces an **empty**
  body. A combined diff shows only hunks that differ from *every* parent, so an empty one is
  proof that no conflict was resolved and no line was authored during the merge — every file
  came through untouched from one side or the other.
- **Whole-tree object comparison, not a file list.** Every top-level tree object was compared
  by hash between `0088189` and the current head. All twenty-nine entries are identical
  except `docs` — including `apps`, `packages`, `scripts`, `tests`, `package.json`,
  `pnpm-lock.yaml` and `pnpm-workspace.yaml`. Because a Git tree hash covers its entire
  subtree transitively, this establishes that *no file anywhere outside `docs/` changed*,
  which is strictly stronger than enumerating the files the review happened to name.
  `git diff 0088189..HEAD -- . ':(exclude)docs'` is correspondingly empty (zero lines).
- **The specific artefacts, by blob hash.** Confirmed identical individually as well:
  `apps/api/src/database/schema.ts` (`c0d2ddb1…`), `apps/api/drizzle/0062_fast_blob.sql`
  (`eab4e07e…`), `apps/api/drizzle/meta/0062_snapshot.json`,
  `apps/api/drizzle/meta/_journal.json`, `apps/api/src/utils/seed-internal-organisation.ts`
  and `apps/api/src/workspace/controllers/create-workspace.ts`. (Note for the record: the two
  latter files live at those paths, not under `apps/api/src/database/` as the dispatch
  described; the tree-hash comparison above covers them either way.) Every test file the PR
  touches — `tests/api-integration/tenant-attribution-schema.test.ts`,
  `work-item-integrity-constraints.test.ts`, `work-item-parent-cycle-guard.test.ts`,
  `work-item-schema.test.ts`, `work-item-schema-integrity.test.ts`,
  `organization-active-session.test.ts`, `project-delete.test.ts`, `helpers/fixtures.ts`,
  `helpers/database.test.ts` — is inside the identical `tests` tree object.
- **The three files that do differ.**
  `docs/07-planning/security-reviews/192-work-item-tenant-attribution.md` is this file,
  added by the note-only commit `353e5c9` and **unchanged by the merge** (empty diff against
  `353e5c9`). `docs/07-planning/decision-log.md` (+33 / −0, purely additive) and
  `docs/07-planning/status.md` (+70 / −17 — a snapshot-header rewrite that moves the
  superseded #18 narrative into an "Earlier the same day" section, not a content deletion)
  both arrived from PR #238 and are **identical to their state on `main`** (empty diff
  against `f84df0e`). Both are planning prose. Neither touches schema, migration, code,
  tests, CI machinery, the dependency graph, permissions, or gate semantics.

## Regression run at the current head

Fresh private database `opusrev192b_test` on `td-lane-pg` (`127.0.0.1:55440`), created for
this pass and used by nothing else. All 62 migrations applied by the real
`drizzle-kit migrate`. Dependencies installed in the isolated worktree from the frozen
lockfile.

| Suite | Result |
| --- | --- |
| `drizzle-kit check` | clean — no drift ("Everything's fine") |
| Unit (`pnpm test`) | **`@taskdesk/api` 323/323** (48 files); 11/11 workspace tasks green — domain 337, permissions pkg 260, web 236, mcp 30, email 16, libs 3, ui 1 |
| Permissions (`pnpm test:permissions`) | **80/80** (10 files), 4/4 tasks |
| Integration (`pnpm test:integration`) | **595/595** (65 files), 4/4 tasks |

All three headline counts match the expected 323 / 80 / 595 exactly. Nothing regressed from
the merge.

## One observation, non-blocking and not about this change

`status.md` as merged by #238 still says #192 is "still not pushed/PR'd" and that the Opus
pass is "not yet dispatched as of this snapshot." That was true when written and is stale
now. It is a planning-document lag on `main`, not a defect in this PR, and it does not
assert that #192 is cleared — so it misleads nobody into treating an ungated change as
gated. Worth a line in the next `status.md` refresh; it blocks nothing here.

## What this pass did not do

- It did not re-run the eleven live-SQL attack shapes, re-read the schema, or re-derive any
  finding from §§1–7. That is deliberate and is licensed only by the byte-identity
  established above; if any part of that identity were false, this section would not stand.
- It did not re-examine findings F1, F2 and F4. They are unchanged and still non-blocking.
- It did not merge this pull request, edit the PR body, touch `## Gates`, or waive anything.
- It did not verify branch-protection state, required status checks, or the recorded reviews
  on the PR. Those are the merging session's own checks, and this note does not substitute
  for them.

## Verdict

**CLEAR — the clearance above extends to `503c32c510f43b8dadf11f58b7a78681c26c2b37`.**

The sync is genuinely content-inert to the reviewed material. Every file outside `docs/` is
byte-identical to `0088189810d6c88e667c55dd08e7a015b8c39bcf` by whole-tree hash, the merge
introduced no authored line at all, and the only content difference is planning prose that
arrived unmodified from `main`. The migration, its snapshot and journal, the schema, both
touched application files and every test file are the exact objects that were reviewed. The
automated suites re-run at this head at their expected counts, and `drizzle-kit check`
reports no drift.

**Cleared at `503c32c510f43b8dadf11f58b7a78681c26c2b37`.** The original condition carries
forward unchanged: any further rebase, conflict resolution, `main`-merge or commit
invalidates this and requires a reviewer's own re-confirmation, not a diff-stat by the
implementing or orchestrating session.

The one exemption, on the same footing as `353e5c9` before it: the note-only commit that
adds *this section* to *this file* changes no code and does not invalidate the clearance it
records. Any commit that touches anything else does.

---

# Second delta re-confirmation — 2026-09-22 (after the second `main` sync)

**Reviewed head:** `4d1365a2e4d4dc2f9720297c596922e52418e790`

**Previous reviewed head:** `503c32c510f43b8dadf11f58b7a78681c26c2b37`

**Reviewer:** independent Opus pass, fresh context — did not author, orchestrate or
implement this change. Dispatched to extend the clearance across a second `main` sync.

**The `main` sync was performed by this reviewer**, in an isolated detached worktree created
from a re-fetched `origin`, using `git merge` (not rebase, which would orphan the
`**Reviewed head:**` citations above). The merge is `4d1365a2…`, parents `b0077301…` (the
branch) and `113f6d6163…` (`origin/main`, resolved by ref, not read from a PR page).

## Correction to the dispatch's premise — this sync is NOT docs-only

The dispatch stated that `main` had advanced by exactly one merge, PR #243, touching only
`docs/07-planning/status.md`, with "zero overlap with anything you verified." **That is not
what the repository contains, and this section does not rest on it.**

`main` advanced by **two** merges since `f84df0e` (the point the previous sync reached):

- `cfd850a` — PR #237, `ci: add check:dockerfile-deps to catch Dockerfile/workspace drift (#170)`
- `113f6d6` — PR #243, the `status.md` snapshot reconciliation the dispatch described

PR #237 was not in the branch before this merge. It changes **five non-`docs/` files**, all
of them inside `ci-cd.md`'s security-review path list:

| Path | Change |
| --- | --- |
| `scripts/ci/check-dockerfile-deps.mjs` | new, 388 lines — a CI gate |
| `scripts/ci/check-dockerfile-deps.test.mjs` | new, 395 lines |
| `scripts/ci/test-all.mjs` | +9 — registers the gate in the manifest |
| `package.json` | +1 — the `check:dockerfile-deps` script |
| `.github/workflows/ci-fast.yml` | +6 — runs the gate in the `registers` job |

So the previous section's licensing condition — *every file outside `docs/` is byte-identical* —
**is false at this head**, and the clearance above therefore does **not** extend forward on
that reasoning. It is re-derived below on the delta that actually exists.

## What was established independently

Whole-tree object comparison by hash, as before, plus a targeted read of the five files.

- **Ancestry.** `0088189810…`, `353e5c94…`, `503c32c5…` and `b0077301…` are all still real
  ancestors of `4d1365a2…`. Nothing was rebased away or replayed; every earlier
  `**Reviewed head:**` citation in this file still resolves.
- **No authored line in the merge.** `git show --cc` on `4d1365a2…` produces an **empty**
  body — no conflict was resolved and no line was written during the merge. Every file came
  through untouched from one side or the other.
- **#192's entire reviewed surface is byte-identical.** `git diff 0088189 HEAD` restricted to
  `apps`, `packages`, `tests`, `Dockerfile`, `pnpm-lock.yaml` and `pnpm-workspace.yaml` is
  **empty (zero lines)**. By whole-tree hash, `apps` (`90d28dea…`), `packages` (`48f22a1b…`),
  `tests` (`76307f01…`), `pnpm-lock.yaml` (`c5366af4…`), `pnpm-workspace.yaml` (`92ccfc48…`)
  and `Dockerfile` (`19819660…`) are the **same objects** reviewed at `0088189`. That covers
  the migration `0062_fast_blob.sql`, its snapshot and journal, `schema.ts`,
  `seed-internal-organisation.ts`, `create-workspace.ts` and every touched test file. None of
  §§1–7's material moved.
- **The CI delta is `main`'s, unmodified.** `git diff HEAD origin/main` restricted to
  `.github`, `scripts` and `package.json` is **empty** — the branch carries PR #237's
  machinery exactly as it exists on `main`, with nothing added or adapted in the merge.
- **#237 was independently gated.** Its own security-review note,
  `docs/07-planning/security-reviews/170-dockerfile-deps-drift-check.md` (802 lines, four
  reviewed heads, one `CHANGES NEEDED` round before clearance), arrived with the merge. This
  pass does **not** re-review #237 and does not need to; it is already on `main` through its
  own gates.

## Why the CI delta does not disturb this clearance

Re-derived, not assumed:

- It is **additive**. One new gate, its tests, its script entry, its workflow step and its
  manifest row. No existing gate was modified, reordered, weakened or removed.
- It **changes no gate semantics for #192**. The gate reads `Dockerfile` and
  `pnpm-workspace.yaml` and asserts the `deps` stage's COPY list matches the discovered
  workspace members. #192 touches **neither file** — confirmed: the branch's `Dockerfile` and
  `pnpm-workspace.yaml` blobs are identical to `main`'s and to `0088189`'s. The gate's inputs
  and #192's change set are disjoint.
- It **touches no authority surface** — no permission, policy, route, migration, schema or
  identity code. It is build-image drift detection.
- **The new gate passes on this exact head.** Run here: `check:dockerfile-deps: 9 workspace
  package manifest(s) match the deps stage COPY list.` (exit 0), and its own suite
  `node --test scripts/ci/check-dockerfile-deps.test.mjs` is **22/22, 9 suites, 0 failures**.
  So the merge does not introduce a red gate into this PR.

## Regression run at the current head

Fresh private database `opusrev192c_test` on `td-lane-pg` (`127.0.0.1:55440`), created for
this pass and used by nothing else. Isolated worktree, dependencies installed from the frozen
lockfile.

| Suite | Result |
| --- | --- |
| `drizzle-kit check` | clean — "Everything's fine" |
| Unit (`vitest run --config vitest.config.ts`) | **323/323** (48 files) |
| Permissions (`vitest run --config vitest.permissions.config.ts`) | **80/80** (10 files) |
| Integration (`vitest run --config vitest.integration.config.ts`) | **595/595** (65 files) |
| `check:dockerfile-deps` (new this sync) | pass, 9 manifests matched |
| `check-dockerfile-deps.test.mjs` (new this sync) | 22/22 |

All three headline counts match the expected 323 / 80 / 595 exactly.

**Operational note for whoever runs these next.** The first attempt reported 287/323 unit and
two failed permissions files. That was **not** a regression: a fresh worktree has no built
`packages/*/dist`, so `@taskdesk/email` and `@taskdesk/permissions` fail to resolve.
`pnpm --filter @taskdesk/email --filter @taskdesk/permissions --filter @taskdesk/domain build`
before the suites, and the counts are exact. Recorded so a future pass does not mistake it
for a defect in this PR.

## What this pass did not do

- It did not re-run the eleven live-SQL attack shapes or re-derive §§1–7. That is licensed by
  the byte-identity of `apps`, `packages` and `tests` established above — which *is* true at
  this head, even though the broader "nothing outside `docs/`" claim is not.
- It did not re-review PR #237. That change is on `main` under its own review note and its
  own gates; this pass only established that it is inert with respect to #192.
- It did not re-examine findings F1, F2, F3 and F4. They are unchanged and still non-blocking.
- It did not merge this pull request, edit the PR body, touch `## Gates`, or waive anything.
- It did not verify branch-protection state, required status checks, or the recorded reviews
  on the PR. Those are the merging session's own checks.

## Verdict

**CLEAR — the clearance extends to `4d1365a2e4d4dc2f9720297c596922e52418e790`.**

The sync is not content-inert as the dispatch claimed, but it is **inert with respect to
#192**. Every artefact this review examined is byte-identical to `0088189810…` by whole-tree
hash; the merge authored no line; the one real code delta is PR #237's additive CI gate,
carried unmodified from `main`, already gated under its own review, disjoint from #192's
inputs, and green on this head. The suites re-run at their expected counts and
`drizzle-kit check` reports no drift.

**Cleared at `4d1365a2e4d4dc2f9720297c596922e52418e790`.** The original condition carries
forward unchanged: any further rebase, conflict resolution, `main`-merge or commit
invalidates this and requires a reviewer's own re-confirmation, **not** a diff-stat by the
implementing or orchestrating session — and, as this pass shows, not a description of the
delta supplied with the dispatch either. The delta must be established from the repository.

The one exemption, on the same footing as `353e5c9` and `b007730` before it: the note-only
commit that adds *this section* to *this file* changes no code and does not invalidate the
clearance it records. Any commit that touches anything else does.
