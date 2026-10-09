# 615 — workflow policy restructure: round-5 independent delta reviews (Opus 5.5)

- **Reviewer contexts:** fresh Claude Code Agent-tool subagents (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`), parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. None authored, directed or remediated the change.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent ab3e25fe3c42ba55a; candidate db071e38c05f7feac38c1b6eadc0e3672339072a; sha256 985dfac89470cedf2b8766006fac3db69d833e8e673312099dabc7fb95a2d500) -->

# Independent ordinary review — #615 complete-diff follow-up at db071e38
- **Exact candidate reviewed:** db071e38c05f7feac38c1b6eadc0e3672339072a. It descends from b617f0b8.
- **Comparison base:** b617f0b80be93b264ac3008a6c64fa37fa463a98 for the delta. Silent-loss and link checks were re-run against `main` 3096cb04.
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), in the same fresh Agent-tool context (general-purpose, not forked) that wrote the round-4 complete-diff review. I did not author, direct or remediate this change. I did not edit the repository or switch its branch. My scratch notes are in `$TMPDIR/615-ordinary-full.md`.
- **Files / surfaces checked:** the delta has two commits, 41ecd3e5 and db071e38, across 12 files:
  - `AGENTS.md`, `CLAUDE.md`
  - `agent-workflow.md`, `definition-of-done.md`, `error-fix-loop.md`, `sdlc.md`
  - `active-mission.md`
  - `decision-log.md`
  - `workflow-policy-audit-2026-10-09.md`
  - the headers of the 615 authority and consistency notes
  - the new `615-workflow-policy-round4-opus.md`

  For cross-checking I read `scripts/ci/lib/pr-body.mjs` at db071e38.
- **Checks actually run:**
  - **Per-commit listing of the delta.** 41ecd3e5 only adds the round-4 note. db071e38 changes 11 files.
  - **Link and anchor checker, same script as round 4.**
    - Changed files at db071e38: 2 broken links. Both are in old decision-log entries and both were already broken on `main`.
    - Whole repo: the set of broken links is identical to b617f0b8.
  - **Live-state grep of the added lines.** The only hit is "currently" in `sdlc.md:29`, which was my own suggested wording.
  - **Node test of `checklistProblems` from `pr-body.mjs`.**
    - The new Definition of Done wording is still detected as the review item.
    - When marked `n/a` it is still rejected, the same as the old wording.
    - Ticked, it passes.
  - **Scratch-repo test of the new `git log -m --format=%H --raw --no-abbrev --no-renames` listing.** A net diff hid the code change. The listing showed all of these:
    - a reverted code change;
    - a mode change from 100644 to 100755;
    - a rename, shown as a delete plus an add;
    - the changes in a merge, shown against each parent.
  - **SHA-256 of REPORT 1.** Lines 8–112 of the round-4 note, without the trailing newline, hash to `eb978ee99463cf1773d0603e115f1886765e1ad56f9d94dcd41aba8afa4c365f`. That matches the value in the marker.

## Status of round-4 items
1. **CLOSED.**
   - `AGENTS.md:237` and `:242-247` add the delegated-policy-maintainer exception, plus the conductor's confirmation of the review set.
   - In `definition-of-done.md:16`, Merge-ready now names "The conductor (or a delegated policy maintainer, for its own candidate)".
   - The Supersedes list at `decision-log.md:41-46` now names "protected merge by the conductor alone".
2. **CLOSED.** `definition-of-done.md:51` and `:114` now read "Security review by an accepted security-review model". `REVIEW_ITEM` still matches this wording and still refuses `n/a`; I confirmed that by running the node test.
3. **CLOSED.** `agent-workflow.md:177-178` now reads "Once installed, `check:policy` keeps the block well formed."
4. **CLOSED.** `agent-workflow.md:319-320` now says "**Which checks run** on which change is defined in ci-cd.md". The time-bound "CI today" sentence is gone.
5. **CLOSED.**
   - `agent-workflow.md:20` (the modes table) and `:349-350` now point publication to "the destinations the active mission names" and say "Production deployment is Thomas's alone".
   - The GHCR and Docker Hub text now lives only in `active-mission.md`.
   - A residual nit is non-blocking finding 2 below.
6. **CLOSED.**
   - `agent-workflow.md:360-362` adds "Pause the affected task" for an unplanned schema change, a conflict with an ADR, or an unforeseen contradiction in the codebase. Other tasks continue.
   - `AGENTS.md:28-29` adds coding standards to the startup reading list.
7. **CLOSED.** `sdlc.md:29-30` now reads "the conductor's queue (currently `…integration-execution-queue.md`)".
8. **CLOSED.** `CLAUDE.md:47-49` now reads "A Claude session fills whichever role the model policy and the active mission give it". The mission-specific copy is gone.
9. **CLOSED.**
   - `workflow-policy-audit-2026-10-09.md:140-142` adds a "Superseded in part by §9" note that covers merge authority.
   - Lines 210-214 replace the "still outstanding" sentence.
   - The new §11 lists every dispatched review.

**Round-4 REPORT 1 is byte-identical to what I returned.**
- The text between the markers, lines 8–112 of `615-workflow-policy-round4-opus.md`, matches my final message line for line. I compared it against my own returned message. I cannot see the platform transcript, so this was not a byte-by-byte comparison against it.
- The SHA-256 recorded in the marker matches those bytes, measured without the trailing newline.
- The ledger in §11 records my verdict correctly: CLEAR WITH NON-BLOCKING, on the complete diff against `main`.
- I cannot see my own agent ID (`ab3e25fe3c42ba55a`), so I have not verified it.

## Findings
**Blocking:** None

**Non-blocking:**
1. **The owner-directive record now carries a condition Thomas did not state.** The Supersedes parenthetical at `decision-log.md:42-44` adds "after the conductor confirms its review set". The directive's own decision paragraph says only "after agreeing the merge window with the current conductor".
   - It tightens rather than loosens, and the same rule appears in `AGENTS.md:246` and `agent-workflow.md:257-259`.
   - But it puts a maintainer-added requirement inside an entry whose authority comes from faithfully recording Thomas's directive. `AGENTS.md` § Authority says only faithful records carry his authority.
   - Suggest labelling it, for example "(the workflow additionally requires …)".
2. **The "SIT" wording is generalized in one place but not the next.** The modes table (`agent-workflow.md:20`) now says "the approved test environment". `agent-workflow.md` § Integration and release (around line 351) still opens its bullet with "**SIT:**". This is cosmetic, because the mode itself is still named "Release and SIT verification".
3. **Two existing note headers were edited, as an observation.** db071e38 changes the publisher-written "Spawn" line in `615-workflow-policy-authority-opus.md:4` and `615-workflow-policy-consistency-opus.md:4`, from "API error" to "stopped … by a platform safeguard".
   - These lines are outside the report markers, and the report bodies are unchanged.
   - The edit sits in a reviewed fix batch, not in a review-record-only delta, so the record-only rule is not engaged.
   - I cannot verify the corrected description against the transcripts.

**Silent-loss re-check against `main`, for the files the delta touches:** nothing was lost.
- The delta restores `main`'s stop triggers and coding standards in the reading list.
- It restores `main`'s "GPT-6 Luna, explicitly selected" and its preference for GPT-6 Sol on broad governance work.
- The removed text — "CI today", the GHCR / Docker Hub / production line, and the mission-specific copy in `CLAUDE.md` — now lives in `ci-cd.md`, `active-mission.md` and the Owner role, and the workflow points to them.
- The evidence row was renamed to "CI-script test results". A note keeps review verdicts under the first row, which tightens the rule.

## Scenario results
| Scenario | Result | Governing text at db071e38 |
| --- | --- | --- |
| Authorized branch publication | PASS | `AGENTS.md:240-241`; Lane agent row at `AGENTS.md:96` |
| One blocked decision with another runnable task | PASS | `agent-workflow.md:89-92`; also the new pause rule at `:360-362` ("Other tasks continue") |
| CI/review completion | PASS | `agent-workflow.md:93-99` and `:117` |
| Safe record-only publication | PASS | `agent-workflow.md` § Exact head and evidence reuse (211-264), now with `--raw --no-abbrev --no-renames`, which I verified in the scratch repo; `definition-of-done.md:16` |
| Forged verdict rejection | PASS | `agent-workflow.md:167` (never mislabel a model), `:250-262` (reports published unedited; every dispatched review recorded; author never asks for a changed verdict; trace to reviewer); `AGENTS.md:276` (do-not 7) |
| Code-then-revert detection | PASS | `agent-workflow.md:238-244`; the scratch repo showed the revert, mode change, rename and merge-parent cases |
| Equivalent-SHA retry counting | PASS | `error-fix-loop.md:124-135`: equivalent new SHAs do not reset the allowance, and for every failure class a commit made only to rerun counts as the re-run |
| Actual runner invocation | PASS | `error-fix-loop.md` § The three-attempt rule (148) and § End-to-end validation for evidence runners (181) |
| Main-only signed-release sequencing | PASS | `agent-workflow.md:345-348`; `definition-of-done.md:16` |
| Final SIT stop | PASS | `active-mission.md` § Stop condition; the Hold exit in `agent-workflow.md:20`; `definition-of-done.md` Mission complete |
| Session end | PASS | `agent-workflow.md:381-391` |

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a7892031e5d3927c9; candidate db071e38c05f7feac38c1b6eadc0e3672339072a; sha256 fd3c33c4022a0ffd5d86d5066344a281fbd4fbf8c317bb98e268ac20cb4b7d45) -->

# Independent ordinary review — #615 delta b617f0b8..db071e38
- **Exact candidate reviewed:** db071e38c05f7feac38c1b6eadc0e3672339072a
- **Comparison base:** b617f0b80be93b264ac3008a6c64fa37fa463a98. The delta is two commits: 41ecd3e5, which adds the round-4 note (308 lines added, 0 deleted), and db071e38, the fix batch. Together they change 12 files.
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), in a fresh Agent-tool context (general-purpose, not forked). This is the same context that produced the round-4 delta report, agent `a7892031e5d3927c9`. I did not author or remediate this change, and I made no edits to the repository.
- **Files / surfaces checked:**
  - The full `git diff b617f0b8..db071e38` and both commit messages.
  - `AGENTS.md` (startup list, Authority, Roles, merge section) and `CLAUDE.md`.
  - `agent-workflow.md`: Operating modes, Model policy and its block, the evidence-reuse table, review records, the new review-integrity paragraph, "Which checks run", Publish, and Escalation.
  - `definition-of-done.md` lines 16, 51 and 113; `error-fix-loop.md` lines 116–136; `sdlc.md` line 29; `active-mission.md` lines 4–12, 30, 41 and 49.
  - The newest decision-log entry, including its Supersedes line, checked against the titles of the 2026-09-29 entries at `decision-log.md:1256` and `:1280`.
  - Audit §7, §8 and §11.
  - The headers of both 615 notes and the whole round-4 note.
  - `ci-cd.md` at the candidate, searched for an applicability rule.
  - #616's branch head 3446fac5, checked only for the presence of its 616 notes.
  - Every subagent transcript and `.meta.json` file in session `412b91f1-…`.
- **Checks actually run:**
  - Ran `cmp` on the authority and consistency note bodies (BEGIN marker to end of file) at b617f0b8 and db071e38.
  - Extracted all three round-4 reports between their markers, recomputed SHA-256, and compared each with the final assistant text of its agent's transcript.
  - Read each reviewer's verdict from all nine transcripts, to check the §11 ledger.
  - Inspected the last turns of both transcripts that received the "write your reports to a file" request, including the tool calls.
  - Ran a scratch-repo test of `git log -m --raw --no-abbrev --no-renames` against a mode-only change and a rename.
  - Ran the relative-link and anchor checker over the 11 changed Markdown files (147 links) and over `decision-log.md`.
  - Grepped for publish destinations, Docker Hub, `applicab` and model names.

## Status of round-4 items
| # | Status | Evidence at db071e38 |
| --- | --- | --- |
| 1. Merge authority contradicts itself | **CLOSED** | `AGENTS.md:235-247` now reads "(or, for its own candidate, a delegated policy maintainer)" and adds the exception to "Only the conductor merges". `definition-of-done.md:16` gives merge-ready to the conductor or the delegated maintainer. `decision-log.md:41-43` supersedes "conductor alone". There is a small wording nit (non-blocking 2). |
| 2. DoD checklist still says GPT-6 Sol | **CLOSED** | `definition-of-done.md:51-53` and `:114-116` now read "Security review by an accepted security-review model ([model policy])". |
| 3. `check:policy` described in the present tense | **CLOSED** | `agent-workflow.md:178` now says "Once installed, `check:policy` keeps the block well formed." |
| 4. Audit §8 stale and overstated | **CLOSED** | The "Correction after round 4" paragraph names both replaced wordings, explains why `--summary` failed, and points to §11. The obsolete "GPT reviews outstanding" sentence is gone. §7 carries a "Superseded in part by §9" banner. |
| 5. Supersedes points at the wrong entry | **CLOSED** | `decision-log.md:43-46` names "OpenAI model routing replaces Claude/`pal-mcp` routing" and "Opus 5.5 retained as sampled big reviewer". Both titles match `:1256` and `:1280` exactly. It also says "GPT roles stand". |
| 6. Note headers misdescribe how the last turn ended | **PARTIALLY CLOSED** | The authority header (`615-…-authority-opus.md:4`) is now accurate. The transcript shows a `Write` to `/tmp/claude-501/615-authority-review-1-c0d5ef6a.md`, stopped as "Not run". The consistency header (`615-…-consistency-opus.md:4`) uses the same sentence, "its attempted write did not run", but transcript `ab2ce0e07c89e65a8` records no `Write`. Only thinking was stopped, followed by the API-error turn. See non-blocking 1. |
| 7. GPT routing details dropped | **CLOSED** | `agent-workflow.md:152-154` restores "explicitly selected", "security- or architecture-heavy context preparation" in the Sol row, and the conductor preference, now phrased as "a GPT conductor prefers GPT-6 Sol". |
| 8. Model block not tied to the mission | **CLOSED** | `agent-workflow.md:178-179` says "The block follows the mission…". `active-mission.md:9-11` says replacing the mission "also re-decides the security-review model block". |
| 9. (Information) queue file absent | **Unchanged, as expected** | `sdlc.md:29` now says "(currently `…integration-execution-queue.md`)". The file is still absent at the candidate, as disclosed in audit §9. |

The fix from round 3 item 5, carried into round 4, is now effective. In the scratch test, `--raw --no-abbrev --no-renames` shows a mode-only change as `:100644 100755 … M` and a rename as `D` plus `A`, which matches the inline comment "only A/M of this PR's notes, mode 100644".

**REPORT 2 in `615-workflow-policy-round4-opus.md` (lines 116–214):** byte-identical to my round-4 final message after stripping surrounding whitespace. I compared it with the only long assistant text in transcript `agent-a7892031e5d3927c9.jsonl` (15:00:05Z, `claude-opus-5-5`). Its SHA-256 `04aeb479…064942` matches the marker. Reports 1 (`ab3e25fe…`, `eb978ee9…`) and 3 (`abe50404…`, `54d96011…`) also match their transcripts and markers.

**Audit §11 ledger:**
- All nine subagents in the session directory appear, and none is missing. Their descriptions, candidates and verdicts match the transcripts:
  - Rounds 1–2: ab2ce0e0 and a731c07f, with the BLOCKED, BLOCKED, CLEAR WITH NON-BLOCKING and BLOCKED (transport) verdicts as stated.
  - Round 3: a49bbfaf (CLEAR WITH NON-BLOCKING).
  - Round 4 on #615: ab3e25fe (CLEAR WITH NON-BLOCKING), a7892031 (CLEAR WITH NON-BLOCKING), abe50404 (BLOCKED).
  - Round 4 on #616 at 7e8ab217: a3487970 (BLOCKED), a32abc36 (BLOCKED), a399c1ab (CLEAR WITH NON-BLOCKING).
- The safeguard-stopped row is accurate.
- The 616 notes exist on #616's branch (`616-policy-enforcement-round4-opus.md`), not in this tree, as the ledger implies.

## Findings
**Blocking:** None.

**Non-blocking:**

1. **The consistency note header overstates what happened** (`615-workflow-policy-consistency-opus.md:4`).
   - The header says "its attempted write did not run". That context recorded no write attempt; its response was stopped before any tool call.
   - Suggested wording: "was stopped before completing by a platform safeguard; no tool call ran and no report was produced".
   - The bodies of both notes remain byte-identical to b617f0b8.
2. **The confirmation clause in `AGENTS.md:245-247` is broader than the workflow's.**
   - It says "When the merger also dispatched the candidate's reviews, the conductor first confirms the review set is complete."
   - Read literally, it also covers the conductor merging work whose reviews it dispatched itself, which makes the confirmation self-referential.
   - `agent-workflow.md:258-259` narrows it correctly to "(a delegated policy maintainer)". Mirror that qualifier in `AGENTS.md`.
3. **"Which checks run" cites a rule that is not in this tree** (`agent-workflow.md:319-320`).
   - It says the rule is "defined in ci-cd.md, including its applicability rule". `ci-cd.md` at db071e38 has no applicability rule; it exists only in #616.
   - The true current-state sentence, "every pull request runs every required check", was removed, though audit §9 still states it.
   - Hedge as was done for `check:policy`, for example "and, once installed, its applicability rule".
4. **The §11 closing line claims closure ahead of the new disposition rule.**
   - "Every round-4 blocking finding is fixed in the following batch" asserts closure. The new rule at `agent-workflow.md:256-257` says a blocking finding "stays open until an independent reviewer records its disposition".
   - It also spans #616, whose fixes are not in this candidate.
   - Suggested wording: "addressed in the following batches (#615 db071e38; #616 separately), pending independent disposition".

Other checks on the fix batch:
- **Publish destinations:** moving them out of `agent-workflow.md:331-332` and the mode table loses nothing. `active-mission.md:30` keeps GHCR, GitHub Releases, tags and Packages, `:41` keeps the Docker Hub ban, and "Production deployment is Thomas's alone" is retained.
- **Startup list:** the coding-standards entry links to a file that exists.
- **New escalation paragraph:** consistent with the task states.
- **Re-run edits:** match the definitions round-4 asked for, and the commit-to-rerun clause now applies to every failure class.
- **Merge-ready:** the "every dispatched review is recorded" clause in `definition-of-done.md:16` agrees with `agent-workflow.md:252-259`.
- **Records-only status:** 41ecd3e5 adds one new file of this PR's own notes and deletes nothing, so it is a review-record-only commit.

**Links:** the 11 changed files have 147 relative links and none are broken. `decision-log.md` has 2 broken links at `:764` and `:5901`. Both are in historical entries and were already broken before this delta; they moved 3 lines down after the Supersedes edit.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent abe5040402caed3a3; candidate db071e38c05f7feac38c1b6eadc0e3672339072a; sha256 ed781d2afd08643c4718897f57b5b15b00fc50c16ea7cb2e4b47e0a51d1887bd) -->

# Independent security/authority review — #615 delta b617f0b8..db071e38
- **Exact candidate reviewed:** db071e38c05f7feac38c1b6eadc0e3672339072a
- **Comparison base:** b617f0b80be93b264ac3008a6c64fa37fa463a98. It is an ancestor of the candidate. The delta is two commits:
  - 41ecd3e5 adds `615-workflow-policy-round4-opus.md`.
  - db071e38 is the fix batch. It changes 11 files, including in-place header edits to two existing 615 notes and to the unmerged Opus decision-log entry.
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5). Same fresh Agent-tool context as round 4 (general-purpose, not forked; agent `abe5040402caed3a3`). Role: security/authority reviewer. I did not author, direct or remediate the change. I was dispatched by the authoring session `412b91f1-99f8-4ac2-8f5c-a03dce507862`.
- **Files / surfaces examined:**
  - The full `git diff b617f0b8..db071e38`.
  - At db071e38: `AGENTS.md`, `agent-workflow.md`, `definition-of-done.md`, `error-fix-loop.md`, `active-mission.md`, `CLAUDE.md`, the decision-log Opus entry, and audit §7, §8 and §11.
  - The round-4 note, all three reports.
  - The subagent transcripts and meta files for session `412b91f1…`.
- **Checks actually run:**
  - `git log -m --raw` over the delta.
  - **Report 3 byte check:** I took the text between the BEGIN/END REPORT 3 markers and compared it with my final message in my own transcript (`agent-abe5040402caed3a3.jsonl`). The two are identical. Both hash to SHA-256 `54d96011b6a6cb29f045980627f6f19afdb6336c63ab356b2b1b2fbf94f892a4`, which matches the marker.
  - **Corrected note headers:** I checked them against the reviewer transcripts. The earlier request was to write the reports byte-for-byte to `$TMPDIR`, and a safety classifier stopped it. The old wording "rewrite its reports" was inaccurate. The new wording is accurate, and it removes the factual basis of my round-4 aside that a reviewer had been asked to revise.
  - **Ledger completeness:** the audit §11 ledger lists all 9 subagents present in the session's `subagents/` directory.
  - **`--raw` listing:** I ran it in a scratch repo. It flags a symlink (`120000`), a mode change (`100755`) and a product file brought in by a merge, charged per parent.
  - No live GitHub state could be checked.

## Disposition of round-4 findings
- **Blocking 1 (choosing which reviews to keep): CLOSED.**
  - `agent-workflow.md:253-259`: every dispatched review is recorded, whatever its verdict. Re-dispatch is allowed only for a reason unrelated to the verdict. The author never asks a reviewer to change its findings or verdict. A blocker stays open until an independent reviewer dispositions it. The conductor confirms the review set when the merger also dispatched the reviews.
  - Also `AGENTS.md:245-246`, `definition-of-done.md:16` ("every dispatched review is recorded"), and the audit §11 ledger, which I verified as complete.
- **Blocking 2 (forced "GPT-6 Sol" attestation): CLOSED.** `definition-of-done.md:51-53` and `:114-116` now read "Security review by an accepted security-review model …". This still matches `REVIEW_ITEM` (`security\s+review`). The stale quotation at `ci-cd.md:330` belongs to #616.
- **NB1 (merge-authority contradiction): CLOSED.** `AGENTS.md:236-246`, `definition-of-done.md:16`, and the decision-log Supersedes line at `:41-46`. See new NB2.
- **NB2 (model allowlist outlives the mission): CLOSED as policy text, not machine-enforced.** `agent-workflow.md:178-179` and `active-mission.md:9-10`.
- **NB3 (verbatim publication weakened): CLOSED.** `agent-workflow.md:249-251` requires unedited publication, allowing only a labelled, separately reviewed redaction.
- **NB4 (re-run loopholes): CLOSED.** `error-fix-loop.md:125-126` defines an incident as "the same job failing on equivalent inputs". `:134-135` applies the commit-made-only-to-rerun rule to every failure class.
- **NB5 (ambiguous evidence-reuse row): CLOSED.** `agent-workflow.md:221`.
- **NB6 (self-approval claim too broad): CLOSED.** `agent-workflow.md:173-177`.
- **NB7 (`check:policy` cited as existing): CLOSED.** `agent-workflow.md:177-178` ("Once installed").
- **NB8 (stale audit §7): CLOSED.** Audit `:140-142`, plus the §8 correction.
- **NB9 (who may edit the active mission): CLOSED.** `active-mission.md:7-10`: the conductor or an assigned policy maintainer edits it, records Thomas's decision in the same change, and takes the agent-authority review tier.
- **NB10 (merge readiness): PARTIALLY CLOSED.**
  - Round-4 reports 1 and 2 give two ordinary CLEAR WITH NON-BLOCKING verdicts at b617f0b8.
  - db071e38 changes policy text, so it needs its own ordinary delta reviews at the workflow-policy tier.
  - Required checks must be green on db071e38. I could not verify them.

## Findings
**Blocking:** None.

**Non-blocking:**
1. **Note additions are append-only only at the line level.** In `agent-workflow.md:242-244`, `--numstat` with zero deletions still passes lines inserted *inside* an existing report, between its markers. That leaves only the prose ("verdict is unchanged") guarding it. **Fix:** require additions to land after the last END marker or in a new file, and have the conductor compare each existing report's marker digest.
2. **Agent text sits inside an owner-decision record.** In the unmerged Opus entry, the edited Supersedes line (`decision-log.md:41-46`) now includes the condition "after the conductor confirms its review set". That condition is the policy maintainer's own addition, not Thomas's words. Label it as such, or keep it only in `AGENTS.md` and the workflow.
3. **"Verifiable" now means the recipient's own record.** `AGENTS.md:55-57`: "That record is what makes it verifiable." The record can sit on an unmerged branch. **Suggest:** a decision handed to another agent counts as verifiable only once its record is on `main`, or Thomas confirms it to the receiving session. This narrows a residual I raised in round 4; it is not a regression from round 3.
4. **Some review records can still be deleted later.** `agent-workflow.md:254` allows recording a dispatched review "in the candidate's review notes or PR". PR comments and body text can be changed or deleted. Prefer the committed notes, as this candidate already does.
5. **The Docker Hub ban now lives only in the mission.** `agent-workflow.md:20,349-350` now defer publication destinations to the active mission. The Docker Hub ban survives only at `active-mission.md:41`, which only Thomas's decision changes. That is acceptable, but disclose it as a change from the earlier fixed rule.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
