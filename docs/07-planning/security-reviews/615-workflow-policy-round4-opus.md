# 615 — workflow policy restructure: round-4 independent reviews (Opus 5.5)

- **Reviewer contexts:** fresh Claude Code Agent-tool subagents (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`), parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. None authored, directed or remediated the change.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent ab3e25fe3c42ba55a; candidate b617f0b80be93b264ac3008a6c64fa37fa463a98; sha256 eb978ee99463cf1773d0603e115f1886765e1ad56f9d94dcd41aba8afa4c365f) -->

# Independent ordinary review — #615 complete diff
- **Exact candidate reviewed:** b617f0b80be93b264ac3008a6c64fa37fa463a98
- **Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a (accepted `main`). The scope is the full `git diff 3096cb04..b617f0b8`: 22 commits, the #612 commits f4dc35d2…78586b44 included, 28 files.
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), in a fresh Agent-tool context (general-purpose, not forked). I did not author or remediate this change. I did not edit the repository. My scratch notes are in `$TMPDIR/615-ordinary-full.md` (`/tmp/claude-501/615-ordinary-full.md`).
- **Files / surfaces checked:**
  - Candidate and `main` versions of `AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`, `definition-of-done.md`, `sdlc.md` and `error-fix-loop.md`.
  - `docs/07-planning/active-mission.md`.
  - The new decision-log entries ("Instruction 1 — Opus policy-repair conductor", "workflow and agent-policy restructure", "Conductor Coordination", "Integration Freeze"), plus the 2026-09-06 squash entry.
  - `docs/07-planning/workflow-policy-audit-2026-10-09.md` and the headers of the 615 review notes.
  - For cross-checking: `docs/04-engineering/ci-cd.md`, `.github/pull_request_template.md`, `scripts/ci/lib/pr-body.mjs` (`REVIEW_ITEM`), `product-principles.md` §7 and `runbook.md` (policy shadow).
  - The local branches `claude/policy-enforcement-20261009` (#616) and `codex/p0-088-operational-records` (#601).
- **Checks actually run:**
  - **Link checker.** I wrote a Python script that reads git objects only. It resolves relative paths and anchors, using GitHub-style slugs plus `<a id>` tags.
    - Changed files: 2 broken links, both in old decision-log entries and both identical on `main`.
    - Whole repo: the set of broken links is the same on `main` and the candidate (15 outside the decision log, 2 inside it). The old `#bulk-implementation-and-review-cadence` anchor still resolves.
  - **Live-state grep.** I searched the added lines of permanent policy files for SHAs, PR numbers and counts.
  - **Scratch-repo test of the record-only listing.** Sequence: a code commit, its revert, then a note commit. A net diff showed only the note. The per-commit `git log -m --name-status --summary` and `--numstat` listings showed `src/x.ts` in both commits.
  - **Existence checks.** `scripts/ci/lib/review-models.mjs`, `check:policy` and the queue file are each absent at the candidate and at `main`. `status.md` is the same blob as on `main`.
  - **Queue preservation.** I compared section headings between #612's queue (78586b44) and the local records branch.

## Findings
**Blocking:** None

**Non-blocking:**
1. **The merge-authority text contradicts itself.**
   - `AGENTS.md:239` says "**Only the conductor merges**". `AGENTS.md:96` lets the policy maintainer "perform the eligible protected merge of its own policy candidate".
   - In `definition-of-done.md:16`, Merge-ready is claimed by "The conductor".
   - `decision-log.md:93` (the restructure entry) keeps "protected merge by the conductor alone" as unchanged. The new Opus entry does not list that line under Supersedes, and its `decision-log.md:42-44` says "That entry's other content stands".
   - The hierarchy settles the conflict, because Thomas's directive ranks first. But the text conflicts in two places.
   - Fix: at `AGENTS.md:239`, add "(or a policy maintainer for its own candidate, per § Roles)". Name the conductor-only merge line in the Opus entry's Supersedes list. That entry has not merged yet, so it can still be edited.
2. **The Definition of Done still names the old security model.** `definition-of-done.md:51,113` still read "GPT-6 Sol security review completed". The same file now says the model is "one accepted security-review model" (around line 244), and the model policy now allows Opus.
   - Under the current mission, an author whose security review was done by Opus would have to tick a box naming GPT-6 Sol. That cuts against "Never label a report with a model that did not produce it".
   - `REVIEW_ITEM` (`pr-body.mjs:904`) matches any "security review", so the wording can safely become "Security review completed…". #616 does not touch the Definition of Done.
3. **The workflow claims a check that does not exist yet.** `agent-workflow.md:176` says "`check:policy` keeps the block well formed". Neither `check:policy` nor `review-models.mjs` exists at the candidate or on `main`; they exist only in #616. The fallback for the model reader is hedged in the text, but `check:policy` is not. Fix: add "(once the enforcement change lands)".
4. **One workflow sentence will become false once #616 merges.** `agent-workflow.md:307` says "CI today: every pull request runs every required check, whatever it changes". #616's applicability change will make this untrue, and #616 does not edit `agent-workflow.md`. It is also time-bound wording inside a permanent file.
5. **Some current mission scope also sits in a permanent file.** `agent-workflow.md:20` and `:337-342` hard-code "GHCR, GitHub Releases… No Docker Hub. No production" and SIT. That repeats `active-mission.md:37-42`, and the Docker Hub ban has no other policy home. This goes against the decision "Mission text… lives only in `active-mission.md`".
6. **Some of `main`'s stop rules have no new home.** `main`'s `agent-workflow.md` "When an agent should stop" said to stop when:
   - a schema change looks necessary and was not in the task;
   - the task appears to conflict with an ADR;
   - something in the codebase looks wrong in a way the task did not foresee.

   None of these has a home in the candidate, and none is named as superseded. The escalation section now covers owner-only decisions only.

   Also, `coding-standards.md` dropped out of the startup reading list and out of the `AGENTS.md` list of specialist standards. It is now reachable only through SDLC step 4 and the workflow's "Related" links.
7. **SDLC step 1 depends on a file that is not on `main`.** `sdlc.md:29-30` makes "a task is `READY` in … `integration-execution-queue.md`" the entry condition for step 1. That file is absent at the candidate and on `main`, and its name is specific to this mission. On `main`, the condition cannot be met until #601 lands, or under any future mission without that queue. Suggest "the conductor's queue (currently …)".
8. **The adapter repeats policy.** `CLAUDE.md:47-50` repeats mission-scoped model policy ("Under the current mission a Claude Opus session may fill any role…") in a file that says it "adds no policy". The content matches the workflow, but it is a second copy.
9. **The audit record is slightly stale.** `workflow-policy-audit-2026-10-09.md` §7 still lists "merge authority" under "Not changed", and §8 still says the GPT-6 Luna and Sol reviews are outstanding. §9 does not restate either point after Instruction 1. These are minor accuracy points in a dated record, not policy.

**Silent-loss check (item 1), apart from findings 6–7.** Each of these has a home or an explicit supersession:
- **Bulk cadence and the P0–P3 human-review deferral:** SDLC, Definition of Done, and workflow § Batching.
- **Three-UTC-date policy shadow:** workflow § Verification and `runbook.md:742`.
- **Security tier table and `scripts/ci/**` classification:** workflow § How many reviews.
- **Change altitude, phase finalizer, sampled-review packet:** kept in the workflow.
- **Retired pal-mcp tooling:** kept.
- **Bypass and CODEOWNERS bans:** `AGENTS.md:244-249`.
- **Fabrication ban:** do-not 7.
- **Rule against leaving work unpushed:** workflow § Sessions.
- **Flake rule:** `testing-strategy.md:490`.
- **Production promotion by digest:** `ci-cd.md:586` and `environments.md`.
- **Stage sequencing:** `product-principles.md` §7 already allows parallel starts.
- **Skills table:** correctly reduced to the two directories that exist.
- **"Uncommitted until Thomas says commit":** superseded by the Integration Freeze entry.

## Scenario results
| Scenario | Result | Governing text |
| --- | --- | --- |
| Authorized branch publication | PASS | `AGENTS.md` § How work reaches `main` (lines 233-238); § Roles, Lane agent |
| One blocked decision with another runnable task | PASS | `agent-workflow.md` § Task states (lines 89-92) |
| CI/review completion | PASS | `agent-workflow.md` § Task states (93-99), § The conductor loop step 6 (117-119) |
| Safe record-only publication | PASS | `agent-workflow.md` § Exact head and evidence reuse (221-244); `definition-of-done.md` § Levels of done, Merge-ready |
| Forged verdict rejection | PASS | `agent-workflow.md` § Exact head and evidence reuse (246-251, trace to reviewer; a hash is not proof); § Model policy (165-170); `AGENTS.md` do-not 7 |
| Code-then-revert detection | PASS | `agent-workflow.md:233-242` ("a revert never restoring a clearance", per-commit listing); confirmed in the scratch repo |
| Equivalent-SHA retry counting | PASS | `error-fix-loop.md` § Bounded verification policy (124-132) |
| Actual runner invocation | PASS | `error-fix-loop.md` § The three-attempt rule and § End-to-end validation for evidence runners |
| Main-only signed-release sequencing | PASS | `agent-workflow.md` § Integration and release (330-336); `definition-of-done.md` Merge-ready |
| Final SIT stop | PASS | `active-mission.md` § Stop condition; `agent-workflow.md` § Operating modes (Release and SIT verification → Hold); `definition-of-done.md` Mission complete |
| Session end | PASS | `agent-workflow.md` § Sessions, handoff and continuation (365-375) |

**Required properties:**
- **Authority hierarchy:** owner → `AGENTS.md` → workflow → specialist standards → `CLAUDE.md` → queue/status. Correct at `AGENTS.md:50-72`.
- **Startup order:** correct at `AGENTS.md:21-31`.
- **Modes and levels of done:** five modes and five levels of done are present.
- **Yield with a named trigger:** present.
- **Review-record exemption:** limited to authentic publication of existing reports and verified over every intervening commit. Present.
- **Opus labelling:** Opus is authorized for every role and never labelled as GPT. Present.
- **Squash merge method:** recorded in the decision log and backed by the 2026-09-06 entry.

**Records separation (item 6):** sound.
- The queue file is absent at the candidate.
- `status.md` is the same blob as on `main` (`2000839e`).
- The policy files name the queue by path without a link, so no link breaks.
- On the local `codex/p0-088-operational-records` ref, every #612 queue heading is present (checkpoints 12:40 down to 03:47, and "Exact human decisions newly unblocked"). The open-PR table rows there are updated in place, which is the conductor's normal practice.
- #612's "Historical control-plane snapshot" `status.md` section survives only in branch history. After a squash merge it lives only on the #612 and #615 refs. Those refs are protected by the "never delete branches" rule.
- The policy docs still work without the queue, except for finding 7.

## Verdict
CLEAR WITH NON-BLOCKING

## Not checked
- The remote state of `codex/p0-088-operational-records` (#601). `git fetch origin` failed, so I checked only the local ref, last commit d9528207.
- Live GitHub PR state, checks and rulesets (`gh` was not used).
- The SHA-256 transport claims in the 615 review notes, and whether those reports are byte-identical to the original transcripts.
- The correctness of #616's code, beyond confirming which files it touches.
- The contents of the 612-* review notes, beyond their presence in the diff.
- Whether the "Instruction 1" directive text faithfully records what Thomas said in chat. I have no access to the source session.

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a7892031e5d3927c9; candidate b617f0b80be93b264ac3008a6c64fa37fa463a98; sha256 04aeb479f3ef61a2800c0c10668f7d96485ad8a0dffb7281e4c2a25448064942) -->

# Independent ordinary review — #615 delta 889daa13..b617f0b8
- **Exact candidate reviewed:** b617f0b80be93b264ac3008a6c64fa37fa463a98
- **Comparison base:** 889daa135cfab536380382a74afadd12bd30ff25. The delta is four commits: f23ae3d6, a0ecd2dd, 570f012b and b617f0b8. They change 14 files. The merge base with `main` is 3096cb04.
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), in a fresh Agent-tool context (general-purpose, not forked). I did not author or remediate this change. This is not a GPT-6 Luna or GPT-6 Sol review.
- **Files / surfaces checked:**
  - The full `git diff 889daa13..b617f0b8` and every commit message in it.
  - `AGENTS.md`: read order, Authority, the roles table, and the merge section around lines 231–245.
  - `CLAUDE.md`.
  - `agent-workflow.md`: Model policy, the review-record rules, Batching, and Task states.
  - `error-fix-loop.md`, `definition-of-done.md`, `sdlc.md` and `active-mission.md`.
  - The new and the 2026-10-09 restructure entries in `decision-log.md`, plus the 2026-09-06 squash entry.
  - Audit §6, §8, §9 and §10.
  - All three 615 review notes.
  - `ci-cd.md` lines 240–275. I also compared `ci-cd.md` and the DoD on the #616 branch head 7e8ab217.
  - The `scripts/ci` inventory and `package.json` scripts.
  - The subagent transcripts and `.meta.json` files for agents a731c07f…, ab2ce0e0… and a49bbfaf….
