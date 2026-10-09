# 615 — record-accuracy batch: independent delta reviews of daeea578 (Claude Sonnet 5.5 ×2, Claude Opus 5.5)

**Reviewed head:** `daeea578bf9f34bb49beb33b245cc2e33e85a358`

- **Reviewer contexts:** the same three fresh Agent-tool contexts that reviewed `e6dd0ca3`, `dff9a617` and `9a3109c6`, each re-dispatched for this delta with the exact new candidate; none authored, directed or remediated the change. Each report's model is the one its transcript records for every turn of this round.
- **Transport:** each report is the reviewer's final message for this delta, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a9fe5e0df4cb824df; model claude-sonnet-5-5; role ordinary review A, delta; candidate daeea578bf9f34bb49beb33b245cc2e33e85a358; sha256 dcdde21f333a537a04d65898c04e3faae05fc3a54e0d09b998e7d57943bbd41d) -->

# Independent ordinary review A — #615 delta 9a3109c6..daeea578
- **Exact candidate reviewed:** daeea578bf9f34bb49beb33b245cc2e33e85a358
- **Comparison base:** 9a3109c625544da7bcea6182202b68efc78dc741
- **Reviewer / model / context:** Claude Sonnet 5.5 (claude-sonnet-5-5), fresh Agent-tool context, did not author or remediate
- **Files / surfaces checked:**
  - Two commits, d458a44a and daeea578, five files changed.
  - `docs/07-planning/security-reviews/615-workflow-policy-model-tiers-delta.md`.
  - `docs/07-planning/decision-log.md`: new top entry, including the "Applied to the other roles", Supersedes, Transition and Source paragraphs.
  - `docs/04-engineering/agent-workflow.md`: Model policy table, Source, labelling and block paragraphs, and the `policy:security-review-models` block.
  - `docs/07-planning/active-mission.md`.
  - Audit §11 (ledger) and §13.
  - The earlier delta note `615-workflow-policy-routing-amendment-delta.md`, for the A-round ledger rows.
- **Checks actually run:**
  - `git diff` and `git log` for the delta.
  - `git diff --stat 9a3109c6 d458a44a`: one file added, so that commit is record-only.
  - Extracted each REPORT block from the model-tiers note and recomputed its SHA-256. Reports 1, 2 and 3 match their markers (`84c68655…`, `da907fb1…`, `bd80663d…`). Verdicts are CLEAR WITH NON-BLOCKING for all three.
  - Compared the REPORT 1 text line by line with my previous reply. It is identical, labelled `claude-sonnet-5-5`, which is the model I ran on.
  - Re-extracted the block lines from the candidate: `GPT-6 Sol`, `GPT-6.1 Sol` and `Claude Opus 5.5 (claude-opus-5-5)`. The block is unchanged from 9a3109c6.
  - Matched the §11 ledger rows A (`dff9a617`) and T (`9a3109c6`) to the two delta notes by agent id, candidate and verdict.
  - Searched the tree for a note backing the §11 round-6 #616 row.
  - Ran no tests or CI.

## Disposition of my earlier items (9a3109c6 round)
1. **Supersession omitted the 2026-09-29 Sol requirement: PARTIAL.**
   - Closed in the decision-log entry. Its Supersedes paragraph now names the 2026-09-29 fixed Sol and Luna requirement.
   - Still open in the `agent-workflow.md` Source paragraph. It says only that the entry "supersedes the earlier 2026-10-09 assignments".
2. **Table changed two roles that the entry did not mention: CLOSED.**
   - Sampled auditor is back to "a fresh Claude Opus context, only from a packet another context prepared".
   - Read-only extraction is narrowed to "any assigned model in either tier, never a retired route".
   - The entry lists both under "Applied to the other roles", explicitly labelled the policy maintainer's reading that Thomas may reverse.
3. **Block versus tier text on Opus versions: CLOSED.** The entry and `agent-workflow.md` now say the block, not the table, decides what the check accepts, and a new model or version needs a reviewed edit of the block.
4. **ci-cd.md and the PR template still describe a required GPT-6 Sol review: PARTIAL.**
   - `agent-workflow.md` and the entry's Transition paragraph now say a review under any other label waits, and name `GPT-6.1 Sol`.
   - `ci-cd.md` is not touched and is not marked as lagging.
   - Audit §13 still says "reviewed only by Opus waits", which is narrower than the entry's "any other label".
