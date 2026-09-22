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
