# Security review — `check:env` alternate environment-access syntax (#352, issue #342)

**Reviewer:** Opus 5.5, a fresh, independent context commissioned by the orchestrating session. I did not author, direct or remediate this change.
**Reviewed head:** `c797fc91e2ee57b73e48c45c57d36a36d916bf2f`
**Reviewed SHA:** `c797fc91e2ee57b73e48c45c57d36a36d916bf2f` (checked with `gh pr view 352 --json headRefOid` and `git rev-parse origin/fix/342-env-reads-syntax` before I started and again before committing)
**Merge base:** `7bebaf61c50d2a65255e459827c88c1d30230340`, which was also `origin/main` at review time.
**Pull request:** #352 (`fix/342-env-reads-syntax`, P0 issue #342, follow-up to the #332 Opus findings E1/E2)
**Date:** 2026-09-24

## Surfaces examined

- `scripts/ci/lib/env-reads.mjs`: this is the detector. The PR replaces the regex detector with a hand-written tokenizer (`tokenize`), `collectTokenAliases`, `isRootIdentifier` and `parseEnvObject`. I read the whole file, all 558 lines.
- `scripts/ci/lib/env-reads-342.test.mjs`: new, 19 tests.
- `scripts/ci/check-env.mjs`: I read it to confirm how the detector's output is used. It is unchanged. A `kind !== "named"` read is unattributable and ratcheted by fingerprint. A `named` read is checked against the approved list or the name baseline.
- `docs/07-planning/status.md`: the PR adds 65 lines to it. There is no gate code in that change.
- PR #332 (`058daa0`), its `env-reads.test.mjs`, and its Opus note `332-env-read-detector-tests.md`.

## What I probed

A scratch harness, not committed, ran the same inputs through this head's detector and through `origin/main`'s detector. "Caught" means `findEnvReads` returns at least one read that `check:env` would fail or ratchet.

### 1. The #342 shapes

| Shape | PR head | `main` |
| --- | --- | --- |
| `{ ...process.env }` | alias | missed |
| `globalThis.process.env.X` / `global.process.env.X` | named `X` | missed |
| `process["env"].X` | named `X` | missed |
| `process?.env.X` | named `X` | missed |
| `const { env } = process` / `{ env: e } = process` | alias | missed |
| `const p = process; p.env.X` (also `let p; p = process`) | named `X` | missed |
| `Reflect.get(process, "env").X` | named `X` | missed |
| `import { env } from "node:process"` / `{ env as e }` | named `X` | missed |
| `require("process").env.X` | named `X` | missed |
| `import.meta["env"].X` / `import.meta?.env.X` | named | missed |
| `process/**/.env.X` | named `X` | missed |

**Every shape #342 lists is now caught, and each has a test.**

### 2. Evasion (new shapes)

| Shape | PR head | `main` |
| --- | --- | --- |
| `Object.entries(process.env)` | alias | alias |
| `` process.env[`X`] `` | computed | computed |
| `` process[`env`].X `` | **missed** | missed |
| `process["e"+"nv"]`, `const k="env"; process[k]` | **missed** | missed |
| `eval("process.env.X")`, `new Function("return process.env.X")` | **missed** | named `X` (by accident: strings were scanned) |
| `import { env } from "process"` (no `node:` prefix) | **missed** | missed |
| `require("node:process").env.X` | **missed** | missed |
| `const { env } = require("node:process")` / `await import("node:process")` | **missed** | missed |
| `import proc from "node:process"; proc.env.X` / `import * as p …` / `import proc, { env } …` | **missed** | missed |
| `globalThis["process"].env`, `const p = globalThis.process; p.env` | **missed** | missed |
| `const { env } = globalThis.process`, `const { process: { env } } = globalThis` | **missed** | missed |
| `Reflect.get(globalThis.process, "env")`, `Object.getOwnPropertyDescriptor(process, "env")` | **missed** | missed |
| `(process).env.X`, `process!.env.X`, `with (process) { env.X }` | **missed** | missed |

The first two rows are acceptable: they are truly dynamic, or they fail closed. The others are static and resolvable, and several are as ordinary as the #342 shapes that were fixed: the `"process"` specifier, the `node:` form of `require`, default or namespace imports of `node:process`, and `globalThis.process` aliases.

