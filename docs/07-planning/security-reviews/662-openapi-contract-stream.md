# PR #662 — authentic OpenAPI stream repair reviews

**Reviewed head:** `8fb32f18afceefb0f930872093dd62144aaddc95`

Both reports are preserved unedited from fresh dispatched independent contexts. This own additive review note changes no product/checker source, grants no waiver, and does not erase the original ENOBUFS failures.

## Original report: openapi-contract-stream-independent-ordinary-luna.md

SHA256: `986a15eb6180bf50a62f28c6d4facef8704e52306828dfd2f8f46a0a89f7d221`

# Independent ordinary review — OpenAPI contract stream fix

**Verdict:** PASS — no blocking or non-blocking findings.

**Reviewed head:** `8fb32f18afceefb0f930872093dd62144aaddc95`

**Comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`

**Independence:** Fresh reviewer context; did not author, direct, or remediate the candidate. This is the assigned strong ordinary review. The separate GPT-6 Sol security review remains required because `scripts/ci/**` is security scope.

## Scope and checks

Reviewed the two-file delta in `scripts/ci/test-contract.mjs` and `scripts/ci/test-contract.test.mjs`, plus the repository workflow/CI guidance and the API versioning contract in `docs/01-architecture/api-design.md`.

Confirmed `origin/main` resolves to the accepted base SHA. The previous synchronous `git show origin/main:tests/api-contract/openapi.json` reproduction fails with `ENOBUFS` (status `null`) after receiving 1,061,738 bytes. The new `readGitFile` returns status 0 and all 1,061,738 bytes from that exact `origin/main` object. The test also creates a real temporary Git repository, commits a >1 MiB UTF-8 object, and byte-compares the stream result to its expected bytes.

Inspected failure behavior: spawn errors reject and are converted by `main` into a nonzero check result; missing refs and paths preserve Git's nonzero status and stderr, and `main` exits nonzero when the requested base contract cannot be read. The helper uses argument-array `spawn` (no shell), drains both output pipes through process close, and returns the child's exit status for the existing fail-closed status check.

Ran `node --test scripts/ci/test-contract.test.mjs`: 55 tests, 55 passed, 0 failed. The added tests verify byte fidelity above the former buffer threshold and actual missing-path/ref failures.

The delta changes only retrieval of the base OpenAPI Git object and adds those focused tests. It does not change the `origin/main` comparison ref, Redocly shrink-only baseline, oasdiff behavior, approved-break or Redocly allowlist semantics, or stable-v2 versioning enforcement. No API/build, integration, browser, database, Docker, or broad suite was run; those are outside this bounded review.

## Findings

None.

## Gate state

Ordinary review clears this exact SHA. This does not satisfy or replace the required independent GPT-6 Sol security review, and it does not claim CI or merge readiness.

## Original report: openapi-contract-stream-independent-security-sol.md

SHA256: `3a463c4609e291635dbc22a304b53cff095e5ca4886a59027ffce60ceb747802`

# Independent GPT-6 Sol security review — OpenAPI base contract stream

**Verdict:** PASS. No blocking or non-blocking findings.

**Reviewed head:** `8fb32f18afceefb0f930872093dd62144aaddc95`  
**Comparison base:** `40f05826109fec0f8fc6fcebfe142593fa1d205c`  
**Independence:** Fresh GPT-6 Sol context. I did not author, direct, or remediate this candidate. This is the full security review required for a bounded `scripts/ci/**` gate pass/fail fix, following the separate strong ordinary PASS at the same head.

## Scope and evidence

I reviewed the complete two-file delta (`scripts/ci/test-contract.mjs`, `scripts/ci/test-contract.test.mjs`), the surrounding contract-gate flow, `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/04-engineering/ci-cd.md`, and the Versioning section of `docs/01-architecture/api-design.md`. I checked the prior `ENOBUFS` diagnosis and ordinary-review evidence as context, then independently ran the focused tests and byte comparison.

`origin/main` resolves to the accepted base SHA above. Its `tests/api-contract/openapi.json` is 1,061,738 bytes. The new async `git show` read returned exit 0 and exactly those 1,061,738 bytes; SHA-256 of its UTF-8 round trip and an independent Git byte read both equal `65deb4d7f31fdb7318b7a6d30a265bfd7639fc2c49103ae203f26c7c96245cb6`. The focused `node --test scripts/ci/test-contract.test.mjs` run passed **55/55** tests, with zero failures, skips, or todos. Its new real-Git fixture exceeds 1 MiB and checks UTF-8 byte equality; missing-ref and missing-path tests confirm nonzero status and Git diagnostics.

## Security assessment

The replacement uses `spawn` with an argument array and no shell. The reference, path, and working directory remain fixed by the existing gate (`origin/main`, `tests/api-contract/openapi.json`, calling checkout root). The helper drains both stdout and stderr and waits for `close`, which follows stream closure, before returning the assembled text. A spawn error rejects and `main` sets a failing exit code. A Git nonzero exit or signal gives a status other than zero and reaches the existing `reportFailure` path; no partial base content is accepted. The old and new callers both decode Git output as UTF-8; the actual contract's round trip is byte identical. The child is reaped before resolution, with no persistent subprocess or temporary file introduced by the change.

The only changed gate decision is that a base OpenAPI object above the synchronous runner's default `maxBuffer` can now be read and checked. Redocly still derives its shrink-only baseline from that exact base object and rejects new findings except for exact new allowlist entries. The oasdiff invocation still uses `breaking --fail-on WARN --format json` against `origin/main:tests/api-contract/openapi.json`, and its parse, exit, fingerprint, and new-entry checks are unchanged. The stable-v2 tag check and closed post-v2.0.0 break-allowlist behavior are unchanged. No dependency, environment variable, bypass, or waiver was introduced.

**Residual limit:** This review did not run `pnpm test:contract`, API build, broad suite, database, browser, or Docker checks; the conductor is serializing those checks. It validates this security-sensitive gate change and focused tests at the exact reviewed SHA, not overall CI or merge readiness.
