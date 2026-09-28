# Issue #424 — check-deps.mjs follow-ups to PR #422's review (F1, F2, F3)

## Security review

**Model:** Opus 5.5, fresh independent context (did not author, orchestrate, or previously
review this change)

**Reviewed head:** `4b19e5b3d949d1b9a1800f7ccddd95ae9f2f42d6`

**Verdict: CLEAR WITH FINDINGS (all non-blocking)**, at head
`4b19e5b3d949d1b9a1800f7ccddd95ae9f2f42d6`.

Scope reviewed: the full diff at this head against its parent `06933045` —
`scripts/ci/check-deps.mjs` (`resolveWorkspaceTarget` end to end, `packageNameForSpecifier`,
`workspaceTargetForSpecifier`, `listWorkspaceManifests`, and the `analyzeDependencies` caller
including every check downstream of the new `continue`), `scripts/ci/check-deps.test.mjs`
(the new F3 test and the `#393` test before it), and the `error-fix-loop.md` bullet.

### What was actually verified (run, not just read)

- **Suite and real checker at this head** (Node v24.20.0): `check-deps.test.mjs` 18/18 pass;
  `node scripts/ci/check-deps.mjs` against the real monorepo reports "9 workspace
  packages/apps and 1161 source files; runtime workspace graph is acyclic and package
  boundaries hold".
- **F1, empirically, against the real repository.** Ran an instrumented copy of the checker
  (temporary, deleted after) that logged every `symbol.declarations` entry the fallback loop
  walks. Across 4,578 declaration handles (3,467 `SourceFile`, 1,111 `ModuleDeclaration`),
  **zero** lacked a string `.path` — every handle from `typescript/unstable/sync` carries its
  containing file's path regardless of node kind, so the `typeof resolvedFile !== "string"`
  check never filters a `ModuleDeclaration`. The live workspace-source augmentation in this
  repo today, `apps/web/src/routeTree.gen.ts`'s `declare module '@tanstack/react-router'`,
  shows up as `[SourceFile …/node_modules/.pnpm/@tanstack+react-router…/index.d.ts,
  ModuleDeclaration …/apps/web/src/routeTree.gen.ts]` — the real declaration first, the
  augmentation second, exactly as the corrected text says. The loop returns the first
  declaration whose path `ownerForFile` places inside a workspace; the `node_modules`
  declaration can never match, so the result does not depend on array position. The
  corrected comment and doc bullet are accurate; the old "array order" wording was wrong.
- **F2:** confirmed by reading — the `specifier.startsWith(".")` branch sits after the loop,
  so relative specifiers do reach it. The new wording is accurate.
- **F3, non-vacuity:** ran the new test against the parent commit's `check-deps.mjs`
  (temporary copy): it fails (17 pass, 1 fail). Against this head it passes. The assertion
  can only match the new `undeclaredDependency` message, which nothing else emits.
- **F3, 20 hand-built adversarial fixtures**, run against both this head and the parent
  implementation, using real edge-matrix workspace names (`@taskdesk/permissions` importing,
  `@taskdesk/email` as the other workspace) so the edge-matrix checks actually apply:

  | Scenario | Parent | This head |
  | --- | --- | --- |
  | shim in another workspace, undeclared (the test's case) | silent | **flagged** |
  | no shim at all, no symbol, undeclared | silent | **flagged** |
  | declared plain dependency, shim elsewhere | silent | silent (correct) |
  | bare `fs`, `fs/promises`, `node:fs` with no `@types/node` | silent | silent (correct) |
  | `node:nonexistent`; bare `test` (a `node:`-only builtin) | silent | flagged (correct) |
  | relative `./nope` | silent | silent (relative branch returns first; unchanged) |
  | typed real package in root `node_modules`, undeclared (the `vitest` shape) | silent | silent — `sawRealDeclaration` is true (correct) |
  | untyped JS package in root `node_modules`, undeclared | silent | flagged (a real undeclared import) |
  | `node_modules/evil` symlinked to another workspace, typed | flagged | flagged — TS resolves to the realpath, the existing edge-matrix check fires |
  | manifest `dependencies: null`, an array, or a string | — | no throw; flagged correctly |
  | `toString/sub` (package name is an `Object.prototype` key), shim elsewhere | silent | **silent** — see N1 |
  | devDependency `foo: "workspace:@taskdesk/email@*"`, or `foo: "link:../b"`, not resolvable by TS | silent | **silent** — see N2 |
  | bare `__proto__` / `constructor` | throws / garbage message | same — see N3, not part of this diff |

- **(a) `sawRealDeclaration` stays false only for genuinely unresolvable specifiers.** In the
  instrumented real-repo run, exactly **one** import reached the new branch:
  `apps/web/src/components/task/task-description.tsx`'s `import "tippy.js/dist/tippy.css"`.
  Its only declaration is vite/client's wildcard `declare module "*.css"` (skipped as a
  `ModuleDeclaration`). It passes because `tippy.js` is declared in `apps/web/package.json`.
  Every ordinary third-party import (`vitest`, `zod`, `i18next`, `@tiptap/core`, …) had a
  real `SourceFile` declaration and never reached the branch.
