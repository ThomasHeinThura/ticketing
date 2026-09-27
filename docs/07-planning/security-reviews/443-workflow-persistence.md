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

## Security review

**Model:** PENDING — Opus, mandatory (touches a migration and new capability-gated routes)
**Session:** PENDING

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
