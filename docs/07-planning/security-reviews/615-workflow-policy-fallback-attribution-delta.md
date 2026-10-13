# 615 — fallback attribution: independent delta reviews of 33cbf71e (Claude Sonnet 5.5 ×2, Claude Opus 5.5)

**Reviewed head:** `33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73`

- **Reviewer contexts:** the same three fresh Agent-tool contexts that reviewed the earlier #615 deltas, each re-dispatched for this delta with the exact new candidate; none authored, directed or remediated the change. Each report's model is the one its transcript records for every turn of this round.
- **Transport:** each report is the reviewer's final message for this delta, extracted mechanically from its subagent transcript and inserted unmodified between the markers, with its SHA-256. A hash identifies bytes; it does not prove independence or approval.

<!-- BEGIN REPORT 1 (agent a9fe5e0df4cb824df; model claude-sonnet-5-5; role ordinary review A, delta; candidate 33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73; sha256 408a3f801512e3b2401c25bfb90d9da3d324edb9f1409c9ae6cc9c27ba2599ad) -->

# Independent ordinary review A — #615 delta 5407c334..33cbf71e
- **Exact candidate reviewed:** 33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73
- **Comparison base:** 5407c334a21ec3ebdc6ecbf0e5b97ebd3f122cf4
- **Reviewer / model / context:** Claude Sonnet 5.5 (claude-sonnet-5-5), fresh Agent-tool context, did not author or remediate
- **Files / surfaces checked:**
  - Commits 359f4e41 and 33cbf71e: `docs/07-planning/decision-log.md` (top entry) and `docs/07-planning/security-reviews/615-workflow-policy-fallback-confirmation-delta.md`.
  - The parent session transcript `412b91f1-99f8-4ac2-8f5c-a03dce507862.jsonl`, for the quote.
- **Checks actually run:**
  - `git log`, `git diff --stat` and `git diff` for the delta.
  - `git diff --stat 5407c334 359f4e41`: one file added, so that commit is record-only.
  - Parsed the parent transcript and took the latest genuine user message, timestamped 2026-10-09T17:12:45Z.
  - Extracted the quoted text from the decision log, joined its line wrap with a single space, and compared it to the transcript string in Python. The comparison returned an exact match, including the curly apostrophe in "they’re" and the trailing "yes. please.".
  - Extracted each REPORT block from the new note and recomputed its SHA-256. Reports 1, 2 and 3 match their markers (`658947d2…`, `c7f04571…`, `ed8bddfb…`), and each has verdict CLEAR WITH NON-BLOCKING.
  - Compared REPORT 1 with the text I returned last round. It is identical, labelled `claude-sonnet-5-5`, which is the model I ran on.
  - Ran no tests or CI.

## Disposition of my earlier items (5407c334 round)
1. **Quote exactness: CLOSED.** The log now quotes the transcript byte for byte, apart from the source's line break.
2. **Scope of the "owner decision" claim: CLOSED.**
   - The text now says Thomas confirmed two cases directly: Opus may do Sonnet/Haiku work when they are unavailable, and Sonnet or Haiku never does security review. Those two are labelled owner decisions.
   - The general form is labelled "the policy maintainer's extension … Thomas may reverse it".
   - The general form is any Sol-tier model (including GPT-6 / GPT-6.1 Sol) filling a Luna-tier role, and no Luna-tier model filling any Sol-tier role.
   - The fallback is moved out of the "reading" paragraph, which removes the mixed signal Report 3 noted.

## Findings
**Blocking:** None

**Non-blocking:**
1. **Attribution matches Thomas's words and no more.**
   - "Two cases" is accurate to the quote.
   - Only one stretch could read slightly wide: "Sonnet or Haiku never does security review" is confirmed, while the log's phrase "no Luna-tier model fills any Sol-tier role" is the maintainer's extension and is labelled as such.
2. **Wording nit in the Supersedes paragraph.** It chains several "; and, in …" clauses, which reads clumsily. It is accurate and cosmetic.
3. **Policy documents restate the general fallback without the label.** The workflow table sentence and `active-mission.md` state the upward-only rule as policy. The "maintainer's extension" label lives only in the decision log. This was acceptable before and is unchanged; a pointer to the entry would help.
4. **Pending.** Ledger rows for this round's review are not yet in §11, and the `ci-cd.md`, PR template and `CODEOWNERS` text that still names GPT-6 Sol is still deferred to #616. Both were already known.

