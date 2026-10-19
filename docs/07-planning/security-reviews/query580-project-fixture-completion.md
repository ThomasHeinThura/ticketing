# PR #840 project-fixture completion — authentic current reviews

**Reviewed head:** `0d5187381ea7078cd5d85cf53d033e793c64ed5f`
**Accepted comparison base:** `b2e1780f45d668febcb1ff9d9cd34de044a0b2bc`
**Candidate parent:** `babd327180b61debf9ee87f5f7c1f1d15420e78c`
**Parent composition:** `babd327180b61debf9ee87f5f7c1f1d15420e78c` has parents `b9040a464daf9bc0f3dab2b5b8b7dc898603d350` and `b2e1780f45d668febcb1ff9d9cd34de044a0b2bc`; source mode/type/blob union was verified conserved.

The current candidate delta adds a fixture lifecycle invariant: `seedProjectRows` returns only after the durable `created` activity for its own task/project actor has been observed. A real controlled regression holds the actual activity insert behind an owned PostgreSQL advisory gate, observes the real task response complete while the helper remains pending, releases the gate, then observes durable activity and a successful unchanged reset. The fixture helper change does not alter product event dispatch, reset retries, or timeout policy. The prior auth relocation and earlier activity-completion test are unchanged from their reviewed source.

**Current root-owned verification:** the complete changed integration file passed 142/142, 0 skipped, native exit 0, 49.164 seconds, on exact head `0d5187381ea7078cd5d85cf53d033e793c64ed5f`; raw log 337,176 bytes, SHA-256 `2beaf4cbaa9fdfee8f5b3be6bef7f72da2651ef942a3a9b8ca5a14ddf566b65b`. The root receipt records all source inputs conserved, private environment removed, exact owned container cleaned, and global Docker inventory conserved. This is local source proof only, not hosted/image evidence. Workspace typecheck completed native exit 0 with 9/9 tasks successful and 5 cached at the same head.

The root-run old-helper counterfactual intentionally failed its semantic assertion (`seedSettled` was true when false was required) after the real insert/FK/lock and actual HTTP JSON conditions, with native exit 1; 141 other tests were not executed. That is the expected negative control, not a passing test or acceptance evidence. Its 4,938-byte raw log SHA-256 is `1435cf979b29df0edf961748e8cb592c2539f0006864b6edbfad425abb4fd291`.

The retained published parent run `39091277201`, PostgreSQL job `117568369845`, remains adverse: 224/225 files and 3,327/3,328 tests passed; the project-scoped-reach API-key case failed in `beforeEach` reset with SQLSTATE `55P03` after five attempts, before the test body ran. The hosted holder remains unknown. The root diagnostic states that this is a second actual same-class failure and not a proven hosted-cause reproduction. The prior `10bc` failure was a different mixed bulk/async-priority case. Neither is called a flake. Current exact-publication hosted checks and applicable image gates remain pending; no merge readiness or waiver is claimed.

## Current independent review provenance

The current fresh ordinary review is assigned `gpt-6-luna/high`, context `01a14d1e-2ba4-7310-945f-39ecdfadf1c1`, and approves the exact reviewed head with no findings. The current full security review is assigned `gpt-6.1-sol/high`, context `01a14d1f-767e-7280-9ae7-f7cc3dbea42e`, and approves the exact reviewed head with no findings. The native records establish configured assignment only, not served-weights attestation. The complete authentic reports below are included byte-for-byte.

Ordinary report source: `session0d518-fixture-ordinary-luna.md`; 5,266 bytes; SHA-256 `ce1dfcc5cbf775d8487efec1b8e167546d6fdde0833687f94b519fd351f9e49e`.

Security report source: `session0d518-fixture-security-sol.md`; 12,744 bytes; SHA-256 `09da62d4e79d43af78048907a602c13181f344c30b5e95e75f588af0f325195d`.

**Evidence boundary:** these reviews and local receipts do not identify the hosted lock holder, establish hosted current-head success, image acceptance, browser verification, or completion of the broader #580 mission.

## Native review-assignment provenance

