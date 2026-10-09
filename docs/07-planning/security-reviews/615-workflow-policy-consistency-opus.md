# 615 — workflow policy restructure: independent consistency review (Opus 5.5)

Transported verbatim from a fresh, non-forked Claude Opus 5.5 Agent-tool context that did not
author or remediate the change. This is additional evidence, not one of the required GPT-6
Luna ordinary reviews.

---

# Independent ordinary review — consistency
- **Exact candidate reviewed:** c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12 (verified via `git rev-parse HEAD` in the worktree)
- **Comparison base:** 78586b4425f92576027fddb8d238fe7c44da4edf
- **Reviewer / model / context:** fresh Claude Opus 5.5 subagent context (Agent tool, not forked), did not author or remediate the change. *Process note:* the candidate's own model policy (`agent-workflow.md:148`) assigns ordinary review to GPT-6 Luna, and new `CLAUDE.md:45-47` says a Claude session "is not the reviewer of record" for a role assigned to another model — so under the candidate's own rules this review is supplementary evidence, not a required-tier review.
- **Files / surfaces checked:** full base and new text of `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/{agent-workflow,definition-of-done,sdlc,error-fix-loop}.md`; new `docs/07-planning/active-mission.md` and `workflow-policy-audit-2026-10-09.md`; decision log (the new entry plus 2026-10-09 back to 2026-10-04 and the two 2026-09-29 model entries); `docs/04-engineering/ci-cd.md` (security-path and note-binding sections, § Branching); `docs/05-operations/runbook.md` § Policy shadow summary; `integration-execution-queue.md`; `scripts/ci/**` comments and messages that cite AGENTS.md; `.github/pull_request_template.md`; `.github/CODEOWNERS`.
- **Checks actually run:** `git diff --stat` and per-file diffs from base to candidate; a rule-by-rule inventory of base text against new text; a Python link/anchor checker over every tracked `.md` at both base and candidate (19 broken links at each — an identical set, so no regressions); `git grep` for do-not and rule numbers in `scripts/ci`, `.github` and `packages`; `git grep` for "retry policy" and for runner versions V24–V44; a count of #612 review-note files; checks of `skills/` and `.claude/agents`; the `ci-cd.md` squash-merge statement against merge-commit history; spot-checks of audit rows 1–6, 12–13, 15, 17, 21 and 22.
- **Workspace hygiene:** I briefly copied one temp file into the worktree (`docs/07-planning/.tmp-dl-check.md`) to link-check it, then deleted it immediately; `git status --short` was empty afterwards. Nothing was committed or pushed.

## Findings

**Blocking:**

1. **The review-record-only check uses the net-tree diff that the repo's own security doc calls a bypass, and wrongly claims it matches CI.** `agent-workflow.md:192-197`: the conductor verifies with "`git diff --name-only <reviewed>..<candidate>`" and the text says "This is the same rule CI enforces for security notes". But `ci-cd.md` § "Landed commits, not the net tree" says the CI rule is judged over every landed commit (merges charged with the union of their per-parent diffs). It names a `git diff <head>..HEAD` comparison as a known bypass, because a code commit plus its revert leaves an empty net diff ("Reverting does not restore a clearance"). This is the evidence-binding rule for scenario (d). It replaces the base rule in `definition-of-done.md` (ordinary review again at the exact candidate) with "no new review of any kind", using a check that is weaker than CI's while claiming equivalence. For security notes CI still catches the gap; for ordinary reviews nothing does. The practical risk is low (the merged tree equals the reviewed tree), but unreviewed commits can land in `main`'s history and the stated equivalence is false. **Fix:** require per-commit verification — e.g. "every commit in `git rev-list <reviewed>..<candidate>` (merges charged per parent) touches only review records — the same landed-commit rule as `scripts/ci/lib/security-review-note.mjs`".
2. **The canonical workflow has two contradictory stop rules.** `agent-workflow.md:95-96`: "**When nothing is `READY`, record the waiting states and stop working**". `agent-workflow.md:113-114`: "Stop only in **Hold**, or when every remaining task is waiting on Thomas, an external credential or capacity". When every task is `WAITING_CI`/`WAITING_REVIEW`, the first says stop and the second says don't. That reintroduces the failure the restructure targets: sessions ending while CI runs, so nobody advances the queue when CI finishes (`:93` says CI completing "is a transition, not a reason to end a session"). It is also broader than the base's whole-program stop (base `AGENTS.md:454-456`). **Fix:** reword `:95-96` to "When nothing is `READY`, do not invent work, start new scope or loosen a gate; wait for the pending transitions. Stop only under the conductor-loop condition."
3. **The independent whole-entrypoint diagnosis was dropped, contradicting a still-effective owner decision.** `error-fix-loop.md:149-166`, post-limit step 2 now reads "**Review** the complete invocation and data path" — no longer an *independent* diagnosis, and no longer agreeing a bounded repair before the next attempt. Base `error-fix-loop.md` ("Assign an independent whole-entrypoint diagnosis, then agree on a bounded, cause-appropriate repair before another attempt"), base `sdlc.md` loop discipline, base `agent-workflow.md:347-349`, and decision log 2026-10-09 "single-conductor delivery" lines 66-68 ("pause that mechanism, assign an independent whole-entrypoint diagnosis, and agree on a bounded cause-appropriate repair") all required it. The new decision entry says the earlier 2026-10-09 decisions "themselves stand and are now expressed once" — this one is not expressed and is not listed as superseded. Independence is the control aimed at the V24→V44 failure mode (the same context iterating); step 6 only adds independent review of the resulting change, not of the diagnosis. **Fix:** step 2 → "Assign an **independent** context to review the complete invocation and data path…"; add to step 4 "agree the bounded repair before the next attempt."

