# Pre-merge security review — PR #195 (fix #188: `work_item.parent_id` cycle/self-reference guard)

**Reviewed head:** `8f9f9a6371ba5cf57454fa3ae95663d2d104df37`

**Status: CLEARED.** The mandatory independent Opus review is recorded, with two rounds
against two heads. Five non-blocking findings are tracked as issue #196. No gate is
waived.

Round 1 read `b7393f106643a52506d4ec80430932dceb62ae5b` and returned **CLEAR WITH
FINDINGS**, seven findings `OS1`–`OS7`. Round 2 read
`8f9f9a6371ba5cf57454fa3ae95663d2d104df37`, the single remediation commit closing `OS1`
and `OS2`, and returned **CLEAR**. The reviewer was a fresh Opus context that did not
author, direct, or remediate this change, and did not author or remediate #185 or #191.

## What this PR fixes

Issue #188, found as finding `S3` of PR #185's mandatory Opus review: `work_item.parent_id`
had no guard against a work item becoming its own ancestor. Two guards close it:

- `work_item_parent_not_self` — `CHECK (parent_id IS DISTINCT FROM id)`, for direct
  self-parenting. Atomic and race-free by construction: both columns live on the one row
  being written, which is the only thing a Postgres CHECK can express.
- `work_item_reject_parent_cycle` — a hand-written `BEFORE INSERT OR UPDATE OF parent_id`
  trigger for multi-row cycles, walking from the proposed parent upward and rejecting if
  the walk reaches `NEW.id`, taking a row lock on every ancestor it visits.

## Why this needed the same scrutiny as a second cryptographic function

