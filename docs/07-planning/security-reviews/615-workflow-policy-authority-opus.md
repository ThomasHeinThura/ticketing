# 615 — workflow policy restructure: independent authority/safeguard reviews (Opus 5.5)

- **Reviewer context:** one fresh Claude Code Agent-tool subagent (`subagent_type: general-purpose`, not forked, model inherited: `claude-opus-5-5`). It did not author or remediate the change. It is not a GPT-6 Luna or GPT-6 Sol review of record and satisfies neither.
- **Spawn:** Agent ID `a731c07f89434fd9f`, parent Claude Code session `412b91f1-99f8-4ac2-8f5c-a03dce507862`. A later request asking this context to write its own reports to a file was stopped before completing by a platform safeguard; its attempted write did not run and no report was produced.
- **Transport:** each report below is the reviewer's final message for that review round, extracted mechanically from the subagent transcript and inserted unmodified between the markers. SHA-256 of report 1: `8377288f770eace73092250ac709b708f9ac5ff8fa666c471a4190e22ed6155b`; report 2: `e9bce0701545b99359728b28742f6fe2dd54ed4c854f71f85470f94894765337`.
- **Correction:** commit `7955d7df` carried a reformatted transcription of report 1 that was labelled verbatim. The delta review (report 2) flagged it, and this file replaces it.

<!-- BEGIN REPORT 1 (candidate c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12) -->

