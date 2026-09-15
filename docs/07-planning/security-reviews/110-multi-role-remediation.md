# Pre-merge security review — PR #110 (#82, one membership = exactly one role)

**Reviewed head:** `001bb985c15e51593aac4550c23de8efd51177f4`
**Base:** `origin/main` = `5f0b2b3b41ae9823f4c3dc18d8aec85763577bef`

**Verdict: CLEAR FOR MERGE.** Zero blocking findings. Three non-blocking (F1 MEDIUM test
integrity, F2/F3 LOW informational).

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, and for that head only. A later commit touching anything outside
`docs/07-planning/security-reviews/` voids it. No waiver was sought or used; none is
authorized.

**Reviewer independence.** A fresh Opus context, spawned explicitly via the `Agent` tool
with an explicit model pin, that authored no part of the change under review. It made no
edit, commit, push, or merge — only PR comments recording its findings, across two rounds
(the original head `450144d`, then the merge-commit head above after the branch was
updated onto current `main`).

## What was established by demonstration, not by reading

- **Refusal predicate correctness** — built a 1,878-value adversarial corpus (every
  ECMAScript whitespace/line-terminator code point, non-trimmed format characters, a
  Cyrillic homoglyph, `Object.prototype` key names, every comma permutation). Nothing
  malformed slips through the refusal predicate. Case/homoglyph variants stay valid but
  both live evaluators deny them identically.
- **Migration 0050's repair rule** — executed its verbatim repair subquery and CHECK
  constraint against real PostgreSQL 18.6 over the same 1,878-value corpus: 0 mismatches on
  both validity and repair target. Proved the safety property directly: for all 110
  repaired values, better-auth's own raw comma-split already contains the repaired string
  byte-identically, so **0 repairs manufacture authority that didn't already exist** on the
  legacy row.
- **Exemption list** — read all 18 handlers in the installed better-auth 1.6.30 with
  file:line citations. All genuinely role-independent; the converse holds too (`leave` does
  consult role and is correctly non-exempt).
- **Live test re-execution** — 134/134 #82 integration tests, 25/25 adjacent, 250/250
  permissions, `check:openapi` green (132 operations), on a private lane database. Two
  mutation probes (deliberately breaking the guard) both went genuinely RED, including
  `expected 200 to be 409` when `update-member-role` is exempted — proving the tests are
  non-vacuous, not just present.
- **New adversarial probe** — 12 crafted path spellings against the guard's action
  derivation (encoding, traversal, case, doubled marker, `%00`): all correctly refused
  (409), all fail-closed.
- **Merge-commit re-verification** (second round, at `001bb985`): confirmed via
  `git diff-tree --cc` that the merge's own contribution is empty — a clean auto-merge with
  zero conflict-resolution edits on either side. Nothing under `apps/` or `packages/`
  changed as part of bringing `main` in; every file in this review's scope is
  byte-identical to what was reviewed at `450144d`. The one new file that arrived from
  `main` (`tests/api-integration/prototype-key-role-characterization.test.ts`, from PR
  #111) was read directly rather than assumed harmless: its `plantLegacyMembershipRole`
  helper is a plain `db.update` with no constraint manipulation, so it neither triggers nor
  is affected by this PR's migration. Re-ran 8 files / 164 tests together at `001bb985`:
  all passed.

## Findings — three, none blocking

- **F1 (MEDIUM, test integrity, not a shipped-code defect)** —
  `tests/api-integration/organization-http.ts` replaces the shipped CHECK constraint with a
  weaker one-argument-`btrim` variant for test setup, so migration `0050`'s whitespace
  clause (statement 3) has zero executed test assertions. The reviewer independently
  proved the actual shipped predicate correct by executing it directly against real
  PostgreSQL, so production is unaffected — but the test suite's own coverage claim for
  this clause is currently vacuous. Tracked as
  [#133](https://github.com/ThomasHeinThura/ticketing/issues/133); not fixed here, and not
  blocking, since the shipped code was independently verified rather than assumed correct
  from the test.
- **F2 (LOW, informational)** — a legacy `invitation.role` value fails closed (500) on
  accept, matching this PR's fail-closed posture; not a defect.
- **F3 (LOW, informational)** — prototype-key role names throw rather than grant, matching
  issue #108's already-characterized and accepted divergence (PR #111); not new scope for
  this PR.

## What this review does not claim

This review clears PR #110's own change — the migration, the repair rule, the exemption
list, and the refusal predicate — against the threat model issue #82 exists to close. It
does not re-clear anything the merge from `main` brought in on its own terms (those
changes, e.g. PR #129's governance reset, were reviewed and cleared through their own
process). It does not extend to PR #119 or PR #122 (the #118 remediation), which are
separate candidates reviewed on their own exact heads.
