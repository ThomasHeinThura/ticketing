# Pre-merge security review — PR #116 (widen the security-review scope)

**Reviewed head:** `36ed6946d0292d2b954297e2bf222de9e27a8f94`

**VERDICT: CLEAR at `36ed6946d0292d2b954297e2bf222de9e27a8f94`** — no blocking finding in the
change. Three new findings are recorded below; **none of them is caused by this pull request,
and none is fixable inside it without pulling a fresh file into the diff.** Two are HIGH and
need their own issue before they are forgotten.

**Merge is still conditional on two pull-request-body corrections** (§7). Neither changes a
tracked file, so neither voids this clearance. **Any change to a tracked file does void it**
and needs a fresh delta review at the new head.

**Reviewer independence.** A fresh, review-only Opus context that authored, directed and
remediated no part of this change, and that is not the context that folded `scripts/deploy.sh`
in at `36ed694`. Reviewed in an isolated throwaway worktree and an isolated throwaway clone,
both created and removed by the reviewer; `/home/ubuntu/.taskdesk-lanes/lane-k-115` was not
touched.

**Prior review chain, checked rather than assumed.** Three ordinary Sonnet reviews are recorded
on the pull request — two at `84f3a5c` and one delta re-confirmation at `36ed694` — matching
the three AGENTS.md requires for CI/security-control machinery. This is the first review at the
Opus/security tier.

---

## 1. Why this pull request needed a review at all

It edits `docs/04-engineering/ci-cd.md`, which is **itself** the ninth entry in the list that
document declares — the change is inside the machinery that decides whether any other change
gets a security review. It also adds a probe under `scripts/ci/**`, which is likewise in scope.

---

## 2. The central question: can it weaken coverage?

*No, and this was demonstrated, not argued.*

```
git diff --stat main...36ed694
 docs/04-engineering/ci-cd.md                       |  89 ++++++
 ...ity-scope-controller-migration-surface.test.mjs | 306 +++++++++++++++++++++
 2 files changed, 395 insertions(+)
```

**Zero deletions across the whole pull request, in two files.** No glob can have been narrowed
or removed because no line was removed. Confirmed independently by parsing the list with the
repository's own `readSecurityReviewPaths()` at this head: **29 globs, all 23 pre-#115 globs
present, plus exactly the six additions** (`apps/api/src/**/controllers/**`,
`apps/api/drizzle/*.sql`, `apps/api/src/policy-registry.ts`, `apps/api/src/database/**`,
`packages/mcp/src/auth/**`, `scripts/deploy.sh`). `readSecurityReviewScope().removed` is empty
and CI emitted no `REMOVED` warning.

**Precision check on the new globs.** Each was expanded through `globToRegExp` and read as a
regular expression; none over-reaches. `apps/api/src/**/controllers/**` anchors under
`apps/api/src/` and cannot escape it. `apps/api/drizzle/*.sql` is single-segment, so
`drizzle/meta/**` correctly stays out, as the document claims. `scripts/deploy.sh` escapes its
`.` and is an exact-path match. Whole-repository classification at this head: **332 of 1393
tracked files in scope, 1061 out** — a widening, not a blanket.

---

## 3. The `b22b8a8` `openapi.ts` argument, re-verified at THIS head

`b22b8a8` dropped `apps/api/src/openapi.ts` as a redundant glob, arguing the content-based
half already covers it. **That argument still holds at `36ed694`, checked by execution rather
than by reading the earlier reviewer's report:**

- `readSecurityReviewPaths().matches("apps/api/src/openapi.ts")` → **false**
- `looksLikeHonoRouter(<the file's current source>)` → **true**, on two independent lines:
  `openapi.ts:25 export function apiRouter<V extends BaseVariables = BaseVariables>() {` and
  `openapi.ts:26 return new OpenAPIHono<{ Variables: V }>({`

Both halves of `looksLikeHonoRouter`'s alternation match, so losing either one alone does not
drop the file out of scope. §4 of the new probe pins exactly this pair, which is the right
control: it converts "covered by the other half" from an assertion into something that fails
loudly the day it stops being true.

---

## 4. The probe's non-vacuity — established by demonstration, per glob

The prior reviews stripped the five original globs together (3 of 8 failed) and `scripts/deploy.sh`
alone (2 of 8 failed). That leaves open whether some individual glob is unasserted. **Every one
of the six was removed individually from a scratch copy of `ci-cd.md` and the probe re-run:**

