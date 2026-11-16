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

Required hosted CI, pinned G8, accessibility, the full role/theme/width and keyboard/focus matrix, and signed canonical Local SIT verification of #910 remain open. These screenshots establish the bounded disposable journey only. The issue must stay open until acceptance is complete.

Separately, #1194 is merged and deployed from signed digest `sha256:da5e60d1598a484227fd96d916e974bccd1857b38b3fb040e74414a8cc76a641`. Backup restore listings and attachment archives were verified; all 185 public-table counts (12,450 rows) matched immediately before/after deployment. Both HTTPS readiness checks and the clean-install 11-account signed-in browser/API smoke passed (125/125). The default legacy credential file failed sign-in; no account was reset or reseeded.
