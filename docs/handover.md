# Handover for the next Claude coding agent

Thomas requested a stop and handover on 22 October 2026. Resume work only on his instruction. This file records state; it adds no process or approval round.

## Read first

Read [AGENTS.md](../AGENTS.md), [current status](status.md), [requirements](requirements.md), [roadmap](roadmap.md) and the relevant [integration contracts](contracts.md). Original Kaneo at `42bb8011` is the UI/interaction baseline. Reuse Kaneo and `packages/ui`; preserve drag/drop, editors, menus, motion and keyboard behavior. Necessary semantic HTML is allowed inside established components. Preserve persisted APIs, permissions, tenant/portal separation, concurrency, pending deletion and history.

One coordinator, one shared worktree. Preserve all uncommitted/untracked work. No reset, clean, stash, second implementation checkout, force push or direct main push. No new dependency without Thomas’s approval. No commit, push, merge or cloud deployment has been performed in this session. No phase is complete, independently reviewed or Thomas accepted.

## Repository and running build

- Workspace: `/Users/heinthura/Documents/Workfolder/Development/Ticketing.v2`.
- Branch: `feat/batch1-hierarchy-and-parent-editing`; base HEAD `d7be6d0bbf77fdae1471b979896276fcd30eb7ed`.
- Large dirty tree includes prior integration and newly maintained docs. It is intentional. Inspect actual diff before editing; do not treat the base HEAD as the implemented source.
- Laptop agent: `http://localhost:1337`; customer portal: `http://portal.localhost:1337`.
- Last identified running build: **M**, application-input SHA256 `54c03e694ce048447fad10123c9bf2c784980e2e3fdda5473a49dea2a6c42848` across 2,607 build inputs. This excludes docs/tooling and is not a whole-tree freeze or signed shipping image. Later attachment/capability source changes are ahead of M unless the final checkpoint below says otherwise.
- Native PostgreSQL 18 on loopback 62870; restricted application role `taskdesk_local_app`.

Private runtime/provenance files are in `/tmp/taskdesk-local-runtime-9g81j3dq/`. Read locally only when needed. Never print credentials, cookies, database URLs, signing/upload URLs or private configuration. `build-provenance-m.json` identifies all built entries and the email package.

**Critical database distinction:** `taskdesk_browser_journey_1022_test` is the LIVE browser database containing Thomas’s work. Its `_test` suffix does not make it disposable. `env-wrapper.py app|owner|migrate` targets that live database: never run resetting integration fixtures through it. Use a separate dedicated database; the existing `smtp-env-wrapper.py owner ...` targets `taskdesk_smtp_provider_1022_test`. Inspect wrappers before use. Do not rerun the SIT account seeder: it changes fixed accounts/sessions.

User-created HELP-12 (“This is the test”) was not modified by this work. Thomas has also moved other records during testing; do not restore a seeded state over his changes. Disposable verification records include HELP-13–17, but inspect fresh state before any mutation.

## Archive decision: implemented and checked

Thomas explicitly chose **keep archive ignored; migrate all readers first**. Do not reverse `.gitignore` or edit the historical snapshot. `.dockerignore` now excludes `archive*` too.

All 647 numbered rule definitions, summaries, primary phase ownership, verification states and evidence slots match the original index. All 72 indexed contracts and their linked safety/design/operation/import/decision references have maintained destinations. The numbered-rule count does not enumerate every unnumbered paragraph; conflicting/proposed/historical statements are explicitly distinguished. The human catalogue/roadmap remains concise; detailed contracts retain necessary technical clauses.

Combined verification: **1,519 local Markdown links /33 maintained files**, no broken links or operative archive pointers. Actual executable readers pass in an export with no archive directory. Git-history comparisons still use real source history to enforce unchanged ratchets; that is intentional, not an ignored-filesystem dependency. A first export without Git history correctly refused baseline checks; no baseline was fabricated.

Relevant evidence outside the checkout:

- `/tmp/taskdesk-final-maintained-contracts-verification.json` and `/tmp/taskdesk-current-reference-verification.json`.
- `/tmp/taskdesk-verify-all-requirements.py`: compares all 647 definitions/provenance/evidence against the pre-migration index.
- `/tmp/taskdesk-verify-current-references.py`: checks maintained links and indexed sources.
- `/tmp/taskdesk-no-archive-reader-verification.json`: environment/event/vocabulary/UI gates.
- `/tmp/taskdesk-noarchive-feature-reader-witness.log`, `/tmp/taskdesk-noarchive-permission-reader-witness.log`:19 reader tests; filesystem witness confined actual reads to the archive-absent export.
- Source-specific mapping/semantic-curation receipts are `/tmp/taskdesk-*-migration-verification.json`, `*-mapping.json` and `*-semantic-ledger.json`. Earlier receipts precede root’s final crosslink fixes; use the final combined checks for current destinations. Semantic curation is not exact-text equality for every historical paragraph.

The old mandatory per-change review sections were removed. Ordinary PRs describe outcome/checks. Explicit phase completion validates one consolidated independent design/integration/security report, bound to actual source and evidence. Explicit releases validate it before build/publication; ordinary main Edge artifacts are not acceptance. Required remote job names/protections remain. No report was fabricated. Source links outside the checkout/archive are rejected; internal linked bytes are bound.

## Implemented and browser-verified before the latest source slice

Build M contains the shared Kaneo shell, canonical board/list/task presentation and real data. Pointer/keyboard drag/reorder, permitted/default transitions, guarded refusal, title-first creation, labels/dates/assignment, task breadcrumb/property shortcut and context-menu anchoring have local persisted evidence. Full-page width now fills desktop; 390px/1024px checks found no document overflow.

Bulk actions reuse the original floating toolbar/Command/Calendar. Chrome changed HELP-16/17 priority, labels, state, date and assignee; named-holder replacement cancellation/confirmation, reload and API reads retained values. Checklist badge 1/2 and real labels are visible. ⌘A selected 14 loaded items; Escape cleared selection without mutation. Partial-failure/deletion/restricted-actor bulk browser cases remain open.

Comments and attachments use durable pending deletion. Chrome verified exact-target/still-present-before-approval and tombstone/absence afterward. Deleted comment summaries no longer expose former text. Activity renders readable description/attachment summaries. Attachment recovery remains unimplemented. Browser file selection is blocked by Chrome extension file-URL access: do not bypass it or claim upload-control acceptance. Earlier disposable attachment verification used genuine presign/PUT/complete HTTP APIs.

Portal Home/My requests/SUB-1 opened on real APIs; Home rechecked on M. Agent cookie→portal404, portal cookie→agent401. This is scoped evidence, not all portal/identity acceptance. Original creation attachment staging, all motion/responsive/themed journeys and full parity are not accepted.

Runtime SMTP resolves persisted settings authoritatively; disabled/error settings cannot fall back to bootstrap. Both public cold import paths work. Mailpit is optional capture infrastructure; Compose presence does not automatically establish runtime sender configuration. Private SMTP/synthetic provider tests passed; no external mail was sent. Quiet hours/digest/portal preferences and complete producer coverage remain open.

Screenshots: `/tmp/taskdesk-visual-evidence-1022/`, especially `task-full-width-fixed.jpg`, `create-new-label-persisted-k.jpg`, `original-bulk-toolbar-l.jpg`, `bulk-reassignment-confirmation-l.jpg`, `bulk-persisted-reloaded-l.jpg`, `attachment-delete-confirmation-k.jpg`, `readable-activity-m.jpg`.

## Current source checkpoint

The stop request arrived during two bounded source assignments:

1. **Creation attachments:** reuse original CommentEditor Paperclip/paste/drop; stage local files without a shadow task; create one canonical item on explicit submit, then existing presign/PUT/complete. Preserve the created key, attachment IDs/checkpoints and ready siblings; retry failures, reconcile ambiguous completion by ID, and never automatically repeat an ambiguous create POST. No persisted blob URLs or silent deletion on close. Strict optional `createAttachments`/`canCreateAttachments()` projects existing `attachment:create`, never a new permission or inference from generic task writes.
2. **Persisted G11 harness:** separate real-data laptop benchmark from existing intercepted legacy diagnostics. A source handoff does not mean fixture creation, runtime mutation or browser performance execution occurred; coordinate those actions against the existing task authorization and private runtime ownership. See final checkpoint for actual delivered files/checks.

Frontend attachment ownership: `apps/web/src/components/activity/comment-editor*`, canonical create form/shell and new adjacent staging hook/presentation/tests, `fetchers/attachment/work-item-attachments*`. Capability ownership: API capabilities response/controller/project-scope and focused tests; web workspace-permission hook/tests. Root owns i18n/schema and integration docs. New attachment strings are registered across 19 locales with English fallback; translation acceptance is not claimed.

The final stop checkpoint below distinguishes source checks from the running build; do not assume newest source is built or browser verified.

## Checks and unresolved gates

- Full local unit suite on L:12 tasks passed, including web 1,861/277 files and API 975/133. M API rerun: 975/133. Scope-specific later results are in status/final checkpoint; do not substitute old suite counts for new code.
- CI-script suite before the final symlink repair:1,343 passed, 0 failures, 20 existing optional engine skips. Follow-up phase/release43 tests and Biome passed after that repair. These are local results, no remote checks executed.
- M gzip budgets: agent248.0/350KB, direct work route349.6/350KB, portal190.1/200KB. Very little work-route headroom; preserve lazy loading. Later source needs a new measurement.
- Contrast: tracing72 tests passed; last source trace still had28 unresolved occurrences. Computed measurement/manifest reconciliation incomplete. G3 does not pass.
- G11 does not pass. Old harness intercepts data, expects legacy tables/cards/writes and cannot establish current persisted evidence. List currently loads50 with real cursor paging. A500-record database is not a500-row paint result; document-start timing must include loading/painting all expected IDs. Board workload 200, list 500, exact budgets/calibration/sample/retry rules remain unchanged. Earlier laptop calibration factor 0.532 is outside allowed range [0.75,1.75]; never change pins or fake a pass. Portal uncalibrated interactions use unchanged raw thresholds. No live benchmark fixture has been created in this slice.
- Rendered Helm: five profiles have no HIGH/CRITICAL Trivy findings, default 0 HIGH / 2 MEDIUM / 16 LOW, no ignores. Ten regressions/lint/package checks pass; image/cluster boot and attachment-byte migration remain unverified.
- Maintained-doc Gitleaks: 0 findings. Last broader source scan retained transitive KaTeX0.16.47 LOW; shipping image/history/environment scans remain open. Trivy config on `.github` detected 0 supported files and supplies no workflow-security coverage.

## Resume priorities

First read the final checkpoint and inspect actual diff. Complete any source-only attachment/harness checks before rebuilding. Build web with **`VITE_API_URL=''`** for both agent and portal; development-default absolute localhost API breaks portal evidence. Do not run simultaneous web builds: route generation is shared. API unit fixtures reserve9464, so pause only the task-owned SIT API through the private refresh helper when required; do not kill unrelated processes. `refresh-built-sit.py` validates staged outputs, runs checks, swaps and restarts/rolls back; inspect before invoking.

Then finish integrated P0–P4 journeys: original create/attachment recovery, remaining actor/tenant/portal/identity tests, notifications/flags/automations/webhooks/MCP/jobs, real performance/contrast/parity, backup and isolated full restore. Keep current safety and unchanged budgets. Full screenshot parity and motion are not proven by a screenshot count.

Real Entra/provider evidence, external penetration testing, the single fresh independent review of each completed phase, signed/source-identified/digest-pinned Technexus deployment and Thomas’s walkthrough remain outstanding. Do not infer P0–P4 completion from elapsed time or mark a phase accepted without that evidence. P5–P7 and proposed P8/P9 remain documented scope.

## Final stop checkpoint