| Removed token | globs parsed | probe exit | assertions failing |
| --- | --- | --- | --- |
| `apps/api/src/**/controllers/**` | 28 | 1 | 2 |
| `apps/api/drizzle/*.sql` | 28 | 1 | **3** (also the PR-#110-specific assertion) |
| `apps/api/src/policy-registry.ts` | 28 | 1 | 2 |
| `apps/api/src/database/**` | 28 | 1 | 2 |
| `packages/mcp/src/auth/**` | 28 | 1 | 2 |
| `scripts/deploy.sh` | 28 | 1 | 2 |

Restored → **8 tests, 8 pass, 0 fail**, working tree clean. **No addition is decorative**: each
is load-bearing on its own, and the probe catches a single-token drop as well as a wholesale
revert. The choice to name the required globs rather than assert `globs.length === 29` is
correct and strictly stronger — it catches a drop *and* a rename without false-firing on a
later legitimate widening.

---

## 5. The consuming mechanism, read end to end

`check-pr-template.mjs`'s `securitySurfaceTouched()` is sound as written:

- Scope is `readSecurityReviewScope()` — the **union** of the list at the merge base and at
  HEAD, so a narrowing cannot take effect on the change that performs it (GPT-F1).
- Path matches and the `looksLikeHonoRouter()` content backstop are unioned, the backstop runs
  over every **changed** `.ts`/`.tsx` file rather than only added ones, and `requiresReview`
  is `touched.length > 0 || scope.removed.length > 0` — so shrinking the list is itself
  review-triggering.
- An undeterminable diff or merge base is a hard failure, never an empty change set.

Two gaps in the surrounding control are recorded in §6. Neither is introduced here.

---

## 6. Findings — all pre-existing, none blocking this pull request

### 6.1 HIGH — the deployment surface is still almost entirely uncovered

`scripts/deploy.sh` — the script that **asserts** the production invariants — is now in scope.
The files that **establish** them are not. None is reachable by the content backstop either,
which only reads `.ts`/`.tsx`:

| Out of scope | Carries |
| --- | --- |
| `compose.yml` | the `No ports:` invariant `assert_port_unpublished` exists to protect; the image reference and the optional `TASKDESK_IMAGE_DIGEST` pin; every secret wiring |
| `deploy/compose.prod.yml` | `TASKDESK_TRUST_PROXY: "1"` — how many proxy hops `X-Forwarded-For` is trusted for — plus the TLS routers and the middleware chain |
| `deploy/traefik/dynamic/middlewares.yml` | `stsSeconds`, `contentTypeNosniff`, `frameDeny`, `rateLimit` |
| `Dockerfile` | `USER taskdesk` (uid 10001) and the privilege drop |
| `deploy/entrypoint.sh`, `deploy/compose.{uat,local,traefik}.yml`, `charts/taskdesk/**` (15 files, incl. `securityContext`), `.dockerignore` | deployment and pod security configuration |

**Demonstrated, with this pull request's own 29-glob list in force** (throwaway clone,
`origin/main` pointed at `36ed694` to simulate post-merge): a one-line change raising
`TASKDESK_TRUST_PROXY` from `1` to `2` — which lets a client forge `X-Forwarded-For` past
Traefik — ran through `check-pr-template.mjs` with an honest body and **exited 0**, printing
`no security-review path touched (29 glob(s) checked)`.

Not blocking here: this pull request removes nothing and claims no completeness — the document
says plainly that the original walk never looked outside `apps/api`/`apps/web`/`packages`.
Blocking it would leave the *narrower* 23-glob list on `main`, which is strictly worse. **It
does need its own issue**, and it is a larger miss than the three #115 was opened for.

### 6.2 HIGH — an incidental phrase can disarm the checklist backstop

`REVIEW_ITEM` in `scripts/ci/lib/pr-body.mjs:272` is
`/\bindependent\b[^\n]*\breview\b|\bsecurity\s+review\b/`, matched against a line normalised to
letters and digits. It matches **any** checkbox whose text happens to contain those words.

The good news first, because the third ordinary review got this backwards: the checklist
backstop **does** generalise to a non-path change. Re-run of the §6.1 scenario with a neutral
branch name, `### Backend change` legitimately collapsed to prose `n/a`:

