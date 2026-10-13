# PR #727 security review record: react-hook-form reset regression guard (#697)

PR #727 adds tests only, with no production code.

- `apps/web/e2e/settings-forms-direct-load.spec.ts` loads three settings forms directly against a mocked backend and asserts that they show the persisted values.
- `apps/web/src/test/form-reset-guard.test.ts` allowlists `register()` users and requires every `reset(values)` call in them to keep field refs.

The e2e directory is a security-review path, so this change needs a security review.

A Claude Sonnet 5.5 lane implemented the change. The conductor (Claude Opus 5.5) merged `main` into it and hardened the guard at `e5c1423a`. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `d827f9af`, with e2e and guard mutations. It noted two guard gaps, which were closed at `e5c1423a`.
- Ordinary delta review by Claude Sonnet 5.5: APPROVE at `e5c1423a`, with three guard mutations.
- Security review by Claude Opus 5.5: CLEAR at `e5c1423a`. Diff scope, e2e isolation, secrets and the auth-redirect spec were run together.
- Mechanical security rebind at `eaacaba2`: CLEAR. This head merges `main` `417944ca` (#726). Its tree equals the merge-tree of `dc480271` with `417944ca`, the changed files are exactly #726's, and there is no interaction with this PR's paths.
- Mechanical security rebind at `77e69d7a`: CLEAR. This head merges `main` `aefb6888` (#722). Its tree equals the merge-tree of `39515633` with `aefb6888`, and the changed files are exactly #722's, with no interaction.

**Reviewed head:** `e5c1423a446a98d88f0388a1c741ce06feb0c40d`
**Reviewed head:** `eaacaba27e0372e9e4d18903af99cf39985f470e`
**Reviewed head:** `77e69d7a3d2cbe90aa7ad86501e78a5e1f5cba88`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `727-ordinary-a-sonnet.md` | Ordinary review A (28481af5..d827f9af) | Claude Sonnet 5.5 | `d827f9af` | APPROVE | `57ae068b637a8ba30acce426547d29820bff5cb6134c507e97ea110b48c5820d` |
| 2 | `727-e5c1-ordinary-delta-sonnet.md` | Ordinary delta review (d827f9af..e5c1423a) | Claude Sonnet 5.5 | `e5c1423a` | APPROVE | `410c92d0cf8f6a5765dc30c373b9f5ae517874f0a1453edf0c5596e08b391cc5` |
| 3 | `727-security-opus.md` | Security review (28481af5..e5c1423a) | Claude Opus 5.5 | `e5c1423a` | CLEAR | `92ecf47356b9c232f937797708260de9ae42b23511c0a7dbec4aaa3a5052cd0f` |
| 4 | `727-eaac-security-rebind-opus.md` | Mechanical security rebind (dc480271..eaacaba2) | Claude Opus 5.5 | `eaacaba2` | CLEAR | `002820ec4535c9395eda9fd4299e184683fe84ba25de70e66d320d910f74dd33` |
| 5 | `727-77e6-security-rebind-opus.md` | Mechanical security rebind (39515633..77e69d7a) | Claude Opus 5.5 | `77e69d7a` | CLEAR | `da097263e6ce28cb4cea7861d5b2c2225dd91765addc8026e1dbb6790271e042` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/727-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 57ae068b637a8ba30acce426547d29820bff5cb6134c507e97ea110b48c5820d) -->
# PR #727 ordinary review (A)

**Reviewed head:** d827f9af919c176a764b5e642a480753bb9b5b92
**Model:** Claude Sonnet 5.5 (claude-sonnet-5-5), fresh independent ordinary-review context; did not author or direct the change.
(Note: the PR body says its implementer was also Sonnet 5.5 in a separate subagent context; this review context is distinct.)

## Audit claim
TRUE. `grep register(` over apps/web/src finds only `components/service-calendar/calendar-details-card.tsx` (`{...form.register("name"|"timezone")}`) and the guard itself. The three settings forms (account/information.tsx, workspace/general.tsx, projects/$projectId/general.tsx) use `FormField` (Controller) with no `register`. The service-calendar hook's three `form.reset(` calls (lines ~131, 184, 270) pass `RESET_KEEP_FIELD_REFS`. Other `form.reset()` calls (create-api-key-dialog, invite modal, verify-otp) are argument-less resets after submit, matching the issue's "probably unaffected".

## Commands and results (scratch worktree at head, frozen-lockfile install, `VITE_API_URL="" pnpm build`)
- Guard: `vitest run src/test/form-reset-guard.test.ts`: 2/2 passed, exit 0.
- E2E: `pnpm exec playwright test e2e/settings-forms-direct-load.spec.ts` (apps/web): 3/3 passed, exit 0.
- Biome check on both new files: exit 0.
- `node scripts/ci/check-ui.mjs --raw-elements`: exit 0.
- CI pickup: `playwright.config.ts` has `testDir: ./e2e`, testIgnore only the two visual specs, so the spec is included. `ci-full.yml` browser-smoke job runs `pnpm test:e2e` after `pnpm build`. Guard runs in the normal web vitest suite.

## Mutation tests
- E2E: added `value=""` after `{...field}` on the workspace name Input, rebuilt, ran: "workspace general" FAILED (Expected "Persisted Workspace", Received ""); the other two passed. Restored with git checkout, tree clean.
- Guard M1: removed `RESET_KEEP_FIELD_REFS` from one service-calendar `reset()`: test 2 FAILED as intended. Restored.
- Guard M2: changed the constant to `{ keepFieldsRef: false }`: guard still PASSED (gap, see F1). Restored.
- Guard M3: new file with `const { register } = useForm(); <input {...register("a")} />`: test 1 FAILED, but only incidentally because the spread's `...` makes `.register(` match.

## Findings
Blocking: none.

Non-blocking:
- F1: The guard checks only that the text `keepFieldsRef|RESET_KEEP_FIELD_REFS` appears in the reset args, never the constant's value. Setting the constant to `keepFieldsRef: false` passes. Cheap hardening: assert the constant definition contains `keepFieldsRef: true`, or require the inline literal.
- F2: Detection pattern `\.register\(` misses non-spread bare usage such as `const props = register("a")` after destructuring (M3 only caught because of the spread). Suggest `/\bregister\(/` plus an import/`useForm` heuristic, or also flagging destructured `register`.
- F3: `reset()` with no args is skipped by design (fine); a `reset(...)` call whose args are only `{}`-less variable names is still matched by text, so a variable named e.g. `keepFieldsRef` bound elsewhere would pass. Minor.
- F4: The e2e covers only the three Controller forms. The register() form (service calendar) is covered by the existing service-calendar-persisted spec, not this one; the title/body are accurate about that. Mock backend returns `[]` for unknown routes, which is acceptable given the mutation test shows the assertions are live.
- F5: Guard's comment-stripping removes only whole-line `//` comments and block comments; trailing `// ...register(` comments or string literals could cause false positives (failure direction, safe).

## Not checked
Hosted CI, full web suite, typecheck, other e2e specs, behaviour on non-Chromium browsers, security-scope review (PR body says Opus review pending for `apps/web/e2e/**`).

**Verdict:** APPROVE
<!-- END REPORT (sha256 57ae068b637a8ba30acce426547d29820bff5cb6134c507e97ea110b48c5820d) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/727-e5c1-ordinary-delta-sonnet.md; Claude Sonnet 5.5; sha256 410c92d0cf8f6a5765dc30c373b9f5ae517874f0a1453edf0c5596e08b391cc5) -->
# PR #727 ordinary delta review (d827f9af..e5c1423a)

