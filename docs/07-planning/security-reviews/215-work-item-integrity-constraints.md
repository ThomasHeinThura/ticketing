# Security review — PR #215 (issue #189: constrain enum-like and numeric work-item columns)

**Reviewed head:** `619ad0f6bdad66017f763dfb44b8968dea60ccbd`

Substantively reviewed at `4d5dafd64ce3c62ccb136211d6fbe52af1fe810d`; clearance extended to
this head (a merge of `origin/main` into the branch) by the same reviewer, who
independently verified true merge parentage, confirmed the full diff is exactly three files
(`.husky/pre-commit`, `docs/07-planning/status.md`, this note) with no `apps/api/` change at
all, and checked git-object-hash identity on a wider surface than the migration/schema/test
files alone — including `drizzle/meta/_journal.json`, `drizzle/meta/0059_snapshot.json`,
`drizzle.config.ts`, and the integration test setup/helpers — to rule out another lane
having slipped in a colliding migration. Also re-observed at the new head in a fresh
worktree, not only inferred from hashes: `drizzle-kit check` clean, 21/21 integration tests
green, all 8 constrained objects present in the migrated catalogue.

One further main-sync landed after that confirmation, at `7fa2004`, bringing in PR #217's
migration-comment edit to a *different* migration file (`0056`, already independently
proven comment-only by its own reviewer, twice over) — no file shared with this PR.
Re-checked directly by the orchestrating session rather than a further reviewer round:
`git diff 7fa20045ebc70577546452fda5ee339d74171834
e47efcc0b26cca788e8f67a97b4f0ece8312a094 -- apps/api/drizzle/0059_work_item_integrity_checks.sql
apps/api/src/database/schema.ts tests/api-integration/work-item-integrity-constraints.test.ts`
is empty, and `drizzle-kit check` was re-run at this exact head and still reports no drift.

A second further sync landed at `619ad0f`, bringing in PRs #213 and #214 (unrelated files,
no overlap). Re-checked directly: `git diff e47efcc0b26cca788e8f67a97b4f0ece8312a094
619ad0f6bdad66017f763dfb44b8968dea60ccbd -- apps/api/drizzle/0059_work_item_integrity_checks.sql
apps/api/src/database/schema.ts tests/api-integration/work-item-integrity-constraints.test.ts`
is empty, and `drizzle-kit check` re-run again at this final head still reports no drift.

## What this PR does

Closes issue #189's data-integrity hardening backlog: adds `CHECK` constraints on
`work_item`/`work_item_type`/`state_template` enum-like and numeric columns (`priority`,
`number > 0`, `position <> 'NaN'`, category/group/visibility enums) plus a partial unique
index, via migration `apps/api/drizzle/0059_work_item_integrity_checks.sql` (8 statements:
7 `ADD CONSTRAINT ... CHECK`, 1 `CREATE UNIQUE INDEX`). No column added, dropped, narrowed,
or renamed; no data rewritten.

## Prior review rounds (both ordinary tier, before this pass)

Two rounds (Copilot/DeepSeek, not Claude): correctness pass at `caa1c7e`, CLEAR WITH
FINDINGS; alignment pass at `40a51eb`, ALIGNED WITH CONCERNS. Both recorded in full on the
PR with what each checked. The candidate correctly carried a `SECURITY REVIEW PENDING —
OPUS CAPACITY` placeholder rather than a fabricated clearance while Claude was unavailable.

## Mandatory Opus review (this pass)

**Verdict: CLEAR WITH FINDINGS — non-blocking. Nothing should block merge.**

Independently re-derived, not accepted from the two prior rounds:

- **Migration safety**: all 8 statements are additive; all 7 CHECKs land as
  `convalidated = t` (validate existing rows), which is irrelevant here because the live
  UAT stack is independently confirmed to still be v1 (Postgres 16, 76 tables) and contains
  none of the five constrained tables.
- **Every bound verified correct, no off-by-one, no wrong direction** — probed against a
  real PostgreSQL 18: `number > 0` rejects 0/-1, accepts 1, on both INSERT and UPDATE;
  `position <> 'NaN'` rejects NaN/nan (confirming the issue's originally-suggested
  `CHECK (position = position)` would NOT have worked, since Postgres `numeric` treats
  `NaN = NaN` as true) while accepting negative and fractional values; `Infinity` is
  separately blocked by the column's own `numeric(20,10)` typmod. All enum value sets match
  `data-model.md` character-for-character, including the US-spelling trap
  (`organization` correctly rejected; the doc says `organisation`).
- **Drift**: `drizzle-kit check` clean; regenerating from `schema.ts` after rolling back the
  0059 artifacts produces a byte-identical migration with exactly 8 statements.
- **Tests**: 21/21 pass on a clean database; non-vacuity independently re-proven by dropping
  all 8 constrained objects — exactly 10 of 21 tests go red, covering all 8 objects.
- **Exact-head discipline**: `caa1c7e..4d5dafd` changes no executable content at all —
  migration SQL, snapshot, journal, and test file are byte-identical; every changed
  `schema.ts` line between those heads is a comment.
- **The two surfaces this PR's own note asked an Opus pass to start from, both resolved**:
  the deliberately-unscoped partial unique index is the *safer* of the two possible designs
  (a narrower `and archived_at is null` form would let an archived row keep `is_default`,
  making a naive "resolve the project's default state" query return two rows) — confirmed
  live: an archived state holding `is_default` correctly blocks a new live default. And a
  unique index has no authority effect regardless — it can only refuse a write, never pin a
  row into another tenant's scope, so this is materially unlike the PR #191 O1 precedent the
  placeholder note worried about. This PR neither closes nor widens issue #192 (`work_item.
  type_id` cross-tenant consistency) — verified live that the relevant FK/unique-index
  prerequisites for closing #192 still don't exist, and this PR correctly doesn't add them.

**Findings, all non-blocking:**
- No test asserts that an archived state holding `is_default` blocks a new default — verified
  by hand during this review, should have a regression test; worth a tracked note on #23 so
  the write path implements the "archive must clear or re-nominate `is_default`" requirement
  (currently only in a `schema.ts` comment and the PR body).
- `work_item.priority` stays nullable and the CHECK permits NULL — deliberate and tested, not
  a regression, but worth stating so a future data migration doesn't assume totality.
- `organisation.default_customer_visibility` carries the same `private`|`organisation`
  vocabulary and is not constrained here — correctly out of #189's scope, but the same class
  of gap on a security-relevant column, worth tracking separately.
- `data-model.md`'s new text states "at most one per project" without the archived-state
  nuance that makes the invariant stricter than it reads.
