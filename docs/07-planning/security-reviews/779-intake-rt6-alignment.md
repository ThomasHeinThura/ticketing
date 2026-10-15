# PR #779 security review record: skipped default assignee recorded at accept; RT-6 matches IQ-7 (#761)

PR #779 closes #761 under Thomas's 2026-10-15 decision. The triager may override the work-item type at accept (IQ-7). An ineligible snapshotted default assignee leaves the item unassigned, and `defaultAssigneeSkipped` is recorded in the `submission.accepted` audit metadata. RT-6 is amended to match.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts.

## Review chain

- Ordinary review B by Claude Sonnet 5.5: APPROVE at `df542c91` (matches the decision and SLA-1; a merge probe with #774 is conflict-free).
- Ordinary review D by Claude Sonnet 5.5: APPROVE at `df542c91` (7 targeted tests; 2 mutations caught).
- Security review by Claude Opus 5.5: CLEAR at `df542c91` (audit readable only by admins; responses unchanged, so no oracle; stale references refused before anything is created).

**Reviewed head:** `df542c913972ad4d939af0a25e69bc1097f46eb1`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `779-ordinary-b-sonnet.md` | Ordinary review B (main..df542c91) | Claude Sonnet 5.5 | `df542c91` | APPROVE | `6ed8300f1db56791365e1a031c780caf77d9283f2617255732afd3dbf54b86a0` |
| 2 | `779-ordinary-d-sonnet.md` | Ordinary review D (main..df542c91) | Claude Sonnet 5.5 | `df542c91` | APPROVE | `67e2a4b7c80a675a8911dda42f1dc1652963968f5798889a278688c77bbc9abc` |
| 3 | `779-security-opus.md` | Security review (main..df542c91) | Claude Opus 5.5 | `df542c91` | CLEAR | `eb2a6c3c88eff8d8c3423fb2c3a3c7c755f7492be4c28ef5ac593e5d77eda7e2` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/779-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 6ed8300f1db56791365e1a031c780caf77d9283f2617255732afd3dbf54b86a0) -->
# Ordinary review B, PR #779 (#761: RT-6 alignment, skipped default assignee audit)

**Reviewed head:** df542c913972ad4d939af0a25e69bc1097f46eb1
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** main 9297362b5f2dd1f17da935c8051c1562b473638a (merge base)
**Method:** scratch detached worktree at the exact head (removed afterwards); read-only; targeted tests only.

## Commands
- `gh pr view 779 --json headRefOid` = head above. Diff: intake/repository.ts (+20), request-types-and-catalogue.md (+16/-3), new tests/api-integration/intake-rt6-snapshot.test.ts (+181).
- `CI=true vitest run --config vitest.integration.config.ts ../../tests/api-integration/intake-rt6-snapshot.test.ts`: 1 file, **7 tests passed**.
- Merge probe with #774's head: `git merge-tree --write-tree df542c91 13f41514` returned a tree id with no conflict. Both PRs edit intake/repository.ts but in different hunks (#774: claim and the call before the accepted audit; #779: the assignee eligibility block and the audit `after`).

## Spec text versus the owner decision on #761
The decision: the triager may override the type at accept (IQ-7 governs); the snapshot still pins form schema, SLA override and default assignee; an ineligible default assignee leaves the item unassigned with the reason recorded; RT-6 amended, with tests for both behaviours. The amended RT-6 says exactly this, and in addition states: missing version gives `409`, the chosen type must be in the workspace else `422`, a policy outside the workspace gives `422`, atomic acceptance, never substitutes live request-type mapping. I verified the statuses in source (missing snapshot: 409 "Submitted form version is unavailable"; unavailable SLA policy: 422) and the type check in the existing conversion path (422). Test titles cover type override, eligible assignee, ineligible reasons, atomic failure for a type outside the workspace, and the database-enforced cross-workspace policy refusal.

## SLA fallback statement versus SLA-1
sla.md SLA-1: "work item type override, then request type, then project, then workspace default". The new RT-6 bullet: chosen work-item type, then the snapshotted request-type override, then the project, then the workspace default. Code: `type.slaPolicyId ?? requestSlaPolicyId ?? project.slaPolicyId ?? workspace.slaPolicyId`. Consistent in all three places.

