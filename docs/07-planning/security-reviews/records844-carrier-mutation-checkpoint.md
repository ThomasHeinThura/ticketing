# Independent factual review record — #844 / Carrier checkpoint

**Reviewed head:** `24936b635e7731345b7892dde9fb9de337c3b978`
**Base:** `2a043777056f07d29a7893481aa247ea49243692`
**Tree:** `177ddb92251437d16da9fae1bb6d8708e6607856`
**Scope:** the dated factual prefixes in `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`; records-only, with no product, authority, security-control or gate-semantics change.
**Review tier:** two fresh, independent ordinary GPT-6 Luna factual contexts. This documentation-only change does not trigger a Sol security review. Configured model/effort metadata is included below; served weights are not attested.

## Conclusion and source conservation

Both independent reviewers returned PASS/CLEAR without blocking findings for the exact source above. Reviewer A noted only compact count formatting. Reviewer B correctly distinguished the native TypeError from proof of a specific AST-field cause; the additional root-native evidence below documents the declaration fields and exact correction patch, and is not presented as independent review.

The source tree contains 3,457 entries and changes only the status and integration queue. Root's source-conservation receipt records all other mode/type/blob tuples preserved and a clean tree. Both candidates preserve their exact historical suffixes. The checkpoint records #844's bounded accepted role-lock ownership and source-bound gates/image, preserves the prior224.4ms adverse publication and current optional CPU diagnostic failure without causal claims, and states that SAME Carrier remains blocked. At the 08:05 UTC snapshot, two focused v14 tests had passed while the unfiltered full99 v15 run was pending. It does not claim Carrier acceptance or a later full99 result.

## Provenance and conservation receipts

The following root-generated receipts are included byte-for-byte. The supplemental AST diagnosis is root evidence, not a reviewer verdict or an independent acceptance.

### Native reviewer-session provenance

````json
{
  "source": "24936b635e7731345b7892dde9fb9de337c3b978",
  "base": "2a043777056f07d29a7893481aa247ea49243692",
  "authorSession": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
  "reviewers": [
    {
      "task": "records24936_ordinary_a_luna",
      "session": "01a14e0d-048e-7e52-bee3-f4bd21377666",
      "sessionCreatedAt": "2026-10-18T08:07:18.437Z",
      "turnContextAt": "2026-10-18T08:07:21.339Z",
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high",
      "report": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/records24936-ordinary-a-luna/report.md",
      "reportBytes": 3609,
      "reportSha256": "b4164d41bbb7e55c6c63ac4c8c34108c12ceb8e89b48e5df101d6bd4da059f45",
      "servedWeightsNotAttested": true
    },
    {
      "task": "records24936_ordinary_b_luna",
      "session": "01a14e0d-d8a7-7eb2-9488-d17779ed99b2",
      "sessionCreatedAt": "2026-10-18T08:08:12.734Z",
      "turnContextAt": "2026-10-18T08:08:16.027Z",
      "configuredModel": "gpt-6-luna",
      "configuredEffort": "high",
      "report": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/records24936-ordinary-b-luna/report.md",
      "reportBytes": 4717,
      "reportSha256": "24376717674fba526d3c9c8e608a4f8236187bc82f4a715fd0acf78e2c2e0e43",
      "servedWeightsNotAttested": true
    }
  ]
}
````

### Root source-conservation receipt

````json
{
  "source": "24936b635e7731345b7892dde9fb9de337c3b978",
  "base": "2a043777056f07d29a7893481aa247ea49243692",
  "tree": "177ddb92251437d16da9fae1bb6d8708e6607856",
  "entries": 3457,
  "changedPaths": [
    "docs/07-planning/integration-execution-queue.md",
    "docs/07-planning/status.md"
  ],
  "allOtherTuplesConserved": true,
  "history": {
    "docs/07-planning/status.md": {
      "priorBytes": 1456087,
      "prefixBytes": 2332,
      "newSha256": "cd9d71a70824f14398b71a2c79064f2a8b355e69c1a7c005752856b449b41355",
      "priorSha256": "a5c710605e21352005eaff5f43d03ecde2598ffd049df21c0af0a4d4b5df5f55",
      "exactHistoricalSuffixPreserved": true
    },
    "docs/07-planning/integration-execution-queue.md": {
      "priorBytes": 285778,
      "prefixBytes": 1997,
      "newSha256": "9fece1775f421cf48591c66cfba5a16ed6fea10686ec267d9d3c36af04516473",
      "priorSha256": "472076e7bd7b06d7cbfa82121b49ec773e25f92a07ab457491383275984cf713",
      "exactHistoricalSuffixPreserved": true
    }
  },
  "clean": true
}
````

