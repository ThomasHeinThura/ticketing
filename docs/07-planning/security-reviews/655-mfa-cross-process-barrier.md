# MFA cross-process fixture ordering: authentic ordinary reviews

**Reviewed head:** `7513e4bbfc086a3f4240250b7383f9329cfc0a83`

Two fresh independent ordinary contexts reviewed the one-file candidate against accepted12c. The change matches no authoritative security glob. Root transports the original reports unedited. Both approve with the same non-blocking early child-exit reporting limit; no runtime mutex/lease, test assertion, timeout or gate change. Optional diagnostic improvement is deferred, not a blocking finding or waiver. Their explicit spawn selectors were gpt-6-luna with fork_turns=none; both reports expose generic GPT-6 and do not attest a Luna serving variant. Current root exact7513 lint/typecheck/unit passed (three actual receipts). Current required GitHub checks remain separate and must be green at the final candidate. The unrelated old production boot import timeout remains unresolved; no clearance is implied.

## Ordinary A

Original report SHA256: `bffbef0fb56e8b85889471867517acf3d681acbc6dd1f34d9770e02f7536f675`. Public original: https://github.com/ThomasHeinThura/ticketing/pull/655#issuecomment-6110187692. Spawn context: `/root/review_mfa_crossprocess_barrier_a_luna`.

# Ordinary review A — MFA cross-process fixture barrier

- **Reviewed head:** `7513e4bbfc086a3f4240250b7383f9329cfc0a83`
- **Comparison base:** `12c09aaca85250c03223df1ed191275c0d3cdd74`
- **Branch:** `codex/mfa-cross-process-barrier`
- **Role / independence:** Fresh ordinary reviewer context; did not author, direct, or remediate this change.
- **Model:** GPT-6 (platform-reported model/version was not exposed to this reviewer context; do not relabel as Luna or Sol without platform confirmation).
- **Scope:** Exact one-file candidate diff, new cross-process mutex barrier and child lifecycle, preserved assertions and timeout, security-scope path classification, and the bounded focused test. No product code changed.

## Evidence

