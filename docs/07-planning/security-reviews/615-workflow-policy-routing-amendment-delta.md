# 615 — routing amendment: independent delta reviews of dff9a617 (Claude Sonnet 5.5 ×2, Claude Opus 5.5)

**Reviewed head:** `dff9a617ffc8d1ba45782342904ff6ab58f88b7c`

- **Reviewer contexts:** the same three fresh Agent-tool contexts that reviewed `e6dd0ca3` (`615-workflow-policy-routing-amendment.md`), each re-dispatched for this delta with the exact new candidate; none authored, directed or remediated the change. Each report's model is the one its transcript records for every turn.
- **Transport:** each report is the reviewer's final message for this delta, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a9fe5e0df4cb824df; model claude-sonnet-5-5; role ordinary review A, delta; candidate dff9a617ffc8d1ba45782342904ff6ab58f88b7c; sha256 e00d22663377424d4bbd87400f762a867732d29152aab91339b55938a3c472d8) -->

# Independent ordinary review A — #615 delta e6dd0ca3..dff9a617
- **Exact candidate reviewed:** dff9a617ffc8d1ba45782342904ff6ab58f88b7c
- **Comparison base:** e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8
- **Reviewer / model / context:** Claude Sonnet 5.5 (claude-sonnet-5-5), fresh Agent-tool context, did not author or remediate
- **Files / surfaces checked:**
  - The two-commit delta (4bed924c and dff9a617), four files changed.
  - Model policy section and the `policy:security-review-models` block in `docs/04-engineering/agent-workflow.md`.
  - `docs/07-planning/decision-log.md`, new entry: the new Scope paragraph and Source paragraph.
  - `docs/07-planning/active-mission.md`, for model wording.
  - `docs/07-planning/workflow-policy-audit-2026-10-09.md`, §11 ledger and §12.
  - The new note `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment.md`.
- **Checks actually run:**
  - `git log`, `git diff --stat` and `git diff` between the base and candidate, restricted to the policy files.
  - `git grep` for "5.5" and Sonnet/Haiku wording.
  - Extracted each REPORT block from the note and computed its SHA-256 against the hash in its marker.
  - Read the full note.
  - Ran no tests or CI.

## Disposition of earlier items
1. **Table roles wider than the entry: OPEN, unchanged.**
   - The delta does not touch the Sonnet or Opus role bundles. The table still gives Sonnet context preparation and bounded architecture/alignment review, and a fresh Opus phase finalizer and broad architecture review, none of which the entry lists.
   - Reports 2 and 3 in the note do not close it either. It is still a plausible mapping of the Luna and Sol bundles, so non-blocking, but one clarifying sentence in the entry is still needed.
2. **Version pinning: CLOSED.**
   - The table now says "Claude Sonnet" and "Claude Haiku" with no version.
   - The model-label paragraph adds "a table entry without a version means whichever version the platform reports".
   - The labelling examples still use the exact platform IDs.
3. **Mission says "Opus" and table says "Opus 5.5": OPEN, trivial.** The mission still says "Claude Opus". This is harmless because the table's Opus 5.5 matches the security block.
4. **Ledger stopped at round 4: CLOSED, with one leftover.**
   - §11 now has round-5 rows. The three #615 rows at `db071e38` match the round-5 note, which Report 3 confirms as three reviews, all CLEAR WITH NON-BLOCKING.
   - It also has round-6 rows and routing-amendment rows A, which match REPORTs 1 to 3 in the new note.
   - The leftover: the §11 intro still says every reviewer was "model `claude-opus-5-5`". Rows A are Sonnet, so the intro now contradicts the table. The added note below the table ("all other rows are Claude Opus 5.5") partly covers this.
5. **§12 tense: CLOSED.** It now reads "reviewed it (§11, rows A), all CLEAR WITH NON-BLOCKING". Those reviews cover `e6dd0ca3`, not this delta. The reviews of this delta are still pending, and §12 does not claim otherwise.

Other items:
- **Security model block:** unchanged. The block lines are not in the delta.
- **Haiku rule:** the added rule (output is data, cited only after a reviewer re-verifies it) only narrows Haiku.
- **Scope paragraph:** the decision-log Scope paragraph addresses Report 3's scope concern.
- **Recording-session id:** the Source line now carries the recording-session id.
- **Link and anchor check:** the delta adds no links or anchors, and the existing `#model-policy` anchor is untouched.

## Findings
**Blocking:** None