The following JSON is the complete native assignment record at `session840-fixture-v4-application-root/native-review-provenance.json`. It records configured model/reasoning assignments only, not served-weights attestation.

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

## Ordinary review

The next delimited report is copied byte-for-byte from its authentic source file.

--- BEGIN AUTHENTIC ORDINARY REVIEW (bytes follow) ---
# Independent ordinary review — PR #840 fixture completion

**Reviewed head:** `0d5187381ea7078cd5d85cf53d033e793c64ed5f`
**Accepted comparison base:** `b2e1780f45d668febcb1ff9d9cd34de044a0b2bc`
**Candidate parent:** `babd327180b61debf9ee87f5f7c1f1d15420e78c` (composition of `b9040a464daf9bc0f3dab2b5b8b7dc898603d350` and accepted main)
**Role:** fresh, strong ordinary review for the test/fixture delta.
**Model provenance:** assigned as the ordinary Luna context (`gpt-6-luna`). The interface identifies this reviewer as GPT-6-based but does not expose a more specific served model/version; this records the assigned tier/model, not served-weights attestation.
**Independence:** I did not author, direct, or remediate this candidate. I made no source, index, ref, or GitHub changes.

## Scope and checks

I verified `HEAD` and the worktree, reviewed the exact commit delta and the candidate's cumulative diff from the accepted base, and compared the current changes with the prior reviewed `5e0fd3cdbc1d9119427279e09362a0c0867fcaf3` source. The new substantive delta is confined to `tests/api-integration/helpers/project-reach-world.ts` and `tests/api-integration/project-scoped-reach.test.ts`. The auth relocation and earlier activity-completion test are unchanged in the intervening source; I inspected their authentic historical reports in the candidate note and rely on them only for that unchanged scope. The intervening main merge contributes records only.

I read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the active mission, `docs/04-engineering/sdlc.md`, `docs/04-engineering/error-fix-loop.md`, and the security-review path list in `docs/04-engineering/ci-cd.md`. I inspected the complete two-file diff, the `seedProjectRows` and request helpers, API integration Vitest config, task activity schema, database reset behavior, the prior authentic review reports, the retained controlled-probe summary/evidence metadata, and the supplied format-only diff.

Read-only commands actually run included `pwd`, `git status --short --branch`, `git status --porcelain=v1`, `git rev-parse`, `git log --oneline`, `git diff --stat`, `git diff --name-status`, `git diff --unified=100`, `git diff --unified=20`, `git show`, and targeted `sed`, `rg`, and `find` reads. No tests, compiler, formatter, Node runtime, Docker, database, browser, or GitHub query were run by this reviewer. In particular, I do not claim the 142-test or typecheck results as reviewed executions; those remained root-owned/pending in the supplied task evidence.

## Findings

**Blocking findings: none. Non-blocking findings: none.**

The fixture now waits for the exact `created` activity row matching its own task and authenticated user before it returns. The match is narrow and independently checked with `toMatchObject`; it cannot be satisfied by an unrelated task or actor. This addresses the relevant lifecycle edge: the task response can complete while its asynchronous activity subscriber is still persisting the event. The change is fixture-only and does not modify application behavior, permissions, test reset logic, retry policy, or timeout budgets.

The new controlled regression exercises the real task POST and real activity insert. It first sets up the world, then installs a trigger scoped to the selected project, actor, and `created` event. Its owned advisory lock holds the actual activity insert while the test observes the pending backend, expected foreign-key and insert locks, and task-insert query. A proxy around `app.request` observes completion of the actual response JSON; after draining promise continuations, the test requires the fixture seed promise to remain unsettled while the insert is held. Releasing the lock permits the real insert to commit; a transaction notification then identifies the committed row, which the test checks before reset. The existing reset implementation is not altered.

The probe's SQL literals escape quote characters; its trigger/function/channel names are fixed and checked for preexistence. Cleanup releases only the test-owned advisory key, waits for the actual seed/commit where needed, drops only the named trigger/function, clears its listener, and closes only its own clients. Assertions preserve the meaningful failure signal if the fixture returns before persistence. The test explicitly verifies the owned objects and successful reset cleanup. The deterministic trigger ordering check verifies that the task foreign-key trigger runs before the gate and that the gate trigger is enabled. I found no authority or gate-semantics change; this remains a bounded fixture-completion regression.

