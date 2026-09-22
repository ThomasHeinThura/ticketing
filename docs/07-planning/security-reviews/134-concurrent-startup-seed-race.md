# Pre-merge security review — PR #250 (concurrent-startup seed race, issue #134)

**Reviewed head:** `8fc40d53855f81d3d2b90656315573bf20592e61`

**Reviewer:** Opus 5, fresh independent review-only context. Authored no part of this
change, directed none of it, and remediated none of it. Reviewed in its own isolated
worktree checked out at the exact head above, not against `main`.

**VERDICT: CLEAR WITH FINDINGS (non-blocking).** Both fixes genuinely close the races they
claim to close — verified empirically against a live PostgreSQL 18.6, not by reading the
diff alone. Five findings, all LOW or informational, none blocking, none a weakening of an
existing control. Nothing here should hold the merge.

**Status of the gate:** this review ran before merge and is complete. The gate is closed
for `8fc40d5` — **and for that head only.** Any later content commit voids it and requires
a fresh delta review. The commit that adds this note is docs-only: it touches no reviewed
source file and leaves the reviewed code tree byte-identical, so the clearance above stands
for the code that would merge.

---

## What was verified, and how

Every claim in the PR body was re-derived from the actual source, the actual migration SQL,
the actual drizzle driver code, and a live database. Nothing below is taken on the PR's
word.

### 1. Scope is exactly what is claimed

`git diff origin/main...8fc40d5 --name-only` returns exactly three paths:

- `apps/api/src/migrations/column-migration.ts`
- `apps/api/src/utils/seed-default-workspace-roles.ts`
- `tests/api-integration/concurrent-startup-seed-race.test.ts` (new)

`apps/api/src/utils/seed-internal-organisation.ts` is **genuinely untouched** by this diff.
The "already hardened, left alone" claim is honest, and I confirmed it is also *correct*
rather than merely honest — see §5.

### 2. `onConflictDoNothing`'s target matches the real constraint

The PR claims `[workspaceId, role]` matches `workspace_role_workspace_id_role_unique`. This
was checked three ways rather than trusted:

- **Migration source** — `apps/api/drizzle/0051_workspace_role_unique.sql` ends with
  `ALTER TABLE "workspace_role" ADD CONSTRAINT "workspace_role_workspace_id_role_unique"
  UNIQUE ("workspace_id", "role");`. Column order matches.
- **Live database**, after applying every migration to a fresh private database:
  `"workspace_role_workspace_id_role_unique" UNIQUE CONSTRAINT, btree (workspace_id, role)`.
- **Generated SQL**, via `.toSQL()` on the actual drizzle builder in this PR:
  `... on conflict ("workspace_id","role") do nothing`.

The arbiter resolves. A duplicate insert is silently skipped rather than raising `23505`;
confirmed directly against the live server (second insert of the same pair leaves one row).

### 3. The advisory lock is inside the transaction, and really does auto-release

This is the class of claim this project has been burned by before, so the driver was read
rather than assumed. `drizzle-orm@0.45.2`'s `node-postgres/session.cjs` `transaction()`:

```js
const session = isPool ? new NodePgSession(await this.client.connect(), ...) : this;
const tx = new NodePgTransaction(this.dialect, session, this.schema);
await tx.execute(sql`begin${config ? ... : void 0}`);
try   { const result = await transaction(tx); await tx.execute(sql`commit`); return result; }
catch { await tx.execute(sql`rollback`); throw error; }
finally { if (isPool) session.client.release(); }
```

Three things follow, all load-bearing and all confirmed:

- **One dedicated client for the whole transaction.** `client.connect()` checks a single
  client out of the pool and every statement in the callback runs on it. The lock and the
  check-then-insert are therefore on the same backend session — not merely in the same
  logical transaction. Had drizzle round-robined statements across pooled connections, the
  lock would have been taken on a stray session and held until that session ended; it does
  not.
- **`begin` carries no isolation config** here (`migrateColumns` passes none), so the
  transaction runs at the session default. The live server reports
  `default_transaction_isolation = read committed`. This matters more than it looks: under
  `READ COMMITTED` each statement takes a fresh snapshot, so the *losing* replica's
  `SELECT` — issued after it finally acquires the lock — sees the winner's committed rows
  and correctly skips. Under `REPEATABLE READ` the snapshot would have been fixed at the
  lock-acquiring statement and the loser would have re-inserted. The fix is correct for
  this deployment's actual isolation level; it would be silently wrong if that default were
  ever changed.
