# PR #769 security review record: saved views (#714) and the structured work-list it contains (#715, PR #768)

PR #769 closes #714 (M3) and contains PR #768 (#715, M4) at its reviewed head `91b37b46`; #768 is absorbed when #769 merges. #715 adds the structured filter editor over `POST /api/work-items/search`, dynamic columns, URL state and cursor pagination; the F3 export hold is respected. #714 adds the saved-view index and detail, with the SV-19 authorized fallback, sharing, pinning and deletion requests; the SV-17 hold is respected. `apps/web/e2e/**` is security-scope.

A Claude Sonnet 5.5 lane implemented both. The reviewers below are fresh, independent contexts.

## Review chain

- #768 ordinary review C by Claude Sonnet 5.5: APPROVE at `c7722924`, delta APPROVE at `91b37b46` (pagination, disclosure a11y, translated errors, parser mutants killed).
- #768 ordinary review D by Claude Sonnet 5.5: APPROVE at `c7722924`, delta APPROVE at `91b37b46`.
- #768 security review by Claude Opus 5.5: CLEAR at `91b37b46` (server whitelist authoritative, URL-state parsing bounded, error detail hidden, no export surface; 5 mutations caught).
- #769 ordinary reviews C and D by Claude Sonnet 5.5: APPROVE at `71f039ec`; mechanical APPROVE at `0f72a0a7`.
- #769 security review by Claude Opus 5.5: CLEAR at `71f039ec` (SV-19 runs as the viewer only; server-enforced sharing and deletion; 6 mutations caught); mechanical rebind CLEAR at `0f72a0a7`, a clean merge of `main` `9bb28099`.

**Reviewed head:** `91b37b462786f8250ce5bd2d003c9d16394cd3ee`
**Reviewed head:** `71f039ec31f0423f56b6bfadb90c23c510c20bfa`
**Reviewed head:** `0f72a0a717066e1021d4f53cc5a403455ef5aa5f`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `768-ordinary-c-sonnet.md` | #768 ordinary review C (main..91b37b46) | Claude Sonnet 5.5 | `91b37b46` | APPROVE | `065252e9420373f8a3f955f34f0a51570c77824aaa91c3b9e676e7cdfb0fb6b1` |
| 2 | `768-ordinary-d-sonnet.md` | #768 ordinary review D (main..91b37b46) | Claude Sonnet 5.5 | `91b37b46` | APPROVE | `49adf0305847a01e70a1fcbdaaca56ef72e16a7d9571c8ff7808111ea4ba3ce9` |
| 3 | `768-security-opus.md` | #768 security review (main..91b37b46) | Claude Opus 5.5 | `91b37b46` | CLEAR | `ebcc61ffa419010e0baa8af7ee60524cec546e41139218f49a5dcec6dc4985e6` |
| 4 | `769-ordinary-c-sonnet.md` | #769 ordinary review C (91b37b46..0f72a0a7) | Claude Sonnet 5.5 | `0f72a0a7` | APPROVE | `05b884123d97a94676c725f0c749f25823a34dc02d31a1d0ab2136e6696e4bb7` |
| 5 | `769-ordinary-d-sonnet.md` | #769 ordinary review D (91b37b46..0f72a0a7) | Claude Sonnet 5.5 | `0f72a0a7` | APPROVE | `0c650b5481e019db743ebe35ccf459ffbbc06066df761533312a30f28ea47c84` |
| 6 | `769-security-opus.md` | #769 security review and rebind (91b37b46..0f72a0a7) | Claude Opus 5.5 | `0f72a0a7` | CLEAR | `939c8dcc7eed70c230452a340126f413d15c13dd8f12d6e629a6c5cb3e61910a` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/768-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 065252e9420373f8a3f955f34f0a51570c77824aaa91c3b9e676e7cdfb0fb6b1) -->
# PR #768 ordinary review C (#715 structured work-list: filter editor, columns, URL state, search wiring)

