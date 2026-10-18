# Independent factual review record — Carrier source ledger correction

**Reviewed head:** `0010a917b65c66b4b9be7725b18615c67b26121c`
**Base:** `8d41d07e507230f30a61f36bb9ba8dc6fb28e18b`
**Tree:** `cab1a9b662f24d8e3ba322d0ed1b799cc0031ab5`
**Scope:** the dated factual checkpoint prefixes in `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`; records-only, with no product, authority, security-control, or gate-semantics change.
**Review tier:** two fresh, independent ordinary GPT-6 Luna factual contexts. This plain Markdown status/queue change does not touch a security-review surface or alter policy; no Sol security review is triggered. Configured-model provenance is included below; served weights are not attested.

## Conclusion and source conservation

Both current reviewers returned CLEAR/PASS for the exact source above. The source commit corrects the two record sentences that mislabeled the v17 contrast source-gate failure as a token-discipline failure. The current checkpoint accurately states that the contrast source gate failed on 938 unresolved occurrences while token discipline passed. The two prior factual reports, including the initial blocker and initial approval at the preceding source, are preserved without rewriting their historical verdicts; the current exact-head reports are included separately.

The source commit is the second commit in the branch history: `60e5b8136a9a3a55e9ed039847e62706800c47f6` followed by `0010a917b65c66b4b9be7725b18615c67b26121c`, based on accepted main `8d41d07e507230f30a61f36bb9ba8dc6fb28e18b`. The cumulative source changes only the two dated prefixes in status and integration queue (12 lines added to each); the current candidate corrects one sentence in each prefix. The reviews confirmed the prior accepted bytes remain exact suffixes. Root independently verified the full source/base identifiers; the shorter identifiers present in two authentic historical report bodies remain unchanged in those reports.

The checkpoint is a 10:14 UTC historical snapshot. It preserves the adverse and incomplete Carrier evidence and does not treat later private Carrier work as acceptance of the reviewed source. It claims no product acceptance, whole #580 completion, release/SIT, backup/restore, final audit, stage closure, waiver, UAT, production, or functioning after-turn scheduler. Publication would add only this review note; it must preserve every source tree entry and all existing notes.

## Native reviewer-session provenance

The following JSON is included byte-for-byte from the root-verified provenance file. It identifies configured model/context metadata and exact report hashes; it does not attest served weights.

````json
{
  "source": "0010a917b65c66b4b9be7725b18615c67b26121c",
  "priorSource": "60e5b8136a9a3a55e9ed039847e62706800c47f6",
  "base": "8d41d07e507230f30a61f36bb9ba8dc6fb28e18b",
  "authorSession": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
  "reviewers": [
    {
      "task": "records60e5_ordinary_a_luna",
      "session": "01a14e82-2490-7c71-81d2-c57d92357687",
      "sessionCreatedAt": "2026-10-18T10:15:14.348Z",
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high",
      "requestedSpawn": {
        "fork_turns": "none",
        "model": "gpt-6-luna",
        "reasoning_effort": "high"
      },
      "servedWeightsNotAttested": true,
      "reports": [
        {
          "path": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/records60e5-ordinary-a-luna/report.md",
          "bytes": 4219,
          "sha256": "bbeee25342f3650cb6a9eb94f48cfc973b7762fd7595bd77865010bc6e42610b"
        },
        {
          "path": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/records60e5-ordinary-a-luna/report-0010.md",
          "bytes": 2629,
          "sha256": "6fb72f734c611ff0a5139edf93ef30adf4563102afb0b49522834f3863fdb8a2"
        }
      ]
    },
    {
      "task": "records60e5_ordinary_b_luna",
      "session": "01a14e82-4fe3-7fd1-883a-470fdf78b2c3",
      "sessionCreatedAt": "2026-10-18T10:15:25.439Z",
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high",
      "requestedSpawn": {
        "fork_turns": "none",
        "model": "gpt-6-luna",
        "reasoning_effort": "high"
      },
      "servedWeightsNotAttested": true,
      "reports": [
        {
          "path": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/records60e5-ordinary-b-luna/report.md",
          "bytes": 4203,
          "sha256": "7feec57e743f0fde4dd9c3a0935c53f0a2ce75293d00c4770ec1cd0e163b2bc6"
        },
        {
          "path": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/records60e5-ordinary-b-luna/report-0010.md",
          "bytes": 3999,
          "sha256": "1f25f1d11d77e10eec11f3b6a718a7f4cedf88f784bcd52d0b875dae9b6b494b"
        }
      ]
    }
  ]
}
````

