# Independent full GPT-6 Sol security review — PR #583 product source

**Reviewed head:** `08842235047a3ab2714427edce80331b94558150`  
**Comparison base:** `c46825e938019c354c615be03200cefeab7d710d` for the current three-file product correction; PR merge base `3096cb044bdf6ae98488bfc385f532fa6386343a`.  
**Reviewer:** fresh independent GPT-6 Sol context. I did not author, direct, remediate, or merge this candidate. This is the per-PR product security review, not the P0 phase finalizer or private operational-runner review.

## Verdict

**CLEAR for the product source at the exact reviewed head.** I found no blocking security defect in the asset authorization correction. This verdict does not authorize the mutable private runner, strict cutover, deployment, or merge. The separate operational runner's reported P2 volume-cleanup blocker remains outside this review and must be resolved and independently reviewed on frozen bytes.

## Security boundary examined

- `GET /api/asset/{id}` remains below the app-wide auth guard. The strict terminal wrapper resolves identity and refuses an absent identity with 401 before `loadAuthoritativeEvidence()` performs the new asset query. The native handler still calls its own credential resolver. A NUL in the path ID is rejected with 400 before either asset query reaches PostgreSQL.
- The new repository query selects both `asset.workspaceId` and joined `project.workspaceId` by the persisted asset ID, with an inner join that excludes orphaned rows. The strict wrapper uses the **project** workspace for reach and the **asset** workspace for the declared row-scoped `workspace:read` capability. Neither scope is supplied by the request. This reproduces the native handler's existing split: its reach-filtered asset query uses `project.workspaceId`, then `assertCallerHasCapability()` uses `asset.workspaceId`.
- The shared evaluator checks required reach before capability. A caller outside the project's workspace gets the same 404 status and body for a mismatched or missing asset; a caller with global reach but without the asset-workspace capability is denied 403. The mismatched row no longer triggers the earlier distinctive 500. The strict terminal wrapper runs before the native object's storage fetch, and the native reach/capability gates remain after strict acceptance.
- The earlier full C468 security review covered the composed installer, release, deploy, dependency, web lifecycle, and retained strict policy surfaces. I read that review, verified the exact current delta is confined to `apps/api/src/asset/repository.ts`, `apps/api/src/permissions/strict-policy-enforcement.ts`, and `tests/api-integration/strict-runtime-enforcement.test.ts`, and re-examined the adjacent current authorization code and policy contract, including the unchanged `apps/api/src/workspace/policy.ts`. No installer, release, dependency, or image-source bytes changed after C468.

## Non-blocking findings and limits

- **P3, regression coverage:** The mismatched asset fixture is requested as a caller in neither workspace. It establishes that the old mismatch-to-500 oracle is gone, but does not independently prove the two scope inputs cannot be swapped. Add calls by a member of the asset workspace and a member of the project workspace, asserting masked 404 and capability 403 respectively, with no object fetch. The source-level mapping and native duplicate gates are correct at this head; this is test hardening, not a current authority blocker. Ordinary reviewer A also recorded this gap.
- **P3, stale policy comment:** `apps/api/src/asset/policy.ts` describes native reach as using `asset.workspaceId`; the implementation uses `project.workspaceId` for reach and `asset.workspaceId` for capability. Ordinary reviewer B also recorded this discrepancy. The executable declaration remains correct.
- No live SQL, browser, Docker, timing parity, or source-bound runtime check was run by this reviewer. The new strict path adds a persisted-row query before evaluation; I inspected response and query structure but did not benchmark latency or assert complete timing equivalence. Independent ordinary reviewer B reports an owned PostgreSQL 18 run of the focused integration file, **1 file / 8 tests passed**; that is their execution, not mine. Current CI and hosted acceptance remain separate gates.

## Checks actually performed

- `git rev-parse HEAD` and `git status --short`: exact `08842235047a3ab2714427edce80331b94558150`, clean at review start and end.
- `git diff --check c46825e938019c354c615be03200cefeab7d710d..HEAD`: passed.
- `pnpm --filter @taskdesk/permissions exec vitest run src/evaluator.fail-closed.test.ts src/scope.test.ts`: **2 files, 40 tests passed**.
- Inspected the complete current three-file diff, asset route/loader/policy, strict registration and evaluator ordering, identity/config handling, NUL guard, asset schema, relevant attachment/RBAC contract, the earlier C468 full Sol review, and both current-head ordinary Luna reports.
- `gh pr view 583` showed the live PR head equals the reviewed SHA. At review time, G11 and the PR template/security-review check were failing, and PostgreSQL integration was still in progress. This product security verdict does not clear those gates.
