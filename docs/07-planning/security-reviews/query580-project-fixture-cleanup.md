# PR #840 project fixture cleanup repair — authentic delta reviews

**Reviewed source:** `49b47095302c89f8c0b358b0e29cf78cc4d4bb2a`
**Candidate parent:** `59da026a8754dd94fd4441f625aaee7d0b560dbe`
**Accepted comparison base:** `b2e1780f45d668febcb1ff9d9cd34de044a0b2bc`
**Candidate tree:** `3d749ff74fa4674da143136311a73ea33ba5802e`

This bounded delta repairs error preservation in the controlled project-fixture regression's cleanup path. It changes only `tests/api-integration/project-scoped-reach.test.ts` (37 additions and 11 removals; SHA-256 `f066d49f60b1906e390faeb4c03f46cd7d6cd4ec251f7e93e19943c4231b9f78`). The test catches and stores its probe error, runs the owned-resource cleanup, then rethrows the original error when cleanup succeeds, throws a cleanup error when cleanup alone fails, or throws an `AggregateError` containing both when both fail. A separate boolean preserves even a falsey/undefined thrown value. The cleanup `finally` has no explicit throw; client closure uses async callbacks under `Promise.allSettled` so synchronous `end()` failures are retained as cleanup failures. Assertions, the real POST/activity gate, SQL, helper behavior, reset, retries and the 20-second bound remain unchanged.

The parent `59da` publishes the prior fixture-completion review note; the parent-to-source commit changes only this test file. Both historical review notes and the 0d fixture-completion note remain byte-identical. The existing auth source and previous activity-completion regression remain unchanged. The new note is a separate own-note publication after this reviewed source.

## Root-owned current-source evidence

On exact local source `49b47095302c89f8c0b358b0e29cf78cc4d4bb2a`, `pnpm lint:ci` exited 0 after checking 2,415 files; it reported 240 warnings and 12 informational messages, with no errors. `pnpm typecheck` exited 0 with all 9 tasks successful and 5 cached. The complete `project-scoped-reach.test.ts` file passed 142/142 with 0 skips and native exit 0 in 47.429 seconds. Its 337,140-byte raw log SHA-256 is `4223fd819d6d1e5a635953e00e68c1740230d3a677fb07db03e2abafffabfee2`. Root receipts record all source inputs conserved, private test environment removed, the exact owned container cleaned, and the global Docker container/volume/network inventory conserved. These are local current-source results, not hosted results.

The old-helper counterfactual is an intended negative control, not acceptance evidence: native exit 1 at the original semantic `seedSettled` assertion, with the original failure preserved through cleanup; one selected test failed and 141 other tests were not executed. Its raw log is 4,968 bytes, SHA-256 `5d4f023a6c51601a2defbc535a315f1842c5db0472b6e0247fb81b0a995f5bbb`.

## Retained adverse evidence and hosted limits

The published `59da026a8754dd94fd4441f625aaee7d0b560dbe` FAST run `39095280819` has an actual required `static` failure at job `117580337329`. The 456,187-byte raw log SHA-256 is `3d473512c58cafc246ba49db44498f92578dec58577beddb6502c53708428ee0`. It reports two `lint/correctness/noUnsafeFinally` errors in the cleanup code fixed by this candidate, plus 240 warnings and 12 informational messages. This is a source failure, not infrastructure. In the read-only GitHub status snapshot during preparation, the 59da FULL run `39095280876` remained in progress (including the PostgreSQL job); it is not a green result. The source candidate `49b` is still local/unpublished, so its exact-publication hosted checks have not run.

Earlier hosted PostgreSQL adverse results also remain. Published parent `b9040a464daf9bc0f3dab2b5b8b7dc898603d350`, run `39091277201`, job `117568369845`, had 224/225 files and 3,327/3,328 tests pass; the project-scoped-reach API-key case failed in `beforeEach` reset after five `NOWAIT` attempts with `55P03` on `task`, before its body ran. The actual hosted lock holder is unknown. Earlier parent `10bc667121efabd357791310679f0d79e47e1f33`, run `39087372154`, job `117556660587`, separately had 224/225 files and 3,327/3,328 tests pass; the next websocket test's `beforeEach` reset failed before its body after five attempts with `55P03` on `task`. These are distinct failures; neither is called a flake, waived, or claimed explained by the local controlled gate.

