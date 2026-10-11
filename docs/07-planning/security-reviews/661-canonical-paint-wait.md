# PR #661 — authentic canonical paint-wait reviews

**Reviewed head:** `d302f3236e822de2bafdd94d22d60c72e577b228`

These reports are preserved unedited. Earlier BLOCKs, closures and the prior premature-paint runtime failure remain source-bound and preserved. This additive review note changes no code and waives no gate.

## Original report: 661-paint-wait-current-independent-ordinary-luna.md

SHA256: `622f18f88acb92d44040c147dd8c3deb92a974505a0d357bac8dfd4d0f86be64`

# PR #661 canonical paint-wait delta — independent ordinary review

**Model:** GPT-6 Luna (exact serving build is not exposed in this context)
**Role:** Fresh independent ordinary delta reviewer
**Independence:** This context did not author, direct, or remediate the candidate. No source edits or subagents were used.
**Reviewed head:** `d302f3236e822de2bafdd94d22d60c72e577b228`
**Comparison base:** accepted main `40f05826109fec0f8fc6fcebfe142593fa1d205c`
**Prior reviewed head:** `2433c979b595557f03352fceef65137449c1b2cf`
**Verdict:** **CLEAR — no blocking ordinary finding in the paint-wait delta.**

## Scope and evidence inspected

Read the repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the current status and decision records, and the CI/security review path and tier rules. Read the authentic prior Sol security report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/661-inclusive-diagnostic-independent-security-sol.md` and the author handoff at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/661-canonical-paint-wait-author-luna.md`. I treated those as evidence and rechecked source and Git ancestry directly.

The merge `64924e2a6281d34e223bdbf9fef678e1277ce1a0` has parents `2433c979b595557f03352fceef65137449c1b2cf` and accepted main `40f05826109fec0f8fc6fcebfe142593fa1d205c`; the candidate `d302f3236e822de2bafdd94d22d60c72e577b228` has sole parent `64924e2a6281d34e223bdbf9fef678e1277ce1a0`. I inspected the intervening composition and author commit per-parent. The only author-commit delta is 20 added lines in `apps/web/e2e/performance.initial-page-diagnostic.ts`; the accepted-main-to-head file list is the previously reviewed helper, diagnostic, focused helper test, and preserved security record.

The addition waits for `__g11Metrics.statePaint > 0` and `assignmentPaint > 0` before the diagnostic reads those recorder values. Each wait uses the same 15,000 ms timeout and signal semantics as the canonical state and assignment collectors in `performance.bench.ts`. The existing evaluation still rejects missing/nonpositive start or end values. This directly addresses the recorded failure where visible text was ready while `statePaint` was still zero. It does not synthesize a measurement or alter the measured interval.

I compared accepted main to this head for the canonical benchmark, G11 fixture, last-item paint recorder, calibration and budget libraries; `git diff --quiet` confirmed no changes in those inputs. Inspection of the patch confirms no changes to measurement logic beyond waiting before reading, throttle, card fixture, budgets, or canonical eight-input workload. I make no profile-runtime or performance-pass claim.

## Verification performed

- `git diff --check 2433c979b595557f03352fceef65137449c1b2cf..HEAD` — passed.
- `pnpm exec biome check apps/web/e2e/performance.initial-page-diagnostic.ts` — passed, 1 file.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/test/aggregate-cpu-profile.test.ts` — passed, 1 file / 5 tests / 0 skipped. These cover the previously reviewed profile helper, not browser execution of the new waits.
- Source-level comparison of the two new waits against canonical collectors — confirmed.

No browser replay, database, Docker, broad build/typecheck, full performance suite, or hosted CI was run. A focused helper test cannot establish paint timing in Chromium; the separately authorized controlled browser replay remains runtime evidence for the conductor to obtain. The checkout was clean after inspection.

This verdict covers the ordinary review of the exact paint-wait delta only. The changed file is in the security-review path; the required fresh full GPT-6 Sol security pass remains a separate gate. This report does not claim runtime acceptance, G11 success, merge readiness, or stage completion.

## Original report: 661-paint-wait-current-independent-security-sol.md

SHA256: `340b64284bdc879367fecb0f6ecf0167084f49fa9a5099f800fac4bb0274d748`

# PR #661 paint-wait candidate — independent full security review

**Model:** GPT-6 Sol (assigned Sol-tier context; exact serving build is not exposed)
**Role:** Fresh independent full security reviewer after the ordinary CLEAR
**Independence:** This context did not author, direct, or remediate the candidate. It made no source edits and used no subagents.
**Reviewed head:** `d302f3236e822de2bafdd94d22d60c72e577b228`
**Accepted comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`
**Previous branch head:** `2433c979b595557f03352fceef65137449c1b2cf`
**Verdict:** **PASS — no blocking security finding at this exact head.** This is a full focused pass over PR #661's diagnostic security semantics and accepted-base delta, not a broad re-audit of accepted main or runtime acceptance.

