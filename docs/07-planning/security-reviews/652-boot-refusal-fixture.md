# PR #652 — production boot-refusal fixture review record

**Reviewed head:** `8ce081d84f7ead3101368fefc48a77bdd79ace9b`

Root transported these independently dispatched reports unchanged. Actual ordinary dispatch was collaboration.spawn_agent model=gpt-6-luna, fork_turns=none; the reviewer could see only generic GPT-6 and did not claim the selector. Actual subsequent fresh full-security dispatch was model=gpt-6-sol, fork_turns=none; its report distinguishes the selector from generic serving identity. No author/fixer context supplies either approval. Root dispatch provenance is a producer clarification, not an edit to authentic reviewer identity or verdict.

Public authentic report: https://github.com/ThomasHeinThura/ticketing/pull/652#issuecomment-6109593302
SHA-256: `dbf2818d9043e043ec0dbac2946ea8399c86becaa1cd601af8c6d631e2583258`

# Independent ordinary review — API boot-refusal fixture

**Role:** fresh independent ordinary reviewer; did not author, direct, or remediate this candidate.
**Reviewer model:** GPT-6, as identified by this platform. This context did not expose a verifiable selector/version string; I do not claim the `gpt-6-luna` selector was explicitly used.
**Candidate:** `8ce081d84f7ead3101368fefc48a77bdd79ace9b`
**Comparison base:** `2ecff903eb9e6a74f2d6a5eb03a54849b36afa45`
**Scope:** sole changed path `tests/api/permissions/enforcement-config.test.ts`.
**Verdict:** PASS — strong ordinary review. No blocking findings.

## What I checked

The candidate preserves all seven existing test cases, including parser validation and the boot-refusal case. It removes mutation of the Vitest process environment and module registry. The refusal assertion now runs a separate Node process with the invalid source value and test-only valid auth/origin settings, imports the freshly built `apps/api/dist/index.js`, and requires a nonzero exit, the exact `PolicyEnforcementConfigError` message, and no successful-import marker. This exercises the production bundle's import-time configuration guard; it does not start the server as the main module or intentionally connect to a database.

The `beforeAll` runs the repository's existing API build command with a 5-second process bound and checks that the resulting entrypoint is a file with a newer mtime. The child import has a separate 5-second bound. Timeout or spawn errors fail the expectations; no timeout allowance is increased. The change adds no dependencies, skips, focused filters, CI pipeline/runtime changes, or permission behavior changes.

The root Turbo `test` task declares `dependsOn: ["^build"]`; the API test task therefore has its workspace dependencies built before the unit suite in the standard Turbo path. The fixture also builds the API bundle itself, so it does not rely on an old API entrypoint. The focused test's conventional direct invocation is from the API package with `vitest.config.ts`; invoking root `pnpm exec vitest` is not a valid selector in this repository because Vitest is an API workspace dependency.

