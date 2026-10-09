# 615 — routing amendment: independent reviews (Claude Sonnet 5.5 ×2, Claude Opus 5.5)

- **Reviewer contexts:** fresh Claude Code Agent-tool subagents (`subagent_type: general-purpose`, not forked), dispatched with an explicit model selection by parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. None authored, directed or remediated the change. The model of each report below is the one its transcript records, not the requested one.
- **Transport:** each report is the reviewer's final message, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a9fe5e0df4cb824df; model claude-sonnet-5-5; role ordinary review A; candidate e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8; sha256 bc330cef7bd47b888cb5ff939faa6f4380c3cc87c211e27b1b2db1744cda8e7d) -->

# Independent ordinary review A — #615 routing amendment ea30542a..e6dd0ca3
- **Exact candidate reviewed:** e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8
- **Comparison base:** ea30542aa081bad7f16c5aa039c502079235547e
- **Reviewer / model / context:** Claude Sonnet 5.5 (claude-sonnet-5-5), fresh Agent-tool context, did not author or remediate
- **Files / surfaces checked:**
  - The full ea30542a..e6dd0ca3 diff: decision-log.md, active-mission.md, agent-workflow.md (Model policy section and the `policy:security-review-models` block) and workflow-policy-audit-2026-10-09.md §12.
  - Tree-wide at the candidate, via `git show` and `git grep`: AGENTS.md, CLAUDE.md, definition-of-done.md, error-fix-loop.md, ci-cd.md, the PR template and CODEOWNERS.
  - Context: the prior "Opus policy-repair conductor" entry, and the commit list from db071e38 to the candidate.
- **Checks actually run:**
  - `git diff --stat` and `git diff` for the delta.
  - Grep for `opus`, `sonnet`, `haiku`, `every role` and `model` across the policy files.
  - A diff grep for `policy:` markers in agent-workflow.md. The block lines (184 to 187) are not in the delta, so the block is byte-unchanged.
  - Read the Model policy section, the active mission and CLAUDE.md in full.
  - Confirmed the `#model-policy` anchor resolves to the `### Model policy` heading in agent-workflow.md.
  - Ran no tests or CI.

## Findings

**Blocking:** None

**Non-blocking:**

1. **Table roles are wider than the decision entry.**
   - The entry and active-mission.md give Sonnet "bounded implementation and independent ordinary review". The Model policy row gives Sonnet (as an alternative to Luna) implementation, context preparation, ordinary review and bounded architecture/alignment review.
   - The entry and active-mission.md give a fresh Opus the "required security and critical review and the final audit". The table's Opus row also carries phase finalizer, broad or high-risk architecture review, and security- or architecture-heavy context preparation.
   - These look like a deliberate mapping of the existing Luna and Sol rows. Neither the entry nor the audit says so, though, and you asked for no role widened beyond the entry.
   - Fix either way: add one sentence to the entry saying Sonnet and Opus take the Luna and Sol role bundles respectively, or trim the table to the entry's wording.
2. **The table names versions the owner did not give.**
   - It says "Claude Sonnet 5.5" and "Claude Haiku 5.5". The entry says only "Claude Sonnet" and "Claude Haiku".
   - The Sonnet version is fine, since the platform reports `claude-sonnet-5-5`. A "Haiku 5.5" is not verifiable from anything in the repo.
   - Consider "Claude Haiku (version as the platform reports it)" so the truthful-labelling rule is not undercut.
3. **The active mission says "Claude Opus"; the table says "Claude Opus 5.5".** Same item as above in the other direction, and harmless.
4. **The audit's review ledger stops at round 4.**
   - This is not in the delta. §11 lists rounds 1 to 4, while §12 refers to "round 5". The round-5 note is committed as `security-reviews/615-workflow-policy-round5-opus.md`. A one-line pointer in §11 would close it.
5. **Audit §12 describes the Sonnet and Opus reviews as already covering the amendment.**
   - The sentence "two Claude Sonnet ordinary reviews and one fresh Claude Opus security review cover it" is written in the present tense. At this commit those reviews are still pending.
   - Rephrase as "will cover it", or record the actual reviews once they land.

## Answers to the five checks

