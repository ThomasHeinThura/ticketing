# API-key capability, owner ceiling and project-settings composition — #783 / #784

**Reviewed head:** `596a2332381e16d89e6bf90a8d679d0cb3a022d8`

The paired candidate preserves #783 capability propagation and #784 owner-project-role clamping, accepted main `e9df2294fa580fd2885343bbef0cec28e81ead4c`, and the bounded target-project settings-authority repair. Two independent ordinary contexts and a fresh independent full GPT-6 Sol context clear the repaired source. The earlier current-main Sol blocker is retained below; it found a workspace-only field gate affecting both sessions and keys, not a key-greater-than-owner grant. The repair uses canonical target-project authority and preserves the stored-key intersection.

The conductor explicitly dispatched implementation/ordinary contexts with GPT-6 Luna and security contexts with GPT-6 Sol. Original Claude identities and each report's actual runtime introspection limits remain unchanged. The first retained packet contains six original/paired records; six subsequent authentic records cover current-main inspection, the adverse finding, repair and current clearances. The conductor authored composition/publication and is not an independent reviewer.

Actual current independent checks include evaluator60/60, key-scope10/10, API typecheck, Biome and diff checks. New PostgreSQL regressions remain UNRUN locally, and complete current hosted CI plus image build/boot/migration/health are pending. No source review waives those gates, authorizes a standalone #783 deployment, closes issues, or claims release/SIT/phase acceptance. The former current-main ten-path byte-conservation proof predates the documented two-path repair; the accepted-main source is conserved except for that explicitly reviewed authority correction.

---

Retained evidence packet 1; origin `apikey-reviews-public.md`; SHA-256 `eeb77d1ef4d00845d99112813157bdd01c643ffe4e72dd6cc299b96d74e2d9f5`; 34060 original bytes.

# Preserved API-key candidate reviews — #783 / #784

Current reviewed source: #783 `e0d5e9c25a80ba65ed5392f5ce06e152347b5c7f`; composed #784 `1bd6851496e286a111a83c658fe44bd116e11e74` includes #783. The current ordinary delta review and full independent Sol security review clear that source composition; original Claude reports retain their model identities, reviewed heads and adverse findings. Reports below are reproduced unchanged with origin hashes.

This is review publication, not acceptance: current-main composition, exact-head required CI and shipping-image/runtime verification remain outstanding. #783 alone must not be treated as complete owner-project clamping; acceptance must preserve the paired #784 repair. Neither issue is closed by this comment, and neither candidate is part of the frozen #791 carrier.

## Authentic report — 783-ordinary-a-sonnet.md

Origin SHA-256 `3fcdf07e04c3a506489beaab01584180846989c5f645abd8e073f3266231a859`.

# PR #783 ordinary review A (#750: stored API-key scope feeds resolveCallerIdentity)

