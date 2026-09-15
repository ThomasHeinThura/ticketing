# Pre-merge security review — PR #122 (#118 DB half: UNIQUE (workspace_id, role))

**Reviewed head:** `49c704b0928ca4c442248479d5e481e79cef6761`
**Base:** `origin/main` at review time

**Verdict: CLEAR FOR MERGE.** Zero blocking findings. Two non-blocking findings, both filed
as tracked follow-up issues, neither a defect in what this PR ships.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, and for that head only. A later commit touching anything outside
`docs/07-planning/security-reviews/` voids it.

**Reviewer independence.** A fresh Opus context, spawned explicitly via the `Agent` tool
with an explicit model pin, that authored no part of the change under review — including no
part of the migration rename/renumber (`NEXT_workspace_role_unique.sql` →
`0051_workspace_role_unique.sql`) or the factual-wording correction, both already reviewed
by two independent Sonnet contexts across prior rounds.

## What was established by demonstration, not by reading

- **Repair and refusal predicates are exactly right.** The repair set
  (`count(DISTINCT permission) = 1`) and refusal set (`count(DISTINCT permission) > 1`) are
  disjoint and exhaustive; the repair's `USING` subquery structurally cannot touch a
  conflicting group. The one theoretical soft spot — `count(DISTINCT permission)` ignoring
  `NULL` values, which could silently mis-repair a mixed NULL/non-NULL group — is closed
  because `permission` is `NOT NULL` in the shipped DDL, confirmed directly against the
  schema and the live catalog.
- **Adversarial runs against the raw SQL** (private PostgreSQL 18.6 lane database, not the
  PR's own test suite): a 2-agree/1-conflict group refuses the whole group with zero rows
  deleted, not a partial repair; the kept row is the lexicographically smallest `id`
  regardless of insertion order; same role name across different workspaces is correctly
  NOT grouped (tenancy boundary holds); semantically-equal-but-textually-different JSON
  payloads are correctly refused, not silently treated as identical; a batch containing both
  a repairable group and a conflicting group **fully rolls back** — verified both by
  behavior and at the source (`drizzle-orm`'s migrator wraps the whole batch in one
  transaction, and the migration runner exits non-zero on failure, which is what actually
  stops deployment).
- **Deletion-safety claim confirmed independently.** Zero occurrences of
  `references(() => workspaceRoleTable` or `REFERENCES "workspace_role"` across the schema
  and all 52 migrations — nothing is orphaned by removing a duplicate row. The
  "timestamps are not authorization" argument holds: nothing reads `created_at`/`updated_at`
  as an input to any authorization decision.
- **Journal correctness re-derived independently**, not trusted from the Sonnet rounds: 52
  entries, `idx` 0–51 unique and contiguous, entry 51's `when` timestamp is both the
  strictly greatest in the file and genuinely in the past (matters because drizzle's
  migrator gates application on `when`, not `idx` — a future timestamp could strand later
  generated migrations). Ran the full chain (0000→0051) against a fresh database; the PR's
  own 5-test suite passes standalone against the result.
- **The unphased `ADD CONSTRAINT` is confirmed non-blocking** for this project's current
  stage (P0/pre-production, no real customer data — verified against `status.md`), and is
  in fact the only available form: `UNIQUE` cannot be added `NOT VALID` in PostgreSQL, so a
  phased approach isn't an option this migration declined — it's not one that exists.

## Findings — two, both non-blocking, both tracked

- **[#134](https://github.com/ThomasHeinThura/ticketing/issues/134)** — three check-then-insert
  paths in the startup/seed path (including `seed-default-workspace-roles.ts`, which runs
  every process startup and exits on failure) lack `onConflictDoNothing`. In a multi-replica
  deployment, concurrent startup could race and crash a replica. Fail-closed, not a security
  regression — an availability cost, not covered by this PR's own scope, and not introduced
  by it.
- **[#135](https://github.com/ThomasHeinThura/ticketing/issues/135)** — `workspace_role_workspaceId_idx`
  is now redundant: the new `UNIQUE (workspace_id, role)` constraint's own index has
  `workspace_id` as its leading column and can serve any query the plain index could.
  Storage/maintenance cleanup, not a defect.

## What this review does not claim

This review clears PR #122's migration — the repair rule, the refusal rule, the constraint,
and the deletion-safety argument — against the threat model issue #118 exists to close. It
does not extend to PR #119 (the evaluator half, reviewed and cleared separately on its own
exact head) or to the two follow-up issues above, which are explicitly out of this PR's
scope.