**Non-blocking:**

1. **Lanes are told to edit the queue, which their role forbids.** `agent-workflow.md:310-311` ("record in the queue the exact branch and head…" before any session ends) and `error-fix-loop.md:149` ("Write down, in the PR, a dated **Blocked** entry and the queue") contradict `AGENTS.md:81` (Lane "May not: edit the queue"). The hierarchy resolves it (AGENTS wins), but say outright that a lane records this in its handoff and the conductor transcribes it.
2. **"Every review count unchanged" is inaccurate.** The decision-log new entry (Unchanged list) and audit §7 claim it, but `agent-workflow.md:162` adds a lower tier ("Records only … **one** independent factual check"; under base this was ordinary substantive work with two reviewers), and `:169` adds a new conditional security pass for workflow policy. Disclose both as changes, or justify them.
3. **The new workflow-policy row applies to this PR.** Row `:169` requires a full security pass when a policy change alters "review requirements"; this PR does (the review-record-only exemption and the records-only tier). The audit (§5) only says no security-scope path is touched. Plan a full GPT-6 Sol pass or state why the row does not apply.
4. **Control-plane ownership has no new home.** Base `CLAUDE.md` § "The control plane, and who owns it" made `AGENTS.md`, `CLAUDE.md`, `agent-workflow.md`, `ci-cd.md`, `status.md`, the decision log, `CODEOWNERS` and issue/board status conductor-owned and read-only for lanes. The new Roles table covers only the queue, scheduler and continuation (plus a "Policy maintainer" role). `.github/CODEOWNERS:49` still points to "CLAUDE.md's 'control plane' section", which no longer exists.
5. **Owner chat directives may lose immediate effect.** Base `AGENTS.md:48-49` ("current explicit instructions take effect now") and base `CLAUDE.md:387-388` ("A current explicit owner directive is not demoted because it arrived in chat") are replaced by new `AGENTS.md:45` (decisions "recorded in the decision log") and `:62` ("chat summaries" are evidence, never policy). Suggest restoring "Thomas's direct instruction takes effect when given; record it."
6. **The one-re-run allowance is new policy, not consolidation.** `error-fix-loop.md:124-127` introduces it, while the same section (`:133-134`) says changing retry counts needs Thomas's approval in the decision log. The audit's claim that no approved retry policy existed is correct (Playwright configs use `retries: 0`, and no policy text exists), but the numeric allowance still needs explicit owner confirmation. The directive text is not quoted anywhere in the repo.
7. **CI and template references have drifted, and the audit overstates their alignment.** Audit §5 says CI messages citing do-nots 5, 7, 11, 15, 18 "still point at the same-numbered items". But do-not 15 has changed meaning ("Implement without addressing applicable known findings…" → "**Merge** a feature while a finding … is not mapped…"), while `scripts/ci/check-reviews.mjs:6,467` still says "a feature is not started while its review section is non-empty" and `definition-of-done.md:100-103` still says findings are "closed in the spec before the build started" — a pre-existing tension, now wider. Also stale: `check-pr-template.mjs:361,382` ("GPT-6 Sol, always (AGENTS.md)"), `.github/pull_request_template.md:52` ("AGENTS.md's 'Sampled big review'", which moved) and `scripts/ci/lib/gate-waiver.mjs:56` ("AGENTS.md and CLAUDE.md now both say"). Add them to F2/F3.
8. **`status.md` updates conflict with "records stay out of candidates".** `definition-of-done.md:112` ("status.md updated") and `sdlc.md:197` contradict `agent-workflow.md:116-118`. "The conductor's records branch" is never defined.
9. **Model-assignment rows were dropped without being recorded.** Base `CLAUDE.md:128,130,134`: Sol for security/architecture-heavy context preparation, Sol for broad/high-risk architecture review, and Sol preferred for governance orchestration. All are dropped despite the claim "model assignments unchanged"; partly covered by "critical cross-boundary review".
10. **Smaller silent losses:**
    - "Read three or four files before inferring conventions" (base workflow:143).
    - "Citing spec rule numbers in test names" (`:185`).
    - "Calendar pressure changes urgency, not gates".
    - "Do not count historical pal-mcp verdicts as current evidence".
    - The continuation notification cadence ("stay quiet…; notify on meaningful progress…") and "save the continuation identity".
    - "Fabricate review evidence or mark an independent review n/a" (now enforced only by CI).
    - "No unresolved blocking findings" for final consolidated SIT acceptance (base DoD).
    - The policy-shadow rules ("note-only does not restart the window / do not wait / elapsed time") now survive only in decision-log entries, not in the linked runbook.
    - The post-limit runner chain no longer names exit status or process lifecycle.