This is the same table PR #191 hardened, where a superficially similar hand-written trigger
(#186 `S5`) was independently proved by both an ordinary reviewer and the mandatory Opus
reviewer to have a live-reproducible TOCTOU race that survived even SERIALIZABLE, and was
closed by replacing the mechanism with a real constraint rather than patching the check.
That PR's second Opus pass then found four more latent issues in the redesign. This
review was conducted on the assumption that a trigger on this table is guilty until
live-reproduced innocent, and every conclusion below was executed rather than reasoned.

## Round 1 — mandatory Opus review at head `b7393f1`

**Verdict: CLEAR WITH FINDINGS (non-blocking).**

Method: applied migration `0056` to a private `postgres:18` database, then confirmed the
deployed function body was byte-identical to the migration's SQL
(`md5(prosrc) = 6f0899c36dd8c5c121c70cb8a080306e`) before running anything, so every result
was against the reviewed code rather than an approximation of it.

### The mechanism holds

The implementer's race analysis was treated as a claim to falsify. It survived.

Structurally, to form a cycle a transaction must set `X.parent_id := Y` where `X` is
reachable from `Y`. Postgres takes `LockTupleExclusive` on `X` in `GetTupleForTrigger`
*before* firing any `BEFORE ROW UPDATE` trigger, and the walk then locks every row it
reads. The lock set is therefore exactly `{target} ∪ {every row the decision depends on}`,
all held to commit — two-phase locking over the decision's read set. That is a categorical
difference from #186 `S5`'s unlocked check-then-act, not a more careful version of it.
Verified rather than asserted:

- **Two-transaction swap** (`T1: A.parent:=B` ‖ `T2: B.parent:=A`): `T2` blocks on a
  `transactionid` lock while `T1` is uncommitted, then rejects with `P0001` once `T1`
  commits. Final graph acyclic.
- **Three-way ring, 10 consecutive runs**: genuine `40P01 deadlock detected` in 10 of 10,
  exactly one victim per run, graph acyclic every run. The implementer's claim of a real
  deadlock is true.
- **Three bypass shapes the implementer had not tested**, chosen because they sidestep
  cross-transaction locking entirely by never being concurrent — single-statement multi-row
  `UPDATE`, writable CTE, and single-statement multi-row `INSERT` (which the FK itself
  tolerates, being checked at end-of-statement) — **all fail closed**.
- **CHECK ↔ trigger interaction**: no masking. Self-parenting returns `23514` naming
  `work_item_parent_not_self`; a multi-row cycle returns `P0001` from the trigger.

### `max_hops` is a false rejection, never a false acceptance

Reproduced in both directions: a legitimate, fully acyclic 1200-deep chain was rejected at
depth 1002 with the `max_hops` error, and a deliberately planted pre-existing cycle
terminated at the bound and rejected rather than looping or passing.

### Findings

- **`OS1`** — the walk's `FOR UPDATE` (`LockTupleExclusive`) was strictly stronger than the
  invariant needs, and additionally conflicts with `FOR KEY SHARE`, the lock an unrelated
  foreign-key check takes against a locked ancestor. Proven side by side on an isolated
  replica of the mechanism differing only in lock mode: under `FOR UPDATE` an FK-referencing
  insert blocked; under `FOR NO KEY UPDATE` it proceeded while a genuine concurrent cycle
  attempt was still blocked. **Fixed in round 2.**
- **`OS2`** — `BEFORE UPDATE OF parent_id` fires on column *mention*, not value change: the
  same Postgres behaviour #191 `N2` found on the sibling `work_item_claim_key` trigger. An
  ordinary whole-row ORM update re-sending an unchanged `parent_id` re-ran the entire
  locking walk. Proven live, with a control showing the same edit not mentioning
  `parent_id` proceeded freely. Combined with `OS1`, a title edit blocked child creation
  under every ancestor. **Fixed in round 2.**
- **`OS3`** — a new class of deadlock between `work_item_claim_key` and
  `work_item_reject_parent_cycle`. The two acquire locks in opposite orders (on `INSERT`
  the claim row first then ancestors; on `UPDATE ... SET key` the target row first then the
  claim), a classic ABBA. Reproduced live as a real `40P01`. Narrow — the wait-for cycle
  only closes when both transactions want the same key, a collision that had to fail
  anyway — but the failure mode changes from a deterministic unique violation to a
  whole-transaction abort that may pick the other participant, and a third innocent
  reparent can be drawn into a longer wait-for cycle. **Tracked in #196; #23's write path
  must retry on `40P01`.**
- **`OS4`** — the trigger is disableable and the CHECK is not. Under
  `session_replication_role = replica` a 2-cycle is accepted while the CHECK still rejects
  self-parenting. Inherent to triggers and not a defect in this PR, but `replica` is the
  mode a logical-replication apply worker, `pg_restore --disable-triggers`, and most
  blue/green or DR cutovers run in. The defensible statement of the guarantee is therefore
  narrower than the presence of a trigger suggests: *on the primary, under normal
  operation, a cycle cannot be written* — **not** that the table can never contain one. The
  `RH-9`/`RH-14`/`WI-19` roll-up walks that #188 cites as the reason this matters must
  still carry their own visited-set or depth bound. **Tracked in #196.**
- **`OS5`** — the trigger is not self-sufficient against direct self-parenting; it is
  load-bearing on the CHECK. Proven: with the CHECK dropped, the trigger accepts
  `parent_id = id`, because of the `IF NEW.parent_id = NEW.id THEN RETURN NEW` early
  return. Low severity — the coupling points the safe way, since a CHECK cannot be disabled
  by `session_replication_role` — but it is the same species as #191 `N3`. **Tracked in
  #196.**
- **`OS6`** — migration `0056` does not retro-validate existing data for cycles. The CHECK
  validates existing rows; the trigger has no equivalent, so a pre-existing multi-row cycle
  survives the migration silently and only surfaces later as a confusing `exceeds 1000
  hops` error. `work_item` has no write path and is effectively empty, so the practical
  risk today is nil. **Tracked in #196.**
- **`OS7`** — the trigger is absent from the drizzle snapshot (recurrence of #191 `O7`), so
  `drizzle-kit check` cannot detect its accidental removal; the integration tests are the
  real gate. Separately, the trigger makes single-statement bulk hierarchy inserts
  order-sensitive in a way the FK alone is not (`(parent, child)` succeeds, `(child,
  parent)` fails closed), which a seed or import path emitting rows in arbitrary order will
  hit. **Tracked in #196.**

### On whether a trigger belongs on this table at all

Recorded because it is the question #191's history actually raises. The "trigger versus
constraint" framing is the wrong axis, and adopting it would have led to the wrong
conclusion here. The real distinction is *check-then-act on unlocked data* versus *a
mechanism whose entire read set is locked for the duration of the decision*. #186 `S5` was
the former and was unfixable by patching; this is the latter.

There is also no constraint-shaped alternative available. #186 `S5`'s key collision could
be re-expressed as "does a row with this exact composite key exist," which a unique index
answers atomically — that is why #191's redesign worked. "Is `X` reachable from `Y` in this
digraph" has no such re-expression: no `CHECK`, FK, unique index, or exclusion constraint
can express reachability, because none can consult a variable-length set of other rows.
Rejecting the trigger here would mean accepting no database-level guarantee at all and
pushing enforcement to the application, which is strictly weaker.

What this table's history does argue for is retiring the sentence "the database guarantees
no cycles" — see `OS4` for the exact conditions under which it stops holding, and why the
honest invariant is narrower than a future reader will assume.

The two decisions the author flagged as judgment calls — row-locking during the walk over a
constraint-only redesign, and `max_hops = 1000` rather than deriving it from `RH-7`'s
depth-5 cap — are both correct, for the reasons given in the PR body.

## Round 2 — remediation and delta review at head `8f9f9a6`

**Verdict: CLEAR.** No new findings.

One commit, closing `OS1` and `OS2`. `OS3`–`OS7` were deliberately left untouched and moved
to #196. The delta touches only the migration SQL, the `parentId` comment in `schema.ts`,
and the test file.

Method, tightened after round 1: the review ran in a private detached worktree rather than
the shared checkout (during round 1 another lane switched the shared working tree off this
PR's head mid-review), against a fresh database migrated from this head, after confirming
the deployed function body was byte-identical to the new SQL
(`md5(prosrc) = cb17a488d90403064e50d9e99e12f9c9`) and that `FOR NO KEY UPDATE` was what
was actually deployed.

**`OS1` verified closed, and verified not to have weakened anything.** On the real table,
with a transaction holding an open reparent whose walk locks `LEAF → MID → ROOT`:

| Probe | Result |
| --- | --- |
| `work_item_key_alias` row FK-referencing the locked ancestor `ROOT` (needs only `FOR KEY SHARE`) | **PROCEEDED** |
| concurrent cycle attempt `ROOT.parent := OTHER` | **BLOCKED** |
| changing a locked ancestor's `id` (a key column) | **BLOCKED** |
| `DELETE` of a locked ancestor | **BLOCKED** |
| plain title `UPDATE` of a locked ancestor | **BLOCKED** |

The cycle-safety reproductions were re-run against the new lock mode rather than reasoned
about: the two-transaction swap still blocks then rejects with `P0001`, and the three-way
ring over 10 fresh runs still resolved to exactly one loser every time — 9 by
`40P01 deadlock detected` and 1 by the trigger's own `P0001` when a pairwise conflict
resolved before a full three-way wait formed. Both are correct outcomes, and this
distribution is the reason the shipped test's `rejected.length >= 1` assertion is the right
one; asserting "exactly one, via deadlock detection" would be flaky against a correct
implementation.

**`OS2` verified closed across the full transition matrix**, including the null transitions,
each probed by a title-only update of the *ancestor* (which runs no walk of its own, so it
blocks if and only if the other transaction's walk holds that row):

| Transition | Walk runs | Correct |
| --- | --- | --- |
| `NULL → NULL` (no-op) | no | yes — nothing can be created |
| `X → X` (ORM whole-row, unchanged) | no | yes — the edge is unchanged |
| `X → NULL` (detach) | no | yes — detaching cannot create a cycle |
| `NULL → X` (attach, first time) | **yes**, full chain locked | yes |
| `X → Y` (reparent) | **yes**, new parent's chain locked | yes |

Cycle rejection was separately confirmed to be intact on exactly the transitions that can
create one: a `NULL → X` attach closing a 2-cycle, an `X → Y` reparent closing a 3-cycle, a
whole-row ORM update that genuinely changes `parent_id` into a cycle, and a self-parent
(correctly `23514` from the CHECK). A multi-row statement in which one row hits the
early-return and another closes a cycle is still rejected, so the early-return cannot be
used as a partial-skip bypass.

**Two adversarial cases specific to the new early-return, neither raised by the
implementer.** The early-return is the only genuinely new risk surface, since it makes the
guard conditional on `OLD`:

- *Stale `OLD` under concurrency.* If `OLD.parent_id` were the pre-blocking snapshot value,
  a transaction could early-return past a real change. Reproduced: `T1` detaches `X`
  (`MID → NULL`) while `T2` concurrently re-sets `X.parent := MID`. After `T1` commits,
  `T2` was confirmed to have actually walked and locked `MID` — Postgres's EvalPlanQual
  re-evaluation gives the trigger a fresh `OLD`, so the early-return cannot be tricked into
  skipping a walk on a genuinely changing update.
- *Cycle attempt racing a detach.* Run in both interleavings; the persisted graph was
  acyclic in both.

**`OS3` re-checked and confirmed neither fixed nor worsened** — the ABBA reproduces
identically at this head, as expected, since the insert side never early-returns
(`TG_OP = 'INSERT'` skips the guard entirely) and the update side of the ABBA is an
`UPDATE ... SET key`, which never fires this trigger. `OS2` strictly *narrows* `OS3`'s
exposure and cannot widen it: an ORM whole-row update re-sending both `key` and `parent_id`
unchanged was confirmed to take no ancestor lock at all, so such a transaction can no
longer appear on the walk-lock side of the ABBA.

**Everything else re-run at this head and unchanged:** all three intra-statement bypass
shapes still fail closed, and `max_hops` is still fail-closed (a legitimate deep chain is
accepted to depth 1001 and then rejected, never accepted).

**Implementation correctness of the guard itself.** `OLD` is referenced only inside a
nested `IF TG_OP = 'UPDATE'`, not as the right half of an `AND`, so it is never touched on
`INSERT` — confirmed by every `INSERT` path exercised above rather than by reading the
short-circuit rules.

## Evidence

| Check | Result |
| --- | --- |
| `work-item-parent-cycle-guard.test.ts` at this head, private Postgres 18 | **13 passed** (10 original + 3 new regression tests) |
| Deployed function body vs. migration SQL | byte-identical, `md5 cb17a488d90403064e50d9e99e12f9c9` |
| Deployed lock mode | `FOR NO KEY UPDATE` |
| Two-transaction swap, new lock mode | blocks on `transactionid`, then `P0001`; graph acyclic |
| Three-way ring, new lock mode, 10 runs | exactly one loser every run (9 × `40P01`, 1 × `P0001`); never a closed ring |
| `OS2` transition matrix | 5 of 5 correct |
| Intra-statement bypass shapes | 3 of 3 fail closed |
| `max_hops` | fail-closed (rejects at the bound, never accepts) |

## What this note does not do

- It does not resolve #196 (`OS3`–`OS7`), which is tracked separately and unaffected by
  this PR's merge.
- It does not merge this pull request, edit `## Gates`, or waive anything.

## What the reviewer did not do

- Did not re-run the pre-fix regression check (the PR body's claim that 7 of 10 tests fail
  against `main`). The suite was run on the candidate heads only.
- Did not run the full integration suite, `lint`, `typecheck`, or `docker build` — those
  are the orchestrating session's and CI's checks, reported green in the PR body and not
  independently re-executed here.
- Did not audit `0056_snapshot.json` beyond `work_item`'s check constraints and confirming
  both triggers are absent from it (`OS7`).
- Did not exhaustively duplicate the two parallel ordinary reviews' lenses.

## Status of the gate

**Closed.** The mandatory independent Opus review is recorded across two heads, with the
final verdict **CLEAR** at `8f9f9a6371ba5cf57454fa3ae95663d2d104df37`. No finding blocks
merge. Issue #196 remains open and tracked, unaffected by this PR's merge. This note's own
commit touches nothing outside `docs/07-planning/security-reviews/`.
