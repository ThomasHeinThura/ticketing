# Security review — PR #235 (issue #165: `test:permissions` must run without `apps/web/dist`)

**Reviewed head:** `d80f568680725d7f92b836cf7da64a17f9db60da`

Independent Opus pass, fresh context — did not author, direct or remediate this change.
Reviewed in an isolated worktree checked out at that exact commit, not `main`.

## What this PR does

Closes issue #165 by **documenting** a running constraint rather than changing code:
`pnpm test:permissions` must run against a router built with no web build on disk, because
`registerStaticServing` (`apps/api/src/index.ts`) adds a third `app.use("*", …)`
registration when it finds one, colliding with `DECLARED_ROUTER_MIDDLEWARE`'s declared
exact count of 2 at `"ALL /*"` (CORS, compress). Four files, **+60 / −0**, comment and prose
only.

Three of the four touched files are in the security-review path list
(`docs/04-engineering/ci-cd.md`): `packages/permissions/**`, `apps/api/src/index.ts` and
`docs/04-engineering/ci-cd.md` itself — not only `route-coverage.ts`.

## Verdict

**CLEAR WITH FINDINGS (non-blocking).** No defect introduced, no gate weakened, no test
expectation adjusted, and the factual claims the decision rests on are correct. Three
findings below argue the documentation is *necessary but thin* — none of them blocks this
merge, and F1 is worth a follow-up issue.

## 1. The diff really is comment/doc-only — confirmed

`git diff dc0dde6…d80f568` read hunk by hunk. Every added line is inside an existing block
comment (`apps/api/src/index.ts`, `packages/permissions/src/route-coverage.ts`) or is
Markdown prose (`docs/04-engineering/ci-cd.md`, `tests/permissions/README.md`). Zero
deletions, zero modified lines, no executable statement anywhere — including in
`apps/api/src/index.ts`, whose hunk lands wholly inside `registerStaticServing`'s existing
JSDoc, above the `function` keyword.