**Reviewed head:** e5c1423a446a98d88f0388a1c741ce06feb0c40d
**Model:** Claude Sonnet 5.5 (fresh independent context; did not author the delta)
**Base compared:** d827f9af919c176a764b5e642a480753bb9b5b92

## Checks
1. Scope: `git diff --stat` shows one file, apps/web/src/test/form-reset-guard.test.ts (+11/-3). No assertion removed or weakened; the register regex is broadened (`\.register\(` -> `\bregister\(`), the reset test gains one conditional assertion.
2. False positives: `grep -rnE "\bregister\(" apps/web/src` (non-test) hits only calendar-details-card.tsx (the allowlisted form.register calls) and two full-line `//` comments in use-service-calendar-editor.ts, which stripComments removes. A comment-only probe file `// call register("x") here` did not fail the guard. Guard passes at head (2/2).
3. Mutations (scratch worktree at e5c1423a, each restored):
   - M1 constant set to `{ keepFieldsRef: false }`: FAILS (new toMatch on the constant).
   - M2 new src/lib file with `const { register } = useForm(); register("x")`: FAILS (allowlist equality).
   - M3 one reset() call changed from RESET_KEEP_FIELD_REFS to `undefined`: FAILS (per-call regex).
   - Extra M4 one call changed to inline `{ keepFieldsRef: false }`: PASSES (see finding).
