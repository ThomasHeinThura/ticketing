# Security review — PR #216 (issue #206: declare the 404s handlers actually return)

**Reviewed head:** `0846d0c24759635f2bcfe669dc87a9a81f2a08b5`

Fixed at `68f3a6979c3bea4bceb4215ac623e076352ccac2`; confirmed by an independent Opus pass
via `git merge-tree --write-tree` recomputation of both intervening merge commits (not a
two-endpoint diff), proving neither substituted or dropped content, at
`c4c0f4fcddd97851614412e48c528ce179752d0b`. One further sync landed after that
confirmation (PR #217's already-independently-verified comment-only migration edit,
touching only `apps/api/drizzle/0056_lonely_gorilla_man.sql`) — re-checked directly by the
orchestrating session rather than a fourth reviewer round, given #217's content had already
been proven comment-only twice over and shares no file with this PR: `git diff
c4c0f4f...2f39705 -- apps/api/src/column/index.ts apps/api/src/label/index.ts
apps/api/src/project/index.ts apps/api/src/task/index.ts apps/api/src/time-entry/index.ts
apps/api/src/workflow-rule/index.ts tests/api-contract/openapi.json` is empty.

## What this PR does

Closes issue #206: adds/corrects OpenAPI `404:` response declarations across
`project`/`task`/`column`/`workflow-rule`/`time-entry`/`label` route files so the contract
matches what handlers actually return. No handler, schema, status behavior, or route path
changes — declarations only. Touches `apps/api/src/**/index.ts` route files, security-review
scope per `docs/04-engineering/ci-cd.md`.

## Review (combined ordinary + mandatory security, one pass)

**Verdict: CLEAR.** One BLOCKING finding, fixed and independently re-verified; no other
issue outstanding.

- **The sweep's own 4 corrections verified correct** against the actual controller code:
  `updateTaskAssignee`'s 404→403 swap (the un-assignable case really is a 403 via
  `assertAssignableUser`; the real 404 is "Task not found"), both label attach/detach 404
  merges (each controller genuinely throws both "Label not found" and "Task not found"),
  and `deleteLabel`'s 404 description (a real third throw path when a task-level label's
  task row is gone).
- **Every other module's existing declarations cross-checked against their controllers
  line by line** — project, time-entry, workflow-rule, label — no other mismatch found.
- **One BLOCKING finding, confirmed and fixed**: `createColumn`'s controller
  unconditionally calls `getProjectWorkspaceId` (which throws 404 "Project not found" on a
  soft-deleted project — the same helper `getColumns`/`reorderColumns` already use and
  already declare 404 for), but `createColumnRoute`'s `responses` block never declared it.
  A real, confirmed instance of the exact defect class this PR closes, missed by its own
  sweep. **Fixed** (added the declaration, regenerated the OpenAPI baseline) and
  **independently re-verified**: `check:openapi` clean (102 operations), `typecheck` clean,
  `biome`/`lint` clean, `test:permissions` 10 files/79 tests (confirming no route or
  permission behavior moved).
- **Correction, found by the confirmation pass**: the orchestrating session's original
  commit message claimed this branch's `status.md` diff would have reverted newer content.
  That was inaccurate — checked directly (`git diff 26ec385 029b75d -- docs/07-planning/
  status.md` is empty): the original reviewed head never touched `status.md` at all: the
  branch simply inherited PR #220's refresh cleanly through the ordinary main-sync merge.
  No revert was ever at risk. (This confusion did apply to a different PR, #210, reviewed
  separately the same session — misattributed here.)

No authorization, permission, or route-path change anywhere in this PR — confirmed by the
`test:permissions` re-run showing the identical 79-test baseline.

Two further main-syncs landed after the confirmation above (PR #213's test-hygiene fixes,
PR #214's UTC timestamp fix — neither touches any file this PR reviewed). Re-checked
directly at `8b9c9133eab91309f1241079d5dee223c88902c5`: `git diff
2f397053595a746c6131499b74daa88179db551b 8b9c9133eab91309f1241079d5dee223c88902c5 --
apps/api/src/column/index.ts apps/api/src/label/index.ts apps/api/src/project/index.ts
apps/api/src/task/index.ts apps/api/src/time-entry/index.ts
apps/api/src/workflow-rule/index.ts tests/api-contract/openapi.json` is empty.

One further main-sync landed after that, bringing in PR #215's constraint-migration PR
(`apps/api/drizzle/0059_work_item_integrity_checks.sql`, `apps/api/src/database/schema.ts`,
its own test file and security-review note — no file this PR reviewed). Re-checked directly
at the final head `ebe5d2a7bcb21e86ee7fc90bac6831bd7d18e849`: `git diff
8b9c9133eab91309f1241079d5dee223c88902c5 ebe5d2a7bcb21e86ee7fc90bac6831bd7d18e849 --
apps/api/src/column/index.ts apps/api/src/label/index.ts apps/api/src/project/index.ts
apps/api/src/task/index.ts apps/api/src/time-entry/index.ts
apps/api/src/workflow-rule/index.ts tests/api-contract/openapi.json` is empty, and the merge
commit's two parents' diffs (per-parent attribution, not a two-endpoint diff) confirm the
same — the only real content is #215's own files, listed above.

One further main-sync landed after that, bringing in PR #222's `status.md` correction —
docs-only, no file this PR reviewed. Re-checked directly at the final head
`b3641ac55279b56166d43004c89d1350709b6e40`: `git diff
ebe5d2a7bcb21e86ee7fc90bac6831bd7d18e849 b3641ac55279b56166d43004c89d1350709b6e40 --
apps/api/src/column/index.ts apps/api/src/label/index.ts apps/api/src/project/index.ts
apps/api/src/task/index.ts apps/api/src/time-entry/index.ts
apps/api/src/workflow-rule/index.ts tests/api-contract/openapi.json` is empty.

Another sync landed after that, bringing in PR #224's `apps/web` fix (logged-out redirect) —
no overlap, no file this PR reviewed. Re-checked directly at the final head
`0846d0c24759635f2bcfe669dc87a9a81f2a08b5`: `git diff
b3641ac55279b56166d43004c89d1350709b6e40 0846d0c24759635f2bcfe669dc87a9a81f2a08b5 --
apps/api/src/column/index.ts apps/api/src/label/index.ts apps/api/src/project/index.ts
apps/api/src/task/index.ts apps/api/src/time-entry/index.ts
apps/api/src/workflow-rule/index.ts tests/api-contract/openapi.json` is empty.