Head `d80f568` is a merge commit; its two parents are `33d9728` (the one code commit) and
`dc0dde6` (current `origin/main`). `git diff 33d9728 d80f568` is exactly main's
decision-log commit (#234) and nothing else, and `git diff origin/main d80f568 --name-only`
is exactly the four files. The merge smuggled nothing in.

## 2. The 79/79 ↔ 76/79 claim — independently reproduced

Run myself at `d80f568`, in a private worktree, `pnpm install --frozen-lockfile`:

| State | Result |
| --- | --- |
| `apps/web/dist` absent | **10 files / 79 tests, all pass** (`[static] No built web app found`) |
| after `pnpm --filter @taskdesk/web build` | **3 failed / 76 passed (79)** (`[static] Serving the built web app from …/apps/web/dist`) |
| `dist` removed again | **10 files / 79 tests, all pass** |

The three failures are all in `tests/permissions/route-coverage.test.ts`:

- `counts middleware as middleware, not as routes` — `expected [ 'ALL /api/*' ] to deeply
  equal [ 'ALL /*', 'ALL /api/*' ]`
- `accounts for every surface the router exposes` — `root: expected +0 to be 1`
- `2: STILL FAILS when a new route's key is appended to the baseline in the same diff` — its
  own vacuity pre-check `expect(hiddenResult.ok).toBe(true)` inverts

The PR's reported numbers are exact. Being doc-only, it changes neither.

## 3. Is "document it" the right call, or a live gap?

### Direction of failure — traced, not assumed

`isMiddlewareEntry` is used in exactly three places: `collectRoutes` (skip), 
`collectMiddleware` (keep), and `authGuardRegistrationIndex` (match at `AUTH_GUARD_KEY`).
When the `"ALL /*"` declaration is voided, those entries stop being skipped and flow into
`collectRoutes` as ordinary routes. `"ALL /*"` is a wildcard, so `computeRouteCoverage`'s
wildcard arm takes it **before** any registry lookup: with no `delegated` policy it lands in
`unclassified`, one of the six conditions that make `ok` false. It never lands in `covered`.

So the primary direction is **fail-closed** — more scrutiny, not less — and I verified it
empirically: with `dist` present, `result.uncovered` is still empty and the
`has a policy for every route` assertion still passes, because the entries went to
`unclassified`, exactly as the code says they should.

`AUTH_GUARD_KEY` is `"ALL /api/*"`, a different key, so the static registration cannot
change the guard's declared count, cannot make `authGuardRegistrationIndex` return
`undefined`, and cannot silently disarm the H2 ordering check. Registration indices all
shift by the same amount, so relative order — the only thing H2 reads — is preserved.

Both obvious wrong "fixes" also fail loudly in the configuration CI actually runs: raising
the declared count to 3 breaks the `dist`-absent case (2 ≠ 3), and adding a `delegated`
policy for `"ALL /*"` to silence the `unclassified` row produces an `orphanedPolicies` row
when the entry is middleware again. The one genuinely dangerous "fix" — relaxing the exact
count to `>=` — is precisely what the added comments tell a future reader not to do, so the
comments carry real defensive weight.

### F3 — one compound fail-open path exists (non-blocking)

The count check is satisfied by a *number*, not by identity. If the static registration is
present **and** CORS or compress is ever removed or relocated, the count returns to 2, the
declaration is satisfied again, and the static `app.use("*", …)` catch-all — a real,
request-answering surface serving files from disk — is silently classified as reviewed
middleware, while the disappearance of CORS goes unseen by this gate. That is the
same-count-substitution limitation `isMiddlewareEntry`'s own doc comment already admits;
what running with `dist` present adds is a way to reach it *by accident* rather than by
malice. Two independent faults are required, and CORS has its own tests, so this is a real
but remote fail-open — recorded, not blocking.

### CI sweep — no job builds the web app before this check today

Both workflows read in full, not just the job the PR names.

- `ci-fast.yml`: `route-policy` (`pnpm check:route-policy` → `pnpm test:permissions`) is its
  own job on its own runner and builds nothing; `build` (`pnpm build`) is a separate job on
  a separate runner; no other job runs `test:permissions`.
- `ci-full.yml`: does not run `test:permissions` at all.
- `turbo.json`: `test:permissions` `dependsOn: ["^build"]`, and the task exists only in
  `apps/api`, whose workspace dependencies are `@taskdesk/email` and `@taskdesk/permissions`.
  `@taskdesk/web` is a dependency of **no** workspace package (grepped every
  `package.json`), so `^build` can never pull the web build in.

The PR's "not live in CI today" claim holds. **But it is live outside CI**, and the PR does
not say so: `scripts/ci/test-all.mjs` runs its manifest sequentially in the repo root, with
`pnpm test:permissions` at one index and `pnpm build` at a later one. A first `pnpm test:all`
on a clean tree passes; a **second run leaves `apps/web/dist` in place from the first**, and
`test:permissions` goes red. Same for anyone who runs `pnpm build` locally and then the
permissions suite. That is a today-reachable footgun in the project's own "run every gate
locally" command, not only a future-pipeline hazard.

### F1 — an assertion is available and cheap (non-blocking; recommend a follow-up issue)

Documentation is the weaker half of this project's own rule: a code defect gets a test, a
process defect gets a sentence, and sentences are what agents route around. The materials
for a test are already here — `resolveStaticRoot` is **exported from
`apps/api/src/index.ts` specifically so tests can call it**. One assertion in
`tests/permissions/route-coverage.test.ts` —

```ts
expect(resolveStaticRoot(), "a built web app is on disk; test:permissions must run without one (#165)").toBeUndefined();
```

— converts three oblique failures into one attributable message, catches the misconfiguration
at its cause, and closes the accidental route into F3. The PR considered options 1 and 2 from
the issue and did not consider this third one. I would not hold the merge for it: this PR
introduces nothing, and the assertion is a separate, small change. It should be an issue.

### F2 — the failure is loud but mis-attributable (non-blocking, pre-existing)

The real-app `route coverage` describe block never asserts `result.ok` or
`result.unclassified` directly — only `uncovered`, `orphanedPolicies`, the baseline pair and
`authGuardOrderingViolations`. An `unclassified` wildcard therefore surfaces only
*indirectly*, through surface arithmetic (`root: expected +0 to be 1`) and the middleware
list equality. None of the three messages names static serving, `apps/web/dist` or #165, and
one of them is a vacuity pre-check inverting, which reads like a broken test rather than a
finding. A reader who does not already know the mechanism has to reach the README to
understand it. This is pre-existing and not caused by this PR, but it is why F1's one-line
assertion is worth more than the prose it would sit beside.

## 4. `isMiddlewareEntry` characterization — accurate

Read the function and the list directly rather than the PR's paraphrase.
`isMiddlewareEntry` requires `isAmbiguousWildcardAll`, an exact key match on
`DECLARED_ROUTER_MIDDLEWARE`, and `actualCounts.get(key) === declared.registrations` — a
strict equality, no tolerance. Its doc comment states the intent in as many words: an extra
registration at a declared key "voids the declaration for **every** entry sharing that key,
rather than quietly keeping one of them exempt." The list holds **two entries** covering
three registrations (`"ALL /*"` × 2, `"ALL /api/*"` × 1). The PR's reasoning — that
absorbing a filesystem-conditional registration would make the declared count itself
conditional, which is the drift the strict count exists to refuse — is a correct reading of
both the code and its stated design intent, not a rationalization.

(Cosmetic, PR body only: the review section says "`DECLARED_ROUTER_MIDDLEWARE`'s existing
three entries"; there are two entries and three registrations. The code comments are
correct.)

One accuracy note on the new prose: the constraint is slightly broader than "`apps/web/dist`".
`resolveStaticRoot`'s first candidate is `<repo root>/public` (`../../../public` from
`apps/api/src`), so a repository-root `public/index.html` triggers it too. All four added
comments do mention the `/app/public` production equivalent, so this is covered in substance.

