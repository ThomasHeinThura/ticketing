# Pre-merge security review — PR #253 (`KNOWN-RADIX.md` + `check:ui`, the Radix-tracking half of gate G1, #9)

**Reviewed head:** `9ae24a1d53bf8ecbab9cdc9c05939a8c26a23b47`

**Reviewer:** Opus 5, fresh independent context. Did not author, direct or remediate any part
of this change. Reviewed in an isolated detached checkout at the exact head above, never on
`main`.

**Verdict: CHANGES NEEDED (blocking).** One blocking finding: the new gate is evadable by a
real, resolvable module specifier — `radix-ui/<subpath>` — which reintroduces the exact
dependency this PR removes while `check:ui` stays green. Reproduced live, not reasoned about.
The fix is one line plus one unit test. Everything else in the change verified correct,
including the `mergeProps` reimplementation (compared against the actual
`@radix-ui/react-slot@1.3.3` build, found on this host), the React 19 `getElementRef` claim,
the CI wiring (three tamper probes, all caught), the null-byte remediation, and the
dependency removals.

---

## Scope of the diff — confirmed exactly as claimed

`git diff origin/main...HEAD` is 11 files, and the merge-base is `origin/main` itself, so the
three-dot diff is the true diff:

```
.github/workflows/ci-fast.yml           |  20 +-
KNOWN-RADIX.md                          |  17 ++   (new)
apps/web/package.json                   |   2 -
apps/web/src/components/ui/form.tsx     |   2 +-
apps/web/src/components/ui/timeline.tsx |   4 +-
apps/web/src/lib/slot.tsx               | 119 ++   (new)
package.json                            |   1 +
pnpm-lock.yaml                          | 499 --
scripts/ci/check-ui.mjs                 | 259 ++   (new)
scripts/ci/check-ui.test.mjs            | 172 ++   (new)
scripts/ci/test-all.mjs                 |   9 +-
```

