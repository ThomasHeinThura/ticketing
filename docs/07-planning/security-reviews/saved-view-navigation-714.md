# Saved-view agent navigation — SV-18 / issue #714

**Reviewed head:** `aea331da76ffa9d80e5c16e62f4d012e9778283d`

The existing shared sidebar is now reachable from agent project work and saved-view routes. It includes every reachable workspace-visible view plus the viewer's other pins, with pins first and stable ID deduplication. The existing endpoint owns reach; viewer/workspace cache separation, delayed saved-view fetch and registered URLs remain. Selected routes use one common Layout/provider and its existing accessible sidebar trigger. Dashboard and God Mode keep their current shell ownership. Mobile selections close the drawer so destination content becomes accessible.

The original five-path source631d received two fresh independent Luna reviews. Both same independent contexts then inspected the ten-path aea331 semantic follow-up: required first-paint translation namespaces, valid list-item loading markup, mobile toggle/close, and meaningful browser/unit regressions. The combined source differs from10236 in11 unique paths; overlapping deltas are not added into a fictitious15-path total. Six authentic reports from the author and those two independent contexts are preserved verbatim below. Four ordinary reports represent two independent contexts across their original and follow-up scopes. Requested model selections are dispatch provenance; no served-backend fingerprint is exposed or invented. The conductor directed bounded repairs and is not an independent reviewer.

Actual author checks: five focused files/25tests passed; normal agent and portal build passed; three saved-view Playwright specs passed17/17, configured retries0/zero skips, including all three existing axe checks. Root independently inspected raw summaries/hashes and ran the final clean-source web typecheck: native0 in7.439seconds,175-byte raw log SHA25695366165839fdc672cd919cc16e5a9d79b64f7643de3015fa1c64ff1e3a376b5. Biome and source/range Gitleaks passed. Initial build failure, axe/mock/selector failures and mobile overlay failure remain retained privately and described by the author; no assertion, axe rule, snapshot baseline or tolerance was weakened. Browser interactions use the real frontend/router with mocked APIs. They do not establish real-provider/backend authorization or final SIT acceptance.

## Screens opened

Root viewed all four actual captured frames. Desktop frames visibly use dark mode; no light-mode or pinned Linux-baseline pass is inferred. Screens reside privately under `takeover/EVID/sv18-navigation-runtime-luna/screenshots-final/`.

| Route | Viewport | Actions and actual evidence |
| --- | --- | --- |
| `/agent/projects/WLP/work?layout=list` |1280x720| Verified one sidebar, pinned-private before workspace-visible unpinned view, excluded unpinned private/team rows; clicked workspace view. `project-work-sidebar.png`, SHA256038c771eddccf6839b5cee73e2f3fffc2f153115685beb2b0485b4616268c8f0. |
| `/agent/views/view-workspace-visible` with stored workspace/list/filter URL state |1280x720| Verified heading, stored query and one sidebar; returned to index. `workspace-view-detail.png`, SHA256a415ff3d2b8395829a9c283dcd27ae48c6520c8778fea545cc1f94fc78ee6877. |
| `/agent/views` |1280x720| Reached index from sidebar and then private pinned view. `saved-views-index-from-agent.png`, SHA256767052f1f3194756a922b71fac9e35db966f500c77b4d6524421a843d4c9ba23. |
| `/agent/views/view-private-pin` |1280x720| Browser asserted destination heading and one sidebar; no separate screenshot captured; final17/17 command log retains the assertion result. |
| `/agent/views/view-workspace-visible` after keyboard-opened mobile sidebar selection |375x720 dark| Verified dialog opens, workspace view selection closes it and destination heading becomes accessible. `mobile-dark-workspace-view.png`, SHA256bf31fe33fdb84d7c32928a1eb956ef8d5cab0debe07d815bdd35a8b1e6d1affb. |

## Remaining acceptance

This branch is source and bounded mock-browser evidence, not accepted-main integration. No separate Sol verdict for this UI component is claimed. It must be conserved into the SAME existing Carrier C; the required combined ordinary panel, full independent security review, numerical/source-bound G3 inventory, pinned visual baselines, G11, full applicable suites and shipping image gates remain mandatory on that composition. This note neither waives them nor promotes older results. Real API/provider workflows, the final signed combined release/digest, laptop SIT, consistent nonempty-attachment backup, usable isolated restore, final audit and whole580/589/stage claims remain unfinished. Existing owner holds remain unchanged.

