# PR 589 project-context lifecycle evidence

- Source base: `85d17a5993269e00acb65ddaf3513f9e47115783` (`codex/bulk-integration-20261006`).
- Change: key the project work-list owner by route project key; associate pending/open/error/retry state with workspace+project identity; invalidate async shell-load completion on close, identity change, and unmount.
- Regression coverage: pending project A shell, navigate to project B before release, confirm no dialog/loading returns after release, intentionally reopen B and verify Escape/focus restoration, browser Back to A with no stale dialog, intentional same-project reopen; leave work route while shell is pending and verify no dialog/navigation corruption; existing normal open/close/reopen, pending Escape, and shell-error/reload recovery journeys remain.
- Browser command: `pnpm --filter @taskdesk/web exec playwright test --config playwright.p0-owned-window.config.ts e2e/work-item-create-dialog.spec.ts`.
- Result: 5/5 passed, 1280×720, mock API only, preview/browser isolated to `127.0.0.1:4179`.
- The one initial run had 4/5 pass and a selector ambiguity (`WLP-1` matched `WLP-10` onward). The exact-name selector was corrected and the complete 5-test suite rerun successfully.
- Screenshots: `project-b-after-cancelled-create-intent.png` shows the B work list with no stale dialog; `project-b-create-dialog-open.png` shows B's explicitly opened form.
- Visual inspection: both screenshots inspected. Test fixture origin helper was temporarily bound to 4179 for the run and restored byte-exactly (`fb36d92d97f474fe35c8740e8eed837b3c630eb9`). Temporary Playwright config removed; no owned 4179 listener remains. Port 4178 untouched.
- Prior source checks at this exact source state: web typecheck, web build, `pnpm check:tokens` (434 pairs), focused work-preload Vitest (1/1), and Biome on changed files passed. The only subsequent source edit was the exact accessible-link locator in the E2E file; Biome and the complete E2E suite passed afterward.
- This is functional mock-browser evidence; it is not a hosted performance acceptance result.
