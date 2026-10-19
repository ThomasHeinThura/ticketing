# Session-hook query ownership and activity completion — authentic reviews

**Candidate:** `5e0fd3cdbc1d9119427279e09362a0c0867fcaf3`
**Candidate parent:** `10bc667121efabd357791310679f0d79e47e1f33`
**Accepted comparison base:** `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0`
**Candidate tree:** `6311abc8bd865ba8e6433cc70d33c0c0a7b7b19b`

The candidate consists of the previously reviewed auth query-ownership relocation plus the narrow test-owned completion repair. The auth source changes remain only in `apps/api/src/auth.ts` and `apps/api/src/auth/repository.ts`. The candidate-parent delta changes only `tests/api-integration/existence-oracle-317.test.ts`: after the existing mixed bulk-write, response, and persisted task assertions, the test waits for its own task's durable `priority_changed` activity and checks task ID, type, caller, and supported `newPriority: high`. It does not assert unsupported old-priority data, change production behavior, or modify reset/event infrastructure.

The exact 5e0 source commit has parent `10bc667121efabd357791310679f0d79e47e1f33`. The changed test source SHA-256 is `615e0bbbae06cb66d7c8576b04832b89a92eef075085cb71ccd240a45b7f9a33`; the exact parent-to-candidate patch SHA-256 is `3e83a952d38724dd4764f22d9a104f0d58e3f1b688a08be4d650355e85f53d8f`. Both parent 10bc and candidate 5e0 contain 3,446 tree entries; all 3,445 non-test entries are conserved. Adding the own-note publication produces 3,447 entries. Local verification ran against parent 10bc plus this exact test patch before the source commit; the receipt records the exact test hash and conservation into 5e0. These are local source-equivalent results, not hosted candidate checks.

## Current independent review provenance

Both reports below approve the exact candidate `5e0fd3cdbc1d9119427279e09362a0c0867fcaf3`: one fresh ordinary review and one fresh lightweight GPT-6.1 Sol security confirmation. They are included below byte-for-byte. Native dispatch records are included as raw JSON; these establish configured assignment metadata only, not served-weights attestation.

Native author-and-ordinary provenance:

```json
[
  {
    "id": "01a14cc2-ebe4-7b02-9a2d-fddf727c6b8d",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
          "depth": 1,
          "agent_path": "/root/invitation_accepted840_preparation_luna",
          "agent_nickname": "Aquinas the 2nd",
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
    "configuredTableModel": "gpt-6-luna",
    "configuredTableReasoningEffort": "high",
    "interpretation": "Native configured assignment only; not served weights attestation."
  },
  {
    "id": "01a14cdc-a6ab-7083-934f-8b8e0ab28f5f",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
          "depth": 1,
          "agent_path": "/root/session5e0_ordinary_luna",
          "agent_nickname": "Anscombe the 2nd",
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
    "configuredTableModel": "gpt-6-luna",
    "configuredTableReasoningEffort": "high",
    "interpretation": "Native configured assignment only; not served weights attestation."
  }
]
```

Native security provenance:

```json
{
  "id": "01a14cde-04d7-7f53-9f36-f71c05f7fa88",
  "source": {
    "subagent": {
      "thread_spawn": {
        "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
        "depth": 1,
        "agent_path": "/root/session5e0_security_sol",
        "agent_nickname": "Euler the 2nd",
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
  "configuredTableModel": "gpt-6.1-sol",
  "configuredTableReasoningEffort": "high",
  "interpretation": "Native configured assignment only; not served weights attestation."
}
```

## Verification and hosted evidence

The local receipt records workspace typecheck: 9 tasks, 5 cached, native exit 0, using the exact candidate test bytes while HEAD was `10bc667121efabd357791310679f0d79e47e1f33`; the complete changed integration file passed 17/17, native exit 0. The changed test SHA matches the committed candidate. This is source-equivalent local evidence, not a fresh run at candidate HEAD.

