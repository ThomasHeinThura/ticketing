# PR #719 security review record: profile settings routes for density and per-project layout

PR #719 implements issue #699 under `settings-hierarchy.md`'s `GET/PATCH /api/me/settings` contract (ST-12..ST-17).

**Routes:**
- Reads return only the caller's own `user_preference` rows, and omit layouts for projects the caller cannot reach.
- PATCH applies a flat partial object of whitelisted keys (`density`, `layout.<projectId>`), validated before any write and applied in one transaction.
- PATCH is session-only: API keys, MCP keys and impersonation are refused.
- Setting a layout requires project reach. Clearing the caller's own row is reach-free and leaks no existence.
- Project ids must match `[A-Za-z0-9_-]{1,128}`.
- Limits: a 4 KiB body, 20 keys per request, and an exact 500-row cap held under a per-person advisory lock.

**Web:** VW-6 density syncs to the server with a per-user first-paint cache and a per-user ordered write queue. VW-2 layout wiring follows #688.

The PR is security-scope because it adds routes, policy-registry entries, permission-matrix rows and the advisory lock.

A Claude Sonnet 5.5 lane implemented it. The conductor (Claude Opus 5.5) made the two merges of `main`. The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (API): APPROVE at `beedd219`. Delta APPROVE at `7a32a0f3` covering the exact cap under the advisory lock, the stale-clear and the web fixes.
- Ordinary review B by Claude Sonnet 5.5 (web, spec, completeness): APPROVE at `beedd219`. Delta APPROVE at `49298316` after the per-user queue fix. It also supplied the R1a/R1b test recipes.
- Security review by Claude Opus 5.5: CLEAR at `569aea44`.
  - 13 probes covering self-only isolation, prototype-pollution keys, reach, credentials, CSRF, limits and the lock.
  - N1: a NUL character in a key caused a 500.
  - N3: a cross-user density write on a shared tab.
- Security rebind: CLEAR at `49298316`. N1 and N3 are fixed and re-probed.
- Light security rebind: CLEAR at `8bf67c9c`. The R1 tests, the adopt-time generation check and the ST-16 wording are in. Mutating each guard makes its own test fail.
- Ordinary delta review by the reviewer-B context: APPROVE at `8bf67c9c`. The tests match its recipes, and mutations of the generation and user clauses each make a test fail.
- Security rebind: CLEAR at `65ffd467`. The render-safety fix (`d7b4c019`) fails closed, because malformed settings bodies become failed reads and the user checks stay outside the try/catch. The commit is a clean merge of `main` `66565b2c` (#710).
- Ordinary delta review by the reviewer-B context: APPROVE at `65ffd467`. Mutating the try/catch and the fetcher validation makes the tests fail, and the e2e approval-withdrawal spec passes 3/3 locally.

**Reviewed head:** `beedd219a6d7634254fc66cf3033bd5ba3f54f7c`
**Reviewed head:** `7a32a0f337b8a195b0054bbd5516a6c88a9ae1f4`
**Reviewed head:** `569aea448f509c583f4735652d0ae6bfc3ed361b`
**Reviewed head:** `49298316eea9f330cf086c5a1b0e1b664b6acdcb`
**Reviewed head:** `8bf67c9cf1349cda549ae3f8ecfe598d5ec6b306`
**Reviewed head:** `65ffd4675f711fab39e3ed334cf1b82758d18858`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `719-ordinary-a-sonnet.md` | Ordinary review A (f0964fd5..beedd219) | Claude Sonnet 5.5 | `beedd219` | APPROVE | `dd84958c1a639c34b737f061734217f04bb5648c18a85965e7a34b4a310ac1b8` |
| 2 | `719-ordinary-b-sonnet.md` | Ordinary review B (f0964fd5..beedd219) | Claude Sonnet 5.5 | `beedd219` | APPROVE | `690a968ede953427c674e3f8f6436e25370838e20bbe4ed7fb1471cb906c41a6` |
| 3 | `719-7a32-ordinary-a-sonnet.md` | Ordinary delta review A (beedd219..7a32a0f3) | Claude Sonnet 5.5 | `7a32a0f3` | APPROVE | `3f888548255368db19ef0191c4ecb441ff707e9d09c6fb0e9251d8beec034de1` |
| 4 | `719-security-opus.md` | Security review (9a8e84cf..569aea44) | Claude Opus 5.5 | `569aea44` | CLEAR | `0e7334b88b1d2ea6ad4c8bd88a21c84c2262f530be17269cce341c7f4793cc3b` |
| 5 | `719-4929-security-rebind-opus.md` | Security rebind (569aea44..49298316) | Claude Opus 5.5 | `49298316` | CLEAR | `2292d2e4a5ad14b8c1bfb77ba029b306d56183c875f1b7d53383cc3bdebd30b9` |
| 6 | `719-4929-ordinary-b-sonnet.md` | Ordinary delta review B (beedd219..49298316) | Claude Sonnet 5.5 | `49298316` | APPROVE | `d6b3c293e5099d8a4ae01a139b9f512030cb3a6e5ff7d07a46f269b69bd76457` |
| 7 | `719-8bf6-security-rebind-opus.md` | Security rebind (49298316..8bf67c9c) | Claude Opus 5.5 | `8bf67c9c` | CLEAR | `cc1bdca13e309581c7338577f1ad3ddaaa9b8eb36efcc9915ec7edc4daf2825c` |
| 8 | `719-8bf6-ordinary-b-sonnet.md` | Ordinary delta review B (49298316..8bf67c9c) | Claude Sonnet 5.5 | `8bf67c9c` | APPROVE | `379f33f0e63117581efdf08d1019ac5ad200dab2544984c42627bd927af56f69` |
| 9 | `719-65ff-security-rebind-opus.md` | Security rebind (8bf67c9c..65ffd467) | Claude Opus 5.5 | `65ffd467` | CLEAR | `be54809a3804c3ec08c510df50e632e6148c8e8cb7b0e79c50e18b7fbfb84695` |
| 10 | `719-65ff-ordinary-b-sonnet.md` | Ordinary delta review B (8bf67c9c..65ffd467) | Claude Sonnet 5.5 | `65ffd467` | APPROVE | `2a77b093e6d193efbfeac268231fea67ee70d828cbeafab960c33a50220eab32` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 dd84958c1a639c34b737f061734217f04bb5648c18a85965e7a34b4a310ac1b8) -->
# PR #719 ordinary review A (API correctness, security-adjacent, tests)

- Model/context: Claude Sonnet 5.5, fresh independent reviewer A (did not author or direct the change)
- **Reviewed head:** beedd219a6d7634254fc66cf3033bd5ba3f54f7c
- Base: origin/main f0964fd5 (merged into the branch)
- Scratch worktree: /Users/heinthura/.codex/worktrees/review-719-a (detached at head; removed). Source files restored after mutations (git status clean). One Testcontainers ryuk container (4188cb1ae3e3) created by my test run, removed by exact ID.

## Files examined
apps/api/src/user-preference/{index,service,policy,schema,response,whitelist}.ts; apps/api/src/index.ts and policy-registry.ts diffs; apps/api/src/utils/require-session-only.ts (header); apps/api/src/database/schema.ts (user_preference, ~5433-5473); docs/03-features/settings-hierarchy.md (ST-12..ST-17 and edited lines); docs/03-features/views.md diff; docs/03-features/README.md (ST prefix, line 132); data-model.md user_preference row (~140); tests/api-integration/user-preference.test.ts; strict-runtime-enforcement.test.ts diff; openapi.json/matrix.fixture.json (via check scripts); issue #699; implementer notes user-pref-impl-sonnet.md. Web client files were not reviewed in depth (outside reviewer A focus).

## Commands run (all in the scratch worktree)
- pnpm install --frozen-lockfile: ok
- pnpm build: 6/6 tasks successful
- pnpm check:openapi: matches API, 283 operations. PASS
- pnpm check:route-policy: PASS (5/5 tasks)
- pnpm test:permissions: 14 files / 88 tests PASS
- CI=true vitest integration (serialized, maxWorkers 1) user-preference + api-key-self-mutations + strict-runtime-enforcement: 3 files / 26 tests PASS
- Mutation 1 (write reach guard `if (false)` in service.ts:164): "stores layout... 404s for a project the caller cannot reach" FAILS (1 failed / 15)
- Mutation 1b (read-side reach filter service.ts:112 removed): same test FAILS (1 / 15)
- Mutation 2 (requireSessionOnly() removed from PATCH middleware): "refuses PATCH from an API key with 403 session_required" FAILS (1 / 15)
- Files restored after each mutation; git status clean.
- gitleaks --no-git on a copy of this report: no leaks found. Not run: full integration suite, web tests, e2e.