- **The lock is acquired as the first statement inside the callback**, before the `SELECT`,
  and there is no code path through the callback that skips it.

Auto-release was then confirmed empirically rather than assumed from the Postgres manual:
after `COMMIT`, and separately after `ROLLBACK`, `pg_locks` where `locktype='advisory' AND
classid=4004` returns **0** rows. A 16-way concurrent burst of `migrateColumns()` across
three projects also leaves **0** advisory locks held afterwards — no leak.

### 4. Namespace collision — checked exhaustively, none found

I grepped the entire repository (`pg_advisory_lock`, `pg_advisory_xact_lock`,
`pg_try_advisory_lock`, and every `*_LOCK_NAMESPACE` constant) rather than trusting the
PR's list. Every advisory-lock call site in the codebase:

| Namespace | Declared in | Used by |
| --- | --- | --- |
| `1524` | inline literal | `create-project.ts`, `reorder-projects.ts` |
| `2026` | inline literal | `auth.ts` admin promotion (single-arg form) |
| `4_002` | `workspace-membership-lock.ts` | 8 membership-mutating controllers + `accept-invitation.ts` |
| `4_003` | `workspace-role-lock.ts` | `create-`/`update-`/`delete-workspace-role.ts` |
| **`4_004`** | **`column-migration.ts` (new)** | **`migrateColumns` only** |

`4_004` is genuinely unused elsewhere. The only other `pg_advisory_xact_lock` mention is a
prose reference in `packages/domain/src/audit/audit.ts` describing work the impure edge
does — not a call site, and it declares no namespace.

Confirmed at runtime as well: holding `(4004, hashtext('X'))` leaves
`pg_try_advisory_xact_lock` on `(1524|2026|4002|4003, hashtext('X'))` all returning `true`.
No cross-namespace interference.

### 5. `seed-internal-organisation.ts` really is already hardened

Read directly rather than accepting the claim. Both functions are safe:

- `ensureInternalOrganisation` wraps its insert in a nested `dbOrTx.transaction(...)`
  (a real transaction on plain `db`, a SAVEPOINT when handed a `tx`) and falls back to a
  re-read on `isUniqueViolation`. The SAVEPOINT is what keeps an enclosing transaction
  healthy after the failed insert.
- `seedInternalOrganisationAndStaffPersons` carries
  `onConflictDoNothing({ target: [userId], where: sql\`user_id is not null\` })`, which
  matches the live partial index exactly:
  `"person_user_unique" UNIQUE, btree (user_id) WHERE user_id IS NOT NULL`. Postgres only
  accepts a partial index as an arbiter when the predicate matches; it does.

Leaving this file untouched was the right call. See finding **L-2** for the one thing about
it that is now misleading.

### 6. `column` has no constraint the PR could have targeted instead

Verified rather than trusted, since a usable constraint would have made the lock the less
idiomatic choice. `column` is created once, in `0012_mixed_thor_girl.sql`; the only later
`ALTER TABLE "column"` in the whole migration history adds the project FK. The live table
carries exactly:

```
"column_pkey"          PRIMARY KEY, btree (id)
"column_projectId_idx" btree (project_id)          <- NOT unique
```

No unique or exclusion constraint on `(project_id, slug)` or anything else. `schema.ts`
agrees (`(table) => [index("column_projectId_idx").on(table.projectId)]`). **The advisory
lock was the correct choice; there was no constraint to target.** The PR's stated reason
for not simply adding one — `create-column.ts` enforces slug uniqueness in application code
with a 409, not in the database, so existing deployments cannot be assumed free of
duplicates without a dedup migration — is sound and correctly scoped out.

### 7. The race was reproduced, and the fix defeats it

The new test file was read, then the fix was attacked directly.

**The regression test is genuinely load-bearing.** I reverted *only* the two source files to
their `origin/main` versions, kept the new test, and ran it:

```
× seedDefaultWorkspaceRoles ... AssertionError: expected 'rejected' to be 'fulfilled'
× migrateColumns          ... AssertionError: expected [...(43)] to have a length of 4 but got 44
Tests  2 failed | 2 passed (4)
```

