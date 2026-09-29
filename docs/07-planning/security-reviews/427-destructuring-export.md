# Issue #427 — env-reads.mjs: track destructured export bindings for later reassignment

Follow-up to PR #423's review chain (F7, raised as non-blocking by Opus pass 5 — see
`423-env-reads-ast-rewrite.md`). Change under review: new `collectBindingNames` in
`scripts/ci/lib/env-reads.mjs`, now used to build `exportedNames`, plus the new
`scripts/ci/lib/env-reads-427.test.mjs`.

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`, direct
review rather than `pal-mcp`'s `coder` chain — recorded by the orchestrating session)

**Verdict:** no blocking issues; two coverage suggestions (default-value case — added in the
reviewed head; cross-nesting variants — not added) and one wording hedge on the array-hole
AST shape. Recorded here for completeness; the Opus pass below is independent of it.

## Security review

**Model:** Opus 5.5, fresh independent context (did not author, direct, or remediate this
change, and did not run any of #423's passes 1-5)
**Session:** Opus subagent spawned by orchestrating session `6eb64ad7-9ee8-4a9a-9c88-71292dbf48ba`

**Reviewed head:** `4318c3543ea1b7267d73a094908f599a34c9e651`

Merge base with `origin/main`: `06933045bb915a5fa8f4aa320c5a6174605ee62c` (confirmed by
`git merge-base`). Single commit on the branch; diff is `env-reads.mjs` (+29/-2) and the new
test file (+64).

**Verdict: CLEAR WITH FINDINGS (all non-blocking).**

### What was verified

1. **Additive-only claim — confirmed by reading every consumer.** `exportedNames` has exactly
   one read (the `BinaryExpression` dispatch in `visit`, passing
   `exportedNames.has(node.left.text)` as `handleBindingDeclaration`'s `exported` argument).
   In `handleBindingDeclaration`, `exported` is consulted only after all alias-set updates
   and bag charges, and only gates one extra `chargeBareValueIfEscaping` call for a
   `process`/`importMeta` classification. It never suppresses a charge and never touches the
   `aliases` sets. The declaration-site path (`hasExportModifier(node.parent?.parent)` in
   the `VariableDeclaration` case) does not read `exportedNames` at all. So a larger
   `exportedNames` can only add charges.
2. **No interaction with the fixed-point loop.** The loop's termination compares the sizes
   of the five `aliases` sets; `exportedNames` is built once before the loop and isn't in
   that sum, and (per 1) the `exported` flag can't change any alias set. `reads` is reset
   every round, so the extra charge is emitted once, not once per round.
3. **No effect on the merge-base ratchet today.** `check-env.mjs --report` against the real
   repo is byte-identical (174 lines) with pre-fix `env-reads.mjs` (`HEAD~1`) and with this
   head; summary unchanged — 29 attributable reads, 52 baselined deviations, 1183 files
   scanned. No new baseline fingerprints, so no unrelated file goes red.
4. **Array-hole AST shape — independently confirmed.** Wrote my own probe against
   `typescript/unstable/ast` via `API`: in `export let [, ...x] = o;` and
   `export let [a, , b] = o;`, each hole is a `BindingElement` with `name: undefined` (not an
   `OmittedExpression`, although that kind exists in the enum). The
   `element.kind === BindingElement && element.name` guard handles it either way;
   `collectBindingNames` can't throw on any `VariableDeclaration.name` shape.
5. **Recursion follows `.name`, never `.propertyName`.** Confirmed: `export let { a: x } = o;
   a = process;` still charges 0 (correct — `a` is the source key, not a binding), while
   `x = process` charges.
6. **Pre/post differential over 40 hand-built probes** (both detectors run on the same inputs;
   the pre-fix copy was taken from `HEAD~1`). Every difference is post ⊇ pre; no probe lost a
   charge. Newly charged (all correct): object, array, renamed-key, nested object, nested
   array, mixed nesting (`[{ a: [x] }]`), array rest, object rest, holes (`[, , x]`), default
   (`{ x = 1 }`), quoted key, computed key, `var`, second declarator in a list
   (`export let y, { x } = o`), `import.meta`, `globalThis.process`,
   `require('node:process')`, cast-wrapped RHS, reassignment inside a block/`if`/`for` body.
   Unchanged, correctly: non-exported destructured binding (0), non-`process` RHS (0),
   compound/logical assignments and `[x] = [process]` (already charged by the default-flip),
   `export { x }` / `export default x` / `export { x as y }` of a locally destructured alias
   (already charged, 1).
7. **Tests.** `node --test 'scripts/ci/**/*.test.mjs'`: 813 tests, 810 pass, 3 fail — all 3 in
   `typecheck-coverage.test.mjs`, each `spawnSync …/apps/api/node_modules/.bin/tsc ENOENT`
   (the sandboxed worktree only has root `node_modules` symlinked; environmental, not this
   diff). `env-reads-427.test.mjs`: 7/7. The six positive cases each return `[]` against the
   pre-fix detector (confirmed by the differential in 6), so they're real regression tests.

### Findings (non-blocking)

- **N1 — the known scope-insensitivity ceiling now also applies to destructured names (safe
  direction).** `exportedNames` is matched by spelling, not scope, so
  `export let { x } = o; { let x; x = process; }` and a shadowing parameter
  (`function f(x) { x = process; }`) now over-charge. This is the same ceiling pass 4
  accepted for plain identifiers (`export let x; function f() { let x; x = process; }`
  already charged pre-fix). Over-charge only, and absent from the real repo (item 3). No
  action needed.
- **N2 — accepted double-charge extends to destructured names.** `export let { x } = o;
  f(x = process);` charges twice (the default-flip on the consumed assignment, plus the
  `exported` path). Same harmless over-count pass 3 accepted for `f(x = process.env)`. No
  action needed.
- **N3 — wording only.** The commit message lists the new tests as "three named shapes plus a
  nested-pattern case, a rest-in-array case, and a non-exported control" / "all five new
  regression cases". The file actually has six positive cases (the default-value case was
  added in this same commit) plus the control. And the test file header says "each case
  below" reproduces the regression, but the control returns `[]` before and after, by
  design. Cosmetic; not worth a new SHA.

Nothing found that weakens an existing detection path or adds a bypass. The change is
strictly a superset on every input tested, and it leaves the declaration-site charge, the
alias sets, the loop bound, and the baseline ratchet untouched.

**Surfaces examined:** `scripts/ci/lib/env-reads.mjs` in full at this head (with
`handleBindingDeclaration`, `analyzeObjectPattern`, `flatBindingNames`,
`collectBindingNames`, `isTrackedAliasDeclarationSite`, `isDeclarationBindingName`, and every
`exportedNames` read); the full diff (`git show 4318c35`); `env-reads-427.test.mjs`;
`423-env-reads-ast-rewrite.md` in full; `security-review-note.mjs`'s format contract; my own
AST-shape probe against `typescript/unstable/ast`; 40+ pre/post differential probes; the full
`scripts/ci` test suite; `check-env.mjs --report` against the real repo with pre- and
post-fix detectors.

**Not examined:** `check-env.mjs` itself and `env-baseline.json` (both unchanged by this diff;
only their observable output was compared); CI on GitHub (not run from this context).