## Answers to focus questions
1. GET: query is filtered by `person_id = caller` and a closed key/scope whitelist (service.ts:66-80); the person id comes from the authenticated user, never from input. Layouts for unreachable or soft-deleted projects are filtered (service.ts:93-112), invalid stored values are dropped. Nothing about other people or unreachable projects is revealed (test confirms non-whitelisted row `pinned_view_ids` is never served). OK.
2. PATCH: every key and value is validated before the first write (service.ts:136-157); reach for all layout keys is checked before the transaction (160-167); sets and clears happen in one `db.transaction` (169-241); `null` deletes the row; session-only via middleware before body limit/validation (index.ts:41-44); 404 for unreachable/missing/soft-deleted writes nothing (tested); 413 body, 422 for >20 keys, 422 settings_limit, 422 whitelist/schema all tested. Upsert uses the correct partial unique index per case: global rows target (person, scope, key) with `scope_id IS NULL`, scoped rows target (person, scope, scope_id, key) with `scope_id IS NOT NULL` (service.ts:206-225), matching the two partial indexes in schema.ts:5467-5472; idempotence tested. 500-row bound is NOT race-safe (finding 1).
3. Mapping ST-14 is consistent with data-model.md (scope global/workspace/project, scope_id null for global, unique (person, scope, scope_id, key)) and with the CHECK constraint.
4. Spec: ST-12..ST-17 match the implementation (404 vs 422 split, 20 keys, 500 rows, 4 KiB, 128-char project id, theme/sidebar 422). ST is settings-hierarchy's own prefix (README.md:132), numbers continue from ST-11 with no clash. The settings-hierarchy.md row-count sentence "a person holds at most 500 stored settings rows" is stronger than the implementation (finding 1). Test-list line at settings-hierarchy.md:240-241 has an over-long line (cosmetic).
5. Contract artefacts: 283 operations, check:openapi / route-policy / permissions pass; both routes registered in POLICY_SOURCES and in the strict-runtime source list.
6. Tests are non-vacuous for reach (write and read) and session-only (mutations above fail them).

## Findings
1. NON-BLOCKING: row cap is a soft bound, not race-safe. service.ts:170-192 counts rows with a plain SELECT inside a default read-committed transaction, no lock; two concurrent PATCHes of a person at 499 rows can both pass and reach 501. The code comment says so honestly, but ST-16 ("at most 500") is stated as a hard limit. Real exposure is small (closed whitelist, only projects the person reaches, one person's own rows). Suggest `pg_advisory_xact_lock(hashtext(person_id))` or `SELECT ... FOR UPDATE` on the person row at the start of the transaction, or soften the ST-16 wording to "about 500". Not tested concurrently.
2. NON-BLOCKING: stale layout rows cannot be cleared. A `null` for layout.<projectId> runs through the same reach check (service.ts:160-167), so after a person loses reach (or a project is soft-deleted) the inert row cannot be removed, still counts toward the 500 cap (ownRowsFilter counts it), and a DELETE of it returns 404. Cap pressure needs hundreds of lost projects, so practically negligible; either allow clearing without reach (it is the caller's own row and reveals nothing) or document in ST-15.
3. NON-BLOCKING: GET resolves reach with `credential: "session"` (service.ts:22) even when called by an API key, so a narrowly scoped key can see the owner's layouts for projects outside the key's own scope. This only returns the owner's own preference rows for projects the owner reaches, so no cross-person or cross-tenant leak; consistent with ST-12 ("GET open to keys"). Worth noting only.
4. NON-BLOCKING (test gaps): no test for (a) 403 on MCP key or impersonation (only plain API key, though requireSessionOnly covers them per its header); (b) `null` clear of a layout key and the 404 on clearing an unreachable one; (c) 413 uses a generic `text/plain` "Payload too large" rather than the API's JSON error shape (index.ts:43), differing from the other error responses documented as errorResponse; (d) concurrency on the row cap; (e) project id longer than 128 chars (422 path at whitelist.ts:50-54 untested); (f) the 500-row test seeds fake project ids that are not reachable, so it also relies on those rows counting (see finding 2).
5. NON-BLOCKING (cosmetic): `sqlNotNull()` helper at the bottom of service.ts is a trivial wrapper; `count` query and `existing` query at 173-183 could be one query.

No blocking findings.

## Residual risk
- Concurrency of the row cap not exercised. Web client (density hook, sync, cache-owner logic) and VW-2 not reviewed here. Full integration suite, e2e, visual and deployment/image checks not run. Security-scope: this PR still needs the mandatory fresh GPT-6 Sol exact-head review per CLAUDE.md; this report does not substitute for it.

## Verdict
APPROVE (ordinary review A; non-blocking findings 1 and 2 recommended before or shortly after merge).
<!-- END REPORT (sha256 dd84958c1a639c34b737f061734217f04bb5648c18a85965e7a34b4a310ac1b8) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 690a968ede953427c674e3f8f6436e25370838e20bbe4ed7fb1471cb906c41a6) -->
# PR #719 ordinary review B (web client, spec alignment, completeness vs #699)

- Model/context: Claude Sonnet 5.5, fresh independent reviewer B (did not author or direct the change)
- **Reviewed head:** beedd219a6d7634254fc66cf3033bd5ba3f54f7c
- Base: origin/main f0964fd5 (merged into the branch)
- Scratch worktree: /Users/heinthura/.codex/worktrees/review-719-b (detached at head; removed afterwards). Source restored after mutations (git status clean). No Docker containers created by this review (web tests only).

## Files examined
apps/web/src/lib/user-preference-sync.ts (+test); apps/web/src/hooks/use-density-preference.ts (+test); apps/web/src/components/providers/user-preferences-sync.tsx; hooks/queries/user-settings/use-get-user-settings.ts; hooks/mutations/user-settings/use-patch-user-settings.ts; fetchers/user-settings/user-settings.ts; main.tsx diff; preferences.tsx and preferences.test.tsx diffs; docs/03-features/settings-hierarchy.md and views.md diffs; issue #699; reviewer A report.

## Commands run (scratch worktree) and results
- pnpm install --frozen-lockfile; pnpm build: 6/6 successful
- web vitest full: 152 files / 681 tests PASS
- web typecheck (tsc app + node): PASS
- pnpm check:i18n: all locales in sync PASS
- pnpm check:tokens (incl. contrast, 418 pairs): PASS
- pnpm check:bundle-size: agent initial 231.7/350 KB, work-list 300.6/350 KB, portal 163.7/200 KB PASS
- pnpm check:reviews: spec(s) settings-hierarchy.md, views.md named; "every spec named in this change has an empty review section" PASS
- Touched web tests alone: 11 tests pass. Mutations (each restored afterwards):
  - M1 `isCacheOwnedByAnotherUser` forced to false: "never uploads another user's local density..." FAILS (1)
  - M2 migrated guard in `reconcilePreference` removed: "uploads ... once" (unit) and "migrates ... exactly once" (hook) FAIL (2)
  - M3 dirty-first branch removed: both dirty/stale-server tests FAIL (2)
- gitleaks --no-git on a copy of this report: see end of summary.

## Answers to focus questions
1. Density sync. Logic matches the brief: cache paints first, server wins after load (effect keyed on `data` identity), non-default local value with no server value uploaded once then marked migrated, failed write keeps `dirty` and is pushed on the next load, read error leaves the cache untouched, per-user query key, `enabled` only with a user, `retry:false`, staleTime 60s, mounted at main.tsx:130 inside AuthProvider and QueryClientProvider.
   - Request storms: none. Refetch (focus, after 60s) returns structurally shared data, so the effect does not re-run unless values change; at most one extra duplicate PATCH when a dirty marker coexists with a refetch.
   - Toggle vs initial sync race: toggling before the GET lands marks dirty, so the later (older) GET pushes the local value rather than reverting it. If the PATCH completes before a stale in-flight GET lands, the stale value is adopted briefly, then the invalidate-triggered refetch restores the right value (eventually consistent).
   - Residual race (finding 2): two quick toggles can leave the earlier PATCH clearing `dirty` while the later PATCH is in flight or fails.
   - Untagged legacy cache claimed by first user to sign in: acceptable. Impact is one cosmetic preference (density) that is only uploaded if non-default, never overwrites an existing server value, and can be changed in settings. Worst case is one person on a shared browser inheriting another's compact mode once. Should be stated as a known residual in the PR body (it is partially stated in ST-17).
2. Spec alignment. ST-12..ST-17 match code per reviewer A and my read of the client (ST-17: first-paint cache, server wins, migrate once, owner attribution). views.md Per-user preferences points to settings-hierarchy.md#profile-settings-routes and says the VW-2 wiring (project-layout-preference.ts, PR #688) is not on main yet and must read/write via the route. theme and sidebar are listed as not whitelisted and 422 (ST-14). check:reviews passes. `grep PREF-` finds two leftovers (finding 1).
3. Completeness vs #699. Items 1 (routes, whitelist, policy, limits, OpenAPI, matrix, tests) and 3 (views.md update; the decision-log follow-up removal is control-plane, not in this diff) are done; item 2 is half done: density yes, VW-2 layout no (owed to #688). Remaining for VW-2 after #688 merges: replace the localStorage-only read/write in project-layout-preference.ts with a `layout.<projectId>` hook using the same GET/PATCH (GET returns all reachable layouts in one call, so one query serves every project); one-time migration of `taskdesk:project-layout:<userId>:<projectId>`; URL layout must still win; offline fallback; tests for migrate-once, URL-wins, offline (views.md lists them as owed); remove the interim note in the decision log. The pure pieces (`reconcilePreference`, marker helpers with scopeId) are reusable. The hook itself is density-specific and the "generic sync library" is not a full generic engine; #688 will write its own hook. Cache-owner helpers take no scopeId (finding 3), and a 404 on a project the user lost reach to will keep a layout "dirty" forever (finding 4).

## Findings
1. NON-BLOCKING: invented rule IDs remain. apps/web/src/hooks/use-density-preference.test.tsx:47 and apps/web/src/lib/user-preference-sync.test.ts:21 name "views.md PREF-8". No PREF-N rule exists; the docs use VW-6 and ST-17. Rename to "VW-6, ST-17". (The brief asked that no PREF- remains; two do, in test titles only.)
2. NON-BLOCKING: out-of-order or overlapping density writes. use-density-preference.ts:134-152: a PATCH `.then` clears `dirty`/sets `migrated` and invalidates, regardless of a newer toggle still in flight. If a later toggle's PATCH then fails, the refetch can overwrite the user's latest local choice with the earlier server value. Narrow window; fix by tracking a write sequence number or clearing dirty only if the value written equals the current store value.
3. NON-BLOCKING: `getPreferenceCacheOwner`/`setPreferenceCacheOwner` (user-preference-sync.ts:~110-148) are keyed by preference key only, with no scope id, unlike the markers. For per-project layout the tag would be shared across projects and could mis-attribute. VW-2's own key already embeds the user id, so #688 can skip the owner tag; either add an optional scopeId or document the helpers as global-key only.
4. NON-BLOCKING: dirty values with no recovery path. A dirty write rejected permanently (for example 422, or 404 for layouts) is retried on every load forever and never cleared (use-density-preference.ts, `.catch` branches). Fine for density (always valid); for #688's layout, clear dirty on 4xx non-network errors.
5. NON-BLOCKING: test gaps. No test for: toggling before the initial GET resolves (race above), the duplicate-PATCH case, signed-out (no user) no-fetch, user A to user B on the same browser where server for B has a value, or the preferences page asserting the PATCH payload on a failed write. The existing page test only checks patch is invoked.
6. NON-BLOCKING (docs): settings-hierarchy.md test-list line (~240-241) is over-long and runs the Unit and Integration sentences together; views.md says "The route exists on main" which is true only after this PR merges (fine at merge time).

No blocking findings.

## Residual risk
- Browser behaviour in a real shared-browser sign-in sequence and real network failure not exercised (jsdom/mocks only). Legacy-cache claim by first user is accepted (above). VW-2 is entirely unimplemented here. API side covered by reviewer A; security-scope Sol review still required and not substituted by this report. Not run: e2e, visual, container/deployment checks, API integration suite.

## Verdict
APPROVE (non-blocking; finding 1, the PREF-8 test titles, is a trivial fix worth doing before merge).
<!-- END REPORT (sha256 690a968ede953427c674e3f8f6436e25370838e20bbe4ed7fb1471cb906c41a6) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-7a32-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 3f888548255368db19ef0191c4ecb441ff707e9d09c6fb0e9251d8beec034de1) -->
# PR #719 delta ordinary review A (beedd219..7a32a0f3, API and web)