Both race tests fail without the fix and pass with it. Note the second one: pre-fix,
`migrateColumns` under concurrency does not merely crash — it produced **44 columns instead
of 4**, silent duplicate-row corruption on a legacy project. The advisory lock is closing a
data-integrity hole, not only an availability one. (The two "second boot" tests pass either
way, as they should — they guard idempotence, not the race.)

**An independent control** confirms the underlying race is real and not an artifact of the
test's shape: a hand-written pre-fix check-then-insert against `workspace_role`, fired 12
ways concurrently, produced **11 rejections, every one SQLSTATE `23505`** — precisely the
unique violation that reaches `runStartupTasks`'s catch and `process.exit(1)`.

**Adversarial variants I tried, all of which the fix survives:**

- *Do unrelated projects needlessly serialize?* **No.** Holding `(4004, hashtext('projectA'))`
  on one session, `pg_try_advisory_xact_lock(4004, hashtext('projectB'))` on another returns
  `true` while `(4004, hashtext('projectA'))` returns `false`. The key is genuinely
  per-project: same project is mutually exclusive, different projects proceed in parallel.
  16 concurrent `migrateColumns()` across 3 projects produced exactly 12 columns.
- *A third replica joining mid-race.* An 8-way race followed by a second 4-way wave after it
  settled: every call fulfilled, exactly 4 columns and 3 role rows. Late joiners no-op.
- *Connection-pool starvation deadlock.* The pool is `max: 10` while the tests fire 12–16
  concurrent calls, so a transaction can block on the lock while holding a pooled client.
  This cannot deadlock: the lock holder is by construction one of the checked-out clients
  and never needs a second connection while holding, so it always makes progress and
  releases. Confirmed empirically — the 16-way burst completed in 141ms.
- *Lock ordering.* `migrateColumns` holds at most one advisory lock at a time (one
  transaction per project, sequentially), so no lock-ordering deadlock is reachable.
- *The post-transaction task-update loop* runs unlocked, but is convergent: the losing
  replica built its map from the winner's committed rows, so both write identical
  `column_id` values, each `UPDATE` is its own implicit transaction, and the
  `IS DISTINCT FROM` guard makes the second a no-op.

### 8. Ordinary second boot still works

Covered by the PR's own two sequential tests and confirmed in the full run: calling each
function twice in a row against a database where the rows already exist resolves cleanly
both times, with no duplicate rows.

### 9. Test suite — counts confirmed independently

Run in my own isolated worktree against a fresh private database
(`td_sec250_test` on `td-lane-pg`), migrations applied via `drizzle-kit migrate`:

| Suite | Reported | Observed |
| --- | --- | --- |
| unit | 334 | **334 passed (49 files)** |
| permissions | 80 | **80 passed (10 files)** |
| integration | 599 | **599 passed (66 files)** |

All three match exactly. (An initial unit run showed 4 failures and 5 unresolved files;
that was my own environment — the workspace packages had not been built. After
`pnpm --filter "./packages/*" build`, 334/334. Not a defect in this PR.)

---

## Findings

None blocking. All are LOW or informational.

### L-1 (LOW) — the constraint this fix now depends on is invisible to drizzle's own model

