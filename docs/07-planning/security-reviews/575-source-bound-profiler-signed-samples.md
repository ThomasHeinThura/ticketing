# PR #575 — source-bound profiler signed samples

**Reviewed head:** `aeea157e77a150e28668f3b05327e8442ed4f5b9`

## Scope and classification

Evidence-tooling security scope (`apps/web/e2e/**`). The current bounded delta corrects one well-understood CPU validation case: signed raw deltas may reconstruct timestamps out of sequence. It retains finite values and actual profile interval bounds, sample/node/count/data-loss checks, and derives stable timestamp/node/index ordering without mutating or dropping raw records. No application, route, permission, fixture, performance budget or clock changed. The full three-file composition is on unaccepted performance parent `a8b33755bae543b6937afa0cd62363e74a236c47`; it does not accept that parent transitively.

## Independent ordinary review

- GPT-6 Luna context `/root/profiler_aee_strong_luna_review`, independent of source/procedure author and fixer.
- [Review 5392685413](https://github.com/ThomasHeinThura/ticketing/pull/575#pullrequestreview-5392685413), exact reviewed head above, CLEAR.
- Actually ran 16/16 focused Node tests, syntax and diff checks; checked actual prerequisite receipt's 32 source inputs and 39 generated outputs. Inspected prior replay proof; did not run a build, new capture or benchmark.
- No blocking or non-blocking findings. Earlier independent composition and procedure reviews remain historical; current bounded source change received this strong delta review.

## Independent full security review

- GPT-6 Sol context `/root/p0_profiler_898_sol_security`, independent of source/procedure author and fixer, after ordinary clearance.
- [Review 5392685946](https://github.com/ThomasHeinThura/ticketing/pull/575#pullrequestreview-5392685946), exact reviewed head above, CLEAR.
- Actually ran 16/16 focused tests, three Node syntax checks, Python AST and diff checks; checked primary protocol/vendor behavior, raw immutability and pair-preserving normalization, current private invocation procedure and the actual 32-input/39-output receipt.
- Private procedure SHA-256 `184dc92b91c1bacdb02f8532f900e51437947de2993584ddde9c275699cd83de`. Exact-source clean build, private output containment, source/artifact hashes, cleanup and candidate-versioned prerequisite receipt were checked. No raw uploader exists; procedure is external operational evidence, not shipped code.
- No blocking or non-blocking findings. This clears one private diagnostic capture only; reviewer did not run build/browser/capture and made no acceptance claim.

## Actual diagnostic execution and limits

One later private capture completed six fixed journeys with exit 0. Original fresh build and source/retained-artifact manifests matched; tracked source stayed unchanged, generated files were cleaned, private permissions verified and preview ports released. The capture used local Node26/pnpm10.32.1/Playwright1.63 and the existing authenticated synthetic fixtures. It is not the hosted canonical 22-case G11 acceptance run. Earlier candidate898 first-journey capture remains failed and preserved; its raw signed-order assumption was incorrect, not a product speed defect.

CPU samples provide positive sampled-stack evidence. The capture does not prove complete request lifecycles, exclusive time attribution, causal savings, or whether routePaint was skeleton or final detail. Raw profiles, URLs, stacks, screenshots and source maps remain private. No performance improvement, representative UAT soak, authorization cutover, manual H1 approval, phase finalizer or P0 completion is claimed.

This review-note-only commit preserves the reviewed source under the canonical review-note binding rule. Broad CI and parent acceptance remain separate gates.