- **(b) Builtins:** `isBuiltin` covers bare (`fs`), subpath (`fs/promises`) and `node:`
  forms, and correctly rejects `test`. Scoped and subpath packages go through the existing
  `packageNameForSpecifier` (`@scope/name`, or the first segment). Correct.
- **(c) False-positive risk:** the whole real-repo surface is the one `tippy.js` import
  above, and it is declared. The new check only adds a violation when an import is both
  unresolvable by TypeScript and not declared in the importer's `package.json`. Under
  pnpm's strict layout that import would fail at runtime or build anyway. No outage risk
  from manifest shape: every `owner` comes from `listWorkspaceManifests`, which only admits
  a parsed object with a string `name`, and spreading a missing, `null`, array or string
  field does not throw.
- **Fail-open check on the new `continue`:** it skips the later per-import checks (domain
  I/O, UI runtime allowlist, pure-leaf, web→api) for that one import. But it only runs after
  a violation has already been pushed, so the gate still fails.

### Findings

**N1 (non-blocking, new code):** `packageName in { …four dependency fields… }` checks the
prototype chain. Any subpath specifier whose package segment is an `Object.prototype` member
(`toString/x`, `constructor/x`, `valueOf/x`, `hasOwnProperty/x`, `__proto__/x`, …) counts as
"declared" and passes silently. Confirmed with `toString/sub`. This is not a regression: the
parent was silent too, and exploiting it still needs a TypeScript-unresolvable runtime
resolution into another workspace. It does leave the closure incomplete. The one-line fix is
`Object.hasOwn(merged, packageName)`. Separately, the PR's claim that this is "the same
object-spread-then-`in` idiom already used elsewhere in this file" is not accurate. This is
the file's only `in` membership test. The other dependency-field merges (`runtimeWorkspaceEdges`,
`workspaceTargetForSpecifier`) iterate with `Object.entries`.

**N2 (non-blocking, remaining gap by design):** "declared" is accepted from any of the four
fields, whatever the version protocol. So if TypeScript cannot resolve an import, and it is
declared through a devDependency `workspace:` alias or a `link:`/`file:` dependency on
another workspace, it stays silent. Confirmed with both. `devDependencies` are excluded from
`workspaceTargetForSpecifier` and `runtimeWorkspaceEdges`, so a devDependency alias is seen
by no other path either. Once pnpm actually installs the link, TypeScript resolves through
the symlink to the realpath and the existing edge-matrix check catches it (confirmed with a
symlink fixture). So this only matters when the target also cannot be type-resolved.
Possible hardening, not required here: in this branch, treat a declared value with a
`workspace:`, `link:`, `file:` or `portal:` protocol as a cross-workspace edge instead of as
legitimate.

**N3 (pre-existing, not in this diff, follow-up suggested):** the `FLAGGED_MESSAGES[imported.specifier]`
lookup in `analyzeDependencies` also reads the prototype chain. `import "__proto__"` crashes
the whole checker with `TypeError: FLAGGED_MESSAGES[imported.specifier] is not a function`.
That fails closed, but as a crash rather than a violation. `import "constructor"` produces a
violation whose message is just `1`. Reproduced identically on the parent commit.
`Object.hasOwn` fixes it here too.

**N4 (informational):** `isBuiltin` reflects the Node version running the gate, so a builtin
newer than CI's Node would be flagged (fails closed). The corrected F1 sentence that a
module's real declaration "lives under `node_modules`, outside every workspace" holds
because TypeScript resolves pnpm symlinks to the root `.pnpm` store. Every observed path was
`<root>/node_modules/.pnpm/…`, and no tsconfig sets `preserveSymlinks`. If one ever did, a
per-package `packages/x/node_modules/…` path would sit inside a workspace, `isWithin` would
match it (it does not exclude `node_modules`), and the #393 misattribution class could come
back through non-`ModuleDeclaration` handles.