## Scope and evidence

Read `AGENTS.md`, the active mission, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and the authoritative `docs/04-engineering/ci-cd.md` security path and gate rules. Read the current independent ordinary CLEAR, the prior Sol report at `c9449e3e8c837eb0cd9da565cc483f65fe220970`, authentic original A/B ordinary reports including B's BLOCK at `af23fdf38568408cc3661b850f46d36ad3947b41`, the recursive-bucket A delta and B closure reports, and the candidate's preserved security note. The old BLOCK remains an authentic verdict on its old head; its precise recursive-coordinate defect was corrected and independently closed at `c9449e3e`.

Inspected Git ancestry and both sides of merge `64924e2a6281d34e223bdbf9fef678e1277ce1a0`: its parents are `2433c979b595557f03352fceef65137449c1b2cf` and accepted main `40f05826109fec0f8fc6fcebfe142593fa1d205c`. The merge's first-parent diff brings accepted-main changes; its second-parent diff retains only the diagnostic candidate files and review note. The sole following commit, `d302f3236e822de2bafdd94d22d60c72e577b228`, adds 20 lines to `apps/web/e2e/performance.initial-page-diagnostic.ts`. I inspected the accepted-base-to-head diff, resulting collector, V8 `ProfileChunk` parser, clipping, sanitizer, aggregation, output construction and assertions, plus the focused tests. The accepted-base delta contains only the helper, diagnostic collector, focused test, and `docs/07-planning/security-reviews/661-inclusive-diagnostic.md`; no new API, auth, permission, route, dependency, runtime product, or CI file is in that delta.

`apps/web/e2e/**` is an explicit security-review path. The added waits observe `__g11Metrics.statePaint > 0` and `assignmentPaint > 0`, with the canonical 15-second timeout, before the diagnostic reads the same recorder fields. The canonical benchmark already waits for these exact positive fields and timeout. The collector still rejects missing or nonpositive starts and paints and forms the same recorder-based intervals. Waiting for completion does not substitute a value, widen a threshold, skip a failure, or change the canonical benchmark. The diagnostic's own nonempty app-frame assertion remains; the CI diagnostic step remains `continue-on-error: true`, while the required `pnpm test:perf` step is unchanged. Direct accepted-base path comparison found no changes to the benchmark, G11 fixture/card count, recorder, throttle/calibration/budget code or tests, CI workflow, or G11 UX gate.

The full profile path keeps raw `ProfileChunk` node data in memory, clips sample intervals to the aligned recorder span, and serializes sanitized nodes and compiled-coordinate buckets. The sanitizer retains finite parent IDs, child IDs, capped function names, same-origin `/assets/` basenames (or `runtime`/`non-asset`), and compiled coordinates. It does not copy call-frame URLs, query strings, fragments, trace arguments, request bodies, or authentication values into profile output. The earlier inclusive fix traverses only present node IDs and deduplicates each compiled-coordinate bucket per sample, including recursive frames. The new waits neither touch this path nor change the existing JSON attachment or `0600` file mode. I found no new profile or request-data exposure in the accepted-base candidate delta.

The diagnostic describes sampled CPU attribution and coverage/clock uncertainty. It still cannot prove wall-time causality or resolve individual source functions from source maps. Its `cpuFrameAttribution` wording refers only to child links although the helper also follows parent IDs; this is an inherited non-blocking documentation imprecision, not a new security or gate change. No G11 root cause or runtime success is inferred from this source review.

## Verification and limits

- Executed `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/test/aggregate-cpu-profile.test.ts` at the exact head: **1 file, 5 tests passed, 0 skipped**. These are pure helper tests; they do not exercise Chromium paint timing.
- Executed `git diff --check 64924e2a6281d34e223bdbf9fef678e1277ce1a0..d302f3236e822de2bafdd94d22d60c72e577b228`: passed. The full accepted-base diff check reports an extra blank line at EOF in the inherited preserved security note (`docs/07-planning/security-reviews/661-inclusive-diagnostic.md:189`); this is non-security whitespace and was not introduced by the paint-wait commit.
- Confirmed the worktree was clean and the direct accepted-base diff over canonical benchmark, fixture, recorder, CI workflow, budget/calibration and dependency paths was empty.

I did not run a browser/profile replay, database, Docker, heavy build, full performance suite, or hosted CI. The ordinary reviewer separately recorded a clean Biome check and the same 5/5 helper result; this report's test claim above is from my own run. The controlled diagnostic replay remains needed to establish that the added waits work in Chromium and to inspect actual sampled output. This verdict does not clear G11, issue #637, PR merge readiness, or a stage gate.