The previous exact hosted publication `10bc667121efabd357791310679f0d79e47e1f33` had a real red PostgreSQL result: run `39087372154`, job `117556660587`, 224/225 files passed, 3,327/3,328 tests passed, and the websocket test's `beforeEach` reset failed before its body after five attempts with SQLSTATE `55P03` on relation `task`. The actual blocking backend/holder was not identified. This remains adverse evidence and is not labeled a flake.

A separate never-publication controlled probe proved only a possible mechanism: under a deliberately owned advisory gate, the real asynchronous activity INSERT remained in flight after the bulk response, held the observed task relation lock, and the unchanged reset failed five attempts; releasing the gate let the real event commit and reset succeed. This controlled result does not identify the actual hosted holder or establish that every reset failure has this cause. The test-owned completion repair is bounded to the exact activity produced by its own successful task write.

**Current exact-candidate hosted checks and applicable image gates remain pending.** No hosted pass, image pass, merge readiness, or gate waiver is claimed. Browser verification is blocked/not applicable to the backend-only change; no screen or UI behavior changed. The hosted adverse result is retained without dismissal.

## Ordinary review

The following complete authentic report is embedded byte-for-byte.

---

# Independent ordinary review — #840 session-hook query ownership

**Reviewed head:** `5e0fd3cdbc1d9119427279e09362a0c0867fcaf3`
**Comparison base:** `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0`
**Candidate parent:** `10bc667121efabd357791310679f0d79e47e1f33`
**Role:** fresh independent ordinary review; assigned for the Luna-tier ordinary-review role.
**Model identity limits:** this interface identifies the assistant as Codex/GPT-6-based but does not display an exact configured/served model variant or reasoning setting. I therefore do not attest that the runtime identity was specifically GPT-6 Luna. The conductor must retain any native dispatch metadata separately and must not infer served-model identity from this report.
**Independence:** I did not author, direct, or remediate the candidate. I reviewed the clean frozen worktree at the exact head above. I did not modify repository source, refs, index, or GitHub state.

## Scope and review tier

The complete diff from accepted base `a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0` touches four paths: `apps/api/src/auth.ts`, `apps/api/src/auth/repository.ts`, `tests/api-integration/existence-oracle-317.test.ts`, and the newly added `docs/07-planning/security-reviews/query580-session-hooks-ownership.md`. The focused `10bc667121efabd357791310679f0d79e47e1f33..5e0fd3cdbc1d9119427279e09362a0c0867fcaf3` delta changes only the integration test. The test change adds `and` to the Drizzle import and awaits a matching persisted activity after the successful mixed bulk update.

The auth paths are on the mandatory security-review path list. Inspection shows the original two awaited session updates retain the same selected executor (`totpTransaction ?? db`), session-id predicates, assigned values, await behavior, guards, and relative order. This is a query-ownership relocation with no observed authority, transaction, hook pass/fail, or error-path change. The additional test change adds completion synchronization around an already-existing activity side effect and does not alter product/auth code or the test's access-control assertions. Under `agent-workflow.md` § Reviews, the source risk calls for one ordinary review plus a lightweight Sol security confirmation. This report supplies only the ordinary review; the existing historical review note covers source `6a23fb3971bd794faddc003fc8617b3fa1e8aa22`, not this candidate or its test delta.

## Checks actually performed

Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, `docs/04-engineering/ci-cd.md`, `docs/07-planning/active-mission.md`, `docs/07-planning/status.md`, `docs/07-planning/decision-log.md`, the candidate's new security-review note, the changed auth/test files, `apps/api/src/database/executor.ts`, the bulk-update event publication path, the event bus, the priority activity subscriber, and its persistence helper.

Read-only commands actually run included `pwd`; `git status --short`; `git rev-parse`; `git diff --stat` and `git diff --name-status` against the accepted base; focused diff against the candidate parent; `git show -s` for candidate metadata; targeted `cat`, `sed`, `rg`, and `find` reads. I inspected the retained hosted adverse summary, native typecheck receipt, precommit verification receipt, source-commit receipt, and controlled-probe result, plus the static reset-lock diagnosis. I did not inspect the full hosted raw log or independently recompute its hash.