- **Checks actually run:**
  - Compared each authority and consistency note across the two commits, from the BEGIN marker to the end of file, with `cmp`.
  - Recomputed SHA-256 for all five reports between their markers, as raw, stripped, and stripped plus a newline.
  - Parsed the transcripts for turn order, model, final assistant blocks, and the tool calls after the "rewrite" request.
  - Ran a scratch-repo test of the git listing on a mode-only change, using `--name-status --summary`, `--summary` alone, and `--raw`.
  - Ran a relative-link and anchor checker over the changed files (162 links) and separately over `decision-log.md` and `status.md`.
  - Checked whether the queue file exists at the merge base and at the candidate.
  - Grepped for leftover re-run, model, merge and squash wording.
  - Notes are kept in `$TMPDIR/615-ordinary-delta.md`.

## Status of round-3 findings
| # | Status | Evidence |
| --- | --- | --- |
| 1. Lane decision-log permission conflicts with SDLC/DoD | **CLOSED** | `AGENTS.md:94` now also allows entries "where the spec, SDLC or Definition of Done requires one", and requires a source received directly from Thomas, never a relay. `error-fix-loop.md:98` is not named, but it falls under the SDLC process. |
| 2. Relayed instructions: who records them | **CLOSED, with a residual** | a0ecd2dd added "recorded on `main` or by the session that received it directly". 570f012b then replaced that with the directive's wording at `AGENTS.md:52-60`: the receiving session records it with its source, a "verifiable decision can be handed between agents", a relay is not approval, and an entry "does not manufacture authority". The lane row still forbids a lane recording a relay. "Verifiable" is not defined. Audit §8 still describes the replaced a0ecd2dd wording (non-blocking 4). |
| 3. Transport header provenance | **CLOSED** | Agent IDs and the parent session were added, and the reports are now called "final message for that review round". Transcripts confirm the IDs, `agentType: general-purpose` and `claude-opus-5-5`. All five digests match the stripped bodies and the transcript blocks. There is a wording nit (non-blocking 6). |
| 4. Re-run counted by intent | **CLOSED** | The directive's wording "equivalent new SHAs do not reset the allowance" (`error-fix-loop.md:124-132`) covers unchanged-input runs whatever the intent. "made only to obtain another run" is the directive's own text. |
| 5. Mode change on the PR's own note missed by the listings | **OPEN** | The fix adds `--summary` to `git log -m --name-status` (`agent-workflow.md:240`). In a scratch repo (git 2.54), `--name-status --summary` prints only `M` for a `chmod +x`, in either flag order. The `mode change 100644 => 100755` line appears only with `--summary` alone, and `--raw` shows both modes. The prose "mode changes counted as touching a file" is therefore not delivered by the listed commands. Impact is negligible. |
| 6. Redaction exception in the decision log | **CLOSED** | The decision log now carries it in the restructure entry ("except a labelled redaction made as its own reviewed change"). It matches `agent-workflow.md`. |