The exact-publication hosted checks and applicable shipping-image gates remain pending for the 49b source and its later own-note publication. This note and body do not claim merge readiness, identify either hosted lock holder, or waive an adverse result. Browser verification is blocked because this is backend integration-test work; no UI screen was opened or changed.

## Current delta review provenance

A fresh ordinary delta review and a further full GPT-6.1 Sol security delta review approve exact source `49b47095302c89f8c0b358b0e29cf78cc4d4bb2a`, each with no findings. The ordinary context is assigned `gpt-6-luna/high`, native context `01a14d1e-2ba4-7310-945f-39ecdfadf1c1`. The Sol context is assigned `gpt-6.1-sol/high`, native context `01a14d1f-767e-7280-9ae7-f7cc3dbea42e`. These are configured assignments, not served-weights attestations. Both complete authentic reports are embedded byte-for-byte below.

Ordinary source report: `session49b-cleanup-ordinary-luna.md`, 4,664 bytes, SHA-256 `ec1e3b6c5cdb0ffee768ea84985795702335256c8d57f6599ed03d9dabad89d4`.

Security source report: `session49b-cleanup-security-sol.md`, 10,730 bytes, SHA-256 `0bba998da4e88ac187a08c04c23d2135cb2c7a58cfa175c182ec6443e470999d`.

## Native review-assignment provenance

The following is the complete native assignment receipt. It establishes configured assignment only, not served-weights attestation.

```json
[
  {
    "id": "01a14d1f-767e-7280-9ae7-f7cc3dbea42e",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
          "depth": 1,
          "agent_path": "/root/session0d518_fixture_security_sol",
          "agent_nickname": "Gauss the 2nd",
          "agent_role": null
        }
      }
    },
    "actualTurnContextPairs": [
      [
        "gpt-6.1-sol",
        "high"
      ]
    ],
    "interpretation": "Native configured assignment only; not served weights attestation."
  },
  {
    "id": "01a14d1e-2ba4-7310-945f-39ecdfadf1c1",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
          "depth": 1,
          "agent_path": "/root/session0d518_fixture_ordinary_luna",
          "agent_nickname": "Dewey the 2nd",
          "agent_role": null
        }
      }
    },
    "actualTurnContextPairs": [
      [
        "gpt-6-luna",
        "high"
      ]
    ],
    "interpretation": "Native configured assignment only; not served weights attestation."
  }
]
```

## Ordinary delta review

The complete authentic report follows byte-for-byte.

--- BEGIN AUTHENTIC ORDINARY REPORT ---
# Independent ordinary delta review — PR #840 cleanup error preservation

**Reviewed head:** `49b47095302c89f8c0b358b0e29cf78cc4d4bb2a`
**Accepted comparison base:** `b2e1780f45d668febcb1ff9d9cd34de044a0b2bc`
**Candidate parent:** `59da026a8754dd94fd4441f625aaee7d0b560dbe` (review-record-only publication of `0d5187381ea7078cd5d85cf53d033e793c64ed5f`)
**Role:** independent ordinary delta review, Luna tier.
**Model provenance:** the native assignment record for this reviewer identifies `gpt-6-luna/high` (context `01a14d1e-2ba4-7310-945f-39ecdfadf1c1`). This is configured assignment provenance, not served-weights attestation.
**Independence:** I did not author, direct, or remediate the cleanup repair. I made no source, index, ref, or GitHub changes.

## Scope and checks

I verified the exact head, parent and clean worktree. The parent-to-head source delta changes only `tests/api-integration/project-scoped-reach.test.ts`; its SHA-256 is `f066d49f60b1906e390faeb4c03f46cd7d6cd4ec251f7e93e19943c4231b9f78`. The source delta adds 37 lines and removes 11. The helper, auth files, previous activity completion test and historical review records are unchanged from the prior reviewed source. The intervening commit `59da` publishes the prior review record; it adds no source changes.