5. **Table roles wider than the entry: OPEN, unchanged.**
6. **§11 ledger missing the `dff9a617` round: CLOSED for #615.**
   - The §11 intro no longer claims every reviewer ran `claude-opus-5-5`.
   - Rows A (`dff9a617`) and T (`9a3109c6`) match the two delta notes on agent id, candidate and verdict, and the note's header says models are as each transcript recorded them.
   - The round-6 #616 row, now CLEAR WITH NON-BLOCKING, has no backing note in this tree, so I could not check it.
7. **#602 correction rests on the conductor's report: PARTIAL.**
   - The "I" in §13 is now "The policy maintainer".
   - The source time changed from "~17:10 UTC" to "relayed to the recording session at 16:56 UTC", with no explanation of the change. I could not verify either time.
   - The "five problems" and "ruleset not changed" claims are unchanged and not independently checked.

## Findings

**Blocking:** None

**Non-blocking:**
1. **`agent-workflow.md` Source paragraph** is out of line with the entry on what it supersedes (disposition 1).
2. **Rules are stated as policy in the active mission and workflow, but the "maintainer's reading, Thomas may reverse" label lives only in the decision-log entry.**
   - This concerns the upward fallback ("a Sol-tier model may fill a Luna-tier role … never the reverse"), the conductor wording and the extraction wording.
   - Policy documents normally state the rule plainly, so this is acceptable. A pointer such as "see the decision log for status" in `agent-workflow.md` or the active mission would help.
   - The "never the reverse" part is stricter than Thomas's recorded "anything is ok". It is a restriction, not a weakening, and is correctly flagged in the entry.
3. **"When no Luna-tier model is available" is undefined.** No evidence of unavailability is required. This is low-risk, since the fallback goes upward to stronger models and independence is unchanged.
4. **Audit §13 and the entry differ on the Transition wording.** §13 says "reviewed only by Opus"; the entry says "any other label (Claude Opus or `GPT-6.1 Sol`)". Align them.
5. **Table roles are wider than the entry** (disposition 5). Unchanged.
6. **The ledger's round-6 #616 row** cannot be traced to a note in this tree. The `security-reviews` folder has no #616 notes, so the row stands on the authoring session's word.
7. **Cosmetic:** the new decision-log and workflow paragraphs are wrapped unevenly (very long lines in the Transition and Source paragraphs).

**Answers to the check questions**
- **Record-only commit:** d458a44a adds only the model-tiers note.
- **My report:** REPORT 1 in that note is byte-identical to what I returned, and its marker hash matches the extracted text. The note's header describes the extraction and hashing as mechanical.
- **Words versus Thomas's support:** each new item is either backed by his recorded words or labelled as the policy maintainer's reading that Thomas can reverse. The only gaps are items 1, 2 and 4 above.
- **Weakening:** counts, independence, label rules, the tier rule and the block are not weakened. The block is unchanged, the label rule is intact and extended, and the new fallback only goes upward.
- **Ledger rows versus notes:** rows A and T match their notes for #615.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a9d11e58300c3ea4b; model claude-sonnet-5-5; role ordinary review B (scenarios), delta; candidate daeea578bf9f34bb49beb33b245cc2e33e85a358; sha256 36e245e993986747e56b1ae588bd5b4a550070aab512bb4e37cd26a900297a4c) -->

# Independent ordinary review B — #615 delta 9a3109c6..daeea578
- **Exact candidate reviewed:** daeea578bf9f34bb49beb33b245cc2e33e85a358
- **Comparison base:** 9a3109c625544da7bcea6182202b68efc78dc741
- **Reviewer / model / context:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh Agent-tool context, did not author or remediate. This is the fourth review round by this context on the same PR.
- **Files / surfaces checked:**
  - The two commits: `d458a44a` (record-only) and `daeea578` (record-accuracy batch).
  - The docs they change: `docs/04-engineering/agent-workflow.md`, `docs/07-planning/decision-log.md`, `docs/07-planning/active-mission.md`, `docs/07-planning/workflow-policy-audit-2026-10-09.md` §11 and §13, and the new `docs/07-planning/security-reviews/615-workflow-policy-model-tiers-delta.md`.
  - `agent-workflow.md` § Sampled big review, and `check-pr-template.mjs` plus `scripts/ci/lib/` on `origin/main`.