**Reviewed head:** 341f365d3fe72ae4e5059560f82d491791d4a375
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 783` (base main, branch codex/api-key-identity-capabilities-750). Security-scope (authorization); this ordinary review does not replace the required Sol review. Diff: `utils/has-project-reach.ts` (+13/-3), a comment-only edit in `work-item/require-work-item-reach.ts`, and new `tests/api-integration/api-key-project-capabilities.test.ts` (150 lines). Scratch worktree removed afterwards.

## Correctness
- `resolveCallerIdentity` now passes `capabilities: apiKeyCapabilitySubset(apiKey)` in the `apiKey` fact. `c.get("apiKey")` (set in `authenticate-api-request.ts`, both header paths) already carries `permissions: key.permissions`, so the stored scope is available with no extra query. `apiKeyCapabilitySubset` is the existing projection used by the request adapter and sockets: it returns `[]` for missing/null/non-object/array permissions and for any resource whose actions are not an array of strings, and only keeps exact `resource:action` pairs present in the canonical capability registry. So fail-closed is preserved and an unknown statement never becomes a capability.
- Resolution remains owner RBAC intersect key scope: `resolve-identity.ts` takes the key fact's `capabilities` as the key subset (`keyCapabilities`) and still rejects a disabled key or an owner-id mismatch (S4); the key can never hold more than its owner. The type widening (`ApiKeyPermissionScope`) is local and non-breaking.
- Effect: `GET /api/project/{id}` for a correctly scoped key now evaluates `can()` against the stored subset instead of an empty one, fixing the 403 that #750 describes; nothing else widens (no route policy changed).

## Tests and mutations (CI=true Testcontainers)
- New file: 7 tests passed. With neighbours (project-reach-reads, work-item-project-reach-credentials, capabilities-scope, api-key-bearer): 5 files, 123 tests passed.
- Mutations (each reverted, tree clean): (1) stop feeding the scope: 2 fail; (2) feed a constant `["project:read"]` instead of the stored scope: 1 fails (the fail-closed table); (3) make a malformed resource `continue` instead of failing the whole projection: survived; (4) accept non-registry `resource:action` strings as capabilities: survived.
- Survivors: the fail-closed table uses single-resource scopes only, so skipping one malformed resource still yields no capabilities; a mixed scope such as `{project:["read"], work_item:[1]}` (should refuse everything) is not asserted. Mutation 4 is nearly equivalent (an unregistered string cannot satisfy `can()`). Both are in the pre-existing projection helper, not in this diff.
- Good coverage otherwise: owner baseline, three valid scopes succeed, nine refused scopes (null, malformed shapes, insufficient, unknown names) give 403, a key never exceeds its owner (owner lacking project:read refused even with a wider key), outsider key stays 404, disabled key 401, `project:update` implies read like a session role.

## Findings
Blocking: none.
Non-blocking: (a) add a mixed valid and malformed scope case to the fail-closed table (kills mutation 3); (b) the project-level 403 refusal for a key with a null scope depends on this feed; consider a one-line assertion that a legacy key row with null permissions is refused on a second route (e.g. work item read) so the change is not only exercised through `GET /api/project/{id}`.

## Residual risk
The stored scope here is the better-auth `permissions` statement set projected to registered capabilities; routes that keep deferring key scope to the legacy gate are unchanged by this PR (#784 builds on it).

**Verdict:** APPROVE


## Authentic report — 783-ordinary-b-sonnet.md

Origin SHA-256 `52359a5dcc61970cae918a4ca56342a367b5e316c48ee8829642fd23dea325af`.

# Ordinary review B, PR #783 (#750: key identities carry stored capabilities): contract and consistency

**Reviewed head:** 341f365d3fe72ae4e5059560f82d491791d4a375
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** main c35666c531c4b84c300bac5432fd4dc8dca3ed4f (merge base)
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; targeted tests.

## Commands and counts
- `gh pr view 783 --json headRefOid` = head above. Diff: `utils/has-project-reach.ts` (+16/-?), `work-item/require-work-item-reach.ts` (comment), new `tests/api-integration/api-key-project-capabilities.test.ts` (+150).
- `CI=true vitest run --config vitest.integration.config.ts` on api-key-project-capabilities, project-scoped-reach and ws-project-reach: 3 files, **165 tests passed**.
- `pnpm test:permissions`: 16 files, **107 tests passed**.

## Contract analysis
- **The change:** `resolveCallerIdentity` now supplies `capabilities: apiKeyCapabilitySubset(apiKey)` on the key fact. `resolveIdentity` already requires a defined subset for a key credential (`keyCapabilitiesFor`: `facts.apiKey?.capabilities ?? []`) and the evaluator enforces "api_key credential with no loaded subset holds nothing" (rbac.md, "Missing key-capability data clamps to nothing, never to the owner's full RBAC (#21)"). Before this PR the key identity had no subset, so every route that evaluated `can()` for a key failed closed (an availability defect, as #750 says).
- **AK-3 (personal key never exceeds its owner; clamped to the owner's current authority each request):** preserved. The identity still resolves the owner's authority and `can()` evaluates owner RBAC intersected with the key subset (the rbac.md formula "current owner RBAC ∩ key capability subset ∩ current reach ∩ route policy"). Reach is unchanged, so an outsider's key stays a 404; a disabled key or owner-mismatch is still refused earlier by the S4 checks in `resolveIdentity`.
- **Fail-closed:** the projection is the same `apiKeyCapabilitySubset` used by the request adapter and the sockets (#749): null, non-object, array, or any non-string action gives an empty subset (nothing granted); only exact `resource:action` pairs present in the canonical capability registry survive; unknown better-auth statements never become capabilities. Tests assert null, malformed and insufficient stored scopes are still refused, a scope the owner lacks is refused like the session, an outsider is 404, a disabled key is refused, and a scope that implies read (`project:update`) holds read as for a session role.
- **Behaviour that widens:** only on routes whose gate evaluated `can()` through `resolveCallerIdentity` for a key (project read/detail and the reach helpers; `callerReach`), where a correctly scoped key that the owner could use now succeeds instead of 403. That is the intended repair; it cannot exceed the owner session's answer by construction. Write routes that use `deferApiKeyCapability` keep deferring the key scope to the downstream key-aware gate (comment updated); there the key is not yet held to the owner's project role. That is the exact gap #724 closes in the stacked PR #784, so **#783 should not be the last word on authority for those routes and #784 should merge with or immediately after it**.
- **Mapping limit (residual, availability only):** keys whose stored scope uses legacy statement names that are not canonical capability strings (for example a `task` resource) project to no capability on these strict routes, so they remain 403; this is fail-closed and consistent with the sockets.

## Findings
**Blocking:** none.
**Non-blocking:** (1) the legacy-statement-to-canonical mapping gap above should be tracked so operators know scopes must be canonical; (2) a short note in rbac.md that REST reach gates and sockets now share one projection would document the consistency (the code comment already says so).

**Verdict:** APPROVE


## Authentic report — 784-ordinary-a-sonnet.md

Origin SHA-256 `e5108003e87d7c0efa9e08bcd41e4c1943c99a4808214b664f4acc573b7afb87`.

# PR #784 ordinary review A (#724: clamp API-key authority by the owner's project role; stacked on #783)

**Reviewed head:** 00ce4b517f83587f0f46fa165b6d477dae187996
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)

Head confirmed with `gh pr view 784` (base main; 341f365d, the #783 head, is its parent, so this reviews the #724 commit `00ce4b51` over #783). Security-scope; this ordinary review does not replace the required Sol review. Diff of the #724 commit: 6 source files (+~100) and two new test files (+534). Scratch worktree removed afterwards.

## Correctness (line level)
- `ProjectReadDecision` gains `ownerCapable`: the OWNER's authority in the project (workspace role overridden by project role) with any key scope removed. `ownerAuthorityView(identity)` copies `authority`, forces `credential: "session"` and drops `keyCapabilities`, so `can()` evaluates owner RBAC only. For a session identity `ownerCapable === capable`; for a key, `ownerCapable` is computed through that view. `hasProjectReadCapability` was widened to `Pick<ResolvedIdentity, "authority"|"keyCapabilities"> & {credential?}`; typecheck passes.
- `projectCapabilityRefused(decision, {deferCapability, deferApiKeyCapability, isApiKey})`: `deferCapability` returns false (handler decides, unchanged); a key on a `deferApiKeyCapability` route is refused iff `!ownerCapable` (its scope still goes to the downstream legacy gate, but the owner's project authority is now enforced here, which is the #724 gap); everything else is refused iff `!capable`. Session behaviour is byte-equivalent to before. Used identically in the four gates: `requireWorkItemReach`, `requireAttachmentReach`, `assertWorkItemProjectReach`, `workspaceAccessMiddleware`.
- `projectReadDecision`: early return only when both `capable` and `ownerCapable`; the `orSelfTarget`/`orOwner` branch capabilities are now evaluated for both the key's view and the owner view, so a key is not clamped harder than the session on those branches. Correct.
- `callerReach().can` for keys: previously `return true` for any key (deferred to the legacy gate); now evaluates the capability against `ownerAuthorityView(identity)` on the row's project. This is the intended "key never does what its owner's session could not" for list/bulk per-row decisions; key scope still decided by the caller's legacy key-aware gate. Correct.
- Residual (design, not a defect in this diff): routes with `deferCapability: true` (time-entry x4, label, approval staff reach) receive no owner-project clamp in the gate because the whole decision is left to the handler; whether those handlers consult project role is outside this diff and not covered by the tests.

## Tests and mutations (CI=true Testcontainers)
- New files: api-key-project-role-clamp (matrix over ROUTES with read-only-lead key vs session, capable-member key still works, bulk delete/assign, outsider 404, narrower scope still narrows, project-level writes) and api-key-project-role-clamp-strict. With neighbours (api-key-project-capabilities, project-reach-reads, work-item-project-reach-credentials, project-reach-writes, work-item-project-reach): 7 files, 225 tests passed.
- Mutations on the two new files (each reverted, tree clean):
  1. deferred-key branch returns `false` (no owner clamp): 21 failures. Killed.
  2. `ownerCapable` forced equal to `capable`: survived (56/56).
  3. `callerReach().can` back to `true` for keys: 2 fail (strict test and bulk delete/assign). Killed.
  4. `workspaceAccessMiddleware` reverted to the old condition: 10 fail. Killed.
  5. `requireAttachmentReach` reverted to the old condition: survived (56/56).
  6. `assertWorkItemProjectReach` reverted to the old condition: survived (56/56).
  7. `requireWorkItemReach` reverted: 11 fail. Killed.
- Survivors mean: the attachment gate and `assertWorkItemProjectReach` (used by comment reach and the task-relation routes) have been changed without a test that fails when the clamp is removed, even though attachment and comment routes are in the matrix (their refusal is masked by another layer or the matrix status for those routes). Mutation 2 survives because every test key is full-scope: the distinction between "owner clamp" and "owner intersect key canonical scope" on a `deferApiKeyCapability` route (a key whose canonical subset is narrower than the legacy statements but whose owner can do the write) is not asserted.

## Findings
Blocking:
1. Test gap on a security-scope change: the clamp in `requireAttachmentReach` and `assertWorkItemProjectReach` is not protected by any test (mutations 5 and 6 survive). Add per-route cases that reach those gates with a read-only-project-role owner's full-scope key (attachment delete/complete/presign, comment edit/delete, task-relation write) and assert the session-equal 403 and no write; and add a key whose canonical scope is narrower than its legacy statements to pin the `ownerCapable` vs `capable` split (mutation 2).
Non-blocking:
2. Document (decision log/rbac note) that `deferCapability` routes leave the owner-project clamp to the handler, or add a test per such route family.
3. `ownerAuthorityView` builds a structural subset of `ResolvedIdentity`; fine now, but a future field read by `can()` would silently be absent. A comment pointing at `can()`'s inputs would help.

## Residual risk
The core mechanism is correct and consistently applied; the risk is regression in two gates whose changes are unguarded by tests.

**Verdict:** REQUEST CHANGES


## Authentic report — 784-ordinary-b-sonnet.md

Origin SHA-256 `bd809ab597ffe180be3bd4da1140b0965c7977688af8f5e5d06dd7aceea2b87e`.

# Ordinary review B, PR #784 (#724: clamp API keys by the owner's project role): contract and consistency

**Reviewed head:** 00ce4b517f83587f0f46fa165b6d477dae187996
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** stacked on #783 head 341f365d3fe72ae4e5059560f82d491791d4a375 (one commit, 00ce4b51, "fix(api): clamp api key authority by the owner's project role (#724)"); reviewed as 341f365d..00ce4b51.
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; targeted tests.

## Commands and counts
- `gh pr view 784 --json headRefOid` = head above. Delta: 6 source files (attachment, work-item and workspace-access gates, assert-work-item-project-reach, caller-reach, has-project-reach) and two new test files (+534).
- `CI=true vitest run --config vitest.integration.config.ts` on api-key-project-role-clamp, api-key-project-role-clamp-strict, api-key-project-capabilities, project-scoped-reach, project-reach-writes, ws-project-reach: 6 files, **238 tests passed**.
- `pnpm test:permissions`: 16 files, **107 tests passed**.

## Against the owner decision on #724 and rbac.md
Decision: a key's effective authority is its stored scope intersected with the owner's current authority in that project (workspace role and project role), so a key never exceeds what the owner's session can do there; implement in the key-aware gates and caller-reach, with tests.
- **Mechanism:** `ProjectReadDecision` gains `ownerCapable`, the owner's authority in the project computed from the same `identity.authority` with the key credential and subset stripped (`ownerAuthorityView`). That authority already resolves project role over workspace role and the explicit `sees_all` grants for owners and admins, so the project-role semantics are those of `can()` for sessions, not re-implemented. For a key `capable` is key scope ∩ owner authority (from #783), hence `capable` implies `ownerCapable`.
- **The four reach gates** (`workspaceAccessMiddleware`, `requireWorkItemReach`, `requireAttachmentReach`, `assertWorkItemProjectReach`) now share `projectCapabilityRefused`: `deferCapability` refuses nothing (handler decides); a key on a `deferApiKeyCapability` route is refused when the owner lacks the capability in the project (the key scope stays with the downstream legacy gate); everything else is refused when not `capable`. This is exactly the missing clamp: previously deferral skipped capability for keys altogether, so a lead with a read-only project role could write with a full-scope key.
- **`callerReach().can`:** for keys it returned `true` (deferring entirely); it now returns the owner's project authority for the row, so bulk and list-style routes refuse per item like the session. This narrows behaviour, as intended.
- **`projectReadDecision`:** the early return now requires both `capable` and `ownerCapable`; the branch capabilities (`orSelfTarget`, `orOwner`) are evaluated for both the credential and the owner, keeping the self-assign and own-assignment conjunctions consistent.
- **Existence oracle unchanged:** in each gate the 404 for an unreachable or missing target is thrown before the capability decision, and `reachable` is computed exactly as before; tests assert an outsider's full-scope key is still 404 on item writes and project writes, and that a capable member's key answers like that member's session.
- **sees_all and project-creator lead:** inherited through `identity.authority`, so owners and admins (explicit `sees_all` grant) and a creator holding the `project-lead` role behave as their session does. Tests cover "an owner or admin with no project override is unaffected", a project role that grants more than the workspace role being honoured (the key is not clamped below its owner), a narrower key scope still narrowing a capable owner, read-only-project-role leads for PATCH, rank, delete, bulk delete and bulk assign, and project-level writes (PUT, health, milestones, archive, DELETE) for lead and admin. There is no dedicated test naming `sees_all` or the project-creator grant; non-blocking suggestion to add one case each.

## Routes left on `deferCapability`: is the justification sound?
The remaining users are approval (`staffReach`), label and time-entry routes. Their capability gates are workspace-level or handler-owned (`requireWorkspaceCapability("workspace:read")`, `time_entry:*`, approver predicates), and the time-entry policy documents decision 720-A: reach was added there without changing who may act. For these routes the owner's session is not project-role-clamped either, so the invariant "a key never exceeds its owner's session" holds without a clamp. If a future decision makes those routes project-role-aware for sessions, the key path follows automatically only if the handler uses `can()`; worth stating in the code comment (the helper's comment already says deferral leaves the decision to the handler).

## Findings
**Blocking:** none.
**Non-blocking:** (1) add one test each for an owner/admin `sees_all` key and a project-creator (`project-lead`) key; (2) record in the PR that the stacked order is #783 then #784, and that `callerReach().can` and every `deferApiKeyCapability` write route now refuse where they previously allowed, which is the intended behaviour change for operators with scoped keys; (3) the decision-log entry for #724 is in #780.

## Residual risk
Routes that evaluate capability inside handlers with `assertCallerHasCapability` (workspace-level role and key scope) were not individually re-audited; the tests above cover the four reach gates, project writes and bulk paths.

**Verdict:** APPROVE


## Authentic report — takeover/apikey-current-delta-luna.md

Origin SHA-256 `8faa6a30b18f8e8c0463791c777fb1b72e9ff3d5029128e821d1d51e11ab3bfc`.

# API-key candidates #783/#784: current-head delta and composition review

**Assigned model selection:** `gpt-6-luna`, `fork_turns=none` (dispatch metadata reported by the orchestrator). The runtime exposes only a generic GPT-6 identity to this reviewer; no more specific runtime version string was available. This report records the assigned lane and does not claim a runtime introspection result beyond that.

**Role:** independent ordinary delta/composition reviewer. I did not author, direct, or remediate either candidate. This is an additional current-head delta review; it does not replace the two original independent ordinary contexts or the required security review.

## Exact source and history

- #783 current head: `e0d5e9c25a80ba65ed5392f5ce06e152347b5c7f`; reviewed base/head: `341f365d3fe72ae4e5059560f82d491791d4a375` → current.
- #784 current head: `1bd6851496e286a111a83c658fe44bd116e11e74`; earlier A/B review head: `00ce4b517f83587f0f46fa165b6d477dae187996`; #783 base for #724: `341f365d3fe72ae4e5059560f82d491791d4a375`.
- #783 has one intervening commit, `e0d5e9c2`, adding integration cases for mixed malformed scopes and the milestones route plus malformed-projection unit cases.
- #784 current history includes the merge of current #783 (`bf33665a`) and two follow-up test commits: `bf33665a` adds the attachment/task-relation coverage, and `5ff0df58` types the own-row fixture. The original #724 production commit remains `00ce4b51`.
- `git diff --quiet` confirmed `apps/api/src` identical across `341f..e0d5` and across `00ce..1bd6`. The #783 delta is tests only. The #784 diff from its previously reviewed head is tests only (three test files); no production file, policy, contract, or dependency changed.
- `git diff --check` passed for both ranges. Worktree status was clean before/after review.

## Findings and disposition

The original #783 ordinary reports are retained at `783-ordinary-a-sonnet.md` and `783-ordinary-b-sonnet.md`; both reviewed `341f365d` and approved. The original #784 reports are retained at `784-ordinary-a-sonnet.md` and `784-ordinary-b-sonnet.md`; A requested changes for tests that killed the attachment-gate and `assertWorkItemProjectReach` mutants and for the owner-capability versus key-scope distinction. B approved the original code and raised no blockers. I inspected the exact intervening commits and current test sources rather than treating the old reports as approval of the new head.

**#783 disposition: original blocking findings closed by the current tests.** The mixed valid/malformed cases (in both member orders and with a non-array resource) assert a 403; null and mixed-malformed stored scopes are also rejected on `/api/project/{id}/milestones`, with a valid-scope 200 control. The unit test patch adds malformed actions in positions that distinguish fail-closed projection from skipping a malformed member. These cases address A’s two coverage gaps. The production projection is unchanged from the approved source.

**#784 disposition: original A blockers closed by the current tests, with author-attributed mutation evidence.** The added own-row matrix makes attachment rows belong to the read-only project-role owner, so ownership cannot mask the project-role refusal; it asserts session/key 403 and an unchanged snapshot for attachment delete/complete and comment edit/delete routes. The task-relation case uses a workspace admin with read-only project role and checks both POST and DELETE are 403 for session/key with unchanged relation rows, covering the deferred `assertWorkItemProjectReach` path. The legacy `work_item:update`-only key on attachment DELETE distinguishes the owner’s capability from the key’s canonical subset; narrower-key and matching-key cases cover the other direction of the intersection. The existing bulk test compares session and key denials for delete and assign and checks the snapshot remains unchanged.

The retained implementation reports `750-impl-sonnet.md` and `724-impl-sonnet.md` attribute the follow-up mutation runs to the Claude Sonnet 5.5 author. The latter says attachment-gate revert was killed by two failures, `assertWorkItemProjectReach` revert by the task-relation refusal, and computing `ownerCapable` from the key-clamped view by the canonical-versus-legacy attachment case; it also says the narrower scope/owner-role regressions passed. I verified that the current test source contains those distinguishing cases. I did **not** rerun PostgreSQL/Testcontainers or mutation runs, so those outcomes remain author-reported evidence, not tests executed by this reviewer.

The requested behavior matrix is represented in the current tests: owner project-role clamp paired with stored scope, malformed/null scope, capability implication (`project:update` implies read), disabled-key refusal (401), outsider non-reach (404), valid/capable key success, and bulk denied no-write. The disabled-key case tests a row already marked disabled; it does not itself exercise a previously successful token immediately after the disable transition. This is a coverage limit, not a new blocker in the unchanged production source.

**Verdict: CLEAR for the current ordinary delta/composition scope.** The prior #784 A blockers are closed by new distinguishing tests and retained author-reported mutation results; no new blocking issue was found by static inspection. This verdict does not authorize merge or claim final acceptance.

## Checks actually run here

- `git show`, commit-parent/log inspection, and immutable-object diffs for the exact ranges above.
- `git diff --quiet … -- apps/api/src` for #783 and #784; both returned exit 0 (production source unchanged).
- `git diff --check` for both exact ranges; passed.
- Read exact current test blobs with `git show` / `git grep`; inspected the paired success, denial, and no-write assertions.
- No test suite, mutation run, PostgreSQL, Docker, browser, or CI command was run. The visual container owns the runtime window per the assignment.

## Remaining gates

The required independent GPT-6 Sol security review and green status checks on the exact current PR heads remain outstanding to this review. This report is not a phase-finalizer pass, security clearance, merge authorization, or task/phase acceptance.


## Authentic report — takeover/apikey-security-sol.md

Origin SHA-256 `fc831e9c42f40341bbb332b2ae5910b22822a2c8c9efc9b18839ad42e2fc32fa`.

# Security review: API-key capability projection and project-role clamp (#783 / #784)

**Reviewed head #783:** `e0d5e9c25a80ba65ed5392f5ce06e152347b5c7f`  
**Reviewed head #784:** `1bd6851496e286a111a83c658fe44bd116e11e74`  
**Comparison base:** `c35666c531c4b84c300bac5432fd4dc8dca3ed4f` (merge base of current `main` `a07df324` and both heads). #784 contains #783.  
**Role and provenance:** fresh independent full security reviewer. Orchestrator dispatch specified `gpt-6-sol`, `fork_turns=none`; this context did not author, direct, or remediate either candidate. The runtime did not expose a more specific model/version string for me to inspect, so `gpt-6-sol` is dispatch provenance, not a claimed runtime introspection result.  
**Method:** read-only inspection of immutable Git objects in `/Users/heinthura/.codex/worktrees/carrier1/Ticketing.v2`. No source edit, design, merge, runtime suite, container, or browser action.

## Contract and security result

The 2026-10-15 owner decision says a personal key's effective authority is its stored scope intersected with the owner's **current** workspace and project authority, never more than the owner's session can do in that project. `webhooks-and-api-keys.md` AK-3 and `rbac.md` give the same current-owner ceiling; the latter says a project role overrides a workspace role. ADR 0003 identifies Better Auth as the API-key foundation. The reviewed implementation is a bounded repair on that existing path, not the unbuilt P4 service-key extension.

For #783, `resolveCallerIdentity` now passes `apiKeyCapabilitySubset(apiKey)` into `resolveIdentity`. The subset is taken from the authenticated key's stored permissions, admits only registered exact `resource:action` pairs, and returns an empty set for missing, null, non-object, array, or any malformed action array. `can()` expands implications and intersects that subset with live owner authority; it fails closed if a key identity lacks capability data. Thus the strict project/reach gates can grant a legitimate scoped key where its owner is capable, without inheriting the owner's full authority from an absent scope. The current tests cover mixed valid/malformed members, null scope, a second project route, implication (`project:update` implies read), disabled key, outsider, and a valid key. Unknown legacy statements can remain unavailable on strict canonical routes; that is a fail-closed availability limit.

For #784, `evaluateProjectRead` computes both the key-clamped `capable` and the session-equivalent `ownerCapable` from the same live authority facts. `projectCapabilityRefused` applies the owner ceiling even when `deferApiKeyCapability` leaves the stored key scope to a downstream legacy gate. The shared helper is used at the project/work-item middleware, attachment, and `assertWorkItemProjectReach` gates. Reach is refused as 404 before capability is refused as 403. `callerReach().can` also checks the owner's project authority on each row of bulk writes and relation targets; the route's existing key-aware gate continues to decide stored key scope. The current tests distinguish session/key denials and no-write results for read-only project roles, bulk delete/assign, own-row attachment and comment writes, task relations, narrower key scopes, and legitimate capable keys. A key can no longer use a broad workspace role to write through a narrower project-role override on these paths.

`deferCapability: true` still leaves the whole capability decision to the handler. Its extant call sites are time-entry, label, and approval routes, whose documented runtime checks are handler/workspace based; this diff does not newly claim those routes have a project-role capability clamp. The same route-specific capability behavior applies to the owner's session. This is a documented semantic boundary, not a finding that the new helper bypasses a newly imposed check. Future changes that make those routes project-role aware must update their handlers and key path together.

The earlier independent Sonnet ordinary reports remain attributed to their actual contexts. The #783 reports reviewed `341f365d` and the #784 reports reviewed `00ce4b51`; #784 A requested stronger regression cases, while B approved. The current ordinary delta report inspected the test-only follow-ups and disposed of A's test blockers. The retained author reports `750-impl-sonnet.md` and `724-impl-sonnet.md` remain author mutation evidence, not tests run by this reviewer. I independently inspected the current source and test cases. Git object comparison confirms production source is unchanged from those earlier reviewed implementation commits (`341f365d..e0d5e9c2` and `00ce4b51..1bd68514` differ only in tests).

## Findings and verdict

**Blocking findings:** none in the composed #784 head.

**Non-blocking limits:** (1) #783 by itself does not close the pre-existing deferred-write owner-project gap; its security acceptance should be paired with #784 or followed immediately by it, never described as complete project-role clamping on its own. (2) Legacy statement names that are not canonical capabilities may deny otherwise legitimate keys on strict routes. (3) The current disabled-key test starts from an already disabled row; it does not exercise a successful token immediately after a disable transition. (4) This review did not re-test handler-owned `deferCapability` route families or perform a race/concurrency probe. None of these observations supplies a new grant path in the reviewed composition.

**Verdict:** **APPROVE** the current #783 and #784 security composition at the exact heads above, with #784 required for the owner-project ceiling. This is an independent security verdict only; it is not CI, merge, release, or phase acceptance. It does not clear red/cancelled checks or stale heads.

## Evidence actually gathered

- `git cat-file`, `git merge-base`, `git log`, `git diff --stat`, immutable `git show`, and `git grep` for both exact heads; examined six changed production files in #784 and the #783 identity projection, plus policy/evaluator, key-scope parser, authentication and caller-reach call sites.
- `git diff --quiet 341f365d..e0d5e9c2 -- apps/api/src` and `git diff --quiet 00ce4b51..1bd68514 -- apps/api/src`: both exited 0, confirming no follow-up production-source delta.
- `git diff --check` for both candidate ranges against the common base: no whitespace errors. Worktree status: clean.
- `gh pr view 783/784 --json headRefOid,baseRefOid,state,statusCheckRollup` confirmed the assigned exact heads remained open during review. Several required checks were cancelled at inspection time; this report makes no green-check claim.
- **Tests executed in this review: 0 files / 0 cases.** PostgreSQL/Testcontainers, mutation runs, Docker, browser, and CI were not run because the pinned visual run owns the laptop runtime window. Prior ordinary reports' test counts and the author's mutation outcomes are historical attributed evidence, not rerun results here.




---

Retained evidence packet 2; origin `apikey-current-main-ordinary-luna.md`; SHA-256 `938165dbef010bcde6f14019f2cbde16ef9496e0bf05aba2de454a7832291a6d`; 5634 original bytes.

# API-key capability and project-role clamp: current-main composition review

**Exact reviewed head:** `64d7ec773fa53f4396d56f82866fc8e1305c706d`  
**Comparison base / accepted main:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`  
**Prior paired source:** `1bd6851496e286a111a83c658fe44bd116e11e74`  
**Reviewed tree:** `d13ab2133a93cb0bf8d7816e3ee3f1df40adf33c`  
**Role:** fresh independent ordinary composition reviewer. I did not author, direct, or remediate the candidates.  
**Model provenance:** this context identifies as GPT-6; the runtime did not expose a more specific model/version or dispatch metadata. I do not claim a Luna/Sol variant based on inference.

