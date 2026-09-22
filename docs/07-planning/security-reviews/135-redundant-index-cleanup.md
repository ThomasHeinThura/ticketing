# Security review — PR #246, issue #135: drop redundant `workspace_role_workspaceId_idx`

**Reviewed head:** `b92c1cbec509e30535eea3047cd3cee81948e4f9`

**Reviewer:** Claude Opus 5, independent fresh context, spawned as its own subagent. Did not
author, direct, or remediate any part of this change.

**Why this review is required:** `apps/api/drizzle/**` and `apps/api/src/database/**` are in
the security-review path list in `docs/04-engineering/ci-cd.md`.

**Method:** reviewed in an isolated detached worktree at the exact head SHA above, never on
`main`. Fresh private database `opus246sec_test` on `td-lane-pg` (`127.0.0.1:55440`,
PostgreSQL 18.6), created for this review and used by nothing else.

**Verdict: CLEAR.**

---

## 1. Scope — exactly the four files claimed

```
$ git diff origin/main..HEAD --stat
 .../0063_drop_redundant_workspace_role_index.sql   |    1 +
 apps/api/drizzle/meta/0063_snapshot.json           | 5427 ++++++++++++++++++++
 apps/api/drizzle/meta/_journal.json                |    7 +
 apps/api/src/database/schema.ts                    |    5 +-
 4 files changed, 5439 insertions(+), 1 deletion(-)
```

`origin/main` (`c422e67eaa9b5b308448aeeb651e9e5b432dda68`) is an ancestor of HEAD. HEAD is a
merge commit; per `ci-cd.md`'s conservative merge attribution, the union of its per-parent
diffs was checked rather than the combined diff:

- branch-parent side (`b30a767..b92c1cb`): `tests/api-integration/helpers/fixtures.ts`, 4
  insertions / 3 deletions — this is #245's comment correction arriving from `main`, byte
  identical to `main`'s copy (it does not appear in `origin/main..HEAD`).
- main-parent side (`c422e67..b92c1cb`): the four files above.

The merge introduced no content of its own. Nothing outside the four claimed files.

## 2. The migration is exactly one `DROP INDEX`

44 bytes, one statement, no trailing newline, no comment, no `--> statement-breakpoint`,
nothing appended:

```
$ cat -A apps/api/drizzle/0063_drop_redundant_workspace_role_index.sql
DROP INDEX "workspace_role_workspaceId_idx";
$ wc -c apps/api/drizzle/0063_drop_redundant_workspace_role_index.sql
44
```

Journal: one appended entry, `idx: 63`, tag `0063_drop_redundant_workspace_role_index`. No
existing entry edited.

Snapshot `0063_snapshot.json` vs `0062_snapshot.json`, compared structurally with `id`/`prevId`
excluded — **exactly one** difference in the entire 5427-line file:

```
REMOVED .tables.public.workspace_role.indexes.workspace_role_workspaceId_idx =
  {"name":"workspace_role_workspaceId_idx","columns":[{"expression":"workspace_id",...}],
   "isUnique":false,"concurrently":false,"method":"btree","with":{}}
count: 1
```

`prevId` of 0063 equals `id` of 0062, so the chain is intact. `schema.ts` removes the one
`index(...)` declaration and leaves `workspace_role_role_idx` untouched.

## 3. The redundancy claim is real, not assumed

