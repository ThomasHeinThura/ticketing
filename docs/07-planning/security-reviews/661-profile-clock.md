# PR #661 — profile-start clock correction reviews

**Reviewed head:** `e28ce9176a749a77b430fe0f2468db8316b86874`

The original independent diagnosis and three exact-source closure reports are reproduced unchanged. Original raw captures and unreliable derivatives remain preserved; no cause, waiver or overall acceptance is supplied.

## Original report: 661-profile-chunk-timing-discussion-diagnosis-luna.md

SHA256: `54c1c92a725a7dd8dcad170880c600100d5f70ffa0d0ad7159c38b3d9be366ea`

# #661 ProfileChunk timing discussion — bounded diagnosis

**Disposition: CONFIRMED.** The open P1 identifies a real timing defect in the exact #661 source. It blocks reliance on #661's clipped CPU attribution outputs, but does not change application behavior or the G11 pass/fail result. This is a diagnosis and bounded fix recommendation, not a review approval or a claim that #661's thread is closed.

- **Exact #661 head inspected:** `a410b8bca9bd908a2afb62aa6b96a6a46db90772`
- **Exact tree:** `ad00cadb59bc3b8bb3a621f4e2f440296a26f20e`
- **Parent:** `7839a4a1455d89d338e7452ddfe77ee49cd76090`
- **Finding:** [#661 review discussion 4242737031](https://github.com/ThomasHeinThura/ticketing/pull/661#discussion_r4242737031), originally posted against `65cc2af53690906c4f9144c9de0743dc536f7c23`.
- **Reviewer context/model:** `/root/review661_accepted_expiry_composition_luna`; assigned GPT-6 Luna by the dispatching session. The serving-variant/selector is not separately exposed here. I did not author, direct, or remediate the #661 diagnostic code. I previously reviewed bounded #661/#650 composition records in this context; this assignment was limited to the independent timing diagnosis.
- **Comparison:** exact current source at `a410b8b`; timing collector was also checked against its unchanged profile implementation in `22253f5cc2e68561437512bf2c533fe3ddd2e74e`.

## Producer semantics and current code

The current #661 collector listens for `ProfileChunk` at `apps/web/e2e/performance.initial-page-diagnostic.ts:764–802`; it does not retain the initial `Profile` event timestamp. For each chunk independently, it sets `sampleTime = event.ts - sum(chunk.timeDeltas)` and advances only through that chunk's deltas. Later chunks therefore restart their timeline at their own trace-event emission timestamp.

V8's producer source contradicts that reconstruction. In the pinned V8 source, the initial `Profile` event's trace `ts` is recorded nearly at profile start. Each `ProfileChunk` computes its `timeDeltas` from the previous sample timestamp, with the first sample measured from the profile start for the first chunk and subsequent chunks continuing from the preceding sample across chunk boundaries. Chunks are streamed when the sample buffer reaches its flush threshold (100 samples) or enough nodes are pending, and the `ProfileChunk` trace event is emitted after that serialization. Its own `ts` is thus a chunk-emission time, not an independent anchor for that chunk's first sample. V8 explicitly says to add the cumulative deltas to the initial `Profile` event `ts`; it also documents a suspend/resume caveat for cross-clock conversion.

The Chrome DevTools Protocol defines the first profile delta relative to profile start. Chromium DevTools likewise treats `Profile` as the head containing start metadata, matches chunks to it by process/profile ID, then appends the chunks' ordered samples and deltas before constructing the CPU profile. These primary references support the discussion's stated semantics:

- [Pinned V8 `profile-generator.cc`](https://chromium.googlesource.com/v8/v8/+/cb5dfb7d734c416a7e6536c853f9be9f3eac587e/src/profiler/profile-generator.cc#L579) — Profile event creation, chunk flush threshold, and cumulative deltas relative to the initial Profile trace timestamp.
- [Chrome DevTools Protocol `Profiler.Profile`](https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile) — profile fields and first-delta semantics.
- [Pinned Chromium DevTools `SamplesHandler.ts`](https://chromium.googlesource.com/devtools/devtools-frontend/+/44e3006b8549ceeffe023b3578930a8440156f52/front_end/models/trace/handlers/SamplesHandler.ts#L20) — profile-head/chunk pairing and concatenation.

## Deterministic reproduction

A small two-chunk profile demonstrates boundary misclipping without a browser. Let the initial `Profile.ts` be `1,000,000 µs`; chunk 1 has deltas `[100,100]` and emits at `1,000,200`; chunk 2 has deltas `[100,100]` but is flushed at `1,001,000`. The correct global intervals are `[1,000,000,1,000,100]`, `[1,000,100,1,000,200]`, `[1,000,200,1,000,300]`, `[1,000,300,1,000,400]`. The current chunk-local calculation gives the final two intervals `[1,000,800,1,000,900]` and `[1,000,900,1,001,000]`. For paint interval `[1,000,350,1,000,450]`, correct clipping retains 50 µs from the fourth sample; current clipping retains no sample.

This reproduces the P1 mechanism: chunk flush delay shifts samples across the canonical window boundary. The sign and magnitude depend on flush timing; the defect is not a uniform constant offset that the separate affine page-clock alignment can repair.

## Retained v7d artifacts and affected outputs

I read only compact manifests/diagnosis and parsed the six persisted window files for structural summaries; I did not print or inspect multi-megabyte profile payloads. The v7d acquisition binds its captures to source `633273f9130769be60c2e93aee1f5d73642b2bd9`. Each persisted window contains a single merged `traceCpuProfiles[0]` with sanitized `nodes` and `samples`, but no profile ID/source/PID/TID, no initial `Profile.ts`, and no `ProfileChunk` boundaries or per-chunk event timestamps. The inventory records these sample counts:

| Window | Persisted samples | Canonical interval |
| --- | ---: | --- |
| Initial work-list navigation to LCP | 5,819 | Yes |
| Task-state click-to-paint | 1,363 | Yes |
| Task-assignment click-to-paint | 1,329 | Yes |
| Board navigation to 200 cards | 2,397 | Yes |
| Board open/close editor | 13,564 | No; full-window context |

All five profiles necessarily span multiple sample chunks: V8 flushes at no more than 100 new samples at a time, and even the smallest retained profile has 1,329 samples. The producer can flush more often when nodes accumulate.

For canonical windows 1–4, the affected timing-dependent outputs are the clipped `traceCpuProfiles[].samples`, `cpuSampleCoverage` bounds/gaps/union, and `topInclusiveCpuFrames` sample membership and clipped durations. Window 5 has no canonical clipping boundary, so its stored sample start timestamps are wrong, while its all-samples frame duration/count aggregation is not changed by timestamp placement alone.

The v7d diagnostic log says all five captures completed, then the diagnostic failed during task-state clock alignment at `1005.9974087050558`; it did not emit the final `profileWindows` summary. The separate offline v7d board diagnosis did clip and analyze the already merged board-window samples. Its timing-dependent figures (2,021 clipped samples, 608 mapped / 1,413 unmapped, clipped sample-duration/union totals, and frame attribution) must be treated as unreliable and superseded pending correctly anchored input. Board boundary marks, the 200-card observation, source/build and map hashes, and the original failed alignment outcome are independent evidence and remain intact. The private v7d files do not retain enough Profile/Chunk metadata to recompute corrected timestamps, so the previous derivative cannot be repaired from those files alone.

The v7d diagnosis's own conclusion that it proves no narrow product cause remains warranted; its detailed sampled CPU attribution should not be used to argue for or against a particular app hot path. This finding does not clear the failed alignment, hosted G11's board-budget failure, or issue #637.

## Discussion state and prior fix evidence

A read-only GraphQL query found discussion `4242737031` still **unresolved** and **outdated**, with no replies. No exact-head #661 closure is present.

There is prior independent evidence for the same structural correction pattern elsewhere: PR #587's `f8414b98de6aa455333005ed1e2b751821972576` anchors streamed samples at profile start and carries a deterministic accumulator test; the subsequent independent GPT-6 Sol report at `e3ac04596499bd59772403bb4e0534b40dc1ac88` explicitly clears the clock blocker for that bounded diagnostic path. PR #587 was later closed unmerged, and its report is not a disposition of #661's thread or approval of #661's separate collector. It is useful as a reviewed implementation pattern, not transferable clearance. The #661 P1 remains open until its own exact source incorporates and verifies the correction.

## Supported bounded fix

For #661's collector, retain the initial V8 `Profile` trace timestamp per stable profile identity, then use a per-profile sample cursor and accumulate each chunk's ordered `timeDeltas` across every chunk before clipping. Keep node-only and metadata-only chunks from resetting the sample cursor; append sample-bearing chunks in trace delivery order; validate finite nonnegative deltas and the presence of an anchor; omit a profile with missing/malformed anchor state rather than falling back to delayed chunk timestamps. Preserve the existing clipping, aggregation, privacy and output limits. Add deterministic tests for delayed multi-chunk flushes, a sample crossing each recorder boundary, chunk-with-no-samples interleaving, profile identity/TID behavior, and missing-anchor omission. The prior #587 implementation can guide the mechanism, but the #661-specific change still needs review at its actual exact head.

## Commands and checks

- `git show a410b8b...:apps/web/e2e/performance.initial-page-diagnostic.ts` and exact commit/tree/parent inspection — confirmed current chunk-local reconstruction and absence of a `Profile` anchor handler.
- `gh api graphql` review-thread query — P1 remains unresolved/outdated with no replies.
- Read-only Python JSON summary over v7d `window-01..05.json` — recorded merged sample counts and absence of chunk identity/timestamps; no profile payloads printed.
- Deterministic Python two-chunk interval/clipping calculation above — reproduced a correct 50 µs overlap versus zero with chunk-local anchoring.
- Read compact `acquisition-exit.json`, `raw-capture-inventory.json`, `diagnostic.log`, and `g11-v7d-board-source-diagnosis.md` — confirmed source binding, retained capture outcome, and the limits of offline attribution.
- No product files changed; no browser, new capture, build, Docker, database, or performance test ran.

## Original report: 661-profile-clock-independent-a-luna.md

SHA256: `f615a6715fc9d44ad491468864db0a8707390d23374ee4751ad5187d08bf30bd`

# PR #661 profile-clock ordinary review A

- **Verdict:** CLEAR for the bounded timing correction; the previously reported P1 is fixed in this exact source.
- **Candidate:** `e28ce9176a749a77b430fe0f2468db8316b86874`
- **Tree:** `fdb1c9113653bbe75479f75d4cb7c260f62353e9`
- **Comparison base:** `a410b8bca9bd908a2afb62aa6b96a6a46db90772`
- **Worktree:** `/Users/heinthura/.codex/worktrees/603-current-role-query-ownership/Ticketing.v2`
- **Model provenance:** assigned as GPT-6 Luna by the dispatching session; the serving variant is not separately exposed in this context. Fresh reviewer context, independent of the author/fixer.
- **Review scope:** full three-file candidate delta: `apps/web/e2e/performance.initial-page-diagnostic.ts`, `apps/web/src/lib/performance-trace-profile-clock.ts`, and its test. Traced CDP event parsing through profile aggregation, clipping, sanitization, and persisted output. Read repository agent workflow, model/review policy, and authoritative security path list.

## Findings

The P1 in [discussion 4242737031](https://github.com/ThomasHeinThura/ticketing/pull/661#discussion_r4242737031) is resolved in code: the collector records `Profile.ts` keyed by pid/tid/source/id; each later chunk's ordered `timeDeltas` advances a persistent cursor from that anchor. It no longer uses delayed chunk-emission timestamps to reconstruct sample times. That is the V8 producer's stated clock rule: `Profile` emits the start event; chunks compute deltas cumulatively from the preceding sample, with the first delta from profile start. The V8 producer also documents the suspend/resume limitation for converting across clock domains. See pinned V8 `profile-generator.cc`, especially lines 590–598, 655–660, and 718–737: https://chromium.googlesource.com/v8/v8/+/cb5dfb7d734c416a7e6536c853f9be9f3eac587e/src/profiler/profile-generator.cc

Identity handling is consistent with the V8 event emission: both `Profile` and `ProfileChunk` use the same trace event ID and pid/tid; V8's event payload does not add a `source`, so the collector's same `unknown` fallback is used on both. Chunk delivery order is preserved by the synchronous loop over `Tracing.dataCollected.value`. Node-only chunks do not advance the cursor; samples with no valid anchor or malformed/mismatched deltas invalidate and remove that profile, with no chunk-timestamp fallback. A bad profile therefore cannot contribute incorrectly timed samples. The existing exact-diagnostic assertions require all five profile windows and nonempty app frames, so total omission is surfaced as a failed diagnostic rather than silently treated as useful evidence.

Timing semantics at clipping and persistence are correct: the corrected absolute intervals flow into the existing recorder-boundary clipping and coverage/frame summaries; unsliced whole-window sample timestamps also use the corrected cursor. Raw persistence still records sanitized samples only. No authority, gate behavior, or application behavior changes; the touched E2E path is in the security-scope list, so this ordinary review does not replace the required lightweight GPT-6 Sol confirmation.

No blocking or non-blocking code findings. The prior P1 should be marked fixed by this exact candidate's independent review; this does not by itself resolve the GitHub discussion thread or establish overall PR/merge readiness.

## Verification

- `pnpm --filter @taskdesk/web exec vitest run src/lib/performance-trace-profile-clock.test.ts` — **1 file, 5 tests passed**.
- The deterministic regression verifies delayed multi-chunk accumulation and 50µs boundary clipping; other cases verify nodes-only chunks, distinct identities, missing/malformed anchors, and malformed-delta cursor preservation.
- No browser run or new capture was performed. No product files changed. No Docker, database, or full-suite check was run.

## Limits

Focused helper tests are not a live CDP/browser reproduction. The actual production listener and downstream use were inspected directly; the diagnostic E2E's all-windows/nonempty-frames assertions were not executed in this review.

## Original report: 661-profile-clock-independent-b-luna.md

SHA256: `c4604ab3b877186c35725e33e9f5ab19705a39a0e872a31a465e59d49443b2e7`

# #661 profile clock — independent ordinary review B

- **Verdict:** CLEAR for the bounded streamed-profile timing correction; the original P1 mechanism is fixed at this head. This is not an overall merge or issue #637 clearance.
- **Reviewed head:** `e28ce9176a749a77b430fe0f2468db8316b86874`
- **Tree:** `fdb1c9113653bbe75479f75d4cb7c260f62353e9`
- **Comparison base / parent:** `a410b8bca9bd908a2afb62aa6b96a6a46db90772`
- **Independence and model:** fresh GPT-6 Luna ordinary-review context assigned by the orchestrator; did not author or remediate this candidate and did not rely on ordinary reviewer A's verdict.
- **Changed paths:** `apps/web/e2e/performance.initial-page-diagnostic.ts`, `apps/web/src/lib/performance-trace-profile-clock.ts`, and its focused test.

## Review

The collector now retains `Profile` event timestamps keyed by process, thread, source, and profile ID. Each `ProfileChunk` uses the corresponding cursor and advances it by ordered `timeDeltas`; its own emission timestamp is not used to place samples. A sample-bearing chunk with no anchor or invalid arrays marks that profile identity invalid and removes accumulated samples, so the old flush-time fallback cannot silently reappear. Metadata-only and nodes-only chunks produce no samples and leave the cursor unchanged. Invalid/non-finite anchors and negative/non-finite deltas are rejected. Existing downstream clipping, sanitized aggregation/output, profile limits, benchmark, budget, calibration and workload files are untouched in this three-path delta.

The five focused tests are substantive: they assert exact cross-chunk sample timestamps and recorder-window clipping, empty-chunk cursor preservation, identity separation, missing/invalid anchor omission, and malformed-delta rejection without cursor advancement. The helper is directly imported and called by the live `Tracing.dataCollected` Profile/ProfileChunk branch; it is not a disconnected unit-only implementation. The P1 discussion diagnosis's producer claim is consistent with pinned V8 source and the Chrome DevTools Protocol: chunk deltas are accumulated from the initial profile time, while chunk emission is delayed. The earlier diagnosis also correctly identified why retained v7d merged samples cannot be repaired without chunk metadata.

## Checks and limits

- `pnpm --filter @taskdesk/web exec vitest run src/lib/performance-trace-profile-clock.test.ts` — **1 file passed, 5 tests passed** (643 ms).
- Inspected the exact parent-to-head diff, collector call path, helper, focused assertions, and the supplied prior primary-source diagnosis.
- No browser capture, full suite, build, Docker, database, performance workload, benchmark/budget/calibration change, or GitHub write was performed. Thus this review confirms the deterministic correction and its production wiring, not runtime browser capture behavior or any G11 result.

## P1 disposition

**Resolved at `e28ce9176a749a77b430fe0f2468db8316b86874` for the collector timing defect.** The profile start anchor plus cumulative per-profile cursor removes chunk-flush anchoring and preserves correct clipping coordinates. The prior captured v7d derivative remains unreliable because its persisted merged samples lack the initial Profile timestamp and chunk boundaries. No claim is made that the historical diagnosis is recomputed, that #637 is clear, or that #661 is merge-ready overall.

## Original report: 661-profile-clock-security-sol.md

SHA256: `86a6ca70e580f2c1e30fcbc512802a1ee3a697dae1aaae1ab56630ec02249cfe`

# PR #661 profile clock — independent security confirmation

**Verdict:** CLEAR for the bounded, observational profile-clock correction. No blocking or non-blocking security finding in this delta. The original P1 chunk-flush anchoring defect is resolved in code at this exact head; this is neither an overall PR/merge verdict nor a new G11 or issue #637 diagnostic conclusion.

- **Reviewed head:** `e28ce9176a749a77b430fe0f2468db8316b86874`
- **Tree:** `fdb1c9113653bbe75479f75d4cb7c260f62353e9`
- **Comparison base / parent:** `a410b8bca9bd908a2afb62aa6b96a6a46db90772`
- **Accepted main reference supplied for this review:** `00c6` (not a substitute for the exact comparison base).
- **Model and role:** GPT-6 Sol security-tier context, as dispatched by the conductor; the serving variant is not separately exposed to this context. Fresh reviewer context. I did not author, direct or remediate this candidate, and reviewed after the two independent ordinary CLEAR reports.
- **Changed paths reviewed:** `apps/web/e2e/performance.initial-page-diagnostic.ts`, `apps/web/src/lib/performance-trace-profile-clock.ts`, `apps/web/src/lib/performance-trace-profile-clock.test.ts`.

## Scope and disposition

`apps/web/e2e/**` triggers mandatory security review under `docs/04-engineering/ci-cd.md`. The three-file delta changes only diagnostic CPU sample timestamp attribution and its explanatory output/test. It changes no route, authorization, tenancy, secret handling, required gate selection or G11 benchmark threshold, budget, calibration, fixture, or workload. Lightweight confirmation is the applicable tier; the two ordinary reviews exceed the one required for that tier.

The listener handles `Profile` and `ProfileChunk` within one ordered `Tracing.dataCollected` loop. It keys each clock by process, thread, source and profile ID, anchors once to the initial `Profile.ts`, and accumulates ordered `timeDeltas` across chunks. A delayed chunk's emission timestamp no longer anchors its samples. The pinned V8 producer confirms that the initial `Profile` trace timestamp is the base for `timeDeltas`, which continue from the preceding sample across chunks: https://chromium.googlesource.com/v8/v8/+/cb5dfb7d734c416a7e6536c853f9be9f3eac587e/src/profiler/profile-generator.cc (lines 590–598 and 718–753). Missing/non-finite/conflicting anchors or sample-bearing chunks with malformed IDs/deltas invalidate and remove that profile; there is no flush-time fallback. Empty and node-only chunks leave the cursor in place. The same `source` fallback is applied to both event kinds; raw profile identity is used only as an in-memory key and is not persisted.

Timed samples flow to existing recorder-window clipping, coverage and sanitized frame aggregation. The raw checkpoint is made from the same timed profile collection, after node URL sanitization, into private write-once JSON. No raw trace args, profile key/source/id, raw URL, network payload, DOM or auth value was added to the output. The pre-existing network summary remains route-template based and bounded. Final diagnostic assertions still require five windows, nonempty app frames, and untruncated network observations; this delta does not alter them. Invalid or absent samples can cause diagnostic failure instead of manufacturing attribution.

**P1 disposition:** resolved for the collector timing mechanism at `e28ce9176a749a77b430fe0f2468db8316b86874`. The historical capture lacking the initial anchor/chunk boundaries cannot be repaired from persisted merged samples. This review does not resolve its GitHub discussion thread or infer an actual runtime performance cause.

## Verification and limits

- `pnpm --filter @taskdesk/web exec vitest run src/lib/performance-trace-profile-clock.test.ts`: 1 file, 5 tests passed. Cases cover multi-chunk cumulative timing and boundary clipping, node-only chunks, key separation, absent/invalid anchors, and malformed-delta cursor preservation.
- Inspected the exact parent-to-head diff, listener, downstream clipping/aggregation, sanitization, raw persistence, fixture path and required diagnostic assertions, along with the authoritative security-scope/review policy.
- No browser/CDP capture, full suite, image, database or GitHub write was performed in this review. The focused tests establish deterministic clock behavior and source wiring, not live capture success or G11 gate results. V8 documents a suspend/resume clock-domain limitation; no claim of coverage across that event is made.