## Preserved report: sv18-agent-navigation-author-luna-v2.md

# SV-18 agent navigation author and verification report (v2)

Date: 2026-10-17
Worktree: /Users/heinthura/.codex/worktrees/ui714-sv18-current-luna
Branch: codex/714-agent-navigation-sv18 (pushed; tracking origin/codex/714-agent-navigation-sv18)
Base: 10236d0cf0f14a6be6e590998119c49a5e96f15b
Commit: 631d57bb8bb4d0c16457511329fccfa0f39812cb
Parent: 10236d0cf0f14a6be6e590998119c49a5e96f15b
Subject: fix(web): expose saved views in agent navigation
Post-push status: clean; local HEAD equals upstream branch HEAD. No PR opened.

## Implemented scope

The workspace sidebar now includes each reachable workspace-visible saved view for every workspace member, plus private/team views pinned by the current viewer. Pinned views come first. Duplicate IDs preserve the first server record. The existing API reach contract, viewer/workspace query keys, delayed post-paint fetch, count queries, UI primitives, registered URLs and URL search state remain in use. Unpinned private/team views remain absent from navigation.

The existing common Layout/AppSidebar is mounted from the authenticated route for /agent/projects/* and /agent/views (including detail routes). Existing dashboard routes remain owned by their explicit layouts; /agent/god-mode/* stays outside the conditional workspace shell to preserve the no-active-workspace instance-admin path.

## Changed files, commit paths and final hashes

Commit changes exactly these five paths:

- apps/web/src/components/authenticated-route-content.test.tsx — SHA-256 4f0fd6b84f63cc6d52c4936368385a3d8886cd7b51be1a48f26040cba1deb107
- apps/web/src/components/authenticated-route-content.tsx — SHA-256 d7cb26afdbcb9af88508f68d0bdb5d500f82df183409b7aa7b40f8aafda469b0
- apps/web/src/components/nav-main.test.tsx — SHA-256 0b6949460fc8c78bb491a17000d689e4cbbf0003fce39b03a51c43fe49a4da4c
- apps/web/src/components/nav-main.tsx — SHA-256 3d0b1b18a7f8baac9831bb6263764e30d90161a79f741af061ddcfa79c23549b
- apps/web/src/routes/agent/_layout/_authenticated.tsx — SHA-256 eb580115e5b553c550dced4eb8a1a8c0c014a6d6065357552c3a63ed1c7b3453

The v1 author report remains preserved at /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/sv18-agent-navigation-author-luna.md.

## Verification

- pnpm install --offline --frozen-lockfile: exit 0; no dependency changes.
- pnpm exec biome check --write on the five changed files: exit 0; formatted two files. Final pnpm exec biome check on those same five: exit 0, no changes required.
- Focused Vitest command for nav-main.test.tsx, authenticated-route-content.test.tsx and existing _authenticated.test.tsx: 3 files passed, 24 tests passed, exit 0. This includes existing session-route redirect/retry regressions.
- Initial focused run had 1 failure in 24 tests: the dedup fixture expected the first duplicate ID’s label, while Map replacement retained the later record. The implementation now preserves the first record, matching stable deduplication; no assertions were weakened. The full initial failure output remains in 03-focused-tests.log and the passing rerun is in 04-focused-tests-rerun.log.
- pnpm turbo build --filter=@taskdesk/web^...: exit 0, four dependency build tasks successful. It built missing workspace exports normally; API task was only its ordinary bundle build, with no service started.
- pnpm --filter @taskdesk/web typecheck: exit 0 (app and node TypeScript configs).
- git diff --check and staged/commit diff checks: exit 0.
- Gitleaks source scan over exactly the five assigned files: exit 0 for each; committed range scan 10236d0..631d57b: exit 0. Commands used redact mode. Logs are under /Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/sv18-agent-navigation-runtime/.
- Normal commit hooks completed successfully; normal push to the assigned branch succeeded.

Private evidence directory mode is 0700 and command logs are created O_EXCL with mode 0600. No browser, Docker, DB, image, application runtime, full web suite, or external observer was started. No credentials were printed.

## Limits and handoff

This is author work only. It is not an independent review, browser journey, screenshot/visual proof, carrier composition, accepted-main integration, or UI acceptance. No issue/stage/predecessor is closed. Root may now conduct source review and assign the two independent ordinary reviews; browser/visual evidence remains required on the eventual carrier candidate.

## Preserved report: EVID/sv18-631d-ordinary-a-luna.md

# SV-18 ordinary review A — navigation

Date: 2026-10-17
Model: GPT-6 Luna
Role: Fresh independent ordinary reviewer
Independence: I did not author, direct, or remediate this candidate. Review assignment arrived as a bounded read-only task.
Worktree: `/Users/heinthura/.codex/worktrees/ui714-sv18-current-luna`
Reviewed head: `631d57bb8bb4d0c16457511329fccfa0f39812cb`
Comparison base: `10236d0cf0f14a6be6e590998119c49a5e96f15b`
Scope: SV-18 agent navigation only. No broader #713 identity/outbound scope.

## Verdict

**PASS — no blocking or non-blocking findings from static source review.** The implementation follows the selected SV-18 contract: it lists all workspace-visible views returned by the reach-filtered endpoint and the current viewer's other pinned views; it places pinned rows first while preserving order within each group; it retains viewer/workspace cache separation and does not request the list before first paint; it preserves the existing route destination and adds the shared shell only for agent project and saved-view paths. Private/team views that are not pinned are omitted.

The defensive ID deduplication keeps the first eligible record in the source list. The focused test covers duplicate workspace records and pinned/workspace ordering. Since the API list contract supplies saved-view records with unique IDs, I found no user-visible defect in this handling.

## Inspected

- `git diff --name-status` and full patch from base to reviewed head: exactly five paths, two added and three modified; `git diff --check` returned clean.
- `apps/web/src/components/nav-main.tsx`: reach-based view selection, visibility and pin predicate, ID deduplication, stable pinned-first ordering, count query keys and navigation URL.
- `apps/web/src/components/nav-main.test.tsx`: workspace-visible inclusion, unpinned private/team exclusion, ordering, ID dedup, viewer isolation, workspace isolation and delayed fetch assertions.
- `apps/web/src/lib/saved-view-keys.ts` and `apps/web/src/fetchers/saved-views.ts` call sites: list keys include workspace and viewer; count keys include viewer, view ID and update timestamp. No fetcher or key contract was changed.
- `apps/web/src/components/authenticated-route-content.tsx` and its tests; `apps/web/src/routes/agent/_layout/_authenticated.tsx`; existing common Layout/AppSidebar composition; saved-view index/detail route composition. This adds the existing shared sidebar shell to `/agent/projects/*`, `/agent/views`, and `/agent/views/*`, while leaving `/agent/god-mode/*` and legacy dashboard shell ownership outside this conditional wrapper.
- `docs/03-features/search-and-saved-views.md` SV-18/SV-20, screen and API contracts; active mission and review workflow.
- Author reports were used as navigation aids only; conclusions above were checked against source.

## Verification and limits

This was a read-only static review. I ran no Node command, tests, browser, database, Docker, install, build, or application runtime. I make no claim about browser rendering, visual behavior, API integration, served backend fingerprints, or acceptance on a composed carrier. The author's test/build results remain author-reported evidence, not independently reproduced here.

## Preserved report: sv18-631d-ordinary-b-luna.md

# SV-18 ordinary review B — GPT-6 Luna

Date: 2026-10-17
Reviewer: independent fresh context assigned by /root
Model dispatch: explicitly assigned as GPT-6 Luna by the parent task dispatch; this context did not author, direct, or remediate the candidate. No separate model-spawn arguments were exposed in this reviewer context.
Candidate: 631d57bb8bb4d0c16457511329fccfa0f39812cb
Comparison base: 10236d0cf0f14a6be6e590998119c49a5e96f15b
Candidate parent: 10236d0cf0f14a6be6e590998119c49a5e96f15b

## Verdict

**PASS — no blocking findings.** The source change implements the SV-18 navigation rule while retaining SV-20 per-viewer pin behavior and mounts the existing shared sidebar on the selected agent project-work and saved-view paths. The source review supports this bounded verdict; it does not accept the UI or the carrier.

## Scope checked

Reviewed the exact candidate diff for these five paths: `apps/web/src/components/authenticated-route-content.tsx`, its new test, `apps/web/src/components/nav-main.tsx`, its test, and `apps/web/src/routes/agent/_layout/_authenticated.tsx`. Read the repository instructions (`AGENTS.md`, `CLAUDE.md`, `docs/04-engineering/agent-workflow.md`), `docs/03-features/search-and-saved-views.md` (SV-18/SV-20 and screen/API contracts), the two assigned takeover evidence reports, shared `Layout`/`AppSidebar`, saved-view route components, URL route helpers, query keys, and fetchers. Also inspected the project-work route ancestry and dashboard layout ownership.

## Findings

No blocking defect found in the reviewed source. `AuthenticatedRouteContent` wraps `/agent/projects/*` and `/agent/views` plus detail paths with the existing `Layout`; the `/dashboard/*` routes and `/agent/god-mode/*` remain outside this conditional wrapper, preserving their prior ownership and the no-workspace God Mode path. The selected route files do not add another common `Layout`, so the conditional wrapper does not duplicate the shared shell on those paths.

`NavMain` includes every returned workspace-visible view and any returned pinned view, omits unpinned private/team views, deduplicates by id while keeping the first server record, and places pinned rows first with stable server ordering within the groups. It continues using the endpoint’s viewer reach, the workspace-and-viewer list key, viewer-specific count keys, delayed post-paint loading, and per-view count queries. Failed/unsupported counts leave the view link present and hide only its badge. Existing route builders and detail-route search handling continue to own the view URL state; the sidebar navigates to the registered detail route with the view id.

The added tests exercise the predicate’s selected path classes, pinned/workspace visibility, omission of unpinned private/team records, first-record deduplication, order, count failure behavior, workspace/viewer cache separation, and delayed fetch. The route-content test replaces `Layout` with a test wrapper, so it demonstrates conditional wrapping but does not itself prove the real `AppSidebar` is rendered exactly once; the source composition inspection found no duplicate for the paths reviewed. This is a test-depth limitation, not a blocking source defect.

## Verification and limits

This was a read-only static review. I ran no tests, browser flow, database, Docker, build, install, or runtime. The author evidence records focused tests and build/typecheck results, but those are author-run evidence and were not independently reproduced here. Browser/visual journey evidence remains outstanding per the takeover report. This verdict applies only to the exact candidate SHA and the five changed files above. No overall carrier approval, UI acceptance, issue closure, or stage completion is asserted.

## Preserved report: EVID/sv18-navigation-author-luna-v2.md

# SV-18 agent-navigation author record (v2)

- Worktree: `/Users/heinthura/.codex/worktrees/ui714-sv18-current-luna`
- Branch: `codex/714-agent-navigation-sv18`
- Base: `631d57bb8bb4d0c16457511329fccfa0f39812cb`
- Commit: `aea331da76ffa9d80e5c16e62f4d012e9778283d` (`fix(web): complete agent sidebar navigation`), parent is the base above.
- Push: ordinary push succeeded to `origin/codex/714-agent-navigation-sv18`; no PR opened.
- Worktree status after push: clean.
- Exact changed paths and committed-content SHA-256:
  - `apps/web/e2e/saved-view-navigation.spec.ts` — `b835da063a6440b6286487046576c3ce9c19bd2a2f20f3b3c35491f56828cd8c`
  - `apps/web/src/components/app-sidebar.tsx` — `2c4943a85b734157571a7d730b0b1d7ca6697caa1275eb40723d28204ca5a204`
  - `apps/web/src/components/app-sidebar.test.tsx` — `096ff776a85498558257ea67cb2201b7045bf022867508a3ed44ef3709f26484`
  - `apps/web/src/components/authenticated-route-content.tsx` — `5b67f61af133917c0eea95cc213ff528da99dc86d1b115de23b225098fe26aba`
  - `apps/web/src/components/authenticated-route-content.test.tsx` — `1d5bbec20db7d80c9fd07c9cbe61ad90b523d8bdd937ba86b6bf068540ef7d83`
  - `apps/web/src/components/nav-main.tsx` — `d7e7d58236a86a0322c17488fa9b3cf24dc58a8f628bda34b4551cad8d7f7987`
  - `apps/web/src/components/nav-main.test.tsx` — `0e75a8e51240cbdd912d836304b4d5e4452b74029d52b1d58a9e7e2c2180d9a7`
  - `apps/web/src/lib/i18n/index.group.test.ts` — `8bf7ea5755e2c8130389399223cd347883a1fb745cd0834f62a35ad7a70a9994`
  - `apps/web/src/lib/i18n/work-route-namespaces.test.ts` — `52b861ebeb85feceef81d19cf0b477b28aa1855ab1d7dd8a7c121ba93ee56c52`
  - `apps/web/src/lib/i18n/work-route-namespaces.ts` — `54f8005ba7a6e1adbb8aa60e1cdde7888e261cb99f5d3b8bba4a75e9deba80b4`

## Changes

The browser build identified that `notification-dropdown.tsx` uses `notifications` and `lib/i18n/domain.ts` resolves `tasks` labels before the work route's deferred translation group. Both namespaces are now in the first-paint group; the catalog test includes those actual modules via the existing namespace detector, and the group-mode test verifies both translations resolve before paint while `settings` remains deferred and no deferred fetch starts before the gate.

The `NavProjects` lazy fallback now places each skeleton inside the existing `SidebarMenuItem`, keeping list children valid; a focused component regression holds the actual lazy import unresolved and checks both list entries. Selected agent project/view routes now include the existing `Layout.Header` and design-system `SidebarTrigger` with the canonical translated accessible label. `NavMain` closes the off-canvas mobile drawer after selecting a navigation item or a pinned/reachable saved view, while desktop behavior and navigation targets remain unchanged; focused tests cover mobile close and desktop non-close.

The new browser journey begins at `/agent/projects/WLP/work?layout=list`, confirms saved-view sidebar composition and pinned-first ordering, excludes unpinned private/team views from navigation, navigates to the workspace-visible detail and back to the index, then opens a private pinned view. It checks the saved-view URL definition including `filter=priority:high`. At 375x720 in dark mode it uses the canonical sidebar trigger by keyboard, confirms the real mobile dialog opens, selects the workspace view, confirms the dialog closes and destination becomes accessible. API responses are mocked through the existing G11 browser fixture; this exercises the real frontend/router and is not real-provider/backend authorization acceptance.

## Verification

- Biome format/check passed on all ten changed files; `git diff --check` and staged `git diff --cached --check` passed.
- Focused Vitest: 5 files passed, 25 tests passed, 0 failed (`EVID/sv18-navigation-runtime-luna/11-focused-ui-i18n-mobile-tests.log`).
- Normal `pnpm --filter @taskdesk/web build` passed for agent and portal (`EVID/sv18-navigation-runtime-luna/12-web-build-final.log`). The initial build failure and all failed/intermediate browser attempts remain in the same evidence directory.
- Final existing Playwright command covered `saved-view-navigation.spec.ts`, `saved-view-detail.spec.ts`, and `saved-view-deletion.spec.ts`: 17 passed, 0 failed, 0 skipped, 1 worker, configured retries 0 (`EVID/sv18-navigation-runtime-luna/15-playwright-three-specs-final-screenshot.log`). The three existing axe checks passed; no axe assertions, baselines, or tolerances were changed.
- Source Gitleaks scan across the ten exact files and commit-range scan `631d57bb8bb4d0c16457511329fccfa0f39812cb..HEAD` both passed with no leaks (`16-gitleaks-source-scan.log`, `17-gitleaks-commit-range.log`). Normal commit hooks passed the ten-file Biome check.

Four final actual frontend screenshots, captured at the tested steps and copied to the private evidence folder, are:

- `screenshots-final/project-work-sidebar.png` — 1280x720 — SHA-256 `038c771eddccf6839b5cee73e2f3fffc2f153115685beb2b0485b4616268c8f0`
- `screenshots-final/workspace-view-detail.png` — 1280x720 — SHA-256 `a415ff3d2b8395829a9c283dcd27ae48c6520c8778fea545cc1f94fc78ee6877`
- `screenshots-final/saved-views-index-from-agent.png` — 1280x720 — SHA-256 `767052f1f3194756a922b71fac9e35db966f500c77b4d6524421a843d4c9ba23`
- `screenshots-final/mobile-dark-workspace-view.png` — 375x720 — SHA-256 `bf31fe33fdb84d7c32928a1eb956ef8d5cab0debe07d815bdd35a8b1e6d1affb`

The first Playwright attempt had three serious axe findings for the fallback list and a mock work-item query mismatch. After the list repair and using the existing fixture's supported work-list URL, those issues cleared. Later attempts exposed an ambiguous saved-view index selector and then the mobile dialog staying open after navigation; selector scoping and the bounded `NavMain` mobile close addressed those. Full logs and original failure traces were retained privately; no raw trace was copied to a shared report.

This is an author record, not independent review or SV-18 acceptance. Two independent ordinary delta reviews and the parent’s integration/visual review remain outstanding. No full web test suite, database, Docker, or provider-backed authentication test was run.

## Preserved report: EVID/sv18-aea331-ordinary-a-luna.md

# SV-18 ordinary review A — semantic delta

Date: 2026-10-17
Model: GPT-6 Luna (requested Luna-tier dispatch)
Role: Fresh independent ordinary delta reviewer
Independence: I did not author, direct, or remediate this candidate. I reviewed the prior 631d candidate independently; this task is a new exact-head review of the semantic delta.
Worktree: `/Users/heinthura/.codex/worktrees/ui714-sv18-current-luna`
Reviewed head: `aea331da76ffa9d80e5c16e62f4d012e9778283d`
Parent / comparison base: `631d57bb8bb4d0c16457511329fccfa0f39812cb`
Scope: Current SV-18 navigation candidate and its semantic delta. Bounded to navigation composition, delayed-fetch/first-paint invariant, responsive sidebar behavior, URL/reach/pin behavior, and the added tests. No broader #713 identity/outbound scope.

## Verdict

**PASS — no blocking or non-blocking findings in the inspected delta.** The original SV-18 behavior remains intact: the sidebar derives navigation entries from the caller-reachable list, includes workspace-visible entries and that caller's pins, sorts pins first, and retains viewer/workspace-specific query keys. The new mobile close behavior is conditional on `isMobile`, so desktop selection does not close the sidebar. Selected route content uses the existing shared Layout, its canonical header and design-system SidebarTrigger, while dashboard/God Mode shell ownership remains outside the route predicate.

The work-list deferred-fetch contract remains explicit: saved-view reads still wait for `afterFirstPaint`; the i18n first-paint group now includes the `notifications` and `tasks` namespaces used by first-paint chunks. The updated namespace test reads the named modules through `referencedNamespaces`, asserts both dependencies are discovered, and verifies they resolve before the deferred group while `settings` remains deferred. The lazy sidebar fallback now gives skeletons the same list-item parent structure as the loaded menu; its test holds the real lazy import unresolved and checks the actual menu children.

The added Playwright journey is non-vacuous by inspection: it installs the existing authenticated/work-item fixture and saved-view API fixture, opens the real project route, checks sidebar composition, view inclusion/exclusion and order, navigates through detail and index URLs, opens a pinned private view, and exercises the mobile dialog via the canonical trigger and verifies it closes on navigation. It is frontend/router coverage with mocked API responses, not real-provider/backend reach acceptance.

## Inspected

- Exact parent-to-head diff: 10 paths (3 additions, 7 modifications), 389 insertions and 13 deletions; `git diff --check` returned clean. Worktree status was clean.
- Full current source/diff for `app-sidebar.tsx`, `authenticated-route-content.tsx`, `nav-main.tsx`, their changed tests, the i18n namespace module/tests, and the added `saved-view-navigation.spec.ts`.
- Existing `AppSidebar` composition confirms it is under the shared Layout's `SidebarProvider`; `NavMain` has no other production call site.
- Existing `afterFirstPaint`, grouped i18n loader and work-route namespace code; `notification-dropdown.tsx` and `domain.ts` confirm actual `notifications`/`tasks` namespace references. The corresponding English catalog sections are about 1.7 KB and 10.1 KB serialized, respectively; this is a modest first-paint expansion compared with the deferred `settings` section (~38.8 KB).
- `g11-performance-fixture.ts` and the added E2E route handlers, confirming the browser journey is authenticated fixture-backed and API-mocked.
- SV-18/SV-20 requirements and the previous independent review. The prior `631d` PASS covered only that exact head and was not treated as approval of this delta.
- The current author report at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/EVID/sv18-navigation-author-luna-v2.md` was used as evidence context; assertions above were checked against current source.

## Verification and limitations

Read-only source review only. Commands actually run in this review: `git status --short`, `git rev-parse HEAD`, `git diff --stat`, `git diff --name-status`, `git diff --check`, and source/evidence reads. No Node, tests, browser, runtime, build, database, Docker, install, or source changes were performed.

The author report says the initial build failed and earlier Playwright attempts exposed axe violations, a fixture mismatch, an ambiguous selector, and a mobile drawer remaining open; it says those attempts and traces remain in the private runtime evidence. It reports the final web build passed and the final three-spec Playwright run passed 17 tests with all three axe checks passing. Those are author-reported results; I did not rerun them or independently inspect the logs. They remain adverse-attempt history, not erased by the final pass. Carrier composition, visual acceptance, and final SIT acceptance remain pending/outside this review.

## Preserved report: EVID/sv18-aea331-ordinary-b-luna.md

# SV-18 ordinary semantic-delta review B — GPT-6 Luna

Date: 2026-10-17
Reviewer: independent context assigned by /root for the follow-up delta
Model dispatch: explicitly assigned as GPT-6 Luna by the parent task dispatch. This reviewer context did not author, direct, or remediate the candidate. No separate model-spawn arguments were exposed in this context.
Candidate: aea331da76ffa9d80e5c16e62f4d012e9778283d
Comparison base: 631d57bb8bb4d0c16457511329fccfa0f39812cb
Original feature base: 10236d0cf0f14a6be6e590998119c49a5e96f15b

## Verdict

**PASS — no blocking findings in the follow-up delta.** This verdict covers the current ten-path candidate delta from its prior reviewed head, including the browser spec and shared-shell mobile/loading/i18n changes. It does not promote the earlier review into a UI or carrier acceptance.

## Scope checked

Confirmed the exact worktree HEAD and clean status. Read the ten-path diff from 631d to aea331 and inspected the resulting source for `authenticated-route-content`, `app-sidebar`, `nav-main`, work-route namespace grouping, the new browser spec, and the related tests. Read the author report at `takeover/EVID/sv18-navigation-author-luna-v2.md` and source-conservation/screenshot-inspection record at `takeover/sv18-aea331-source-conservation-and-root-screenshot-inspection.json`. The delta has 10 paths and 389 insertions/13 deletions. The combined feature candidate from 10236 contains those ten paths plus the five previously reviewed paths.

## Findings

No blocking defect found. `AuthenticatedRouteContent` now gives the selected project and saved-view surfaces the existing common `Layout`, a `Layout.Header`, and the shared design-system `SidebarTrigger` with the canonical translated accessible name. Dashboard and God Mode paths remain outside that conditional wrapper. The route-component and source composition show one shared layout/provider at this boundary; the report’s frontend run also states that one sidebar is present on the covered screens. The component test remains mocked at the `Layout` boundary, so its assertions do not independently prove real sidebar internals.

`NavMain` closes the off-canvas drawer after its navigation selections only when the sidebar reports mobile; it retains navigation targets and desktop behavior. The focused test covers mobile close for the saved-view index and a pinned view, and desktop non-close for index navigation. The new browser spec covers a workspace-visible view selection on the real frontend at 375x720, confirms the dialog closes, and checks a workspace-view URL carrying its stored query. Its API is fixture-mocked, so it does not establish backend reach or authorization behavior.

The lazy project-navigation fallback now wraps each skeleton in `SidebarMenuItem`, matching the menu’s list-child structure; the new test holds the lazy import pending and asserts both fallback children are list items. The namespace update places `notifications` and `tasks` in the first-paint group and expands the scanner test to inspect the notification dropdown and task-domain translation module. The author report records 25 focused tests, both agent/portal web builds, and 17 passing checks across three Playwright specs. Earlier build, axe, selector, mock-fixture, and mobile-overlay failures remain recorded in the author logs; I did not independently rerun or reinterpret those failures as passes.

The browser test asserts the work-list `layout=list` query on entry and checks the saved-view detail URL’s context and encoded filter, then returns to the index and opens a pinned view. This gives non-vacuous route and URL coverage in the recorded mocked-browser run. No issue found in the inspected assertions. Root’s separate screenshot inspection record reports four actual dark-mode frames viewed; I did not view those images in this static pass and infer no light-mode or Linux baseline result.

## Verification and limits

Read-only source/evidence review only. I ran no Node command, tests, browser flow, build, install, database, Docker, or runtime, and made no source changes. Reported author checks were not independently reproduced here. The browser flow is frontend-only with mocked API responses; no backend/provider authorization, accepted-main integration, or SIT acceptance is established. No overall carrier approval, issue closure, or stage completion is asserted. Verdict applies to the exact candidate SHA above and the reviewed ten-path delta.
