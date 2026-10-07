# PR #599 — public-origin storage URL review record

## Frozen source review

**Reviewed head:** `51d151e8c2ff973c899c8b257f2fa21d9ee8fb0c`

**Base:** `5326937460b195d8e69584c0cb99305348330a95`  
**Risk tier:** security-scope paths touched; URL metadata only, with no authority or gate pass/fail semantic change. One ordinary GPT-6 Luna review and the required lightweight GPT-6 Sol confirmation.

### Ordinary review

- **Reviewer/model:** fresh independent GPT-6 Luna context.
- **Review report:** `/tmp/p0-public-origin-luna-review-51d151e8.md`.
- **Independence:** report states the reviewer did not author, direct, or remediate the candidate.
- **Scope:** complete 10-file candidate diff; host-origin selection, host guard, route context typing, task-image URL generation, filesystem attachment presign/download URL use, unchanged storage signing, and regression tests.
- **Checks:** `git diff --check` passed; focused host tests passed 2 files / 13 tests. Database integration tests, Docker, browser, deployment, CI and G11 were not run by this reviewer.
- **Verdict:** CLEAR; no blocking or non-blocking findings.

### Security review

- **Reviewer/model:** fresh independent GPT-6 Sol context.
- **Review report:** `/tmp/p0-public-origin-sol-review-51d151e8.md`.
- **Independence:** report states the reviewer did not author, direct, or remediate the candidate.
- **Scope:** all 10 changed files plus host selection, filesystem/S3 URL creation and token signing, storage selection, middleware order, origin configuration, and the Luna review.
- **Checks:** `git diff --check` and the same 2-file / 13-test focused host suite passed. No database integration, Docker, browser, deployment, network/CI or G11 run.
- **Verdict:** CLEAR; no blocking or non-blocking findings. The verdict applies to `51d151e` only.

### Source-51 build and runtime evidence

The exact OCI image built successfully as `sha256:e706fdf02622e0b44be43cf405b1cc02b05a65374d116e32c7bce8f50a7ffed4`. Root's bounded stock-Traefik run verified both JSON health endpoints, signup/session/CSRF, workspace/project/item creation, native HTTPS attachment presign, upload204, completion200, listing200, HTTPS redirect302, and download200 with matching bytes. It used no URL rewrite. Root cleanup passed: five containers, three named volumes, two networks and two aliases removed; global sets unchanged; ports4296/4297 absent; unknown volume preserved.

The native PostgreSQL test run at `51d151e` was 2 files / 23 tests: 21 passed, 2 failed. Both failures were fixture defects remediated in the reviewed `9abb601` delta below. This source-51 run is preserved as historical evidence and is not relabeled green.

The source-51 evidence does not establish official installer verification, an official installer TLS result, G11 clearance, strict cutover, or P0 acceptance.

## Test-only delta review

**Reviewed head:** `9abb60134cf14f8b252e2c5f94635a6026eebfd4`

**Comparison base:** `51d151e8c2ff973c899c8b257f2fa21d9ee8fb0c`  
**Risk tier:** test-only delta in security-scope integration files; it does not change a security control, authority, or gate pass/fail semantics. One ordinary GPT-6 Luna review plus the required lightweight GPT-6 Sol confirmation.

### Ordinary review

- **Reviewer/model:** fresh independent GPT-6 Luna context.
- **Review report:** `/tmp/taskdesk-p0-599-fixture-delta-luna-9abb6013.md`.
- **Independence:** report states the reviewer did not author, direct, or remediate the delta.
- **Scope:** exact 2-file delta (`tests/api-integration/attachment.test.ts`, `tests/api-integration/task-image-upload.test.ts`), host selection and public-origin middleware, integration auth/fixture helpers, URL call sites, and predecessor reviews.
- **Checks:** `git diff --check 51d151e8..9abb6013` passed; static inspection only. Reviewer did not run database tests or service/runtime activity.
- **Verdict:** CLEAR; no blocking or non-blocking findings.

### Security review

- **Reviewer/model:** fresh independent GPT-6 Sol context.
- **Review report:** `/tmp/taskdesk-p0-599-fixture-delta-sol-9abb6013.md`.
- **Independence:** report states the reviewer did not author, direct, or remediate the candidate.
- **Scope:** same exact 2-file delta, integration setup/auth fixtures, configured-origin parser and host guard, and predecessor Luna/Sol reports.
- **Checks:** exact delta `git diff --check` passed; static inspection only. Reviewer did not run database integration, Docker, browser, network/CI or performance checks.
- **Verdict:** CLEAR; no blocking or non-blocking findings. This is the required lightweight Sol confirmation for the test-only delta, not a new full security redesign review.

### Author verification and root-owned exact-head evidence

At `9abb601`, author-run standard offline checks passed sequentially:

- `pnpm lint`: passed, 8/8 Turbo tasks; existing lint warnings were reported.
- `pnpm typecheck`: passed, 9/9 Turbo tasks.
- `pnpm test`: passed, 12/12 Turbo tasks. This command runs unit suites; it does not run PostgreSQL integration tests.
- Focused host-origin suite: 1 file / 7 tests passed.
- Changed-file Biome check and `git diff --check`: passed; four pre-existing undeclared-environment-variable warnings remain in the two integration test files.

Root's exact-head native result `/Users/heinthura/.codex/taskdesk-evidence/2026-10-07/public-origin-native-20261007T121541Z-271391/native-result.json` records source `9abb60134cf14f8b252e2c5f94635a6026eebfd4`, exit0 and 2 files / 23 tests passing. Its cleanup receipt records PASS: one container and one named volume removed after zero-client verification; global container/volume/network sets unchanged; port55442 absent; operational credentials removed. The native receipts are root-owned evidence, not reviewer-run checks.

`runtime-product-source-equivalence.json` binds the source-51 runtime to `9abb601`: the only changed files are those two test files, source-51 product runtime is unchanged, and no new runtime claim is inferred for `9abb601`.

## Limits and disposition

No review or test is claimed beyond the exact heads and checks listed above. The unchanged source-51 runtime does not become a new-head runtime run through test-only source equivalence. No official installer acceptance, persistent DEV refresh, G11 retry/clearance, strict cutover, merge, waiver or P0 completion is claimed. Hosted required checks remain governed by their actual exact-head GitHub results. The known P0 #583 G11 failure remains unresolved and was not retried or waived.