## Findings
**Blocking:** None.

**Non-blocking:**

1. **Merge authority contradicts itself inside `AGENTS.md`.**
   - The new policy-maintainer row (`AGENTS.md:96`) allows "the eligible protected merge of its own policy candidate when Thomas delegates it".
   - The same file still says "protected merge by the conductor" (`:234`) and "**Only the conductor merges**" (`:239`).
   - This bears directly on how #615 itself will be merged.
   - Fix: add the scoped exception to `:239`.
2. **The DoD security checklist still requires GPT-6 Sol.**
   - The delta updated `definition-of-done.md:244` to "one accepted security-review model". The checklist items at `:51` and `:113` still read "GPT-6 Sol security review completed".
   - #616 (head 7e8ab217) does not touch these lines, so they would survive both PRs.
   - They contradict the new Model policy, which wins under the hierarchy but is left inconsistent.
3. **Present-tense claims about machinery that is not in this tree.**
   - `agent-workflow.md:176` says "`check:policy` keeps the block well formed". No `check:policy` script or `package.json` entry exists at the candidate; it is in #616.
   - The `review-models.mjs` reader has a fallback clause, but `check:policy` has none.
   - Suggest "will keep (#616)".
4. **Audit §8 is stale and overstated.**
   - It says the round-3 items "were fixed" and lists "recording on `main` or by the direct recipient" and "re-run counting by unchanged inputs". 570f012b rewrote both.
   - The `--summary` fix does not work (item 5 above).
   - §8 still ends with "required GPT-6 Luna ordinary reviews and the GPT-6 Sol pass are still outstanding". Under the new Model policy those roles may also be filled by Opus.
