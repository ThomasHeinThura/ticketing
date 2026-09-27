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

A fix implementing the structural approach change above is being commissioned. This PR is
not merge-ready until a fresh Opus pass confirms the fix closes this class.
