# PR #558 — hosted cold recording security and privacy review

**Reviewed head:** `951cc9a9e8c2fcd7b8ed2da14d2c145acb8f2921`
**Reviewed head:** `965dd9e51993195219be525160a1c2542f2d5a17`

## Scope and chronology

PR #558 adds an opt-in, single-journey hosted diagnostic and a shared route-paint recorder. The recorder is also used by the canonical G11 test. This is security-sensitive because the workflow can collect CDP timeline, CPU, and network-initiator data and upload a derived report. The diagnostic does not alter authorization, product routes, runtime UI, dependencies, canonical budgets, retry policy, fixture, or the 22-case acceptance suite.

The source review sequence is bound to the exact heads above:

- **Earlier ordinary panel, 38dc:** Three fresh independent GPT-6 Luna contexts reviewed `38dc5a00f2914d0a729adc0bc127c8141ec6ca73`. Reviews [5383785466](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5383785466), [5383922353](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5383922353), and [5383942061](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5383942061) all blocked on the same clipped-ancestor false-visible class. This is recorded as historical source-panel evidence, not clearance for later heads.
- **Structural visibility repair:** The next independent Luna review at `3ed373861f0df6079b6965a4e59c93bb9c63f16c` found a narrower fractional clip-edge false positive in that same class. The author changed altitude to a conservative inward-bound invariant rather than adding a fixture-specific exception. The independent report is `/private/tmp/pr558-3ed3-luna-structural-review.md`.
- **Full privacy review at 951:** Fresh independent GPT-6 Sol full review [5384555138](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5384555138) cleared privacy/security and the conservative first-visible proxy on exact head `951cc9a9e8c2fcd7b8ed2da14d2c145acb8f2921`. It did **not** clear candidate readiness: the Linux physical-RTL browser regression failed because the fixture's second relative `left` assignment used an incorrect offset, and required checks were not all green. The review was source-level privacy/security clearance, not a hosted diagnostic permission or G11 acceptance.
- **Current ordinary delta review at 965:** Fresh independent GPT-6 Luna review [5384746631](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5384746631) reviewed only the `951cc9a9` → `965dd9e5` fixture delta and cleared it. It confirmed the negative gutter assertion remained and the corrected target rectangle exceeded the conservative safe region by more than 2 CSS px on each axis before the recorder wait.
- **Current post-ordinary Sol review at 965:** Sol review [5384763417](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5384763417) was made after reading that ordinary review and independently confirmed privacy/security on exact head `965dd9e51993195219be525160a1c2542f2d5a17`. The reviewer was fresh and did not author, direct, or remediate the candidate or ordinary review. Its verdict is **CLEAR for source privacy/security on this exact head**.