The remaining gap has one root cause. `parseEnvObject` returns `null`, meaning the access is ignored, for any `process` reference it doesn't recognise, when it should fail closed. The #332 note recommended treating any root `process` reference that isn't followed by a recognised `.env` access as `alias`.

### 3. No weakening: the regressions

**On the current tree:** I ran `node scripts/ci/check-env.mjs --report` with this head's detector, then with `origin/main`'s detector swapped in and restored afterwards, and diffed the output. The only difference is one approved "read" that disappears: `apps/api/src/utils/require-auth-secret.ts:5`. That line is a JSDoc comment, so it was a false positive and nothing real was lost. Unapproved names and unattributable reads are identical, so no read on today's tree becomes undetected. `pnpm check:env` exits 0 with 28 attributed reads.

The status.md entry says the new scanner "found an approved template-interpolation read in `send-workspace-invitation-email.ts` that the old `$`-prefix exclusion missed". That is not correct: `main`'s detector already reports `send-workspace-invitation-email.ts:46`. The 29 → 28 change is the comment false positive being dropped.

**Latent regressions: shapes `main` catches and this head misses.** The tokenizer treats anything it thinks is a string, regex literal or comment as not code. It gets that wrong on ordinary TSX and on some ordinary TS. `check:env` scans `.tsx`, and seven `.tsx` files under `apps/web` and `packages/email` read the environment today. Reproduced:

```tsx
export function Footer() {
  return (
    <p>
      Don't have an account? <a href={import.meta.env.VITE_SIGNUP_URL}>Sign up</a>
    </p>
  );
}
const secret = process.env.STRIPE_SECRET_KEY;
// We're done
```

- `main` reports `4 VITE_SIGNUP_URL` and `8 STRIPE_SECRET_KEY`.
- **This head reports nothing.**

The apostrophe in JSX text opens a "string". Quoted strings don't stop at a newline, so the scan runs to the next `'` wherever it is. In this example that `'` is inside a later comment, so everything in between is swallowed.

| Shape | PR head | `main` |
| --- | --- | --- |
| JSX text containing `'` (e.g. `Don't`), followed by any read before the next `'` in the file, across lines | **missed** | named |
| JSX closing tag `</x>` followed on the same line by a read and another `/` (e.g. `<span>Port</span><b>{process.env.TASKDESK_PORT}</b>`) | **missed** | named |
| Postfix `i++ / 2; … process.env.X / 1` (and `i--`) | **missed** | named |
| `foo<Bar>/x; process.env.X` | **missed** | named |
| `eval` / `new Function` string bodies | **missed** | named |
| `'abc` with an unterminated quote at end of line, followed by a read on the next line | **missed** | named |

`<`, `>`, `+` and `-` are in `regexPrefixPunctuation`. So a `/` after a JSX `<`, or after a postfix `++`, is lexed as the start of a regex, and the rest of the line up to the next `/` is skipped.

### 4. ReDoS and performance

- The tokenizer uses only single-character regexes (`/\s/`, `/[A-Za-z_$]/`, `/[\w$]/`, `/[A-Za-z]/`). There is no backtracking pattern, so there is **no ReDoS surface**.
- `canStartRegex` walks backwards through the token list to the matching `(` or `{` for every `/` that follows `)` or `}`. That is quadratic in nesting depth:
  - 8,000 nested `if (x) {`: 1.07 s.
  - 8,000 nested parens, each followed by `/`: 183 ms.
  - 1.8 MB of ordinary code: 179 ms, against 1 ms on `main`.
- `addRead`'s `source.slice(0, start).split("\n")` per read is quadratic too. That cost predates this PR, and this head is roughly 3× faster than `main` on it.
- A full `check:env` run takes 0.4 s over 969 files. **None of this is exploitable in CI.** It is informational.

### 5. Tests and mutation

