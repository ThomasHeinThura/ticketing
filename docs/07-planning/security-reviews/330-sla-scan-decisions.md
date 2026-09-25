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

---

## Delta re-review — M1 fix (#366)

**Reviewed head:** `09305f1ea5b73973e42e6b7ea1ad2c97d6a44bbe`

**Reviewer:** Claude Opus 5.5, a fresh context in a fresh worktree. It did not write the
fix. It made no code edit and no PR-body edit.

**Verdict: CLEAR.** M1 is fixed. L1 and L2 are unchanged. Both are LOW and do not block the
merge. One new trivial LOW (D1). This verdict covers the head above only.

### What changed since `4c1b9d9`

- `9d7e3eb` merges `origin/main`. Its only effect is the #369 decision-log entry: the
  `decision-log.md` diff between `origin/main` and this head is empty.
- `09305f1` changes `scan.ts` and `scan.test.ts` only. `alertRank` is gone. The rule is now
  "emit when `computed` is `at_risk` or `breached` and `computed !== stored`". The header
  no longer claims consumption is monotonic. There is one new test for `breached → at_risk`,
  which also checks that a rescan emits nothing.

### Measured at this head

| Check | Result |
| --- | --- |
| `packages/domain` tests | 9 files, **481/481** pass (one more than before) |
| Coverage | 97.63 % stmts / 97.68 % lines / 98.51 % funcs (gate 90 %); `scan.ts` 100 % lines and branches |
| `tsc --noEmit` | clean |
| Mutation: bring back the silent `breached → at_risk` | new test red (1). Reverted |
| Mutation: drop `computed !== stored` | 3 tests red. Reverted |
| CI (`gh pr view 330`) at the time of review | runs for `09305f1` still **in progress** (secret scan, helm, CodeQL, GitGuardian, Analyze are green; the rest are pending). This note's push starts a new run. The merge gate must check green CI on the final head |

### (1) Double-fire or wrong fire? (throwaway probes, deleted)

Each case below was scanned every 5 minutes with the cache written back after each tick.
The setup is the same as above: a 7-day, 08:00–20:00 Europe/London calendar and a
1440-minute resolution goal.

- **Full transition table** (all 36 stored × computed pairs): emits only for
  `{none, ok, met, missed} → at_risk|breached`, `at_risk → breached` and `breached → at_risk`,
  one event each. Pairs where the state stays the same, or moves to `ok`/`none`/`met`/`missed`,
  emit nothing. No pair emits two events.
- **Flapping** `ok → at_risk → breached → at_risk → breached → breached → at_risk → at_risk`
  emits `at_risk, breached, at_risk, breached, at_risk`. That is one event per real change,
  and none for the repeats.
- **DST fall-back with every tick scanned twice:** `at_risk@2026-10-25T17:00Z` and
  `breached@2026-10-26T11:05Z`. The duplicate-tick run is identical, so there is no double fire.
- **Pause/resume storm** (after the breach, a 10-minute pause every 20 minutes for 6 hours):
  no extra events. A pause going forward only freezes the clock. It never lowers the
  consumed share, so no retreat happens.
- **Retroactive pause** (a 4-hour pause on Sunday, recorded at Mon 13:00Z): `at_risk@13:00Z`
  and then a re-breach `breached@15:05Z`. This is exactly the retreat-and-re-breach that
  SLA-15's 2026-09-18 note describes.
- **`ok → breached` in one interval:** emits `sla.breached` **only**. This matches the spec.
  SLA-15 ties each event to "a transition into" its own state. An `ok → breached`
  transition goes into `breached`, not into `at_risk`, so emitting `at_risk` as well would
  report a state the scan never saw. I confirm the PR's boundary reading 1.
- **Reopen** (resolved at Tue 09:00Z while breached, reopened at 12:00Z): the cache goes
  `breached → missed → breached`, and `sla.breached` fires again at the reopen. This is L1,
  still as described.

### (2) Does the fix match the spec's transition rule?

Yes. The new condition is SLA-15 word for word: into `at_risk` → `sla.at_risk`; into
`breached` → `sla.breached`; a real change fires again, and a state that stays put fires
nothing. SLA-15a holds too: `met`/`missed` never emit from the scan.

### (3) L1 and L2

- **L1 — unchanged.** `missed → breached` and `met → at_risk` still emit (both measured).
  This is consistent with SLA-15's re-fire reading, but there is still no test.
  Recommendation unchanged: add one test that pins it.
- **L2 — unchanged.** Exactly-once delivery still depends on the job writing the new state
  in the same transaction as the emit, with `WHERE state = :stored`. This belongs to #329.
- **N1/N2** (zero or huge `target_minutes`, `main` code outside this diff): unchanged.

### D1 (LOW, trivial) — out-of-date doc comment

`ScanDecision.emit` is still documented as "0, 1, or 2 items". Under both the old rule and
the new one it holds at most **one** event. Fix it with the next change; it does not block.