- **Checks actually run:**
  - Confirmed `9a3109c6` is an ancestor of `daeea578`, and listed both commits and the full diff.
  - Extracted all three REPORT blocks from the new note and recomputed each SHA-256 over the stripped body. All three match their marker headers (REPORT 2 is `da907fb1…6c7`).
  - Compared REPORT 2 line by line with the report I returned for `9a3109c6`: identical. It is labelled `claude-sonnet-5-5`.
  - Confirmed `d458a44a` only adds the note and that `daeea578` leaves it untouched.
  - Confirmed `origin/main`'s `check-pr-template.mjs:376` still reads `model !== "GPT-6 Sol"` and that `review-models.mjs` is absent from `origin/main`.
  - Ran no tests, since the delta is docs only.

## Disposition of my earlier non-blocking items
- **Cross-tier fallback: CLOSED.** The table paragraph, decision-log "Fallback upward only" and `active-mission.md` now say: a Sol-tier model may fill a Luna-tier role when no Luna-tier model is available, and a Luna-tier model never fills a Sol-tier role.
- **GPT-6.1 label under the old checker: CLOSED** in `agent-workflow.md` (`check still accepts only the literal GPT-6 Sol, and a review under any other label waits`) and in the decision-log Transition (`Claude Opus or GPT-6.1 Sol`). Audit §13 still says "reviewed only by Opus"; see non-blocking item 1.
- **Table versus block on versions: CLOSED.** "The block, not the table above, decides what the check accepts: a new model or version needs a reviewed edit of the block" appears in the workflow and in the decision log.
- **"From now on … for merges" unconditional: CLOSED.** It now reads "the merge check accepts it once the model-aware checker (#616) is on `main`".
- **First-person audit §13: CLOSED.** It now says "The policy maintainer first reported".
- **Ledger: CLOSED for rows A and T.** The "pending" row 6 is now CLEAR WITH NON-BLOCKING, and the models are stated. The delta review of `daeea578` itself still needs rows, as expected.
- **Final-audit independence sentence: OPEN**, unchanged. "Fresh" implies it. Non-blocking.
- **Stale GPT-6 Sol text in ci-cd.md, the template and CODEOWNERS:** still deferred to #616.

## Scenario results
- **(a) PASS.** With GPT-6 Sol unavailable, a fresh Claude Opus context does the security review (Sol-tier row, § Model policy). It is labelled `Claude Opus 5.5 (claude-opus-5-5)`, as the platform reports it, which exact-matches the block. The decision log says the merge check accepts it only once #616 is on `main`.
- **(b) PASS.** The Luna tier is GPT-6 Luna, Claude Sonnet or Claude Haiku. A Haiku context may be the ordinary reviewer, and it must be labelled with the platform-reported Haiku model. It must never be recorded as Opus (labelling paragraph), nor as any model that did not produce it.
- **(c) PASS.** "One context never fills two roles on the same change" is retained. The new fallback sentence lets a Sol-tier model fill a Luna-tier role but does not collapse the roles; they still need separate contexts. The "labels are not interchangeable" clause stands.
- **(d) PASS.** The block has exact lines for `GPT-6 Sol`, `GPT-6.1 Sol` and `Claude Opus 5.5 (claude-opus-5-5)`, unchanged in this delta. The reader is not yet on `main`; see (i).
- **(e) PASS.**
  - Until #616 lands, a security-scope PR with any non-`GPT-6 Sol` label waits for #615 and #616. The review is never relabelled and the check is not lifted. Governing text: `agent-workflow.md` § Model policy (the paragraph before the block) and the decision-log Transition.
  - Audit §13 still says only "reviewed only by Opus" (non-blocking item 1).
  - #615 itself is not a security-scope PR on the path list, so this wait does not apply to it.
- **(f) PASS.** Earlier reviews stay valid for what they covered: "Reviews completed under an earlier assignment stay valid", decision log "historical Sol and Luna reviews keep their identity", and `active-mission.md`. The new "Supersedes" addition names the 2026-09-29 fixed Sol/Luna requirement and leaves "their other content stands". "Never approves later changes" is untouched.
- **(g) Clear.**
  - The decision-log "Applied to the other roles" block labels the extra mappings as "the policy maintainer's reading… Thomas may reverse any of it". That is honest and avoids implying Thomas said more than he did.
  - Dispatch is now unambiguous:
    - Security and critical review go to a Sol-tier model.
    - Ordinary review and implementation go to a Luna-tier model, falling upward only.
    - The sampled auditor is a fresh Opus context.
    - Read-only extraction goes to any assigned model, with its output treated as data.
