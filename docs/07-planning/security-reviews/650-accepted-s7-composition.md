# PR #650 — authentic accepted-S7 composition review

**Reviewed head:** `37db2cb6df96f9257c6f6e76b12d852934cdb1c2`

The independent report below is preserved unedited. Prior verdicts, failures and corrections remain bound to their original sources. This note adds no product source and waives no gate.

## Original report

SHA256: `7ad5118f4235bff6213f7bf062bfbad413182c0d75ebc1d97b91eb160959953e`

# PR #650 accepted-S7 composition delta review

**Verdict: APPROVE the bounded accepted-S7 composition delta** at exact head `37db2cb6df96f9257c6f6e76b12d852934cdb1c2`. This is not a merge authorization, phase-finalizer, or G11 acceptance.

- **Reviewer:** GPT-6 Luna; fresh independent ordinary-review context. I did not author, direct, or remediate the composition.
- **Comparison:** accepted main `40f05826109fec0f8fc6fcebfe142593fa1d205c`; prior PR #650 candidate `6faa8c0c7ebf733e962ab13696e6d0516f1e1282`.
- **Mode and contract:** integration freeze; native realtime contract in `docs/01-architecture/realtime.md` and accepted S7 changes from #658.

## Scope and findings

I read the author handoff and inspected the current merge topology, per-parent history and raw changes. The candidate is a normal merge with first parent `6faa8c0c7ebf733e962ab13696e6d0516f1e1282` and second parent accepted main `40f05826109fec0f8fc6fcebfe142593fa1d205c`. The intervening per-parent log includes every landed commit and charges merge parents separately; the composition introduces no additional source commit.

I compared the four #605 owner files against source commit `27b344f33cd1356c38b7254525e9c30b57ddbb96` and current head. All four blob IDs match exactly:

- `apps/web/src/hooks/use-native-work-item-realtime.ts`: `ee477f942bfc572715805442fde3e772f78d4f76`
- `apps/web/src/hooks/use-native-work-item-realtime.test.tsx`: `69214d64522f74abdec2dd54343fb9f5863511e8`
- `docs/01-architecture/realtime.md`: `15db57fc36c5be8212fd9aeadcbd4fe1ab7a3bef`
- `tests/api-integration/node-server-websocket.test.ts`: `0c1f512076da88e3771f3d8a58729281ddb08639`

Thus the accepted #638 legacy authorization assertions in the websocket integration test are byte-preserved (including the previously recorded 189 assertion lines). I did not run that permission/native integration suite.

For independent S7 source conservation, I compared all 125 paths changed between accepted base `13aacb2e87c99a280b50e5297cd296aa512dd0aa` and accepted main `40f05826109fec0f8fc6fcebfe142593fa1d205c`: every candidate blob equals the accepted-main blob. Relative to accepted main, the candidate's product delta consists only of the four unchanged #605 realtime files; its only additional file is the preserved PR #650 composition review note. The S7 changes are therefore exactly the accepted source, with no composition-specific edits to authority, policy/gates, thresholds, test filters, or performance optimization.

No blocking or non-blocking findings in this bounded delta. The prior #650 reports and accepted S7 reports remain preserved; this review does not replace or rewrite them.

## Verification performed

- `pnpm --filter @taskdesk/domain build` — passed. This refreshed the ignored local domain output needed by the focused API tests after accepted S7 added the holiday-import export.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/use-native-work-item-realtime.test.tsx` — 1 file / 8 tests passed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts tests/api/mfa-csrf-app-fixture.test.ts tests/api/permissions/enforcement-config.test.ts` — 2 files / 18 tests passed.
- Merge-aware per-parent history, raw/status and blob comparisons — passed; `git diff --check 6faa8c0c7ebf733e962ab13696e6d0516f1e1282 37db2cb6df96f9257c6f6e76b12d852934cdb1c2` passed; worktree clean.

The author handoff preserves the actual initial focused boot/MFA result of 17/18, with the failure caused by stale ignored `apps/api/dist/index.js` lacking the newly accepted domain export (`HolidayImportError`). It also records the narrow domain build followed by 18/18 on the same two-file command. My run independently confirms the post-build 18/18 result; I did not rerun the stale-artifact failure. The result is an environment/build-input distinction, not grounds to discard the original failure.

## Limits and residuals

No API/database integration, permission suite, browser, container/image, broad suite, or runtime verification was performed. Prior Any, browser, image, native database and other test evidence remains bound to its original source and is not carried forward by this review. Exact-head hosted checks remain separate. The prior G11 batch spread `0.681` over the unchanged `0.55` limit remains uncleared and is not accepted or explained here. No merge or phase-completion claim is made.
