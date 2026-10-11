# Independent GPT-6 Luna bulk review — P0 asset scope and strict evidence runner

**Product source:** `08842235047a3ab2714427edce80331b94558150`  
**Product base:** `c46825e938019c354c615be03200cefeab7d710d`  
**Worktree:** `/Users/heinthura/.codex/worktrees/p0-performance-complete-20261006/Ticketing.v2`  
**Independence:** Fresh reviewer context. I did not author, direct, or remediate this candidate. The separate strict evidence runner is private operational evidence and was not executed.

## Verdict

**BLOCK — one P2 operational cleanup finding in the private evidence runner.** The asset-scope product correction itself clears this review. The private runner must not be used for an acceptance run until its disposable PostgreSQL volume cleanup is made ownership-safe and complete. One P3 source-comment mismatch is also recorded below.

## Product source review

Reviewed the complete three-file, 168-line delta from `c46825e938019c354c615be03200cefeab7d710d` to `08842235047a3ab2714427edce80331b94558150`, plus the native asset route, asset policy, strict evaluator, schema/foreign-key shape, NUL guard, integration harness, and the prior Luna A finding.

The correction preserves the native boundary: the joined `project.workspaceId` supplies reach, and persisted `asset.workspaceId` supplies the declared `workspace:read` capability scope. A row whose asset and project workspace IDs differ is no longer refused with a distinct 500 before reach masking. Foreign/missing remain indistinguishable 404s; the added regression also checks the mismatched row's 404 body, that object storage is not fetched, anonymous 401, reachable 200, a nonmember admin's 403, and NUL 400.

**Focused independent verification:** with `CI` unset, ran `pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/strict-runtime-enforcement.test.ts` against a fresh owned PostgreSQL 18 resource. Result: **1 file, 8 tests passed**. The runner's exact full container ID and mount name were captured before teardown; only this run's container and volume were removed, and both absence checks passed. Evidence is under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-06/p0-strict-cutover-prep/bulk-luna-b-review/`.

No broader API/performance/browser suite was run. I found no blocker in this product delta and make no claim about timing parity beyond existing behavior.

## Blocking finding

**P2 — Disposable PostgreSQL volume is not labeled for cleanup and is preserved**  
**Location:** `run-strict-cutover-prepared.py:610` and `:1868-1885` in the private release.

The runner starts `postgres:18-alpine` without an explicit volume at line 610. Its image declares `/var/lib/postgresql` as a `VOLUME` (`docker image inspect postgres:18-alpine` confirmed this), so Docker creates an anonymous volume that does not inherit the container's `taskdesk.proof.owner` / `taskdesk.proof.run` labels. The cleanup loop correctly captures the mounted volume name, checks users, and avoids pruning, but then requires those volume labels at line 1878. The anonymous volume therefore takes the `ownership_label_mismatch_preserved` path and remains after its owned container is removed.

This violates the draft's requirement to remove and verify only this run's unused mounted volumes. Before an acceptance run, either create and mount an explicitly labeled run-owned volume or use the captured exact mount of an ownership-verified container as the parent ownership proof; then verify the volume is unused, remove only that exact volume ID, and record absence. Add an offline regression that models the actual anonymous-volume label shape so the current preservation path cannot be mistaken for successful cleanup.

## Non-blocking source observation

**P3 — Asset policy comment describes the wrong reach column**  
`apps/api/src/asset/policy.ts` says native `reachableWorkspacePredicate` evaluates `asset.workspaceId`. The current route in `apps/api/src/utils/authorize-asset-access.ts` evaluates `projectTable.workspaceId`; `asset.workspaceId` is used by the subsequent capability check. The candidate implements this split correctly, but the adjacent contract comment remains contradictory. Update the comment in a follow-up within the same owning change if possible.

## Private runner review and pins

The private diff was compared across the entire `composed-c46825e9-draft` and `strict-shadow-separated-draft` trees (excluding only Python bytecode caches). I reviewed the stage/mode receipts and ordering, separate off/shadow then strict traffic windows, fail-closed status/tally assertions, positive asset-owner binding, redacted pre-restart diagnostics, external authority gates, config/task exclusions, full container and mount capture, cleanup, immutable original failure records, and the no-carry-forward addendum.

Every final controlled-file pin, release packet, structural refreeze audit, offline log, candidate author packet, policy registry source pin, clean exact source SHA, and worktree status matched its manifest. I independently ran `python3 -m unittest -q test_strict_cutover.py` on the final private bytes: **34 tests passed**. The release remains `DRAFT_NOT_AUTHORIZED_NOT_EXECUTED`; this review does not authorize execution, establish runtime evidence, or claim acceptance.

Relevant SHA-256 pins:

- Release packet: `c60f26bf6b9072dd2638a877a22fd2a65dca90efc55baa7cf23a60eebcf7c357`
- Draft manifest: `e6b4e856decdebffcc236c15e0913002b6ada5b5b0f867fa6f3279df4ef4634f`
- Structural audit: `36358e3337a9ed4718eca8abae8c17602b59bd9393c197787373ac59d2e34b79`
- Offline tests log: `8170d2406beda74f0375b6a0c6e9b3e5660e1ceba747b1de02422baf83766d32`

**Reviewed head:** `08842235047a3ab2714427edce80331b94558150`
