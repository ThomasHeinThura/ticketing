# 615 — model tiers: independent delta reviews of 9a3109c6 (Claude Sonnet 5.5 ×2, Claude Opus 5.5)

**Reviewed head:** `9a3109c625544da7bcea6182202b68efc78dc741`

- **Reviewer contexts:** the same three fresh Agent-tool contexts that reviewed `e6dd0ca3` and `dff9a617`, each re-dispatched for this delta with the exact new candidate; none authored, directed or remediated the change. Each report's model is the one its transcript records for every turn of this round.
- **Transport:** each report is the reviewer's final message for this delta, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a9fe5e0df4cb824df; model claude-sonnet-5-5; role ordinary review A, delta; candidate 9a3109c625544da7bcea6182202b68efc78dc741; sha256 84c68655f0ba0d864d57db9ad8f75677e5ae4fe76d1531f19ab94c43740ade04) -->

# Independent ordinary review A — #615 delta dff9a617..9a3109c6
- **Exact candidate reviewed:** 9a3109c625544da7bcea6182202b68efc78dc741
- **Comparison base:** dff9a617ffc8d1ba45782342904ff6ab58f88b7c
- **Reviewer / model / context:** Claude Sonnet 5.5 (claude-sonnet-5-5), fresh Agent-tool context, did not author or remediate
- **Files / surfaces checked:**
  - The two-commit delta (e824f6d6 and 9a3109c6), five files changed.
  - `docs/04-engineering/agent-workflow.md`: Model policy table, Source and labelling paragraphs, and the `policy:security-review-models` block.
  - `docs/07-planning/decision-log.md`: the new top entry, plus the 2026-10-09 "Mixed-model routing" and "Opus policy-repair conductor" entries it supersedes.
  - `docs/07-planning/active-mission.md` and audit §11, §12 and §13.
  - The new note `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment-delta.md`.
  - Tree-wide references to "GPT-6 Sol": `ci-cd.md`, the PR template, CODEOWNERS and `scripts/ci/check-pr-template.mjs`.
- **Checks actually run:**
  - `git diff` and `git log` for the delta.
  - Greps for the Sol/Luna tiers and "GPT-6 Sol" across the tree.
  - Read `check-pr-template.mjs` lines 372 to 378 at the candidate. It does still reject any `**Model:**` other than the literal `GPT-6 Sol`, so the entry's Transition paragraph is accurate for `main`.
  - Extracted each REPORT block from the delta note and recomputed its SHA-256. Reports 1, 2 and 3 each match their marker hash. REPORT 1 (hash `e00d2266…`) is the same text I returned, compared line by line. It is labelled `claude-sonnet-5-5`, which is what I ran on.
  - Confirmed `602-p0-scope-clean.md` appears in git history on another ref.
  - Tried `gh pr view 602`; it failed on TLS. I could not verify #602's live state.
  - Ran no tests or CI.

## Findings

**Blocking:** None

**Non-blocking:**

1. **Supersession line omits the 2026-09-29 GPT-6 Sol requirement.**
   - The new entry lifts the fixed GPT-6 Sol requirement. That requirement lives in the 2026-09-29 "OpenAI model routing replaces Claude/pal-mcp routing" entry, which required a fresh GPT-6 Sol review and said not to downgrade. The 2026-09-29 sampled-auditor entry also limited Opus to sampling.
   - The "Supersedes" paragraph names only the two 2026-10-09 entries. Check 3 asks that supersession be stated accurately, so add the 2026-09-29 Sol requirement and sampled-auditor wording to it.
   - The Source line in `agent-workflow.md` has the same gap. It cites 2026-09-29 as a live source and says the new entry supersedes only "the earlier 2026-10-09 assignments".
   - The Haiku part is stated accurately. Its read-only limit is superseded, and Haiku is now Luna tier.
2. **The table changes two roles that the entry does not mention.**
   - Sampled auditor changed from "Claude Opus 5.5" to "A Sol-tier model". This now permits GPT Sol, and it drops the "outside-the-GPT-system" intent of the 2026-09-29 entry.
   - Read-only extraction changed from Haiku to "Any model".
   - The mission text does not mention either role. Both could be intended, but they are not recorded as owner decisions. Either note them in the entry or revert the table to the entry's wording.