4. `pnpm exec vitest run src/test/form-reset-guard.test.ts` (apps/web): 1 file, 2 tests passed. `pnpm exec biome check` on the file: clean.
Worktree removed; main checkout untouched.

## Findings
- Both claimed gaps are closed and verified by mutation.
- Non-blocking, pre-existing: per-call regex `/keepFieldsRef|RESET_KEEP_FIELD_REFS/` only checks the token is present, so an inline `{ keepFieldsRef: false }` on a reset call passes. The delta does not worsen this; could be tightened to `keepFieldsRef:\s*true`.
- Non-blocking: the constant pin is conditional on at least one call using the constant (true today, 3 calls). If all calls were inlined, the pin is simply skipped, which is correct.

## Not checked
Full web suite, e2e, CI status.

**Verdict:** APPROVE
<!-- END REPORT (sha256 410c92d0cf8f6a5765dc30c373b9f5ae517874f0a1453edf0c5596e08b391cc5) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/727-security-opus.md; Claude Opus 5.5; sha256 92ecf47356b9c232f937797708260de9ae42b23511c0a7dbec4aaa3a5052cd0f) -->
# PR #727 — independent security review

- **PR:** #727 "test(web): guard react-hook-form reset on direct load (#697)" (branch `codex/forms-reset-keep-fields-ref`)
- **Reviewed head:** e5c1423a446a98d88f0388a1c741ce06feb0c40d
- **Base:** origin/main 28481af5826035d702f705ea599858f27634a84b
- **Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). I did not author, direct or remediate this change.
- **Date:** 2026-10-14
- **Depth:** lightweight. The change is tests only. It is in security scope because of the `apps/web/e2e/**` path.

## Head verification

- `gh pr view 727 --json headRefOid` returned `e5c1423a446a98d88f0388a1c741ce06feb0c40d`. State: OPEN.
- `git rev-parse origin/main` returned `28481af5826035d702f705ea599858f27634a84b`.
- Commits in `28481af5..e5c1423a`: 6fb2127a, then the merge d827f9af, then e5c1423a.
- Scratch worktree: a detached worktree at the exact head under `$TMPDIR`. It was removed after the review. The main checkout was not touched.

## Surfaces examined

- `apps/web/e2e/settings-forms-direct-load.spec.ts` (new, 162 lines). Read in full.
- `apps/web/src/test/form-reset-guard.test.ts` (new, 87 lines). Read in full.
- `apps/web/playwright.config.ts`. Checked testDir, workers, webServer, and whether globalSetup or storageState exist.
- `apps/web/e2e/auth-redirect.spec.ts`, which holds the protected-route redirect test.
- `apps/web/e2e/sla-policy.spec.ts`. Used to compare the capability mock shape.
- `apps/web/src/test/e2e-secret-redaction.test.ts`. This guard was added on main via the merge.
- `apps/web/src/hooks/use-workspace-permission.ts`. Checked the CapabilityMap shape.
- `apps/web/src/hooks/use-service-calendar-editor.ts`. This is the reset owner that the unit guard checks.
- The merge commit d827f9af: diffed against both parents.

## Q1 — Diff scope

- `git diff --stat 28481af5 e5c1423a` shows exactly two files, 249 insertions and 0 deletions:
  - `apps/web/e2e/settings-forms-direct-load.spec.ts` (+162)
  - `apps/web/src/test/form-reset-guard.test.ts` (+87)
- `gh pr view --json files` lists the same two files, both ADDED.
- Merge d827f9af has parents 6fb2127a and 28481af5. Its second parent is exactly the reviewed base.
- `git diff --stat d827f9af^2 d827f9af` shows only the same two files (+162 and +79). So the merge adds nothing beyond main except the PR's own files. The large diff against `d827f9af^1` is main's content coming in.
- No production code changed.

**Result: confirmed.**

## Q2 — Does the e2e spec weaken or bypass e2e security machinery?