**Non-blocking:**
1. **§11 intro is stale** (see 4 above). Change it to say that rounds 1 to 6 used `claude-opus-5-5` and rows A record their own models.
2. **Table roles still wider than the entry** (see 1 above). Not addressed by the delta.
3. **Round-6 ordinary row** says "pending at the time of writing". That wording will go stale and should be updated when the row resolves.
4. **Report 2's** non-blocking points (thin provenance on the confirmation, final-audit independence, how #615 satisfies its own PR-template check) are not acted on in the delta. They are only recorded, which is acceptable.
5. **§12 does not mention this delta's own review.** It still describes only the `e6dd0ca3` reviews, which is correct as written.

**Report 1 byte-identity and labelling**
- Report 1 labels the model `claude-sonnet-5-5`, which is what I ran on. The note's header says model labels come from each transcript.
- The text between the markers has a SHA-256 that matches the marker hash `bc330cef7bd4…`. Reports 2 and 3 also match their markers, so the transport is internally consistent.
- Comparing the report line by line with my returned message, I found no differences. I cannot hash my own earlier output independently, and I cannot confirm that agent id `a9fe5e0df4cb824df` is mine.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a9d11e58300c3ea4b; model claude-sonnet-5-5; role ordinary review B (scenarios), delta; candidate dff9a617ffc8d1ba45782342904ff6ab58f88b7c; sha256 6eb05f02579361edeb0cd4393bf527caae02e4b68e11fa43e54f381227296803) -->

# Independent ordinary review B — #615 delta e6dd0ca3..dff9a617
- **Exact candidate reviewed:** dff9a617ffc8d1ba45782342904ff6ab58f88b7c
- **Comparison base:** e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8
- **Reviewer / model / context:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh Agent-tool context, did not author or remediate. This is a delta review of the same PR I reviewed at `e6dd0ca3`.
- **Files / surfaces checked:**
  - The delta `4bed924c` and `dff9a617`, four files: `docs/04-engineering/agent-workflow.md` (Model policy rows and the labelling paragraph), `docs/07-planning/decision-log.md` (new Scope sentence and Source line), `docs/07-planning/workflow-policy-audit-2026-10-09.md` (§11 ledger and §12), and `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment.md` (new, 181 lines, three embedded reports).
  - Unchanged and so unaffected: `active-mission.md` and the `policy:security-review-models` block.
- **Checks actually run:**
  - Confirmed `e6dd0ca3` is an ancestor of `dff9a617`, and listed the two commits and the full four-file diff.
  - Confirmed the review note is added in `4bed924c` and not touched in `dff9a617`.
  - Extracted the REPORT 2 body from the committed note and recomputed its SHA-256. The `strip('\n')` form hashes to `1c1726e5…bc95`, which equals the hash in the marker header.
  - Compared the REPORT 2 text line by line against the report I returned.
  - Ran no tests, since the delta is docs only.

## Disposition of earlier items
1. **Thin provenance on the confirmation: PARTIAL.**
   - The Source line now carries the recording session id (`412b91f1-99f8-4ac2-8f5c-a03dce507862`), and the new Scope sentence states the exact scope.
   - There is still no verbatim phrase or time of day. That is acceptable under `AGENTS.md` (date, session, scope), so it stays non-blocking.
2. **"Current mission" versus "delivery mission", and #615's own reviews: CLOSED for #615.**
   - The decision-log "Scope" sentence now says the routing "applies to the remaining reviews of the policy candidate (#615), including the reviews of this entry", and that earlier Opus reviews stay valid. Audit §12 repeats it.
   - For future policy PRs, the entry still says only "for the delivery mission". Those would be governed by the "Policy maintenance" row and the mission. This is a minor residual.
3. **Overlap between context preparation and Haiku extraction: CLOSED.** The Haiku table row now says its output "is data, cited only after a reviewer re-verifies it against the source".
4. **Final audit has no independence rule of its own: OPEN.** The delta does not touch the Review roles table, and this is the same point as before. "Fresh Opus context" implies independence, and it remains non-blocking.
5. **How #615's own gate satisfies the PR-template check: OPEN.** The delta adds no sentence on this. Audit §9 still explains the boundary and #616 still delivers the reader. It remains non-blocking.

Earlier items from other reviewers that the delta also touches:
- The version-neutral table entries ("Claude Sonnet", "Claude Haiku") plus the sentence "a table entry without a version means whichever version the platform reports" close the pinned-version concern.
- The §11 ledger now has rows for round 5, round 6 and A, which closes the incomplete-ledger concern.

