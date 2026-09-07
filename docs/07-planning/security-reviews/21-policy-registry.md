# Pre-merge security review — PR #21 (policy registry, evaluator, route coverage)

**Status of the gate:** this review ran **before** merge, and is complete. PR #21 creates
`packages/permissions/**` and the first `policy.ts` declarations — squarely inside the
`ci-cd.md` security-review path list. Four independent Opus reviews were performed across
three different heads. The current head is **cleared for Thomas's merge decision**; nothing
here is a merge, and nothing here waives a gate.

**Reviewed at:** three heads, in sequence — `f3cd609` (initial, two lenses), `5956fb3`
(final re-review), `b950e26` (focused delta). Merge base `04e3a55` throughout, unchanged.
**Each review saw exactly one head, and the clearance attaches to the head that was seen.**
The chain is set out below precisely so that no reader can infer a review covered code it
never read.

**Method:** every reviewer was a fresh Opus 5 session with no involvement in writing the
code, given a distinct lens and told to find defects rather than bless work. All four worked
from source in a read-only worktree pinned at the head under review, wrote their **own**
oracles, harnesses and generators rather than re-running the author's tests, and re-ran every
gate non-cached. Findings were reproduced as failure modes, not read off diffs.

**Reviewer independence caveat, stated plainly:** the same orchestrating session that drove
this branch's remediation also spawned these reviewers. Each was a separate session with
fresh context and no knowledge of the authoring rationale — which satisfies "a different
session" — but it is not an outside pair of eyes, and it is not recorded as one. Two of the
four reviewers corrected the orchestrator on substance during this branch's life, which is
some evidence the independence was real; it is not proof. **Thomas should treat the
CRITICAL/HIGH list as needing his own confirmation.**

---

## The review chain — which head each review actually saw

