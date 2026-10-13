# S4 notifications — review record

**Reviewed head:** `63d177e0593a88485f91889ee0f2944c98de54df` (first round)
**Reviewed head:** `52d5d7704777d506be68b0f516c104b0b0b3d17f` (first remediation)
**Reviewed head:** `34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66` (time-zone remediation; cleared)
**Reviewed head:** `f7b97a6b2e8d2667776415ec3656562e22c4a479` (rebind after merging main `7486809f`, S2; conflicts only in the decision-log top and in the shadow-test imports)

## The slice

Port of #589 (`2350397b`): fenced outbox delivery with send-time eligibility, plus the session-cleanup reservation purge. On top of that sits #506's unique delta: workspace reach on preference rules and delivery contexts, and task reach on route contracts. D10 (read-all stays reach-limited) is recorded as Thomas decided it on 2026-10-10.

Review remediation added:
- `work_item:read` at send time (F1);
- bounded back-off, so an unresolved or erroring row never blocks the queue (F2);
- fence tests for a foreign token, an expired lease and a stale holder (F3);
- `approval` removed from fan-out until S3 (F4);
- real-database revoke-then-drain tests (F6);
- a renewal-failure abort;
- drain-level tests;
- UTC-correct timestamp binding, with the outbox suite run under UTC, ahead of UTC and behind UTC (N1);
- failure logging, catch-path tests, and timing validation (N2–N4).

The runtime is not wired yet. The pre-wiring gates are recorded in `background-jobs.md` and `notifications.md`.

## Contexts

- **Implementation:** Claude Sonnet `a5a3abc85579adae6`.
- **Ordinary review (Claude Sonnet):**
  - `a28b3d6259e3a1556` (port fidelity and scope): PASS at `63d177e0`. Later commits are remediation and tests, covered by the runtime reviewer and the security reviewer.
  - `ad38bc50730a68430` (runtime and tests): APPROVE at `63d177e0`, closure APPROVE at `52d5d770` and `34bf9c38`, rebind APPROVE at `f7b97a6b`.
- **Security review (Claude Opus 5.5, Sol-tier under Thomas's routing; not GPT-6 Sol):** `a9dc1d549a25ee820`.
  - CHANGES REQUIRED at `63d177e0` (F1–F3).
  - CHANGES REQUIRED at `52d5d770` (N1, time zone).
  - CLEARED at `34bf9c38`.
  - Rebind CLEARED at `f7b97a6b`.

Each report is inserted unmodified, with its SHA-256. Reports later extended with closure and rebind sections are inserted in their final form.

<!-- BEGIN REPORT (agent a28b3d6259e3a1556; model claude-sonnet-5-5; role ordinary review A (fidelity/scope); candidate 63d177e0593a88485f91889ee0f2944c98de54df; sha256 24ed027c9b169a9e133f6f11c93d4af256fbd48b6ad5ae81e8f2939e4c1a4f06) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh independent ordinary reviewer A, port fidelity and scope; static, read-only, no Docker, nothing edited)
**Reviewed head:** 63d177e0593a88485f91889ee0f2944c98de54df
Verdict: PASS (no blocking findings). Two non-blocking notes. Security-scope paths are touched (notification/index.ts, database/repositories/notification-delivery.repository.ts), so a fresh Sol review at this exact head is still required; this review does not replace it.

Method: HEAD verified (63d177e0, 6 commits on 954eb840). Three-way diff of every changed file against main 954eb840, HEAD, #589 2350397b and #506 c55b32b3. I did not re-read AGENTS.md, active-mission.md or agent-workflow.md in full (scope was taken from the task brief). Tests were not re-run (static review); I rely on the author's reported results only as claims.

## 1. #589 port fidelity
Byte-identical to 2350397b (git diff empty): notification-delivery.repository.ts, delivery-primitives.ts, fanout.ts, outbox-drain.ts, preferences.ts, scheduler/session-cleanup.ts, and the tests notification-outbox-delivery, session-cleanup-purge, notification-resource-mapping, delivery-primitives, preferences, recipient-resolvers.
Deliberate deviations, all justified:
- Approval holds only. Removed from current-eligibility.ts (approval binding at ~L122 and the approval recipient branch), recipient-resolvers.ts (resolveApprovalEventRecipients), repository.ts (findApprovalNotificationContext, listApprovalWatcherPersonIds, listApprovalParticipantPersonIds, the approval resource-context branch) and resource-contract.ts (the "approval" entry). The same lines are removed from tests/api/notification-current-eligibility.test.ts. I confirmed nothing else was lost: the remaining diff against 2350397b in these files is only those removals plus the import trims, and the workspace and work_item paths are unchanged.
- Fail-closed is correct. "approval" is no longer a supported resource/event pairing, so canonicalBinding returns null and the delivery is rejected as resource_mapping_mismatch. A test now asserts approval.requested and approval.decided are rejected (notification-current-eligibility.test.ts ~L300-308). A grep of apps/api/src for approvalTable or from/into/update/join approval outside the two schema files returns nothing, so the N2 guard (tests/api/database/unanchored-tables-unreferenced.test.ts) should pass. Generic strings remain (fanout.ts L59 "approval" in RESOURCE_TYPES, L75 "approval.expiring" in URGENT_EVENT_KINDS, preferences.ts L29 approval.* default-email) but they are not table references and are inert while no approval producer or resolver exists. Result: fan-out for approval events cannot produce a deliverable row, which is the safe direction.
- repository.ts also drops the refactor-only DB getters (getNotificationPreference, getProjectWorkspace, getTaskProject, listVisibleNotifications, getOwnedNotificationType) and their imports. Consistent with not porting the refactor.
- "Centralize database reads" refactor not ported: claim verified for task reach. In 2350397b the four notification controllers contain zero reach references and notification/task-reach.ts does not exist; main's controllers do. Porting the refactor would have overwritten main's #602 task-reach. See NB-1 for the session-only part of the claim.
- Main's schema (0119 tenant-composite FK on notification_delivery/outbox) is newer than #589's, and S4 correctly does not touch schema.ts, migrations, events/outbox.ts, event-keys.ts or scheduler/index.ts. events/outbox.ts and tests/api/events/outbox.test.ts equal 2350397b already; event-keys.ts and scheduler/index.ts in 2350397b only carry unrelated slice content (saved_view, service_calendar, reminder-scan) that must NOT come across, and does not.

## 2. #506 delta
- notification-preferences/service.ts is byte-identical to #506 (workspace-scoped rules filtered by reachableWorkspacePredicate, select/join with separate selectedProjects read).
- delivery.ts: HEAD = main plus only the reachableWorkspacePredicate on the workspace delivery context (L16, L282). Main's stronger #602 version is kept (userCanReachTask before the task read, canSend/authorize send-time rechecks per channel, recheck moved after content build). #506's weaker per-where predicate and its lack of canSend are correctly not taken.
- notification/index.ts: HEAD differs from main only in the read-all description. Main already has the other task-reach descriptions, requireSessionOnly and the 403s. Not taken from #506: controllers, task-reach.ts, policy.ts reason text from #506 (replaced by the D10 text), its decision-log entry and its security-review note (reviews a different SHA).
- Tests: the permission-shadow-mode shadow tests present in HEAD and absent from main are exactly 4 (describe "#8 notification self-read shadow evidence" and its 3 its). The three #506-only titles missing from HEAD (instance-admin bypass #315 S8, project request-scope) are not loss: they were already removed from main by dda49351 and exist in the #506 merge base, so #506 is merely stale there. delivery-ssrf.test.ts is a main-based re-fixture; notification-workspace-reach.test.ts is a new file (not in #506 or #589); I did NOT read its body, only confirmed it exists and is scoped to the workspace-reach change.
- Nothing of #506's unique runtime content is silently dropped.

