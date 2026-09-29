# Security review — PR #500 OpenAI-first model policy

**Reviewer:** GPT-6 Sol, fresh independent context. Did not author, direct, edit, or remediate the candidate.
**Verdict:** CLEAR WITH FINDINGS on the full pass; the sole LOW documentation finding was resolved and independently confirmed on the final candidate head.
**Reviewed head:** `9c73aedc81ba01ea7b17f22e302c6581c90f0586`

## Scope and method

This is a security/control-plane change because it changes the model value accepted by the
security-review CI gate. I inspected the complete candidate diff against
`b7ec505adf332e145cf8f3323f5b5d986c688335`, the security-scope parser/checker, review-note
binding logic, model probes, PR template authority logic, active operating documents, and the
cutover instructions for already-open security-scope PRs.

The security-scope parser returned the same 42 entries at base and candidate. The checker
accepts only the exact canonical label `GPT-6 Sol`. Positive and negative probes cover the
valid Sol case and rejection of `GPT-6 Luna`, `Opus 5.5`, blank, `n/a`, and `pal-mcp`.

## Findings

- **LOW — resolved:** The first full pass found `docs/04-engineering/error-fix-loop.md` called
  reviewer capacity the “third absolute”, while the migrated workflow lists two absolutes.
  Commit `9c73aedc81ba01ea7b17f22e302c6581c90f0586` changes the wording to “reviewer-capacity
  rule”. A fresh independent GPT-6 Sol delta review confirmed the wording and confirmed the
  unchanged gate code remains covered by the full pass.

No unresolved security finding remains.

## Control checks

- Required security review section and committed-note requirement remain fail-closed.
- Exact-head binding remains enforced; only review-note commits may follow the declared
  reviewed head.
- Removing the optional sampled Opus section passes when security evidence is valid;
  removing the required security-review section fails.
- Review counts, reviewer independence, waiver authority, branch protection, and phase
  finalizer requirements remain intact.
- The status transition requires each still-open security-scope PR to receive a fresh exact-head
  GPT-6 Sol review and updated body/note before merge. Opus 5.5 is not a fallback.
- Historical review records were not rewritten.

## Tests and evidence

- `pnpm test:ci-scripts` on Node 24: **851 passed, 0 failed**, 110 suites.
- `pnpm lint:ci`: passed across 1,582 files; 117 warnings, no lint errors.
- `pnpm typecheck`: **9/9 tasks passed**.
- `pnpm test:all --list`: CI/document reconciliation passed; 38 declared gates, with G4/G8/G11
  still disabled pending their separate P0 implementation.
- Relevant security/template probes: **50 passed, 0 failed**.
- `pnpm check:vocabulary`, `pnpm check:reviews`, `pnpm check:skips`, and `git diff --check`:
  passed.

**Residual:** At review time the candidate did not yet have a pull request, so this pass could not
inspect its live PR body. The PR body must name GPT-6 Sol and link this committed note before the
template check can pass.