## Scope

I reviewed the exact automatic merge of accepted main into the paired #783/#784 API-key capability and owner project-role clamp source. The accepted-main delta is ten feature/test paths: six API authorization/reach helpers, three API integration tests and one API unit test (1,083 additions / 34 deletions against accepted main). The review focused on interactions introduced by the composition: current owner authority versus stored key scope; helper behavior across immediate and deferred gates; malformed/null stored scopes; outsiders and disabled/revoked credentials; bulk and row writes; and the previously reviewed attachment gate.

The attached report `apikey-current-delta-luna.md` and earlier ordinary/security reports were read as historical evidence. I rechecked the current merged source and tests directly; their verdicts were not treated as coverage of this exact composition. The earlier attachment clamp change `00ce4b517f83587f0f46fa165b6d477dae187996` is an ancestor of the exact head. The current attachment helper calls the shared `projectCapabilityRefused` decision, preserving the previously reviewed attachment path in the composed implementation.

## Review result

The composition preserves the intended personal-key authority intersection: key scope is evaluated against current owner authority; the owner authority view removes the key's stored subset only to calculate the owner ceiling; and the ordinary `capable` result remains the key-scope intersection. `projectCapabilityRefused` applies the owner ceiling on `deferApiKeyCapability` paths while leaving the stored key scope to the downstream legacy key-aware gate. `deferCapability` still delegates the full decision to its handler. I found no mismatch in the composed call sites across work-item, workspace access, attachment and task-relation reach checks.

The current tests directly cover null, malformed and mixed valid/malformed scope projections, both mixed-member orders, a second project reach route, capability implication, outsider 404, disabled-key 401, a read-only key under a capable owner, and a broad key under a read-only project override. They compare session and key denials for bulk delete/assign and assert unchanged state; test own-row attachment/comment writes so ownership cannot mask denial; exercise task-relation create/delete through the deferred key-scope path; and include allowed controls for capable owners and matching scope. The separate identity integration file's disabled-key test begins with a disabled row; it does not independently prove a successful token becomes invalid immediately after a revocation transition. Existing authentication/revocation behavior was not changed in this merge delta, so this remains a coverage limit rather than a composition blocker.

**Blocking findings:** none found by static review.  
**Non-blocking residuals:** no successful-token-then-revoke transition was executed here; the API integration suite did not complete in this environment, so the no-write and PostgreSQL cases remain source-inspected rather than freshly reproduced. No container/runtime or browser evidence is claimed.

**Verdict: CLEAR for the ordinary current-main composition scope at `64d7ec773fa53f4396d56f82866fc8e1305c706d`.** This verdict does not authorize acceptance, release, merge, or any other gate disposition; it is not a security review or phase finalizer.

## Checks and inspection actually performed