No tests, compiler, formatter, database, browser, Node runtime, Docker, GitHub query, or application runtime were run by this reviewer. I make no claim that I reproduced any supplied result. The supplied receipts state that typecheck completed at the test-source input with 9 tasks, 5 cached, native exit 0, and that the complete existing integration file completed 17/17 tests, native exit 0. They are retained evidence, not this reviewer's executions.

## Findings

**Blocking findings: none. Non-blocking findings: none.**

The two repository helpers take `Executor` first, await the Drizzle update, return `Promise<void>`, and preserve the original table, predicate, value, call-site ordering, and caller-selected transaction handle. The surrounding portal rejection/deletion paths, TOTP enrollment transaction selection, OIDC provenance handling, membership guard, and hook return behavior remain unchanged in the reviewed diff.

The new test synchronization is scoped to `ownTask.id`, `priority_changed`, `caller.user.id`, and `eventData.newPriority === "high"`. It follows the existing response and persisted task assertions and completes before Vitest advances to the next test's `beforeEach` reset. Inspection of the existing bulk controller and subscriber confirms that this operation emits the matching activity asynchronously after the task transaction; the test polls for the actual persisted activity row. The predicate cannot be satisfied by a foreign task's activity or another priority value. The test adds no diagnostic listener, database trigger, probe, retry change, reset modification, mock, or event-bus/product behavior change. Existing response equality, SQL-shape, own-row update, and foreign-row preservation assertions remain in place.

The newly added documentation records the earlier source's historical reviews and their limits. It does not purport to make those verdicts apply to `5e0fd3c`; the current ordinary and Sol reviews remain independently necessary.

## Adverse evidence and residual limits

The retained hosted summary records run `39087372154`, PostgreSQL job `117556660587`, failing on parent `10bc667121efabd357791310679f0d79e47e1f33`: 1 of 225 files and 1 of 3,328 tests failed after 224 files / 3,327 tests passed. The failure was the next test's `beforeEach` reset, before its body, with SQLSTATE `55P03` on relation `task`; the actual holder is explicitly unknown. This remains a real adverse hosted result and blocks merge until the exact candidate's required hosted checks are green.

The supplied static diagnosis identifies the preceding mixed bulk-write event's asynchronous activity subscriber as a code-supported possible source of a lingering task lock, but does not establish the hosted holder. The separate controlled probe summary reports that an owned activity insert can produce the reset-lock failure under a deliberately held gate and that releasing the gate lets activity commit and reset succeed. That demonstrates a controlled mechanism only; it does not identify the hosted blocker or reproduce the hosted run. The new test waits for actual activity persistence and is a plausible narrow completion repair, but its local 17/17 receipt is not a reproduction of the prior hosted failure. No final hosted result, image gate, browser result, or runtime acceptance at `5e0fd3c` is present in the supplied evidence.

## Verdict

**APPROVE — source review clear for the exact candidate and bounded scope.** This is not a waiver of the required Sol security confirmation, current exact-head hosted checks, or applicable image gate. The specific GPT-6 Luna runtime identity is not independently visible in this review interface; retain dispatch-side proof before crediting this report to that exact model label.

## Security review

The following complete authentic report is embedded byte-for-byte.

---

# Independent security confirmation — #840 session hooks and test completion

**Reviewed head:** 5e0fd3cdbc1d9119427279e09362a0c0867fcaf3
**Comparison base:** a6b3d7c5dc8262f6bc091587c00a4fc68233b0c0
**Candidate parent:** 10bc667121efabd357791310679f0d79e47e1f33
**Model:** GPT-6.1 Sol
**Role:** fresh independent mandatory security review, lightweight confirmation after ordinary review cleared.
**Context:** /root/session5e0_security_sol; native context 01a14cde-04d7-7f53-9f36-f71c05f7fa88; parent 01a14000-d9e0-7bb1-b3fd-2c0204a4834c.
**Model provenance and limits:** I read session840-activity-completion-root/native-security-provenance.json. It records this context's configured model/reasoning as gpt-6.1-sol/high. My interface identifies Codex/GPT-6-based but does not independently expose a specific configured or served variant. The model label above reflects the native configured assignment, not served-weights attestation. The authentic ordinary report retains its own interface identity limits; separate native-author-and-ordinary-provenance.json records the ordinary context as gpt-6-luna/high. I do not relabel its report.
**Independence:** I did not author, direct, or remediate this candidate. This is a fresh reviewer context, distinct from the original auth author, test repair author, ordinary reviewer, and conductor. I inspected the clean frozen worktree and exact Git objects; I made no source, ref, index, or GitHub changes. I read the authentic ordinary report approving this exact head before issuing this security verdict.

