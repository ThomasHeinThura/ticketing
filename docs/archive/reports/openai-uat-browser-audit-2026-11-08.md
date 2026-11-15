# TaskDesk UAT browser, screen and connectivity audit — 8 November 2026

**Reviewer:** OpenAI Codex. **Scope:** read-only, evidence-bounded audit. **Checkout:** `733c99d5341c9916554d1ca5b3c6bde362ff709a`; UAT image commit and digest were not independently verified. Browser sign-ins create server sessions, and request interception prevented business writes. This audit is incomplete: route entries and HTTP 200 responses are not full interaction, design, security or role acceptance.

## Follow-up: browser, screen and connectivity sweep — 8 November 2026

The follow-up uses the maintained [154-row screen inventory](../screens.md): 138 route rows and 16 overlays, dialogs or sections. Direct URLs, visible navigation links, placeholders, redirects, authorisation states, loading states and safe interactions must be assessed separately: an HTTP 200 from the single-page app does not prove that a requested screen exists or that a control is connected. Planned routes, inaccessible fixtures and checks not actually performed remain open.

**Automated inventory checks.** `pnpm check:inventory` passed: 161 canonical generated route identities and 114 unique active inventory identities. The checker's output calls ten planned-only route identities “unimplemented,” but independent comparison found **nine absent from the generated tree and one present** (`/god-mode/organisations`); presence does not prove that screen works. Its four checker unit tests passed. The checker combines the agent and portal route trees and strips query strings, so a pass does not prove a route belongs to the correct host or that layout and filter URL states work ([canonicalisation](../../scripts/ci/check-inventory.mjs#L15-L22), [comparison](../../scripts/ci/check-inventory.mjs#L70-L88)). `pnpm check:visual-scope` passed: 116 active inventory route rows mapped to 116 screenshot cases; its 168 checker unit tests passed. These are static coverage checks, not proof of UAT navigation, correct fixtures, accessibility, browser rendering or working links.

**Earlier local code checks in this session.** At source revision `44725ece8cbd8513876ccb57e0481a02aa922683`, `pnpm test` passed with 8,387 reported unit/component tests and four cached tasks; typecheck, UI raw-element, token/contrast and API-contract checks also passed. Local lint failed on a tracked formatting issue and local backup/generated files. The checked-out revision above differs from that source revision in documentation files; these results do not establish UAT image provenance or integration/browser acceptance.

The earlier dependency audit reported three advisories, comprising one low and three moderate affected instances; no high or critical instances were reported. A filesystem Gitleaks scan also returned findings in tracked and ignored local material; the tracked sample was reviewed as hashes, identifiers and test/fixture values, while ignored material was not individually validated as active credentials. Neither result is an image scan or a security all-clear. Integration tests requiring a fresh database were not run because the documented scratch database port and local Docker daemon were unavailable.

**Browser availability.** Playwright Chromium 153, Firefox 155 and WebKit 26.6 were launched successfully. On both sign-in origins at 1280×800 and 375×812, all 12 combinations returned HTTP 200 with the email input visible and no document-level horizontal overflow. Installed Google Chrome 156 also loaded both sign-in screens at 1280×800 with the email input visible. These are unauthenticated sign-in-screen checks, not authenticated journeys or native Safari release qualification. Representative sign-in screenshots were inspected. Firefox and WebKit binaries were installed in the local browser cache; no application dependency was added.

**Authenticated engine sample.** All 11 available accounts completed real form login in the paced run: three logins in Chromium, four in Firefox and four in WebKit. Each resulting session was copied **in memory** into isolated Chromium, Firefox and WebKit contexts; it was not independently signed in again in every engine. Each staff account then navigated `/agent`, `/agent/my-work` and `/agent/triage`; each customer navigated `/`, `/requests` and `/catalogue`; each instance administrator navigated `/god-mode`, `/god-mode/users` and `/god-mode/authentication`. All 99 navigations returned document HTTP 200, reported an authenticated session and showed nonempty pages without the checker's error-boundary text. Owner project-list and customer dashboard screenshots from all three engines were inspected. These are three sampled routes per account and engine, not every screen, independent form sign-ins in every engine, full visual approval or native Safari testing. The harness blocked non-GET requests, so dependent interactions and any blocked read-like POST operations remain unverified.

**Rate limits and sessions.** During concurrent form logins, UAT returned HTTP 429 for some attempts. The affected audit run was stopped and the result is not counted as an application authentication failure or a passed login. Sign-ins create server sessions; tests use isolated browser contexts and block non-GET application requests after authentication. Browser contexts closing does not guarantee immediate server-side session revocation.

### Related source-review findings