### Root supplemental AST target evidence

````json
{
  "claim": "Root supplemental static diagnosis, not independent review or full-suite acceptance. Reviewer B correctly notes v12 receipt alone does not prove the precise AST-field cause.",
  "installedAstDeclarationSha256": "d380a6813bb07a1d05a07a08282ff1b63166c40c944db15bc9b27edb7b884e04",
  "declaredFields": {
    "PrefixUnaryExpression": "operand: Expression (line442)",
    "PostfixUnaryExpression": "operand: Expression (line446)",
    "DeleteExpression": "expression: Expression (line568)"
  },
  "beforeSource": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/carrier-popup-connected-render-path-luna/0723/0702/check-contrast.mjs.preimage",
  "beforeSha256": "1aa3ad2f0ad6d5221d0efb88374d56d24153df6bc3eafe2d8b9a535529fa2e8e",
  "exactCorrectionPatch": "/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/carrier-popup-connected-render-path-luna/0723/0702/source-change.patch",
  "patchSha256": "8b109ee8a8abcb2b8e583d07e74c423dafa9ba231923dabce2dd4e8da6164fdb",
  "afterSourceSha256": "07a8de3d8220e67c73f49fb8234b8ce0d904b75c0b2234bd090172ec5b4b42b4",
  "actualFocusedVerification": "v14 includes benign object delete plus rejected intrinsic map/iterator deletion and prefix/postfix updates; 2 selected tests passed. Full99v15 remains separately pending."
}
````

## Authentic independent reports (verbatim)

### Ordinary review A

````text
# Independent ordinary factual review A

- **Model / role:** GPT-6 Luna, assigned fresh ordinary reviewer context A
- **Candidate:** `24936b635e7731345b7892dde9fb9de337c3b978`
- **Comparison base:** `2a043777056f07d29a7893481aa247ea49243692`
- **Independence:** I did not author, direct, or remediate this candidate.
- **Scope:** The two added records in `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md` (22 added lines total). Records-only; the source changes no authority or gate pass/fail semantics, so no security review is applicable.

## Verdict

**PASS — no blocking factual findings.** The dated 08:05 UTC checkpoint is supported by the reviewed evidence and keeps the open Carrier work, adverse results, optional diagnostics, and unfinished release boundaries explicit.

## What I checked

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, and the review/model/count guidance in `CLAUDE.md`.
- Inspected the exact two-file diff and confirmed there are 22 added lines and no other changed paths.
- Compared each changed file's historical suffix with the base: both suffixes are byte-identical. Compared recursive Git tree tuples: only the two named files differ; every other tree entry is conserved.
- Compared the #844 status claims with the private readiness, source-image, shipping-image, protected-acceptance, and acceptance-comment receipts. Read-only `gh pr view` confirms #844 is merged at the stated SHA/time and #846 is merged at its recorded main SHA. The receipts support 18 current required checks; PostgreSQL 225 files / 3,329 tests / 5 tasks; typecheck 9 tasks; unit 12 tasks; required G11 22; and the exact source-bound image, 125 migrations, UID 10001, healthy/live/ready 200, and cleanup. The report correctly keeps the old 224.4 ms result adverse and does not claim a causal performance repair. The current optional CPU diagnostic's sampled-application-frame failure is separately identified and not counted as a required-gate failure.
- Checked the Carrier native receipts. v11 is 1/1 pass; v12 is 1/1 fail with the AST mismatch; v13 is 1/2 with the DnD fixture/evidence-record failure; v14 is 2/2 pass, with 97 of 99 declarations unselected and source/fixture conservation asserted. The full99 v15 start receipt is timestamped 08:04:06 UTC; at inspection its PID was live and no completion receipt existed, consistent with the 08:05 snapshot's pending state.
- Checked the profile-correlation receipts: the focused run passed 12 tests, and the controlled probe observed 1 Profile / 97 chunks with all 97 chunks on a TID different from the profile header. The record appropriately labels this diagnostic-only and draws no hosted-cause or performance-cause conclusion.
- Confirmed this record update preserves the prior checkpoint's blocked and unfinished boundaries. It does not claim Carrier acceptance, whole #580 completion, release/SIT/recovery/final-audit completion, or a functioning after-turn scheduler.

## Tests and reproductions

No tests, runtime, formatter, or candidate-mutating commands were run. This was a read-only factual review of the exact diff and recorded evidence; therefore there are no newly executed tests to report.

## Findings

- **Blocking:** None.
- **Non-blocking:** The new snapshot uses compact count formatting in several sentences (`2/2`, `97`, adjacent units). This does not affect the claims or evidence and does not warrant a review block.
- **Residual:** The v15 full-suite result remained pending at the snapshot timestamp. The checkpoint states that explicitly and makes no acceptance claim.
````