## Audit metadata `defaultAssigneeSkipped`
- Shape: `after.defaultAssigneeSkipped = { personId, reason }`, reason one of `not_a_project_member`, `inactive`, `not_staff`. Key names contain none of the AU-2 secret-name segments (checked against audit-trail.md's list), and `personId` ends in `id`; no redaction collision. It is added only when a skip happens, so the normal row is unchanged.
- Convention: events.md `submission.accepted` row lists the outbox payload (`ref`, `workItemKey`); that payload is unchanged and the new RT-6 text correctly says "No event key is added". audit-trail.md has no `submission.accepted` row at all (it lists `submission.claimed` and `submission.duplicate`), so the new audit metadata is documented only in request-types-and-catalogue.md. Non-blocking: add a `submission.accepted` row to audit-trail.md ("record reference, work-item key and, when skipped, defaultAssigneeSkipped") so the audit vocabulary has one home.
- Eligibility is "active staff with a project-scope membership of the destination project" (the existing query joins `membership` on scope project); the spec text says "active staff member of the destination project", consistent. Reason `not_a_project_member` also covers a person row that no longer exists. A lead with only workspace-level reach (not a direct project membership) counts as not a member; that is existing behaviour, now surfaced and worth a one-line note.

## Interaction with #774
No textual conflict. Semantically: after #774 the claim audit is appended just before `submission.accepted`; #779's data rides on the accepted row, so the two compose. The RT-6 test asserting no accepted audit on atomic failure remains true under both ordering variants.

## Findings
**Blocking:** none.
**Non-blocking:** audit-trail.md row (above); the "member of the destination project" note; state in the PR that the 2026-10-13 recovered RT-6 wording is superseded by the owner entry in #780, so #779 should merge with or after #780.

**Verdict:** APPROVE
<!-- END REPORT (sha256 6ed8300f1db56791365e1a031c780caf77d9283f2617255732afd3dbf54b86a0) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/779-ordinary-d-sonnet.md; Claude Sonnet 5.5; sha256 67e2a4b7c80a675a8911dda42f1dc1652963968f5798889a278688c77bbc9abc) -->
# #779 (#761) ordinary review D (line-level)

**Reviewed head:** df542c913972ad4d939af0a25e69bc1097f46eb1
**Model / context:** Claude Sonnet 5.5, fresh independent context (did not author, direct or remediate)
**Comparison base:** merge-base with origin/main (9297362b); 3 files: `apps/api/src/intake/repository.ts` (+20), `docs/03-features/request-types-and-catalogue.md`, new `tests/api-integration/intake-rt6-snapshot.test.ts` (181 lines).

## Commands
- `pnpm install --frozen-lockfile --prefer-offline`; `pnpm turbo typecheck` 9/9.
- `CI=true vitest run --config vitest.integration.config.ts` on `intake-rt6-snapshot`, `intake-atomic-conversion`, `intake-triage-negative`, `intake-triage-actor`: **4 files, 28 tests passed** (testcontainers Postgres, started and stopped by the harness).
- Mutation checks, run in the scratch worktree and reverted: M1 replace the eligibility check `person?.active && side === "staff"` with `if (person)`: 2 tests fail (inactive, not staff). M2 disable the `defaultAssigneeSkipped` audit spread: 3 tests fail (all three skip reasons). Both mutations are killed.

## Code review
- Behaviour: the only code change is additive. The existing eligibility test is unchanged; the `else` branch records `{ id, reason }` and the acceptance audit `after` gains `defaultAssigneeSkipped: { personId, reason }` only when a snapshotted assignee was skipped, so an accepted submission without a default assignee, or with an eligible one, produces a byte-identical audit row. Reason mapping is exhaustive over the three failure shapes: no project membership row (`not_a_project_member`), `active=false` (`inactive`), `side != staff` (`not_staff`); a person who is both inactive and not staff reports `inactive`, a deterministic precedence. The audit row is written in the same transaction as the work item (unchanged), so the record cannot disagree with the outcome. No event key is added, as the spec text says.
- Data in the audit row is a person id and a closed reason vocabulary; no name or email. Fine for the hash-chained append-only log.
- Minor: `!person` also covers a person row that does not exist at all (deleted), reported as `not_a_project_member`; acceptable and arguably true of the snapshot reference.

## RT-6 text accuracy vs code (checked line by line)
- "pinned version supplies form schema, field mapping, SLA override, default assignee": `version.formSchema`, `snapshot.defaultAssigneeId`, `requestSlaPolicyId` all come from the submission's `request_type_version`. True.
- "missing version fails with 409, live request type never consulted": `409 Submitted form version is unavailable`. True.
- "work-item type and project pre-filled but the triager's choice (IQ-7); chosen type must exist in the same workspace else 422": type lookup is `id = typeId AND workspace_id = workspaceId`, `422`. True.
- SLA order "chosen work-item type, then snapshotted request-type override, then project, then workspace default": `type.slaPolicyId ?? requestSlaPolicyId ?? project.slaPolicyId ?? workspace.slaPolicyId`, which also matches `sla.md` `SLA-1`. A policy outside the workspace: `422 Submission SLA policy is unavailable`. True. "The database also refuses a cross-workspace policy in a snapshot": proven by the DB-level test.
- "unassigned, `defaultAssigneeSkipped` with person id and reason": true.
- "Acceptance is atomic": the conversion is one transaction; the type-failure test asserts no work item, state still `new`, no audit row.

## Test review
- Meaningful: assignment/skip cases assert both the DB outcome (`assigneeId` null, submission `accepted`, exactly one audit row, `toMatchObject` of reason and person) and the negative (no `defaultAssigneeSkipped` key for the eligible case), and both mutations above are caught.
- Gaps (non-blocking): (1) the title "fails atomically for a work-item type outside the workspace" sends a non-existent id, not a real type from another workspace, so the cross-workspace branch of the `AND workspace_id` is not separately proven; (2) the `409` missing-version path is claimed in the spec and untested; (3) "stale policy" test only proves the DB constraint rejects a cross-workspace snapshot update; the acceptance-time `422` for an unavailable policy (via project or workspace default) is claimed and untested; (4) the first test (type override) is largely pre-existing behaviour made explicit, still fine.