- Model/context: Claude Sonnet 5.5, fresh independent reviewer A (same reviewer as the earlier beedd219 report; did not author or direct the change)
- **Reviewed head:** 7a32a0f337b8a195b0054bbd5516a6c88a9ae1f4
- Delta base: beedd219a6d7634254fc66cf3033bd5ba3f54f7c
- Scratch worktree /Users/heinthura/.codex/worktrees/review-719-a2 (removed; source restored after each mutation, git status clean). No ryuk/testcontainers containers left behind (none created that persisted).

## Files examined
apps/api/src/user-preference/{index,service,whitelist}.ts diff; apps/web/src/hooks/use-density-preference.ts and user-preference-sync.ts diffs; fetchers/user-settings/user-settings.ts (HttpError status); tests (user-preference.test.ts new cases, use-density-preference.test.tsx, user-preference-sync.test.ts); settings-hierarchy.md diff (stat); repo-wide grep of pg_advisory.

## Commands and results
- CI=true serialized integration: user-preference + api-key-self-mutations + strict-runtime-enforcement: 3 files / 31 tests PASS (user-preference now 20 tests)
- Web: use-density-preference.test.tsx + user-preference-sync.test.ts + settings/account/preferences.test.tsx: 3 files / 18 tests PASS. (A broad `src/routes` pattern I ran by accident hit 4 portal/agent files failing to resolve `@taskdesk/domain/intake` in this fresh worktree: an unbuilt-package environment issue unrelated to this PR; not a PR finding.)
- Mutations, all caught:
  - API: remove the `pg_advisory_xact_lock` call: "serialises one person's writes..." FAILS (1/20)
  - API: require reach for clears again: "clears a layout with null ... stale row" FAILS (1/20)
  - API: disable the cap comparison: cap test and serialisation test FAIL (2/20)
  - Web: remove generation guard on success: "lets only the latest write clear the unsent mark" FAILS
  - Web: make 401 terminal: "treats 4xx as terminal except 401, 408 and 429" FAILS
- gitleaks --no-git on a copy of this report: see end of this file (no leaks).

## Review points
1. Lock key. `pg_advisory_xact_lock(699001, hashtext(personId))` uses the two-int form, whose keyspace is separate from the single-bigint users (`(2026)`, `hashtextextended(...)`, namespace 4_011 single-arg). Other two-int users: COLUMN_SEED 4_004, WORKSPACE_ROLE 4_003, membership namespaces, and step-up `(hashtext(sessionId), hashtext(...))`. No namespace collision with a constant; the step-up form's first int is a hash, so a collision is a 2^-32 event and would only cause a brief extra wait, never wrong behaviour. Scope is per person, transaction-scoped (released at commit/rollback), taken once and before any other lock in the transaction, so no lock-ordering/deadlock risk. Reach lookup and identity resolve happen before the transaction, so the lock is held only for the write. Cap is now exact: count (`existing.length`) is read after the lock and after clears. The deterministic `pg_locks` test uses the same namespace (699_001 hard-coded at test:433; if the constant changes the test must follow, but it fails loudly if so).
2. Stale clear / oracle. Clears no longer go through reach (service.ts:161-166); the delete is keyed by (caller person, scope, key, scopeId) so it can only affect the caller's own row, returns 200 with the normal body whether or not a row or project exists. Set of an unreachable project still 404. No existence oracle: a nonexistent, soft-deleted and foreign project clear are identical (200, same body). A mixed request (set unreachable + clear) is 404 as before, which depends only on the set key. Clear-before-count ordering is covered by the cap tests (mutation caught). PASS.
3. Generation guard (web). `latestWrite` increments per write; writes are serialised through `writeChain` (`then(send, send)` so a failure does not break the chain, and `result.catch` keeps the chain alive). Only the latest generation clears `dirty`/sets `migrated`/invalidates the query; an earlier success cannot hide a later unsent change; an earlier failure of a non-latest write is ignored since the latest value supersedes it. Logic is correct. Non-blocking notes: `latestWrite`/`writeChain` are module-level and not per user, so after a user switch the old user's in-flight latest write could be treated as "latest" for the new user's first write only in the sense of generations (harmless: markers are keyed per userId), but the terminal-rejection branch calls `setCompactMode` from the old user's rejection even if the signed-in user changed meanwhile (tiny edge; a userId check against the current auth user before adopting would close it).
4. 401 not terminal. Sound: 401 means session expiry, the choice should survive re-login and the dirty mark persists, retried on the next successful load. 408/429 transient, 5xx not terminal. Other 4xx (403, 404, 413, 422) are terminal and adopt the server state via `fetchQuery`; failure of that fetch is swallowed and the next load reconciles. Covered at predicate level (`isTerminalWriteRejection`) and hook-level for 4xx/5xx/429 and ordering; the hook has no explicit 401 test (predicate test only). Non-blocking.
5. 413 via HTTPException: now goes through the app error handler, consistent JSON shape; tested.

## Findings
- No blocking findings.
- NON-BLOCKING: terminal-rejection branch can write `compactMode` after the signed-in user changed (see 3).
- NON-BLOCKING: no hook-level test that a 401 keeps the write dirty (only the predicate is tested).
- NON-BLOCKING: lock namespace 699_001 is outside the repo's 40xx convention for namespaces and the test duplicates the literal; consider importing the constant in the test.
- Cosmetic (already noted by coordinator): web changes are in the commit titled "fix(api)...".

## Residual risk
Full integration suite, e2e, image/deploy checks not run. Web visual not checked. Security-scope: the mandatory fresh GPT-6 Sol exact-head review at 7a32a0f3 is still required; this report does not substitute for it.

## Verdict
APPROVE
gitleaks result: no leaks found.
<!-- END REPORT (sha256 3f888548255368db19ef0191c4ecb441ff707e9d09c6fb0e9251d8beec034de1) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-security-opus.md; Claude Opus 5.5; sha256 0e7334b88b1d2ea6ad4c8bd88a21c84c2262f530be17269cce341c7f4793cc3b) -->
# PR #719 security review (sampled big reviewer, Opus 5.5)

- **Model / context:** Claude Opus 5.5 (`claude-opus-5-5`), fresh independent context. Did not
  author, direct or remediate the change. No edits, pushes, comments or merges on the branch.
- **PR:** ThomasHeinThura/ticketing #719, `GET/PATCH /api/me/settings` (issue #699).
- **Reviewed head:** 569aea448f509c583f4735652d0ae6bfc3ed361b
- **Merge base / comparison base:** 9a8e84cf68fc802bac84e68bcc3051e65172b5ba (origin/main; the
  head is a merge of origin/main into the branch).
