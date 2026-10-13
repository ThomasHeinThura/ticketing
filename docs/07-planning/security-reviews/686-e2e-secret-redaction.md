# PR #686 security review record: redact MFA secrets from e2e failure artifacts

PR #686 closes the recurrence path behind the 2026-10-13 public-artifact incident. Playwright's failure `error-context.md` carried an ARIA page snapshot of the MFA enrollment screen into uploaded CI artifacts. The PR adds `apps/web/e2e/helpers/redact-secret-error-context.ts`, wires it into both specs that render MFA secrets (`instance-users-journey.spec.ts` and `mfa-csrf-journey.spec.ts`; the second had no redaction), and adds a guard test (`apps/web/src/test/e2e-secret-redaction.test.ts`). The guard fails when a spec that renders a secret marker, directly or through an imported e2e helper, lacks the trace/video/screenshot-off settings or the redaction hook. CI evidence handling makes this PR security-scope.

The change was authored by the conductor (Claude Opus 5.5). The reviewers below are fresh, independent contexts that did not author or direct it.

## Review chain

- Ordinary review by Claude Sonnet 5.5: APPROVE at `f0b45105`.
- Security review by Claude Opus 5.5: CLEAR at `e77aa549`, checked against the Playwright 1.63 source. Its non-blocking residual (assertion messages in `tests/e2e/users-primary-journey.spec.ts`, a spec CI does not run) is tracked as issue #689.
- Ordinary delta review by the same Claude Sonnet 5.5 context: APPROVE for `f0b45105..e77aa549`.

**Reviewed head:** `f0b4510596718ed082f63c18c4f242cc33e7de25`
**Reviewed head:** `e77aa549f2b2dbf839af83be1d70a3a2fdd02421`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `686-ordinary-sonnet.md` | Ordinary review (31b98613..f0b45105) | Claude Sonnet 5.5 | `f0b45105` | APPROVE | `ebc3cbd9156ce0b4aefb6a17eb530fc0c78ddbadfdbd4eff001bc814e204e282` |
| 2 | `686-security-opus.md` | Security review (31b98613..e77aa549) | Claude Opus 5.5 | `e77aa549` | CLEAR | `9232b59a3e001fcd7ac4841be79d5dc4f49c5c416f3ce85d5c6dbfe655855310` |
| 3 | `686-e77a-ordinary-sonnet.md` | Ordinary delta review (f0b45105..e77aa549) | Claude Sonnet 5.5 | `e77aa549` | APPROVE | `82502b1455d2dd697706e25a2143068d5271c2f216d8998254e090077eee9a92` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/686-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 ebc3cbd9156ce0b4aefb6a17eb530fc0c78ddbadfdbd4eff001bc814e204e282) -->
# PR #686 ordinary review

Reviewer model: Claude Sonnet (fresh independent ordinary-review context)
Role: ordinary correctness / test / guard-strength review. Not the security-scope gate.

**Reviewed head:** f0b4510596718ed082f63c18c4f242cc33e7de25
**Base (merge base with origin/main):** 31b98613a24bb799ba46caf1de4357bd0e90a777
Worktree: /Users/heinthura/.codex/worktrees/e2e-secret-redaction/Ticketing.v2 (HEAD confirmed equal to the reviewed head). Read-only; nothing edited, committed or pushed in the worktree.

## Files examined
- Diff `origin/main...HEAD` (5 files, +120/-14): apps/web/e2e/helpers/redact-secret-error-context.ts (new), apps/web/e2e/instance-users-journey.spec.ts, apps/web/e2e/mfa-csrf-journey.spec.ts, apps/web/src/test/e2e-secret-redaction.test.ts (new), docs/04-engineering/error-fix-loop.md.
- Playwright 1.63.0 (node_modules/.pnpm/playwright@1.63.0): lib/index.js (willCloseBrowserContext, _takePageSnapshot, didFinishTest), lib/errorContext.js (buildErrorContext), lib/runner/index.js (error-context attachment printing).
- Other e2e surface: every file under apps/web/e2e and tests/e2e; apps/web/src/routes/.../settings/account/security.tsx (the only UI that renders the TOTP URI and backup codes); apps/web/e2e/visual.spec.ts + visual-screens.json; god-mode-users.spec.ts; tests/e2e/users-primary-journey.spec.ts; all playwright*.config.ts; .github/workflows/ci-full.yml, ci-fast.yml, release.yml.

