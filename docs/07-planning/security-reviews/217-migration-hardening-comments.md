# Security review — PR #217 (issue #196: document the five hardening notes beside the cycle guard)

**Reviewed head:** `4ee00af3919239182e05a04702a552d889e61739`

## What this PR does

Closes issue #196 — five non-blocking findings (OS3 through OS7) from PR #195's mandatory
Opus review of the `work_item_reject_parent_cycle` trigger and its CHECK constraint. Each
finding becomes a durable `--` comment in the already-applied migration file it concerns
(`apps/api/drizzle/0056_lonely_gorilla_man.sql`), for whoever builds #23's write path, a
future bulk importer, or a future "cleanup" to actually read. No DDL statement is changed.

## Review (lightweight tier — comment-only migration edit)

**Verdict: CLEAR WITH FINDINGS — both informational, neither blocks merge.**

- **Comment-only claim mechanically proven**: every added line matches `^\+\s*--`, zero
  non-comment additions, zero removals. Stripping comments from both the base and head
  versions of the migration file yields byte-identical SQL (sha256 match): one `ALTER
  TABLE ... ADD CONSTRAINT work_item_parent_not_self CHECK`, one function, one trigger,
  unchanged. No lexical hazard in the added text (no semicolons, no `$` characters that
  could interfere with the function body's `$$` delimiters, statement-breakpoint count
  unchanged).
- **No migration-content checksum gate exists** — verified by reading the installed
  migrator (`drizzle-orm/pg-core/dialect.js`): re-application is gated purely on a
  timestamp comparison; the `hash` column is written on insert but never compared. Editing
  an already-applied migration's text is a genuine runtime no-op, not something that could
  cause a silent drift or re-run.
- **All five comments (OS3–OS7) verified as true statements about the unchanged code**,
  each checked against the actual trigger/constraint definitions:
  - OS5 (matched pair): the trigger's early-return for direct self-parenting exists, and
    would indeed be the only guard left if the CHECK were dropped.
  - OS4 (void under replica role): the trigger uses plain `CREATE TRIGGER` (origin-only
    firing); no `ENABLE ALWAYS/REPLICA TRIGGER` exists anywhere in the migrations.
  - OS3 (cross-trigger `40P01`): the mechanism is sound — `work_item_key_claim`'s PK is on
    `key` alone while the claim trigger's `ON CONFLICT` arbiter is the composite `(key,
    work_item_id)`, and paired with the cycle trigger's row locks, an ABBA order is real.
  - OS6 (prospective only): no backfill/scan/validation statement exists; the trigger only
    fires on future `INSERT`/`UPDATE OF parent_id`.
  - OS7 (invisible to drizzle-kit): the committed snapshot has zero trigger/function
    entries; the integration test suite (cycle-rejection tests for 2/3/6-node cycles plus
    concurrency tests) is confirmed to be the only guard against silent removal.

**Two informational findings, neither blocking:**
- OS3's "reproduced live during #195's review" isn't independently re-verifiable from this
  repo alone — no regression test pins the specific cross-trigger interaction it describes
  (only same-trigger cycle deadlocks are tested today). Not a defect: OS3's actionable
  output is a requirement on a *future* PR (#23's write path must retry on `40P01`
  regardless of raiser), not a claim about current code needing a test.
- OS6's "prospective only" is precise for the trigger but slightly loose for the migration
  as a whole (the CHECK constraint, added without `NOT VALID`, did validate pre-existing
  rows for the direct-self-parent case specifically) — reads correctly in its actual
  context (the function header), no rewrite needed.
