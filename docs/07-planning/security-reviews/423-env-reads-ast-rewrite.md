# PR #423 — env-reads.mjs AST rewrite (issue #342)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; read the
actual worktree files directly given this PR's size, rather than a pasted diff)
**Session:** subagent `ae5ef6a9f834fd548`

**Reviewed head:** `9fc7f825a50ee3d1df6c714e029f77c325114249`

**Verdict: NOT CLEAN.** One HIGH finding (file-wide, unscoped shadow tracking for
`process`/`globalThis`/`global`/`window` silently suppressed a genuinely unrelated real
`process.env.X` read elsewhere in the same file — persisted across the 10-round fixed-point
alias-resolution loop) and one MEDIUM finding (no tree-walk case for
`ObjectLiteralExpression`/`ArrayLiteralExpression`/`ConditionalExpression`/logical
`||`/`??`, so embedding the bare bag/global in one of those containers was never charged,
unlike the existing spread-handling case). Both independently re-confirmed by the
orchestrating session by direct source read before commissioning a fix (traced the
file-wide `shadowed` Set's persistence across fixed-point rounds; confirmed the existing
test suite never tested a shadow coexisting with a genuinely separate real read).

**Also confirmed correct:** computed-key fail-closed behavior in `memberMatch`,
parse-failure fail-closed behavior in `check-env.mjs`, M1 module-boundary export charging,
and — checked directly against `packages/email/src/smtp-config.ts` and
`env-baseline.json` — the SMTP_* behavior-neutrality claim (both parameter-default sites
match the existing baseline fingerprints verbatim).

## Fix (round 1, commit `0d07d84`)

Replaced the file-wide `shadowed` Set with `isShadowedAt(node, name)` — walks the real
parser's `.parent` chain from the identifier being classified, checking for an enclosing
function whose own parameters bind the name, or an enclosing `catch` clause binding it.
Added tree-walk cases for `PropertyAssignment`/`ShorthandPropertyAssignment`/
`ArrayLiteralExpression` elements/`ConditionalExpression` branches/`||`/`??` operands,
charging via the existing `chargeBareValueIfEscaping` helper.

**Independently re-verified by the orchestrating session before commissioning the Opus
pass** (not a substitute for it — a real logic change always needs a fresh independent
reviewer): read `isShadowedAt`'s implementation directly, confirmed the parent-chain walk is
structurally sound for the case it targets; ran `node --test
scripts/ci/lib/env-reads-342.test.mjs` directly (74/74 pass, including the new regression
test reproducing the exact concrete failure case); ran the full suite (686/686); ran
`check-env.mjs` against the real repo directly (29 attributable reads, 52 baselined
deviations, matching the claimed unchanged output).

## Security review

**Model:** Opus 5.5, fresh independent context (pass 1)
**Session:** subagent `a56bb1e96568ba929`

**Reviewed head:** `0d07d8433fb98f2bfa01fa23f897ce5bde824fb5`

**Verdict: BLOCKING.**

Confirmed the round-1 Finding 1 fix works for its target case, and found one real
follow-up: `isShadowedAt` treats anything inside a function NODE as shadowed, not just its
body/parameters — so a computed class-member key or a decorator argument (which run in the
OUTER scope and see the real `process`) get wrongly treated as shadowed, e.g.
`class C { [process.env.SECRET_KEY](process) {} }` now silently returns zero reads where the
old tokenizer charged it. Confirmed Finding 2 (containers) has no double-count —
`chargeBareValueIfEscaping` only fires for a bare bag/global value.

**The blocking issue is new and larger: the rewrite drops coverage for roughly 26 shapes the
old tokenizer on `main` caught**, verified empirically — 42 hand-built probe files run
through both the old tokenizer (checked out from `origin/main`) and this PR's new AST
walker, in fresh scratch worktrees. The old tokenizer charged every bare
`process.env`/`import.meta.env` not followed by a member access as an alias read (a
blanket fail-closed default); the new walker only charges the specific contexts its
tree-walk switch explicitly lists, so everything not in that list now silently returns zero
reads.

Concrete missed shapes, grouped:

