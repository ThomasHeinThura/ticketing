# Independent GPT-6 Sol security review — PR #579 P0 bulk candidate

**Reviewed head:** `b58c965426752f19a25d287bfb9000c678b0dd98`

- **Reviewer/model:** fresh GPT-6 Sol security-review context.
- **Independence:** I did not author, direct, or remediate this candidate or either earlier 866 finding. I made no source edit, commit, push, merge, deployment, or external message.
- **Checkout:** frozen clean `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`; HEAD matched the reviewed SHA before and after this pass.
- **Comparison:** complete current delta from the previously cleared `b8d0bbc48087128189a4e58dfe4813f78f344f7d` to b58; prior blocked 866 reports and all three current independent Luna CLEAR reports were treated as evidence, not as this review.
- **Verdict:** **CLEAR for the required exact-head security review.** No blocking security, authority, or gate-semantics finding. This supports functionally reviewed development delivery under the standing DEV decision only; it does not clear protected acceptance or the separate P0 phase finalizer.

## Scope and reasoning

Read the repository operating instructions, workflow, status, decision log, CI security-scope rule, private exact-head packet and terminal evidence, all three current Luna reports, and the prior independently cleared b8 Sol note. Inspected the complete 60-file b8→b58 inventory, then the changed security-scope E2E fixture, `scripts/ci/check-contrast.mjs` and its red probes, and the route-policy fixture/tests/CI contract. Traced the changed task controls, move popover, status/assignee optimistic ledger, sidebar/nav capability branch, and relevant unchanged API authorization boundaries.

The route-policy fixture now constructs the real `createApp` router with explicit built and missing static roots. The test compares route keys, route registration count, and middleware collection across those roots; it does not exclude or lower the five declared catch-all middleware registrations. The API's static middleware registration is unconditional, and missing roots change only document responses. I noted an old conditional-registration comment above `resolveStaticRoots` in `apps/api/src/index.ts`; source registration, test and current CI documentation agree on the actual unconditional behavior. This comment is a non-blocking documentation cleanup.

The contrast checker changes recognize memo-wrapped components, reachable state and backdrop branches, and imported caller surfaces. The added tests include unknown-state rejection, unsupported caller-surface rejection, stale/missing occurrence binding and translucent-surface terminal checks. I found no pass-on-error branch, lowered threshold, narrowed source inventory, or bypass of manifest occurrence binding. The large `pairs.json` rewrite is backed by the focused checker suite and the separately attributed 228-pair exact-source run in Luna C's report.

Task controls continue to use the current complete `['task', id]` cache for mutation payloads, including version; the popover refreshes status from that cache. The new per-client, per-task/field optimistic ledger rolls back to the confirmed field after failures and preserves unrelated current-cache fields. It affects UI/cache state only. The v2 full-task API still requires task reach, `work_item:update`, assignee permission, and a quoted `If-Match` comparison after task locking; narrow status/assignee routes retain their documented field-scoped behavior. No API policy, auth, migration, schema or permission-registry source changed in this delta. The earlier 866 overlap and duplicate-dialog defects are closed in the current source and independently checked by the ordinary panel.

The lazy sortable nav mounts only while the server-derived `updateProjects` capability is true, drops drag state on unmount, and leaves static project links during load or permission absence. The unchanged reorder API requires workspace access and `project:update`; client visibility cannot grant authority. Board create and list changes add no route or authority grant.

## Checks actually run

- `node --test scripts/ci/check-contrast.test.mjs`: **49 tests / 1 suite passed**, 0 failed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.permissions.config.ts ../../tests/permissions/route-coverage.test.ts`: **17 tests / 1 file passed**, 0 failed.
- An initial `pnpm exec vitest run --config vitest.config.ts tests/permissions/route-coverage.test.ts` did not run tests because root has no `vitest` binary; the correct API-workspace invocation above passed. This setup invocation is not counted as a test failure or pass.
- Final `git status --short` was clean and HEAD remained b58. No broad unchanged suite, canonical performance workload, image build, or browser journey was rerun by this reviewer.

Separately attributed exact-head receipts inspected: hosted PostgreSQL **136 files / 1,649 tests**, web **106 / 429**, UI **60 / 306**, G4 and E2E passed; immutable image/runtime operator assessment binds b58 and records revision, nonroot UID, health, accepted migration prefix, CAS/auth/metrics negatives, **129** selected requests, **28/28** eligible sources, **44** tally rows / **127** occurrences, zero unexplained/uncovered and cleanup errors, and the sole WebSocket delegation. This is receipt review, not my execution of those suites. The capture is a partial October 5 UTC observation; the program has two partial actual UTC dates, not three.

## Findings and residuals

- **Blocking security findings:** none.
- **Non-blocking security findings:** none.
- **Non-blocking documentation finding:** the stale conditional static-registration comment in `apps/api/src/index.ts` conflicts with the code and current CI guide; update it with the next relevant source change, without altering the reviewed gate behavior.
- **Protected acceptance remains blocked:** hosted G11 is **18/22** with four latency budget failures (LCP 2572 ms, state 232.4 ms, assignment 206.6 ms, board 629 ms); G8 lacks the new native-scroll Linux baseline; the review-template status still needs this committed exact-head note. No gate is waived. The third UTC date, protected exact-head checks/merge, and a fresh independent P0 phase finalizer remain outstanding.

This report is a security review of the exact candidate, not an approval of human P4 design review, production deployment, or stage completion.