## 1. Helper semantics (the gating question): PASS
Mechanism confirmed against Playwright 1.63.0 source:
- `didFinishTest` (lib/index.js ~L697) runs after the test function, the `afterEach` hooks and fixture teardown. It writes error-context.md from `this._testInfo.errors`. `buildErrorContext` (lib/errorContext.js L65) emits each error's `errorContext` verbatim inside a yaml fence, and the page snapshot only when it is passed in.
- `_takePageSnapshot` (L654-L660) returns early when any error has a truthy `errorContext`, so no automatic ARIA "# Page snapshot" section is produced. `hasMatcherAriaSnapshot` (L701) also passes `pageSnapshot: undefined`. So setting a truthy `errorContext` on every error in `afterEach` both replaces the per-error context and suppresses the page-level snapshot. The mechanism is honoured. Not blocking.
- The helper recurses through `cause`, which is correct for matcher errors that carry nested causes.
- The `afterEach` destructures `page`, which forces the page fixture so the hook is registered consistently. Fine.

## 2. Guard strength
Negative controls re-run on copies under $TMPDIR (a mirror of apps/web/e2e, tests/e2e and the guard test with a temporary vitest config; the worktree was never touched).

| Control | Expected | Result |
| --- | --- | --- |
| baseline | pass | 4/4 pass |
| NC1 remove afterEach from mfa-csrf spec | fail | FAILS on the afterEach regex |
| NC2 trace "on" in mfa-csrf spec | fail | FAILS on the test.use regex |
| NC3 new apps/web/e2e spec with a marker, no guards | fail | FAILS (spec discovered) |
| NC4 new tests/e2e spec with a marker, no guards | fail | FAILS (spec discovered) |
| NC8 helper body made a no-op | fail | FAILS the helper unit test |

The PR body's negative controls hold. The helper unit test is non-vacuous (asserts `otpauth://` and a code-like value are absent and nested cause is redacted).

Weaknesses found (all classified non-blocking, see findings): comment or dead-code evasion (NC5 afterEach inside a block comment passes; NC6 a commented-out `test.use` with `trace: "on"` passes; NC7 an unreachable redact call after `return` passes), marker coverage (NC9 a spec that clicks "Set up authenticator" and reads the URI from `code` but never contains the three markers passes undetected), and file-name coverage (NC10 a `.ts` that is not `*.spec.ts` or `*.bench.ts` is not scanned).

Secret screens inventory: the only UI that renders secrets is account/security (TOTP provisioning URI in a `code` element, backup codes in an alert list). Only instance-users-journey and mfa-csrf-journey drive it, and both are now guarded. visual.spec.ts renders the "enrollment-ready" screen from mocks, before any secret is shown, and screenshots only that. god-mode-users.spec.ts uses fixture tokens (and already has trace/video/screenshot off). tests/e2e/users-primary-journey.spec.ts is API-only (no page, so no ARIA snapshot). No password-reset or show-once API-key UI exists in apps/web/e2e or tests/e2e.

## 3. Other upload paths
.github/workflows uploads: ci-full.yml playwright-smoke, playwright-a11y, playwright-visual, playwright-performance (all apps/web/test-results/), g11 initial-page-profile.json, and release-sboms. Only `pnpm test:e2e` (smoke, runs the guarded specs) and `test:a11y` (`--grep @a11y`) could capture secrets. Both guarded specs set trace, video and screenshot off at spec level, overriding the config-level `trace: "retain-on-failure"`. Visual and performance configs do not run the secret specs. The approvals config (tests/e2e) output dir is not uploaded. No remaining upload path captures the enrollment secrets via the snapshot, trace, video or screenshot mechanism.