- **(h) PASS.**
  - When the whole Luna tier is out of quota, Opus may do ordinary review. The authority is the fallback sentence in § Model policy, the decision-log "Fallback upward only" and `active-mission.md`, and it keeps independence. The Opus ordinary reviewer cannot also be the security reviewer on that change, since that is two roles in one context.
  - Haiku can never do security review. A Luna-tier model never fills a Sol-tier role, and Haiku is not in the accepted block.
- **(i) FAIL for acceptance, which is the correct and intended answer.** `main`'s checker accepts only the literal `GPT-6 Sol` today (`check-pr-template.mjs:376`; no `review-models.mjs` on `origin/main`). A `GPT-6.1 Sol` review therefore waits for #616. The policy block accepts the label only once #616 reads it from the merge base.
- **(j) PASS.** The sampled auditor is a fresh Claude Opus context, working only from a packet another context prepared, and it never replaces a required review (§ Model policy row, § Sampled big review, decision-log "unchanged"). The earlier "A Sol-tier model" wording is tightened back to Opus, matching 2026-09-29. A GPT Sol model is not an accepted sampled auditor. The PR template's "Packet author: GPT-6 Luna or GPT-6 Sol" wording is stale, and #616 carries that cleanup.

## Findings
**Blocking:** None

**Non-blocking:**
1. **Audit §13 was only partly updated.**
   - It still says "a security-scope PR reviewed only by Opus waits for #615 and #616", while the decision log and `agent-workflow.md` now say "any other label (Claude Opus or `GPT-6.1 Sol`)". One phrase to align would close it.
2. **"Final audit" independence is still not stated in the Review roles table.** It is implied by "fresh Claude Opus context". The same point was open in earlier rounds.
3. **The delta review of `daeea578` and its ledger rows are pending.** That is expected until the reviews land.
4. **Stale GPT-6 Sol wording** remains in `ci-cd.md`, the PR template (including "Packet author: GPT-6 Luna or GPT-6 Sol") and `CODEOWNERS`, for #616.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a2d042e8432eb6e84; model claude-opus-5-5; role security/authority review, delta; candidate daeea578bf9f34bb49beb33b245cc2e33e85a358; sha256 a896e28f729fc5a3b75d79194c2dc4893f6c9c16eb602caaf7076b156878c195) -->

# Independent security/authority review: #615 delta 9a3109c6..daeea578
- **Exact candidate reviewed:** daeea578bf9f34bb49beb33b245cc2e33e85a358
- **Comparison base:** 9a3109c625544da7bcea6182202b68efc78dc741
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), the same fresh Agent-tool context (agent `a2d042e8432eb6e84`, not forked) that reviewed e6dd0ca3, dff9a617 and 9a3109c6; role: security reviewer; did not author, direct or remediate this change.
- **Files / surfaces examined:**
  - Policy files changed by daeea578: `docs/04-engineering/agent-workflow.md` (model table, Source paragraph, block-authority paragraph), `docs/07-planning/active-mission.md`, `docs/07-planning/decision-log.md` (top entry: "Applied to the other roles", Supersedes, Transition, Source), and `docs/07-planning/workflow-policy-audit-2026-10-09.md` §11 and §13.
  - Review notes: `docs/07-planning/security-reviews/615-workflow-policy-model-tiers-delta.md` and `615-workflow-policy-routing-amendment-delta.md`.
  - #616's notes for rounds 4–6 and its `scripts/ci/lib/review-models.mjs` / `check-pr-template.mjs` at `92660ed7`.
  - The decision-log entries the new text relies on: 2026-09-29 "OpenAI model routing replaces Claude/`pal-mcp` routing", 2026-09-29 "Opus 5.5 retained as sampled big reviewer", and 2026-10-09 "Opus policy-repair conductor".
  - The parent session transcript and the three reviewer transcripts.