5. **The decision-log "Supersedes" clause points at the wrong entry.**
   - It names "the model table that limited Opus to sampling" in the 2026-10-09 restructure entry. That entry has no model table; it says "Unchanged: model assignments (2026-09-29)".
   - The decision actually being narrowed is the 2026-09-29 routing entry, which is not named.
   - The append-only rule requires naming what is superseded.
6. **The note headers slightly misdescribe how the last turn ended** (`615-workflow-policy-{authority,consistency}-opus.md:4`).
   - The headers say "ended in an API error and produced no output". The authority transcript shows the coordinator's rewrite request led to an attempted `Write` to `/tmp/claude-501/615-authority-review-1-…md`.
   - A safety classifier stopped that turn; the harness message says it was "not a tool or API error", and the write "did not run". A synthetic API-error turn followed.
   - "Produced no output" is true in substance. Suggested wording: "was stopped before completing; its attempted write did not run; no report was produced".
   - The embedded bodies are byte-identical (verified). The header changes are header-only (numstat 2/1 per file) and otherwise not overstated.
7. **The Model-policy rewrite dropped GPT routing details the directive did not ask to remove.**
   - Removed: "security- or architecture-heavy context preparation" from the Sol row (it now falls under the general Luna/Opus row), the GPT-6 Sol preference for broad governance or security conducting, and "explicitly selected" for Luna.
   - The directive says the GPT roles remain. These removals are a small, undisclosed loosening of GPT routing.
