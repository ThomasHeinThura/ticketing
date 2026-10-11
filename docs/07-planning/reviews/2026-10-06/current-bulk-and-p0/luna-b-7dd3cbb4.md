# Independent ordinary review — domain and concurrency

- Candidate: `7dd3cbb461e9a6567acb07eda64cd3bbaaac54de`
- Base: `3096cb044bdf6ae98488bfc385f532fa6386343a` (verified ancestor and exact merge-base)
- Reviewer: fresh independent GPT-6 Luna context; no authoring or remediation
- Scope: approvals lifecycle and gate locking; SLA/calendar computation; reminder scan; notification outbox reservation, eligibility recheck and provider-attempt fencing. Extra coupling review of work-item transition approval locking.
- Verdict: **BLOCKED — one P1 domain correctness finding**

## Checks performed

- Read repository operating guides, current decision log, relevant feature contracts, and the frozen diff.
- Ran `pnpm --filter @taskdesk/domain exec vitest run src/sla/sla.test.ts`: **1 file, 30 tests passed**. Existing tests cover pauses within a covered window and open pauses starting within covered time, but not pauses spanning the gap before the next window.
- Inspected exact candidate source; no changes made.
- SQL integration, full DB/API suite, image/runtime and product-screen checks were not run in this review context.

## Findings

### [P1] SLA due-time calculation ignores pauses beginning before the next calendar opening

`packages/domain/src/sla/sla.ts:159-162` selects the next pause only when `startedAt > opening`. If a pause begins after the SLA start but during uncovered hours, then extends into the next covered window, it is discarded. The same strict comparison discards a pause beginning exactly at the opening.

Reproduction from the existing 8×5 London calendar: `from = 2026-09-18T17:00:00Z` (Friday 18:00 BST, after close), target 60 minutes, and a closed pause from Friday 19:00 BST through Monday 10:00 BST. The next opening is Monday 09:00 BST; current code selects no pause and returns Monday 10:00 BST. Correct due time is Monday 11:00 BST because the 09:00–10:00 interval is paused. With the same start and an unclosed pause beginning Friday 19:00 BST, the function returns a due time even though the open pause freezes the clock; it should return `null`.

This makes the SLA API report an incorrect commitment for paused items and can trigger at-risk/breach decisions early. The pause search must account for overlap with the active/future covered stretch, including pauses already underway by its opening.

