# Pre-merge security review — PR #79 (typecheck coverage, turbo inputs, and the class-level checker)

**Reviewed head:** `fa22ecb2566645a36b2ae7dfd4e2bff378ea013f`

**Verdict: CLEAR WITH FINDINGS** — one MEDIUM, three LOW, **none blocking**, none a weakening.

**Status of the gate:** this review ran **before** merge and is complete. It closes the
mandatory independent Opus security review for the head named above, **and for that head
only.** A later content commit voids it and requires a fresh delta review. No waiver was
sought or used — none is authorized for this pull request.

**Reviewer independence.** A fresh, review-only Opus context that authored no part of the
change, made no edit to the worktree, and confirmed `git status --porcelain` empty with HEAD
unchanged throughout. The candidate was implemented by a Sonnet lane with the turbo-inputs and
class-checker work authored by the orchestrator; the orchestrator's own verification is
recorded in the pull request as author verification and is explicitly **not** the independent
review.

**Reviewed the tree that will merge.** The branch was updated onto `main` at `5745c88` — which
carries #78 and #81 — **before** freezing, so this clearance applies to the merged
configuration rather than to a stale one. That ordering is deliberate: on #81, reviewing
before updating cost an extra confirmation round.

**It gates two lanes**, PR #80 and PR #77, and the reviewer looked specifically: **no
propagating defect.**

---

## What was wrong, and it was two different things

**1. `tests/api-integration` was in NO TypeScript program.** 48 files. A broken import, a wrong
type, or a call to a function that no longer existed could not fail CI. 365 diagnostics were
fixed to close it — 342 `TS18048`, 12 `TS2532`, 9 unmasked once `better-auth/types` resolved,
and 2 genuine narrowing defects at `helpers/fixtures.ts:47`.

**2. `pnpm typecheck` returned a CACHED FALSE PASS.** turbo's `typecheck` task declared no
`inputs`, so default per-package hashing never saw `tests/` — those trees live outside every
package. **A gate that can pass without checking is worth less than no gate**, and CI runs the
cached command.

## What the reviewer established, by demonstration

| Claim | Evidence |
| --- | --- |
| **Zero suppressions — more strongly than claimed** | No `as any`, `@ts-*` pragma, `as unknown` chain, `satisfies` escape or strictness disabling in the diff. Non-null assertions: **none exist anywhere in `tests/api-integration`**, not merely none introduced. The repo's only `@ts-nocheck` is in a generated file this pull request does not touch. `strict` and `noUncheckedIndexedAccess` live in an untouched shared base. **Exactly one** signature changed in the whole diff |
| **No assertion was weakened to make anything compile** | The decisive check, and the one that mattered most for a 365-diagnostic refactor of an authorization oracle: all **19** touched assertions map 1:1 to added ones with **identical matchers and expected values**. **261 test declarations before and after** — nothing deleted, nothing skipped |
| **`requireRow` throws** | `fixtures.ts:18-24`, returning `T` rather than `T \| undefined`. All 12 non-insert call sites already required the row: the old code either used `expect(undefined).toBeNull()`, which fails, or indexed `[0]` with no optional chain, which throws. So no test's absence-semantics were replaced by a throw |
| **`mockAuthenticatedSession` is faithful** | `role?: string \| null` mirrors `is-instance-admin.ts:7`'s own cast character-for-character |
| **The cached false pass, both directions** | On `main` with a broken import: `8 successful, 8 cached, FULL TURBO, exit 0`. At this head, same break: `TS2882`, exit 1 |
| **The `$TURBO_DEFAULT$` trap is real and guarded** | With the sentinel removed, the task hash **froze at `9f54c0de992fffbc`** across an `apps/api/src` edit while `tests/` still moved it — the defect *moves* exactly as documented, and the new guard fails on it |
| **The class-level checker is genuine** | Reports the `i18n` gap when the `@taskdesk/web#typecheck` entry is removed; its string-aware scanner survives a `//` inside a string value and a block comment |
| **`cache: false` tasks are genuinely inert** | `cache bypass, force executing`, never a HIT where `build` shows one. Described honestly in `turbo.json` and **not** sold as a live vulnerability |
| **The exemption is really gone** | `EXEMPT` is an empty `Map`; `tsc --listFiles` shows **48 of 48** with an empty set difference; the gate asserts **equality per tree**, not `> 0` |
| **The gates interlock rather than merely coexist** | `test:ci-scripts` **322/322** on the merged tree. #81's own classifier puts exactly `typecheck-coverage.test.mjs` and `turbo.json` in scope, and `check:pr-template` demands this review **by name** |
| **The oracle still passes at runtime** | **41 files / 290 tests** green against real PostgreSQL. Compiling is not passing, and a 365-diagnostic refactor needed that check — the reviewer ran it unasked |

Both new `paths` mappings resolve to real declaration files (verified in `--listFiles`), are
genuinely necessary (`pg@8.22.0` ships no types; the test files sit outside `apps/api`), and
replace no pre-existing `paths`.

---

## Findings

**None blocking.** Recorded here rather than fixed, because **nothing outside
`docs/07-planning/security-reviews/` may land after `fa22ecb`** without voiding the clearance
above. They are batched into a single follow-up pull request together with #81's four LOWs and
`status.md:588`, rather than spending a review round on each.

- **MEDIUM — the class-level checker's coverage has a real limit, and it was A/B tested.** The
  same out-of-package reach **fails** when expressed via `include` and **passes** when
  expressed via `files`. It is also blind to a single-`../` reach, and `extends` is invisible
  twice over — `base.json` does not match `tsconfig*`, and its directory has no `scripts`
  entry. **Latent, not present in the tree, and disclosed by the author** in the code comment.
  The durable answer is to derive reaches from `tsc --showConfig` rather than from the raw
  files.
- **LOW** — a dead `?? null` at 7 sites, provably unreachable via an untouched fixture guard.
  Disclosed.
- **LOW** — two JSONC parsers now live in one file, and the weaker one runs on `turbo.json`.
  It fails closed. One-line fix: call `parseJsonc`.
- **LOW, and it is this project's signature defect, so it is stated plainly.**
  `typecheck-coverage.test.mjs:44-57` still argues **present-tense** for the exemption that
  *this same commit deleted* — "34 files", "359 errors", "declared as an EXEMPTION instead",
  all now false. The pull-request body says two stale mentions remain; **there are four**,
  though only this block is materially misleading. It matters because it is the prose a future
  agent reads **before touching the guard** — the same "fix the row, leave the neighbour stale"
  habit that cost #78 four review rounds. **Knowingly merged and batched**, not overlooked: it
  is prose rather than behaviour, #79 is the dependency anchor for two lanes, and a fifth
  review round to correct a comment would delay them for no behavioural gain.

## Method

Mutations were applied to a mirror under `/home/ubuntu/.taskdesk-scratch/rev79/` with
byte-identity verified on restore; the lane was never written to. `/tmp` was avoided via
`TMPDIR` because that filesystem is inode-constrained on this host. Full findings:
`/home/ubuntu/.taskdesk-scratch/review-79-opus.md` (689 lines).
