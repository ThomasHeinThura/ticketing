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

## Pass 3 — critical finding: the leak is not fixed

**Reviewed head:** `1eca1e528b156f5e34b0979442a9337f10ae32a5`
**Model:** Opus 5.5 (`claude-opus-5-5[1m]`), fresh independent context.
**Verdict:** REQUEST CHANGES — a new, critical finding, distinct from and more severe than
F1–F10/N1–N7.

**B1 (CRITICAL):** made one fresh, isolated `codereview` call — synthetic content, no
`continuation_id` — and its response contained material from other sessions: this session's
own earlier steps on this PR, and a palindrome/binary-search code review from a macOS path
under a different username, from a different Claude session entirely (first observed several
rounds earlier, believed at the time to be fixed by the fusion-panel→failover switch). It is
not. Diagnosis: `pal-mcp`'s workflow-tool step/state history is shared across separate calls
and clients server-side — this is unrelated to which model backs `coder`, so the earlier
"two clean tests" read (recorded in the entry above and in decision-log.md) was wrong; too
small a sample, not a real fix.

**B2 (HIGH):** `pal-mcp` is a remote SSE server (`https://mcp-router.technexus.info/sse`)
with no access to this host's filesystem at all — confirmed via `~/.claude.json`'s config and
directly by testing (`absolute_file_paths` returns `files_embedded: 0`; `working_directory_absolute_path`
only resolves against the remote host's own filesystem, not this one). The path-scoping rule
in `CLAUDE.md`/`agent-workflow.md`/`pal-reviewer.md` rested on a false premise ("reads files
with the host user's own privileges") — corrected to a content-scoping rule (never
`Read`-and-paste a dotfile/`.env*`/key/credential file into a prompt).

**B3–B5 (MEDIUM):** cross-file inconsistencies — `agent-workflow.md` still described the
independence rule in terms of the abandoned two-model "panel/judge" framing instead of the
four-model failover list; the committed note (this file) blended fixer claims with reviewer
findings under one voice, since corrected into per-pass sections; `status.md` lagged behind
the actual state by two commits.

**Resolution:** `pal-mcp` is **suspended** as the default ordinary reviewer — not deleted,
marked suspended in `CLAUDE.md` and `agent-workflow.md`, so the design can resume once the
leak is actually fixed. See decision-log.md, "CORRECTION: the pal-mcp cross-call leak is NOT
fixed — `pal-mcp` SUSPENDED as default reviewer." **Correction to this section's own earlier
claim:** commit `bccafe7` fixed B2–B5 only in `CLAUDE.md` and `decision-log.md` — a follow-up
lightweight Opus confirmation (below) found `.claude/agents/pal-reviewer.md` had no
suspension notice at all, and `agent-workflow.md`'s main "Model tiers" section still read as
pal-mcp-primary throughout (only one later subsection had been fixed). Both, plus `status.md`
(B5), corrected in the commit immediately following that confirmation.

**What this changes about Pass 1/Pass 2's verdicts:** does not retroactively invalidate them
— F1–F10 and N1–N7 were real findings about the governance *text*, correctly found and fixed
independent of whether `pal-mcp` itself works. B1 is a finding about the *tool*, not the text
describing it, and is the reason the text now describes `pal-mcp` as suspended rather than as
primary.

## Pass 4 — completeness check on the suspension notice

**Reviewed head:** `9febf1062097589f0fc7ff8866dba695ac089cbb`
**Model:** Opus 5.5 (`claude-opus-5-5[1m]`), fresh independent context.
**Verdict:** REQUEST CHANGES.

Confirmed `bccafe7`'s suspension text (CLAUDE.md, decision-log.md) was accurate as far as it
went, but incomplete: `.claude/agents/pal-reviewer.md` — added by this PR, never touched by
`bccafe7` — had no suspension notice at all, and `agent-workflow.md`'s main "Model tiers
within Claude Code" section still read pal-mcp-primary throughout its header, bullets, and
role table (only a later, easy-to-miss subsection had a notice). Also flagged: `status.md`
still stale, and this note's own Pass 3 "Resolution" paragraph overclaiming that all of
B2–B5 were fixed in `bccafe7`. Fixed in commit `205c803`.

## Pass 5 — completeness re-confirmation, one more gap found and closed

**Reviewed head:** `205c803c6f22e2543c1b4a5f588b7e2c3fb754d1`
**Model:** Opus 5.5 (`claude-opus-5-5[1m]`), fresh independent context.
**Verdict:** REQUEST CHANGES.

Confirmed `205c803` correctly fixed `pal-reviewer.md`, `agent-workflow.md`'s main section,
`status.md`, and this note's own Pass 3 overclaim — none of the CODEOWNERS/phase-finalizer/
AGENTS.md/ci-cd.md content was disturbed. A repo-wide grep for "pal-mcp"/"pal-reviewer" across
the full diff found one more instance neither this pass's targeted read nor Pass 4's had
caught: `CLAUDE.md`'s own separate "## Using subagents here — what works" section (outside
"## Model tiers", so outside that section's suspension notice) still told agents to default
to `pal-reviewer` with no qualifier. Also flagged: the two decision-log entries didn't
cross-reference each other clearly, and this note's own "a follow-up lightweight Opus
confirmation (below)" line pointed at nothing (this Pass 4/5 gap). All fixed in the commit
recording this Pass 5 entry — see `CLAUDE.md`'s "Using subagents here" bullet, and the two
decision-log entries' updated cross-references.

**This closes the pal-mcp-suspension completeness question.** Remaining before merge: the
mechanical PR-body/checklist update, and the orchestrating session's call on whether the
Sonnet ordinary reviews at `6d7a812` (which pre-date the suspension entirely) still cover the
delta, or whether a fresh ordinary delta review is warranted given how much the PR's
substance changed.