1. **Decision-log entry:** consistent and honest. It states the relay and the direct confirmation, and gives the session id. It narrows only the delivery-mission part of the 2026-10-09 entry, which had authorised Opus for every role for "this assignment and the following frozen-scope delivery mission". It leaves the policy-repair scope and the 2026-09-29 GPT roles unchanged, and it correctly says the security-review block is unchanged. The earlier entry is not edited, so the log stays append-only.
2. **Active mission and Model policy section:** the mission paragraph matches the entry exactly. Reviewer counts, independence and the truthful-labelling rule are intact. The "never a Sonnet report as Opus" clause is added and correct. The only mismatches are the wider table roles in item 1.
3. **Contradictions:**
   - No remaining text says Opus fills every role. The only such statement is the history in the policy-repair entry and the Source line, which now name the later entry.
   - CLAUDE.md defers to the Model policy section and its Opus example is a label example only. AGENTS.md and the definition-of-done checklist link to the Model policy anchor, and error-fix-loop cites the old entry only for the re-run allowance.
   - The `#model-policy` anchor resolves.
4. **Security-review block:** unchanged. It still accepts GPT-6 Sol and Claude Opus 5.5. That is consistent with Opus doing security review and with Sonnet and Haiku being deliberately excluded.
5. **Audit §12:** accurate on the sequence, the unchanged block and the lack of checker changes. See items 4 and 5 for the wording and ledger nits.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a9d11e58300c3ea4b; model claude-sonnet-5-5; role ordinary review B (scenarios); candidate e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8; sha256 1c1726e5d614010be4661be64b61c34450b658ae905b69d90a6e23075767bc95) -->

# Independent ordinary review B — #615 routing amendment ea30542a..e6dd0ca3
- **Exact candidate reviewed:** e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8
- **Comparison base:** ea30542aa081bad7f16c5aa039c502079235547e
- **Reviewer / model / context:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh Agent-tool context, did not author or remediate
- **Files / surfaces checked:** the four changed files at the candidate: `docs/04-engineering/agent-workflow.md` (Review roles, Model policy, security-review block), `docs/07-planning/decision-log.md` (new entry, plus the "Opus policy-repair conductor" entry), `docs/07-planning/active-mission.md`, and `docs/07-planning/workflow-policy-audit-2026-10-09.md` §§8–12. I also read `AGENTS.md` § Authority and the lane-agent row, and compared `main` (`8ddb9de8`) for `review-models.mjs`, the policy block and `check-pr-template.mjs`.
- **Checks actually run:** read-only `git diff` and `git show` on the exact SHAs, and `git grep` for Sonnet/Haiku/Opus/relay wording in docs, `scripts` and `.github`. I did not run tests, because this is a docs-only delta and I made no edits.

## Scenario results
- **(a) PASS** (`agent-workflow.md` § Model policy, § Review roles).
  - A Sonnet context may do ordinary review. It must be recorded as `Claude Sonnet 5.5 (claude-sonnet-5-5)`, with role, context, source, scope and verdict.
  - It must never be recorded as Opus, GPT-6 Luna or GPT-6 Sol ("nor a Sonnet report as Opus").
  - It cannot be the security review. The security row lists only GPT-6 Sol or a fresh Claude Opus 5.5. The `policy:security-review-models` block lists only `GPT-6 Sol` and `Claude Opus 5.5 (claude-opus-5-5)`, matched exactly. "Never downgrade" applies.
  - The text never states outright that Sonnet cannot do security review. It follows from the table and the block, so it is implicit but unambiguous.
- **(b) PASS** (§ Model policy security row and the block). A fresh Opus context is accepted and must be labelled exactly `Claude Opus 5.5 (claude-opus-5-5)`. The row also requires it to be fresh, and the Review roles table requires it not to have authored, directed or remediated the change.
- **(c) PASS** (§ Model policy "Read-only extraction" row; decision log "optional read-only extraction only").
  - Haiku output is "never an author, reviewer of record or approver". Haiku is absent from the security block, so it cannot satisfy the security check either.
  - `active-mission.md` words it more loosely ("may do read-only extraction") without the "never approver" clause. The governing text is `agent-workflow.md`, so this is only a consistency gap.
- **(d) PASS.**
  - Nothing forbids one model filling two roles. The Review roles table says "The same model may fill several roles; the context and role must be independent".
  - What is forbidden is one context filling two roles: "one context never fills two roles on the same change".
  - The author's context is excluded: "the author's context is never its reviewer", and the security reviewer "did not author, direct or remediate" the change.
  - The Opus conductor directs the work, so it is excluded from the security role. The "fresh Opus context" wording and the Security reviewer row make that explicit.
  - Two Sonnet ordinary reviewers is the normal "two independent" case, counted by separate contexts, not by distinct models.
- **(e) PASS** (`agent-workflow.md` § Model policy last paragraph; decision log "Relation to earlier entries"; `active-mission.md`).
  - Reviews completed under the earlier assignment "stay valid for what they covered". The same section also says an existing review counts "only where its scope and source coverage are established" and "never approves later changes".
  - The decision log and `active-mission.md` give only the first half ("stay valid for what they covered"). The "cannot approve later changes" limit lives in `agent-workflow.md`, which is the correct home.