## Authentic independent reports (verbatim)

The two initial reports apply to the preceding source `60e5b8136a9a3a55e9ed039847e62706800c47f6`; their original verdicts and scope remain historical. The two corrected reports apply to the exact reviewed source `0010a917b65c66b4b9be7725b18615c67b26121c`.

### Ordinary reviewer A — initial blocker at 60e5

````text
# Ordinary factual review A — records-only

- **Candidate:** `60e5b8136a9a3a55e9ed039847e62706800c47f`
- **Comparison base:** accepted main `8d41d07e507230f30a61f36bb9ba8dc6fb28e18`
- **Model/context:** GPT-6 Luna review context, fresh and independent of the author/fixer; this reviewer did not author, direct, or remediate the record change.
- **Scope:** first 12 lines added to `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`; read-only factual review. No product/security approval.
- **Verdict:** **BLOCKED — correct one material gate-label error before treating this factual review as clear.**

## Blocking finding

Both new records mislabel the v17 failure as a *token gate* failure:

- `status.md`: “The canonical v17 token gate also failed on938 unresolved source occurrences…”
- `integration-execution-queue.md`: “canonical token-gate failures remain adverse history.”

The pinned `canonical-g3-v17_0-run/root-verified-g3-baseline.json` says `tokenDisciplinePassed: true`, `contrastSourceGatePassed: false`, and `unresolvedOccurrenceCount: 938`. Its stated limit says source violations stopped the gate before CSS build; there was no browser/computed-style/image pass. The adverse result is real, but the failing check was the contrast source gate, not token discipline. Suggested correction: say “canonical v17 contrast source gate failed on 938 unresolved source occurrences” in status and “canonical v17 source-gate failure” in the queue.

## Checks performed

