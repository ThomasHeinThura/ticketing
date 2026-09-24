# Security review — PR #361, `check:deps` workspace dependency boundary gate

**Reviewer:** Claude Opus 5.5 (fresh independent context; did not author, direct or remediate this change)
**Reviewed head:** `2a486814d2080f64cec91b51307ee81d0254a8ab`
**Date:** 2026-09-24
**Scope:** `scripts/ci/check-deps.mjs`, `scripts/ci/check-deps.test.mjs`, `scripts/ci/test-all.mjs`,
`.github/workflows/ci-fast.yml`, `package.json`, `docs/01-architecture/monorepo-layout.md`,
`docs/07-planning/status.md` (report only).

## Baseline runs at the reviewed head

- `pnpm check:deps`: pass — 9 workspace packages/apps, 981 source files.
- `node --test scripts/ci/check-deps.test.mjs`: 5/5 pass.
- `pnpm test:ci-scripts`: 513/513 pass (88 suites).

## Findings (written as found)

Every probe below was a synthetic file written into this review's own worktree, checked with
`node scripts/ci/check-deps.mjs` (what `pnpm check:deps` runs), then deleted. "Missed" means
the gate exited 0 with the forbidden edge present.

### F1 — HIGH — a regex literal hides a real import from the lexer (fail-open)

`sourceImports` drives the TypeScript scanner token by token with no parser, and never calls
`reScanSlashToken`. So `/` always scans as a division token, and a regex literal holding a
quote or backtick opens a fake string or template that swallows the real code after it.
Both files below pass `node --check` as valid ES modules, and the gate misses both:

```ts
// packages/libs/src/zz.ts: one line, gate exits 0
const re = /"/; import { x } from "@taskdesk/api"; const s = /"/;
```

```ts
// packages/libs/src/zz.ts (also missed as packages/ui/src/zz.tsx): multi-line, gate exits 0
const re = /`/;
import { x } from "@taskdesk/api";
const t = /`/;
```

In the second file the backtick "template" covers any number of lines, so any import can be
hidden. A control file that uses real division (`1 / 2`) is caught. This is the same class
of gap the earlier rounds found (the lexer's view of the source differs from the real
grammar), and more lexer patching will not close it. The fix is to parse, not to scan. Build
a real AST (`typescript` is already a dependency, and the `ts.preProcessFile` or
`createSourceFile` API gives import declarations, import-equals, `import()` and `require`
calls). Treat any parse diagnostic as a gate failure.

### F2 — HIGH — whole directories and file names are skipped without a word

`listSourceFiles` reuses `lib/repo.mjs`'s `walk`, which silently skips any directory named
`build`, `out`, `dist`, `coverage`, `.next`, `.source` and the rest of `ignoredDirectories`,
at any depth. It also skips any file named `routeTree.gen.ts`, and every symbolic link. All
of these were missed:

- `packages/libs/src/build/zz.ts` with `import { x } from "@taskdesk/api";`
- `packages/libs/src/out/zz.ts`, same content
- `packages/libs/src/routeTree.gen.ts`, same content

`src/build/` and `src/out/` are ordinary source directory names, and bundlers compile them.
Symbolic links are skipped instead of rejected, so a committed link inside
`packages/ui/src` that points at `apps/api/src` would be neither scanned nor resolved (see
F4). The fix is for the boundary gate either to scan these paths too, or to fail on any
source file or symbolic link it declines to inspect under a workspace `src`. Only root-level
`node_modules` and real build output should be excluded, and each exclusion should be named.

F1 has a second trigger: a lone backtick in JSX text hides imports the same way. This
`packages/ui/src/zz.tsx` was missed:

```tsx
export const C = () => <p>`</p>;
import { x } from "@taskdesk/api";
export const D = () => <p>`</p>;
```

### F3 — MEDIUM — `require` without a literal call escapes the fail-closed rule

The gate fails closed only on `require(<non-literal>)`. A `require` token that is not
followed by `(` is skipped with `continue`, and no other loader is recognised. All three
of these were missed in `packages/libs/src/zz.ts`:

- `const r = require; r("@taskdesk/api");`
- `import { createRequire } from "node:module"; const r = createRequire(import.meta.url); r("@taskdesk/api");`
- `globalThis["req"+"uire"]("@taskdesk/api");`

`createRequire` is the ordinary way to load CommonJS from ESM, so this is realistic, not
contrived. Fix: fail on any `require` identifier that is not called directly with one
literal, and on any import of `createRequire` (from `node:module` or `module`) outside an
allowlist of named files. `require.resolve(...)` and `import.meta.resolve(...)` were also
missed. They only resolve a path and load nothing, so they are LOW and noted only.

### F4 — MEDIUM — the target resolver ignores every alias except `@/` and `@i18n/`

`resolveWorkspaceTarget` knows only `@taskdesk/*`, relative paths, and two hard-coded
`apps/web` aliases. Every other way of naming another package resolves to `null`, so the
edge counts as a harmless external package. `packages/ui` and `packages/domain` still
catch these through their bare-specifier allowlists. `packages/libs`, `packages/email`,
`packages/mcp`, `apps/web` and `apps/api` do not. All of these were missed from
`packages/libs/src/zz.ts`:

- `packages/libs/package.json` `"imports": { "#api": "@taskdesk/api" }`, then `import { x } from "#api";`
- `packages/libs/package.json` `"dependencies": { "api-alias": "workspace:@taskdesk/api@*" }`,
  then `import { x } from "api-alias";`. The alias is also invisible to the cycle graph,
  because `runtimeWorkspaceEdges` matches dependency keys against workspace names.
- `packages/libs/tsconfig.json` `"paths": { "~api/*": ["../../apps/api/src/*"] }`, then
  `import { x } from "~api/auth";`
- a symbolic link, never scanned (F2): `packages/libs/src/lnk.ts -> ../../../apps/api/src/auth.ts`
  with `import { x } from "./lnk";`, and a linked directory `packages/ui/src/lnk -> ../../libs/src`
  with `import { x } from "./lnk/index";`.