## 4. Tests and typecheck
- Guard test: `vitest run src/test/e2e-secret-redaction.test.ts` with an equivalent temporary config (root apps/web, jsdom, same setup file and aliases, no react plugin): 1 file, 4 tests passed. The repo vitest.config.ts could not be loaded directly because the sandbox denies the write of Vite's config temp file inside the worktree (EPERM on node_modules/.vite-temp); the substitute config differs only by omitting the unused React plugin.
- Typecheck: `tsc --noEmit -p tsconfig.app.json` exit 0; `tsc --noEmit -p tsconfig.node.json` exit 0 (both with `--incremental false`).
- Not run: the Playwright specs themselves (browsers and Docker excluded by instruction), so the end-to-end behaviour of afterEach redaction was verified by source reading, not by a live failing run.

## Findings
Blocking: none.

Non-blocking:
1. Guard regexes run on raw source and can be satisfied by comments or dead code (NC5-NC7). Suggest stripping comments before matching, or anchoring `test.afterEach` and `test.use` at line start with the multiline flag. Low likelihood (needs deliberate or careless edit), cheap to fix.
2. Marker set is narrow. A future spec that drives the setup flow but only reads the URI (no "Verify and enable", "I saved these codes" or "#enrollment-code") escapes (NC9). Suggest adding "Set up authenticator", "#factor-password", "otpauth://" and "account/security" as markers. A spec that imports `enrollFactor` from a shared helper would also escape, since detection is per-file text.
3. Scanned filenames are limited to `*.spec.ts` and `*.bench.ts` (NC10); a diagnostic-style file such as performance.initial-page-diagnostic.ts is run by a dedicated config and not scanned. None currently renders secrets.
4. Errors appended after the `afterEach` hook (for example a fixture teardown error on an otherwise passing test) would not carry an `errorContext`, and Playwright could then take its automatic snapshot in `willCloseBrowserContext`. The specs end on non-secret screens in the normal flow, so this is a remote residual.
5. Assertion messages are not redacted: `error.message` is printed into error-context.md and reporter output. The current specs only assert booleans and counts on secret values, so nothing leaks today. A future `expect(secretString).toBe(...)` would print the value. The lesson text could mention it. users-primary-journey.spec.ts uses `expect(status, body)`, which would print a response body on a status mismatch (API-only, not uploaded).
6. Docs: the lesson is accurate with respect to the Playwright behaviour verified above.

## Residual risk
Redaction relies on Playwright 1.63 behaviour (a truthy `errorContext` suppresses the page snapshot); a Playwright upgrade should re-verify, and the helper unit test would not catch a change there. The guard is textual, so it is a tripwire, not proof. No live failing browser run was performed.

## Secret scan
gitleaks 8.30.1 `detect --no-git` on a directory holding only this report: 0 findings ("no leaks found").

Verdict: APPROVE
<!-- END REPORT (sha256 ebc3cbd9156ce0b4aefb6a17eb530fc0c78ddbadfdbd4eff001bc814e204e282) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/686-security-opus.md; Claude Opus 5.5; sha256 9232b59a3e001fcd7ac4841be79d5dc4f49c5c416f3ce85d5c6dbfe655855310) -->
# PR #686 security review

Reviewer model: Claude Opus 5.5 (fresh independent security-review context)
Role: independent security-scope review. I did not author, direct or remediate this change. I worked read-only. I edited, committed and pushed nothing in the worktree, and ran no browsers or Docker.

**Reviewed head:** `e77aa549f2b2dbf839af83be1d70a3a2fdd02421`
**Base:** origin/main `31b98613a24bb799ba46caf1de4357bd0e90a777` (equal to the merge base)
Worktree: /Users/heinthura/.codex/worktrees/e2e-secret-redaction/Ticketing.v2. HEAD was confirmed to equal the reviewed head.
Commits in range: c4ee298c, f0b45105, e77aa549. The diff touches 5 files, +139/-14.