- **S1 — Project permission granularity gaps (medium; source confirmed, known).** The [RBAC contract](../technical/permissions.md#L23-L27) separates archive from update, but the legacy archive and unarchive routes require `project:update` and project reach ([routes](../../apps/api/src/project/index.ts#L513-L551), [policy note](../../apps/api/src/project/policy.ts#L33-L45)). Project board-column and workflow-rule mutations also use `project:update` although the contract describes project states and settings under `project:manage_settings` ([column route](../../apps/api/src/column/index.ts#L47-L60), [column policy note](../../apps/api/src/column/policy.ts#L23-L38), [workflow-rule route](../../apps/api/src/workflow-rule/index.ts#L42-L54), [workflow policy note](../../apps/api/src/workflow-rule/policy.ts#L21-L31)). These are recorded migration gaps; the registry declarations mirror the broader checks, so enabling registry enforcement alone does not fix the archive gap. No UAT mutation was attempted and no individual UAT role's actual write access is asserted.
- **S2 — Expanded IPv6 bypasses the private-address guard (medium; locally reproduced).** The guard rejects compressed loopback but does not reject equivalent expanded loopback or expanded IPv4-mapped loopback ([address check](../../apps/api/src/utils/assert-public-destination.ts#L29-L85)). The SMTP connection path uses this check ([runtime](../../apps/api/src/notification-provider/runtime.ts#L77-L97)) and its configuration and test routes require instance-admin access. Two independent local checks reached a fake connector; a separate isolated test using the real connector and a temporary local IPv6 listener accepted a loopback socket. This proves a local connection-guard bypass, not an SMTP or TLS transaction, non-admin access, or UAT exploitability. No UAT network target was contacted for this test.
- **S3 — Number answers use mismatched types (medium; source confirmed).** The customer form stores numeric input as a string ([form](../../apps/web/src/routes/portal/catalogue.tsx#L596-L613)), while the domain validator requires a finite number ([validator](../../packages/domain/src/intake/request-type.ts#L284-L293)) and the API rejects invalid submissions ([repository](../../apps/api/src/intake/repository.ts#L907-L914)). An isolated invocation confirmed the type mismatch. The current request-type editor does not offer number fields ([editor](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L49-L70)); applicability depends on a numeric schema existing through another route. A UAT customer catalogue sample contained no number fields; no request was submitted.
- **S4 — Hidden conditional answers can still be submitted (medium; source-confirmed privacy/UX risk).** The portal sends all answer state and attempts uploads for staged files without checking current field visibility ([submit and upload](../../apps/web/src/routes/portal/catalogue.tsx#L176-L205)); the API stores the submitted answers ([repository](../../apps/api/src/intake/repository.ts#L931-L939)). Confirm the intended policy for hidden data and test with safe fixtures.
- **S5 — Checkbox conditions compare strings with booleans (medium; source confirmed).** The authoring editor stores condition values as strings ([editor](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L939-L953)), but the portal sends checkbox values as booleans ([portal](../../apps/web/src/routes/portal/catalogue.tsx#L538-L553)) and the domain compares them strictly ([comparison](../../packages/domain/src/intake/request-type.ts#L173-L182)). An isolated invocation confirmed the mismatch; UAT was not mutated.
- **S6 — UAT Content Security Policy is report-only (medium defence-in-depth risk; live response confirmed).** Fresh GETs to the agent and customer sign-in documents returned `Content-Security-Policy-Report-Only` and no enforcing CSP header. Each document had a nonce matching its report-only policy. Report-only policy reports violations but does not block them; this is not proof of an exploitable XSS. The retained [security contract](../technical/safety-and-runtime.md#L3806-L3821) describes report-only rollout followed by enforcement. Confirm whether UAT is deliberately still in rollout and assess violation reports before an authorised configuration change; this audit made no change.
- **S7 — UAT fixtures cannot alone establish all project isolation (medium coverage gap; source confirmed).** The seed includes one customer project for each of two organisations and assigns seeded project-role accounts to each seeded project ([projects](../../apps/api/scripts/seed-uat-users.ts#L241-L269), [membership loop](../../apps/api/scripts/seed-uat-users.ts#L2074-L2090)). Those seed fixtures alone cannot demonstrate denial for an unassigned staff project or separation between two engagements of one customer. This is a test-coverage gap, not evidence of a cross-tenant breach.
- **S8 — Seed sign-in readiness is not checked per portal (medium; conditional source finding).** The seed reports password sign-in ready if any enabled password plugin has a scope other than `none` ([seed](../../apps/api/scripts/seed-uat-users.ts#L2540-L2551)); runtime resolves the agent and customer portals separately and defaults customer local providers off ([auth](../../apps/api/src/auth.ts#L267-L301)). An agent-only password configuration can therefore suppress the warning even when customer password sign-in is unavailable. Current UAT customer sign-in succeeded for sampled accounts, so this is not a claim of present UAT misconfiguration.
- **S9 — Issued filesystem download links can outlive object-level reach (low; known source-level residual).** A portal download link is signed for a person and expires after five minutes, but the download handler checks the current portal person and token without repeating the attachment/request reach check ([handler](../../apps/api/src/index.ts#L1714-L1728), [token and read](../../apps/api/src/storage/filesystem.ts#L921-L960), [TTL](../../apps/api/src/storage/shared.ts#L23)). If a person's object-level access changes while their session and link remain valid, the issued link can remain usable until expiry, provided the object remains available. This is already recorded in [the backlog](../roadmap.md#L06); it was not exercised in UAT. S3 bearer-link behaviour is a separate provider-specific boundary.

### Additional browser observations

- **B1 — Request-type authoring controls shown to restricted roles (medium; reproduced UI issue).** In UAT, a lead saw enabled New Request Type, Add field and Remove controls; separate viewer and member browser observations also showed editable authoring controls on direct navigation to `/dashboard/settings/workspace/request-types`. The workspace navigation hides the page for some of these roles, but a direct link still exposes the controls. No save or mutation was sent in this review. The source declares `request_type:manage` on mutation routes ([API](../../apps/api/src/intake/index.ts#L516)), but that is not live proof that every deployed mutation is denied. Test UI visibility and API denial independently with an isolated fixture.
- **B2 — Wrong-portal message is generic in one direction (low/medium; observed once).** In Chromium, a workspace owner attempting to sign in through the customer portal received HTTP 403 with `USE_AGENT_SIGN_IN`, remained unauthenticated, and saw “Failed to sign in” rather than a direction to the agent portal. Current source provides a plausible mechanism: the portal auth client retains the status and message but drops the error code ([client](../../apps/web/src/lib/portal-auth-client.ts#L39-L44)), while the refusal-message mapper requires the code ([mapper](../../apps/web/src/lib/sign-in-refusal.ts#L15-L19)). The deployed revision was not independently established. A repeat received 429, so it did not reproduce or disprove the UI observation. The reverse customer-to-agent check displayed a specific instruction and the subsequent session check was unauthenticated.
- **B3 — Mobile Triage displayed an error boundary once (unconfirmed).** A member at 390×844 saw “Something went wrong” on `/agent/triage`; its desktop observation did not detect a boundary. An owner and an admin saw a list in separate mobile observations. The failing resource and response were not captured, and the non-GET blocking test harness may affect application behaviour. Treat this as a failure requiring reproduction and diagnosis, not a confirmed role-specific defect or proof that Triage is generally broken.
- **B4 — God Mode Imports actions clip on mobile (low; reproduced visually).** On `/god-mode/imports` at 390×844, the third action button extends beyond the visible right edge instead of wrapping. The instance-admin account had no workspace and its actions were disabled, so their execution was not tested. A screenshot was independently inspected; the action row uses a non-wrapping inner flex container ([source](../../apps/web/src/components/god-mode/imports/import-runs-panel.tsx#L146-L171)). Check the same layout with a valid workspace, keyboard focus and the supported mobile widths.
- **B5 — Change calendar hides part of the current month and year on mobile (low; reproduced visually).** On `/agent/service-management/changes` at 390×844, the toolbar truncates both its heading and month/year, leaving the full year unreadable. The screen uses the shared calendar toolbar ([caller](../../apps/web/src/components/service-management/change-calendar.tsx#L153-L160), [toolbar](../../apps/web/src/components/calendar/calendar-toolbar.tsx#L62-L69)). This may be another surface of existing calendar-toolbar issue #1061; it has not been established as a separate defect. Month navigation and assistive text were not tested.
- **B6 — UAT password-reset article points to an absent sign-in control (medium; reproduced content mismatch).** The customer Knowledge Base article “Reset your password” tells readers to use Forgot password on the sign-in page and describes a reset email. In the sampled UAT customer portal, neither the email stage nor the password stage displayed a Forgot/Reset control. The article and both sign-in stages were inspected without submitting a reset; the article screenshot was independently reviewed. The seed contains the same guidance ([seed](../../apps/api/scripts/seed-uat-users.ts#L1170-L1180)). This establishes misleading UAT guidance, not whether a backend reset endpoint exists or what the live email-provider configuration is.
- **B7 — Other local reports contain UAT host details (medium; document review).** At the security recheck, the untracked `report.md` and `uat-audit-report.html` contained UAT host details. `report.md` also describes acceptance more broadly than this review established. A separate report changed while this audit was in progress; these other files were not edited in the security recheck. Review and sanitise any report before sharing. Their local existence does not establish external disclosure.
- **B8 — Request-type mapping and visibility selectors lack an apparent clear action (medium; source confirmed, UAT reproduction pending).** The editor displays placeholders for an unmapped field and an always-visible field but supplies only concrete selector items ([mapping](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L818-L857), [condition](../../apps/web/src/routes/agent/_layout/_authenticated/dashboard/settings/workspace/request-types.tsx#L903-L937)). The handlers can accept a cleared value, but a visible clear option was not identified in source. Verify library keyboard/clear behaviour in a safe fixture before calling this a deployed UI defect.
- **B9 — Portal Backlog keeps a project parameter but fetches organisation-wide data (medium; source confirmed, intent unresolved).** Switching to Backlog retains the project in route state, while the Backlog query supplies only a cursor and groups all returned projects ([query](../../apps/web/src/routes/portal/requests.tsx#L98-L103), [grouping](../../apps/web/src/routes/portal/requests.tsx#L167-L179), [switch](../../apps/web/src/routes/portal/requests.tsx#L246-L253)). The API describes an organisation-wide backlog ([API](../../apps/api/src/intake/index.ts#L984-L993)). Determine whether the retained project parameter is meant to constrain Backlog or only restore the list filter; test with two engagements in one customer organisation. This observation does not prove cross-organisation exposure.


### Follow-up route and role observations

- Owner: 59 inventory routes were captured at 1440×900 and 390×844. Instance administrator: 16 God Mode routes at the same two widths. All 150 document navigations returned HTTP 200 and the sweep recorded no page exception, API 5xx or 429; it did not record console errors. All screenshots were scanned as thumbnails, with more than 15 opened at full size. This count is not a working-page count: some captures showed loading skeletons, and an SPA document 200 can also serve redirects or not-found states. At the approximately 1.3-second capture point, My Work and Timesheet were among the screens still loading; this was not a persistent-loading test. The God Mode storage screen identifies Filesystem as active but explicitly does not claim provider connectivity was checked.
- Workspace admin, two members and viewer: each navigated 38 static built inventory routes, for 152 desktop navigation observations. Each top-level response was 200 and the 1.5-second checks did not detect a desktop page error or error boundary. This does not prove readiness or interactive behaviour. Project-template checks from this run substituted an internal project ID where the route required a slug and are excluded. A later lead login timed out; the earlier successful lead login and its separate Request Types control check remain valid.
- On mobile Triage, one viewer was shown an explicit lack-of-permission state, while an admin and a different member saw the queue. A separate member error-boundary observation remains unconfirmed (B3).
- One customer account had 12 desktop portal routes and two existing request details opened; all 14 screenshots were visually inspected at 1440×900 without obvious broad clipping. These checks do not establish that every action works or prove cross-browser coverage.
- One authenticated customer session navigated directly to 28 distinct discovered same-origin hrefs, including project, request, submission and Knowledge Base detail links. Two hrefs differ only by fragments. All returned an HTTP 200 document and none showed the checker’s not-found text. A catalogue card was clicked and opened a real request form; it was not submitted. The href checks did not test click handlers, fragment scrolling or 28 distinct screens. They do not cover every account, record or linked action, and SPA HTTP 200 alone does not establish correct content or authorisation.
- Seven customer screens were also captured in Chromium at 768×1024 light, 375×812 light and dark, and 1440×900 dark; 16 of those 28 screenshots were visually inspected. Document widths stayed within the viewport. At 768px, the Projects table used horizontal scrolling and some columns were initially out of view; swipe, discoverability and keyboard access remain untested, so this is not classified as a defect. The follow-up intercepted 72 non-GET requests after login; any affected feature or network error remains unverified under this harness.

Private follow-up evidence directories: `/var/folders/vc/dxqq93753l30c6hhd0fxzphc0000gn/T/taskdesk-owner-extended-hBHo2s`, `/tmp/taskdesk-staff-deep-audit`, `/tmp/taskdesk-customer-audit-private` and `/tmp/taskdesk-browser-matrix-private`. Browser evidence contains UAT content and must remain private; paths in this report are temporary workstation paths, not public attachments.

### Security recheck — 8 November 2026

- Eight targeted local unit-test files covering destination guards, webhook delivery, response headers, host routing and attachment access passed: **91 tests**. Passing tests do not negate the independently reproduced IPv6 case, which those tests did not cover.
- Both unauthenticated sign-in documents returned HTTP 200 with HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a referrer policy and a permissions policy. Both used CSP report-only as described in S6; their HTML nonces matched their reported policies. These are sampled headers, not a complete configuration review.
- Fresh owner and customer password sign-ins each returned HTTP 200. In each sampled response, the session cookie had Secure, HttpOnly and restrictive SameSite attributes and no Domain attribute. Cookie values and names were not recorded here. Sign-in creates a server session; closing the client does not itself prove revocation.
- In anonymous GET samples, agent workspace, project, instance-user and security-factor routes returned 401; portal requests returned 401, while some other portal-host routes returned 404. A 404 may be host routing, not an authorisation verdict. A foreign-origin preflight sample did not reflect the test origin; this does not establish CORS behaviour on every route.
- A fresh authenticated GET sample used two customers in one organisation and a customer in another. Own submission details returned 200 and a foreign customer received 404 in each cross-organisation direction. A private request returned 200 to its owner and 404 to the same-organisation peer, and was absent from that peer's list. For a shared case, both customers could read the case, while the peer's attachment-list and direct download GETs returned 404; the requester could list one ready file. These are specific fixture-level checks, not complete tenant-isolation proof. Three additional login sessions were created; no signed link was fetched and no business mutation was attempted.
- The outbound webhook client rechecks DNS at connection time and refuses redirects ([client](../../apps/api/src/webhook/safe-http.ts#L165-L212)); no DNS-rebinding flaw is claimed from the preliminary validation alone. Filesystem portal submission and work-item attachment download links are person-bound; S3 portal downloads are short-lived bearer URLs ([storage boundary](../../apps/api/src/storage/portal-servable.ts#L122-L148)). Provider-specific UAT configuration was not independently inspected in this recheck.

### Page and feature checker checklist

| Check | Evidence in this audit | Remaining |
| --- | --- | --- |
| Inventory route registered | G5 passed for 114 unique active route identities; of ten planned-only identities, nine are absent and one is present in the generated trees | Reconcile intended redirects, unlisted routes, planned pages and the correct host. G5 does not compare paths per host. |
| Real navigation and link destination | 28 discovered customer hrefs were navigated directly; a catalogue card was clicked and opened a real form | Complete staff, admin and customer link graphs, record invalid links and verify destination content, not only HTTP status. |
| Dangling or unconnected screen | Inventory sweep records not-found, redirects and missing fixtures; invalid substitutions are excluded | Confirm navigation entry points and whether each expected screen is reachable for its intended role. A registered route alone is insufficient. |
| Buttons, dialogs and feature connections | Sampled open/cancel, focus, status expansion and catalogue-card navigation | Exercise every reachable action, persistence, reload, error/retry and feature-flag state with authorised isolated fixtures. |
| Role and tenant boundaries | All 11 accounts signed in during the earlier sweep; sampled God Mode GET denials and host/session separation checked | Complete action-level allow/deny checks and cross-project, cross-person and cross-organisation record tests. |
| Design, responsive and accessibility | Owner/admin desktop and mobile capture; customer desktop/tablet/mobile samples; B4 and B5 recorded | Review all screenshots at useful size, both themes, all widths, keyboard, screen reader, focus, drag and motion. |
| Browser engines | All 11 accounts signed in across Chromium, Firefox and WebKit; session-transferred samples covered three routes per account in each engine. Installed Chrome sign-in pages also loaded | Complete independent sign-ins and all intended journeys across engines and any required native browsers. |
| Errors and security | Selected page errors, API 5xx/429 and RBAC guards checked; source findings S1/S2 and UI finding B1 recorded | Reproduce B3 with network evidence, review console and failed requests by screen, and complete security and permission testing without exposing credentials. |

## Screen-by-screen checklist

This checklist is derived from [the maintained inventory](../screens.md). It records some route-level evidence for 101 rows and marks 53 rows “Not established”; these are evidence counts, not pass counts. “Route entry” means a browser navigation was observed in one or more sampled accounts; it does not assert that the page finished loading, its links or actions worked, its design passed, or that every role/browser was checked. Redirect, denial, fixture missing and not-found are observations requiring the contract and role context. “Not established” includes routes, overlays and interaction states that were not individually verified. Invalid work-item/report placeholders and the invalid catalogue key are excluded. The per-screen table combines the prior UAT inventory run and this follow-up; it is not an all-role matrix.

| # | Screen | Inventory route or context | Kind / inventory state | Observed UAT navigation |
| --- | --- | --- | --- | --- |
| 1 | Sign in (legacy `/agent/sign-in` redirects) | `/auth/sign-in` | route; Active/in progress | form login (admin, instance admin, lead, member, owner, viewer) |
| 2 | MFA challenge | `/auth/two-factor` | route; Active/in progress | Not established |
| 3 | MFA enrolment | `/dashboard/settings/account/security` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 4 | Accept invitation | `/agent/invite` | route; Planned | Not established |
| 5 | Workspace home (default dashboard) | `/agent` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 6 | Inbox | `/agent/inbox` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 7 | My work | `/agent/my-work` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 8 | Global search results | `/agent/search` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 9 | Not found (agent origin) | `*` | route; Planned | Not established |
| 10 | Project overview (summary, status, contract and hour bank, service levels, milestones) | `/agent/projects/{key}` | route; Active/in progress | route entry (owner) |
| 11 | Work — board | `/agent/projects/{key}/work?layout=board` | route; Active/in progress | route entry (lead, owner, viewer) |
| 12 | Work — list | `/agent/projects/{key}/work?layout=list` | route; Active/in progress | route entry (lead, owner, viewer) |
| 13 | Work — table | `/agent/projects/{key}/work?layout=table` | route; Active/in progress | route entry (owner) |
| 14 | Work — calendar | `/agent/projects/{key}/work?layout=calendar` | route; Planned | route entry (owner) |
| 15 | Work — timeline | `/agent/projects/{key}/work?layout=timeline` | route; Planned | route entry (owner) |
| 16 | Backlog | `/agent/projects/{key}/backlog` | route; Active/in progress | route entry (owner) |
| 17 | Cycles list | `/agent/projects/{key}/cycles` | route; Active/in progress | route entry (owner) |
| 18 | Cycle detail | `/agent/projects/{key}/cycles/{cycleId}` | route; Active/in progress | Not established |
| 19 | Modules list | `/agent/projects/{key}/modules` | route; Active/in progress | route entry (owner) |
| 20 | Module detail | `/agent/projects/{key}/modules/{moduleId}` | route; Active/in progress | Not established |
| 21 | Pages | `/agent/projects/{key}/pages` | route; Active/in progress | route entry (lead, owner, viewer) |
| 22 | Page view and editor | `/agent/projects/{key}/pages/{pageId}` | route; Active/in progress | Not established |
| 23 | Prerequisites (milestones are on the overview) | `/agent/projects/{key}/prerequisites` | route; Active/in progress | route entry (owner) |
| 24 | Team (stakeholders and roster) | `/agent/projects/{key}/team` | route; Active/in progress | route entry (owner) |
| 25 | Documents (document links, link to Pages) | `/agent/projects/{key}/documents` | route; Active/in progress | route entry (lead, owner, viewer) |
| 26 | Timeline (opens the Kaneo Gantt, `feature.timeline`) | `/agent/projects/{key}/timeline` | route; Active/in progress | route entry (owner) |
| 27 | Work item — full page | `/agent/work-items/{key}` | route; Active/in progress | Not established |
| 28 | Intake queue and submission detail | `/agent/triage?state=new&ref={ref}` | route; Active/in progress | Not established |
| 29 | Approvals inbox | `/agent/my-work?lens=approvals` | route; Planned | route entry (owner) |
| 30 | Service catalogue — services list (D8: named "Service catalogue"; URL unchanged) | `/agent/service-management/services` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 31 | Service catalogue — service detail | `/agent/service-management/services/{id}` | route; Active/in progress | Not established |
| 32 | Service catalogue — change calendar | `/agent/service-management/changes` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 33 | Service catalogue — releases | `/agent/service-management/releases` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 34 | Service catalogue — announcements (D7) | `/agent/service-management/announcements` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 35 | Knowledge base list | `/agent/kb` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 36 | Article view | `/agent/kb/{id}` | route; Active/in progress | Not established |
| 37 | Article editor | `/agent/kb/{id}/edit` | route; Active/in progress | Not established |
| 38 | Reports index | `/agent/reports` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 39 | Report detail | `/agent/reports/{key}` | route; Active/in progress | Not established |
| 40 | Report builder (tier 3) | `/agent/reports/new` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 41 | Report export (emailed link) | `/agent/reports/exports/{id}` | route; Active/in progress | Not established |
| 42 | Dashboard | `/agent/dashboard` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 43 | Dashboard editor | `/agent/dashboard/edit` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 44 | Timesheet | `/agent/timesheet` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 45 | Saved views index | `/agent/views` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 46 | Saved view | `/agent/views/{id}` | route; Active/in progress | Not established |
| 47 | Profile — general | `/dashboard/settings/account/information` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 48 | Profile — appearance | `/dashboard/settings/account/preferences` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 49 | Profile — notifications | `/dashboard/settings/account/notifications` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 50 | Profile — security & sessions | `/dashboard/settings/account/security` | route; Planned | route entry (admin, member, viewer); route entry (owner) |
| 51 | Profile — pending actions (API/MCP-originated deletions awaiting my approval) | `/dashboard/settings/account/pending-actions` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 52 | Profile — pending action detail | `/dashboard/settings/account/pending-actions/{id}` | route; Active/in progress | Not established |
| 53 | Profile — API keys | `/agent/settings/profile/api-keys` | route; Planned | redirect (owner) |
| 54 | Workspace — general | `/dashboard/settings/workspace/general` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 55 | Workspace — terminology | `/agent/settings/terminology` | route; Planned | redirect (owner) |
| 56 | Workspace — members | `/dashboard/settings/workspace/members` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 57 | Workspace — customer invitations | `/dashboard/settings/workspace/customer-invitations` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 58 | Workspace — teams | `/dashboard/settings/workspace/teams` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 59 | Team detail | `/dashboard/settings/workspace/teams/{id}` | route; Active/in progress | Not established |
| 60 | **Workspace — roles** | `/dashboard/settings/workspace/roles` | route; Active/in progress | route entry (admin, member, viewer); route entry (lead, owner, viewer) |
| 61 | **Role editor** | `/dashboard/settings/workspace/roles/{id}` | route; Active/in progress | Not established |
| 62 | Workspace — work item types | `/dashboard/settings/workspace/work-item-types` | route; Planned | not found (owner) |
| 63 | Workspace — states | `/dashboard/settings/workspace/states` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 64 | Workspace — workflows | `/dashboard/settings/workspace/workflows` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 65 | Workflow editor | `/dashboard/settings/workspace/workflows/{id}` | route; Planned | Not established |
| 66 | Workspace — SLA policies | `/dashboard/settings/workspace/sla-policies` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 67 | SLA policy editor | `/dashboard/settings/workspace/sla-policies/{id}` | route; Active/in progress | Not established |
| 68 | Workspace — service calendars | `/dashboard/settings/workspace/calendars` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 69 | Service calendar editor | `/dashboard/settings/workspace/calendars/{id}` | route; Active/in progress | Not established |
| 70 | Workspace request types and selected editor | `/dashboard/settings/workspace/request-types?requestTypeId={id}` | route; Active/in progress | Not established |
| 71 | Workspace — custom fields (incl. sections) | `/dashboard/settings/workspace/custom-fields` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 72 | Custom field editor | `/dashboard/settings/workspace/custom-fields/{id}` | route; Active/in progress | Not established |
| 73 | Workspace — labels | `/dashboard/settings/workspace/labels` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 74 | Workspace — canned responses | `/dashboard/settings/workspace/canned-responses` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 75 | Project — estimates (system, scale, cycle completion default) | `/agent/projects/{key}/settings/estimates` | route; Active/in progress | redirect (owner) |
| 76 | Workspace — rates | `/dashboard/settings/workspace/rates` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 77 | Workspace — time activities | `/dashboard/settings/workspace/time-activities` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 78 | Workspace — cost types (Rates section) | `/dashboard/settings/workspace/rates` | section; Active/in progress | Not established |
| 79 | Workspace — automations | `/dashboard/settings/workspace/automations` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 80 | Workspace — webhooks | `/dashboard/settings/workspace/webhooks` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 81 | Webhook editor | `/dashboard/settings/workspace/webhooks/{id}` | route; Active/in progress | Not established |
| 82 | Webhook delivery history | `/dashboard/settings/workspace/webhooks/{id}/deliveries` | route; Active/in progress | Not established |
| 83 | Workspace — import | `/dashboard/settings/workspace/import` | route; Planned | not found (owner) |
| 84 | Workspace — danger zone | `/dashboard/settings/workspace/danger` | route; Active/in progress | redirect (admin, member, owner, viewer) |
| 85 | Project — general | `/agent/projects/{key}/settings` | route; Active/in progress | redirect (owner) |
| 86 | Project — members | `/agent/projects/{key}/settings/members` | route; Active/in progress | redirect (lead, owner, viewer) |
| 87 | Project — states | `/agent/projects/{key}/settings/states` | route; Active/in progress | redirect (owner) |
| 88 | Project — labels | `/agent/projects/{key}/settings/labels` | route; Active/in progress | redirect (owner) |
| 89 | Project — SLA & calendar | `/agent/projects/{key}/settings/sla` | route; Planned | not found (owner) |
| 90 | Project — features | `/agent/projects/{key}/settings/features` | route; Active/in progress | redirect (owner) |
| 91 | Project — automations | `/agent/projects/{key}/settings/automations` | route; Active/in progress | redirect (owner) |
| 92 | Project — budget | `/agent/projects/{key}/settings/budget` | route; Active/in progress | redirect (owner) |
| 93 | Project — danger zone | `/agent/projects/{key}/settings/danger` | route; Active/in progress | redirect (owner) |
| 94 | God Mode home / health | `/god-mode` | route; Active/in progress | route entry (instance admin) |
| 95 | God Mode sign-in (password and MFA only; signed-out God Mode visits land here; legacy `/agent/god-mode/*` redirects) | `/god-mode/sign-in` | route; Active/in progress | Not established |
| 96 | Webhook security posture | `/god-mode/webhooks` | route; Active/in progress | route entry (instance admin) |
| 97 | General (incl. terminology) | `/god-mode/general` | route; Active/in progress | route entry (instance admin) |
| 98 | Branding | `/god-mode/branding` | route; Planned | not found (instance admin) |
| 99 | **Authentication providers** | `/god-mode/authentication` | route; Active/in progress | route entry (instance admin) |
| 100 | **Provider editor** | `/god-mode/authentication/{id}` | route; Active/in progress | Not established |
| 101 | Organisations | `/god-mode/organisations` | route; Planned | route entry (instance admin) |
| 102 | Organisation detail | `/god-mode/organisations/{id}` | route; Planned | Not established |
| 103 | **Organisation — Identity** (customer OIDC + SCIM connection) | `/god-mode/organisations/{id}/identity` | route; Active/in progress | Not established |
| 104 | Storage | `/god-mode/storage` | route; Active/in progress | route entry (instance admin) |
| 105 | Notification channels — SMTP configuration | `/god-mode/notifications` | route; Active/in progress | route entry (instance admin) |
| 106 | Deliveries (outbox, dead letters) | `/god-mode/deliveries` | route; Active/in progress | route entry (instance admin) |
| 107 | Workspace — features | `/dashboard/settings/workspace/features` | route; Active/in progress | route entry (admin, member, viewer); route entry (owner) |
| 108 | Feature flags | `/god-mode/features` | route; Active/in progress | route entry (instance admin) |
| 109 | Jobs | `/god-mode/jobs` | route; Active/in progress | route entry (instance admin) |
| 110 | Plugins | `/god-mode/plugins` | route; Active/in progress | route entry (instance admin) |
| 111 | Observability and instance MFA policy | `/god-mode/observability` | route; Active/in progress | route entry (instance admin) |
| 112 | MCP usage | `/god-mode/mcp` | route; Active/in progress | route entry (instance admin) |
| 113 | Audit log | `/god-mode/audit` | route; Active/in progress | route entry (instance admin) |
| 114 | Import runs (shared P4 prerequisite) | `/god-mode/imports?workspaceId={workspaceId}` | route; Active/in progress | Not established |
| 115 | Import run detail | `/god-mode/imports/{id}?workspaceId={workspaceId}` | route; Active/in progress | Not established |
| 116 | Users | `/god-mode/users` | route; Active/in progress | route entry (instance admin) |
| 117 | Sign in | `/sign-in` | route; Active/in progress | form login (customer); route entry (customer) |
| 118 | Accept invitation | `/invite/{id}` | route; Active/in progress | Not established |
| 119 | Home | `/` | route; Planned | route entry (customer) |
| 120 | Request detail (work item) | `/submissions/{ref}` | route; Planned | Not established |
| 121 | Catalogue | `/catalogue` | route; Planned | route entry (customer) |
| 122 | Request form | `/catalogue?key={typeKey}` | route; Planned | route entry (customer) |
| 123 | Customer portal — request catalogue and selected form | `/catalogue?q=no-match&key=access` | route; Active/in progress | Not established |
| 124 | Customer portal — submission detail | `/submissions/{ref}` | route; Active/in progress | route entry (customer) |
| 125 | Approvals | `/approvals` | route; Planned | route entry (customer) |
| 126 | Projects list | `/projects` | route; Active/in progress | route entry (customer) |
| 127 | Project detail | `/projects/{key}` | route; Active/in progress | fixture missing (customer); route entry (customer) |
| 128 | Knowledge base | `/kb` | route; Active/in progress | route entry (customer) |
| 129 | Article | `/kb/{id}` | route; Active/in progress | route entry (customer) |
| 130 | Announcements (D7; release notes tab at `/releases`; incident and maintenance banner on the shell) | `/announcements` | route; Active/in progress | route entry (customer) |
| 131 | Announcement | `/announcements/{id}` | route; Active/in progress | Not established |
| 132 | Satisfaction survey | `/submissions/{ref}` | route; Planned | Not established |
| 133 | Customer notification inbox and bell | `/notifications?filter=unread` | route; Active/in progress | route entry (customer) |
| 134 | Account (mention/comment email notification preferences; remaining controls open) | `/account` | route; Active/in progress | route entry (customer) |
| 135 | Not found (portal origin) | `*` | route; Planned | Not established |
| 136 | Portal home | `/` | route; Active/in progress | route entry (customer) |
| 137 | Portal requests | `/requests` | route; Active/in progress | route entry (customer) |
| 138 | Request raised by the team (D6, U-12): status, public conversation, files, reply | `/requests/{ref}` | route; Active/in progress | route entry (customer) |
| 139 | Portal approval decision | `/approvals?approval={id}` | route; Active/in progress | Not established |
| 140 | Sign-in — provider chooser | `/auth/sign-in` | section; Planned | Not established |
| 141 | Command palette | — | overlay; Active/in progress | Not established |
| 142 | Pending action approval (every deletion — [pending-actions.md](../technical/safety-and-runtime.md#pending-actions)) | — | dialog; Active/in progress | Not established |
| 143 | Error boundary | — | overlay; Planned | Not established |
| 144 | Work item — side pane | `?item={key}` on any list | overlay; Active/in progress | Not established |
| 145 | Create work item | — | dialog; Active/in progress | Not established |
| 146 | Bulk edit | — | overlay; Active/in progress | Not established |
| 147 | Relations editor | — | section; Active/in progress | Not established |
| 148 | Approvals panel | — | section; Planned | Not established |
| 149 | SLA panel | — | section; Planned | Not established |
| 150 | Time entries | — | section; Active/in progress | Not established |
| 151 | Attachments | — | section; Active/in progress | Not established |
| 152 | Activity & comments | — | section; Active/in progress | Not established |
| 153 | Section manager (reorder sections, move fields between them — [custom-fields.md](../technical/feature-contracts-p4.md#custom-fields)) | — | section; Planned | Not established |
| 154 | Submission page (pre-acceptance, same URL) | `/submissions/{ref}` | section; Planned | Not established |
