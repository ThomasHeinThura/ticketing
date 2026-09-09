# Pre-merge security review — PR #81 (security-review scope repair)

**Reviewed head:** `0eecc4b9639bcda8531fee0eaea51cb5ee7dd5a3`
**Reviewed head:** `074aae3f1c3af0882c85743cbedc00514909733a`
**Reviewed head:** `0bb15c9b1ad6449ee16c836305c20177d47fa216`

**Three independent Opus reviews, three heads, chaining without a gap** — `0eecc4b`, then
`0eecc4b..074aae3`, then `074aae3..0bb15c9`. **`0bb15c9` is the CURRENT clearance and the code
that would merge.** The two earlier lines are **still standing for their own heads** and
**superseded as the current clearance**; they are kept, not withdrawn, because each reviewed
real code and a reader must be able to tell which head is current. Every reviewer was a fresh,
review-only Opus context that authored no part of the change.

| Head | Verdict | Scope |
| --- | --- | --- |
| `0eecc4b` | CLEAR WITH FINDINGS (4 LOW, 2 MEDIUM) | the scope repair: glob list, router predicate, changed-vs-added |
| `074aae3` | CLEAR WITH FINDINGS (1 MEDIUM, 4 LOW) | the merge-ref binding fix |
| **`0bb15c9`** | **CLEAR** (4 LOW, none blocking) | the M-1 payload/tree-agreement fix and four LOWs |

**CURRENT VERDICT: CLEAR at `0bb15c9`** — four LOW findings, none blocking, none a
weakening. The two earlier rounds each returned CLEAR WITH FINDINGS against their own heads;
their findings were fixed, which is what produced the later heads. Round-by-round detail
below, newest round last.

**Status of the gate:** these reviews ran **before** merge and are complete. The gate is
closed for **`0bb15c9`**, the current head and the code that would merge — **and for that head
only.** A later content commit voids it and requires a fresh delta review; that has already
happened twice on this pull request, which is why there are three heads rather than one. Nothing
here is a merge, and nothing here waives a gate — no waiver was authorized for this pull
request.

**Reviewer independence.** A fresh, clean, review-only Opus context that authored no part of
the change. The candidate was implemented by the top-level Opus orchestrator, and under the
separation rule an Opus context that authored a candidate may not review it. The
orchestrator's own verification of this branch is recorded in the pull request as author
verification and is explicitly **not** counted as the independent review.

---

## Why this pull request needed a review at all

It changes **the security-review boundary itself** — the machinery that decides whether any
other change gets a security review. It is deliberately first in the merge train
`#81 → #79 → #80 → #77 → #76`, so that the boundary is correct before the authorization
changes land behind it.

It answers a HIGH finding from an independent audit of `main@5270954`: the **entire
authorization enforcement layer** sat outside `ci-cd.md`'s security-review path list. The
sharpest consequence was that **PR #80 — a P0 privilege-restoration fail-open fix — edits
`apps/api/src/utils/require-workspace-permission.ts`, and would not have tripped its own
gate.**

---

## The central question, and the answer

*Can this change weaken security-review coverage anywhere?* That is the only way it could do
harm. **It cannot**, and the reviewer demonstrated rather than argued it.