- Read repository `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, active mission, relevant API-key/RBAC feature text, and the supplied authentic prior review reports.
- Verified `HEAD`, clean initial worktree, first-parent merge composition, exact ten-path diff/stat against accepted main, and the reviewed tree object.
- Inspected the complete changed authorization helpers and relevant current integration-test sections; confirmed the attachment clamp commit is an ancestor of this head.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c...HEAD` passed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/utils/require-api-key-permission-scope.test.ts`: **1 file / 10 tests passed**.
- `pnpm --filter @taskdesk/api typecheck`: completed without diagnostics; the command process exited before its final poll, so no explicit exit code was surfaced by the tool.
- Attempted the three targeted API integration files with `vitest.integration.config.ts`; Vitest printed its startup banner but produced no test discovery/result for over a minute. I interrupted that stalled run. No integration pass is claimed. Docker/PostgreSQL availability and runtime integration were not established.
- A first unit invocation used a nonexistent `vitest.unit.config.ts` and failed at config loading; corrected invocation above passed. This is recorded to preserve the actual check history.

No repository files were edited. The checkout was clean after review.


---

Retained evidence packet 3; origin `apikey-current-main-security-sol.md`; SHA-256 `37b94b7ee000eb97d2070cd4930e993d916478fc67cab1e3a751b5439152a66b`; 7504 original bytes.

# Full security review: API-key/project-role clamp on accepted main (#783/#784)

**Reviewed head:** `64d7ec773fa53f4396d56f82866fc8e1305c706d`  
**Reviewed tree:** `d13ab2133a93cb0bf8d7816e3ee3f1df40adf33c`  
**Comparison base (accepted main):** `e9df2294fa580fd2885343bbef0cec28e81ead4c`  
**Retained paired source:** `1bd6851496e286a111a83c658fe44bd116e11e74`  
**Role and independence:** fresh independent full security reviewer, dispatched as GPT-6 Sol for the current-main composition. I did not author, direct, or remediate the candidate or accepted-main project change. The runtime did not expose a more specific model/version string; Sol is dispatch provenance, not introspected model metadata. This is a read-only source review, not a phase finalizer or acceptance run.

## Scope and source conservation

I read the current repository AGENTS.md, active mission, agent workflow, CLAUDE.md, RBAC and API-key contracts, relevant source and tests, prior paired ordinary/full Sol reports, and the current-main ordinary report. The candidate is a clean first-parent merge of accepted main into the retained pair. Its ten API-key production/test paths equal the paired source byte for byte; eleven imported accepted-main paths equal `e9df2294` byte for byte, as recorded in `apikey-current-source-conservation.json` and spot-checked against the Git diff. The attachment clamp `00ce4b517f83587f0f46fa165b6d477dae187996` is an ancestor. No product file was edited.

I traced the authenticated key's stored Better Auth permission map through `verifyApiKey`, `apiKeyCapabilitySubset`, `resolveCallerIdentity`, `can`, `projectReadDecision`, and the deferred legacy gates. I checked project/work-item, attachment, task-relation and bulk call sites, then composed those paths with accepted main's `PUT /api/project/{id}` engagement-field check. The exact candidate's `apps/api/src/project/index.ts` adds `kind`, `supportLevel`, and `serviceCalendarId` to that strict field check.

## Security result

The paired API-key repair itself preserves the two clamps in the inspected paths. Missing, null or malformed stored scope projects to no canonical capabilities; unknown statements do not expand to grants. A key's canonical `capable` is current owner authority intersected with its stored scope. Deferred key-aware writes use `ownerCapable` for the current project-role ceiling and the downstream legacy gate for stored key scope. Per-row bulk authorization checks owner project authority after reach; the bulk handler first checks the stored key scope. Out-of-reach records are masked before 403 capability refusals. The attachment helper uses the same refusal predicate. `verifyApiKey` loads only enabled, unexpired keys and checks the current owner's active/unbanned status. These are source conclusions; I did not execute PostgreSQL or a revoke transition.

**Blocking finding — accepted-main engagement-field gate ignores project-role override, and the composed API-key path can use it.** The authoritative RBAC rule says a project role overrides a workspace role for that project (`docs/01-architecture/rbac.md`, Authority); `projects-and-engagements.md` requires `project:manage_settings` for each engagement field. The new handler checks `project:manage_settings` via `assertCallerHasCapability(workspaceId, userId, ..., capabilityCredential(c.get("apiKey")))`. That helper explicitly reads only `workspaceMemberRoles` and `builtInRoleHasCapability` for the workspace. It never takes `projectId` or evaluates the target project's overriding role. The preceding `workspaceAccess.fromProject(..., {requireProjectReach: true, deferApiKeyCapability: true})` checks only the route's baseline `project:update` under the project override, then defers the key's stored scope to `requireWorkspacePermission({project:["update"]})`. A project role containing `project:update` but excluding `project:manage_settings` therefore passes that baseline. A broad workspace manager/admin role supplies the missing field capability to the handler despite the overriding project role.

Concrete PostgreSQL reproduction to add/run: create an active staff member with a workspace `manager` (or `admin`) role and a reachable live project; give that person an explicit project role with `project:read` and `project:update`, excluding `project:manage_settings`; retain a valid legacy workspace `project:update` statement. First confirm the same person's session can perform a plain name-only `PUT /api/project/{id}`. Then send `kind: "managed_service"` or `supportLevel: "L2"` to that route as the session and as a valid personal key with stored `project:read`, `project:update`, and `project:manage_settings` statements. The source predicts 200 and a changed engagement column for both, whereas the project-role contract requires 403 and no write. Check the persisted row after each denial/allowance. A narrower key lacking `manage_settings` is correctly refused, so the problem is the owner/project side of the field gate. The current accepted-main integration file does not test this fixture: its `actorWithLegacyMap` unconditionally calls `grantProjectManageAccess`, whose project role explicitly includes `project:manage_settings`; its lead-like denial therefore measures the workspace role, not a narrower project override.

This mechanism is present in the accepted-main import, not introduced by the byte-identical #783/#784 source. I found no key-greater-than-owner-session grant in the reviewed composition: the same unsupported engagement update is available to the owner's session. It still blocks security clearance of the combined candidate against the authoritative project-role contract, especially because the candidate makes legitimate scoped keys usable at this handler. Remediation should use target-project canonical authority for this field-level check while retaining the stored-key intersection, with a regression for both session and key and a capable control. No policy weakening or gate waiver is implied.

**Verdict: BLOCKED for current-main security composition at `64d7ec773fa53f4396d56f82866fc8e1305c706d` pending correction and independent re-review.** The prior paired Sol clearance remains valid for its unchanged source, and the current ordinary CLEAR remains its own report; neither adjudicates this accepted-main interaction. This report grants no merge, image, runtime, release, or stage acceptance.

## Checks and limits

- `git status --short --branch`, `git rev-parse HEAD`, `HEAD^{tree}`, source/merge diffs, and ancestry check: assigned clean head/tree and attachment ancestor confirmed.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c...HEAD`: exit 0.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/utils/require-api-key-permission-scope.test.ts`: exit 0, 1 file / 10 tests passed. This tests scope projection, not the PostgreSQL engagement counterexample.
- `pnpm --filter @taskdesk/api typecheck`: exit 0 after all configured TypeScript projects completed.
- PostgreSQL integration, revocation transition, container boot, browser and hosted CI: not run by this reviewer. The current-main ordinary review attempted an integration suite that stalled before results; it is not counted as a pass here. The blocking counterexample is a source-derived authorization trace, awaiting an executable regression.

The checkout remained clean at the exact head after review. No repo source, PR body, commit, push, or merge was changed.


---

Retained evidence packet 4; origin `apikey-project-settings-authority-repair-luna.md`; SHA-256 `f7ee6b8e3d277d5a9f903d59af299365709ec41c108fb46e58bf9739f4e58a20`; 2716 original bytes.

# API-key/project-settings authority repair

**Source head:** `596a2332381e16d89e6bf90a8d679d0cb3a022d8`
**Parent source:** `64d7ec773fa53f4396d56f82866fc8e1305c706d`
**Branch:** `codex/api-key-project-role-clamp-724`
**Worktree:** `/Users/heinthura/.codex/worktrees/api750/Ticketing.v2`
**Model provenance:** GPT-6 Codex agent context; no more specific model/version was exposed by this runtime. The requested `-luna` report filename is not evidence of a Luna model identity.
**Role:** bounded implementation and regression-test author; not an independent review.

## Change

The strict `project:manage_settings` field check in `PUT /api/project/{id}` now resolves the request identity and evaluates the target project's canonical capability using the project reach facts already established by reach middleware. This applies uniformly to `kind`, `supportLevel`, `serviceCalendarId`, and `defaultCommentVisibility`. The route's legacy `project:update` baseline remains unchanged; API-key scope is still applied by the canonical identity evaluator. Missing identity/facts or missing capability fails with 403 before the existing project read/write path.

The integration regression creates a workspace manager with a project override containing `project:read` and `project:update` only. It sends engagement and default-comment-visibility updates once as a session and once as a key whose stored scope includes `manage_settings`, asserting 403 and unchanged stored settings each time. Existing allowed project-settings cases remain in the same suite.

## Changed files

- `apps/api/src/project/index.ts`
- `tests/api-integration/project-engagement-manage-settings.test.ts`

No schema, capability, role, route-policy, dependency, or shared helper changes. The prior Sol finding report was not modified.

## Checks on exact source

- `pnpm exec biome check apps/api/src/project/index.ts tests/api-integration/project-engagement-manage-settings.test.ts` — passed.
- `git diff --check` — passed before commit.
- `pnpm --filter @taskdesk/api typecheck` — passed (all configured API TypeScript projects).
- PostgreSQL integration test — not run; PostgreSQL runtime was unavailable per task constraints. Docker, browser, image, and runtime checks were not run.

The first typecheck attempt exposed typing issues in the new context/test code; those were corrected before the passing full typecheck. No passing PostgreSQL behavior is claimed.

## Residuals

The regression is compile-checked but has not been executed against PostgreSQL. Independent ordinary reviews and the fresh independent Sol security review remain pending. This report is implementation evidence only and grants no acceptance or merge authority.


---

Retained evidence packet 5; origin `apikey-project-settings-ordinary-a-luna.md`; SHA-256 `bb03264a1d898f0b98ca249f9842c0d45563e426d98419bedf51dcd1748a3024`; 5350 original bytes.

# API-key project-settings authority repair: ordinary review A

**Exact reviewed head:** `596a2332381e16d89e6bf90a8d679d0cb3a022d8`  
**Comparison base:** `64d7ec773fa53f4396d56f82866fc8e1305c706d`  
**Delta:** `apps/api/src/project/index.ts`; `tests/api-integration/project-engagement-manage-settings.test.ts`  
**Role and independence:** fresh independent ordinary reviewer A. I did not author, direct, or remediate the repair. I independently reviewed the exact two-path delta and the relevant current-main seam.  
**Model provenance:** this runtime identifies as GPT-6; no more specific model/version or dispatch metadata was exposed. The report filename is not a model assertion.

## Scope and evidence

I read the repository guidance and current API-key/RBAC/project-settings contracts, the exact `64d7ec77..596a2332` diff, the retained current-main Sol blocker report, and the implementation author's repair note. I treated the blocker and author report as leads and checked each material claim against current source and tests.

The change replaces the workspace-only `assertCallerHasCapability(..., "project:manage_settings", ...)` in `PUT /api/project/{id}` with `resolveCallerIdentity` plus `evaluateProjectRead` over the target project's `projectReachFacts`. The existing middleware first enforces target project reach and retains the legacy `project:update` baseline/key-aware gate. The handler then applies canonical `project:manage_settings` on that project. For keys, `resolveCallerIdentity` carries the parsed stored capability subset; `evaluateProjectRead` computes current owner project authority intersected with that subset. A missing identity or missing facts fails closed as 403. The target facts are the same project/workspace facts established by the route's row lookup and reach middleware, and the handler confirms the capability on those facts before entering its later project read/write path.

The repair therefore closes the reported case: a workspace manager whose target-project role has `project:read` and `project:update` but omits `project:manage_settings` cannot use the workspace role to set a protected project setting, whether via session or a key with broad stored scope. A key without the required stored setting scope also remains denied by the canonical evaluator. Current owner membership/role and key enabled/expiry/owner-active checks are resolved on the request path; no cached authority was introduced. The source path was inspected, not exercised against PostgreSQL.

The new integration fixture change is scoped and meaningful: `actorWithLegacyMap` uses `grantProjectRole` only when the new optional project-capability list is supplied; all existing tests retain their prior `grantProjectManageAccess` fixture. The new case explicitly creates the manager override without `manage_settings`, sends both `supportLevel` and `defaultCommentVisibility` as session and key, expects 403, and rereads persisted settings after each credential. The key includes `manage_settings`, which isolates the owner-role clamp from key-scope denial. This does not weaken expected outcomes or the prior allowed fixtures.

Existing cases in the same suite preserve relevant controls: the manager/owner/admin capable path can set engagement configuration; a project:update-only key is denied for a protected field but can rename; a lead-like role cannot be widened by a broad key; plain updates that omit protected fields preserve their behavior; health remains on project:update; explicit null protected fields are still treated as sent; and a SQL assertion ensures plain rename does not write engagement columns. The new test checks `kind`, `supportLevel`, `serviceCalendarId`, and `defaultCommentVisibility` remain unchanged on refusal through persisted-row assertions (the new case changes the first and last directly; prior table-driven cases cover the other fields).

## Findings and verdict

**Blocking findings:** none found in the reviewed delta or relevant authorization seam.  
**Non-blocking residual:** the decisive database-backed regression was not executed in this context, so 403/no-write behavior and fixture operation remain compile/static evidence until a real PostgreSQL run. No freshness/revocation runtime probe is claimed; those behaviors were traced to the existing request verification and identity-resolution source.

**Verdict: CLEAR for ordinary review A at exact head `596a2332381e16d89e6bf90a8d679d0cb3a022d8`.** This review is independent ordinary evidence only. It is not ordinary review B, the required Sol re-review, acceptance, or merge authorization.

## Checks actually run

- `git status --short --branch`, `git rev-parse HEAD`, exact two-path name/status/stat and diff inspection.
- `git diff --check 64d7ec773fa53f4396d56f82866fc8e1305c706d...HEAD`: exit 0.
- `pnpm exec biome check apps/api/src/project/index.ts tests/api-integration/project-engagement-manage-settings.test.ts`: exit 0, 2 files clean, no fixes applied.
- `pnpm --filter @taskdesk/api typecheck`: exit 0 across all configured API TypeScript projects.
- No unit test directly covers this handler repair. PostgreSQL integration, Docker, browser, image and hosted CI were not run; the assignment excluded PostgreSQL/Docker/browser.
- The worktree remained clean; no source, test, PR body, commit or push was changed.


---

Retained evidence packet 6; origin `apikey-project-settings-ordinary-b-luna.md`; SHA-256 `b4483ecce7251f1ecdcabd49b34b05da9a15f2539bf5ed4515863dc66a52b762`; 5322 original bytes.

# API-key project-settings authority repair: ordinary review B

**Exact reviewed head:** `596a2332381e16d89e6bf90a8d679d0cb3a022d8`  
**Comparison base:** `64d7ec773fa53f4396d56f82866fc8e1305c706d`  
**Delta:** `apps/api/src/project/index.ts`; `tests/api-integration/project-engagement-manage-settings.test.ts`  
**Role and independence:** fresh independent ordinary reviewer B. I did not author, direct, or remediate the repair. I independently reviewed the exact delta and its authority, reach, and API-key seams.  
**Model provenance:** this runtime identifies as a GPT-6 Codex agent context; it did not expose a more specific model/version or dispatch identity. The report filename is not a model assertion.

## Scope and evidence

I read the repository guidance, project-settings and API-key contracts, the relevant RBAC clauses, the exact two-file diff, and the retained source-bound author, ordinary-A, and current-main Sol reports. I checked the route's middleware configuration, project lookup, project-reach facts, canonical evaluator, key identity adapter, and fixture helper against the source rather than relying on the other reports' conclusions.

The strict `project:manage_settings` field check now calls `resolveCallerIdentity` and `evaluateProjectRead` with the route's `projectReachFacts`. The route still runs `workspaceAccess.fromProject("id", { requireProjectReach: true, deferApiKeyCapability: true })` and the existing legacy `project:update` key-aware gate before the handler. On a successful project lookup, the middleware obtains facts from the persisted project/workspace row, attaches them to context, and performs the required reach decision before continuing. If required reach facts are absent or mismatched, middleware fails before the handler. The handler also fails closed with 403 if identity/facts are absent or the canonical project decision lacks the capability. The project lookup and identity resolution are not conditional on the policy-shadow flag; that flag only enables an observer-only GET path for an unresolved lookup. Thus the new field gate receives the target project's facts in both shadow-disabled and shadow-enabled operation for this PUT route.

`evaluateProjectRead` invokes the shared canonical `can()` evaluator against scope `project` and the target project/workspace IDs. That evaluator applies a project-scoped role as an override of workspace authority for this project. For API keys, `resolveCallerIdentity` includes the key's parsed stored capability subset, so the decision is current owner authority in the target project intersected with the stored key scope. The prior legacy baseline and deferred-key-scope behavior remain intact. The field gate still runs before the handler's project read and all writes, and it only applies when one of the protected fields is present; omitted fields retain existing update behavior. I found no path by which broad workspace `manage_settings` can now defeat the project's narrower override, or by which a key's scope widens the owner's target-project authority.

The new regression uses a workspace manager and a project role containing only `project:read` and `project:update`. It exercises a session and a key whose stored scope includes `project:manage_settings`, checks both an engagement-field and `defaultCommentVisibility` refusal, and reads the persisted row after each credential. `grantProjectRole` creates that exact project-scoped capability set when no project membership exists; it does not union in the earlier broad helper's settings grant. Existing capable settings cases still use the prior broad project-role fixture, and existing API-key cases retain the narrower-key denial / authorized-key controls. The evaluator's unit suite also directly asserts project-role override behavior.

## Findings and verdict

**Blocking findings:** none found in the reviewed delta or its authority seam.

**Non-blocking residual:** the new database-backed session/key regression was not run here. Its 403 and persisted no-write outcomes are source/test evidence, not a PostgreSQL runtime result. Image build, container boot, browser verification, and hosted CI remain outside this review.

**Verdict: CLEAR for ordinary review B at exact head `596a2332381e16d89e6bf90a8d679d0cb3a022d8`.** This is ordinary-review evidence only. The fresh full GPT-6 Sol re-review required for the security-sensitive auth change remains outstanding; this report grants no merge, image, runtime, release, or stage acceptance.

## Checks actually run

- Confirmed clean checkout and exact `HEAD` / comparison base; inspected the two-path diff and `git diff --check` (exit 0).
- `pnpm exec biome check apps/api/src/project/index.ts tests/api-integration/project-engagement-manage-settings.test.ts` — passed, 2 files clean, no fixes applied.
- `pnpm --filter @taskdesk/api typecheck` — passed across the configured API TypeScript projects.
- `pnpm --filter @taskdesk/permissions exec vitest run src/evaluator.test.ts` — passed, 1 file / 60 tests, including project-role override coverage.
- The integration regression, PostgreSQL, Docker/image/runtime, browser, and hosted CI checks were not run. No PostgreSQL behavior is claimed.
- The worktree remained clean; no repository source, test, commit, push, or PR body was changed.


---

Retained evidence packet 7; origin `apikey-project-settings-security-current-sol.md`; SHA-256 `65a13466bb073d548dcdf5ba2607f23e91b9942a5205dea1115c98f7673c8f06`; 6801 original bytes.

# Full security review: API-key project authority and project-settings repair

**Reviewed head:** `596a2332381e16d89e6bf90a8d679d0cb3a022d8`  
**Immediate comparison base:** `64d7ec773fa53f4396d56f82866fc8e1305c706d`  
**Accepted-main composition base:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`  
**Role and independence:** fresh independent full security reviewer. I did not author, direct, or remediate this candidate, the paired API-key changes, or the two-file repair. I read the two ordinary CLEAR reports after they were complete but formed this verdict from source and checks. The dispatch requested a GPT-6 Sol security review; this runtime did not expose a finer model/version identifier for introspection. The filename and dispatch are provenance, not a claim of introspected model identity.