8. **The accepted-model block is not time-bounded.**
   - The machine-readable block lists `Claude Opus 5.5 (claude-opus-5-5)` with no mission scope. Only the prose ("under the current mission") limits it, while the decision covers "this assignment and the following frozen-scope delivery mission".
   - Suggest stating the removal trigger: when the mission ends, the block is edited through a reviewed change.
9. **Information only: the queue file does not exist on this tree.**
   - `AGENTS.md:30`, `sdlc.md:30` and `active-mission.md:9` name `docs/07-planning/integration-execution-queue.md` as a path, not a link. The file is absent at the merge base and at the candidate.
   - This is disclosed in audit §9, pending #601. Startup step 5 points at a nonexistent file until #601 lands.

**Directive fidelity (checked against the new decision-log entry):**
- **Re-run rule:** the text in `error-fix-loop.md:116,124-141` matches every element of the entry: one rerun per incident on equivalent inputs; retained evidence of a pre-execution transient fault; audit, typecheck and policy failures are not infrastructure; preserve both run IDs; note commits, renamed branches and equivalent SHAs do not reset the allowance; a rerun-only commit counts; correction CI is normal verification; no retry-until-green or G11 changes. It adds "lint" to the non-infrastructure list, which is stricter than the directive.
- **Model transition:** the transition text says one role per context per change, never labelled GPT, GPT roles still valid, historical identities kept, and existing Opus reviews count only where coverage is established. All of that matches, except items 7 and 8 above.
- **Squash:** the 2026-09-06 "Repository setup" entry does say "squash merge only".
- I found no invented authority beyond item 1.

