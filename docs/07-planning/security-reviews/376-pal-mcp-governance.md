# Security review — PR #376 (`pal-mcp` governance, control-plane CODEOWNERS)

**Reviewed head:** `efb29bee3084a3368ba59c2c5d733ea043c34e72`

**Model:** Claude Opus 5.5, fresh independent context (did not author, direct, or remediate
this change).

**Verdict at that head:** REQUEST CHANGES.

**Surfaces examined:** `CLAUDE.md`, `AGENTS.md`, `docs/04-engineering/agent-workflow.md`,
`docs/04-engineering/ci-cd.md`, `.github/CODEOWNERS`, `.claude/agents/pal-reviewer.md`,
`docs/07-planning/decision-log.md`, `docs/07-planning/status.md`, the `protect-main` ruleset
config, repo permissions/collaborator list, `pal-mcp` tool schemas, `scripts/ci/check-pr-template.mjs`,
`.claude/settings.json`.

## Findings and disposition

1. **F1 (HIGH):** the plan to enable "Require review from Code Owners" for six control-plane
   paths does not work — sole collaborator, shared agent `gh` token, no identity boundary for
   GitHub to enforce; flipping it would either brick future control-plane PRs or require a
   bypass actor that defeats all required checks. **Fixed:** toggle plan dropped, not enabled;
   docs corrected to describe CODEOWNERS as documentation only for these paths; decision log
   records the finding as pending Thomas's confirmation.
2. **F2 (MEDIUM-HIGH):** the `coder` panel (GPT-6 Luna judge, DeepSeek member) is not
   independent of PRs authored by GPT-6 Luna or DeepSeek. **Fixed:** explicit rule added in
   `CLAUDE.md`, `agent-workflow.md`, `pal-reviewer.md` — those authors require Sonnet or a
   non-panel reviewer.
3. **F3 (MEDIUM):** the secrets/PII guardrail told reviewers to "check the exact lines,"
   which doesn't match how `pal-mcp`'s tools actually send whole files/diffs. **Fixed:**
   rewritten as a path-scoping rule (never pass dotfiles, home-dir paths, `.env*`, `*.pem`,
   `*.key`, credential files, or a path suggested by content under review).
4. **F4 (LOW-MEDIUM):** stale cross-references remained in `CLAUDE.md` ("all eight") and
   `agent-workflow.md` ("every other subagent is Sonnet", "two Sonnet reviews minimum").
   **Fixed:** all corrected to reflect `pal-mcp` as the default ordinary-review/audit/report/
   alignment tool.
5. **F5 (LOW, non-blocking):** CODEOWNERS doesn't cover `.github/workflows/**`,
   `scripts/ci/**`, `.claude/settings.json`. Given F1, this list is documentation only
   regardless — deferred, not fixed in this PR.
6. **F6 (LOW):** the phase finalizer text didn't require a fresh, non-orchestrating context,
   or say what happens if Opus is unreachable for it. **Fixed:** both added to `CLAUDE.md`'s
   table and `AGENTS.md`'s "Review tiers" section.
7. **F7 (LOW):** `pal-reviewer`'s `chat` tool can write to an arbitrary directory via
   `working_directory_absolute_path`, and `clink` wasn't explicitly named as excluded.
   **Fixed:** both addressed in `pal-reviewer.md` and `CLAUDE.md`.
8. **F8 (LOW for security, blocking for the template gate):** the PR body didn't use the
   required template sections, had a stale claim that `pal-reviewer` has `Bash` (removed in
   an earlier round), and the review-SHA/model-attestation records needed reconciling.
   **Fixed:** PR body rewritten to the template; this note committed; `status.md` corrected.
9. **F9 (LOW):** one decision-log citation named the wrong date for the "router did not work
   out" decision (2026-09-23 instead of 2026-09-15). **Fixed:** citation corrected, and a
   `Supersedes:` line added naming every entry this decision partially supersedes.
10. **F10 (for information):** the `coder` panel's exact composition is configured on
    Thomas's own 9Router gateway and cannot be independently verified from this repo or
    session. **Fixed:** noted explicitly in `CLAUDE.md` rather than stated as simple fact.

## Checked and found sound (no change needed)

- No wording anywhere lets a future agent cite the phase finalizer, or any `pal-mcp`
  confidence level (including `certain`), to skip, batch, or substitute for the per-PR Opus
  security-scope gate — checked adversarially, multiple independent places reject that
  reading, and `check-pr-template.mjs`'s `/^opus/i` check independently guards against a
  fabricated attestation.
- CODEOWNERS narrowing (six paths, not `*`) achieves exactly its stated, documentation-only
  effect; GitHub's semantics don't make it wider or narrower than described.

## Not done by this review

- Did not test GitHub's actual behavior for a sole code owner authoring their own PR (finding
  F1 is reasoned from the ruleset/permissions config, not empirically triggered).
- Did not change the ruleset, the PR, or any file directly — reported findings for the
  orchestrating session to remediate.
- Did not send anything to `pal-mcp` itself except a `listmodels` call.

## Next step

A fresh confirmation pass is required at the exact SHA that includes all fixes above before
merge — this note will be superseded by (not edited into) that pass's own note once it lands,
per this repo's exact-head discipline.
