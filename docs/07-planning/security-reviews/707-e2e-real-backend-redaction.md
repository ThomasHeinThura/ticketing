# PR #707 security review record: redact failure snapshots in every real-backend e2e spec

PR #707 closes the defect class found in the #696 security review: Playwright's failure `error-context.md` prints form values, including fixture passwords, as well as visible text.

The PR widens the #686 guard (`apps/web/src/test/e2e-secret-redaction.test.ts`). A spec is now guarded if it contains an MFA marker, imports the real-backend `mfa-csrf-app-fixture` directly or through a helper, or fills a password from a variable. The PR adds the trace/video/screenshot-off settings and the afterEach redaction hook to the nine real-backend specs that lacked them. It also extends the error-fix-loop lesson.

The e2e specs and the CI evidence-upload surface make this PR security-scope.

Authorship:
- **Implementation:** a Claude Sonnet 5.5 lane.
- **Merge of `main` (`4c5013f9`):** the conductor, Claude Opus 5.5.

The reviewers below are fresh, independent contexts that did not author or direct the change.

## Review chain

- Ordinary review by Claude Sonnet 5.5: APPROVE at `4c5013f9`. It forced a real-backend spec to fail after the password fill: the password appears 0 times with the hook and once without it.
- Security review by Claude Opus 5.5: CLEAR at `4c5013f9`. It inventoried every CI upload path and forced failures in two real-backend specs; the password appeared 0 times in artifacts and stdout. It recommends making the rule structural, tracked in #709.

**Reviewed head:** `4c5013f931ad1cb4ec807aa2a144c1177b99df2d`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `707-ordinary-sonnet.md` | Ordinary review (bf23f525..4c5013f9) | Claude Sonnet 5.5 | `4c5013f9` | APPROVE | `b1349dcc34e0034d873bfa69e85965c34cb3a4b98197ba4af2075b7294b417fc` |
| 2 | `707-security-opus.md` | Security review (bf23f525..4c5013f9) | Claude Opus 5.5 | `4c5013f9` | CLEAR | `e078e2d3fe9e42104686427876e1b2174ec0759ac19b381f5bb6dfff25d1102d` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/707-ordinary-sonnet.md; Claude Sonnet 5.5; sha256 b1349dcc34e0034d873bfa69e85965c34cb3a4b98197ba4af2075b7294b417fc) -->
# PR #707 ordinary review (Claude Sonnet 5.5, fresh independent context)

Model: Claude Sonnet 5.5 (claude-sonnet-5-5). Did not author or direct the change.
**Reviewed head:** 4c5013f931ad1cb4ec807aa2a144c1177b99df2d
Base: origin/main bf23f525e047d986780d724340044f94d865b77c (merge-base equals base; branch is up to date with main).
Scratch worktree /Users/heinthura/.codex/worktrees/review-707 created and removed. No Docker containers left (Testcontainers ryuk self-removed; compose containers untouched).

## Files examined
apps/web/src/test/e2e-secret-redaction.test.ts; apps/web/e2e/helpers/redact-secret-error-context.ts; the 9 modified specs (apps/web/e2e/{realtime,work-item-comments-journey}.spec.ts, tests/e2e/{approvals-primary-journey,approver-email-not-leaked,customer-cannot-request-cab,intake-primary-journey,requester-cannot-self-approve,service-operations-primary-journey,users-primary-journey}.spec.ts); already-guarded instance-users-journey / mfa-csrf-journey; all other specs under apps/web/e2e and tests/e2e; helpers; apps/web/playwright*.config.ts; tests/e2e/playwright.approvals.config.ts; implementer notes. docs/04-engineering/error-fix-loop.md lesson line skimmed only.

## Commands and results
- pnpm install --frozen-lockfile; build packages; build api and web: ok.
- vitest run src/test/e2e-secret-redaction.test.ts: 13 passed.
- Full web vitest: 144 files / 630 tests passed.
- playwright --list default config: 33 tests / 13 files (includes approval-withdrawal.spec.ts, which arrived via main); approvals config: 7 tests / 7 files.
- tsc --noEmit -p tests/e2e/tsconfig.approvals.json: ok.
- Negative controls (temp specs, removed): (1) fixture import with no test.use/hook: guard FAILED (correct); (2) getByLabel(/password/i).fill(secret), no hook: FAILED (correct); (3) fixture import + hook but no test.use: FAILED (correct). Gap probes: (4) single-quoted fixture import + template-literal password fill: NOT detected; (5) page.fill("#pw", `pw${...}`) with no fixture import: NOT detected. See N1/N2.
- Real forced failure (Testcontainers, serialized, via withMfaCsrfApp; sign-up form, password filled, then forced expect failure):
  - With test.use off + afterEach hook (({browserName:_browserName}, testInfo)): error-context.md contains "Page snapshot omitted because this workflow displays authentication secrets."; generated 48-char password occurs 0 times; no trace/video/screenshot artifacts in test-results.
  - Control without hook (same spec): password occurs 1 time in the textbox snapshot (confirms the N1 leak and that the test is non-vacuous).
  - Hook with only browserName destructured works without a page fixture.

