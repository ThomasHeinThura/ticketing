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

---

# Delta security review at `e3dd45b` (after the F1 remediation `139d595`)

**Reviewer:** Opus 5.5, a fresh, independent context commissioned by the orchestrating session. I did not author, direct or remediate this change. An earlier attempt at this delta review stopped partway when its login expired; this pass redid all of it from the start.
**Reviewed head:** `e3dd45b09f629f0971f5d0a5862a77db89374204`
**Checked with:** `git fetch origin pull/352/head`, `gh pr view 352 --json headRefOid` and `git ls-remote` before I started and again before pushing. `origin/main` was `c4e18107fd7ed019ef6cf00edd8fec82b1703c89`, which is an ancestor of the head.
**Date:** 2026-09-24

## What changed since `c797fc9`

- `139d595` is the only code commit. It touches `scripts/ci/lib/env-reads.mjs` and `env-reads-342.test.mjs`. It adds a raw-regex backstop: any `process.env` / `process?.env` / `globalThis.process.env` / `import.meta.env` spelling that did not produce a token-level read is reported as `alias`, unless it sits inside a span the tokenizer identified as a comment. It also ends quoted strings at a newline and adds TSX, postfix, eval and variant tests.
- `git diff 139d595 HEAD -- scripts/` is empty, so the detector did not change after the fix.
- The merges `be226e2`, `b610f26`, `e1cfec5`, `e87f95a` and `e3dd45b` have an empty `git show --remerge-diff`, so none of them needed a manual conflict resolution. `git diff origin/main HEAD` touches only the PR's four files: the detector, its test, this note and `status.md`.

## Tests and counts (in my worktree at the reviewed head)

- `node --test scripts/ci/lib/env-reads-342.test.mjs`: **23/23 pass.**
- `pnpm test:ci-scripts`: **525 tests, 88 suites, 525 pass, 0 fail.**
- `pnpm check:env`: **exit 0.** It scanned 980 files and reports "29 environment read(s), every one attributable". 52 inherited deviations are baselined, and 1 stale baseline name is a note.
- **On the current tree, the result matches `main`.** I ran `check:env --report` with this head's detector and with `origin/main`'s detector swapped in, then restored it. The only difference is the known JSDoc false positive at `apps/api/src/utils/require-auth-secret.ts:5`, which this head drops.

## 1. Is F1 closed? Every earlier case, rerun

| Earlier F1 input | `e3dd45b` | `main` |
| --- | --- | --- |
| TSX `Don't have an account? <a href={import.meta.env.VITE_SIGNUP_URL}>` … `process.env.STRIPE_SECRET_KEY` … `// We're done` | line 4 `alias` + line 8 named | named, named |
| `<span>Port</span><b>{process.env.TASKDESK_PORT}</b>` | `alias` | named |
| `i++ / 2; process.env.X / 1` (also `i--`) | `alias` | named |
| `foo<Bar>/x; process.env.X` | `alias` | named |
| `eval("process.env.X")`, `new Function("return process.env.X")` | `alias` | named |
| `'abc` unterminated, then `process.env.X` on the next line | named `X` | named `X` |

**Every earlier F1 case is now reported.** Where the tokenizer loses track, the read comes out as `alias` rather than named. `alias` is unattributable, so it fails the gate, which is fail-closed. F1(b) holds: strings end at a newline. F1(c) holds: there are regression tests. F1(a) is only partly met, because a span the lexer wrongly thinks is a comment is still exempt. That is finding D1.

## 2. New findings

### D1 — BLOCKING. A false "comment" in JSX hides reads that `main` catches. This gap predates `139d595`.

The backstop exempts every span the tokenizer recorded as a comment. But the tokenizer records `//` and `/*` inside **JSX text**, and inside code that a mis-lexed quote has exposed, as real comments. So a read after them is hidden from both the token pass and the backstop. `main` does not strip comments, so it catches all of these. I found the same misses at `c797fc9`, so the earlier pass missed this and `139d595` did not introduce it.

Each case below was confirmed end to end. I wrote the synthetic file shown, ran `pnpm check:env` (**exit 0, "29 … every one attributable"**), and removed the file. A control file with a bare `process.env.STRIPE_SECRET_KEY` exits 1.

- `apps/web/src/zz-opus-probe.tsx`: `export const Docs = () => <p>See https://example.com/docs {process.env.STRIPE_SECRET_KEY}</p>;`
  - The `//` in the URL opens a "comment" that runs to the end of the line.
