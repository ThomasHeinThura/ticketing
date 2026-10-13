**Reviewed head:** `c9a7f26ca16eac524847be80d23a9729789bbef5`

# Independent GPT-6 Sol security review — PR #584, exact C9 head

**Reviewer:** fresh GPT-6 Sol context; no authorship, direction, remediation, operational authorization, or merge of this candidate.
**Candidate:** `c9a7f26ca16eac524847be80d23a9729789bbef5` on PR #584, base `3096cb044bdf6ae98488bfc385f532fa6386343a`. GitHub head and local clean checkout matched at review.
**Scope:** full product authorization change from base, three dependency floors added at C9, and the private C9 strict-runner draft. This is the per-PR security review, not the P0 phase finalizer or a runtime release record.

## Verdict

**CLEAR for the reviewed product/security source; no blocking or non-blocking security finding in this scope.** The operational draft remains **unreleased and unexecuted**. This verdict does not clear failed CI, establish runtime/soak compatibility, or authorize a cutover.

## Source checks

- The only executable API product change from base is `loadAuthoritativeEvidence` in `apps/api/src/permissions/strict-policy-enforcement.ts`. For a workspace policy declaring `scopeSource: "row"`, request-derived `workspaceId` causes an exact `workspaceTable.id` lookup. A present row supplies `workspaceScopeFromRow` through the existing resolver; absent/unknown evidence refuses 500, absent row refuses 404. It does not relabel an unverified request id as row evidence.
- The strict wrapper is on the terminal handler, after `workspaceAccess.fromParam` and the route's native auth/capability middleware. The native access path checks session/API-key reach first; nonmember and missing cases retain that path's response semantics. The strict evaluator still separately requires the route capability, so native instance-admin reach alone cannot grant `workspace:read`. The patch does not change policy registry declarations, route middleware, identity loading, or capability evaluation.
- The new integration cases address the persisted row for detail, members, invitations, update and delete; an instance-admin nonmember reaches native middleware but receives strict 403 on an existing row; the same admin gets 404 on a missing row; an ordinary nonmember gets the native 403. The full 7-case SQL, 37-unit and 88-permission test results were supplied by the candidate team/CI, not independently rerun in this review. GitHub's current full PostgreSQL check is green on C9.
- C9 versus reviewed 81 changes only `pnpm-workspace.yaml` and `pnpm-lock.yaml`; product files are byte-identical. Lockfile/package snapshot changes resolve `proxy-addr@2.0.8`, `source-map-js@1.2.2`, `prosemirror-view@1.42.6` and the expected `prosemirror-model@1.25.12` edge. No direct dependency or unrelated override changed. The installer packet records offline frozen install, dependency check, typecheck and a high/critical audit with no high/critical finding; those commands were not rerun here. The stated low KaTeX residual remains visible.

## Off/shadow and older manifest compatibility

At C9, `TASKDESK_POLICY_ENFORCE` selection code still returns `next()` before strict context loading when unset or when this route source is unselected. The new lookup therefore cannot change the off-mode response through the strict wrapper. The separate shadow middleware and workspace native middleware are unchanged from the October 4 `ea6a6367` manifest source; the `apps/api/src/index.ts` delta in that comparison is a comment. This is a source-level compatibility assessment only. The changed lock graph applies in all modes, and no C9 runtime mode comparison was performed.

The October 4 manifest is source-bound to `ea6a63672c70459bb3a7a91b829e913d2f295829`, with different strict-policy and workspace-policy files and older dependency bytes. Its later comparison to `36959b57` established equivalence only for that then-current source; it cannot carry forward to C9. The recorded actual dates were October 4–5, and the normative assessment itself did not satisfy three dates. A new candidate-specific observation/compatibility decision remains necessary. The original failed strict run `20261006T054501Z-3096cb04` stays failed evidence at `representative_traffic`; this review does not reinterpret it.

## Private C9 draft review

The draft release packet SHA-256 is `c7cc32931b09bf4fb8803c250007de328cab11748ded53b6533368f4fe9f3bbd`; the draft manifest SHA-256 is `760ec40c6982142b90764be0d2acd7b1664eee7c901de3f95fde10eea5661d3f`; the dependency packet SHA-256 is `6f4a5f45b4367fbd83521ace4974db1d1e3758535a12f6a852c880042b00b1db`. I recomputed all seven manifest-controlled file hashes; each matched. The wrapper also pins the runner, two helpers, stage plan, and offline test. The source target is C9; the schema-80 baseline is distinctly `b80ff7c3ef723a280bb35cfadec0a71b1ad14ae3` and image `sha256:6a6315c2890b5677f9afb858c3f81aa86c181e7d3270fa7164d889111e214628`.

I inspected the execute path: it requires externally pinned runtime release, independent Sol, CI-window and operational/orchestrator records before Docker actions, then exact source and clean checkout. The current manifest says `DRAFT_NOT_AUTHORIZED_NOT_EXECUTED`, `strict_execution_authorized: false`, and `three_date_carry_forward_claimed: false`; the plan says `runtime_invoked: false`. New C9 operational authorization, orchestrator application, CI-window and trusted Sol release records are absent. These absences fail closed. This review is not a substitute record for that release path. The copied runner's diagnostic/log changes were inspected for bounded redaction and rollback ordering; the prior failed run's records remain untouched.

## Checks actually run and limits

- `python3 -m unittest -q test_strict_cutover.py`: **28/28 passed** on the pinned C9 draft.
- `python3 -m py_compile proof_helpers.py run-strict-cutover-prepared.py test_strict_cutover.py`: passed.
- `git diff --check` for base to C9: passed. Local checkout remained clean.
- No Docker boot, database/SQL test, API runtime, browser, network cutover, strict runner execution, or performance test was run by this reviewer.

At review, GitHub C9 has green full PostgreSQL, permissions, static, unit, build, supply-chain and other listed checks, but the pull-request template/security check and G11 performance check are red. Root reports G11 at 17/22. These are merge blockers independent of this clean security verdict. No stage completion, cutover, three-date carry-forward, or protected-merge eligibility is claimed.

## Orchestrator evidence index and scope clarification

Ordinary product reviews independently cleared81bcda5b; current C9 changes only the three
dependency floors and lockfile graph. Independent C9 ordinary delta also cleared the private
runner draft, reran28 offline tests and checked all seven pins. Its report SHA-256 is
`db6dd85fb5b35304717864ca639c32a9a4718004a2e6fc3ef965182d60a6bde9`.
The original independent Sol report SHA-256 is
`b5875adf1518741bfa5fa09c0f8fd7b3f7b2389b401057d1cc095eee32348c5e`.
These are actual independent reviews, not root remediation or self-review.

The older EA normative assessment examined October4–5. Separately, original source3096
also has an actual October6 partial observation at01:53:15.538258–01:53:22.000250 UTC.
All three original partial buckets remain original evidence. They are not full-day or
72-hour coverage, and have not been carried forward to C9. Source-level compatibility
inspection above is insufficient to establish changed dependency runtime equivalence.
Current C9 G11 failure17/22 stays open. No merge/cutover/phase acceptance is claimed.
