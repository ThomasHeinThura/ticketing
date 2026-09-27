# Security review — PR #382, env-read detector D3 shapes (#342 follow-up)

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`; fresh independent context; did not author, direct or remediate this change)
**Reviewed head:** `f2632ad08e03baca6c5838b7ba1d073a9a15b52f`
**Merge base:** `0b1bcc1d82f340a8d624fb053835ce3152d8b51d` (also `origin/main` at review time)
**Date:** 2026-09-27
**Scope:** `scripts/ci/lib/env-reads.mjs`, `scripts/ci/lib/env-reads-342.test.mjs` (the PR's only two files). `scripts/ci/**` is security-review scope (`ci-cd.md`).

## Baseline runs at the reviewed head

- `node --test 'scripts/ci/**/*.test.mjs'`: 626/626 pass, 89 suites, 0 fail. A fresh worktree needs `pnpm install` first, or the `tsc`-dependent tests fail.
- `pnpm check:env`: 29 environment reads, all attributable. Unchanged from `main`.
- Regression diff: the PR's and `main`'s `findEnvReads` give identical output on all 1,271 tracked JS/TS files except the PR's own test file.
- Crash probes: malformed, out-of-range, over-long and lone-surrogate `\u` escapes, plus `\u` at end of file. A 20,000-case random fuzz gave 0 throws. A throw would still fail closed, because `check-env.mjs` ends in a top-level `await main()`.

## Findings

Probes were synthetic files under `apps/web/src/` in the review worktree, checked with `node scripts/ci/check-env.mjs`, then deleted. "Exit 0" means the gate passed while an unregistered `STRIPE_SECRET_KEY` read was present. **Every miss below is also missed on `main`, so none is a regression.**

### H1 — HIGH, already on `main` — JSX text apostrophe hides reads (lexer/grammar divergence)
`const p = process;` then `<p>Can't reach {p.env.STRIPE_SECRET_KEY}</p>`: exit 0. The same line without the apostrophe exits 1. Casts and `process["env"]` on that line are hidden the same way. This is the same class as #361 F1. Only a real parser closes it.

### M1 — MEDIUM, already on `main` — passing `process` to another file
Each of these exits 0 when a second file reads `.env.STRIPE_SECRET_KEY`:
- `export default process`
- `export const p = process`
- `export { env } from 'node:process'`
- `export const get = () => process`

The PR's own reason for flagging `f(process)` applies to these too.

### M2 — MEDIUM, already on `main` — cast shapes the new unwrap misses
- `(import.meta as any).env.X` (exit 0)
- `((process as any)).env` (exit 0)
- `(process! as any).env`
- `(globalThis as any).process.env`
- `(<any>globalThis).process.env`
- `const p = (process as any); p.env`
- `const p = <any>process; p.env`
- `(import.meta).env`

### M3 — MEDIUM, already on `main` — escapes in string literals are not decoded
- `process['\x65nv'].X` (exit 0)
- `globalThis['\x70rocess']`
- `require('process')`
- `import … from 'node:pro\x63ess'`
- `Reflect.get(process, '\x65nv')`

### M4 — MEDIUM, record-keeping — one listed D3 shape is still open
`const { process: { env } } = globalThis; env.X` (exit 0) and `const { process: p } = globalThis; p.env.X` are missed. Neither is tested or listed under "Not done". The PR body's "closes the D3 shapes" and "structural guard so it cannot recur" overstate coverage. #342 must stay open.

### L1 — LOW — new false positives from the bare-argument rule
The rule also flags `if (process)`, `(process) => …`, `function f(process)`, `catch (process)` and `f(a, process).env`. These fail closed, and none appear in today's tree. A local variable named `process` would be reported as an unattributable env read.

### L2 — LOW, already on `main` — other static misses
- an alias of an alias
- a `globalThis` alias with no `;`, declared with a comma, or cast
- `(await import('node:process')).env`
- non-ASCII alias names and astral `\u{…}` escapes
- spread, array or object wrappers around `process`, and `new Proxy(globalThis, {})`
- `self.process`, `globalThis[x]`, `with (globalThis.process)`

## Verdict

**CLEAR WITH FINDINGS at `f2632ad08e03baca6c5838b7ba1d073a9a15b52f`.**

This change is strictly more fail-closed than `main` and causes no regressions, so it may merge once its other required gates pass. The findings are not regressions and do not block this PR. H1, M1–M4 and L1 must be tracked on #342, and #342 must not be closed on this merge. Recommended next step: don't queue another round of lexer patches. Rebuild the detector on the TypeScript compiler API and fail on any parse error, as #361 did. Then treat every reference to the global `process`, `globalThis.process` or `import.meta` as unattributable unless it is a known safe member.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `a8a7e17345019aec9299c208355f60bc69e88748`
**Previously reviewed head:** `f2632ad08e03baca6c5838b7ba1d073a9a15b52f`
**Reviewer:** orchestrating session (mechanical verification — the merge changes no authority or gate-semantics invariant, per `AGENTS.md`'s review-tier table)
**Verdict:** CLEAR WITH FINDINGS, unchanged. All findings above (H1, M1-M4, L1, L2) still stand, non-blocking.

- `git show --remerge-diff a8a7e17` is empty — a clean automatic merge, no conflict-resolution content.
- `git diff 1c183ad..a8a7e17 --stat` touches exactly two files: `docs/05-operations/runbook.md` (#380) and `docs/07-planning/status.md` (#384), both docs-only and outside security-review scope. `scripts/ci/lib/env-reads.mjs` and its test file are unchanged since the reviewed head.

---

## Lightweight re-confirmation after second branch update (2026-09-27)

**Reviewed head:** `ce73e9a1dc2bc9eea193649179cebef6f0a14ba6`
**Previously reviewed head:** `a8a7e17345019aec9299c208355f60bc69e88748`
**Reviewer:** orchestrating session (mechanical verification, per `AGENTS.md`'s review-tier table)
**Verdict:** CLEAR WITH FINDINGS, unchanged. H1, M1-M4, L1, L2 above still stand, non-blocking.

- `git show --remerge-diff ce73e9a` is empty — clean automatic merge, no conflict-resolution content.
- This merge brings in PR #375's real changes (migration, `schema.ts`, `audit-writer.ts`, `list-workspace-audit.ts`), which already carries its own independent, complete Opus CLEAR verdict. Zero overlap with this PR's own file (`scripts/ci/lib/env-reads.mjs`, `scripts/ci/lib/env-reads-342.test.mjs`) — confirmed via `git diff a8a7e17..ce73e9a --stat`.