# Independent security/authority review
- **Exact candidate reviewed:** c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12 (I checked this with `git rev-parse HEAD` in the worktree)
- **Comparison base:** 78586b4425f92576027fddb8d238fe7c44da4edf (head of #612)
- **Reviewer / model / context:** a fresh Claude Opus 5.5 subagent context, started with the Agent tool and not forked. I did not author or remediate this change. This is NOT the repository's required GPT-6 Sol security review and does not satisfy it.
- **Files / surfaces examined:**
  - Read in full at the candidate: AGENTS.md, CLAUDE.md, agent-workflow.md, definition-of-done.md, error-fix-loop.md, active-mission.md, workflow-policy-audit-2026-10-09.md and the new top entry of decision-log.md.
  - The sdlc.md diff. The base AGENTS.md and base agent-workflow.md in full.
  - scripts/ci/lib/security-review-note.mjs and scripts/ci/check-pr-template.mjs in full, plus .github/pull_request_template.md.
  - ci-cd.md (the security-path list and the note-binding text), the retry/flake wording in ux-quality-gates.md and testing-strategy.md, and the ci-fast/ci-full triggers.
  - Every non-Markdown file that mentions `docs/07-planning/security-reviews/`.
- **Checks actually run:**
  - Parsed the security-path list with `parseSecurityReviewPaths` and matched it against every changed file. Only `ci-cd.md` matches, and it is unchanged, so CI will not require a security review on this PR.
  - Built a scratch git repo with: reviewed commit → unreviewed code commit → revert → note commit. `git diff --name-only R..HEAD` lists only the note. `git log --format= --name-only R..HEAD` also lists `src/a.ts`.
  - `check-reviews`, `check-vocabulary` and `check-inventory` exit 0 on the candidate. `check-skips`, `check-events` and `check-env` could not run because the worktree has no `node_modules`, so the audit doc's claim that they exit 0 is unverified here.
  - Findings were written as I went to `$TMPDIR/review-authority.md`.

## Findings

**Blocking:**

1. **"Review records" covers every file under `security-reviews/**`, including historical security decisions that product code cites as its authority.** This lets them be edited with no review at all.
   - **Where:** `docs/04-engineering/agent-workflow.md:192-193`: "**Review records** are `docs/07-planning/security-reviews/**` and the PR body. A commit that touches only review records needs **no new review of any kind** — not ordinary, not security." The same idea is carried into Merge-ready at `definition-of-done.md:16`.
   - **What the base required:** `definition-of-done.md:138-141` at base: "ordinary exact-candidate review is still required."
   - **Why it matters:** the CI note rule only proves that this PR's own Sol note is current. It does not limit which notes a commit may touch. Under the base rule, an ordinary reviewer at the final head still saw any edit to a note. Under the new rule, nobody does.
   - **What is exposed:** these notes are the recorded rationale behind live security decisions:
     - `440-runtime-authorization-wiring.md` is cited as "for the decision" by `tests/permissions/inherited-uncovered.json:24`, `apps/api/src/invitation/policy.ts:62` and `invitation/index.ts:57`.
     - `13-kaneo-import-lenses/E-secrets.md` (finding E-13) is cited by `apps/api/src/instance/policy.ts:54`.
     - `route-classification-guard.ts:22` also cites a note.
   - **Exploit:** after review, a lane pushes a commit that touches only `security-reviews/`. It deletes or relabels a historical finding, or rewrites another PR's decision record. The conductor's path check passes and no reviewer of any tier sees it. This also cuts against do-not 15 ("erase/relabel a historical finding") and the base CLAUDE.md rule "Do not rewrite … old security-review notes".
   - **Fix:** define a review record as *adding* this PR's own note(s) (`<this-pr>-*.md`, Markdown only), plus the reviewer-identity and review-link fields of the PR body. Any modification or deletion of an existing note, any other PR's note, or any non-`.md` file under that directory is a reviewed change. Check it with `--name-status` and allow only `A`, or `M` of this PR's own note.

2. **The conductor's "mechanical path check" uses the net-tree comparison that CI explicitly rejects as a bypass, while claiming to be the same rule.**
   - **Where:** `agent-workflow.md:194-196`: "The conductor verifies the path list mechanically (`git diff --name-only <reviewed>..<candidate>`) … This is the same rule CI enforces for security notes".
   - **What CI actually does:** `security-review-note.mjs` rule 3 (GPT-F5) judges *landed commits*, not the net tree. It states that "reverting does not restore a clearance". It also checks that the reviewed head is an ancestor of the branch. The line `agent-workflow.md:181` ("every commit landed in between") contradicts the command given.
   - **Why it matters:** for ordinary-review reuse, this conductor check is the *only* control; CI does not bind ordinary reviews. In my scratch repo, a code commit followed by its revert and a note commit read as "review-record-only". With merge commits on `main`, the unreviewed intermediate commit lands in history.
   - **Fix:** require `git merge-base --is-ancestor <reviewed> <candidate>` and a per-commit listing (`git log -m --format= --name-status <reviewed>..<candidate>`) with the same allow-list as Blocking 1. Alternatively, defer to `reviewBinding()` semantics, and drop the "same rule" claim unless it is literally true.

3. **The explicit ban on fabricating review evidence was dropped, while the new reuse rule depends on notes being authentic.**
   - **What was removed:** base `AGENTS.md:292`, "Never: fabricate review evidence or mark an independent review `n/a`". It appears nowhere in the new AGENTS.md "Never" line (231-233), the 23 do-nots, or agent-workflow.md. agent-workflow.md:257 covers only "fabricate a status".
   - **Why it matters:** CI admits it "does not prove a review took place … a determined author can type a SHA into the note". The new rule removes the ordinary reviewer who used to see the final head. So a lane can push code H3, then push a note-only commit H4 declaring `**Reviewed head:** H3` with a CLEAR verdict that never happened. CI binds, the path check passes, and Merge-ready is met on paper.
   - **Fix:**
     - Restore the prohibition in AGENTS.md "Do not".
     - Add to Merge-ready: the conductor confirms each review record against a review it dispatched or can trace (reviewer session/spawn provenance and the verbatim output) before relying on it.
     - Require that a note's verdict text be added only by the reviewer's own transport.

**Non-blocking:**

1. **The PR body is treated as a review record** (`agent-workflow.md:192`). This means edits after review to `## Gates`, `## Not done`, `## Checklists` or `## Task` never invalidate a verdict. A `## Not done` gap a reviewer relied on can be silently removed. Base was silent here, since only a SHA change triggered re-review, so this is not a regression; ci-fast still re-runs on `edited`, and waived rows still need Thomas. Narrow the definition to the review-identity and review-link fields.

2. **"Review counts unchanged" is inaccurate.** `decision-log.md:32` ("every review count … Unchanged") and audit line 152 say so. But `agent-workflow.md:162` adds a new reduced tier: "Records only (status, queue, evidence) … **one** independent factual check". Base required at least two for ordinary substantive work. "Evidence" is also undefined: it should explicitly exclude security-review notes, decision-log entries, active-mission.md and machine-read docs. The decision log does list the relaxed note-only re-review separately, so the claim should be qualified.

3. **This candidate triggers its own new rule.** Row `agent-workflow.md:169` requires a "full pass" security review when a workflow change alters review requirements. This PR does: it extends evidence reuse, adds the records-only tier and creates a re-run allowance. Under the model policy that pass is GPT-6 Sol. CI will not enforce it, because no security path is touched, and audit §5 (lines 121-123) implies no security review is needed. The conductor should not merge on ordinary reviews plus this Opus review. Mark it **SECURITY RE-REVIEW PENDING — GPT-6 SOL CAPACITY** if needed.

4. **The bounded re-run** (`error-fix-loop.md:124-127`) does not create a re-run-until-green path. It allows one re-run, stops after a second failure, keeps G11 sampling unchanged (line 129-132) and leaves required checks unreused. Two gaps remain:
   - "Per candidate SHA" resets on any records-only commit, so the cap should count per job per task across SHAs unless a change addresses the cause, mirroring the three-attempt rule.
   - "Network … error" (line 116) can occur inside a test, so a flaky test could be mislabelled as infrastructure; testing-strategy.md:490 says "a flaky test is a broken test". Restrict eligibility to failures before test execution or in runner provisioning.
   - It is also self-inconsistent with line 133-134, which says changing retry counts needs its own PR and Thomas's approval. Confirm Thomas approved this specific allowance.

5. **Merge-ready (`definition-of-done.md:16`) omits the pre-merge runtime proofs** — exact-image boot and installer regression — that base `AGENTS.md:101-104` required before a protected merge. `agent-workflow.md:276-278` lists them, but the merge-ready level does not reference them. The integrated-slice checklist (149-151) orders image boot after merge, as base did. Add "applicable pre-merge runtime proofs" to Merge-ready.

6. **active-mission.md is now a level-1 authority but is an ordinary docs file,** and its owner provenance is whatever an agent writes in the decision log. Base had the same risk through the decision log. Classify edits to it under the "Agent authority" row with a full pass, and require a verifiable owner source.
   - **Policy-maintainer row (`agent-workflow.md:151`):** I found no bypass. CLAUDE.md:45-47 says a Claude session "is not the reviewer of record for a role the model policy assigns to another model". Still, state in the Model policy that the maintainer's own PRs get independent reviews and Sol wherever the tier requires it.

7. **Evidence-reuse inputs for test results (`agent-workflow.md:187`) leave out docs that checks read by machine** (configuration-reference.md, identifier registers, decision-log for waivers). This is mitigated because required status checks are never reused (line 190).

8. **The sampled-review packet author** is now "another context" rather than "GPT-6 Luna or GPT-6 Sol" (base). The Model-policy row for context preparation still names Luna, and the PR template still says Luna/Sol, so this is minor.

**Checked and kept (no finding):**
- Only the conductor merges; lanes never do.
- A waived gate needs Thomas's own action; only Thomas waives a gate or approves H1–H6.
- No production deployment and no Docker Hub (AGENTS roles, agent-workflow.md:20 and 283, active-mission.md:37-42).
- Never: direct push to `main`, routine force-push, "Require review from Code Owners", or a bypass actor (AGENTS.md:231-233).
- No downgrade of an unavailable reviewer, and the SOL CAPACITY marker (agent-workflow.md:154-155).
- The phase finalizer must be independent of whoever orchestrated or merged the stage (line 135).
- A private `*_test` database per lane (line 246) and redaction of credential-shaped test values (line 250).
- pal-mcp stays retired.
- Lower sources — queue, status, PR body, CLAUDE.md, subagents — gain no authority (AGENTS.md:58-64; do-not 22).
- No text claims acceptance, review or CI that has not happened; the audit says the policy is "proposed until it merges".

## Residual risk
- I did not verify the owner directive's actual wording; I took it as recorded.
- I did not run the remaining register checks (skips, events, env) or the audit's "10/10 invariants" script, which is not committed.
- I did not review #601 or the queue file.
- CI cannot verify note authenticity at all. Blocking 3 asks for a procedure, not a machine gate, so a residual trust in the conductor remains even after the fixes.

## Verdict
**BLOCKED.** Blockers 1–3 are each a small, local text fix. Once they are fixed, this candidate still needs the full GPT-6 Sol security pass its own row 169 requires (Non-blocking 3).

<!-- END REPORT 1 -->

<!-- BEGIN REPORT 2 (candidate ed7bb516b2f4e1b0d2c0ddb53f7e036c79419aa8) -->

# Independent security/authority review — delta
- **Exact candidate reviewed:** ed7bb516b2f4e1b0d2c0ddb53f7e036c79419aa8 (I checked this with `git rev-parse HEAD`)
- **Comparison base:** c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12. The delta is two commits: 7955d7df (transports the two Opus reports) and ed7bb516 (remediation).
- **Reviewer / model / context:** the same fresh Claude Opus 5.5 subagent context that wrote the first review (Agent tool, not forked). I did not author or remediate either commit. This is NOT the required GPT-6 Sol security review and does not satisfy it.
- **Files / surfaces examined:**
  - The full diff `c0d5ef6a..ed7bb516`.
  - The transported note `security-reviews/615-workflow-policy-authority-opus.md`, compared against the report I returned.
  - The candidate's AGENTS.md (authority section, roles, do-nots), agent-workflow.md (§ Model policy, § How many reviews, § Exact head and evidence reuse), definition-of-done.md:16, error-fix-loop.md:110-135, sdlc.md:200, the decision-log top entry and audit §5 and §8.
  - Every CI message that cites a do-not (`grep` over `scripts/ci`).
- **Checks actually run:** I built a scratch repo (git 2.54.0) and ran the three new conductor commands — `merge-base --is-ancestor`, `git log -m --format=%H --name-status`, `git log -m --format= --numstat` — against eight scenarios:

| # | Scenario | Result |
| --- | --- | --- |
| S1 | Code commit, its revert, then this PR's own note | Caught: `M src/a.ts` listed twice; numstat deletions = 1 |
| S2 | One line deleted from a historical note | Caught: `M 440-old.md`, deletions = 1 |
| S3 | Another PR's note renamed to this PR's note name | Caught by name-status `R100`; numstat alone shows `0 0`, so both commands are needed |
| S4 | `main` merged into the branch | Caught: per-parent `A src/b.ts` |
| S5 | Merge whose tree carries a change from neither parent | Caught: `M src/a.ts` |
| S6 | Lines appended to this PR's own note | Passes, as intended |
| S7 | Verdict in this PR's own note edited in place | Caught: numstat deletions = 1 |
| S8 | Historical note deleted | Caught: `D` |

  Findings were appended to `$TMPDIR/review-authority.md`.

## Status of earlier findings

| # | Status | Evidence |
| --- | --- | --- |
| B1 — review-record scope | **CLOSED** | `agent-workflow.md:198-203`: review records are only "lines **added** to this PR's own notes" plus the reviewer-identity and review-link fields of the PR body. Modifying another PR's note, or adding a non-Markdown file, is a reviewed change. Historical notes "are append-only". S2, S3 and S8 confirm the commands enforce this. |
| B2 — net-tree check | **CLOSED** | `agent-workflow.md:205-214`: the check is now over landed commits, with the ancestor check, per-parent `name-status` and `numstat`, and "mirroring" CI instead of "same rule". S1, S4 and S5 are now caught. |
| B3 — fabrication ban | **CLOSED** | `AGENTS.md:257` (do-not 7) adds "fabricate review evidence, or mark an independent review `n/a`". `agent-workflow.md:217-221` requires the conductor to trace every record to a review it dispatched or can verify; a record it cannot trace does not count. `definition-of-done.md:16` adds "each is traced to its reviewer". |
| N1 — PR body as review record | **CLOSED** | `agent-workflow.md:198-200`: only the reviewer-identity and review-link fields count. Under line 192, any other body edit is an input that invalidates a verdict. |
| N2 — "review counts unchanged" | **PARTIALLY CLOSED** | `decision-log.md:28-34` now discloses the tier changes and says "every other review count" (line 39). `agent-workflow.md:168` excludes notes, decision-log entries, the active mission and any document a check reads. But `workflow-policy-audit-2026-10-09.md:154` still says "Not changed: model assignments, review counts". |
| N3 — this PR needs a Sol pass | **CLOSED (in text)** | Audit lines 123-125 and decision-log 30-34 now say a full GPT-6 Sol pass is required before merge. That review is still outstanding as a gate. |
| N4 — bounded re-run | **CLOSED, with a residual (new Non-blocking 2)** | `error-fix-loop.md:116` limits eligibility to failures before the code under test started. Lines 124-130 count one re-run per job per task across SHAs, say a network error inside a test is a test failure, and make the allowance inactive until Thomas approves it in the decision log. G11 (131-134) is unchanged. There is no re-run-until-green path. |
| N5 — pre-merge runtime proofs | **CLOSED** | `definition-of-done.md:16` now requires pre-merge runtime proofs and no unresolved blocking finding. |
| N6 — active mission / policy maintainer | **CLOSED** | `agent-workflow.md:175`: any active-mission edit needs a traceable decision by Thomas, under the agent-authority row with a full pass. Line 156: the policy maintainer is "authoring only", and its PRs still get the reviews and Sol pass their tier requires. |
| N7 — test-result inputs | **CLOSED** | `agent-workflow.md:193` adds "any document a check reads". |
| N8 — packet author | **CLOSED** | `agent-workflow.md:155` and 245-246: the packet is prepared by a GPT-6 Luna or GPT-6 Sol context, never the auditor itself. |

**Do-not 7 and CI:** `check-pr-template.mjs:296-298` says "an agent may not approve its own work (AGENTS.md do-not 7)". Do-not 7 still starts with that clause, so the citation still holds. The other cited numbers (5, 11, 15, 18, rule 2) are unchanged. The audit (§5, F3) already discloses that do-not 15's wording now differs from `check-reviews.mjs`.

## Findings

**Blocking:**

1. **The transported copy of my report is not byte-faithful, but the note and the audit both call it "verbatim".**
   - **Where:** `security-reviews/615-workflow-policy-authority-opus.md:3` ("Transported verbatim") and `workflow-policy-audit-2026-10-09.md:162` ("committed verbatim").
   - **What differs:** compared with the report as I returned it, the wording and structure change throughout, though no finding, classification or verdict changes. Line 10 reads "(verified via `git rev-parse HEAD`…)" where mine read "(I checked this with `git rev-parse HEAD` in the worktree)". The reviewer line and the files/checks lines are reworded and collapsed into paragraphs. Blocking 1–3 and Non-blocking 4 are flattened from labelled sub-bullets into single paragraphs.
   - **Why it blocks:** this PR's own rule (`agent-workflow.md:217-219`) says reports are "committed verbatim with their provenance (session or spawn arguments, model, exact SHA)". The trace-to-reviewer control that closes B3 depends on exactly that. The note also has no session or spawn provenance line. A record that misstates its own transport is the precise failure this delta is meant to prevent.
   - **Caveat:** if the coordinator received this exact wording from the harness, the change happened in transport upstream of the coordinator, not by the committer.
   - **Fix:** either commit the raw tool result byte-for-byte with its spawn provenance, or relabel the note "reformatted for transport; findings and verdict unchanged" and drop the "verbatim" claim in both places.
   - **Scope:** this is a fix to the review record, not to the policy text. Under the new rule, a correction like this is itself a reviewed change unless it only adds lines.

**Non-blocking:**

1. **The audit still claims review counts are unchanged.** `workflow-policy-audit-2026-10-09.md:154` says "Not changed: … review counts", which contradicts its own §8 and decision-log:28. Qualify it.
2. **A new commit can stand in for a re-run.** The cap at `error-fix-loop.md:124-130` covers "re-run of a failed job". A new commit pushed to get a fresh CI run on a new SHA is not literally a re-run, so a no-op or records commit is an unstated way around both the cap and the "inactive until Thomas approves" rule. Line 48-50 bans editing *product* code to trigger a run, but not other commits. Add: "a commit made to obtain another CI run counts as a re-run".
3. **Chat instructions from Thomas** (`AGENTS.md:45-46`: "takes effect when given, including in chat"). This is not a regression, since base AGENTS.md said "current explicit instructions take effect now". It is still worth stating that only a session that received the instruction directly from Thomas may act on it before the decision-log entry exists. A claim relayed by another agent or a subagent is not an owner instruction.
4. **Decision-log ownership is ambiguous.** The roles table (`AGENTS.md:80`) gives the conductor ownership of "decision-log entries". But the lane May-not list (81) does not include the decision log, and lanes are still told to write entries (`sdlc.md:200` "Add a decision log entry…", `definition-of-done.md:31` for dependencies). The waiver binding (`gate-waiver.mjs`) also reads entries from the PR branch. Say whether lanes append entries in their own PR or hand them to the conductor.
5. **The two verification commands only work together.** S3 shows a rename reads as `0 0` in numstat; only `name-status` (`R100`) reveals it. `agent-workflow.md:209-214` requires both, which is correct. A one-line note that both must pass, and that renames and mode changes count as touching, would stop a future shortcut to numstat alone.

## Residual risk
- CI still enforces only the Sol note's currency. Append-only historical notes, the extra conductor checks and the trace-to-reviewer step are procedure, not machine gates. Turning them into a CI check (F5) would close that.
- I did not verify the owner directive's text or the consistency reviewer's transported report, and I did not re-run the register checks.
- The required GPT-6 Luna ordinary reviews and the GPT-6 Sol full pass (required by `agent-workflow.md:175` for this PR) have not happened.

## Verdict
**BLOCKED — on the review record only.** All three original blockers are CLOSED, and the policy text is CLEAR WITH NON-BLOCKING. The one remaining blocker is the "verbatim" claim on the transported note (Blocking 1 above). Once that is fixed, the candidate still needs its required Luna reviews and the GPT-6 Sol pass before merge.

<!-- END REPORT 2 -->