## 3. Shared files
- background-jobs.md: one hunk in the outbox-delivery section, matching #589's hunk plus the wording fix that current-eligibility.ts now exists. The session-cleanup row (incl. outbox_dedupe_reservation) was already on main.
- notifications.md: one hunk ("Open questions"), matching #589's plus the same wording fix. Main's AK-9 text untouched.
- openapi.json: exactly 5 description strings (4 route descriptions plus 1 response description; the author's report says 4), no structural change; matches the index.ts text in HEAD.
- scheduler: only session-cleanup.ts (expired reservation purge). No cron registration or scheduler/index.ts change. No new job name, so nothing is missing from background-jobs.md. Existing job name `session-cleanup` is documented.
- Event keys: no new keys; none added to events/event-keys.ts. Env vars: none read in the new files (grep for process.env empty), so configuration-reference.md needs nothing.
- apps/api/src/index.ts untouched (dirty tree on main checkout is not part of this branch). git status of the worktree is clean.

## 4. Exclusions
Changed-file list contains no S3/S6/S7/S8/S9 content (no approval runtime, SLA, calendar, view, identity, migration, drizzle or schema files) and no feature-flag or request-type code (zero "flag" paths). No security-review notes or status.md edits are included.

## 5. D10 entry
docs/07-planning/decision-log.md: 17 insertions, 0 deletions, one hunk at the very top (above the 2026-10-10 SCIM entry), and it is the only decision-log change. Policy reason and policy.ts comment and read-all description are aligned with the code. Content matches the code and the notifications.md row. Provenance is stated as Thomas via the conductor, recorded by Sonnet 5.5, and the unverified 2026-09-30 #506 entry is explicitly not carried.

## Findings
BLOCKING: none.

NON-BLOCKING
- NB-1 (/private/tmp/claude-501/s4-out.md, "Exclusions"): the author's claim that #589's refactor would also drop main's "session-only enforcement" is only partly supported. 2350397b's notification/index.ts has 5 requireSessionOnly uses and notification-preferences/index.ts has 4, so session-only is not lost on those files; the task-reach loss is the real, verified reason. Wording only; the decision not to port is right.
- NB-2 (docs/03-features/notifications.md Open questions, background-jobs.md ~L305-322): the docs do not state that approval-addressed deliveries currently fail closed (resource_mapping_mismatch) pending S3 and the N2 anchoring. A short sentence would stop a reader treating approval notifications as implemented. Also S3 and S4 overlap on recipient-resolvers.ts/repository.ts/current-eligibility.ts/resource-contract.ts, as the author notes; the conductor must reconcile those four files when merging both so S3 re-adds the approval blocks rather than overwriting S4's shape.
- NB-3 (decision-log.md D10 entry, "Source"): the provenance is second-hand (told to the conductor session). Acceptable per the conductor's instruction, but if the repo expects a first-hand record this should be confirmed by Thomas.
<!-- END REPORT (sha256 24ed027c9b169a9e133f6f11c93d4af256fbd48b6ad5ae81e8f2939e4c1a4f06) -->

<!-- BEGIN REPORT (agent ad38bc50730a68430; model claude-sonnet-5-5; role ordinary review B (runtime/tests), closures and rebind; candidate 63d177e0; 52d5d770; 34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66; rebind f7b97a6b2e8d2667776415ec3656562e22c4a479; sha256 c32c06fdcad17fd4c16e35bbd24d92d5b26a80883a8a261ca03fe8b4343196a6) -->
# S4 notifications: independent ordinary review B (runtime correctness and test adequacy)

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (fresh independent Sonnet 5.5 subagent context; did not author, direct or remediate this work)
**Reviewed head:** 63d177e0593a88485f91889ee0f2944c98de54df
Comparison base: 954eb84094e009658943af1e294d3b8a48d17f69 (29 files, +4445/-74)

## Verdict

**APPROVE WITH NON-BLOCKING FINDINGS (no blocking defect found in the runtime behaviour).**

All gates are green on a clean `git archive` of the exact head. The delivery protocol is correct on the paths I read. Three of the four requested mutations are killed by tests. The fourth, the fencing token comparison, is NOT killed by any test (finding F1). I classify that as a test-adequacy gap rather than a runtime defect, and I proved with a probe that the code is correct and that a test would catch the break. F1 is the finding I would most want closed before this protocol is relied on by a worker. If the orchestrator holds the line "every fence needs a negative test", treat F1 as blocking for this slice.

## Environment and method

- Export: `git archive 63d177e0` into the scratchpad. I verified `git rev-parse HEAD` of /private/tmp/claude-501/s4 is `63d177e0...` before exporting.
- node_modules linked per package from the candidate worktree. The @taskdesk workspace links were re-pointed at the export, because the stale `packages/domain/dist` otherwise produced false typecheck errors. I rebuilt `domain`, `permissions` and `email` with `tsc`. `git init` was used in the export for the permission baseline tests.
- One container only: `s4-review-b-pg`, postgres:18-alpine, `--rm --tmpfs /var/lib/postgresql`, host port 55433. It was run with the sandbox disabled because the docker socket is outside the sandbox. Two databases in it: `taskdesk_test` (full suite) and `taskdesk_mut_test` (mutations and probes).
- Some unit tests need `listen()`, so the unit suite was re-run with the sandbox disabled. The first sandboxed run failed with EPERM on listen only.

## Commands and counts (all on the exported head)

| Check | Result |
| --- | --- |
| `apps/api` `npm run typecheck` (tsconfig, permissions, tests, rls-prototype) | clean, exit 0 |
| root `npm run typecheck` | 5 of 9 turbo tasks pass. The failing ones are `@taskdesk/libs` and web typecheck, which cannot resolve `@taskdesk/api` types in my harness (api dist types not built). These packages are untouched by the diff. Harness artefact, not a candidate finding. |
| `apps/api` `test:unit` | 101 files, 756 tests passed |
| `apps/api` `test:permissions` | 14 files, 88 tests passed |
| `npm run check:route-policy` | pass (turbo 5/5 successful, route-coverage tests green) |
| `npm run check:openapi` | pass, 208 operations, matches tests/api-contract/openapi.json |
| `npm run check:events` | pass, 31 event keys over 456 files |
| `npm run check:vocabulary` | pass, 111 table declarations. Notes only: 1 stale baselined name and 11 inherited baselined identifiers |
| `npx biome ci .` | 0 errors, 176 warnings, 1 info (the sample warning I inspected was in unchanged `rls-prototype.test.ts`). Checked 1938 files. |
| Targeted integration (notification, session-cleanup, permissions-shadow) | 7 files, 99 tests passed |
| **FULL integration suite, private `taskdesk_test` DB** | **151 files, 1765 tests passed**, 575 s, serial (`fileParallelism: false`) |

The integration runs happened with host timezone +0630 (not UTC). The repository helper `utcDate()` parses the raw timestamp strings, so the lease and clock code is exercised in a non-UTC zone and passes. I did not re-run under other zones.

## Mutation spot checks

Each mutation was applied to a throwaway copy, the relevant tests were run, and the file was restored from the export. Mutations were checked to be syntactically valid (an early read-all mutation lacked an import and was discarded and redone).

| # | Mutation | Result |
| --- | --- | --- |
| M1a | Remove the send-time eligibility re-check in the preflight transaction (`outbox-drain.ts`: reuse the earlier evaluation) | KILLED: 3 failures in notification-outbox-delivery (in-flight fence suppression and deferral, and release on preflight unresolved) |
| M1b | Remove the `reaches()` reach check inside `evaluateCurrentNotificationReachAndPreference` | Integration suite: SURVIVES (23/23 pass). Unit suite KILLS it (2 failures in notification-current-eligibility.test.ts). See F3. |
| M1c/M1d | Remove the `person.active` check in the evaluator | SURVIVES in both unit (41/41) and integration (23/23). See F3. |
| M2 | Remove the reach predicate from read-all (`mark-all-notifications-as-read.ts`) | KILLED: 2 failures in notification-task-reach (including the D10 test) |
| M3a | Remove `reachableWorkspacePredicate` from preference rules (`notification-preferences/service.ts`) | KILLED: "lists a workspace notification rule only while the caller reaches the workspace" |
| M3b | Remove `reachableWorkspacePredicate` from the delivery context (`notification-preferences/delivery.ts`) | KILLED: "delivers a workspace-scoped notification while the recipient reaches the workspace, and not after" |
| M4a | Remove the `leaseToken` comparison in `authorizeNotificationProviderAttempt` | **SURVIVES** 23/23 |
| M4b | Remove the `ownerDeliveryId` comparison in authorize | **SURVIVES** 23/23 |
| M4c | Remove the `leaseToken` comparison in `completeNotificationDelivery` | **SURVIVES** 23/23 |
| M4d | Remove the `leaseToken` comparison in `renewNotificationReservation` | **SURVIVES** 23/23 |
| M4-all | Remove all 5 token comparisons (authorize, complete, renew, defer, release) | **SURVIVES**: outbox-delivery plus session-cleanup, 4 files, 50/50 pass |
| M4e | (extra) Treat any existing reservation as expired in acquire | KILLED (concurrent same-key test) |

Probe tests (written only in the throwaway copy, not committed anywhere) to separate "code wrong" from "test missing":
- Stale worker for the SAME delivery: acquire (token1), force the lease to expire, re-acquire (token2), then `completeNotificationDelivery` with token1. Real code: returns false, row stays `pending`. With all token comparisons removed: the stale worker marks the delivery `delivered` (assertion failed: expected pending, got delivered). So the token fence is the only thing preventing a stale worker from terminalising a delivery another worker now owns, and no test pins it.
- Real-DB end to end with `currentEligibilityRuntime`: deactivating the recipient person after enqueue gives `suppressed`, 0 sends, 0 attempts. Deleting the project membership and workspace member rows after enqueue gives 0 sends. So the behaviour is right today; only the committed tests do not prove it.

## Findings

### F1 (test adequacy, high priority, non-blocking on correctness): the lease-token fence has no negative test
All five `leaseToken !==` comparisons in `notification-delivery.repository.ts` (authorize, complete, renew, defer, release) can be deleted without any test failing, and the owner comparison in authorize likewise. The "fencing" tests that exist cover different-delivery contention (the owner check) and expiry sampling, not a stale holder of the same delivery after takeover. The fix is a regression test like my probe: acquire, expire, re-acquire for the same delivery, then call authorize, complete, renew and defer with the stale token and assert `null`/`false` and no state change. It is cheap and non-vacuous (my probe fails under the mutation and passes on the head).

### F2 (runtime, medium, non-blocking while the worker is unwired): `renewUntilStopped` has no error handling
In `outbox-drain.ts`, `const renewal = renewUntilStopped(...)` is started without a `.catch`. If a renewal transaction throws (transient DB error) while the provider call is in flight, the promise rejects with no handler until the later `await renewal`. That can surface as an unhandled rejection, or, if it is handled later, `processNextNotificationDelivery` throws after the provider already sent, leaving the child pending and un-completed so a later drain re-sends (the provider idempotency key is `delivery.id`, which limits the damage). Found by inspection, not reproduced. The renewal path also has no test at all (no test references `renewNotificationReservation` or the renewal loop).

### F3 (test adequacy, medium): send-time reach and deactivation are only proven with mocked facts
- Under real PostgreSQL, no committed integration test revokes membership or deactivates the recipient after enqueue and then runs `currentEligibilityRuntime`. The integration suite survives removal of the `reaches()` check (M1b); only the unit test (mocked facts) catches it.
- `recipient_inactive` has no test at all, and removing the `active` check survives everywhere. In practice `resolveIdentity` rejects an inactive person as a second line (`recipient_identity_unavailable`), so behaviour is currently correct, but nothing proves the inactive-recipient requirement or the stated reason.
- The preflight re-check (M1a) is killed only by call-counter mocks (`checks <= 2`), not by a real state flip between the first evaluation and the preflight evaluation.
The probes I ran show the code behaves correctly; please convert them into committed tests.

### F4 (design/runtime, medium, forward-looking): an unresolved child is never deferred, so it sits at the head of the queue
For `quiet_hours_unresolved` and `destination_unresolved` the child is left `pending` with no change to `next_attempt_at` (this is asserted by the tests and documented as intentional). `claimNextNotificationDelivery` orders by `next_attempt_at, created_at, id`, so once a scheduled worker calls `processNextNotificationDelivery` it will pick the same unresolved row first on every tick and burn the tick. Every `workspace.created` email delivery is currently `destination_unresolved`, so this is the common case. Nothing wires the worker yet (no caller of `processNextNotificationDelivery` or `enqueueNotificationEvent` outside the module and tests), so it is not live. Before scheduler wiring, either defer unresolved rows with a short backoff or skip them in the claim query.

### F5 (spec gap, medium, forward-looking): read-side reach filters only cover `resource_type = 'task'`
List, mark-one, read-all and clear-all apply reach only for legacy `task` rows (`OR resource_type IS NULL OR resource_type <> 'task' OR reachable`). `notifications.md` (line ~346, "Inbox list, read, and mutation operations also apply current reach filtering to each notification's referenced resource") covers the new `work_item`, `comment`, `workspace` and other resource types that `fanout.ts` writes. Not exploitable today because fan-out is unwired and only the creation route can insert rows, but the moment fan-out is wired, inbox rows for lost-reach work items, comments or workspaces will list and mark as read. There is also no unread-count endpoint at all (so nothing to verify there). Negative tests for the new resource types are absent, since there is no code to test.

### F6 (test adequacy, medium): delivery paths with no test
No committed test exercises these branches of `processNextNotificationDelivery`:
- provider failure (retry with backoff, `provider_failed`, `retry ambiguous:false`), and the backoff schedule applied to `next_attempt_at` in a real row (only the pure function and the repo-level sixth-attempt dead-letter are tested);
- provider deadline or abort (`ambiguous` outcome, reservation held until lease expiry);
- lease loss mid-send (delivered but `completeNotificationDelivery` returns false, reported as `retry ambiguous:true`, with no backoff written so the row is immediately due again);
- the `recent_duplicate` suppression path via the drain (only the repository helper has a test);
- `deferNotificationDelivery` and `reservation_contention` deferral;
- `fanout.ts` (`enqueueNotificationEvent`/`materializeNotificationFanout`): no test references it at all, including actor self-exclusion, inactive or login-less recipients, preference gating, urgent-bypasses-digest, and the digest-requires-hook error.
There is also no end-to-end two-worker test over two independent `processNextNotificationDelivery` calls for different rows that share a dedupe key; the concurrency tests are at the repository level plus one fence test with a held provider call (which does pass and is a good test).

### F7 (note): `claimNextNotificationDelivery` is a peek, not a claim
The `FOR UPDATE SKIP LOCKED` lock is released when the claim transaction commits, so two workers can pick the same row. Correctness does not depend on it: the real fence is `acquireNotificationReservation` (locks the delivery row, requires `pending`, then reservation lease). I read this path and it is consistent (`not_pending`, `deferred`, `digest_collision` outcomes are all handled). The naming and the doc phrase "immediate-child claiming" overstate it; worth a comment.

## Answers to the focus questions

2. Outbox delivery semantics (by reading `outbox-drain.ts` and `notification-delivery.repository.ts`, plus the tests above):
   - Fencing/lease: lock order is always delivery then reservation. Lease is 60 s, renewed every 15 s, every comparison samples `clock_timestamp()` after the lock, and acquire handles the cleanup race by bounded retry. Sound, modulo the missing token negative test (F1) and F2.
   - Retry/backoff: 30 s, 2 m, 10 m, 1 h, 6 h, 24 h, dead at the sixth durable attempt. Attempts are consumed only at provider authorization, so suppression and deferral spend none. Poison inputs (bad envelope, missing mapping, unresolved resource) suppress terminally. A repeatedly failing provider reaches `dead` after six. Pure backoff and the cap are tested; the drain-level retry path is not (F6).
   - Idempotency: dedupe key and reservation key are length-prefixed SHA-256, and the provider receives `delivery.id` as the idempotency key. Recent-success window is 5 minutes via a fresh DB clock sample.
   - Concurrent drains: a second worker gets `delivery_fence` or `reservation_contention` and cannot change a delivery that holds a live fence (`updateUnreservedNotificationDelivery` returns false). The two-worker in-flight test passes.
   - Send-time eligibility: the evaluator runs before reservation and again in the same transaction as the attempt authorization, immediately before the provider call. It re-reads person activity, identity, resource scope, customer visibility, reach (`can`/`reaches`), and preference using the transaction. Quiet hours or an unmapped destination refuse the send rather than authorize it. This is a single evaluator (current-eligibility) shared by every `notify.*` channel; there is no per-channel branch to miss. The only residual is the unavoidable window between the preflight commit and the provider call.
   - Reservation purge during a drain: `deleteExpiredNotificationReservations` deletes only rows already past `lease_expires_at` by the DB clock. A live holder renewing is protected (the DELETE re-evaluates after the renew commits under READ COMMITTED). A stalled holder past 60 s loses its fence, and its complete then returns false, which is the intended fail-closed result. Acquire re-runs insert/lock if the purge removed the conflicting row in the gap (tested). Safe. The purge also deliberately ignores legal holds, documented in the diff.
3. Read-side task reach: read, list, read-all and clear-all use the same predicate for `task` rows; the D10 read-all test and the revocation test pass and are killed by M2. Preference-rule listing and the delivery context are workspace-reach filtered and killed by M3a and M3b. There is no unread-count route. Gaps: F5 (non-`task` resource types), and there is no negative test that read-all leaves a hidden notification unread for a different user's credential-limited API key beyond what notification-task-reach already covers.

## Cleanup proof

- Container `s4-review-b-pg` stopped (`docker stop` succeeded; `--rm` removed it): `docker ps -a --filter name=s4-review-b-pg` returns 0 rows, and nothing is listening on port 55433. No other container was touched.
- Throwaway directories `b-export`, `b-mut` and the mutation script were deleted from the scratchpad. I left the scratchpad files that belong to other reviewers (`b-*.txt`, `b-main`, `mutate*.sh` and so on) alone. The only artefact of mine that remains is `b-full-integration.log`, next to this report.
- I made no edits, commits or pushes to /private/tmp/claude-501/s4 or to any repository.
- Heads-up for the orchestrator: `git status` in /private/tmp/claude-501/s4 now shows uncommitted modifications to `current-eligibility.ts`, `delivery-primitives.ts` and `outbox-drain.ts` (about 100 insertions). I did not make them. My review is of the `git archive` of HEAD `63d177e0`, taken before those edits, and does not cover them.

## Not checked

- No browser or UI checks; no deployment or image checks (Docker image build and boot are outside this review's focus).
- Timezones other than +0630 were not run.
- `fanout.ts` was read but has no tests, so nothing about it is verified at runtime beyond reading.
- Security-scope review (GPT-6 Sol) is separate and not replaced by this note.

## Closure at 52d5d770

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** 52d5d7704777d506be68b0f516c104b0b0b3d17f
Context: same fresh independent Sonnet context as above. Fresh `git archive` export of the head, which is one commit on 63d177e0 (9 files, +872/-39). I made no edits to the candidate, and its worktree is clean.

### Verdict

**CLOSED. APPROVE (ordinary review).** F1, F2, F3, F6 and F7 are closed by real tests that fail under mutation. The remaining items are small and non-blocking. This does not replace the GPT-6 Sol security review.

### Findings closure

- **F1 (token fence): closed.** I re-ran the mutation set on the new head.
  - M4a (authorize token), M4c (complete token) and the defer and release token mutations are each KILLED. The new tests that kill them are "authorize, renew, complete, defer and release all refuse 'a foreign lease token'" and "B-F1 a stale holder of the same delivery cannot ...". "Losing the lease mid-send ..." also kills the complete mutation.
  - M4b (owner comparison in authorize) is KILLED by B-F1.
  - M4-all (all five JS token comparisons) is KILLED, with 3 failures.
  - M4d (renew JS check only) still survives. It is equivalent: the renew `UPDATE ... WHERE owner_delivery_id AND lease_token AND lease_expires_at` repeats the check in SQL, so a single-layer removal changes nothing observable. M4-renew-JS+SQL (both layers removed) is KILLED, so the renew fence is genuinely pinned. The author's addendum is right on this point.
  - My stale-holder probe is now committed as B-F1, and it fails when the comparisons are removed.
- **F2 (renewal failure): closed.**
  - `renewUntilStopped(...)` now has `.catch` that aborts the controller. The send is treated as ambiguous and fail-closed, with no unhandled rejection and no throw after a successful send.
  - Mutation N2 (catch removed) is KILLED by "B-F2 a renewal failure stops the send fail-closed ...".
- **F3 (real-DB send-time checks): closed.**
  - M1b (`reaches()` removed) is now KILLED at integration level by "F6 suppresses after project reach is revoked, then drains again once restored".
  - M1c (`person.active` removed) is now KILLED at integration level by "B-F3 suppresses a deactivated recipient with the recipient_inactive reason".
  - New work_item:read authority check: mutation N3 is KILLED by "F1 suppresses a recipient whose project role no longer grants work_item:read".
- **F6 (drain-level paths): closed.** New tests cover provider failure with backoff and one attempt consumed, provider deadline (ambiguous, reservation kept to lease expiry), lease lost mid-send, `recent_duplicate`, backed-off unresolved and throwing-evaluator rows still letting a sibling deliver, and fan-out writing no approval inbox row. The "F6 suppresses after project reach is revoked, then drains again once restored" and "workspace authority removed" tests cover real DB reach changes.
- **F7: closed** by the doc comment on `claimNextNotificationDelivery`.
- **F4 (unresolved head-of-line block): closed in code.** `backOff` defers unresolved results, evaluator exceptions and reservation contention by 30 s, consumes no attempt, and releases the reservation in the same fenced transaction when one is held.
- **F5: still open and documented.** The read-side reach filter for non-`task` types and the other pre-wiring gates are recorded in `background-jobs.md` and `notifications.md`. This is acceptable while fan-out is unwired.

### New-code review

- **30 s backoff** (`NOTIFICATION_UNRESOLVED_BACKOFF_MS` = first step of the retry schedule, applied through `deferNotificationDelivery` or `updateUnreservedNotificationDelivery`):
  - The state logic is sound.
  - There is no cap or attempt spend, so an unresolved row is retried every 30 s indefinitely. That is bounded churn, not blocking.
  - `until` uses the application clock (`Date.now()`) while the other writes sample the database clock. Harmless at 30 s granularity.
- **Renewal-failure abort:** correct. A rejection aborts the controller, `callNotificationProvider` then throws the abort reason, the outcome is `ambiguous`, and the reservation is left to expire. If the complete step itself then throws because the DB is down, the row stays pending and is retried after lease expiry with the same idempotency key.
- **Evaluator and preflight failure handling:** an evaluator exception before the reservation backs off with `evaluator_error`. A preflight exception rolls the transaction back, so the attempt authorization is not consumed, and then backs off while releasing the held reservation. Note that the preflight `.catch(() => null)` swallows every error type, including programming errors, with no log. Nothing is recorded except the `evaluator_error` reason.
- **Optional `renewalIntervalMs` / `providerDeadlineMs`:**
  - Production defaults are 15 s and 30 s, unchanged from before.
  - Nothing outside the tests passes these options.
  - The values are not validated. A renewal interval of 0 or less would spin the renewal loop, and a deadline of 0 or less makes the provider call throw `RangeError`, which is recorded as a failed attempt rather than a configuration error.
  - Nothing enforces that the interval and deadline stay below the 60 s lease. Acceptable for an internal, test-oriented option, but add a guard or document the constraint before it is exposed.
- **work_item:read check:** placed after `reaches()` and applied only to non-workspace resources. It uses the same call shape as the work-item read route.

### Non-blocking residuals (new)

- **R1:** mutation N1 (backoff changed from 30 s to 0) SURVIVES: all 40 tests in the file still pass. The tests prove a sibling is delivered but do not assert that the backed-off row's `next_attempt_at` is in the future, so the specific delay is unpinned. Suggested: assert `next_attempt_at` is at least about 25 s ahead.
- **R2:** mutations N4 and N5 (changing the 15 s and 30 s production defaults to 1 s) SURVIVE. Tests always pass explicit small values, so the production defaults are unpinned. Low risk, but a unit test of the defaults would close it.
- **R3:** `releaseNotificationReservation` is now an unused import in `outbox-drain.ts`. Biome reports 177 warnings, one more than before, and exits 0.

### Counts (fresh export of 52d5d770)

| Check | Result |
| --- | --- |
| `apps/api` `npm run typecheck` (4 tsconfigs) | clean |
| unit (`test:unit`) | 101 files, 757 tests passed |
| `test:permissions` | 14 files, 88 tests passed |
| `check:openapi` | pass, 208 operations |
| `check:events` | pass, 31 event keys over 456 files |
| `check:route-policy` | pass, turbo 5/5 |
| `check:vocabulary` | pass, 111 table declarations |
| `biome ci .` | 0 errors, 177 warnings, 1 info (176 before; the +1 is R3) |
| **FULL integration, private `taskdesk_test` DB** | **151 files, 1782 tests passed**, 427 s |
| `notification-outbox-delivery` file alone | 40 tests (23 before) |

Mutations were run against a second database, `taskdesk_mut2_test`, in the same container.

### Cleanup

- Container `s4-review-b-pg` (`--rm`, tmpfs) was stopped. Afterwards 0 containers match that name and nothing listens on port 55433. No other container was touched.
- My export and mutation copy (`c-export`, `c-mut`) and the mutation script were deleted. The only file of mine left in the scratchpad is `c-full-integration.log`. Other `c-*` entries in the scratchpad belong to other lanes and were not touched.
- /private/tmp/claude-501/s4 is untouched: HEAD is `52d5d770`, `git status` is clean, and nothing was committed or pushed.

## Closure at 34bf9c38

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** 34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66
Context: same fresh independent Sonnet context as above. Fresh `git archive` export of the head, which is one commit on 52d5d770 (11 files, +1992/-1561; most of the churn is moving the outbox suite into a shared helper). I made no edits to the candidate, and its worktree is clean.

### Verdict

**CLOSED. APPROVE (ordinary review).** The UTC binding is correct and consistent with `utils/db-time.ts`. The new time-zone tests really move both the Node process and the database session, and they fail under mutation. R1, R2 and R3 are closed. Two tiny non-blocking notes remain below. This does not replace the GPT-6 Sol security review.

### 1. UTC binding

- `utc()` in the repository binds `date.toISOString()::timestamp`.
  - An ISO string ending in `Z` is UTC, and the `timestamp` cast ignores the zone, so the stored value is the UTC wall clock whatever the process or session zone.
  - This is the same convention as `utils/db-time.ts`: UTC wall clock in `timestamp without time zone` columns, with no session setting involved.
  - It also matches Drizzle's own write path (`toISOString`).
- No bare `Date` is bound anywhere in the repository now.
  - A grep finds no `${...}::timestamp` or `${until}` / `${update.until}` binds left outside `utc()`.
  - Every writer goes through `utc()`: acquire, renew, complete (including ambiguous `GREATEST(...)`), defer, release, update-unreserved and authorize.
  - `completeNotificationDelivery` feeds `utc()` the raw stored lease string, which `utcDate()` parses as UTC. That is correct.
- Fan-out now inserts `next_attempt_at`, `created_at` and `updated_at` with `dbNowUtc()` (`now() AT TIME ZONE 'UTC'`).
  - That is the database's clock in UTC wall-clock form, the intended pattern in `db-time.ts`.
  - It replaces column defaults that would have stored the session-local wall clock.
  - The claim query already compares with `clock_timestamp() AT TIME ZONE 'UTC'`.
- Backoff `until` values come from the application clock but are bound as UTC instants, so they are zone-safe.

### 2. Time-zone tests

- The ahead-of-UTC (Asia/Yangon) and behind-UTC (America/New_York) files each set `process.env.TZ` and `process.env.PGOPTIONS = "-c timezone=..."`.
- Each file also contains an assertion test that `new Date().getTimezoneOffset() !== 0` and that `current_setting('TimeZone')` equals the intended zone. So both zones are verified to be really in effect, not assumed. This mirrors the existing `session-cleanup-server-ahead/behind-utc` pattern.
- They run in CI: the integration config includes `tests/api-integration/**/*.test.ts`, and the shared helper (no `.test.ts` suffix) is not collected twice.
- They run the same shared suite body (50 or 51 tests per file) as the base file.
- Note: the base `notification-outbox-delivery.test.ts` sets no zone, so it runs in the ambient host zone. It is UTC in CI but +0630 on this host. That is harmless, and it was useful here, since mutation U1 failed all three files on this host.
- Mutations:
  - **U1:** `utc()` changed to bind a bare `Date`. 24 tests failed across the three suite files, so the zone regression is caught.
  - **U2:** fan-out explicit timestamps removed. KILLED in one of the two zone files ("N1 fan-out writes a delivery child that is immediately claimable (UTC wall clock)"). Only the ahead-of-UTC direction asserts; the behind-UTC file would only mis-set `created_at`/`updated_at`, which is not asserted. Minor, non-blocking: add an assertion on those two columns to cover both directions.

### 3. R1 to R3

- **R1 (backoff duration): closed.** Mutation backoff 30 s to 0 now fails 4 tests, via the new `secs_ahead > 25` assertions.
- **R2 (production defaults): closed.** The new unit test `drain-timing-defaults.test.ts` pins lease 60 s, renewal 15 s, deadline 30 s and backoff 30 s, and checks they keep a send inside its fence. Mutating the deadline default to 1 s or the renewal default to 1 s each fails it. The drain code now reads `NOTIFICATION_*` constants for its defaults.
- **R3 (unused import): closed.** `releaseNotificationReservation` is gone from `outbox-drain.ts`.
- **Related N4 timing validation:** `assertDrainTimings` rejects non-finite or non-positive values, a renewal at or above half the lease, and a deadline at or above the lease. Mutating the renewal check out fails a test. This also closes the validation residual I raised in the previous closure.
- **N2:** evaluator and preflight failures are now logged through `logTaskDesk` with a closed event, and the row keeps `evaluator_error`. This is acceptable.
- **Residual:** biome still reports 177 warnings overall. The outbox-drain warning is gone, and the new one is an unused import in the new `helpers/notification-outbox-suite.ts` (line 10). Cosmetic.

### Counts (fresh export of 34bf9c38)

| Check | Result |
| --- | --- |
| `apps/api` `npm run typecheck` (4 tsconfigs) | clean |
| unit (`test:unit`) | 102 files, 759 tests passed |
| `test:permissions` | 14 files, 88 tests passed |
| `check:openapi` | pass, 208 operations |
| `check:events` | pass, 31 event keys over 456 files |
| `check:route-policy` | pass, turbo 5/5 |
| `biome ci .` | 0 errors, 177 warnings, 1 info (1942 files) |
| **FULL integration, private `taskdesk_test` DB** | **153 files, 1894 tests passed**, 416 s |

Mutations ran against a second database, `taskdesk_mut3_test`, in the same container.

### Cleanup

- Container `s4-review-b-pg` (`--rm`, tmpfs) was stopped. Afterwards 0 containers match that name and nothing listens on port 55433. No other container was touched.
- My export, mutation copy and mutation script were deleted. The only file of mine left in the scratchpad is `d-full-integration.log`.
- /private/tmp/claude-501/s4 is untouched: HEAD is `34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66`, `git status` is clean, and nothing was committed or pushed.

## Rebind at f7b97a6b

Reviewer model: Claude Sonnet (claude-sonnet-5-5)
**Reviewed head:** f7b97a6b2e8d2667776415ec3656562e22c4a479
Context: same fresh independent Sonnet context as above. This is an exact-head rebind of the S4 merge commit, whose parents are `34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66` (S4) and `7486809fc92c67b5d5943003204b5d1b8c20f1e0` (main with S2 #627). I made no edits to the candidate, and its worktree is clean.

### Verdict

**REBOUND. APPROVE at f7b97a6b.** The merge adds nothing to S4 beyond the two conflict resolutions. Both resolutions are correct and weaken nothing. The reviewed S4 content, my earlier verdicts and findings closure, carry over to this head unchanged. This does not replace the GPT-6 Sol security review.

### 1. Diff equivalence

Commands (in /private/tmp/claude-501/s4):
- `git rev-parse HEAD` gives f7b97a6b2e8d2667776415ec3656562e22c4a479.
- `git merge-base --is-ancestor 7486809f HEAD` and `... 34bf9c38 HEAD` both succeed, and the parents are as stated above.
- `git diff 954eb840 34bf9c38` (S4 against its old base) and `git diff 7486809f HEAD` (merged head against new main).

Results:
- Both diffs have the same file set (verified with `git diff --name-only`) and the same length, 6244 lines.
- After stripping `index` lines and hunk-header numbers, they differ in 12 diff lines in total, three places, all in conflict areas and all context lines, not added or removed lines:
  - two context lines in `docs/07-planning/decision-log.md`, where the neighbouring context is now main's newest entry instead of the old one;
  - one context line in `tests/api-integration/permissions-shadow-mode.test.ts`, the node:crypto import line.
- Every added or removed line of S4 is identical.

Conflict area 1, `docs/07-planning/decision-log.md`:
- Against main, the file diff is `17 0`: 17 lines inserted, 0 removed.
- The one added entry is the D10 entry, at the top.
- All of main's entries are intact: the "Owner decisions recorded late" (#602 lift) entry, S3 approvals, the SCIM first OIDC login entry, the integration decisions, G11 and older.
- So it is insert-only against main, as required.

Conflict area 2, the `permissions-shadow-mode.test.ts` import block:
- The resolution is `import { createHash, randomUUID } from "node:crypto"` plus `import { and, eq, inArray } from "drizzle-orm"`, the union of S2 (`createHash`) and S4 (`inArray`).
- Against main, the only removed line is the old `import { and, eq } from "drizzle-orm"`, now replaced by the union.
- Against S4 34bf9c38, the only removed line is the old `import { randomUUID } ...`, now replaced by the union.
- No other imports were disturbed.

### 2. S2 and S4 shadow cases intact and unweakened

- Against main (S2 content): the file differs by +603 and -1 lines, and the sole removal is the drizzle import line. So every S2 line is present.
- Against S4 34bf9c38: the sole removed line is the old node:crypto import. S2's additions (83 added lines) sit on top of everything S4 had.
- Case counts grow monotonically: 35 at the old base 954eb840, 37 on main (S2 added 2), 38 on S4 34bf9c38, and 40 on the merged head. Expect-call counts are 110 on main, 150 on S4 and 156 on the merge, so no assertion count dropped on either side.
- The S4 #506 shadow cases are present by name: "returns only the caller's notifications and records the self-policy agreement", "keeps only reachable task links and metadata ...", and "rechecks task reach at notification creation, read, delivery, and preference read". The workspace-reach test lives in its own file, `notification-workspace-reach.test.ts`, and is untouched.
- Because the file has no removed lines other than the two import lines, neither side's assertions were weakened.

### 3. Runs on a fresh export

Commands:
- `git archive HEAD` into a scratchpad directory. node_modules was linked per package, and `domain`, `permissions` and `email` were rebuilt with `tsc`.
- Container `s4-review-b-pg`: `docker run -d --rm --name s4-review-b-pg --tmpfs /var/lib/postgresql postgres:18-alpine`, on host port 55433, database `taskdesk_test`.
- `npx vitest run --config vitest.integration.config.ts permissions-shadow-mode notification-outbox-delivery.test notification-outbox-delivery-ahead notification-outbox-delivery-behind notification-workspace-reach notification-task-reach`

Results:

| Check | Result |
| --- | --- |
| Integration, 6 files (shadow-mode, outbox UTC/ambient, outbox ahead-of-UTC, outbox behind-UTC, workspace-reach, task-reach) | **6 files, 203 tests passed** |
| `apps/api` `npm run typecheck` | 0 TypeScript errors |

I did not re-run the full suite. The builder reports 156 files and 1919 tests (Addendum 4). Since the merged tree differs from main plus S4 only in the two reviewed conflict areas, my earlier full run (153 files, 1894 tests at 34bf9c38) plus the scoped run above is the evidence I vouch for.

### Cleanup

- Container `s4-review-b-pg` (`--rm`, tmpfs) was stopped. Afterwards 0 containers match that name and nothing listens on port 55433. No other container was touched.
- My export and diff scratch files were deleted.
- /private/tmp/claude-501/s4 is untouched: HEAD is `f7b97a6b2e8d2667776415ec3656562e22c4a479`, `git status` is clean, and nothing was committed or pushed.
<!-- END REPORT (sha256 c32c06fdcad17fd4c16e35bbd24d92d5b26a80883a8a261ca03fe8b4343196a6) -->

<!-- BEGIN REPORT (agent a9dc1d549a25ee820; model claude-opus-5-5; role Sol-tier security review, closures and rebind; candidate 63d177e0; 52d5d770; 34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66; rebind f7b97a6b2e8d2667776415ec3656562e22c4a479; sha256 b5b26cde3d0e29daf885adb9caec3191e27af67e4acbc863c95d8efd018946d0) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s4-security-review-opus (a fresh subagent context spawned from that session; the harness exposes no separate agent id)
**Reviewed head:** 63d177e0593a88485f91889ee0f2944c98de54df

**Verdict: CHANGES REQUIRED (BLOCKED).** There are 3 BLOCKING findings and 5 NON-BLOCKING findings.

# S4 notifications: Sol-tier independent security review

- **Candidate:** branch `claude/s4-notifications`, worktree `/private/tmp/claude-501/s4`.
  - HEAD was verified as `63d177e0593a88485f91889ee0f2944c98de54df`.
  - The working tree was clean before and after the review.
- **Base / merge base:** `954eb84094e009658943af1e294d3b8a48d17f69`, verified with `git merge-base`.
  - Diff: 29 files, +4445/−74.
- **Policy read at base:**
  - `AGENTS.md`
  - `docs/01-architecture/rbac.md`
  - `docs/03-features/notifications.md`
  - `docs/01-architecture/background-jobs.md`
- **Independence:** I did not author, direct or remediate this candidate. I treated the author's report (`s4-out.md`) as untrusted. One claim in it is out of date: it says "five commits", but the branch has six.
- **Isolation:** all tests and mutations ran on a clean rsync export at `scratchpad/s4x`, never in the candidate worktree. They used one disposable container, `s4-sec-pg` (postgres:18-alpine, `--rm --tmpfs /var/lib/postgresql`), which has been stopped and removed.

## Important context: the runtime is not wired at this head

Nothing in production calls the following:

- `materializeNotificationFanout` / `enqueueNotificationEvent`
- `processNextNotificationDelivery` / `currentEligibilityRuntime`
- `resolveWorkspaceCreatedRecipient`

A grep over `apps/` and `packages/` finds them only in tests. The docs say this openly (`background-jobs.md` "first bounded runtime slice").

So none of the findings below can be exploited from production at this head. They are still defects in the security contract this PR implements, and two of them are locked in by the PR's own tests. Wiring the seam later would inherit them silently. That is why they block this candidate rather than "the future wiring PR".

---

## Findings

### F1. BLOCKING: the send-time evaluator authorises delivery to a recipient without `work_item:read`

**Where:**
- `apps/api/src/notification/current-eligibility.ts:190-201`. The work item and comment branch checks only `reaches(identity, reachFacts)`.
- `tests/api-integration/notification-outbox-delivery.test.ts:113`, `:421-439`. The fixture enshrines the defect.

**Rule:**
- `rbac.md` §2: reach and authority are separate axes.
- `rbac.md:713`: `GET /api/work-items/{key}` requires `work_item:read`.
- `notifications.md:356`: the send-time check must "Recheck current work-item and project reach under the [work-item read policy]".
- `reaches()` is purely the reach axis (`evaluator.ts:353`). It never consults capabilities.
- Main's own legacy inbox path (`task-reach.ts`, with the test "requires effective work_item:read, including project override") requires effective `work_item:read`. The new evaluator is weaker than the code it is meant to replace.

**Attack scenario:**
1. An admin moves a staff member onto a project-scope role that removes `work_item:read`. Project-scope roles override workspace roles in `authorityFor`.
2. The person keeps the project membership, so `reaches()` stays true.
3. Every queued and future `work_item.*` / `sla.*` / comment email for that project still passes send-time eligibility.
4. The recipient receives the work item title or body and its URL for items they can no longer open.

**Proof (my probe, PROBE-A, real Postgres):** I used the candidate's own fixture. The recipient has a project role with `capabilities: []`.
- `can(identity,'work_item:read','work_item',{…})` returned `false`.
- `evaluateCurrentNotificationReachAndPreference` returned `{"kind":"eligible","projection":{"title":"Assigned","body":"A safe summary","url":"/agent/work-items/NOT-…-1"}}`.

The candidate's positive test "NO-3/NO-9 rechecks a staff work-item destination…" asserts `delivered` for exactly this capability-less recipient.

**Fix:**
- Require `can(identity, "work_item:read", "work_item", { workspaceId, organisationId, workItemProjectId: projectId, projectId })` in addition to `reaches(...)`.
- Fix the fixture so the positive case grants `work_item:read`.
- Add a negative test (project override with no read capability → `suppress`).

### F2. BLOCKING: a poison row starves the outbox queue (unresolved results never reschedule)

**Where:**
- `apps/api/src/notification/outbox-drain.ts:150-151` and `:249-250` (`leaveUnresolved`, lines 100-110).
- `notification-delivery.repository.ts:94-99`: the claim orders by `next_attempt_at, created_at, id`, and the claim lock is released when its transaction commits.

**Mechanism:**
- When eligibility is `quiet_hours_unresolved` or `destination_unresolved`, the drain returns without touching the row.
- `next_attempt_at` stays in the past, so the same row is the head of the queue on every subsequent `processNextNotificationDelivery` call.
- Either way, the drain is stuck on that row:
  - if the scheduled drain stops on the first non-`delivered` result, every other delivery is head-of-line blocked;
  - if it loops "until idle", it never reaches idle.

The candidate's tests at `:758-810` assert the row stays `pending` but never assert that it stops blocking.

**Who can trigger it:** any ordinary user, with no privilege needed.
- Setting quiet hours on one's own profile is enough. Every person with quiet hours poisons the queue.
- So does every delivery whose destination is unresolved, which today means:
  - every customer recipient;
  - every comment notification (`staffUrl: null`);
  - every `workspace.created` notification.

  These are the normal case, not an edge case.

The same head-of-line effect applies to:
- the thrown `NotificationReservationContentionError` (`repository.ts:219`);
- any exception thrown by the evaluator. The row is never moved, so a malformed or poison row that throws inside `resolveIdentity` or a query blocks the queue indefinitely.

There is also no attempt or age bound on these paths. The six-attempt cap only counts authorised provider attempts.

**Proof (PROBE-B, real Postgres):** I seeded an older unresolved `workspace.created` child and a newer, fully eligible work-item child. Five consecutive drain calls returned `destination_unresolved` five times. The eligible sibling stayed `pending` with `attempts: 0`.

**Fix:** on `unresolved` and on caught errors, move the row forward under the delivery lock. Options:
- set `next_attempt_at` to a bounded backoff;
- or park it in a non-claimable state, or exclude it via a flag, until the contract lands.

Add a regression test where an unresolved head row does not prevent a sibling from being delivered.

### F3. BLOCKING (test gate): the fencing-token and stale-lease rules have no regression test

**Required mutations that survived the candidate's full outbox suite** (`notification-outbox-delivery.test.ts`, 23/23 still green):

| Mutation | Location | Result |
| --- | --- | --- |
| M3-authz: drop `leaseToken` comparison in `authorizeNotificationProviderAttempt` | `repository.ts:368` | **survived** |
| M3-complete: drop `leaseToken` comparison in `completeNotificationDelivery` | `repository.ts:440` | **survived** |
| M3-renew: drop `leaseToken` comparison in `renewNotificationReservation` | `repository.ts:524` | **survived** |
| M4-authz: accept an expired lease in authorize | `repository.ts:369-370` | **survived** |
| M4-complete: accept an expired lease in complete | `repository.ts:441` | **survived** |
| M4-acquire: treat a live foreign lease as takeable | `repository.ts:186` | killed (1 test) |

**Reading the code:** the fencing logic is correct. My PROBE-C showed that a wrong token or an expired lease is refused by authorize, renew and complete (`null/null/false`, row stays `pending`, `attempts: 0`).

**Why it still blocks:**
- No test in the candidate calls these functions with a stale token or an expired lease.
- These checks are the only thing preventing a stale worker (GC pause, partition) from sending after another worker took over, or from committing `delivered` or `dead` over the new owner.
- AGENTS / CLAUDE.md: "Every rule that closes a code defect gets a test."
- The review brief requires each of these mutations to fail a test.

**Fix:** add direct repository tests for authorize, renew and complete × (foreign token, expired lease). PROBE-C below can be adopted almost verbatim.

### F4. NON-BLOCKING (pre-wiring gate): inbox read paths re-check reach only for `resource_type = 'task'`

**Where:**
- `controllers/get-notifications.ts:39-47`
- `mark-all-notifications-as-read.ts:10-18`
- `mark-notification-as-read.ts:28-33`
- `clear-notifications.ts`

All of these use `or(isNull(resourceType), ne(resourceType,'task'), reachableTaskNotificationPredicate(...))`.

The new fan-out writes in-app inbox rows into the same `notification` table (`fanout.ts:130-139`), with `resource_type` from `RESOURCE_TYPES` (`fanout.ts:56-71`): `work_item`, `comment`, `approval`, `workspace`, `instance`, and others. Every one of those rows bypasses current-reach filtering on list, read, read-all and clear.

**Effect:**
- Once fan-out is wired, a user who loses reach (or `work_item:read`) keeps seeing the work item, comment or approval title and body in `GET /api/notification`.
- `notifications.md:346` ("Inbox list, read, and mutation operations also apply current reach filtering to each notification's referenced resource") is violated.
- This is also where **approval does not fully fail closed**:
  - external approval deliveries are correctly suppressed (`resource_mapping_mismatch`; tested at `notification-current-eligibility.test.ts:301-306`);
  - but `RESOURCE_TYPES` still admits `approval`, so an approval inbox row would be listed unfiltered.
- Instance-scoped events (`resource_type 'instance'`, `type 'info'`) also bypass the `audit_write_failed`/instance-admin gate in `get-notifications.ts:16-22`, because that gate keys on the legacy `type`.

**Already on main:** legacy `workspace_created` rows (`resource_type 'workspace'`) are listed after workspace reach is lost. #506's workspace-reach delta reached delivery and preferences, but not the inbox. The exposure today is only the workspace name, which the creator already knew.

**Why non-blocking now:** there is no production writer of the new resource types at this head.

**Required before any resolver is wired:**
- extend the read predicate to each registered `resource_type` (fail closed for unknown types);
- remove `approval` from `RESOURCE_TYPES` until S3 lands its reach code.

### F5. NON-BLOCKING: legacy workspace delivery checks reach once, with no banned or deactivated check, and no recheck at send time

**Where:**
- `notification-preferences/delivery.ts:272-285`
- `utils/workspace-access-middleware.ts:500-516`
- `delivery.ts:548-554`

**Details:**
- `reachableWorkspacePredicate` accepts any `workspace_user` row or `user.role='admin'`. It does not check `user.banned`, `person.active` or a soft-deleted workspace.
- `canSendToTask()` returns `true` for every non-task resource, so the email, ntfy, gotify and webhook "recheck immediately before send" is skipped for workspace notifications.

**Scenario:** a banned user, or a deactivated person whose `workspace_user` row was not removed, still receives `workspace_created` email and webhook deliveries.

**Impact:** low. The content is a workspace name, and the event targets the creator. This is a net improvement over main, which had no check at all.

**Recommendation:** use the same identity-based `can(workspace:read)` check as the new evaluator, and recheck it in `canSend`.

### F6. NON-BLOCKING: send-time workspace authority and scope checks are untested

**Surviving mutations, run against both the unit suite and the integration suite:**
- M5-wscan: remove `can(identity,'workspace:read')` at `current-eligibility.ts:184-189`. It survived all 41 unit tests plus 25 integration tests.
  - `notification-workspace-reach.test.ts` covers only the legacy `delivery.ts`, not the evaluator.
- M5-scope: remove `resource.workspaceId !== delivery.workspaceId` at `:175`. It survived.
  - This is partly redundant with `canonicalBinding`'s envelope check, but there is no direct test.
- M1a: remove `reaches()` at `:199`. It was killed by 2 unit tests, which rely on a mocked `reaches`. It survived the 23 integration tests: no real-DB test revokes membership and drives the real evaluator.
- M5-inactive (drop `person.active`) survived, but it is an equivalent mutant because `resolveIdentity` rejects inactive people (`resolve-identity.ts:354`). This is not a finding.

**Recommendation:** add real-DB revoke-then-drain tests for project reach and for workspace authority.

### F7. NON-BLOCKING: the reach facts omit ancestors and the owner team (fails closed)

`current-eligibility.ts:193-198` builds `ProjectReachFacts` without `ancestorProjectIds` or `ownerTeamId`. Recipients whose reach comes from an ancestor project or an owning team are suppressed wrongly. This is safe, because it can only hide notifications, but it is a correctness gap against `reaches()` steps 4 and 5.

### F8. NON-BLOCKING: residual windows inherent to the design (documented, accepted)

- **Revocation after preflight:** reach revoked between the preflight commit (`outbox-drain.ts:222-236`) and the provider call can still send once. This is inherent to sending outside the transaction.
- **Duplicate sends:** after an ambiguous result, or after a lease is lost mid-send, the provider may receive a duplicate. The idempotency key is `delivery.id`, and delivery is documented as at-least-once.
- **Repeated re-claims while a send is in flight:** while one worker is inside a provider call (≤30 s), other workers repeatedly re-claim and re-evaluate the same pending row. The fence makes this correct but busy. This is bounded by the 30 s deadline, which is shorter than the 60 s lease.

## Areas checked with no defect found

- **Fencing protocol, by reading and by probe:**
  - Every write path follows the same lock order (delivery row `FOR UPDATE`, then reservation `FOR UPDATE`, then a post-lock `clock_timestamp()` sample).
  - Every terminal or reschedule write is guarded by `state='pending'`, and the reservation delete is guarded by owner, token and live lease.
  - The renew loop aborts the provider call when the fence is lost.
  - A deadline of 30 s against a 60 s lease with 15 s renewal is consistent.
  - `completeNotificationDelivery` returning `false` after a lost lease is surfaced as `retry/ambiguous` and never treated as success.
- **Reservation purge race:**
  - The purge deletes only `lease_expires_at <= now` (`session-cleanup.ts`).
  - The insert/lock gap is retried, with a bounded retry count of 6, and is tested.
  - A purged live lease is impossible.
  - After an ambiguous result, the reservation is deliberately kept until it expires, and the retry consumes an attempt.
- **Retries:** six authorised attempts, then `dead` (tested). The backoff table is bounded. `notificationRetryDelayMs` throws outside 1..6.
- **Cross-workspace and envelope binding:** `canonicalBinding` requires:
  - the envelope id, kind, workspace and organisation to equal the delivery's;
  - the work item id and key to resolve to the same row;
  - the comment to bind to its work item.

  Scope or project drift is suppressed. These cases are tested and were mutation-killed (M1c killed 12 tests).
- **Deactivated person and API-key or impersonation:**
  - Fan-out skips inactive persons and persons with no login.
  - The evaluator resolves the *recipient's* session identity, never the actor's key, so an API-key or impersonated actor cannot widen a recipient's eligibility.
  - The list route clamps task rows to the key's `work_item:read`, and that was mutation-killed (M2-apikey).
- **Customer recipients:** internal comments are suppressed for customers (mutation-killed). Every customer send currently ends in `destination_unresolved`.
- **Instance-scoped events:** fan-out creates no external delivery children when `scope.workspaceId` is absent (`fanout.ts:141`). See F4 for the inbox side.
- **D10 read-all contract** (task rows):
  - read-all, read-one and clear-all apply the same reach predicate as list;
  - an unreachable row stays unread and hidden;
  - read-one returns 404 for unreachable, foreign and non-existent rows alike.

  There is no unread-count endpoint on this API surface, and no server count is returned (`bulkResultSchema` is `{success}`), so I found no count or oracle. The 50-row limit is applied after filtering (tested). All four task read-path mutations were killed (M2-list, M2-readall, M2-readone, M2-apikey). The F4 gap applies to non-task rows.
- **Email and content injection:**
  - The new outbox path has no adapter, so nothing is rendered or sent.
  - The projection URL is server-built (`/agent/work-items/${encodeURIComponent(key)}`).
  - On the legacy path, the notification email body goes through React Email (escaped JSX `{message}`); the subject goes to nodemailer, which encodes header values; `actionUrl` is server-built.
  - The ntfy `Title` header carries user-influenced text (for example `mentionerName`). undici rejects CR/LF in header values, so the result is a failed delivery rather than header injection. This is unchanged by this diff.
  - For the future `notify.*` adapter: it must strip CR/LF and other control characters from `title` before using it as a subject or header.
- **Approval:** external approval deliveries fail closed (`resource_mapping_mismatch`, tested), and no code reads the `approval` table. See F4 for the inbox side.

## Tests and mutations run

Baseline, on the clean export of `63d177e0` against `s4-sec-pg` database `s4sec_test`:

- **Integration:** 5 files, 93/93 tests passed.
  - `notification-outbox-delivery` (23)
  - `notification-task-reach` (9)
  - `notification-workspace-reach` (2)
  - `permissions-shadow-mode`
  - `session-cleanup-purge`
- **Unit:** 6 files, 53/53 tests passed.
  - `notification-current-eligibility` (41)
  - `delivery-ssrf`
  - `notification-resource-mapping`
  - `notification/{delivery-primitives,preferences,recipient-resolvers}`

Mutation results (each mutation was applied to the export, run, then reverted; a diff against the candidate `src` confirmed the export was pristine):

| ID | Mutation | Suite | Result |
| --- | --- | --- | --- |
| M1a | skip `reaches()` at send time | unit | killed (2) |
| M1a | same | integration outbox | **survived** (F6) |
| M1b | no re-evaluation at preflight (reuse first verdict) | integration | killed (3) |
| M1c | send-time evaluator always `eligible` | integration | killed (12) |
| M2-list | drop reach on list | task-reach | killed (6) |
| M2-readall | drop reach on read-all | task-reach | killed (2) |
| M2-readone | drop reach on single read | task-reach | killed (4) |
| M2-apikey | ignore API-key clamp on list | task-reach | killed (1) |
| M3-authz / M3-complete / M3-renew | drop fencing token | integration outbox | **survived** (F3) |
| M4-authz / M4-complete | accept a stale (expired) lease | integration outbox | **survived** (F3) |
| M4-acquire | take over a live foreign lease | integration outbox | killed (1) |
| M5-customer | drop customer-visibility suppression | unit | killed (1) |
| M5-pref | drop channel-preference recheck | integration | killed (1) |
| M5-wscan | drop workspace `can()` | unit + integration | **survived** (F6) |
| M5-scope | drop resource-workspace equality | unit + integration | **survived** (F6) |
| M5-inactive | drop `person.active` | unit + integration | survived, equivalent mutant |

Probes I wrote (scratch export only, `tests/api-integration/zz-s4-security-probe.test.ts`, 3/3 ran):

- **PROBE-A:** `canRead=false` but the verdict is `eligible`. Confirms F1.
- **PROBE-B:** five drains returned `destination_unresolved` five times; the eligible sibling stayed `pending`, `attempts 0`. Confirms F2.
- **PROBE-C:** a stale token or an expired lease is refused by authorize, renew and complete (`null,null,false` ×2); the row stays `pending`, `attempts 0`. The logic is correct; the test is missing (F3).

## Commands run

```
git -C /private/tmp/claude-501/s4 rev-parse HEAD                     # 63d177e0593a88485f91889ee0f2944c98de54df
git -C … merge-base HEAD 954eb84094e009658943af1e294d3b8a48d17f69    # = base
git -C … diff --stat / --name-status / diff 954eb840..HEAD -- <paths>
git -C … status --short                                              # clean, before and after
grep -rn -E "enqueueNotificationEvent|materializeNotificationFanout|processNextNotificationDelivery|currentEligibilityRuntime|resolveWorkspaceCreatedRecipient|evaluateCurrentNotificationReachAndPreference" apps packages tests
rsync -a --exclude .git /private/tmp/claude-501/s4/ <scratchpad>/s4x/
docker run -d --rm --name s4-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55439:5432 postgres:18-alpine
docker exec s4-sec-pg psql -U postgres -c "create database s4sec_test"
cd <s4x>/apps/api && TASKDESK_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55439/s4sec_test \
  npx vitest run --config vitest.integration.config.ts ../../tests/api-integration/{notification-outbox-delivery,notification-task-reach,notification-workspace-reach,permissions-shadow-mode,session-cleanup-purge}.test.ts
npx vitest run --config vitest.config.ts ../../tests/api/notification-current-eligibility.test.ts ../../tests/api/notification-preferences/delivery-ssrf.test.ts ../../tests/api/notification-resource-mapping.test.ts ../../tests/api/notification/
<scratchpad>/mut/run.sh <ID> <file> <old> <new> <config> <tests…>      # apply → vitest → restore, per mutation above
npx vitest run --config vitest.integration.config.ts ../../tests/api-integration/zz-s4-security-probe.test.ts --reporter=verbose --silent=false
docker stop s4-sec-pg                                                # container removed (--rm), verified absent
```

## Residual risk

- The F8 windows remain: revocation after preflight can still produce one send, and delivery is at-least-once.
- The runtime is unwired. The real risk will be decided by the wiring PR:
  - recipient resolvers;
  - the `notify.*` adapter (header and subject sanitisation);
  - scheduler loop semantics (see F2);
  - the inbox read predicate (see F4).

  That PR needs its own Sol review.
- Approvals (S3) must re-add approval reach code. Until then, approval is fail-closed externally, but it is still admitted by `RESOURCE_TYPES` for inbox rows (F4).

## What I did not check

- The full `permissions-shadow-mode.test.ts` delta (+604 lines). I ran it green but did not audit each new case.
- The OpenAPI contract diff, beyond confirming it changes descriptions only.
- Digest grouping or delivery. Digest children (`digest_id` not null) are never claimed by this drain, and no digest worker exists.
- Load or concurrency behaviour with more than 2 workers, and real SMTP or ntfy providers.
- Browser or UI notification rendering.
- Migrations 0110/0111/0114/0115. They are unchanged by this diff and already on main.
- The S3 approval code held out of this slice.
- `resolveIdentity` internals, beyond the `active` check.

## Closure at 52d5d770

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s4-security-review-opus (the same reviewer context as the first pass; it is independent of the author and of the remediation)
**Reviewed head:** 52d5d7704777d506be68b0f516c104b0b0b3d17f

**Verdict: CHANGES REQUIRED (BLOCKED) on one new BLOCKING finding, N1.**

- F1, F2 and F3 are closed under a UTC process time zone.
- N1 shows that the outbox repository and the new back-off depend on the process time zone. Under any zone behind UTC the drain delivers nothing and F2's starvation comes back. Under any zone ahead of UTC, leases and back-offs stretch by the offset.
- N1 was already present at 63d177e0 and I missed it in my first pass. It is a defect class this repository already documents (`apps/api/src/utils/db-time.ts`, `scheduler/leader-lock.ts`).
- Once N1 is fixed with time-zone tests, I expect clearance. Everything else below is non-blocking.

**Scope:**
- Remediation commit: `git diff 63d177e0..52d5d770`, 9 files, +872/−39.
- Re-checked `954eb840..52d5d770` as a whole for new leak paths.
- HEAD verified as `52d5d7704777d506be68b0f516c104b0b0b3d17f`. The worktree was clean before and after.
- Fresh rsync export at `scratchpad/s4y`. One fresh `s4-sec-pg` container (postgres:18-alpine, `--rm --tmpfs /var/lib/postgresql`), now stopped and removed.
- I trusted nothing in the author's addendum 2.

### Per-finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| **F1** reach without `work_item:read` | **CLOSED** | See F1 below. |
| **F2** poison-row starvation | **CLOSED under TZ=UTC; REOPENS under TZ behind UTC (N1)** | See F2 below. |
| **F3** fencing tests | **CLOSED** | See F3 below. |
| **F4** inbox reach only for `task` | **PARTIAL, as agreed** | See F4 below. |
| **F5** legacy workspace delivery | OPEN, non-blocking, documented | Pre-wiring gate (3). |
| **F6** untested workspace and scope checks | **CLOSED** | See F6 below. |
| **F7** ancestors and owner team omitted | OPEN, non-blocking, documented | Pre-wiring gate (5). Over-suppresses only. |
| **F8** inherent windows | Accepted residual | No change. |

**F1:**
- `current-eligibility.ts:201-211` now requires `can(identity,"work_item:read","work_item",{workspaceId, organisationId, workItemProjectId, projectId})` after `reaches()`. The scope target is correct for every grant tier (`requiredIdFor`).
- PROBE-A, re-run: project role capabilities set to `[]`. `canRead=false`, the verdict is `suppress/read_authority_lost`, the drain result is `suppressed`, `sent=0`, and the row is `suppressed`, `attempts 0`.
- The fixture now grants `["work_item:read"]`.
- Removing the new `can()` (M1-can) is killed by both the integration suite (1) and the unit suite (1).

**F2:**
- Unresolved results, evaluator errors and reservation contention now move the row forward by 30 s under the delivery lock (`outbox-drain.ts` `backOff`), releasing the reservation when one is held.
- PROBE-B under UTC:
  - call 1 returned `destination_unresolved`;
  - call 2 returned `delivered` for the sibling;
  - calls 3 and 4 returned `idle`.
- PROBE-B under America/New_York **failed**. All four calls returned `unresolved`, `sent=0`, and the backed-off row's `next_attempt_at` sat about 4 h in the past. See N1.
- M2-nobackoff, M2-evalcatch and M2-renewcatch are killed.

**F3:**
- New fencing tests cover all five writers: authorize, renew, complete, defer and release. Each is tested with a foreign token and with an expired lease, plus a same-delivery stale holder.
- I killed all 10 JS-check mutations except two (M3/M4 for authorize, complete, defer and release; see the mutation table).
- M3-renew and M4-renew (JS check only) survive. They are **equivalent mutants**, because renew's `UPDATE … WHERE lease_token = … AND lease_expires_at > …` re-guards the same facts in SQL. The full mutants that remove both the JS and the SQL guards are killed (2 and 1 tests).
- PROBE-C, extended to defer and release: stale-token authorize and renew returned `null`, and complete, defer and release returned `false`. Expired-lease calls gave the same results. The row stayed `pending`, `attempts 0`.

**F4:**
- `approval` is removed from `RESOURCE_TYPES` (`fanout.ts:56-61`), and an unknown type is silently skipped (`continue`).
- The integration test "F4 fan-out writes no inbox row for an approval resource and does for a work item" exercises the real `materializeNotificationFanout`.
- The pre-wiring gates (1)–(6) are written identically into `background-jobs.md` and `notifications.md`. They cover:
  - the inbox read predicate, per type and failing closed, with the instance-admin gate;
  - the approval exclusion;
  - the legacy workspace path;
  - fan-out tests;
  - ancestors and owner team;
  - adapter CR/LF sanitisation.
- The read-path gap itself is unchanged, as agreed for the unwired state.

**F6:**
- The new tests are real-DB, revoke-then-drain tests, and they kill the mutants at integration level:

| Mutation | Test that fails |
| --- | --- |
| M1a (drop `reaches`) | "F6 suppresses after project reach is revoked, then drains again once restored" |
| M5-wscan | "F6 suppresses a workspace notification after workspace authority is removed" |
| M5-scope | "F6 suppresses when the resource's workspace differs from the delivery's workspace" |

- I read the bodies and confirmed they mutate memberships and rows in Postgres and drive `currentEligibilityRuntime`. Mocks are not involved.

### New findings

**N1. BLOCKING: the outbox timestamps depend on the process `TZ`, which breaks the lease, the fencing and the F2 back-off off UTC.**

**Where:** `notification-delivery.repository.ts`, every interpolated JS `Date` bound into a `timestamp without time zone`:
- `${sampledAt}::timestamp + interval '60 seconds'` (acquire and renew);
- the `${sampledAt}::timestamp` comparisons and `updated_at`;
- `${update.until}` and `${until}` (defer, `updateUnreservedNotificationDelivery`);
- `${current.leaseExpiresAt}::timestamp`;
- the new `backOff` in `outbox-drain.ts`, which builds `new Date(Date.now()+30_000)` and passes it through those same paths.

**Mechanism:** raw `sql` template parameters go through node-postgres, which serialises a `Date` as process-local time with an offset. PostgreSQL drops the offset when it casts to `timestamp`. The column convention, though, is UTC wall clock (`db-time.ts` documents exactly this landmine, and session-cleanup has ahead and behind time-zone tests for it).

**Measured** (PROBE-E, `acquireNotificationReservation` then reading `lease_expires_at − clock_timestamp() AT TIME ZONE 'UTC'`):

| Process TZ | Effect |
| --- | --- |
| UTC | Lease TTL `00:00:59.998`. Correct. |
| Asia/Yangon (+06:30; this host's own zone) | Lease TTL `06:30:59.998`. Every lease, ambiguous hold and back-off lasts 6.5 h too long. After a crash or an ambiguous send, the key is blocked for 6.5 h. The 30 s back-off becomes 6 h 30 m (PROBE-B: `due_in 06:30:29`). |
| America/New_York (−04:00) | `acquireNotificationReservation` throws `NotificationReservationContentionError` on a fresh key. No delivery can ever acquire a reservation. With 52d5d770's contention back-off, the row is moved about 4 h **into the past**, so it is re-claimed first forever. **F2's head-of-line starvation returns**: PROBE-B gave 4/4 `unresolved` and `sent=0`. |

**Suite result:** under `TZ=America/New_York`, the candidate's own `notification-outbox-delivery` suite fails 20 of 40 tests.

**Pre-existing:** at 63d177e0, 9 of 23 tests failed under NY, so this was there before the remediation and I missed it in my first review. The remediation makes it worse, because F2's fix now rests on these writes.

**Confidentiality:** the effect stays fail-closed. I observed no double send or leak under either offset. This is an integrity and availability defect of the outbox mechanism.

**Exposure:** the shipped image sets no `TZ`, so it defaults to UTC. But the project explicitly treats non-UTC process zones as a supported, tested condition, and customer deployments set `TZ`.

**Fix:**
- Bind UTC wall-clock strings (`until.toISOString()`, or the `db-time.ts` convention), or do the arithmetic in SQL (`clock_timestamp() AT TIME ZONE 'UTC' + interval …`).
- Read DB timestamps without local-time parsing.
- Add ahead-of-UTC and behind-UTC runs of the outbox suite, following `session-cleanup-server-ahead/behind-of-utc.test.ts`.

**N2. NON-BLOCKING: a permanent evaluator error is hidden forever.**
- `outbox-drain.ts`: `catch {}` on the first evaluation and `.catch(() => null)` on preflight both swallow the error without logging or a metric.
- PROBE-D: an always-throwing evaluator gave `deferred/evaluator_error` three times. The row stays `pending`, `attempts 0`, `last_error evaluator_error`, and is re-evaluated every 30 s with no dead-letter or age bound.
- Starvation: none under UTC. Backed-off rows re-enter in `next_attempt_at` order behind already-due rows, so every row still gets turns. The cost is one claim plus an evaluation per backed-off row every 30 s. That is the same for unresolved rows, which by contract stay pending until the quiet-hours and destination contracts land.
- **Recommendation:** log or count the swallowed error with the delivery id, and add an age- or count-based dead-letter for `evaluator_error`. Unresolved rows are intentionally pending.

**N3. NON-BLOCKING: two new catch paths are untested.**
- Replacing the preflight `.catch(() => null)` with nothing (M2-preflightcatch) survives.
- Rethrowing instead of backing off on `NotificationReservationContentionError` (M2-contention) survives.
- Under UTC both behave correctly by reading. They need one test each.
- Note that non-contention errors from acquire still propagate without back-off, for example "Database wall-clock sample was unavailable". The claim lock is not held, so the row stays at the head until the condition clears. This is transient-only.

**N4. NON-BLOCKING: `renewalIntervalMs` / `providerDeadlineMs` are unvalidated.**
- They are optional, default to 15 s and 30 s, and have no production caller. A grep finds only the declaration and the defaults. No environment variable, config or chart feeds them, so production cannot misconfigure them today.
- They are unbounded, though:
  - an interval of 60 s or more (the lease length), or a deadline over 60 s, lets the lease lapse mid-send, so a second worker can take over and send a duplicate;
  - `0`, a negative value or `NaN` makes the renewal loop spin transactions as fast as it can.
- **Recommendation:** clamp or reject at the function boundary (interval < lease/2, deadline < lease, finite > 0), or make them test-only.

**Renewal-failure abort path: no defect.**
- `renewUntilStopped(...).catch(e => controller.abort(e))` converts a renewal DB error into an abort of the provider call, giving an `ambiguous` outcome. `completeNotificationDelivery(ambiguous)` then keeps the reservation until expiry, if it is still live.
- If the send already succeeded, the `finally` abort stops the loop and `await renewal` cannot reject, so the `delivered` commit proceeds.
- There is no unhandled rejection; M2-renewcatch is killed, including vitest's "Unhandled Errors" detection.

**Diff shape `954eb840..52d5d770`: no new leak path.**
- No route, controller or read predicate changed.
- `can()` only narrows.
- The `fanout` set only shrinks.
- `claimNext…` changed only a comment.
- The docs changes are the gate list.
- The send projection is unchanged: stored title and body plus the server-built `staffUrl`.

### Tests, probes and mutations (closure)

Every run below used `TZ=UTC` unless marked otherwise.

**Baseline:**
- Integration: 5 files, 110/110 passed.
  - `notification-outbox-delivery` (40)
  - `notification-task-reach`
  - `notification-workspace-reach`
  - `permissions-shadow-mode`
  - `session-cleanup-purge`
- Unit: 6 files, 54/54 passed.

**Time-zone runs** (outbox suite plus closure probes):

| Process TZ | Result |
| --- | --- |
| UTC | 44/44 passed |
| America/New_York | 20 failed / 24 passed |

At 63d177e0 under America/New_York, the outbox suite failed 9 of 23.

**Probes** (`tests/api-integration/zz-s4-closure-probe.test.ts`, export only):

| Probe | Result |
| --- | --- |
| A | Closed |
| B | Closed under UTC; fails under America/New_York |
| C | All 10 stale or expired calls refused |
| D | N2 |
| E | N1 |

**Mutations killed:**

| Mutation | Tests failed |
| --- | --- |
| M3-authz | 2 |
| M4-authz | 1 |
| M3-complete | 3 |
| M4-complete | 1 |
| M3-defer | 2 |
| M4-defer | 1 |
| M3-release | 2 |
| M4-release | 1 |
| M3-renew-full | 2 |
| M4-renew-full | 1 |
| M1a (integration) | 1 |
| M1-can (integration) | 1 |
| M1-can (unit) | 1 |
| M5-wscan (integration) | 1 |
| M5-scope (integration) | 1 |
| M2-nobackoff | 1 |
| M2-evalcatch | 1 |
| M2-renewcatch | 1 |

**Mutations survived:**
- M3-renew and M4-renew, JS check only. These are equivalent: the SQL re-guards the same facts.
- M2-preflightcatch and M2-contention. These are N3.

### Commands (closure)

```
git -C /private/tmp/claude-501/s4 rev-parse HEAD; git status --short; git log --oneline 63d177e0..HEAD
git diff --stat 63d177e0..HEAD; git diff 63d177e0..HEAD -- apps docs tests
rsync -a --exclude .git /private/tmp/claude-501/s4/ <scratchpad>/s4y/
docker run -d --rm --name s4-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55439:5432 postgres:18-alpine
docker exec s4-sec-pg psql -U postgres -c "create database s4sec_test"
TASKDESK_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55439/s4sec_test npx vitest run --config vitest.integration.config.ts <5 integration files>
npx vitest run --config vitest.config.ts <6 unit files>
TZ={UTC,America/New_York} npx vitest run --config vitest.integration.config.ts notification-outbox-delivery.test.ts zz-s4-closure-probe.test.ts
TZ={UTC,America/New_York,Asia/Yangon} npx vitest run … zz-s4-closure-probe.test.ts -t PROBE-E --reporter=verbose
(s4x export @63d177e0) TZ=America/New_York npx vitest run … notification-outbox-delivery.test.ts
<scratchpad>/mut/run.sh and run-line.sh (apply → TZ=UTC vitest → restore), per mutation listed
grep -rn "renewalIntervalMs|providerDeadlineMs|processNextNotificationDelivery(" apps packages; grep TZ Dockerfile deploy charts
docker stop s4-sec-pg   # removed (--rm), verified absent
```

### Residual risk (closure)

- **N1** until it is fixed.
- After N1, the F8 windows remain: one send is possible after revocation at preflight, and delivery is at-least-once.
- **N2:** permanent evaluator failures are silent.
- **N3:** two catch paths are untested.
- **N4:** the option parameters are unvalidated.
- F4, F5 and F7 stay open as documented pre-wiring gates.
- The wiring PR (resolvers, adapter, scheduler loop, inbox predicate) still needs its own Sol review.

**Not checked:** digest delivery, behaviour with more than 2 concurrent workers, real providers, `permissions-shadow-mode` case-by-case, and fan-out beyond the F4 approval/work-item test.

## Closure at 34bf9c38

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s4-security-review-opus (the same reviewer context; it is independent of the author and of all three remediations)
**Reviewed head:** 34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66

**Verdict: CLEARED (PASS) at the Sol security tier for this candidate.**

- I found no BLOCKING findings and no new leak path.
- N1 is closed and covered by tests that run in CI.
- N2, N3 and N4 are fixed. N2's log line has no test (NB-1 below).
- The remaining items are non-blocking and are recorded as pre-wiring gates.
- The clearance applies to this exact SHA only.

**Scope:**
- Remediation commit: `git diff 52d5d770..34bf9c38`, 11 files, +1992/−1561. Most of the size is the outbox suite moving into `helpers/notification-outbox-suite.ts`.
- Re-checked the whole of `954eb840..34bf9c38` (33 files, +5709/−74).
- HEAD verified as `34bf9c38a7cfad3a8d0317d7d0db57019b7dfa66`. The worktree was clean before and after.
- Fresh export at `scratchpad/s4z`. Fresh `s4-sec-pg` container (`--rm --tmpfs /var/lib/postgresql`), now stopped and removed.
- I trusted nothing in Addendum 3.

### Per-finding status

| Finding | Status | Evidence |
| --- | --- | --- |
| F1 reach without `work_item:read` | CLOSED | PROBE-A gives `canRead=false`, `suppress/read_authority_lost`, `sent=0`, in all three zones. M1-can (integration) still makes a test fail. |
| F2 poison row starves the queue | CLOSED in every zone tested | PROBE-B, with process and DB session both in the zone: in UTC, America/New_York and Asia/Yangon the results are `unresolved` → `delivered` → `idle` → `idle`, and the backed-off row is `due_in 00:00:29.97–.98`. M2-nobackoff makes 2 tests fail. |
| F3 fencing tests | CLOSED | M3-authz, M4-authz and M3M4-all-JS (the JS token and expiry checks removed across complete, defer and release) each make tests fail. PROBE-C: all 10 stale or expired calls are refused in every zone. |
| F4 inbox reach only for `task` | PARTIAL, as agreed | Unchanged. Pre-wiring gates (1)–(2). |
| F5 legacy workspace delivery | OPEN, non-blocking | Gate (3). |
| F6 untested workspace and scope checks | CLOSED | Unchanged from 52d5d770. M1-can (integration) re-confirmed. |
| F7 ancestors and owner team omitted | OPEN, non-blocking | Gate (5). |
| F8 inherent windows | Accepted residual | No change. |
| **N1** process/session time-zone dependence | **CLOSED** | See N1 below. |
| **N2** silent permanent evaluator error | **FIXED (log), non-blocking residual** | See N2 below. |
| **N3** untested catch paths | **CLOSED** | M2-preflightcatch and M2-contention each make their new test fail. |
| **N4** unvalidated timings | **CLOSED** | See N4 below. |

**N1**
- Every JS instant bound into a `timestamp` column in `notification-delivery.repository.ts` now goes through `utc()` (`toISOString()::timestamp`). That covers `sampledAt`, `until`, `update.until` and `leaseExpiresAt`.
- Values read back come through drizzle as strings and are parsed as UTC by `utcDate`. This is proven by the tests passing under non-UTC process zones.
- Fan-out writes `next_attempt_at`, `created_at` and `updated_at` from `dbNowUtc()`.
- Grep result over the repository, `fanout.ts`, `outbox-drain.ts` and `current-eligibility.ts`:
  - no `${date}` binding is left without `utc()`;
  - no bare `now()` is left;
  - the only JS clock left is `backOff`'s `Date.now()+30 s`, which goes through `utc()`. App-to-DB clock skew is the only residual there.
- PROBE-E lease TTL is `00:00:59.99` in UTC, New York and Yangon. A second worker gets `deferred` and the first worker still authorises.
- The outbox suite passes 50/50 in every combination I tried:
  - process zone UTC, New York or Yangon, each with the DB session at its default and with the session in the same zone;
  - a cross run with the process in New York and the session in Yangon.
- Mutations:

| Mutation | Effect | Tests failed |
| --- | --- | --- |
| MN1-utc-bare | `utc()` binds a bare Date | 22 |
| MN1-until-only | one `until` site reverted | 4, in the ahead and behind files |
| MN1-lease-only | lease SET reverted | 20 |
| MN1-fanout-now | fan-out uses `now()` | 1, in the ahead file |
| MN1-fanout-default | fan-out uses column defaults | 1, in the ahead file |

**N1 tests in CI**
- `ci-full.yml` → job `integration` (runs on every pull request, unconditionally when the change scope is full) → `pnpm test:integration` → turbo → `apps/api` `vitest.integration.config.ts`.
- Its `include` is `../../tests/api-integration/**/*.test.ts`, so both `notification-outbox-delivery-ahead-of-utc.test.ts` and `…-behind-utc.test.ts` run.
- The shared helper is not a `*.test.ts` file, so it is not double-run.
- Each file asserts that it is really off UTC: `getTimezoneOffset() != 0` and `current_setting('TimeZone')` equals its zone. Both assertions passed in my verbose run.
- They follow the existing `session-cleanup-server-{ahead-of,behind}-utc` precedent, which also uses `PGOPTIONS`.
- A full 7-file run in one invocation, with the TZ files before the other suites, passed 222/222.

**N2**
- Both catch paths call `logEvaluatorFailure()`, which emits only `logTaskDesk({module:"jobs", message:"jobs.failure", level:"error", result:"failed"})`. These are constant, allowlisted values (`observability/logger.ts:24`).
- No error object, message, delivery id, person id or payload is logged, so **nothing leaks**.
- The trade-off is that operators cannot tell which row is failing. The row's `last_error=evaluator_error` is the only pointer.
- "Retried forever every 30 s, with no dead-letter" is now recorded as pre-wiring gate (7) in both documents.

**N4**
- `assertDrainTimings` runs **before** the claim. A rejected call therefore touches no row (tested: the row stays `pending`, 0 attempts, `last_error` null).
- The bounds are correct:
  - renewal interval: finite, above 0 and below lease/2 (30 s), so at least two renewals fit in one lease;
  - deadline: finite, above 0 and below the lease (60 s).
- The defaults are named constants, pinned by `drain-timing-defaults.test.ts`.
- MN4-noassert makes 7 tests fail. The two boundary mutations (`>=` → `>` at 30 000 and at 60 000) each make 1 test fail, so the boundaries are exact.
- There is still no production caller and no env or config input.

### New findings (non-blocking)

**NB-1. The N2 `jobs.failure` emission is untested.** MN2-nolog (removing the log call) survives. Before wiring, add a `logTaskDesk` spy assertion, which would also pin that no extra fields are logged.

**NB-2. Test hygiene: TZ and PGOPTIONS are not restored.** The ahead and behind files set `process.env.TZ` and `PGOPTIONS` and never restore them. The session-cleanup precedent deletes `PGOPTIONS` in `afterAll`. It is harmless under vitest's default per-file isolation, and my combined 7-file run stayed green, but it should match the precedent.

**NB-3. Column defaults are still session-local (pre-wiring gate (8), documented).**
- The `notification_delivery` timestamp columns default to `now()`.
- I re-observed it with my own probe fixture, which relied on the default: under a DB session in Asia/Yangon a new row sat 6 h 30 m in the future and was not claimable (PROBE-B returned 4 × `idle`). Writing UTC explicitly fixed it.
- Fan-out, the only production writer, is correct and has a mutation-killing test.
- A migration that changes the defaults to `(now() AT TIME ZONE 'UTC')` would remove the trap for future writers. This affects availability only (fails closed); there is no leak.

**Full diff `954eb840..34bf9c38`: no leak path.**
- The runtime file set is unchanged since the first pass.
- This commit touches only the repository, primitives, fan-out and drain: timestamp binding, timing validation and logging.
- No route, controller, read predicate, recipient resolution or projection content changed.

### Commands

```
git -C /private/tmp/claude-501/s4 rev-parse HEAD; git status --short; git log/diff --stat 52d5d770..HEAD; git diff 52d5d770..HEAD -- apps docs tests/api <tz files>
grep JS-Date / now() paths in notification-delivery.repository.ts, fanout.ts, outbox-drain.ts, current-eligibility.ts, repository.ts, preferences.ts
grep logTaskDesk / jobs.failure in apps/api/src and observability/logger.ts
sed .github/workflows/ci-full.yml; turbo.json test:integration; apps/api/vitest.integration.config.ts include
rsync -a --exclude .git /private/tmp/claude-501/s4/ <scratchpad>/s4z/
docker run -d --rm --name s4-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55439:5432 postgres:18-alpine; createdb s4sec_test
TZ=UTC npx vitest run --config vitest.integration.config.ts <7 S4 integration files>      # 222/222
npx vitest run --config vitest.config.ts <S4 unit files>                                  # 56/56
TZ={UTC,America/New_York,Asia/Yangon} [PGOPTIONS="-c timezone=<same>"] npx vitest run … notification-outbox-delivery.test.ts   # 50/50 each
TZ=America/New_York PGOPTIONS="-c timezone=Asia/Yangon" npx vitest run … notification-outbox-delivery.test.ts                  # 50/50
npx vitest run … *-ahead-of-utc.test.ts *-behind-utc.test.ts --reporter=verbose          # 102/102, off-UTC guards pass
TZ=<zone> PGOPTIONS="-c timezone=<zone>" npx vitest run … zz-s4-closure-probe.test.ts --reporter=verbose   # PROBE-A/B/C/E, 3 zones
mut/run.sh (apply → TZ=UTC vitest → restore): MN1-*, MN4-*, MN2-nolog, M2-preflightcatch, M2-contention, M1-can-int, M2-nobackoff, M3-authz, M4-authz, M3M4-all-JS
docker stop s4-sec-pg   # removed, verified absent
```

### Residual risk

- **F8:** one send is still possible after revocation at preflight, and delivery is at-least-once.
- **App-to-DB clock skew** on the 30 s back-off.
- **Unbounded retry of `evaluator_error`** (gate 7). The log line is sound but has no test (NB-1).
- **Pre-wiring gates still open:**
  - F4 inbox read predicate;
  - F5 legacy workspace path;
  - F7 reach facts;
  - fan-out coverage;
  - adapter CR/LF sanitisation;
  - NB-3 column defaults.
- **The wiring PR** (resolvers, `notify.*` adapter, scheduler loop, inbox predicate) needs its own fresh Sol review. This clearance does not extend to it.

**Not checked:**
- digest delivery;
- behaviour with more than 2 concurrent workers;
- real providers or SMTP;
- an actual GitHub Actions run (I checked inclusion by configuration only);
- the `permissions-shadow-mode` tests case by case;
- the helper-suite move, beyond confirming it still has 50 tests and that the ahead and behind wrappers execute it.

## Rebind at f7b97a6b

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:3a9e9ce4-8409-47d4-b1be-1f1544697e70/s4-security-review-opus (the same reviewer context; it did not author the merge)
**Reviewed head:** f7b97a6b2e8d2667776415ec3656562e22c4a479

**Verdict: CLEARED (PASS). The 34bf9c38 Sol clearance rebinds to f7b97a6b unchanged.**
- The S4 delta is preserved exactly.
- S2 (#627) does not change S4's send-time eligibility or its suppression reasons.
- The S4 security suites and probes pass on a fresh export.
- No new findings. The 34bf9c38 non-blocking items and pre-wiring gates carry over unchanged.

**1. Diff equivalence**
- HEAD `f7b97a6b` is a merge with parents `34bf9c38` and `7486809f`.
- `954eb840` is an ancestor of `7486809f`, and it is the merge base of `7486809f` and `34bf9c38`.
- `git diff 7486809f HEAD` and `git diff 954eb840 34bf9c38` match:
  - both are 33 files, +5709/−74;
  - the changed-file lists are byte-identical (`cmp`);
  - the SHA-1 of the added and removed lines matches **file by file for all 33 files**.
- That includes the two conflict files. `docs/07-planning/decision-log.md` and `tests/api-integration/permissions-shadow-mode.test.ts` have combined change-line hashes of `b1802068…` on both sides.
- So the "keep both" and "union of imports" resolutions add nothing beyond S4's own lines against the new main. The import union is `inArray` plus `grantProjectRole`, exactly S4's additions.

**2. Interaction with S2 (#627)**

`954eb840..7486809f` touches these runtime files:
- `resolve-identity.ts`
- `resolve-request-identity.ts` (new)
- `verify-api-key.ts`
- `shadow-middleware.ts`
- `strict-policy-enforcement.ts`
- `index.ts`
- `auth/*`
- `schema.ts` plus migration 0120 (approval workspace anchor)

**`resolveIdentity`:**
- The change is comments only. With comment lines filtered out of the diff, nothing remains.
- The banned → `null` and inactive-person → `null` refusals already existed (S6, `resolve-identity.ts:354`).
- So the evaluator's recipient resolution, `resolveIdentity({userId, credential:"session"}, tx)`, behaves exactly as it did at 34bf9c38.

**`verifyApiKey` owner-state check (`apiKeyOwnerIsActive`):**
- It runs only on the request authentication path.
- The S4 evaluator resolves the *recipient* with `credential:"session"` and never verifies a key, so the change cannot affect send-time eligibility.
- On the read side, a banned or inactive owner's API key now gets a 401 before `GET /api/notification` runs. That is strictly tighter, and S4's `credentialCanReadTask` clamp is unchanged.

**The `resolve-request-identity` / inactive-identity 403:** request-layer only. The notification routes still filter by `c.get("userId")` and the S4 reach predicates are unchanged.

**Migration 0120 / approval anchoring:** S4 still reads no `approval` table, and `approval` stays out of the fan-out `RESOURCE_TYPES` (F4).

**Suppression reasons:** unchanged. A new real-DB probe, PROBE-F, drains a `work_item.assigned` child after the recipient changes state. It gave the same result in UTC, America/New_York and Asia/Yangon:

| Recipient state | Drain result | Row | Sent |
| --- | --- | --- | --- |
| User banned after enqueue | `suppressed / recipient_identity_unavailable` | `suppressed`, 0 attempts | 0 |
| Person deactivated after enqueue | `suppressed / recipient_inactive` | `suppressed`, 0 attempts | 0 |

**3. Tests**

Run on a fresh export (`scratchpad/s4r`) of f7b97a6b against a fresh `s4-sec-pg` (`--rm --tmpfs`), which has since been stopped and removed:
- **S4 security integration files, `TZ=UTC`:** 7 files, 224/224 passed. The files are:
  - `notification-outbox-delivery`
  - `-ahead-of-utc`
  - `-behind-utc`
  - `notification-task-reach`
  - `notification-workspace-reach`
  - `permissions-shadow-mode`
  - `session-cleanup-purge`

  There are 224 tests rather than 222 because main's `permissions-shadow-mode` has more cases.
- **S4 unit files:** 7 files, 56/56 passed.
- **Probes**, with process and DB session in UTC, America/New_York and Asia/Yangon: A, B, C, E and F pass, 6/6 in every zone. PROBE-B is `unresolved` → `delivered` → `idle` → `idle` with a 29.98 s back-off.

The candidate worktree was clean before and after.

**Commands**
```
git -C /private/tmp/claude-501/s4 rev-parse HEAD; git status --short; git log -3 --format='%H %P %s'
git merge-base 7486809f 34bf9c38; git merge-base --is-ancestor 954eb840 7486809f
git diff --stat 7486809f HEAD; git diff --stat 954eb840 34bf9c38
git diff --name-only 7486809f HEAD > a; git diff --name-only 954eb840 34bf9c38 > b; cmp a b
per file f: git diff <range> -- f | grep '^[+-]' | grep -v '^+++\|^---' | shasum   (both ranges, all 33 files; conflict files also combined)
git diff --name-only 954eb840 7486809f; git diff 954eb840 7486809f -- resolve-identity.ts verify-api-key.ts (non-comment lines filtered)
rsync -a --exclude .git /private/tmp/claude-501/s4/ <scratchpad>/s4r/   (+ probe file with PROBE-F)
docker run -d --rm --name s4-sec-pg --tmpfs /var/lib/postgresql -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55439:5432 postgres:18-alpine; createdb s4sec_test
TZ=UTC npx vitest run --config vitest.integration.config.ts <7 S4 integration files>     # 224/224
npx vitest run --config vitest.config.ts <S4 unit files>                                 # 56/56
TZ=<zone> PGOPTIONS="-c timezone=<zone>" npx vitest run … zz-s4-closure-probe.test.ts --reporter=verbose   # 3 zones, 6/6 each
docker stop s4-sec-pg   # removed, verified absent
```
<!-- END REPORT (sha256 b5b26cde3d0e29daf885adb9caec3191e27af67e4acbc863c95d8efd018946d0) -->