**Answers to the check questions**
- **Quote byte-for-byte:** exact (check described above).
- **Record-only commit:** 359f4e41 adds only the one note, with markers whose hashes match.
- **Attribution:** claims what Thomas said and no more (item 1).
- **Weakening:** the delta changes only decision-log wording. Counts, independence, label rules, the tier rule and the security-review block are untouched.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (agent a9d11e58300c3ea4b; model claude-sonnet-5-5; role ordinary review B (scenarios), delta; candidate 33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73; sha256 02dec5fd3560b840a5490ba53fa5af840eb19e8b111fe6c2a357c1b5f6a19144) -->

# Independent ordinary review B — #615 delta 5407c334..33cbf71e
- **Exact candidate reviewed:** 33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73
- **Comparison base:** 5407c334a21ec3ebdc6ecbf0e5b97ebd3f122cf4
- **Reviewer / model / context:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh Agent-tool context, did not author or remediate. This is the sixth review round by this context on the same PR.
- **Files / surfaces checked:**
  - Commit `359f4e41` (record-only) and commit `33cbf71e` (`decision-log.md` only).
  - The new decision-log "Fallback upward only" paragraph and the "Applied to the other roles" list.
  - The new note `docs/07-planning/security-reviews/615-workflow-policy-fallback-confirmation-delta.md`.
  - Unchanged context: `agent-workflow.md` § Model policy and `active-mission.md`, where the general fallback sentence sits.
- **Checks actually run:**
  - Confirmed `5407c334` is an ancestor of `33cbf71e`, and that the range is exactly the two commits (`359f4e41`, then `33cbf71e`).
  - Confirmed `359f4e41` changes one file only: it adds the new note (167 lines, 0 deletions, mode 100644, status A), and touches nothing else.
  - Extracted all three embedded REPORT blocks from the note and recomputed each SHA-256 over the stripped body. All three match their marker headers (REPORT 2 starts `c7f04571…`).
  - Compared REPORT 2 with what I returned for `5407c334`: identical and labelled `claude-sonnet-5-5`.
  - Printed the full `359f4e41..33cbf71e` diff, which touches only `decision-log.md` (+8/−5), and read the resulting entry.
  - Ran no tests, since the delta is docs only.

## Scenario results
- **(h) PASS.**
  - The decision log now separates the two cases from the extension. The "Fallback upward only" paragraph quotes Thomas exactly: "Opus may do Sonnet/Haiku work when they’re unavailable, but Sonnet or Haiku never does security review. yes. please."
  - The quote now keeps the curly apostrophe and the trailing "please.", which matches the session transcript I read last round.
  - It names those two cases as owner decisions.
  - It labels the general form as "the policy maintainer's extension of them through the tier mapping above; Thomas may reverse it". That form is: any Sol-tier model, including GPT-6 and GPT-6.1 Sol, may fill a Luna-tier role when no Luna-tier model is available, and no Luna-tier model fills any Sol-tier role.
  - Result for the scenario: when the whole Luna tier is out of quota, Opus may do ordinary review (confirmed case 1). Haiku and Sonnet never do security review (confirmed case 2). The "one context, one role" rule still stops an Opus ordinary reviewer from also being the security reviewer on that change.
  - The workflow table sentence and `active-mission.md` state the general rule without marking it as an extension. The entry in the decision log, the higher authority, does mark it.
- **Nothing else changed.**
  - `359f4e41` only adds the review note.
  - `33cbf71e` touches only `decision-log.md`: it moves the fallback bullet out of "Applied to the other roles" into its own paragraph and rewrites it.
  - The Supersedes and Transition paragraphs, the block, the table and audit §13 are unchanged.

## Findings
**Blocking:** None

**Non-blocking:**
1. **My earlier items 1 and 2: CLOSED.**
   - The exact quote is now preserved.
   - The two confirmed cases are separated from the maintainer's extension.
2. **Still pending, as before.**
   - The §11 ledger rows for the review round on `33cbf71e`.
   - The Review roles "final audit" independence sentence.
   - Stale GPT-6 Sol text in `ci-cd.md`, the PR template and `CODEOWNERS`, which is deferred to #616.

## Verdict
CLEAR

<!-- END REPORT 2 -->

<!-- BEGIN REPORT 3 (agent a2d042e8432eb6e84; model claude-opus-5-5; role security/authority review, delta; candidate 33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73; sha256 39edeef9dedbe4ba2662d3423891e52c3df3f882ac55c9744188bd8b36073829) -->