- **Live confirmation (`git ls-remote https://github.com/ThomasHeinThura/ticketing.git`):**
  `refs/pull/719/head` = `refs/heads/codex/user-preference-routes` = 569aea44…; `refs/heads/main`
  = 9a8e84cf…. (SSH remote was refused by the proxy; HTTPS ls-remote succeeded.)
- **Scratch worktree:** `/Users/heinthura/.codex/worktrees/review-719-sec`, detached at the
  head; installed with `pnpm install --frozen-lockfile`, packages and API built. Removed after
  the review.

## Surfaces examined

- `apps/api/src/user-preference/{index,policy,response,schema,service,whitelist}.ts` (all of it).
- `apps/api/src/index.ts` (mount at `/me`, the auth guard, the global CSRF call, host routing
  and the portal allowlist), `apps/api/src/policy-registry.ts`.
- `apps/api/src/utils/require-session-only.ts`, `apps/api/src/utils/csrf-protection.ts`,
  `apps/api/src/permissions/resolve-identity.ts`, `packages/permissions/src/evaluator.ts`
  (`reaches`, `ProjectReachFacts`), `apps/api/src/utils/has-project-reach.ts` and
  `workspace-access-middleware.ts` (to compare how reach facts are built elsewhere).
- `apps/api/src/database/schema.ts` `user_preference` (text `scope_id`, two partial unique
  indexes, scope check).
- Web: `apps/web/src/lib/user-preference-sync.ts`, `hooks/use-density-preference.ts`,
  `components/providers/user-preferences-sync.tsx`, `fetchers/user-settings/user-settings.ts`,
  `hooks/mutations/use-sign-out.ts`, `components/user-avatar.tsx` (sign-out path).
- `tests/permissions/matrix.fixture.json` (semantic diff against main),
  `tests/api-integration/user-preference.test.ts`, `strict-runtime-enforcement.test.ts` diff.
- Authorities: `docs/03-features/settings-hierarchy.md` ST-12..ST-17, decision-log 2026-10-06
  "Keep self-only personal writes session-only until explicit API-key scopes exist".
- Prior reviews read: `719-ordinary-a-sonnet.md`, `719-ordinary-b-sonnet.md`,
  `719-7a32-ordinary-a-sonnet.md`.

## Tests and probes run (scratch worktree, exact head)

| Run | Result |
| --- | --- |
| `CI=true vitest --config vitest.integration.config.ts` on `user-preference`, `api-key-self-mutations`, `strict-runtime-enforcement` (serialized, Testcontainers Postgres) | 3 files / 31 tests passed |
| `pnpm test:permissions` | 14 files / 88 tests passed |
| `pnpm check:openapi` | passed, 283 operations match |
| `pnpm check:route-policy` | passed (5/5 tasks) |
| Web: `use-density-preference.test.tsx`, `user-preference-sync.test.ts`, `settings/account/preferences.test.tsx` | 3 files / 18 tests passed |
| Probe file `719-security-opus-probes.test.ts` (this folder; SHA-256 `a7735561b62764f5840ccda65a196a4475fec15422f2176725ceba2401ec5d2a`), `CI=true`, Testcontainers | 13 / 13 passed; raw output in `719-security-opus-probes.log` |

Containers: running container IDs were snapshotted before the runs and compared after; no
container created by these runs was left behind (Testcontainers stopped its own). No container
was removed by hand.

### Probe results

- **P1 prototype keys.** `{"__proto__":…}` → 422 "no keys supplied" (the key never becomes an
  own entry after validation); `constructor`, `prototype` → 422; `layout.__proto__`,
  `layout.constructor` set → 404, clear → 200 `{}`. `Object.prototype` not polluted; only the
  `density` row was ever written.
- **P2 duplicate keys.** JSON last-wins; `{"density":"compact","density":"tight"}` → 422, nothing
  written; reversed order → 200 `compact`. No split between validated and written value.
- **P3 crafted ids.** SQL quotes, `' OR person_id <> '`, `../../etc/passwd`, `%`, `_`, `*`,
  upper-cased real id, leading space, trailing tab, 32 emoji, combining/precomposed é: every set
  → 404, every clear → 200 `{}`. Clearing Bob's real project id as Alice → 200 and Bob's rows are
  byte-identical afterwards. All filters are parameterised `eq` on `person_id`.
- **P4 control characters.** `layout.\u0000` and `layout.a\u0000b` → **500** on both set and
  clear (Postgres rejects NUL in text). Lone surrogates → 404 / 200. See finding N1.
- **P5 clear leaks nothing.** Clearing a missing id, a foreign-workspace project, a soft-deleted
  project and an own reachable project with no row: identical status (200), identical body and
  identical headers (request-id and date excluded).
- **P6 scope confusion on clear.** `density: null` deletes only the caller's `global/density`
  row; the caller's `global/pinned_view_ids` row and Bob's density row survive.
- **P7 GET scope confusion.** Rows planted for Alice as `project/<bob project>/layout`,
  `workspace/<own project>/layout`, `project/<own project>/density`, and a `layout` row with a
  1 KB object value: GET returns `{}` (unreachable, wrong scope, wrong key, failed schema).
- **P8 customer side.** Customer identity with an agent session on the agent host: GET 200 `{}`,
  layout PATCH → 404, density PATCH → 200 (own global row only). Portal session on the portal
  host: GET and PATCH → 404 (host guard; the route is not a portal policy route). Portal session
  on the agent host: 401. No customer reaches any staff project.
- **P9 narrow key read.** A key scoped `{time_entry:["read"]}` and a scope-less key both read
  `GET /api/me/settings` → 200 with `layout.<projectId>` entries, while the same keys get 403 on
  `GET /api/project/<that id>`. See finding N2.
- **P10 CSRF.** Cookie-session PATCH with no token → 403 `csrf_token_missing`; foreign Origin →
  403 `csrf_origin_invalid`; forged token → 403; nothing written. (The positive control through
  the shared `csrfRequest` helper could not be run because the issuer needs a stored session;
  the guard itself is the shared global middleware in the auth guard, `index.ts:1362`.)
- **P11 body edges.** `[]`, string, `null`, number, array-of-pairs → 400; malformed JSON → 400;
  a 10 KB streamed body with no Content-Length → 413; 20 clears with 128-char ids (2.8 KB) → 200,
  nothing written. `text/plain` or missing content type → 422 "no keys supplied": the JSON
  validator does not run for a non-JSON content type and the body is ignored, so nothing is
  written (informational).
- **P12 lock isolation.** With person A's lock `(699001, hashtext(A))` held by an external
  session, person B's PATCH completed in 11 ms (200).
