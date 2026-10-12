# Password label association — independent ordinary reviews

**Reviewed head:** 1a9d02ca96b6d49d0dcd9222abd9e9468c8b47c9

Two fresh independent ordinary contexts cleared the four-file form/test candidate. Trusted local session metadata records `gpt-6-luna` for both contexts; the authentic reports retain their own platform-visible identity statements unchanged. This framing does not rewrite either report or make a security waiver. These paths match no authoritative security-scope glob and change no authority behavior.

## Ordinary review A

# PR #668 ordinary review A — password label association

**Candidate SHA:** `1a9d02ca96b6d49d0dcd9222abd9e9468c8b47c9`
**Comparison base:** `44fa25f08271e6e6ad30da7fa0e2d3ec0bc1e4eb`
**Reviewer model:** GPT-6 (platform-reported; this context cannot truthfully claim GPT-6 Luna)
**Role:** Independent ordinary code review
**Context / independence:** Fresh delegated reviewer context; did not author, direct, or remediate this change.
**Scope:** All four changed files: sign-in/sign-up forms and their adjacent component tests. Read repository agent workflow, operating guide, auth architecture, UX quality gate G4, and CI security-path policy.

## Checks performed

- Inspected the exact base-to-candidate diff and current candidate source.
- Ran `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/auth/sign-in-form.test.tsx src/components/auth/sign-up-form.test.tsx`: **2 files passed, 2 tests passed**.
- Ran `git diff --check 44fa25f08271e6e6ad30da7fa0e2d3ec0bc1e4eb 1a9d02ca96b6d49d0dcd9222abd9e9468c8b47c9`: clean.

## Findings

No blocking or non-blocking findings.

In both forms, `FormControl` now directly contains the `Input`, allowing the shared form primitive to attach its generated input id and error accessibility attributes. The positioning wrapper and visibility-toggle sibling remain around that control, so the toggle is not treated as the controlled input. The focused tests exercise label-to-input association before and after toggling visibility; signup also exercises invalid-password state and checks that the error id remains in `aria-describedby`. The changes do not alter auth calls, payloads, navigation, route policy, or authorization semantics.

The changed paths do not match the authoritative security-review path globs in `docs/04-engineering/ci-cd.md`, and inspection found no authority or gate-semantics change. This is an ordinary UI correctness/accessibility fix; no security-path exemption or waiver is being asserted.

## Verdict

**APPROVE** at `1a9d02ca96b6d49d0dcd9222abd9e9468c8b47c9` for the reviewed source scope. This is one ordinary review only and does not assert overall PR acceptance or completion of any other gate.

## Ordinary review B

# PR 668 password label review B

- **Reviewed head:** `1a9d02ca96b6d49d0dcd9222abd9e9468c8b47c9`
- **Comparison base:** `44fa25f08271e6e6ad30da7fa0e2d3ec0bc1e4eb`
- **Reviewer role:** Fresh independent ordinary reviewer B (Luna tier)
- **Independence:** I did not author, direct, or remediate this candidate. This review ran in a separate context assigned by the conductor.
- **Model identity:** GPT-6 family as platform-visible in this context; exact serving variant is not exposed here. I do not claim a GPT-6 Luna variant.
- **Scope:** Four changed files only: sign-in/sign-up password form components and their focused component tests. Checked native label/input association, input-node preservation while showing/hiding, validation error accessibility, and scope.

## Findings

No blocking or non-blocking findings.

Both components now put the shared `FormControl` directly on the password `Input`. `FormControl` supplies the generated input `id` and the `aria-invalid`/`aria-describedby` state; `FormLabel` uses that same generated id as `htmlFor`. This avoids the prior structure where the control slot targeted a wrapper instead of the input. The show/hide button remains a separate `type="button"`, and only the input's `type` changes, so React preserves the same input node and its field state. The signup regression test checks that the same labelled input survives the toggle and that a short-password validation error is referenced by `aria-describedby`. The sign-in test checks the same label and node-preservation behavior.

No unrelated behavior or files were changed. No authorization, tenancy, secret-handling, or CI/gate semantics are implicated by this diff.

## Checks actually run

Command: `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/auth/sign-in-form.test.tsx src/components/auth/sign-up-form.test.tsx`

Result: **2 test files passed; 2 tests passed.** Vitest emitted the existing Vite `__dirname` config-loader warning; it did not affect the run.