# Independent security/authority review: #615 delta 5407c334..33cbf71e
- **Exact candidate reviewed:** 33cbf71e48bcf9c62c3e1a90eca5749ff6b71f73
- **Comparison base:** 5407c334a21ec3ebdc6ecbf0e5b97ebd3f122cf4
- **Reviewer / model / context:** Claude Opus 5.5 (`claude-opus-5-5`). This is the same fresh Agent-tool context (agent `a2d042e8432eb6e84`, not forked) that reviewed the earlier #615 rounds. Role: security reviewer. I did not author, direct or remediate this change.
- **Files / surfaces examined:**
  - `docs/07-planning/decision-log.md`, top entry: the new "Fallback upward only" paragraph, plus the "Applied to the other roles" paragraph it was moved out of.
  - `docs/07-planning/security-reviews/615-workflow-policy-fallback-confirmation-delta.md`.
  - The `policy:security-review-models` block in `docs/04-engineering/agent-workflow.md`.
  - The parent session transcript `412b91f1-99f8-4ac2-8f5c-a03dce507862.jsonl`, line 3393.
  - The three reviewer transcripts.
- **Checks actually run:**
  - **Commit structure.** I ran `git log` with parents, `git diff --name-status 5407c334 359f4e41`, `git show --name-status 33cbf71e` and `git diff --stat 5407c334 33cbf71e`.
    - 359f4e41 has parent 5407c334. Its only change adds `security-reviews/615-workflow-policy-fallback-confirmation-delta.md`, so it is record-only.
    - 33cbf71e changes only `decision-log.md`: 13 lines, 5 removed.
  - **Security-review block.** The extracted block has sha256 `317f48e5…` at both 5407c334 and 33cbf71e. It is byte-unchanged.
  - **The quote.** I took the quoted text from the decision log, collapsed only the markdown line break inside it, and compared it to the transcript message. That message is at line 3393, timestamp `2026-10-09T17:12:45.420Z`, with `turnOrigin: "human"`. The two are byte-equal, curly apostrophe and the trailing "please." included.
  - **Fallback-confirmation note.** It declares `**Reviewed head:** 5407c334…`. For each report I took the body between the markers and found a byte-equal final message in that reviewer's own transcript. Each hash equals its marker:
    - REPORT 1 (`a9fe5e0d`): `claude-sonnet-5-5`, `658947d2…`.
    - REPORT 2 (`a9d11e58`): `claude-sonnet-5-5`, `c7f04571…`.
    - REPORT 3 (`a2d042e8`, mine): `claude-opus-5-5`, `ed8bddfb83dc8934…`. This is byte-identical to the report I returned.

## Findings
**Blocking:** None

**Non-blocking:**
1. **The workflow and mission files state the general rule without its qualifier.**
   - `agent-workflow.md` and `active-mission.md` still state the general tier form as plain policy: a Sol-tier model fills a Luna-tier role when no Luna-tier model is available, and never the reverse.
   - The decision log now labels that general form as the maintainer's extension, which Thomas may reverse.
   - Both files cite that entry, and the only reach beyond Thomas's literal words is upward (GPT-6 / GPT-6.1 Sol doing Luna-tier work), so the risk is negligible.
   - If the extension label should travel with the rule, add a short "(maintainer's extension; see decision log)" in those two files.

My earlier items 1–3 are resolved:
- **Item 1.** The quote is now byte-exact.
- **Item 2.** The paragraph separates the two owner-confirmed cases from the maintainer's extension:
  - Owner-confirmed: Opus may do Sonnet/Haiku work when they are unavailable, and Sonnet or Haiku never does security review.
  - Extension: any Sol-tier model may fill a Luna-tier role, including GPT Sol's upward reach, and no Luna-tier model fills any Sol-tier role.
  - The extension is explicitly reversible by Thomas.
- **Item 3.** The fallback is out of the "reading" paragraph, so that heading no longer contradicts it.

No authority is claimed beyond Thomas's words. Owner authority is claimed only for the two cases he typed, and everything broader is labelled as the maintainer's and reversible. The restrictive half of the extension is stricter than his words, not looser. The block, reviewer counts, independence, the transition and the labelling rules are untouched.

## Verdict
CLEAR WITH NON-BLOCKING

<!-- END REPORT 3 -->
