# Security review — #317 S1/S3/S4: asset, websocket and invitation-cancel existence oracles (PR #383)

**Reviewer:** Opus 5.5 (`claude-opus-5-5[1m]`), fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `ab070fa89732c122b01709046bbbcf7ce5d60405`
**Reviewed SHA:** `ab070fa89732c122b01709046bbbcf7ce5d60405` (confirmed via `gh pr view 383 --json headRefOid` at start and end of review)
**Base:** `0b1bcc1d82f340a8d624fb053835ce3152d8b51d` (`origin/main`; merge-base equals it)
**Branch:** `fix/317-existence-oracle-timing`
**Pull request:** #383 (commits `d79b1ad`, `13802a0`, `685aacd`, `ab070fa`)
**Implemented by (as recorded in the PR body):** Claude Sonnet 5, #317 implementation subagent
**Date:** 2026-09-27

Any later change to #383's head (rebase, base merge, code or test commit) invalidates this attestation; only a commit touching `docs/07-planning/security-reviews/` alone is exempt.

## Surfaces examined

- `apps/api/src/utils/authorize-asset-access.ts` (whole file, `loadReachableAsset`)
- `apps/api/src/index.ts`: `GET /api/asset/{id}` and `/api/ws/:projectId`
- `apps/api/src/utils/workspace-access-middleware.ts`: `reachableWorkspacePredicate` (export only)
- `apps/api/src/utils/require-invitation-workspace-access.ts`, `require-workspace-membership.ts`, `validate-workspace-access.ts`, `authenticate-api-request.ts`
- `apps/api/src/invitation/index.ts` (cancel route middleware order), `index.ts` `/invitation/public/:id`
- `apps/api/src/asset/policy.ts`, `apps/api/src/policy-registry.ts` (comments), `tests/api-contract/openapi.json`
- `apps/api/src/task/index.ts` (the only asset writer), `permissions/shadow-middleware.ts`
- Tests: `existence-oracle-317.test.ts`, `workspace-invitation-writes.test.ts`, `tests/api/utils/authorize-asset-access.test.ts`

## Verdict

**CLEAR WITH FINDINGS. No finding is BLOCKING.**

- **Asset and websocket: the oracle and the query-count residue are gone.** One query for both a foreign and a missing id: session 1/1 and `x-api-key` 3/3, on both routes. There is no conditional or error-path second query. Responses are byte-identical in status, body and headers. The remaining in-query difference is about 20–35 µs, from Postgres evaluating EXISTS on a found row. The #307 middleware has the same behaviour.
- **Access is preserved.** A member and a non-member instance admin still reach the asset and pass the ws check. An outsider gets 404 / 401. On ws, API-key enablement and ownership are now enforced, a strict narrowing that matches the middleware.
- **Invitation-cancel: the status oracle is closed for every caller type.** Foreign owner 404=404, non-member instance admin 404=404, unauthenticated 401=401, API key 403=403 (`requireSessionOnly`). A same-workspace member gets 403 "Insufficient permissions", which is fine: they are entitled to know the invitation exists. The PR's decision not to reuse `reachableWorkspacePredicate`, which lets instance admins through, is correct against `requireWorkspaceMembership`, which does not.
- **No new TOCTOU window.** Asset and ws read one snapshot. For invitations, a membership removed between the new check and `requireWorkspaceMembership` only reveals existence to someone who was a member a moment earlier.