## Surfaces examined
- The full diff `origin/main...HEAD`:
  - apps/web/e2e/helpers/redact-secret-error-context.ts
  - apps/web/e2e/instance-users-journey.spec.ts
  - apps/web/e2e/mfa-csrf-journey.spec.ts
  - apps/web/src/test/e2e-secret-redaction.test.ts
  - docs/04-engineering/error-fix-loop.md
- Playwright 1.63.0, which matches the lockfile entries for `@playwright/test`, `playwright` and `playwright-core`:
  - `playwright/lib/index.js`: `willCloseBrowserContext`, `_takePageSnapshot`, `didFinishTest` and the error-context attachment.
  - `playwright/lib/errorContext.js`: `buildErrorContext`, including the error-details, page-snapshot and code-frame sections.
  - `playwright/lib/worker/workerProcessEntry.js`: the per-test run order, `testInfoError`, and the `matcherResult.ariaSnapshot` to `errorContext` mapping.
  - `playwright/lib/runner/index.js`: how the list reporter prints errors and attachments, and the `PLAYWRIGHT_LIST_PRINT_STEPS` default.
  - `playwright/lib/matchers/expect.js`: which matchers produce `ariaSnapshot`.
- Every file under apps/web/e2e (including helpers) and tests/e2e (including helpers and scripts). I searched them for TOTP, provisioning-URI, backup-code, API-key, invitation, reset-token, session-token and step-up-token handling. I also searched for `page.screenshot`, `testInfo.attach`, `outputPath`, console output and child-process stdio.
- tests/e2e/helpers/mfa-csrf-app-fixture.ts and child-process-supervisor.mjs. I checked where server logs go and what error text they produce.
- Every Playwright config: apps/web/playwright{,.visual,.storybook,.perf,.perf-diagnostic}.config.ts and tests/e2e/playwright.approvals.config.ts.
- Workflow files: .github/workflows/ci-full.yml, ci-fast.yml and release.yml, covering every `upload-artifact` step and the script behind each.
- The restricted incident record. I read it and quote no values from it.
- The ordinary Sonnet review, read only after I had formed the findings below.

## How the redaction works, checked against the 1.63.0 source
Per-test order in `workerProcessEntry.js`:
1. The test function runs.
2. `_didFinishTestFunction` runs. It calls the screenshot recorder, which does nothing because `screenshot: "off"`.
3. The `afterEach` hooks run. The redaction runs here.
4. Test-scoped fixtures are torn down. This closes the context, which calls `willCloseBrowserContext` and then `_takePageSnapshot`. The artifacts fixture teardown calls `didFinishTest`, which writes `error-context.md`.

What this means:
- `_takePageSnapshot` returns early when any error has a truthy `errorContext`, so no automatic ARIA page snapshot is taken.
- `didFinishTest` drops `pageSnapshot` when `hasMatcherAriaSnapshot` is true. A snapshot captured earlier would therefore also be dropped.
- Each error's `errorContext` is replaced by the fixed notice. This covers the per-matcher ARIA snapshot that `testInfoError` copies from `matcherResult.ariaSnapshot`. The redaction also recurses into `cause`.
- `trace`, `video` and `screenshot` are set to `off` by a top-level `test.use` in each spec, which overrides the config-level `trace: "retain-on-failure"`.
- A timeout error is pushed before the `afterEach` hooks run, so it is redacted too.

Result: for both specs, no page content (DOM, ARIA, pixels or network) reaches `apps/web/test-results/`. The redaction does what it claims.

Channels the redaction does not cover:
- **`error.message`.** It is written into `error-context.md` under "Error details" and printed by the list reporter to the CI job log, which is public on a public repository.
- **`stack`.** It goes into the code frame, which only reads test source from disk and holds no runtime values.