**Reviewed head:** c77229245d6f955a153585736478af730373f247
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 768` (2 commits: a7c392b5 feature, c7722924 baseline PNG only). Diff base d159704b (merge-base; origin/main has since moved to 8ed5fef2, not re-based onto). Comparison: #589 (origin/codex/bulk-integration-20261006), SV-11/12/13/19 in docs/03-features/search-and-saved-views.md. Scratch detached worktree, removed afterwards.

## Commands

| Check | Result |
| --- | --- |
| install frozen, `pnpm turbo typecheck` | exit 0, 9/9 |
| apps/web `vitest run` (full) | 192 files, 1112 tests passed |
| `pnpm check:tokens` (web build + contrast) | exit 0, 418 declared, source-grounded pairs |
| `check:ui`, `check:i18n`, `check:visual-scope`, `check:vocabulary` | all exit 0 (visual-scope: 19 cases, 18 active inventory rows) |
| `biome ci` on apps/web/src, the new e2e spec, i18n | clean; ui-boundaries OK (186 + 771 files) |
| Playwright: structured-search, work-item-list-layout, work-list-i18n-deferred (17 tests) | 17 passed. Port 4178 was busy (another lane), so I ran from a scratch config on 4190; the g11 fixture hardcodes 4178 for base URL and CORS, so I also patched that helper in the scratch worktree only (reverted). Before the helper patch all 16 specs that use the fixture failed with the list error state, which is that hardcoding, not the PR |
| Mutations on parsing/serialisation (8) | 5 killed, 3 survived (see N2) |
| Ad-hoc round trip battery (14 ASTs plus unknown fields) | all equal after print then parse |

## Correctness findings by area

- Filter lib: `apps/web/src/lib/work-item-filter.ts` is byte-identical to #589's approved file. Its leaf validation mirrors the server `validateWorkItemSearchQuery` whitelist (apps/api/src/work-item/search/query.ts): same fields, operators, enums, bounds (state 20, priority 20/4, dueDate 32 and 1-3650d, createdAt 10, project/type 100, depth 8, 64 leaves, 1-32 clauses, 8192 text) and the same `@me`-only rule for assignee (eq) and watcher (contains). Unknown fields and recognised-but-unavailable fields (`sla.*`, `cf.*`, `label`) deliberately pass client validation so the server's 400/422 is authoritative. `@me` is sent as the literal and resolved server-side (SV-13).
- AST round trip: canonical printing writes every group as `AND(...)`/`OR(...)` with quoting of anything outside a safe character class, as SV-11 specifies; infix/parenthesised input is still accepted. Lossless in my battery (lte/gte, quotes, backslashes, unicode, values `and`/`OR`, one-child groups, nested groups, unknown fields). The client sends the AST (not text) to `POST /api/work-items/search`, so the printer's explicit-group syntax never has to be accepted by the server's text parser.
- Search wiring: the project is added as a leading `project eq <slug>` clause under an `and`; `position` sort is not forwarded; empty sort/columns are omitted; a malformed URL filter is converted to a client 400 and never sent. Error detail read from plain-text or JSON, bounded to 512 printable characters, shown only for 400/403/422 beside the editor and only while the applied filter equals the draft (stale errors do not stick). Covered by e2e ("unavailable field shows the server's 422").
- URL/history: filter, filterMode, columns, sort, dir all in the URL via `parseWorkItemListSearch` (total, never throws; unknown or oversize/control-character values dropped, columns must be a unique subset). Apply and mode switch are `navigate` pushes, so back/forward walks the queries; the editor resyncs drafts from the `filter` prop in an effect. e2e covers history and reload keeping sort, direction and columns.
- No export or download surface: grep of the non-test diff for export/download/csv/Blob/createObjectURL finds only the comment in `work-item-list-controls.tsx`; e2e "offers no export control (F3 hold)" passes; no i18n key mentions export or download.
- packages/ui primitives only (Alert, Button, Input, Select family); ui-boundaries and check:ui pass. All 18 locale files in sync (non-English carry English text, as in the sibling PRs).
- Contrast manifest: `pairs.json` is verified against live source contexts by the checker (shown in my #760 review: removing an entry fails it), so the additions are source-grounded; the check passes against the built CSS in light and dark.
- Linux baseline (c7722924): the only changed file is `work-item-list-linux.png`; sha256 9c5709d3... equals the evidence's `target-snapshot-hashes` and `snapshots-after-tests`. Evidence pre-update run: 18/19 pass with the single failure exactly `work-item list screen @visual` (equal to the expected set); post-update 19/19. Snapshot hash lists before/after differ only on that one path. I diffed old and new PNGs (both 1280x720): the differing region is a 180x30 box in the toolbar, and a crop shows the new "Filter" button between Board and Create work item. Expected change only.

## Findings

Blocking: none.

Non-blocking:
- N1. The filtered list ignores `page.hasMore`/`nextCursor`; the endpoint default is 50, so a filter matching more than 50 items silently shows the first 50 with no indicator. The unfiltered list has the same pre-existing limitation (documented in `get-work-items.ts`), but a filter makes it easier to hit. Suggest a "showing first 50" notice or a follow-up issue.
- N2. Three surviving mutants show missing assertions for SV-11 lossless behaviour: (a) printing `lte` as `<` (operator token table) is not caught, i.e. no unit test prints and re-parses a `lte` leaf; `gte` is covered; (b) removing the quoting of a value equal to `AND`/`OR` in `printValue` is not caught; (c) dropping the one-value check for `contains(...)` (extra arguments silently discarded) is not caught. The shipped code is correct for all three (my ad-hoc battery passed), so these are test gaps in a file identical to #589.
- N3. A filtered result is displayed with the unfiltered-list realtime component; query-key prefix invalidation still reaches it, but there is no test that a realtime invalidation refetches the search read (low risk).
- N4. Board layout ignores the URL filter and says so in a notice (tested); acceptable, but the Filter button is hidden on board, so a filtered board link cannot be cleared from the board.
- N5. The PR carries a scratch-environment fragility: the e2e fixture hardcodes port 4178 (pre-existing, not introduced here).

## Residual risk

Server behaviour was exercised only through the mocked network edge and the existing server integration tests; I did not run the API integration suite (no API change in this PR). The origin/main drift after d159704b was not merged in.

**Verdict:** APPROVE

---

## Delta review: c7722924 to 91b37b46

**Reviewed head:** 91b37b462786f8250ce5bd2d003c9d16394cd3ee
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Delta: 36 files (+815/-98), no snapshot PNG touched.

| Check | Result |
| --- | --- |
| `pnpm turbo typecheck` | exit 0, 9/9 |
| apps/web full `vitest run` | 192 files, 1131 tests passed (was 1112) |
| Previously surviving mutants re-applied (`lte` printed as `<`; AND/OR value quoting removed; `contains()` arity check removed) | all 3 now die (1 failing test each in `src/lib`) |
| New mutants: drop `cursor` from the search request; `getNextPageParam` always undefined | both die |
| Playwright (scratch config on port 4190, 4178 was busy; fixture port patched in scratch only, both reverted, nothing committed): structured-search, list-layout, i18n-deferred | 19 passed, including the new "more than one page loads the rest on demand" and "disclosure: focus enters the editor and returns on close" |
| `check:visual-scope`, `check:ui`, `check:i18n`, `biome ci` | pass |

Verification of each fix:
- Cursor pagination: filtered reads now use `useInfiniteQuery` (key gains a `"search"` segment); the plain list read is back on the original `["work-items", projectId, sort, dir]` key and its own query, so existing list-key users and `["work-items", projectId]` prefix invalidation are unaffected. `getNextPageParam` follows `nextCursor` only when `hasMore`; pages are flattened and `hasMore` comes from the last page; the fetcher sends the cursor only when set; the list shows a disabled-while-loading "Load more" button only when `hasMore` and a handler exist. Closes my N1.
- Disclosure a11y: `aria-pressed` removed, `aria-expanded` kept, `aria-controls` only while the region exists; focus moves into the editor only when the user opens it (not when the URL did); closing returns focus to the toggle; Escape closes, except when the event originates in a select popup or an expanded control. Covered by the new e2e and unit tests.
- Translated errors: `workItemSearchErrorMessage` maps 400/403/422 to three translated keys, server text is not displayed, other statuses show no filter message; keys present in all locales (check:i18n).
- Test timeout raise in the controls test: lazy-chunk wait only, no logic change.
- Pixels: no PNG is in the delta and the only render-affecting additions (Load more, focus handling, attribute changes) do not appear in the baseline screen (no filter, no more pages). I cannot reproduce the pinned-image run here, so unchanged pixels rely on `check:visual-scope` plus that structural argument.

New non-blocking notes: (a) Escape closes the editor and discards an unapplied draft without a prompt (the applied URL filter is kept); (b) with the 30s polling fallback an infinite query refetches all loaded pages in sequence, which is fine at this scale. Earlier N1 and N2 are resolved; N3 to N5 stand unchanged.

**Verdict:** APPROVE

Addendum (from reviewing #769 on a head containing this delta): `work-item-list-controls.test.tsx` "shows a translated message for the endpoint's 400 refusal" timed out in 2 of 3 full-suite runs while the host load average was about 80-100, and passed in isolation and in the quiet-host run above. The raised timeout may still be tight under heavy load. Non-blocking; verdict unchanged.
<!-- END REPORT (sha256 065252e9420373f8a3f955f34f0a51570c77824aaa91c3b9e676e7cdfb0fb6b1) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/768-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 49adf0305847a01e70a1fcbdaaca56ef72e16a7d9571c8ff7808111ea4ba3ce9) -->
# #768 ordinary review D (architecture / contracts / UX)

**Reviewed head:** c77229245d6f955a153585736478af730373f247
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate; reviewer C's report not read)
**Comparison base:** origin/main d159704be626136e728df7ddef0381dc37cf7756 (read-only scratch worktree at the exact head)

Scope: #715 structured work-list. Filter editor (visual and text over one AST), `filter`/`filterMode`/`columns` URL state, `POST /api/work-items/search` read when a filter is present, configurable list columns, board notice. 43 files, web + i18n only.

## Commands run
- `pnpm install --frozen-lockfile --prefer-offline`; `pnpm turbo typecheck`: 9/9 successful.
- Web unit suite (apps/web `vitest run`): **192 files, 1112 tests passed**, exit 0.
- `pnpm check:ui` clean (0 unlisted, 0 Base UI outside packages/ui); `check-tokens.mjs` exit 0; `check:i18n` all 19 locales in sync; `check:inventory` ok (53 generated routes, no new route); `check-bundle-purity` ok.
- `pnpm --filter @taskdesk/web build` then `check-bundle-size.mjs`: **agent 232.3 KB / 350, agent work-list route graph 279.0 KB / 350 (14 assets), portal 164.7 KB / 200**, exit 0. Matches the stated 279 KB.
- Playwright NOT run; read `apps/web/e2e/work-item-structured-search.spec.ts` (tests: filter scoped to project and restored from URL; plain read loads no editor; mode switch keeps sort/dir/columns through history and reload; invalid text never reaches the endpoint; 422 shown beside filter; empty-match state; no export control (F3); board notice; axe in visual and text modes tagged @a11y).

## Architecture and contracts
- URL state / route registry (AGENTS.md rule 4): parsing was moved from `routes.ts` into `lib/work-item-list-search.ts` and re-exported, so the saved-view screens (#714) can reuse identical bounds. Parsing is total (bad values omitted, never thrown, filter bounded to 8192 chars with control characters rejected, columns validated as a duplicate-free subset). `routes.workItemList.build` and `parseWorkItemListSearchFromQueryString` carry the three new params, and unit tests cover build->parse round trip, idempotence, the router's JSON search codec, hostile URLs and "no defaults added". Good fit for the registry convention. Apply and mode change use push navigation (back steps through queries); layout change spreads `prev`, so the filter survives a layout switch in the URL.
- Search grammar / saved-view envelope: the fetcher sends exactly the documented envelope (`{ workspaceId, query: { entity: "work_item", filter, sort?, columns? } }`), only `filter`/`sort`/`columns` (the P1-accepted keys), no `groupBy`/`aggregate`, sort limited to the four search fields (`position` is correctly not forwarded), absent sort/columns are omitted so a later saved view stores only what the user chose, workspace from the body (never inferred from the project filter). Filter tree uses only and/or groups and `{field,op,value}` leaves with the documented fields; client-side bounds (depth 8, 64 leaves, 32 clauses, 8192 text) mirror the server bounds. The project scope is added as a leading `project eq <slug>` clause; this is within the documented grammar, but see finding 4.
- G11 headroom decision: the editor and its controls are `lazy()` and only mounted when the toggle is pressed or when the URL carried a filter at first render (`useState(isFiltered)`); the search fetcher is a dynamic import in the query function; `useGetWorkItems` keeps the old key shape for unfiltered reads and appends filter/workspace/columns only when filtered, so existing `["work-items", projectId]` invalidations (realtime, mutations) still reach both reads. Measured 279.0 KB leaves 71 KB headroom; the decision is sound and effective.
- F3 export hold: respected. No export control, request or download in `work-item-list-controls.tsx`, the editor, the fetcher or the route (greps clean), a unit/e2e test asserts the absence, and the component comment cites the hold.
- G6 four states for the filtered list: loading (existing skeleton plus editor loading status), error (server 400/403/422 text shown beside the filter and the list error state with retry), empty ("matches nothing" variant that keeps the filter visible), partial (State/Assignee now validated by `parseWorkItemRow`, flagged as unavailable per field instead of a blank badge). Covered in unit and e2e tests.
- Board: ignores the URL filter and shows a `role="status"` warning notice instead of looking unfiltered. Honest and covered by test.
- Defaults unchanged: default column order equals the previous hard-coded order; the unconfigured list renders as before.

## Findings (none blocking)
1. NON-BLOCKING (spec drift, record it): `views.md` VW-1 says filter state "survives a layout switch" and the "Read any layout" row lists `POST /api/work-items/search` for every layout. The board here keeps the filter in the URL but does not apply it (notice only). That is a defensible partial delivery, but it is a named gap against VW-1 and should be recorded (status.md or the views.md "not implemented on main" list) so #714 and the board work do not assume it. Also `views.md` still says VW-19 (chosen columns) is not implemented on main; this PR implements URL-carried `columns` for the list, and the doc sketch `?layout=board&state=started&assignee=me` shows separate params whereas the implementation uses one `filter=<text>` param. Docs were not touched in this PR.
2. NON-BLOCKING (a11y, focus management): opening the editor does not move focus into it, and closing does not return focus; the editor mounts after the header row, so a keyboard user pressing the toggle must Tab past the create trigger to reach it. The toggle also carries both `aria-pressed` and `aria-expanded` (two competing toggle semantics on one button) and `aria-controls` points at an id that does not exist while closed. Recommend a disclosure pattern (`aria-expanded` only, controls only when mounted) and focusing the first control or the form on open. Axe tests (serious/critical) and form/fieldset/legend/aria-label structure are otherwise in place; I did not run axe.
3. NON-BLOCKING (i18n/consistency): the API error is rendered as `"<status>: <raw server text>"` and parser errors from `parseWorkItemFilterText` are English `Error` messages shown verbatim, so neither is localized. The sibling #760 explicitly avoids echoing server text. Server 422 text naming the field is useful here, but the numeric prefix is developer-facing; consider mapping by status and keeping the field name as a parameter. The 15 non-English locale files carry English strings for the new keys, which matches the existing convention (check:i18n enforces parity only).
4. NON-BLOCKING (contract): the project clause is ANDed with the user's text. A user filter containing its own `project:` clause silently yields no rows rather than being refused or merged; and when #714 saves "the query document", it must decide whether the injected `project` leaf belongs to the stored query (it is currently added only inside the fetcher, so the URL `filter` text excludes it; the saved-view code must re-add it consistently). Worth one line in the #714 contract.
5. NON-BLOCKING: when sort is `position` (the list default rank order) and a filter is active, the server falls back to `key asc` while no column header shows as sorted; harmless but undocumented in the UI. `hasMore`/`nextCursor` from the search response are carried but the list does not follow or announce them, the same limitation as the existing unfiltered list read; a filtered result larger than one page is silently truncated.
6. NON-BLOCKING: the editor is opened state-wise only on first render (`useState(isFiltered)`); navigating back/forward to a filtered URL while the editor is closed leaves it closed while the toggle shows the active label. Acceptable, mildly surprising.
7. INFO: the visual baseline PNG (`work-item-list-linux.png`) was refreshed for the new Filter button; I did not inspect it or run visual tests.

## Residual risk / not checked
No Playwright (e2e, axe, visual) run; no live API check of the search route's 400/422 texts; did not read other reviewers' reports.

**Verdict:** APPROVE

---

## Delta review: c7722924 -> 91b37b46 (findings 2, 3 and 5 addressed)

**Reviewed head:** 91b37b462786f8250ce5bd2d003c9d16394cd3ee
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Checked in a worktree at the #769 head, which contains 91b37b46 as an ancestor (verified); I reviewed `git diff c7722924 91b37b46` only (36 files, +815/-98). Typecheck 9/9; the work-item unit tests in that tree pass (see the #769 report for the 414-test saved-view/lib run and the full-suite note). Playwright not run.

- Disclosure pattern: the toggle now carries `aria-expanded` only (the competing `aria-pressed` is gone) and `aria-controls` only while the controlled region is mounted. That is the correct WAI-ARIA disclosure pattern. Focus: opening moves focus into the editor only for a user-initiated open (`autoFocus` set by the toggle, not by a URL that already carried a filter), via a ref and an effect that focuses the first button/input/combobox after the lazy chunk mounts; closing from the toggle or Escape returns focus to the toggle. Escape handling ignores events from inside an open select/listbox (`closest('[role=listbox],[role=option],[aria-expanded="true"]')`) and respects `defaultPrevented`, so a select popup still closes itself first. Residual (non-blocking): the first focusable is the mode switch button rather than the first filter field; Escape discards an unapplied draft without warning.
- Error mapping: `workItemSearchErrorMessage` maps only 400/403/422 to three translated messages (`filter.errors.invalid|forbidden|unavailable`), shows nothing for other statuses, and never echoes server text, field names or the numeric prefix. This closes finding 3. Non-blocking: a 403 from the whole route (for example a customer principal) reads as "no access to filter by one of these fields", and a 400 from a bad cursor reads as "invalid filter"; acceptable, rare.
- Pagination vs the search API cursor contract (api-design.md: opaque keyset cursor bound to workspace, normalized query document and limit; mismatch is 400): the fetcher sends top-level `cursor` with the identical scoped query on every page and no `limit` (default 50 each page), so cursors stay valid. `useInfiniteQuery` is used only when a filter is present; `getNextPageParam` follows `hasMore ? nextCursor`; `select` flattens pages and reports the last page's `hasMore`. The list shows "Load more" with a disabled/loading label. Query keys: the unfiltered list keeps its four-element key; the search key adds `"search"` at index 4, so every `["work-items", projectId]` or `["work-items"]` invalidation (realtime, bulk assign, comment-visibility setting) still reaches both, and no code reads or writes `["work-items", ...]` data with `setQueryData`, so the infinite-data shape cannot collide with a `WorkItemsResult` consumer. Interval/realtime refetch of an infinite query re-reads all loaded pages with their stored cursors, which keyset cursors tolerate. Closes finding 5 for the filtered list (the unfiltered list's single-page behaviour is unchanged and pre-existing).
- i18n: new keys present in all 19 locales (English placeholders in non-English files, the established convention).

**Verdict:** APPROVE
<!-- END REPORT (sha256 49adf0305847a01e70a1fcbdaaca56ef72e16a7d9571c8ff7808111ea4ba3ce9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/768-security-opus.md; Claude Opus 5.5; sha256 ebcc61ffa419010e0baa8af7ee60524cec546e41139218f49a5dcec6dc4985e6) -->
# PR #768 (#715 structured work list) — security review

**Reviewed head:** 91b37b462786f8250ce5bd2d003c9d16394cd3ee
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge-base d159704be626136e728df7ddef0381dc37cf7756 (origin/main at review time 9297362b5f2dd1f17da935c8051c1562b473638a)
**Role:** independent security reviewer; did not author, direct or remediate this change. Read-only (scratch detached worktree, removed afterwards).

Head confirmed with `gh pr view 768 --json headRefOid` = 91b37b46..., state OPEN, MERGEABLE.

## Surfaces examined

- `apps/web/src/lib/work-item-filter.ts` (tokenizer, parser, printer, client-side leaf validation, bounds)
- `apps/web/src/lib/work-item-list-search.ts`, `apps/web/src/lib/routes.ts` (URL state: `filter`, `filterMode`, `columns`, `sort`, `dir`, `layout`)
- `apps/web/src/fetchers/work-item/search-work-items.ts` (request body for `POST /api/work-items/search`, error detail handling)
- `apps/web/src/lib/work-item-search-error.ts`, `components/work-item/work-item-list-controls.tsx`, `work-item-filter-editor.tsx` (error mapping)
- `apps/web/src/hooks/queries/work-item/use-get-work-items.ts` (query keys, cursor pagination, placeholder data)
- `apps/web/src/components/work-item/work-item-list.tsx`, `work-items-panel.tsx`, route `agent/projects/$projectKey/work.tsx` (rendering, export hold)
- `apps/web/e2e/work-item-structured-search.spec.ts` (security-scope path)
- Server counterpart read for alignment only: `apps/api/src/work-item/search/query.ts` (field whitelist; `default:` → 400), `search/repository.ts` (cursor bound to the query).

## Checks and conclusions

1. **No raw query fragments.** The client builds a JSON AST (`{field, op, value}` / `{op, clauses}`) and sends it as JSON; no string concatenation into a server query language. Operators are produced only from a fixed set (`eq|in|contains|lt|lte|gt|gte`, `and|or`). Unknown fields are deliberately passed through for the server to refuse; the server's `switch` whitelist answers 400 for anything else. The server is authoritative.
2. **Project scope cannot be escaped.** The user filter is always wrapped as `AND(project = <slug>, <user filter>)`; an `OR(...)` inside the user filter cannot widen it. Reach is server-side.
3. **URL state.** `parseWorkItemQueryState` whitelists `sort`/`dir`/`filterMode`/`layout`, bounds `filter` to 8192 chars with no control characters, and accepts `columns` only as a duplicate-free subset of the six known columns (JSON-string or array). No property of the parsed object is used as a write target, so no prototype pollution; probe with a `__proto__`/`constructor` URL confirmed `({}).polluted` stays undefined and hostile values fall back.
4. **XSS.** All rendered values (titles, state, assignee, client parse errors) go through React text nodes; no `dangerouslySetInnerHTML`/`innerHTML` in changed files. Detail links use the pre-existing `detailHref` construction.
5. **Error mapping.** The UI shows only translated messages keyed by status (400/403/422); server text is kept in `HttpError.message` but not rendered (unit tests assert this). Client-side parse errors are client-authored strings.
6. **Export hold.** No export/download control or download start; e2e asserts no `export|download` button.
7. **Cursor pagination.** The infinite query key includes `projectId`, sort, dir, filter, workspaceId and columns; cursors are per key and the server binds a cursor to its exact query. Placeholder data is reused only for the same `projectId` (test-covered).

## Commands run (real results)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck --concurrency=2` | exit 0, 9/9 tasks |
| `vitest run` 8 targeted files (filter, list-search, fetcher, hook, editor, controls, list, route test) | exit 0, 8 files / 119 tests passed |
| `pnpm turbo build --filter=@taskdesk/web` | exit 0, 5/5 tasks |
| `playwright test e2e/work-item-structured-search.spec.ts` (scratch config, port 4391, uncommitted; scratch-only port edit in the g11 fixture) | exit 0, 12 passed |
| Scratch probe test (deep nesting, prototype keys, hostile URL), deleted afterwards | 3 run; observations below |