| Claim | How it was established |
| --- | --- |
| **The glob list only grew** | The repository's own parser run on both sides: **19 → 23** globs, `REMOVED = []`, all 19 pre-existing tokens byte-identical, `main` an ordered subsequence of `head`. Precedence cannot matter: matching is `some()` over all globs, with no first-match-wins and no negation syntax. Fuzzed over **27,271 paths** (all 1,341 tracked files plus ~40k adversarial synthetics): **`in-main-but-not-head = 0`** |
| **The predicate only widened** | The old pattern is preserved verbatim as the first top-level alternative; no anchors, groups, backreferences or flags. **0 regressions across 300,000 fuzz inputs.** `new OpenAPIHono(`, `new Hono(`, `new  OpenAPIHono<Env>(` and `new\n\tHono<{}>(` all still match |
| **changed-instead-of-added loses nothing** | Superset by construction (`diff.mjs:77-86` — same array, `filter` cannot add). `--no-renames` makes a rename `D`+`A`, so renames are content-tested. All four scenarios built as real scratch repos with the router at a path **no glob matches**: rename → caught; added-and-glob-matched → counted **once**; unreadable file (`chmod 000`) → **exit 1 with `EACCES`, never "no security-review path touched"** |
| **`MINIMUM_GLOBS` is unchanged** | The regex line is the only non-comment change in `security-paths.mjs` |
| **The corrected figure is a real measurement** | Re-measured by delta (floor 8 → 20 failures; floor 16 → 34): **exactly 14 tests, in 3 suites, across 2 files** — F9-residual in `screens-opened-state.test.mjs` (7), GPT-F2 (5) and GPT-F5 (2) in `stale-review-note.test.mjs` |
| **The probe is genuine** | Each of the three changes reverted independently; each goes red on ≥2 live assertions (2 / 3 / 2 failures), 10/10 restored |
| **The probe's ENOENT self-defence is load-bearing** | Mutating out `installFromRepo(".github/pull_request_template.md")` to recreate the historical crash makes **the two end-to-end tests fail**, on the `doesNotMatch(/ENOENT|SyntaxError|Cannot find module/)` assertion |
| **The gap is actually closed** | All eight named enforcement files go `OUT → IN`; **68 tracked files** newly in scope, including all 20 route modules. The OLD predicate matched precisely **2** files; the NEW one matches **21** (20 route modules + `openapi.ts`), losing none. The `[<(]` character class is load-bearing — **7** modules use `apiRouter<...>()` |

**On the admitted textual proxy.** A router declared through an indirection at a non-glob path
would evade both halves. The reviewer established this is **not reachable**: `grep -c '\.route('`
outside `index.ts` is **0**, and there is no dynamic, `readdir` or glob-based route loading
anywhere in `apps/api`. Mounting requires editing `apps/api/src/index.ts`, which this pull
request puts **in** scope. A defence-in-depth gap, not a bypass.

---

## Findings

**These are ROUND 1's findings, against `0eecc4b`.** LOW A–D and MEDIUM E–F were recorded
rather than fixed, and remain so: **nothing outside `docs/07-planning/security-reviews/` may
land after `0bb15c9`** without voiding the current clearance. Round 2's and round 3's findings
are in their own sections below.

- **LOW A** — `probes/security-scope-enforcement-layer.test.mjs:277-283` asserts a local
  literal against itself, which is vacuous. Follow-up.
- **LOW B** — deleting a whole router at a non-glob path still requires no review.
  Pre-existing, unchanged from `main`, necessary, and materially narrowed by this change.
- **LOW C** — the fenced glob block does not mark its four aspirational globs
  (`middleware/**`, `scim/**`, `webhooks/**`, `plugins-contracts/**`); only the surrounding
  prose does.
- **LOW D** — `\b` makes `$apiRouter(` match (fails safe) and `_apiRouter(` not (covered by a
  path glob regardless).
- **MEDIUM E — `apps/web/**` scope.** The reviewer's opinion, which the author had left as an
  open question: **do not add it wholesale.** The client delegates every decision to the
  server (`use-workspace-permission.ts:9-14`), so it is not an enforcement point, and gating
  the largest tree in a repository that already has a waived Opus gate on record invites
  routine waiving. Recommended instead: narrow globs (`use-workspace-permission*`,
  `auth-client*`, `**/*permission*`, `**/*capabilit*`) plus an invariant that client decisions
  still route through the server. Not a regression, and not this pull request's job.
- **MEDIUM F** — file the durable fix as a tracked follow-up: derive the route surface from
  `collectRoutes(await loadApiApp())`, the actual mounted-route graph, rather than from source
  text. The chokepoint argument above depends on `index.ts` remaining the only mount site.

