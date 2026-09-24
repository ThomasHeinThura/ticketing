# Security review — #317 S3: asset and websocket existence oracles (PR #338, carried over from #333)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `59176784b4717f3ebd35c08cef6f63b83c78a2f9`
**Reviewed SHA:** `59176784b4717f3ebd35c08cef6f63b83c78a2f9` (confirmed via `gh pr view 338 --json headRefOid`)
**Carried over from #333.** The probes and suites below ran on #333's head, `896cec2c58b1c9014aa146a068642e8ef2fa9bc0` (note: `333-asset-ws-oracles.md` on `fix/317-oracle-hardening`, commit `1de28df`). #338's head has the same tree: `git rev-parse <sha>^{tree}` gives `f9a5b5fa35bb163c5c7cea56553b05f4b7162879` for both, and `git diff 896cec2 5917678 --stat` is empty. So every result below holds for `5917678` byte for byte. Any later change to #338's head (a rebase, a base merge, or a code or test commit) invalidates this attestation. This note commit itself is the only exception.
**History check:** `origin/main..5917678` is one commit, `5917678`, whose parent is `dd067e2` (main). It does not contain the gitleaks-flagged literal WebSocket key from #333's `0d07520`: that commit is not an ancestor, and the test builds the key at runtime with `Buffer.from("the sample nonce").toString("base64")`.
**Base:** `dd067e21f77853b35dd79de31e99d258678b92b4` (`origin/main` at review time; merge-base equals it)
**Branch:** `fix/317-oracle-clean`
**Pull request:** #338 (it replaces #333, which was closed at 2026-09-23T16:30Z over the gitleaks hit)
**Implemented by (as recorded in the PR body):** "Codex agent; exact model variant is not exposed in this runtime". The commit is authored `Claude Code`. The attribution comment on #333 says a non-Claude lane agent wrote it.
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/index.ts`: the `GET /api/asset/{id}` route (lookup, `authorizeAssetAccess`, stream and error paths) and both websocket routes (`/ws/user`, `/ws/:projectId`), plus `app.onError`
- `apps/api/src/utils/authorize-asset-access.ts` (whole file)
- `apps/api/src/utils/validate-workspace-access.ts`, `utils/authenticate-api-request.ts` (`resolveAssetBearerOrCookie`), `utils/verify-api-key.ts`, and the `apikey` schema (`reference_id` is NOT NULL)
- `apps/api/src/utils/require-invitation-workspace-access.ts`. This PR does not touch it.
- `tests/api-integration/existence-oracle-317.test.ts` and `tests/api/utils/authorize-asset-access.test.ts`
- `docs/03-features/work-items.md` WI-25
- Every other `validateWorkspaceAccess(` caller and every other `"You don't have access to this workspace"` thrower under `apps/api/src`

---

## Verdict

**CLEAR WITH FINDINGS on the code. No code finding is BLOCKING.** The merge gates are a separate
matter and are **not** met, see "Gates" below.

- **The asset route is fixed.** An authenticated caller gets a byte-identical `404 Asset not found`, with identical headers, for another tenant's asset and for a nonexistent one. This holds for every asset kind, for session, `x-api-key` and Bearer API-key credentials, and with conditional, range and CORS request headers.
- **The ws route is fixed.** A foreign project and a nonexistent one both give `401 Unauthorized`, with identical headers, before any upgrade.
- **Unauthenticated callers** still get the same 401 on both routes.
- **No fail-open.** Only the membership 403 is remapped. A DB error is still a 500. The admin and member paths are unchanged.
- **The mutation check bites.** With the old behaviour restored, the new integration tests and the updated unit test go red.
- **This is S3 only.** The PR does not touch S4 timing (S1 below), and the invitation site is untouched (S4). #317 must stay open after this merges. Nothing in the PR body or commit auto-closes it.

| # | Severity | Summary |
| --- | --- | --- |
| S1 | NON-BLOCKING (#317 open item) | S4 timing is unchanged. A nonexistent id costs 1 query and a foreign id costs 3, on both routes. The median gap is about 0.8 ms (asset) and 0.5 ms (ws), in-process. |
| S2 | NON-BLOCKING | The remap matches the exact message string of `validate-workspace-access.ts:56`, and it leaves the "Invalid API key for this workspace" 403 unmapped. That differs from #307's middleware, which remaps both. |
| S3 | NON-BLOCKING | `getAsset`'s OpenAPI entry still advertises `403 No access to this asset` (`index.ts:735`). |
| S4 | NON-BLOCKING (#317 open item) | The invitation-scoped site from #307 S3 (`require-invitation-workspace-access.ts:43-48`) is not addressed, and the PR's "Not done" does not list it. |


---

## What I probed

Probes ran as a temporary integration test file, deleted afterwards, on the private DB
`pr333_opus_test` (td-lane-pg). Caller A is a `member` of workspace A only. B is another tenant
with one project and five assets of different kinds.

### 1. `GET /api/asset/{id}`: status, body and headers

The nonexistent-id baseline is `404`, body `Asset not found`, and headers exactly
`access-control-allow-credentials: true`, `content-type: text/plain;charset=UTF-8`,
`vary: Accept-Encoding, Origin`. There is no `Cache-Control`, `ETag`, `Last-Modified` or
`Content-Disposition` on either side.

| Request (caller A) | Foreign asset (B) | Nonexistent | Identical? |
| --- | --- | --- | --- |
| Session. Every asset kind: `image/png`, `application/pdf`, `text/html`, `image/svg+xml`, `application/octet-stream` | 404 `Asset not found` | 404 `Asset not found` | yes, all headers |
| Session plus `If-None-Match: *`, `Range: bytes=0-0`, `Origin: https://evil.example` | 404 | 404 | yes |
| Personal API key via `x-api-key` | 404 | 404 | yes |
| Personal API key via `Authorization: Bearer` | 404 | 404 | yes |
| Unauthenticated | 401 `Unauthorized` | 401 `Unauthorized` | yes |
| Bogus `x-api-key` | 401 | 401 | yes |

- **Public or signed-URL assets.** TaskDesk has neither. `is_public` was removed, and there is no presign or signed-read path in `apps/api/src`, so no other asset kind exists to test.
- **On `main`** (the same probes with both source files reverted to `origin/main`): the foreign asset is `403` `You don't have access to this workspace`, and the nonexistent one is `404`. The oracle is live on `main` and closed at this head.

### 2. `/api/ws/{projectId}`

| Request (caller A) | Foreign project (B) | Nonexistent | Identical? |
| --- | --- | --- | --- |
| Session with upgrade headers | 401 `Unauthorized` | 401 `Unauthorized` | yes, all headers |
| Session without upgrade headers | 401 | 401 | yes |
| Personal API key with upgrade headers | 401 | 401 | yes |
| Unauthenticated with upgrade headers | 401 `Unauthorized` | 401 `Unauthorized` | yes |

- **On `main`:** foreign is `403` and nonexistent is `401`.
- **The handshake.** The rejection happens inside `upgradeWebSocket`'s setup callback, before any `101`, so both cases fail at the HTTP layer with the same response. No socket is opened, so no close code is ever sent.
- **What I could not test in-process.** Hono's in-process `app.request` cannot complete a real upgrade. A member's own project returns `500` there. I did not trace the cause; it is most likely that there is no real Node socket in-process. It is on the member path and not an oracle. A real TCP upgrade for a member was not exercised.

### 3. Invitation-scoped routes

The PR does not touch `require-invitation-workspace-access.ts`. #307's S3 lists it as the third
site, with low value. It is still open, see S4 below.

### 4. Fail-open

- **The remap is narrow.** It fires only when `error instanceof HTTPException && status === 403 && message === "You don't have access to this workspace"` (`authorize-asset-access.ts:28-34`, `index.ts:916-924`). Everything else is rethrown.
- **DB error.** I injected a `pg` failure on the `workspace_member` query during a foreign-asset request. The result was **500** `{"message":"Internal Server Error"}`, not a 404 and not a pass.
- **Instance admin who is not a member.** A foreign asset still reaches the storage read, as on `main` (the result was `404 Asset object not found` because the probe had no object on disk). The PR does not change authority.
- **Same tenant.** The asset and ws routes have no capability tier beyond membership, so there is no "member without permission" 403 to preserve. A member reading their own asset reaches the storage path (`404 Asset object not found` with no object present). The member path is not blocked.
- **Credential errors** stay 401, and they are identical for foreign and missing ids (table 1).

### 5. S4 timing and query counts

Counted at the `pg` pool on the same app instance, then measured with 300 interleaved samples after 30 warm-ups, in-process.

| Route | Queries: nonexistent | Queries: foreign | Median at this head (missing / foreign) | Median on `main` (missing / foreign) |
| --- | --- | --- | --- | --- |
| `GET /api/asset/{id}` | 1 | 3 (asset, `user.role`, `workspace_member`) | 0.70 ms / 1.54 ms | 0.83 ms / 1.76 ms |
| `/api/ws/{projectId}` | 1 | 3 (project, `user.role`, `workspace_member`) | 0.41 ms / 0.94 ms | 0.50 ms / 1.20 ms |

The PR does **not** fold the reach check into the lookup. The roughly 2x timing gap and the
1-vs-3 query difference are unchanged. The PR body says so plainly ("This PR covers S3 only"). See S1.

### 6. Tests and mutation check

The new tests are `tests/api-integration/existence-oracle-317.test.ts` (3 tests) and the updated
case in `tests/api/utils/authorize-asset-access.test.ts`.

- **Mutation.** I reverted `apps/api/src/index.ts` and `apps/api/src/utils/authorize-asset-access.ts` to `origin/main` and re-ran. The asset equality test failed (`expected 'You don't have access to this worksp…' to be 'Asset not found'`), the websocket equality test failed (`… to be 'Unauthorized'`), and the unit test `masks a foreign asset as missing…` failed. I restored both files. `git status` showed only this note as untracked, and `git diff --quiet HEAD` passed.
- **Test gaps (minor, not a finding).** The integration test covers session credentials and one asset kind only. My probes covered API keys and all kinds, and they matched.

---

## S1: S4 timing residue is unchanged (NON-BLOCKING, #317 open item)

**Where:** `index.ts:743-763` (the asset lookup) runs before `authorizeAssetAccess` → `validateWorkspaceAccess` (`authorize-asset-access.ts:21-23`). `index.ts:900-912` (the ws lookup) runs before `validateWorkspaceAccess`.

A nonexistent id stops after the lookup. A foreign id also resolves credentials and runs the
`user.role` and `workspace_member` queries. Section 5 has the numbers. They match #307's S4, so there
is no regression, but the residue is still there.

**Fix:** as #317 says. Fold reach into the lookup (join `workspace_member` on `(workspace_id,
user_id)`, with the instance-admin case folded in), so that "missing" and "out of reach" are the
same null. The PR says it covers S3 only, so this is not blocking for the PR. It is blocking for
closing #317.

## S2: The remap is keyed on a message string, and the API-key 403 is left unmapped (NON-BLOCKING)

**Where:** `authorize-asset-access.ts:28-34` and `index.ts:916-924`.

- **Fragile coupling.** The remap fires only on `message === "You don't have access to this workspace"`. If `validate-workspace-access.ts:56`'s wording changes, both oracles silently reopen as 403. The new integration tests would catch that (I confirmed they go red whenever the foreign id returns 403). That is the mitigation, so this is hardening and not a defect.
- **The unmapped API-key 403.** "Invalid API key for this workspace" (`validate-workspace-access.ts:26-30`) is deliberately left alone ("not a tenant-boundary oracle"). It is only reachable after the asset row has been found, so if it fired, it would be an oracle (403 for an existing asset vs 404 for a missing one). In practice it is unreachable. `resolveAssetBearerOrCookie` just verified the same key through `verifyApiKey`, which sets `userId = reference_id ?? user_id`, and `apikey.reference_id` is NOT NULL, so the recheck's `reference_id = userId` always matches. The one exception is a race where the key is disabled between the two queries.
- **Not consistent with #307.** The middleware remaps both 403 messages (307 note, section 2).

**Suggested hardening (optional):** remap any `HTTPException` 403 from `validateWorkspaceAccess` at
these two sites, as `task-relation/index.ts:77-82` already does, or have `validateWorkspaceAccess`
throw a typed error.

## S3: The OpenAPI entry still advertises a 403 (NON-BLOCKING)

`index.ts:735` still declares `403: No access to this asset` for `getAsset`. After this PR, only
the practically unreachable API-key path in S2 can produce it. `check:openapi` passes, because the
baseline still matches. The docs just keep hinting at a distinction the route no longer makes.
Drop or reword it when S2 is addressed.

## S4: The invitation-scoped site is not addressed (NON-BLOCKING, #317 open item)

`require-invitation-workspace-access.ts:43-48` still sets `workspaceId` from any invitation row
without a reach check. The capability check that follows answers 403 where a nonexistent id gets 404.
#307 rated this low value, because invitation existence is otherwise public. #317's S3 acceptance
covers it ("each route"), though, and the PR's "Not done" omits it. Either fix it with S1 or record
explicitly on #317 that it is accepted as is.

---

## Gates (reported, not judged as code findings)

- **Ordinary independent review.** #333's body, under `## Reviewed by`, claims an "Independent Codex reviewer context (exact model variant is not exposed)", session `release_delta_review`, CLEAR at `896cec2…`.
  - It names **no model**.
  - Nothing is recorded as a GitHub review or a PR comment. `gh pr view 333 --json reviews` is empty.
  - Codex is outside `CLAUDE.md`'s model-tier table, where ordinary review is Sonnet.
  - On #338 (this PR), `## Reviewed by` is "Pending fresh review of the clean candidate head".
  - **So no qualifying ordinary review is recorded at either head.**