## 5. Scope check — clean

Four files, as claimed, and nothing else. No test file, fixture or baseline touched:
`tests/permissions/inherited-uncovered.json`, `tests/permissions/matrix.fixture.json` and
every `*.test.ts` are absent from the diff. No expected/actual count anywhere was adjusted —
the 79-test baseline is unchanged and was re-derived from a live run, not read off the PR.
No masked regression.

## Summary of findings

| # | Finding | Severity |
| --- | --- | --- |
| F1 | Doc-only closes #165 with a sentence where a one-line assertion is available (`resolveStaticRoot` is already exported for tests); the footgun is reachable today via a repeat `pnpm test:all` or any local `pnpm build` first | Non-blocking — recommend a follow-up issue |
| F2 | The real-app suite never asserts `result.ok` / `result.unclassified`, so the failure arrives as three oblique messages naming neither static serving nor #165 | Non-blocking, pre-existing |
| F3 | Compound fail-open: with the static registration present, removing CORS or compress restores the count to 2 and silently re-exempts a real request-answering catch-all | Non-blocking, remote (two independent faults) |

**Verdict: CLEAR WITH FINDINGS (non-blocking).**

---

## F1 fixed in this same PR — 2026-09-22 (orchestrating session, self-verified)

F1's suggested assertion was small and precisely specified enough to add directly rather
than only file as a follow-up (issue #236 filed regardless, so the reasoning has a durable
home). Added `loadResolvedStaticRoot()` to `tests/permissions/api-app.ts` (calling the
real, already-exported `resolveStaticRoot()` with its production default candidates) and a
new first-class test in `route-coverage.test.ts` asserting it resolves `undefined`.
Verified directly: with `apps/web/dist` absent, 80/80 (was 79/79, +1 for the new test);
with `apps/web/dist` built for real, the new assertion fails first and by itself with a
message naming the actual directory found (`AssertionError: expected
'.../apps/web/dist' to be undefined`) — the exact "one attributable message instead of
three oblique ones" F1 asked for. Also closes F3's compound fail-open path, since the
suite now fails at this assertion before ever reaching the weakened-declaration scenario.
F2 (a pre-existing gap in what the real-app suite asserts) and the general "should this be
a code fix vs. documentation" question remain as issue #236 background, not fully closed —
this is a net-positive addition on top of the doc-only fix, not a claim that #236 is done.

**Reviewed head:** `<to be set once this commit lands>` — self-verified only; this addition
has not had its own independent review pass. Flagging plainly rather than implying it has.