I checked every assertion in both specs that could touch a secret. They assert only booleans or counts, for example `expect(Boolean(...)).toBe(true)`, `expect(uri.startsWith(...)).toBe(true)` and `expect.poll(count)`. One locator assertion, `toContainText`, targets the step-up dialog. Typed codes sit in input values, not in text content, so the "Received string" cannot contain them.

`totpForUri` never echoes the key in its errors. Fixture child-process output goes to a 0700 directory under the OS tmpdir, which is not uploaded. The list reporter does not print steps by default, and no workflow sets `PLAYWRIGHT_LIST_PRINT_STEPS`. No JSON, HTML or blob reporter is configured. Nothing leaks through `message` or `stack` today.

## Tests run
- Guard test, with the repository config: `vitest run --config vitest.config.ts src/test/e2e-secret-redaction.test.ts` in apps/web, using vitest 4.1.11. Result: **1 file, 4 tests passed**:
  - the non-vacuity check;
  - 2 `it.each` rows, one each for instance-users-journey and mfa-csrf-journey;
  - the helper unit test.
  - The run needed the sandbox lifted only so Vite could write its config temp file in `node_modules/.vite-temp`. No tracked file changed.
- Typecheck: `pnpm typecheck` in apps/web, which runs `tsc -p tsconfig.app.json` and `tsc -p tsconfig.node.json`. Result: **exit 0**. The helper is type-checked because the guard test, under `src`, imports it. The specs themselves are outside both tsconfig includes, as they already were on main.
- Regex mutation checks. I evaluated the guard's two regexes in Node against modified copies of mfa-csrf-journey held in memory; the worktree was not touched:

| Mutation | Guard result |
| --- | --- |
| Original file | passes |
| `afterEach` removed | fails |
| `trace: "on"` | fails |
| Commented-out `afterEach` text with the real hook removed | passes, which is an evasion |
| A later `test.describe` adding `test.use({ trace: "on" })` | passes, which is an evasion |

- Not run: the Playwright specs themselves, because the instruction excluded browsers and Docker. The end-to-end behaviour is established by reading the source, not by a live failing run.

## Findings

### Blocking
None.

### Non-blocking
1. **The guard can be satisfied by text alone.**
   - Comments, dead code or a later nested `test.use({ trace: "on" })` all satisfy the regexes. A nested override also re-enables retained traces, which carry network bodies such as the enrollment response.
   - I judge this acceptable for a guard that is paired with mandatory review. Its job is to catch omission: a new secret-rendering spec without the hook, or the hook deleted. It does that, and the negative controls confirm it. It is not meant to stop deliberate evasion.
   - Cheap hardening: strip comments before matching, and fail on any `trace|video|screenshot` value other than `"off"` anywhere in a rendering spec.
2. **Marker coverage is narrow.**
   - Detection works on source text: four UI or route markers, plus a direct import of a marker-bearing non-spec helper, matched by basename and double quotes only.
   - It would miss a spec that drives "Set up authenticator" and reads the URI from `code` without any marker. It would also miss a two-level helper chain, a helper written as `.mjs`, or a test file not named `*.spec.ts` or `*.bench.ts`, such as performance.initial-page-diagnostic.ts.
   - None of these exist today. My inventory found that only account/security renders a TOTP URI or backup codes, and only the two guarded specs drive it.
   - Suggestion: add "Set up authenticator" and `#factor-password` as markers, or mark secret-rendering helpers explicitly.
3. **`error.message` is not redacted.** It reaches the uploaded `error-context.md` and the public job log.
   - Both guarded specs are disciplined about this today.
   - tests/e2e/users-primary-journey.spec.ts uses `expect(response.status(), body)` through `statusText()`. A status-code change on `/api/auth/two-factor/enable`, for example 200 becoming 201 in a refactor, would print the enrollment body into the error message. That body holds the TOTP URI and every backup code.
   - Mitigations today: the spec is API-only, runs only under the approvals config, writes to `test-results/approvals-e2e`, is not run by any workflow, and its credentials are disposable.
   - Recommend a follow-up: mask secret-bearing bodies in `statusText` for the enrollment and step-up calls, and add one line to the error-fix-loop lesson saying assertion messages must never include a secret value.