The two `package.json` variants touch `**/package.json`, which is in security scope, so a
reviewer would at least see them. `tsconfig.json`, a Vite `resolve.alias`, and a symbolic
link are not in any scope path. Fix: resolve every edge to a real file path (the TypeScript
module resolver with each package's own tsconfig, plus `realpath`), and judge the resolved
path. Failing that, fail on any bare specifier that neither names an installed external
package nor a workspace package by its real name.

### F5 — MEDIUM — the documented edge matrix is not enforced for the apps

`monorepo-layout.md` draws `apps/web ──► packages/ui, libs, permissions`, but the gate
enforces only the bullet rules. It passed `import { x } from "@taskdesk/domain";` and
`import { x } from "@taskdesk/email";` in `apps/web/src/zz.ts`. `apps/api` has no allowlist
either. Most of the gap is not exploitable today: `email` and `mcp` are server packages, and
pulling them into the web bundle is a boundary break, not a privilege gain. But the brief
for this round said "positive allowlists", and only `ui`, `domain` and the pure leaves have
them. Fix: encode the arrow list as an allowlist per workspace, or change the doc to say the
arrows are illustrative. The first is the one that matches "enforced".

### F6 — LOW — the doc/gate drift can widen without security review

The allowlist lives in `scripts/ci/check-deps.mjs`, and `scripts/ci/**` is in `ci-cd.md`'s
security scope, so widening what the gate *enforces* does need a security review. Good.
`docs/01-architecture/monorepo-layout.md`, where the boundary is *defined*, is not in scope,
so the definition can change without one, and the two can then drift silently. The same
doc still says the rule is enforced by "a `turbo` task plus a dependency-cruiser check".
This PR's gate is neither. Fix: correct that sentence to name `pnpm check:deps`, and either
add the doc's path to the scope list or pin the doc's rule list in a test.

### F7 — LOW — false positives from JSX text

Plain UI copy fails the build. `<p>You can import data from the old system</p>` in a `.tsx`
file is reported as a "non-static module specifier", and `<p>Please import from
"@taskdesk/api" later</p>` as an app import. This fails closed, so it is safe, but it will
cost someone an afternoon. Parsing (F1's fix) removes it. Comments and ordinary string or
template literals containing import-like text were correctly *not* flagged.

### F8 — INFO — I/O that needs no import

`const fs = process.getBuiltinModule("node:fs");` in `packages/domain/src` passes. So would
a bare `fetch(...)`. An import-graph gate cannot see these; they belong to lint (a
`no-restricted-globals`/`no-restricted-properties` rule for `packages/domain`). Noted, not
blocking.

## Probes that were correctly caught

In `packages/libs/src` (forbidden target `@taskdesk/api`, runtime): static `import`,
side-effect `import "…"`, `export { } from`, `export * from`, `import()` with a string
literal, a no-substitution template, a template with a substitution, a variable, a
concatenation, with a comment inside, and with an options argument; `require` with a literal
and with a variable; `module.require`, `process.mainModule.require`; `import x =
require(…)`; inline `import { type X }` and `import type, { X }` (both runtime, as the doc
says); `@taskdesk/api/src/auth` as a subpath; a relative climb `../../../apps/api/src/auth`;
`.cjs` and `.mjs` files; a `libs/test/` file. In other packages: `packages/ui` with `import
type` from `@taskdesk/api`; `packages/ui` climbing into `../../libs/src`; `packages/domain`
climbing into `../../ui/src`; `packages/domain` importing `fs`; a domain *test* file climbing
into `apps/api`; `apps/web` `.tsx` importing `@taskdesk/api`; `apps/web` using `@/../../api/src/auth`;
`apps/api` importing `@taskdesk/web`. Real division (`1 / 2`) around an import did not
confuse the scanner.

## Wiring

- `ci-fast.yml` runs `pnpm check:deps` as a step of the `static` job, which triggers on
  `pull_request` and `push` to `main`. `static` is a required status check in ruleset
  22365005 (enforcement `active`, 0 bypass actors). The CI run for this head
  (run 36032196547, head `2a48681`) logged `check:deps: 9 workspace packages/apps and 981
  source files; … boundaries hold`.
- `test-all.mjs` flips `check:deps` from `run: null` to `["pnpm", "check:deps"]`.
  `ci-cd.md` line 50 already declares `pnpm check:deps` as a fast gate, `pnpm test:all --list`
  shows it enabled, and the `CI matches ci-cd.md` check is green at this head. The
  workflow header comment was updated to match. The wiring is consistent.
- The only red check at this head is `pull request template + security review`. It fails
  for four reasons: no link to this committed review; two "Any change" independent-review
  checkboxes where exactly one must exist; the ordinary exact-head review unticked; and the
  Opus review unticked. Those are PR-body items for the author and the orchestrator, not
  code defects.

## `status.md` (orchestrator-owned; report only, not edited)

The new 2026-09-24 "P0 #10 dependency-boundary gate" entry is accurate at this head: 9
packages/apps and 981 files, 5/5, and 513/513 all reproduce, and it correctly says the Opus
review is still required and claims no merge. It does not mention that the PR body still
lists the ordinary exact-head review as pending.

## Verdict

**CHANGES NEEDED.**

F1 and F2 are fail-open with ordinary, syntactically valid source: a regex literal, a
backtick in JSX text, or a `src/build/` directory each gets a forbidden runtime import of
`apps/api` past the gate with exit 0. F1 is the same class of finding (the scanner's view
differs from the real grammar) that the earlier rounds kept patching. Per AGENTS.md's
"stop patching and change altitude", the fix is structural: replace the hand-driven token
scan with a real parse, and resolve each specifier to a real file path. That also closes
F3, F4 and F7. F2 needs the walk to stop silently skipping `build`/`out`/symbolic links
under workspace sources. F5 and F6 should land in the same round, since the doc change is
already in this PR. Each fix needs a regression test that uses the concrete input above.