Nothing else changed. The third commit (`9ae24a1`) is a clean merge of `origin/main`: it
touches only four files that came from `main` (`column-migration.ts`,
`seed-default-workspace-roles.ts` and two #134 test/doc files) and carries no
conflict-resolution edit to any file this PR owns. Verified with
`git diff 34d1269 9ae24a1`.

---

## BLOCKING — B1. `radix-ui/<subpath>` evades the gate entirely

`isRadixSpecifier` (`scripts/ci/check-ui.mjs:63-65`) is asymmetric:

```js
return specifier === "radix-ui" || specifier.startsWith("@radix-ui/");
```

The scoped org is matched by prefix; the umbrella package is matched by **exact string only**.
But `radix-ui@1.6.7` ships a wildcard export map and per-primitive dist files:

```json
"exports": { ".": {...}, "./*": { "import": { "default": "./dist/*.mjs" } }, ... }
```

`node_modules/radix-ui/dist/slot.mjs` exists and exports `Slot` / `Root`. So
`import { Slot } from "radix-ui/slot"` is a working, resolvable import of the umbrella
package — the identical capability `timeline.tsx` had before this PR — and `check:ui` does
not see it.

Reproduced at this exact head. Three probe files were dropped into `apps/web/src/lib/` and
`check:ui` was run:

| Probe | Specifier | Result |
| --- | --- | --- |
| `__probe1.ts` | `import { Slot } from "radix-ui/slot"` | **NOT DETECTED — gate green** |
| `__probe2.ts` | `await import("@radix-ui/react-slot")` (dynamic) | caught |
| `__probe3.ts` | `import { Slot } from "@radix-ui/react-slot/dist/index.mjs"` | caught |

With all three present, `check:ui` reported `2 problem(s)` and exit 1 — probe 1 was silently
absent from the report.

Why this is blocking rather than a note:

- It is a **fail-open in brand-new gate machinery**, in the one mechanism this PR exists to
  create. The gate's own `KNOWN-RADIX.md` states it "fails the build if any file in the
  repository imports `@radix-ui/*` or the bare `radix-ui` umbrella package". `radix-ui/slot`
  **is** the umbrella package; the claim is not true as shipped.
- `docs/02-design/ux-quality-gates.md:22` (G1b) and `docs/04-engineering/testing-strategy.md:316`
  both state the rule as "the `radix-ui` umbrella package", with no subpath carve-out. The
  implementation does not meet its own written contract.
- This repository has already been bitten by one level of exactly this mistake:
  `docs/07-planning/reviews/2026-09-05/pre-p0-check-fable/L5-design-ui.md:12` flagged that a
  checker matching only `@radix-ui/` would miss `timeline.tsx`'s umbrella import. This is the
  same error one level down.
- The fix is one line and one test, in a PR that is otherwise clean.

**Required fix:**

```js
function isRadixSpecifier(specifier) {
  return (
    specifier === "radix-ui" ||
    specifier.startsWith("radix-ui/") ||
    specifier.startsWith("@radix-ui/")
  );
}
```

plus a unit test in `scripts/ci/check-ui.test.mjs` pinning `radix-ui/slot` (the subpath form
is what makes the regression real, not the bare form that is already tested). Note that with
the fix, `radix-ui/slot` and `radix-ui` remain **distinct** table keys, which is correct and
consistent with how the scoped subpath case already behaves.

---

## Verified correct

### V1. `mergeProps` is an exact match for `@radix-ui/react-slot@1.3.3`

Compared against the real thing, not from memory: a cached copy of the exact pinned version
exists at
`node_modules/.pnpm/@radix-ui+react-slot@1.3.3_@types+react@19.2.18_react@19.2.8/node_modules/@radix-ui/react-slot/dist/index.mjs`.
Its `mergeProps` and `apps/web/src/lib/slot.tsx`'s `mergeProps` are algorithmically identical,
clause for clause:

- **Event-handler composition order:** both run **the child's handler first**, then the slot's,
  and return **the child's** return value. (`const result = childPropValue(...args); slotPropValue(...args); return result;`)
  A handler present only on the slot is used as-is; a handler present only on the child is
  left untouched by the spread. Matches Radix's documented behavior.
- **`style`:** `{ ...slotPropValue, ...childPropValue }` — the **child's** values win. Match.
- **`className`:** `[slot, child].filter(Boolean).join(" ")` — slot first, child second, empty
  values dropped. Match.
- **Every other shared prop:** the child's value wins, via `overrideProps = { ...childProps }`
  and the final `{ ...slotProps, ...overrideProps }`. Match.

### V2. `getElementRef`'s React 19 claim is correct for the version actually pinned

React resolves to **19.2.8** throughout `pnpm-lock.yaml` (`apps/web/package.json` declares
`react: ^19.2.8`, `@types/react: ^19.2.18`; the lockfile resolves `react@19.2.8` everywhere,
including inside every `@radix-ui/*` peer graph). On React 19 the element's `ref` is an
ordinary prop, so `element.props.ref` is the correct read. Radix 1.3.3's own function has two
DEV-only branches that sniff React ≤18 via `isReactWarning` getters and then falls back to
`element.props.ref || element.ref`; on React 19 both the DEV branch and the fallback's first
operand yield `element.props.ref`. The local one-liner is therefore correct for this repo's
pinned React, and the comment is accurate rather than plausible-sounding. It would be wrong
only if this repo dropped to React ≤18, which the lockfile forbids.

### V3. Ref composition — the "no forwardedRef" case is exactly right

`mergedProps.ref = forwardedRef ? composeRefs(forwardedRef, childRef) : childRef` is
line-for-line Radix's `mergedProps.ref = forwardedRef ? composedRef : slottableElementRef`.
The fall-through to the child's own ref when there is no forwarded ref is correct.
`composeRefs` handles callback refs (`typeof ref === "function"`) and object refs
(`ref.current = node`) and skips `null`/`undefined`, matching Radix's `setRef`. The
`children.type !== React.Fragment` guard is present and matches.

Both call sites in this repo pass **no** ref (`FormControl` and `TimelineDate` are plain
function components, not `forwardRef`), so `forwardedRef` is always `null` and the
`composeRefs` branch is currently unreachable — which bounds findings F2 and F3 below.

### V4. The null-byte remediation is genuinely clean

`scripts/ci/check-ui.mjs` at this head contains **zero** control bytes (checked
byte-by-byte: no byte below 0x09, none in 0x0B–0x1F, no 0x7F); the only non-ASCII bytes are
one em-dash sequence. `file` reports "Node.js script executable, Unicode text, UTF-8 text",
and `git diff` renders it as text. The separator logic is still correct and still
unambiguous: the composite key is `` `${file}\n${pkg}` `` on both the table side
(line 195) and the scan side (line 216), and neither a repo-relative path nor an npm package
name can contain a newline. The fix commit (`34d1269`) changes only that.

### V5. Table semantics — cross-package satisfaction is correctly impossible

Probed directly. A `KNOWN-RADIX.md` row naming `radix-ui` against a file that actually
imports `@radix-ui/react-slot` produces **two** failures — the unlisted import *and* the
stale row — not a pass. Correcting the row to the exact specifier then passes. Stale-row
detection fires on a row whose file no longer imports that package. The bare umbrella and a
scoped subpackage are genuinely distinct keys.

A scoped **subpath** import (`@radix-ui/react-slot/dist/index.mjs`) is reported with the full
specifier as the package, so an existing row for `@radix-ui/react-slot` does not satisfy it.
That is fail-closed and correct.

### V6. The CI wiring is genuinely enforced

- The `pnpm check:ui` step in the `registers` job has **no `if:`** and **no
  `continue-on-error:`** — `.github/workflows/ci-fast.yml:162-169`.
- The job's display name — `registers - env, vocabulary, reviews, skips, overrides`, the
  exact string the `protect-main` ruleset binds — is **unchanged** by this PR.
- Three tamper probes were run against the reconciliation in my own isolated checkout, and
  all three go red (exit 1):

| Probe | `node scripts/ci/test-all.mjs --list` |
| --- | --- |
| add `continue-on-error: true` to the step | **FAIL** — "every workflow occurrence of it CANNOT FAIL A PULL REQUEST … a gate in name only" |
| delete the step entirely | **FAIL** — "marks `pnpm check:ui` ENABLED and NO workflow executes it" |
| add `if: false` to the step | **FAIL** — "step `if: false` — it never runs" |

The manifest entry moved from `run: null` + `why:` to `run: ["pnpm","check:ui"]` + `note:`;
`note` is an established key already used by `pnpm lint`, `pnpm test:contract` and others.
`pnpm check:ui` now prints as `enabled` in `--list`.

### V7. The dependency removals are safe

Grepped the whole repository myself (excluding `.git`, `node_modules`, `dist`, `.next`):
**zero** remaining `@radix-ui/react-slot` or bare-`radix-ui` *imports* anywhere. Every
remaining textual hit is prose — this script's own header, `KNOWN-RADIX.md`,
`test-all.mjs`'s note, the workflow comment, `check-ui.test.mjs`'s fixture strings, and six
planning/design documents.

`pnpm-lock.yaml` still contains `@radix-ui/react-slot@1.3.3` entries — this is **correct, not
a leftover**. It survives only as a transitive dependency of the 17 other `@radix-ui/*`
packages still declared in `apps/web/package.json` (all of which have zero references and are
explicitly out of scope for this slice). Both *direct* dependency entries
(`@radix-ui/react-slot`, `radix-ui`) are gone from `apps/web/package.json`, and the `radix-ui`
umbrella is gone from the lockfile's importer block.

### V8. Everything reported passing does pass

Re-run by me at this head (Node 24.20.0):

| Check | Result |
| --- | --- |
| `node scripts/ci/check-ui.mjs` | `0 unlisted Radix import(s), 0 tracked row(s), all current.` exit 0 |
| `node --test scripts/ci/check-ui.test.mjs` | **19/19 pass**, 3 suites, 0 fail |
| `node --test 'scripts/ci/**/*.test.mjs'` (`test:ci-scripts`) | **492/492 pass**, 88 suites, 0 fail |
| `biome check` on all 6 touched source files | clean, no fixes applied |
| `tsc --noEmit` in `apps/web` | exit 0 |
| `turbo build --filter=@taskdesk/web` | 4/4 successful |

GitHub checks at this head: every required check green except `pull request template +
security review`, which fails only because the PR body's Security review section says
"pending" — this note is what clears it.

---

## Non-blocking findings

**F1 (LOW, correctness of a stated claim).** `slot.tsx:90-92` says the component "Throws when
given anything other than exactly one valid React element child — same contract as
`@radix-ui/react-slot`'s `Slot`." That is **not** Radix 1.3.3's contract. Radix throws only
when `children` is truthy (or `0`) and does not resolve to a single element; for falsy
children it does `return children` — i.e. `<Slot>{cond && <input/>}</Slot>` with `cond` false
renders nothing. The local version throws there, turning a render-nothing into a render
crash. Not reachable today: all 20 `<FormControl>` call sites pass exactly one element, and
`TimelineDate` has no call site outside its own file. It is a latent hazard the moment
someone writes a conditional child. Either reproduce the `if (children || children === 0)`
guard, or correct the comment to say the contract is deliberately stricter.

**F2 (LOW, unreachable today).** Radix 1.3.3's `composeRefs` supports React 19 ref **cleanup
functions**: it collects each `setRef` return value and, if any is a function, returns a
composed cleanup. The local `composeRefs` discards return values and always returns
`undefined`, so a child ref callback that returns a cleanup would never have it invoked (React
would call the composed ref with `null` instead). Unreachable while neither call site passes a
forwarded ref.

**F3 (LOW, unreachable today).** Radix uses `useComposedRefs` (a `useCallback` memoized on the
refs); the local version builds a fresh callback on every render, so a truthy `forwardedRef`
would cause detach/re-attach ref churn on every render. Same dead branch as F2. F2 and F3
together mean the `composeRefs` path is the one part of the reimplementation that is *not* a
faithful match — worth a one-line comment saying so, since the file's header claims fidelity.

**F4 (INFO).** `slot.tsx:5-6` names "`timeline.tsx`'s `TimelineDate`/`TimelineContent`
(`asChild`)". `TimelineContent` (timeline.tsx:75) renders a plain `<div>` and has no `asChild`
and no `Slot`. Only `TimelineDate` uses `Slot`. (`TimelineIndicator` accepts an `asChild` prop
and ignores it — pre-existing, not this PR's.)

**F5 (INFO).** `isCode` (`scripts/ci/lib/repo.mjs`) covers `.ts .tsx .mts .cts .js .jsx .mjs
.cjs` only. A Radix import in `.mdx`, `.vue`, `.svelte` or `.astro` is invisible to the gate;
probed and confirmed. Harmless today (the repo has no such files) but worth remembering when
the planned Fumadocs docs site lands, since MDX can carry real imports.

**F6 (INFO, accepted).** A computed specifier (`import("@radix-ui/" + name)`) cannot be seen
by a regex scanner. This is inherent to the approach, the file's own doc comment is honest
about not being a parser, and every literal shape that matters — static `import`, `import
type`, side-effect `import`, `export … from`, dynamic `import()`, `require()` — is covered and
unit-tested. No change asked for. Note that a *comment* containing import-shaped text is
flagged as a violation rather than ignored, which is fail-closed and the right direction; the
two files that legitimately contain such text are excluded by exact path.

---

## Governance

The PR's `## Gates` table cites **no waived gate** — every row is `pass` or `n/a`. The
orchestrating session's delegated merge authority is therefore not blocked on Thomas's own
action, once B1 is fixed and re-reviewed at the new head.

Per this project's exact-head rule: fixing B1 changes the head SHA, so this note's
`**Reviewed head:**` must be updated and the fix re-cleared at that new SHA before merge. The
re-clear can be narrow — B1 is a bounded, single-function change with a regression test, not a
redesign of an authority or gate-semantics invariant.

## What I did not do

- Did not open a browser. The PR body already flags this honestly: `apps/web/**` changed and
  no screen was opened. The `Slot` swap is algorithmically verified against the real removed
  dependency and the production build is green, but no running form or timeline was observed.
  That gap is the PR author's disclosure and I did not close it.
- Did not run the full `pnpm test` or the integration suite — I ran the unit suites that cover
  the changed surfaces (`check-ui.test.mjs`, the whole `scripts/ci/**` probe suite), plus
  typecheck, lint and build. CI's `unit + component` job is green at this head independently.
- Did not review the 17 remaining unused `@radix-ui/*` dependencies in `apps/web/package.json`
  beyond confirming they have zero imports; pruning them is explicitly out of this slice.

**Verdict: CHANGES NEEDED (blocking) — one finding, B1.**

---

# Round 2 — delta confirmation of the B1 fix (2026-09-22)

**Reviewed head:** `3b158ead2e16aae5bdbac523f9f550236776b8af`

**Reviewer:** Opus 5, a second fresh independent context. Did not author, direct or remediate
this change and did not write round 1 above. Reviewed in my own isolated detached checkout at
the exact head above — not `main`, and not the branch's own working worktree.

**Verdict: CLEAR WITH FINDINGS (non-blocking).** B1 is genuinely closed: the original evasion
is caught, the new tests are non-vacuous under two independent mutations, the negative guard
holds, and nothing overcorrected. One new non-blocking finding (F7) records three *further*
evasion shapes I constructed — they are narrower instances of the already-accepted F6 class
(a regex scanner cannot see an obfuscated specifier), they require deliberate obfuscation
rather than an ordinary mistake, and they do not reopen B1.

---

## Scope of the fix commit — confirmed

`git diff 9ae24a1..3b158ea` is four files:

```
apps/web/src/lib/slot.tsx                                |   7 +-
docs/07-planning/security-reviews/9-radix-tracking-check-ui.md | 302 ++  (new)
scripts/ci/check-ui.mjs                                  |  13 +-
scripts/ci/check-ui.test.mjs                             |  26 ++
```

The three code files are exactly the ones claimed. The fourth is round 1's own review note,
added by the same commit — content, not a code change. No other file moved: `KNOWN-RADIX.md`,
`apps/web/package.json`, `pnpm-lock.yaml` and `.github/workflows/ci-fast.yml` are byte-identical
to round 1's reviewed head (verified with a path-scoped `git diff 9ae24a1..HEAD`, empty).

`check-ui.mjs`'s change is confined to `isRadixSpecifier` and its doc comment. The
excluded-path list, `IMPORT_SPECIFIER`, the table parser and the reconciliation logic are
untouched, so round 1's V4/V5/V6 findings still stand at this head unre-examined by design.

## 1. B1's exact evasion is closed — probed, not read

Probed `radixImportsIn` directly by importing it from the checker at this head, rather than
reasoning about the regex. `radix-ui/slot` now returns `["radix-ui/slot"]`. So do every
sibling and delivery shape I tried:

| Probe | Result |
| --- | --- |
| `import { Slot } from "radix-ui/slot"` (**the B1 evasion**) | caught |
| `import { Dialog } from "radix-ui/dialog"` | caught |
| `import x from "radix-ui/react-slot/dist/index.mjs"` (deep subpath) | caught |
| `import x from "radix-ui//slot"` (double slash) | caught |
| `import x from "radix-ui/"` (trailing slash only) | caught |
| `import x from "radix-ui/./slot"` | caught |
| `import x from "radix-ui/../radix-ui/slot"` | caught |
| `await import("radix-ui/slot")` / `require("radix-ui/slot")` | caught |
| `export { Slot } from "radix-ui/slot"` | caught |
| `import "radix-ui/slot"` (side-effect) | caught |
| single-quoted, and newline between `from` and the specifier | caught |
| `import x from "radix-ui/slot" with { type: "json" }` | caught |
| bare `radix-ui` and `@radix-ui/react-slot` (round 1's existing cases) | caught |

## 2. The negative guard is real — no overcorrection

Every unrelated-but-similar name I tried is correctly **not** flagged: `radix-ui-extras`,
`radix-ui-extras/something`, `radix-uix/slot`, `radix-ui2`, `my-radix-ui/slot`,
`@radix-uixyz/foo`, `@acme/radix-ui`, and the bare scope `@radix-ui` (not a resolvable
package). A comment that merely mentions `radix-ui/slot` next to an unrelated import is also
not flagged. The anchoring literal `/` is doing exactly the work claimed, so the gate has not
become noisy.

## 3. The new tests are non-vacuous — mutation-tested twice

Not taken on trust. Two independent mutations of `isRadixSpecifier` only, tests left alone:

| Mutation | Result |
| --- | --- |
| revert to round 1's `specifier === "radix-ui" \|\| startsWith("@radix-ui/")` | **2 fail / 22** — both `radix-ui/<subpath>` regression tests go red |
| overcorrect to `startsWith("radix-ui")` (drop the anchoring slash) | **1 fail / 22** — the `radix-ui-extras` negative test goes red |
| restored (`git checkout --`) | **22 pass / 22**, working tree clean |

So each of the three added tests pins a distinct real property: the subpath match, that it is
not `/slot`-specific, and the prefix anchoring. None is vacuous in either direction.

## 4. No path-alias route into a Radix package

Checked for the alias-resolution evasion specifically. `apps/web/tsconfig.json` defines only
`@/* → ./src/*` and `@i18n/* → ../../i18n/*`; `apps/web/vite.config.ts`'s `resolve.alias` is
the same two entries. Neither can reach `node_modules`, so no innocuous-looking specifier
resolves to a Radix package through config today. There is no other alias mechanism in the
web app.

## F7 (LOW, non-blocking) — three further obfuscation shapes still evade, all in F6's class

Since round 1 found B1 as a variant after several other shapes were already handled, I hunted
specifically for a new one. Three work, confirmed by real Node resolution rather than by
inspection:

1. **Escape sequences inside the specifier string.** `import { Slot } from "radix-ui/slot"`
   — the scanner reads raw source text, where the literal does not contain `/`, so
   `isRadixSpecifier` never sees it; but JS processes the escape and Node resolves the module.
   Verified both halves: `await import("react")` resolves `react`, and
   `await import("@radix-ui/react-dialog")` resolves from `apps/web` today (17
   `@radix-ui/*` packages are still declared there). `\x2F` behaves the same.
2. **A comment between `from` and the specifier.** `import { Slot } from /*x*/ "radix-ui/slot"`
   — `IMPORT_SPECIFIER` requires `from\s+`, which a comment breaks. Valid JS, confirmed
   executing.
3. **A template literal in a dynamic import.** ``await import(`radix-ui/slot`)`` — the
   character class is `["']` only. Confirmed ``await import(`react`)`` resolves.

Two shapes I expected to work do **not**, which is worth recording:

- `import{Slot}from"radix-ui/slot"` (no whitespace) evades `check:ui`, **but `biome ci` fails
  it** as a formatting error (exit 1, confirmed against the repo's own biome 2.5.7), and
  `pnpm lint:ci` runs in CI with no `if:` and no `continue-on-error:`. Defence in depth holds
  here. It does **not** hold for shapes 1 and 3 above — `biome ci` passes both (confirmed,
  exit 0).
- Case variation (`RADIX-UI/slot`) evades the match, but is fail-safe: package directories are
  case-sensitive on Linux, and an uppercase specifier does not resolve on this host
  (`ERR_MODULE_NOT_FOUND`, confirmed). It would break the Linux CI build rather than sneak
  past it. npm package names are lowercase-only, so there is nothing to catch.

**Why this is not blocking, and why I am not asking for another round.** B1 was
`radix-ui/slot` — the shape Radix's own docs teach, which an honest developer writes by
accident and the gate silently passed. That is a fail-open against mistakes, which is this
gate's actual threat model. None of shapes 1–3 is accident-shaped; each requires a committer
deliberately obfuscating a specifier, and a committer willing to do that can equally edit
`check-ui.mjs`, add a row to `KNOWN-RADIX.md`, or use the computed specifier
(`import("@radix-ui/" + name)`) that round 1's F6 already accepted as inherent to a
non-parser scanner. These are narrower instances of F6's class, not a new class — so per
CLAUDE.md's "stop patching and change altitude", this Opus pass is the closing gate rather
than the trigger for another round.

**Suggested cheap hardening, for a later slice and not a condition of this merge** — none of
these needs a parser: add `` ` `` to `IMPORT_SPECIFIER`'s quote class; allow comments/no
whitespace after `from`; and flag any specifier containing a backslash escape as a violation
on sight (nothing legitimate in this repo has one). Alternatively, resolve the real fix at the
dependency layer, where it is structural rather than lexical: the 17 unused `@radix-ui/*`
packages still declared in `apps/web/package.json` are what make an obfuscated scoped import
resolve at all. Pruning them — explicitly out of scope for this slice — would make every
shape above fail at build time regardless of what the scanner sees.

## F8 (INFO) — two doc claims now under-describe the gate

`KNOWN-RADIX.md`'s preamble and `check-ui.mjs`'s own header both still say the gate fires on
"`@radix-ui/*` or the bare `radix-ui` umbrella package". After this fix it also fires on
`radix-ui/<subpath>`, so the word "bare" is now narrower than the behaviour. Round 1 cited
that exact sentence as evidence the implementation missed its written contract; the contract
is now the conservative side of the discrepancy, which is harmless. Worth one word when
someone next touches either file. No change asked for here.

## 5. F1's doc-comment fix is accurate

Read `apps/web/src/lib/slot.tsx:88-93` against the code immediately below it. The comment now
says the component throws on anything other than exactly one valid element child "including a
falsy child (`null`, `undefined`, `false`)", that this is "stricter than
`@radix-ui/react-slot`'s `Slot`, which returns a falsy child as-is (rendering nothing)", and
that no call site reaches the difference today. The guard is
`if (!React.isValidElement(children) || React.Children.count(children) !== 1) throw` —
`React.isValidElement(null)` is `false`, so a falsy child does throw. The comment neither
overclaims (it no longer asserts parity) nor underclaims (it names the exact divergence and
its direction), and the reachability claim matches round 1's V3 finding that both call sites
pass exactly one element. Accurate as written.

## 6. Everything green at this head

Re-run by me in my own checkout (Node 24.20.0):

| Check | Result |
| --- | --- |
| `node scripts/ci/check-ui.mjs` | `0 unlisted Radix import(s), 0 tracked row(s), all current.` exit 0 |
| `node --test scripts/ci/check-ui.test.mjs` | **22/22 pass**, 3 suites, 0 fail |
| `node --test 'scripts/ci/**/*.test.mjs'` | **495/495 pass**, 88 suites, 0 fail |
| `tsc --noEmit -p tsconfig.json` in `apps/web` | exit 0 |
| `vite build` in `apps/web` | `✓ built in 12.30s`, exit 0 |

One trap worth recording for the next reviewer: a bare detached worktree with no
`node_modules` reports **488/495 with 7 failures**. All seven are in
`scripts/ci/lib/typecheck-coverage.test.mjs` and `scripts/ci/probes/orphan-tsconfig-coverage.test.mjs`,
which spawn `tsc`; both files are untouched by this PR (`git diff origin/main..HEAD` on those
paths is empty) and both pass in a tree that has dependencies installed. With `node_modules`
linked in, the suite is 495/495. The failures are environmental, not a regression.

## 7. The tracked Radix state of the repository is unaffected

`KNOWN-RADIX.md` is byte-identical to round 1's head and still has zero data rows.
`git grep` for a real Radix import shape across the whole tree (excluding `docs/` and
`*.md`) returns only the two files the checker excludes by exact path — `check-ui.mjs`'s
header comment and `check-ui.test.mjs`'s fixture strings, including the three new B1 fixtures.
`check:ui` is green with those new fixtures present, which independently confirms the
exclusion list did not need widening and was not widened. The umbrella `radix-ui` remains
undeclared in `apps/web/package.json`; the 17 unused `@radix-ui/*` entries are unchanged and
still have zero importers. This commit changed the checker's detection logic and its tests,
and nothing else.

## Governance

The PR's `## Gates` table cites no waived gate, so the orchestrating session's delegated merge
authority covers this candidate. Round 1's blocking finding is closed at
`3b158ead2e16aae5bdbac523f9f550236776b8af`, and this note is the exact-head re-clearance
round 1 required. Committing this note changes the head SHA again; the change is
documentation-only and carries no code, so it does not invalidate the verification above —
but the merging session should confirm the final head differs from
`3b158ead2e16aae5bdbac523f9f550236776b8af` only by this note.

## What I did not do

- Did not re-verify round 1's V1–V7 from scratch. This was a delta review: I confirmed the
  fix commit touches nothing those findings rest on, and took them as standing.
- Did not open a browser. Round 1's disclosure about `apps/web/**` changing with no screen
  opened still stands; the build and typecheck are green but no running form or timeline was
  observed.
- Did not run `pnpm test` or the integration suite — the changed surfaces are the CI checker
  and one doc comment, and I ran the suites that cover them plus the web typecheck and build.
- Did not implement F7's suggested hardening or prune the 17 unused `@radix-ui/*` packages.
  Both are follow-up work, not conditions of this merge.

**Verdict: CLEAR WITH FINDINGS (non-blocking) — F7 and F8, neither blocking. B1 is closed.**