`onConflictDoNothing` makes boot-time behavior depend on
`workspace_role_workspace_id_role_unique` existing. That constraint exists **only** in the
hand-written SQL of migration `0051` and in the live database. It is *not* declared in
`schema.ts` (`workspaceRoleTable`'s extras are just `index("workspace_role_role_idx")`), and
the current drizzle snapshot `drizzle/meta/0063_snapshot.json` records
`"uniqueConstraints": {}` for the table.

If that constraint were ever lost, the insert raises SQLSTATE `42P10` — confirmed live:
`ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` —
inside `runStartupTasks`, whose catch calls `process.exit(1)`. That is the exact crash mode
#134 exists to remove, re-entered through a different door.

**Why this is LOW and not blocking:** two independent things already guard it.
`drizzle-kit generate` against this head reports *"No schema changes, nothing to migrate"*,
so there is no pending drift and no regenerated migration wanting to drop it (schema.ts and
the snapshot agree with each other, they simply both omit it). And
`tests/api-integration/workspace-role-uniqueness.test.ts` asserts the constraint's existence
directly via `pg_constraint`, so its loss would fail CI.

**Suggested hardening, not required for this merge:** declare it in `schema.ts` —
`unique("workspace_role_workspace_id_role_unique").on(table.workspaceId, table.role)` — so
drizzle's model matches the database and the dependency is visible where a reader looks.
Worth its own small PR; it is not this PR's job.

### L-2 (LOW) — a now doubly-stale doc comment in `seed-internal-organisation.ts`

Lines 120–126 of `seedInternalOrganisationAndStaffPersons`'s doc comment read:

> following this codebase's existing check-then-insert seed convention
> (`seed-default-workspace-roles.ts`). Not proof against every concurrent-boot race — the
> same accepted limitation as that precedent

Both halves are now wrong. The code immediately below that comment *does* carry
`onConflictDoNothing` against `person_user_unique` (added in #192), so it **is** proof
against that race. And the "precedent" it cites for the supposed limitation,
`seed-default-workspace-roles.ts`, is exactly the file this PR just hardened.

This is documentation drift, not a defect, and the PR was right not to widen its diff to
touch a file it otherwise leaves alone. But this is precisely the kind of stale comment that
misleads a future session into re-opening a closed question or, worse, into believing a
hardened path is still soft. Worth a one-line follow-up.

### L-3 (LOW, pre-existing, not worsened) — the lock is only honored by `migrateColumns`

Advisory locks are cooperative. `create-column.ts` inserts into `column` without taking
namespace `4_004`, and there is no database constraint to catch it. So a user creating a
column through the API during a replica's boot-time seed of that same legacy zero-column
project can still land a duplicate slug or a fifth column.

The window is very narrow (boot-time only, and only for a legacy project with zero columns),
it is entirely pre-existing, and this PR does not widen it — it closes the replica-vs-replica
case, which is the one #134 is about. The durable fix is the `UNIQUE (project_id, slug)`
index plus a dedup migration that the PR explicitly and correctly scopes out. Noting it so
the residual is on the record rather than assumed closed.

### L-4 (INFORMATIONAL) — the success log now overstates what happened

`seedDefaultWorkspaceRoles` still logs `✅ Seeded ${rows.length} default workspace role
row(s)` unconditionally. With `onConflictDoNothing` in place, `rows.length` is now the
number of rows *attempted*, and in the losing half of a race every one of them is silently
skipped. Boot logs will claim a seed that did not happen. Cosmetic, but it is the one place
an operator would look to understand a concurrent boot.

### L-5 (INFORMATIONAL) — `hashtext` collisions over-serialize, harmlessly

`hashtext` returns `int4`, so two distinct project ids can collide and serialize
unnecessarily. This is correctness-preserving — over-serialization only, never
under-serialization — costs nothing at boot-seed volumes, and matches what every other
advisory-lock call site in this codebase already does. No action.

---

## What I did not do

- I did not review `apps/web/**` — no frontend file is touched by this diff.
- I did not run `biome check` or `tsc --noEmit`; CI's `unit + component`, `build` and
  `registers` checks are green on this head and cover them.
- I did not attempt a genuine multi-process, multi-container replica boot. The races were
  reproduced in-process with 12–16 concurrent calls against one live database, which
  exercises the same database-level interleaving the fix targets, and the pre-fix control
  run confirms the interleaving is real rather than simulated.
- I did not evaluate whether `column` *should* gain a `UNIQUE (project_id, slug)` index and
  a dedup migration. The PR scopes that out deliberately and I agree with the scoping; it
  belongs to its own issue.

---

## Verdict

**CLEAR WITH FINDINGS (non-blocking) at `8fc40d53855f81d3d2b90656315573bf20592e61`.**

Both fixes are correct, use the primitive the codebase already uses for this exact problem,
and are backed by a regression test that genuinely fails without them. The advisory lock is
acquired inside the transaction that does the check-then-insert, on a single dedicated
session, at an isolation level where the losing replica correctly observes the winner's
rows, and releases automatically on both commit and rollback. The `onConflictDoNothing`
target matches a real constraint in the real database. The new namespace collides with
nothing. Scope is exactly the three files claimed.

The five findings are all LOW or informational and none of them should delay this merge.
**L-1** is the one worth a follow-up issue: this change quietly takes a runtime dependency on
a constraint that drizzle's own schema model does not know exists, and the failure mode if
it is ever lost is the same `process.exit(1)` this PR set out to remove.