### Ordinary review B

````text
# Independent ordinary factual review — records checkpoint

- **Candidate:** `24936b635e7731345b7892dde9fb9de337c3b978`
- **Base:** `2a043777056f07d29a7893481aa247ea49243692`
- **Tree:** `177ddb92251437d16da9fae1bb6d8708e6607856`
- **Role / independence:** Fresh `ordinary_b_luna` reviewer context. I did not author, direct, or remediate this change and did not consult another review report.
- **Review classification:** Records-only factual review. The exact diff changes only `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`; neither changes authority or gate semantics, and neither path is in the CI/CD security-review path list. One ordinary factual review is the applicable tier; no Sol security review is triggered by this diff.
- **Verdict:** **CLEAR**, with one non-blocking evidence-precision note below.

## What I checked

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, the applicable review rules in `CLAUDE.md`, the active mission, the current status and queue context, and the security-review path list in `docs/04-engineering/ci-cd.md`. Inspected only the two named document diffs and bounded private evidence for the claims they add. Checked GitHub read-only for PRs #844 and #846.

The diff is two dated prefixes only. The 08:05 UTC status checkpoint and queue row agree on the current SAME Carrier state, the bounded #844 acceptance, preserved adverse/performance evidence, owner-held #811/#773 questions and findings, #810's 223.2 ms result, and the unfinished #580/release/SIT/recovery/audit boundaries. The status records the full99 v15 run as pending at the checkpoint; it does not turn the focused results into a full-suite pass or claim Carrier acceptance.

The #844 acceptance claims match the private exact-source receipts and GitHub: source `bab4c451ceff9ebc7d9068d66a52c6de202c6361`, publication `8ef01acf7e9af51a2f1a29505a9294ae353fad0e`, accepted merge `2a043777056f07d29a7893481aa247ea49243692` at `08:01:48Z`, and tree `a00334ab45c6f4bfb417b02db38662777c3e3703`. The readiness receipt records 18 required contexts, PostgreSQL 225 files / 3,329 tests / 5 tasks, 1,395 gate tests with 1,375 pass / 20 opt-in skips / 0 failures, G11 22, browser 64, and the source-bound image digest and health/cleanup facts. It separately retains the optional CPU diagnostic failure and prior 224.4 ms adverse result, with no causal repair claim. The acceptance receipt and GitHub show the protected merge and matching tree.

The #846 records-only acceptance claim also matches its private receipts and GitHub: accepted merge `c98f290022a7dcc4356a89bbe9f02bf6db2d8e9a` at `07:14:58Z`; its receipts explicitly classify product steps as skipped and make no product runtime/image acceptance claim.

The four Carrier receipts bind their native runs to frozen HEAD `31fc00b9bf30e563711e080bba71c9495606b333` and report unchanged source/fixture snapshots. v11 is one selected pass with 97 cases unselected; v12 is one selected failure with 97 unselected; v13 is one pass and one failure with 97 unselected; v14 is two passes with 97 unselected. This supports the documents' explicit distinction between focused runs and the pending full99 run. v13's native failure log says the isolated regression emitted zero evidence records where one was expected.

The records-conservation receipt names the exact candidate, base and tree; it lists only the two checkpoint files, records all other tree tuples conserved and a clean source. I independently compared both current files with their base versions: each original byte suffix is unchanged after the new prefix. The status suffix begins at byte 2,332 and the queue suffix at byte 1,997. The two-file name-status diff agrees with the receipt.

## Non-blocking evidence-precision note

The v12 native stdout directly establishes a `TypeError` in `isParenthesizedExpression` after an undefined node reaches the checker. It does not, by itself, identify the precise `DeleteExpression.expression` versus unary-operand mismatch or show the subsequent target-extraction correction. The checkpoint wording may rely on a separate root diagnosis; that specific causal detail was not independently established from the bounded receipts reviewed here. The native failure and the documented non-acceptance remain supported, so this does not block the records checkpoint.

## Not run / limits

No tests, runtime, formatter, or source checks were run. This was a read-only factual review; no Git or GitHub state was changed. The review does not validate the still-running full99 v15 result or claim any stage, release, SIT, backup/restore or final-audit completion. No report or receipt not listed above was treated as approval.
````

## Limits

This record binds only the exact two-document source head above. It does not assert the then-pending full99-test Carrier result, a security review, application behavior, whole-#580 completion, release/SIT, backup/restore, final audit, or a scheduler capability. The new publication head still requires all current exact-head CI before merge. No waiver is recorded.