4. **Errors added only after `afterEach` are not redacted.** An example is a fixture-teardown error on a test that otherwise passed. Such an error carries no `errorContext`, so `_takePageSnapshot` would run.
   - In the normal flow the page has already left the secret screens by then: the codes are dismissed and the test has moved on to dashboard or Users routes.
   - This is a remote residual risk.
5. **Exact-head gate observation, for the orchestrator.** The ordinary Sonnet report records `Reviewed head: f0b45105…`, not the candidate `e77aa549…`.
   - e77aa549 changes the guard's detection logic (helper-import detection and the `otpauth://` marker).
   - Under CLAUDE.md, the ordinary-review gate is not satisfied at this candidate SHA until an ordinary review is recorded at e77aa549.
   - This is a process gate, not a code defect, and it does not change the security verdict below.

### CI upload paths (question 4)
ci-full.yml uploads `apps/web/test-results/` four times, each on `always()`:

| Artifact | What runs | Can it capture secrets from the enrollment journeys? |
| --- | --- | --- |
| `playwright-smoke` | `pnpm test:e2e`, the whole apps/web/e2e suite except visual | Only the two secret-rendering specs could. Both are now covered. The other real-runtime specs (realtime, work-item-comments) already set trace, video and screenshot off and do not display MFA secrets. Their fixed `page.screenshot` calls are taken on non-secret screens. instance-users-journey's own `users-directory-after-auth.png` is taken after the codes are dismissed. |
| `playwright-a11y` | `--grep @a11y` | Runs only auth-redirect, which shows no secrets. |
| `playwright-visual` | visual and storybook configs | Mock data only. The enrollment-ready baseline is captured before any secret exists. |
| `playwright-performance` | perf config | Mock fixture only, using fixed fake tokens. |

The `g11-initial-page-diagnostic` and release SBOM uploads are unrelated. The approvals, intake and users-primary journeys in tests/e2e are not run by any workflow, and their outputDir, repo-root `test-results/approvals-e2e`, is outside every upload path. Each job runs on its own runner, so no other job's output can reach these directories.

## Residual risk
- The redaction depends on Playwright 1.63 internals: a truthy `errorContext` suppresses the page snapshot, and `afterEach` runs before fixture teardown. A Playwright upgrade must re-verify this. The helper's unit test would not detect a behaviour change. A Playwright upgrade PR should repeat this source check, or add a deliberate failing-spec canary that asserts the content of `error-context.md`.
- The guard is a textual tripwire, not proof. See findings 1 and 2.
- The error-message channel depends on assertion discipline. See finding 3.
- Disposable passwords and session cookies in the other real-runtime specs fall outside the MFA-secret scope of this PR. They are also limited because trace is off in those specs.
- Copies of the deleted artifacts that anyone downloaded before deletion cannot be recalled. The incident record establishes that the codes belonged to destroyed, single-use identities.
- No live failing browser run was performed.

## Secret scan
I ran gitleaks 8.30.1 `detect --no-git` on a directory holding only this report. Result: 0 findings ("no leaks found"). I re-ran it after adding this line, with the same result.

Verdict: CLEAR
<!-- END REPORT (sha256 9232b59a3e001fcd7ac4841be79d5dc4f49c5c416f3ce85d5c6dbfe655855310) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/686-e77a-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 82502b1455d2dd697706e25a2143068d5271c2f216d8998254e090077eee9a92) -->
# PR #686 delta ordinary review (f0b45105..e77aa549)

Reviewer model: Claude Sonnet (fresh independent ordinary-review context)
Role: ordinary delta review of the change made in response to my earlier non-blocking findings.