**Surfaces examined:** `resolveWorkspaceTarget` and every path from it to a violation; the
new test, run against both implementations; the real repository, with the fallback loop
instrumented; 20 adversarial fixtures against both implementations. Not examined: other CI
gates' handling of `link:`/`file:` protocols (for N2), and CI's configured Node version (for
N4).

## Delta security review — N1 fix (2026-09-28)

**Model:** Opus 5.5, fresh independent context (same review lineage as the section above;
did not author the fix)

**Reviewed head:** `565652c34b8e19ba18b4397763f616ef97605604`

**Verdict: CLEAR — N1 resolved**, at head `565652c34b8e19ba18b4397763f616ef97605604`.
This is a scoped delta review of this one commit only, not a re-review of the whole PR.

What was checked (run, not just read):

- **Diff scope.** `git show --stat` of the commit: one file, `scripts/ci/check-deps.mjs`,
  11+/8-, all inside `resolveWorkspaceTarget`'s F3 block. The four-field spread merge is
  unchanged. It is hoisted into a `dependencyFields` const, and `packageName in {...}` is
  replaced with `Object.hasOwn(dependencyFields, packageName)`, plus a comment. Nothing else
  changed.
- **Semantics, empirically.** A standalone Node 24 script built the merged object exactly
  as the code does, from a `JSON.parse`d manifest:
  - Declared names (`foo`, scoped `@s/bar`, a devDependency) still return `true`.
  - `toString`, `constructor`, `hasOwnProperty`, `valueOf` and `isPrototypeOf` now return
    `false`, including against an empty merge of all-undefined fields. The old `in` check
    returned `true` for every one of them.
  - `__proto__` returns `false` unless a manifest literally declares it. In that case
    `JSON.parse` and the spread both create it as an own data property, so it correctly
    reads as declared.
  - So no legitimately declared dependency changes behavior.
- **Tests.** `node --test scripts/ci/check-deps.test.mjs` passed 18/18, 0 failed.

Not in this commit, unchanged: N3 (the pre-existing prototype-chain lookup on
`FLAGGED_MESSAGES` in `analyzeDependencies`), which is tracked separately as a follow-up. N2
and N4 also stand as recorded above. No regression test pins a prototype-named specifier for
F3. That is acceptable for a one-call stdlib swap, but it is cheap to add if this block is
touched again.

## Delta security review — error-fix-loop lesson (2026-09-28)

**Model:** Opus 5.5, fresh independent context (same review lineage as the sections above;
did not author this commit)

**Reviewed head:** `af3f21d4f2a21762c2636ef9164c6242867569b9`

**Verdict: CLEAR (unchanged)**, at head `af3f21d4f2a21762c2636ef9164c6242867569b9`. This
final head is covered. The PR is done from the security-review side.

What was checked:

- **Diff scope.** `git show --stat af3f21d4` shows one file,
  `docs/04-engineering/error-fix-loop.md`, 16+/0-. It adds one bullet to the lessons list.
  `git diff --stat 565652c3 af3f21d4` shows only that file plus this review note (the
  previous delta entry, `60eb35d9`). No code, test, CI, or dependency file changed.
- **Accuracy of the bullet.** It matches what was verified in the reviews above. N1: the
  `in` check against the spread-merged dependency fields matched `Object.prototype` names,
  and the code now uses `Object.hasOwn(dependencyFields, packageName)` (`check-deps.mjs`
  line 1035). N3: `FLAGGED_MESSAGES["__proto__"]` returns `Object.prototype`, which is
  truthy, and calling it throws a `TypeError` that crashes the checker. It is pre-existing
  and out of scope here. `gh issue view 464` confirms #464 is the open follow-up for exactly
  this N3 bug.
- **One nit, non-blocking.** The bullet says `Object.hasOwn` "only matches the object's own
  enumerable properties". In fact it matches all own properties, enumerable or not. That
  makes no difference here, because spread-created properties are always enumerable. It is
  worth correcting the next time that file is edited.
- **Head.** `git log -1 --format=%H` reports `af3f21d4f2a21762c2636ef9164c6242867569b9`.

N2, N3 (#464), and N4 stand as recorded above.
