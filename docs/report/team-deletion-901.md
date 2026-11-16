# Team deletion: exact-name confirmation (#901)

16 November 2026. Base: `309c9b992`. State: [PR #1196](https://github.com/ThomasHeinThura/ticketing/pull/1196) merged as `08575e865`; signed Local SIT acceptance passed on 16 November. Technexus acceptance remains separate.

Thomas decided: “Require the team name and update the deletion contract.” This supersedes the team's old click-confirmation row. Team deletion uses `typed_name`, without adding step-up.

The server derives the confirmation requirement, checks the exact frozen name inside the locked pending-action approval, and retains current identity, permission, credential-ceiling, expiry, target fingerprint, blocker, audit and transaction checks. Case and whitespace differences are refused. Rename invalidates an existing request; replay cannot execute twice. Stored click-confirmed requests are not rewritten: cancel and request again.

The existing shared approval dialog shows the target name and sends typedName without requesting PA-15 proof. The team settings card uses the existing destructive border token. Cancellation restores focus; execution leaves the deleted team detail before cache refresh. No new control, dependency, permission or migration was added.

## Verification

- Full `pnpm test`: 12 tasks passed, including 682 web files / 5,225 tests. Full typecheck: 9/9 tasks; final scoped API typecheck also passed after response typing was restricted to the team target.
- Focused payload/approval-contract unit tests: 236/236. Shared approval/dialog/executed/team component tests: 54/54; new tests failed before implementation.
- Fresh PostgreSQL 18: 60/60 integration tests in registered deletion, team blockers, pending-action service and decisions. The first run exposed missing timestamps in new fixtures; those fixtures were corrected without changing schema or weakening assertions.
- Lint, route policy, 127 permission tests, raw-element, token contrast (421 pairs) and bundle gates passed. Existing lint warnings remain; thresholds were unchanged.
- OpenAPI changed only `DELETE /teams/{id}`: the 202 confirmation is now the `typed_name` literal. The unchanged gate reports one fingerprint-bound enum addition (`db2d7eb4a62c`), matching Thomas's authorized contract decision; its approval is recorded against PR #1196 and `pnpm test:contract` passed with one approved change.
- Independent Sol high source/spec review: C0/H0/M0/L0. Reviewer did not implement the change.

## Persisted browser evidence

`pnpm --filter @taskdesk/web exec playwright test e2e/team-deletion-persisted.spec.ts --workers=1 --reporter=list`: **2/2 passed in 54 seconds**: one retry-header parser test and one persisted browser journey, using the real source-built API and disposable PostgreSQL, without response mocks.

The journey additionally covers **36 cells**: independent owner, admin, lead, member, viewer and customer sessions × desktop 1440, tablet 768 and mobile 390 × actual light and dark themes. None of those users is an instance administrator. Canonical stored roles, effective capabilities and the team response are checked. Owner and admin exercise exact-name validation and cancellation/focus in every cell, then each executes a deletion with keyboard approval and verifies absence after reload. Lead, member and viewer have no deletion control and receive API 403 while the team survives. The customer signs in only on the portal host, has no agent session, and receives agent API 401. The original first-administrator journey remains supplementary.

All 52 generated screenshots were counted; six matrix screenshots below were visually inspected and retained alongside the original four. Other generated screenshots remain local test artifacts. A first matrix attempt encountered the authentication provider's sign-in limit. Setup now accepts only one server-advertised 1–10 second delay, with invalid headers tested; authentication limits and test timeout are unchanged. Independent Sol high review of the matrix found C0/H0/M0/L0.

The journey creates its own synthetic team, requests deletion through team settings, cancels and verifies trigger focus, then refuses missing/wrong/case/whitespace names through the API while preserving the team and pending request. The shared dialog blocks wrong names, Tab reaches the exact-name Delete action, and Enter executes. Team detail returns 404 and the reloaded list excludes it. No step-up request is made after setup enrollment.

Routes: `/dashboard/settings/workspace/teams/{fixture-team-id}` and `/dashboard/settings/workspace/teams` on an isolated loopback origin. Screenshot files contain only synthetic fixture data:

- [Destructive team card](team-deletion-901/team-danger-zone-desktop-dark.png)
- [Exact-name field](team-deletion-901/team-name-required-mobile-dark.png)
- [Keyboard-ready mobile approval](team-deletion-901/team-exact-name-ready-mobile-dark.png)
- [List after deletion and reload](team-deletion-901/team-deleted-reloaded-mobile-dark.png)
- [Owner desktop light confirmation](team-deletion-901/matrix-owner-desktop-light-confirmation.png)
- [Admin mobile dark confirmation](team-deletion-901/matrix-admin-mobile-dark-confirmation.png)
- [Lead tablet light, read only](team-deletion-901/matrix-lead-tablet-light-screen.png)
- [Member mobile dark, read only](team-deletion-901/matrix-member-mobile-dark-screen.png)
- [Viewer desktop dark, read only](team-deletion-901/matrix-viewer-desktop-dark-screen.png)
- [Customer mobile light portal](team-deletion-901/matrix-customer-mobile-light-screen.png)

All eight owned temporary containers were removed by exact ID and confirmed absent:

- Initial integration fixtures: `12744e6277aea4d235b77d4f5d9ca1011f526ac9aff131ebaf462951c8806d89`.
- Passing integration suites: `4d3509787aca080114418ed50fc439cdb8c3f23f7132e45d93a4bb966618f2d9`.
- First browser locator run: `a3f1feda1606be253529ae69c1d4fc3847f688eb7b7bed183f68ecf39b5d4751`.
- Passing browser journey: `e121bdfd5244766de28b28e3a329aff4d46a5a3b6f783e581981a3e451926f23`.
- Keyboard visibility check: `be476fc3cb1139b55f150a0494a884d11ea3428e07b6a3ebf2c18cf93ed2dd4e`.
- Final stable screenshot run: `7edca164daf5b64603bd40f4550555b7571acac303b85b3a11ac4742750e8f54`.
- Initial role matrix (provider sign-in limit): `c9bdb3496ec46ce56610c2e68bd02f7c66dad079588812f60296e61fa6966424`.
- Passing expanded matrix: `978ee2d794a0a16da3272611f69a26597f4d792e3931e586a46ee029ff9c072f`.

The disposable journeys above did not modify canonical SIT or the protected native database. The signed journey below later created and deleted only its recorded synthetic teams on canonical Local SIT.

## Signed canonical Local SIT acceptance

All 17 required hosted checks passed at `9640f1004` before merge. Release [43859882124](https://github.com/ThomasHeinThura/ticketing/actions/runs/43859882124) built, scanned, signed and published revision `08575e865`, index `sha256:3c65c515bb11e9db3afdc86ecc1df59ae036c9fc128c2260faa0d696e5e58957`. Independent provenance/cosign verification preceded upgrade. A fresh database/files/config backup passed a full isolated PostgreSQL restore: all 185 tables and 14,396 rows matched. After upgrade, 184 table counts and the one attachment's bytes/hash matched; only scheduler history grew by 30 successful scheduled-run rows. Certificate-verified HTTPS readiness passed on both hosts and signed-in smoke passed 125/125. No account seeder ran.

The real Chromium journey passed **42/42 unique cells** on `https://ticketing.localhost` and `https://portal.localhost`: owner, admin, manager, lead, member, viewer and customer × 1440/768/390 × actual light/dark. Staff sessions were not instance administrators; real memberships and live capabilities were checked. Owner, admin and manager have the existing `workspace:manage_settings` permission: each exercised exact-name refusals, cancellation/focus in every cell, then keyboard-executed deletion of its own team and checked 404 plus reload. Lead, member and viewer had no Delete control and received 403; customer sessions remained portal-only and received agent GET/DELETE 401. No PA-15 request occurred.

Early attempts stopped at incorrect harness assumptions about credential labels, ordinary auth-role output and manager authority; no team was created in those preflight failures. The first run past preflight created three durably recorded synthetic teams, then stopped on a width assertion before page readiness. Read-only light/dark mobile diagnostics found no settled overflow. The corrected journey waits for the page heading and retains a zero-overflow assertion; it recovered those exact three teams, created **zero** new teams, and deleted all three. Old run artifacts and the original ownership ledger were preserved; the new ledger records all three deletions. No existing customer team was targeted.

All browser writes were restricted to recorded synthetic team IDs and their pending actions; service workers were blocked. Observed browser/API responses stayed on the two canonical origins, with zero foreign-origin responses, redirects, forbidden writes, foreign team mutations or step-up requests. These are observed journey boundaries, not a claim about every possible application request.

Independent Sol high review of the harness, recovery bindings, final matrix/ledger/network artifacts and eight sampled images found C0/H0/M0. Root inspected four further images; 42 screenshots were generated. The samples support this team-deletion journey, not whole-product visual acceptance:

- [Owner desktop dark](team-deletion-901/signed-owner-desktop-dark-typed-confirmation.png)
- [Admin mobile dark](team-deletion-901/signed-admin-mobile-dark-typed-confirmation.png)
- [Manager tablet light](team-deletion-901/signed-manager-tablet-light-typed-confirmation.png)
- [Lead mobile light](team-deletion-901/signed-lead-mobile-light-synthetic-team.png)
- [Member mobile light](team-deletion-901/signed-member-mobile-light-synthetic-team.png)
- [Viewer mobile dark](team-deletion-901/signed-viewer-mobile-dark-synthetic-team.png)
- [Customer mobile light heading](team-deletion-901/signed-customer-mobile-light-portal-heading.png)

No container was started by this signed browser journey. The healthy canonical application remains running intentionally; its isolated backup-restore proof container was removed by the reviewed operator. Report-only G11 failures remain open and frozen. Technexus deployment, external acceptance and the broader product sweep are not established by this result.
