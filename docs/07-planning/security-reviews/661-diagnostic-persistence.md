# PR #661 — diagnostic persistence review and runtime evidence

**Reviewed head:** `22253f5cc2e68561437512bf2c533fe3ddd2e74e`

The following independent reports are preserved verbatim, with their original scope and limits. They supplement the prior diagnostic review panel. The accepted-main composition following that reviewed head requires its own independent confirmation; this record does not supply it.

## Original report: 661-persistence-independent-luna.md

SHA256: `4b73c75b5ee965ed35d7ad0ac44a707fd14231b66f7109eafb85d2447f80988b`

# Independent ordinary review — #661 diagnostic persistence

**Role:** Ordinary reviewer (independent)
**Model:** GPT-6 Luna (platform-reported model for this review context)
**Reviewed head:** `22253f5cc2e68561437512bf2c533fe3ddd2e74e`
**Compared with:** `1e10c064faf984fbefe4ddb346d1e571524e4fc2`
**Tree:** `180c7e3feb3eae5482d6b66ca6a21855e3e8ca67`
**Scope:** Four changed files only: `apps/web/e2e/performance.initial-page-diagnostic.ts`, `apps/web/e2e/helpers/persist-diagnostic-capture-artifact.mjs`, its `.d.mts` declaration, and its focused `.test.mjs` fixture. Read the applicable G11 diagnostic contract, workflow review policy and CI security-scope list. No authorship, direction, or remediation of this delta.

## Verdict

**CLEAR for the bounded diagnostic-only persistence change.** The ordering change checkpoints all five source-bound, sanitized captures before running alignment/aggregation. An alignment exception is rethrown unchanged after a best-effort failure receipt attempt. The persistence helper validates fixed indices and metadata, uses exclusive `wx` writes, requests directory/file modes `0700`/`0600`, and catches each write failure so capture persistence does not replace the original alignment outcome. I found no regression to G11 budgets, acceptance assertions, or pass/fail thresholds, and no new authority behavior.

## Findings and limits

- No blocking or non-blocking code findings.
- Privacy/source binding: the persisted artifact is assembled from the captured window's metrics, sanitized CPU nodes, timing samples, fixed diagnostic marks, timeline data, browser metrics, and the bounded network summary. The existing producers constrain network paths to fixed templates and omit request/response payloads and credentials; CPU nodes are sanitized against the benchmark origin. The four source/build identifiers are required as strings before writing.
- Failure preservation: the receipt records the failed window, completed window names, phase, source/build identity and error message. The helper rethrows the original error object. Failure receipt and per-window write errors are caught and logged.
- Existing files are protected by exclusive creation. The fixture verifies an existing window artifact remains intact after an `EEXIST` result and verifies private file mode.
- Important limit: artifact construction and sanitization happen in `captures.map(createRawCaptureArtifact, ...)` before entering the helper's best-effort writer. A construction/sanitization exception can therefore fail before checkpoint attempts; this patch does not establish globally non-gating persistence. The best-effort guarantee applies to filesystem persistence failures after artifacts have been constructed.
- The aggregate failure handler catches synchronous errors from the aggregation callback inside `Array.map`; that matches the current synchronous `alignBoundaryToTrace`/aggregation callback.
- These artifacts remain diagnostic evidence. This review makes no claim that G11 passed, that the board caused the observed regression, or that preserved captures themselves establish a performance result.

## Verification performed

- `node --test apps/web/e2e/helpers/persist-diagnostic-capture-artifact.test.mjs` — 2 tests passed, 0 failed, 0 skipped. The fixtures cover five-window checkpointing before a reproduced alignment failure, retention of the original error, source binding and sample/clock markers, exclusive/no-overwrite behavior, private file mode, and capture/failure-write error handling.
- `git diff --check 1e10c064faf984fbefe4ddb346d1e571524e4fc2..22253f5cc2e68561437512bf2c533fe3ddd2e74e` — passed.
- No browser, full build, Docker or performance run was performed; this review is limited to the focused persistence helper and its wiring.

## Gate implication

`apps/web/e2e/**` is explicitly in the CI security-review path list. The reviewed delta is observational and does not change authority or gate pass/fail semantics, so the policy calls for one ordinary review plus a lightweight independent GPT-6 Sol security confirmation. This Luna report is the ordinary review only and does not satisfy the Sol confirmation.

## Original report: 661-persistence-independent-sol.md

SHA256: `657c160df649c72eb1814d1e380c2a50cf1403c054c40ccca1cb9d5ce41b4765`

# Independent security confirmation — PR #661 diagnostic persistence

**Role:** Independent security reviewer  
**Model:** GPT-6 Sol  
**Verdict:** CLEAR, lightweight confirmation for this bounded diagnostic-only delta  
**Exact reviewed head:** `22253f5cc2e68561437512bf2c533fe3ddd2e74e`  
**Reviewed tree:** `180c7e3feb3eae5482d6b66ca6a21855e3e8ca67`  
**Compared with prior reviewed code:** `1e10c064faf984fbefe4ddb346d1e571524e4fc2`

