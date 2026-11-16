# TaskDesk UAT and code audit — 8 November 2026

**Reviewer:** OpenAI Codex. **Status:** partial audit; results and limits below. **Source revision:** `44725ece8cbd8513876ccb57e0481a02aa922683`. The deployed UAT revision was not independently established, so source findings are not automatically claims about the deployed image. This is a read-only review, not a penetration test or UAT acceptance. No application code, UAT fixture or customer records were intentionally changed; no seeder was run. Existing uncommitted files were present before the review and were preserved.

## Decision

Do not treat this report as a complete pass for the product or for RBAC. There are source-confirmed security and setup issues, and the requested complete browser, role, device and end-to-end matrix was not established by the checks documented here. Prioritise the private-network guard, validate seeded roles and customer boundaries with suitable data, and complete the outstanding journeys before acceptance. Severity below describes potential impact, not proof of exploitation on UAT.

## Findings

### F1 — Expanded IPv6 addresses bypass the private-network guard (medium; source confirmed)

The address checker handles `::1` and compressed IPv4-mapped IPv6 addresses, but compares textual forms without fully normalising them. The actual function returned **not blocked** for expanded IPv6 loopback and expanded IPv4-mapped loopback, while it blocked the corresponding compressed forms. Evidence: [`assert-public-destination.ts`](../../apps/api/src/utils/assert-public-destination.ts#L29-L85); existing tests concentrate on compressed forms in [`assert-public-destination.test.ts`](../../tests/api/utils/assert-public-destination.test.ts#L5).

The SMTP provider checks the same function before resolving and connecting ([runtime](../../apps/api/src/notification-provider/runtime.ts#L77-L97)); its configuration schema accepts IP-shaped strings ([schema](../../apps/api/src/notification-provider/schema.ts#L34-L40)). The provider configuration and test routes require a current instance administrator ([route](../../apps/api/src/notification-provider/index.ts#L72-L100)). This establishes a guard bypass and a conditional connection path, not unprivileged exploitation, a successful SMTP transaction, or a demonstrated UAT exposure. No UAT exploit was attempted. Normalise and classify all IPv6 representations before use, and add unit and connection-path tests.

### F2 — The UAT seed cannot cover key isolation scenarios (medium; source confirmed)

The seed defines one project for each of two customer organisations and assigns each project-role seed account membership in every seeded project ([project definitions](../../apps/api/scripts/seed-uat-users.ts#L241-L269), [membership loop](../../apps/api/scripts/seed-uat-users.ts#L2074-L2090)). The seed alone therefore cannot establish a staff user's denial on an unassigned project, or project-level separation between two engagements for the same customer. It has three projects in total, including one internal project; this is a coverage limitation, not evidence of an isolation breach. Use separately authorised, non-destructive fixtures and verify both allowed and denied API and browser paths.

The test named “every account can sign in” checks account status and compares the stored password hash; it does not perform a real HTTP or browser login, MFA, or cross-host check ([test](../../tests/api-integration/uat-seed.test.ts#L238-L265)). Treat real authentication results below as a separate evidence class.

### F3 — Seed sign-in readiness can misreport customer password availability (medium; conditional source finding)

The seed's readiness report accepts any enabled password plugin whose portal scope is not `none` ([seed](../../apps/api/scripts/seed-uat-users.ts#L2540-L2551)). The runtime resolves the agent and customer portals separately and defaults customer local providers off ([auth](../../apps/api/src/auth.ts#L267-L301)). Thus an agent-only password configuration can suppress the seed warning even when customer password login is disabled. This does not assert that UAT is currently misconfigured. Check effective methods for both portals and report readiness per portal.

### F4 — Request-type field settings lack an apparent clear action (medium; source confirmed, UAT reproduction pending)

The request-type editor renders a placeholder for an unmapped field but provides only concrete mapping choices; likewise the visibility selector offers fields but no selectable “always visible” choice. The change handlers accept a cleared value, yet the rendered items do not provide one ([mapping](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L818-L857), [visibility](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L903-L937)). This appears to leave an administrator unable to undo a mapping or condition using these controls after selection. Browser and persistence reproduction is needed before asserting the deployed behaviour. Review the library's clearing interaction, then provide a visible and keyboard-accessible reset if absent.

### F5 — Portal Backlog retains a project selection but fetches organisation-wide data (medium; scope/UX needs confirmation)

Switching to Backlog preserves `project` in route state, whereas the Backlog query supplies only the cursor and groups all returned projects ([route](../../apps/web/src/routes/portal/requests.tsx#L98-L103), [grouping](../../apps/web/src/routes/portal/requests.tsx#L167-L179), [view switch](../../apps/web/src/routes/portal/requests.tsx#L246-L253)). The API describes organisation-wide backlog ([API](../../apps/api/src/intake/index.ts#L984-L991)). With multiple engagements, the retained selection can suggest a narrower scope than the displayed results. Confirm the intended product contract and test with two projects for one customer; do not infer cross-organisation data exposure from this observation.

### F6 — Dependency advisories remain (low/moderate; current lockfile scan)

`pnpm audit --json` reported **three advisories: one low and three moderate affected instances**, no high or critical instances. They concern `deepmerge` (one low path), `glob` (two moderate paths), and `minimatch` (one moderate path). These are dependency findings, not demonstrated application exploits. Check actual production reachability and remediation options without changing dependencies in this review. Separately, the filesystem Trivy vulnerability scan returned no findings for its one detected `pnpm-lock.yaml` target; this does not replace an image scan or invalidate the pnpm advisory results.

### F7 — Local lint gate fails in this checkout (low; confirmed locally)

`pnpm lint:ci` exited 1 with 12 format errors and 269 warnings. One format error is in tracked `.vscode/mcp.json`; one is in a local generated test-result file and ten are in local backup manifests. The latter local files mean this result cannot be projected onto GitHub CI or attributed entirely to committed source. No files were reformatted. A JSON reporter confirmed the locations.

### F8 — The current local UAT checklist contains a stale source claim (low; source confirmed)

The pre-existing, untracked `docs/uat-role-checklist.md` says portal withdrawal lacks confirmation. Current source opens an alert dialog and performs the mutation from its confirmation action ([portal request](../../apps/web/src/routes/portal/submissions/$ref.tsx#L490-L550)); a component test covers confirmation ([test](../../apps/web/src/routes/portal/submissions/$ref.test.tsx#L300-L345)). The deployed version and all withdrawal states were not verified from this source comparison. Update the checklist only after checking the deployed behaviour; it was not edited in this audit.

The same checklist says a member should not be able to open project Members. In UAT, a member could open the seeded project's read-only roster; this is consistent with the retained contract, which grants the members GET to `project:read` and separately requires `project:manage_members` for mutations ([contract](../technical/feature-contracts-p1.md#L895-L905)). This observation is not evidence of a privilege escalation; the mutation denials were not exercised.

### F9 — Request-type settings include hard-coded English (low; source confirmed)

Several labels and choices in the request-type editor are literal English strings ([examples](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L818-L846)). This is a localisation coverage issue; no particular UAT locale was tested. Audit the entire editor and locale catalogues before assigning full scope.

## RBAC interpretation

The policy registry has an opt-in enforcement configuration: with no selected sources, the strict middleware passes control to the existing route guards ([configuration](../../apps/api/src/permissions/enforcement-config.ts#L4-L13), [middleware](../../apps/api/src/permissions/strict-policy-enforcement.ts#L801-L804)). This staged design alone is not a bypass: existing guards can still enforce access. The effective UAT configuration was not read, and successful policy-registration tests alone do not prove every route, grant, tenant and portal boundary is enforced. Test owner, admin, lead, member, viewer, customer and instance admin separately, including direct API denials and users without membership.

## Local verification

| Check | Result | Meaning and limitations |
| --- | --- | --- |
| `pnpm typecheck` | Passed; nine tasks, four cached | Source typecheck; no runtime acceptance. |
| `pnpm check:ui:raw-elements` | Passed | Static gate; not visual, interaction or accessibility acceptance. |
| `pnpm check:tokens` | Passed; 421 declared light/dark contrast pairs | Built CSS and registered pairs only; not a complete WCAG audit. |
| `pnpm test:contract` | Passed | No unapproved breaking API change against the locally available `origin/main`; stale allowlist warnings were reported. |
| `pnpm check:route-policy` | One independent run passed with 118/118 API permission tests; another concurrent run failed 1/118 on a 5-second reach-guard timeout, with 117 passing | The timeout occurred under parallel audit load. Both runs are reported; a pass does not prove live UAT enforcement. |
| Permissions package unit suite | 278/278 passed across 15 files | Local unit scope, not real UAT sessions. |
| `pnpm lint:ci` | Failed | See F7. |
| GitHub workflows for the source revision | Release, Push on main and CI - fast reported success | Read from GitHub during this audit. Workflow conclusions do not establish the deployed UAT revision or complete browser coverage. |
| `pnpm audit --json` | Advisories found | See F6. |
| Trivy filesystem vulnerability scan | No reported findings on one pnpm lockfile target | No release image or OS scan performed. |
| Gitleaks filesystem scan | 350 detections; exit 1 | 19 were in tracked files: bundle digests, request-type identifiers and test/fixture values on contextual review. The remaining 331 were in untracked/ignored material including backups and environment files; not individually validated as active credentials. No secret values are included in this report. This was not a full Git-history scan or a clean all-clear. |

Full unit, fresh-database integration, persisted write journeys, G4 accessibility, G8 visual regression, performance/bundle budgets, deployed-image scan, external penetration test, backup/restore rehearsal, and real IdP/Entra tests were not completed in this review. No test or production container was started for these checks.

## UAT browser results

Both UAT readiness endpoints returned HTTP 200. Their response did not identify a revision. The agent UI showed version `v2.22.0`, which does not prove the deployed commit or image digest.

| Role | Browser-form sign-in and sampled navigation | Boundary checked | Limit |
| --- | --- | --- | --- |
| Workspace owner | Passed | Direct God Mode users page denied | Sampled pages only; no create/delete test. |
| Workspace admin | Passed | Direct God Mode users page denied | Sampled pages only; no settings mutations. |
| Lead | Passed | Direct God Mode users page denied | No unassigned-project denial fixture was exercised. |
| Two members | Both passed | Direct God Mode users page denied; project roster visible read-only | No API mutation-denial test. |
| Viewer | Passed | Direct God Mode users page denied | No write attempt was made. |
| Three customers across two organisations | All passed | Portal-host agent route returned 404 | No cross-customer data comparison or request lifecycle. |
| Two instance administrators | Both passed; God Mode and users opened | Workspace-members route redirected to onboarding | No instance configuration changes. |

The six staff accounts each opened seven sampled paths: `/agent`, `/agent/my-work`, `/agent/triage`, workspace Members, God Mode users, a seeded project's Work, and its Members settings. The three customers each opened `/`, `/requests`, `/catalogue`, `/projects`, `/kb`, `/notifications` and `/account`, plus the denied agent route. These are basic browser navigation and DOM/error checks, not a full action-by-action RBAC matrix; the custom sweep did not collect console errors. Each account used an isolated browser context, which was closed without explicit logout; server sessions created by login may remain until expiry.

A separate release smoke used API authentication and injected browser sessions, rather than the login form: **108/110 assertions passed, two failed**, and its process exited 1. Both failed assertions expected a nonempty workspace list but received HTTP 200 and an empty list. This resembles the previously documented instance-admin empty-workspace limitation, but the anonymised output does not preserve the exact account identities, so these failures are not promoted to confirmed expected outcomes. Its 54 browser page checks passed their configured HTTP 5xx/429, uncaught page error, console error and error-boundary checks.

The release smoke captured 54 screenshots; the browser-form sweep captured 24. Six were visually inspected: at 1440×900, the owner project list, customer dashboard, and member and viewer project rosters showed no obvious broad layout failure. At 375×812, the owner list used a horizontally scrollable table, and the visible customer dashboard was readable. Programmatic horizontal scrolling worked; swipe and keyboard access were not tested. The agent samples used dark and the portal samples light; opposite themes and tablet were not inspected. The screenshots do not establish keyboard, screen reader, interaction, focus or complete responsive acceptance.

Private evidence directories on this workstation: `/var/folders/vc/dxqq93753l30c6hhd0fxzphc0000gn/T/taskdesk-uat-audit-G1pjpA` (smoke) and `/var/folders/vc/dxqq93753l30c6hhd0fxzphc0000gn/T/taskdesk-role-audit-HQvwr0` (role sweep). These may contain user data; they are temporary and must not be published with the report.

Not covered: every reachable page and permission; all desktop/tablet/mobile and light/dark combinations; keyboard and assistive-technology paths; account invitation, MFA, deprovisioning and real IdP; persisted create/edit/delete, uploads, approval, comment, concurrency, retries and reload journeys; cross-organisation and cross-project denial tests; customer request lifecycle; feature flags and failure recovery; and independent UAT-image provenance. These remain open, not passed.