Also inspected the `FormControl`/`FormLabel` implementation in `packages/ui/src/components/form.tsx`, the candidate diff, repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/07-planning/active-mission.md`, `docs/07-planning/decision-log.md`, and the identity feature spec. No full suite, build, browser, or Docker checks were run, as scoped by the assignment.

## Residuals and verdict

This is a source review plus the two focused component tests. Browser verification and broader UI checks were not performed and are outside this review assignment.

**Verdict: CLEAR** for this ordinary review scope at the exact head above.


## Shared Input invalid-state correction

**Reviewed head:** a71a78cdfded583c56aee98e19052e5770579e32

Two fresh independent ordinary contexts clear the two-file followup. Stored turn_context metadata verifies gpt-6-luna for both; original reports are preserved unchanged. Review A initially saved its owned untracked report under the repository; root moved only that file to the private evidence path without changing bytes. Its stated unavailable E12 receipt limitation remains historical; review B inspected the correctly located evidence and ran focused checks. Rendered computed-style/browser proof and baseline disposition remain required, with no acceptance inferred from these source reviews.

### Ordinary followup A

# PR 668 follow-up — invalid shadow selector review A

**Reviewed head:** `a71a78cdfded583c56aee98e19052e5770579e32`
**Comparison base:** `7ad012499012b0a094e5cad2629dbafca4e06486`
**Accepted product base:** `44fa25f08271e6e6ad30da7fa0e2d3ec0bc1e4eb`
**Reviewer model:** GPT-6 (platform-visible family; exact serving variant is not exposed in this context)
**Role:** Independent ordinary review A
**Independence:** Fresh review context; did not author, direct, or remediate the change.
**Scope:** The two-file follow-up delta in `packages/ui/src/components/input.tsx` and `packages/ui/src/styles/pairs.json`; prior four-file product review coverage remains the accepted record at the accepted product base.

## Checks performed

- Inspected the exact follow-up diff from parent `7ad012499012b0a094e5cad2629dbafca4e06486` to head `a71a78cdfded583c56aee98e19052e5770579e32` and compared the cumulative candidate to accepted product base `44fa25f08271e6e6ad30da7fa0e2d3ec0bc1e4eb`.
- Confirmed the follow-up changes only the shared input shadow-suppression selector and regenerates path references in `pairs.json`; that file's diff is 16 insertions and 16 deletions. Parsed `pairs.json` successfully (418 records; four records contain the two affected form paths).
- Ran `git diff --check 7ad012499012b0a094e5cad2629dbafca4e06486 a71a78cdfded583c56aee98e19052e5770579e32`: clean.
- Reviewed the available E12/668 input-invalid-shadow-fix receipt reference from the assignment. The receipt artifact itself was not present in this worktree and could not be independently opened here.
- No tests, builds, or browser checks were run in this review.

## Findings

No blocking or non-blocking findings in the follow-up delta.

The changed selector is on the input-control wrapper. Its `:has([aria-invalid=true])` alternative matches a descendant whose value is the literal string `true`; `[aria-invalid=false]` does not suppress the wrapper shadow. The other alternatives retain the existing behavior: a disabled descendant or a `:focus-visible` descendant suppresses the shadow. The focus ring selectors, invalid border/ring selectors, disabled opacity, and dark-mode selectors are unchanged. The 16 `pairs.json` line changes update the two moved button paths in the same four derived records; no pair categories, source alignment, thresholds, or record shape changed.

## Residuals

The previously reported hosted G8 password-border delta and four stale static occurrences remain documented in `E12/668-final` at the prior parent head; this review did not reproduce or resolve them. Root-owned browser/computed-style verification and a new baseline remain pending. This review does not claim those checks or the unavailable E12 receipt artifact.

## Verdict

**CLEAR** for the two-file follow-up delta at `a71a78cdfded583c56aee98e19052e5770579e32`. This report does not claim browser acceptance, overall PR acceptance, or completion of other gates.

### Ordinary followup B

# Independent ordinary review B — input invalid-shadow follow-up

- **Model:** GPT-6 Luna (review assignment; exact runtime model identifier was not exposed in this agent context)
- **Role:** Fresh independent ordinary reviewer, review B
- **Context:** `/root/review668_invalid_shadow_b_luna`, dispatched by the orchestrating session; no author/fixer conversation inherited
- **Candidate:** `a71a78cdfded583c56aee98e19052e5770579e32`
- **Parent:** `7ad012499012b0a094e5cad2629dbafca4e06486`
- **Comparison base:** `44fa25f08271e6e6ad30da7fa0e2d3ec0bc1e4eb`
- **Independence:** I did not author, direct, or remediate this candidate. I used its receipt as evidence location/context only and verified the source and diff directly.

## Scope and checks

Reviewed the exact parent-to-candidate delta in:

- `packages/ui/src/components/input.tsx`
- `packages/ui/src/styles/pairs.json`

Confirmed the delta changes only those two paths. The input wrapper's shadow suppression now tests `[aria-invalid=true]` while continuing to suppress on disabled and focus-visible descendants. This avoids treating the ordinary `aria-invalid="false"` form-control state as invalid. The manifest hunk mechanically updates four occurrence IDs for the auth form JSX path change already present at the parent; it changes no pair thresholds, colors, ratios, categories, or occurrence counts by intent.

Commands/checks actually run on the exact candidate:

- `pnpm --filter @taskdesk/ui exec vitest run --config vitest.config.ts src/components/input.test.tsx` — 1 file, 4 tests passed.
- `pnpm --filter @taskdesk/web exec vitest run src/components/auth/sign-in-form.test.tsx src/components/auth/sign-up-form.test.tsx` — 2 files, 2 tests passed.
- `node --test scripts/ci/check-contrast.test.mjs` — 52 tests passed, 0 failed.
- `git diff --check 7ad012499012b0a094e5cad2629dbafca4e06486 a71a78cdfded583c56aee98e19052e5770579e32` — passed.
- `git diff --name-only` for the same parent/head — confirmed the two paths above.

## Findings and residuals

No blocking or non-blocking source defect found in the reviewed delta. The selector is a targeted correction for boolean ARIA invalid state and retains the intended disabled/focus-visible suppression conditions. Manifest source-path adjustment is consistent with the candidate source and the contrast-checker test suite passes.

Residual: this review did not run a browser or computed-style check. Therefore it does not establish actual rendered shadow behavior in light/dark themes or confirm the four planned states (pristine false, invalid true, disabled, keyboard focus-visible). It does not clear any broader browser acceptance requirement.

## Verdict

**CLEAR for this exact two-file follow-up delta**, subject to the separate browser evidence still outstanding for rendered computed styles. This is an ordinary code review verdict, not stage acceptance or browser acceptance.

