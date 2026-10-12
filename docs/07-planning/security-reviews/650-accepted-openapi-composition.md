# PR #650 — authentic accepted OpenAPI composition reviews

**Reviewed head:** `ee00fc5ebbbf949b97f06a50ef6fb101902b223b`

These original independent reports and their factual/model corrections are preserved verbatim. Their bounded scope supplements existing feature reviews. This own additive note grants no waiver or broader product/runtime/CI acceptance.

## Original report: 650-accepted-openapi-composition-independent-luna.md

SHA256: `89d3435cb93280d3659051bb06d5a56138077faf7fda6bf2e96dce2089a1055a`

# PR #650 accepted OpenAPI composition — independent ordinary delta review

**Verdict: CLEAR for the accepted OpenAPI composition delta only.** No blocking or non-blocking findings.

- **Reviewed head:** `ee00fc5ebbbf949b97f06a50ef6fb101902b223b`
- **Merge parents:** feature composition `f0d2393d6ff2574a60aa3af9ba52bf52a6e86544`; accepted main `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`
- **Accepted checker source:** `8fb32f18afceefb0f930872093dd62144aaddc95`
- **Reviewer:** fresh independent ordinary-review context; I did not author, direct, or remediate the checker or this composition.

## Scope and checks

I reviewed the accepted #662 ordinary and Sol reports, their authentic preservation note, the #650 source/composition reports, and the exact candidate history. The #662 merge's first-parent delta is only its 65-line accepted review record plus `scripts/ci/test-contract.mjs` and `scripts/ci/test-contract.test.mjs` (the two checker files: 107 insertions and 2 deletions). The checker blobs at `ee00fc5` match accepted source `8fb32f18` exactly. Relative to the accepted-main second parent, the candidate retains the native realtime implementation and tests; the separate #650 composition record is present as expected.

I inspected merge parents and both parent-relative diffs, not just the net tree. This candidate contains the accepted #662 note/checker change as the incoming main composition and no additional composition edit. The prior #650 source reports and accepted-S7 composition reports remain in history/evidence. The original #650 G11 failure (`37db-openapi` report lineage) remains preserved; this review does not convert historical source-bound evidence into current acceptance.

The #662 focused checker suite is author/reviewer evidence at exact source `8fb32f18`: 55/55 passed, including >1 MiB Git object byte fidelity and missing-ref/path failure handling. I inspected the accepted ordinary and full independent Sol assessments of those semantics; I did not rerun the suite for this composition-only review. No database, broad build, browser, Docker, or product integration check was run.

## Limits

This clears only the narrow accepted-main composition delta and source conservation for #650. It does not clear its pre-existing G11 result, prove product/runtime behavior, establish exact-head hosted checks, or provide the required fresh GPT-6 Sol confirmation on this current security-scope head. No merge or overall PR-readiness claim is made.

## Original report: 650-composition-failure-label-correction-luna.md

SHA256: `f18347a5fd8da3d03b98873f417ef4fa7d81f3faac3d3020062378282e46a327`

# PR #650 composition review — factual failure-label correction

**Disposition:** Withdraw the ambiguous G11 attribution in my accepted-composition report. This correction does not change its verdict or scope.

- **Original report:** `650-accepted-openapi-composition-independent-luna.md`
- **Reviewed #650 composition head:** `ee00fc5ebbbf949b97f06a50ef6fb101902b223b`
- **Reviewer:** same fresh independent ordinary-review context; factual correction only.

The original report said “original #650 G11 failure (`37db-openapi` report lineage) remains preserved.” That wording conflated two separate results and is withdrawn.

The preserved `pr650-37db-openapi-failure-raw.log` shows `pnpm test:contract` failed at `test:contract failed: spawnSync git ENOBUFS` (18:15:01 UTC). This is the OpenAPI contract checker failure. The separate preserved `pr650-37db-hosted-g11-pass-raw.log` is the hosted G11 run for the same `37db` lineage; it records `22 passed` at 18:23:03 UTC and a successful run. Thus the 37db OpenAPI failure was not a G11 failure; G11 passed on that run.