3. **Block versus tier text on Opus versions.**
   - The tier text and the entry say "a fresh Claude Opus context".
   - The block accepts only the exact label `Claude Opus 5.5 (claude-opus-5-5)`. A different Opus version would satisfy the table but fail the block.
   - This fails closed. One sentence saying the block is authoritative, or adding versions when they appear, would remove the ambiguity.
4. **"From now on … satisfies the Sol tier for merges" sits beside the unchanged checker.**
   - `check-pr-template.mjs:376` and the PR template still say "must be exactly GPT-6 Sol".
   - `ci-cd.md` (lines 155, 161, 240, 242, 247, 330, 676) and CODEOWNERS still describe a required GPT-6 Sol review.
   - The entry's Transition paragraph and the workflow text ("check still accepts only GPT-6 Sol") disclose the checker gap, so this is not a contradiction. But `ci-cd.md` is not marked as lagging. A line saying it is updated when #616 lands would help.
5. **Table roles are still wider than the entry** (carried over from my earlier items 1 and 3). The Luna tier and Sol tier rows carry context preparation, architecture review and similar work that the entry does not list. Not changed by this delta.
6. **Audit §11 ledger does not list the `dff9a617` delta review round.** That round is in the new `...-routing-amendment-delta.md` note. §11 still says "nothing dropped". Add rows for it, and for the round on this candidate once it exists.
7. **The #602 correction rests on the conductor's report.**
   - The correction text is honest and consistent between the entry and audit §13. It says the lift rested on the maintainer's mistaken premise, was withdrawn, and the ruleset was not changed.
   - Two points in it come from the conductor's report and could not be checked here: that five problems were found, none of them the model label, and that all close once #602's runtime proof lands.
   - I could not verify the quoted "~17:10 UTC" time, or the "ruleset was not changed" claim.
   - The audit uses "I" in §13, which departs slightly from the neutral style of the other sections.

**Answers to the check questions**
1. **Agreement:** the entry, active mission, model table and block agree on the Sol tier (GPT-6 / GPT-6.1 Sol or a fresh Opus), the Luna tier (Luna, Sonnet, Haiku), `GPT-6.1 Sol` added to the block, and the checker transition. The only mismatches are items 2 to 5 above.
2. **Counts, independence and labelling:** preserved. The labelling clause is extended to "a Claude report … never recorded as a GPT model or the reverse, nor a Sonnet or Haiku report as Opus".
3. **Supersession:** accurate for Haiku and the two 2026-10-09 entries. Incomplete for 2026-09-29 (item 1).
4. **#602 correction:** honest and consistent between the entry and §13 (item 7).
5. **Links:** the delta adds no new links, and the `#model-policy` anchor is untouched. The Source line's decision-log title matches the new entry's heading prefix.
6. **REPORT 1 in the delta note:** byte-identical to what I returned, as described under checks above.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a9d11e58300c3ea4b; model claude-sonnet-5-5; role ordinary review B (scenarios), delta; candidate 9a3109c625544da7bcea6182202b68efc78dc741; sha256 da907fb1746d3e4a6d7c096a9f22c3514c63601e9a232e310097b0a5c4dda6c7) -->

# Independent ordinary review B — #615 delta dff9a617..9a3109c6
- **Exact candidate reviewed:** 9a3109c625544da7bcea6182202b68efc78dc741
- **Comparison base:** dff9a617ffc8d1ba45782342904ff6ab58f88b7c
- **Reviewer / model / context:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh Agent-tool context, did not author or remediate. This is the third review round of the same PR by this context.
- **Files / surfaces checked:**
  - The delta `e824f6d6` (record-only) and `9a3109c6`, five files: `docs/04-engineering/agent-workflow.md` (model-policy table, Source and labelling paragraphs, security-review block, transition sentence at line ~178), `docs/07-planning/decision-log.md` (new "Model tiers by availability" entry), `docs/07-planning/active-mission.md`, `docs/07-planning/workflow-policy-audit-2026-10-09.md` §13, and the new `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment-delta.md`.
  - Residual wording in `.github/pull_request_template.md`, `.github/CODEOWNERS`, `docs/04-engineering/ci-cd.md`, `docs/04-engineering/repository-bootstrap.md`, `AGENTS.md` and `CLAUDE.md`.
