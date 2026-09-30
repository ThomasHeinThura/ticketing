# GPT-6 Sol security review — PR #506 notification task reach

**Verdict:** PASS — no blocking security defect found.
**Reviewer:** GPT-6 Sol, fresh independent context; runtime session ID was not exposed.
**Reviewed head:** `9795615d072c07056ba821b8e37517f960d9dc5e`
**Review date:** 2026-09-29

## Scope inspected

- Notification list reach filtering, including deleted-project and orphan task-backed rows before pagination.
- Single notification read and read-all SQL updates, including user ownership and current work-item reach.
- Task reach predicates and creation/delivery-time reach checks.
- Notification preference reads after workspace reach changes.
- Relevant route policy and schema context.

## Findings

No blocker. List reads omit notifications whose task/project is no longer reachable. Individual-read and read-all update predicates enforce current reach in the same SQL statement as the read-state mutation. Creation and delivery recheck current reach; workspace-scoped preference reads also filter current reach. Hidden or deleted task notifications remain unread, as specified by the user's decision; the inbox omits them while reach is absent.

## Verification

- Focused isolated-Postgres check: `permissions-shadow-mode.test.ts -t 'notification self-read shadow evidence'` — 1 file, 3 passed, 19 skipped by the test filter.
- Exact-head CI integration: 117 files, 1,493 tests passed.

## Non-blocking residual

The existing `self` notification route permits an API key with limited permissions to read its owner's task notification content without a `work_item:read` capability check. This behavior predates PR #506 and also exists in the legacy task-read route. It was not introduced by this change and should be tracked separately as an API-key policy follow-up.