- Read accepted `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and `docs/07-planning/active-mission.md`. The mission is integration freeze followed by release/SIT consolidation; queue and status are evidence, not authority.
- Confirmed the candidate is checked out at the requested SHA and diffed only the requested two file prefixes. Each diff adds 12 lines. Byte comparison against base confirms each file's entire prior suffix is unchanged: status base 1,458,419 bytes and candidate 1,461,254; queue base 287,775 and candidate 289,854.
- Checked v5 native receipt and root baseline. Receipt reports native exit 0, 326.881 seconds, 1,334 source-tree entries, source/status/fixture conservation, raw JSONL SHA-256 `d9d8bf40d692db2d9ac43b115779bb9f4c7bd51b8702804655055a5d2fe9ebed`, 985 occurrences, 938 unresolved, 11,089 requirements, projection held with seven unknown fields and zero projection problems. Baseline confirms 10,389 open / 700 complete. ProjectLayout is 17 occurrences / 498 requirements with unresolved nested wrapper insertion.
- Checked pinned v23 and v24 receipts. v23 is a selected two-test pass (2/2; 99 not selected), not a whole-suite run. v24 is a selected eight-test run with 6 pass / 2 fail, 93 not selected, zero skip/cancel, native exit 1; source and fixture conservation is true. Raw output names the two failures as the shadowed context-menu/trigger override case and connected callback/popup receiver case. Both remain supported positives, consistent with the record. Receipt pins checker `a8ba4b1d…` and test `a307c6cf…` at committed product HEAD `31fc00b9…`.
- Checked the earlier full99 v15 baseline: 92 pass / 7 fail / 0 skip or cancel, native exit 1, full selection. The adverse run is accurately preserved.
- Read live GitHub metadata: #847 is merged at the accepted base SHA and timestamp recorded in the new checkpoint (08:31:28Z); #810 and #811 remain open at heads `3f5e8dab…` and `73ce0912…`, respectively. The records are a dated 10:14 UTC snapshot; no claim is made here that moving Carrier source after that timestamp is the same state.

## Non-blocking observations

The diagnostic-only framing, source/tree conservation, unresolved ProjectLayout boundary, selected-versus-full-suite distinctions, adverse v15/v24 outcomes, and no-acceptance/no-waiver boundaries match the inspected receipts. The #810 performance value and #811/#773 owner-decision counts were not re-derived from independent source receipts in this bounded review; I verified only the requested live PR heads for those items.

This review covers factual records only. It is not product acceptance, a security review, or a permission to merge.
````

### Ordinary reviewer B — initial approval at 60e5

````text
# Independent factual review — records candidate 60e5b8136a9a3a55e9ed039847e62706800c47f6

- **Role:** Ordinary factual review B (records-only).
- **Model:** GPT-6, as exposed to this reviewer; exact served variant/build was not exposed in this context. The task name designated the Luna lane, but I do not claim a more specific model label than the platform exposed.
- **Context:** `/root/records60e5_ordinary_b_luna`, fresh child review context.
- **Independence:** I did not author, direct, or remediate this candidate. I reviewed its facts independently from the candidate author.
- **Candidate/base:** `60e5b8136a9a3a55e9ed039847e62706800c47f6` against `8d41d07e507230f30a61f36bb9ba8dc6fb28e18`.
- **Verdict:** **APPROVE — factual review.** No blocking or non-blocking factual findings.

## Scope actually checked

Inspected the exact two-file diff in `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`; read the accepted `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, and `docs/07-planning/active-mission.md`; checked the new checkpoint against supplied private evidence, native receipts/logs, and live GitHub facts for #847, #810, and #811. I did not edit repository files or run product tests, compilers, browser checks, or Docker.

## Evidence and findings

The candidate adds twelve lines to the top of each target file. Direct blob comparison confirmed that, for each file, the complete prior accepted blob is byte-for-byte the suffix of the candidate blob. The two existing records are preserved without edits.

- The private v5 production diagnostic receipt reports native exit 0, 326.881 seconds, 358 collector paths, 43 tokens, 1,334 source-tree entries, 985 union occurrences, 938 unresolved occurrences, and 11,089 frozen requirements (10,389 open / 700 complete). It records projection held, seven unknown fields, zero projection problems, diagnostic-only, complete capture, and conserved source pins/status. The retained JSONL is 60,636,687 bytes; independently computed SHA-256 is `d9d8bf40d692db2d9ac43b115779bb9f4c7bd51b8702804655055a5d2fe9ebed`, matching the receipt. The baseline records ProjectLayout at 17 occurrences / 498 requirements with unresolved nested-wrapper insertion.
- The historical v15 native log confirms 99 tests: 92 pass, 7 fail, 0 cancelled/skipped. The v17 `pnpm check:tokens` receipt exits 1; its retained output includes the unresolved-occurrence diagnostics. The v19 receipt confirms a selected 7-test pass, not a full-suite pass. The new status text preserves these distinctions and the adverse outcomes.
- The v23 native receipt records the exact committed source HEAD `31fc00b9bf30e563711e080bba71c9495606b333`, checker/test pins `a8ba4b1d…` / `a307c6cf…`, 2/2 pass, 99 not selected, and `sourceAndFixtureConserved: true`. The v24 receipt on the same source HEAD records 8 selected, 6 pass / 2 fail, 93 not selected, 0 skipped/cancelled, native exit 1, and source/fixture conservation. Its two failures are the context-menu shadow/override rejection case and connected callback-return transfer case; these match the checkpoint's open positives and stated boundary.
- Live `gh pr view 847` confirms PR #847 is merged to main at `2026-10-18T08:31:28Z`, merge commit `8d41d07e507230f30a61f36bb9ba8dc6fb28e18b`. Live #810 and #811 remain open. Their current PR bodies preserve the 223.2ms versus strict 200ms result and pending hosted proof boundaries represented in the checkpoint.