## Verdict
No blocking findings. Residual risk is limited to the untested spec claims in gaps 1-3, which are claims about code that already exists and that I verified by reading.

**Verdict:** APPROVE
<!-- END REPORT (sha256 67e2a4b7c80a675a8911dda42f1dc1652963968f5798889a278688c77bbc9abc) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/779-security-opus.md; Claude Opus 5.5; sha256 eb2a6c3c88eff8d8c3423fb2c3a3c7c755f7492be4c28ef5ac593e5d77eda7e2) -->
# PR #779 (#761) security review — RT-6 / IQ-7 acceptance semantics

**Reviewed head:** df542c913972ad4d939af0a25e69bc1097f46eb1
**Model / context:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context
**Comparison base:** merge base 9297362b5f2dd1f17da935c8051c1562b473638a (origin/main at review time 9bb28099a69d1e599e1d7451ebdf6225e380546c; `git merge-tree` against main: clean; against #774 head 13f41514: clean)
**Role:** did not author, direct or remediate this change. Ordinary reviews B/D read as context only; every claim below re-verified against source.

## Surfaces examined
- `apps/api/src/intake/repository.ts` — `convertSubmissionInTransaction` (full body), `acceptSubmission` staff path, portal auto-accept call site.
- `apps/api/src/audit/index.ts`, `audit/controllers/list-workspace-audit.ts`, `list-instance-audit.ts` — who can read `audit_log.after`.
- Repository-wide search for any other reader of `audit_log` or of `defaultAssigneeSkipped` (none besides the two audit-read controllers and the writer).
- `docs/03-features/request-types-and-catalogue.md` RT-6 text vs code.
- `tests/api-integration/intake-rt6-snapshot.test.ts`.

## Commands (scratch worktree, CI=true Testcontainers Postgres 18)
- `pnpm install --frozen-lockfile --prefer-offline` — exit 0.
- `pnpm turbo typecheck` — exit 0 (turbo cache hit, content-hash keyed).
- `vitest run --config vitest.integration.config.ts intake-rt6-snapshot.test.ts` — 1 file, 7 tests passed, exit 0.
- Same config over all 9 `intake-*` integration files — 9 files, 44 tests passed, exit 0.
- PR checks at this head: 21 success, 1 failure = `pull request template + security review` (expected: awaits this review note).

## Findings
1. **Audit visibility — acceptable.** The new `defaultAssigneeSkipped {personId, reason}` lives only in the `submission.accepted` audit row's `after`. Audit rows are readable only by instance administrators (`instance:read_audit`) and workspace administrators (`workspace:manage_settings`, reach-filtered); customers never read the audit log (AU-12). The outbox event payload, the work-item event payload, the activity row and both HTTP responses (staff accept, portal auto-accept) are unchanged and carry no skip data. Nothing new is customer-visible.
2. **personId exposure — acceptable.** The id is the request type's own configured default assignee (from the pinned version snapshot, never from request input). Workspace administrators can already see that configuration and the member list. Note: the row is written without `projectId`, so it is visible to every workspace administrator regardless of project reach — same as before this PR (the row already carried `workItemKey`). Non-blocking.
3. **Oracle — none found.** The reason is not returned to the caller of either acceptance path; the only caller-observable signal is whether the created item is assigned, which existed before. The person lookup is keyed to the snapshot id and the destination project's membership, which the triager can only choose within their own reach (`canReachProject`, unchanged).
4. **Stale snapshot refs fail closed.** Missing version → 409 (checked both in `acceptSubmission` and in the convert function); triager type not in workspace → 422; project missing/foreign/unreachable → 422; SLA policy not workspace-owned → 422. All checks run before `claimWorkItemNumber` and any insert, inside one transaction, so a refusal creates nothing. Test pins the type case (status 422, work-item count unchanged, submission still `new`, no audit row).
5. **RT-6 text accuracy — accurate.** Doc matches code: version supplies form/mapping, SLA override, default assignee; type/project are triager choices; SLA-1 order type → snapshot override → project → workspace matches `policyId` expression; three reasons match the code; "No event key is added" is true.

Non-blocking test gaps (already noted by ordinary review D, confirmed): the "outside the workspace" type test uses a non-existent id rather than a real type from another workspace; the 409 missing-version path and the acceptance-time 422 SLA path are not exercised (the SLA test proves only the database constraint).

## Residual risk / not checked
- Did not run the full integration suite; did not boot the image (API-only change, no image surface).
- Audit-trail.md has no `submission.accepted` row describing the new metadata (documentation home; non-security).

**Verdict:** CLEAR
<!-- END REPORT (sha256 eb2a6c3c88eff8d8c3423fb2c3a3c7c755f7492be4c28ef5ac593e5d77eda7e2) -->