- **Checks actually run:**
  - **Record-only commit:** `git log` with parents and `git diff --name-status 9a3109c6 d458a44a`. d458a44a's only change is adding `security-reviews/615-workflow-policy-model-tiers-delta.md`, so it is record-only. daeea578 changes no review note.
  - **Security-review block:** sha256 of the extracted block is `317f48e5…` at both base and candidate, so it is byte-unchanged in this delta.
  - **Model-tiers note:** for each of the three reports I extracted the body between its markers and searched its own transcript for a byte-equal final message.
    - REPORT 1 (`a9fe5e0d`): every turn is `claude-sonnet-5-5`; match sha256 `84c68655…` = marker.
    - REPORT 2 (`a9d11e58`): every turn is `claude-sonnet-5-5`; match `da907fb1…` = marker.
    - REPORT 3, mine (`a2d042e8`): every turn is `claude-opus-5-5`; match `bd80663d727cd3b5…7e50` = marker. My report is byte-identical to what I returned.
    - The note declares `**Reviewed head:** 9a3109c6…`.
  - **Ledger:** every new or changed §11 row checked against the notes.
    - The A rows at `dff9a617` match the three CLEAR WITH NON-BLOCKING verdicts in `…routing-amendment-delta.md`.
    - The T rows at `9a3109c6` match the three in `…model-tiers-delta.md`.
    - Row 6 `a32abc36` at #616 `c3685d9d` matches REPORT 1 in `616-policy-enforcement-round6-opus.md` (CLEAR WITH NON-BLOCKING; transcript checked in the earlier round).
  - **Relay time:** the parent transcript shows the conductor's relay at `2026-10-09T16:56:21.786Z`. The new "relayed to the recording session at 16:56 UTC" is accurate.
  - **Checker behaviour:** I read #616's `parseSecurityReviewModels`.
    - It needs exactly one open and one close marker.
    - Each line must be ``- `label` ``, printable ASCII, unpadded, with no duplicates.
    - An empty block throws; a missing block falls back to the legacy list `["GPT-6 Sol"]`.
    - `check-pr-template.mjs` reads the block through `readAcceptedSecurityReviewModels` at the merge base.
    - `GPT-6.1 Sol` parses under these rules.
  - **Earlier authorization:** "Instruction 1" (the Opus policy-repair conductor entry) explicitly let Opus do implementation, orchestration, ordinary review, security review and finalization.

## Findings
**Blocking:** None

**Non-blocking:**
1. **The upward fallback is the maintainer's reading, but two files state it as plain policy.**
   - The decision log is honest: the "Applied to the other roles" paragraph is labelled as the policy maintainer's reading of "anything is ok", and Thomas may reverse it. That is technical rationale, not claimed owner authority.
   - The same fallback appears in `agent-workflow.md` and `active-mission.md` with no such qualifier. `active-mission.md` itself says only a new explicit decision by Thomas changes it.
   - The risk is low:
     - the fallback is upward only;
     - a Luna-tier model still never fills a Sol-tier role;
     - Instruction 1 had already explicitly authorized Opus for those roles;
     - one-context-one-role and author-is-not-reviewer still apply.
   - Fix: get Thomas's confirmation in the session, or cite the reading in `active-mission.md` as the maintainer's, pending his reversal.
2. **The Supersedes list misses one entry.**
   - It now names the 2026-09-29 "OpenAI model routing" entry, which is accurate.
   - It does not name the 2026-09-29 "Opus 5.5 retained as sampled big reviewer" entry, which says Opus is "not the per-PR security gate, not the phase finalizer". Instruction 1 superseded that only within its own scope.
   - The new entry is written as "from now on", not limited to the mission, so that entry should be named too. Thomas's words ("Sol = opus", "don't need for GPT 6 sol review now on") support it.
3. **The other new sentences grant nothing Thomas did not give:**
   - **Conductor:** still the session Thomas designates, and the current conductor is unchanged.
   - **Read-only extraction:** now "any assigned model in either tier, never a retired route", which narrows the earlier "any model".
   - **Sampled auditor:** a fresh Claude Opus context. This narrows the 9a3109c6 wording, which allowed any Sol-tier model. "Unchanged" is accurate only against the pre-9a3109c6 text.
4. **The block-authority claim is correct and fails closed.** The checker accepts only exact labels from the merge-base block and throws on a malformed block. A model or version that the table allows but the block does not list is rejected. In that case the review waits for a reviewed block edit; it is never treated as accepted.
5. **The transition is still literal.** Until #616 is on `main`, a review under any label other than `GPT-6 Sol` (Opus or `GPT-6.1 Sol`) waits. Reviews are never relabelled and the required check is never lifted.
6. **My earlier items are resolved:**
   - The relay time is corrected.
   - The conductor row is now explicit.
   - Extraction is limited to assigned models.
   - The table-versus-block versions are covered by item 4 above.
   - In §11, the opening model claim is removed, row 6 is updated, and the dff9a617 rows are added. The trailer states the models row by row, and they match the transcripts.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