- **P13 credentials.** Key via `x-api-key` and via Bearer → 403 `session_required`; key plus a
  valid session in the same request → 403 (key wins, refused); impersonation GET → 200 (the
  impersonated person's own rows; GET is not session-only by spec).

## Answers to the challenge

1. **Self-only isolation.** Holds. Every read, delete, count and upsert is filtered on
   `identity.personId` from the authenticated user (`service.ts:67-81, 182-193, 197-203,
   216-245`); the client never supplies a person. Keys only select a fixed `(scope, key)` pair and
   a parameterised `scope_id`. Prototype keys, duplicates, SQL/path/unicode ids and scope
   confusion were all probed (P1-P3, P6, P7).
2. **Reach.** Set requires reach via `reaches()` over live, non-deleted project rows
   (`service.ts:33-65, 164-171`), 404 with nothing written. Clear needs no reach and is
   indistinguishable across missing/foreign/deleted/own (P5). GET filters by reach (P7, P8).
   Customer identities reach no staff project; the portal host refuses the route.
   Reach facts use `workspace.organisation_id`, `ancestorProjectIds: []` and `ownerTeamId: null`;
   this matches the other reach callers in this codebase (no project hierarchy or owner-team
   columns exist yet) and can only narrow reach, never widen it.
3. **Credentials.** PATCH is session-only before body parsing (`index.ts:37-45`); API key, MCP
   (same runtime kind) and impersonation → 403 (P13 and the PR's own tests). CSRF applies (P10).
   GET with a key resolving reach "as a session" is safe in the sense that matters for isolation:
   keys in this runtime carry no project or workspace scope, only capability pairs, and reach is
   always the owner's own. It does let a key with no project capability learn the owner's
   project ids (finding N2).
4. **DoS.** 4 KiB enforced also on streamed bodies; 20 keys; 500 rows exact under the lock
   (the PR's concurrency test passes). The lock is a transaction lock, released at
   commit/rollback; the transaction holds at most 20 deletes, one select and 20 upserts and makes
   no outside calls, so hold time is bounded by those statements. One person cannot block
   another except on a 32-bit `hashtext` collision, which only serialises two people briefly.
   Values are closed enums, so a client cannot store large JSON; GET also re-validates stored
   values (P7). A burst of one person's concurrent PATCHes holds one pool connection each while
   queued; that is no worse than any other burst of concurrent requests.
5. **Web client.** The cache owner and markers are keyed per user. The terminal-branch race the
   delta review noted is real but cosmetic (finding N3). No confidential value crosses users:
   the only value is a one-bit density, and the server stores rows only under the session's own
   person.
6. **Matrix and registry.** The registry declares GET `authenticated + self` and PATCH
   `authenticated + self + sessionOnly`, both `no_person_parameter`; runtime matches (keys read
   GET, keys/impersonation refused on PATCH, every role allowed for its own rows). A semantic
   diff of `matrix.fixture.json` against main shows only the two new routes added; the other
   textual churn is key reordering with no removed or changed value. `strict-runtime-enforcement`
   lists the new policy source and passes. No #708-class mismatch found.

## Findings

No blocking findings.

- **N1 (non-blocking, robustness).** A NUL character in a layout key returns 500 instead of
  422. `parseSettingKey` (`apps/api/src/user-preference/whitelist.ts:47-60`) accepts any
  characters, and Postgres rejects `\u0000` in a text parameter in the reach query
  (`service.ts:38-51`, set path) and in the delete (`service.ts:182-193`, clear path). The
  response is the generic `Internal Server Error`; nothing is written and nothing leaks. Fix:
  restrict the project-id segment to the id alphabet (for example `^[A-Za-z0-9_-]{1,128}$`) or
  reject control characters with 422, and add a regression test.
- **N2 (non-blocking, design note on ST-12).** `GET /api/me/settings` resolves reach with
  `credential: "session"` (`service.ts:19-30`) and the policy leaves GET open to keys
  (`policy.ts:22-31`). A key with no `project:read` capability (P9: a `time_entry:read` key and a
  scope-less key) can list the ids of projects the owner has layouts for, which the same key
  cannot read through `GET /api/project/{id}` (403). The disclosure is the owner's own data,
  opaque ids plus `board`/`list`, no cross-person or cross-tenant reach, and it matches ST-12 and
  the 2026-10-06 decision ("read-only self routes remain unchanged"). Recommend a follow-up when
  explicit key scopes land: either omit `layout.*` for a key lacking `project:read`, or make the
  GET session-only too.
- **N3 (non-blocking, client integrity).** `writeChain`/`latestWrite` are module-level
  (`apps/web/src/hooks/use-density-preference.ts:37-53`) and sign-out is an SPA navigation
  without a reload (`hooks/mutations/use-sign-out.ts:22-35`, `components/user-avatar.tsx:38-41`).
  If user A signs out while their density PATCHes are still queued and user B signs in in the
  same tab, a queued `send()` goes out with B's cookie, so A's last density choice could be
  written to B's row. If the request fails terminally instead, the branch at lines 71-99 fetches
  with B's session into A's query key, sets the shared `compactMode`, and tags the cache owner as
  A (the next reconcile for B treats it as foreign and self-heals). Impact: one cosmetic bit on a
  shared browser in a narrow timing window. It does not expose anyone's data, but it is a gap in
  ST-17's "never uploaded for another person". Fix: capture the auth user at send time and drop
  the send (and the terminal adoption) when the current user differs; or reset the chain on
  user change.
- **N4 (non-blocking, informational).** A PATCH with a non-JSON content type skips body
  validation and is answered `422 settings: no keys supplied` (P11). CSRF runs earlier, and
  nothing is written. A 415 would be clearer.
- **N5 (non-blocking, process).** The CSRF positive path for this route was not exercised end to
  end by me (the shared issuer needs a stored session). The negative paths were, and the
  middleware is shared and unchanged by this PR.

## Residual risk / not checked

- I did not run the full integration suite, a container image build or deployment checks.
- I did not drive the web client in a browser; N3 is from source reading, not reproduced.
- I did not test strict-enforcement mode with my probes beyond the PR's
  `strict-runtime-enforcement` suite.
- A future key-scope model (P4 extension table) must revisit N2.
- A future project hierarchy or owner-team reach must update `reachableProjectIds`, which
  hard-codes `ancestorProjectIds: []` and `ownerTeamId: null` (fail-closed today).

## Verdict

**CLEAR** for 569aea448f509c583f4735652d0ae6bfc3ed361b. No blocking finding. This sampled
Opus 5.5 review does not replace the required GPT-6 Sol security review.
<!-- END REPORT (sha256 0e7334b88b1d2ea6ad4c8bd88a21c84c2262f530be17269cce341c7f4793cc3b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-4929-security-rebind-opus.md; Claude Opus 5.5; sha256 2292d2e4a5ad14b8c1bfb77ba029b306d56183c875f1b7d53383cc3bdebd30b9) -->
# PR #719 security rebind (sampled big reviewer, Opus 5.5)

- **Model / context:** Claude Opus 5.5 (`claude-opus-5-5`). Same reviewer context as the CLEAR at
  569aea44 (`719-security-opus.md`); I did not author, direct or remediate the fix commits. No
  edits, pushes, comments or merges on the branch.
- **Reviewed head:** 49298316eea9f330cf086c5a1b0e1b664b6acdcb
- **Previous reviewed head:** 569aea448f509c583f4735652d0ae6bfc3ed361b (CLEAR)
- **Merge base:** 9a8e84cf68fc802bac84e68bcc3051e65172b5ba. `git ls-remote` (HTTPS), checked
  at the start and again at the end: `refs/heads/main` = 9a8e84cf…;
  `refs/pull/719/head` = `refs/heads/codex/user-preference-routes` = 49298316….
- **Scratch worktree:** `/Users/heinthura/.codex/worktrees/review-719-rebind`, detached at the
  head, installed and built, then removed.

## Delta 569aea44..49298316 (nothing else changed)

Two commits, each a single parent, with no merge:

- `2b96345f` fix(api): reject project ids outside the id alphabet with 422
- `49298316` fix(web): scope density write queue to the signed-in user

Four files changed, 170 insertions and 15 deletions:

- `apps/api/src/user-preference/whitelist.ts`: a `PROJECT_ID_PATTERN` of
  `^[A-Za-z0-9_-]{1,128}$` replaces the length-only check. The constant moved; its value is
  unchanged.
- `apps/web/src/hooks/use-density-preference.ts`: the write queue and generation are now per
  user, with checks against the signed-in user.
- `apps/web/src/hooks/use-density-preference.test.tsx`: additions only (+85).
- `tests/api-integration/user-preference.test.ts`: additions only (+22).

No route, policy, registry, matrix, OpenAPI, service or schema file changed.

## N1 (NUL / control characters → 500): fixed

`parseSettingKey` (`whitelist.ts:59-61`) now returns `undefined` for any id outside the
alphabet. The id is therefore refused with 422 before identity resolution, any query or the lock,
on both set and clear.

I re-ran the probes against this head with `CI=true` and Testcontainers. The probe file is
`719-4929-security-rebind-opus-probes.test.ts` in this folder (SHA-256
`bb93c3e43617ff17dd076b7ceb35504e336d18adc06d3eda3397578ccea74431`). P3 and P4 now expect 422
for ids outside the alphabet. The raw output is in `719-4929-security-rebind-opus-probes.log`.

- **P4:** every one of these ids gets 422 on set and 422 on clear, and nothing is written:
  - NUL characters: `\u0000`, `a\u0000b`, `abc\u0000`, `\u0000abc`;
  - lone surrogates: `\ud800`, `\udfff`;
  - control and whitespace characters: BEL, `\n`, `\r`, space, NBSP, zero-width space;
  - punctuation: `/`, `.`, `%00`;
  - a Cyrillic look-alike, and a 129-character id.

  No request returned 500.
- **P3:** ids containing SQL quotes, paths, `%`, `*`, a leading space, a trailing tab, emoji or
  é now get 422 on set and clear. `_` and an upper-cased real id are inside the alphabet: set
  gives 404 and clear gives 200. Clearing Bob's real project id still gives 200, and Bob's rows
  are unchanged.
- **Existence leak:** none. The 422 depends only on the id's syntax, never on whether a project
  exists.
- **P5 (clear is indistinguishable):** still identical across missing, foreign, deleted and own
  projects, in status, body and headers.
- **Other probes:** P1, P2 and P6-P13 still pass. The probe file and the PR suite together give
  2 files and 40 tests passed.

Real project ids are cuid2, so they are inside the alphabet. Rows can be written only for
reachable real projects, so no stored row can fall outside the alphabet and get stuck.

## N3 (queued density write sent with another user's session): fixed

I read `use-density-preference.ts:41-140, 159, 226`:

- **Per-user queue.** `writeStates` is a `Map<userId, {chain, latest}>`. The generation compare
  is per user.
- **Send-time check (line 80-83).** A queued `send()` calls `patchSettings` only when
  `activeUserId === userId`. Otherwise it rejects with `SupersededByUserChange`, and the error
  branch returns at once. That user's dirty marker stays under that user's key, so nothing is
  written to the other account.
- **Success and terminal branches (lines 89, 105-111).** Both are skipped when the signed-in
  user changed. The adopt step re-checks after the refetch (line 121).
- **How `activeUserId` stays current.** It is set by `useLayoutEffect` in both hooks.
  `UserPreferencesSync` is mounted inside `AuthProvider` (`main.tsx:133-134`), and
  `AuthProvider` keeps its children mounted after the first session load. On sign-out the user
  becomes `null`, so `activeUserId` becomes `undefined` and A's queued sends are dropped before B
  signs in.

Tests:

- The web density and sync files plus the preferences page test pass: 3 files and 20 tests,
  including both new tests, "never writes user A's queued density to user B's account after a
  mid-flight sign-out and sign-in" and "does not apply a terminal-rejection adopt to a different
  signed-in user".
- I mutation-checked the tests in the scratch copy, then restored it:
  - Removing the send-time check makes the mid-flight test fail.
  - Removing all three user checks makes both new tests fail.
  - Removing only the terminal-branch entry check and the adopt-time check (lines 108 and 121)
    leaves all 12 hook tests passing. See R1.

## Runs at this head

| Run | Result |
| --- | --- |
| `CI=true` integration: user-preference, api-key-self-mutations, strict-runtime-enforcement (one at a time) | 3 files / 38 tests passed (was 31; +7 new id-alphabet cases) |
| Rebind probes + user-preference suite | 2 files / 40 tests passed |
| `pnpm test:permissions` | 14 files / 88 tests passed |
| `pnpm check:openapi` | passed, 283 operations |
| `pnpm check:route-policy` | passed (exit 0) |
| Web: density hook, sync lib, preferences page | 3 files / 20 tests passed |
| Mutation checks (web, scratch only, reverted) | as above |

**Docker.** Running container IDs were snapshotted before my runs and compared after. One new
container was running at the end: `22d8f88c6bce` (`postgres:18-alpine`, name
`pedantic_moore`). It belongs to Testcontainers session `6bdabbdc468a`. That session's Ryuk
container (`16cbbd6b0252`) was already in my before-snapshot, and the Postgres container was
created at 19:31:18Z, after my integration runs had finished. So it is not one of mine, and I
did not remove it. Each of my vitest runs used its own Testcontainers session, and none of my
containers was left behind.

## Findings

No blocking findings.

- **R1 (non-blocking, test coverage).** No test fails on its own when the terminal-branch
  `activeUserId !== userId` check (`use-density-preference.ts:108`) or the adopt-time check
  (`:121`) is removed. The new "terminal-rejection" test passes only because of the send-time
  check. The code is correct when read. To make the test non-vacuous, have the PATCH reject
  only after the user switches, and resolve the refetch after a second switch.
- **R2 (non-blocking, residual).** The send-time check uses React's view of the user. If the
  session cookie changes without this tab's auth state changing first, a queued send can still
  go out with the new cookie. An example is signing in as someone else in another tab while a
  request in this tab is slow. The window is narrow and the impact is one cosmetic density bit.
  In the same way, a terminal-branch refetch that finishes after a user switch can leave the
  other user's settings in the old user's query cache entry. That entry is never adopted, and
  the next fetch replaces it.
- **R3 (non-blocking, docs).** ST-16 in `settings-hierarchy.md` still says only "a project id
  at most 128 characters". The id alphabet (`[A-Za-z0-9_-]`) and its 422 on clear are not in
  the spec text. A one-line spec update would keep code and contract aligned.
- **N2 and N4 from the first report are unchanged and remain non-blocking.** N2 is the GET key
  read of layout ids. N4 is a non-JSON content type getting 422 instead of 415; the 415 change
  was declined because the repo has no 415 convention.

## Residual risk / not checked

- I did not run the full integration suite, an image build or deployment checks.
- I did not drive the web client in a real browser. The N3 verification is by code reading, the
  unit tests and mutation checks.

## Verdict

**CLEAR** for 49298316eea9f330cf086c5a1b0e1b664b6acdcb. N1 and N3 are fixed, nothing outside the
four files changed, and main is still 9a8e84cf. This sampled Opus 5.5 review does not replace the
required GPT-6 Sol security review at this head.
<!-- END REPORT (sha256 2292d2e4a5ad14b8c1bfb77ba029b306d56183c875f1b7d53383cc3bdebd30b9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-4929-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 d6b3c293e5099d8a4ae01a139b9f512030cb3a6e5ff7d07a46f269b69bd76457) -->
# PR #719 delta ordinary review B (web delta beedd219 -> 49298316)

- Model/context: Claude Sonnet 5.5, fresh independent reviewer B (did not author or direct the change)
- **Reviewed head:** 49298316eea9f330cf086c5a1b0e1b664b6acdcb
- Previous approval head: beedd219a6d7634254fc66cf3033bd5ba3f54f7c
- Scratch worktree: /Users/heinthura/.codex/worktrees/review-719-b2 (removed afterwards; mutations and added tests reverted, git status clean). No Docker containers created.

## Files examined
apps/web/src/hooks/use-density-preference.ts (full) and its test; apps/web/src/lib/user-preference-sync.ts diff (scopeId on owner helpers, isTerminalWriteRejection). The #688 merge files (project layout, search, routes) were not reviewed beyond their tests passing in the full suite.

## Commands and results
- pnpm install --frozen-lockfile, pnpm build: ok
- Full web vitest: 162 files / 776 tests PASS. Touched density and sync tests: 19 PASS (12 in the hook file).
- web typecheck PASS; check:i18n PASS; check:reviews PASS; grep PREF- over apps, docs, tests: no matches (B1 renamed).
- Mutations (hook test file only, each reverted):
  - send-time check removed (`activeUserId === userId` -> `true`): "never writes user A's queued density to user B's account..." FAILS (1)
  - success-path generation guard removed: "lets only the latest write clear the unsent mark..." FAILS (1)
  - R1 confirmed: removing the terminal-branch user check (line 108), the adopt-time check (line 121), or both, leaves all 12 existing hook tests passing. The existing "does not apply a terminal-rejection adopt to a different signed-in user" test is vacuous for those guards.
- Recommended R1 tests (added only in scratch, then reverted) fail the right mutation and pass on the real code: with them the file is 14/14 PASS; removing line 108's check fails R1a; removing line 121's check fails R1b.
- gitleaks --no-git on a copy of this report: no leaks found (see summary).

## Correctness review
- Per-user queue (`writeStates` keyed by user, chain of promises, `latest` counter): sends are serialized in order; `chain` is reset to a non-rejecting promise so one failure does not poison later writes. Sound.
- Generation guard: success only clears dirty, sets migrated and invalidates when it is the newest write for that user and that user is still active. Correct and test-pinned.
- Send-time user check: a write queued for A is rejected with `SupersededByUserChange` when B is active, so it is never sent with B's session; it stays dirty under A's marker and is pushed next time A loads. Correct and test-pinned. `activeUserId` is a module variable set in a layout effect by both hooks (set to undefined on sign-out). Acceptable; ordering is safe because effects run before the next user-triggered action.
- Terminal handling: any 4xx except 401/408/429 drops dirty and adopts server state; 401 stays dirty so the choice survives re-login. Reasonable. `fetchQuery` also updates the query cache, which re-triggers the sync effect (adopt again, harmless).
- Push from the sync effect goes through `writeDensity`, so it shares the queue and generation. Good.

## Findings
1. NON-BLOCKING (R1, test gap, recommended before merge): the terminal-branch user check (`use-density-preference.ts:108`) and the adopt-time user check (`:121`) are unpinned. Add these two hook tests (written and verified in scratch):
   - R1a "a terminal rejection that lands after a user switch touches nothing": use `switchableWrapper("user-a")`, make `mocks.put` return a deferred promise, call `setDensity("compact")`, wait until put is called once, set `current.userId = "user-b"` and `rerender()`, then reject the deferred with `new HttpError(422, "rejected")` inside `act`. Wait about 50 ms. Assert `mocks.get` was not called and `localStorage.getItem("taskdesk:preference-dirty:user-a:density")` is still "1". Fails if line 108's `activeUserId !== userId ||` is removed.
   - R1b "an adopt that resolves after a user switch is not applied": `mocks.get` returns a deferred promise, `mocks.put` rejects once with `HttpError(422)`, user-a calls `setDensity("comfortable")`, wait for `mocks.get` to be called once, switch to user-b and rerender, set the store compactMode to false, then resolve the deferred get with `{ settings: { density: "compact" } }` inside `act`. Wait about 50 ms. Assert the store compactMode is still false. Fails if line 121's check is removed.
   The existing last test fails to pin either because both guards run after the user switch and it mounts no second hook; keep it or delete it, it adds no coverage for those two lines.
2. NON-BLOCKING: the adopt-time check at :121 compares only the user, not the generation. If the same user toggles again while the terminal-branch refetch is in flight, the adopt overwrites that newer toggle in the store (the newer write then lands and the refetch restores it; if the newer write fails transiently, the local choice is lost and the next load pushes the adopted value). Narrow window. Fix: also require `generation === state.latest` at :121; a test is the R1b pattern with a second toggle instead of a user switch.
3. NON-BLOCKING (carry-over, accepted): untagged legacy cache claimed by first sign-in; no change since beedd219.

No blocking findings. All earlier B1-B4 findings are addressed (B1 test titles, B2 write chain and generation guard, B3 optional scopeId on owner helpers, B4 terminal 4xx dropped and adopted; for B4 note finding 2).

## Residual risk
Real browser sign-out/sign-in and network failure not exercised (mocks only). The #688 merged web code, API changes (reviewed by reviewer A), e2e, visual and container checks were not covered here. The mandatory GPT-6 Sol security review is recorded separately by the coordinator; this report does not substitute for it.

## Verdict
APPROVE (non-blocking: add the two R1 tests; consider the generation check in finding 2).
<!-- END REPORT (sha256 d6b3c293e5099d8a4ae01a139b9f512030cb3a6e5ff7d07a46f269b69bd76457) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-8bf6-security-rebind-opus.md; Claude Opus 5.5; sha256 cc1bdca13e309581c7338577f1ad3ddaaa9b8eb36efcc9915ec7edc4daf2825c) -->
# PR #719 light security rebind (sampled big reviewer, Opus 5.5)

- **Model / context:** Claude Opus 5.5 (`claude-opus-5-5`). This is the same reviewer context as
  the CLEARs at 569aea44 and 49298316. I did not author, direct or remediate the fix commits. I
  made no edits, pushes, comments or merges on the branch.
- **Reviewed head:** 8bf67c9cf1349cda549ae3f8ecfe598d5ec6b306
- **Previous reviewed head:** 49298316eea9f330cf086c5a1b0e1b664b6acdcb (CLEAR,
  `719-4929-security-rebind-opus.md`)
- **Merge base:** 9a8e84cf68fc802bac84e68bcc3051e65172b5ba.
- **Remote state:** `git ls-remote` (HTTPS) at the start and at the end showed
  `refs/heads/main` = 9a8e84cf… and `refs/pull/719/head` =
  `refs/heads/codex/user-preference-routes` = 8bf67c9c….
- **Scratch worktree:** `/Users/heinthura/.codex/worktrees/review-719-8bf6`, detached at the
  head. I installed and built it, confirmed it was clean after the mutations, then removed it.
  No Docker was used, because the delta is web and docs only.

## Delta 49298316..8bf67c9c

Two commits, each with a single parent and no merge:

- `f8c46c11` fix(web): reject stale adopts by generation and pin the user-switch guards
- `8bf67c9c` docs(settings): state the project id alphabet in ST-16

`git diff --numstat` lists exactly three files:

- `apps/web/src/hooks/use-density-preference.ts`, +3/-2. The adopt-time check (line 122) became
  `if (activeUserId !== userId || generation !== state.latest) return;`, and its comment was
  updated. Nothing else changed in the file.
- `apps/web/src/hooks/use-density-preference.test.tsx`, +81/-0, additions only. It adds three
  tests:
  - R1a: "a terminal rejection that lands after a user switch touches nothing";
  - R1b: "an adopt that resolves after a user switch is not applied";
  - "an adopt from an older rejection does not overwrite the same user's newer toggle".
- `docs/03-features/settings-hierarchy.md`, +3/-1. ST-16 now says a project id must match
  `[A-Za-z0-9_-]{1,128}`, and that any other id, including NUL or control characters, is `422`
  on both set and clear. This matches `whitelist.ts` at this head and the probes in the 49298316
  rebind.

No API, policy, registry, matrix, OpenAPI, schema or integration-test file changed. The API
behaviour reviewed at 49298316 therefore still applies unchanged.

## Tests and mutation checks

The web hook, sync library and preferences-page tests pass: **3 files, 23 tests**. The hook file
has 15 tests, including the three new ones.

I mutated each guard on its own in the scratch copy, ran the hook test file, and restored the
copy after each run.

| Mutation | Result |
| --- | --- |
| M1: remove `activeUserId !== userId` from the terminal-branch entry check (line 108) | 1 failed / 14 passed: **R1a** fails |
| M2: remove `activeUserId !== userId` from the adopt-time check (line 122) | 1 failed / 14 passed: **R1b** fails |
| M3: remove `generation !== state.latest` from the adopt-time check (line 122) | 1 failed / 14 passed: "an adopt from an older rejection does not overwrite the same user's newer toggle" fails |

Each guard is now pinned by its own test, which closes R1 from the 49298316 report. The new
generation check is correct. Without it, a refetch started by an older terminal rejection could
overwrite the same user's newer local toggle. That is a stale-data issue within one user, not a
security issue, and the check closes it.

## Findings

No blocking findings. No new findings.

- R1 (test coverage) is closed.
- R3 (spec drift on the project-id alphabet) is closed.
- R2 is unchanged and non-blocking. The send-time check depends on React's view of the user. A
  cookie switched from another tab while a request is slow could still be used by a queued send.
  The impact is one cosmetic density bit.
- N2 and N4 from the first report are unchanged and non-blocking:
  - N2: a key can read layout ids through GET.
  - N4: a non-JSON content type gets 422, not 415.

## Residual risk / not checked

- This was a light rebind. I did not re-run the API integration suites, `test:permissions`,
  `check:openapi` or `check:route-policy`, because no file they cover changed since 49298316.
  At 49298316 they gave 38, 88, 283 operations and pass respectively.
- I did not drive the web client in a real browser, run an image build or run deployment checks.

## Verdict

**CLEAR** for 8bf67c9cf1349cda549ae3f8ecfe598d5ec6b306. This sampled Opus 5.5 review does not
replace the required GPT-6 Sol security review at this head.
<!-- END REPORT (sha256 cc1bdca13e309581c7338577f1ad3ddaaa9b8eb36efcc9915ec7edc4daf2825c) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-8bf6-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 379f33f0e63117581efdf08d1019ac5ad200dab2544984c42627bd927af56f69) -->
# PR #719 delta ordinary review B (49298316 -> 8bf67c9c)

- Model/context: Claude Sonnet 5.5, fresh independent reviewer B (did not author or direct the change)
- **Reviewed head:** 8bf67c9cf1349cda549ae3f8ecfe598d5ec6b306
- Previous approval head: 49298316eea9f330cf086c5a1b0e1b664b6acdcb
- Scratch worktree /Users/heinthura/.codex/worktrees/review-719-b3 (removed afterwards; mutations reverted). No Docker containers created.

## Delta examined
apps/web/src/hooks/use-density-preference.ts (+3/-2), its test file (+81), docs/03-features/settings-hierarchy.md ST-16 wording.

## Checks
- R1a and R1b tests match the recipes: R1a defers the put, switches to user-b, then rejects with HttpError(422), asserting `get` not called and user-a dirty still "1"; R1b defers the get, switches user, sets the store to false, resolves with compact, asserts the store stays false. Both are non-vacuous.
- New test "an adopt from an older rejection does not overwrite the same user's newer toggle": first put rejects 422, get deferred, same user toggles again (second put never resolves), get resolves with the older value, store must stay compact. Matches the finding 2 pattern.
- Generation check at the adopt step (`activeUserId !== userId || generation !== state.latest`) is correct. A newer toggle bumps `latest`, so a stale adopt is skipped; the newer toggle's own marker is untouched (dirty is cleared at the terminal branch before the await, and the newer toggle sets it afterwards or the earlier return at the first generation check applies). In the skipped case `migrated` is not set, which is harmless.
- ST-16 wording: states `[A-Za-z0-9_-]{1,128}` and 422 on set and clear; consistent with the earlier N1 change.

## Commands and results
- Hook test file plus sync unit test: 22/22 PASS.
- Mutation: generation clause removed at the adopt step: the new "newer toggle" test FAILS (1). User clause removed at the adopt step: R1b FAILS (1). Both reverted.
- Full web vitest: 162 files / 779 tests PASS. web typecheck PASS (after building workspace libs).
- gitleaks --no-git on a copy of this report: no leaks found.

## Findings
None blocking. None new.

## Residual risk
Mocks only, no real browser sign-in sequence. Security rebind and API-side delta are covered elsewhere; this report does not substitute for the Sol review.

## Verdict
APPROVE
<!-- END REPORT (sha256 379f33f0e63117581efdf08d1019ac5ad200dab2544984c42627bd927af56f69) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-65ff-security-rebind-opus.md; Claude Opus 5.5; sha256 be54809a3804c3ec08c510df50e632e6148c8e8cb7b0e79c50e18b7fbfb84695) -->
# PR #719 security rebind (sampled big reviewer, Opus 5.5)