## Mutation testing (each reverted; worktree confirmed clean after each)

| Mutation | Test outcome |
| --- | --- |
| M1 drop the leading `project` clause (send user filter unscoped) | killed — `search-work-items.test.ts` 1 failed / 8 |
| M2 render server error text instead of the translated message | killed — `work-item-list-controls.test.tsx` 4 failed / 6 |
| M3 remove the URL filter length/control-character bound | killed — `work-item-list-search.test.ts` 1 failed / 14 |
| M4 accept any `columns` value from the URL | killed — `work-item-list-search.test.ts` 1 failed / 14 |
| M5 reuse placeholder rows across a project switch | killed — `use-get-work-items.test.tsx` 1 failed / 9 |

## Findings

**Blocking:** none.

**Non-blocking:**

- **NB-1 (robustness): prototype-chain lookups in plain-object tables.** `aliases[...]`, `FIELD_TOKENS[...]` and `OPERATOR_TOKENS[...]` in `work-item-filter.ts` are plain object literals indexed with user text. A field token named after an `Object.prototype` member yields a non-string `field` (an object or function) in the AST; it serializes to `{}` or is omitted, and the server refuses it with 400. No pollution and no escalation (verified by probe), but the client produces a malformed document instead of a clean refusal. Suggest `Object.hasOwn` checks or `Map`s.
- **NB-2 (robustness): nesting depth is checked only after parsing.** The recursive-descent parser enforces depth 8 in `validateTree` after the parse, so an 8 KB string of nested parentheses reaches the engine stack limit (`RangeError`) first. Every call site catches it (fetcher → 400 not sent; editor → inline error), so nothing crashes and nothing is sent. Suggest a depth counter during parsing.