The existing notes establish previous ordinary and Sol reviews for the unchanged auth and earlier bulk-activity scopes. Those reports do not cover this new fixture/helper delta. This report clears only the ordinary-review role for the exact current source; the required fresh full Sol review for this security-scope candidate remains separate and pending.

## Verdict

**APPROVE — ordinary review clear for the exact reviewed head and bounded test/fixture scope.** This is not the required Sol security review, current hosted exact-head checks, merge readiness, or acceptance of the broader #580 work.

--- END AUTHENTIC ORDINARY REVIEW ---

## Security review

The next delimited report is copied byte-for-byte from its authentic source file.

--- BEGIN AUTHENTIC FULL SECURITY REVIEW (bytes follow) ---
# Independent full security review — PR #840 fixture completion

**Reviewed head:** 0d5187381ea7078cd5d85cf53d033e793c64ed5f
**Accepted comparison base:** b2e1780f45d668febcb1ff9d9cd34de044a0b2bc
**Candidate parent:** babd327180b61debf9ee87f5f7c1f1d15420e78c
**Composition parents:** b9040a464daf9bc0f3dab2b5b8b7dc898603d350 and b2e1780f45d668febcb1ff9d9cd34de044a0b2bc.
**Model:** GPT-6.1 Sol
**Role:** fresh independent mandatory full security review, after the current ordinary review cleared.
**Context:** /root/session0d518_fixture_security_sol; native context 01a14d1f-767e-7280-9ae7-f7cc3dbea42e; parent 01a14000-d9e0-7bb1-b3fd-2c0204a4834c.
**Model provenance and limits:** I read session840-fixture-v4-application-root/native-review-provenance.json. It records this context's configured model/reasoning as gpt-6.1-sol/high and the distinct ordinary context 01a14d1e-2ba4-7310-945f-39ecdfadf1c1 as gpt-6-luna/high. My interface identifies Codex/GPT-6-based without independently displaying a more specific served model/version. The model label above records native configured assignment, not served-weights attestation.
**Independence:** I did not author, direct, or remediate this candidate. This is a fresh context distinct from the authors, material advisers, ordinary reviewer and conductor. I made no repository, index, ref, database, runtime or GitHub changes. The only file I wrote is this private report. I read the complete current ordinary report before issuing this verdict; its independently recomputed SHA-256 is ce1dfcc5cbf775d8487efec1b8e167546d6fdde0833687f94b519fd351f9e49e (5,266 bytes).

## Scope and independently determined tier

The cumulative accepted-base diff contains two auth source files, the earlier existence-oracle test completion repair, two historical review notes, and the new project fixture/helper regression. The new parent-to-head substantive delta changes only tests/api-integration/helpers/project-reach-world.ts and tests/api-integration/project-scoped-reach.test.ts. The parent normally composes the prior b904 candidate and accepted main; the accepted-main contribution relative to b904 contains only status, queue and its factual-review record. I inspected the cumulative source diff, not just the latest test patch.

Both auth paths remain mandatory security scope under docs/04-engineering/ci-cd.md. The auth extraction changes no authority or hook semantics. The new work is a bounded fixture-completion control with a real database regression; it changes a narrow test pass/fail case and warrants one strong ordinary review plus this further full Sol security pass. It introduces no new capability, schema migration, trust boundary, application transaction policy, or CI authority. This report does not waive a gate or claim a phase finalizer.

## Security conclusions

The two session repository helpers preserve the original table, id equality predicate, portal/activeOrganizationId values, awaited execution and Promise<void> result. They require the caller-selected Executor and neither substitute shared db, open/commit a transaction, catch an error, nor return an unawaited query builder. The hook continues to select currentTotpEnrollmentTransaction() only for /two-factor/verify-totp and passes the same sessionWriter to both writes. Customer-identity and factor rejection/deletion branches still precede the portal update; OIDC provenance binding and invalid-provenance deletion/cookie clearing remain between the same writes. Active organization selection remains under the same endpoint and membership guards. No new identity-provider input grants authority, no tenant predicate is relaxed, and update failures still propagate through the awaited hook.

