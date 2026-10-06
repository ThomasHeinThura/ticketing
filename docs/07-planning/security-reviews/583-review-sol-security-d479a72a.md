# Independent GPT-6 Sol security review — PR #583

**Reviewed head:** `d479a72a3dd3f4f48473e62d5d933ad83c94fa2c`  
**Comparison base:** accepted main `3096cb044bdf6ae98488bfc385f532fa6386343a`; detailed current-lineage inspection from `08842235047a3ab2714427edce80331b94558150`.  
**Reviewer:** GPT-6 Sol, fresh independent context. I did not author, direct, or remediate this candidate, and made no source edits, commit, merge, or deployment.  
**Verdict:** **Security source review clear on the exact head. No blocking or non-blocking source findings found.** This is the required per-PR security pass only; it is not a P0 phase finalizer or acceptance of the PR's runtime/CI gates.

## Scope and method

I verified clean checkout HEAD and live PR #583 head both equal the reviewed SHA. I read `AGENTS.md`, agent workflow, `CLAUDE.md`, security scope in `ci-cd.md`, current decision log, the installer contract, pending-action contract, API-key/RBAC/strict-policy code, and the three independent ordinary Luna reports. I examined the whole accepted-main-to-head file inventory, then traced the 98-file current-lineage auth/UI/CI delta and the final two image-only commits. Prior `08842235` lineage is source-bound rather than re-reviewed as a new change.

Security paths inspected include API-key verification/authentication and stored-scope parsing; legacy workspace permission, manual capability, strict policy identity/evaluator, asset scope and route guards; the pending-action transaction; all nine approved session-only personal write routes and registry entries; installer release verification/extraction/consent, `.env` and rollback selection; release signing and deploy image verification; both MCP SDK dependency floors; G1 raw-element gate execution/red probes and contrast resolver changes. I compared author and ordinary-review assertions against code and retained hosted receipts rather than treating those assertions as a current gate pass.

The key checks support a fail-closed composition: null/malformed/narrow key permissions cannot add grants; strict identity receives only recognized stored capabilities; manual checks require explicit credential kind and intersect stored key scope with current role. Pending-action creation locks the current key row and rechecks owner, enabled state, expiry, stored scope and role before writes. The personal mutations use actual `requireSessionOnly()` middleware and corresponding policy flags. Installer verification pins issuer and release workflow identity, checks signed checksum and archive shape before persistent writes, preserves existing secrets, and clears stale rollback digest when the release tag changes. The G1 raw-element check is declared, executed and probed red when removed. No security authority expansion or required-check weakening was found.

## Reproductions actually run on this checkout

- API-key scope unit suite: **1 file, 10/10 tests passed**.
- Pending-action and personal self-mutation integration suites on disposable PostgreSQL: **2 files, 27/27 tests passed**; no persistent database retained.
- Strict runtime enforcement integration suite: **passed** (one selected file; complete count was outside retained console excerpt, so no count is claimed).
- Installer/release shell harness: **20/20 tests passed**, including signature, checksum, traversal/link rejection, consent, idempotency, `.env` preservation and rollback-selection cases.
- Workflow gate-drift red probes: **56/56 passed**.
- `gh pr view 583`: exact head matched. At observation time multiple hosted jobs remained in progress and `pull request template + security review` was red pending publication of this review; those are not relabeled green here.

## Findings and acceptance boundary

**Blocking source findings:** none.  
**Non-blocking source findings:** none.

I did not run a second full native 1,659-test suite, the 144-story browser replay, G11, image boot, or the three-date traffic proof. Retained 6b7 hosted G11 remained **21/22**, with the 200-card board at **527.5 ms against 500 ms**; no budget, workload or retry waiver is inferred. Exact d479 hosted replay was in progress at this review. The native-project **400 versus RBAC 404** evidence ambiguity, public configuration-evidence substitution decision, original-date compatibility, strict/rollback acceptance and a separate independent Sol P0 finalizer remain explicit holds. This source verdict does not resolve them and does not authorize merge or stage completion while required checks or holds remain open.