- **Checks actually run:**
  - Confirmed `dff9a617` is an ancestor of `9a3109c6`, and listed the commits and the full docs diff.
  - Extracted all three embedded reports from the delta note and recomputed their SHA-256 over the stripped body. Each matches its marker header, and REPORT 2 gives `6eb05f02…6803`.
  - Compared REPORT 2 line by line with what I returned. It is identical, labelled `claude-sonnet-5-5`, and describes the `dff9a617` delta review, which is the review I returned for that candidate.
  - Ran `git grep` for Haiku, GPT-6 Sol and "never an author" across policy, CI docs and the template.
  - Checked #615's own changed paths against `origin/main` (merge base `3096cb04`): only `AGENTS.md`, `CLAUDE.md` and `docs/**`. None is on the ci-cd.md security-scope path list.
  - Ran no tests, since the delta is docs only.

## Scenario results
- **(a) PASS.**
  - When GPT-6 Sol is unavailable, a fresh Claude Opus context does the security review. The Sol-tier row of `agent-workflow.md` § Model policy allows it, and the decision log says "a fresh Claude Opus security review satisfies the Sol tier".
  - It is labelled as the platform reports it, `Claude Opus 5.5 (claude-opus-5-5)`, which exact-matches the `policy:security-review-models` block. "Never label a report with a model that did not produce it" applies.
  - For merge purposes see (e): until #616 lands the check does not accept that label.
- **(b) PASS.**
  - The Luna tier lists GPT-6 Luna, Claude Sonnet or Claude Haiku, and the decision log explicitly drops the Haiku "read-only extraction only" limit.
  - A Haiku context may be the ordinary reviewer, and it must be labelled with the platform-reported Haiku model. The labelling paragraph forbids recording "a Sonnet or Haiku report as Opus", and the general "never label a report with a model that did not produce it" covers recording it as Sonnet.
  - It still needs a context that did not author or remediate the change.
- **(c) PASS.**
  - "One context never fills two roles on the same change" and "the author's context is never its reviewer" are both retained in the Source paragraph, and tier interchangeability is explicitly limited to availability ("their labels are not").
  - So a Luna-tier and a Sol-tier role on one change need separate contexts. The security-reviewer row also requires a context that did not author, direct or remediate, and that reviews after ordinary review clears.
- **(d) PASS.** The block now has the exact line `GPT-6.1 Sol` alongside `GPT-6 Sol` and `Claude Opus 5.5 (claude-opus-5-5)`. It is exact-line matched against the `**Model:**` field, and the surrounding "read from the merge base" text is unchanged.
  - Note that this acceptance is on the policy side. `main`'s checker still accepts only the literal `GPT-6 Sol`, so a `GPT-6.1 Sol` label also waits for #616. See non-blocking item 2.
- **(e) PASS.**
  - A security-scope PR whose only security review is Opus-labelled waits for #615 and #616, with the review never relabelled and the required check not lifted. The decision log "Transition" paragraph and audit §13 say exactly this.
  - `agent-workflow.md` still states that until the reader is on `main` the check accepts only `GPT-6 Sol`.
  - The withdrawn ruleset-lift proposal is recorded as withdrawn, with "the ruleset was not changed". I can attest to the text but not to the GitHub state.
  - #615 itself is not caught by this wait. It changes only `AGENTS.md`, `CLAUDE.md` and docs, none of which is on the security-scope path list, so the template model check does not gate it.
- **(f) PASS.**
  - The decision log says historical Sol and Luna reviews "keep their identity", and "Their other content stands" for the superseded entries.
  - `agent-workflow.md` says "Reviews completed under an earlier assignment stay valid for what they covered", and `active-mission.md` repeats it.
  - The rule that an old review "never approves later changes" is untouched.
- **(g) Partly clear.** The dispatch rule is clear for the common cases: security goes to a fresh Opus or any Sol-tier model, and ordinary review goes to Sonnet, Haiku or Luna. Wording that could leave an agent unsure is listed in the findings below.

## Findings
**Blocking:** None