I did not author, direct, or remediate this candidate. I reviewed the four changed paths in `apps/web/e2e/`: the diagnostic test, the persistence helper, its declaration, and its focused Node fixture. I checked the workflow's security-scope classification, the capture producers, sanitizers, filesystem writer, and the unchanged diagnostic assertions. The ordinary Luna review had already cleared the same exact head; I verified its relevant claims independently.

The candidate checkpoints five capture artifacts before `alignBoundaryToTrace` runs. An alignment exception generates a best-effort failure receipt and is rethrown as the original error object. Each capture write error is caught; existing files are protected by `wx`, and the writer requests `0700` for the directory and `0600` for each JSON file. The index is restricted to the five fixed windows, and source/build identity keys must be present as strings. The new artifact contains sanitized CPU nodes (compiled asset basename/function/coordinates, no raw URL), sample timing, fixed clock markers, bounded network summaries, browser timeline data, document metrics, and recorder boundary. The network producer templates dynamic route segments and retains no payloads or auth values. The diagnostic runs against the fixed G11 fixture and local origin. The new raw capture directory is not named in the diagnostic job's explicit CI artifact upload, which continues to upload `initial-page-profile.json`.

No authority, authentication, tenancy, deployment, CI control, G11 budget, calibration, benchmark sampling, or acceptance assertion changes occur in this delta. The unchanged assertions still run after aggregation and summary writing. `apps/web/e2e/**` is a mandatory security-review path, so this confirms the security tier even though the semantic change is observational.

**Findings:** No blocking or non-blocking finding for this bounded candidate. The best-effort catch starts at filesystem persistence. `captures.map(createRawCaptureArtifact, ...)` builds and sanitizes all artifacts before the catch, so a construction error can prevent persistence; this review does not claim globally non-gating behavior. The full-window document metric `resources[].asset` is a pathname basename rather than a path template. Here its source is the fixed local G11 fixture; extending the same artifact writer to non-fixture traffic would require a fresh privacy review. The strings required for source binding are presence-checked, not cryptographically validated by this helper; their values come from the existing build-identity producer.

**Verification:** `node --test apps/web/e2e/helpers/persist-diagnostic-capture-artifact.test.mjs` passed 2/2 tests, 0 skipped. The tests reproduce the old alignment failure after five completed windows, verify all five files and the failure receipt, original-error rethrow, exclusive/no-overwrite behavior, private file mode, and write-failure handling. `git diff --check 1e10c064faf984fbefe4ddb346d1e571524e4fc2..22253f5cc2e68561437512bf2c533fe3ddd2e74e` passed. I did not run a browser, Docker build, or actual G11 performance workload. Current required CI and runtime acceptance remain separate gates. This review does not establish a G11 pass or identify the product cause of the previously observed `scale=993.5797900735282` alignment failure.

## Root runtime evidence — persistence on exact #650 production source

The serialized private capture used exact #650 source `633273f9130769be60c2e93aee1f5d73642b2bd9` with a closed five-file diagnostic overlay from reviewed #661 source `22253f5cc2e68561437512bf2c533fe3ddd2e74e`. Product source, fixture, recorder, production distribution and assertions were conserved. This is not a runtime test of every file in the current composed #661 tree.

On 2026-10-11 at 22:24:49–22:25:21 UTC, the actual diagnostic completed all five canonical browser windows, persisted all five sanitized raw capture files and alignment-failure context, and exited **1** because task-state alignment scale `1005.9974087050558` exceeded the unchanged `1000 ± 5` guard. The original preview was restored and verified healthy, with its source and distribution unchanged. Failed earlier acquisitions remain retained; this successful persistence does not turn the diagnostic outcome into a pass.

An offline derivative from raw board window 4 independently reapplied the committed alignment formula and strict guard, checked captured production JavaScript/manifest/fixture hashes and source maps, and clipped samples to the canonical board interval. It exited 0 with board scale `1000.0604026845638`. The original failed diagnostic remains failed. Sampled attribution is evidence for diagnosis, not a hosted G11 result, a completeness guarantee or causal proof.

Private source-bound evidence remains outside Git: `g11-schema4-exact650-private-acquisition/capture-prealign-v7d/` and `maps-and-derivative-prealign-v7d/` under the conductor's dated evidence directory. Raw board capture SHA256: `be96805c0909d0563b135b6190e81330201d325ba800cc79b2fbc311c8f90136`; offline derivative SHA256: `b005b1fed3d83d034f063f7467f01b197872e1aa1638c68c2a6c9e51d388ad2f`. These hashes identify artifacts; they do not independently establish authorship or acceptance.

No G11 waiver, product performance correction, release, SIT promotion, issue #637 closure, or stage completion is claimed.