## Spec classification (apps/web/e2e, tests/e2e)
| Spec | Backend | Fills credentials | Guard catches | Hook+test.use present |
|---|---|---|---|---|
| web realtime | real | var | yes (fixture, pw) | yes (added) |
| web work-item-comments-journey | real | var | yes | yes (hook added) |
| web instance-users-journey | real | var | yes | yes (pre-existing) |
| web mfa-csrf-journey | real | var | yes | yes (pre-existing) |
| tests intake-primary-journey | real | var | yes | yes (added) |
| tests users-primary-journey | real | var | yes | yes |
| tests service-operations-primary-journey | real | var | yes | yes |
| tests approvals-primary-journey | real, API only (no page/goto) | no | yes (via approval-runtime -> fixture) | yes |
| tests approver-email-not-leaked | real, API only | no | yes (helper) | yes |
| tests customer-cannot-request-cab | real, API only | no | yes (helper) | yes |
| tests requester-cannot-self-approve | real, API only | no | yes (helper) | yes |
| web auth-redirect | mocked (route) | no fill (visibility/type toggles only) | no (correct) | n/a |
| web approval-withdrawal | mocked | no | no (correct) | n/a |
| web god-mode-users | mocked | no | no (correct) | n/a |
| web task-properties-version-freshness | mocked | no | no | n/a |
| web task-properties-board-smoke | mocked fixture | no | no | n/a |
| web work-item-create-dialog / work-item-list-layout | mocked fixture | no | no | n/a |
| web performance-api-fixture / performance-paint-recorder | mocked | no | no | n/a |
| web visual.spec.ts | mocked | literal "visual-enrollment-password" | no (correct: literal) | n/a |
| web performance.bench.ts | mocked | literal | no (correct) | n/a |
| web storybook-visual / performance.initial-page-diagnostic.ts | static / mocked | no | no | n/a |
No real-backend spec is missed today; no mocked spec is wrongly forced. The 4 API-only approvals specs are over-included (harmless; no page snapshot is generated for them anyway).

## Config interaction
Per-file test.use is placed before all tests in every guarded spec (lines 6-27 vs first test) and overrides the default config trace: "retain-on-failure". Approvals config already has everything off. Perf/visual/storybook configs only match unguarded mocked specs.

## Findings
- N1 (non-blocking): Guard import detection is syntactic: `from\s+"[^"]*/mfa-csrf-app-fixture(\.ts)?"` (e2e-secret-redaction.test.ts:44). Single-quoted imports, `.js/.mjs` suffixes, dynamic import() and require() of the fixture are not matched (probe 4). Currently safe because biome enforces double quotes and all specs use plain `from "..."`. Possible hardening: broaden the regex, or also check for the fixture symbol names (withMfaCsrfApp).
- N2 (non-blocking): PASSWORD_FILL (line 39) requires a letter/`_`/`$` after `.fill(`, so a template-literal or string-concatenated password, or `page.fill("#pw", value)` with a selector not containing "password", is missed when the spec does not also import the real-backend fixture (probe 5). All real-backend specs use the fixture, so this is only a future-proofing gap.
- N3 (non-blocking, informational): The guard asserts the presence of the afterEach text and test.use but not that they are at file scope or that the hook cannot be skipped (e.g. inside test.describe.skip). Static check only; the real failure run above shows the shipped hooks do work.
- N4 (non-blocking): Implementer notes cite default list 30 tests/12 files; current is 33/13 only because main added approval-withdrawal.spec.ts (mocked, unaffected). Not a defect.
No blocking findings.

## Residual risk
- Failure contexts only verified for a sign-up form fill in one spec; other specs rely on the same hook and the static guard. Timeouts and failures thrown inside the hook itself, and errors raised after afterEach (fixture teardown), were not exercised.
- Redaction depends on Playwright's testInfo.errors[].errorContext being the writer input for error-context.md for the installed version; verified empirically here, but a Playwright upgrade could change it (the redaction test only exercises the helper on fake objects).
- Logs/stdout/console and withMfaCsrfApp's own diagnostics were not audited for secrets (out of scope per PR #686).
- Whole-suite Playwright runs of the other 8 modified specs were not executed.

