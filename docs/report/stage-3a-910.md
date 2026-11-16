# Stage 3A: template custom-field defaults (#910)

16 November 2026. Base: `309c9b992` (#1194). State: implemented, draft review; issue remains open.

The create transaction now applies valid, applicable template field values before ordinary field defaults. Explicit request keys, including clears, win. Invalid/stale/type-hidden and conditionally hidden template values are omitted; required fields still block creation and roll back the transaction. Template version/tenant checks remain in place.

The existing create dialog allows the API to resolve template defaults. It preserves explicit clears and identifies known fields in validation errors. A server-required conditional field can be corrected; an explicitly changed controller restores normal visibility and payload filtering. Raw template values and arbitrary server error text are not exposed.

## Verification

- Full `pnpm test`: 12 tasks passed, including 682 web files / 5,226 tests and 353 API files / 2,856 tests. Final recovery changes were separately verified by 45/45 dialog/fetcher tests.
- `pnpm lint:ci`, full `pnpm typecheck`, final web typecheck, API/web builds, `pnpm test:permissions` (127 tests), `pnpm check:route-policy`, and `pnpm test:contract` passed. Lint retained existing warnings; no unapproved API break was reported.
- Disposable PostgreSQL 18: 16/16 tests passed across template defaults, custom-field definition races and custom-field filters. Disabling template default application made two regression tests fail; restoring the exact source returned the suite to green.
- `pnpm check:ui:raw-elements`, `pnpm check:tokens` (421 contrast pairs), and `pnpm check:bundle-size` passed with unchanged thresholds.
- Dependency audit: one previously accepted low `deepmerge` advisory with no patched version; no moderate/high/critical finding. No dependency changed. Trivy build/scan/signing passed for the separately deployed #1194 release.
- Independent Sol high source/spec review after corrections: C0/H0/M0/L0. Reviewer did not implement the code.

## Persisted browser evidence

`pnpm --filter @taskdesk/web exec playwright test e2e/work-item-template-persisted.spec.ts --workers=1 --reporter=list`: **1/1 passed**, real source-built API and disposable PostgreSQL; no network response mocks. First administrator/workspace owner, 1440×1000, app-rendered **dark** theme (the app's default overrides the browser light preference).

The journey creates a work item from an untouched required template value, overrides it explicitly, checks API and UI detail after reload, refuses an explicit required clear without adding a work item, and recovers a hidden conditional required field after a real 400. A narrow fetch observer records only synthetic test-field values because Playwright did not expose the cloned Request body.

Routes: `/agent/projects/RWHZAXJU/work?layout=list`, `/agent/work-items/RWHZAXJU-1`, `/agent/work-items/RWHZAXJU-3` on the disposable loopback origin. The database, server and origin no longer exist after cleanup.

- [Selected template, untouched field](stage-3a-910/template-default-before-create.png)
- [Stored default after reload](stage-3a-910/template-default-persisted.png)
- [Required clear refused](stage-3a-910/template-required-clear-refused.png)
- [Conditional-field recovery persisted](stage-3a-910/template-conditional-recovered.png)

Both integration containers, both browser-attempt containers and the signed-release migration container were removed by exact ID and confirmed absent. The canonical Local SIT application remains running intentionally. No account seeder, protected native database, Technexus deployment or customer-data deletion was used.

## Open acceptance

All 17 required hosted checks, including G8 and accessibility, passed at `5ef723813` before the #1196 upstream sync. Fresh checks after sync, the expanded role/theme/width and keyboard/focus matrix, and signed canonical Local SIT verification of #910 remain open. These screenshots establish the bounded disposable journey only. The issue must stay open until acceptance is complete.

Separately, #1194 is merged and deployed from signed digest `sha256:da5e60d1598a484227fd96d916e974bccd1857b38b3fb040e74414a8cc76a641`. Backup restore listings and attachment archives were verified; all 185 public-table counts (12,450 rows) matched immediately before/after deployment. Both HTTPS readiness checks and the clean-install 11-account signed-in browser/API smoke passed (125/125). The default legacy credential file failed sign-in; no account was reset or reseeded.


## Expanded persisted matrix and upstream integration (16 Nov)

The candidate now integrates the reviewed #1197 source locally; its final hosted checks and merge are still separate gates. On this combined application source, full unit tests passed 12/12 tasks (API 353 files / 2,860 tests; web 683 files / 5,267 tests), typecheck 9/9, permissions, route policy, lint, raw controls, all 421 contrast pairs, contract and bundle checks. The contract gate reported exactly the 15 enum additions Thomas approved for #1197. Bundles remained within unchanged budgets: agent 278.1/350 KB, work-list graph 349.4/350 KB, portal 197.2/200 KB.

Fresh PostgreSQL 18 integration passed 16/16 across template defaults, definition races and filters. A full run performed concurrently with other checks initially missed a lazy-content error alert; that unchanged test passed 5/5 in isolation and the full serial rerun passed 12/12. The combined-source full run subsequently passed as well. No assertion or timeout was changed to obtain those results.

The retained core browser journey passed 1/1 in 19.1 seconds, including explicit required clear, rollback and conditional-field recovery. The expanded matrix passed after correcting its setup key generator to reuse the existing letters-only project-key helper, bootstrapping portal auth before API start, and checking actual ordinary session shapes and permissions. It verifies **102 scenarios across 42 unique cells**: seven real non-instance-admin roles × desktop/tablet/mobile × actual light/dark. Five creating roles each exercise untouched defaults, explicit override and optional clear in every cell (90 persisted creations), with fresh API reads and reloaded fields. Viewer creation is refused with 403 in six cells; customer agent-host GET and POST are refused with 401 in six cells.

Review found early screenshots racing portal content and the independently lazy project header. Those captures were not accepted. Thomas approved the prepared 11-line viewer-header readiness fix and another run after the third failing review round. The approved run passed **1/1 in 4.3 minutes**, with zero skipped, unexpected or flaky cases. JSON evidence contains all 102 records and 42 distinct role/view/theme keys. All 42 captures require rendered content and zero horizontal overflow; viewer captures additionally require the loaded project navigation. Every creator cell checks natural Tab/Shift+Tab order between the persisted required and optional fields; a separate owner path checks Enter activation and focus through creation/template selection/submission. These checks do not establish keyboard coverage for the entire product.

Routes: the fixture project's `/agent/projects/{synthetic-key}/work?layout=list`, its `/agent/work-items/{synthetic-key}-{number}` detail pages, and customer `/projects`, on isolated loopback origins. Forty-two matrix images were generated; representative retained images below are fixture data only. Final independent review of the approved run remains pending, as do fresh hosted CI and signed canonical Local SIT acceptance. #910 remains open.

- [Owner desktop light](stage-3a-910/template-owner-desktop-light.png)
- [Admin mobile dark](stage-3a-910/template-admin-mobile-dark.png)
- [Manager tablet light](stage-3a-910/template-manager-tablet-light.png)
- [Lead mobile dark](stage-3a-910/template-lead-mobile-dark.png)
- [Member mobile light](stage-3a-910/template-member-mobile-light.png)
- [Viewer mobile light](stage-3a-910/template-viewer-mobile-light.png)
- [Customer mobile light](stage-3a-910/template-customer-mobile-light.png)

All seven new owned check containers were removed by exact ID and independently confirmed absent: initial matrix `307d8044b0c8e9de46b05b5c1c739c62c60e2c18869671cf1baed985c5c20b39`; passing early matrix `96e30b36b51c7693d041df12e72b263a02fefc2cc979ccb3c53b9d5670639674`; combined integration `a5e530dd968b725cbe1571f4839dab62fe79c10b8b58a9e07cd2c019a97026ac`; core browser `07644ecf36877c41cb1ded97bd9916012eee1e1493c57ba973c8c16803d6b710`; combined browser matrix `76ee74605804ba154f451e214821e8022d841ffc2107385437b08768a8427fe5`; pinned G8 readiness verification `a62049c7e280b4d579fb5ffbbf9df708c265ec46a7721990bb581ffd505fb43b`; approved final matrix `fc7045c78bc5baa9d53c8d7a2074820d68698620565b4f6465b5e0bf5e5f624a`. Canonical SIT and its pre-existing services remain running intentionally.
