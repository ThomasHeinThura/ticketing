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