## Verdict
APPROVE
<!-- END REPORT (sha256 b1349dcc34e0034d873bfa69e85965c34cb3a4b98197ba4af2075b7294b417fc) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/707-security-opus.md; Claude Opus 5.5; sha256 e078e2d3fe9e42104686427876e1b2174ec0759ac19b381f5bb6dfff25d1102d) -->
# PR #707 security review

Model: Claude Opus 5.5 (claude-opus-5-5), fresh independent security-review context. I did not author, direct or remediate this change. I did not edit, push, comment on or merge the branch.

**Reviewed head:** 4c5013f931ad1cb4ec807aa2a144c1177b99df2d
**Base:** origin/main bf23f525e047d986780d724340044f94d865b77c. The merge base equals the base.
Both were confirmed with `git ls-remote https://github.com/ThomasHeinThura/ticketing` (`refs/pull/707/head`, `refs/heads/main`). SSH ls-remote failed in the sandbox. `gh` failed TLS verification, so issue #689 was not read live.

Scratch worktree: /Users/heinthura/.codex/worktrees/review-707-sec, detached at the head. Created, used, then removed with `git worktree remove`. The review worktree stayed clean at the head.

Read first: 707-ordinary-sonnet.md, e2e-real-backend-redaction-impl-sonnet.md, 686-security-opus.md, 696-security-opus.md (N1/N1a).

## Surfaces examined
- The full diff `bf23f525...4c5013f9`: 11 files, +114/-18.
- apps/web/src/test/e2e-secret-redaction.test.ts and apps/web/e2e/helpers/redact-secret-error-context.ts.
- All 9 modified specs, plus the already-guarded instance-users-journey and mfa-csrf-journey.
- All Playwright configs: apps/web/playwright{,.visual,.storybook,.perf,.perf-diagnostic}.config.ts and tests/e2e/playwright.approvals.config.ts.
- .github/workflows/ci-full.yml, ci-fast.yml and release.yml.
- tests/e2e/helpers/{mfa-csrf-app-fixture,approval-runtime}.ts, and intake-primary-journey's network journal and page diagnostics.
- PR #696 head 56ce39e5: service-calendar-persisted and sla-policy-persisted specs, fetched read-only.

## Upload-path inventory

| Workflow / artifact | Path | Command and config | Specs that feed it | Real-backend specs |
|---|---|---|---|---|
| ci-full `playwright-smoke` (always) | apps/web/test-results/ | `pnpm test:e2e` → playwright.config.ts (testDir e2e, ignores visual and storybook-visual, trace retain-on-failure, reporter list) | All 13 files in `--list`: approval-withdrawal, auth-redirect, god-mode-users, instance-users-journey, mfa-csrf-journey, performance-api-fixture, performance-paint-recorder, realtime, task-properties-board-smoke, task-properties-version-freshness, work-item-comments-journey, work-item-create-dialog, work-item-list-layout | realtime, work-item-comments-journey, instance-users-journey, mfa-csrf-journey. All four have file-level `test.use` (trace, video and screenshot off) and the redaction afterEach. #696 adds two more; both already carry the hook at 56ce39e5. |
| ci-full `playwright-a11y` (always) | apps/web/test-results/ | playwright.config.ts `--grep @a11y` | Only auth-redirect carries @a11y | none |
| ci-full `playwright-visual` (always) | apps/web/test-results/ | visual config (visual.spec.ts) and storybook config | visual.spec.ts and storybook-visual.spec.ts, mocked or static | none |
| ci-full `playwright-performance` (always) | apps/web/test-results/ | perf config (performance.bench.ts; trace retain-on-failure with screenshots and attachments) | performance.bench.ts, mocked with fixed fake tokens | none |
| ci-full `g11-initial-page-diagnostic` | one JSON file | perf-diagnostic config | performance.initial-page-diagnostic.ts, mocked; network summary | none |
| release `release-sboms` | taskdesk-*.cdx.json | — | — | n/a |
| ci-fast | no upload-artifact step | Installs Chromium for check:tokens only | — | n/a |

