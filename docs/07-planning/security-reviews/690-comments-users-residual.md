# PR #690 security review record: #606/#608 residual comment and users units

PR #690 integrates the residual units of historical PRs #606 and #608 that `main` lacked. These are:
- `deletedBy` on deleted-comment tombstones in the activity API (CA-18);
- a PostgreSQL-range bound on the comment version-history cursor;
- the omitted-body comment PATCH as a write-free no-op after every edit check (CA-17, decision log 2026-10-09);
- the `navigation.workspaceSwitcher.instanceUsers` locale key;
- keeping the focused work-item list row in view;
- the ported tests.

The comment controllers and the work-item router are security-scope paths.

A Claude Sonnet 5.5 implementation lane wrote the code. The conductor (Claude Opus 5.5) added the final test commit `5c6589dd`. The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review A (API correctness and tests) by Claude Sonnet 5.5: APPROVE at `bcf65d2b`.
- Ordinary review B (alignment, web, spec and #606/#608 absorption accounting) by Claude Sonnet 5.5: APPROVE at `bcf65d2b`.
- Ordinary delta review by reviewer A's context: APPROVE for `bcf65d2b..5c6589dd`, the omitted-body refusal test added for A's finding F1.
- Security review by Claude Opus 5.5: CLEAR at `5c6589dd`. Its non-blocking items are the duplicate `Comment` schema name in OpenAPI, which predates this PR, the strictness of the no-op body schema, and the optional extra cross-workspace and archived-parent tests.
- Security rebind by the same Claude Opus 5.5 context: CLEAR at `456d5e77`. That commit is a clean GitHub update-branch merge of `main` `727fa8d2` (#686). `git merge-tree` reproduces its tree exactly, and nothing under `apps/api` changed.
- Second security rebind by the same Claude Opus 5.5 context: CLEAR at `87aab535`. That commit is a clean update-branch merge of `main` `468ab265` (#687, docs only), and nothing under `apps/api` changed.

**Reviewed head:** `bcf65d2bbf42589137ef9de26800c072e52ad998`
**Reviewed head:** `5c6589dd2a6f8e21e4c6ee4359dd0d7b07e33a2b`
**Reviewed head:** `456d5e77895bcac6be8c9636ea9c073d97cd828c`
**Reviewed head:** `87aab5358856c1a667303dd5a7e71f8247fffb31`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `690-ordinary-a-sonnet.md` | Ordinary review A (31b98613..bcf65d2b) | Claude Sonnet 5.5 | `bcf65d2b` | APPROVE | `8088cf42f57c922ef64846e12e74f9d937880c06069ff144bf4d86f04a189459` |
| 2 | `690-ordinary-b-sonnet.md` | Ordinary review B (31b98613..bcf65d2b) | Claude Sonnet 5.5 | `bcf65d2b` | APPROVE | `b47aafcdf24fa78360bdf7707b81f19d0b6726b4c42ce637abc04b07eb5065be` |
| 3 | `690-5c65-ordinary-a-sonnet.md` | Ordinary delta review (bcf65d2b..5c6589dd) | Claude Sonnet 5.5 | `5c6589dd` | APPROVE | `dddb3d239d1f16bcf9f38644e05370a486013b470a2fa5bce5fd63c1edb85576` |
| 4 | `690-security-opus.md` | Security review (31b98613..5c6589dd) | Claude Opus 5.5 | `5c6589dd` | CLEAR | `0e6c4f9fc3fb205f5ee54446108e27c6487b6370a2f5f41305e13bec95b34e6e` |
| 5 | `690-456d-security-rebind-opus.md` | Security rebind (5c6589dd..456d5e77) | Claude Opus 5.5 | `456d5e77` | CLEAR | `66fb2a3ca61bf67ee7950842c6fd21311787cc52ad85b5f5150cca742599f4ee` |
| 6 | `690-87aa-security-rebind-opus.md` | Security rebind (456d5e77..87aab535) | Claude Opus 5.5 | `87aab535` | CLEAR | `24cf0b34cd0a29712770cc7538f511a4bd50a1b50d3e5c8dd779491588c00639` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/690-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 8088cf42f57c922ef64846e12e74f9d937880c06069ff144bf4d86f04a189459) -->
# PR #690 ordinary review A (API correctness and tests)

Model: Claude Sonnet 5.5 (fresh independent context, reviewer A; did not author, direct or remediate the PR)
**Reviewed head:** bcf65d2bbf42589137ef9de26800c072e52ad998
Base: origin/main 31b98613a24bb799ba46caf1de4357bd0e90a777 (merge-base equals base)
Scratch copy: detached worktree /Users/heinthura/.codex/worktrees/review-690-a at the head SHA (the source worktree was not modified).

## Files examined
apps/api/src/work-item/controllers/update-comment.ts, list-comment-versions.ts, list-work-item-activity.ts; comment-schema.ts; comment-response.ts; response.ts; index.ts (route descriptions and the PATCH handler at ~1617); docs/03-features/comments-and-activity.md (CA-17/CA-18); docs/07-planning/decision-log.md (2026-10-09 01:53 UTC entry, item 1); tests/api-contract/openapi.json; i18n/schema.json and en-US/de-DE; web work-item-list.tsx and its test; tests/api/comment-version-cursor.test.ts, work-item-comment-schema.test.ts; tests/api-integration/work-item-comment.test.ts, work-item-activity-read.test.ts, work-item-detail.test.ts; implementer notes.

## Commands and results
Setup: `pnpm install --offline --frozen-lockfile` (ok); `pnpm --filter @taskdesk/domain --filter @taskdesk/email --filter @taskdesk/permissions build` (ok; needed because the fresh copy had no package dist, which first caused 18 environmental import failures that are not PR defects).
- `vitest run` of the two new unit files: 2 files, 6 tests passed.
- `CI=true pnpm run test:unit` (apps/api): 118 files, 840 tests passed.
- `CI=true vitest run --config vitest.integration.config.ts work-item-activity-read work-item-comment work-item-detail` (testcontainers, serialized, one process): 3 files, 51 tests passed.
- `pnpm check:openapi`: "tests/api-contract/openapi.json matches the API (280 operations)".
- `pnpm check:i18n`: "All locale files are in sync with en-US."
- Mutation checks (scratch copy only, each reverted afterwards; `git status` clean):
  1. Removed the `cursor.number > POSTGRES_INTEGER_MAX` clause: unit test "bounds version numbers..." FAILED (1 failed, 4 passed).
  2. `commentBody.optional()` reverted to `commentBody`: work-item-comment-schema test FAILED (1 failed).
  3. Removed `if (newBody === undefined) return locked;`: 2 integration tests FAILED (CA-17 no-op in work-item-comment.test.ts, and "treats an omitted PATCH body as a write-free no-op" in work-item-activity-read.test.ts); 44 others passed.
  4. Replaced the `deletedBy` mapping with `null`: 3 integration tests FAILED (CA-18 deleter-differs-from-author, tombstone body null, ordered prior bodies/history after tombstoning).
  All four ported tests are non-vacuous.

## Review against the focus points
- M3 ordering: in update-comment.ts the sequence is lock + 404 for missing/foreign-workspace/tombstoned comment, then work-item and project liveness, then membership (403), then `update_any`/(owner AND 15-minute window AND `update_own`) (403), and only then `newBody === undefined` returns the already-locked row. The reach middleware `requireCommentReach()` runs before the controller, so the status codes for no access versus no permission are unchanged. The no-op sits before the version count, version insert and update, so no `comment_version`, `editedAt` or `updatedAt` change; the integration test compares full comment, version, audit and outbox rows before and after. JSON cannot carry `undefined`, so only a truly absent key triggers the no-op; `body: null` still goes through validation. The wording matches Thomas's 2026-10-09 decision.
- M1: `deletedBy` is read from the comment row and returned only when `deletedAt` is set. The route is gated by work-item reach and `work_item:read` (staff workspace members, per the controller header). It exposes an actor id of the same kind as `authorId`, and the tombstone already exposed `deletedAt`. No visibility filtering changed, and no portal/customer projection was added or altered. Response schemas (comment-response.ts, response.ts) and openapi.json agree with the code, and check:openapi passes.
- M2: cursor accepts 1..2147483647 inclusive; 2147483648 gives 400 `cursor: malformed`. The unit test covers both edges. The integration test covers only the above-max edge (see F2).
- i18n/schema.json: the diff is larger than the one key. It adds `instanceUsers` but also catches up other namespace entries main's schema lacked and drops `requestTypes.delete`. The key is absent from en-US, so the regeneration matches the catalogs. Nothing unexpected beyond that drift catch-up.
- N1: `closest("tr")?.scrollIntoView({block:"nearest"})` is guarded by the anchor null check, and the component test asserts the call, arguments and receiver.

## Findings
- F1 (non-blocking): no test pins that an omitted-body PATCH is still refused (403) for a non-author, an author past the 15-minute window, or a tombstoned parent (404). Reading the code confirms the ordering is correct, but the no-bypass guarantee is untested. Suggest adding such a test. Location: tests/api-integration/work-item-comment.test.ts around line 1526.
- F2 (non-blocking): the integration test for the version-cursor bound covers only 2_147_483_648 (tests/api-integration/work-item-activity-read.test.ts:730). The inclusive edge 2_147_483_647 is covered only by the unit test, not end-to-end.
- F3 (non-blocking, doc): the CA-18 sentence in docs/03-features/comments-and-activity.md is now one long line, and its sentence order places the deletion-approval clause after the new text. This is cosmetic.
- No blocking findings.

## Residual risk
Full integration suite, web UI tests, e2e and the image build were not run by me (web scroll test and activity UI use of `common:people.unknown` were only read, not executed). The M1 audience statement relies on the controller header and the `requireWorkItemReach` middleware, not on an end-to-end customer/portal test. I did not review the web activity.tsx tombstone naming logic in depth.

## Verdict
APPROVE

## Secret scan
`gitleaks detect --no-git --source <report>`: see the result appended below.
Result: gitleaks (no-git, on a copy of this report): "scanned ~6112 bytes, no leaks found".
<!-- END REPORT (sha256 8088cf42f57c922ef64846e12e74f9d937880c06069ff144bf4d86f04a189459) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/690-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 b47aafcdf24fa78360bdf7707b81f19d0b6726b4c42ce637abc04b07eb5065be) -->
# PR #690 ordinary review B (project alignment, web/UI, spec and docs)

**Model:** Claude Sonnet 5.5 (`claude-sonnet-5-5`), fresh independent context. I did not author, direct or remediate this change.
**Reviewed head:** bcf65d2bbf42589137ef9de26800c072e52ad998
**Base:** origin/main 31b98613 (31b98613a24bb799ba46caf1de4357bd0e90a777)
**Worktree:** /Users/heinthura/.codex/worktrees/comments-users-residual/Ticketing.v2 (HEAD verified equal to the reviewed head; clean tree; I made no edits, no push, no GitHub comment). The only writes were Vite's ephemeral `node_modules/.vite-temp` files and fetched refs `refs/review690/p606` and `refs/review690/p608` (read-only copies of the original PR heads).
**Scope:** API was covered in depth by the other reviewer; I read the API diff only for spec alignment.

## Files examined
- Diff `origin/main...HEAD`, 39 files: apps/web (work-item-activity.tsx and its .ui test, new work-item-activity.test.ts, work-item-list.tsx and test), apps/api/src/work-item/{comment-response,comment-schema,response,index}.ts and controllers/{list-comment-versions,list-work-item-activity,update-comment}.ts, docs/03-features/comments-and-activity.md, i18n/*.json (19 catalogs) + i18n/schema.json, tests/api-contract/openapi.json, tests/api-integration and tests/api additions.
- Disposition analysis, implementer notes, decision-log entry "2026-10-09 · Resume eligible integration work ..." (docs/07-planning/decision-log.md:7070).
- #606 head 077fea417f65d9be9678757f8fc2f198bca7fab4 (base 024788d8) and #608 head 8f1713934cb91fb7048930ae9b776b29cb67089b (base 2350397b), via fetched refs.
- docs/*/ux-quality-gates.md (G8, G13), apps/web/src/test/jsdom-layout.ts.

## Commands run and results
| Command | Result |
|---|---|
| `git rev-parse HEAD` | bcf65d2bbf42589137ef9de26800c072e52ad998 |
| `pnpm check:i18n` | exit 0, "All locale files are in sync with en-US." (all 19 locales OK) |
| python recursive compare of i18n/schema.json vs en-US.json | head schema adds 15 properties and removes 1 (see check 3); 0 added properties absent from en-US; 0 removed keys still in en-US; 0 en-US keys (excluding plural suffix forms) missing from the head schema, vs 14 missing on main |
| `cd apps/web && pnpm exec vitest run` on the 3 touched files (work-item-list.test.tsx, work-item-activity.test.ts, work-item-activity.ui.test.tsx), sandbox disabled because Vite writes `.vite-temp` | Test Files 3 passed (3), Tests 27 passed (27) |
| `cd apps/web && pnpm exec vitest run` (full web suite) | Test Files 139 passed (139), Tests 581 passed (581) |
| `pnpm lint:ci` (biome ci .) | exit 0; "Checked 2154 files", 196 warnings, 1 info, no errors, no fixes applied |
| `pnpm typecheck` (turbo) | 9 successful, 9 total (all cache hits, FULL TURBO; the cache key includes the file contents, so the hit is valid for this head) |
| `pnpm check:openapi` | "tests/api-contract/openapi.json matches the API (280 operations)" |
| Not run by me: API unit and integration (testcontainers), e2e, G8/G13 hosted gates, image build. The implementer's notes record 28 files / 692 integration tests and 118 files / 840 API unit tests passing; the other reviewer covers the API. |

## Check results

1. **Completeness.** PASS. See the absorption accounting below. Every MISSING-APPROVED unit (M-U1, M1, M2, M3, N1, N4) and every test-only unit the disposition assigned (T1-T5) is present in #690 or already green on main. X1, N2, N3 are excluded as owner questions. Independent cross-check: I listed every file in #606's own commits (base 024788d8...head, 122 files) and #608's own commits (46 files) whose blob differs from #690 HEAD. All of #608's 44 differing files fall into U1-U17 (evolved, superseded or obsolete on main, per the disposition), except two small items not named in the disposition (see finding F4). All #606 differing files fall into C1-C17, N1-N5 or T1-T5. Content in #606's ancestry that is not its own (the approvals section in work-item-detail.tsx, the list-boundary `stateName` validation in types/work-item) is base-branch content, not a #606 residual.
2. **Locale key.** PASS. `common:people.unknown` exists (en-US.json:53-56, `"unknown": "Unknown"`, translated in all 19 catalogs). The old `common:unknown` is a path nowhere defined. All three call sites (work-item-activity.tsx:245, :254, :520) are "actor name is not resolvable", which is the key's meaning. The UI test mock is updated to match (work-item-activity.ui.test.tsx:45). Adding `common.unknown` would have duplicated it, so the deviation is right.
3. **Locales.** PASS with one non-blocking note (F1). `check:i18n` is clean. The i18n/schema.json diff adds `navigation.workspaceSwitcher.instanceUsers` plus its `required` entry, and 14 other properties that all exist in the catalogs on main: `common.actions.retry/tryAgain`, `common.empty.select`, `intake.claimedAt/convertedWorkItem/nextPage/prefilledFromType/retry`, `portal.intake.attachmentListError/completeUpload/completeUploadError/downloadError/fieldRequired/noMatch`. It removes `requestTypes.delete`, which is absent from en-US on both main and head. So the regeneration only reconciles the schema with the catalogs. Each of the 19 catalogs gains exactly one line, `navigation.workspaceSwitcher.instanceUsers`, with the #608 translations.
4. **N1.** PASS. work-item-list.tsx:269-275: `handleListFocus` is bound to `onFocusCapture` (line 346). It returns early when the target is not a work-item detail anchor, then calls `anchor.closest("tr")?.scrollIntoView({ block: "nearest" })` and prefetches. It runs on focus moving into a row link (keyboard Tab/arrow, but also pointer focus; with `nearest` this is a no-op for a fully visible row). The test installs a mock via `Object.defineProperty` on the specific row, asserts one call with `{ block: "nearest" }` and the right `this` (the row), and does not leak. apps/web/src/test/jsdom-layout.ts stubs `scrollIntoView` globally, so no other jsdom test can throw on the new call. Full web suite is green. The call is optional-chained on the row only, so a non-table render does not throw.
5. **Spec text.** PASS. CA-17 now says an omitted `body` is a no-op, "owner decision 2026-10-09": same reach, live-parent, membership, ownership and 15-minute-window checks, then returns the comment unchanged with no `comment_version`, `edited_at`, `updated_at` change or event. This matches decision-log 2026-10-09 01:53 UTC item 1 ("no-op after existing permission, window, and parent checks. Do not mutate the comment") and the code (`update-comment.ts` `if (newBody === undefined) return locked;` placed after the checks, before any write; `comment-schema.ts` `body: commentBody.optional()`; "`null` and other present values keep validation unchanged"). CA-18 now states the activity route returns `deletedBy` (deleter id, null on a live comment) and that the name resolves through the reach-filtered directory; this matches `list-work-item-activity.ts` (`deletedBy: row.deletedAt ? row.deletedBy : null`), `response.ts`, `comment-response.ts` (stale "omitted on purpose" comment replaced) and `openapi.json`. No rule IDs renumbered or removed (the diff removes no `CA-` line). Only style issue: F2.
6. **Conventions.** PASS. `lint:ci` exit 0, `typecheck` 9/9, `check:openapi` clean (280 operations).
7. **G-gates.** G8: no visible change in any en-US key screen or story. The list scroll is a no-op when the row is already visible, the tombstone and unknown-actor strings are unchanged in en-US ("Unknown", defaultValue behaviour), and the only new catalog string is shown in the workspace-switcher menu, which has no G8 key-screen snapshot. No baselines need regenerating. The hosted G8 job remains the authority; I did not run it. G13: the scroll happens on focus, not on data arrival, and changes no layout, so it cannot add layout shift. One residual a11y point is F3.

## Findings
- **F1 (non-blocking, scope):** i18n/schema.json carries 14 unrelated property additions and the `requestTypes.delete` removal (see check 3). They are correct (catalog-backed) and make the schema consistent, but are not part of the PR's stated purpose. The PR body should say the schema was regenerated. No code change needed.
- **F2 (non-blocking, style):** docs/03-features/comments-and-activity.md:133-135 (CA-18) has one over-long line ("... as every other actor. Like every deletion it is a pending action approved by the requester — a") produced by an in-place insertion. Reflow when convenient. Markdown is not Biome-checked.
- **F3 (non-blocking, a11y residual):** apps/web/src/components/work-item/work-item-list.tsx:272. `block: "nearest"` does not account for any sticky header or footer that could obscure the focused row (WCAG 2.4.11). I found no `sticky` or `scroll-margin` in work-item-list.tsx or the Table component, so there is no known obscuring element today. The #606 source had the same call and a recorded 200% zoom journey. Re-check if a sticky list header is ever added.
- **F4 (non-blocking, absorption bookkeeping):** two small #608 deltas are not named in the disposition: scripts/ci/check-openapi.mjs:69-70 (`TASKDESK_AGENT_URL` default `https://taskdesk.test` instead of `http://localhost:5173`) and the tests/api-integration/scim-admin.test.ts:355 assertion that `changed` is an object. Both belong to the #608 lineage that main has already evolved: the first goes with the SCIM server-metadata change (the disposition's NOT-OWNED SCIM/identity note, `4157514c`), the second with the person-lifecycle return shape (U12/U14, superseded by #647). Neither is a Users or Comments unit. Record them in the closure note for #608 as "SCIM/identity-owned, not Users".
- No blocking findings.

## Absorption accounting

Location legend: MAIN = already on origin/main 31b98613 (cited commit or file); #690 = this PR at bcf65d2b; OQ = excluded owner question.

### #608 (Users)
| Unit | Location | Evidence |
|---|---|---|
| U1 God Mode Users directory screen | MAIN (#670 d9af1c83) | disposition U1; `agent/god-mode/users.tsx`, relocated and hardened |
| U2 Requester pending-action list | MAIN (#670) | disposition U2 |
| U3 Pending-action detail | MAIN, superseded and evolved (#670/#647) | disposition U3 |
| U4 Instance users fetcher | MAIN (#670) | disposition U4 |
| U5 Pending-actions fetcher | MAIN (#670) | disposition U5 |
| U6 Instance users query hook | MAIN (#670) | blob-identical per disposition U6 |
| U7 Route parser/builders/route tree/metadata | MAIN (#670) | `lib/routes.ts` per disposition U7 |
| U8 God-mode-users e2e | MAIN, extended (#670/#647) | disposition U8 |
| U9 Workspace-switcher entry code | MAIN (#670) for code; locale key in #690 (M-U1 below) | `workspace-switcher.tsx:204-210` per disposition U9 |
| M-U1 `navigation.workspaceSwitcher.instanceUsers`, 19 catalogs, plus schema property and required entry | #690 (commit b1993d30) | Verified: 19 catalog diffs, one line each, #608 values; schema property and `required` added; `pnpm check:i18n` exit 0 |
| U10 `instanceUsers` + `pendingActions` locale keys (159 keys x 19) | MAIN (#670) | disposition U10 (0 absent, 0 differing) |
| U11 schema.json properties for those namespaces | MAIN (#670); nav key in #690 | disposition U11 + my schema comparison |
| U12 Canonical pending-action backend | MAIN, superseded by #647 8973cbb1 | disposition U12 |
| U13 Exclusive step-up challenge contract | MAIN (#647) | disposition U13 |
| U14 Lifecycle locks parent-first | MAIN, evolved in #647 | disposition U14 |
| U15 Migration 0112 (net no-op) | Obsolete, not replayed: main 0109 has the identical check | disposition U15 |
| U16 Backend tests | MAIN except two cases: (a) 0112 replay test, obsolete, "refuses legacy execution" half is `instance-users.test.ts:155` on main; (b) SCIM server-metadata test, NOT-OWNED identity | disposition U16 |
| U17 Specs GM-15, PA-15, IP-15 | MAIN (newer than #608) | disposition U17 |
| SCIM/OIDC/SLA/calendar UIs riding in the stack | NOT-OWNED, other PRs | disposition "NOT-OWNED content" section |
| check-openapi.mjs default URL, scim-admin test shape | NOT-OWNED, SCIM/identity (F4) | my file-level cross-check |

Conclusion for #608: nothing Users-specific is unaccounted for. With #690, #608 can be closed as absorbed (branch preserved, consistent with the queue's conservation rule), subject to the SCIM/identity-owned items above being tracked in their own PR.

### #606 (Comments)
| Unit | Location | Evidence |
|---|---|---|
| C1 Chosen composer, visibility selector, submit | MAIN (#672 b596d2de) | disposition C1 |
| C2 D9 permission-filtered choices | MAIN (#672) | disposition C2 |
| C3 Draft recovery | MAIN (#672) | disposition C3 |
| C4 Scoped mentions, preflight | MAIN (#672) | disposition C4; route policies and matrix fixture on main (grep: 3 hits each in policy.ts, api-design.md, matrix.fixture.json) |
| C5 Mention creation and events | MAIN (#672) | disposition C5 |
| C6 Edit history and bounded paging | MAIN, with the M2 guard added in #690 | disposition C6 |
| C7 Comment permissions | MAIN (#672) | disposition C7 |
| C8 Combined activity stream UI and URL filter | MAIN (#672) | disposition C8 |
| C9 Project default visibility | MAIN (#672) | disposition C9 |
| C10 / M1 Tombstone `deletedBy` | #690 (commit 9872b94f) | `list-work-item-activity.ts`, `response.ts`, `comment-response.ts`, `openapi.json`, CA-18 text; tests `work-item-activity-read.test.ts` (including a deleter-differs-from-author case) |
| C11 / M3 Omitted `body` PATCH no-op | #690 (9872b94f) | `comment-schema.ts`, `update-comment.ts`, CA-17 text, openapi.json; schema test and integration test |
| C12 / M2 Version cursor bounded to PG integer | #690 (ca182273) | `list-comment-versions.ts`, `tests/api/comment-version-cursor.test.ts` |
| C13 `edited_by` as `person.id` | SUPERSEDED, not selected; main keeps the user id; ported history test asserts the user id | disposition C13; implementer notes |
| C14 Private-visibility staff reach | MAIN for the resolver half; remainder OQ X1 | disposition C14, X1 (excluded on purpose) |
| C15 Comments locale keys | MAIN | disposition C15 |
| C16 Historical security-review note | OBSOLETE on main, preserved on the branch | disposition C16 |
| C17 Migrations | none | disposition C17 |
| N1 List-row `scrollIntoView` | #690 (bcf65d2b) | `work-item-list.tsx:269-275` and component test (check 4) |
| N2 Create-dialog performance (shell, lazy body, DialogPanel split, permission retry) | OQ (excluded on purpose) | disposition N2 |
| N3 Alert contrast tooling | SUPERSEDED/OBSOLETE (regenerated in #670/#672); one open question about the stricter `check-contrast.mjs` binding logic | disposition N3 |
| N4 `common:unknown` locale key | #690 via `common:people.unknown` (commit 824e11c0) | check 2 |
| N5 Saved-view visual, screen-inventory row, e2e stub, G8 snapshots | NOT-OWNED (#609/#512 lane) | disposition N5 |
| X1 Private visibility vs staff reach | OQ (excluded on purpose) | disposition X1 |
| T1 CA-13 customer-mention test | MAIN-passing, or ported in #690 (work-item-comment.test.ts +493 lines) | implementer notes: ported and passing |
| T2 CA-12 private-customer test | #690, passes unchanged on main | implementer notes |
| T3 Three history API tests | #690 (work-item-activity-read.test.ts +374 lines) | implementer notes |
| T4 Project default visibility test | #690 (work-item-detail.test.ts +22 lines) | implementer notes |
| T5 filter/grouping unit tests | #690 (new apps/web/.../work-item-activity.test.ts, 4 tests; passes in my run) | file read and run |

Conclusion for #606: every unit is on main, in #690, or one of the three listed owner questions (X1, N2, and the N3 contrast-tooling question), plus the N5 NOT-OWNED lane. Nothing else unique was found. #606 can be closed as absorbed once those owner questions have a home elsewhere (tracked issue or decision), because closing it loses the only live source for X1 and N2. Keep the branch preserved. Caveat: I checked X1 and N2 only as exclusions, not their content, and I rely on the disposition for the unit-by-unit "on main" claims for C1-C9 (spot-checked by the file-level cross-check above, not by reading every test title).

## Residual risk
- I did not run the API unit and integration suites, the e2e/visual jobs, or the image build; I rely on the other reviewer and CI for the API and on the implementer's logs for the integration counts (not independently reproduced).
- The typecheck result is a turbo cache hit at the same content hash, not a fresh execution.
- The "no G8 baseline impact" conclusion is by reasoning over the diff; the hosted G8/G13 gates are authoritative.
- The deleter identity (`deletedBy` as an id) leaves name resolution to the client via the reach-filtered directory; if the deleter is outside the viewer's reachable directory the tombstone shows "Unknown". That matches the decided design and CA-18 text, but is a product-visible behaviour to be aware of.
- #606/#608 closure depends on X1, N2 and N3 having a home elsewhere (see conclusions).

## Verdict
**APPROVE** (no blocking findings; F1-F4 are non-blocking).

## Secret scan
`gitleaks detect --no-git --source 690-ordinary-b-sonnet.md`: "scanned ~17120 bytes ... no leaks found" (re-run after appending this section: see below).
<!-- END REPORT (sha256 b47aafcdf24fa78360bdf7707b81f19d0b6726b4c42ce637abc04b07eb5065be) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/690-5c65-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 dddb3d239d1f16bcf9f38644e05370a486013b470a2fa5bce5fd63c1edb85576) -->
# PR #690 delta ordinary review A (bcf65d2b..5c6589dd)

Model: Claude Sonnet 5.5 (fresh independent context, reviewer A)
**Reviewed head:** 5c6589dd2a6f8e21e4c6ee4359dd0d7b07e33a2b
Delta base: bcf65d2bbf42589137ef9de26800c072e52ad998 (my earlier APPROVE, report 690-ordinary-a-sonnet.md)
PR base: origin/main 31b98613a24bb799ba46caf1de4357bd0e90a777

## Files examined
`git diff bcf65d2b..5c6589dd`: one file, tests/api-integration/work-item-comment.test.ts, +27 lines (one new test). No source change.

## Commands and results (scratch worktree /Users/heinthura/.codex/worktrees/review-690-a, detached at 5c6589dd)
- `CI=true vitest run --config vitest.integration.config.ts work-item-comment` (testcontainers, one process): 1 file, 31 tests passed (includes the new test).
- Negative control: removed `if (newBody === undefined) return locked;` from its place after the permission checks and put it directly after the comment lock/404 check, before the work-item, membership and ownership/window checks. Same file run: 1 failed, 30 passed. The new test failed with "AssertionError: expected 200 to be 403". Source restored; `git status` clean.

## Assessment
- Correct: three comments are created by the member creator. A stale one (createdAt moved back 16 minutes) gives 403 for an omitted-body PATCH (author, outside the 15-minute window, lacks update_any). A deleted one gives 404 (the tombstone check comes first). A second member (not author, no update_any) gives 403. These match the controller's order and the status codes of a real edit.
- Non-vacuous: the control above shows it fails when the no-op bypasses the checks. Because the test asserts on three different paths, a bypass placed before the membership/ownership checks is caught by the first 403 assertion.
- Should it also assert no row was written? Not required. A refused request throws inside the transaction, so nothing is written, and the 403/404 statuses already prove the early exit. The no-write property of the successful no-op is covered by the existing tests from bcf65d2b (full comment, version, audit and outbox comparison). Optional hardening only: assert zero comment_version rows for the refused targets.

## Findings
- N1 (non-blocking, optional): add a zero-version-rows assertion for the three refused targets. The test also keeps its three targets in one test, so a failure on the first assertion hides the others; cosmetic.
- No blocking findings. F1 from my earlier report is resolved.

## Residual risk
Only the comment integration file was run for this delta; the rest of the PR checks are as in my earlier report.

## Verdict
APPROVE
gitleaks no-git scan on a copy: no leaks found.
<!-- END REPORT (sha256 dddb3d239d1f16bcf9f38644e05370a486013b470a2fa5bce5fd63c1edb85576) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/690-security-opus.md; Claude Opus 5.5; sha256 0e6c4f9fc3fb205f5ee54446108e27c6487b6370a2f5f41305e13bec95b34e6e) -->
# PR #690 security review (sampled independent, Opus)

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), fresh independent context. I did not author, direct or remediate this PR.
- **Role note:** Under `CLAUDE.md`, Opus 5.5 is the sampled "big reviewer". It is **not** the mandatory GPT-6 Sol security gate. This report does not replace a GPT-6 Sol exact-head review.
- **Reviewed head:** 5c6589dd2a6f8e21e4c6ee4359dd0d7b07e33a2b
- **Merge base:** 31b98613a24bb799ba46caf1de4357bd0e90a777 (origin/main)
- **Scratch copy:** a detached worktree at `/Users/heinthura/.codex/worktrees/review-690-sec` (HEAD verified as 5c6589dd...). The temporary probes were reverted before the suites were re-run, and the scratch copy was removed afterwards. The PR worktree was not modified.

## Files and surfaces examined

- `apps/api/src/work-item/controllers/update-comment.ts`: the full function, including the new no-op return at line 114.
- `apps/api/src/work-item/comment-schema.ts`: `updateCommentBody` and the `commentBody` refinements.
- `apps/api/src/work-item/require-comment-reach.ts`: the reach, live-parent and workspace-access middleware for PATCH and DELETE.
- `apps/api/src/work-item/index.ts`: the `updateCommentRoute` and `listWorkItemActivityRoute` definitions and the PATCH handler (lines 989-1015 and 1616-1622).
- `apps/api/src/work-item/controllers/list-work-item-activity.ts`: the visibility and caller doc comment, and the comment projection with `deletedBy` (lines 277, 295 and 321-323).
- `apps/api/src/work-item/controllers/delete-comment.ts`: the origin of `deletedBy`, which is the actor id at line 104.
- `apps/api/src/work-item/controllers/list-comment-versions.ts` and `apps/api/src/work-item/comment-versions.ts`: the cursor decoding and its binding to the comment and work item.
- `apps/api/src/work-item/comment-response.ts`, `apps/api/src/work-item/response.ts`, `apps/api/src/comment/response.ts` and `tests/api-contract/openapi.json`: contract parity.
- `apps/api/src/utils/csrf-protection.ts` and the global guard in `apps/api/src/index.ts` (around line 1361): whether CSRF depends on the request body.
- The web diff for `work-item-activity.tsx` (the deleter name now resolves through the existing reach-filtered directory) and the `work-item-list.tsx` N1 scroll.
- The new and changed tests, and the three prior ordinary reports (690-ordinary-a/b-sonnet.md at bcf65d2b and 690-5c65-ordinary-a-sonnet.md at 5c6589dd). I read them but did not rely on them.

## Tests and reproductions run

All runs used `CI=true`, were serialized, and ran in the scratch copy. Integration used the Testcontainers Postgres.

| Run | Result |
| --- | --- |
| Integration: `work-item-comment`, `work-item-activity-read`, `work-item-detail` (plus 1 temporary probe) | 3 files, 53/53 passed (52 PR tests + 1 probe) |
| Unit: `comment-version-cursor`, `work-item-comment-schema`, plus a temporary cursor probe | 3 files, 7/7 passed |
| Full API unit suite (`vitest.config.ts`), after reverting the probes | 118 files, 840/840 passed |
| `test:permissions` (`vitest.permissions.config.ts`), including route-coverage | 14 files, 88/88 passed |
| `pnpm test:contract` | Redocly 19 findings, equal to the origin/main baseline. oasdiff: no unapproved breaking changes. |

The first unit and permissions runs failed with `Failed to resolve entry for package "@taskdesk/email"`. That failure came from the scratch environment: the workspace packages had not been built. A forced build of the workspace packages fixed it, and the re-runs above are clean.

### Temporary probe results (not committed)

An omitted-body PATCH on an internal comment authored by a `member`:

| Case | Status |
| --- | --- |
| Owner of a different workspace | 404 "Comment not found". Reach masks it and nothing is echoed. |
| Same-workspace member who is not the author | 403. This is the same message a real edit gets, and no body is echoed. |
| Work item archived | 404 (`requireCommentReach`). |
| Project archived | 404 "Work item not found". |
| JSON array body | 400. |
| `content-type: text/plain`, a missing body, or `{"visibility":"public"}` | 200 no-op (see N2). |

After all of these, the row was unchanged: the body was identical, `updatedAt` was identical, `editedAt` was null and there were 0 `comment_version` rows.

The cursor probe sent hostile cursors to `decodeCommentVersionCursor`. Each of these was rejected with 400 "cursor: malformed":

- number values of -1, 0, 1.5, "3", 2^31 and MAX_SAFE_INTEGER;
- a literal `1e400` (which parses to Infinity) and a literal `NaN`;
- a commentId or workItemKey from another comment or work item;
- an extra key;
- non-JSON input, `null` and `[]`;
- an empty id, a 129-character id, and an id containing a NUL byte.

A valid round trip decoded correctly.

## Challenge answers

**M3 (omitted-body no-op): does it skip any check a real edit performs?** No. The return at `update-comment.ts:114` comes after every check a real edit runs:

- the route-level `requireCommentReach()`: workspace access, with a 403 mapped to 404, and the live work item, archive and project checks;
- the global auth, CSRF (token-based for every unsafe method and body-agnostic), local-factor and route-classification guards;
- the in-transaction `FOR UPDATE` row lock, the tombstone check (404), the live work-item and project checks, the unambiguous-membership check, and `update_any`, or else `update_own` with ownership and the 15-minute window.

API keys follow the same middleware path as a real edit (`validateWorkspaceAccess(userId, ws, apiKey.id)`). No portal or customer route mounts this handler.

**Does a no-op reveal anything?** No. A caller who fails the checks gets exactly the status a refused real edit gets. A caller who passes could already have rewritten the body. The echoed `locked` row has the same full-row shape as the real-edit `.returning()` row. Internal comments are not reachable by customer actors on this staff-only route.

**M1 (`deletedBy`): who can call the activity route?** It is gated by `requireWorkItemReach(key, {requireProjectReach})` plus `work_item:read`, and it is staff-side only (see the controller's VISIBILITY comment). It is not mounted on the portal router.

**Is the exposure consistent?** `deletedBy` is a workspace actor id. It has the same class as the already-exposed `authorId`/`actorId`, and it is already returned today by DELETE (and PATCH) `/comments/{id}` because those handlers return the full row. It is nulled for live rows at `list-work-item-activity.ts:323`. The client resolves the name only through the existing reach-filtered directory. There is no new cross-tenant exposure.

**M2 (cursor): is it fully validated?** Yes. The checks are canonical base64url, strict JSON, an exact key set, `Number.isSafeInteger`, `1 ≤ n ≤ 2^31-1`, a bounded and NUL-free id, a canonical re-serialization check, and equality with the route's `key` and `id`. The page query also filters on the route's commentId, after the live-parent check bound to the reach-established `workItemId`. A cursor cannot reach another comment, work item or workspace.

**OpenAPI and route policy.** The request schema for `body` was already optional in the emitted spec (`{"body": {}}` with no `required`), so M3 produces no request-contract delta. The `deletedBy` field on the activity row is documented and passes oasdiff. Permissions and route-coverage are green.

## Findings

- **N1 (non-blocking, pre-existing, contract parity).** `apps/api/src/work-item/comment-response.ts:29` and `apps/api/src/comment/response.ts:15` both register `.openapi("Comment")`. The emitted component is the legacy kaneo shape (`taskId`/`userId`/`content`). As a result, `PATCH`/`DELETE /comments/{id}` document the wrong 200 schema, and this PR's `deletedBy` addition to `commentSchema` is invisible in `openapi.json`. This predates the PR and leaks nothing. The fix is a follow-up: rename the work-item schema (for example to `WorkItemComment`).
- **N2 (non-blocking, hardening).** `PATCH /comments/{id}` (`index.ts:1000-1005`, `required: true`) accepts a request with no body or with a non-JSON content type: the validator yields `{}`, and the request reaches the M3 no-op with 200. The same happens for an unknown key such as `{"visibility":"public"}` (zod strips it). This writes nothing and runs after every authorization check, so it is not a security defect. By my reading of the base code (I did not run it), the same request on main reached a phantom write: a version row plus `editedAt`, because `z.unknown()` accepts undefined. M3 therefore improves on base. A future slice could consider a 400 or 415 for a non-JSON PATCH and `.strict()` on `updateCommentBody`, so that a request that cannot be an edit is refused explicitly.
- **N3 (non-blocking, tests).** The committed M3 tests cover the non-author, stale, deleted and success cases. They do not pin the omitted-body cases for cross-workspace, archived work item or archived project. My probes show all three return 404 correctly. Adding those assertions would lock the "same checks as a real edit" claim against future reordering.

There are no blocking findings.

## Residual risk / not checked

- I did not run the full integration suite, only the three touched files. I did not run the web tests, the image build or the deploy.
- I did not test an API-key bearer PATCH or a customer/portal session end to end. My conclusion for those comes from reading the code: there is a single middleware path and no portal mount.
- I inferred the base-branch phantom-write behaviour in N2 and did not reproduce it.
- I did not test concurrency between a no-op PATCH and a concurrent DELETE, beyond noting that the `FOR UPDATE` lock serializes them.
- This review does not satisfy the mandatory GPT-6 Sol exact-head security gate required by `CLAUDE.md`.

## Verdict

**CLEAR** at 5c6589dd2a6f8e21e4c6ee4359dd0d7b07e33a2b. There are no blocking findings. N1-N3 are non-blocking.
<!-- END REPORT (sha256 0e6c4f9fc3fb205f5ee54446108e27c6487b6370a2f5f41305e13bec95b34e6e) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/690-456d-security-rebind-opus.md; Claude Opus 5.5; sha256 66fb2a3ca61bf67ee7950842c6fd21311787cc52ad85b5f5150cca742599f4ee) -->
# PR #690 exact-head rebind (sampled independent, Opus)

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), fresh independent context. I did not author, direct or remediate #690 or #686.
- **Role note:** Opus 5.5 is the sampled "big reviewer" under `CLAUDE.md`. This rebind does not replace the mandatory GPT-6 Sol exact-head security review.
- **Reviewed head:** 456d5e77895bcac6be8c9636ea9c073d97cd828c
- **Prior Opus CLEAR:** 5c6589dd2a6f8e21e4c6ee4359dd0d7b07e33a2b (report `690-security-opus.md`, same directory).
- **Merge base vs main:** 727fa8d203a930d3447a9b10e228587cc8a4fd76 (origin/main, the merge commit of PR #686).
- **Method:** read-only git object inspection in the PR worktree after `git fetch`. No scratch worktree was needed, and nothing was modified.

## Commit topology (verified)

- `456d5e77` has parents `76d31bfd583bcb8cfda0d6d354e5b14882471c15` (branch) and `727fa8d203a930d3447a9b10e228587cc8a4fd76` (main). Its message is "Merge branch 'main' into codex/comments-users-residual".
- The parent of `76d31bfd` is `5c6589dd`, the head I cleared before. It changes exactly one file: `docs/07-planning/security-reviews/690-comments-users-residual.md` (+346 lines).
- The parents of `727fa8d2` are `31b98613` (the original #690 merge base) and `e14ba238` (the #686 head).

## Checks run

| Check | Command | Result |
| --- | --- | --- |
| Clean-merge tree equality | `git merge-tree --write-tree 76d31bfd 727fa8d2` vs `git rev-parse 456d5e77^{tree}` | Both are `90ce568251e32b6335144a12e8edd38ac9471513`. merge-tree exits 0 and lists no conflicted paths, so there was no hand conflict resolution. |
| No change to the reviewed API code | `git diff 5c6589dd 456d5e77 -- apps/api` | Empty (0 lines). |
| Full delta since the cleared head | `git diff --name-only 5c6589dd 456d5e77` | 7 files, listed below. |
| Main-side delta | `git diff --name-only 31b98613 727fa8d2` | The same 6 files as the #686 rows below. |
| Overlap with #690 surfaces | `comm -12` of the main-side and #690 (`31b98613..5c6589dd`) file lists | Empty: no shared files. |
| Branch-side delta after the merge | `git diff --stat 76d31bfd 456d5e77` | Exactly the 6 #686 files, +417/-14. |

The 7 files changed between 5c6589dd and 456d5e77:

| File | Source |
| --- | --- |
| `apps/web/e2e/helpers/redact-secret-error-context.ts` | #686 |
| `apps/web/e2e/instance-users-journey.spec.ts` | #686 |
| `apps/web/e2e/mfa-csrf-journey.spec.ts` | #686 |
| `apps/web/src/test/e2e-secret-redaction.test.ts` | #686 |
| `docs/04-engineering/error-fix-loop.md` | #686 |
| `docs/07-planning/security-reviews/686-e2e-secret-redaction.md` | #686 |
| `docs/07-planning/security-reviews/690-comments-users-residual.md` | 76d31bfd |

## Interaction analysis

The main-side changes are a Playwright e2e secret-redaction helper and its use in two e2e specs, a web-side static guard test, and two docs. None of them touches `apps/api`, the comment controllers, `work-item/index.ts`, the activity controller, the OpenAPI snapshot, i18n, or the web activity/list components changed by #690.

The only matches for "comment" or "activity" in the main-side diff are prose inside the #686 review note. Those lines mention the existing `work-item-comments` e2e spec's trace, video and screenshot settings, and they change no code.

The e2e helper runs only in the Playwright test harness and is not shipped API runtime. There is no shared contract and no shared file, so no semantic interaction with M1, M2 or M3 is possible.

## Findings

None. The non-blocking items N1-N3 from `690-security-opus.md` are unchanged and still non-blocking.

## Residual risk / not checked

- I did not re-run test suites at 456d5e77. The API code is byte-identical to the head I tested, and the main-side change touches only the web e2e and test tree.
- I did not verify that the CI checks for 456d5e77 are green on GitHub. The orchestrator must check them before merging.
- I did not review whether the embedded copy of my report in `690-comments-users-residual.md` is verbatim; that was outside this rebind's scope.
- The GPT-6 Sol exact-head gate is still required.

## Verdict

**CLEAR** at 456d5e77895bcac6be8c9636ea9c073d97cd828c. The merge is a clean, conflict-free merge of 76d31bfd and 727fa8d2. The reviewed `apps/api` code is unchanged, and main's #686 changes do not interact with the #690 surfaces.
<!-- END REPORT (sha256 66fb2a3ca61bf67ee7950842c6fd21311787cc52ad85b5f5150cca742599f4ee) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/690-87aa-security-rebind-opus.md; Claude Opus 5.5; sha256 24cf0b34cd0a29712770cc7538f511a4bd50a1b50d3e5c8dd779491588c00639) -->
# PR #690 exact-head rebind 2 (sampled independent, Opus)

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`), fresh independent context. I did not author, direct or remediate #690 or #687.
- **Role note:** Opus 5.5 is the sampled "big reviewer" under `CLAUDE.md`. This rebind does not replace the mandatory GPT-6 Sol exact-head security review.
- **Reviewed head:** 87aab5358856c1a667303dd5a7e71f8247fffb31
- **Prior Opus CLEARs:**
  - 5c6589dd2a6f8e21e4c6ee4359dd0d7b07e33a2b (`690-security-opus.md`, full review with tests);
  - 456d5e77895bcac6be8c9636ea9c073d97cd828c (`690-456d-security-rebind-opus.md`).
- **Merge base vs main:** 468ab265caa3700125302a82b41fd014f30faa04 (origin/main, the merge commit of PR #687).
- **Method:** read-only git object inspection in the PR worktree after `git fetch`. No scratch worktree was needed, and nothing was modified.

## Commit topology (verified)

- `87aab535` has parents `30c0eb74877e699db66d77918030f0ab87300a12` (branch) and `468ab265caa3700125302a82b41fd014f30faa04` (main). Its message is "Merge branch 'main' into codex/comments-users-residual".
- The parent of `30c0eb74` is `456d5e77`, the prior cleared head. It changes exactly one file: `docs/07-planning/security-reviews/690-comments-users-residual.md`.
- The parents of `468ab265` are `727fa8d2` (the previous main) and `bfbfb96a` (the #687 head). `git merge-base 456d5e77 468ab265` = `727fa8d2`.

## Checks run

| Check | Command | Result |
| --- | --- | --- |
| Clean-merge tree equality | `git merge-tree --write-tree --name-only 30c0eb74 468ab265` vs `git rev-parse 87aab535^{tree}` | Both are `cfbded375f99bfd5399774c9c3d5dc87b7551485`. merge-tree exits 0 and lists no conflicted paths, so there was no hand conflict resolution. |
| No change to the reviewed API code | `git diff 456d5e77 87aab535 -- apps/api` | Empty (0 lines). |
| Full delta since the prior cleared head | `git diff --name-only 456d5e77 87aab535` | 4 docs files, listed below. |
| Main-side delta | `git diff --numstat 727fa8d2 468ab265` | The 3 #687 files: `intake-queue.md` +11/-1, `request-types-and-catalogue.md` +15/-0, `decision-log.md` +134/-0. The decision log is insertion-only, so append-only discipline holds. |
| Overlap with #690 surfaces | `comm -12` of the main-side and #690 (`31b98613..5c6589dd`) file lists | Empty: no shared files. |
| Topic interaction | grep of the main-side diff for `comment`, `CA-17`, `CA-18`, `deletedBy`, `activity` or `2026-10-09` | No matches. #687 neither alters nor supersedes the 2026-10-09 owner decision that governs M3. |
| Branch-side delta after the merge | `git diff --stat 30c0eb74 87aab535` | Exactly the 3 #687 docs files, +160/-1. |

The 4 files changed between 456d5e77 and 87aab535:

| File | Source |
| --- | --- |
| `docs/03-features/intake-queue.md` | #687 |
| `docs/03-features/request-types-and-catalogue.md` | #687 |
| `docs/07-planning/decision-log.md` | #687 |
| `docs/07-planning/security-reviews/690-comments-users-residual.md` | 30c0eb74 |

## Interaction analysis

Every change since the prior cleared head is under `docs/`. Nothing touches:

- `apps/api` (comment controllers, `work-item/index.ts`, the activity controller, the cursor code);
- `apps/web`, i18n, tests, or the OpenAPI snapshot.

#687's text covers intake and request types, which are unrelated to comments, activity or comment history. There is no shared contract and no shared file, so no runtime or contract interaction with M1, M2 or M3 is possible.

## Findings

None. The non-blocking items N1-N3 from `690-security-opus.md` are unchanged and still non-blocking.

## Residual risk / not checked

- I did not re-run test suites. The shipped code is byte-identical to the 5c6589dd code I tested, and the delta is docs-only.
- I did not verify GitHub CI status for 87aab535. The orchestrator must check it before merging.
- I did not check whether the report copies appended to `690-comments-users-residual.md` are verbatim.
- The GPT-6 Sol exact-head gate is still required.

## Verdict

**CLEAR** at 87aab5358856c1a667303dd5a7e71f8247fffb31. The merge is a clean, conflict-free merge of 30c0eb74 and 468ab265. `apps/api` and every other #690 surface are unchanged, and the #687 docs do not interact with #690.
<!-- END REPORT (sha256 24cf0b34cd0a29712770cc7538f511a4bd50a1b50d3e5c8dd779491588c00639) -->