## Scenario results
- **(a) PASS, unchanged.** A Sonnet ordinary review is labelled with the platform-reported model and cannot be the security review. The security row and the block list only GPT-6 Sol and Opus, and the block is untouched.
- **(b) PASS, unchanged.** The accepted security-review label is still exactly `Claude Opus 5.5 (claude-opus-5-5)`, from a fresh context.
- **(c) PASS, and now explicit.** Haiku is never an author, reviewer of record or approver (`agent-workflow.md` § Model policy, extraction row).
- **(d) PASS, unchanged.** Nothing forbids one model filling two roles. The rule is one context, one role per change. The author's context is excluded, and the conductor is excluded from the security role because it directs the change.
- **(e) PASS, unchanged.** Reviews completed under the earlier assignment stay valid for what they covered. The text still says "never approves later changes", and the new Scope sentence repeats the first half.
- **(f) PASS, unchanged.** GPT-6 Luna and Sol reviews remain valid.
- **(g) PASS, strengthened.**
  - The entry still records the relay and Thomas's direct confirmation in the recording session, now with that session's id and the scope. This meets `AGENTS.md` § Authority item 1.
  - The authority is Thomas's confirmation, not the edit. The text bootstraps Sonnet's eligibility without relying on the candidate editing itself.
- **(h) PASS.**
  - A Sonnet context may now be an ordinary reviewer of #615. The decision-log Scope sentence, audit §12 and the model-policy row all support it.
  - It must be labelled `Claude Sonnet 5.5 (claude-sonnet-5-5)`, must not have authored or remediated the change, and does not count as the security review.
  - On the base tree (before this candidate), Sonnet was not an eligible ordinary reviewer. The record makes clear that eligibility rests on Thomas's confirmed directive and not on the edit.
- **(i) PASS, meaning it must not be cited.** Haiku output is data and may be cited only after a reviewer re-verifies it against the source. The rule lives only in the `agent-workflow.md` table row. The decision log and active mission still say only "read-only extraction only", which is not a contradiction.

**REPORT 2 integrity.**
- The REPORT 2 body in the note hashes to the value in its marker header, so the embedded bytes are self-consistent.
- It is labelled `claude-sonnet-5-5` and "Claude Sonnet 5.5 (`claude-sonnet-5-5`)", my actual model.
- It matches the report I returned, line for line. I could not independently hash my own message, so I can only attest to a visual line-by-line match plus the self-consistent embedded hash.

## Findings
**Blocking:** None

**Non-blocking:**
1. Items 4 and 5 above remain open: a final-audit independence sentence, and how #615's own PR-template gate passes with an Opus security review.
2. **The delta review round is not yet in the ledger.**
   - The §11 rows A cover only `e6dd0ca3`. The reviews of `dff9a617`, including this one, will need rows, because "every dispatched review is recorded".
   - Row 6 still reads "pending at the time of writing" for `a32abc363efeeecbd`. That is not part of this delta, but it is stale if that review has since landed.
3. **A pointer would help.** Audit §12's sentence "reviewed it (§11, rows A)" is accurate for `e6dd0ca3`. A pointer saying the later `dff9a617` delta has its own review would avoid readers assuming rows A cover the whole candidate.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a2d042e8432eb6e84; model claude-opus-5-5; role security/authority review, delta; candidate dff9a617ffc8d1ba45782342904ff6ab58f88b7c; sha256 e5eda118c574c3abdfeeb76b10cdac4717ff552cbe7624a256919d9b0773bc02) -->

