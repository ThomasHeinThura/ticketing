# Team deletion: exact-name confirmation (#901)

16 November 2026. Base: `309c9b992`. State: implemented; draft acceptance, not released.

Thomas decided: “Require the team name and update the deletion contract.” This supersedes the team's old click-confirmation row. Team deletion uses `typed_name`, without adding step-up.

The server derives the confirmation requirement, checks the exact frozen name inside the locked pending-action approval, and retains current identity, permission, credential-ceiling, expiry, target fingerprint, blocker, audit and transaction checks. Case and whitespace differences are refused. Rename invalidates an existing request; replay cannot execute twice. Stored click-confirmed requests are not rewritten: cancel and request again.

The existing shared approval dialog shows the target name and sends typedName without requesting PA-15 proof. The team settings card uses the existing destructive border token. Cancellation restores focus; execution leaves the deleted team detail before cache refresh. No new control, dependency, permission or migration was added.

## Verification

- Full `pnpm test`: 12 tasks passed, including 682 web files / 5,225 tests. Full typecheck: 9/9 tasks; final scoped API typecheck also passed after response typing was restricted to the team target.
- Focused payload/approval-contract unit tests: 236/236. Shared approval/dialog/executed/team component tests: 54/54; new tests failed before implementation.
- Fresh PostgreSQL 18: 60/60 integration tests in registered deletion, team blockers, pending-action service and decisions. The first run exposed missing timestamps in new fixtures; those fixtures were corrected without changing schema or weakening assertions.
- Lint, route policy, 127 permission tests, raw-element, token contrast (421 pairs) and bundle gates passed. Existing lint warnings remain; thresholds were unchanged.
- OpenAPI changed only `DELETE /teams/{id}`: the 202 confirmation is now the `typed_name` literal. The unchanged gate reports one fingerprint-bound enum addition (`db2d7eb4a62c`), matching Thomas's authorized contract decision; its approval is recorded with this PR.
- Independent Sol high source/spec review: C0/H0/M0/L0. Reviewer did not implement the change.

## Persisted browser evidence

`pnpm --filter @taskdesk/web exec playwright test e2e/team-deletion-persisted.spec.ts --workers=1 --reporter=list`: real source-built API and disposable PostgreSQL, no response mocks. First administrator/workspace owner, desktop 1440×1000 and mobile 390×844, actual dark theme.

The journey creates its own synthetic team, requests deletion through team settings, cancels and verifies trigger focus, then refuses missing/wrong/case/whitespace names through the API while preserving the team and pending request. The shared dialog blocks wrong names, Tab reaches the exact-name Delete action, and Enter executes. Team detail returns 404 and the reloaded list excludes it. No step-up request is made after setup enrollment.

Routes: `/dashboard/settings/workspace/teams/{fixture-team-id}` and `/dashboard/settings/workspace/teams` on an isolated loopback origin. Screenshot files contain only synthetic fixture data:

- [Destructive team card](team-deletion-901/team-danger-zone-desktop-dark.png)
- [Exact-name field](team-deletion-901/team-name-required-mobile-dark.png)
- [Keyboard-ready mobile approval](team-deletion-901/team-exact-name-ready-mobile-dark.png)
- [List after deletion and reload](team-deletion-901/team-deleted-reloaded-mobile-dark.png)

All owned temporary database/browser containers are removed by exact ID. The original live SIT and protected native database were not modified; deletion ran only on the fixture-owned team.

## Open acceptance

Hosted required CI, pinned visual/a11y gates, the remaining role/theme/device matrix and canonical signed Local SIT verification are not established. The issue remains open and this change must not be treated as a released fix.