Other channels:
- **Reporters.** Every config uses `reporter: "list"`. There is no HTML, JSON or blob report, and no workflow overrides the reporter or sets `PLAYWRIGHT_LIST_PRINT_STEPS`.
- **Attachments.** No spec calls `testInfo.attach`. The fixed `page.screenshot` calls in real-backend specs are taken on non-secret screens (as in the #686 analysis). intake-primary-journey writes its screenshots to `fixture.fixtureDir`, not test-results.
- **Network and console capture.**
  - intake-primary-journey journals host, path, method and status only, into a 0600 file in the fixture directory.
  - realtime's `response` listener is in-memory.
  - The G11 network capture is mocked-only.
- **tests/e2e specs.** They run only under playwright.approvals.config.ts (`pnpm test:e2e:approvals`). No workflow invokes that config, and its outputDir (repo-root test-results/approvals-e2e) is outside every upload path.

**Conclusion.** At this head, I found no real-backend spec that can put a credential, session token, cookie, MFA secret, or reset or invite token into an uploaded artifact through a page snapshot, trace, video, screenshot or report. The one remaining channel is assertion `error.message` (S3), and it is not uploaded today.

## Tests and reproductions run
- `pnpm install --frozen-lockfile` and `pnpm build`: ok.
- Guard test: `vitest run --config vitest.config.ts src/test/e2e-secret-redaction.test.ts` gave **1 file, 13 tests passed**.
- Bypass probes. Each was a temporary file in the scratch worktree, removed afterwards:
  - (a) `zz-probe-a.test.ts`: imports the fixture and fills `f.password`, with no hook. The guard stayed green at 13 tests. **Playwright's default config does collect it**: `--list` showed 34 tests in 14 files. The guard does not see it. (S1)
  - (b) Dynamic `await import(".../mfa-csrf-app-fixture")` with `.fill(f.password)`: not detected. (S2)
  - (c) A spec driving an external URL with a credential from env: not detected. Expected, since no heuristic can see it. (S2)
  - (d) A nested `test.describe` with `test.use({ trace: "on" })`: **Playwright 1.63 refuses it at load time** ("Make it top-level in the test file or put in the configuration file"). #686 finding 1's nested-override evasion is therefore not reachable. A second top-level `test.use` still is. (S4)
- Forced real failures. Testcontainers, default config, `--workers=1`, run serially one at a time, in the scratch copy only. The generated 48-character fixture password was written to a temp file outside test-results so it could be searched for.
  1. **realtime.spec.ts.** After the sign-up password fill, a forced `expect(locator).toBeVisible()` failure, which exercises the matcher ARIA snapshot path.
     - With the PR's hook: test-results held only `.last-run.json` and `error-context.md`. The snapshot section read "Page snapshot omitted…". **Password: 0 hits** in artifacts, 0 in stdout.
     - Control, with the hook body disabled: the password appeared **1 time** in `error-context.md`, as `textbox "Password": <value>`.
  2. **work-item-comments-journey.spec.ts.** After the sign-up password fill, a forced `expect(1, msg).toBe(2)`, which exercises the automatic page snapshot at fixture teardown.
     - With the hook: same artifact set, snapshot omitted. **Password: 0 hits** in artifacts and stdout.
     - Control without the hook: the password appeared **1 time**, in the `[active]` Password textbox.
  - Both controls prove the test is non-vacuous. The `({ browserName: _browserName }, testInfo)` hook works for specs using the `browser` fixture (realtime, manual contexts) and the `page` fixture (comments).
- Docker:
  - Testcontainers' ryuk reaped the containers from my runs.
  - After my runs, a postgres:18-alpine and ryuk pair, with session 9cf3b8cd…, appeared. They were created after my last run had finished, so they belong to another lane. I left them alone.
  - The `taskdesk-*` compose containers were untouched.

## Findings

### Blocking
None.

### Non-blocking
- **S1. File classification is narrower than what Playwright collects.**
  - Location: apps/web/src/test/e2e-secret-redaction.test.ts:26,29.
  - `tsFiles` reads only `.ts`, and `isSpec` treats only `*.spec.ts` and `*.bench.ts` as specs.
  - The default config's testMatch also collects `*.test.ts`, `.js/.mjs` and `.tsx` files under apps/web/e2e. Probe (a) showed such a file runs in the `playwright-smoke` job and is never checked. The guard instead treats it as a "helper".
  - No such file exists today.
- **S2. Content heuristics can be bypassed.**
  - Locations: e2e-secret-redaction.test.ts:39 (`PASSWORD_FILL`), 43-44 (`importsModule`), and 14-19 (markers).
  - Probe (b) confirmed the ordinary reviewer's N1/N2: dynamic import, single-quoted or `.js` specifiers, and a member-access or template argument all evade it. A real-backend spec that does not use the fixture at all, such as an env-driven UAT or external URL, can never be detected.
  - Real risk today is low. Every current real-backend spec uses static double-quoted fixture imports, biome enforces double quotes, and the guard is paired with mandatory review.
  - The residual is accidental omission by a future spec, not deliberate evasion.
- **S3. The `error.message` channel is still unredacted.** This is #686 finding 3, still open; see issue #689.
  - Location: tests/e2e/users-primary-journey.spec.ts:87-89. `statusText` puts the full response body in the assertion message.
  - At :187-190 it is used on `/api/auth/two-factor/enable`, whose body carries the TOTP URI and all backup codes. At :269-274 it is used on the raw-API-key request; the 403 body itself carries no key.
  - `redactSecretErrorContext` replaces only `errorContext`. The message reaches error-context.md "Error details" and the list-reporter log.
  - It is not uploaded today, because the approvals config is not run in CI. But it would leak the moment that config is wired into CI, which the redaction in this PR could make reviewers believe is safe.
  - Recommend fixing it in the #689 follow-up: drop or mask the body in `statusText` for the enrollment and step-up calls.
- **S4. Informational: #686 finding 1 is partly obsolete.** Nested `test.use({ trace })` is rejected by Playwright 1.63, as probe (d) showed. A comment-only hook, or a second top-level `test.use({ trace: "on" })`, still satisfies the textual guard (lines 103-108).
- **S5. Errors thrown in afterEach or fixture teardown are still unredacted.**
  - This is the #686 residual. I judge it **still acceptable**.
  - Trace, video and screenshot are off, so the only remaining channel is the automatic ARIA snapshot for an error that has no `errorContext`. By teardown, the realtime and intake journeys have closed their manual contexts in `finally`, and the page-fixture journeys are past their sign-up screens.
  - A teardown error on a still-open sign-up form would require the test body itself to have passed while the form was open, which is remote.
  - It should still be covered by the structural rule below, which runs the redaction at the latest possible point.
- **S6. Merge-order note.** The persisted specs in PR #696 import the fixture, so the widened guard catches them, and both already carry the hook at 56ce39e5. Merging #696 after #707 keeps the guard green. Merging #707 after #696 likewise.

## Recommendation on a structural rule
Make the rule structural **in a follow-up, not in this PR**. This PR closes every known real-backend leak path, and both reproductions confirm it. Its heuristic gaps (S1 and S2) affect only hypothetical future files. Blocking now would delay a real fix for a future-proofing improvement.

The follow-up should:
1. **Enumerate files by config, not content.** Build the guarded set from `playwright test --list --reporter=json` for playwright.config.ts and playwright.approvals.config.ts, the two configs that can reach a real backend. Require the hook and the file-level `test.use` in **every** collected file, with no heuristics. Mocked specs pay four harmless lines.
   - Alternatively, make it opt-out: an explicit `// e2e-mocked-only` marker that a reviewer must approve.
   - This removes S1 and S2 entirely.
2. **Set the defaults in config.** Set `trace`, `video` and `screenshot` to `"off"` in playwright.config.ts `use`. The four uploaded real-backend specs already override to off, so nothing is lost for them, and mocked specs keep their explicit screenshots.
   - Make the guard reject any `trace`/`video`/`screenshot` value other than `"off"` anywhere in a collected file. This closes S4.
3. **Close the message channel (S3)** under #689. Ban assertion messages built from response bodies in real-backend specs, with a guard regex on `expect(…, body)` patterns or a shared masked `statusText` helper.
4. **Add a Playwright-upgrade canary.** Keep one permanent failing-on-purpose canary, run in a separate guard job, that asserts error-context.md has no known injected value. The redaction depends on 1.63 internals: `errorContext` suppressing the snapshot, and afterEach running before teardown.

A global auto-fixture or a scrubbing reporter is not recommended. Auto-fixture teardown order relative to context close is less obvious than afterEach. A reporter runs after error-context.md has already been written.

## Residual risk
- No CI run was observed. The upload inventory comes from the workflow source at this head.
- Only two of the nine modified specs were exercised live. The others rely on the identical hook text, which the guard verifies. The tests/e2e specs are not uploaded.
- Issue #689 was not read live, because `gh` failed TLS.

## Secret scan
I ran gitleaks 8.30.1 `detect --no-git` on a copy of this report in its own directory. Result: 0 findings ("no leaks found").

## Verdict
CLEAR
<!-- END REPORT (sha256 e078e2d3fe9e42104686427876e1b2174ec0759ac19b381f5bb6dfff25d1102d) -->