| Group | Shapes |
| --- | --- |
| Constructors | `new Config(process.env)`, `new X(process.env as any)`, `new Wrapper(process)` |
| Values returned | `return process.env` in a local function; `() => process.env`; an exported function whose return is inside an `if`; `yield process.env` |
| Operators | `(0, process.env).X`, `(0, process).env.X`, `(true && process.env).X`, `e ||= process.env`, `"X" in process.env` |
| Assignments | `({ SECRET } = process.env)`, `o.env = process.env`, `module.exports = process.env` |
| Classes | field initializer `class C { env = process.env }` |
| Destructuring from `process` | a quoted or computed key: `const { "env": e } = process`, `const { ["env"]: e } = process` |
| JSX (`apps/web`) | `<C {...import.meta.env} />`, `<C env={import.meta.env} />` |
| Other | `import("node:process").then(({ env }) => env.X)`; a tagged template |

Some gaps predate this PR and remain out of scope (rest-destructuring from
`process`/`globalThis`, `.default.env` through a dynamic/namespace import,
`const { "process": p } = globalThis`). The rewrite does genuinely improve three shapes
(`[process]` array aliasing, a plain alias passed as a call argument, `export { e }`).

**Recommended fix (structural, not another round of case-by-case patches):** flip the
walker's default — whenever `classify()` resolves a node to
`env`/`importMetaEnv`/`process`/`importMeta`, charge it as an alias read unless its parent
is one of the specifically recognized consumers (a narrowing member access, a tracked
alias/destructuring declaration, a resolved wrapper call, the `.then` callback) — restoring
the old tokenizer's fail-closed default instead of enumerating contexts to explicitly allow.
Each row in the table above should get a regression test.

**Independently confirmed, not new findings:** the SMTP_* behavior-neutrality claim (ran
`check-env.mjs --report` on this head and on current `origin/main`, byte-identical 174-line
output). Ran the test suite directly: `env-reads-342.test.mjs`+`env-reads.test.mjs` 82/82,
`scripts/ci/**/*.test.mjs` 683/686 (3 failures are a missing-`tsc`-binary environment
artifact in the reviewer's own scratch worktree, consistent with the working lane's own
686/686). Confirmed the parse-failure fail-closed path in `check-env.mjs` still works.
Confirmed the module's own "Accepted limits, by design" header comment now overclaims — it
still lists "passed as a bare function argument" as an accepted limit even though arguments
are now charged, and says nothing about the shapes above.

**Surfaces examined:** `scripts/ci/lib/env-reads.mjs` in full at this head; the old
tokenizer on `origin/main` (re-executed, not just read); `check-env.mjs`/`scratch-repo.mjs`'s
diffs; 42 hand-built probe files run through both old and new detectors;
`packages/email/src/smtp-config.ts` and `scripts/ci/env-baseline.json` (direct comparison).

A fix implementing the structural approach change above was commissioned; see pass 2 below.

---

## Security review — pass 2 (delta on the structural fix)

**Model:** Opus 5.5, fresh independent context (did not author or review pass 1)
**Session:** subagent `ac6bb54e95ad0d003`

**Reviewed head:** `871e16de9191ca0c03b1243738d30fa9410aaba6`