I reread the relevant `AGENTS.md`, agent workflow review-tier rules, CI security-review path list and error-fix-loop classification rules. I inspected the full 59da-to-49b diff, surrounding probe setup and cleanup, the complete prior 0d ordinary/security review record, the retained exact 59da static adverse log, the stored repaired-source Biome receipt and the format-only diff.

Read-only commands actually run included `git rev-parse`, `git status --short --branch`, `git status --porcelain=v1`, `git log --oneline`, `git diff --name-status`, `git diff --stat`, `git diff --check`, `git show`, `sha256sum`, and targeted `sed`, `rg`, `find` and Python reads of JSON evidence. `git diff --check 59da..49b` emitted no diagnostics. I did not run tests, compiler, formatter, Node, Docker, database, browser or GitHub operations. The 142-test, typecheck and Biome results are inspected root-owned receipts, not executions by this reviewer; I make no positive exact-head test or hosted-check claim.

## Findings

**Blocking findings: none. Non-blocking findings: none.**

The retained exact-59da static result is a genuine source-check failure, not an infrastructure failure: its complete raw log records two `lint/correctness/noUnsafeFinally` errors on the probe's failure path and cleanup-error path. In both cases, throwing from `finally` could replace an earlier assertion or operation error. The current patch catches the probe-body error, records it, performs cleanup, then reports errors after `finally`. With only a probe failure it rethrows that original value; with only cleanup failures it throws a cleanup error; with both it throws an `AggregateError` containing both. Cleanup errors now include their recorded messages.

The restructured `finally` no longer contains an explicit throw. Advisory unlock failures are recorded rather than thrown there. Each awaited cleanup operation remains guarded, and client shutdown is wrapped in an async callback before `Promise.allSettled`, so both rejected promises and synchronous throws from `client.end()` are observed as rejected settlements. No failure is converted into success: a failed probe or any cleanup problem still rejects the test after cleanup. On success, the test continues to require successful gate release, seed completion, commit notification, row verification and database reset.

The change leaves the probe's SQL gate, trigger ordering, response-completion observation, helper invariant, timeouts and assertion semantics intact. The added control flow is limited to preserving diagnostic errors while cleanup runs. I found no change to product behavior, authority, test budgets, retries, reset policy or gate pass/fail semantics beyond making the existing source check pass for this narrow `finally` case.

The earlier ordinary and full Sol reports cover the unchanged 0d source scope. They do not cover this cleanup delta. This report clears only the ordinary review role for exact head `49b4709`; the required fresh full Sol security review remains separate.

## Verdict

**APPROVE — ordinary delta review clear for exact head `49b47095302c89f8c0b358b0e29cf78cc4d4bb2a`.** This is not a current positive test/typecheck claim, hosted-check clearance, merge readiness, or a waiver of the prior adverse check. The root-owned current-source verification and separate Sol review remain outstanding.

--- END AUTHENTIC ORDINARY REPORT ---

## Full security delta review

The complete authentic report follows byte-for-byte.

--- BEGIN AUTHENTIC SECURITY REPORT ---
# Independent full security delta review — PR #840 cleanup repair

**Reviewed head:** 49b47095302c89f8c0b358b0e29cf78cc4d4bb2a
**Accepted comparison base:** b2e1780f45d668febcb1ff9d9cd34de044a0b2bc
**Candidate parent:** 59da026a8754dd94fd4441f625aaee7d0b560dbe
**Prior reviewed source:** 0d5187381ea7078cd5d85cf53d033e793c64ed5f
**Model:** GPT-6.1 Sol
**Role:** independent mandatory full Sol security delta pass after the current ordinary review cleared.
**Context:** /root/session0d518_fixture_security_sol; native context 01a14d1f-767e-7280-9ae7-f7cc3dbea42e; parent 01a14000-d9e0-7bb1-b3fd-2c0204a4834c.
**Model provenance:** the previously inspected session840-fixture-v4-application-root/native-review-provenance.json records this context as gpt-6.1-sol/high and the distinct ordinary context 01a14d1e-2ba4-7310-945f-39ecdfadf1c1 as gpt-6-luna/high. This is native configured assignment only, not served-weights attestation. My interface identifies Codex/GPT-6-based without an independently displayed specific served variant.
**Independence:** I did not author, direct, advise on the fix, or remediate this repair. This is the independent security context that reviewed 0d518, continuing only to review the current delta. I made no repository, index, ref, database, runtime or GitHub changes. My only write in this pass is this private report. No delegation was used.