The earlier existence-oracle assertion is conserved. It waits for the newly created own task's priority_changed row and checks caller userId and newPriority high after the existing mixed bulk-write and own/foreign persistence assertions. No denial, concealment, SQL grouping, query-count or foreign-row preservation assertion was removed. The historical auth and bulk-completion reports are not treated as approval of this new helper/test delta.

The fixture now waits, using the existing Vitest default-bounded vi.waitFor mechanism, for a real task_activity row matching its freshly returned task id, created type and projectAdmin user id. The independent toMatchObject assertion checks the same identity fields before the fixture returns. A missing event or wrong actor/task cannot satisfy the predicate; failure remains visible rather than being swallowed or suppressed. Reading the row through a separate normal database statement observes persistence after commit, not a mocked event or merely completed HTTP response. The existing task controller publishes task.created after its task transaction; EventEmitter does not await the subscriber, and recordTaskEventActivity awaits the real INSERT. This explains the fixture lifecycle edge without asserting the cause of the hosted incident.

The regression executes setupProjectWorld, the real helper and real Hono POST/response JSON. Its proxy only observes the actual response.json completion at the helper's task endpoint; it preserves the underlying response body and status. It installs a plain, test-only AFTER INSERT trigger scoped to created events for the exact fixture actor and project. The gate is held by one owned session-level advisory key. Catalog assertions require the actual task foreign-key triggers to precede the gate and to be nondeferrable; lock observation requires the blocked activity backend, its task RowShareLock and activity RowExclusiveLock, the actual activity INSERT query, and the control backend among its blockers. After the actual HTTP JSON is decoded and promise continuations drain, the helper must still be unsettled. A rejection also marks it settled, so failure cannot impersonate successful waiting.

Release must report that the owned advisory key was unlocked. The helper must then resolve, the actual transaction notification must arrive, and the persisted activity must match notification id, returned task id, created type and actor. Reset must actually remove the task and activity. These are independent observations of the held INSERT and subsequent commit; response completion alone cannot satisfy them. Existing reset retries, global timeouts, product dispatch, authorization assertions and budgets are unchanged. The new probe has its own bounded signal/observation waits and per-test timeout; these are not retries of an adverse hosted run.

The SQL object/channel names and advisory integers are fixed. Generated actor/project values are quoted by doubling single quotes, and value parameters are used where PostgreSQL permits them. No external credential, executable attacker input, SECURITY DEFINER privilege, persistent migration or application endpoint is added. Integration setup validates a *_test database, beforeEach uses that guarded reset, and Vitest runs files with one worker and no file parallelism; the established workflow still requires a private database per concurrent lane.

Preexistence assertions refuse to adopt another trigger/function. Ownership flags are set only after successful creation. Cleanup releases only the owned advisory key, awaits seed completion and actual commit where necessary, drops only its named trigger and function, removes its own listener and closes only connected owned clients. Cleanup failures become a test error; they cannot turn the regression green. Failure paths can obscure the original assertion with a cleanup error, but remain fail closed and are not a security blocker. No shared application pool termination, unrelated backend cancellation or broad object deletion is added.

## Source conservation and report provenance

I independently compared current Git objects and checked the intervening history with git log -m, including both composition-parent diffs. Auth source and the earlier test are byte-identical at 5e0fd3cdbc1d9119427279e09362a0c0867fcaf3, b9040a464daf9bc0f3dab2b5b8b7dc898603d350 and this head. Their SHA-256 values are respectively ee433d7a6d8ef07e269c9784e10cd668c0609b1f943c933f50e4ebd143a6b670, 94b290893fc3e7d25f4996d99088d3d70f3e105778eb8ec5919d4e99a8ead204 and 615e0bbbae06cb66d7c8576b04832b89a92eef075085cb71ccd240a45b7f9a33. Current helper and regression hashes are 93e4dfe6f9ab0c2c984a4c6dac784557e558c0378d7f2d950239a0bb488b68bc and 4839a1074496834b2bd03c750a669148110cd48b1936048c56e8b07b3119a2f7; worktree bytes match the exact reviewed objects.

