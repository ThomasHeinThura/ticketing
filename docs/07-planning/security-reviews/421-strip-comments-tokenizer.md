# Security review — #421 / PR #460: `strip-code-comments.mjs` on the real TypeScript parser

**Reviewer:** Opus 5.5 (1M context), fresh independent context. It did not author, direct or remediate this change.
**Date:** 2026-09-28
**Reviewed head:** `558fe6e22213dba2df8a86a9b62bdf157c90294e`
**Verdict:** CLEAR WITH FINDINGS (non-blocking)

## Review chain

1. **First pass at `8585ea67` (8585ea679d4ef024d09d67598d8225775bc288ba): FINDINGS THAT MUST BE FIXED FIRST.**
   Not attested as a cleared head. There were two blocking findings:
   - **B1 — always parsing as `.tsx` hid real code.** An ordinary generic arrow
     function (`const pick = <T>(xs: T[]) => xs[0];`) in a `.ts` file was read as a JSX
     opening tag. From there to the end of the file, string literals were not reliably
     recognized, so a glob or URL string (`"src/*.ts"`, `"http://x"`) was scanned as a
     comment. That blanked a real `it.only(` / `it.skip(` after it. Reproduced. The
     pre-#421 scanner saw the call. The header wrongly said the legacy `<T>expr` cast
     was the only shape where `.tsx` parsing differs.
   - **B2 — one missed literal disabled literal-awareness for the rest of the file.**
     Literals were matched only when `ranges[r].start === i`, so once the comment scan
     passed a literal's start, `r` never moved again. `JsxText` was not tracked, so
     `<code>src/*.ts</code>` in a genuine `.tsx` file caused exactly that and hid a
     later `it.only(`. Reproduced. The old scanner happened to recover at the next
     newline.
2. **Delta pass at `558fe6e2`: CLEAR WITH FINDINGS (non-blocking).** This note.

## What was verified at `558fe6e2`

- `git rev-parse HEAD` and `origin/fix/421-strip-comments-real-tokenizer` both
  print `558fe6e22213dba2df8a86a9b62bdf157c90294e`. The worktree is clean.
- **B1 is closed.** An optional `fileName` now picks the parse mode: `.tsx`/`.jsx`
  (case-insensitive) parse as JSX, anything else or no `fileName` parses as non-JSX.
  `check-skips.mjs` passes `absolute` and `check-events.mjs` passes `location`, in both
  of its calls, so its `code` and `structural` copies are parsed identically.
  `workflow-alias-table.test.mjs` scans a `.mjs` file and correctly uses the default.
  Re-ran the B1 repro with no `fileName` and with a `.ts` `fileName`: `it.only(` is
  visible.
- **B2 is closed.** `JsxText` is a tracked literal kind. It has no `DELIM_WIDTH` entry,
  so under `blankStrings` it is blanked in full, and it is left unchanged otherwise.
  The main loop now throws if a pending literal's start is behind the scan position.
  Re-ran the B2 repro with a `.tsx` `fileName`: `it.only(` is visible.
- The new tests genuinely fail without the fix. Both were reproduced as failures on
  `8585ea67`.
- `node --test scripts/ci/lib/strip-code-comments.test.mjs` passed all 46 tests.
  `workflow-alias-table.test.mjs` passed all 13.
- `check:skips` reports 423 test files, clean. `check:events` reports 31 keys across
  379 files, clean. Both match `origin/main`. The desync guard did not fire on any real
  repository file.
- **Fuzzing.** 4,000 random inputs, each run in both non-JSX and `.tsx` mode, were built
  from pieces covering strings, templates, regexes, comments, JSX tags and text,
  generics, lone quotes and backslashes. The desync guard never fired. There were no
  other errors. The output length with and without `blankStrings` was always the same.
  `check-events.mjs` relies on that last property to read values back out at the same
  offsets.
- **Earlier checks at `8585ea67`, still valid because the code involved did not change:**
  - The shared compiler process never returned stale results. Inputs were run in
    order, in reverse, and as 200 alternating pairs of different inputs.
  - Resources stayed flat after about 2,500 calls: 6 file descriptors and about 79 MB
    in the child process, about 1.7 ms per call.
  - The scratch folder is removed on a normal exit and after an uncaught exception.
  - Non-ASCII text and emoji, a byte-order mark, `#!` lines, CRLF, JSDoc literal types,
    decorators, enums, import attributes and nested templates all behaved correctly.
- The two Sonnet fixes are in place. `parseLiteralRanges` throws when the parser returns
  no source file. A newline inside a string is kept, and it has its own test.

## Non-blocking findings

- **N1 — a desync that runs to end of file is not caught.** The guard only runs at the
  top of the next iteration. A comment that passes a literal's start and then reaches
  the end of the file ends the loop without throwing. No input reaching this path was
  found (the fuzzing above found no desync of any kind), so this is defence in depth
  only. Suggested follow-up: after the loop, throw if any unconsumed range has
  `start < source.length`. Zero-width recovery tokens at the very end must be exempted.
- **N2 — the desync guard has no test of its own.** It is covered only by the
  regression tests that no longer reach it. A test that injects mismatched ranges would
  guard it against a future edit.
- **N3 — a generic arrow without a trailing comma in a genuine `.tsx` file is blanked.**
  `<T>(xs: T[]) => ...` is not valid TSX. The parser reads it as JSX text, which is now
  blanked, so a following `it.only(` is hidden. Checked: esbuild, the transform vitest
  uses, rejects this file ("The character \">\" is not valid inside a JSX element"),
  and `tsc` rejects it too. So such a file cannot run, and cannot hide a skipped test
  that actually executes. Recorded so nobody reads the `.tsx` path as covering invalid
  TSX.
- **N4 — (from the first pass) the scratch folder is not removed after a signal.**
  `process.on("exit")` does not run on SIGTERM or SIGINT, so a killed run leaves a
  `strip-code-comments-*` folder in the temp directory. Only a housekeeping issue.

## Scope not covered

This review does not cover CI status, PR-body gates, or branch protection. The
merging session verifies those itself at merge time.
