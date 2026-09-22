# Security review — PR #216 (issue #206: declare the 404s handlers actually return)

**Reviewed head:** `68f3a6979c3bea4bceb4215ac623e076352ccac2`

## What this PR does

Closes issue #206: adds/corrects OpenAPI `404:` response declarations across
`project`/`task`/`column`/`workflow-rule`/`time-entry`/`label` route files so the contract
matches what handlers actually return. No handler, schema, status behavior, or route path
changes — declarations only. Touches `apps/api/src/**/index.ts` route files, security-review
scope per `docs/04-engineering/ci-cd.md`.

## Review (combined ordinary + mandatory security, one pass)

**Verdict: CLEAR.** One BLOCKING finding, fixed and independently re-verified; no other
issue outstanding.

- **The sweep's own 4 corrections verified correct** against the actual controller code:
  `updateTaskAssignee`'s 404→403 swap (the un-assignable case really is a 403 via
  `assertAssignableUser`; the real 404 is "Task not found"), both label attach/detach 404
  merges (each controller genuinely throws both "Label not found" and "Task not found"),
  and `deleteLabel`'s 404 description (a real third throw path when a task-level label's
  task row is gone).
- **Every other module's existing declarations cross-checked against their controllers
  line by line** — project, time-entry, workflow-rule, label — no other mismatch found.
- **One BLOCKING finding, confirmed and fixed**: `createColumn`'s controller
  unconditionally calls `getProjectWorkspaceId` (which throws 404 "Project not found" on a
  soft-deleted project — the same helper `getColumns`/`reorderColumns` already use and
  already declare 404 for), but `createColumnRoute`'s `responses` block never declared it.
  A real, confirmed instance of the exact defect class this PR closes, missed by its own
  sweep. **Fixed** (added the declaration, regenerated the OpenAPI baseline) and
  **independently re-verified**: `check:openapi` clean (102 operations), `typecheck` clean,
  `biome`/`lint` clean, `test:permissions` 10 files/79 tests (confirming no route or
  permission behavior moved).
- **A second issue found and fixed, unrelated to the 404 sweep itself**: this branch's
  `status.md` diff would have silently reverted newer content (the #192 decision-request
  section) back to a stale pre-refresh state, since the branch was cut before PR #220's
  later, independently-reviewed reconciliation landed. Resolved by merging `main` and
  dropping the branch's own stale status.md edit — confirmed the resulting diff against
  `main` touches only the intended six route files and the OpenAPI baseline.

No authorization, permission, or route-path change anywhere in this PR — confirmed by the
`test:permissions` re-run showing the identical 79-test baseline.