The checkpoint does not claim Carrier acceptance, full101, G3, browser/image, accepted-main composition, a final review panel, hosted acceptance, whole580, mission/stage closure, UAT, production, a waiver, or a functioning continuation. Its next actions and historical boundaries are consistent with the accepted mission and review workflow. No implied gate waiver or completion claim found.

## Commands and reads performed

Read-only Git diff/blob comparison, private receipt/log inspection, JSONL `sha256sum`, and live `gh pr view` / `gh issue view` for #847/#810/#811. No product verification was run by this reviewer; reported run outcomes above are the original receipt-backed evidence, not executions by this context.
````

### Ordinary reviewer A — corrected exact-head review at 0010

````text
# Ordinary factual review A — corrected records-only candidate

- **Exact candidate SHA:** `0010a917b65c66b4b9be7725b18615c67b26121c`
- **Exact comparison base:** accepted main `8d41d07e507230f30a61f36bb9ba8dc6fb28e18b`
- **Prior candidate reviewed:** `60e5b8136a9a3a55e9ed039847e62706800c47f6`
- **Model/context:** Assigned GPT-6 Luna review context; the conductor will verify native configured-model provenance separately. No served-weights attestation is made. This reviewer did not author, direct, or remediate the corrected record.
- **Scope:** Cumulative first 12 lines of `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`, plus the exact two-line delta from the prior candidate. Read-only factual review; no product or security approval.
- **Verdict:** **CLEAR for the bounded factual correction at this exact SHA.**

## Exact delta and evidence

The only candidate-to-prior changes are the two intended sentence corrections. Status now says the canonical v17 **contrast source gate failed** on 938 unresolved source occurrences and **token discipline passed**. The queue now says the canonical **contrast source-gate failures** remain adverse history and **token discipline passed**.

I re-read the pinned `canonical-g3-v17_0-run/root-verified-g3-baseline.json`: `tokenDisciplinePassed` is `true`, `contrastSourceGatePassed` is `false`, and `unresolvedOccurrenceCount` is 938. The same receipt states that source violations stopped the gate before CSS build and that no browser/computed-style/image pass occurred. The corrected statements now describe that evidence accurately.

## Cumulative prefix and preservation checks

- Compared both complete 12-line prefixes at candidate SHA `0010a917b65c66b4b9be7725b18615c67b26121c` with accepted main `8d41d07e507230f30a61f36bb9ba8dc6fb28e18b`. Each file differs only in its one corrected line versus the prior reviewed prefix.
- Confirmed each candidate file's suffix after the 12-line new prefix is byte-identical to the accepted-main file. Status prefix: 2,865 bytes; queue prefix: 2,114 bytes. No prior record bytes were removed or rewritten.
- The previously reviewed v5/v23/v24/full99 evidence claims remain unchanged in the other 22 lines and were rechecked in the prior report. This verdict is scoped to that cumulative 24-line addition and this two-line correction; the 10:14 records remain historical evidence and do not describe later private Carrier v25 work.

This is a records-only factual verdict at the exact candidate SHA. It does not claim Carrier acceptance, product acceptance, a security review, or merge authorization.
````

### Ordinary reviewer B — corrected exact-head review at 0010

````text
# Independent factual review — records candidate 0010a917b65c66b4b9be7725b18615c67b26121c