## Residual risk / not checked

- Server-side search authorization (reach, field permissions, cursor binding) was read for alignment, not re-reviewed; it is outside this PR's diff.
- Did not run full suites (load control); did not test against a real API runtime (the e2e spec is mock-only).
- Visual snapshot and i18n/`pairs.json` changes not security-relevant; not reviewed in depth.

**Verdict:** CLEAR
<!-- END REPORT (sha256 ebcc61ffa419010e0baa8af7ee60524cec546e41139218f49a5dcec6dc4985e6) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/769-ordinary-c-sonnet.md; Claude Sonnet 5.5; sha256 05b884123d97a94676c725f0c749f25823a34dc02d31a1d0ab2136e6696e4bb7) -->
# PR #769 ordinary review C (#714 saved views index and detail, stacked on #715)

**Reviewed head:** 71f039ec31f0423f56b6bfadb90c23c510c20bfa
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 769`. Reviewed the #714 delta over #715's head 91b37b46 (`git diff 91b37b46 71f039ec`: 52 files, +7366/-145; commits 3480ae3f feature, a9d7e527 baselines, bda2ad3e translated refusals, plus two merges of #715). Spec: SV-14..SV-21 in docs/03-features/search-and-saved-views.md; server: apps/api/src/view (policy.ts, update/create/delete controllers). Scratch worktree, removed afterwards.

## Commands

| Check | Result |
| --- | --- |
| install frozen, `pnpm turbo typecheck` | exit 0, 9/9 |
| apps/web full `vitest run` | run 1: 4 failed (timeouts, see N1), 194/198 files; run 2: exit 0, 198 files, 1253 tests; run 3: 1 failed (`work-item-list-controls.test.tsx`, a `findBy` timeout), otherwise passed. The 4 run-1 failures re-run in isolation: 4 files, 22 tests passed |
| Playwright (saved-view-detail, saved-view-deletion, structured-search, project-views-a11y; scratch config on 4192 plus fixture port patched in scratch, reverted) | 35 passed |
| `check:i18n`, `check:ui`, `check:visual-scope`, `check:vocabulary`, `check:policy` | exit 0 |
| `pnpm check:tokens` | exit 0, 418 declared pairs (source-grounded) |
| `biome ci` on apps/web src+e2e and i18n; ui-boundaries | clean (OK, 186 + 786 files) |
| Mutations (8 applied) | all 8 killed (details below) |

## Spec and behaviour checks

- SV-14: the stored envelope `{entity, filter, sort[{field,direction}], columns}` is translated both ways in `lib/saved-view-query.ts`; the stored `direction` vs the search endpoint's `order` difference lives only there; no defaults are ever added (a view that stored no sort or columns is not given one by opening, running or re-saving). `isExecutableSavedViewQuery` refuses anything the screen cannot carry (groupBy, aggregate, extra keys, non-work-item entity, bad sort/columns) and the screen then says so and keeps the stored query untouched on save.
- SV-15/16/18 (audience): Private is the default for create, duplicate and clone. Team is offered only with `saved_view:share`, workspace only with `workspace:manage_settings`, and a current value is always kept selectable so an unrelated edit of an existing team/workspace view does not need the capability. This matches the server: create needs share for team and manage_settings for workspace; update compares with the current row and requires share only when publishing a team view or changing its team (update-view.ts 67-70) and manage_settings only when moving to workspace. Capability flags come from the real `/api/capabilities` shape (`shareSavedViews`, `manageWorkspaceSettings`); `use-workspace-permission.ts` adds them with `false` defaults, plus tests. The server remains authoritative and 403s map to a translated message.
- SV-17 hold: no team-lead edit or ownership transfer UI exists (grep clean); the audience-fields and index comments state it is held; the PR body states TM-8/SV-17 are not claimed. Edit and delete rights are not inferred in the browser.
- SV-19: the URL carries workspaceId, scope, scopeId, layout, filter, sort, dir, columns, filterMode, parsed totally and bounded. Three cases are implemented and tested: (1) readable and URL equals stored definition: server run + count (`POST /views/{id}/run`, `GET .../count`); (2) readable but URL differs: runs as a direct search with the same validator and reach, with a "modified" notice; (3) unreadable (403/404) with a complete snapshot: runs as the viewer through the same search endpoint (field permissions and reach apply), with a notice; an incomplete snapshot runs nothing (`isFallback = viewUnreadable && snapshotComplete`). A complete URL naming another workspace/scope/layout than a readable view is replaced by the stored definition (no other view's query under this view's name), once per context so it cannot loop. A project-scoped fallback narrows by a leading `project` clause once the project resolves; an unreachable project is stated and runs nothing.
- SV-20: pin toggles the caller's own preference via `POST /views/{id}/pin`; state read from the list's `isPinned`.
- SV-21: Duplicate on the index and Clone on the detail screen create a private copy named "<name> copy" (bounded to 200 chars) in one click.
- Deletion: `DELETE /api/views/{id}` is a request that answers 202 with a pending action; the index navigates to the pending-action screen and nothing is removed locally; 403 and 409 (already requested) map to translated messages, as the route documents.
- Counts: index counts are per-view queries that tolerate 422 (count simply not shown), staleTime 30 s matching the server cache.
- `search-work-items.ts` conflict resolution: `postWorkItemSearch` (shared boundary), `parseFilterTextOrThrow` and the default `searchWorkItems` keep #715/#768 behaviour exactly: project clause as a leading `and`, `position` sort not forwarded, empty sort/columns omitted, cursor sent only when set, error detail bounded, `total` added from `meta.total`. The #768 pagination fix is preserved (cursor param present; the 768 specs pass on this head).
- routes.ts: new `savedViews`/`savedView` builders and parsers are total, bounded (ids 200, query 200), and round trip (routes.test.ts +93 lines); route tree and generated metadata updated. No export or download surface was added.
- Baselines: the two new linux PNGs match the evidence's target hashes (`saved-view-detail-linux.png` b326cf28..., `saved-views-index-linux.png` f56313f3...). The evidence run (pinned image v11 at c06b7280) generated them, then re-ran the target without update (2 passed twice), the visual-scope guard passed (21 cases), and the before/after snapshot hash lists differ only by those two added paths (no existing baseline touched; no changed or removed paths). Note the evidence directory has no pass/fail summary file, only step exit codes (all 0) and hashes.
- pairs.json: `check:tokens` passes against built CSS (the manifest is verified against live source contexts, see my #760 review).

## Mutations (all killed)

SV-19 fallback condition dropped `snapshotComplete` (1 test failed); fallback forced off (5 failed); workspace-audience gate on `canManageSettings` removed (2 failed); team-audience gate on `canShare` removed (3 failed); URL context check always passes (2 failed); stored sort direction always asc (3 failed); index duplicate takes the source view's visibility instead of private (1 failed); (one more pattern did not apply and was not counted).

## Findings

Blocking: none.

Non-blocking:
- N1. Under heavy host load (load average about 80-100 from other lanes) the full web suite showed intermittent `findBy`/`waitFor` timeouts (realtime composition, command palette, i18n group test) and `work-item-list-controls.test.tsx` "translated message for the 400 refusal" failed in 2 of 3 full runs here, always passing alone. That test is the one #768's delta raised a timeout for; it still looks the most load-sensitive and could flake in CI.
- N2. The Edit button on the detail screen is offered to every viewer who can read the view; a viewer who is neither owner nor workspace manager gets a translated 403 only after attempting to save. The hold on browser-side ownership inference makes this a deliberate choice, but it is a small UX roughness.
- N3. Duplicate on the index copies the listed view's stored query verbatim, including a query this screen cannot execute; the server validates on create, so this is safe, only possibly surprising.
- N4. The baseline evidence directory lacks a pass/fail results summary (see above).

## Residual risk

Server behaviour only through the mocked network edge and the existing server tests; API integration suites not run (no API change). The merges from #715 mean part of this diff was reviewed in #768; I confined line-level review to the saved-view files and the conflict region.

**Verdict:** APPROVE

---

## Mechanical check: merge of main 9bb28099 (#767 merged)

**Reviewed head:** 0f72a0a717066e1021d4f53cc5a403455ef5aa5f
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate). Mechanical check only: no tests were re-run.

- `gh pr view 769` head equals 0f72a0a717066e1021d4f53cc5a403455ef5aa5f. Parents: 71f039ec31f0423f56b6bfadb90c23c510c20bfa (the previously reviewed head) and 9bb28099a69d1e599e1d7451ebdf6225e380546c (main).
- `git merge-tree --write-tree 71f039ec31f0423f56b6bfadb90c23c510c20bfa 9bb28099` prints the same tree as the new head's tree: the merge is clean, with no hand edits or conflict resolution.
- Merge base with main is d159704b. Main brought 28 files; the diff from the old head to the new head is exactly that file list. None of them is also changed on the PR side since the merge base (overlap: 0 files).
- Main's changes are api project (#767), deploy/compose/docs (#755, #758), #763's two web test files and release workflow; none touches saved-view code, routes, i18n or the two new baselines. The head still contains #768's 91b37b46 (stacked).
**Verdict:** APPROVE
<!-- END REPORT (sha256 05b884123d97a94676c725f0c749f25823a34dc02d31a1d0ab2136e6696e4bb7) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/769-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 0c650b5481e019db743ebe35ccf459ffbbc06066df761533312a30f28ea47c84) -->
# #769 ordinary review D (spec / contract / holds / UX)

**Reviewed head:** 71f039ec31f0423f56b6bfadb90c23c510c20bfa
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate; reviewer C's reports not read)
**Comparison:** `git diff 91b37b46 71f039ec` (the #715 head to this head): 52 files, +7366/-145, web + i18n + one inventory doc row. Read-only scratch worktree at the exact head.

Scope: #714 saved views index (`/agent/views`) and detail (`/agent/views/{id}`), shareable viewer-run URLs, pinned views in the dashboard sidebar, audience fields, deletion request flow.

## Commands run
- `pnpm install --frozen-lockfile --prefer-offline`; `pnpm turbo typecheck` 9/9 successful.
- `check:ui` clean; `check-tokens` ok; `check:i18n` all locales in sync; `check:inventory`: 55 generated routes, all 20 in-progress/complete inventory routes exist; `check-contrast`: 418 pairs ok; `pnpm --filter @taskdesk/web build` + `check-bundle-size`: agent 233.1 / 350 KB, **agent work-list graph 281.6 KB / 350 KB (15 assets)** (the brief said 280.6; I measured 281.6), portal 165.0 / 200 KB.
- Web unit suite, full, once: first run 2 failed / 1251 passed, a second full run 1 failed (`triage.test.tsx`: "Unable to find role=button name Retry", a 1 s findBy timeout) while other lanes loaded the machine. `triage.test.tsx` is untouched by this PR and passes in isolation (5/5). The saved-view, nav-main, fetcher and lib suites pass in isolation: 45 files, 414 tests. I could not identify the other first-run failure (not reproduced). Treat as load-dependent flake, not attributable to this diff; I did not prove the base is also flaky.
- Playwright NOT run; read the e2e specs: `saved-view-detail.spec.ts` (11 tests incl. stored run + count, bare link replaced by full definition, complete link to an unopenable view runs as viewer, incomplete link runs nothing, unreachable project, changed link notice, unsupported layout, edit, pin/clone, two axe tests) and `saved-view-deletion.spec.ts` (deletion is a request into the pending-action flow, refused request keeps list, URL filter/pin/duplicate, private default and capability-gated sharing, axe).

## Spec, contract and holds
- SV-14/SV-19 (URL fully encodes the view): `routes.savedView.build` and `parseSavedViewUrlSearch` carry workspaceId, scope, scopeId, layout and the shared query properties (filter, filterMode, sort, dir, columns), reusing `parseWorkItemQueryState` from #715 so bounds are identical; parsing is total and adds no defaults; build->parse round trip is unit-tested. The index links embed the whole stored definition. Three-case detail logic is well specified: readable view with matching URL runs the server's stored view and count; readable but different URL runs the URL definition as a direct search and says it is not the saved definition; unreadable (403/404 masked) but complete snapshot runs as the viewer through the same search validator, reach and field permissions; incomplete snapshot runs nothing. This honours SV-22 masking (no distinction between missing and out of reach is surfaced) and does not widen reach.
- Saved-view API contract on main: GET/POST `/api/views`, GET/PATCH/DELETE `/api/views/{id}`, `/pin`, `/run`, `/count`, `team-audiences`; client uses typed hono responses, delete is a request (`202` + pending action, nothing removed client-side), count tolerates 422 (no badge), pins keyed per viewer. The stored query document keeps the `{entity, filter, sort, columns}` envelope and "adds no defaults" so opening and re-saving does not mutate a view (SV-14); a layout or query the screen cannot execute is stated and its stored layout/query are left untouched on save.
- SV-15/16/18: private default; team offered only with `saved_view:share`, workspace only with `workspace:manage_settings`, current stored audience stays selectable; team needs one of the caller's own teams from `team-audiences`. Server remains the authority.
- SV-17 / TM-8 holds: team-lead editing and ownership transfer are not offered anywhere (component comment and index comment cite the 2026-10-11 hold); no UI infers ownership. TM-8 (deactivated person stays on rosters) is not touched.
- Native admission / ownership: the view response carries `createdBy` (a person id), and the client has no person id for the caller, so "owner" cannot be known client-side without a new contract. Edit (detail) and Request deletion (index) are therefore shown to every viewer and a 403 is mapped to a translated "you cannot edit/delete this" message.
- Hold F3 (export) and others: no export UI in this PR.

## Findings (none blocking)
1. NON-BLOCKING, UX judgement on Edit / Request deletion for everyone: acceptable for this slice because the server enforces `workspace:manage_settings OR owner` and the refusal is explained, nothing is written on refusal, and deletion is only a request that still needs the requester's step-up approval. It is not good UX: a non-owner can open the editor, make changes and only learn at Save, and "Request deletion" is offered on every card. Preferred follow-up (contract change, so not for this PR): return `canEdit`/`canDelete` (or `isOwner`) per view from `GET /api/views` and `/{id}` so the client renders the actions the server will accept, still without inferring ownership. Record it as a known gap.
2. NON-BLOCKING, navigation gap: the only in-app entry to `/agent/views` is the new "Saved views" item and pinned views in `NavMain`, which belongs to `app-sidebar` (the dashboard shell). The `/agent/*` routes (work list, triage, settings, views) have no shared nav, so a user already inside `/agent/...` reaches views only by going back to the dashboard or by a typed or shared URL. The screen inventory rows were moved to the in-progress marker, which is honest; add the entry to whatever shell serves `/agent` when it exists, and note it in status. Also `isActive` for the new nav items uses `window.location.pathname` at render time, so it does not re-render on navigation by itself.
3. NON-BLOCKING, a11y (same class as my #768 finding, now fixed there): Pin/Unpin and Edit/Cancel-edit buttons use `aria-pressed` while also changing their visible label. A pressed state and a changing name conflict for assistive technology; keep a fixed name with `aria-pressed`, or change the label and drop `aria-pressed`. Labels on the index buttons include the view name (`aria-label` "Pin {name}"), which is good. Axe checks (serious/critical) exist for index, detail reading/editing and the shared-link fallback; I did not run them.
4. NON-BLOCKING, scale: the index issues one `GET /api/views/{id}/count` per visible view (cached 30 s, `retry: false`) and the sidebar one per pinned view; the list endpoint is not paginated in the client. Fine at P1 volumes; consider a batched count or a count on the list payload before views multiply.
5. NON-BLOCKING, copy/i18n: fetchers throw `HttpError` with English fallback strings ("Unable to ..."), but components map by status to translated messages and never display them; the 15 non-English locale files carry English placeholders as elsewhere (check:i18n parity only).
6. NON-BLOCKING, G6: index covers loading (skeleton with status role), error with retry, empty (and empty-search), populated; a failed per-card count is silently omitted (partial, unmarked). Detail covers loading, error (retry vs unavailable), unsupported layout, project unavailable, modified/fallback notices and "load more". Acceptable; the per-card partial could carry a "count unavailable" mark.
7. INFO: docs - `screen-inventory.md` rows updated; `search-and-saved-views.md` and `views.md` were not touched in this PR (SV status and the VW-19/VW-1 notes from my #768 review remain stale).
8. INFO (test infra): see the full-suite flake note above; worth watching, not caused by this change as far as I could determine.

## Residual risk / not checked
No Playwright (e2e, axe, visual baselines for the two new screens). Not read in depth: `saved-view-editor.tsx` internals and `saved-view-query.ts` normalisation beyond the unit tests passing. No live API run; contract checked against the typed client and docs.

**Verdict:** APPROVE

---

## Mechanical check after main moved to 9bb28099a69d1e599e1d7451ebdf6225e380546c

**Reviewed head:** 0f72a0a717066e1021d4f53cc5a403455ef5aa5f
**Model / context:** Claude Sonnet 5.5, fresh independent context (mechanical verification only; no code re-review)

- `gh pr view` head = 0f72a0a717066e1021d4f53cc5a403455ef5aa5f (confirmed).
- Parents: first = 71f039ec (previously reviewed head), second = 9bb28099a69d1e599e1d7451ebdf6225e380546c (equals origin/main, ancestor of origin/main).
- `git merge-tree --write-tree <p1> <p2>` = 1471889c9626cc1c9052ea82df1b55e109e674b7, identical to the merge commit's tree: clean merge, no manual conflict resolution or extra edits.
- Overlap between files changed on the PR side and on the main side since the merge base: none (28 files changed on main).
- Tests not re-run (no PR-side change between the reviewed head and this one).

**Verdict:** APPROVE (unchanged from the prior review of 71f039ec; for a PR with no prior review of mine, this is a mechanical check only)
<!-- END REPORT (sha256 0c650b5481e019db743ebe35ccf459ffbbc06066df761533312a30f28ea47c84) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/769-security-opus.md; Claude Opus 5.5; sha256 939c8dcc7eed70c230452a340126f413d15c13dd8f12d6e629a6c5cb3e61910a) -->
# PR #769 (#714 saved views, stacked on #715) — security review

**Reviewed head:** 71f039ec31f0423f56b6bfadb90c23c510c20bfa
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge-base d159704be626136e728df7ddef0381dc37cf7756 (origin/main at review time 9297362b5f2dd1f17da935c8051c1562b473638a). The head includes all of #768 (91b37b46); the #768 surfaces are covered by `768-security-opus.md` and were re-run here.
**Role:** independent security reviewer; did not author, direct or remediate this change. Read-only (scratch detached worktree, removed afterwards).

Head confirmed with `gh pr view 769 --json headRefOid` = 71f039ec..., state OPEN, MERGEABLE.

## Surfaces examined

- `apps/web/src/components/saved-view/saved-view-detail.tsx` (the three SV-19 cases, run selection, edit/save/clone/pin)
- `apps/web/src/lib/saved-view-query.ts` (executable-query check, URL ↔ stored envelope, context matching, definition matching)
- `apps/web/src/fetchers/saved-views.ts` (`run`, `count`, pin, create, update, deletion request, `runSavedViewUrlQuery`)
- `apps/web/src/fetchers/work-item/search-work-items.ts` (shared `postWorkItemSearch` boundary)
- `apps/web/src/routes/agent/_layout/_authenticated/agent/views.tsx`, `views/$id.tsx`, `lib/routes.ts` (`parseSavedViewUrlSearch`, bounded ids)
- `apps/web/src/components/saved-view/saved-view-audience-fields.tsx`, `saved-view-editor.tsx`, `hooks/use-workspace-permission.ts` (offered audiences)
- `apps/web/src/components/nav-main.tsx`, `lib/saved-view-keys.ts` (pinned views, per-viewer cache keys)
- `apps/web/e2e/saved-view-detail.spec.ts`, `saved-view-deletion.spec.ts`, `work-item-structured-search.spec.ts`, `helpers/axe.ts`, `visual.spec.ts` (security-scope paths)
- Server counterparts read for alignment only: `apps/api/src/view/index.ts` (run/count "with current work-item reach"), `capabilities` (`shareSavedViews`, `manageWorkspaceSettings` exist); spec `search-and-saved-views.md` SV-15..SV-22; decision log 2026-10-11 hold.

## Checks and conclusions

1. **SV-19 authorized fallback runs only with the viewer's authority.** `isFallback = viewUnreadable && snapshotComplete` (403/404 only; a 5xx is not treated as unreadable). In fallback, `view` is undefined so `definitionMatches` is false and the client never calls `POST /views/{id}/run` or `/count`. It calls `POST /api/work-items/search` with the URL's definition under the viewer's session. No owner identity, owner reach or stored-view data is used or requested. A project-scoped snapshot runs only when the project is in the viewer's own project list (`useGetProjects`), narrowed by a leading `project` clause; otherwise "unavailable", and nothing runs. An incomplete snapshot runs nothing. Unit and e2e tests assert `run`/`count` call counts of 0 and the exact search body.
2. **Readable view, foreign context.** A complete URL whose workspace/scope/scopeId/layout differ from the stored view is replaced by the stored definition once (`savedViewUrlContextMatches`). Another workspace's query never runs under this view's name. Same context with a different filter runs as a direct search with the viewer's reach, with a "modified" notice.
3. **URL envelope cannot escalate.** `parseSavedViewUrlSearch` bounds ids and whitelists scope, layout, sort, dir and columns; filter text is parsed to the same AST as #768. A stored query is executed client-side only if `isExecutableSavedViewQuery` accepts it (no `groupBy`/`aggregate`/unknown keys). The server re-validates every save and search.
4. **Mutations go through the server API.** Pin, create/clone (always `visibility: "private"`), update and deletion all call `/api/views` routes. Deletion is `DELETE /api/views/{id}` → `{pendingActionId}`, then navigates to the pending-action review screen; nothing is removed client-side. 403 and 409 are shown as refusals.
5. **Edit gating.** Edit is offered for any readable view and the server decides; a 403 on save is shown as "forbidden". Team and workspace audiences are offered only with `saved_view:share` / `workspace:manage_settings` (from `/api/capabilities`), and only for UI choice.
6. **SV-17 hold respected.** The UI offers no team-lead editing and no ownership transfer, matching the decision-log hold. Edit rights stay with the server's owner/workspace-manager rule.
7. **Cache isolation.** Every per-viewer key (list, detail, count, run, team audiences) includes the user id. Logout clears the query client.
8. **XSS.** View names, server visibility strings and counts are rendered as React text only.

## Commands run (real results)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | exit 0 |
| `pnpm turbo typecheck --concurrency=2` | exit 0, 9/9 tasks |
| `vitest run` 11 targeted files (saved-view-query, saved-views fetcher, detail, audience fields, views index, nav-main, routes, workspace permission, search fetcher, filter, list-search) | exit 0, 11 files / 227 tests passed |
| `pnpm turbo build --filter=@taskdesk/web` | exit 0, 5/5 tasks |
| `playwright test e2e/saved-view-detail.spec.ts e2e/saved-view-deletion.spec.ts e2e/work-item-structured-search.spec.ts` (scratch config, port 4392, uncommitted; scratch-only port edit in the g11 fixture) | exit 0, 28 passed |

## Mutation testing (each reverted; worktree confirmed clean after each)

| Mutation | Test outcome |
| --- | --- |
| M1 incomplete link runs in fallback (`isFallback = viewUnreadable`) | killed — detail test 1 failed / 26 |
| M2 unreadable view uses the stored-view run (`definitionMatches` true without a view) | killed — detail test 5 failed / 26 |
| M3 accept a complete URL naming another workspace/scope/layout under this view | killed — 2 failed (query lib + detail) / 64 |
| M4 drop the project narrowing of a project-scoped URL query | killed — 2 failed / 39 |
| M5b deletion request skips the pending-action review | killed — views index 1 failed / 19 |
| M6 treat any error (incl. 5xx) as unreadable → fallback | killed — detail test 1 failed / 26 |
| (M5 first attempt was a malformed mutation that broke compilation; discarded, not counted) | — |

## Findings

**Blocking:** none.

**Non-blocking:**

- **NB-1 (by design, noted):** a crafted complete link to a view the viewer *can* edit pre-loads a different query. If the viewer then explicitly opens Edit and saves, that query is persisted. It needs two deliberate clicks, the "not the saved definition" notice is shown, the editor displays the query, and the server authorizes the update. Acceptable; record only.
- **NB-2:** inherits #768's two robustness notes (prototype-chain lookups in the parser's token tables; depth checked after parsing). Neither changes authority here: `canonicalFilter` and `printStoredFilter` catch the errors, and `savedViewQueryDocument` throws before any save request.

## Residual risk / not checked

- Server enforcement of `/views/{id}/run`, count caching, SV-22 reach and pending-action deletion was read for alignment, not re-reviewed (outside this diff).
- The e2e specs are mock-only; no real API runtime run. No full suites (load control).
- No e2e-level mutation (would need a rebuild per mutation); unit-level kills above.

**Verdict:** CLEAR

---

## Mechanical rebind after main moved to 9bb28099 (#767 merged)

**Reviewed head:** 0f72a0a717066e1021d4f53cc5a403455ef5aa5f

**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context (the same context that wrote the #760/#768/#769 security reports)
**Main:** 9bb28099a69d1e599e1d7451ebdf6225e380546c (#767 merged: `PUT /api/project/{id}` engagement fields need `project:manage_settings`, plus docs, tests and the review note)
**Previous reviewed head:** 71f039ec31f0423f56b6bfadb90c23c510c20bfa

Method (read-only, no checkout of the working tree): `git fetch`, `gh pr view --json headRefOid` (confirmed OPEN, MERGEABLE).
- **Parents:** `git log -1 --format=%P <new>` = `71f039ec31f0423f56b6bfadb90c23c510c20bfa 9bb28099a69d1e599e1d7451ebdf6225e380546c`, which is the previous head plus the new main. It is a plain "Merge remote-tracking branch 'origin/main'" commit.
- **Merge-tree equality:** `git merge-tree --write-tree 71f039ec31f0423f56b6bfadb90c23c510c20bfa 9bb28099a69d1e599e1d7451ebdf6225e380546c` = 1471889c9626cc1c9052ea82df1b55e109e674b7, which equals `<new>^{tree}` = 1471889c9626cc1c9052ea82df1b55e109e674b7. The merge adds nothing beyond a clean, conflict-free merge.
- **Overlap:** the files the PR changes (from its old merge base) do not intersect the files main changed since that base (empty intersection). `git diff <old> <new> -- <PR files>` is empty, so the PR's own content is byte-identical.
- **Interaction:** main's changes since d159704b are the project engagement server rule (#767), deploy/compose/traefik and loopback scripts, docs, the release workflow, and the web test `setup.ts` (adds Testing Library `cleanup()` in `afterEach`, test-only). None touch saved views, work-item search, the filter parser, URL parsing, capabilities or `/api/views`. The contained #768 content (91b37b46) is likewise unchanged.
- No new code to test; the previous runs and mutation results stand for identical PR content.

**Verdict:** CLEAR
<!-- END REPORT (sha256 939c8dcc7eed70c230452a340126f413d15c13dd8f12d6e629a6c5cb3e61910a) -->