**Links:** the changed policy and audit files have 162 relative links and none are broken. `decision-log.md:761` and `:5898` are broken, as are `status.md:3457`. All three are in historical text and were already broken before this delta (round 3 reported the decision-log ones at :710 and :5847, before the 50-line insertion).

## Verdict
CLEAR WITH NON-BLOCKING

## Not checked
- The text of the owner directive "Instruction 1". I checked fidelity only against its decision-log record. I could not verify that Thomas actually gave it, or its exact scope (including merge delegation).
- Live GitHub: PR #615's body, CI on b617f0b8, the `protect-main` ruleset's allowed methods, and branch protection. `git fetch` failed, so `origin/main` (3096cb04) may be stale.
- Audit §9's claim that #601 preserves the removed queue and status content.
- Audit §10's executed-check claims, such as `check:policy` passing on this tree and `test:ci-scripts` 1,140/1,142. I did not run #616's code.
- Whether the transcripts were extracted "mechanically". I verified the bytes, not the method.
- Policy text outside the delta, beyond the sections listed above.

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent abe5040402caed3a3; candidate b617f0b80be93b264ac3008a6c64fa37fa463a98; sha256 54d96011b6a6cb29f045980627f6f19afdb6336c63ab356b2b1b2fbf94f892a4) -->

