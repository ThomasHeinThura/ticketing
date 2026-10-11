# PR 590 — independent GPT-6 Luna ordinary review

- Candidate: `32ed86f472645a2c69ea7200c1955e4787bbb1ad`
- Base: `75d2c97b6670e31cba41a82671e8cc7881cfc987`
- PR: https://github.com/ThomasHeinThura/ticketing/pull/590
- Review context: fresh independent reviewer; no authoring or remediation.
- Verdict: **CHANGES REQUIRED** — one blocking create-dialog loading lifecycle defect.

## Scope checked

Inspected the full four-file candidate delta: route loading/open/error/retry state, extracted shell and form boundary, route preload regression test, and all changed E2E lifecycle assertions. Read the repository workflow, SDLC, coding standards, work-item feature contract, current status context, and PR description. Confirmed the supplied base is the actual merge base.

## Blocking finding

**Escape cannot cancel a create-dialog shell that is still loading.** `openCreateDialog` sets the route state to open and begins awaiting the import, but the pending branch renders only a status/skeleton outside any `Dialog`. Thus no dialog key handler, modal dismissal behavior, or focus management is active while the request is pending. The trigger remains the focused element and pressing Escape does not close/cancel the in-flight intent; once the import resolves, the dialog appears. The added E2E test covers Escape only after the form has loaded, so it does not exercise this transitional state. Keep the dialog dismissal surface active during shell loading (or explicitly handle Escape and cancel/ignore the pending open), and add a regression journey that presses Escape before releasing the delayed shell request and verifies the dialog stays closed after release.

## Other checks and evidence

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts 'src/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work-preload.test.tsx'` — **1 file / 1 test passed**.
- `pnpm --filter @taskdesk/web build:agent` — passed.
- Inspected the built agent manifest and generated `index.html`: `work-items-panel` is in the direct work-route initial preload set; `work-item-create-dialog-shell` is a dynamic entry and its Dialog chunk is absent from that initial preload set; the form remains a dynamic import from the shell. This supports the stated dependency-closure claim. Build output included existing Vite config, sourcemap, and large-chunk warnings.
- `git diff --check` — passed; generated build output left no tracked changes.
- Existing route sort state continues to use URL search parsing/navigation. The create dialog open state was already component-local in the base; no new URL-state regression was found in this delta.
- Reviewed reported E2E/browser evidence as author evidence only. I did not run browser tests, SQL, Docker, hosted performance, or external resource checks. First-two-run screenshots were unavailable per task handoff; I do not claim those screen captures as independently verified.
- I found no additional independent blocker in the module cache reset, retry path, shell/form chunk split, or the unchanged build-manifest claim. The PR description correctly says no new hosted G11 performance budget has been cleared.