I matched the four original private 6a23/5e0 ordinary/security report files byte-for-byte inside the two candidate historical notes and recomputed their hashes. They are b0f840a894e096f45246d8a472a64c9c2019763d11f8efd6eea623341a0200d3, 80e83c340e84fe9279c40e8d3c58c8308d0f591a960d54682e38f1874fd501f4, 42b60297a79a86e92ecaa53d338cbf26d7f89ebb911d2637e8ec1b18c9f3e0a7 and bf0d2da64177535031d010d6f94589f2a51f1f2a32b98d9a129cb0338f54bb92. I read the historical 5e0 native ordinary/security provenance. These establish retained publication and identity records for their original scopes; hashes alone do not establish independence. The reports' stated independence and source limits remain intact. My current verdict comes from fresh source inspection and does not transfer historical test passes to changed inputs.

## Checks actually performed and evidence limits

Read AGENTS.md, the active mission, agent-workflow.md, CLAUDE.md, relevant SDLC/error-fix-loop and CI/security-path provisions, query-ownership coding standards, auth-and-identity session/portal contract, current status/decision context, the complete cumulative source diff, both changed files, helper/request/setup/reset paths, integration configuration, task activity schema, real task controller, EventEmitter subscriber and activity persistence helper. I also read the complete current ordinary report, historical notes, native identity receipts, format-only diff, application receipt, root counterfactual summary and complete native counterfactual Vitest log.

Commands actually run were read-only pwd, cat, sed, rg, git status/rev-parse/log/show/diff, gh pr list and gh pr view, and Python for static Git comparisons and SHA-256 verification. No tests, compiler, formatter, Node, Docker, database, browser or application runtime were run by me. git diff --check reports only the conserved historical ownership note's added blank line at EOF (line 103), with no source/test whitespace diagnostic; this does not clear a separately required formatting gate.

The retained old-helper counterfactual is meaningful negative evidence: native exit 1, one selected failed test, 141 other tests filtered/not executed, 142 declared. Its complete 4,938-byte log hashes to 1435cf979b29df0edf961748e8cb592c2539f0006864b6edbfad425abb4fd291. It reaches the semantic seedSettled assertion (true when false was required), after the real INSERT/FK/control-blocker and actual HTTP JSON preconditions, rather than failing at setup or timeout. The root receipt records source/helper restoration, environment removal, owned-container cleanup and conserved Docker inventory. I inspected retained evidence; I did not execute that counterfactual. It ran on diagnostic parent 10bc with a temporary test overlay and the old helper, not as a positive execution at this candidate.

At review time, the root-owned complete positive 142-test file and workspace typecheck were pending. I claim no positive result for either. My live read also found PR #840 still published at b9040a464daf9bc0f3dab2b5b8b7dc898603d350, with the PostgreSQL integration job red; it was not hosted current-head validation of 0d518. The retained status describes a beforeEach reset lock failure on task and explicitly leaves its actual holder unknown. This review does not identify that holder, reproduce that hosted failure, relabel it a flake, or establish that every reset failure is cured.

## Findings and verdict

**Blocking findings:** none in the reviewed source/delta.
**Non-blocking findings:** none.
**Verdict: APPROVE — mandatory full independent security review clear for exact head 0d5187381ea7078cd5d85cf53d033e793c64ed5f and the bounded scope above.**

This source verdict is not merge readiness or runtime acceptance. Positive local verification, authentic publication, required exact-publication hosted checks and applicable image gates remain the conductor's work. No red required check, residual or gate is waived. Existing #231 and NB1 residuals remain unchanged and unwaived. This is not a comprehensive audit of unchanged authentication code, whole-#580 completion, stage completion, signed-release/SIT acceptance or final audit.

--- END AUTHENTIC FULL SECURITY REVIEW ---
