# PR 590 hosted MFA / observability timeout investigation

**Candidate:** `80ad3ba85530190c18bca94ad7aa249971899c11`  
**Role:** independent, source-only investigation; no source edits and no runtime/browser/database/container/performance probes performed.

## Evidence inspected

- Hosted workflow log: `hosted-80ad-e2e.log`.
- Playwright retained context: `hosted-80ad-smoke/mfa-csrf-journey-P0-MFA-an-37ae9--and-backup-code-challenges/error-context.md`.
- Exact candidate E2E: `apps/web/e2e/mfa-csrf-journey.spec.ts`.
- Exact candidate settings page: `apps/web/src/routes/agent/_layout/_authenticated/god-mode/observability.tsx`.
- Shared select: `packages/ui/src/components/select.tsx` (Base UI Select wrappers).
- API schema and GET/PATCH semantics: `apps/api/src/observability/settings.ts` and `apps/api/src/instance/observability/index.ts`.

The hosted log says 24 tests, one worker. Tests 1–22 passed; test 23 (`P0 MFA and CSRF browser journey`) failed at its 240,000 ms timeout; test 24 realtime passed. The failure's last Playwright step is `observability: select original realtime log level`. The retained page snapshot shows the Observability page, realtime combobox expanded, current/selected value `debug`, and all four options (`error`, `warn`, `info`, `debug`) present. The trace/video/screenshot are explicitly disabled in the spec; this saved error context is a DOM snapshot, not a screenshot or action log.

## What source establishes

The test reads the initial observability DTO via `GET /api/instance/observability`. It derives `initialRealtime = modules.realtime ?? default`, changes realtime, saves and reads it back, restores the default, then reopens the realtime select and awaits an exact-name option click for `initialRealtime`. Its expected type is the four-level union.

The page renders each module in a controlled shared `Select`; realtime's value is `settings.logLevels.modules.realtime ?? settings.logLevels.default`. The option list is generated from the same four-value list. The API's strict Zod DTO requires a valid default and permits an optional realtime level from that same enum. GET parses persisted data through that schema; PATCH validates input and uses version compare-and-set before applying the requested levels.

Thus the retained snapshot rules out the straightforward hypothesis that the requested original value is outside the page's supported option vocabulary or that the realtime option list is empty. It does **not** establish the actual `initialRealtime` value in this run, show the locator's Playwright call log, prove whether the option click was attempted/actionable, or establish whether a preceding step consumed most of the four-minute test budget. The title of the last step locates where the timeout interrupted the test; it is not a diagnosis of the underlying failure. No reproducible source-level defect is established by these artifacts.

## Remaining hypotheses (unproven)

1. The final option locator/click was blocked or did not complete despite the visible listbox (for example, an actionability/overlay/focus issue in that hosted viewport).
2. Earlier operations in the same long journey consumed nearly all of the per-test 240-second budget, leaving the final click to be interrupted. The workflow report gives total test duration, not per-step times.
3. The persisted initial realtime value and rendered value diverged during the journey. The snapshot gives rendered `debug`, but the log/context does not expose the initial, changed, and restored DTO values or versions needed to test this.

## Smallest necessary probe

On a permitted hosted rerun of the unchanged exact candidate, retain the Playwright action call log/trace for this test and record the four DTO checkpoints already read by the test (`initial`, changed default, changed realtime, restored) plus per-step elapsed times. Keep the same 240-second budget and assertions. This will distinguish a stuck locator/action from time spent in earlier requests and will confirm whether API and controlled-select values diverged. Do not infer a product fix or increase the timeout from the current evidence alone.
