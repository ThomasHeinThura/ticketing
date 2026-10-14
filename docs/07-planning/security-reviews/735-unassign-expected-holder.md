# PR #735 security review record: unassign expected-holder precondition (#723)

PR #735 fixes #723. `DELETE /api/work-items/{key}/assign` now takes an optional `expectedAssigneeId` query parameter.

A mismatch with the current holder, including an item that is now unassigned, returns 409 with the current `assigneeId` and writes nothing. The check runs after the reach decision (404) and the capability decision (403), and before the conditional write. That write's `WHERE` clause pins the same row that was read.

Assign already accepted `expectedCurrentAssigneeId`. The web detail page now sends the precondition and shows the existing conflict message on a 409.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (correctness, ordering, validation, mutations): APPROVE at `f59b68ca`.
- Ordinary review B by Claude Sonnet 5.5 (API design, other callers, real browser, axe): APPROVE at `f59b68ca`.
- Security review by Claude Opus 5.5: CLEAR at `f59b68ca`. There is no disclosure to callers who can't already see the holder, no oracle, and the ordering is correct. Three mutations were all killed.
- Mechanical security rebind at `722ee8b5`: CLEAR. It is a pure merge of `main` `82aecead` (#732).
- Mechanical security rebind at `410e20e2`: CLEAR. This is a pure merge of `main` `1f1abe7c` (#733) and does not interact with this PR's surface.
- Mechanical security rebind at `882eb1d8`: CLEAR. This is a pure merge of `main` `6015f016` (#738), with no interaction.
- Mechanical security rebind at `64ee15b1`: CLEAR. A pure merge of `main` `a31bdde3` (#730, #739). Assign and unassign, item reach and the 409 precondition are unchanged.

**Reviewed head:** `f59b68ca1e02c69a1c87276965e53a7c84fded64`
**Reviewed head:** `722ee8b59e6a240244a2959612b9323cf932706e`
**Reviewed head:** `410e20e220a9e69412d4c6f77625b461a98cc16d`
**Reviewed head:** `882eb1d8530ab3511d17333ac0a3e8024e5bf6fe`
**Reviewed head:** `64ee15b10e0f892602d9417f5936e8808eb6c634`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `735-ordinary-a-sonnet.md` | Ordinary review A (0cc0ae12..f59b68ca) | Claude Sonnet 5.5 | `f59b68ca` | APPROVE | `f86d5ef0239657b8c000fc1fe7479c64c1262fb3b90ed1eb227e1ce52d3de5c1` |
| 2 | `735-ordinary-b-sonnet.md` | Ordinary review B (0cc0ae12..f59b68ca) | Claude Sonnet 5.5 | `f59b68ca` | APPROVE | `f26d315aea3df20066cb843923430ad4368faa11616407767fe67171f8a75270` |
| 3 | `735-security-opus.md` | Security review (0cc0ae12..f59b68ca) | Claude Opus 5.5 | `f59b68ca` | CLEAR | `12020b6bc53370fbd436d88f3798cdef9800777e7a1dfa717012b5ed83aeb7d6` |
| 4 | `735-722e-security-rebind-opus.md` | Mechanical security rebind (f59b68ca..722ee8b5) | Claude Opus 5.5 | `722ee8b5` | CLEAR | `8332a98ebf3f8837bc8993484a92d9df7daaf366eb0f088ac558fcb4bc9faf8b` |
| 5 | `735-410e-security-rebind-opus.md` | Mechanical security rebind (8b5f1406..410e20e2) | Claude Opus 5.5 | `410e20e2` | CLEAR | `4ba751db0b9f8707e6cc561a871e86f5d646b9029676d0f746c65e7d2957446b` |
| 6 | `735-882e-security-rebind-opus.md` | Mechanical security rebind (3a37b329..882eb1d8) | Claude Opus 5.5 | `882eb1d8` | CLEAR | `e168df093dc5625ecd34cfe9c69f56f503052d302ecb14f6fc39f809398e6291` |
| 7 | `735-64ee-security-rebind-opus.md` | Mechanical security rebind (6d30d432..64ee15b1) | Claude Opus 5.5 | `64ee15b1` | CLEAR | `a9b07c53ec8c7e12740970766ebf5cd1b2a7e25e5fc9e6e627010799523a5687` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 f86d5ef0239657b8c000fc1fe7479c64c1262fb3b90ed1eb227e1ce52d3de5c1) -->
# PR #735 ordinary review A (Claude Sonnet 5.5)

**Reviewed head:** f59b68ca1e02c69a1c87276965e53a7c84fded64
**Base:** 0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b (= current origin/main; `git merge-base` confirmed)
**Model:** Claude Sonnet 5.5 (fresh context; did not author, direct or remediate)
**Method:** scratch worktree at the exact head (removed), private Postgres container `postgres:18-alpine` on 127.0.0.1:55435 db `review735_test` (created by me, removed by exact id 39cd4b510019). SIT postgres untouched. Runs serial.

## Commands (all at the exact head, clean tree)
| Command | Result |
| --- | --- |
| integration: work-item-unassign + work-item-assign | 2 files, 39 tests passed (18 + 21), exit 0 |
| `pnpm test:permissions` | 15 files, 95 tests passed, exit 0 |
| `pnpm check:openapi` | exit 0 |
| `pnpm check:route-policy` | exit 0 |
| `pnpm lint:ci` | exit 0 (208 warnings, 1 info, 0 errors) |
| `pnpm typecheck` | 9/9 tasks, exit 0 |
| web vitest `work-item-journey.test.tsx` | 1 file, 43 tests passed, exit 0 |

## Findings by area
1. Correctness (no blocking). The handler compares `expectedAssigneeId` with `current.assigneeId` (the row it already read) and then passes that same `current.assigneeId` to the controller, whose UPDATE is `WHERE assignee_id = previousAssigneeId` plus liveness clauses. So when a precondition is supplied, the write is conditional on the expected value atomically; no TOCTOU. The 409 return happens before the controller runs: no write, no version bump, no activity, no event (test asserts all four; mutation confirms).
2. Ordering/leaks (no blocking). Reach middleware first (out-of-reach and foreign-workspace admin with the param: 404 "Work item not found", probed), then capability decision (viewer who can read: 403 "Insufficient permissions" even with a bogus expected id, probed), then precondition 409. 409 body (`currentAssigneeId`) is therefore shown only to callers who may clear it or are the holder. Moving the check before the capability decision is caught by the new disclosure test (mutation M3).
3. Spec (non-blocking N1). assignment.md AS-19, its API line and api-design.md (action routes use a conditional update) are consistent, and assign is already an action route exempt from If-Match. But `work-items.md` WI-7 still says rank is "the one exception" to version checking; assign/unassign are not listed there. assignment.md already cited WI-7 for the exemption before this PR, so this is a pre-existing doc gap the PR could have closed.
4. Query validation. Probed: `?expectedAssigneeId=` -> 400; `=null` literal -> 409 (treated as an id; correct, nothing written); `=not-a-uuid` -> 409 nothing written; NUL byte -> 400; duplicated param -> 400. OpenAPI shows `string, minLength 1, optional, in query`, matching the zod schema (NUL refine is not expressed in OpenAPI, same as every other schema here). N2 (non-blocking): a misspelled or wrong-case param name (`expectedassigneeid`) is ignored and the clear proceeds with legacy semantics (probed 200). This is inherent to the optional design and is documented, but API-key/MCP callers get no signal.
5. Web (no blocking). Fetcher sends `{expectedAssigneeId}` when the item has an assignee (button only renders when held; null falls back to `{}`). The existing `handleFailure` 409 path invalidates the detail query and shows `assignmentConflict`; there is no retry and the new test asserts one call, the alert text and the invalidation. Bulk assign: `bulkWorkItems` calls `assignWorkItem(..., null, {assigneeId})` -> `WHERE assignee_id IS NULL`, so it cannot overwrite a holder; the AS-19 justification holds.
6. Tests. See mutations below. Gaps (non-blocking N3): no test for empty-string 400 / invalid-id behaviour (mutation M5 survives), no test for a 404 outsider carrying the parameter (probed manually OK), and the race test is sequential rather than truly concurrent (the pre-existing concurrent/F1 tests cover the controller pin, confirmed by M6).

## Mutations (my own; each reverted)
| # | Mutation | Result |
| --- | --- | --- |
| M1 | disable the expected-holder check in the handler | 4 of the 8 #723 tests fail (killed) |
| M2 | skip the check when the item is now unassigned | 1 fails (killed) |
| M3 | run the check before the capability decision | disclosure test fails (killed) |
| M4 | 409 body returns `currentAssigneeId: null` | 2 fail (killed) |
| M5 | drop `.min(1)` from the query schema | 0 fail (SURVIVED; N3) |
| M6 | remove the controller's `assignee_id =` pin and its stale-holder guard | 2 pre-existing tests fail (killed) |
| M7 | web sends `null` instead of `item.assigneeId` | 2 web tests fail (killed) |
6 of 7 killed.

## Blocking findings
None.
## Non-blocking
N1 WI-7 text not updated; N2 misspelled param is silently legacy; N3 no empty-string/invalid-id/outsider-404 tests (M5 survived).

## Not checked
Full integration suite and the other web test files; the real browser UI/e2e; true multi-connection concurrent interleaving beyond existing tests; MCP tool surface (does an MCP unassign tool expose the param?); docs gates (check:i18n, vocabulary) and CI state; security review (Sol) is separate and out of scope.

**Verdict: APPROVE (ordinary review A clear at f59b68ca1e02c69a1c87276965e53a7c84fded64; no blocking findings, 3 non-blocking).**
<!-- END REPORT (sha256 f86d5ef0239657b8c000fc1fe7479c64c1262fb3b90ed1eb227e1ce52d3de5c1) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 f26d315aea3df20066cb843923430ad4368faa11616407767fe67171f8a75270) -->
# PR #735 ordinary review B (spec alignment, API design, callers, real browser)

**Reviewed head:** f59b68ca1e02c69a1c87276965e53a7c84fded64
**Base:** main 0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b
**Model:** Claude Sonnet 5.5 (fresh context; did not author/direct/remediate; reviewer A's report not read)

## Runs (scratch worktree at exact head, private postgres:18-alpine *_test container removed by exact id; worktree removed)
- api-integration work-item-unassign + work-item-assign: 2 files, 39 tests pass.
- check:openapi: matches (282 operations). check:i18n: all locales in sync.
- lint:ci: first run (clean tree) 0 errors, 208 warnings, 1 info, no fixes. (A later re-run included my throwaway spec and exited 1; that was my unformatted file, now deleted.)
- typecheck (turbo): 9/9 tasks successful.
- full web vitest: 177 files, 958 tests pass.

## Real browser (Chromium via Playwright, mocked backend, own preview port 4391 because 4178 was held by another process; throwaway spec deleted)
Screens: /agent/work-items/HELP-7 detail page. Screenshots: 735-screen-1-before.png, 735-screen-2-success.png, 735-screen-3-409.png (evidence dir).
- Holder matches: DELETE sent once with `?expectedAssigneeId=alice`; Unassign disappears; polite status "Unassigned." announced; focus on the "Assignment" h2.
- Server 409: DELETE sent exactly once (no retry); alert "The assignee changed in the meantime. The latest assignee is shown; try again if you still want to change it." shown; detail refetched once, UI shows new holder Bob; focus on "Assignment" h2; message is role=alert so announced.
- axe (full ruleset): only `landmark-one-main` and `region` (moderate) from the mocked shell/page structure, identical in success and 409 states, not introduced by this PR. 0 serious/critical.

## API design / spec
- Query param on DELETE is reasonable: DELETE has no body (clients/proxies may drop it) and the route is an action route exempt from If-Match (api-design, WI-7). Assign uses `expectedCurrentAssigneeId` in the body because it is a POST. Different location, same semantics and same 409 body shape (`currentAssigneeId`). Documented in api-design.md, assignment.md (AS-19 + route table) and the OpenAPI description. OpenAPI parameter correct (optional, minLength 1).
- Validation correct: NUL-byte refine, empty string rejected. Check ordering (after capability, before write, controller CAS still behind it) matches the disclosure model; test asserts a member gets 403, not 409.
- Backward compatible: optional param, legacy behaviour unchanged.

## Other callers
- packages/mcp and apps/api: no unassign tool exists (mcp-server.md lists only `assign_work_item` -> POST). Nothing to update. Web detail page is the only first-party caller and sends the holder. Portal: none. Bulk: assign only; bulk unassign is a later slice. No consumer doc enumerates DELETE assign beyond assignment.md/api-design.md/openapi, all updated.

## Findings
1. NON-BLOCKING: WI-7 (docs/03-features/work-items.md L71-74) says rank is "the one exception" and "every other field write is version-checked". assign/unassign already deviated (CAS on assignee, not If-Match) before this PR, and AS-19/api-design now document it. A one-line cross-reference in WI-7 would remove the apparent contradiction. Follow-up docs, not a gate.
2. NON-BLOCKING: param naming differs (`expectedCurrentAssigneeId` body vs `expectedAssigneeId` query). Acceptable and documented.
3. NON-BLOCKING: a stale screen showing "unassigned" sends no param, but then Unassign is not rendered (canUnassign needs assigneeId), so no gap.

No blocking findings.

## Verdict
APPROVE (ordinary review B): no blocking findings at f59b68ca1e02c69a1c87276965e53a7c84fded64.
Not checked: Sol security review; a real (non-mocked) backend through the browser.
<!-- END REPORT (sha256 f26d315aea3df20066cb843923430ad4368faa11616407767fe67171f8a75270) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-security-opus.md; Claude Opus 5.5; sha256 12020b6bc53370fbd436d88f3798cdef9800777e7a1dfa717012b5ed83aeb7d6) -->
# PR #735 security review: unassign expected-holder precondition (#723)

**Reviewed head:** f59b68ca1e02c69a1c87276965e53a7c84fded64
**Base:** main 0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b (merge base = base; one commit on the branch)
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context. It did not author, direct or remediate this change.
**Role:** independent security reviewer, as the orchestrator requested.
**Date:** 2026-10-14

**Head check:** `gh pr view 735 --json headRefOid` returned `f59b68ca…` (state OPEN, MERGEABLE). The review used a detached scratch worktree at that SHA. It was removed afterwards. The main checkout was not touched.

## Surfaces examined

- `apps/api/src/work-item/index.ts`: the unassign route definition and handler, in full, including the new precondition block. I compared the handler with the assign handler.
- `apps/api/src/work-item/schema.ts`: `unassignWorkItemQuery`.
- `apps/api/src/work-item/controllers/unassign-work-item.ts`: the pinned conditional `UPDATE` (unchanged).
- `apps/api/src/work-item/controllers/assign-work-item.ts`: the existing 409 disclosure path, read for comparison.
- `apps/api/src/work-item/require-work-item-reach.ts`:
  - the reach decision (404);
  - the `deferApiKeyCapability` branch;
  - the customer 403.
- `apps/api/src/utils/require-workspace-capability.ts`: `assertCallerHasCapabilityOrSelf`, including the API-key scope intersection.
- `apps/api/src/utils/require-api-key-permission-scope.ts`: scope matching.
- `apps/api/src/work-item/policy.ts`: the `DELETE /api/work-items/{key}/assign` entry. It is unchanged by this PR.
- Web changes:
  - `apps/web/src/fetchers/work-item/unassign-work-item.ts`;
  - `apps/web/src/components/work-item/work-item-journey.tsx` and its test.
- Docs and contract:
  - `docs/03-features/assignment.md` (AS-19);
  - `docs/01-architecture/api-design.md`;
  - `tests/api-contract/openapi.json`.
- `tests/api-integration/work-item-unassign.test.ts`: the 7 new tests.

## Commands and results

Postgres: a private container (`postgres:18-alpine`, database `opus735_test`, 127.0.0.1:32768), ID `a36a6b98c4c7`. I removed it by that exact ID at the end. No other container was touched.

| Command | Result |
| --- | --- |
| `vitest --config vitest.integration.config.ts work-item-unassign.test.ts work-item-assign.test.ts` | 2 files, **39/39 pass** (unassign 18, assign 21) |
| Scratch probe file (uncommitted, deleted afterwards): 12 security probes, listed below | **12/12 pass** |
| `pnpm --filter @taskdesk/api test:permissions`, run 1 | 4 files failed with 25 skipped. This was a cold first run straight after `pnpm install`, with the scratch probe file present. |
| `test:permissions`, runs 2 and 3 (run 3 with the probe file removed) | **15/15 files, 95/95 tests pass**, exit 0. Treated as a cold-start flake: the same tree passed twice. |
| `pnpm check:route-policy` | exit 0 |
| `pnpm check:policy` | exit 0 ("8 policy file(s) coherent") |
| `pnpm check:openapi` | exit 0 ("openapi.json matches the API (282 operations)") |
| `tsc --noEmit -p apps/api` | exit 0 |
| `apps/web vitest work-item-journey.test.tsx` | 43/43 pass |
| `gitleaks 8.30.1 git --log-opts=0cc0ae12..f59b68ca --redact` | 1 commit scanned, **no leaks found**. `.gitleaksignore` is unchanged. |

### Mutations

Each mutation was run against `work-item-unassign.test.ts` plus the probe file (30 tests) and then reverted with `git checkout`.

| Mutation | Committed tests failed | Probes failed |
| --- | --- | --- |
| M1: delete the precondition block | 4 (mismatch 409, now-unassigned 409, stale race, API key) | 2 |
| M2: move the precondition **before** `assertCallerHasCapabilityOrSelf` | 1 ("does not disclose the holder to a caller who may not clear it") | 4 (member, guest, read-only key, update-only key) |
| M3: treat a now-unassigned row as a match (`current.assigneeId !== null &&`) | 1 ("now unassigned is 409, not a silent no-op") | 0 |

All three mutations are caught by the committed suite, not only by my probes.

### Probe results

The item was held by person A in every probe.

- **P1, out-of-workspace admin session:** 404 with no parameter, with `expectedAssigneeId=B` and with `expectedAssigneeId=A`. The body never contains A's id or `currentAssigneeId`. The row was unchanged.
- **P1b, nonexistent key with the parameter:** 404.
- **P1c, workspace member whose project grant is on another project:** 404 "Work item not found". No leak.
- **P2, in-reach `viewer`, `customer`, `member` and `guest`, with a mismatched parameter:** 403 "Insufficient permissions" for both values. Never 409 or 200, no leak, row unchanged.
  - Viewer and customer are stopped in the reach middleware.
  - Member and guest reach the handler and are stopped by the capability check. That handler-level ordering is what M2 tests.
- **P3, API key `{project:[read], work_item:[read]}`:** 403, no leak.
- **P3b, API key `{project:[read], work_item:[read, update]}` held by someone who is not the holder:** 403, no leak.
- **P3c, API key `{work_item:[assign]}` with no read scope:**
  - `GET /work-items/{key}` returns 403;
  - `DELETE ?expectedAssigneeId=B` returns 409 with `currentAssigneeId=A`;
  - on the base code, `POST /assign {assigneeId:B}` already returns the identical 409 with `currentAssigneeId=A`, with nothing written.
  - See finding N1.
- **P4, input handling.** The row was unchanged in every case and there was never a 500.

  | Input | Result |
  | --- | --- |
  | empty `?expectedAssigneeId=` | 400 (min length) |
  | `%00` | 400 (NUL refine) |
  | `<A>%00` | 400 (NUL refine) |
  | duplicate key, same value | 400 ("expected string, received array") |
  | duplicate key, different values | 400 ("expected string, received array") |
  | 8000-character value | 409 (compared in JavaScript only, never reaches SQL) |
  | upper-cased A | 409 (exact match) |
  | space-padded A | 409 (exact match) |
  | literal `null` | 409 (exact match) |

- **P5, update-only member who is the holder (self-branch):**
  - a mismatched parameter returns 409 naming themselves;
  - a matching parameter returns 200.

## Answers to the security questions

### 1. Information disclosure

The 409 is returned only after both gates pass:

- the reach middleware (404 for out-of-workspace, out-of-project and nonexistent keys; 403 for customers);
- `assertCallerHasCapabilityOrSelf`, which intersects the role with the API-key scope.

So the only callers who can see `currentAssigneeId` are:

- holders of `work_item:assign`, with both role and key scope; or
- the current holder acting under `work_item:update`, who learns only their own id.

Results by caller type:

- **Out-of-reach callers:** 404, verified in P1 and P1c.
- **Read-only callers (viewer, member, guest):** 403 before the precondition is evaluated (P2). M2 shows the committed test enforces this ordering.
- **Customers:** 403 in the middleware (P2).
- **Limited API keys:** keys without `assign` get 403 (P3, P3b). A key with `assign` but no `read` does see the holder (P3c). That disclosure already exists on base through `POST /assign`, so this is not a new exposure (N1).

### 2. Oracle

There is no oracle beyond what the caller already gets directly:

- The comparison is exact string equality (`!==`). There is no prefix or range comparison, so a binary search has nothing to work with.
- The parameter never reaches SQL, so there is no timing or error side channel.
- Every caller who can get past the 403 already receives the holder id in the 409 body. Nothing is left to probe for.
- Callers who cannot get past the 403 receive a constant 403 or 404 whatever value they send (P2, P3).

### 3. Ordering and TOCTOU

The order is reach (middleware) → capability (handler) → precondition → controller conditional write. This is correct:

- The precondition compares against `current.assigneeId`. That is the same value the capability decision used, and the same value passed as the controller's pin.
- The controller's `UPDATE … WHERE assignee_id = :pin` (plus the delete, archive and project-freeze clauses) closes the window after the check. A change to another holder in that window becomes the controller's 409.
- One edge case: if the row is cleared by someone else in that window, the controller's pre-read sees `null` and returns a 200 no-op. The caller's intent (A no longer holds it) is still true and nothing is written, so this is not a security issue (N3).
- There is no TOCTOU that lets a stale caller clear a new holder. The committed race test and M1 confirm this.

### 4. Input handling and OpenAPI

- Zod rejects empty values (`min(1)`) and NUL bytes (shared refine). Duplicate keys arrive as an array and are rejected with 400.
- Long strings are harmless: they are only compared in JavaScript and are bounded by the server's URL limit.
- An unknown spelling such as `expectedAssigneeId[]` is stripped as an unknown key. The request then falls back to the legacy unconditional clear (N2).
- The OpenAPI contract declares the optional query parameter `string, minLength 1`, and `check:openapi` passes.
- The NUL rule is not expressible in the published schema. That matches the convention for other NUL-refined fields.

### 5. Coverage gates

- `policy.ts`, the permission matrix and `packages/permissions` are unchanged by the diff. The route keeps its `work_item:assign` / `orOwner(row.assignee_id, work_item:update)` entry with `reach: "required"`.
- `check:route-policy`, `check:policy` and `test:permissions` all pass. This includes `route-coverage.test.ts` and `work-item-reach-guard.test.ts`.

### 6. Tests

All required tests ran; results are in the tables above. All three mutations were caught by committed tests.

## Findings

No blocking findings.

- **N1 (non-blocking, already present on base): non-destructive holder disclosure to assign-scoped, read-less API keys.**
  - A key scoped `{work_item:[assign]}` without `read` can learn the current holder from `DELETE ?expectedAssigneeId=<anything>`.
  - The same key can already learn it on base from `POST /assign` with any eligible assignee: the result is a 409 with `currentAssigneeId` and nothing is written.
  - It can also learn it from the 200 body's `previousAssigneeId` on an unconditional DELETE.
  - This PR adds no new class of disclosure.
  - If assign-without-read key scopes should not see holder ids, that is a separate policy question about the shared `WorkItemAssigneeConflictError` response for both routes. It is not a defect in this PR.
- **N2 (non-blocking, robustness): a misspelled or bracketed parameter is silently ignored.**
  - `?expectedAssigneeId[]=X` (or any typo) is stripped as an unknown key, so the request runs as the legacy unconditional clear.
  - The caller is still authorised for that clear, so there is no privilege effect.
  - It does mean a client bug fails toward the old race-prone behaviour.
  - The web fetcher builds the parameter with the typed Hono client, so the shipped UI is not affected.
  - Optional follow-up: reject unknown query keys on this route (`.strict()`).
- **N3 (non-blocking, semantics): a concurrent clear after the precondition check gives 200, not 409.**
  - The window is between the precondition check and the controller's pre-read. A precondition naming A then gets a 200 no-op instead of a 409.
  - Nothing is written, and the outcome (A no longer holds the item) matches the caller's intent.
  - It is not a security issue. It is noted only because AS-19's doc text says "including nobody → 409". That is true for the handler's read, but not for this narrow race.
- **N4 (informational): the first `test:permissions` run failed on a cold start.**
  - 4 files failed with 25 tests skipped, straight after `pnpm install`.
  - Two later runs on the same tree were 95/95 green.
  - The flake is not attributable to this diff, which touches no permissions code. It is recorded for completeness.

## Residual risk / not checked

- I did not build or boot the container image. The change is application code only, with no dependency, migration or config change.
- I did not run the full integration suite. Only the assign and unassign files plus my probes ran.
- The real-browser 409 flow was not exercised. I relied on the web unit test (43/43) and the implementer's screenshots.
- MCP callers go through the same route and gates. I did not test MCP separately.

**Verdict:** CLEAR
<!-- END REPORT (sha256 12020b6bc53370fbd436d88f3798cdef9800777e7a1dfa717012b5ed83aeb7d6) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-722e-security-rebind-opus.md; Claude Opus 5.5; sha256 8332a98ebf3f8837bc8993484a92d9df7daaf366eb0f088ac558fcb4bc9faf8b) -->
# PR #735 security review: exact-head rebind after merging main (#732)

**Reviewed head:** 722ee8b59e6a240244a2959612b9323cf932706e
**Previously cleared head:** f59b68ca1e02c69a1c87276965e53a7c84fded64 (`735-security-opus.md`, Verdict CLEAR)
**Merged main:** 82aecead4c32861c3b2321af4abf7fcd1dc14731 (#732, the workspace-delete role-dependents helper)
**Original base:** 0cc0ae12a8ad2fc46df539fcc29fe5199a5acb7b
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is the same independent context that cleared f59b68ca. It did not author, direct or remediate the change.
**Scope:** a mechanical rebind. No tests were run, as the coordinator instructed.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 735` head | `722ee8b5…`: matches |
| `origin/main` | `82aecead…`: main is unchanged |
| Parents of 722ee8b5 | `f59b68ca…` and `82aecead…`: matches |
| Tree of 722ee8b5 compared with `git merge-tree --write-tree f59b68ca 82aecead` | both `1b7e62d018f204cd452d3b782262084cc008d527`. The merge is clean and adds no hand edits. |
| `diff --name-only f59b68ca..722ee8b5` compared with `diff --name-only 0cc0ae12..82aecead` | identical 6 files (below) |
| PR patch `0cc0ae12..f59b68ca` compared with `82aecead..722ee8b5` (index lines ignored) | byte-identical. The same 9 files and the same content as the cleared review. |

The six files that came in from main:

- `apps/api/src/user/controllers/delete-account-data.ts`
- `apps/api/src/workspace/controllers/delete-workspace-role-dependents.ts`
- `apps/api/src/workspace/controllers/delete-workspace.ts`
- `docs/01-architecture/data-model.md`
- `docs/07-planning/security-reviews/732-workspace-delete-role-dependents.md`
- `tests/api-integration/workspace-delete-role-dependents.test.ts`

## Overlap and interaction

There is no overlap between the two file sets.

On main's side (`0cc0ae12..82aecead`), I grepped the `apps/` diff for:

- `assign`, `work_item` or `workItem`;
- `require-work-item-reach` and `require-workspace-capability`;
- `apiKey`;
- `openapi`.

It had no changed lines on any of them.

The new `deleteWorkspaceRoleDependents` helper is imported only by `delete-workspace.ts` and `delete-account-data.ts`. It runs only on workspace or account deletion. It does not touch:

- the unassign or assign route or controllers;
- the reach middleware;
- the capability or API-key gates;
- the query schema;
- the OpenAPI contract.

The f59b68ca findings therefore carry over unchanged:

- no blocking findings;
- N1–N4 remain non-blocking or informational.

**Verdict:** CLEAR
<!-- END REPORT (sha256 8332a98ebf3f8837bc8993484a92d9df7daaf366eb0f088ac558fcb4bc9faf8b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-410e-security-rebind-opus.md; Claude Opus 5.5; sha256 4ba751db0b9f8707e6cc561a871e86f5d646b9029676d0f746c65e7d2957446b) -->
# PR #735 security review: exact-head rebind after merging main (#733)

**Reviewed head:** 410e20e220a9e69412d4c6f77625b461a98cc16d
**Prior CLEAR heads:**
- 722ee8b59e6a240244a2959612b9323cf932706e (`735-722e-security-rebind-opus.md`);
- f59b68ca1e02c69a1c87276965e53a7c84fded64 (`735-security-opus.md`).

**Pre-merge head:** 8b5f1406fc4a64b8e53e0b7604644270d7cafde1
**Merged main:** 1f1abe7ca145d9a9749c869d4a4b94f4eb4d2537 (#733, owner/admin `sees_all`)
**Previous main:** 82aecead4c32861c3b2321af4abf7fcd1dc14731
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is the same independent context that cleared f59b68ca and 722ee8b5. It did not author, direct or remediate the change.
**Scope:** a mechanical rebind. No tests were run, as the coordinator instructed.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 735` head | `410e20e2…`: matches |
| `origin/main` | `1f1abe7c…`: main is unchanged |
| Parents of 410e20e2 | `8b5f1406…` and `1f1abe7c…`: matches |
| Tree compared with `git merge-tree --write-tree 8b5f1406 1f1abe7c` | both `ff38b0dab4e2775f322922bfe4d8e15fbe58b37d`. The merge is clean and adds no hand edits. |
| `diff --name-only 8b5f1406..410e20e2` compared with `diff --name-only 82aecead..1f1abe7c` | identical, 21 files |
| 8b5f1406 already contains 82aecead | yes |
| Commits after the prior CLEAR (`722ee8b5..8b5f1406`) | exactly one, `8b5f1406 docs(security-reviews): record #735 review chain`. Its parent is 722ee8b5 and it adds one file, `docs/07-planning/security-reviews/735-unassign-expected-holder.md`, with 373 insertions. It is documentation only. |

## Interaction with #735's surface

I grepped the #733 `apps/` diff, excluding the generated drizzle `meta` snapshot, for:

- `assign` and `work_item`;
- `requireWorkItemReach`, `projectReadDecision` and `has-project-reach`;
- `require-workspace-capability`;
- `apiKey`.

No changed line matched.

#733 adds `workspace-admin-reach.ts`. That file is used by:

- the workspace member, invitation, ownership and account-deletion controllers;
- one boot-reconcile call in `index.ts`.

Migration 0123 also backfills `sees_all` grants for owners and admins. This changes reach **data** for owners and admins, but not the reach or capability **code** that the unassign route runs.

Those callers already hold `work_item:assign` and `work_item:read` in their workspace. #735's 409 is still evaluated only after the reach and capability decisions. It therefore discloses the holder only to principals who can already read the item, so #733 does not change #735's analysis.

No assign or unassign file, schema, OpenAPI entry or web file is in the #733 delta.

The f59b68ca findings carry over unchanged:

- no blocking findings;
- N1–N4 remain non-blocking or informational.

**Verdict:** CLEAR
<!-- END REPORT (sha256 4ba751db0b9f8707e6cc561a871e86f5d646b9029676d0f746c65e7d2957446b) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-882e-security-rebind-opus.md; Claude Opus 5.5; sha256 e168df093dc5625ecd34cfe9c69f56f503052d302ecb14f6fc39f809398e6291) -->
# PR #735 security review: exact-head rebind after merging main (#738)

**Reviewed head:** 882eb1d8530ab3511d17333ac0a3e8024e5bf6fe
**Prior CLEAR head:** 410e20e220a9e69412d4c6f77625b461a98cc16d (`735-410e-security-rebind-opus.md`; the substantive review is `735-security-opus.md` at f59b68ca)
**Pre-merge head:** 3a37b329b5b65b5edd99360b5219a9a221334f22
**Merged main:** 6015f0163f150dcb7f09e485ad0985a8d890db94 (#738, service-calendar delete request-time recheck)
**Previous main:** 1f1abe7ca145d9a9749c869d4a4b94f4eb4d2537
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is the same independent context as the prior #735 security reviews. It did not author, direct or remediate the change.
**Scope:** a mechanical rebind. No tests were run, as the coordinator instructed.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 735` head | `882eb1d8…`: matches |
| `origin/main` | `6015f016…`: main is unchanged |
| Parents of 882eb1d8 | `3a37b329…` and `6015f016…`: matches |
| Tree compared with `git merge-tree --write-tree 3a37b329 6015f016` | both `b7e716cc72988e5285ae35771fcdd422ed4eea85`. The merge is clean and adds no hand edits. |
| `diff --name-only 3a37b329..882eb1d8` compared with `diff --name-only 1f1abe7c..6015f016` | identical, 4 files (below) |
| 3a37b329 already contains 1f1abe7c | yes |
| Commits after the prior CLEAR (`410e20e2..3a37b329`) | exactly one, `3a37b329 docs(security-reviews): bind the main-merge rebind`. Its parent is 410e20e2 and it changes only `docs/07-planning/security-reviews/735-unassign-expected-holder.md`, with 61 insertions. It is a note only. |

The four files that came in from main:

- `apps/api/src/pending-action/deletion-targets.ts`
- `apps/api/src/service-calendar/index.ts`
- `docs/07-planning/security-reviews/738-service-calendar-request-recheck.md`
- `tests/api-integration/service-calendar-usage-delete.test.ts`

## Interaction

I grepped the #738 `apps/` diff for:

- `assign` and `work-item/`;
- `requireWorkItemReach` and `projectReadDecision`;
- `require-workspace-capability`;
- `apiKey`;
- `openapi`.

No changed line matched.

`deletion-targets.ts` is imported only by:

- `pending-action/index.ts`;
- `service-calendar/index.ts`.

Neither is on the unassign route's path. #735's surface is not affected: the unassign handler, the query schema, the controller, reach, the capability gate, the OpenAPI contract and the web fetcher.

Prior findings carry over unchanged:

- no blocking findings;
- N1–N4 remain non-blocking or informational.

**Verdict:** CLEAR
<!-- END REPORT (sha256 e168df093dc5625ecd34cfe9c69f56f503052d302ecb14f6fc39f809398e6291) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/735-64ee-security-rebind-opus.md; Claude Opus 5.5; sha256 a9b07c53ec8c7e12740970766ebf5cd1b2a7e25e5fc9e6e627010799523a5687) -->
# PR #735 security review: exact-head rebind after merging main (#730 and #739)

**Reviewed head:** 64ee15b10e0f892602d9417f5936e8808eb6c634
**Prior CLEAR head:** 882eb1d8530ab3511d17333ac0a3e8024e5bf6fe (`735-882e-security-rebind-opus.md`; the substantive review is `735-security-opus.md` at f59b68ca)
**Pre-merge head:** 6d30d432018cf65747f950baf689f55c5a08871f
**Merged main:** a31bdde3fde0d31b77bf7452f97abab7b8ce63fc. It contains:
- #730 (6389d6e7), API project reach;
- #739 (a31bdde3), web i18n namespace groups.

**Previous main:** 6015f0163f150dcb7f09e485ad0985a8d890db94
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). This is the same independent context as the prior #735 security reviews. It did not author, direct or remediate the change.
**Scope:** a mechanical rebind plus the #730 interaction. No tests were run, as the coordinator instructed.

## Checks

All checks ran against live git and GitHub.

| Check | Result |
| --- | --- |
| `gh pr view 735` head | `64ee15b1…`: matches |
| `origin/main`, confirmed through the GitHub API | `a31bdde3…`: main is unchanged |
| Parents of 64ee15b1 | `6d30d432…` and `a31bdde3…`: matches |
| Tree compared with `git merge-tree --write-tree 6d30d432 a31bdde3` | both `fa027e5f79ce547431fa9b53869c78bca7c6f4c4`. The merge is clean and adds no hand edits. |
| `diff --name-only 6d30d432..64ee15b1` compared with `diff --name-only 6015f016..a31bdde3`, where 6015f016 is the merge base | identical, 111 files |
| Commits after the prior CLEAR (`882eb1d8..6d30d432`) | exactly one, `6d30d432 docs(security-reviews): bind the main-merge rebind`. Its parent is 882eb1d8 and it changes only `docs/07-planning/security-reviews/735-unassign-expected-holder.md`. It is a note only. |
| PR code patch: `0cc0ae12..f59b68ca` compared with `a31bdde3..64ee15b1`, excluding security-review notes, with index and hunk-header lines ignored | byte-identical (`cmp` exit 0). The unassign handler, query schema, OpenAPI entry, web fetcher and tests are exactly what was cleared. |

## #730 interaction (project reach)

#730 does touch two files that #735 also touches. In both, it changes a different route.

**`apps/api/src/work-item/index.ts`**
- #730's only hunk there is `createWorkItemRoute`, whose middleware becomes `workspaceAccess.fromProject("projectId", { requireProjectReach: true, deferApiKeyCapability: true })`.
- It also adjusts that route's 400 and 404 descriptions.
- The assign and unassign routes are not touched. They still use `requireWorkItemReach("key", { deferApiKeyCapability: true })`.

**`tests/api-contract/openapi.json`**
- #730's hunks only change descriptions on project-scoped routes: "Project not found or out of reach", "Malformed project ID", and the asset download text.
- No hunk touches `DELETE /work-items/{key}/assign` or `POST /work-items/{key}/assign`.

#730 does not modify the files the unassign route depends on:

- `require-work-item-reach.ts`;
- `require-workspace-capability.ts`;
- the unassign or assign controllers;
- `work-item/policy.ts`.

Its `workspace-access-middleware.ts` and `task-target-reach.ts` changes apply to project-scoped and task-target routes, not to the `{key}` item routes.

The `work-item-reach-guard.test.ts` change is a comment only.

So the order (reach 404, then capability 403, then the 409 precondition, then the conditional write) is unchanged, and so is the analysis in `735-security-opus.md`.

## #739 interaction (web i18n)

#739 changes web i18n loaders, the work route, the create-trigger, a new e2e spec and the locale JSON. None of these is one of #735's files.

#735's web change reuses the existing `workItems:journey.assignmentConflict` key and adds no string. The work-item detail journey is not one of #739's deferred work-list namespaces.

Prior findings carry over unchanged:

- no blocking findings;
- N1–N4 remain non-blocking or informational.

**Verdict:** CLEAR
<!-- END REPORT (sha256 a9b07c53ec8c7e12740970766ebf5cd1b2a7e25e5fc9e6e627010799523a5687) -->