- `apps/web/src/zz-opus-probe.tsx`:
  ```tsx
  export const Glob = () => <code>apps/*</code>;
  export const k = process.env.STRIPE_SECRET_KEY;
  /** end */
  export const z = 1;
  ```
  - The `/*` in JSX text opens a "comment" that runs across lines, up to the next `*/` anywhere in the file, such as the end of the next JSDoc block. Every read in between is hidden.
- `apps/web/src/zz-opus-probe.tsx`: `export const A = () => <p>Don't</p>; export const u = 'https://x.com' + process.env.STRIPE_SECRET_KEY;`
  - The apostrophe in `Don't` flips which quotes the lexer treats as strings. The real string's `//` then counts as code, and so opens a "comment".
- In the harness only: `<p>Press ` to open</p>;` followed by `` `https://x.com`; process.env.X `` on the next line.
  - The stray backtick in JSX text causes the same flip across lines.

These are ordinary React shapes, not adversarial ones: URLs in JSX text, and globs or paths in `<code>`. They are the same class as F1, because a lexer misclassification makes the gate fail open where `main` did not.

**Suggested fix (smallest):** the backstop must not exempt any comment span. It should report every raw match. On today's tree, the only extra report would be the `require-auth-secret.ts:5` JSDoc line. It resolves to an approved name, and `main` already reports it, so this costs nothing new. A narrower option: exempt a comment only when its `//` or `/*` is the first non-whitespace text on its line. Either way, add the four inputs above as tests.

### D2 — BLOCKING. Rest destructuring from `process.env` is reported as a named read of the rest binding (a regression from `main`)

`const { ...rest } = process.env` is reported as `named: "rest"`; `main` reports `alias`. When the binding is given an approved name, the gate passes while the code copies the whole environment:

- `apps/api/src/zz-opus-probe.ts`: `export const { ...TASKDESK_AUTH_SECRET } = process.env;`
  - `pnpm check:env` gives **exit 0, "30 … every one attributable"**. With `main`'s detector, the same line is `alias`, which is unattributable and fails.
- `const { DATABASE_URL, ...all } = process.env` is reported as named `DATABASE_URL` + named `all`, when it should be named + `alias`.
- Cause: the destructuring loop in `findEnvReads` (`env-reads.mjs` about lines 626–645) treats every `id` token in the pattern as a key. It does not check for a preceding `...`.
- Fix: a `...` inside the pattern makes the whole pattern `alias`.
- This is also the #332 E3 coverage ask ("rest … destructuring keys staying `alias`"), which is still unpinned. Add a test.

### D3 — NON-BLOCKING, should be tracked (continues F2). Static `process` shapes still fail open, on both heads

The commit title says "fail closed on alternate environment reads". The backstop regex only matches `process` directly followed by `.env` / `?.env`, and it skips any `process` that follows a `.`. So these static, resolvable shapes are still missed by both `e3dd45b` and `main`.

Confirmed end to end in `apps/web/src/zz-opus-probe.tsx` with `STRIPE_SECRET_KEY`: `pnpm check:env` exits 0 for each.

- `(process as any).env.X`
  - This is the most ordinary one, a common TypeScript idiom.
- `globalThis?.process.env.X`
- `const p = (process); p.env.X`
- `process.env.X`
  - A unicode escape in an identifier. `process.env` and `\u{65}` are missed too.
- `window.process.env.X`

Confirmed in the harness only:

- `(<any>process).env.X`
- `const g = globalThis; g.process.env.X`
- `const p = globalThis['process']; p.env.X`
- `const { process: { env } } = globalThis`
- `Reflect.get(globalThis, 'process').env.X`
- `const p = require('process'); p.env.X`
- `import('node:process').then((m) => m.env.X)`
- `const m = import.meta; m.env.X` and `const { env } = import.meta`
- `process?.['env'].X`
- `with (process) { env.X }`
- `f(process)`

`main` misses all of these too, so none is a regression, and none appears in `apps/` or `packages/` today.

**Suggested direction:** report as `alias` any root `process` token, and any `process` reached from `globalThis`/`global` by any path, that is not consumed as a recognised non-env member access (`process.argv`, `.exit` and similar). Also report any file containing an identifier escape `\u` outside strings. Record this on #342 or a follow-up issue. The file header ("every occurrence of the environment object is classified") and the status wording still overstate coverage.

### D4 — INFORMATIONAL