- `git diff --name-only <base>..<head>`: only `tests/api/mfa-csrf-app-fixture.test.ts`.
- `git diff --check <base>..<head>`: clean.
- Exact command: `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/mfa-csrf-app-fixture.test.ts`
- Result: 1 file, 11 tests passed; 3.77s. Captured raw output: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/E/review-mfa-crossprocess-a/focused-test.raw.log`.
- No expanded API suite, DB, API server, stress, Docker, mutation, or full test suite was run.

## Assessment

The corrected ordering establishes the parent lock before spawning the independent process. The parent callback then waits for `MFA_LOCK_CHILD_WAITING` and, crucially, the helper's actual `onLockContention` callback (`MFA_LOCK_CHILD_CONTENDED`) before checking that `MFA_LOCK_CHILD_ENTERED` is absent. Only after the parent's callback releases the lock does the child finish and the test require its callback-entry marker. This makes the negative assertion conditional on observed contention, rather than elapsed startup time alone. If the child enters before contention, the negative assertion fails; if it never enters after release, the positive assertion fails. The existing 20-second Vitest timeout, 10-second child lock wait, child kill/close cleanup, and remaining assertions are preserved. No test was skipped or removed.

This is a source-level validation of the negative-control path, not an independently run mutated-helper test. The hosted boot/import failure in the separate PR evidence is unrelated to this fixture-only correction and remains outside this review's verdict.

## Finding

- **Non-blocking reliability / diagnostics:** `childContended` is awaited without racing it against `childDone`. If the child exits or its supervisor fails after printing `WAITING` but before emitting `CONTENDED`, the parent callback stays pending until the 20-second Vitest timeout. The test should still fail and its `finally` cleanup runs, so this does not create a false pass or invalidate the contention oracle, but it obscures the child failure and delays feedback. Consider rejecting the barrier promptly when `childDone` resolves before contention. This behavior is bounded by the unchanged test timeout and resembles the pre-existing un-raced `childWaiting` barrier.

## Verdict

**Approve with one non-blocking finding.** The mutex oracle now has a real contention event barrier and the focused suite passes on the exact candidate. Residual: child failure before contention is reported through the outer test timeout instead of immediately.

## Ordinary B

Original report SHA256: `ce073250fe2d5e3e426d0dd211881b2b95cb5da28fbd1023ec2290383fc35af3`. Public original: https://github.com/ThomasHeinThura/ticketing/pull/655#issuecomment-6110188167. Spawn context: `/root/review_mfa_crossprocess_barrier_b_luna`.

# Ordinary review B — MFA cross-process fixture barrier

- **Reviewed head:** `7513e4bbfc086a3f4240250b7383f9329cfc0a83`
- **Comparison base:** `12c09aaca85250c03223df1ed191275c0d3cdd74`
- **Branch:** `codex/mfa-cross-process-barrier`
- **Role / independence:** Fresh ordinary reviewer context; did not author, direct, or remediate this change.
- **Model:** GPT-6 (platform-reported model/version detail was not exposed; I cannot independently attest a Luna selector).
- **Scope:** Exact one-file test diff, cross-process contention barrier, callback-entry assertions, timing, child failure handling and cleanup, security-scope classification, and focused test execution.

## Evidence

- `git rev-parse HEAD`: exact reviewed head above.
- `git diff --name-status <base>..<head>`: only `M tests/api/mfa-csrf-app-fixture.test.ts`.
- `git diff --check <base>..<head`: clean.
- Exact command: `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/mfa-csrf-app-fixture.test.ts`
- Result: 1 file, 11 tests passed; 3.94s. Raw output: `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/E/review-mfa-crossprocess-b-luna/focused-test.raw.log`.
- No source edits, expanded suite, database, server, image, or additional mutation run.

## Assessment

The parent acquires the fixture lock before spawning the child. The child emits `WAITING` before requesting the lock, then emits `CONTENDED` only through the real `onLockContention` callback. In the helper, that callback is reached from the supervisor's `EEXIST` retry loop for its configured `lockPath`. Since both processes receive the same private path and the parent is holding its lock, this is evidence of the actual contention phase, rather than child startup alone. The parent checks absence of `ENTERED` after that signal and the retained 40 ms interval, releases its lock, then requires the child's callback-entry marker. The pre-fix child-first baseline and the negative entered-marker probe support the ordering diagnosis and the assertion's ability to reject an entered marker.

I reviewed the documented alternate-lock control. It is not a valid negative control for the final test: it manually emits the contention marker after changing the child path, so it bypasses the meaning of the real callback. Its pass after slow supervisor startup is therefore not proof that the final oracle misses a different-path child. With the real callback, a child using an alternate path would not report contention; the parent's barrier would remain unsatisfied and the test would fail by its existing bounded test timeout. The control does expose a diagnostic weakness: the test waits on `childContended` without racing against `childDone`, so early child/supervisor failure is reported only after the 20-second test timeout. The close handler still captures nonzero exit and cleanup kills a surviving child in `finally`; I found no false-pass path from this behavior.

`tests/api/mfa-csrf-app-fixture.test.ts` is outside the exact security-review paths in `docs/04-engineering/ci-cd.md` at this base/head; no Sol security pass is required for this one-file test-only change. The raw hosted #652 failure is on source `d00394cf0faa3dcb14cca5c510e52fc38a63088b` (job `114491325844`) and is a distinct API import/boot failure. This candidate does not clear or explain it.

## Finding

- **Non-blocking reliability / diagnostics:** Race `childContended` against `childDone` so a premature child exit fails promptly with its captured error instead of waiting for the outer Vitest timeout. This does not invalidate the current actual-contention oracle or produce a false pass, so it does not block this focused test correction.

## Verdict

**Approve with one non-blocking finding.** The revised test establishes parent ownership before child launch and waits for actual lock contention before asserting non-entry. The alternate-lock manual-marker control is correctly treated as non-evidence; the real callback path would fail closed on that mismatch. The separate hosted boot timeout remains unresolved.
