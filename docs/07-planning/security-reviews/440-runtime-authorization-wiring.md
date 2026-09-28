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

---

## Security review — Opus delta 3 (2026-09-27)

**Model:** Opus 5.5, fresh independent context (did not write, direct or fix any part of
this PR)
**Session:** subagent `a7353c095b6bdf8fe`

**Reviewed head:** `738e2f4c8b5a9174732b6806c6709860841a9782` (docs-only; the code under
review is fix commit `0a6c320`)

**Verdict: BLOCKING.** B3 is fixed, and holds against every `ALL`-method shape tried. But
a **fourth instance of the same class**, reproduced live: the guard's walk stopped at the
first matched entry whose method is not `ALL`, assuming that entry is the one that
actually answers. In Hono, a GET/POST/other specific-method handler can call `next()` and
hand the request on, exactly like `.use()` does — nothing enforces that a non-`ALL`
handler is terminal.

**F4 (BLOCKING, same class as B1/B3, reproduced live):** three shapes, each with the
first registration given a real policy entry (spying `policyRegistry.get`, same technique
as prior passes): a classified GET pass-through (`app.get("/api/gm/*", (c, next) =>
next())`) fronting an unclassified `app.get("/api/gm/x", LEAK)` — 200, leak served; a
classified multi-method pass-through (`app.on(["GET","POST"], ...)`) fronting an
unclassified POST — 200, leak served; a classified parameter route that conditionally
calls `next()` (`app.get("/api/pr/:id", ...)`) fronting an unclassified literal sibling —
200, leak served. The third shape is the most realistic (a common Hono idiom, followed
later by a literal route added without a policy). Live exposure today: none — the real
route table's only `ALL`-method entries are the two declared catch-alls, and grepping
`apps/api/src` found every `next()`-calling handler shares its own route's key (same
"backstop for the day the invariant breaks" standard as B1/B3).

**Recommended fix (change altitude, per CLAUDE.md — third round finding the same fault in
one function):** stop predicting which matched entry is terminal, entirely. Require every
matched entry except the two declared catch-all keys to be classified, with no early
stop. Shadow-mode attribution must NOT switch to this same unbounded walk — it needs the
bounded first-non-`ALL` entry, or it misattributes (`GET /api/invitation/pending` also
matches `GET /api/invitation/{id}`'s parameter pattern; taking the walk's last entry would
misattribute every `/pending` request to the wrong policy).

**One real cost that needed a human decision:** applying the stricter guard makes `GET
/api/invitation/pending` also require `GET /api/invitation/{id}` to be classified (both
match the same request), and `{id}` was still deliberately uncovered — pending a decision
this project had left open since 2026-09-22 on whether to give it a real access check,
delete it, or declare it intentionally open. Put to Thomas directly: **delete it.**
Fixed accordingly (commit `8baa78f`): `attributedRoutesToClassify` now checks every
matched entry unconditionally (no early exit); `attributedMatchedRoute` (shadow-mode's
own, separate, bounded-prediction caller) reverted to the original first-non-`ALL`-entry
behaviour; `GET /api/invitation/{id}` deleted (route, controller, dead schema export,
`inherited-uncovered.json` entry, `policy.ts`'s own doc comment all updated) rather than
classified — it had zero real callers (`apps/web` checked), returned the same
invitee-email/workspace-name/inviter-name as the fully public `GET
/api/invitation/public/{id}` with no recipient check of its own, and already 500ed for
every authenticated caller regardless (N1, unchanged since the B1/B2 fix) — deletion
closes a real, disclosed info-leak rather than reopening the classification question a
fourth time.

New regression tests: three F4 probes (GET pass-through, multi-method pass-through,
parameter-route-conditionally-calling-next), each refused (500), reproduced fail-then-pass
by reverting just the two source files; plus a direct test that `GET
/api/invitation/pending` still returns 200 now that its former sibling is gone.

Full suites reproduced at commit `8baa78f`: unit 61 files/496 tests, permissions 13/83,
integration 104 files/1355 tests — all green. `tsc --noEmit` clean on all three `apps/api`
tsconfigs (including `tsconfig.tests.json`). `check-openapi.mjs` clean, 132 operations (one
fewer than before — the deleted `getInvitationDetails` operation), no drift.

F4 is required (fixed above, including the invitation-route deletion Thomas approved). A
fresh Opus delta pass is required on the head that fixes it.

---

## Security review — Opus delta 4 (2026-09-28)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a20763d81bfa2747e`

**Reviewed head:** `81c71dbf416b5f12d55f34484c86bd3275ff09fb` (docs-only; the code under
review is fix commit `8baa78f`)

**Verdict: BLOCKING.** F4 is fixed and could not be broken by new adversarial shapes
(overlapping routes, nested mounts, exotic HTTP methods including a real WebSocket
upgrade, 300 concurrent requests). But a **fifth instance of the same class**, live-
reproduced, no registry spy needed this time.

**F5 (BLOCKING, live-reproduced): exempting a matched entry by its raw key string
(`ALL /*` / `ALL /api/*`) assumed the key identifies the reviewed CORS/compress/static-
serving/auth-guard middleware — it only identifies WHERE something is mounted, not WHAT
runs there.** Five shapes, none classified, none needing a spy: a stray
`app.all("/api/*", LEAK)` fallback; a `.use("/api/*", ...)` that itself answers a
request; `app.mount("/api", handler)`; a sub-router's own `.all("*")` mounted at `/api`
(the same shape a real router mounted via `api.route("/", ...)` would produce); a bare
`app.all("*", LEAK)`. All five: 200, leak served. A control case, `app.get("/api/*",
LEAK)` (a specific method, not `ALL`), correctly 500ed — confirming the gap was
specifically about the KEY, not about method generally. Live exposure today: none (the
real router has exactly the declared registrations; CI's route-coverage strict count
independently catches an added `ALL`-method registration, confirmed by temporarily adding
one and watching 5 coverage tests fail).

**Fix (commit `085ebeb`), the recommended structural close, not another patch:** stop
predicting which matched entry is safe to skip, entirely — check by IDENTITY. `createApp()`
now calls a new `declareCatchAllMiddleware()` on the exact function reference of each of
its four reviewed catch-all registrations (CORS, compress, the conditional static-serving
fallback, and the auth guard itself) at the moment each is created, before `.use()`. A
matched entry is exempted only when `r.handler` is one of those exact references —
identity, which `app.route()` preserves, never a string, method or position anything else
could coincidentally share. Shadow-mode's own bounded single-route prediction
(`attributedMatchedRoute`) uses the same identity set, keeping its existing bounded
(first-match) semantics — only the exemption TEST changed, not how far either function
walks. Consolidated four stacked, increasingly-stale doc comments into one current
description of the mechanism and its full B1→F5 history.

New regression tests (F5-D1 through D5): all five shapes refused (500), fail-then-pass
reproduced by reverting just the two source files. One pre-existing unit test
(`route-classification-guard.test.ts`) needed its own minimal fixture updated to declare
its own guard-wrapper middleware, the same way production now declares its four —
otherwise the guard would refuse its OWN test harness as "an unclassified route."

Full suites reproduced at commit `085ebeb`: unit 61 files/496 tests, permissions 13/83,
integration 104 files/1360 tests — all green. `tsc --noEmit` clean on all three
`apps/api` tsconfigs. `check-openapi.mjs` clean, 132 operations, no drift.

F5 is required (fixed above). A fresh Opus delta pass is required on the head that fixes
it — the fifth in a row on this one mechanism; if this pass finds nothing further, this
closes issue #8's runtime-authorization-gateway obligation.
