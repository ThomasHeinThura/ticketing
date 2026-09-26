# Security review — PR #376 (`pal-mcp` governance, control-plane CODEOWNERS)

This note is append-only across passes, like the decision log — each pass's own findings
and verdict are kept as its own section, not merged into a single blended narrative. A later
pass may find an earlier one's "fixed" claim was incomplete; when that happens both are
recorded, not just the latest.

## Pass 1

**Reviewed head:** `efb29bee3084a3368ba59c2c5d733ea043c34e72`
**Model:** Opus 5.5, fresh independent context (did not author, direct, or remediate this
change).
**Verdict:** REQUEST CHANGES. Findings F1–F10 below.

1. **F1 (HIGH):** the plan to enable "Require review from Code Owners" for six control-plane
   paths does not work — sole collaborator, shared agent `gh` token, no identity boundary for
   GitHub to enforce; flipping it would either brick future control-plane PRs or require a
   bypass actor that defeats all required checks.
2. **F2 (MEDIUM-HIGH):** the `coder` panel (GPT-6 Luna judge, DeepSeek member) is not
   independent of PRs authored by GPT-6 Luna or DeepSeek.
3. **F3 (MEDIUM):** the secrets/PII guardrail told reviewers to "check the exact lines,"
   which doesn't match how `pal-mcp`'s tools actually send whole files/diffs.
4. **F4 (LOW-MEDIUM):** stale cross-references remained in `CLAUDE.md` ("all eight") and
   `agent-workflow.md` ("every other subagent is Sonnet", "two Sonnet reviews minimum").
5. **F5 (LOW, non-blocking):** CODEOWNERS doesn't cover `.github/workflows/**`,
   `scripts/ci/**`, `.claude/settings.json`.
6. **F6 (LOW):** the phase finalizer text didn't require a fresh, non-orchestrating context,
   or say what happens if Opus is unreachable for it.
7. **F7 (LOW):** `pal-reviewer`'s `chat` tool can write to an arbitrary directory via
   `working_directory_absolute_path`, and `clink` wasn't explicitly named as excluded.
8. **F8 (LOW for security, blocking for the template gate):** the PR body didn't use the
   required template sections, had a stale claim that `pal-reviewer` has `Bash`, and the
   review-SHA/model-attestation records needed reconciling.
9. **F9 (LOW):** one decision-log citation named the wrong date for the "router did not work
   out" decision (2026-09-23 instead of 2026-09-15).
10. **F10 (for information):** the `coder` panel's exact composition is configured on
    Thomas's own 9Router gateway and cannot be independently verified from this repo/session.

## Fix commit (between pass 1 and pass 2)

**Head:** `53aefaedd068ac14aba1e453bdcea0d5f1aa60d5`
**Author:** the orchestrating session (Claude Sonnet 5), not an independent reviewer —
claims below are the fixer's, not verified by a fresh context until pass 2.

Claimed: F1 (toggle dropped, docs corrected, decision-log entry added), F2 (panel
independence rule added), F3 (path-scoping rewrite — **later found incomplete, see pass 2**),
F4 (stale text corrected), F5 (deferred, documented), F6 (phase finalizer wording — **later
found incomplete, see pass 2**), F7 (`clink` excluded, `chat` scoped), F8 (PR body rewritten
— **later found still failing the template check, see pass 2**), F9 (citation fixed,
Supersedes line added), F10 (noted explicitly).

## Pass 2

**Reviewed head:** `53aefaedd068ac14aba1e453bdcea0d5f1aa60d5`
**Model:** Opus 5.5 (`claude-opus-5-5[1m]`), fresh independent context, distinct from the
fixer above.
**Verdict:** REQUEST CHANGES.

- F1: fixed in the five operative docs, but the decision log and `.github/CODEOWNERS` header
  still read as asserting the reversal as settled fact rather than pending Thomas's
  confirmation (**N1**, blocking) — corrected in the next fix commit.
- F2, F4, F7, F9, F10: confirmed genuinely fixed.
- F3: **not actually fixed in `docs/04-engineering/agent-workflow.md`** — only `CLAUDE.md`
  and `pal-reviewer.md` had the path-scoping rewrite; `agent-workflow.md` still had the old
  content-based wording. Corrected in the next fix commit.
- F5: deferral confirmed reasonable, recorded rather than silently dropped.
- F6: **not actually fixed in `AGENTS.md`'s own "Phase finalizer" subsection** — only
  `CLAUDE.md`'s table row had the freshness/capacity wording. Corrected in the next fix
  commit.
- F8: **PR body still failed `check-pr-template.mjs` locally** — Security review `Model:`
  field must start with "Opus" (was "Claude Opus 5.5, ..."); six checklist headings were
  merged into one line instead of separate `### ` headings; no independent-review checkbox
  was present anywhere in `## Checklists`. Corrected in the next fix commit (same class of
  mistake independently found on PR #377 at the same time).
- **N5 (new):** `pal-reviewer` cannot check a PR's author itself (no `Bash`/`gh`); the
  orchestrating session must pass the author explicitly for the F2 carve-out to work. Added
  to `pal-reviewer.md`.
- **N6 (new):** the path-scoping rule should also forbid passing a whole directory (only
  explicit files). Added to all three copies of the rule.
- **N7 (new):** `status.md` had several unrelated stale claims (a wrong `main` SHA, #373
  shown as still-open when it's merged, a "still to do" note for work already done).
  Corrected.
- **N3/N4 (process notes, not blocking):** this note previously blended the fixer's claims
  with the reviewer's findings under one voice — restructured into per-pass sections above.
  Whether the two ordinary Sonnet reviews recorded at `6d7a812` (pre-dating the
  Code-Owner-review reversal and the panel-independence rule) are sufficient, or whether a
  fresh ordinary review is needed for that substantive delta, is flagged in `status.md` as an
  open call for the orchestrating session, not decided by this security review.

## Checked and found sound (both passes)

- No wording anywhere lets a future agent cite the phase finalizer, or any `pal-mcp`
  confidence level (including `certain`), to skip, batch, or substitute for the per-PR Opus
  security-scope gate.
- CODEOWNERS narrowing (six paths, not `*`) achieves exactly its stated, documentation-only
  effect.
- The live `protect-main` ruleset (checked directly via the GitHub API in pass 2) has
  `require_code_owner_review: false` and `bypass_actors: []` — the toggle was never actually
  flipped and no bypass was added, matching what the docs now claim.

## Not done by either pass

- Neither pass tested GitHub's actual behavior for a sole code owner authoring their own PR
  (reasoned from the ruleset/permissions config, not empirically triggered).
- Neither pass changed the ruleset, the PR, or any file directly.
- Neither pass sent anything to `pal-mcp` beyond schema/`listmodels` inspection.