- **Model / context:** Claude Opus 5.5 (`claude-opus-5-5`), the same reviewer context as the
  CLEARs at 569aea44, 49298316 and 8bf67c9c. I did not author, direct or remediate the new
  commits. I made no edits, pushes, comments or merges on the branch.
- **Reviewed head:** 65ffd4675f711fab39e3ed334cf1b82758d18858
- **Previous reviewed head:** 8bf67c9cf1349cda549ae3f8ecfe598d5ec6b306 (CLEAR)
- **Merge base:** 66565b2c2eade2378b5a1d1fd518054b2e298238, the new origin/main (#710 merge).
  The head is a merge with parents d7b4c019 and 66565b2c.
- **Remote state:** `git ls-remote` (HTTPS), checked at the start and at the end:
  - `refs/heads/main` = 66565b2c… Main moved from 9a8e84cf as expected; it is the merge's
    second parent.
  - `refs/pull/719/head` = `refs/heads/codex/user-preference-routes` = 65ffd467….
- **Scratch worktree:** `/Users/heinthura/.codex/worktrees/review-719-65ff`, detached at the
  head. I installed and built it, confirmed it was clean after the mutations, and then removed it.

## Commits since 8bf67c9c

1. `bb1f21d3` (review note only). It adds one file,
   `docs/07-planning/security-reviews/719-profile-settings-routes.md` (+705). There are no code
   changes.
2. `d7b4c019`, the fix. It touches four code and test files:
   - `fetchers/user-settings/user-settings.ts` (+21/-1);
   - `fetchers/user-settings/user-settings.test.ts` (new, 38 lines);
   - `hooks/use-density-preference.ts`, where the reconcile body is wrapped in `try/catch` and
     re-indented;
   - `components/providers/user-preferences-sync.test.tsx` (new, 74 lines).

   `8bf67c9c..d7b4c019` changes 5 files: these four plus the bb1f21d3 note.
3. `65ffd467`, the merge of origin/main 66565b2c, which brings in #710.

## Merge integrity

`git merge-tree --write-tree d7b4c019 66565b2c` gives tree `0f33f84c507643a562ce2562194001ef9ca78a5e`.
That is identical to `65ffd467^{tree}`. The merge is clean and adds no conductor edits.

## The fix fails closed

**The fetcher.** `getUserSettings` (`user-settings.ts`, `parseUserSettings`) accepts only a body
whose `settings` is a non-null, non-array object. Anything else throws `HttpError(502)`: `[]`,
`{}`, `null`, `{settings: []}`, `{settings: "x"}`, or HTML that fails to parse.

- **The query errors.** `data` stays undefined, so the reconcile effect returns at its
  `!data` guard before reading or writing anything.
- **No redirect.** A 502 is not 401, so `handleUnauthorized` never fires.
- **Prototype keys do nothing.** A JSON `__proto__` key inside `settings` becomes an own
  property, not the prototype, so it cannot supply `density`.
- **Bad values are rejected.** `parseDensity` still accepts only `comfortable` or `compact`.
- **Same-user writes only.** A well-formed `{settings:{}}` from a stub can at most trigger the
  existing one-time migration. That writes this user's own local value under this user's own
  session.

**The `try/catch`** (`use-density-preference.ts`, reconcile effect) wraps only the synchronous
reconcile. All the security-relevant user and generation checks live in `writeDensity`'s promise
callbacks:

- the send-time `activeUserId` check;
- the success, terminal and adopt checks.

Those callbacks run asynchronously, outside the try, and handle their own rejections, so the
catch cannot reach or swallow them. The only side effect that can happen before a throw is the
existing foreign-cache reset to the default. That reset leaves the user in the safer state.

**Tests and mutations** (scratch copy, restored each time):

- The new provider test covers 404, 401, network error, `[]`, `{}`, `null` and a hang. For each
  case it asserts that the app still renders, `compactMode` is unchanged, and no PATCH is sent.
- Removing the `try/catch` makes the `[]` and `{}` cases fail (2 of 7). The `null` case is
  covered by the `!data` guard.
- Returning the raw body from the fetcher makes 5 of the 7 fetcher tests fail.
- The user and generation guards in `writeDensity` are byte-identical to 8bf67c9c. The same hook
  tests that pinned them there pass here.

## #710 and #719 coexist

- `index.ts` mounts `capabilities` at `/capabilities` (line 1492) and `userPreference` at `/me`
  (line 1512), and both are in the route union.
- Each route has its own policy file: `capabilities/policy.ts` declares
  `GET /api/capabilities`, and `user-preference/policy.ts` declares GET and PATCH
  `/api/me/settings`.
- The matrix fixture has all three route keys.
- OpenAPI lists `/capabilities` [get] and `/me/settings` [get, patch].

## Runs at this head

| Run | Result |
| --- | --- |
| `pnpm check:openapi` | passed, **284 operations** |
| `pnpm check:route-policy` | passed |
| `pnpm test:permissions` | 14 files / 88 tests passed |
| `CI=true` integration (one at a time): user-preference, capabilities-scope, strict-runtime-enforcement, api-key-self-mutations | 4 files / 60 tests passed |
| Web sync set: density hook, sync lib, fetcher, provider, preferences page | 5 files / 37 tests passed |
| Full web vitest (`apps/web`) | **164 files / 793 tests passed** |
| Mutations (try/catch, fetcher validation) | caught as above |

I did not re-run the e2e or G8 visual harnesses. The implementer reports `approval-withdrawal`
3/3 locally and visual screens rendering up to the Linux-baseline comparison. Hosted CI at this
head is the authority for those.

**Docker.** I snapshotted the running container IDs before the integration run and compared
them after. No new container remained. Testcontainers stopped its own, and I removed nothing by
hand.

## Findings

No blocking findings. No new findings.

- R2, N2 and N4 from the earlier reports are unchanged and remain non-blocking:
  - R2: a cookie switch made from another tab can race a queued send.
  - N2: an API key can read layout ids through GET.
  - N4: a non-JSON content type gets 422, not 415.

## Residual risk / not checked

- I did not run the e2e, visual, image-build or deployment checks.
- The review note added in bb1f21d3 was not reviewed for content. It is documentation only.

## Verdict

**CLEAR** for 65ffd4675f711fab39e3ed334cf1b82758d18858. This sampled Opus 5.5 review does not
replace the required GPT-6 Sol security review at this head.
<!-- END REPORT (sha256 be54809a3804c3ec08c510df50e632e6148c8e8cb7b0e79c50e18b7fbfb84695) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/719-65ff-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 2a77b093e6d193efbfeac268231fea67ee70d828cbeafab960c33a50220eab32) -->
# PR #719 delta ordinary review B (8bf67c9c -> 65ffd467), web