# Independent security/authority review — #615 complete candidate
- **Exact candidate reviewed:** b617f0b80be93b264ac3008a6c64fa37fa463a98
- **Comparison base:** 3096cb044bdf6ae98488bfc385f532fa6386343a. This is also the merge base. I reviewed all 24 commits, including those inherited from #612.
- **Reviewer / model / context:** Claude Opus 5.5 (claude-opus-5-5). Fresh Agent-tool context (general-purpose, not forked). Role: security reviewer. I did not author, direct or remediate this change. Disclosure: I was dispatched by parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`, which is the session that authored this candidate. That is the same self-dispatch pattern Blocking 1 is about.
- **Files / surfaces examined:**
  - **Read in full at the candidate:** `AGENTS.md`, `CLAUDE.md`, `agent-workflow.md` and `active-mission.md`.
  - **Diffs read in full:** `error-fix-loop.md`, `definition-of-done.md`, `sdlc.md`, `docs/README.md` and `decision-log.md` (four new entries).
  - **Review records:** the three 615 Opus notes, three of the 612 Sol notes, and §§7–10 of the audit file.
  - **On main:** the full `AGENTS.md`, the `ci-cd.md` security-path list and branch rules, `check-pr-template.mjs`, `lib/gate-waiver.mjs`, the `REVIEW_ITEM` pattern in `lib/pr-body.mjs`, and `.github/pull_request_template.md`.
  - **#616:** the local branch `claude/policy-enforcement-20261009` at `7e8ab217`, which may not be the exact published head. I read `lib/review-models.mjs` and the diffs to `check-pr-template.mjs`, `ci-cd.md`, `CODEOWNERS` and the template.
- **Checks actually run:**
  - `git diff`, `--stat` and `--name-status` from base to candidate, and for `a0ecd2dd..b617f0b8`.
  - `git log -m --name-status` over the review-note history.
  - `git diff --check`: only Markdown hard-break trailing spaces in the 612 notes (cosmetic).
  - Recomputed the SHA-256 of the round-3 report between its markers. The stripped text matches the recorded `d06a2b88…`.
  - `git grep` for leftover GPT-only attestations, re-run wording and reviewer-spawn rules.
  - Live `gh` failed (TLS certificate error), so I verified no live PR or check state.
  - Findings were written as I went to `$TMPDIR/615-security-full.md`.

## Findings
**Blocking:**

1. **An agent can approve itself by choosing which reviews to keep.**
   - **Where:**
     - `CLAUDE.md:51-53`: "Subagents started with the Agent tool without forking get a fresh context and can serve as independent reviewers of work the parent authored."
     - `agent-workflow.md:246-251`: "the conductor traces it to a review it dispatched or can otherwise verify."
     - `AGENTS.md:96`: the policy maintainer may "perform the eligible protected merge of its own policy candidate".
   - **What is missing:** nothing anywhere says that every review dispatched for a candidate must be recorded. Nothing forbids re-dispatching the same SHA and scope after an unwelcome verdict. Nothing forbids asking a reviewer to revise its report; the 615 notes record that such a request was actually made, and it failed with an API error.
   - **Exploit:** the author spawns reviewers, drops any BLOCKED report and spawns again, then publishes only the CLEAR ones. The dropped blocker never appears on record, so merge-ready's "no blocking finding is unresolved" (`definition-of-done.md:16`) holds on paper.
   - **Why it is worse for the policy maintainer:** the author dispatches, publishes, traces and then merges its own policy candidate. The conductor only "agrees the merge window", so no second party checks the review set. Hashes prove the bytes, not that nothing was left out (the candidate says so at `:249`).
   - **Fix:** add to § Reviews:
     - Every review dispatched for a candidate is recorded in its notes with its verdict, including BLOCKED and abandoned runs.
     - A reviewer is re-dispatched for the same SHA and scope only for a recorded reason that is not about its verdict (a crash, the wrong SHA).
     - The author never asks a reviewer to revise its findings or verdict.
     - A blocking finding from any dispatched review stays open until an independent reviewer dispositions it.
     - When the merger also dispatched the reviews (the policy maintainer's self-merge), the conductor confirms the complete review set before merging.

2. **The Definition of Done forces a false "GPT-6 Sol" attestation whenever Opus does the security review.**
   - **Where:** `definition-of-done.md:51-52` and `:113-114` still say "GPT-6 Sol security review completed and recorded in the pull request's `## Security review` section".
   - **Why it bites:** authors must paste these checklists into `## Checklists` (template, line 116 onward). `ci-cd.md:330` and the `REVIEW_ITEM` pattern (`pr-body.mjs:904`) mean this line **cannot be marked `n/a`**.
   - **Effect:** under the new model policy (`agent-workflow.md:153`, active-mission line 49), every backend or feature PR reviewed by Opus must tick a box saying a GPT-6 Sol review happened. That contradicts "never labelled GPT-6 Sol" (decision log, Opus entry) and do-not 7 (fabricated review evidence). The local #616 branch does not fix it either.
   - **Fix:** reword both lines model-neutrally, for example "Security review by an accepted security-review model ([model policy]) completed and recorded in …". `REVIEW_ITEM` matches `security\s+review`, so the machine requirement still holds. Align the quoted line in `ci-cd.md:330` in #616.

**Non-blocking:**

1. **Merge authority contradicts itself.**
   - `AGENTS.md:239` says "**Only the conductor merges**". The Definition of Done gives merge-ready to "the conductor" (`:16`), and `active-mission.md:46-47` says the maintainer "owns only its policy candidate and its handoff".
   - All three contradict the policy-maintainer merge right at `AGENTS.md:96`.
   - The Opus decision-log entry's Supersedes line (`decision-log.md:41-43`) also leaves out "protected merge by the conductor alone" from the restructure entry (`:93`).
   - The error is on the safe side, but merge authority should be stated the same way everywhere.

