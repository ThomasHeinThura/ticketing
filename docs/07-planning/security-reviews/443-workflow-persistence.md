# PR #443 — workflow persistence layer (issue #31)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis, real Bash/git
access)
**Session:** subagent `a2598e2235aa1787b`

**Reviewed head:** `b90f79053593ed331f57b56a520715576977765c`

**Verdict: APPROVE.** Confirmed the four new tables (`workflow`, `workflow_version`,
`workflow_transition`, `scheduled_transition`) match `packages/domain/src/workflow/types.ts`
column-by-column, including the `guards`/`effects` jsonb vocabularies correctly excluding
`AutomaticEffect` from what a caller may author (`WF-22`). Applied the real migration to a
scratch database and confirmed the circular `workflow`/`workflow_version` FK resolves
cleanly (both `CREATE TABLE`s precede both `ALTER TABLE ADD CONSTRAINT`s). Confirmed the
`scheduled_transition` composite-FK shape genuinely matches the #186/#191 precedent at
`schema.ts:2359-2360`. Confirmed `work_item_type.workflow_id`'s pre-existing placeholder
comment is now genuinely fulfilled with a real `.references()`. Confirmed
`create-workflow-version.ts` calls `validateWorkflowVersion` before opening the
transaction (nothing persists on an invalid draft) and that tenant scoping is enforced via
`workspaceAccess.fromWorkflow()`/`fromWorkflowVersion()`, matching this codebase's existing
pattern. Confirmed `requireWorkspaceCapability` (not the legacy `requireWorkspacePermission`)
is the correct mechanism for the new capabilities, with no legacy `ac` statement equivalent.

**Existing-row migration case tested directly** (not just reasoned about): applied
migrations 0000-0072 to a scratch DB, inserted a real `work_item_type` row, then applied
0073 forward — succeeded, row survived untouched, new FK genuinely enforced.

Full suites reproduced: domain unit 11 files/544 tests, permissions 13/83, integration
99 files/1313 tests — all green. `tsc --noEmit` clean, `check-openapi.mjs` clean (132
operations). Issue #442 (deferred transition-execution route, #36 approvals interim
behavior) confirmed accurately scoped.

**Two non-blocking notes:** no dedicated automated existing-row regression test for the
`work_item_type.workflow_id` FK addition (verified by hand instead); `create-workflow-version.ts`'s
`max(number) + 1` version assignment is race-prone under concurrent creation for the same
workflow, but the unique index catches it as a 500 rather than corrupting data — acceptable
for a schema-CRUD-only PR, worth a follow-up.

---

## Re-confirmation after branch update (2026-09-27)

**Reviewed head:** `7c43defd3623d8e6178e593f5eecea0e029c22db`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. This branch was merged forward with `origin/main` (which had
advanced with #430/#432/#433/#439) to resolve a routine conflict in the GENERATED
`tests/permissions/matrix.fixture.json` only — regenerated via `REGEN_MATRIX=1`, not
hand-edited. `git diff b90f79053593ed331f57b56a520715576977765c..7c43defd3623d8e6178e593f5eecea0e029c22db`
scoped to every application file this PR touches (`apps/api/src/workflow/**`,
`apps/api/src/database/schema.ts`, `relations.ts`, `index.ts`, migration files) is empty.
Re-verified after the merge: full permissions suite 13/83, `tsc --noEmit` clean,
`check-openapi.mjs` clean (138 operations, contract auto-merged correctly with no drift).

---

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a871815f87f36e21e`

**Reviewed head:** `1be6b1ee93cf487afecb0f0be0684a96a566e09d`

**Verdict: BLOCKING.** Do not merge. Tenant scoping on reads and publish is sound, but two
real blocking findings plus a genuine CI failure this PR's own tsconfig scope introduced.

**B1 (BLOCKING, real, reproduced live): a workspace can no longer be deleted once it has a
workflow transition.** Migration 0073's `ON DELETE RESTRICT` FKs from `workflow_transition`
to `state_template` (from/to) and to `role` block Postgres's delete-cascade ordering —
`DELETE /api/workspace/{id}` returns 500 after one valid draft version exists, and the
workspace survives. Confirmed this is genuinely new (a workspace with only project states,
no workflow transition, deletes fine). Also breaks account deletion via
`delete-account-data.ts`, which deletes workspaces too. **Fix verified by the reviewer:**
delete `workflow WHERE workspace_id = …` first, in the same transaction, in both
`delete-workspace.ts` and `delete-account-data.ts` — the cascade then clears
versions/transitions and the delete succeeds. Needs a regression test: a workspace with a
role-gated transition deletes with 200.

**B2 (BLOCKING, real, reproduced live): `create-workflow-version.ts` accepts a `roleId`
from another workspace.** Validation checks from/to state templates against the workflow's
own workspace but never checks `roleId`. Proven: workspace A's owner saved a transition
pointing at workspace B's role (200); B's owner then gets 500 deleting their own workspace
and cannot delete that role — one tenant can block another tenant's deletes. **Fix:**
reject with 400 any `roleId` the workspace may not reference, before insert. Needs a
regression test.

**B3 (BLOCKING, real): CI's `static` job fails.** `tsc -p tsconfig.tests.json` reports four
TS18048 errors in this PR's own `tests/api-integration/workflow.test.ts` (lines 126, 127,
140, 178) — `requireRow([backlog])` called on a possibly-undefined destructured value.
Confirmed in CI run 36340503303. The ordinary review's "tsc clean" claim only covered the
main tsconfig, not the tests config.

**N1 (non-blocking, real):** caller-written `guards`/`effects` JSON has the right shape
(Zod union closed to 5 guard types / 6 authored effect kinds) but unchecked values —
`schedule_transition.toStateTemplateId` pointing at another workspace's template,
`set_assignee.personId` as an arbitrary string, `set_field`/`field_required` with
`field: "__proto__"`/`"constructor"` were all accepted with 200. No SQL injection risk
(parameterized queries, jsonb columns) but the #442 execution engine must treat all of
these as untrusted. Cheap fix available now: check `schedule_transition`'s target against
the same template set create-time validation already loads.

**N2 (non-blocking):** publishing an already-published version overwrites
`published_at`/`published_by`, conflicting with `WF-6`'s "a published version is immutable."
Should refuse or no-op.

**N3 (non-blocking):** `work_item_type.workflow_id` is a single-column key, not tied to a
workflow in its own workspace — nothing writes it yet; whoever adds the first writer should
use a composite `(workspace_id, workflow_id)` key.

**N4 (informational):** `workflow.active_version_id` isn't DB-limited to that workflow's own
versions; application code is correct today.

**N5 (non-blocking):** create/publish write no audit event despite changing governance
configuration.

**Verified clean:** tenant scoping on `fromWorkflow`/`fromWorkflowVersion` (reach check
built into the query), cross-tenant probes all correctly refused (404/403 as appropriate,
path parameter wins over body-supplied id), all 5 policy entries real and correctly scoped,
capability strength no weaker than the legacy mechanism (viewer/member read-only,
admin can create, customer refused both). Migration re-confirmed additive-only via a
fresh existing-row test (two `work_item_type` rows survived 0073 untouched).

Full suites reproduced: integration 104/1351, permissions 13/83, domain 11/544 — all green.
`tsc --noEmit` clean for api/permissions/domain configs; the tests config is B3.

B1, B2, B3 are all required before merge. A fresh Opus pass is required on the new head —
this is a code-changing fix, not a no-op reconfirmation.
