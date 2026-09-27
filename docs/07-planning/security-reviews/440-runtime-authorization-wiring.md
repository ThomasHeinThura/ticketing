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

---

## Security review — Opus delta (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `afea2848a5c0a4132`

**Reviewed head:** `315476f9fbf87f9b7824231771b4a202129b1ab0`

**Verdict: BLOCKING.** Do not merge. For the normal case the guard works, but a live
defeat test found two real gaps.

**B1 (BLOCKING, real, reproduced live): the guard fails open for two route shapes.**
`assertRouteIsClassified` silently returns (no refusal) whenever `attributedRouteKey`
returns `null`, which happens for (a) a route matched only by `ALL`-method entries
(`.all()`/`.mount()`), and (b) a route registered under a custom HTTP method outside
`HTTP_METHODS` (e.g. `PURGE`) — `normaliseRouteKey` throws, caught and turned into `null`.
Built the real `createApp()`, added two one-line unclassified route registrations below
the guard (an `.all()` route and a custom-method route), confirmed both are served (200)
instead of refused. No live exposure exists today (no such route currently registered
below the guard, and CI's own route-coverage check already flags both shapes as
uncovered), but this is exactly the shape a future regression would have, and this guard's
whole purpose is to be the backstop for that. **Fix, tried and reverted by the reviewer:**
take the first matched route whose raw `METHOD path` is not a declared-middleware key
(`"ALL /*"`, `"ALL /api/*"`), refuse only if no such route exists (genuine 404), and look
up the registry using the route's own registered method — `policyRegistry.get()` already
turns an unnormalisable key into `undefined`, so bad keys correctly fail closed. Verified
this fix gives 500 for all five unclassified shapes tested, 200 for GET/HEAD on the real
route, 404 for unknown paths.

**B2 (should-fix in the same change, real, reproduced live): real authenticated HEAD
requests now return 500.** Hono runs a HEAD request through the matching GET route, but
`c.req.method` stays `"HEAD"` — the guard looks up `"HEAD /api/…"`, finds nothing, and
refuses a genuinely real, previously-working request. Fails closed (not a security hole)
but contradicts the PR's own "no-op for every real request" claim. The same B1 fix (using
the matched route's own method) closes this too.

**Needs, before the fix lands:** `DECLARED_ROUTER_MIDDLEWARE` is not currently exported
from `packages/permissions/src/index.ts` — exporting it is a small, correctly-scoped
shared-contract touch the fix needs. Regression tests required: an `.all()` route, a
custom-method route, and a real HEAD request, all against the real `createApp()` — the
current test only covers a plain GET on a minimal app.

**Verified clean:** guard placement (inside the one existing `api.use("*")` guard, after
auth — health/openapi/`/auth/*`/`/config` intentionally exempt above the guard, confirmed
documented; websocket routes registered below, covered). Registry lookup (`get()` never
returns `null`/throws — the gap is entirely in route-key derivation, not the registry
itself). Single middleware registration (confirmed via diff, `packages/permissions`
untouched, `route-coverage.test.ts` passes). #256/#285 (confirmed independently — #285's
merge commit is on this branch, no fallback remains). Full suites: unit 61/496,
permissions (api) 13/83, permissions (package) 13/262, integration 103/1345 (one earlier
run showed 42 failures from a database contaminated by a concurrent lane — reproduced
clean on a fresh, unique database; likely the same root cause as issue #441's original,
now-corrected claim). `tsc --noEmit` clean on all three tsconfigs.

**"Not done" section correction needed:** the PR actually satisfies parts of 5 of #8's 9
"done when" items (1/4/5 already done pre-PR, 2 partially via shadow mode, 3 newly closed
by this PR pending B1's fix), defers items 6-9 — the PR body should list which items by
number rather than a rounded "closes one, defers eight" framing. Item 2 (runtime
consultation) is correctly only PARTIALLY closed — the guard checks entry-existence, but
the actual ALLOW/DENY decision stays shadow-only per the 2026-09-23 decision, unaffected by
this finding.

B1 is required. B2 should be fixed in the same pass (same root-cause fix closes both). A
fresh Opus delta pass is required on the new head.
