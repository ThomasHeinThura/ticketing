# Independent ordinary GPT-6 Luna review — P0 strict asset-scope correction

**Reviewed SHA:** `08842235047a3ab2714427edce80331b94558150`  
**Original asset-fix SHA:** `517737d80dca5f4c8e57e4797589fa6c0c39d649`  
**Base:** `c46825e938019c354c615be03200cefeab7d710d`  
**Worktree:** `/Users/heinthura/.codex/worktrees/p0-performance-complete-20261006/Ticketing.v2`, branch `codex/p0-shadow-compatibility-complete-20261006`, clean at review start.  
**Independence:** Fresh GPT-6 Luna context for this exact-head review. I did not author, direct, or remediate this candidate. The earlier `luna-a-review.md` is retained unchanged.  
**Scope/risk:** Full asset authorization boundary and the correction from 517. Security-scope change; the required separate current-head GPT-6 Sol review remains required.

## Verdict

**CLEAR WITH ONE NON-BLOCKING TEST-COVERAGE FINDING.** The prior P2 existence-disclosure finding is fixed in the source: project workspace is used for strict reach; asset workspace is used for the policy's row-scoped `workspace:read` capability. The mismatch now reaches policy evaluation and an out-of-project-reach caller receives the same masked 404 as a missing asset. Authenticated positive, capability denial, NUL, object-fetch boundary, and cleanup behavior are covered by the expanded integration test. I found no remaining source-level authority or response-oracle defect in this correction.

## Disposition of the prior finding

**Resolved at this head.** `loadAuthoritativeEvidence()` now records `workspaceId = asset.workspaceId` and `reachWorkspaceId = asset.projectWorkspaceId` separately. `buildContext()` constructs the declared workspace capability scope from `workspaceId`, while computing `inReach` from `reachWorkspaceId`. This matches the actual native route: `loadReachableAsset()` folds reach using `projectTable.workspaceId`; after it returns, `assertCallerHasCapability()` checks `asset.workspaceId`. The asset policy remains `scope: "workspace"`, `scopeSource: "row"`, `reach: "required"`.

The mismatch path no longer returns a distinctive 500 before reach is evaluated. The current integration case uses an outsider who belongs to neither workspace and compares its mismatch response to a missing asset: both are 404 with identical response text, and no private-object fetch occurs. The NUL request remains 400; no storage fetch occurs for that case. The prior cause is therefore remediated without relying on a narrower or request-supplied scope.

Global reach is not treated as capability: the nonmember instance-admin case still expects 403 and asserts storage was not fetched. Reach/capability remain separate in the evaluator, and the strict middleware runs before the native terminal handler. The native handler's repeated reach/capability checks remain in place after strict acceptance.

## Non-blocking coverage finding

**Low — make the contradictory-workspace fixture discriminate both scope inputs**  
**Location:** `tests/api-integration/strict-runtime-enforcement.test.ts:576-647`.

The mismatched row is deliberately placed in `stranger.workspace` while its project remains in `owner.workspace`, but the mismatch request is made as `outsider`, who belongs to neither. That proves the previously reported mismatch-to-500 oracle is closed for an out-of-reach caller. It does not independently lock down the two-scope mapping: an implementation that accidentally used the asset workspace for reach would still return 404 for this outsider. Consider using `stranger` against the mismatched row to prove membership/capability in the asset workspace cannot substitute for project-workspace reach, and `owner` against it to prove project reach alone cannot substitute for `workspace:read` in the asset workspace. Assert 404/403 respectively and no object read. This is a focused regression-strengthening suggestion, not a current source blocker: the source has the correct separation and the native handler repeats both checks.

The instance-admin test is against a consistent row rather than the mismatch fixture. Static inspection confirms the same independent capability evaluation applies when reach is global (`inReach = true` but `scope` is still the asset workspace); no global-authority bypass was introduced.

## Evidence and checks

- Reviewed the entire current diff from `517737d80dca5f4c8e57e4797589fa6c0c39d649`, plus the original correction from `c46825e938019c354c615be03200cefeab7d710d`, and the current asset route/policy, storage boundary, identity/reach evaluator, asset/project schema, native loader, and asset security contract.
- Confirmed the schema's asset workspace and project foreign keys are independent; the mismatch fixture is representable. The new code does not reject it as an internal error and does not use request-supplied scope.
- `git diff --check c46825e9..HEAD`: passed.
- The author packet reports API typecheck/build, Biome and focused strict integration **1 file / 8 tests** passing on the owned disposable PostgreSQL resource. I did not rerun those tests or touch the SQL/resource lease; these are author-provided results, not reviewer-run checks.
- I ran no SQL/API runtime, browser, Docker/image, or performance command. Therefore this is not runtime or timing acceptance. Static comparison confirms the strict path performs one scope lookup before evaluating a found row; the native path still performs its reach-filtered query after strict acceptance for allowed requests. No new HTTP status/body existence distinction was found in the reviewed mismatch case, but I did not measure timing.
- Exact head and worktree cleanliness were confirmed at review start. No source edits were made.

This verdict covers only this independent ordinary review at `08842235047a3ab2714427edce80331b94558150`. It is not the remaining ordinary Luna review, current-head full Sol review, strict-cutover approval, runtime/performance acceptance, or a P0 phase-finalizer verdict.