Migration `0051_workspace_role_unique.sql` (issue #118) ends with:

```sql
ALTER TABLE "workspace_role"
  ADD CONSTRAINT "workspace_role_workspace_id_role_unique"
  UNIQUE ("workspace_id", "role");
```

Leading column is `workspace_id` — confirmed by reading the migration, and confirmed against
the real catalog below. So the composite index is a usable substitute for the dropped
single-column one.

**Every call site checked.** All references to `workspaceRoleTable` / `workspace_role` in
`apps/api/src/**` were enumerated. The query shapes are only these two:

| Shape | Sites |
| --- | --- |
| `workspace_id` alone | `list-workspace-roles.ts:60`, `create-workspace-role.ts:96` (the 25-role ceiling `count()`) |
| `(workspace_id, role)` | `create-workspace-role.ts:106`, `add-workspace-member.ts:68`, `update-workspace-member-role.ts:81`, `invite-workspace-member.ts:102`, `workspace-member-roles.ts` (`workspaceRolePermission`) |
| `(workspace_id, id)` | `update-workspace-role.ts:78`, `delete-workspace-role.ts:83` (pkey) |

No site names any index. No query hint, no `/*+ ... */`, no `SET enable_*`, no `pg_hint_plan`.
Repo-wide grep for the dropped name outside `drizzle/meta/`:

```
docs/07-planning/retrofits/s7-role-cutover-blueprint.md:170   (prose, historical)
docs/07-planning/security-reviews/122-workspace-role-unique.md:75  (the issue link)
apps/api/drizzle/0030_smart_umar.sql:11                       (its CREATE INDEX)
apps/api/drizzle/0051_workspace_role_unique.sql:4             (prose, historical)
apps/api/drizzle/0063_drop_redundant_workspace_role_index.sql:1 (the DROP)
apps/api/src/utils/workspace-member-roles.ts:207              (prose, historical)
apps/api/src/database/schema.ts:292                           (the new explanatory comment)
```

No executable reference. No test asserts its presence.

## 4. Planner behaviour, measured — not reasoned about

The textbook claim (a btree on `(a, b)` serves a predicate on `a` alone) was verified against
a real planner rather than assumed. 3000 workspaces × 5 roles = 15000 `workspace_role` rows,
`ANALYZE`d, all inside a rolled-back transaction on `opus246sec_test`. Every shape, including
the one the FK does on a parent delete:

| Shape | Plan |
| --- | --- |
| A. `WHERE workspace_id = ?` (list-roles) | `Bitmap Index Scan on workspace_role_workspace_id_role_unique` |
| B. `count(*) WHERE workspace_id = ?` (role ceiling) | `Bitmap Index Scan on workspace_role_workspace_id_role_unique` |
| C. `WHERE workspace_id = ? AND role = ?` | `Index Scan using workspace_role_workspace_id_role_unique` |
| D. `SELECT 1 FROM ONLY workspace_role WHERE workspace_id = ? FOR KEY SHARE` (the RI probe) | `LockRows → Bitmap Index Scan on workspace_role_workspace_id_role_unique` |
| E. `DELETE FROM workspace WHERE id = ?` (cascade) | trigger `workspace_role_workspace_id_workspace_id_fk` fires, 1 call, no seq scan |
| F. join `workspace_role.workspace_id = workspace.id` | `Bitmap Index Scan on workspace_role_workspace_id_role_unique` |

**No sequential scan on `workspace_role` in any shape.** This was the one plausible way an
index drop could bite: `workspace_role` carries
`FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON UPDATE CASCADE ON DELETE CASCADE`,
and Postgres does not index the referencing side automatically. Had the composite index not
covered it, dropping the plain index would have turned every workspace delete into a seq scan
of the whole table. It covers it.

## 5. The actual security question — locking and ordering

**No authorization or data-integrity implication. Checked, not assumed.**

- **Nothing takes a row lock on this table.** Repo-wide grep for `forUpdate` / `FOR UPDATE` /
  `forShare` / `SKIP LOCKED` in `apps/api/src/**` returns no hit on `workspace_role`. The only
  `FOR UPDATE` mention in the tree is a comment in `schema.ts:1727` about a different table.
- **Concurrency on this table is serialized by an advisory lock, not by scan order.**
  `WORKSPACE_ROLE_LOCK_NAMESPACE = 4_003` (`workspace-role-lock.ts`) is taken as the first
  statement of every mutating transaction — `create-workspace-role.ts:90`,
  `update-workspace-role.ts:70`, `delete-workspace-role.ts:75` — as
  `pg_advisory_xact_lock(4003, hashtext(workspaceId))`. Lock acquisition is keyed on the
  workspace id and is entirely independent of which index the subsequent `SELECT` uses. An
  index drop cannot reorder it, cannot skip it, and cannot change which transaction wins.
- **No query on this table has an `ORDER BY`**, so no result ordering can shift. This matters
  because the `.limit(1)`-without-`ORDER BY` reads that issue #118 flagged still exist — but
  `UNIQUE (workspace_id, role)` makes them single-row by construction, which is #122's fix and
  is unaffected here.
- **The unique constraint is the integrity backstop and is untouched.** The drop removes a
  non-unique index; it removes no constraint, no uniqueness, and no NOT NULL. Confirmed in the
  catalog below.

## 6. Live catalog on a fresh database

`drizzle-kit migrate` applied all 64 journal entries cleanly to `opus246sec_test`
(`SELECT count(*) FROM drizzle.__drizzle_migrations` → 64).

```
=# SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'workspace_role' ORDER BY indexname;
                indexname                |                              indexdef
-----------------------------------------+---------------------------------------------------------------------
 workspace_role_pkey                     | CREATE UNIQUE INDEX workspace_role_pkey ON public.workspace_role
                                         |   USING btree (id)
 workspace_role_role_idx                 | CREATE INDEX workspace_role_role_idx ON public.workspace_role
                                         |   USING btree (role)
 workspace_role_workspace_id_role_unique | CREATE UNIQUE INDEX workspace_role_workspace_id_role_unique ON
                                         |   public.workspace_role USING btree (workspace_id, role)
(3 rows)
```

`workspace_role_workspaceId_idx` is **gone**. The unique-constraint-backed index is **present**
with `workspace_id` leading. Constraints intact, including
`workspace_role_workspace_id_role_unique | u | UNIQUE (workspace_id, role)` and the FK.
Re-queried after the integration suite ran: unchanged.

## 7. Drift and tests

```
$ drizzle-kit check      → Everything's fine 🐶🔥          (exit 0)
$ drizzle-kit generate   → No schema changes, nothing to migrate 😴
```

The `generate` probe is the stronger of the two: `schema.ts` and the `0063` snapshot agree
exactly, so the migration is neither short of nor ahead of the declared schema. It produced no
file (`git status` clean afterwards).

Full suite, against `opus246sec_test`, all run by this reviewer at this head:

| Suite | Result |
| --- | --- |
| unit (`vitest.config.ts`) | **48 files, 323/323 passed** |
| permissions (`vitest.permissions.config.ts`) | **10 files, 80/80 passed** |
| integration (`vitest.integration.config.ts`) | **65 files, 595/595 passed** |

Counts match the PR body exactly. `tsc --noEmit -p tsconfig.json` exit 0; `biome check` on both
touched source files clean. No skipped or disabled tests.

## 8. CI at this head

All twelve checks required by the `protect-main` ruleset are green at
`b92c1cbec509e30535eea3047cd3cee81948e4f9` except one:

- **`pull request template + security review` — FAILURE, expected.** `check-pr-template.mjs`
  reports exactly two problems: `## Security review` has no `**Note:**` link, and the
  "Independent review completed and recorded" box is unticked. Both close when this note is
  committed, linked from the PR body, and the box ticked — a note-only commit, which is the
  shape `ci-cd.md` prescribes.
- **`github-advanced-security` — FAILURE, not a finding and not required.** The job log shows
  `SessionModelError: You are not licensed to use Copilot` (HTTP 403, `errorType:
  'authentication'`). It is a licensing/infrastructure failure that produced no scan result,
  it is **not** in the ruleset's required-status-check list, and it failed identically on
  merged PRs #239 and #243. Not attributable to this change.

CodeQL (`Analyze (actions)`, `Analyze (javascript-typescript)`), GitGuardian, secret scan, and
dependency audit are all green.

## 9. Gates table

The PR's `## Gates` table cites **no waived gate** — every row is `pass` or `n/a`, with `n/a`
justified by "no UI change" / "no route change" / "no permission change", all of which are true
of a 4-file schema diff that touches no route, no policy, and no `apps/web/**` file. The
delegated-merge condition on waivers is satisfied.

---

## Observations (non-blocking, no change requested)

1. **`workspace_role_role_idx` may be redundant too, for a different reason.** No query in
   `apps/api/src/**` filters or joins on `role` without also constraining `workspace_id`; every
   site is `(workspace_id)` or `(workspace_id, role)`, both of which the composite index serves
   better. `role` alone is not a prefix of `(workspace_id, role)`, so it is not redundant in the
   #135 sense — it simply appears to have no caller. Out of scope for this issue and **not** a
   reason to hold this PR; worth a separate issue if index hygiene is being swept.

2. **No `IF EXISTS`, and no `CONCURRENTLY` — both correct here.** `drizzle-kit migrate` runs
   each migration inside a transaction, where `DROP INDEX CONCURRENTLY` is not permitted, so
   the plain form is the only option. It takes a brief `ACCESS EXCLUSIVE` lock on
   `workspace_role`; the table holds at most 25 roles per workspace, so this is momentary.
   `IF EXISTS` is unnecessary because migration `0030` always creates the index and the journal
   prevents a re-run. Recorded for operational completeness, not as a defect.

3. **One genuinely stale doc line, pre-dating this PR.**
   `docs/07-planning/retrofits/s7-role-cutover-blueprint.md:170` still states `workspace_role`
   has "Two plain (non-unique) indexes only … **No unique constraint on `(workspaceId, role)`.**"
   That went stale when #122 landed, and this PR makes it doubly wrong. It is a historical
   blueprint, not an operative spec, and correcting it is out of this PR's scope — but it is the
   kind of line a later session reads as current. Suggest the orchestrator decide whether to
   annotate it. The reference at `apps/api/src/utils/workspace-member-roles.ts:207` is *not*
   stale: it describes what migration `0030` contains, which remains true.

## What I did not do

- Did not run the frontend or `packages/**` suites — no file outside `apps/api/**` is touched.
- Did not benchmark storage reclaimed; the issue's own blast-radius statement ("none") is not
  something this review needed to quantify.
- Did not review migrations `0052`–`0062`, which are already on `main` and out of this diff.
- Did not commit this note or edit the PR body — that is the orchestrating session's action.
