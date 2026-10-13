# Ordinary independent review A — PR #583 frozen P0 candidate

- **Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate the candidate.
- **Exact candidate:** `1cf9dcc9a163ce48c0a0c19695774e725da90606` (`codex/p0-installer-full-20261006`).
- **Comparison:** full auth/strict/pending-action delta from `08842235047a3ab2714427edce80331b94558150` through this candidate; prior blocker at `294ddd6420262eb9d607dc4e80e338c568dd9afd` checked against its structural remediation in `6b7c094bcb1ffd5397fde9eefdcc6776253f9087`.
- **PR:** #583. Live `gh pr view` head matched the reviewed SHA. Review did not treat hosted checks as clear: the sampled rollup had checks in progress and `pull request template + security review` failed.
- **Independence:** no authorship, implementation, fixing, or merge activity on this change.

## Verdict

**Clear for this ordinary authorization-review scope; no blocking or non-blocking candidate defect found.** The prior pending-action stored-scope omission is structurally closed on this head. This verdict is not the required GPT-6 Sol security review, a phase finalizer, hosted CI acceptance, or merge approval.

## Authorization review

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, the current status snapshot and newest relevant decision-log entries, plus the authoritative `auth-and-identity.md`, `rbac.md`, `pending-actions.md`, `webhooks-and-api-keys.md`, and `notifications.md` contracts.
- Inspected the complete auth/strict/pending-action API delta since `0884223`, including `require-api-key-permission-scope.ts`, both workspace authorization helpers, strict policy identity projection/evaluation, every `assertCallerHasCapability` and `assertCallerHasCapabilityOrSelf` call site, pending-action request transaction, notification/preference/avatar route guards, and the related integration/unit regressions.
- Verified the previous finding: the pending-action transaction now locks the current API-key row and checks key id, owner, enabled state, expiry, persisted permission scope, and current workspace role before inserting pending action/outbox/audit effects. A missing or insufficient scope is refused before those effects. The exact route remains registry-bound to `DELETE /api/work-items/{key}` and `work_item:delete`.
- Confirmed malformed, absent, null, and narrower stored key scopes fail closed in the shared legacy/capability predicates. Strict evaluation projects only recognized canonical capabilities and intersects them with current role authority. Manual capability paths require an explicit session/API-key credential discriminant; reachable request handlers pass `c.get("apiKey")`.
- Confirmed the approved self-write rule is enforced with `requireSessionOnly()` on notification mutations, notification-preference mutations, and avatar writes; corresponding policies are registered. Read handlers remain self-scoped.
- `git diff 6b7c094b..1cf9dcc9` contains only the sign-in visual snapshot; the full auth remediation reviewed at `6b7c094b` is source-equivalent on this head.

## Checks actually run

- `git status --short --branch` was clean; `git rev-parse HEAD` returned the exact candidate SHA above.
- `CI=true pnpm --filter @taskdesk/api exec vitest run --config vitest.integration.config.ts ../../tests/api-integration/pending-action-service.test.ts ../../tests/api-integration/strict-runtime-enforcement.test.ts` — **2 files, 34 tests passed**; Testcontainers cleanup completed.
- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/utils/require-api-key-permission-scope.test.ts` — **1 file, 10 tests passed**.
- `git diff --exit-code 6b7c094b..HEAD -- ':!apps/web/e2e/visual.spec.ts-snapshots/sign-in-linux.png'` — passed; the only later source delta is the PNG snapshot.
- `gh pr view 583 --json headRefOid,headRefName,reviewDecision,statusCheckRollup,mergeable` — head matched; rollup was incomplete and included a failed template/security-review check at observation time. No hosted-CI-green claim is made.

## Residual acceptance state

The separately reported native-project-count/source-evidence ambiguity and configuration-evidence hold are not findings introduced by this candidate and are not resolved by this authorization review. Hosted exact-head CI, required independent review panel completion, GPT-6 Sol security review, and remaining P0 acceptance gates remain outside this verdict.
