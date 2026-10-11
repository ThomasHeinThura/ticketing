# Independent ordinary delta review — PR #589

- **Reviewer:** GPT-6 Luna, original independent UI panel; no source authoring or remediation.
- **Reviewed head:** `85d17a5993269e00acb65ddaf3513f9e47115783`
- **Delta base:** `c993b525ae725989243ae266dfdbc28e1bdf2e99`
- **PR head confirmation:** `gh pr view 589` reports the exact SHA above.
- **Verdict:** **BLOCKED** — pending create-dialog intent can follow a project route change and open against the wrong project.

## Scope

Reviewed the complete seven-path `c993..85d17a59` diff: work-list route/dialog loading and retry state, extracted shared-UI dialog shell and trigger ref, loading/error E2E journeys, generated contrast inventory updates, and query-checker lexical type-binding fix/tests. Consulted the previous `c993` Sol finding and earlier independent PR 590 UI reviews. I did not rereview the unchanged 641-file body of #589.

## Blocking finding — project route changes leave the pending intent open

In `apps/web/src/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx`, the `openCreateDialog` async callback sets `isCreateOpen`, awaits the shared shell import, and later sets `isCreateDialogReady` without capturing the initiating project identity or checking whether the route is still the same project (around lines 112–125). While the shell is loading, the rendered fallback is only a non-modal `role="status"` element (around lines 304–335); the Escape handler closes this pending intent and returns focus, but other route navigation remains possible.

The work list is a single dynamic route keyed by `$projectKey`; its component state is not keyed/remounted by the project parameter. On an A→B project navigation during the pending import, `isCreateOpen` remains true. Once the import resolves, the shell is rendered with the current `project.id` at line 320, so a create intent started on A can display a form scoped to B. A user can then create in the unintended project. The pending intent must be bound to its initiating project (or cancelled on parameter/workspace change), and the regression journey should switch projects while the shell request is held and verify that no dialog for B appears.

The previous Escape-specific defect is addressed: the route installs a pending-open Escape listener, restores focus to the trigger, and the new E2E case checks the dialog remains closed after shell continuation. Reopening after Escape remains possible because the cached import resolves on the next intent. Error retry still uses the documented page-reload path; closing the route before a pending import resolves unmounts the route, so a late state update cannot open a dialog on the new route. The project-parameter change is different because the same route instance persists.

## Query-checker delta

The current `check:queries` uses lexical static value bindings for known database roots and follows bounded Reflect/apply/call/bind forms. The current checker tests now include the previously missed object aliases, destructuring, sequence callee, `globalThis.Reflect`, nested forwarding, and shadowed namespace cases. The c993 Sol finding is corrected: generic type-parameter bindings are keyed by lexical binding identity, nested generic alias expansion terminates, and the function-generic shadow cases resolve as non-database.

I reran a bounded direct probe matrix at this exact head. The previously missed Reflect forms now report the underlying method (`select`) instead of no finding or a synthetic method name. The two c993 Sol regression probes return finite results: unrooted nested generic identity resolves to no database finding; the registered `DbTransaction` chain reports `select`; a generic parameter shadowing imported `DbTransaction` reports no finding. I found no remaining blocker in the reviewed query-checker delta.

## UI, URL, retry, and contrast review

- The P2 work-item `filter` remains sourced from `Route.useSearch()`, passed to the query hook, and applied by merging into current search state, preserving sort/direction URL state. The filter contract says the `filter` query parameter reproduces the query after reload/share.
- The extracted shell continues to use `@taskdesk/ui` Dialog primitives and accessible title/description/close labeling. The form remains its own lazy boundary; the work-items list and shell/form have independent loading boundaries.
- The trigger ref is passed through the shared `Button`; pending Escape restores focus, and the loaded dialog retains Escape close/reopen behavior.
- The shell call-chain entries in `packages/ui/src/styles/pairs.json` now include its field, alert, and dialog text surfaces. Author-reported exact-head contrast inventory is 434 pairs. Current hosted G8 is green, corroborating visual gate execution; no browser session was run as part of this review.
- The new failure state is an alert with a reload retry action. E2E author evidence covers one failed shell request, reload recovery, close, and reopen. I found no other blocker in retry or permission-trigger rendering; backend policy remains authoritative if permission changes while the dialog is open.

## Checks actually run

- `node --test scripts/ci/check-queries.test.mjs` — **21/21 passed**.
- `pnpm check:queries` — passed on current API source.
- `pnpm --filter @taskdesk/web exec vitest run src/lib/routes.test.ts` — **24/24 passed**.
- `pnpm --filter @taskdesk/domain exec vitest run src/sla/sla.test.ts` — **35/35 passed**.
- `pnpm --filter @taskdesk/api exec vitest run tests/api/auth/configuration-version.test.ts` — **6/6 passed**.
- `git diff --check c993b525..HEAD` — passed.
- Author reports exact-head web typecheck/build, preload unit test, three browser journeys, and 434 contrast pairs. These are recorded as author evidence, not browser runs by this reviewer.

## Current required-gate status and limits

The exact-head hosted snapshot has static, route policy, unit/domain (while one repeat was still in progress), build, G4, G8, CodeQL, supply-chain, Helm, and CI-manifest checks green. PR-template/security-review and OpenAPI drift remain red; PostgreSQL integration and G11 remained in progress when queried. GitHub had no review records at that snapshot. The previously identified OpenAPI contract decision and G11/runtime/status-contract blockers remain unwaived. A fresh required GPT-6 Sol review must still attest the corrected exact query-control head after ordinary review clears.

I did not run browser journeys, SQL/integration, Docker/image boot, or performance measurement. No UI screenshots or product acceptance are independently claimed. The prior provider-reload and SLA pause-overlap review findings are outside this delta and are not duplicated here.