11. **The end-to-end rule's scope is unclear.** `error-fix-loop.md:170` sits under the three-attempt rule, so for a first runner failure the full-path regression is not clearly required. This matches base and the 2026-10-09 freeze entry ("after repeated failure"); stating that it applies to every runner fix would close scenario (e) cleanly.
12. **Audit accuracy:**
    - Row 4 says "#612 gathered 16 review notes"; there are 15 `612-*` files in `security-reviews/`.
    - The new decision entry says the earlier 2026-10-09 decisions "themselves stand", yet it reorders that freeze entry's hierarchy (CLAUDE.md moves from 2nd to 5th). Name this explicitly as superseded.
    - Spot-checks confirmed: row 1 (on `main`: `3096cb04:CLAUDE.md:43`), row 2 (`main` workflow:275), row 3 (decision log:118), row 4 (base DoD text), row 5 (four base locations; no definition anywhere), row 12 (queue checkpoints above the title; "Execution boundary" at :123), row 13 (V26–V44 in the queue), row 15 (check-pr-template:361/382), row 17 (only two skills; no `.claude/agents`), row 21 (`ci-cd.md:674` "Squash merge" vs "Merge pull request" history) and row 22 (base DoD:11 / sdlc:98).

## Scenario results
- (a) **PASS** — `agent-workflow.md` § Task states (`:93`) and § Conductor loop step 2. The adjacent "nothing READY" case is contradicted (Blocking 2).
- (b) **PASS** — § Task states, `WAITING_DECISION`: "A pending decision stops only the decision path it governs".
- (c) **PASS** — § Verification "CI today" (`:253-258`) plus `AGENTS.md` § Authority (enforced gates). Minor: the "canonical owner" of a `main`-lockfile advisory is not named.
- (d) **PASS (behaviour) / binding method defective** — § Exact head and evidence reuse; DoD § Levels of done. See Blocking 1.
- (e) **PASS with scope ambiguity** — `error-fix-loop.md` § End-to-end validation for evidence runners; reliably triggered only post-limit (Non-blocking 11).
- (f) **PASS** — `error-fix-loop.md` § The three-attempt rule ("V35 → V36 … does not reset the count") and `AGENTS.md` do-not 10.
- (g) **PASS** — `agent-workflow.md` § Integration and release (pre-merge / post-merge evidence).
- (h) **PASS** — § Conductor loop, "Duplicate work".
- (i) **PASS** — `active-mission.md` § Stop condition; workflow § Operating modes (Release/SIT → Hold).
- (j) **PASS for the conductor / ambiguous for lanes** — § Sessions, handoff and continuation (continuation verified by configuration plus a run receipt; not a promise). Lane queue edits conflict with Roles (Non-blocking 1).

## Verdict
**BLOCKED** — three targeted text fixes (Blocking 1–3), each a one- or two-sentence edit. Everything else is non-blocking.

## Not checked
- Live GitHub state: PR bodies (audit row 19), CI runs on the candidate, and the #601 hunks (row 18).
- Whether Thomas's 2026-10-09 restructure directive actually authorizes the one-re-run allowance or the new review tiers (the directive text is not in the repo).
- Whether the `check:*` scripts pass on this tree (I relied on the audit's statement).
- Historical documents (lane-prep, reviews) beyond grep, and spec content under `docs/03-features`.
- A security-tier assessment (this was an ordinary consistency review).