## Also examined, nothing found

Only one production consumer of the path list, so no second-order gate effects. The parser
handles the four new rows (23 tokens). **The security review is not waivable through the
G1–G13 `gate-waiver` mechanism**, so widening the scope opens no escape hatch. And the real
gate was run against the real pull-request body: it reports 3 problems, all of the form "the
independent review has not happened yet", correctly naming its own 4 in-scope files.

## Method

`git status --porcelain` empty throughout; the head was unchanged at `0eecc4b` before and
after. All scratch work stayed under `/home/ubuntu/.taskdesk-scratch/rev81/`, with `/tmp`
avoided via `TMPDIR` because that filesystem is inode-constrained on this host. Full findings:
`/home/ubuntu/.taskdesk-scratch/review-81-opus.md`.

---

## Round 3 — `074aae3..0bb15c9`, verdict CLEAR

The second review's **MEDIUM M-1** was that the payload SHA was never cross-checked against the
checkout, so a payload naming an **earlier** branch commit — the reviewed head itself, or the
note commit — made a stale note **pass**. Fixed with that reviewer's own recommendation:
`refs/pull/N/merge` has exactly two parents, base first and the pull request head second, so
when `HEAD` is a merge the claimed head must **be** one of them.

The third reviewer rebuilt the bypass from git plumbing rather than accepting the fix, and
reported the decisive flips: the prior matrix's rows 3/3b went from **`PASS(0) BOUND`** to
**`FAIL(1) REFUSED-DISAGREE`**, while the honest note-only case still passes — so the fix does
not work by rejecting everything. It also probed the composition: a payload naming the **base**
parent passes the parent test and is then refused `NOT-ANCESTOR` by the pre-existing invariant,
so the two checks compose rather than overlap.

**Fail-closed confirmed by exit code, not by message.** All four unreadable payload shapes
(`ENOENT`, `EISDIR`, `EACCES`, bad JSON) plus the new refusal exit **1**, with `finish()`
actually running and a structured `## Security review` violation. The decisive measurement: an
M-1 refusal alongside two unrelated failures now reports **`3 problem(s)` in one run**, which
the previous untyped throw made impossible.

**Probes mutation-tested, byte-identity verified on every restore.** Reverting the parent check
turns the M-1 probe red; so does weakening the guard to `> 2`, and so does making
`headParents()` always return `[]`. Removing the 40-hex validation — the surviving mutation from
round 2 — turns the malformed-payload probe red, and it asserts `/is STALE/` rather than a bare
non-zero exit. Best adversarial result: making the payload ignored entirely produces the right
exit for the wrong reason, and the M-1 probe **still** goes red on its second assertion.

**Earlier reviews verified undisturbed at blob level**, not by filename: `security-paths.mjs`,
`ci-cd.md`, `diff.mjs`, `security-review-note.mjs` and `git-baseline.mjs` are byte-identical to
both prior heads, and `pr-body.mjs` is behaviourally inert (its comment-stripped diff is one
line — the dead ternary collapsing to `return null`).

### Four LOW findings, all follow-up hardening, none blocking

- **C-1** — the check is inert when `HEAD` has one parent, so a lying payload passes there. Not
  reachable in this repository's CI: default `actions/checkout` on `on: pull_request` always
  yields a two-parent merge ref.
- **C-2** — `parents.includes()` accepts **any** parent rather than specifically the second. A
  three-parent `HEAD` naming an unrelated parent would pass.
- **C-3** — `headParents()` conflates "not a merge" with "cannot read `HEAD`". Refusing on a
  non-zero `git` status would cost nothing.
- **C-4** — **the typed-error fix is itself unprobed:** reverting it to a plain `throw` leaves
  the whole suite green, because a crash also satisfies "non-zero exit and message present".

Both regions in C-1 and C-2 were **strictly worse** at `074aae3`, so this is a narrowing.