**Reviewed head:** e77aa549f2b2dbf839af83be1d70a3a2fdd02421
**Delta base (previously approved head):** f0b4510596718ed082f63c18c4f242cc33e7de25
**PR base (merge base with origin/main):** 31b98613a24bb799ba46caf1de4357bd0e90a777
Worktree: /Users/heinthura/.codex/worktrees/e2e-secret-redaction/Ticketing.v2 (HEAD confirmed equal to the reviewed head). Read-only; nothing edited, committed or pushed there.

## Files examined
- `git diff f0b45105..e77aa549`: one file, apps/web/src/test/e2e-secret-redaction.test.ts (+29/-10).
- Marker presence in every .ts under apps/web/e2e and tests/e2e, and the importers of tests/e2e/helpers/mfa-csrf-app-fixture.ts.

## Commands and counts
- Guard test, equivalent temporary vitest config (the repo config cannot write Vite's temp file in the sandbox; the substitute omits only the unused React plugin): 1 file, 4 tests passed.
- Negative controls on copies under $TMPDIR (worktree untouched), 9 runs (baseline plus controls A-H below).

## Review of the delta
1. Marker `otpauth://` added. Only the two already-guarded specs contain any marker; no helper, visual spec or mock contains `otpauth`, so no false positive in the current tree. The guard test file itself lives in src/test and is not scanned.
2. Import detection. A spec counts if it imports a non-spec .ts helper that itself holds a marker. Current tree: no non-spec helper contains a marker (mfa-csrf-app-fixture.ts only computes a TOTP and does not hold the screen markers), so detection adds nothing today and the set of guarded specs is unchanged (instance-users-journey, mfa-csrf-journey). The `redact-secret-error-context.ts` helper contains no marker literal, so it is not misclassified as a secret helper.
3. Dropping the broader markers is justified. "Set up authenticator", "#factor-password" and "account/security" also appear in visual.spec.ts and visual-screens.json, which render the pre-enrollment mocked screen with no secret; including them would force trace/video/screenshot off on the visual suite, which needs screenshots to do its job. `otpauth://` plus the three post-submit markers target text that only exists once secrets are displayed or driven to completion. The residual gap (a spec that only clicks "Set up authenticator" and reads the URI from the page without the literal `otpauth://`) is narrower than before and is covered by the helper-import path when shared helpers are used.

## Negative controls
| Control | Result |
| --- | --- |
| baseline | 4/4 pass |
| A: new helper containing a marker plus a spec importing it, no guards | FAILS (spec discovered through the import) |
| B: same, import written with an explicit `.ts` extension | FAILS (detected) |
| D: `.d.ts` file containing a marker | ignored, passes (correct) |
| G: helper whose basename contains a dot (`foo.bar.ts`) | FAILS, detected (the unescaped dot acts as a wildcard, harmless) |
| H: new spec literally containing `otpauth://` without guards | FAILS (marker detected) |
| C: single-quoted import of the helper | passes undetected |
| E: transitive chain spec to helper to helper-with-marker | passes undetected |
| F: `.mjs` helper containing a marker | passes undetected |

## Findings
Blocking: none.

Non-blocking:
1. Import detection matches only double-quoted static `from "..."` imports, only one hop, and only .ts files (controls C, E, F). The repo formatter enforces double quotes and e2e helpers are .ts, so this is acceptable; a transitive helper chain is the realistic residual.
2. The helper name is matched by basename only and is not regex-escaped; a collision between same-named helpers in different folders can only cause a false positive (stricter), never a miss. Optional tidy: escape the name.
3. Earlier non-blocking items on comment/dead-code satisfaction of the `test.use` and `afterEach` regexes (previous report) are unchanged and still non-blocking.

## Residual risk
The guard remains a textual tripwire. Redaction still relies on Playwright 1.63 behaviour verified in the previous report. No live failing browser run was performed.

## Secret scan
gitleaks no-git on a directory holding only this report: 0 findings (self-scan result below was confirmed at write time).

Verdict: APPROVE
<!-- END REPORT (sha256 82502b1455d2dd697706e25a2143068d5271c2f216d8998254e090077eee9a92) -->