Sol review [5384743551](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5384743551) on the same source was submitted before the bounded ordinary review. The reviewer explicitly identified it as premature. It is retained as historical review evidence only and is **not** used as the sequenced security-review gate. The post-ordinary review [5384763417](https://github.com/ThomasHeinThura/ticketing/pull/558#pullrequestreview-5384763417) is the current security clearance.

These are independent model-review contexts recorded as GitHub `COMMENTED` reviews, not GitHub approving reviews or waivers. The current post-ordinary Sol review is additive to the earlier full-path review; it does not rely on prior-head clearance to cover the changed RTL fixture.

## Security and privacy controls reviewed

The full Sol review on 951 inspected the recorder, report builder/final validator, exact-source/build binding, and opt-in workflow; the post-ordinary Sol review checked the 965 delta and reconfirmed the unchanged controls. The bounded diagnostic:

- runs only by explicit workflow dispatch for the exact selected candidate SHA; verifies the checked-out head and source binding;
- captures one fixed WLP-1 work-list-to-detail journey through the unchanged H1 LCP, 500 actual rows, click, shared two-RAF route marker, and existing full-detail/URL checks;
- keeps raw CDP URLs, request bodies, headers, cookies, DOM content, trace packets, profiles, and arbitrary exception strings out of the report; raw recording state is temporary and cleanup runs on both success and failure;
- writes only a size-bounded, closed-schema derived JSON report after the final privacy assertion; route labels use fixed route templates, and resource/initiator asset labels must belong to the current verified Vite manifest and `dist` inventory; unknown values become `unrecognized`;
- bounds event, resource, sample, node, segment, and report sizes; validates numeric values and clock uncertainty; keeps request/idle overlap explicitly non-causal and separate from exclusive main-thread phases;
- uploads only the sanitized report after successful validation, with the workflow's one-day retention. Ordinary CI skips this opt-in capture job.

The shared recorder produces a conservative positive rectangular intersection with the viewport and each supported ancestor clip at both existing probes. It fails closed for unsupported geometry, including ambiguous viewport origin and CSS zoom other than 1. This is a potentially paintable-region proxy, not pixel-level paint, unobscured-content, legibility, or exact-paint-time proof. The corrected physical-RTL regression first asserts the target is wholly within the measured left scrollbar gutter and unmarked; after the movement it asserts a conservative safe overlap greater than 2 CSS px on both axes before awaiting the shared recorder.

The 965 delta changes only `apps/web/e2e/route-paint-visibility.spec.ts`. It does not change the shared helper, builder, validator, workflow, canonical benchmark, fixtures, selectors, action sequence, report schema, budgets, throttling, retry policy, or product runtime. Shared recorder SHA-256 remains `69045270b8cd21a769d6e99ea95b14ec6d9f6887ee3a2194848f8d720fb0fbf9`.

## Evidence and provenance

The author ran the old spec red and corrected spec green in an official Playwright 1.63.0 Linux/amd64 container: the old physical-RTL branch timed out at the second marker wait; the fixed branch passed. The browser measured a 15 CSS px left gutter (`clientLeft=15`, `clientWidth=105`, `offsetWidth=120`); after reposition, the target had a 12×19 CSS px conservative safe intersection. This Docker Linux/amd64 run was emulated on an arm64 Mac host and is supporting author evidence, not the hosted runner result.

The exact-head hosted Ubuntu `e2e - protected-route redirect` job succeeded on 965 and normally discovers `route-paint-visibility.spec.ts` (job [110552619079](https://github.com/ThomasHeinThura/ticketing/actions/runs/36916632049/job/110552619079)). This is the required hosted browser regression evidence for the fixture; it is not a hosted cold diagnostic capture.

Focused local checks on 965 passed: route-paint visibility Playwright **11/11**, report-validator **9/9**, web typecheck, focused Biome, and `git diff --check`. The local macOS Chromium run uses overlay scrollbars and does not itself exercise the physical left-gutter branch. No new production build was needed for the 965 spec-only delta.

The manually reported JavaScript/source-map aggregates in the early 951 author note used relative `assets/...` labels. The diagnostic runner uses basename-only aggregate rows. The correct runner-algorithm aggregates, independently recomputed from the unchanged 1,248-file distribution, are JavaScript **621 files** `e75d71af1e9989aea3a0774f797482807c7a530bd35fa128a37403d0e7c6d865` and source maps **603 files** `0be2ae48b34cf30e6abeac16e23f4225c8ed9bebd2193e812940a1d504171439`. The index, manifest, full-dist aggregates, and shared-helper hash match the prior build evidence. These are source/build metadata, not hosted capture evidence; any actual report must carry the runner-generated exact binding.

Full review reports: `/private/tmp/pr558-951c-sol-security-review.md`, `/private/tmp/pr558-965d-sol-security-review.md`, `/private/tmp/pr558-965d-sol-post-ordinary-confirmation.md`, and `/private/tmp/pr558-965d-luna-fixture-review.md`. The 965 source head and the report hashes are also recorded in `/private/tmp/pr558-951cc9a9-author-evidence.md`.

## Remaining gates and limits

At the current Sol review snapshot, the hosted Ubuntu E2E regression was green, the required PR-template/security-review check was red while the committed note and corrected PR body were absent, G11 performance was still pending, and optional GitGuardian was red. PostgreSQL integration was still in progress at the review snapshot; the later status read showed it successful. The opt-in hosted cold diagnostic was skipped. Root owns the PR body and any diagnostic dispatch.

This note records source privacy/security clearance only. It does not claim current all-green required CI, an actual hosted diagnostic/report, authenticated product-screen browser verification, G11 budget acceptance, a P0 completion, or phase-finalizer completion. `BROWSER VERIFICATION: BLOCKED — authenticated product screens were not opened; no product UI changed.` P0 remains open. No raw or derived diagnostic capture was produced or published by either review.