2. **The model allowlist outlives Thomas's scope.**
   - Thomas authorized Opus "for this assignment and the following frozen-scope delivery mission". The prose says "under the current mission", but the machine-readable block (`agent-workflow.md:178-181`) has no expiry.
   - Nothing makes the change that ends this mission remove the Opus line.
   - **Fix:** add to `active-mission.md` that replacing the mission also re-decides the security-review model block in the same change. Optionally have `check:policy` cross-check the two.

3. **Report publication was weakened from "verbatim" to "never edits a verdict or finding"** (`agent-workflow.md:246-248`).
   - That still allows a publisher to edit scope, checks run, "not checked" items and residual risk.
   - `CLAUDE.md:42-43,54` still require verbatim publication, but `CLAUDE.md` sits lower in the hierarchy.
   - **Fix:** require unedited publication except a labelled, separately reviewed redaction.

4. **Re-run loopholes** (`error-fix-loop.md:125-133`).
   - "Incident" is undefined, so each infrastructure failure could be declared a new incident.
   - "A commit made only to obtain another run counts as the re-run" sits only inside the infrastructure bullet. For assertion and gate failures the rule is "never re-run an *unchanged* candidate", so a no-op commit gets around it.
   - **Fix:** extend the commit-to-rerun clause to every failure class. Define an incident as the same job failing on equivalent inputs.

5. **One evidence-reuse row is ambiguous.** The row "CI/security-control verdict" with inputs "`.github/**`, `scripts/ci/**` and the other control paths" (`agent-workflow.md:218`) could be read as letting a security review survive product-code changes. The Definition of Done's exact-SHA rule still prevents that. Rename the row to "CI-script test results".

6. **The self-approval claim is broader than what the reader does.** "a candidate cannot add a model and approve itself" (`agent-workflow.md:172-174`) holds only for edits to the block. A PR that changes `scripts/ci/**` runs its own checker under `pull_request`. Qualify the sentence, as #616's `ci-cd.md` already does for the classifier.

7. **The text names a check that is not on main yet.** It says "`check:policy` keeps the block well formed" (`:176`), but `check:policy` exists only in #616. Hedge it the way the reader sentence is hedged.

8. **The audit file now misleads.**
   - §7 (`workflow-policy-audit-2026-10-09.md:155-157`) says "Not changed: model assignments, … merge authority". §9 changes both.
   - Line 152 still calls the re-run allowance "inactive".
   - Mark §7 as superseded by §9.

9. **The policy does not say who may edit `active-mission.md`.** Lanes are excluded, but the conductor's and the maintainer's rights are not named. Name the editor; it is already gated by a traceable decision from Thomas.

10. **The candidate does not yet look merge-ready.** The committed ordinary reviews cover `c0d5ef6a`, `ed7bb516` and `889daa13` only. Each says it is "not a … review of record". `a0ecd2dd..b617f0b8` changes merge authority, the model policy and the re-run rule, and has no committed ordinary review. The audit also records red G11 and dependency-audit checks on this candidate.

## Residual risk
- **Authority from chat cannot be checked.** Under `AGENTS.md:52-58`, a decision received in chat takes effect for the session that received it and is "verifiable" only through that session's own decision-log entry. Agents share Thomas's GitHub identity (`ci-cd.md` § Branching), so nothing in the repository can prove an entry is authentic. The backstops are: a waiver still needs Thomas's own merge action, the CI path gate, and the reviewers.
- **The trust model depends on branch protection I could not see.** The merge-base read is sound only while the ruleset forces branches to be up to date with `main`. I could not verify the live ruleset.
- **#616 was not reviewed at its exact published head.**
- **Note authenticity cannot be checked by a machine.** It rests on tracing each note to its reviewer.

## Verdict
BLOCKED

<!-- END REPORT 3 -->