## Scope and independently determined tier

The complete accepted-base-to-candidate diff has four paths: apps/api/src/auth.ts, apps/api/src/auth/repository.ts, tests/api-integration/existence-oracle-317.test.ts, and the historical authentic review note docs/07-planning/security-reviews/query580-session-hooks-ownership.md. Direct Git inspection confirms the exact head, single parent and clean worktree. Parent-to-head changes only the test: both trees have 3,446 entries, with the other 3,445 identical. Compared with historical reviewed source 6a23fb3971bd794faddc003fc8617b3fa1e8aa22, only the historical note and test differ; this review nevertheless independently inspects the full substantive candidate, rather than treating historical clearance as current approval.

Both auth paths are mandatory security-review scope under ci-cd.md. The actual source change relocates two existing awaited UPDATE statements without changing authority, hook acceptance/rejection, transaction behavior, or gate pass/fail semantics. The added test synchronization strengthens completion observation around an existing side effect and preserves existing denial and SQL assertions. The applicable risk tier is therefore one fresh ordinary review plus mandatory lightweight Sol confirmation. A semantic auth redesign tier is not warranted by these bytes.

## Security conclusions

Each repository helper takes Executor first, awaits the same sessionTable UPDATE, preserves the session-id equality predicate and assigned portal or activeOrganizationId value, and returns Promise<void>. Neither helper substitutes shared db for its supplied handle, opens or commits a transaction, catches an error, or returns an unawaited builder. Both call sites retain await, their relative order, and the original sessionWriter = totpTransaction ?? db selection. Only /two-factor/verify-totp selects the current enrollment transaction. The surrounding enrollment context still requires its outer transaction and enlists adapter/hook writes in it.

The portal write remains after absent-session, customer identity, and factor rejection branches and before OIDC provenance binding. Session deletion, cookie deletion, setNewSession(null), invalid-provenance return, signed challenge/source-marker reads, source-cookie expiry, and OIDC binder arguments remain unchanged. The binder still validates user/portal/connection/identity and session predicates. The active-organization write remains under the original sign-up/sign-in/factor endpoint condition and nonempty membership guard. No session flags, policy, route, schema, dependency, or source of authority changes. An UPDATE failure still propagates through the awaited hook.

The test adds only the Drizzle and import and an awaited vi.waitFor after the successful mixed write and existing persisted own-priority/foreign-priority assertions. It reads taskActivityTable for the newly created ownTask.id and priority_changed type, then asserts that row's exact taskId/type/caller userId/newPriority high. The fixture directly creates a fresh task, and prior foreign-only/missing-only writes are denied; there is no earlier matching successful own-task priority write. The condition therefore cannot be satisfied by a foreign task or unrelated priority value. It deliberately makes no unsupported oldPriority claim. Existing response equality, denial status/body, SQL grouping, query-count coverage, own-row update and foreign-row preservation remain intact.

Inspection of the bulk controller, EventEmitter bus, activity subscriber, and persistence helper confirms why response completion alone does not await the subscriber's INSERT: emit invokes an async listener without awaiting its promise. The test now waits for the actual matching persisted activity before the next beforeEach database reset. It introduces no diagnostic callback, trigger, probe, mock, subscriber suppression, timeout/retry/reset modification, event-bus change, or product/auth change. This is a bounded test-owned completion repair; it does not claim to drain all asynchronous application work.

## Checks actually performed