- Model/context: Claude Sonnet 5.5, fresh independent reviewer B (did not author or direct the change)
- **Reviewed head:** 65ffd4675f711fab39e3ed334cf1b82758d18858
- Previous approval head: 8bf67c9cf1349cda549ae3f8ecfe598d5ec6b306
- Scratch worktree /Users/heinthura/.codex/worktrees/review-719-b4 (removed afterwards; all mutations reverted, git status clean). No Docker containers created (e2e used the mocked Playwright spec, no Testcontainers).

## Delta examined
d7b4c019: fetchers/user-settings/user-settings.ts (new parseUserSettings), hooks/use-density-preference.ts (reconcile effect wrapped in try/catch), new tests user-settings.test.ts and providers/user-preferences-sync.test.tsx. bb1f21d3 is a review note only. 65ffd467 is the main merge (#710), not reviewed beyond the suites passing.

## Is the fix correct and minimal?
Yes. Root cause: a catch-all stub returned `[]` with a 200, the fetcher cast it to `UserSettings`, and the effect read `data.settings[...]` from `undefined`, throwing in an effect and reaching the error boundary. The fetcher now accepts only `{settings: <non-null, non-array object>}` and throws HttpError 502 otherwise, so the query errors, `data` stays undefined, and the cached value keeps serving. The same validated fetcher feeds the terminal-rejection `fetchQuery` path in `writeDensity`, so `fresh.settings` is safe there too. `patchUserSettings` is unvalidated but its result is unused. The effect's try/catch is defence in depth and the diff is mostly re-indentation.

## Does the try/catch hide real bugs?
Mild risk, non-blocking. It swallows everything silently, including genuine programming errors (a bad store call, a typo in the reconcile logic), which would then show up only as "density not syncing". With the fetcher validation in place the catch should be unreachable for bad responses. Recommend logging in the catch (a dev-only `console.warn` or the app's existing reporting hook) so an unexpected throw is visible, and keeping `reconciledFor.current = data` before the try as is (a throwing payload is not retried every render). I found no existing `console.*` usage in non-test web code, so match whatever error reporter the app uses rather than introducing console calls.

## Commands and results
- Full web vitest: 164 files / 793 tests PASS. web typecheck PASS (libs built first). Touched files: 29/29 PASS.
- Mutations (each reverted):
  - M1 try/catch replaced by `finally` (errors propagate): the hook-level "empty array body" and "empty object body" cases FAIL (2) plus an unhandled error. The test is non-vacuous for the catch.
  - M2 fetcher validation bypassed (plain cast): 5 fetcher tests FAIL (empty array, empty object, null, settings array, settings string).
  - M3 `Array.isArray(settings)` check removed: "settings as an array" FAILS (1).
  - M4 both removed: 7 tests FAIL.
- E2E: `VITE_API_URL="" pnpm build` then `playwright test e2e/approval-withdrawal.spec.ts`: 3/3 PASS (requester withdrawal, instance-admin withdrawal, terminal-approval 409). I did not run the other mocked or G8 specs, nor reproduce the original CI failure on the pre-fix commit.
- gitleaks --no-git on a copy of this report: no leaks found.

## Test quality
Non-vacuous as shown above. The hook-level test mocks the fetcher and the fetcher test mocks the client, so the pairing (real fetcher through real hook) is covered only by the e2e spec; acceptable. The "hanging request" and "404/401/network" cases pass trivially (the sync never acts on errors) but pin the no-throw, no-write, cache-kept contract.

## Findings
1. NON-BLOCKING: the silent `catch {}` at the end of the reconcile effect in use-density-preference.ts should report (see above).
2. NON-BLOCKING: no test for a well-formed body whose `density` value is invalid (for example `{settings:{density:"huge"}}`); `parseDensity` already ignores it, so it is a pin only.

No blocking findings.

## Residual risk
Only the approval-withdrawal e2e spec was run; other mocked/G8 harness specs, visual specs and container checks were not. The Sol security rebind (recorded CLEAR) is separate and not substituted by this report.

## Verdict
APPROVE
<!-- END REPORT (sha256 2a77b093e6d193efbfeac268231fea67ee70d828cbeafab960c33a50220eab32) -->
