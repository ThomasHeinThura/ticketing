# Independent GPT-6 Luna review — P0 bulk integration delta

**Reviewed head:** `f19b3bed6bc2e60d71906423b985fadb089da212`  
**Comparison base:** `64d3ce895e952879d81c444f4276b730781c312a` (historical independently Sol-reviewed candidate)  
**Accepted base:** `8ddb9de8d4d242a0832f6f91e12872300480a905`  
**Independence:** Fresh GPT-6 Luna reviewer context; I did not author, direct, or fix this candidate.  
**Verdict:** **CHANGES REQUESTED** — one blocking diagnostic-evidence defect; no source edits made.

## Scope checked

Reviewed the G11 fixture extraction, recorder boundaries, retry rules, board drag/write completion, trace-to-browser clock alignment and CPU coverage calculation, the non-gating `ci-full` diagnostic ordering, token/contrast occurrence refresh, plus the P0 runtime integration context and published run/status/decision contracts. Compared against `docs/04-engineering/ci-cd.md`, `docs/07-planning/evidence/2026-10-03-g11-7402.md`, `docs/05-operations/configuration-reference.md`, `docs/05-operations/runbook.md`, and the current decision/status entries. The unchanged P0 security behavior remains within the prior Sol review's scope; that prior verdict is not treated as clearance of this candidate's delta.

## Checks and evidence inspected

- Verified `HEAD` is exactly `f19b3bed6bc2e60d71906423b985fadb089da212`; checkout was clean before and after review.
- Read `AGENTS.md`, required agent-workflow and `CLAUDE.md` guidance, status/decision log, CI/CD and G11 evidence contracts.
- Inspected the base-to-head source diff for `.github/workflows/ci-full.yml`, the shared G11 fixture/benchmark extraction, diagnostic clock alignment and sample clipping, and `packages/ui/src/styles/pairs.json`.
- Compared contrast manifest structure against the base with a local script: **418 rows** in both; category and threshold sequences are unchanged. Occurrence/surface bindings are refreshed with the task-details source move and JSX shape changes.
- Inspected private safe G11 outcome and diagnostic coverage fields. The c68 outcome is **18/22**, with four named budget failures; its diagnostic summary reports the initial window's observed uncovered prefix as approximately **195.5 ms**. This is earlier-source evidence and not a current candidate pass.
- Confirmed canonical retry helper still takes a three-sample median and one retry set when median is at/above strict budgets; inclusive metrics retain their separate inclusive retry rule. No budget, retry, fixture-size, or visible-content relaxation found in reviewed G11 changes. Board drag still asserts exactly 100 successful versioned writes, CSRF header/issuer behavior, moved column, persisted post-reload state, and minimum frame samples.
- No tests, build, browser, Docker, PostgreSQL, broad CI, or permission suites were run. These were unnecessary for the identified static evidence-boundary defect and heavy runtime checks were expressly excluded while the dedicated actor runs.

## Findings

### Blocking — CPU profile samples escape the canonical recorder interval and can hide edge coverage gaps

**Path:** `apps/web/e2e/performance.initial-page-diagnostic.ts:474-490` (coverage aggregation at `1322-1340`).

`sanitizeTraceCpuProfile` clips to `[start - uncertaintyMicroseconds, end + uncertaintyMicroseconds]`, and those expanded samples are subsequently used to compute `observedStart`, `observedEnd`, and `unionCoverageMicroseconds` for a window labeled `canonical recorder boundary`. A sample just outside either aligned boundary can therefore be counted as in-window work, and a small edge gap can become a reported zero uncovered prefix/suffix. The calculation also attributes CPU from outside the recorder window to that diagnostic interval. Alignment uncertainty is useful metadata, but expanding the observed sample interval silently converts uncertainty into coverage.

**Reproduction by inspection:** pass a recorder start of `1000`, end of `2000`, uncertainty `150`, and a trace sample `[850, 1050]`. The sanitizer retains `[850, 1050]`, so coverage aggregation reports its observed start before the canonical interval and clamps the uncovered prefix to zero, although the profile's sample evidence only establishes an interval whose start alignment is uncertain. Similar expansion applies after the end. The safe c68 receipt happens to retain a large ~195.5 ms initial uncovered prefix (greater than its ~61 μs reported uncertainty); that receipt does not exercise the smaller-gap case or make the general calculation sound.

**Contract:** the diagnostic must clip trace CPU intervals to the actual canonical recorder span, report uncertainty separately, and keep missing coverage explicit. `Performance.getMetrics` is correctly labeled cumulative whole-window context only; that does not repair the CPU sample-boundary issue.

**Required correction:** keep sample intervals strictly clipped to the aligned recorder boundaries. Carry alignment uncertainty as a separate field (and, if desired, report conservative possible coverage separately without folding it into observed coverage). Add a focused regression that proves out-of-window samples cannot reduce uncovered prefix/suffix or inflate in-window union coverage.

## Nonblocking observations

- The `ci-full` step runs the diagnostic after the canonical G11 step, with `if: always()` and `continue-on-error: true`; it is distinct from and cannot turn a failed G11 gate green. Its artifact upload tolerates missing evidence as expected for a non-gating diagnostic.
- Canonical G11 and local fixture-author proof remain distinct from the optional instrumented diagnostic. c68 is explicitly earlier-source, currently red at 18/22. I found no acceptance assertion that upgrades it to a candidate pass or grants clean-date credit.
- The integration ledger and status remain explicit that current-source image/traffic proof, exact-head required CI, live G11 branch protection, three actual clean dates/router cutover, and the separate Sol phase finalizer are pending. No P0 completion claim or gate waiver was found.
- The historical Sol review's CodeQL scan classifications describe the older exact head only; this review does not treat them as current alert dismissal or current-head security clearance.

## Review limits

No runtime test suites or external CI receipts were rerun. This is ordinary reviewer C for the frozen bulk panel, not the required GPT-6 Sol security pass or phase finalizer. The candidate's hosted G11 status and runtime/image proof remain owned by their exact-source receipts and required checks.