## Scope and method

Read repository AGENTS.md, active mission, agent workflow, CLAUDE.md, the approved RBAC, API-key and project-engagement contracts, the prior paired-source and current-main Sol reports, source-conservation record, both ordinary reports, and current source/tests. Inspected the exact `64d7ec77..596a2332` two-file delta and the `e9df2294..596a2332` composition. The repair changes the `PUT /api/project/{id}` protected-field check from workspace-only `assertCallerHasCapability` to `resolveCallerIdentity` plus `evaluateProjectRead` on target `projectReachFacts`; the integration case adds a workspace manager with a narrower project role and session/key refusals. The prior current-main Sol blocker was specifically the workspace-only check. The composed #783/#784 source remains the paired implementation recorded in the conservation file; the attachment clamp `00ce4b517f83587f0f46fa165b6d477dae187996` is an ancestor.

## Security trace

The route's `workspaceAccess.fromProject("id", { requireProjectReach: true, deferApiKeyCapability: true })` resolves the named project by persisted row, sets the matching project/workspace/organisation facts, and checks reach before capability. A missing or out-of-reach target answers 404 before the protected-field handler. Missing or mismatched facts fail in middleware. The policy-shadow observer branch is GET-only and does not feed this PUT. The existing `requireWorkspacePermission({ project: ["update"] })` remains the legacy baseline and stored-key update-scope gate. Deferred key capability in middleware still enforces `ownerCapable` for the target-project `project:update`; only the key-scope half is deferred.

For a body containing `kind`, `supportLevel`, `serviceCalendarId`, or `defaultCommentVisibility`, including explicit null, the handler now evaluates strict `project:manage_settings` against the target facts before its project read and any write. `resolveCallerIdentity` reloads current owner authority and, for a key, projects the authenticated key's parsed stored permissions through `apiKeyCapabilitySubset`. `can()` selects a project role over workspace roles for that project and intersects a key with its stored capability subset. Missing, null, or malformed stored permission maps yield no canonical capability. Thus a workspace manager with a target-project role containing `project:read` and `project:update` but excluding `project:manage_settings` is denied as both session and broadly scoped key. A narrower key also cannot exceed an owner who has settings authority. For omitted protected fields, the baseline `project:update` behavior and selective write path remain; health remains on `project:update`.

The surrounding #783/#784 paths retain their source-level owner ceiling: `projectCapabilityRefused` applies owner project authority on deferred key routes; `callerReach().can` applies it per bulk row after reach filtering; attachment, work-item and relation gates use the same project decision. `verifyApiKey` reloads enabled/unexpired key and active, unbanned owner on every verification; identity resolution reloads current role/membership. A key disable, role removal or owner deactivation is therefore read on the next request by source design. This review did not exercise a revocation transition against PostgreSQL. `deferCapability: true` remains an explicit handler-owned boundary on other route families, unchanged by this candidate; this review does not assert those families were newly clamped.

The new integration fixture uses `grantProjectRole` only for the new narrow-role case. Its session and key each send an engagement setting and default-comment visibility, expect 403, and reread the persisted row for no-write. Existing cases cover a capable settings owner/key, a key without settings scope, explicit-null refusal, health, plain update, and the non-writing engagement columns on plain rename. These are test assertions, not runtime PostgreSQL evidence in this review.

## Findings and verdict

**Blocking findings:** none found in the exact repair or the inspected composed authorization seams. The previous current-main blocker is addressed at this head.

**Non-blocking observations:** The handler comment still names the replaced `assertCallerHasCapability` helper; its mechanism description is stale, though the executable gate uses the canonical evaluator. The source review does not prove the new database-backed regression passes, a revocation transition is atomic with an in-flight request, or that the image boots. The requested PostgreSQL, Docker, browser, and hosted CI work was outside this read-only review and was not run.

**Verdict: CLEAR for the full security review at exact head `596a2332381e16d89e6bf90a8d679d0cb3a022d8`.** This is a source security verdict. It does not confer merge, image, runtime, release, SIT, or stage acceptance. Required hosted status checks, PostgreSQL integration, image build/boot/health proof and any other applicable acceptance gates remain for the conductor on this exact candidate.

## Checks actually run

