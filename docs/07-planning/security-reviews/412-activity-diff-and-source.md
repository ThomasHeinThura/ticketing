# PR #412 — null-vs-epoch activity diff and derived event source (issue #298 S1/S2)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (fell back from `pal-mcp` after two
300s timeouts)
**Session:** subagent `aedc6276ace8159b6`
**Verdict: APPROVE (after fix)**, at head `3c8aadeb71f9fe841eae6744cda9214d3a383202`.

**Reviewed head:** `3c8aadeb71f9fe841eae6744cda9214d3a383202`

## Security review

**Model:** Opus 5.5
**Session:** subagent `a24fbd3126a50e089`
**Verdict: CLEAR WITH FINDINGS (F1 fixed in this PR)**, reviewed at head
`3c8aadeb71f9fe841eae6744cda9214d3a383202`.

Confirmed `valuesDiffer`'s null-check has one caller, fires before any earlier code can
skip it, and changes behavior only for the date fields at exactly the epoch. Confirmed
`resolveActor` can only return `"api_key"` or `"person"` today, and `eventSourceFor`'s
exhaustive switch makes a future third actor type a compile error. Ran the target test
file (17/17), full API integration suite (1264 tests), API unit suite (490 tests) — all
green. Confirmed via mutation testing that 3 of the 4 new tests fail without the fix.

**F1 (low, fixed in this PR, commit `dfaaf833daf7973857623846423c7d8e25c24663`):**
`eventSourceFor(actorType)` originally ran after the transaction had already committed —
so a hypothetical unmapped actorType would 500 a client whose item was already saved,
risking a duplicate on retry. Moved before the transaction starts.

**Surfaces examined:** `apps/api/src/work-item/activity.ts`'s `valuesDiffer` and
`DIFFABLE_FIELDS`; `apps/api/src/work-item/controllers/create-work-item.ts`;
`apps/api/src/work-item/index.ts`'s `resolveActor`; the 4 new integration tests.

## Lightweight re-confirmation after F1 fix (2026-09-27)

A fresh, independent delta-review of this fix is being commissioned separately (per this
project's rule that a functional code change cannot be self-certified by the session that
made it) — see the PR's own comments for the actual verdict once recorded.

---

## Independent delta-review of the F1 fix (2026-09-27)

**Reviewed head:** `91159cd991f3044936c8232789832a8bc4e66fd4`
**Reviewer:** Opus 5.5, fresh independent context (subagent `ab24662fdee77001f`)
**Verdict: CLEAR.** Confirmed `eventSourceFor(actorType)` is now the first statement after
input destructuring, before every database read/write including the transaction. Confirmed
`actorType` is never reassigned and this route is `createWorkItem`'s only caller. Ran the
full integration suite in a fresh worktree with a dedicated database (`pr412_delta_test` on
`td-lane-pg`): 13 files, 520 tests, all passed. Typecheck clean.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `4f7277e0c0a5f55a935b4bf2424848ff58a585c2`
**Reviewer:** orchestrating session (verified by direct inspection, not a clean-diff claim)
**Verdict:** CLEAR, unchanged. The intervening merge brought in #404's own already-reviewed
`isUniqueViolation` exact-match fix, which touches the SAME file
(`create-work-item.ts`) as this PR — not a zero-diff situation. Read the full current
function directly to confirm the two changes are genuinely disjoint and non-interacting:
#404's change is confined to the transaction's `catch` block (matching the exact
`work_item_key_claim_pkey` constraint name instead of a substring), while this PR's changes
are the pre-transaction `eventSourceFor(actorType)` call and the post-transaction
`publishEvent` call's `source` field — different variables, different control-flow paths,
no shared state. `activity.ts` (this PR's other touched file) has no diff at all between the
last reviewed head and this one.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `f3896db13291e43f3c8deed0fb9f858bf0be8c3b`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty diff on `apps/api/src/work-item/activity.ts` and
`apps/api/src/work-item/controllers/create-work-item.ts` between the last reviewed head
(`4f7277e0c0a5f55a935b4bf2424848ff58a585c2`) and this one — the intervening commits bring in
#405's already-reviewed schema-drift fix, zero overlap with this PR's own files.