## Scope, ordinary clearance and source conservation

I read the complete current ordinary report, which clears exact 49b4709 with no findings. I independently recomputed its 4,664-byte SHA-256 as ec1e3b6c5cdb0ffee768ea84985795702335256c8d57f6599ed03d9dabad89d4. That report is not relabelled as this security verdict.

The complete parent-to-head delta changes only tests/api-integration/project-scoped-reach.test.ts: 37 additions and 11 removals, current SHA-256 f066d49f60b1906e390faeb4c03f46cd7d6cd4ec251f7e93e19943c4231b9f78. Worktree bytes match the exact Git object and the worktree is clean. Inspection of the complete intervening commit with git log -m --raw confirms 59da adds only this PR's review note, mode 100644. I matched both original 0d ordinary/security private reports verbatim inside it. My prior full security report remains unchanged at 12,744 bytes, SHA-256 09da62d4e79d43af78048907a602c13181f344c30b5e95e75f588af0f325195d; it covers its original source, while this report covers the subsequent repair.

Direct Git comparisons confirm both auth files, the earlier existence-oracle assertion, project fixture helper, AGENTS.md, CLAUDE.md, agent-workflow.md, ci-cd.md and error-fix-loop.md are unchanged since the full 0d review. The auth hashes remain ee433d7a6d8ef07e269c9784e10cd668c0609b1f943c933f50e4ebd143a6b670 and 94b290893fc3e7d25f4996d99088d3d70f3e105778eb8ec5919d4e99a8ead204; the earlier test and helper remain 615e0bbbae06cb66d7c8576b04832b89a92eef075085cb71ccd240a45b7f9a33 and 93e4dfe6f9ab0c2c984a4c6dac784557e558c0378d7f2d950239a0bb488b68bc. There is no newly changed auth, tenant, permission, executor, product event, reset or CI-policy surface. The accepted-base cumulative auth extraction therefore retains the full prior inspected security scope without an intervening source rewrite or new authority.

The applicable classification remains a bounded test control repair on a security-scope candidate: one strong current ordinary review and a further full Sol pass. This review does not reclassify it as records only, waive a failed check, or claim a phase finalizer.

## Security conclusions

The actual adverse static check is retained. Its log identifies two lint/correctness/noUnsafeFinally errors at old test lines 636 and 707, with native process exit 1. This was a genuine source-check result, not infrastructure. The narrow repair changes error propagation around cleanup rather than the assertions or their acceptance meaning.

The probe body now catches its original thrown value, records an explicit probeFailed boolean and stores the value as unknown. The boolean is necessary and correct: even throw undefined, null or another falsey value still reaches the rejection path. Cleanup always runs after a body failure. After finally, a body-only failure rethrows the original value, a cleanup-only failure throws a descriptive cleanup error, and simultaneous failures throw AggregateError containing both. This removes the previous replacement of the original error by the final cleanup throw. Neither failure class is converted to success.

The finally block contains no explicit throw. A false owned-key unlock result appends a cleanup failure and leaves gateHeld true; a successful result alone clears it. A rejected unlock also records failure. Existing guarded waits, trigger/function removal and UNLISTEN still execute in the same order. Client closures now run inside async callbacks before Promise.allSettled, so a synchronous client.end exception becomes a rejected promise and cannot abort construction of the remaining closures. Rejected shutdowns remain cleanup failures. All connected owned clients are still offered closure, and no shared application pool, unrelated backend or non-owned database object is closed or removed.

The new failure summary includes the recorded cleanup messages. It contains fixed test diagnostics, not connection strings, SQL parameter values or credentials. The AggregateError retains the original underlying error for diagnosis rather than hiding it. Source inspection found no changed reach or actor premise, permission assertion, SQL text, fixed trigger/function/channel name, advisory key, resource-ownership flag, trigger ordering, FK-lock observation, actual HTTP JSON observation, seed-settlement assertion, commit notification, activity-row identity assertion or reset deletion assertion.