| # | Review | Head reviewed | Posted | Verdict at that head |
| --- | --- | --- | --- | --- |
| 1 | [Route-coverage lens (1 of 2)](https://github.com/ThomasHeinThura/ticketing/pull/21#issuecomment-5558192660) | `f3cd609` | 2026-09-06 09:00Z | **Not merge-ready** — 1 CRITICAL, 3 HIGH, 2 MEDIUM, 3 LOW |
| 2 | [Policy-core lens (2 of 2)](https://github.com/ThomasHeinThura/ticketing/pull/21#issuecomment-5558216412) | `f3cd609` | 2026-09-06 09:05Z | **Not merge-ready** — 3 HIGH, 5 MEDIUM, 4 LOW; ReDoS fix **CLEARED** |
| 3 | [Final independent re-review](https://github.com/ThomasHeinThura/ticketing/pull/21#issuecomment-5560588530) | `5956fb3` | 2026-09-06 16:30Z | **CLEAR FOR THOMAS MERGE DECISION** — six must-fix VERIFIED-CLOSED; 1 new MEDIUM, 2 new LOW |
| 4 | [Focused delta re-review](https://github.com/ThomasHeinThura/ticketing/pull/21#issuecomment-5564976026) | `b950e26` | 2026-09-07 04:20Z | **CLEAR FOR THOMAS MERGE DECISION** — MEDIUM-1 VERIFIED-CLOSED; 3 new LOW |

**Remediation commits between review 2 and review 3:** `c8785cd` (findings 1, 2) ·
`e45584b` (3, 5) · `f7dd722` (4, 6) · `a4a8481` (a `pnpm typecheck` failure introduced by
this PR's own ReDoS fix) · `c57abe1` (finding 4 completed — the provenance-free fallback
removed) · `5956fb3` (four further fail-opens, a disclosure gap, and the MEDIUM/LOW sweep).
**Between review 3 and review 4:** `b950e26` alone.

Three statements this note will not blur:

- **Reviews 1 and 2 never saw any remediation.** Every finding they raised was raised against
  `f3cd609`. Their verdict was *not merge-ready*, and that verdict was correct for that head.
- **Review 3 never saw `b950e26`.** Its clearance covers `5956fb3` and nothing after it. It is
  the review that *found* the defect `b950e26` fixes.
- **Review 4's scope was the delta plus a blast-radius check**, not a fresh whole-branch
  review. It re-proved that none of the six invariants cleared at `5956fb3` were reopened; it
  did not independently re-derive them. Reviews 3 and 4 together cover the current head.
  **No clearance transfers to any later commit.**

---

## Totals

| Severity | Count | Disposition |
| --- | --- | --- |
| **CRITICAL** | **1** | **Fixed in `c8785cd`; VERIFIED-CLOSED at `5956fb3`** |
| HIGH | 6 | 4 fixed and VERIFIED-CLOSED; 1 tracked to **#8**; **1 with no disposition — see H2** |
| MEDIUM | 7 | 1 elevated to must-fix and closed; 4 fixed; 1 verified not applicable; 1 follow-up |
| LOW | 7 | 6 fixed; 1 already addressed by a HIGH fix |
| *Raised after remediation* | 1 MEDIUM, 5 LOW | MEDIUM VERIFIED-CLOSED; 5 LOW open, none blocking |

21 findings at `f3cd609`, plus six raised by the two later reviews.

**A counting trap, named so nobody walks into it.** The PR body speaks of *"the six must-fix
findings"* and *"all fourteen MEDIUM/LOW"*. Those two sets are **not** `1 CRITICAL + 6 HIGH`
and `7 MEDIUM + 7 LOW`. Must-fix #6 was **elevated from a MEDIUM** (the custom-role test
below), and it is counted in both tables. Two of the six original HIGHs are therefore outside
the must-fix six: **H2** and **H3**.

---

## CRITICAL

### C1 — `isMiddlewareEntry` deleted reachable terminal routes from the enumeration · VERIFIED-CLOSED

`packages/permissions/src/route-coverage.ts`. The classifier read *ALL + wildcard + arity ≥ 2*
as middleware, so `collectRoutes` skipped it and no policy was ever required. Two ordinary
shapes hit it — a terminal `app.all("/api/x/*", async (c, _next) => …)` that never calls
`next`, and **`app.mount(path, handler)`**, Hono's first-class API for mounting an external
app, implemented as `all(mergePath(path, "*"), …)`. `Function.length` counts declared
parameters; it is not a signal of terminality. The probe showed two endpoints answering
**HTTP 200** while `collectRoutes()` returned **zero** route keys, filed under "middleware" so
they did not appear in the human report at all.

**Found independently by both reviewers**, which is why it was treated as the most certain
finding in either report. The docstring and `tests/permissions/README.md` both asserted the
opposite guarantee.

**Fix (`c8785cd`):** arity is gone. An entry's exact `METHOD path` key must appear on
`DECLARED_ROUTER_MIDDLEWARE` **and** the router must hold precisely the declared number of
registrations at that key. An entry at an **undeclared** key is a route until a human says
otherwise; an **extra** registration crowding a declared key voids the declaration for every
entry sharing it. An `unclassified` bucket was added, and `result.ok` requires it empty.

**Independently verified at `5956fb3`:** a real `app.mount()` bolted onto the **real** API
router surfaces as `ALL /legacy/*`, lands in `unclassified`, `ok:false`. The trap is closed in
all three directions — a **capability** policy, a **public** policy and a **baseline entry**
each fail to clear a wildcard. Only a `delegated` policy clears one. Non-`ALL` wildcards
(`GET /files/*`) are equally uncoverable.

**Residual, disclosed in the code:** a same-count *substitution* at a declared key still hides
a mount. No signal from `{ method, path, handler }` alone can prove identity, and tagging the
registration at its call site means editing `apps/api/src/index.ts`, which this package does
not reach into. Reproduced by review 3 and confirmed unreachable in the current tree — it
needs a simultaneous removal **and** addition.

---

## HIGH — remediated and independently verified

Numbering here is this note's, mapped to the review comments by content. The reviewers did not
number their HIGHs.

### H1 — `inherited-uncovered.json` was not shrink-only · VERIFIED-CLOSED

The test named *"keeps the inherited-uncovered list shrinking, never growing"* asserted
`baselineNowCovered === []` and `baselineStale === []`, both computed against the **current**
router. Nothing compared the baseline to its previous committed state, its length, or a hash.
Probe: real router, one new unclassified route, one appended baseline line — baseline
128 → 129, `result.ok = true`, **gate green**. The failure path is short: build goes red, the
message names the baseline file, an agent appends one line, CI green. The README's control was
*"adding a line is a visible diff"* — code review — which ADR 0010's own Alternatives section
rejects: *"Trust code review. Rejected. v1 had review."*

**Fix (`c8785cd`):** `diffBaselineEntries` compares against the file as committed at the merge
base. Verified at `5956fb3` as a correct set difference — growth caught, shrink allowed — and
`readJsonAtMergeBase` **throws** rather than treating an unresolvable merge base as "did not
grow". See LOW-B2 for the one caveat.

### H2 — the gate models no source ordering · **OPEN, and not in the must-fix six**

`CollectedRoute` carries no registration index. `collectRoutes` iterates `app.routes` in order
and discards that order, so a route registered **above** the auth guard is indistinguishable
from one below it.

In the real app the guard `ALL /api/*` sits at index **38 of 457**, with **27 route keys
registered above it**. Every classified one is `public` or `delegated` today, so the tree is
consistent. Nothing keeps it that way: when #8 classifies `GET /api/asset/{id}` or
`GET /api/user/avatar/{id}` as `{ capability, scope }` — the obvious verdict — the gate turns
green with **zero runtime change** and the route stays anonymous.

**This is the v1 failure mode reproduced inside the control built to close it, and the
ordering data is present as the array index and thrown away.**

**Disposition: none was recorded.** This finding does not appear in the PR body's six-must-fix
table, does not appear in its fourteen-MEDIUM/LOW table, no commit on this branch implements a
control for it, and neither review 3 nor review 4 re-checked it — because neither was asked
to. It was found during the documentation pass that produced this note, by counting the
original findings against the body's tables.

The PR body does record the underlying *fact* for one route — *"`GET /api/instance/status` is
anonymous today purely because of where it sits in `index.ts`"* — but a stated fact about one
route is not a control over twenty-seven.

**Where it belongs: issue #8.** #8 is the retrofit that will classify the above-guard routes,
so #8 is where the omission would actually fire. The control itself is a change to
`packages/permissions` (carry the registration index through `CollectedRoute`; refuse a
`capability` policy on a route registered above the declared auth-guard key). **It is not
fixed by merging #21, and #21 should not be read as closing it.**

### H3 — the registry has no runtime existence · tracked to #8; false claims corrected here

ADR 0010 §1 said *"the route factory refuses at module load to construct a route with no
policy entry — so the failure is at boot, not at request time"*, and `policy-registry.ts`
repeated it. Neither was true. Combined with C1, H1 and H2 it meant every "covered" claim in
this PR was a claim about a TypeScript literal, not about request handling.

**Handled, not fixed.** ADR 0010 §1 and §2 and the file docstring carry dated, non-weakening
corrections in this diff — the boot-refusal target is **scheduled, not softened**. Review 3
confirmed the boundary rather than taking it on trust: `grep -rn "policy-registry"` returns
exactly **one** importer (`tests/permissions/api-app.ts`); `apps/api/src/index.ts` never loads
it; **no** producer of `ResolvedIdentity.credential` exists anywhere in `apps/`; nothing
imports `evaluatePolicy`, `can` or `ResolvedIdentity`. No request is evaluated against a policy
today. Issue **#8** durably carries all nine Done-when boxes, including *"No flat-target
provenance fallback exists at runtime."*

Review 3's words: *"#21 is not failed for #8's absence, and the PR body describes that boundary
accurately."*

### H4 — `sessionOnly` and `elevated` were silently inert on `public` and `delegated` · VERIFIED-CLOSED

Both kinds returned `{ allowed: true, requiresElevation: false }` **before** the `sessionOnly`
check and before `requiresElevation` was set. So: someone hardens `/api/ws/{projectId}` — *"the
websocket should only be reachable from a browser session, not a personal API key"* — adds
`sessionOnly: true`, it type-checks, `validatePolicy` accepts it, `sessionOnlyRoutes()` lists
it, `session-only.test.ts` enumerates its cases **from that list** and passes, and rbac.md's
generated table renders it. At runtime the credential is never inspected. **The control was
documented, tested, and absent.** Not hypothetical: `instance/policy.ts` already shipped a
`public` policy carrying `elevated` and `elevationExemptionReason`.

**Fix (`e45584b`):** a declared flag is enforced or refused. `sessionOnly` is now checked
**before** the public/delegated early returns.

**Verified at `5956fb3`:** `session_required` confirmed on **capability, self, portal and
delegated** for `api_key`, `mcp_key` and `impersonation`; `requiresElevation` surfaces on every
kind. `public` + `sessionOnly`/`elevated` **denies** (`policy_incoherent`, 403) rather than
falling through, is refused again by `validatePolicy` at construction, and is unrepresentable
on a well-typed literal (`policy.type-assertions.ts`).

### H5 — `Policy.scope` was declared, validated and documented, and never read · VERIFIED-CLOSED

`scopeIdFor` was dead code. `grantAppliesTo` matched any grant whose `scopeId` equalled any
matching id on the target, so a workspace-scope role holding `instance:admin` satisfied a
`scope: 'instance'` policy. Nothing cross-checked that `target.projectId` lived inside
`target.workspaceId`, so a role in workspace A authorised a `scope: 'project'` policy for a
project in workspace B. The only thing between that and an IDOR was `context.inReach` — which
was H6.

**This finding took two attempts and an arbitration.** The first design was built and then
**defeated by an adversarial pass**: its single `ResolvedScope` brand took three
caller-supplied `string`s, so `projectScope({ workspaceId: c.req.header("X-Workspace-Id") })`
compiled, type-checked, was branded, and was indistinguishable from a row-derived scope. The
adversary also found a case the design never considered — a `scope: 'workspace'` route
addressing a single row by `{id}` (`DELETE /api/webhooks/{id}` and six similar surfaces),
where an admin of workspace A could delete a webhook belonging to workspace B.

**Fix (`f7dd722` + `c57abe1`):** the policy declares `scopeSource: "row" | "request"`,
required on every capability policy, and provenance is carried by **two distinct brand
symbols** rather than one brand plus a doc comment. `f7dd722` was reported as completing this
finding while a provenance-free flat-target fallback was still in the code; `c57abe1` removed
it. **The intermediate claim was wrong and is left in the record rather than tidied away.**

**Verified at `5956fb3`, with extra scrutiny requested on this finding specifically:** absent
`context.scope` on a `CapabilityPolicy` → 500 `policy_context_incomplete`, **before**
`context.target` is read. A deliberately rich flat bag matching the policy's scope exactly
still **denies**; `scopeIdFor` survives only as an exported utility with no caller in the
decision path. `RequestScope` → `scopeSource:"row"` policy = 403 `scope_source_mismatch`, and
the reverse likewise. A hand-built lookalike, a `JSON.parse(JSON.stringify(…))` round trip and
an object spread all lose the non-enumerable brand and are refused. `validatePolicy` refuses
`scope:"instance"` with `scopeSource:"row"`/`"request"` **and** any id-bearing scope with
`scopeSource:"instance"` — both directions.

**One honest limit, disclosed in the docblock and not a finding:** the brand symbols are
reachable via `Object.getOwnPropertySymbols`, so an in-process caller **can** forge a
`ResolvedScope`. The docblock says exactly that — it is *"not, and is not claimed to be,
unrepresentable-by-construction protection against a caller who lies"*. The property that
holds is the valuable one: a missing `context.scope` no longer runs an authority decision with
no scope evidence.

**Also out of scope by decision, not by oversight:** `inReach` and `scope` remain two facts
about one resource and nothing ties them. Tying them is larger than this finding and needs its
own follow-up.

### H6 — three optional `PolicyContext` fields each defaulted to ALLOW when omitted · VERIFIED-CLOSED

`inReach` omitted → allowed (`inReach: false` → 404). `targetPersonId` omitted → allowed.
`portalPredicateSatisfied` omitted → allowed. All three were `?: boolean`, so a middleware
that forgot one line, or a `try/catch` leaving one `undefined`, compiled and passed. This is
the **"omission, not mistake"** failure class `route-coverage.ts` says the module exists to
refuse — refused at the route-registration layer and reintroduced at the context layer.

**Fix (`e45584b`):** missing context is a denial.

**Verified at `5956fb3`:** `reach:"required"` with `inReach` of `undefined`/`null`/`"true"`/
`1`/`{}`/`NO_SINGLE_RESOURCE` → all 500 `policy_context_incomplete`. A capability policy
declaring **no** `reach` denies. `self` with a string `personParam` and no `targetPersonId`
denies; `self` with no `personParam` at all denies. `portal` with `portalPredicateSatisfied` of
`undefined`/`null`/`"true"`/`1`/`{}` denies; `false` → generic 404. **No absence anywhere reads
as permission.**

### M4 (elevated to must-fix #6) — a workspace role could carry instance authority · VERIFIED-CLOSED

Raised as a MEDIUM by the policy-core lens and treated as a must-fix. `custom-role.test.ts` was
named *"cannot mint instance authority through a workspace role"* and its body read
`expect(can(overreaching, "instance:admin", { workspaceId: WORKSPACE_ID })).toBe(true)`. The
comment conceded it and deferred the real control to *"grant time, not evaluation time"* —
which was not in this PR. Meanwhile `expandCapabilities` turned that one string into all five
`instance:*` capabilities. **A test whose name states a security property while its body
asserts the negation is worse than no test, because it will be read as coverage.**

**Fix (`f7dd722`):** instance authority is unreachable from a workspace role.

**Verified at `5956fb3`:** a `workspace`-, `project`- **or** `organisation`-scope grant whose
row literally contains `"instance:admin"` expands to the **empty set** — sibling
workspace-tier capabilities in the same row survive, the instance one does not. The clamp sits
where a name is taken off the expansion queue, so it holds for capabilities arriving by
implication. `GRANT_SCOPES_FOR.instance === ["instance"]`, so an instance-scope **policy** is
unreachable from a workspace grant. A malformed instance grant (`scopeId !== null`) applies
**nowhere**; an unknown or mis-cased grant scope grants nothing — `roleScopeTier` fails closed
to `workspace`, `tierPermits` fails closed on an unrecognised tier.

---

## MEDIUM and LOW — the fourteen from `f3cd609`

Dispositioned in full, per the PR body's own table at `b950e26`. None was left unchecked, and
none was closed by argument.

| Disposition | Count | Findings |
| --- | ---: | --- |
| Already addressed by a CRITICAL/HIGH fix | 2 | M4 (must-fix #6 above), L12 |
| **Fixed in this PR** | 10 | M1, M2, M3, M5, L9, L10, L11, L13, L14, L15 |
| Explicit follow-up | 1 | M7 — `metrics` surface declared with zero routes |
| Verified not applicable | 1 | M6 — route-key normalisation collision |

Three worth naming:

- **M5 — `GET /api/instance/status` closed out with a factually wrong exemption reason.** The
  reason read *"reads one boolean about setup state; it grants nothing and changes nothing"*.
  It returns **two** booleans, and `hasUsers === false` is precisely the signal that the next
  signup is auto-promoted to instance admin. The route does not grant; it **publishes the
  window in which anyone can take the grant**. Our own #13 review already had this as **F-12**
  and **H17**. Only the false description was #21's to fix — the underlying bootstrap
  behaviour stays **#18**, which is open. The gate-level defect it exposed is real and
  unfixed: `validatePolicy` accepts any non-empty string as a `public` reason and any non-empty
  string as an `elevationExemptionReason`, so an unresolved issue was converted into a green
  build by two free-text strings.
- **M6 — checked, not assumed.** `:id{[0-9]+}` and `:id{[a-z]+}` are distinct Hono routes that
  both normalise to `{id}`; so do `:id?` vs `:id`, and a literal `{id}` segment vs `:id`. The
  real constructed app was loaded — **138 routes, 138 unique normalised keys, zero
  collisions** — and no `:id{regex}` or `:id?` syntax exists anywhere in `apps/api/src`. Latent
  at most, and not live.
- **M7 — the `metrics` surface** is declared in `ROUTE_SURFACES`, has zero routes, and is
  skipped by the report. If metrics later ships on a separate `http.createServer` it is
  structurally outside `app.routes` and the gate can never see it, while the surface list
  implies coverage. Explicit follow-up.

---

## Raised after remediation

### MEDIUM-1 — `mcp_key` with undefined `keyCapabilities` inherited the owner's full RBAC

Found by **review 3** at `5956fb3`; fixed in `b950e26`; **VERIFIED-CLOSED by review 4** at that
exact head.

`can()` guarded only `credential === "api_key"`, but `CREDENTIAL_KINDS` models `mcp_key` as a
distinct kind. Proven at `5956fb3`:

```
K1  api_key + undefined keyCapabilities  -> can() === false   ✅
K5  mcp_key + undefined keyCapabilities  -> can() === true    ❌  owner's full RBAC
```

**The identical fail-open shape this PR exists to close, one credential kind over.** `rbac.md`
is explicit that the clamp is universal — *"**Every** personal API key — `is_mcp` or not"*.

**Fix (`b950e26`):** a list plus a predicate, not a second comparison. `KEY_CREDENTIAL_KINDS`
and `isKeyCredential` in `identity.ts`; `can()` and the diagnostic label both read the list;
`CapabilitySource` derives from it. Nine regression tests driven **from the list** rather than
restating it. Review 4's judgement: *"`|| credential === "mcp_key"` would have closed the
finding; a list plus a predicate closes the finding **and** moves the decision to one
reviewable place."*

**Verified at `b950e26`** against an inventory of **every** credential-kind decision in the
package, so exhaustive rather than sampled — three sites, two list-driven, and one
(`sessionOnly`) written as the **inverted** `credential !== "session"`, which fails closed on
any new kind. Eight required checks all pass, including MEDIUM-1's exact probe now returning
`can() === false`, and the whole set re-run through `evaluatePolicy` rather than `can()` alone.
On an `elevated` + `sessionOnly` instance route both key kinds are refused `session_required`
**before** the clamp is reached — the two controls compose in the right order.

### A second omission of the same shape, disclosed and closed

The diagnostic `source` label also hard-coded `"api_key"`, so an `mcp_key` denial was reported
under the wrong credential kind. Disclosed by the author rather than filed away, fixed in the
same commit, and **VERIFIED-CLOSED independently** by review 4 — captured `onUnknown` reports
`source: "mcp_key"` for `mcp_key` and `"api_key"` for `api_key`.

### Open LOW findings — five, none blocking

**The two later reviews each labelled their own findings LOW-1 and LOW-2 with different
content.** They are kept apart here deliberately.

**From review 3, at `5956fb3`:**

- **LOW-A1 — the CRITICAL fix's own signal is unasserted against the real app.**
  `result.unclassified` and `result.ok` are asserted only in the synthetic
  `buildAppWithMount` describe; the real-app block asserts `uncovered`, `orphanedPolicies`,
  baseline drift and surface accounting, and merely `console.error`s the report when
  `!result.ok`. The gate **does** hold today, but only via the *incidental* surface-accounting
  invariant — an unclassified route is in neither `covered` nor `uncovered`, so the row stops
  balancing — and it reports the wrong reason. One edit folding `unclassified` into
  `uncovered`, or a relaxation of that assertion, would silently disarm the CRITICAL fix on
  the real router while every other assertion stayed green. Two lines close it.
- **LOW-A2 — baseline monotonicity is inert on this PR.** `readJsonAtMergeBase` returns `null`
  because `inherited-uncovered.json` does not exist at the merge base, the test returns early,
  and no drift comparison runs **on #21 itself**. This is the correct bootstrap behaviour,
  documented in both files, with the logic proven synthetically and the git plumbing proven
  against real scratch clones. **#21 is the one PR whose baseline additions this control
  cannot check**; it goes live on the next PR.

**From review 4, at `b950e26`:**

- **LOW-B1 — the classification is *visible* but not *forcing*.** This is the answer to *"if a
  new credential kind is added tomorrow, where could the old bug reappear?"* — **in exactly the
  same place.** Add `"service_token"` to `CREDENTIAL_KINDS` and forget `KEY_CREDENTIAL_KINDS`:
  `isKeyCredential` returns false, no clamp, owner's full RBAC. **That is MEDIUM-1 verbatim**,
  and nothing fails — the safeguard is a docblock sentence. Review 4: *"LOW-1 is the one I
  would actually want done… but it guards a **future** credential kind, not this HEAD."*
  `identity.ts` is a shared contract, so a reviewer already stands in front of that change.
- **LOW-B2 — `KEY_CREDENTIAL_KINDS` is not frozen.** `as const` is compile-time only;
  truncating the array in-process disables the clamp. Reproduced at this head.
- **LOW-B3 — an unrecognised credential value is unclamped rather than refused.**
  `isKeyCredential` answers a *membership* question, so anything not matching a listed literal
  runs unclamped. **Pre-existing, not a regression** — `=== "api_key"` behaved identically. The
  safer default at #8 is clamp-unless-known-non-key.

**Also recorded by review 4, no action:** a non-key credential carrying `keyCapabilities` is
still clamped and its diagnostic is mislabelled `"api_key"` (conservative direction, disclosed
in the code); `isCapability` uses `Object.hasOwn`, which coerces, so a nested-array capability
is accepted — bounded and shown unable to exceed the owner or defeat the tier clamp;
non-iterable `keyCapabilities` throws a `TypeError` rather than denying cleanly (pre-existing,
fail-closed at the HTTP layer); and `can()`'s docblock wording is stale.

---

## The ReDoS fix — cleared twice, on its own evidence

CodeQL raised `js/polynomial-redos` **HIGH** on `normaliseRoutePath`. `f3cd609` replaced the
regex with a linear parser holding a monotone cursor. The alert is **`fixed`, not dismissed**,
and no `// codeql`, `lgtm`, `biome-ignore`, `@ts-ignore`, `.skip` or scanner-configuration
change appears anywhere in the diff.

| Question | Verdict | Evidence |
| --- | --- | --- |
| Actually O(n)? | **Yes** | Review 2: 18 adversarial families to **16 MB**; doubling input doubles time, everywhere. Review 3 re-ran its own sweep independently. |
| Byte-identical to the removed regex? | **Yes** | Review 2: **75,584,074 differential cases, zero disagreements.** Review 3, with its **own** oracle rather than review 2's: **500,018 cases, zero disagreements.** |
| Can it throw, hang or collide? | **Throws correctly, never hangs** | Rejects `""`, `"   "`, `"GET"`, `"\t"`, `"GETX /a"`. Tab, space and NBSP separators all normalise. `PURGE`/`QUERY` keys throw and are handled as an ordinary registry miss. |

The old quirks are **pinned on purpose** rather than quietly improved — `:id{[0-9]{3}}` still
yields `{id}}` — because the route scanner normalises through this same function and changing
one side alone would desynchronise coverage. Review 2 also independently reproduced the
original alert as real rather than noise: the removed regex ran at 4× per doubling.

---

## Verified clean — recorded so it is not re-litigated

- **`orOwner` / `orSelfTarget` boolean composition is correct.** Both are genuine conjunctions,
  not bypasses: a role without `work_item:update`, self-assigning, is refused with
  `403 Missing capability work_item:assign`. `orOwner` refuses an owner lacking the branch's
  own `*_own` capability; `orSelfTarget` dispatches on the predicate string with a fail-closed
  `default`.
- **Diagnostic detail is not leaked on the wire.** Every denial's `reason` is generic
  (`"Forbidden"`, `"Out of reach"`, `"The server could not evaluate this request's
  authorization"`); the parameter name, predicate, declared-vs-resolved scope and missing field
  live in `diagnostic`/`missingContext`. Client-safe by construction, not by per-code
  convention.
- **The `withinMinutes` window rejects both expiry and a future `created_at`** — clock skew or
  a client-supplied timestamp no longer makes an edit window permanent.
- **Real-router enumeration, done independently at `5956fb3`:** 457 raw entries → **138**
  distinct routes, **138 unique** normalised keys, **zero collisions**; middleware excluded is
  exactly `["ALL /*","ALL /api/*"]`; surfaces `api 124 · auth 7 · well-known 4 · websocket 2 ·
  health 1`. Coverage: 10 covered, 128 baseline-known, **0 uncovered, 0 unclassified, 0
  orphaned, 0 stale**. The baseline contains **no** `/api/instance/*` route and **no** wildcard.
- **`tests/permissions/matrix.fixture.json`** is byte-identical at `5956fb3` and `b950e26`
  (SHA-256 `e8c26242…`) and regenerates byte-identical — 10,583 canonical bytes, 8 roles ×
  10 routes.
- **Gates re-run non-cached by the reviewers, not read from the body:** permissions package
  **233** passed / 11 files at `b950e26` (224 → 233, +9); `pnpm test:permissions` **74** passed
  / 10 files; api **386** passed / 60 files; `typecheck --force` 6/6; `build --force` 5/5;
  `biome ci` exit 0 over 1200 files. **Zero code-scanning alerts** on the PR branch, and zero
  ever raised anywhere under `permissions/`.

**One accuracy correction review 3 made to the PR body, worth keeping:** *"CodeQL · Analyze ·
GitGuardian — green, zero open alerts"* is true of **this PR** and false of the **repository**,
which carries three open alerts on `main` — `js/insufficient-password-hash` HIGH
(`apps/api/src/utils/verify-api-key.ts`), `js/polynomial-redos` HIGH
(`packages/libs/src/api-url.ts`), and `js/incomplete-html-attribute-sanitization` MEDIUM
(`apps/api/src/plugins/telegram/events.ts`). All three are inherited kaneo code and none of
those files is in this PR's diff, so none is #21's to fix. **The two HIGHs deserve their own
issue.** Similarly, `biome ci` exits 0 but emits 55 warnings, all in inherited code; this PR's
own 45 files are clean.

---

## What merging #21 does and does not complete

**Merging #21 does not complete issue #7.** Independently confirmed by review 4, not taken from
the PR body:

- **`.github/workflows/` does not exist on this branch.** `.github/` contains only
  `pull_request_template.md`. The three passing checks come from GitHub default setup, not from
  a workflow in this repository.
- **No file anywhere references `test:permissions` in CI.**
- **#19** owns `ci-fast.yml`'s `route-policy` job and `scripts/ci/route-policy-gate.mjs`, and
  registering `route-policy` as a required status check on the `protect-main` ruleset *"is a
  repository setting, not something a pull request can do."*

So #21 publishes the contract and the suite; **the job that runs it, and its registration as a
required check, land through #19.** Throttle 1's third condition — *"a new route without a
policy fails the build"* — is true of a local or turbo run today and becomes true of **CI**
only after #19.

**Runtime attachment remains #8**, per H3 above.

---

## Disposition summary

- **1 CRITICAL — fixed** (`c8785cd`), independently verified at `5956fb3` against the real API
  router in all three directions.
- **4 of 6 HIGH — fixed and independently verified.** One (**H3**) is correctly tracked to #8
  with its false documentation claims corrected here. One (**H2** — source ordering) **has no
  disposition and is open**; it belongs to #8 and is the single most important thing in this
  note.
- **All 14 MEDIUM/LOW dispositioned**, none by argument.
- **MEDIUM-1 and the diagnostic-source omission — VERIFIED-CLOSED** at `b950e26`.
- **Five LOW open**, none blocking. **LOW-B1** is the one the reviewer said it would actually
  want done, because it guards against MEDIUM-1 recurring verbatim for a future credential
  kind — a few lines in a file this PR already touches. Thomas's call whether it rides along or
  becomes a follow-up.
- **Verdict at HEAD `b950e26`: CLEAR FOR THOMAS MERGE DECISION.** Reviews 3 and 4 together cover
  this head and no other. **No clearance transfers to any later commit** — a further commit
  needs its own delta review.
- **Not merged. Only Thomas decides merge.**