- **Protected-route redirect tests.** `auth-redirect.spec.ts` was not modified. The new spec mocks `get-session` with an authenticated session inside its own test-scoped `page`, so it does not affect the logged-out redirect test. I ran the two specs together and both passed (see commands).
- **Auth fixtures.** The spec imports only `@playwright/test`. It does not import `mfa-csrf-app-fixture` or any helper.
- **Global setup.** `playwright.config.ts` has no `globalSetup`. The PR does not change the config.
- **Mock leakage.** The spec registers `page.route("**/api/**")` in `beforeEach` on the per-test `page` fixture. Playwright isolates this per test (new context per test). It is not on a shared context or browser, so it cannot leak into other specs.
- **Shared storage state.** There is no `storageState` anywhere in `apps/web/e2e` or the config. The spec writes nothing to disk.
- **Real credentials or secrets.** None. The values are synthetic: a session token `session-token-forms-e2e`, a CSRF token `e2e`, and the email `persisted.person@example.test` (on the reserved `.test` TLD). The spec has no password fill and no MFA markers. So it is correctly out of scope for the `e2e-secret-redaction` guard, which needs `trace/video/screenshot: off` and `redactSecretErrorContext` only on secret-rendering specs. That guard passes at head.
- **Network to non-local hosts.** The spec has no absolute URLs. Every `/api/**` request is fulfilled locally, and everything else goes to the local preview server at `127.0.0.1:4178` (from the config `baseURL`).
- **Masked failures from running alongside auth specs.** testDir is `./e2e` with `workers: 1`, `retries: 0` and `forbidOnly: true`. The spec uses no `test.skip`, `test.fixme`, `.only`, `expect.soft` or retry changes. Each test runs in its own browser context, so it cannot mask an auth spec failure.

**Result: no weakening found.**

## Q3 — Do the mocked capabilities or fixtures normalise anything misleading?

- The capabilities mock is all-true. It has the same 17-key shape as the existing `sla-policy.spec.ts` mock and matches `CapabilityMap`. The mocked user is consistently an `owner` (workspace list, workspace detail, members), and owners hold these capabilities. So the mock does not grant controls the mocked role would not have.
- The spec asserts only that persisted values appear in `input[name=...]` fields. It does not assert that any control is visible or enabled, and makes no claim about permission-gated UI. So it does not establish "UI shows controls without capabilities" as expected behaviour.
- The catch-all `route.fulfill(json([]))` returns 200 `[]` for any unmapped API path. This is acceptable for a test of rendered values. It is not a security assertion.
- Optional `bindProjectOrganisation` (added on main) is absent from the mock. It defaults to false, which is the safe direction.

**Result: nothing misleading.**

## Q4 — Commands and results

| Command (worktree at e5c1423a) | Exit | Result |
| --- | --- | --- |
| `gitleaks dir <copy of the 2 files> --no-banner -v` | 0 | no leaks found (~8.15 KB) |
| `gitleaks git . --log-opts="28481af5..e5c1423a"` | 0 | no leaks found (~8.34 KB) |
| `pnpm install --frozen-lockfile --prefer-offline` | 0 | — |
| `pnpm exec vitest run src/test/form-reset-guard.test.ts src/test/e2e-secret-redaction.test.ts` (apps/web) | 0 | 2 files, 17 tests passed |
| Mutation: `keepFieldsRef: true`→`false` in `use-service-calendar-editor.ts`, plus a new non-allowlisted file calling `register(...)`, then rerun the guard | non-zero (expected) | both guard tests failed. The guard is not vacuous. Mutations reverted, and `git status` was clean afterwards. |
| `pnpm exec turbo run build --filter=@taskdesk/web` | 0 | dist/agent and dist/portal built. A bare `pnpm build` first failed only because workspace package `@taskdesk/permissions` had not been built in the fresh worktree. That is an environment issue, not a PR issue. |
| `pnpm exec playwright test e2e/settings-forms-direct-load.spec.ts` (apps/web, own local preview server, after the full build) | 0 | 3 passed (account information, workspace general, project general) |
| `pnpm exec playwright test e2e/settings-forms-direct-load.spec.ts e2e/auth-redirect.spec.ts` | 0 | 4 passed. The redirect test is unaffected. |

An earlier Playwright run against the partial build also passed 3 out of 3. It is superseded by the run after the full build above.

No Docker was used.

## Findings