| # | Severity | Summary |
| --- | --- | --- |
| F1 | NON-BLOCKING (#317 open item) | Invitation-cancel timing residue: foreign 4 queries vs missing 3 (median +0.43 ms). Low impact: existence is public via `/api/invitation/public/:id`. |
| F2 | NON-BLOCKING | Asset reach now checks `project.workspace_id`, not `asset.workspace_id`. They are equal by construction today, with no DB constraint. `asset/policy.ts` still says the runtime evaluates `asset.workspaceId`. |
| F3 | NON-BLOCKING (test gap) | No test pins the non-member instance-admin invitation case. A let-admins-through mutation survives. |
| F4 | NON-BLOCKING (test gap, fails closed) | No integration test asserts that a member or admin can still reach an asset or ws. An always-`false` predicate survives. |
| F5 | NON-BLOCKING (monitoring) | The new invitation 404 leaves `legacyAuthorization` unset, so shadow mode records `known:false` where it used to record "denied". |
| F6 | NIT | Stale test comment ("remaps that exact 403"). The unreachable `if (userId)` skip would reopen the oracle if it were ever reached. |

## What I probed

A temporary integration test file, deleted afterwards, ran on a private database (`pr383_probe_test`, td-lane-pg, PG 18).

### 1. Asset / websocket

| Route and credential | Queries (foreign / missing) | Median ms (foreign / missing) |
| --- | --- | --- |
| asset, session | 1 / 1 | 0.927 / 0.906 |
| asset, `x-api-key` | 3 / 3 | 2.248 / 2.213 |
| ws, session | 1 / 1 | 0.726 / 0.705 |
| ws, `x-api-key` | 3 / 3 | 2.073 / 2.052 |

Status, body and headers were equal for both credential types. Owner-member and non-member admin: the asset lookup passes (the request reaches storage: "Asset object not found") and ws passes (the harness then returns 500 at upgrade). Outsider: 404 "Asset not found" and ws 401.

### 2. Invitation cancel

| Caller | Result | Queries (foreign / missing) | Median ms |
| --- | --- | --- | --- |
| foreign workspace owner | 404 = 404, headers equal | 4 / 3 | 2.923 / 2.478 |
| non-member instance admin | 404 = 404, headers equal | 4 / 3 | 2.503 / 2.076 |
| unauthenticated | 401 = 401 | — | — |
| API key | 403 = 403 | — | — |
| same-workspace member | 403 "Insufficient permissions" (missing id: 404) | — | — |

## F1: Invitation-cancel timing residue (NON-BLOCKING, #317 open item)

`require-invitation-workspace-access.ts` runs the invitation lookup and then a separate `workspace_member` query, so a foreign id costs one more round trip. Fix: fold `EXISTS (SELECT 1 FROM workspace_member WHERE user_id = $u AND workspace_id = invitation.workspace_id)` into the lookup, with no admin bypass, and return no row in both cases. Low value, because `/api/invitation/public/:id` already reveals existence. Record it on #317 either way.

## F2: Asset reach subject moved to `project.workspace_id` (NON-BLOCKING)

`loadReachableAsset` passes `schema.projectTable.workspaceId` to the predicate. Before, `validateWorkspaceAccess` received `asset.workspaceId`. The only writer (`task/index.ts` ~880–910) sets both from one join, and no route mutates `project.workspace_id`, so the two are equal today. No DB constraint enforces that, though. A probe row with mismatched values was served to a member of the project's workspace who is not a member of the asset's workspace. `asset/policy.ts` still says "the runtime check only ever evaluates `asset.workspaceId`". Fix: pass `schema.assetTable.workspaceId`, or correct the comment.

## F3 / F4: Test gaps (NON-BLOCKING)

- **M2**, a let-admins-through branch added to the invitation membership check: the invitation and oracle files still pass, 33/33.
- **M6**, reach predicate replaced with `sql\`false\``: every asset/ws integration file still passes, 49/49. The unit test's database mock never evaluates the predicate.
- **Fix:** add a non-member admin foreign-vs-missing equality test for invitations, and a test that a member or admin can reach an asset, by asserting the storage-stage response rather than "Asset not found".

## F5: Shadow evidence (NON-BLOCKING)

The new 404 is thrown before `requireWorkspaceMembership` has marked the request. `runNextWithPolicyShadow` then sees `legacyAuthorization === undefined` and records `known:false`. Fix: call `setShadowLegacyAuthorization(c, "denied")` before throwing.

## F6: Nits

The comment on the invitation test in `workspace-invitation-writes.test.ts` describes the abandoned remap approach. In the resolver, a falsy `userId` skips the check. That can't happen behind `requireSessionOnly`, but if it did, the downstream 403 would be an oracle. Throwing 404 there too would be safer.

## Mutation checks

| Mutation | Result |
| --- | --- |
| M1: remove the invitation membership check | #317 S3 invitation test fails |
| M2: let instance admins through the invitation check | survives (F3) |
| M3/M4: reach predicate replaced with `true` | 3 asset/ws tests fail |
| M5: restore main's two-step asset/ws code | both query-count tests fail |
| M6: reach predicate replaced with `false` | survives (F4) |

Each mutation was reverted afterwards, and `git diff --quiet HEAD` passed.

## Verification run (at `ab070fa`)

- Integration, `vitest.integration.config.ts`, private DB `pr383_opus_test`: **90 files / 1228 tests passed**
- Unit, `vitest.config.ts`, after building the workspace packages: **59 files / 490 tests passed**
- Permissions, `vitest.permissions.config.ts`: **11 files / 81 tests passed**

## What I did not do

- I did not measure timing over a real network. All numbers are in-process medians.
- I did not test a real WebSocket upgrade. The harness returns 500 once the reach check passes.
- I did not run e2e, the OpenAPI drift check, or the CI gate scripts locally. I relied on the PR's CI runs, which pass except the template/security-review check that is waiting on this note.
- I did not review the ordinary-review tier. It has not been commissioned yet.

---

## Ordinary review (Claude Sonnet 5)

**Reviewer:** Claude Sonnet 5, a fresh independent context. Worked in `/tmp/pr383-review` (isolated worktree, shared checkout untouched).
**Reviewed head:** `ab070fa89732c122b01709046bbbcf7ce5d60405`
**Verdict: APPROVE.**

- Confirmed the asset/ws query fold: `loadReachableAsset` (replacing `authorizeAssetAccess`) and the websocket route fold the reach check into the same query as the existence lookup via the newly-exported `reachableWorkspacePredicate`. Both foreign and missing ids cost exactly 1 query, not 3 vs 1, per `existence-oracle-317.test.ts` and direct code reading. `reachableWorkspacePredicate`'s existing callers are unaffected (export-only change to the function itself).
- Confirmed the invitation fix checks membership synchronously in the same middleware frame, not via try/catch around `next()` — verified the stated reason (Hono's `compose()` converts a downstream throw to a Response before an earlier frame's own catch can see it) against the actual installed Hono source. Confirmed via git history this was a real caught mistake: `d79b1ad` shipped the try/catch version, `ab070fa` replaces it, citing the regression test that caught it.
- Confirmed the deliberate non-reuse of `reachableWorkspacePredicate` (admin-bypassing) for the invitation route against `requireWorkspaceMembership` (no bypass) is consistent with the 2026-09-08 decision-log entry ("The instance-admin bypass is not blessed on S4 mutation routes").
- Confirmed the rewritten `workspace-invitation-writes.test.ts` test asserts the foreign-invitation 404 is byte-identical to the missing-id 404 (status + body), and that the foreign invitation itself is left untouched (still "pending").
- Confirmed the dropped 403 in `tests/api-contract/openapi.json`'s `getAsset` contract is legitimate (the path is genuinely unreachable now); `check:openapi` passes (110 operations matched).
- Ran the full suite directly: typecheck clean (9/9), biome clean, `test:permissions` 11/81, unit `@taskdesk/api` 59/490 (web unaffected, 70/327), integration 90/1228 (cross-checked against the PR's own CI run on GitHub's Testcontainers Postgres 18 — same counts, no deadlock flake either run), `node --test scripts/ci/**/*.test.mjs` 491/77.
- Two non-blocking observations, not findings: the PR body's own S-numbering doesn't quite match `338-asset-ws-oracles.md`'s established numbering (traceability nit only); the ws route now also re-checks API-key enablement/ownership where the old code never passed `apiKeyId` for this specific route — a strictly-positive incidental fix, not scope creep, worth noting so it isn't mistaken for undisclosed behavior change.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `e486c84ea3b33029e7d3a1d6d8427a8a01b406d9`
**Previously reviewed head:** `ab070fa89732c122b01709046bbbcf7ce5d60405`
**Reviewer:** orchestrating session (mechanical verification — the merge changes no authority or gate-semantics invariant, per `AGENTS.md`'s review-tier table)
**Verdict:** CLEAR WITH FINDINGS, unchanged. F1-F6 above still stand, non-blocking.

- `git show --remerge-diff e486c84` is empty — a clean automatic merge, no conflict-resolution content.
- `git diff 6242c3b..e486c84 --stat` touches exactly two files: `docs/05-operations/runbook.md` (#380) and `docs/07-planning/status.md` (#384), both docs-only and outside security-review scope. No file in `apps/api/src/utils/**`, `apps/api/src/asset/**`, or any other security-scope path changed.

---

## Lightweight re-confirmation after second branch update (2026-09-27)

**Reviewed head:** `ffb9d9d96ac3d435080d107fc35cad66b90627ac`
**Previously reviewed head:** `e486c84ea3b33029e7d3a1d6d8427a8a01b406d9`
**Reviewer:** orchestrating session (mechanical verification, per `AGENTS.md`'s review-tier table)
**Verdict:** CLEAR WITH FINDINGS, unchanged. F1-F6 above still stand, non-blocking.

- `git show --remerge-diff ffb9d9d` is empty — clean automatic merge, no conflict-resolution content.
- This merge is larger than the prior two: it brings in PR #375's real changes (`apps/api/drizzle/0070_audit_log_project_id.sql`, `apps/api/src/database/schema.ts`, `apps/api/src/audit/audit-writer.ts`, `apps/api/src/audit/controllers/list-workspace-audit.ts`), which is genuinely security-review scope. But #375 itself already carries its own complete, independent Opus CLEAR verdict (`docs/07-planning/security-reviews/375-audit-log-project-id-reach-filter.md`), and none of those files overlap with anything #383 touches (`apps/api/src/utils/authorize-asset-access.ts`, `apps/api/src/utils/require-invitation-workspace-access.ts`, `apps/api/src/asset/policy.ts`, `apps/api/src/index.ts`'s asset/ws/invitation routes). Confirmed via `git diff e486c84..ffb9d9d --stat`: zero files in common with #383's own diff against `main`.

---

## Lightweight re-confirmation after third branch update (2026-09-27)

**Reviewed head:** `8f2d109690c36efc52dbe04b6e2f7b583d2f16e0`
**Previously reviewed head:** `ffb9d9d96ac3d435080d107fc35cad66b90627ac`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR WITH FINDINGS, unchanged.

- `git show --remerge-diff 8f2d109` is empty — clean automatic merge.
- Brings in PR #381's already-reviewed changes (`shadow-context.ts`, `shadow-middleware.ts`), zero overlap with this PR's own asset/ws/invitation files.

---

## Lightweight re-confirmation after fourth branch update (2026-09-27)

**Reviewed head:** `db8ce9bc898f3ade89dc6a7350eafac29240c7db`
**Previously reviewed head:** `8f2d109690c36efc52dbe04b6e2f7b583d2f16e0`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR WITH FINDINGS, unchanged.

- `git show --remerge-diff db8ce9b` is empty — clean automatic merge.
- Brings in PR #382's already-reviewed changes (`scripts/ci/lib/env-reads.mjs` and its test), zero overlap with this PR's own asset/ws/invitation files.

---

## Lightweight re-confirmation after fifth branch update (2026-09-27)

**Reviewed head:** `5ef9fec4be17ee454ad20ff564c139ba75cd545f`
**Previously reviewed head:** `db8ce9bc898f3ade89dc6a7350eafac29240c7db`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR WITH FINDINGS, unchanged.

- `git show --remerge-diff 5ef9fec` is empty — clean automatic merge.
- Brings in only `docs/07-planning/status.md` (#385), docs-only, outside security-review scope, zero overlap with this PR's own files.

---

## Lightweight re-confirmation after sixth branch update (2026-09-27)

**Reviewed head:** `b5146080922bac1d61cd107b97ea81dab1d7b989`
**Previously reviewed head:** `5ef9fec4be17ee454ad20ff564c139ba75cd545f`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR WITH FINDINGS, unchanged.

- `git show --remerge-diff b514608` is empty — clean automatic merge.
- Brings in only `docs/07-planning/decision-log.md` (#386) and this PR's own already-committed review note — docs-only, zero overlap with this PR's own asset/ws/invitation files.

---

## Lightweight re-confirmation after seventh branch update (2026-09-27)

**Reviewed head:** `3a001a2a47a31cbf5cc8558004bad4f5101309bc`
**Previously reviewed head:** `b5146080922bac1d61cd107b97ea81dab1d7b989`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR WITH FINDINGS, unchanged.

- `git show --remerge-diff 3a001a2` is empty — clean automatic merge.
- Brings in only `CLAUDE.md` (#387), docs-only, outside security-review scope, zero overlap with this PR's own files.

---

## Lightweight re-confirmation after eighth branch update (2026-09-27)

**Reviewed head:** `3533a16502cc3ea1a4736ac7de81ef7a66f68c67`
**Previously reviewed head:** `3a001a2a47a31cbf5cc8558004bad4f5101309bc`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR WITH FINDINGS, unchanged.

- `git show --remerge-diff 3533a16` is empty — clean automatic merge.
- Brings in only `deploy/compose.traefik.yml` and `docs/05-operations/traefik-and-domains.md` (#388), outside security-review scope (neither file is on `ci-cd.md`'s path list), zero overlap with this PR's own files.