- **Attribution.** `## Implemented by` says "Codex agent". Every commit is authored `Claude Code <noreply@anthropic.com>`, and the orchestrator's comment on #333 says the two must be reconciled before merge.
- **`check-pr-template.mjs`**, run from this worktree: rc=1 on both #333's and #338's bodies, with the same 2 problems. The `## Security review` note link is missing, and the "Independent Opus security review" checkbox is unticked. Both are expected until this note is linked and the section is filled.
- **Security review.** This note, bound to `5917678`. #338's `## Security review` section still has to link it and tick the box.

## Verification run (at #333's `896cec2`, which has the same tree as `5917678`)

- `pnpm install --frozen-lockfile`, then `pnpm turbo build --filter=@taskdesk/permissions --filter=@taskdesk/email`: ok
- Unit (`vitest.config.ts`): **54 files, 412 tests, all pass**
- Integration (`vitest.integration.config.ts`, `CI=true`, DB `pr333_opus_test`): **80 files, 1085 tests, all pass**
- `test:permissions`: **10 files, 80 tests, all pass**
- `pnpm check:openapi`: matches the API (106 operations)
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 pass, 0 fail**
- `pnpm --filter @taskdesk/api typecheck`: clean. Biome on the 4 changed code and test files: clean.

## What I did not do

