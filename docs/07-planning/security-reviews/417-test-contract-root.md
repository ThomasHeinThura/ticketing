# PR #417 — test-contract.mjs repoRoot fix (issue #415)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis — implementing lane
is Sonnet per this project's standing convention; reviewed together with sibling PR #419
since both touch the same root-resolution area)
**Session:** subagent `a7381120a5e7cf93e`

**Verdict: APPROVE** as a standalone fix. Confirmed the bug against the actual pre-fix
file (the exact #399-shaped derivation), confirmed the fix is a complete replacement
(`run()` is the single `cwd` choke point; no leftover file-location-derived path remains),
confirmed the new regression test is real (spawns a genuine two-scratch-repo scenario,
imports the actual exported helper).

**One real cross-PR finding (fixed, commit `76a91a2`):** this PR's own new test fixture
built its `callerDir` via `initRepo()` alone, without `installCheckers()` — so once #419's
checkout-marker check landed, this test would break regardless of merge order. Fixed by
mirroring the same `installCheckers(callerDir)` call #419 already applies to its own two
analogous call sites.

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a2479726293664064`

**Reviewed head:** `76a91a2471373859100783e0166f6ce9b7914393`

**Verdict: CLEAR.** Fix confirmed correct and complete — `test-contract.mjs` no longer
computes its own root; both the `run()` cwd and the approved-breaks read now use
`repoRoot`; no other checker in `scripts/ci` computes its own root. Confirmed the new test
genuinely catches the bug (reverted the fix in scratch, confirmed the probe fails).
Confirmed the cross-PR fixture fix genuinely closes the interaction: merged #419's head
into a scratch clone of this PR's head, confirmed `test-contract-root.test.mjs` passes on
the combined code, then confirmed removing the `installCheckers(callerDir)` line makes it
fail on the same combined code — proving the fix is load-bearing, not coincidental.

Full suite: 784/784 passed. One CI-only caveat noted: the `unit + component` job showed a
red `workspace-role-unique-schema-drift.test.ts` failure at review time, confirmed
unrelated to this diff (a drizzle-kit schema-drift test, not touched by this PR) — needs a
clean re-run before merge, not a finding against this PR.

Clear to merge once CI is green (including the unrelated job above).