The actual historical #650 G11 calibration failure remains the independently recorded `0.681` spread against the unchanged `0.55` threshold at the earlier `998fdc5` source, as stated in the prior #650 composition reports. Other source-bound failures at older heads retain their own original labels and outcomes. This note does not generalize those results to the current head or revise any report, test evidence, or overall readiness assessment.

No source or published report was changed. No tests or runtime work were performed for this factual correction.

## Original report: 650-accepted-openapi-composition-security-sol.md

SHA256: `ce4033d9eb1e7d3d1ba9882fbbda04a6445bd5d03b17b95ff6cf7814170ed315`

# PR #650 — independent lightweight security confirmation of accepted OpenAPI composition

**Verdict: PASS for this bounded composition delta.** No blocking or non-blocking finding in the accepted checker import. This does not clear #650's pre-existing G11 failure or overall PR gates.

**Reviewed head:** `ee00fc5ebbbf949b97f06a50ef6fb101902b223b`  
**Merge parents:** #650 source `f0d2393d6ff2574a60aa3af9ba52bf52a6e86544`; accepted main `3dadd086d2a0bc3d35621fc97683cc0dea2eec7d`  
**Accepted checker source:** `8fb32f18afceefb0f930872093dd62144aaddc95`  
**Reviewer:** fresh independent GPT-6.1 Sol security context. I did not author, direct, or remediate the checker, composition, or #650 product source. This is a current-head lightweight confirmation following the separate ordinary composition CLEAR.

I inspected the exact head, both merge parents, first-parent incoming path list, and checker blob identities. The first-parent delta consists only of `docs/07-planning/security-reviews/662-openapi-contract-stream.md`, `scripts/ci/test-contract.mjs` and `scripts/ci/test-contract.test.mjs`; there is no first-parent change under `apps`, `packages`, `tests`, or `docs/01-architecture`. Both checker blobs are byte-identical to the accepted, fully ordinary- and Sol-reviewed #662 source. The second-parent comparison preserves #650's native realtime source. No new authority or gate pass/fail semantics are introduced by this merge beyond that accepted checker repair, and the merge does not alter #650's performance budget or G11 evidence.

I read the accepted #662 ordinary and Sol reports and the independent #650 composition report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/E/650-accepted-openapi-composition-independent-luna.md`. The accepted checker evidence reports focused 55/55 tests, byte-faithful Git reads above 1 MiB, and fail-closed missing ref/path behavior at source `8fb32f18`. I did not rerun that unchanged suite, nor run DB, Docker, browser, broad build, or product tests. Prior #650 browser/image and G11 results remain bound to their original SHAs; this verdict certifies only the current-head security-scope composition delta, not hosted checks or merge readiness.

## Original report: current-security-reviews-model-provenance-correction.md

SHA256: `99f3930949a77be8b1f8801d74de59567d62485e3e3a6790b7e09c450019c106`

# Model provenance correction for four current security reports

The four original security reports below remain preserved verbatim. Their reviewer lines identify this context as **GPT-6.1 Sol**. That specific serving variant is not independently visible to this reviewer and should not be asserted as fact. The parent dispatch explicitly selected **`gpt-6-sol`**, a Sol-tier model, for this fresh independent context. The truthful provenance is therefore **GPT-6 Sol (dispatch selector `gpt-6-sol`; actual serving variant not independently exposed)**. This correction changes no security finding, review scope, head SHA, or verdict.

- `663-expiry-current-full-security-sol.md` — current-head BLOCK, snapshot ledger byte-hash mismatch.
- `650-accepted-openapi-composition-security-sol.md` — bounded composition PASS only.
- `661-accepted-openapi-composition-security-sol.md` — bounded composition PASS only.
- `660-accepted-openapi-composition-security-sol.md` — bounded composition PASS only.

The four reports were produced in one fresh reviewer context, which served only the security-review role for distinct candidate compositions and #663. It did not author, direct, or remediate any of those candidates. This correction must travel alongside any cited report so the model label is not misrepresented.

