# Pre-merge security / critical review — PR #330 (`sla-scan` decision core, SLA-14/15/15a)

**Reviewed head:** `4c1b9d950cb56438fd40c699e5cc87e389ea42bb`

**Reviewer:** Claude Opus 5.5, a fresh, independent context. It did not write, direct or fix
this change. It made no code edit and no PR-body edit. The only commit it made is this file.

**Verdict: CHANGES REQUESTED.** One MEDIUM finding (a spec mismatch that no test pins). Two
LOW findings. Two notes on `main` code outside this diff, which this PR can reach. Nothing
here is an authorization or data-exposure hole. The core cannot skip a breach or fire the
same edge twice, as long as the job writes `nextStoredState` in the same step as the emit.

This review covers the head above **only**. Any later commit outside
`docs/07-planning/security-reviews/` voids it.

## Scope

The diff against `origin/main`: `packages/domain/src/sla/scan.ts` (new, 100 lines),
`scan.test.ts` (new, 8 tests), two 12×5 tests added to `sla.test.ts`, and one export line in
`index.ts`. Clock, calendar, DST and pause arithmetic live in `sla.ts` and `calendar.ts`,
which are already on `main` and **not** changed here. I still probed them through this
core, because the scan's correctness depends on them.

## What was measured

| Check | Result |
| --- | --- |
| `packages/domain` tests | 9 files, **480/480** pass |
| Coverage (`vitest --coverage`, gate 90 % statements/lines/functions) | all files 97.66 % stmts / 97.71 % lines / 98.52 % funcs; `scan.ts` 100 % lines, 100 % branches |
| `tsc --noEmit -p packages/domain/tsconfig.json` | clean |
| Purity | `scan.ts` imports only a type. No I/O, no `Date.now`, no `new Date()`, no randomness. `sla.ts`/`calendar.ts` take `now` as an argument |
| CI (`gh pr view 330`) | every required check green at this head **except** `pull request template + security review` (FAILURE). That is expected: no ordinary review is recorded yet, and this security review was not recorded until now |
| Mutation 1: `computedRank > storedRank` → `>=` | 2 tests red (the exactly-once test and the steady-state test). Reverted |
| Mutation 2: `none` branch `computedRank >= 1` → `>= 0` | 1 test red (`none → ok` must not emit). Reverted |
| Mutation 3: add an `sla.at_risk` emit for `breached → at_risk` | **0 tests red** (8/8 pass). Reverted. See M1 |

### Scan simulation (throwaway probe, deleted)

I ran `computeMetricState` + `scanDecision` in a loop, every 5 minutes, with the cache
written back after each tick. Setup: a 7-day, 08:00–20:00 Europe/London calendar, a
1440-minute resolution goal and a 75 % threshold.

- **DST fall-back** (start Sat 2026-10-24 10:00Z; the clocks go back on Sun 25 Oct):
  `sla.at_risk` fired once at 2026-10-25T17:00Z and `sla.breached` fired once at
  2026-10-26T11:05Z. I checked both by hand. Sat 11:00–20:00 BST gives 540 minutes. Sun
  08:00 GMT + 540 = 17:00Z (the 1080-minute point). Sunday ends at 1260 minutes. Monday opens
  at 08:00 GMT = 08:00Z, and + 180 = 11:00Z. At exactly 100 % the item is still `at_risk`
  (breached means `> 100`), so the first tick after that is 11:05Z. Correct.
- **Duplicate ticks** (every tick scanned twice): the emits were identical — no double fire.
- **DST spring-forward** (start Sat 2026-03-28 10:00Z): at_risk at 2026-03-29T15:00Z and
  breached at 2026-03-30T09:05Z, once each. Both checked by hand.
- The two new 12×5 tests' expected values are also correct by hand (BST offsets).

## Findings

### M1 (MEDIUM) — `breached → at_risk` emits nothing, but SLA-15 says it should, and no test pins either reading

- **Input:** `scanDecision("breached", "at_risk")` → `{ emit: [], nextStoredState: "at_risk" }`.
- **Spec:** SLA-15 says "On a transition into `at_risk`, emit `sla.at_risk`". The 2026-09-18
  clarification adds: "a genuine state change re-fires the edge. A breached item can retreat
  to `at_risk` — pauses lower the consumed proportion — and breach again."
  `breached → at_risk` is a genuine transition into `at_risk`.
- **Code:** only *rising* changes emit. The header's reason is "A downward correction … only
  possible via manual data change — consumed time is monotonic for open items". The spec
  sentence above says the opposite. My probe confirms it: a retroactive pause on a breached
  item gives `breached → ok` directly.
- **PR body:** boundary reading 3 covers "downward corrections re-arm crossings". It does not
  say that a retreat *into* `at_risk` stays silent. So the reading is neither flagged
  (do-not 17) nor pinned. Mutation 3 above passes all 8 tests.
- **Impact:** after a pause pulls a breached item back to `at_risk`, no one is told it is at
  risk again. A later re-breach still fires, so no breach is lost. This is a missed
  notification, not a missed breach.
- **Fix (either one):** (a) emit whenever the new state is an alert state that differs from
  the stored one:
  `if ((computed === "at_risk" || computed === "breached") && computed !== stored) emit.push(…)`.
  That is shorter than the rank logic and matches the spec word for word. Add a
  `breached → at_risk` test and correct the header's "monotonic" sentence. Or (b) if the
  silent reading is wanted, get it written into `sla.md` SLA-15 and pin it with a test.

### L1 (LOW) — reopening a `missed` item re-emits `sla.breached`

- **Input:** `scanDecision("missed", "breached")` → `emit: ["sla.breached"]`. The same
  happens for `met → at_risk`.
- A reopened item that already went `missed` gets a second `sla.breached`, so escalation
  (SLA-17) starts again. Under SLA-15's "a genuine state change re-fires the edge" this is
  defensible. But the PR does not mention it and no test covers it. Add a test that pins the
  reading, so the job slice and escalation know it is deliberate.

### L2 (LOW) — exactly-once depends on the job, and the PR does not say how

The core is idempotent across rescans (measured above). Exactly-once *delivery* still needs
the job to write `nextStoredState` in the **same transaction** as the event/outbox insert.
Two scans running at once also need a conditional write (`WHERE state = :stored`). Without
these, a crash between emit and cache write, or two overlapping scans, double-fires. That
belongs in #329's job slice; record it there as an acceptance criterion.

### Notes on `main` code outside this diff (not blockers for #330; a separate issue is recommended)

- **N1 — a `target_minutes` of 0 never breaches.** `pct()` returns 100 when `target <= 0`,
  and `stateForConsumedPct` needs `> 100` to breach. A goal with `targetMinutes: 0` stays
  `at_risk` forever, so the scan never fires `sla.breached`. Nothing validates
  `sla_goal.target_minutes > 0` yet.
- **N2 — a huge `target_minutes` throws or runs slowly.** `targetMinutes: 2e10` throws
  `RangeError: Invalid time value` from `instantAtCoveredOffset`. The first horizon,
  `(remaining + 1) * 8` minutes, is not capped before `new Date(...)`. `targetMinutes: 1e8`
  takes about 1.7 s for one item. If the job does not catch errors per item, one bad goal
  stops the whole scan, and every other item's breach is skipped. Fix: validate goals as
  positive integers with an upper bound when policies are written, and cap the first horizon.

## Tests pin the rules?

Mostly. Every rising pair, steady state, `none` edges and the met/missed suppression are
pinned, and mutations 1 and 2 go red. The retreat case (M1) and reopen-after-terminal (L1)
are not pinned.
