# PR #440 — runtime authorization wiring (issue #8, P0 gateway)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis, real Bash/git
access)
**Session:** subagent `acaf4fd8692b7dfcd`

**Reviewed head:** `f44d17a7194c0e24f072484590ae1e0372f5598b` (branch since updated onto
latest `main`, see reconfirmation below)

**Verdict: APPROVE.** Confirmed the decision-log's 2026-09-23 "shadow until clean, then
strict" entry genuinely governs full ALLOW/DENY enforcement's deferral (gated on a 7-day
UAT soak that hasn't run) — not a convenient excuse. Confirmed `shadow-middleware.ts` is
genuinely already live in production (called from the real auth guard, read-only,
true no-op when the env flag is off). Confirmed `assertRouteIsClassified` is wired as a
single new call inside the SAME existing `api.use("*", ...)` guard — no second middleware
registration, `packages/permissions`'s `DECLARED_ROUTER_MIDDLEWARE` untouched by this
diff. Confirmed the guard only checks for `undefined` (no entry) and never inspects
ALLOW/DENY — it structurally cannot start enforcing anything beyond presence. Confirmed
`HTTPException(500)` matches an established, 30+-call-site project convention for
code-defect/defense-in-depth cases. Confirmed the new test boots a real minimal Hono app
and exercises both branches. Independently confirmed issue #256 (flat-target-provenance
fallback hazard) is already closed by merged PR #285, not just trusted from the PR's own
account. Confirmed the "Not done" section is honest about deferred scope (full
enforcement, RowScope/RequestScope retrofit) rather than overclaiming #8 is closed.

**Two findings, both addressed:**
- Process: branch was stale relative to `main` — updated before commissioning Opus, to
  avoid a post-review invalidation (see reconfirmation below).
- Accuracy: the PR's own integration-test claim ("4 pre-existing failures, verified by
  revert") did not reproduce against a fresh Postgres, either in the reviewer's own run or
  in this project's live CI check-run for the exact reviewed SHA (both zero failures,
  103 files / 1345 tests). Corrected in the PR body. Issue #441 (filed on the original
  claim) has been corrected with this finding.

Full suites reproduced: unit 61 files/496 tests, permissions 13/83, `tsc --noEmit` clean
on all three `apps/api` tsconfigs.

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `336631ce65f3dde8eabd333ec3156b66dd666f46`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Branch updated onto latest `main` (which had advanced with
#430/#432/#433/#439) via a clean automatic merge (no manual conflict resolution needed).
`git diff f44d17a7194c0e24f072484590ae1e0372f5598b..336631ce65f3dde8eabd333ec3156b66dd666f46`
scoped to `apps/api/src/index.ts` and `apps/api/src/permissions/**` is empty. `tsc --noEmit`
re-run clean. This is the head the mandatory Opus pass should review.

## Security review

**Model:** PENDING — Opus, mandatory (touches `apps/api/src/index.ts`'s auth guard and
`apps/api/src/permissions/**`)
**Session:** PENDING