- **Blocking:** none.
- **Non-blocking:**
  1. The e2e spec covers the three `<Controller>`/`<FormField>` forms. It does not cover the one allowlisted `register()` form (service calendar details). That form's direct-load behaviour is covered by the existing `service-calendar-persisted.spec.ts` (not re-run here) and by the unit guard. This is a coverage note, not a security issue.
  2. The unit guard uses regex and string scanning (`\bregister\(`, `.reset(` with paren matching). Unusual call shapes, such as an aliased `register` or `reset` passed indirectly, could evade it. This is acceptable for a regression tripwire. It has no security impact.

## Residual risk / not checked

- I did not run the full e2e suite or CI. Results cover only the two new files and the auth-redirect spec run alongside them.
- I did not re-run `service-calendar-persisted.spec.ts`.
- I did not check GitHub status checks for the head. That is the orchestrator's job before merge.
- The production code paths under test were not changed by this PR, so the residual security risk from the change itself is negligible.

**Verdict:** CLEAR
<!-- END REPORT (sha256 92ecf47356b9c232f937797708260de9ae42b23511c0a7dbec4aaa3a5052cd0f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/727-eaac-security-rebind-opus.md; Claude Opus 5.5; sha256 002820ec4535c9395eda9fd4299e184683fe84ba25de70e66d320d910f74dd33) -->
# PR #727 — security exact-head rebind (mechanical merge of main #726)

**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is a fresh, independent context. I did not author, direct or remediate #727 or #726.
**Reviewed head:** eaacaba27e0372e9e4d18903af99cf39985f470e
**Prior CLEAR head:** dc48027125443885f6e6b66f2bd7a480c013ca71 (e5c1423a, CLEAR, plus the review-note commit)
**Main merged in:** 417944ca57844d02de1590fbed82633a476f4665 (merge of #726; first parent 28481af5)
**Method:** read-only. A blobless bare clone in the scratchpad. No worktree was modified. No test suites were run, and no Docker was used.

## Commands and outputs

```
$ git ls-remote origin refs/heads/main refs/pull/727/head        (at the start and again at the end)
417944ca57844d02de1590fbed82633a476f4665  refs/heads/main
eaacaba27e0372e9e4d18903af99cf39985f470e  refs/pull/727/head
$ gh pr view 727 --json headRefOid  -> eaacaba27e0372e9e4d18903af99cf39985f470e (codex/forms-reset-keep-fields-ref)

$ git rev-list --parents -n1 eaacaba2
eaacaba27e0372e9e4d18903af99cf39985f470e dc48027125443885f6e6b66f2bd7a480c013ca71 417944ca57844d02de1590fbed82633a476f4665

$ git rev-parse eaacaba2^{tree}                      -> 282adb544589e8e8a5854536eb47a7ee4f737e16
$ git merge-tree --write-tree dc480271 417944ca     -> 282adb544589e8e8a5854536eb47a7ee4f737e16   (identical)

$ git merge-base dc480271 417944ca                  -> 28481af5826035d702f705ea599858f27634a84b
$ git diff --name-only dc480271 eaacaba2  vs  git diff --name-only 28481af5 417944ca
35 files each; diff of the two lists is empty -> IDENTICAL

$ git diff --name-only 417944ca...eaacaba2   (#727's own files)
apps/web/e2e/settings-forms-direct-load.spec.ts
apps/web/src/test/form-reset-guard.test.ts
docs/07-planning/security-reviews/727-form-reset-guard.md
-> no path overlap with #726
```

## Interaction review: #726 against #727's two test files

1. **`apps/web/src/test/form-reset-guard.test.ts`** scans every non-test `.ts`/`.tsx` file under `apps/web/src` for `register(`, and requires that set to equal its allowlist.
   - I grepped #726's web files at the new head. None of them contains `register(`.
   - `general.tsx` contains `useForm` and two `.reset(` calls, but both existed before #726 and the page uses no `register(`.
   - The #726 diff of `general.tsx` and `default-comment-visibility-setting.tsx` adds no `register`, `reset`, `useForm`, `Controller` or `FormField` line.
   - The guard's input set is therefore unchanged from the CLEARed head.
2. **`apps/web/e2e/settings-forms-direct-load.spec.ts`** ("project general" case). #726 adds `<DefaultCommentVisibilitySetting>` to that page, below the `<Form>`.
   - The component returns `null` unless `canManageProjectSettings()` is true, and that reads the new optional `manageProjectSettings` capability.
   - The spec's mocked `/api/capabilities` does not set `manageProjectSettings`, so the component renders nothing in the spec.
   - The asserted `name`, `slug` and `description` inputs are unaffected.
   - The component only reads `project?.…` after that gate, so the mocked data cannot cause a render crash.

## Hosted CI at eaacaba2 (observed; this is not a substitute for the gate)
- 18 checks SUCCESS.
- Integration, visual regression and the performance budgets were IN_PROGRESS.
- `pull request template + security review` was FAILURE. I expect that to be the exact-head review-note check: it should clear once a note recording this head is committed. The orchestrator must confirm every required check is green at the final head before merging.

## Findings
- Blocking: none.
- Non-blocking: none.

## Residual risk / not checked
- I ran no tests, by instruction. A whole-tree `git grep` at the head failed on a network fetch (blobless clone). The `register(` conclusion therefore rests on two facts: the guard passed at the prior CLEARed tree, and the #726 delta adds no `register(`. Hosted CI at the head is the gate.
- If a later review-note commit changes the head, a new exact-head confirmation is needed.

**Verdict:** CLEAR
<!-- END REPORT (sha256 002820ec4535c9395eda9fd4299e184683fe84ba25de70e66d320d910f74dd33) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/727-77e6-security-rebind-opus.md; Claude Opus 5.5; sha256 da097263e6ce28cb4cea7861d5b2c2225dd91765addc8026e1dbb6790271e042) -->
# PR #727 — security exact-head rebind (mechanical merge of main #722)