## Verification performed

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/permissions/enforcement-config.test.ts` — exit 0; **1 file / 7 tests passed**, 1.50s reported duration.
- `git diff --check 2ecff903eb9e6a74f2d6a5eb03a54849b36afa45 8ce081d84f7ead3101368fefc48a77bdd79ace9b -- tests/api/permissions/enforcement-config.test.ts` — no whitespace errors.
- Initial exploratory command `pnpm exec vitest run tests/api/permissions/enforcement-config.test.ts` — exit 254 because Vitest is not installed at the root; this was an invalid selector, not a test failure. The API workspace invocation above is the valid focused run.

The author handoff reports a negative-guard probe in a temporary built copy that exited successfully and printed the marker after neutralizing the policy guard. I inspected that report but did not independently rerun its mutation probe.

## Findings and residuals

No blocking or non-blocking code findings. The 5-second API build bound is intentionally retained; a slower supported runner would fail closed and require diagnosis. This review did not run the full API unit suite, integration/database tests, browser checks, or image build. The test's seven-case focused pass does not clear the separately recorded full-suite failure. No PR, merge, or security-review verdict is claimed here.


Public authentic report: https://github.com/ThomasHeinThura/ticketing/pull/652#issuecomment-6109593628
SHA-256: `86b89526b97f4cdf89a2b856dce106d957e7d958da4a3db002382099357a6840`

# Independent security review — API boot-refusal fixture

**Role:** fresh independent full Sol-tier security reviewer, after ordinary review; I did not author, direct, or remediate the candidate.
**Dispatch provenance:** parent dispatched this fresh context with `model: gpt-6-sol` and `fork_turns: none` (explicitly stated in the task dispatch). The platform identifies me generically as GPT-6; it does not expose a self-verifiable selector/version string here. The Sol-tier label records the explicit dispatch selector, not a claim that I introspected the runtime version.
**Reviewed head:** `8ce081d84f7ead3101368fefc48a77bdd79ace9b`
**Comparison base:** `2ecff903eb9e6a74f2d6a5eb03a54849b36afa45`
**Changed path:** `tests/api/permissions/enforcement-config.test.ts` only.
**Ordinary prerequisite:** reviewed `/Users/heinthura/.codex/taskdesk-evidence/2026-10-11/boot-refusal-fixture-ordinary-luna.md`, which records PASS at this exact head, 1 file / 7 tests.

**Verdict:** PASS — full Sol-tier security assurance review at the exact candidate head. No blocking or non-blocking findings.

## Security assessment

The candidate retains seven test cases and substitutes a bounded production-bundle child import for the former Vitest global environment/module-registry mutation. The child receives an invalid policy source and valid test-only auth/public-origin values. Its assertions jointly require a nonzero exit, the exact `PolicyEnforcementConfigError` message, and no import-completion marker. An unrelated startup error by itself cannot satisfy the exact policy error assertion. The import targets the production `apps/api/dist/index.js`, whose module evaluation reads `TASKDESK_POLICY_ENFORCE` and calls `parseEnforcedPolicySources` at module load. The API's main-module condition prevents the test import from starting the server or database startup path.

The setup invokes the existing API build command and requires a file with an mtime from this setup newer than any prior entrypoint. Its process and hook bounds are 5 seconds, and the child has a separate 5-second bound. A failed/stalled build, absent/stale entrypoint, child spawn error, child timeout, or signal fails the test. The standard Turbo `test` task also declares `dependsOn: ["^build"]` for API workspace dependencies; the fixture's own build covers its API entrypoint. A coarse timestamp, clock movement, or runner too slow for this bound can cause a false failure; it does not create a false pass. No source guard, CI gate, timeout allowance, dependency, skip/focus, global process environment, or module registry was changed. The child inherits the parent environment with three test-only overrides plus the invalid policy source; its invocation does not print inherited secrets.

I checked the source parser, registry dependency, production entrypoint's module-load and main-module paths, API build script, Turbo test dependency, and the original full-run log. The log shows the old boot-refusal test timed out after 5 seconds during a full run. That historical cause is not proven, and this narrow review does not claim the full runner is repaired.

## Independent verification

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/permissions/enforcement-config.test.ts` — exit 0, **1 file / 7 tests passed**, 1.29 seconds reported duration.
- Negative compiled-copy probe: copied the freshly built `dist/index.js` to an owned temporary file in `dist`, changed the compiled invalid-source condition to `false` exactly once, then imported that copy under the same invalid source and valid test-only bootstrap variables. The child exited 0 and printed `TASKDESK_API_IMPORT_SUCCEEDED` within 5 seconds. The candidate's nonzero/exact-error/no-marker assertions would reject this missing guard. The temporary copy was removed in a `finally` block; tracked source and normal `dist/index.js` were not altered.
- `git diff --check` on base..head — exit 0. Worktree clean after probes; local and remote branch refs both resolve to the reviewed head.

## Residual scope

This establishes focused regression evidence for invalid-policy rejection during production bundle import, not complete server startup or every security configuration. I did not run the full API suite, integration/database suite, browser/image checks, or CI. The separate full-suite failure remains open until reproduced and diagnosed at the appropriate candidate. No PR, merge, waiver, or author approval is claimed.