**Implementation is stopped at Thomas’s request.** All three subagents released their files and stopped. The existing build M/API/PostgreSQL remain available for handover; no user data was removed. No new build, browser verification, commit, push or deployment followed the stop request.

**Creation attachment source:** completed the bounded memory-staging/retry implementation described above. Focused six-file suite **56/56 passed**, all 12 owned frontend paths pass Biome, actual web app+node types pass. Capability projection: **12 API tests +28 hook tests** pass, API production/test types and six-file Biome pass. Root i18n check and formatting pass. Logs: `/tmp/taskdesk-create-stage-{test,biome,types}.log`; capability tests are `tests/api/capabilities/attachment-capabilities.test.ts` and `apps/web/src/hooks/use-workspace-permission-attachments.test.tsx`, alongside the existing scope/hook suites. The final root web typecheck is `/tmp/taskdesk-handover-web-types.log`.

**Still incomplete in attachments:** persisted inline editor embedding, upload ownership continuing through navigation/closing, byte progress/beforeunload warning, expired signed-PUT renewal and ambiguous-create reconciliation. Closing a labeled partial result keeps the item/ready attachments but loses local failed File selections; abandoned pending rows remain normal cleanup work. These are open requirements. The new source has not been built, exercised with real files/APIs or accepted in a browser; build M does not contain it. Do not present “staging implemented” as AT-12/13 completion.

**Persisted benchmark source:** added the read-only list/board runner and private-manifest validation, requiring pre-created dedicated fixtures. Four Node helper tests and targeted strict TypeScript check pass; root reran the four tests. Existing paint-recorder defaults remain; optional canonical exact-ID selectors were added. No real performance result exists.

Delivered benchmark paths:

- `scripts/perf/laptop-sit.mjs`, `.d.mts`, `.test.mjs`.
- `apps/web/playwright.perf-sit.config.ts`.
- `apps/web/e2e/performance.persisted.bench.ts`.
- `apps/web/e2e/helpers/g11-persisted-fixture.ts`, `.test.mjs`.
- `apps/web/e2e/helpers/last-item-paint-recorder.ts`.

Invocation after fixture/privacy work is ready: `node scripts/perf/laptop-sit.mjs /absolute/private/manifest.json /absolute/private/new-output`. Read its validator for the exact manifest/credential schema; do not put secrets in arguments or logs. It checks owned mode0600 regular inputs outside the checkout, exact workspace/organisation/project boundaries, project names beginning `G11 <runId> `,500 list records and 200 board records. It never provisions them. A valid input is not proof that the fixture or metric passed.

**Still incomplete in G11:** real fixture provisioning/readback, recorder browser regressions, real run/calibration, drag/state/rank persistence, portal/action/LCP/CLS coverage and safe failure artifacts. Tracing is intentionally disabled pending privacy verification. Passing the two new paint cases alone cannot establish full G11 acceptance. Existing budgets/calibration are unchanged.

The last integrated full unit suite predates these newest source changes. No whole-suite, bundle-budget or shipping-image pass is claimed for this final source checkpoint. All phase reviews and Thomas acceptance remain outstanding. Resume from this checkpoint and actual diff, not from previous success counts.

Final integration check found two native test-double controls; root replaced them with shared Input/Textarea rather than adding exemptions. The affected 26-test creation file and raw-element gate pass afterward (`/tmp/taskdesk-handover-create-driver-tests.log`, `/tmp/taskdesk-handover-raw-ui.log`). The 56-test focused result precedes only this test-host substitution. Exact final web app/node types are recorded in `/tmp/taskdesk-handover-web-types-final.log`. Final link check including this handover:34 Markdown files, no broken links; all 647 definitions still match.

Private final source receipt: `/tmp/taskdesk-local-runtime-9g81j3dq/handover-source-manifest.json` hashes the nonignored source tree after this handover was written. It is not a commit, build, independent review or deployment. Compare it before resuming if another session may have edited files. Final root web app/node typecheck passed after the test-host fix. All coding agents and test commands are stopped; only the pre-existing laptop SIT application/database remain running for handover.