Read the candidate AGENTS.md, active mission, agent-workflow.md, CLAUDE.md, security scope/tier rules in ci-cd.md, relevant coding standards and auth-and-identity session contract, newest status/decision context, historical note, full substantive diff, surrounding hook and repository helpers, Executor contract, TOTP enrollment context, OIDC binder, complete changed test region and reset hooks, bulk event publication, event bus, priority subscriber and persistence helper. Read the authentic current ordinary report, native identity receipts, retained verification/source receipts, repaired local and controlled-probe raw logs, and the adverse hosted raw failure/count sections and summary.

Read-only commands included pwd, cat, sed, rg, tail, git status/rev-parse/show/diff/ls-tree, and Python for static Git-tree comparisons and SHA-256 recomputation. No tests, compiler, formatter, database, Node, Docker, browser, application runtime, or GitHub query was run by me. These are inspected retained results, not my reruns. git diff --check reports only an added blank line at EOF in the unchanged historical review note (line 103), with no source/test whitespace diagnostic; this is not a security finding or clearance of an independently required formatter gate.

I independently recomputed the two auth hashes ee433d7a6d8ef07e269c9784e10cd668c0609b1f943c933f50e4ebd143a6b670 and 94b290893fc3e7d25f4996d99088d3d70f3e105778eb8ec5919d4e99a8ead204; test hash 615e0bbbae06cb66d7c8576b04832b89a92eef075085cb71ccd240a45b7f9a33; parent-to-head patch hash 3e83a952d38724dd4764f22d9a104f0d58e3f1b688a08be4d650355e85f53d8f; and ordinary-report hash 42b60297a79a86e92ecaa53d338cbf26d7f89ebb911d2637e8ec1b18c9f3e0a7. These match retained receipts. The local verification inputs were dirty parent10bc plus that exact patch, subsequently conserved in this single commit: typecheck reports 9 successful tasks/5 cached/native0, and the complete original integration file reports 17 passed/native0. Its 20,119-byte raw log hashes to 220f02cd8a421b2e1f400478dfe725b1eb4268fb7d37b765ae2873073abef59d. The retained Gitleaks receipt reports native0/zero findings for A6..5e0; I did not rerun it.

## Adverse evidence and residual limits

Hosted parent10bc run39087372154/job117556660587 actually failed: 224 passed and 1 failed files, 3,327 passed and 1 failed tests, all225/3,328, with 4 of5 tasks successful. The next websocket case failed in beforeEach reset before its body, after five attempts, SQLSTATE55P03 on task. I checked the raw failure/count sections and independently recomputed its 7,133,207-byte log hash 0e1915dde2f4666f2672c3d1daeb10df3e0d087cfcb4cd6f85033ae08e3f61a8. The actual holder remains unknown. This is retained adverse evidence, not a proven flake or an established hosted cause.

The separate never-publication controlled probe reports 1 passed/native0/root5.258s. Its 1,218-byte raw log hash is a27c505b2398d81c546e16cb9c6922725f147b974c59984842bf11631219cf8f, independently recomputed. Inspection of its retained source/result supports only the controlled mechanism: the real activity INSERT was deliberately held after insertion while holding a task FK RowShareLock; unchanged reset failed all five attempts; release allowed actual activity commit and reset success. This does not identify the hosted blocker or prove the new candidate cures every reset failure. The repaired local17/17 pass likewise does not reproduce the earlier hosted contention.

No current exact-head hosted/image acceptance, browser or runtime acceptance is established by this review. Historical note/source6a23 approval and parent10bc image/check evidence do not approve the new test or replace current required GitHub checks. Existing #231 and NB1 residuals remain unchanged, unfixed and unwaived. This is not whole-#580 completion, a phase finalizer, release/SIT acceptance, or a comprehensive audit of unchanged authentication code.

## Findings and verdict

**Blocking findings:** none in the reviewed source/delta.
**Non-blocking findings:** none.
**Verdict: APPROVE — mandatory lightweight security confirmation clear for exact head 5e0fd3cdbc1d9119427279e09362a0c0867fcaf3 and the bounded scope above.**

The conductor still owns authentic publication, current exact-publication required checks and applicable shipping-image gates. The adverse parent result is not waived; this source verdict is not merge readiness and authorizes no bypass.
