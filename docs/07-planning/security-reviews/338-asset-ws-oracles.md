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