- `node --test scripts/ci/lib/env-reads-342.test.mjs`: **19/19 pass.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **514 tests, 88 suites, 514 pass, 0 fail.**
- `pnpm check:env`: **exit 0**. It reports "28 environment read(s), every one attributable"; 52 inherited deviations are still baselined, and 1 stale baseline name is a note.
- Mutation A: I forced `globalProcess = false`. "records globalThis process" and "records global process" went **red**.
- Mutation B: I disabled the `import { … } from "node:process"` alias collection. Three tests went **red**: "records node:process import", "ignores plain node:process import declarations", and "resolves aliased node:process imports".
- I restored both mutations, and `git status --porcelain` was empty afterwards. The new tests pin real behaviour.
- **There is no test for JSX/TSX input or for postfix `++`/`--`.** That is why probe 3's regressions are green.

## Findings

**F1 — BLOCKING. The tokenizer hides reads that `main` catches (gate weakening).** Probe 3 shows that ordinary TSX makes real `process.env` and `import.meta.env` reads invisible to `check:env`: an apostrophe in JSX text, or a closing tag followed by more markup on the same line. The same happens after a postfix `++`/`--` division, and after a `>` followed by `/`. For JSX text, the hidden region spans lines, up to the next `'` anywhere in the file. These are not adversarial shapes. They are what React code looks like, and `apps/web` is React.

The PR's stated goal is to close evasion. The old detector failed closed on strings and comments (#332 E4). The new one fails open wherever its lexer is wrong, which is a new and broader bypass class than E1/E2. The current tree is unaffected: probe 3's diff shows parity.

Required before merge:
- **(a) Fail closed on lexer uncertainty.** Every raw `process…env` / `import.meta…env` occurrence the regex would find must either be accounted for by a token-level read, or lie inside a span the tokenizer positively identified as a comment. Otherwise report it as `alias`. String, regex-literal and JSX-text hits stay flagged. That is the #332-accepted false-positive cost.
- **(b) Quoted strings end at an unescaped newline**, as they do in JavaScript. That bounds any mis-lex to one line.
- **(c) Regression tests** for the probe-3 shapes: TSX with `'` in text, a same-line `</x>…{read}…/>`, `i++ / …`, and `eval("process.env.X")`. Each must be reported.

