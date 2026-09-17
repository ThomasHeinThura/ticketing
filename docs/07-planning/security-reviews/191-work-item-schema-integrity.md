# Pre-merge security review — PR #191 (fix #186: work-item schema integrity — customer_visibility default, cross-project composite FKs, key/alias collision registry)

**Reviewed head:** `c20efe56cce2ae0e285c9f7ead236075a186b901`

All three review rounds above read `2049107485ba491de251799c9df08e523038b6b8`. The commit
above it is a merge bringing this branch up to date with `origin/main` (which had moved on
— PRs #190/#193 merged elsewhere while this PR's review was in progress) — `git diff
2049107 c20efe56cce2 --stat` touches only `docs/07-planning/decision-log.md` (an unrelated
PR's entry, already merged to `main` independently) and this note file; every
`apps/api/**`/`apps/api/drizzle/**` path the merge commit's own file list names is
byte-identical to `2049107`, confirmed directly. No further code review was needed to move
the reviewed head forward to it.

**Status: CLEARED.** Both required ordinary reviews (PASS, delta-confirmed at `db65e55`)
and the mandatory Opus review (three passes, final verdict **CLEAR** at this head) are
recorded. No gate is waived.

## What this PR fixes

PR #185's mandatory Opus review found nine findings in issue #23's first work-item schema
slice; four (S1, S2, S5, and one folded into S6/#181) were flagged as needing to close
before any write-path PR. This PR fixes S1, half of S2 (project/state/parent scoping — the
other half, `type_id`/workspace scoping, is issue #192), and S5 (key/alias collision).

## Round 1 — two ordinary reviews + mandatory Opus, at head `550997b`

Ordinary reviews: composite-FK/migration-ordering fidelity (**PASS**, one documentation nit
on the `type_id` punt, corrected); trigger correctness and test genuineness (**CHANGES
REQUIRED** — the S1 NULL-rejection test didn't test what it claimed, and an independently
reproduced TOCTOU race in the original trigger-based S5 fix).

Mandatory Opus review: **CHANGES REQUIRED**, three blocking findings, all proven with live
Postgres reproductions:

- **O1** — the two new composite FKs (`work_item`→`state`, self-referencing `parent_id`)
  used `ON UPDATE CASCADE`. Because the referenced column set includes the *mutable*
  `project_id`, this created a cross-tenant write path: `UPDATE state SET project_id =
  <different workspace>` silently cascaded a work item across a workspace boundary.
- **O2** — the S5 trigger (a `BEFORE INSERT/UPDATE` check of `work_item_key_alias.old_key`
  against `work_item.key`) had an unlocked TOCTOU race, confirmed independently by both the
  ordinary trigger reviewer (plain READ COMMITTED) and Opus (who additionally proved
  SERIALIZABLE isolation does not save it — only one rw-antidependency edge exists, so
  Postgres's serializable snapshot isolation has no dangerous structure to detect this
  specific race).
- **O3** — the trigger function had no pinned `search_path`; a session-local `CREATE TEMP
  TABLE work_item_key_claim` could make the check resolve against an empty decoy table,
  silently bypassing it entirely.

Plus four non-blocking findings: **O4** (S5's reverse-direction gap, no tracked issue yet),
**O5** (the `type_id`/workspace punt's stated reasoning understated the risk — this is the
cross-*tenant* half, more security-relevant than the cross-*project* halves fixed here),
**O6** (a factual error about `isUniqueViolation`'s applicability to the trigger's custom
exception), **O7** (the trigger isn't captured in the drizzle snapshot, so `drizzle-kit
check` alone can't detect its future accidental removal).

## Round 2 — remediation and delta-confirmation, at head `db65e55`

**O1 fixed:** both composite FKs' `onUpdate` changed from `cascade` to `no action`. Verified
live: the exact cross-workspace `UPDATE` now fails closed naming the correct constraint;
legitimate same-project updates unaffected.

**O2 fixed via redesign, not a patch.** The trigger-based check is replaced entirely by a
new table, `work_item_key_claim` (`key text PRIMARY KEY`, `work_item_id text NOT NULL`,
`UNIQUE(key, work_item_id)`) — a key string is claimed here exactly once, ever, for the
life of the system, never released even after a hard delete. `work_item.key` and
`work_item_key_alias.old_key` both get composite FKs into this table; an alias can only
ever reference a claim recording *its own* work item as the original claimant, so the
cross-item collision S5 exists to prevent has no matching row to reference — rejected by a
real FK, no race window. One trigger remains (`work_item_claim_key`), but its body is only
an unconditional `INSERT`, no preceding check — a real `PRIMARY KEY`, not application logic,
is the sole arbiter of any conflict, atomically. This design closes O4 as a side effect,
verified with a regression test that fails on the pre-fix head.

**O3 fixed:** `SET search_path = pg_catalog, public` pinned on the remaining trigger
function; the `CREATE TEMP TABLE` bypass attempt re-verified closed.

Both ordinary reviewers delta-confirmed **PASS** at this head — the composite-FK reviewer
re-verified O1 and the migration end-to-end (including hand-reordering the new table's
constraints, a repeat of the same drizzle-kit statement-ordering issue found in the original
PR #185); the trigger reviewer independently reconstructed their own original race and
confirmed it now closed, verified the S1 test fix, and confirmed the O4 regression test is
genuine (fails pre-fix, passes post-fix).

Opus delta-confirmed **CLEAR WITH FINDINGS (non-blocking)** at this head — O1/O2/O3 verified
closed with fresh live reproductions (including a full 6-run concurrency matrix across three
isolation levels), O4/O6 verified closed/accurate, O5/O7 correctly deferred/documented — but
surfaced four new, latent findings (nothing on this branch has a write path yet):

- **N1** — an `ON CONFLICT DO NOTHING`-skipped `work_item` insert leaves its trigger-created
  claim row uncommitted-but-not-rolled-back, permanently squatting that key.
- **N2** — `BEFORE UPDATE OF key` fires on column *mention*, not value change: an ordinary
  whole-row ORM update that includes `key` unchanged would spuriously fail.
- **N3** — the code comment credited the `search_path` pin for closing O3's bypass; Opus
  proved the actual defense is the `public.`-qualified table reference, not the pin (Postgres
  checks `pg_temp` first regardless unless explicitly excluded) — a correct-behavior,
  wrong-reasoning documentation bug that could mislead a future maintainer into removing the
  real protection as apparent redundancy.
- **N4** — a dead citation to a `migrations.md` section that didn't contain the trigger-
  firing-order guidance it claimed to.

## Round 3 — final remediation and delta-confirmation, at head `2049107`

**N1/N2 fixed** with a single change: the trigger's INSERT gained `ON CONFLICT ("key",
work_item_id) DO NOTHING`. Verified live: a same-value re-`SET` of `key` no longer fails
spuriously (N2 closed); a squatted claim becomes recoverable by the *same* work item that
originally claimed it, while a *different* work item still can never take it (N1 closed to
exactly the degree intended — recoverable, not preventable, since the claim is still made on
first insert). The full O2 concurrency matrix and O4's reverse-direction test were re-run and
still pass — this fix does not reopen the cross-item guarantee.

**N3/N4 corrected** — the code comment now credits the actual defense (schema qualification)
and warns against removing it as apparent redundancy; the `migrations.md` citation now points
at real, added guidance on Postgres's alphabetical BEFORE-trigger firing order.

Opus's final delta pass: **CLEAR**, re-verified against a fresh reproduction of the same
6-run concurrency matrix, the cross-namespace alias rejection, and O4 — all still pass. N3's
corrected reasoning independently re-proved live. No new findings.

The orchestrating session independently ran `docker build .` and a full container boot
against a fresh Postgres 18 at this exact head: migration applied cleanly, both health
endpoints returned `{"status":"ok"}`, PR #179's internal-organisation seed ran correctly
alongside the new schema, and the claim table/trigger/composite-FKs were confirmed present
via live `psql` queries exactly as designed.

## What this note does not do

- It does not resolve issue #192 (the `type_id`/workspace_id cross-tenant gap, O5) —
  tracked separately, needs a decision before #23's write-path PR.
- It does not merge this pull request, edit `## Gates`, or waive anything.

## Status of the gate

**Closed.** Both required ordinary reviews (delta-confirmed PASS at `db65e55`) and the
mandatory Opus review (three full passes, final verdict CLEAR at `2049107`) are recorded.
No finding blocks merge. Issue #192 remains open and tracked, unaffected by this PR's merge.