**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is a fresh, independent context. I did not author, direct or remediate #727 or #722.
**Reviewed head:** 77e69d7a3d2cbe90aa7ad86501e78a5e1f5cba88
**Prior CLEAR head:** eaacaba27e0372e9e4d18903af99cf39985f470e
**Pre-merge head:** 39515633070768a8a2bcc910e226f52b327319ff
**Main merged in:** aefb6888f3d45ad3439c69133ac644f738a70a4a (merge of #722)
**Method:** read-only. A blobless bare clone in the scratchpad. No tests were run and no Docker was used.

## Commands and outputs
```
$ git ls-remote origin refs/heads/main refs/pull/727/head      (at the start and again at the end)
aefb6888f3d45ad3439c69133ac644f738a70a4a  refs/heads/main
77e69d7a3d2cbe90aa7ad86501e78a5e1f5cba88  refs/pull/727/head

$ git rev-list --parents -n1 77e69d7a
77e69d7a... 39515633070768a8a2bcc910e226f52b327319ff aefb6888f3d45ad3439c69133ac644f738a70a4a

$ git rev-parse 77e69d7a^{tree}                     -> bab8f5f4602ebfd29d23d0184f4f06c2851ba831
$ git merge-tree --write-tree 39515633 aefb6888    -> bab8f5f4602ebfd29d23d0184f4f06c2851ba831  (identical)

$ git diff --name-only 39515633 77e69d7a  vs  git diff --name-only 417944ca aefb6888
39 files each -> IDENTICAL; no overlap with #727's own three files

$ git log --oneline eaacaba2..39515633
39515633 docs(security-reviews): bind the main-merge rebind
$ git diff --name-only eaacaba2 39515633
docs/07-planning/security-reviews/727-form-reset-guard.md      (note-only)
```

## Interaction review
1. **`form-reset-guard.test.ts`.** In the #722 diff under `apps/web/src`, no added line matches `\bregister\(`, `\.reset\(` or `useForm` (grep exit status 1). The guard's set of files using `register()` is therefore unchanged.
2. **`settings-forms-direct-load.spec.ts`.** The spec's `goto` targets are only `/dashboard/settings/account/information`, `/dashboard/settings/workspace/general` and `/dashboard/settings/projects/{id}/general`. The new work-item detail page (`agent/work-items/$key`) is never loaded.
   - #722's `use-workspace-permission.ts` change only adds the optional `transitionTasks`/`rankTasks` flags and their accessors. Nothing on the settings pages reads them.

## Findings
- Blocking: none.
- Non-blocking: none.

## Residual risk / not checked
- No tests were run, by instruction. Hosted CI at 77e69d7a is the gate.
- A further head change needs a new exact-head confirmation.

**Verdict:** CLEAR
<!-- END REPORT (sha256 da097263e6ce28cb4cea7861d5b2c2225dd91765addc8026e1dbb6790271e042) -->