The unchanged fixture still cannot return successfully until a real committed created activity matches the exact newly created task and project-admin user. The unchanged regression still holds the actual activity INSERT after the observed task FK, requires the real task response JSON to have completed, and asserts the seed has not settled before release. Its success branch still requires successful unlock, actual seed resolution, committed-row notification and identity verification, then task/activity deletion by the existing reset. No timeout, polling bound, retry count, reset policy, test selector, product dispatch or existing negative assertion is weakened. The prior review's SQL isolation/quoting and test-database/owned-cleanup conclusions remain applicable to those conserved bytes.

## Checks and evidence actually inspected

I verified exact HEAD and parent, clean worktree, the complete source delta, full surrounding probe body and cleanup, intervening raw Git history, unchanged policy/security-scope inputs and unchanged cumulative auth/helper inputs. The workflow, security-path, SDLC, error-fix-loop, auth/session and repository contracts were read in the preceding full pass in this same independent context; relevant policy files were verified unchanged for this refresh. I inspected the current ordinary report, original published reports, retained adverse static failure portions, repaired-source Biome summary, the three-line format-only diff, updated negative raw failure, positive raw result summary and the current positive run's native/source/cleanup receipts.

Commands actually run were read-only git rev-parse/status/show/diff/log, sed, cat, rg and Python for static Git comparisons, JSON inspection and SHA-256 recomputation. git diff --check 59da..49b emitted no diagnostics. No tests, compiler, formatter, Node, Docker, database, browser, application runtime or GitHub operation were run by me. These are retained root-owned executions, not my reruns.

The actual 59da static adverse raw log is 456,187 bytes and hashes to 3d473512c58cafc246ba49db44498f92578dec58577beddb6502c53708428ee0, independently recomputed. The retained targeted repaired-source Biome receipt reports native exit 0, two files checked, no fixes applied and 11 informational messages. I inspected its summary and format-only diff; it is not a full current hosted static result or typecheck.

The updated old-helper counterfactual retains the intended original assertion: seedSettled is true where false is required at line 591. It reports native exit 1, one selected failed test and 141 filtered/not-executed tests out of 142 declared. Its 4,968-byte raw log hashes to 5d4f023a6c51601a2defbc535a315f1842c5db0472b6e0247fb81b0a995f5bbb, independently recomputed. The reported failure is the original assertion, not a cleanup error replacing it; thus the cleanup repair preserves this real negative control. Root records source restoration, private environment removal and Docker conservation. This diagnostic overlay is not a positive execution of current source and does not identify the hosted lock holder.

The now-available current positive receipt is bound to exact 49b47095302c89f8c0b358b0e29cf78cc4d4bb2a, tree 3d749ff74fa4674da143136311a73ea33ba5802e. The actual command selects the complete project-scoped-reach.test.ts without a name filter. Native result is 0, one file and all 142 tests passed, no failed or skipped tests, with 47.429 seconds root duration. Its raw result tail agrees with the receipt. The 337,140-byte raw log hashes to 4223fd819d6d1e5a635953e00e68c1740230d3a677fb07db03e2abafffabfee2, independently recomputed. Pre/postflight receipts have the same clean head/tree and exact source/test hashes; the owned container cleanup exits 0 and Docker inventory reports no added/missing containers, volumes or networks. The root receipt also records private environment removal. This is inspected exact-source local proof only; I did not execute it or inspect every HTTP log line as a separate assertion.

## Findings, verdict and limits

**Blocking findings:** none in the current source/delta.
**Non-blocking findings:** none.
**Verdict: APPROVE — mandatory full independent Sol security delta review clear for exact head 49b47095302c89f8c0b358b0e29cf78cc4d4bb2a.**

Current workspace typecheck/full static and required hosted checks were not established by this review; the actual adverse 59da check remains retained and unwaived. A local 142/142 result does not transfer hosted status or prove the cause of the earlier task-lock incident. The actual hosted holder remains unknown. Authentic publication, current exact-publication required CI and applicable image gates remain the conductor's responsibility. Existing #231 and NB1 residuals remain unchanged and unwaived. This is not merge readiness, comprehensive audit of unchanged auth, whole-#580 completion, stage closure, signed-release/SIT acceptance or final audit.

--- END AUTHENTIC SECURITY REPORT ---
