# Security review — PR #208 (issue #198, first slice: `legal_hold` + session-cleanup purge)

**Reviewed head:** `c205060a362fda37bf833633669ac7e464e847be`

## What this PR does

`docs/01-architecture/background-jobs.md` specifies a `session-cleanup` job that purges
soft-deleted rows past their `purge_after` window and skips any row whose organisation or
person is under an open `legal_hold`. `docs/05-operations/data-protection.md` specifies the
hold as an operator action. Neither existed in code before this PR — no `legal_hold` table,
no purge job, nothing reading the `purge_after` columns PR #179 (`organisation`) and PR
#200 (`project`) added.

This is explicitly a **first slice**: it adds the `legal_hold` table and implements the
*session*-purging half of the job — sessions are the one table today where the
hold-awareness predicate (`session.user_id → person.user_id → person.organisation_id`) is
fully derivable from existing columns. Deliberately deferred, each verified rather than
assumed by review: purging soft-deleted `organisation`/`project` rows (`organisation.
deleted_at` is written nowhere yet; neither `workspace` nor `project` has an
`organisation_id` column, so a project purge's hold-check is impossible to write correctly
today); a hold placement/lift route (no `audit_log` table or appender exists anywhere in
`apps/api`, and an unaudited route would violate `data-protection.md`'s own audit
requirement); invitation/idempotency-key purging (no idempotency table exists); a lease
heartbeat (this job finishes in one statement); chunking (a single `DELETE`, deliberate).
Issue #198 remains open for this remaining scope.

## Prior review rounds (both ordinary tier, before this pass)

- **Round 1** (at `3f401c2`): CLEAR WITH FINDINGS. Verified a clean-database migrate,
  `drizzle-kit check`, byte-identical migration regeneration, the snapshot chain, 20
  raw-SQL probes of the hold predicate, and independently re-derived all three
  "deliberately not implemented" reasons by trying to falsify each. Five findings, all
  fixed in `cfff660`: a duplicate independent-review checkbox; a test that claimed to catch
  a dropped `scope` discriminator but didn't (fixed and mutation-proven); a destructive run
  that logged nothing; a comment citing a nonexistent file; nothing pinning the cron
  cadence.
- **Round 2** (delta `3f401c2..cfff660`): CLEAR WITH FINDINGS. Independently reproduced
  both mutation proofs, verified every claimed test count exactly, confirmed all 30
  rebase-introduced files (mid-review rebase onto `main`) are byte-identical to `main` and
  disjoint from this PR's own changes. Five more residuals, all fixed in `c205060`: a
  throwing run emitted no structured log line; the cadence test asserted a pattern *set*
  rather than keying by job name, so transposing two jobs' cron patterns still passed;
  `traceId` was named by spec but absent (now stated as future scope, not a silent gap); a
  schema comment asserted a doc resolution that doesn't exist; a log test didn't cover the
  no-op-run case it praised.

## Mandatory Opus review (this pass)

**Verdict: CLEAR WITH FINDINGS — nothing blocks merge.**

Independently re-derived at every step, not accepted from the two prior rounds:

- **Table invariants** verified live against a freshly migrated database: the `CHECK` and
  partial unique index match `data-model.md` §2 and §Indexing verbatim. Migration confirmed
  genuinely additive.
- **Migration reproducibility** independently re-verified: deleted the migration/snapshot/
  journal entry and regenerated from `schema.ts` — byte-identical.
- **The hold predicate**, probed adversarially with 14 new scenarios beyond the prior
  rounds' 20: scope discrimination in both directions and against a third party; two
  simultaneous holds on the same user; a lifted hold on the right org alongside an open
  hold on a different one; a placeholder person with a null `user_id`; the exact expiry
  boundary. Confirmed the session→organisation path is the only derivable one — no FK on
  `session` itself, `workspace`/`project` carry no `organisation_id`.
- **5 independent mutation proofs**, all discriminating: dropping `lifted_at IS NULL` (1
  test fails), breaking the organisation join column (4 fail), and — the destructive
  direction — flipping the expiry comparison (11 fail).
- **Lease/scheduler wiring**, live-tested: a lease held by a different owner blocks the
  run; an expired lease is taken over; a failing run still releases its lease; two
  concurrent invocations produce no double-delete.
- **All three "deliberately not implemented" claims** survive falsification by direct
  grep/read of the current codebase, not just accepted from the PR's own reasoning.
- **Suite counts confirmed exactly**: 58 files / 527 tests without the reviewer's own added
  probes, 59/541 with them, all green.

**Findings, all non-blocking:**
- **F1**: the scheduler's name→*handler* binding is unpinned (as opposed to name→*pattern*,
  fixed in round 2's D4) — swapping which function each job name maps to left all 9
  scheduler tests green. Current wiring is correct; this is regression exposure, narrower
  instance of the same class as N1/D4, filed as a follow-up rather than another round.
- **F2**: the expiry boundary is loosely pinned (all fixtures expire an hour out); the
  destructive direction is well covered, so this is a coverage gap, not a live risk.
- **F3**: `legal_hold` accepts a lift with no attribution (`lifted_at` set, `lifted_by`
  null) — the reverse is safe. Best closed alongside the eventual placement/lift route.
- **F4**: a future-dated `lifted_at` releases the hold immediately — follows the literal
  spec, not a deviation, but a foot-gun for a future "schedule a lift" gesture. Worth a
  sentence for whoever builds that route.
- **F5**: `session.expires_at <= now()` assumes a UTC database server — an inherited
  convention (`withJobLease` already does the same), not introduced here, but this is the
  first pattern-user that *destroys* rows on it. Filed as its own follow-up (#212) since it
  applies beyond this PR's scope.
- **F6**: query plan is a Seq Scan with a correlated SubPlan — fine while `legal_hold` is
  small; the PR already discloses the no-chunking decision and the shape a future bound
  would take.