**Verdict: CLEAR WITH FINDINGS (all non-blocking).** Independently confirmed the structural
default-flip works: ran the full test suite (712/712), ran `check-env.mjs --report` against
the real repo at this head and at the merge base — byte-identical 174-line output, both
`packages/email/src/smtp-config.ts` sites still match the baseline exactly. Constructed
~110 of its own adversarial probe snippets (not the PR's own tests) and ran them against
both this head and the pre-#423 tokenizer on the merge base: confirmed every pass-1 table
row is caught, including the tagged-template case, plus roughly 70 further variants not in
any test (`super(process.env)`, `yield*`, `for…in`, `switch`, getter returns,
`${process.env}` inside a template, `static {}` blocks, JSX children/spread, and more) —
direct evidence the structural fix generalizes rather than merely covering the enumerated
list. Independently re-confirmed the shadow-scoping follow-up with its own additional
adversarial variants beyond the four pass 1 asked for.

**Findings, all low-severity, none blocking:**

- **F1 (new false negative, narrow):** the resolved-wrapper-call exception in
  `isSafeConsumingContext` exempts *every* argument of a call like `require(...)`, not just
  the one `classify()` actually consumes — so a second/extra argument
  (`require("process", process.env)`) is silently dropped. Only reachable with a shadowed
  `require`, same adversarial class as other already-accepted narrow gaps. Exact fix
  specified: replace the `includes` check with `parent.arguments[0] === effNode`.
- **F2 (new false negative, harmless at runtime):** `isTrackedAliasDeclarationSite` treats
  an `ArrayBindingPattern` as already-handled, but `handleBindingDeclaration` just returns
  for an array pattern without charging anything — `const [a] = process.env` gives `[]`.
  Neither pattern is actually iterable so it throws at runtime anyway; the comment's claim
  is still inaccurate. Fix: remove `ArrayBindingPattern` from `bindableName`.
- **F3 (new false positive, fails safe):** an assignment's LHS gets charged once the name
  is a tracked alias (`let x; x = process;` charges once where `const p = process;`
  charges zero) — over-counts, never under-counts.
- **F4 (new false positives, fails safe, none present in the real repo):** several NAME
  positions aren't in `DECLARATION_NAME_HOLDER_KINDS` and get charged as if they were value
  references — `typeof process !== "undefined"` (a common guard, most likely to surface
  later), type positions, labels, a JSX attribute name, a destructuring key, an import's
  original name, `export { process }` shapes.
- **F5 (doc accuracy):** the file's header/"Accepted limits" section (lines 1–58, untouched
  by this delta) still describes the old allow-list design and lists things as limits that
  are now actually caught (bare function arguments, non-exported-function returns,
  `.then(cb)`); doesn't list real remaining gaps (rest-destructuring from
  `process`/`globalThis`, `.default.env` through a dynamic/namespace import, the
  truthiness-test exemption, `self.process`); two stale comment references
  (`maybeChargeBareEscape` doesn't exist; a doc comment cites the wrong parameter count).

**Surfaces examined:** `scripts/ci/lib/env-reads.mjs` in full at this head; ~110 hand-built
adversarial probes run against both this head and the pre-#423 tokenizer on the merge base;
the shadow-scoping fix with its own additional variants; the real repo via
`check-env.mjs --report`.

A narrow fix for F1/F2/F3/F4 (each exact and specified above) plus F5's doc correction was
commissioned as a delta; see pass 3 below.

---

## Security review — pass 3 (short delta on the F1-F5 fix)

**Model:** Opus 5.5, fresh independent context (did not author or run passes 1/2)
**Session:** subagent `a5c225b7baebb5639`

**Reviewed head:** `6d9b83b32b5aefe20016b78d546f5462d86bbb01`

**Verdict: BLOCKING.** F1, F2, and F4 confirmed correct. F3's right-hand-side exemption in
`isTrackedAliasDeclarationSite` is too broad: it treats `x = <value>` as safe whenever `x`
is a plain identifier, without checking whether the assignment's own value is actually
consumed rather than thrown away as a standalone statement — a genuine sixth problem, a
fail-open regression relative to pass 2's own cleared head (`871e16d`), confirmed by running
41 hand-built probes against both heads: `f(x = process)`, `use((x = process).env.SECRET)`
(a real named read, now silently dropped), `y = x = process; use(y.env.SECRET)`,
`const y = (x = process); use(...)`, `return x = process;`, and
`export default (x = process);` all silently returned `[]` at this head where `871e16d`
correctly charged each one.

**Exact fix specified and pre-tested in a throwaway copy:** in the `BinaryExpression` branch
of `isTrackedAliasDeclarationSite` (~line 383), add a check that the assignment's own parent
(through `effectiveParent`) is an `ExpressionStatement` — i.e., genuinely a standalone
statement, not consumed as a value anywhere. Confirmed this restores all six probe shapes
while keeping the original F3 cases correct. One accepted side effect noted: `f(x =
process.env)` now double-charges rather than misses.

**F1/F2/F4 independently re-verified correct**, including one further adjacent case the
reviewer tested on its own initiative (`export { p as process }` where `p` is a tracked
alias — correctly charges exactly once on the local name `p`).

**F5:** mostly accurate; two small corrections requested (the `.then(cb)` callback's
coverage is the dedicated `.then` case, not the default-flip; the exemption description
should note the standalone-statement condition once F3 lands).

**Noted, not blocking, pre-existing since `871e16d`:** `export { process } from "./x"` and
`export { process as y } from "./x"` both charge even though neither is ever actually the
real global — a false positive, safe direction, filed as a follow-up.

**Surfaces examined:** the five fixes plus surrounding code; 41 hand-built probes against
both this head and `871e16d`; the real repo via `check-env.mjs --report` (unchanged: 29/52).
