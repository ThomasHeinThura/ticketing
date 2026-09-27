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

---

## Security review — Opus delta 2 (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a000de76bd3810f04`

**Reviewed head:** `9ea468b6e7d9ca27c452f04b143fc81020523d32`

**Verdict: BLOCKING.** B1 and B2 are fixed. But the B1/B2 fix itself opens a new fail-open
gap in the same class — the prior pass's own recommended fix is what created it, not the
lane.

**B3 (BLOCKING, introduced by the B1/B2 fix, live-reproduced): a route-scoped `.use()`
middleware ahead of the real handler is itself picked as "the" attributed route.**
`attributedMatchedRoute`'s "first matched entry that isn't a DECLARED catch-all" rule
treats a scoped `.use()` middleware (e.g. `app.use("/api/foo/*", next)`) the same as a
real terminal route — its own key is not one of the two declared catch-alls, so if that
middleware's key happens to carry a registry entry, every UNCLASSIFIED route behind it
passes the guard using the middleware's clearance instead of its own (missing) one.
Live-verified: real `createApp()`, `app.use("/api/probe3/*", next)` then an unclassified
`app.get("/api/probe3/x", LEAK)`, with a policy entry given to the middleware's own key by
spying on `policyRegistry.get` — at `9ea468b`, 200 and the leak body served. The same gap
would also mis-evaluate shadow mode (evaluating the middleware's policy instead of the
real route's), though enforcement stays shadow-only today. Nothing is exposed in
production: the real router has no route-level `.use()`/`.all()` registration beyond the
two declared catch-alls, and no non-standard methods reach the registry as `ALL` keys —
this is the same "backstop for the day the invariant breaks anyway" standard the guard's
own B1 fix was held to.

**Fix, matching the reviewer's own live-verified trial:** walk every matched entry in
order, skipping only the two declared catch-alls; every `ALL`-method entry met along the
way must itself be classified (it can gate the request same as the two declared ones),
and the walk stops at — and also requires classified — the first non-`ALL` entry, the
actual terminal route Hono dispatches to. `assertRouteIsClassified` now checks every entry
the walk collects, not just the first. Implemented in commit `0a6c320`
(`shadow-middleware.ts`'s new `attributedRoutesToClassify`, consumed by
`route-classification-guard.ts`); `attributedMatchedRoute` (used by shadow-mode
evaluation) now returns the walk's LAST entry — the genuine terminal route — fixing the
same shadow-mode imprecision as a side effect. New regression test added
(`route-classification-guard-real-app.test.ts`, B3 case): a classified `ALL`-method
middleware ahead of an unclassified handler is refused (500); reproduced fail-then-pass by
reverting just the two source files.

**N1 (non-blocking, real, confirmed still present): `GET /api/invitation/{id}` now
500s for every authenticated caller.** This route is on the inherited-uncovered list
(`tests/permissions/inherited-uncovered.json`, `apps/api/src/invitation/policy.ts`'s own
"could not be confidently classified" comment) and sits below the guard — it has been true
since B1's own fix, not newly introduced by B3. The web app uses `/public/:id}` instead, so
no screen breaks; an API-key/MCP caller could be affected. The route exposed invitation
details (invitee email, workspace name, inviter name) to any logged-in user with no real
access check, so refusing it is arguably the right fail-closed outcome, not a regression —
but it settles a "needs a human decision" note that was previously left open, and makes
the PR body's "no-op for every real request" framing inaccurate. Disclosed in the PR body
below rather than silently left implicit.

Full suites reproduced on this head (fresh database, `td-lane-pg`): unit 61 files/496
tests, permissions 13/83, integration 104 files/1351 tests — all green. `tsc --noEmit`
clean on all three `apps/api` tsconfigs. `check-openapi.mjs` clean, 133 operations, no
drift.

B3 is required (fixed above). A fresh Opus delta pass is required on the head that fixes
it.