**Non-blocking:**
1. **No stated fallback across tiers.**
   - The decision quote says "anything is ok because usage limit are real", but the table lists only Luna-tier models for implementation and ordinary review, and only Sol-tier models for security and critical review.
   - It does not say whether a Sol-tier model (for example Opus) may do ordinary review or implementation when the whole Luna tier is out of quota. The previous text explicitly removed that for Opus.
   - One sentence either allowing or forbidding upward use would remove the guess.
2. **The transition text covers only Opus-labelled reviews.**
   - `main`'s checker rejects anything but the literal `GPT-6 Sol`, so a `GPT-6.1 Sol`-labelled security review would also wait for #616.
   - The decision-log "Transition", audit §13 and the line at `agent-workflow.md` ~178 should say "any label other than the literal `GPT-6 Sol`", or name `GPT-6.1 Sol` as well.
3. **Table versus block mismatch on versions.**
   - The Sol-tier row says "a fresh Claude Opus context" with no version, but the block pins `Claude Opus 5.5 (claude-opus-5-5)`.
   - If the platform reports another Opus version, the table says it is fine, but the exact-line block will not match. Either note that the block needs a new line when versions change, or state that the block is authoritative for the merge check.
4. **"From now on … satisfies the Sol tier for merges" reads as unconditional.**
   - The next paragraph (Transition) qualifies it until #616 lands. Reading the first sentence alone could mislead, so a pointer such as "once #616 lands" would help.
5. **The audit §13 correction is written in the first person ("I first reported…").** The rest of the audit is third-person. This is a style nit.
6. **The ledger and pointers are still to be updated.** The delta reviews of `dff9a617` (including REPORT 1 to 3 of the new note) and this review of `9a3109c6` will need §11 rows. The earlier-flagged "final audit independence" and "§12 pointer to later deltas" items are still open.
7. **Stale GPT-6 Sol requirement text remains in `ci-cd.md`, the PR template and `CODEOWNERS`.** This is expected, because #616 carries the F3 reference cleanup. It is noted only so it is not forgotten.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a2d042e8432eb6e84; model claude-opus-5-5; role security/authority review, delta; candidate 9a3109c625544da7bcea6182202b68efc78dc741; sha256 bd80663d727cd3b5b24a485030d99def65b9372115ad7cfc1996d4a4f2ce7e50) -->

# Independent security/authority review: #615 delta dff9a617..9a3109c6
- **Exact candidate reviewed:** 9a3109c625544da7bcea6182202b68efc78dc741
- **Comparison base:** dff9a617ffc8d1ba45782342904ff6ab58f88b7c
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), the same fresh Agent-tool context (agent `a2d042e8432eb6e84`, not forked) that reviewed e6dd0ca3 and dff9a617. Role: security reviewer. I did not author, direct or remediate this change.
- **Files / surfaces examined:**
  - `docs/04-engineering/agent-workflow.md`: the Model policy table, the Source and labelling paragraphs, and the `policy:security-review-models` block.
  - `docs/07-planning/active-mission.md`: the model assignment.
  - `docs/07-planning/decision-log.md`: the new top entry, including its Supersedes, Transition and Source sections.
  - `docs/07-planning/workflow-policy-audit-2026-10-09.md`: the new §13, and §11 as it stands.
  - `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment-delta.md`.
  - The parent session transcript `412b91f1-…jsonl`, for the owner's words and the conductor's relay.
  - My own subagent transcript.
  - The live `protect-main` ruleset, and #602's PR body.