```
pr-template: 1 problem(s)
  ## Checklists
      there is NO independent-review checkbox anywhere in `## Checklists`. …
EXIT=1
```

`checklistPresenceProblems()` rule 3 runs unconditionally and catches it. **The bypass is the
false positive.** Change one thing — name the branch `fix/900-security-review-hops`, which is
this repository's own convention — and the ticked "Branch named …" line that quotes it
normalises to `branch named fix fix 900 security review hops`, matches `REVIEW_ITEM`, is
already ticked, and becomes the "exactly one" review checkbox rule 3 demands. Same diff, same
body otherwise:

```
pr-template: note — no security-review path touched (29 glob(s) checked …)
pr-template: every fixed section present and filled
EXIT=0
```

So for any change outside the path list and outside `.ts`/`.tsx`, a branch named
`*security-review*` or `*independent*…*review*` removes the last backstop. It also produces
**this pull request's own fourth CI failure** (§7): on branch `fix/115-security-review-surface`
the checker counts two review checkboxes. Not fixable here — `pr-body.mjs` is not in this diff,
and pulling it in would require a new head and a fresh review.

### 6.3 MEDIUM — the assertion half of the route-policy gate is out of scope

`scripts/ci/**` and `.github/**` cover the runners; the assertions live in `tests/permissions/`
(19 files, all out), including `route-coverage.test.ts`, `matrix.test.ts` and
`apps/api/vitest.permissions.config.ts`. The *data* files have their own merge-base ratchets
(`inherited-uncovered.json`, `better-auth-plugins-pending-removal.json` both fail on growth),
so the exposure is the test code and the vitest config, not the fixtures. Same follow-up issue.

### 6.4 LOW — a deleted file trips neither half

`securitySurfaceTouched()` skips a changed file that no longer exists on disk, deliberately, so
a file covered **only** by the content backstop escapes the gate when it is deleted rather than
edited. `apps/api/src/openapi.ts` is exactly such a file today. Practically unreachable —
deleting it breaks 20 route modules, all in scope via `apps/api/src/**/index.ts` — but worth
recording next to §3.

### 6.5 NIT — two stale "five"s in the probe

`security-scope-controller-migration-surface.test.mjs` says `Restore the five issue-#115 globs`
and `${glob} is one of issue #115's five globs` in assertion messages that now iterate six.
Cosmetic, in failure text only; the same class of stale-number defect the first ordinary review
raised as a MEDIUM against the document. Not worth a new head on its own — fold it into the
follow-up.

---

## 7. What must still happen before merge

Neither item changes a tracked file, so neither voids this clearance.

1. **Record this review in the body**: `## Security review` → `**Model:** Opus 5`, and link
   `docs/07-planning/security-reviews/116-security-review-surface.md`; tick the Definition of
   Done line. This closes three of the four CI problems.
2. **Reword `### Any change`'s first line** so it no longer quotes the branch name verbatim —
   pointing at the pull request's head ref instead of spelling it out is enough. The fourth CI
   problem ("there are 2 independent-review checkboxes") is §6.2 firing on this branch's own
   name and will **not** clear when the review is recorded.

The body is also stale at this head — it says five globs / 28, and "no independent review of
any tier", while the head carries six / 29 and three recorded ordinary reviews. Worth correcting
in the same edit.

---

## 8. What this review does NOT claim

- **It does not claim the list is now complete.** §6.1 says the opposite, with a working
  demonstration. It claims only that this change is a correct, non-narrowing widening.
- It does not re-derive the 92-controller, 68-mutating-file or 50-migration counts to the file;
  those were verified by two prior reviews and the probe asserts named representatives rather
  than counts, which is what actually matters.
- It does not re-audit `apps/web/**`, `packages/domain`, `packages/ui`, `packages/libs` or
  `packages/email`, which the original investigation cleared.
- It does not assess `apps/api/drizzle.config.ts` or `apps/api/auth-schema.ts` beyond agreeing
  with the delta review's reasoning for deferring both.
- It is not a merge, and it waives nothing. No waiver was authorized for this pull request, and
  the `## Gates` table cites none.
- It clears **`36ed6946d0292d2b954297e2bf222de9e27a8f94` and that head only.** Any later commit
  touching anything outside `docs/07-planning/security-reviews/` voids it.