- Confirmed clean worktree and exact HEAD/parent; inspected exact two-file delta, composed source, policies, evaluator, identity resolver, key verification, middleware, and tests.
- `git merge-base --is-ancestor 00ce4b517f83587f0f46fa165b6d477dae187996 HEAD`: exit 0.
- `git diff --check e9df2294fa580fd2885343bbef0cec28e81ead4c...HEAD`: exit 0.
- `pnpm --filter @taskdesk/permissions exec vitest run src/evaluator.test.ts`: 1 file, 60 tests passed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/utils/require-api-key-permission-scope.test.ts`: 1 file, 10 tests passed.
- `pnpm --filter @taskdesk/api typecheck`: exit 0 for all configured API TypeScript projects.
- PostgreSQL integration, Docker/image/container/health, browser, hosted CI, and revocation transition: not run. No source, test, PR, commit, push, or merge changed; the repository worktree remained clean.



## Hosted failure correction — current independent source clearance

**Reviewed head:** `bb1c79466c79a39904f9fec61fac3b58f0ab7660`

The authentic hosted result at3594 remains FAILED (206files/2999tests,4files/11tests failed). The bounded repair corrects overpowered and invalid negative fixtures, genuine canonical customer identity, owner-positive/key-negative scope setup, and the AK-3 scoped-comment positive oracle. Production authority/status is unchanged; the protected-field key-scope denial now retains its specific error when the owner is capable and key subset is insufficient. Strong independent ordinary review and fresh full independent Sol clear this source. PostgreSQL/image/required CI remain outstanding. #782 disposition exists only in unaccepted carrier791 and remains a dependency.

Conductor dispatch provenance: ordinary reviewer explicitly GPT-6 Luna; fresh security reviewer `/root/apikey_hosted_repair_security_current` spawned with `model: gpt-6-sol`, `fork_turns: none`. Reports preserve their actual runtime introspection limits; advisory failure adjudication is not implementation approval. The prior two adverse ordinary verdicts and all author reports follow unchanged. Publication changes only this own note.

---

### Authentic record: apikey-hosted-failures-adjudication-sol.md

# #784 hosted PostgreSQL failure adjudication — read-only advisory

**Model provenance:** GPT-6 Sol, fresh bounded critical adjudication context; no authorship, remediation, approval, or independent review of a future repair. **Frozen source:** `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74`, clean worktree `/Users/heinthura/.codex/worktrees/api750/Ticketing.v2`; PR #784 live head matched this SHA when checked. The reviewed predecessor was product `596a2332381e16d89e6bf90a8d679d0cb3a022d8`, followed by an own-note delta. No source was changed here.

**Evidence:** private hosted log `784-pg-3594cb34.log`, final Failed Tests block only; 206 files: 4 failed, 202 passed; 2,999 tests: 11 failed, 2,988 passed. No raw SQL, parameters, credentials, or unrelated diagnostic lines are reproduced. Live GitHub showed #784 open with required `integration - Postgres 18` red, registers red, and pull-request-template/security-review red; other current results do not cure those gates. The previously cleared ordinary/Sol source reviews predated any actual PG run and do not make this candidate merge ready.

**Authorities and checked paths:** `AGENTS.md`, active mission, agent workflow, `CLAUDE.md`; `docs/01-architecture/rbac.md` (project-role override, customer rule, project reach); `docs/03-features/projects-and-engagements.md` (PR-9, field-level manage-settings), `comments-and-activity.md` (CA-2, own comment edit), `webhooks-and-api-keys.md` (AK-3 stored subset intersected with live owner authority), `customer-portal.md`, decision log (owner/role/reach decisions); `apps/api/src/project/index.ts`, `project/policy.ts`, `utils/has-project-reach.ts`, `utils/require-api-key-permission-scope.ts`, `utils/require-workspace-capability.ts`, `work-item/controllers/update-comment.ts`; four failing integration files and `tests/api-integration/helpers/fixtures.ts`. `gh pr view 784` and `gh pr view 782` were read-only live checks. The current source's project-setting check uses `evaluateProjectRead(identity, "project:manage_settings", "project", persistedReachFacts)`. This is the canonical project-aware decision and must not be reverted to a workspace-only role check.

## Findings by actual defect class

1. **Overpowered project-role fixtures invalidate intended role denies (seven status failures).** `actorWithLegacyMap` in both project tests calls `grantProjectManageAccess` by default, and that helper includes `project:manage_settings`. The RBAC spec says a project role overrides workspace roles on that project. Thus the two member/lead `defaultCommentVisibility` denies return 200, the two member/lead engagement denies reach PR-9 validation and return 422, and the two “key cannot widen member/lead owner” denies return 200/422 respectively because their owner actually holds project management authority. A narrow manager project role test already supplies its own reduced project capabilities and should remain. The `defaultCommentVisibility` customer-labeled deny also returns 200: `createWorkspaceMember({role:"customer"})` creates the ordinary active staff fixture and the helper grants it a staff project-management role. A string role name is not proof of a real customer-side identity. Do not fix any of these by imposing workspace-only manage-settings authority or by changing expected statuses to success. Give staff negative fixtures an explicit reachable project role lacking `project:manage_settings`, retain legacy route `project:update` where that contrast is the test, and preserve the no-write assertions. For the customer case construct genuine customer-side person, organisation-scoped customer membership, project organisation binding, and agent API request (or a separate proven genuine-customer fixture); assert 403 and no write. Do not grant a customer a project role, which the spec makes structurally impossible. The status failures map to visibility lines 269 twice, 317, 397 and engagement lines 187 twice, 369; the visibility customer case is line 317.

2. **API key denial reason lost at project field guard (two message failures).** Visibility line 342 and engagement line 312 still receive HTTP 403 but body `Insufficient permissions` where tests require `Insufficient API key scope`. `project/index.ts` checks combined `decision.capable` and always throws the generic message. `evaluateProjectRead` also provides `ownerCapable`, so a bounded source repair can distinguish `ownerCapable=true, capable=false` on an authenticated API key and return the key-scope message; owner incapable must remain a generic permission denial. Preserve persisted project facts, key stored subset, and no-write behavior. Verify both missing-scope and owner-denied cases; do not infer a missing key scope whenever the owner's project role itself lacks authority.

3. **Task-update key-scope test is masked by owner authority (one message failure).** `task-update-concurrency` line 503 gets 403 `Insufficient permissions`; its caller is a workspace viewer with project role `project:read,work_item:read`, so the owner also lacks `work_item:update`. The test cannot claim the denial was solely the key's read-only stored subset. Repair the fixture to give the owner current update authority on the addressed project and retain a read-only key, then require the explicit key-scope 403 and assert unchanged task/version. Keep a separate viewer/session denial and both legacy/versioned route checks. If the repaired fixture still gets generic text, inspect the exact route's error branch and make the smallest consistent distinction without changing the canonical gate.

4. **Strict comment in-scope expectation is stale (one status failure).** `strict-runtime-enforcement` line 598 returns 200 for a key carrying `comment:update_own`. The fixture owner holds that project capability, owns the comment, and the stored key scope carries the same capability. The old comment says a key has no canonical capability subset; #784 now projects one. Keep the out-of-scope read-only key 403 and persisted no-write check, and replace the in-scope 403 assertion with success plus exact persisted comment content (and required own-edit window/identity conditions). If the intended policy truly forbids all legacy comment edits by keys, that conflicts with AK-3 and the present canonical projection and would require an explicit owning spec decision before source restriction; no such prohibition was found.

## Bounded next actions for an implementation owner

- Repair only the fixtures above and the project-field error branch needed to preserve the existing API-key denial contract. Make staff no-manage project grants explicit per case; create a genuine customer actor for the customer denial; keep meaningful 403, no-write and PR-9-before-validation assertions.
- Add or retain a key test matrix that separates owner-authorized/key-unscoped, owner-unauthorized/key-scoped, owner-and-key-authorized, and genuine customer. For task update, prove the owner-positive/key-negative condition before asserting the error reason. For strict comment, prove both stored-scope refusal and permitted own edit with persisted state.
- Run the focused four real-PG files first, then exact-head full hosted integration and applicable ordinary/security delta review and all required current-head gates. The previous full-PG run remains failed evidence; no review may be called complete on this advisory report. A future implementation directed by this report needs a fresh independent reviewer.
- The separate `registers` red result is the missing webhooks review disposition dependency owned by #782 inside carrier #791; it is not an additional #784 product failure. Preserve that dependency and its recorded historical findings; do not duplicate, erase, waive, or treat it as a reason to weaken `check:reviews`.

**Decision status:** no new Thomas product decision is necessary for the fixture, key-scope diagnostic, or positive in-scope comment behavior under the existing approved RBAC/AK-3 contract. Only an intent to ban that in-scope comment edit despite the current contract would need an explicit owner spec decision. This report claims neither a repaired source nor green hosted acceptance.


---

### Authentic record: apikey-hosted-fixture-inventory-luna.md

# #784 hosted PostgreSQL failure fixture inventory

**Frozen source inspected:** `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74`
**Hosted evidence:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/784-pg-3594cb34.log`; final Failed Tests block only.
**Run result:** 206 files (202 passed, 4 failed); 2,999 tests (2,988 passed, 11 failed).
**Role/provenance:** read-only fixture/error inventory; GPT-6 Codex context, no more-specific model/version exposed. This is not a review.

## Case inventory

1. `project-default-comment-visibility.test.ts`: member and lead expected 403 but received 200; the member-labelled key-with-manage-settings owner expected 403 but received 200. The local `actorWithLegacyMap` always calls `grantProjectManageAccess`, whose explicit project role contains `project:manage_settings`. The RBAC contract makes the project role override the workspace role, so the denial fixtures are actually project-settings-authorized. Keep the 403/no-write intent and use a reachable project role without `manage_settings`, preserving the legacy `project:update` baseline. The narrow manager-overriding-role case must remain.

   The customer-labelled case also expected 403 but received 200. `createWorkspaceMember({ role: "customer" })` creates a staff-side person; the string `customer` in the workspace membership is not a customer identity. The helper then grants that staff person project management. Correct this with an actual customer-side person, a valid customer organisation and matching project organisation binding, and no project-role grant; preserve the 403/no-write assertion. A nonmatching/unreachable project would test masking (404), not this in-reach capability denial.

   A key limited to `project:update` received 403 with `Insufficient permissions`, while the test expects `Insufficient API key scope`. The key owner has project management authority; the stored key subset is the missing condition. Preserve 403 and no-write, and in `project/index.ts` distinguish key `ownerCapable === true && capable === false` as the existing key-scope error. Owner/project denial remains generic. Do not label the narrow-project-role key case as a scope failure when `ownerCapable` is false.

2. `project-engagement-manage-settings.test.ts`: member and lead denials each reach PR-9 validation and receive 422 instead of 403; their fixture helper also unconditionally grants project `manage_settings`. The key-with-settings-scope/member-or-lead-owner denial likewise reaches validation (422). Give these denial cases reachable project roles with `project:update` but without `project:manage_settings`; keep their existing 403/no-write checks and retain allowed engagement scenarios. A key lacking the field scope returned generic 403 rather than the existing API-key-scope diagnostic; apply the same owner-positive/key-negative distinction as the visibility cases.

3. `strict-runtime-enforcement.test.ts`: the read-only key case is denied and its no-write assertion passes. The following key is scoped to `comment:update_own`; its owner has that project capability, authored the comment within the edit window, and the policy declares `comment:update_own` for this operation. The response is 200, contrary to the test's stale comment/expected 403. AK-3 and the canonical capability projection allow this explicit stored subset. Keep the out-of-scope 403/no-write case; for the in-scope own-edit case assert success and the exact persisted body, preserving the owner/window conditions. No source restriction is supported without changing the approved contract.

4. `task-update-concurrency.test.ts`: the read-only key receives generic 403 before the downstream workspace legacy permission middleware can report a key-scope error. Its owner is a workspace viewer whose project role includes only `project:read` and `work_item:read`; therefore the owner also lacks `work_item:update`, and the failure is not isolated to key scope. Add project-level `work_item:update` to this key-specific fixture while retaining the workspace viewer baseline and read-only key. This lets owner authority pass the `deferApiKeyCapability` reach gate so the downstream scope check can return `Insufficient API key scope`. Keep the separate viewer/session denial, both route checks, and unchanged task/version assertions.

## Scope boundary

This inventory did not edit source, tests, or prior evidence. The `registers` check dependency remains owned by the webhooks review section in #782 carried by #791; this report makes no duplicate disposition or waiver. Raw SQL, query parameters, credentials, and unrelated log diagnostics are not reproduced.


---

### Authentic record: apikey-hosted-failures-repair-luna.md

# #784 hosted failure grouped repair

