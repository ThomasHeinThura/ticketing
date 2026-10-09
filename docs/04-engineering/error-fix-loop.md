# Error fix loop

Stage 7 of the [SDLC](sdlc.md). How to fix something without making it worse, and when to
stop trying.

## The loop

```
        ┌──────────────────────────────────────┐
        ▼                                      │
   Reproduce  →  Understand  →  Fix  →  Verify ─┘ (if not fixed)
                                          │
                                          ▼
                                   Guard  →  Record
```

Every step in order. The most common failure is skipping **Understand** and going straight
from a symptom to a plausible change.

---

## 1 · Reproduce

You cannot fix what you cannot reproduce. If it only happens sometimes, that *is* the bug —
find the condition.

- Write a **failing test first**. It reproduces the problem, it proves the fix, and it
  prevents the regression. Three jobs for one artefact.
- Capture the exact conditions: role, data, browser, timing, concurrency.
- If reproduction takes more than thirty minutes, that is information: the system is hard
  to observe, and that is worth fixing too.

## 2 · Understand

**Find the cause, not the symptom.**

Ask "why?" until you reach something structural:

> The board shows a stale card.
> — *Why?* The query was not invalidated.
> — *Why?* The WebSocket message carried a different key shape.
> — *Why?* The broadcast used `id` where the query key uses `key`.
> — *Why?* Nothing enforces that broadcast payloads match query keys.

The last answer is the one worth fixing. Patching the first produces a fix that works and
teaches nothing.

**Do not change code until you can say, in one sentence, why it is broken.**

## 3 · Fix

- The smallest change that addresses the cause.
- Do not refactor while fixing. Two changes in one pull request means neither is reviewed
  properly.
- Do not fix adjacent things you noticed. Note them, open issues, move on.
- If the fix reveals the spec was wrong, **update the spec** and re-enter at SDLC step 3.

## 4 · Verify

Re-run from the earliest step the change could have affected:

| Change touched | Re-run from |
| --- | --- |
| `packages/domain` | Stage 4 — unit |
| An API route | Stage 5 — integration and permissions |
| A UI component | Stage 6 — UX gates |
| The schema | Stage 4, with a migration test |

Then **open the thing and use it**. Automated verification is necessary and insufficient —
v1's worst defects were all green.

## 5 · Guard

If the bug was an instance of a *class*, add something structural so the class cannot
recur.

Precedents already in this project:

| Bug class | Guard |
| --- | --- |
| A route with no permission check | Route policy coverage test |
| A screen with no URL | Route registry round-trip test |
| A bespoke UI primitive | Lint rule (G1) |
| A hard-coded colour | Token check (G2) |
| Cross-tenant leak | Tenant isolation test |
| Internal comment leaking to the portal | Separate portal router plus a named test |
| A bare `now()` beside a `timestamp` column, or a raw `Date` bound into one | `dbNowUtc()`, and the rule in [coding standards](coding-standards.md#database) |

A guard is worth far more than a fix. A fix closes one hole; a guard closes the shape of
the hole.

## 6 · Record

- Root cause stated in the pull request. Not the symptom — the cause.
- If the lesson generalises, add it to the **Lessons** section below.
- If it changed a decision, add a [decision log](../07-planning/decision-log.md) entry.

---

## The three-attempt rule

**After three failures on the same mechanism, stop speculative iterations and change altitude.**

Write down:

1. What is happening, precisely.
2. What you expected.
3. The three things you tried and what each produced.
4. What you have ruled out.
5. Your current best hypothesis.

Pause iterations on that mechanism, not unrelated authorized tasks. Put the five-item note in
the PR, a dated **Blocked** status entry and the
[integration queue](../07-planning/integration-execution-queue.md). Escalate to Thomas only the
owner-only decision, waiver or unavailable external access; technical diagnosis and structural
remediation remain authorized. A required reviewer-capacity block stays at its existing tier.

Before any further runner iteration:

1. Identify the root cause from preserved failure evidence; state the mechanism and what
   remains unknown. If the cause is unknown, gather targeted diagnostic evidence first.
2. Replace repeated special cases with the necessary structural invariant/helper/redesign.
   Keep the repair bounded to the identified cause and its integration dependencies.
3. Add a regression that fails before the fix and passes after through the **complete real
   invocation path**: actual entry command/wrapper, arguments and environment/config loading,
   process lifecycle, real runtime/service interactions, result/artifact production and exit
   status/cleanup as applicable. A helper-only test or offline fixture is not this regression.
4. Run that regression and applicable source-bound checks before scheduling another expensive
   runner/acceptance pass. Preserve command, source SHA, counts, receipts and failures.
5. Review the current candidate at the existing risk-appropriate Luna/Sol tier. Do not add
   automatic comfort rounds; changed source still needs the required independent delta review.

Do not reset this threshold with a new symptom, branch, session or reviewer. Offline
simulation may isolate a defect, but cannot substitute for actual runtime/SIT acceptance.
Keep the same budgets, negative assertions, suite counts, exact-source requirements and CI
checks; disabling tests or widening thresholds to make a runner green is not convergence.

This applies especially to AI agents, where the failure mode is generating variation after
variation without new information. A fourth variation on a wrong model of the problem is
not progress, and the fifth will not be either. The rule converts a spiral into a
conversation.

---

## Anti-patterns

| Don't | Why |
| --- | --- |
| Disable the failing test | You have hidden the bug, not fixed it. Never acceptable |
| Add a `try/catch` that swallows | The error was information; you deleted it |
| Add a `setTimeout` to "let it settle" | You have made it slower and still racy |
| `as any` to silence the compiler | The compiler was right |
| Widen a permission to make it work | You have created a security bug to fix a UX one |
| Revert someone else's guard | Ask why it exists first. It exists because something went wrong |
| Fix the symptom and move on | It will come back, in a different shape, later, worse |
| Keep going after three failures | See above |

---

## When a build fails in CI

1. **Read the actual error.** Not the summary — the error.
2. Reproduce locally with the same command CI ran.
3. If it fails locally, it is a real failure. Fix it.
4. If it passes locally, it is an environment difference: timing, data, ordering,
   parallelism, timezone. Those are the usual suspects, in that order.
5. If it is flaky, **fix the flake**. Do not retry the job. A suite with known flakes
   stops being trusted, and then a real failure gets retried too.

---

## Lessons

Add to this as things are learned. It is the institutional memory that agents do not have.

### From v1

- **Green tests proved nothing about authorization.** Eleven holes shipped past a full
  suite, because a test only fails for behaviour someone thought to assert. The answer is
  structural: policy coverage and a permission matrix.
- **"It looked fine" was not verification.** Four active buttons rendered with empty icon
  paths. Icons must be imported directly so a missing one is a compile error.
- **Display-name comparison collided.** Compare identities by id, always.
- **Fire-and-forget notifications hid failures.** An outbox with visible delivery history
  is the correction.
- **Bundle separation created false confidence.** "It isn't in the customer bundle" is not
  a security argument.

### From v2

- **A lightweight lexer is not an authority for suppressing suspicious source text.** If a
  CI gate cannot prove a raw environment access was already classified, it must fail
  closed even when the text appears inside a comment or string; JSX and template syntax can
  make a handwritten scanner misidentify those spans. Attribute destructuring only when
  every key is a flat, static identifier; nested or computed patterns remain unattributable.
  The guard belongs in the detector and its regression suite, not in a growing list of
  syntax-specific exemptions.
- **A hand-written regex/lexer CI gate keeps finding new bypass classes; the fix is a real
  parser, not another exemption.** check-deps.mjs's workspace-boundary gate (`4540cfd`,
  #361) and check-env.mjs's raw-environment-access gate (the lesson above) each started as
  a regex/lexer scanner and each needed a full rewrite once a new evasion shape turned up.
  check-ui.mjs's Radix-import gate repeated the pattern a third time (#255): a Unicode
  escape inside the quoted specifier, a comment between the `from`/`import` keyword and the
  quoted string, and a no-substitution template-literal dynamic import all defeated its
  regex — three more shapes a hand-written pattern cannot anticipate in advance, not three
  more special cases to patch it for. `typescript/unstable/ast` (via
  `typescript/unstable/sync`'s `API`) is already a repo devDependency and already used by
  check-deps.mjs; reach for it at the *first* such finding in a gate, rather than adding a
  regex exemption and waiting for the next evasion to arrive. check-env.mjs itself
  eventually made the same move (#342): two rounds of patching its hand-written
  tokenizer (#352, then #382's "D3" follow-up) each closed the named shapes and each left a
  narrower instance of the *same* class open — an unresolvable JSX-text/comment/regex
  divergence between the tokenizer's own grammar and the real one, casts and string
  escapes the tokenizer read as raw text instead of the parser's already-decoded value, and
  a bare-argument heuristic that both under- and over-fired (flagging a parameter or
  catch-clause binding merely *named* `process`, while still not tracing an exported
  re-export of the real global to another module). The tokenizer was retired rather than
  patched a third time; `lib/env-reads.mjs`'s own header is the detailed account of how the
  real parser closes each of those for structural reasons, not one more special case per
  finding. `strip-code-comments.mjs`'s regex-vs-division scanner was the fourth instance of
  the same class (#421): three prior patches (the original #143 lookback fix, dropping the
  contextual keyword `of`, then excluding reserved words used as property/field names) each
  closed one narrower shape and left a disclosed one open — a `)` closing an
  `if`/`while`/`for` condition permits a following regex, which a previous-token lookback
  cannot tell apart from an ordinary call's `)` without real paren-matching. Switched to the
  same real-parser mechanism rather than a fourth instance-patch; see that file's own header
  for the account.
- **A React context Provider whose register/unregister calls go through `setState` can
  create an unbounded re-render loop with no built-in guard** (#407): registering
  something real state → Provider re-renders → its inline context `value` object gets a
  new identity → every consumer re-renders (including the one that just registered) →
  a consumer whose own effect depends on a freshly-built config object sees a new identity
  and re-registers → back to the first step, forever. Not a same-render `setState` loop
  (React's "Maximum update depth exceeded" guard does not catch it — each commit is a
  genuinely new one). The fix is structural, not caller-side: a registry that is only ever
  read inside an event handler (never during render) does not need to be `useState` at
  all — a `ref` breaks the cycle at its source, and the Provider's context `value` should
  be memoized regardless, so an unrelated re-render doesn't cascade to every consumer.
  Fixing only one caller (memoizing its config object) would have left every other
  caller of the same hook exposed to the identical loop.
- **A handler that re-dispatches the same event type it is registered under recurses if
  anything is still listening for that type.** #294: `command-palette/index.tsx` registered
  a shortcut for `"?"` whose handler did `document.dispatchEvent(new KeyboardEvent("keydown",
  { key: "?" }))` — meant, apparently, to forward the keypress somewhere. The shared
  `KeyboardShortcutsProvider` (`apps/web/src/hooks/use-keyboard-shortcuts.ts`) has exactly one
  document-level `keydown` listener multiplexing every registered shortcut; that listener
  picked the synthetic event straight back up, found `"?"` registered again, and called the
  handler again — `RangeError: Maximum call stack size exceeded`. The actual dialog this
  handler thought it needed to trigger (`keyboard-shortcuts-help.tsx`) already listens for the
  real keydown independently, so the registration was dead weight, not a working forward.
  Before adding a dispatch that re-emits the same event type a component (or a shared
  listener it feeds into) is itself listening for, trace who else is listening for that type
  and confirm the forward is actually load-bearing.
- **A TypeScript symbol's `declarations` array can hold an ambient augmentation with a real
  workspace path, indistinguishable from a real declaration by path alone.** #393 (following
  #389/#390): `check-deps.mjs`'s `resolveWorkspaceTarget` walked a bare third-party import's
  checker symbol and returned the first declaration whose path fell inside any workspace,
  on the assumption that a real (non-workspace) declaration would always be found first.
  Not an array-order bug: in both the real repro and a fresh one, the module's own true
  declaration consistently comes first in `symbol.declarations` — order was never the
  mechanism. The real cause is that this file resolves symbols through TypeScript 7's
  native API (`typescript/unstable/sync`), where every declaration handle — a `SourceFile`,
  a `ModuleDeclaration`, any kind — carries a real `.path` for its containing file. A
  third-party module's own declaration lives under `node_modules`, so its path falls outside
  every workspace and the loop harmlessly continues past it regardless of position; an
  ambient module augmentation (`declare module "some-pkg" { ... }`) written into workspace
  source, though, has a `.path` that *does* fall inside a workspace, making it the only
  declaration that matches — and it wins regardless of where it sits in the array. One
  `declare module "vitest" { ... }` in `packages/ui`'s test helpers misattributed every
  OTHER package's `import ... from "vitest"` to `@taskdesk/ui`, 69 false violations from one
  augmentation. The guard is structural, not per-caller: any code walking a module symbol's
  declarations to prove ownership must skip `ts.SyntaxKind.ModuleDeclaration` entries —
  they can never be a bare specifier's real home in that kind of fallback — rather than
  re-excluding whichever specific module tripped it this time.
- **`in` on a plain object also matches `Object.prototype`, not just the object's own
  keys.** #424 (F3, Opus finding N1): a new membership check in `check-deps.mjs`,
  `packageName in { ...four package.json dependency fields }`, silently treated a
  specifier segment named `toString`, `constructor`, `valueOf`, `__proto__`, etc. as "a
  declared dependency," because `in` walks the prototype chain and every plain object
  inherits those names from `Object.prototype`. The same class of gap was already
  live and pre-existing elsewhere in the same file: `FLAGGED_MESSAGES[imported.specifier]`
  (a plain object keyed by specifier string) reads `FLAGGED_MESSAGES["__proto__"]` as
  `Object.prototype` itself — truthy, not `undefined` — and then tries to call it,
  crashing the whole checker with a `TypeError` instead of producing a violation or a
  clean failure (filed as its own follow-up, #464, since it predates this PR and is out
  of its scope). Fixed the new code with `Object.hasOwn(merged, key)`, which only
  matches the object's own enumerable properties. Any specifier-keyed (or otherwise
  attacker- or content-influenced-keyed) lookup against a plain object literal or a
  spread-merged manifest should use `Object.hasOwn`/`Map`, never bare `in` or bracket
  truthiness, for exactly this reason.

## Related

- [SDLC](sdlc.md) · [Testing strategy](testing-strategy.md)
- [Agent workflow](agent-workflow.md)