# Independent security/authority review: #615 delta e6dd0ca3..dff9a617
- **Exact candidate reviewed:** dff9a617ffc8d1ba45782342904ff6ab58f88b7c
- **Comparison base:** e6dd0ca3c00d5c4c7765ff4467ae3b7cbde300e8
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`), the same fresh Agent-tool context (agent `a2d042e8432eb6e84`, not forked) that wrote the e6dd0ca3 security review; role: security reviewer; did not author, direct or remediate
- **Files / surfaces examined:**
  - `docs/04-engineering/agent-workflow.md` (model table and labelling paragraph)
  - `docs/07-planning/decision-log.md` (new Scope paragraph and Source line)
  - `docs/07-planning/workflow-policy-audit-2026-10-09.md` §11–§12
  - `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment.md` (all three reports and their markers)
  - `docs/04-engineering/ci-cd.md`: the security-review path list
  - #615's full path set against `main` `3096cb04`
  - the 12 reviewer transcripts under parent session `412b91f1-99f8-4ac2-8f5c-a03dce507862`
- **Checks actually run:**
  - **Commits:** `git log`, `git show --name-status` for both commits, and the full `git diff` from base to candidate. 4bed924c has parent e6dd0ca3 and makes one change: it adds `docs/07-planning/security-reviews/615-workflow-policy-routing-amendment.md`. It is record-only, and dff9a617 is the only policy-changing commit.
  - **Security-review block:** I hashed the extracted `policy:security-review-models` block at e6dd0ca3 and at dff9a617 (sha256 `66f7923c…5f29` for both). It is byte-unchanged.
  - **REPORT 3:** I extracted my final message from my own transcript `agent-a2d042e8432eb6e84.jsonl`. Every assistant turn in it is recorded as `claude-opus-5-5`, 40 turns in all. The message's sha256 is `9563f508…0390`, which equals the marker hash. The note's REPORT 3 body, with the newlines around the markers stripped, is byte-identical to that message.
  - **REPORTS 1–2:** Both Sonnet transcripts record every turn as `claude-sonnet-5-5`. Each one's first final report hashes to its marker (`bc330cef…`, `1c1726e5…`) and is found verbatim in the note. Each transcript also holds a later delta report on dff9a617. Neither is published yet, which is expected.
  - **§11 ledger:** For every agent ID I checked each row's candidate, scope and verdict against the report headings and `## Verdict` lines in the transcripts. The subagent directory holds 36 files, which is 12 agents, and the ledger lists the same 12.
  - **Path check:** `git diff --name-only 3096cb04 dff9a617` shows #615 touches no path on the ci-cd.md security-review list.

## Disposition of earlier items
1. **Sonnet's eligibility and scope: RESOLVED.** The Scope paragraph records Thomas's direct confirmation that the routing applies to #615's remaining reviews, including the reviews of this entry. Eligibility therefore rests on the owner, not on the edit. The Source line names both sessions. One small leftover is new item (c) below.
2. **Version pinning: RESOLVED.** The table entries for Sonnet and Haiku no longer name a version, and a new sentence says an unversioned entry means whatever the platform reports. The transcripts confirm the Sonnet example `claude-sonnet-5-5` is real.
3. **Haiku and the ordinary-review model are not enforced by any check: PARTLY ADDRESSED, accepted residual.** The new rule says Haiku output is data, cited only after a reviewer re-verifies it against the source. Nothing checks this automatically, and this delta did not create that gap.
4. **§11 ledger was incomplete: RESOLVED, with two leftovers.** Rounds 5, 6 and A are added and match the transcripts. The leftovers are (a) and (b) below.
5. **Recording session ID was missing: RESOLVED.** `412b91f1-99f8-4ac2-8f5c-a03dce507862` is now in the Source line.

## Findings
**Blocking:** None

**Non-blocking:**
- **(a) The §11 opening sentence is now false.** It still says every reviewer below ran on model `claude-opus-5-5`. The A rows are Claude Sonnet 5.5. A trailer sentence corrects this, but the opening sentence is the kind of mislabelling the policy forbids. Reword it to "model as recorded per row / in each transcript".
- **(b) One ledger row is out of date.** The round-6 row for `a32abc363efeeecbd` (#616 `c3685d9d`, test adequacy) says "pending at the time of writing". Its transcript now ends CLEAR WITH NON-BLOCKING at that delta. Update the row when the next records are made.
- **(c) A sentence in agent-workflow.md is slightly out of date.** Its Source line still describes the earlier entry as "Claude Opus for every role … for the policy repair". The new Scope paragraph moves #615's remaining reviews to the new routing, so that wording is now partly superseded. This only narrows Opus's role and widens nothing.
- **(d) The amendment note has no `**Reviewed head:**` lines.** The round-5 note has none either. #615 touches no path on the security-review list, so no CI gate fails. Still, the workflow says a committed security note carries `**Reviewed head:** <40-char SHA>`. Add the lines to the note header, outside the report bytes, when this round is recorded.

**Threat model of the delta:**
- **Authority:** The Scope sentence is written as a direct owner confirmation and names the session it was given in. I cannot see the chat, so I am relying on the record. The sentence extends Sonnet's ordinary-review eligibility to #615 only. It does not change:
  - the security-review models;
  - merge authority;
  - who may be phase finalizer, final auditor or conductor;
  - reviewer counts or independence.
- **Earlier reviews:** They stay valid for what they covered. The policy still says a review never approves later changes.
- **Labels:** I found no mislabelling in the note. Each report's marker and heading match its transcript's model.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