- **(f) PASS.** The decision log says GPT-6 Luna and Sol "keep their roles (2026-09-29)". `agent-workflow.md` still lists both in their rows and says "historical reviews keep their original identity". `active-mission.md` says they "remain valid for their existing roles".
- **(g) PASS** (`AGENTS.md` § Authority item 1; `agent-workflow.md`; audit §12).
  - A relay is "not approval". A direct instruction takes effect for the session that received it, and that session records it in the decision log with its source.
  - This candidate follows that rule: the conductor's relay was not recorded, and Thomas's direct confirmation in the policy-maintainer session is what the entry rests on. The decision-log "Source" paragraph and audit §12 both say so.
  - The entry is therefore a verifiable owner decision under the stated rule.

## Findings
**Blocking:** None

**Non-blocking:**
1. **Thin provenance on the confirmation.**
   - The "Source" paragraph records that Thomas confirmed directly, but gives no time of day or verbatim phrase. The earlier entry quoted "Instruction 1 — …".
   - `AGENTS.md` asks for when, where and exact scope, and the entry gives the date, the session and the scope. Consider adding the confirming phrase or turn reference.
2. **Possible confusion over what "current mission" and "delivery mission" cover.**
   - The table says "under the current mission". The decision log says "for the delivery mission" and "narrows the policy-repair conductor assignment for the delivery mission".
   - #615 is policy-maintainer work, run by an Opus maintainer under the "Policy maintenance" row. It is reviewed by Sonnet and Opus under audit §12.
   - An agent could wonder whether Opus may still do ordinary review of policy PRs. The decision log says no, but one sentence would close the gap.
3. **Overlap between context preparation and read-only extraction.**
   - "Context preparation" is assigned to Luna or Sonnet. The security- or architecture-heavy kind goes to Sol or Opus. "Read-only extraction" goes to Haiku.
   - It is not stated that extracted facts must be verified against the source by the reviewer of record. Haiku output is data, not evidence.
4. **Final audit has no independence rule of its own.**
   - "Final audit" now sits in the phase-finalizer row, which says it must be "a fresh Claude Opus 5.5 context".
   - The Review roles independence cell is "Did not orchestrate or merge that stage's PRs", written for stages. It is not stated outright that a fresh Opus context counts as independent from the Opus conductor. The "fresh/separate context" wording implies it.
5. **How #615 itself satisfies the PR-template check is not stated.**
   - Audit §12 says one fresh Opus security review covers the amendment.
   - On the base, `check-pr-template.mjs` and the PR template still require `**Model:** exactly GPT-6 Sol`, because `review-models.mjs` is not on `main`. Audit §9 explains that this is a technical boundary and that #616 delivers the reader.
   - §12 could add one sentence saying how #615's own gate is handled, to avoid operator confusion.

**Wording that could leave an agent unsure which model to dispatch:** the five items above are the only ones. Ordinary review by Sonnet, security review by fresh Opus, conductor Opus and Haiku as non-approving extraction are otherwise unambiguous. Opus is no longer listed for implementation or ordinary review, and the decision log confirms that is deliberate.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a2d042e8432eb6e84; model claude-opus-5-5; role security/authority review; candidate e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8; sha256 9563f5087baec53b8be9015ca88602e8b352019d70e42aaed1efd72078070390) -->

# Independent security/authority review: #615 routing amendment ea30542a..e6dd0ca3
- **Exact candidate reviewed:** e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8
- **Comparison base:** ea30542aa081bad7f16c5aa039c502079235547e
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), fresh Agent-tool context, role: security reviewer; did not author, direct or remediate
- **Files / surfaces examined:** the full one-commit delta: `docs/07-planning/decision-log.md` (new top entry, plus the "Opus policy-repair conductor" entry it narrows), `docs/07-planning/active-mission.md`, `docs/04-engineering/agent-workflow.md` § Review roles / § Model policy / § How many reviews, and `docs/07-planning/workflow-policy-audit-2026-10-09.md` §11–§12. For cross-checks: `AGENTS.md` (authority precedence and the relay rule, lines 50–64 and 96), `CLAUDE.md` (Claude Code section), `.github/pull_request_template.md`, `scripts/ci/check-pr-template.mjs`, `scripts/ci/lib/` listing, `docs/04-engineering/ci-cd.md` and `definition-of-done.md` model references, and `docs/07-planning/security-reviews/615-workflow-policy-round5-opus.md`.
- **Checks actually run:**
  - `git log` / `git diff --stat` / full `git diff` base..candidate: one commit, 4 files, docs only.
  - Extracted the `<!-- policy:security-review-models -->` block from both trees and ran `cmp` on them. They are byte-identical: `GPT-6 Sol` and `Claude Opus 5.5 (claude-opus-5-5)`. No Sonnet or Haiku label is in the block.
  - `git grep` across the candidate tree:
    - Sonnet and Haiku appear only in the four delta files and in historical records.
    - No other live document still describes the old "Opus for every role" routing.
    - The candidate's checker (`check-pr-template.mjs:376`) still accepts only `GPT-6 Sol` and does not read the block. `review-models.mjs` is not in this tree, which the workflow text already discloses.
  - Read the PR template's `## Reviewed by`. The only machine constraint there is a different model or session from `## Implemented by`.
  - Verified `db071e38..ea30542a` is one commit that only adds `615-workflow-policy-round5-opus.md`, so that delta is records-only.
  - Verified the round-5 note holds three reviews at `db071e38`, all CLEAR WITH NON-BLOCKING: two ordinary and one security/authority.
  - Compared the new entry's source line with the relay rule in AGENTS.md lines 52–60.

