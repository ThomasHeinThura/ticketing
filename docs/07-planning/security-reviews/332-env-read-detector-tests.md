# Security review — regression tests for the environment-read detector (#332)

**Reviewer:** Opus 5.5, a fresh, independent context commissioned by the orchestrating session. I did not author, direct or remediate this change.
**Reviewed head:** `c731c26a8b35ccccafbd2516dcd926ba94443c8c`
**Reviewed SHA:** `c731c26a8b35ccccafbd2516dcd926ba94443c8c` (checked with `gh pr view 332 --json headRefOid` before I started)
**Merge base:** `dd067e21f77853b35dd79de31e99d258678b92b4`. `origin/main` was `33ce9ec8a926b3dd0dbe8d00b828c69c72861408` at review time.
**Pull request:** #332 (`fix/10-env-read-regressions`, P0 #10)
**Date:** 2026-09-23

## Surfaces examined

- `scripts/ci/lib/env-reads.test.mjs`: new file, 107 lines. This is the only file the PR changes (`gh pr diff 332 --name-only`, and `git diff --stat origin/main...HEAD` shows 1 file, +107).
- `scripts/ci/lib/env-reads.mjs`: the detector. It is **unchanged** by this PR. I read the whole file, including the `ACCESS`, `NAMED`, `BRACKET_LITERAL` and `BRACKET_COMPUTED` regexes, `destructuredKeys`, and `readFingerprint(s)`.
- `scripts/ci/check-env.mjs`: how `findEnvReads` results are classified. Anything whose `kind !== "named"` is treated as unattributable and ratcheted by fingerprint. Named reads are checked against the approved list or the baseline.
- `docs/05-operations/configuration-reference.md` and AGENTS.md rule 2: every environment read must be attributable to an approved entry, and `check:env` fails the build on any other read.

## What I probed

1. **Is it test-only?** Yes. The detector, `check-env.mjs`, `env-baseline.json` and the workflows are all unchanged. A test-only addition can't make `check:env` pass a read it would otherwise flag. **There is no gate weakening.**
2. **Suites at this head.** `pnpm install --frozen-lockfile` was clean.
   - `node --test scripts/ci/lib/env-reads.test.mjs`: **6 tests, 6 pass.**
   - `node --test 'scripts/ci/**/*.test.mjs'`: **501 tests, 88 suites, 501 pass, 0 fail.** That matches the 501 the PR body claims.
   - `pnpm check:env`: **exit 0.** It found "25 environment read(s), every one attributable". It scanned 963 files under `apps` and `packages`, with 52 inherited deviations still baselined and 1 stale baseline name to prune (a note, not a failure).
3. **Mutation checks** (restored each time, and `git status --porcelain` was empty afterwards):
   - I replaced `destructuredKeys(...)` with `null`. The test "destructured environment properties are attributed individually" went **red**.
   - I reclassified bracket-computed reads as `alias`. "computed helper and lookup-table names remain unattributable" and "unattributable read fingerprints preserve identity and occurrence" went **red**.
   - So the tests pin real classification behaviour. They don't only check that the detector returns something.
4. **Evasion shapes against `findEnvReads`.** I ran a scratch harness against this head's detector, not committed. "Caught" means the detector returns at least one read that `check:env` would fail or ratchet.

| Shape | Caught? | Result | Covered by a test in this PR? |
| --- | --- | --- | --- |
| `process.env.NAME` | yes | named | yes |
| `process.env["NAME"]` / `['NAME']` | yes | named | yes |
| `process.env[name]` (helper) / lookup-table key | yes | computed | yes |
| `const e = process.env` | yes | alias | yes |
| `(env: T = process.env)` parameter default | yes | alias | yes |
| `const { A, B } = process.env` | yes | named ×2 | yes |
| `const { A: a } = process.env` (rename) | yes | named `A` | no |
| `const { A = "x" } = process.env` (default) | yes | named `A` | no |
| `const { A, ...rest } = process.env` | yes | alias (fails closed) | no |
| `const { "A": a } = process.env` / `{ [k]: a }` | yes | alias (fails closed) | no |
| `process.env?.NAME` / `process.env?.["NAME"]` | yes | named | no |
| `` process.env[`NAME`] `` / `` [`A_${k}`] `` | yes | computed (fails closed) | no |
| `f(process.env)`, `Object.entries(process.env)` | yes | alias | no |
| `import.meta.env.X` + Vite built-ins | yes | named, built-ins skipped | yes |
| **`{ ...process.env }` (spread)** | **no** | nothing | no |
| **`globalThis.process.env.X` / `global.process.env.X`** | **no** | nothing | no |
| **`process["env"]`, `` process[`env`] ``** | **no** | nothing | no |
| **`process?.env.X`** | **no** | nothing | no |
| **`const { env } = process` / `{ env: e } = process`** | **no** | nothing | no |
| **`Reflect.get(process, "env")`, `Object.getOwnPropertyDescriptor(process, "env")`** | **no** | nothing | no |
| **`const p = process; p.env.X`** | **no** | nothing | no |
| **`import { env } from "node:process"`, `require("process").env`** | **no** | nothing | no |
| **`import.meta["env"]`** | **no** | nothing | no |
| **`process/**/.env.X`** (comment between tokens) | **no** | nothing | no |
| `Bun.env` / `Deno.env` | no | nothing | no (not a runtime this repo ships) |
| `// process.env.X`, `"process.env.X"` | flagged | named (false positive, fails closed) | no |