- **Checks actually run:**
  - **Commit structure:** I ran `git log` with parents, `git show --name-status` for each commit, and `git diff --name-status dff9a617 e824f6d6`. e824f6d6 has parent dff9a617 and only adds `security-reviews/615-workflow-policy-routing-amendment-delta.md`, so it is record-only. 9a3109c6 changes four policy files.
  - **Security-review block:** I extracted the block at both commits and compared them with `diff` and `od -c`. Exactly one plain-ASCII line was added, ``- `GPT-6.1 Sol` ``, after `GPT-6 Sol`. Markers and format are unchanged, and the marker appears twice, as before.
  - **REPORT 3:** I extracted my second report from my transcript (every turn there is `claude-opus-5-5`). Its sha256 is `e5eda118…bc02`, which equals the marker. With the marker newlines stripped, the published REPORT 3 body is byte-identical to it. The note also now carries `**Reviewed head:** dff9a617…`.
  - **Owner's words in the parent transcript:**
    - 16:56:21Z: the conductor's relay, quoting "yes do it. don't need for GPT 6 sol review now on."
    - 16:59:25Z: Thomas's direct answer in the recording session: "Now gpt 6.1 sol usage limit is full … Sol = opus / luna = sonnat / haku … anything is ok because usage limit are real." In the same answer he chose "Lift template check for #602 (Recommended)".
    - 17:00:27Z: the conductor asked for the lift to be withdrawn.
    - 17:00:55Z and 17:01:30Z: the maintainer withdrew it and told the conductor and Thomas.
  - **GitHub, read-only via `gh`:** this needed a sandbox bypass because sandbox TLS verification failed.
    - `protect-main` is active, `updated_at` is 2026-10-05, and it still lists "pull request template + security review".
    - #602 at `66c736e7` has `## Security review` **Model:** GPT-6 Sol, linked to `602-p0-scope-clean.md`.

## Findings
**Blocking:** None

**Non-blocking:**
1. **The relay time label is wrong.** The entry repeats the conductor's "~17:10 UTC". The relay message is timestamped 16:56:21Z, and Thomas's direct answer 16:59:25Z, so 17:10 cannot be UTC. It is most likely local time; `gh` shows the owner's offset as +06:30. Correct it, or drop "UTC".
2. **The conductor row no longer names a model.** It now reads only "The session Thomas designates". Thomas's words mapped the Sol and Luna tiers but did not mention the conductor. This widens nothing, because only Thomas can designate a conductor and agents cannot. Still, the earlier "Opus conductor" choice is now superseded silently rather than explicitly. Say so in the entry, or keep "a Sol-tier session preferred".
3. **"Read-only extraction: Any model" is too loose.** The output is treated as data, so the risk is low. But "any model" could be read as allowing the retired routes (`pal-mcp`, 9Router), which the same section bans. Write "any assigned model".
4. **Version mismatch between table and block.** The Sol tier says "a fresh Claude Opus context" with no version, but the block accepts only `Claude Opus 5.5 (claude-opus-5-5)`. This fails closed: a different Opus version would satisfy the table but not the gate once #616 lands. It needs a reviewed block edit if that happens.
5. **Residual risk:** Haiku is now an eligible ordinary reviewer, including for auth and permissions changes that need two to three ordinary reviews. Thomas authorized this directly, and the Sol-tier security pass remains mandatory. This is noted as a capability residual, not a policy defect.
6. **Leftovers from my dff9a617 review:**
   - (a) The §11 opening line (line 287) still says every reviewer ran on `claude-opus-5-5`.
   - (b) The round-6 `a32abc36` row still says "pending".
   - §11 has no rows for the dff9a617 delta round. That round is recorded in the new note.
   - My item (c) is resolved: the Source line was rewritten.
   - My item (d) is resolved for the new note: it has a `**Reviewed head:**` line.

**Answers to the threat-model questions:**
1. No Luna-tier model (Sonnet, Haiku, Luna) is listed for any Sol-tier role. The Sol-tier roles are security review, critical review, phase finalizer, final audit, high-risk architecture review and security-heavy context preparation. The sampled auditor is now Sol-tier. "One context never fills two roles on the same change" and "the author's context is never its reviewer" are retained.
2. Counts and independence are unchanged. Labelling is strengthened: a Claude report is never recorded as a GPT model or the reverse, and a Sonnet or Haiku report is never recorded as Opus.
3. The block edit is exactly the added `GPT-6.1 Sol` line, and it is well formed. The block is read from the merge base, so this PR cannot use the edit to approve itself. "GPT-6.1 Sol" comes from Thomas's own words, so the addition is traceable to him.
4. The source is honest. The relay is attributed to the conductor, and Thomas's tier mapping was given directly in the recording session; the quotes match the transcript. The lift is reported correctly:
   - Thomas did choose it.
   - It rested on the maintainer's wrong premise.
   - It was withdrawn, in the conservative direction, and Thomas was told.
   - The ruleset is unchanged, and #602 really does carry a GPT-6 Sol review.

   The Transition paragraph keeps the checker literal and allows no relabelling and no lift.
5. Yes, e824f6d6 is record-only.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
