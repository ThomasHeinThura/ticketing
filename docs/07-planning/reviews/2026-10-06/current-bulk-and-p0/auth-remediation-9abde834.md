# c2fd P0 authorization remediation evidence

## Source and original failures

Base: `c2fd8153676baecc958c089988f60ab156b26aff` in the sole-owned bulk-integration worktree. The preserved hosted SQL report is `hosted-85-sql.log`; it recorded 146/148 files and 1724/1727 tests, with three failures. No hosted result is represented as rerun or cleared here.

- Node WebSocket test's first purported no-credential request inherited `mockAuthenticatedSession`, whose test implementation returns a persisted session independent of request cookie. The actual authenticated request had no Origin and therefore correctly returned 403. Moving the mock after the true no-cookie request makes the 401 check exercise unauthenticated request resolution.
- Existing auth-and-identity contract states that null/unbound and wrong-portal sessions fail closed as 401 at request authentication. The integration expectations for those stored sessions were stale 403 assertions; updated only those cases. Other authenticated WebSocket origin-boundary behavior remains under the same test.
- Strict runtime enforcement showed an administrator role allowed an API-key assignment whose stored permissions were absent. Capability checking now intersects the freshly read member role with the API key's own stored resource/action scope. The denied regression checks 403 and unchanged work-item/activity state; an explicitly `work_item:update`-scoped key still passes the documented self-assignment branch.

## Implementation

Changed API helper `assertCallerHasCapability(workspaceId, userId, capability, apiKey?)` and `assertCallerHasCapabilityOrSelf(..., isSelfTarget, apiKey?)`. An absent key preserves session behavior. For an API key, both the member role and key permissions must grant the checked resource/action. The self-target fallback also requires the key's self capability. Malformed/missing scopes fail closed. Passed the authenticated key into manual capability checks for priority, assignment, bulk operations, unassignment, asset workspace-read, and service-calendar capability reporting. No schema, capability vocabulary, route policy, or API contract was changed.

## Checks

- Focused private Testcontainers PostgreSQL 18 integration run: `node-server-websocket.test.ts` and `strict-runtime-enforcement.test.ts`: 2 files, 25 tests passed. `CI=true` and `TASKDESK_DATABASE_URL` unset; ephemeral Testcontainers DB teardown succeeded.
- API unit selection: 100 files, 701 tests passed.
- API typecheck passed after final source changes.
- `check:route-policy`: passed (including API build and 14 permission files / 88 tests).
- `check:openapi`: passed; generated contract matched 230 operations.
- Biome on all six changed files: passed; `git diff --check`: passed.

## Limits and cleanup

This does not establish a complete hosted SQL rerun, full integration suite, independent review, or PR acceptance. The original hosted failure evidence remains preserved. No UI/browser/performance/SQL-wide suite was run. Only the pre-existing `taskdesk-postgres-1` container remained after the focused Testcontainers run; the ephemeral test container was removed. No shared development database was used.