5. **Live exposure.** I searched `apps/**` and `packages/**` (`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`, excluding `node_modules` and `dist`) for every uncaught shape above. **No instance exists today.** The only `node:process` imports are `stdin`/`stdout` in `packages/mcp/src/install/index.ts:3` and `packages/mcp/src/cli.ts:1`, and neither reads `env`. So nothing currently slips past `check:env`, and the gaps are latent.

## Findings

**E1 — NON-BLOCKING, not made worse by this PR. The spread and `globalThis.` prefixes are invisible.** `ACCESS` uses the lookbehind `(?<![\w$.])` (`scripts/ci/lib/env-reads.mjs:17`), which rejects any match preceded by a `.`. That excludes `foo.process.env`, but it also excludes `...process.env` and `globalThis.process.env` / `global.process.env`. Spreading the whole environment into an object (`{ ...process.env }`) is a common real-world shape, for example to build a child-process env or a config bag. It makes every later lookup by name invisible, which is the same class of hole the kaneo `env(name)` helper opened. Suggested fix: let the lookbehind accept a `...` prefix, and match `(?:globalThis|global)\s*\.\s*process\s*\.\s*env` explicitly. Classify the spread as `alias`. Add a test for each.

**E2 — NON-BLOCKING, not made worse. Reaching the env object without the literal token `process.env` is invisible.** The shapes are:
- `process["env"]`
- `process?.env`
- `const { env } = process`
- `Reflect.get(process, "env")`
- `const p = process; p.env`
- `import { env } from "node:process"`
- `require("process").env`
- `import.meta["env"]`
- a comment between the tokens

The detector keys on the `process.env` / `import.meta.env` token sequence, so anything that doesn't spell it out evades it. None of these shapes exists in the scanned tree today (probe 5). The detector's own docstring presents it as "every occurrence of the environment object is classified", and these shapes contradict that claim. A fail-closed approach would treat any bare `process` reference not followed by `.env.<NAME>` / `.env["<NAME>"]` as `alias`, plus any `env` import from `node:process` / `process`. The alternative is a Biome `noRestrictedImports`/`noRestrictedGlobals` rule, with `check:env` asserting that the rule is present. That work belongs to a follow-up on #10, not to this PR.

**E3 — NON-BLOCKING, test coverage.** The detector already handles these shapes correctly, but no test pins them:
- optional chaining (`process.env?.X`, `?.["X"]`)
- template-literal keys (classified `computed`, which fails closed)
- destructuring with a rename, a default, a rest element, a quoted key or a computed key
- `process.env` passed as a call argument

A regression in `NAMED`/`BRACKET_*`/`destructuredKeys` could flip one of them silently. The most important to pin are the rest element and the quoted or computed key, because each must stay `alias`: if one became `named`, it would attribute a single name while the rest of the environment leaks through.

**E4 — INFORMATIONAL.** Comments and string literals containing `process.env.X` are reported as reads. That is a false positive, but it fails closed, so it's acceptable for a gate. A literal key with an escape sequence (`process.env["SECRET"]`) is reported under its raw, unescaped spelling. That spelling can't match an approved name, so it also fails closed.

## Gates observed at this head (for the orchestrator; not part of the verdict on the code)

- **Ordinary independent review: MISSING.** The PR has no GitHub reviews (`reviews: []`), and `## Reviewed by` reads "Pending independent ordinary review". No review by a different agent, with model and SHA, is recorded anywhere.
- **Attribution is unreconciled.** `## Implemented by` names "Codex agent; exact model variant is not exposed". The single commit `c731c26` is authored `Claude Code <noreply@anthropic.com>`. The owner's PR comment (2026-09-23T16:29:31Z) says the PR won't merge until the attestation and the commit identity are reconciled, per the 2026-09-23 decision-log entry (#336). This review context is not the author, whatever the commit identity says.
- **Required checks.** Every check on `c731c26` is green except **`pull request template + security review`, which is FAILURE**.
- **Template checker.** `node scripts/ci/check-pr-template.mjs --body <body>` from this worktree reports 2 problems:
  - `## Security review` `**Note:**` doesn't link a committed note. This file resolves that once the body links it.
  - The "Any change" item "Independent Opus security review completed and recorded" is unticked. That is a BLOCKER until this review is recorded and the box is ticked.
- **Waivers.** The `## Gates` table cites no waived gate. Every row is `n/a`.
- **Head change.** This note is committed on top of `c731c26`, so the PR head moves. The code under review is unchanged: the only new file is this note.

## Verdict

**CLEAR WITH FINDINGS at `c731c26a8b35ccccafbd2516dcd926ba94443c8c`.** There are no blocking findings.
- **Test-only.** The change adds tests and nothing else. The detector, the checker and the baseline are untouched, so it can't weaken `check:env`.
- **The tests are real.** They pin real classification behaviour, and two separate mutations of the detector turned them red.
- **Suites.** The CI-script suite is green (501/501), and `check:env` is green.
- **Pre-existing gaps.** E1 and E2 are detector gaps that predate this PR, and this PR doesn't widen them. No live instance of either exists in `apps/` or `packages/` today. They should be tracked as follow-up work on #10.

This verdict covers the security surface only. The PR is **not merge-ready** until three things are done:
- an independent ordinary review by a different agent is recorded;
- the `## Implemented by` attribution and the commit identity are reconciled;
- the PR body links this note and ticks the Opus item, turning the template check green on the final head.