- **Dynamic code.** `eval('process' + '.env.X')` and `new Function('return pro' + 'cess.env.X')` are missed by both heads. They cannot be resolved statically. Treating any `eval` or `new Function` as `alias` would close it cheaply.
- **Other runtimes.** `Bun.env.X` and `Deno.env.get('X')` are not detected. Neither is a runtime target of this repository.
- **Accepted false positives.** These are stricter than `main`, which is the fail-closed direction. None of them fires on today's tree.
  - A string `'process.env.X'` is now `alias` (on `main`, named `X`).
  - `const { X } = process.env` without a trailing `;` is now `alias`. Biome's default adds semicolons.
  - `function f({ X } = process.env)` is now `alias`.
  - `process[k].NAME`, with any non-literal `k`, is treated as a read of `process.env.NAME`.
- **Dead code.** `tokenStart` at `env-reads.mjs:681-685` is a three-way ternary whose branches all equal `start`. It has no effect.
- **Earlier findings.** F3 (`as` / `satisfies`) is fixed and tested: both now give `alias`. F4 is unchanged and harmless.

## 3. Merges from `main`, and #355 / #356

- **Merges.** All five merge commits are clean (empty remerge diff), and the PR's four-file diff against `origin/main` is intact.
- **#355** (Playwright smoke, merged as `776999d`) added `apps/web/e2e/**` and CI jobs. `check:env` still runs in `ci-fast.yml` (lines 137–138), and so does `test:ci-scripts` (lines 199–218). Both are green at this head. #355 does not touch `env-reads*`.
- **#356** (scope widening, merged as `3a45fc5`) changed only `ci-cd.md`, `decision-log.md` and its note.
- **Scope.** The detector's file is in security-review scope, through `scripts/ci/**` (`ci-cd.md` line 157).

## 4. `status.md` (orchestrator-owned; reported only)

The PR's new top entry (`8cc9d6e`) is **mostly accurate**:

- The candidate SHA, "23/23", "29 attributable reads" and "525/525" match my runs.
- It corrects the earlier false "previously missed read" claim, which is good.

Four inaccuracies:

- It says `pnpm test:ci-scripts` "could not run". That was true only of the author's Bun-shimmed environment. With real Node it runs: 525/88/0.
- It says the backstop covers "process-import/alias … and TypeScript assertion cases". That is broader than the truth. `process.env as T` is covered; `(process as any).env` and several alias shapes are not (D3).
- "Outside tokenizer-confirmed comments" is the wording that hides D1: the tokenizer's comments are not confirmed in JSX.
- The entry is inserted **above** the `# Status` H1 title, as is an earlier entry, so the file no longer starts with its heading.

## 5. Required CI and gates at `e3dd45b` (for the orchestrator; not part of the code verdict)

- **CI.** `gh pr view 352 --json statusCheckRollup` shows every required check green except **`pull request template + security review` = FAILURE**. The three `NOT ENABLED` jobs are skipped.
- **Template checker.** Run locally against the current body, `check-pr-template.mjs` reports:
  - the reviewed-head binding needs a delta review of `c797fc9..e3dd45b`. This section supplies that once the body cites it.
  - there are 2 independent-review checkboxes where exactly one is allowed.
  - both Opus items are unticked.
- **Ordinary review.** `## Reviewed by` cites a GPT-6 Luna "integration delta review … for the #338 merge" at `e3dd45b`. It does not clearly say that an ordinary review covered the code in `139d595`.
  - `139d595` is authored by `Codex GPT-6 <codex-gpt6@taskdesk.local>`, a third commit identity alongside `Codex (GPT-6 Luna)` and `Claude Code`.
  - The earlier author/reviewer-independence and attribution items (F5 and the gates list above) still apply.
- **GitHub reviews.** There are none (`reviews: []`).
- **Waivers.** None are cited.

## Verdict

**CHANGES NEEDED at `e3dd45b09f629f0971f5d0a5862a77db89374204`.**

- **F1 as reported is closed.** Every earlier input is now caught, fail-closed, and tested. The merges are clean, the counts match, and the gate matches `main` on today's tree.
- **Two regressions from `main` remain.** Each lets an ordinary-looking read pass `check:env`:
  - **D1:** JSX text containing `//`, `/*`, an apostrophe or a backtick produces false "comments" that the backstop exempts.
  - **D2:** `const { ...APPROVED_NAME } = process.env` is attributed to an approved name.
- **Both fixes are small:**
  - D1: stop exempting comment spans, or exempt only line-leading comments.
  - D2: a rest element makes the pattern `alias`.
  - Each needs a regression test using the inputs above.
- **After the fix,** a delta Opus pass on the new head is required. D3 should be tracked on #342 or a follow-up issue, even though it does not block this PR.
