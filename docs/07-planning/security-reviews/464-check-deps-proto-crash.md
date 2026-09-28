# Security review — #464: `check-deps.mjs` `__proto__` crash

**Reviewed head:** `b0f89c6bf7bcd76bf724e82f36543da5bc6b392e`
**Reviewer:** Opus 5.5, a fresh independent context commissioned by the orchestrating session.
It did not author, direct or fix this change.
**Surfaces examined:** `scripts/ci/check-deps.mjs` (security-review scope per `ci-cd.md`, the
CI/gate-machinery entry).
**Verdict:** CLEAR WITH FINDINGS. No HIGH, MEDIUM or LOW findings. One finding (F1) blocks
merge but is not a security issue.

## What was checked

- The diff at this head changes exactly two files, `scripts/ci/check-deps.mjs` and
  `scripts/ci/check-deps.test.mjs`.
- `node --test scripts/ci/check-deps.test.mjs` → 19/19 pass. The two related test files
  (`check-deps.createrequire-redesign`, `check-deps.module-acquisition`) → 12/12 pass.
- `node scripts/ci/check-deps.mjs` against the real repo exits 0: 9 packages, 1161 files, no
  violations — the fix raises no false positives on real code.
- Wrote an independent test beyond the PR's own: every other `Object.prototype` own name
  (`valueOf`, `isPrototypeOf`, `__defineGetter__`, `propertyIsEnumerable`, `toLocaleString`,
  `__proto__`), plus other import shapes (`require()`, dynamic `import()`, `export * from`,
  default import), plus one real synthetic key (`"<createRequire>"`). On the candidate, every
  prototype name gets the normal "not declared as a dependency" violation, and
  `"<createRequire>"` still gets its createRequire message. On the parent (pre-fix), the same
  file crashes the gate with `FLAGGED_MESSAGES[imported.specifier] is not a function`. The fix
  is class-complete, not a point patch for `__proto__` alone, and the test is not vacuous.
- Searched the file at this head for every computed-property read (`x[...]`, `?.[`, `in`,
  `Reflect.*`) on a plain object keyed by an attacker-controlled string. The only one found was
  `FLAGGED_MESSAGES[imported.specifier]`, the one this PR fixes. Everything else — the line
  that PR #424/#465 already fixed, the manifest dependency/`imports` maps, `alias?.[1]` — is
  already safe (`Object.hasOwn`, `Object.entries`/`Object.keys`, a regex match index, or a
  `Map`/`Set`).
- No change in behavior for the four real `FLAGGED_MESSAGES` keys (`<createRequire>`,
  `<module-acquisition>`, `<getBuiltinModule>`, `<module-constructor>`): all are own properties
  with truthy function values, none collides with an `Object.prototype` name, so the new check
  returns exactly what the old bracket read did for every non-prototype string. The only
  changed outcome is for prototype names, and it fails closed: before, `__proto__` crashed the
  gate outright, and other prototype names silently produced a nonsense message and skipped the
  real dependency check; now all of them get a proper "not declared" violation instead. No
  gate or authority change — the `DYNAMIC_SPECIFIER` branch and the `continue` are untouched,
  and nothing that was flagged before can now pass.

## Findings

- **F1 (blocks merge, not a security issue):** the `static` check (`biome ci .`) failed at this
  head — the new `const flaggedMessage = Object.hasOwn(FLAGGED_MESSAGES, imported.specifier)`
  line was too long for Biome's formatter at line 1178. Fix: `biome format --write
  scripts/ci/check-deps.mjs`.

## Not done

Did not review the rest of `check-deps.mjs` beyond the lookup class and the changed lines, and
did not re-audit the #424 fixes.

---

## Delta confirmation — F1 fix at `08c32a43`

**Reviewed head:** `08c32a43ee69d0352fed9f95e788ed087d2c4f62`
**Parent:** `b0f89c6bf7bcd76bf724e82f36543da5bc6b392e` (the reviewed head above)
**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass, per the
established practice of self-declaring a mechanical reconfirmation when a follow-up commit is
verifiably a no-op with respect to the reviewed logic (CLAUDE.md, "stop patching, change
altitude" / the review-tier guidance against unbounded rounds on an already-cleared class).

**What changed:** `git diff b0f89c6b 08c32a43` touches one file, `scripts/ci/check-deps.mjs`,
reflowing the `Object.hasOwn(...)` call across three lines instead of one (Biome's formatter
output). Verified directly: after stripping all whitespace from both file versions, the only
remaining difference is one added trailing comma inside the reflowed call's argument list. A
trailing comma in a JavaScript call expression's argument list is syntactically inert — it has
no effect on which arguments are passed or how the call executes. This is a no-op reformat, not
a logic change.

**Verdict:** the CLEAR WITH FINDINGS verdict at `b0f89c6b` carries over to `08c32a43` on that
basis. F1 (the only finding) is closed by this same commit. No new review round needed.

This review covers this head only. A later commit outside
`docs/07-planning/security-reviews/` voids it.