- I did not complete a real TCP websocket upgrade. All ws probes were in-process, and every denial happens before the upgrade.
- I did not measure timing over a real network. The numbers are in-process medians.
- I did not re-run the suites on `5917678` itself. The tree is identical, so the results carry over.
- I did not modify code, approve on GitHub, or merge.

---

## Delta review: #317 S4, reach folded into the lookup (`691f735`)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `691f735e686e2f7569934d8433f485a6cc928ef7`
**Also verified at the later heads.** The branch moved while I was reviewing: `691f735` → `b92ebdc4771a5cf2b74c0783f5510d11d05163a2` → `790400785dccbbcf883c043aef4a80d9b380757c`.
- Each of the four `main` merges in that range (`e14e3d4`, `84358c4`, `7389aa4`, `479869f`) reproduces exactly under `git merge-tree --write-tree`, so none carries hand edits.
- `workspace-access-middleware.ts` and `validate-workspace-access.ts` are byte-identical at all three heads.
- The only non-merge changes after `691f735` are `7a40cad` (test only, `existence-oracle-317.test.ts` +138) and three commits that edit only `docs/07-planning/status.md` (`ea37521`, `b92ebdc`, `7904007`). `7904007` changes no code (`git diff b92ebdc 7904007 -- apps tests packages scripts` is empty).
- I re-ran the full suites and the key mutation at `b92ebdc`. Everything below holds for `7904007`'s code.
**Code delta:** `691f735` "fix(auth): fold workspace reach into resource lookup", by `Codex GPT-6 <codex-gpt6@taskdesk.local>`. It changes `workspace-access-middleware.ts` (+137/-70), the middleware unit test, `existence-oracle-317.test.ts` and `status.md`.
**Scratch:** worktree `pr338-opus-delta`, DB `pr338_opus_delta_test`, scratch files `pr338-opus-*`. All deleted afterwards.