**Source head:** `a7e522818abe6cdd5a361e776f4bcbdbf8969274`
**Parent source:** `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74`
**Branch:** `codex/api-key-project-role-clamp-724`
**Worktree:** `/Users/heinthura/.codex/worktrees/api750/Ticketing.v2`
**Model provenance:** GPT-6 Codex runtime; no more-specific model/version was exposed here. The requested `-luna` report filename is not evidence of Luna identity.
**Role:** implementation and test repair following fresh independent Sol advisory; not a review.
**Read-only inventory:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/apikey-hosted-fixture-inventory-luna.md`.

## Repair

The canonical target-project `project:manage_settings` evaluator remains in place. For field denials it now preserves the established API-key diagnostic when the owner is capable but the key's stored subset is not; missing owner/project authority still returns the generic permission denial. The check still precedes project reads and writes.

- `project-default-comment-visibility.test.ts`: staff negative cases use a reachable project override with `project:read` and `project:update`, excluding `manage_settings`; the key case with sufficient stored scope uses the same narrow owner ceiling. The customer case now has a customer-side person, active organisation, organisation membership and project binding, with no project-role grant. Existing 403/no-write assertions remain.
- `project-engagement-manage-settings.test.ts`: member/lead and scoped-key owner-denial cases use narrow reachable project-role overrides, preserving legacy `project:update`, 403, and no-write expectations.
- `strict-runtime-enforcement.test.ts`: retained the out-of-scope key 403 and no-write assertion. The explicitly scoped `comment:update_own` key now asserts its authorized own edit succeeds and verifies the exact persisted body; fixture author and edit-window setup remain.
- `task-update-concurrency.test.ts`: the project role now gives the viewer owner `work_item:update` so the read-only key reaches the downstream key-scope gate. Workspace-viewer session denial and both legacy/versioned route checks remain; the key case also asserts unchanged task title, description and version.

Only the five assigned source/test paths changed. No schema, roles, route policy, capabilities, dependencies, shared helpers, checker, register disposition or release state changed.

## Checks on exact source

- `pnpm exec biome check` on all five changed paths — passed.
- `git diff --check` — passed before commit.
- `pnpm --filter @taskdesk/api typecheck` — passed across all configured API TypeScript projects.
- `pnpm --filter @taskdesk/api test:unit` — passed, 119 files / 855 tests.
- PostgreSQL integration — not run locally; no local Docker/PostgreSQL runtime was available. The original hosted failure remains authentic failure evidence on `3594cb34`; no passing focused or hosted PG result is claimed for this repair.

The separate `registers` result remains the webhooks review dependency owned by #782 inside #791. The prior Sol advisory, prior failed hosted log, public reports, and this read-only inventory were not modified. Worktree is clean after the commit; no push, PR/body edit or merge was performed.

## Remaining gates

Fresh independent strong ordinary review and full Sol security review of exact source `a7e522818abe6cdd5a361e776f4bcbdbf8969274`, followed by required current-head CI including real PostgreSQL integration, remain outstanding. This implementation report grants no acceptance or merge authority.


---

### Authentic record: apikey-hosted-repair-ordinary-luna.md

# #784 hosted-failure correction — ordinary review

**Verdict:** BLOCKED on one material fixture finding. The source diagnostic change and staff/key/comment/task regression corrections otherwise match the approved contracts and the bounded repair. Resolve the customer fixture in a changed candidate, then obtain the required fresh full GPT-6 Sol security review and exact-head hosted PostgreSQL result. This review does not grant acceptance.

**Model provenance:** GPT-6 Codex runtime; the platform did not expose a more specific model/version label in this context. I did not author, direct, or remediate the candidate. Independent review context, limited to ordinary review of the bounded delta.

**Exact source:** `a7e522818abe6cdd5a361e776f4bcbdbf8969274`, branch `codex/api-key-project-role-clamp-724`, based on `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74`. The worktree was clean at review start. I reviewed the complete five-path delta and the project/RBAC/API-key/customer contracts, current route/evaluator code, and prior adjudication, fixture inventory, repair note, and original hosted failure evidence.

## Blocking finding

`tests/api-integration/project-default-comment-visibility.test.ts` still constructs the purported customer through `createWorkspaceMember({ role: "customer" })` in `actorWithLegacyMap`, then changes that provisioned staff person's `side` to `customer` and adds an organisation membership. That helper has already inserted a `workspace_user` membership with role `customer` and creates or rewrites a workspace role row for that role. Changing `person.side` does not remove this staff/workspace identity. The test therefore still invents a customer with a workspace membership and a workspace-scoped customer role, contrary to the customer contract: the built-in customer role is organisation-scoped and customers are off the staff rank ladder. This fails the assigned requirement to use a genuine customer person/org/binding without customer staff/project membership. The no-project-role portion is correct, but it does not cure the invalid workspace identity.

Use a fixture path that creates or provisions a customer-side person with only its valid organisation-scoped customer membership, bind the project to that organisation, and make the agent API call without manufacturing a workspace role/map. Keep the meaningful 403 and persisted no-write assertion. If the existing fixture infrastructure cannot represent this legal state, report that fixture prerequisite rather than retaining the invalid identity. The original advisory's request for a genuine customer principal remains unresolved.

## Delta that cleared inspection

- `apps/api/src/project/index.ts` retains `evaluateProjectRead` on the persisted target project facts. On denial it emits `Insufficient API key scope` only when a key is present and `ownerCapable` is true; owner/project denial, absent identity/facts, and sessions retain generic `Insufficient permissions`. This preserves status and the canonical owner/project authority intersection while accurately identifying a missing key subset.
- Staff project-setting negative fixtures now install explicit `project:read` + `project:update` project overrides, so the project's authority overrides the workspace grant as the RBAC contract requires. The key-with-broad-scope/underpowered-owner cases retain 403 and persisted-state assertions.
- The comment test keeps the out-of-scope 403/no-write case and now verifies an explicitly scoped owner-authored comment edit succeeds with the exact persisted body. This agrees with AK-3 and the registered `comment:update_own` contract.
- The task update key fixture now grants the owner project `work_item:update` while retaining the read-only key, and checks the key-specific 403 plus unchanged title, description, and version. The separate workspace-viewer session boundary remains.
- No expected status was changed to success for an intended negative authority case, and I found no weakened project-setting denial or omitted state check in those cases. The only invalid-identity issue is the customer case above.

## Verification actually run

- `pnpm exec biome check` on the five changed files — passed, 5 files.
- `pnpm --filter @taskdesk/api typecheck` — passed (all configured API TypeScript projects).
- `pnpm --filter @taskdesk/api test:unit` — passed, 119 files / 855 tests.
- `git diff --check 3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74..a7e522818abe6cdd5a361e776f4bcbdbf8969274` — passed.
- PostgreSQL integration was not run in this review. Preserve the original hosted result on `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74` as adverse evidence: 206 files, 4 failed / 202 passed; 2,999 tests, 11 failed / 2,988 passed. The private original log's final failed-tests block remains at `784-pg-3594cb34.log`; no query text or credentials are copied here. No local PG, Docker, browser, push, edit, or merge action was performed.

## Residuals

The source and other four test-file corrections are independently reviewed at this ordinary tier, subject to the customer-fixture blocker. After the fixture is repaired and the candidate SHA changes, review that delta at the required tier. A fresh full GPT-6 Sol review remains mandatory for the current exact head. Exact-head hosted PostgreSQL integration remains required; current passing typecheck/unit/Biome results do not replace it. The separate #782 review dependency and image/current-hosted-PG gates remain outstanding as recorded by the conductor; this report makes no disposition on them.


---

### Authentic record: apikey-customer-fixture-repair-luna.md

# API key project-settings customer fixture repair

- Exact parent source head: `a7e522818abe6cdd5a361e776f4bcbdbf8969274`
- Repair commit: `3871491fbb50e4625b7e5a6f78f2e2563f27d865`
- Branch: `codex/api-key-project-role-clamp-724`
- Changed file: `tests/api-integration/project-default-comment-visibility.test.ts` only

## Finding and correction

The prior negative case created a `customer` via `createWorkspaceMember` and changed that staff person's side and organisation afterward. That fixture retained workspace identity/membership and did not represent a reachable customer under the organisation-scoped customer contract. It also described an impossible customer with a legacy workspace `project:update` claim.

The renamed case now creates a separate admin staff fixture only to own the workspace/project, then creates a distinct customer user, customer-side person, active external organisation, organisation-scoped customer role/membership, and project-to-organisation binding. The customer is never passed through `createWorkspaceMember` or `actorWithLegacyMap`. Before the request, assertions establish that the customer has no `workspace_user`, has exactly one organisation membership (therefore no canonical workspace/project membership), and has no corresponding workspace-scoped customer role; the assigned customer role is explicitly organisation-scoped with null `workspaceId`.

The test retains the agent project-settings request's 403 assertion and persisted `defaultCommentVisibility === "internal"` no-write assertion. Existing staff narrow-role and API-key cases are untouched. No production, route policy, role, capability, evaluator, or shared helper behavior changed.

## Checks actually run

- `pnpm exec biome check tests/api-integration/project-default-comment-visibility.test.ts` — passed after formatting.
- `pnpm --filter @taskdesk/api typecheck` — passed.
- `pnpm --filter @taskdesk/api test:unit` — passed: 119 files, 855 tests.
- `git diff --check` — passed.
- The PostgreSQL integration test was not run; no local PostgreSQL/Docker runtime is available. No claim of an integration/runtime pass is made.
- Commit hook ran Biome on the staged file and passed.

## Provenance and limits

This report records the authoring Codex agent context. The runtime did not expose a verifiable routed model/version label, so no specific Luna/Sol model identity is asserted. The ordinary reviewer finding report and prior hosted failure/adjudication evidence remain unchanged. This is a one-file test-fixture correction, not independent review or final security clearance.


---

### Authentic record: apikey-customer-fixture-ordinary-current-luna.md

# #784 customer-fixture repair — independent ordinary review

**Verdict:** BLOCKED on one remaining contract mismatch in the customer fixture. The prior fake workspace identity is removed, and the requested negative/no-write checks are retained. The organisation membership currently uses a custom role rather than the built-in `customer` role, so this still does not represent the admitted customer identity defined by the repository contract.

**Model provenance:** GPT-6 Codex runtime; no more specific platform model/version was exposed. Fresh ordinary review context; I did not author, direct, or remediate the candidate.

**Exact source:** `3871491fbb50e4625b7e5a6f78f2e2563f27d865`, branch `codex/api-key-project-role-clamp-724`, one-file delta from `a7e522818abe6cdd5a361e776f4bcbdbf8969274`. The worktree was clean when checked. I read the author report and inspected the complete delta, the customer-role contract, the identity resolver's customer branch, and established customer test fixtures.

## Finding

In `tests/api-integration/project-default-comment-visibility.test.ts`, the new user and person are created from scratch. The person is customer-side, belongs to an active external organisation, has no workspace-user row, has exactly one organisation-scope membership, and the project is bound to that organisation. No customer project membership or workspace role-map entry is fabricated. The request remains a denied call to the agent project-settings API, followed by a persisted `defaultCommentVisibility === "internal"` assertion.

However, the test inserts a fresh role with key `comment-visibility-customer-${randomUUID()}` and attaches that role to the organisation membership. The customer contract defines an admitted customer as holding the built-in `customer` role on an organisation-scoped membership; `rbac.md` says `customer` is the one system role at organisation scope. Existing customer fixtures use role key `customer`, null `workspaceId`, and the canonical customer role setup. Here, the resolver derives the canonical customer grant from `person.side`, so the request is denied, but the persisted membership itself is not the specified customer role membership. The test should use or reuse the built-in organisation-scoped role with key `customer` (and the canonical capabilities), then retain the no-workspace/no-project-membership assertions and 403/no-write check.

This is a narrow fixture correction, not an authority or route defect. It blocks this fresh ordinary verdict because the task is to prove the scenario with a genuine customer identity, and the membership row does not yet meet that contract.

## Remaining bounded matrix

The only candidate delta since the blocked review is this one test file. The source-side key-scope diagnostic, staff project-role override denies, key owner/scope distinctions, authorized scoped comment edit, and task update no-write case are unchanged from the previously inspected bounded matrix. The staff negative cases still assert meaningful denials and persisted state; the comment in-scope case still verifies exact persisted content. This one-file repair introduces no successful expected value in place of an intended denial and does not alter production behavior.

## Verification

- `pnpm exec biome check tests/api-integration/project-default-comment-visibility.test.ts` — passed, 1 file.
- `pnpm --filter @taskdesk/api typecheck` — passed across configured API TypeScript projects.
- `pnpm --filter @taskdesk/api test:unit` — passed, 119 files / 855 tests.
- `git diff --check a7e522818abe6cdd5a361e776f4bcbdbf8969274..3871491fbb50e4625b7e5a6f78f2e2563f27d865` — passed.
- PostgreSQL integration was not run. The author report states no local PostgreSQL/Docker runtime is available. The earlier hosted PostgreSQL failure on `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74` remains adverse evidence and is preserved in `784-pg-3594cb34.log`; this review does not claim a PG pass.

No source or prior adverse report was edited. No Docker, browser, push, or merge action was performed. A fresh full Sol review and exact-head hosted PostgreSQL integration remain required after the fixture is corrected; the separate #782 review dependency remains outstanding.


---

### Authentic record: apikey-customer-canonical-fixture-repair-luna.md

# API key project-settings canonical customer fixture repair

- Parent candidate reviewed: `3871491fbb50e4625b7e5a6f78f2e2563f27d865`
- Repair commit: `bb1c79466c79a39904f9fec61fac3b58f0ab7660`
- Branch: `codex/api-key-project-role-clamp-724`
- Changed file: `tests/api-integration/project-default-comment-visibility.test.ts` only

## Contract and fixture correction

The prior fixture had a separate real customer identity and organisation membership, but attached a newly invented role key/capability set. That was not the built-in customer role required by the identity contract.

`docs/01-architecture/rbac.md` defines organisation scope as existing for exactly one system role, `customer`. `packages/permissions/src/roles.ts` is the role-data source and declares `BUILT_IN_ROLES.customer` with its canonical key, scope, rank, editability, and capabilities. `apps/api/src/permissions/resolve-identity.ts` constructs the customer authority from that built-in definition for a customer-side person; it does not trust an invented database role definition. The integration helper `tests/api-integration/helpers/approval-fixtures.ts` demonstrates admitted-customer construction (external organisation, customer person, organisation membership) but permits test-specific capabilities and therefore is not itself a canonical-role source. There is no global customer-role bootstrap helper in the API. The workspace role seed is unrelated and seeds only workspace roles.

The fixture now persists the canonical built-in key/scope/rank/capabilities, null `workspaceId`, `isSystem: true`, and non-editable status from `BUILT_IN_ROLES.customer`. The customer remains a separately created user and customer-side person, with one active external organisation membership and project-to-organisation binding. Assertions verify the canonical role data, the absence of a workspace user, exactly the single organisation membership (no workspace/project membership), no matching workspace-scoped customer role, and the canonical role lacks `project:update` and `project:manage_settings`. The test retains its 403 response and persisted `defaultCommentVisibility === "internal"` no-write check. Staff and key cases are unchanged; no evaluator or production behavior changed.

## Checks actually run

- `pnpm exec biome check tests/api-integration/project-default-comment-visibility.test.ts` — passed.
- `pnpm --filter @taskdesk/api typecheck` — passed.
- `pnpm --filter @taskdesk/api test:unit` — passed: 119 files, 855 tests.
- `git diff --check` — passed.
- Commit hook ran Biome on the staged file and passed.
- PostgreSQL integration test not run because no local PostgreSQL/Docker runtime is available. No integration/runtime pass is claimed.

## Provenance and limits

This report records the authoring Codex agent context. Runtime did not expose a verifiable routed model/version label, so no specific Luna/Sol identity is asserted. The prior ordinary finding and fixture-repair reports remain unchanged. This is a fixture correction, not an independent review or security clearance.


---

### Authentic record: apikey-customer-canonical-ordinary-current-luna.md

# #784 canonical customer-fixture repair — independent ordinary review

**Verdict:** CLEAR at the ordinary-review tier for exact source `bb1c79466c79a39904f9fec61fac3b58f0ab7660`. The fixture now uses the canonical built-in customer role on the sole organisation-scoped membership, with no workspace or project authority. The previously blocked ordinary finding is resolved. This verdict is not security clearance or acceptance.

**Model provenance:** GPT-6 Codex runtime; no more specific platform model/version was exposed. Fresh independent ordinary-review context. I did not author, direct, or remediate the candidate.

**Source and scope:** Branch `codex/api-key-project-role-clamp-724`, exact head `bb1c79466c79a39904f9fec61fac3b58f0ab7660`, parent `3871491fbb50e4625b7e5a6f78f2e2563f27d865`. The exact delta changes only `tests/api-integration/project-default-comment-visibility.test.ts`. The worktree was clean at review start. I inspected the delta, `BUILT_IN_ROLES.customer`, the customer identity construction, the customer portal/RBAC contracts, and the unchanged bounded #784 regression matrix.

## Review result

The customer user and customer-side person are created independently of staff workspace fixtures. The test persists the built-in customer role's key, organisation scope, rank, capabilities, `workspaceId: null`, system status, and non-editability from `BUILT_IN_ROLES.customer`. Its sole membership is organisation-scoped and points to that role. The test binds the project to an active external customer organisation, asserts no workspace-user row, exactly one organisation membership, no workspace-scoped customer role in the workspace, and the expected canonical role values. The canonical customer capabilities exclude both `project:update` and `project:manage_settings`.

The agent project-settings request still asserts 403 and then reads the project row to prove `defaultCommentVisibility` remains `internal`. The prior fake staff/customer identity and the intermediate custom role are gone. This matches the stated contract and introduces no invented role/capability fields. The unique `(scope, workspace_id, key)` role index is safe in this fixture: the integration harness truncates all tables before each test, so this test creates the canonical organisation role once in its fresh test database.

The previous bounded matrix remains intact: staff with narrow project-role overrides are still denied protected settings and checked for no writes; API-key owner-authority and stored-scope controls remain; the explicitly scoped own-comment success still checks exact persisted content; and the task-update key denial still checks unchanged task/version. This one-file delta does not alter production authority, route behavior, expected denial status, or prior adverse evidence.

## Verification

- `pnpm exec biome check tests/api-integration/project-default-comment-visibility.test.ts` — passed, 1 file.
- `pnpm --filter @taskdesk/api typecheck` — passed across configured API TypeScript projects.
- `pnpm --filter @taskdesk/api test:unit` — passed, 119 files / 855 tests.
- `git diff --check 3871491fbb50e4625b7e5a6f78f2e2563f27d865..bb1c79466c79a39904f9fec61fac3b58f0ab7660` — passed.
- PostgreSQL integration was not run, as assigned. The original hosted failure on `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74` remains adverse evidence (206 files, 4 failed; 2,999 tests, 11 failed) in private `784-pg-3594cb34.log`. This review claims no integration pass.

No source or prior ordinary/adverse report was changed. No PostgreSQL, Docker, browser, push, or merge action was performed. A fresh full GPT-6 Sol review and exact-head hosted PostgreSQL result remain required. The separate #782 review dependency also remains outstanding.


---

### Authentic record: apikey-hosted-repair-security-current-sol.md

# #784 hosted-failure repair — full independent security review

**Verdict: CLEAR** for source security at exact reviewed head `bb1c79466c79a39904f9fec61fac3b58f0ab7660`. No blocking finding in the bounded repair or inspected composed authority seams. This is not PostgreSQL, image, CI, merge, or SIT acceptance.

**Reviewed head:** `bb1c79466c79a39904f9fec61fac3b58f0ab7660`  
**Comparison base:** `3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74`  
**Prior full security source:** `596a2332381e16d89e6bf90a8d679d0cb3a022d8`, confirmed ancestor of the reviewed head.  
**Role and provenance:** Fresh independent full security reviewer context dispatched for the Sol-tier role. I did not author, direct, or remediate the candidate. This runtime identifies itself as Codex based on GPT-6 but does not expose an inspectable routed model/version label; the requested `-sol` filename and role assignment are not independent proof of a finer model identifier. The conductor should attach its actual spawn arguments when publishing this report.

I read repository `AGENTS.md`, active mission, agent workflow, `CLAUDE.md`, the RBAC, API-key, project/engagement and customer contracts, the prior full Sol source review, the Sol failure adjudication (as advisory only), both adverse ordinary reviews, all three repair reports, and the final ordinary CLEAR. I inspected the entire five-file `3594cb34..bb1c7946` delta and traced the current project route, reach middleware, identity resolver, key-scope projection, and evaluator. The worktree was clean at the exact head before and after review. No source, test, PR, or prior note was changed.

## Security assessment

- The only production delta is the protected project-field denial message. The guard still evaluates `project:manage_settings` using current identity and persisted target-project reach facts before any project read or write. `evaluateProjectRead` computes `capable` from owner authority intersected with the stored key subset and `ownerCapable` from the owner alone. The new key-scope message is selected only for a key with `ownerCapable === true` and `capable === false`; owner denial, missing identity/facts, and sessions retain the generic permission message. It does not turn a denial into success or replace the target-project check.
- `workspaceAccess.fromProject` retains project reach, target fact matching and the project capability owner's ceiling; `deferApiKeyCapability` leaves only the legacy key-scope half to the downstream check. The protected-field handler applies the stricter canonical intersection. Project role overrides workspace role for that target project, so the repaired staff fixtures provide `project:read` and `project:update` without `project:manage_settings`. Their 403 and persisted no-write assertions remain.
- The API-key matrix retains owner-capable/key-insufficient denial with the specific scope reason, owner-incapable/key-scoped denial, and owner-and-key-capable success. The task-update fixture now makes its owner capable of `work_item:update` in the addressed project while the key remains read-only; its key-specific 403 and unchanged title, description and version check are meaningful. The separate workspace-viewer session and foreign-project denials remain.
- The comment regression retains out-of-scope 403 with no write. Its explicitly scoped `comment:update_own` key has an owner-authored comment inside the edit window and now requires 200 plus the exact persisted body, consistent with AK-3. No broader comment authority is introduced by this test edit.
- The final customer fixture uses a separate customer-side person, active external organisation, project-to-organisation binding, and the canonical built-in `customer` role on its one organisation-scoped membership. It asserts no workspace user, no workspace-scoped customer role, no project membership, and no project update/settings capability. The agent settings request is 403 and the stored setting stays `internal`. This resolves the fake staff/customer and invented role findings from both adverse ordinary reviews. The resolver's customer branch constructs only the canonical organisation grant and ignores workspace rows; no route in this delta turns the fixture into agent authority.

The source still has a stale comment naming `assertCallerHasCapability` in the protected-field guard. The executable branch uses `resolveCallerIdentity` and `evaluateProjectRead`. This is non-blocking documentation drift, not a changed authority path.

## Checks and limits

- `git diff --check 3594cb34c2f50ab3434fbc7ddd28ba9a0a3a6c74..HEAD`: passed.
- `pnpm --filter @taskdesk/permissions exec vitest run src/evaluator.test.ts`: 1 file, 60/60 tests passed.
- `pnpm --filter @taskdesk/api typecheck`: passed across all configured API TypeScript projects.
- Exact-head PostgreSQL integration, Docker/image/boot/health, browser and hosted CI: **not run** in this read-only review. The authentic hosted PG result at `3594cb34` remains failed: 206 files (4 failed), 2,999 tests (11 failed). This repair requires a new exact-head real-PG result; typecheck and evaluator units cannot establish the integration fixture outcomes. The separate #782 register disposition remains a carrier dependency and is not waived or weakened here.

**Blocking findings:** none found in the inspected source.  
**Residual:** current-head hosted PostgreSQL and all required CI/runtime gates must be judged separately by the conductor. The review makes no claim about simultaneous revocation races or full release acceptance.