- **Role:** Fresh exact-head factual review of the records-only correction.
- **Candidate/base:** `0010a917b65c66b4b9be7725b18615c67b26121c` against `8d41d07e507230f30a61f36bb9ba8dc6fb28e18`.
- **Delta from prior reviewed source:** `60e5b8136a9a3a55e9ed039847e62706800c47f6`; exactly one corrected sentence in each target file (two changed lines total).
- **Configured model/context provenance:** Orchestrator-provided native session metadata identifies session `01a14e82-4fe3-7fd1-883a-470fdf78b2c3`, agent path `/root/records60e5_ordinary_b_luna`, configured model `gpt-6-luna`, high effort, parent `01a14000-d9e0-7bb1-b3fd-2c0204a4834c`. This establishes configured model provenance only; served-model/weights identity was not attested.
- **Independence:** Fresh child review context; I did not author, direct, or remediate this candidate.
- **Verdict:** **APPROVE — factual review.** No blocking or non-blocking findings.

## Scope actually checked

Read the exact two-line correction and the cumulative 24-line checkpoint prefix in `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`. Rechecked the v17 native receipt, stdout/stderr, v5 retained raw capture hash, accepted historical blob preservation, and live #847 merge details. Read-only Git, receipt, hash, and GitHub inspection only; I did not edit repository files or run product tests, compilers, browser checks, or Docker.

## Findings

The correction accurately distinguishes the two sequential checks inside `pnpm check:tokens`: the `check-tokens.mjs` token-discipline step succeeded, and the subsequent contrast-source check failed. The v17 native receipt records exit 1 after 336.479 seconds. Its retained stdout shows the token-discipline success message followed by command failure; stderr contains contrast-source unresolved-occurrence diagnostics. The checkpoint correctly identifies the 938 unresolved occurrences as the contrast-source failure and says token discipline passed. This preserves the adverse contrast result without mislabeling token discipline as failed or implying the combined command passed.

The exact diff from the prior reviewed source changes one line in each file. The cumulative candidate has a 24-line checkpoint prefix (12 lines per file); direct Git blob comparison confirms the full accepted base blob remains an exact byte-for-byte suffix of each candidate file. Existing history is preserved.

Other claims in the unchanged 10:14 checkpoint remain supported by the previously checked receipts: v15 full99 is 92 pass / 7 fail / 0 skipped or cancelled; v19 is a selected 7/7 run; v23 is 2/2 focused pass with scoped inputs conserved; v24 is 6/8 pass, two fail, 93 not selected, 0 skipped/cancelled, and native exit 1; the v5 diagnostic has 358 collector paths, 43 tokens, 985 union occurrences, 938 unresolved, and 11,089 requirements (10,389 open / 700 complete). The raw capture SHA-256 again matches `d9d8bf40d692db2d9ac43b115779bb9f4c7bd51b8702804655055a5d2fe9ebed`. Live `gh pr view 847` confirms merged state at `2026-10-18T08:31:28Z`, merge commit `8d41d07e507230f30a61f36bb9ba8dc6fb28e18b`.

The checkpoint retains its explicit non-acceptance boundary: no Carrier acceptance, full101, G3, browser/image, accepted-main composition, final review panel, exact hosted acceptance, whole580, mission/stage closure, UAT, production, waiver, or continuation acceptance. No implied gate waiver or completion claim found. Later private v25 results were not used to revise this dated checkpoint; they are not same-head evidence for its 10:14 `a8ba4b1d` / `a307c6cf` records.

## Commands and reads performed

Read-only `git diff`, `git show` blob comparison, receipt/stdout/stderr inspection, `sha256sum` of the retained JSONL, and `gh pr view 847`. No product verification was run by this reviewer; all product run outcomes above come from the cited original receipts/logs.
````

## Limits

This note records the reviews and source facts only. It is not a product or security approval, a waiver, or merge authorization. The publication candidate still requires the normal protected PR flow and all current required checks on its exact publication head.