### Delta verdict

**CHANGES NEEDED. One finding is BLOCKING (D1). It needs a test only. The code at head is correct.**

- **Equivalence.** The folded predicate matches `validateWorkspaceAccess` exactly for every caller type I tried: 352 old-vs-new cells, **0 mismatches**.
- **The oracles stay closed.** Foreign and missing are byte-identical on all 8 lookups and on `lookupMany`: **0 oracles**.
- **SQL.** It is parameterised and correctly parenthesised today.
- **Timing.** The gap is gone.
- **The gap (D1).** Nothing in the test suite pins the predicate's operator precedence. If the parentheses around `admin OR member` are removed (this is #320's leak class), all 1146 integration tests still pass. That broken build returns another tenant's label to a plain member and lets them delete it. For core authorization code built on precedence-sensitive raw SQL, that has to have a regression test before merge.

| # | Severity | Summary |
| --- | --- | --- |
| D1 | **BLOCKING** | No test catches losing the predicate's outer parentheses. With `(EXISTS admin OR EXISTS member)` un-parenthesised, `GET` and `DELETE /api/label/{foreign}` return 200 and delete the foreign row, and the whole suite stays green. |
| D2 | NON-BLOCKING | A DB error on the folded single-lookup reach check now answers **503** (`lookupWorkspaceId`'s catch). Before it was **500**, and `lookupMany` still answers **500**. Both fail closed. |
| D3 | NON-BLOCKING | The correlation `"workspace_member"."workspace_id" = <outer>.workspace_id` relies on Drizzle table-qualifying the outer column. It does today, but an `alias()`-ed lookup would silently correlate wrongly. D1's test would catch that. |
| D4 | NON-BLOCKING (process) | Lane commits `691f735`, `ea37521`, `b92ebdc` and `7904007` edit the orchestrator-owned `docs/07-planning/status.md` and add session-log claims. `CLAUDE.md` makes that file read-only for lanes. The orchestrator should verify or strip these before merge. |
| D5 | NON-BLOCKING | The middleware unit test's DB mock now hardcodes reach (`workspaceId === "workspace-mine"`), so the unit suite no longer exercises reach logic, only that the SQL contains `EXISTS` and `"workspace_member"`. Reach is covered only by integration tests. |

### 1. Semantic equivalence: old vs new on the same fixtures

I ran the pre-delta middleware (copied from `e14e3d4`) and the new middleware side by side. Both
were mounted on identical minimal Hono apps, with the same `userId` and `apiKey` context, on the same
fixtures: workspaces A and B, each holding a project, task, label, time entry, activity, comment,
column and workflow rule. I compared status, body and sorted headers for the own id, the foreign id
and a missing id, across all 8 `lookup` kinds plus 8 `lookupMany` mixes.

| Caller | Own / foreign / missing (all 8 lookups) | `lookupMany` | Old = new |
| --- | --- | --- | --- |
| member of A | 200 / 404 / 404 (project 200 / 400 / 400) | `[own, foreign]` = `[own, missing]` = 200; `[foreign]` = `[missing]` = 404 | yes |
| non-member (C) | 404 / 404 / 404 | all 404 | yes |
| instance admin, non-member | 200 / 200 / 404 | `[own, foreign]` 400 "same workspace"; `[foreign]` 200 | yes (admin bypass unchanged) |
| member A + own enabled key | same as member | same | yes |
| member A + **revoked** key | 404 / 404 / 404 | all 404 | yes |
| non-member C + own key | 404 everywhere | 404 | yes |
| member A + **key owned by C** (mismatch) | 404 everywhere | 404 | yes |
| admin + own key | same as admin | same | yes |
| admin + **revoked** key | 404 everywhere | 404 | yes |
| member A + nonexistent key id | 404 everywhere | 404 | yes |
| **deactivated** (`banned = true`) member of A | 200 / 404 / 404 | same as member | yes |

**Total: 352 cells, 0 mismatches, 0 foreign-vs-missing differences.**

- **Deactivated users** pass in both versions. `validateWorkspaceAccess` has never checked `banned`; session revocation does that. So there is no widening, just the same behaviour.
- **Key expiry** is not re-checked by either version. `verifyApiKey` checks it upstream. That is also the same.
- **No path left behind.** Every `lookup`/`lookupMany` answer is now produced by the null-row branch. No caller depends on the old 403-remap path. `fromQuery`, `fromBody` and `fromParam` still go through the unchanged post-loop `validateWorkspaceAccess`. `lookupWorkspaceId` has no other callers.

### 2. #290 / #307 invariants

- **Through the real app** (`createApp`, member A): a foreign label and a missing one both give `404 Label not found` with identical headers. `PATCH /api/task/bulk` with `[own, foreign]` and with `[own, missing]` returns byte-identical `200 {"success":true,"updatedCount":1}`, and the foreign task's priority stays unchanged (`medium`).
- **#307 S1's restored bulk membership check still holds.** A non-member instance admin sending `PATCH /api/task/bulk` `delete` on B's task gets `403 You don't have access to this workspace`, and the task still exists.

### 3. SQL: every case rendered

I captured every case at the `pg` pool with an API-key caller. Every case is **one** query. For example, `label`:

```sql
select "workspace_id" from "label"
where ("label"."id" = $1 and ((
  EXISTS (SELECT 1 FROM "user" WHERE "user"."id" = $2 AND "user"."role" = 'admin')
  OR EXISTS (SELECT 1 FROM "workspace_member" WHERE "workspace_member"."user_id" = $3
             AND "workspace_member"."workspace_id" = "label"."workspace_id")
) and EXISTS (SELECT 1 FROM "apikey" WHERE "apikey"."id" = $4
             AND ("apikey"."reference_id" = $5 OR "apikey"."user_id" = $6)
             AND "apikey"."enabled" = true))) limit $7
```

- **The other cases.** `project`, `task`, `timeEntry`, `activity`, `comment` (with `"task_activity"."type" = $2` as its own conjunct), `column`, `workflowRule` and `lookupMany` (`"task"."id" in ($1, $2)`, no limit) render the same shape. Each correlates to `"project"."workspace_id"` on the joined project, or to `"label"."workspace_id"`.
- **Without a key**, the predicate is `("label"."id" = $1 and ( EXISTS … OR EXISTS … ))`.
- **Parameterised throughout.** Every user-controlled value is a bind parameter. The only literals are `'admin'` and `true`, which are constants. An id of `x' OR '1'='1` arrives as `$1`.
- **Precedence.** Every `OR` sits inside a parenthesised group. The one that matters is the template's own `( … OR … )` at `workspace-access-middleware.ts:286`/`:297`. Drizzle's `and()` does **not** add parentheses around its operands (the no-key rendering shows this), so those template parentheses are load-bearing. That is D1.

### 4. Timing

Measured in-process through the middleware harness: 300 interleaved samples after 30 warm-ups, member A, foreign id vs missing id.

| Lookup | Old: missing / foreign | New: missing / foreign |
| --- | --- | --- |
| `task` | 0.556 ms / 1.279 ms | 0.768 ms / 0.802 ms |
| `label` | 0.248 ms / 0.630 ms | 0.386 ms / 0.392 ms |

- **The gap closes.** Old foreign cost was 2.3x to 2.5x the missing cost. New, the two are within 0.03 ms.
- **The query count is equal.** It is 1 in both cases, where before it was 1 vs 3.
- **The real cost.** A missing lookup got a little slower, because the reach subqueries now run on every lookup. That is the price of equalisation, and it is small.
- **Asset and ws routes.** #317's asset and ws routes (S1 in the review above) still do their reach check separately. This delta does not touch them.

### 5. Tests and mutation checks

- **M1: drop the membership correlation** (`AND workspace_member.workspace_id = <outer>` removed). The suite goes **red**: 6 failures, including `workspace-rbac.test.ts`'s #290 mixed-id tests, `work-item-create-read-list.test.ts`'s #290 test, and `existence-oracle-317.test.ts`'s S4 test.
- **M2: drop the membership branch entirely.** **Red**: 38 failures in `workspace-rbac.test.ts` alone.
- **M3: drop the outer parentheses of `reach`** (the #320 class). **Green: 1146/1146** at `b92ebdc`, including `7a40cad`'s new API-key and bulk tests. See D1.
- **After each mutation** I restored the file, `git diff --quiet HEAD` passed, and the scratch files were deleted.
- **Suites at `691f735`:** unit **55 files / 441**, integration **81 / 1111**, `test:permissions` **10 / 80**, `scripts/ci` **495 / 0 fail**, `check:openapi` 106 operations, API typecheck clean.
- **Suites at `b92ebdc`** (code identical to `7904007`): unit **57 / 450**, integration **84 / 1146**, `test:permissions` **10 / 80**, `scripts/ci` **495 / 0 fail**, `check:openapi` 106 operations, API typecheck clean.

## D1: No test catches losing the predicate's precedence (BLOCKING)

**Where:** `workspace-access-middleware.ts:286-297`. The `sql\`( EXISTS … OR EXISTS … )\`` wrapper is the only thing grouping the `OR`, because Drizzle's `and()` does not parenthesise its operands.

**What happens without it.** The where clause becomes `id = $1 AND EXISTS(admin) OR EXISTS(member of <this row's> workspace)`. For a plain member that is true for **every row in their own workspace**, whatever the id. The lookup therefore returns the caller's own workspace for a foreign or missing id, and the handler then acts on the path id. I demonstrated this at `b92ebdc` with the parentheses removed:
- member A requests `GET /api/label/{B's label}` and gets **200** with B's label (`"name":"SECRET-FOREIGN"`, B's `workspaceId`);
- `DELETE /api/label/{B's label}` returns **200**, and B's label is deleted.

At the real head the same requests give `404 Label not found` and the label survives.

**Why the existing tests miss it.** Every #290/#317 fixture gives the caller **no rows of the same kind in their own workspace**, so the broken OR has nothing to match. `7a40cad`'s new tests have the same shape. The unit test's mock hardcodes reach and only asserts that `EXISTS` and `"workspace_member"` appear.

**Required fix (test only).** Add an integration test where the caller owns at least one row of the kind being looked up in their own workspace, then requests a foreign id and a missing id. Assert:
- both answer the resource's 404 byte-identically;
- a mutating request (for example `DELETE`) leaves the foreign row intact.

Cover at least one direct-table lookup (`label`), one joined lookup (`task` or `column`), and `lookupMany` (the caller holds 2+ tasks, sends `[foreign]` and `[missing]`, and gets `404 No tasks found` for both). Then confirm that M3 goes red. A test asserting the rendered SQL shape can be added too, but only alongside the behavioural test, not instead of it.

## D2–D5 (NON-BLOCKING)

- **D2.** Before, a reach-check DB error was a raw `pg` error from `validateWorkspaceAccess`, outside `lookupWorkspaceId`'s try, and answered 500. It is now inside the try and answers `503 Could not verify workspace access`. `lookupMany`'s query is unwrapped and still answers 500. Both fail closed. The codes are just inconsistent.
- **D3.** Correlation relies on Drizzle emitting `"label"."workspace_id"`/`"project"."workspace_id"`, and it does in every rendered case. A future `alias()`-ed table would need care. D1's test would catch a miscorrelation.
- **D4.** A lane is editing `docs/07-planning/status.md` on a feature branch, with multi-paragraph session-log entries, in four commits. Some claims, such as "bulk-specific coverage is still not demonstrated", are now stale after `7a40cad`. This is the orchestrator's surface.
- **D5.** Since `691f735`, `tests/api/utils/workspace-access-middleware.test.ts`'s mock decides reach itself, so the unit suite asserts only the SQL's text fragments.

## Other observations (not findings)

- **GitGuardian** flagged `charts/taskdesk/values.yaml:245` in merge commit `84358c4`. That line is `passwordKey: postgres_uri`, a key name and not a secret. It arrives unchanged from `main` (#308): `git diff 5ada9c5 b92ebdc -- charts` is empty. It is not this PR's content, and it looks like a false positive.
- **Ordinary review.** The PR has a comment recording "Independent ordinary review at `691f735…`: APPROVE WITH NOTES. Claude Sonnet, fresh context", under the #345 review fallback. It is bound to `691f735`, not to the current head `7904007`. The code is identical, but that binding is for the orchestrator to judge.
- **`## Implemented by`** still names only "Codex agent". The S4 commits are `Codex GPT-6 <codex-gpt6@taskdesk.local>` and the S3 commit is `Claude Code`.
- **`check-pr-template.mjs`** on the current body: rc=1. The `## Security review` note link is missing, and the Opus checkbox is unticked.

## What I did not do in the delta

- I did not measure timing through the full app stack or over a network. The numbers come from the middleware harness, in-process.
- I did not re-run M1 and M2 at `b92ebdc`. The middleware is byte-identical to `691f735`, and M3, the key one, I did re-run at `b92ebdc`.
- I did not review the `main`-side content brought in by the merges (#308, #322, #336, #345, #350) beyond confirming the merges are clean. Those have their own reviews.
- I did not modify code, approve on GitHub, or merge.

## Final review at the merged head (`a1f494f`)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `a1f494fcfa6339a8cedcf941abfab33d7a515d49`
**Scope:** the whole PR diff against its merge base `9d5deb92a81791598140007fe8e108d1a352855c` (`main` after #323), not just the delta. That matters because the branch was rebuilt: none of the heads attested above (`5917678…`, `691f735…`, `b92ebdc…`, `7904007…`) are ancestors of this head, so none of them binds this code.
**New since the `691f735` delta:** `c76a0ba` and `e6e962b` (test only, `existence-oracle-317.test.ts`), `51c4551` (`status.md` only), and `a1f494f`, a merge of `origin/main` at `9d5deb9` (#355, #323).
**Scratch:** worktree `wt-338-opus`, DB `opus338_test`. Both deleted afterwards.

### Verdict

**CLEAR WITH FINDINGS.** D1 is closed. Nothing blocks merge from the security side. The findings below are non-blocking, and two of them are for the orchestrator (E2, E3).

| # | Severity | Summary |
| --- | --- | --- |
| D1 | **CLOSED** | The new S4 test goes red when the reach `OR` loses its grouping, on each of the three legs taken separately: direct (`label`), joined (`task`), and `lookupMany`. |
| E1 | NON-BLOCKING | The `lookupMany` leg is caught only by a regex on the rendered SQL. The behavioural assertions cannot catch it, because the bulk controller re-filters by workspace. |
| E2 | NON-BLOCKING (process) | `51c4551` edits orchestrator-owned `status.md`. It landed at 02:42Z, after Thomas's 01:10Z PR comment asking for every `status.md` change on this branch to be reverted. Parts of it are stale. |
| E3 | NON-BLOCKING (merge mechanics) | The head is `BEHIND` `main` by #334 and #356. `git merge-tree` is clean, and neither touches this PR's surfaces. But any branch update after this note adds a non-review commit, which unbinds this attestation. |
| S1–S4, D2, D3, D5 | NON-BLOCKING, carried | Unchanged from the reviews above. The code they describe is byte-identical here. S1, the asset/ws timing residue, is still a #317 open item. The PR does not claim to close #317. |

### 1. Code at this head is what was reviewed before

- **Byte-identical to `7904007`:** `authorize-asset-access.ts`, `validate-workspace-access.ts`, and both unit test files. The PR's `index.ts` WebSocket hunk is also unchanged. `git diff 7904007 HEAD -- apps/api/src/index.ts` contains only `main`'s changes.
- **`workspace-access-middleware.ts`** differs from `7904007` only by the #323 lines described in section 3.
- **I re-read the full PR diff anyway**, rather than relying on equivalence.
  - Every `lookup` case, all 8, and `lookupMany` put `reachableWorkspacePredicate` inside the same `and(...)` as the id match.
  - Its admin-or-member `OR` is wrapped in the template's own parentheses.
  - The API-key `OR` (`reference_id`/`user_id`) sits inside its own parenthesised `AND ( … )`.
  - The query, body and param sources still go through the unchanged post-loop `validateWorkspaceAccess`, which uses Drizzle's `or()`. Drizzle's `or()` does parenthesise.
- **No ungrouped `OR` was found** in any changed query.

### 2. Oracle surface (check 1)

- **Middleware lookups.** "Missing" and "out of reach" are the same null row from one query. They share the same `RESOURCE_NOT_FOUND_MESSAGE` 404, `project`'s 400, or `No tasks found`. No extra query runs on either branch.
- **Assets.** Both cases give `404 Asset not found`. The route sits below the app-wide `authenticateApiRequest` guard (`index.ts:708`), so an unauthenticated or bogus-credential caller gets `401` before the asset row is read. That is identical for foreign and missing ids. I checked this because the handler reads the row before `authorizeAssetAccess`.
- **WebSocket.** `authenticateApiRequest` runs first, then an unknown project and a foreign project both give `401 Unauthorized` before upgrade.
- **Timing.** The asset and ws routes still run 1 query for a missing id and 3 or more for a foreign one. That is S1, unchanged.
- **Shadow mode (#323).** `runShadowEvaluation` reads `workspaceId`/`projectId` from context after `next()`. On both the foreign path and the missing path, the middleware throws before either is set. The shadow side therefore sees the same nulls, and it never changes the response.
- **Result:** no new oracle.

### 3. The merge (check 4): not clean, resolved correctly

- **Not clean.** `git merge-tree --write-tree 51c4551 9d5deb9` reports a **CONFLICT in `workspace-access-middleware.ts`**, so `a1f494f` carries a hand resolution. `index.ts` and `status.md` auto-merged.
- **What #323 did.** On `main`, #323 set `shadowProjectId = id` inside the old post-lookup `validateWorkspaceAccess` success branch. That branch no longer exists here.
- **The resolution** sets `shadowProjectId` in the branch where the reach-filtered lookup returned a row (`accessChecked = true`). That is the same condition: a real, reachable project. It then does `c.set("projectId", …)` after `c.set("workspaceId", …)`, exactly as `main` does.
- **Consumers of `projectId`.** The only reader is `shadow-middleware.ts:193`. `require-work-item-reach.ts:118` is a separate writer from `main`. No legacy authorization path reads it.
- **The PR's own changes are intact.** `git diff 9d5deb9 HEAD -- apps packages scripts` touches only the PR's three source files.
- **#334** (`sees_all` scoped to granting workspaces) is **not in this head**; it is on `main` after the merge base. It changes `packages/permissions` and `resolve-identity.ts` only. It does not touch `validate-workspace-access.ts` or the middleware, so the folded predicate and `validateWorkspaceAccess` stay equivalent. `git merge-tree HEAD origin/main` (`3a45fc5`) is clean.
- **Migration 0069** is `main`'s, arrives unchanged, and the PR does not touch it.

### 4. Mutation checks (check 2)

In my worktree, each mutation was reverted before the next, and `git diff --quiet HEAD` passed at the end.

| Mutation | Result | Where it fails |
| --- | --- | --- |
| **M3:** remove the reach template's outer parentheses (all lookups) | **red**, 1/7 | first `compareResponses` (label GET): `200` vs `404` |
| **M-task:** ungrouped predicate on the `task` lookup only | **red**, 1/7 | `compareResponses` at `:379`: `200` vs `404` for the foreign task |
| **M-many:** ungrouped predicate on `lookupMany` only | **red**, 1/7 | the SQL-shape regex at `:410`. The behavioural comparison at `:407` **passed** (see E1). |

So D1's requirement is met. A caller who owns rows of the same kind is present; a direct, a joined and a bulk lookup are each pinned; a foreign `DELETE` leaves the row intact; and M3 goes red.

### 5. Suites (check 3), at `a1f494f`, PG 18 `td-lane-pg`, private DB

| Suite | Files | Tests |
| --- | --- | --- |
| PR unit files (`authorize-asset-access`, `workspace-access-middleware`) | 2 | 36 pass |
| PR integration file (`existence-oracle-317`) | 1 | 7 pass |
| Full unit (`vitest.config.ts`) | 58 | 476 pass |
| `test:permissions` | 10 | 80 pass |
| Full integration | 85 | 1157 pass |
| API `tsc --noEmit` | — | clean |

The first unit and permissions run failed on `Failed to resolve entry for package "@taskdesk/email"`, because the workspace packages were unbuilt in a fresh worktree. After `pnpm --filter "./packages/*" -r build`, everything passed. This was environmental, not a defect.

### 6. CI (check 6)

Every required check is green except **`pull request template + security review`**, which fails on 2 problems:
- the `## Security review` note link is missing from the PR body;
- the "Independent Opus security review completed" box is unticked.

Both are PR-body items for the orchestrator. The a11y, visual-regression and performance-budget jobs are `NOT ENABLED` skips, as on every PR. GitGuardian and CodeQL are green.

### E1: The `lookupMany` leg is guarded only by the SQL-shape regex (NON-BLOCKING)

**Where:** `existence-oracle-317.test.ts:407-416`; `bulk-update-tasks.ts:127-128`.

**Failure scenario.** Suppose `lookupMany`'s `where` loses its grouping. It then matches every task in the caller's own workspace, and the middleware passes with `workspaceId = <caller's own>` for a request naming only foreign ids. The bulk controller then re-selects with `inArray(ids) AND project.workspace_id = workspaceId`, finds nothing, and answers `404 No tasks found`: identical to a missing id. That is defence in depth working, and it is why the behavioural comparison stayed green under M-many.

**The risk.** The only thing that fails is the regex `/\bid\b[\s\S]*\bin\s*\([^)]*\)\s+and\s+\(\s*exists/i`.
- If a Drizzle upgrade re-renders whitespace or parentheses, this goes **red** (fail-safe), and someone may "fix" it by loosening the regex.
- A future `fromTasks()` consumer that does not re-filter by workspace would then be exposed with no behavioural test.

**Suggested hardening (optional).** Add a second, reachable workspace for the caller, and assert that `[foreign]` still gives 404 rather than 400 "All tasks must belong to the same workspace". Alternatively, add a middleware-level test that asserts `c.get("workspaceId")` is never set for a foreign-only list.

### E2: `status.md` edits on a lane branch (NON-BLOCKING, process: check 5)

- **Docs only.** `git diff 9d5deb9 HEAD -- docs/07-planning/status.md` is +22/-3, and there are no code or config changes in those commits. This file is the orchestrator's; I report and do not judge.
- **Timing.** `51c4551` was committed at `2026-09-24T02:42Z`, **after** Thomas's PR comment at `01:10Z` asking lanes to revert every `status.md` change on this branch. The earlier lane edits are also still present.
- **Accurate:**
  - the new 2026-09-24 session-log entry's M3 claim (I reproduced it);
  - "7/7 targeted" (matches).
- **Stale or unverifiable:**
  - the snapshot header says `main` is at `21c6a71`. It is `3a45fc5`, and the merge base is `9d5deb9`.
  - the "Seventh pass" paragraph says #323 "still require[s] independent Opus security review before merge". #323 is merged.
  - "Two fresh independent ordinary delta reviewers cleared this test-only change" is backed only by the PR body's prose. No review comment at `e6e962b` is on the PR.
  - "historical hashes are not objects in this branch": the commits do exist as objects in the repository. They are just not ancestors of this head. The conclusion is still right: the old attestations do not bind.
- **Failure scenario if merged as-is:** the next session reads `main` as `21c6a71` and #323 as unreviewed.

**Recommendation:** revert or rewrite these edits in the orchestrator's own commit before merge.

### E3: The head is behind `main`; updating it unbinds this note (NON-BLOCKING, merge mechanics)

- **State:** `mergeStateStatus` is `BEHIND`, and `main` has #334 and #356 on top of `9d5deb9`.
- **Why it matters:** `security-review-note.mjs` rule 3 marks this note STALE if any non-review-artefact commit lands after `a1f494f`, including a merge of `main`.
- **Failure scenario:** someone updates the branch after this note, the template gate goes red, and someone is tempted to add the new head by hand without a review. It is also the only point where #334 could interact, and I checked above that it does not.
- **Recommendation:** either merge from this head if the repository's rules allow a behind branch, or update first and commission an exact-head delta attestation of the merge commit.

### What I did not do

- I did not re-measure timing. The middleware code is identical to the `691f735` delta's, which measured it, and the asset/ws code is identical to the first review's.
- I did not re-run M1 and M2. Their target code is unchanged.
- I did not run `scripts/ci` tests, lint, or `check:openapi` locally. CI's `gate checkers + red probes`, `static` and `contract - OpenAPI drift` are green at this head.
- I did not review #323's shadow machinery itself, beyond its interaction with this PR. It has its own reviews.
- I did not edit the PR body, approve on GitHub, or merge.
