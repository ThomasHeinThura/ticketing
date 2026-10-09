# 615 — workflow policy restructure: independent consistency reviews (Opus 5.5)

- **Reviewer context:** one fresh Claude Code Agent-tool subagent (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`). It did not author or remediate the change. It is not a GPT-6 Luna or GPT-6 Sol review of record and satisfies neither.
- **Spawn:** Agent ID `ab2ce0e07c89e65a8`, parent Claude Code session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. A later request asking this context to rewrite its reports ended in an API error and produced no output.
- **Transport:** each report below is the reviewer's final message for that review round, extracted mechanically from the subagent transcript and inserted unmodified between the markers. SHA-256 of report 1: `0f2cb5f117d3efa7bb24f5774bd98e87780d264a42d4491ff8dd8cca9b9c0d10`; report 2: `bc5dd65173cf0c8f2bbd3b9be4b2b19147560db9780300b20adcde8071b658ca`.
- **Correction:** commit `7955d7df` carried a reformatted transcription of report 1 that was labelled verbatim. The delta review (report 2) flagged it, and this file replaces it.

<!-- BEGIN REPORT 1 (candidate c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12) -->

# Independent ordinary review: consistency

- **Exact candidate reviewed:** c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12 (`git rev-parse HEAD` in the worktree returned this SHA)
- **Comparison base:** 78586b4425f92576027fddb8d238fe7c44da4edf
- **Reviewer / model / context:** a fresh Claude Opus 5.5 subagent context (Agent tool, not forked). I did not author or fix this change. **Process note:** the candidate's own model policy (`agent-workflow.md:148`) assigns ordinary review to GPT-6 Luna. New `CLAUDE.md:45-47` says a Claude session "is not the reviewer of record" for a role assigned to another model. So under the candidate's own rules, this review is extra evidence, not one of the required reviews.
- **Files / surfaces checked:**
  - Full base and new text: `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `definition-of-done.md`, `sdlc.md`, `error-fix-loop.md`.
  - New files: `docs/07-planning/active-mission.md` and `workflow-policy-audit-2026-10-09.md`.
  - Decision log: the new entry plus entries from 2026-10-09 back to 2026-10-04, and the two 2026-09-29 model entries.
  - `docs/04-engineering/ci-cd.md`: the security-path and note-binding sections, and § Branching.
  - `docs/05-operations/runbook.md` § Policy shadow summary.
  - `integration-execution-queue.md`.
  - `scripts/ci/**` comments and messages that cite AGENTS.md, `.github/pull_request_template.md` and `.github/CODEOWNERS`.
- **Checks actually run:**
  - `git diff --stat` and per-file diffs, base to candidate.
  - Rule-by-rule check of every base rule against the new text.
  - A Python link and anchor checker over every tracked `.md` file at both base and candidate: 19 broken links in each, an identical set, so nothing new is broken.
  - `git grep` for do-not and rule numbers under `scripts/ci`, `.github` and `packages`.
  - `git grep` for "retry policy" and for the V24–V44 runner versions.
  - Count of #612 review-note files; checks of `skills/` and `.claude/agents`.
  - `ci-cd.md` squash-merge statement checked against the merge-commit history.
  - Spot-checks of audit rows 1–6, 12–13, 15, 17, 21 and 22.
- **Workspace note:** I briefly copied one temp file into the worktree (`docs/07-planning/.tmp-dl-check.md`) to link-check it and deleted it at once. `git status --short` was empty afterwards. Nothing was committed or pushed.

## Findings

**Blocking:**

1. **The review-record-only check uses a diff method that the repo's own security doc calls a bypass, and it claims to match CI when it does not.**
   - **Where:** `agent-workflow.md:192-197`. It says the conductor verifies with `` `git diff --name-only <reviewed>..<candidate>` `` and that "This is the same rule CI enforces for security notes".
   - **Evidence:** `ci-cd.md` § "Landed commits, not the net tree" says the CI rule checks every landed commit, and charges a merge with the union of its per-parent diffs. It names a `git diff <head>..HEAD` comparison as a known bypass: a code commit plus its revert leaves an empty net diff ("Reverting does not restore a clearance").
   - **Why it matters:** this is the evidence-binding rule behind scenario (d). It replaces the base rule in `definition-of-done.md` (ordinary review again at the exact candidate) with "no new review of any kind". It does so with a check that is weaker than CI's, while saying the two are the same. For security notes CI still catches the gap. For ordinary reviews nothing does. Practical risk is low (the merged tree equals the reviewed tree), but unreviewed commits can land in `main`'s history and the stated equivalence is false.
   - **Fix:** require per-commit verification, for example: "every commit in `git rev-list <reviewed>..<candidate>`, with merges charged per parent, touches only review records — the same landed-commit rule as `scripts/ci/lib/security-review-note.mjs`".

2. **The canonical workflow gives two different stop rules.**
   - **Where:** `agent-workflow.md:95-96` says "**When nothing is `READY`, record the waiting states and stop working**". `agent-workflow.md:113-114` says "Stop only in **Hold**, or when every remaining task is waiting on Thomas, an external credential or capacity".
   - **Why it matters:** when every task is `WAITING_CI` or `WAITING_REVIEW`, the first rule says stop and the second says keep going. That brings back what the restructure set out to remove: sessions ending while CI runs, so nobody advances the queue when CI finishes (`:93` says CI completing "is a transition, not a reason to end a session"). It is also broader than the base's whole-program stop rule (base `AGENTS.md:454-456`).
   - **Fix:** change `:95-96` to something like "When nothing is `READY`, do not invent work, start new scope or loosen a gate; wait for the pending transitions. Stop only under the conductor-loop condition."

3. **The independent whole-entrypoint diagnosis was dropped, contradicting an owner decision that still stands.**
   - **Where:** `error-fix-loop.md:149-166`. The post-limit sequence step 2 now reads "**Review** the complete invocation and data path". It no longer requires an *independent* diagnosis, or agreement on a bounded repair before the next attempt.
   - **Evidence:** all of these base texts required it:
     - base `error-fix-loop.md`: "Assign an independent whole-entrypoint diagnosis, then agree on a bounded, cause-appropriate repair before another attempt"
     - base `sdlc.md` loop discipline
     - base `agent-workflow.md:347-349`
     - decision log 2026-10-09 "single-conductor delivery", lines 66-68: "pause that mechanism, assign an independent whole-entrypoint diagnosis, and agree on a bounded cause-appropriate repair".
   - **Why it matters:** the new decision entry says the earlier 2026-10-09 decisions "themselves stand and are now expressed once". This one is not expressed, and the entry does not list it as superseded. Independence is the control aimed at the V24→V44 failure mode, where the same context kept iterating. Step 6 only adds independent review of the resulting change, not of the diagnosis.
   - **Fix:** step 2 should read "Assign an **independent** context to review the complete invocation and data path…", and step 4 should add "agree the bounded repair before the next attempt."

**Non-blocking:**

1. **Lanes are told to edit the queue, which their role forbids.**
   - `agent-workflow.md:310-311` says "record in the queue the exact branch and head…" before any session ends.
   - `error-fix-loop.md:149` says "Write down, in the PR, a dated **Blocked** entry and the queue".
   - `AGENTS.md:81` says a Lane "May not: edit the queue".
   - The authority order resolves this (AGENTS wins), but say it outright: a lane records this in its handoff, and the conductor transcribes it into the queue.
2. **"Every review count unchanged" is not accurate.** The decision log new entry (Unchanged list) and audit §7 claim it, but `agent-workflow.md:162` adds a lower tier ("Records only … **one** independent factual check"; under the base this was ordinary substantive work, two reviewers). `:169` adds a new conditional security pass for workflow policy. Disclose both as changes, or justify them.
3. **The new workflow-policy row applies to this PR.** Row `:169` requires a full security pass when a policy change alters "review requirements". This PR does that (the review-record-only exemption and the records-only tier). The audit (§5) only says no security-scope path is touched. Plan a full GPT-6 Sol pass, or state why the row does not apply.
4. **Control-plane ownership has no new home.** Base `CLAUDE.md` § "The control plane, and who owns it" made `AGENTS.md`, `CLAUDE.md`, `agent-workflow.md`, `ci-cd.md`, `status.md`, the decision log, `CODEOWNERS`, issue status and board status conductor-owned and read-only for lanes. The new Roles table covers only the queue, scheduler and continuation, plus a "Policy maintainer" role. `.github/CODEOWNERS:49` still points to "CLAUDE.md's 'control plane' section", which no longer exists.
5. **Owner chat directives may lose immediate effect.**
   - Base `AGENTS.md:48-49` said "current explicit instructions take effect now". Base `CLAUDE.md:387-388` said "A current explicit owner directive is not demoted because it arrived in chat."
   - New `AGENTS.md:45` says decisions are "recorded in the decision log", and `:62` lists "chat summaries" as evidence, never policy.
   - Suggest restoring "Thomas's direct instruction takes effect when given; record it."
6. **The one-re-run allowance is new policy, not consolidation.** `error-fix-loop.md:124-127` introduces it. The same section (`:133-134`) says changing retry counts needs Thomas's approval in the decision log. The audit's claim that no approved retry policy existed is correct (Playwright configs use `retries: 0`, and no policy text exists). The numeric allowance still needs explicit owner confirmation; the directive text is not quoted anywhere in the repo.
7. **CI and template references have drifted, and audit §5 overstates their alignment.**
   - Audit §5 says CI messages citing do-nots 5, 7, 11, 15, 18 "still point at the same-numbered items".
   - Do-not 15 has changed meaning: from "Implement without addressing applicable known findings…" to "**Merge** a feature while a finding … is not mapped…". `scripts/ci/check-reviews.mjs:6,467` still says "a feature is not started while its review section is non-empty", and `definition-of-done.md:100-103` still says findings are "closed in the spec before the build started". This tension existed before, but it is now wider.
   - Also stale: `check-pr-template.mjs:361,382` ("GPT-6 Sol, always (AGENTS.md)"); `.github/pull_request_template.md:52` ("AGENTS.md's 'Sampled big review'", a section that moved); and `scripts/ci/lib/gate-waiver.mjs:56` ("AGENTS.md and CLAUDE.md now both say"). Add these to F2/F3.
8. **`status.md` updates conflict with "records stay out of candidates".** `definition-of-done.md:112` ("status.md updated") and `sdlc.md:197` contradict `agent-workflow.md:116-118`. "The conductor's records branch" is never defined anywhere.
9. **Model-assignment rows were dropped without being recorded.** Base `CLAUDE.md:128,130,134` had: Sol for security- or architecture-heavy context preparation, Sol for broad or high-risk architecture review, and Sol preferred for governance orchestration. These are dropped despite the claim "model assignments unchanged". Partly covered by "critical cross-boundary review".
10. **Smaller silent losses:**
    - "Read three or four files before inferring conventions" (base workflow:143)
    - "citing spec rule numbers in test names" (`:185`)
    - "Calendar pressure changes urgency, not gates"
    - "Do not count historical pal-mcp verdicts as current evidence"
    - continuation notification cadence ("stay quiet…; notify on meaningful progress…") and "save the continuation identity"
    - "fabricate review evidence or mark an independent review n/a" (now only enforced by CI)
    - "no unresolved blocking findings" for final consolidated SIT acceptance (base DoD)
    - the policy-shadow rules "note-only does not restart window / do not wait / elapsed time" now live only in decision-log entries, not the linked runbook
    - the post-limit runner chain no longer names exit status or process lifecycle.
11. **Scope of the end-to-end rule is unclear.** `error-fix-loop.md:170` sits under the three-attempt rule, so for a first runner failure the full-path regression is not clearly required. This matches the base and the 2026-10-09 freeze entry ("after repeated failure"), but stating that it applies to every runner fix would close scenario (e) cleanly.
12. **Audit accuracy:**
    - Row 4 says "#612 gathered 16 review notes"; there are 15 `612-*` files in `security-reviews/`.
    - The new decision entry says the earlier 2026-10-09 decisions "themselves stand", yet it reorders that freeze entry's hierarchy (CLAUDE.md drops from second to fifth). Name this explicitly as superseded.
    - Spot-checks confirmed:
      - Row 1: on `main` (`3096cb04:CLAUDE.md:43`)
      - Row 2: `main` workflow:275
      - Row 3: decision log:118
      - Row 4: base DoD text
      - Row 5: four base locations and no definition anywhere
      - Row 12: queue checkpoints sit above the title, and its "Execution boundary" section is at :123
      - Row 13: V26–V44 appear in the queue
      - Row 15: check-pr-template:361/382
      - Row 17: only two skills, no `.claude/agents`
      - Row 21: `ci-cd.md:674` "Squash merge" against "Merge pull request" history
      - Row 22: base DoD:11 and sdlc:98

## Scenario results

- **(a) PASS:** `agent-workflow.md` § Task states (`:93`) and § Conductor loop step 2. The adjacent "nothing READY" case is contradicted; see Blocking 2.
- **(b) PASS:** § Task states, `WAITING_DECISION`: "A pending decision stops only the decision path it governs".
- **(c) PASS:** § Verification, "CI today" (`:253-258`), together with `AGENTS.md` § Authority (enforced gates). Small gap: the "canonical owner" of a `main`-lockfile advisory is not named.
- **(d) PASS on the behaviour, but the binding method is defective:** § Exact head and evidence reuse, and DoD § Levels of done. See Blocking 1.
- **(e) PASS, with a scope ambiguity:** `error-fix-loop.md` § End-to-end validation for evidence runners. It is reliably triggered only after the limit; see Non-blocking 11.
- **(f) PASS:** `error-fix-loop.md` § The three-attempt rule ("V35 → V36 … does not reset the count") and `AGENTS.md` do-not 10.
- **(g) PASS:** `agent-workflow.md` § Integration and release, pre-merge and post-merge evidence.
- **(h) PASS:** § Conductor loop, "Duplicate work".
- **(i) PASS:** `active-mission.md` § Stop condition and workflow § Operating modes (Release/SIT leads to Hold).
- **(j) PASS for the conductor; ambiguous for lanes:** § Sessions, handoff and continuation. Continuation must be verified by its configuration plus a run receipt, so it is not a promise. Lane queue edits conflict with Roles; see Non-blocking 1.

## Verdict

**BLOCKED.** Three targeted text fixes are needed (Blocking 1–3). All are one- or two-sentence edits. Everything else is non-blocking.

## Not checked

- Live GitHub state: PR bodies (audit row 19), CI runs on the candidate, and the #601 hunks (row 18).
- Whether Thomas's 2026-10-09 restructure directive actually authorizes the one-re-run allowance or the new review tiers. The directive text is not in the repo.
- Whether `check:*` scripts pass on this tree; I relied on the audit's statement for that.
- Historical documents (lane-prep, reviews) beyond grep. Spec content under `docs/03-features`.
- Security-tier assessment; this was an ordinary consistency review.

Working notes are in `/tmp/claude-501/review-consistency.md` and `/tmp/claude-501/links-{base,new}.txt`.

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (candidate ed7bb516b2f4e1b0d2c0ddb53f7e036c79419aa8) -->

# Independent ordinary review: consistency delta

- **Exact candidate reviewed:** ed7bb516b2f4e1b0d2c0ddb53f7e036c79419aa8 (`git rev-parse HEAD` in the worktree returned this SHA)
- **Comparison base:** c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12. The delta is 7955d7df (two review notes) and ed7bb516 (the fixes).
- **Reviewer / model / context:** the same fresh Claude Opus 5.5 Agent-tool context (not forked) that wrote the first consistency review. I did not author or fix this change. Under the candidate's own model policy this is extra evidence, not a required GPT-6 Luna review.
- **Files / surfaces checked:**
  - The full `git diff c0d5ef6a..ed7bb516`.
  - `docs/07-planning/security-reviews/615-workflow-policy-consistency-opus.md`, compared with the report I returned.
  - Changed sections of `AGENTS.md`, `agent-workflow.md`, `definition-of-done.md`, `error-fix-loop.md` and `sdlc.md`.
  - The new decision-log entry, with the 2026-10-02 policy-shadow entry and the 2026-10-05 test-vector redaction entry.
  - Audit §5, §6 (F3), §7 and §8.
- **Checks actually run:**
  - Link and anchor checker over every tracked `.md` file: 19 broken links, the same set as the original base 78586b44, so nothing new is broken.
  - Greps for each fix and each previously dropped rule.
  - A semantic check of the new landed-commit verification commands.
  - The 10 scenarios, walked against the new text.
  - `git status --short` stayed clean throughout. Nothing was written to the worktree.

## Previous findings: status

| # | Status | Evidence |
| --- | --- | --- |
| **B1** net-tree diff | **CLOSED** | `agent-workflow.md:198-217`: review records are narrowed to lines added to this PR's own notes plus the reviewer fields of the PR body. The check is now ancestor test + `git log -m --name-status` + `--numstat` with 0 deletions, done "over **landed commits, not the net tree**". It now says it *mirrors* the CI rule instead of equalling it. `-m` checks merges against each parent, and renames, modifications and deletions are rejected, so this is stricter than CI. Under this rule, 7955d7df counts as a review-record-only commit. |
| **B2** two stop rules | **CLOSED** | `agent-workflow.md:95-96` now says "Wait for the pending transitions; stop only under the conductor loop's stop condition". `:115-116` adds "Tasks waiting on CI or review are not a stop condition". |
| **B3** independent diagnosis | **CLOSED** | `error-fix-loop.md:163` "Assign an independent context to diagnose…"; `:166` "Agree a bounded, cause-appropriate repair … before making it". |
| NB1 lanes editing the queue | **CLOSED** | `agent-workflow.md:112-113` and `:334-336` (lane writes the handoff in its PR; the conductor transcribes it); `error-fix-loop.md:152`. |
| NB2 "review counts unchanged" | **PARTIALLY CLOSED** | The decision log now discloses the tier changes. Audit §7 (`workflow-policy-audit-2026-10-09.md:~152`) still says "Not changed: model assignments, review counts…". See New 1. |
| NB3 self-application | **CLOSED** | Decision log ("which applies to this restructure itself"); audit §5 ("needs a full GPT-6 Sol pass before merge"); audit §8 last line. |
| NB4 control-plane ownership | **CLOSED** | `AGENTS.md:80-81`: the conductor owns `status.md`, decision-log entries, and issue and board status; lanes may not edit control-plane files. The `CODEOWNERS:49` pointer is listed in F3. |
| NB5 chat directives | **CLOSED** | `AGENTS.md:45-46`: "takes effect when given, including in chat; record it". |
| NB6 re-run allowance | **CLOSED as a finding.** The fix creates New 3. | `error-fix-loop.md:124-130`: narrowed, and inactive until Thomas approves it in the decision log. |
| NB7 CI and template drift | **PARTIALLY CLOSED** | F3 now lists every stale reference, and audit §5 is corrected. `definition-of-done.md:101` still says "every medium/low finding closed in the spec before the build started". That conflicts with do-not 15 and with workflow § Batching (findings mapped, then dispositioned before merge). This file is in the PR, so it could be fixed here. |
| NB8 `status.md` vs records | **CLOSED** | `definition-of-done.md:112`; `sdlc.md:197`; `agent-workflow.md:118-120` defines the records PR. |
| NB9 model rows | **CLOSED** | `agent-workflow.md:152-156` (architecture review, context preparation, conductor preference, packet author); `:246`. |
| NB10 smaller losses | **Mostly CLOSED** | Restored: calendar pressure (`:122`), pal-mcp evidence (`:161-162`), three or four files (`:332`), notification cadence and continuation identity (`:340-343`), fabrication / `n/a` ban (`AGENTS.md:257`), no unresolved blocking finding (DoD `:16`, `:19`), policy-shadow rules (`:269-272`), exit status and lifecycle (`error-fix-loop.md:184`). **Still OPEN:** "cite spec rule numbers in test names" has no home anywhere in `docs/04-engineering/`. |
| NB11 end-to-end scope | **CLOSED** | `error-fix-loop.md:177`: "Every fix to an evidence runner — not only after the limit". |
| NB12 audit accuracy | **CLOSED** | Row 4 now says 15. The decision log's Supersedes section now names the hierarchy reordering. |

## Findings

**Blocking:** None.

**Non-blocking:**

1. **New: audit §7 still claims review counts are unchanged.** It says "Not changed: model assignments, review counts, …". The new decision entry discloses review-tier changes, so the audit now contradicts the decision record it explains. §7's "Every reference to an 'approved retry policy' (now the bounded verification policy)" and row 5's "one infra re-run" also no longer say the allowance is inactive. **Fix:** change §7 to "every *other* review count" and note the pending approval.

2. **New: "append-only" conflicts with a still-effective redaction decision.**
   - `agent-workflow.md:202-203` says historical notes "are append-only". The decision log entry of 2026-10-05 ("Record both public RFC 6238 test-vector scanner findings accurately") and `agent-workflow.md:273-274` both allow a *labelled redaction* of an existing public review note.
   - `:200-201` also says modifying a line is "a reviewed change", which implies editing is allowed with review.
   - **Fix:** "append-only, except a labelled redaction made as its own reviewed change".

3. **New: the immediate ban on re-runs is not recorded in the decision log.**
   - `error-fix-loop.md:129-130` says "until then, no job is re-run". The decision entry only says the allowance "applies only once Thomas approves it here".
   - Before this change there was no defined policy, so "no re-runs at all" is new, enforceable behaviour. With no approval in place, a pre-test infrastructure failure leaves the task `WAITING_CI` with no defined way forward.
   - **Fix:** state the interim ban in the decision entry, and have the conductor put the approval request to Thomas as a `WAITING_DECISION` item.

4. **New: ownership of decision-log entries is unclear.** `AGENTS.md:80` gives the conductor ownership of "decision-log entries". But `sdlc.md:200` ("Add a decision log entry if a notable choice was made") and `definition-of-done.md:31` (new dependency) expect the implementer to add them. Lanes are not barred from the decision log (`AGENTS.md:81`). Say whether lanes may add entries or only hand them off.

5. **New, minor: the conductor's model conflicts with designation by Thomas.** `agent-workflow.md:154` says "Conductor | A top-level GPT session". `AGENTS.md:80` says it is "The one session Thomas designates". These conflict only if Thomas designates a non-GPT session. AGENTS.md wins, but "GPT preferred" would be clearer.

6. **Open from before:**
   - `definition-of-done.md:101` closure-before-build wording (NB7).
   - The "spec rule numbers in test names" convention (NB10).

7. **The transported note is faithful in substance but not verbatim.**
   - `615-workflow-policy-consistency-opus.md` keeps every finding, file:line citation, scenario result, verdict and "Not checked" item. The process note and the workspace-hygiene disclosure are kept accurately.
   - The layout and wording differ from the report I returned. Bulleted Where / Evidence / Why / Fix structure is collapsed into paragraphs. Some sentences are rephrased, for example "(verified via `git rev-parse HEAD`…)" for "(`git rev-parse HEAD` in the worktree returned this SHA)", and "Workspace hygiene" for "Workspace note". The heading separator also differs.
   - The verdict and findings were not edited, but line 3's "Transported verbatim" is not literally true. The new rule (`agent-workflow.md:219`) requires verbatim transport. This may be an artefact of how my output was relayed. Either recopy the note exactly, or change the provenance line to say it was reformatted, not edited.

## Scenario results

- **(a) PASS:** `agent-workflow.md` § Task states `:93-96` and § Conductor loop `:105`, `:115-116`.
- **(b) PASS:** § Task states, "A pending decision stops only the decision path it governs".
- **(c) PASS:** § Verification "CI today" `:276-281` and `AGENTS.md` § Authority (enforced gates).
- **(d) PASS:** § Exact head and evidence reuse `:198-221` (landed-commit check plus tracing each record to its reviewer), and DoD § Levels of done, Merge-ready.
- **(e) PASS:** `error-fix-loop.md:177-185`, "Every fix to an evidence runner — not only after the limit".
- **(f) PASS:** `error-fix-loop.md` § The three-attempt rule ("does not reset the count") and `AGENTS.md` do-not 10.
- **(g) PASS:** `agent-workflow.md` § Integration and release (pre- and post-merge evidence), and DoD Merge-ready (pre-merge runtime proofs).
- **(h) PASS:** § Conductor loop, "Duplicate work".
- **(i) PASS:** `active-mission.md` § Stop condition, and DoD "Mission complete … with no unresolved blocking finding" leading to Hold.
- **(j) PASS:** `agent-workflow.md:334-343` (lane handoff in its PR, conductor transcribes it, continuation verified and identity recorded, no promise).

## Verdict

**CLEAR WITH NON-BLOCKING.** All three earlier blocking findings are closed. No new blocking contradiction was introduced. The remaining items are wording and record-accuracy fixes. The required GPT-6 Luna reviews and the full GPT-6 Sol pass, which audit §5 and §8 say this PR needs, are still outstanding.

## Not checked

- Live GitHub state: the PR number (I assumed 615 from the note filenames), PR body fields, and CI on ed7bb516.
- The authority reviewer's note (`615-workflow-policy-authority-opus.md`), and whether its findings are fully closed. That is outside my focus beyond the shared fixes I checked.
- Whether Thomas's directive authorizes the new review tiers.
- Running the landed-commit commands against an actual review-record delta. I checked them by reading only.

<!-- END REPORT 2 -->