An AST parser (#342 suggests one) would also close this, but it isn't required if (a) holds.

**F2 — NON-BLOCKING, should be tracked. Unrecognised `process` accesses fail open.** Probe 2 found static shapes that still evade detection: `from "process"`, `require("node:process")`, default and namespace imports of `node:process`, `globalThis.process` aliases and destructuring, `` process[`env`] ``, `Object.getOwnPropertyDescriptor`, and `(process).env` / `process!.env`.

- Suggested fix: `parseEnvObject` returns an `alias` read for every root `process` or `globalThis.process` reference not followed by a recognised env access, and for every import or require of `process` / `node:process` that binds more than `stdin`/`stdout`-style members.
- This isn't blocking, because #342's acceptance list is met and none of these shapes exists in `apps/` or `packages/` today.
- It should be recorded on #342 or a follow-up issue. It shouldn't be left as an implicit gap: the file header still claims that "every occurrence of the environment object is classified".

**F3 — NON-BLOCKING, correctness. `process.env as T` is misclassified as the named read `as`.** The branch `tokens[parsed.end]?.value === "env" && next?.type === "id"` is at `env-reads.mjs:477`. It turns `const e = process.env as Record<string, string>` into `named: "as"`; `main` reports it as `alias`, and `satisfies` behaves the same way. This fails closed, because `as` is not an approved name, but it misreports an unattributable alias as a single unapproved name. If "as" were ever added to `unmigratedNames`, it would stop ratcheting by fingerprint. The branch should be removed, or restricted to the imported-`env` alias case it seems to be for, and `as`/`satisfies` should get a test.

**F4 — INFORMATIONAL.** Probe 4 found quadratic backward scans in `canStartRegex`. They are harmless at this repository's scale.

**F5 — PROCESS, not part of the code verdict.**
- The PR edits `docs/07-planning/status.md`, which is an orchestrator-owned surface (CLAUDE.md, "The control plane"). The entry also carries the inaccurate "previously missed read" claim noted in probe 3.
- The orchestrator should decide whether to keep that hunk and correct the claim.

## #332 supersession

**#352 does not supersede #332. They are complementary and don't conflict.**

- **What #332 adds:** `scripts/ci/lib/env-reads.test.mjs`, a different file from #352's `env-reads-342.test.mjs`, plus its note. Neither PR touches the other's files, and #332 is `MERGEABLE` against `main`.
- **#332's assertions still hold.** I ran #332's `env-reads.test.mjs` at `058daa0` against this head's detector: **6/6 pass**. That covers helper and lookup-table computed reads, aliases, typed parameter defaults, destructuring, Vite built-ins, and fingerprint identity and occurrence. So #352 does not break any #332 assertion.
- **#352 doesn't carry them.** It covers direct, computed, destructured and Vite reads, but it has no alias, parameter-default or fingerprint assertion.
- **Both should merge.** #332's E3 coverage asks (rest, quoted and computed destructuring keys staying `alias`) are still unpinned by either PR.

## Gates observed at this head (for the orchestrator; not part of the verdict on the code)

- **Ordinary review.** There are no GitHub reviews (`reviews: []`, `reviewDecision: ""`). The PR body's checklist claims "GPT-6 Luna PASS at `c797fc9…`", while `## Reviewed by` still reads "Pending fresh independent ordinary review". The two sections contradict each other.
- **Reviewer and author.** The reviewer is GPT-6 Luna. The implementer attested in `## Implemented by` is also GPT-6 Luna (Codex). The orchestrator reports that Thomas has since allowed GPT-6 Luna to self-review. **I could not find that allowance in the decision log or CLAUDE.md on `origin/main` (`7bebaf6`).**
  - The 2026-09-23 lane entry says "the same agent or tool is never both author and ordinary reviewer".
  - The current-model fallback entry says it "does not change reviewer independence".
  - Per CLAUDE.md's source hierarchy, the allowance needs a decision-log entry before this merges.
- **Attribution does not reconcile.**
  - `git log --format='%an <%ae>' origin/main..HEAD` shows 8 commits by `Codex (GPT-6 Luna) <agent@taskdesk.local>`.
  - The last 3 commits (`574ccc1`, `1f002ae`, `c797fc9`, i.e. the nested-property and unary-prefix fixes) are by `Claude Code <noreply@anthropic.com>`.
  - `## Implemented by` names only GPT-6 Luna.
  - Under the 2026-09-23 commit-identity rule, this mismatch must be noted on the PR and reconciled before merge.
  - Whoever made those three commits is also an author. If a Claude context wrote them, then GPT-6 Luna's delta review of them is independent of that author, but Luna's review of its own earlier commits is not.
- **CI at `c797fc9`.** The latest run (35937640751) is green except **`pull request template + security review`, which is FAILURE**. Some earlier runs were superseded (CANCELLED).
- **Template checker.** `node scripts/ci/check-pr-template.mjs --body <body>` from this worktree reports **5 problems**:
  - `## Task` section missing.
  - `**Note:**` doesn't link a committed note; this file fixes that once the body links it.
  - There are 3 independent-review checkboxes where exactly one is allowed.
  - The Opus item is unticked in "Any change", and again in "Bug fix".
- **Waivers.** The `## Gates` table cites none; every row is `n/a`.
- **Head change.** This note is committed on top of `c797fc9`, so the PR head moves. The code under review is unchanged: the only new file is this note.

## Verdict

**CHANGES NEEDED at `c797fc91e2ee57b73e48c45c57d36a36d916bf2f`.**

- **What works.** Every #342 shape is caught and tested. The tests pass mutation checks, there is no ReDoS, and on today's tree the gate is at parity with `main`, minus one comment false positive.
- **What blocks.** F1: the new lexer fails open on ordinary TSX and on postfix-increment division, so reads that `main`'s `check:env` catches become invisible. This PR is meant to close bypasses, and it opens a broader one. Fixing F1 (a) to (c) is required.
- **After the fix.** A delta Opus pass on the new head is needed. F2 and F3 should be fixed or tracked. The gate items above (review attestation, a decision-log entry for the self-review allowance, commit-identity reconciliation, and the template problems) must be resolved before merge regardless.