## Findings
**Blocking:** None

**Non-blocking:**
1. **Bootstrap and scope of Sonnet's eligibility to review this delta.**
   - At the base `ea30542a`, the ordinary-review row allows only GPT-6 Luna or Claude Opus 5.5. Sonnet becomes an eligible ordinary reviewer only through this candidate.
   - Audit §12 plans "two Claude Sonnet ordinary reviews" of #615 itself. That is legitimate only because the authority is Thomas's directive, recorded as confirmed directly in the recording session, and not the edit. AGENTS.md precedence item 1 supports that.
   - However, the entry scopes the routing to "the frozen-scope delivery mission" and narrows the earlier assignment "for the delivery mission". The earlier entry treats the policy repair as a separate assignment. The workflow's Source line also still describes the earlier entry as "Claude Opus for every role … for the policy repair", while the table now drops Opus from ordinary review.
   - The active mission says policy maintenance runs "alongside" inside the mission, so the reading is defensible. Still, the entry should say explicitly that the routing applies to #615's remaining reviews, if that is what Thomas confirmed. The alternative is to include one ordinary reviewer eligible under both trees (GPT-6 Luna).
   - None of this weakens the security tier. The Opus security reviewer is eligible under both trees.
2. **Version pinning goes beyond the decision.**
   - The decision names "Claude Sonnet" and "Claude Haiku" with no version.
   - The table pins "Claude Sonnet 5.5" and "Claude Haiku 5.5" and gives the example ID `claude-sonnet-5-5`.
   - This fails closed: it is narrower than the decision, not wider. But if the platform reports a different version, the table and reality diverge. Confirm the versions, or phrase them as "as the platform reports it".
3. **Residual: some exclusions are prose-only.**
   - Haiku's "never an author, reviewer of record or approver" and the ordinary-reviewer model list are not machine-enforced. The template only requires `Reviewed by` to differ from `Implemented by` by model or session.
   - This was already true before the delta. The only machine-gated model check is the security model, and it is unaffected.
   - Consider also stating that a Haiku extraction is never cited as evidence unless a reviewer re-verifies it against source.
4. **Audit §11 ledger is incomplete.**
   - §11 says "Nothing was dropped", but it lists rounds 1–4 only.
   - §12 relies on round 5, which is real and accurately described (three CLEAR WITH NON-BLOCKING reviews at `db071e38`), but round 5 has no ledger rows.
   - Add the round-5 rows and this amendment's review round. The gap was already there at `ea30542a`; §12 now depends on it.
5. **Provenance detail.**
   - The source line gives the conductor session ID. For the recording policy-maintainer session it gives only "PR #615" and a date.
   - AGENTS.md asks for when, where and exact scope. Adding the recording session's ID (and the time, if available) would make the "confirmed directly" claim traceable to the same standard as the relay leg.
   - The record itself is honest: it does not treat the relay as authority, and it says the decision was recorded only after direct confirmation.

On the specific questions:
- **Q1:** No authority is widened. No security-critical role (security review, critical review, phase finalizer, final audit, conductor) moves to a weaker model. Security, finalizer and final audit stay with GPT-6 Sol or a fresh Opus 5.5 context; "fresh" is newly explicit. Haiku is explicitly barred from reviewer of record. Counts and independence are unchanged.
- **Q2:** The block is unchanged, and the dependent text (merge-base read, exact-line match, "block follows the mission") stays consistent.
- **Q3:** The supersession wording is sound. Earlier reviews "stay valid for what they covered" and "never approve later changes".
- **Q4:** The new rule bars recording a Sonnet report as Opus, or a Claude report as GPT, which reduces mislabelling risk.
- **Q5:** Audit §12 is factually accurate, subject to items 1 and 4.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
