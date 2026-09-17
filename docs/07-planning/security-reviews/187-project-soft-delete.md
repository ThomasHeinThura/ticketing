# Security review — PR #200 (issue #187: project soft-delete)

**Reviewed head:** `ff4d11faf1db05ed21b14672800846ce6bec8a83`

## What this PR does

`work_item.project_id` carries `ON DELETE CASCADE` (PR #185). The live `project` table had
no soft-delete window, so the existing hard-delete route would silently destroy every work
item under a project once a write path for work items exists — an ordinary user action with
no recovery window. This PR:

- Adds nullable `deleted_at`/`purge_after` columns to `project` (migration
  `apps/api/drizzle/0057_project_soft_delete.sql`), mirroring `organisation`'s existing pair
  from PR #179.
- Converts `delete-project.ts` from a hard `DELETE` to a single atomic
  `UPDATE ... WHERE id = ? AND workspaceId = ? AND deletedAt IS NULL RETURNING *`.
- Filters soft-deleted projects out of every read/write path that touches a project or its
  children: `get-project.ts`, `get-projects.ts`, `get-project-statistics`,
  `get-tasks.ts`, `export-tasks.ts`, `global-search.ts` (all four of its project-joining
  queries, via one shared filter), `reorder-projects.ts`, and task/column creation (via a
  shared helper, `getProjectWorkspaceId`).

Deliberately out of scope, tracked as **#198**: the actual hard-purge job, a `legal_hold`
table, a restore/undelete endpoint, and any change to `organisation`/`workspace`.

## Round 1 (head `cc65f22`)

Three independent reviewers dispatched: two ordinary Sonnet (correctness/tests;
spec/vocabulary alignment) plus the mandatory Opus pass required for this
`apps/api/drizzle/*.sql`-touching PR.

**Core mechanism confirmed sound**: the atomic `UPDATE ... WHERE ... AND deletedAt IS NULL`
is race-safe under concurrent double-delete — live-reproduced under READ COMMITTED
(deployed isolation, confirmed via `show transaction_isolation`) with a controlled
two-transaction interleave and an 8-concurrent-request probe through the real route: one
row stamped once, the rest 404, zero 5xx. Structurally different from PR #191's/#195's
hand-written-trigger TOCTOU races: the check lives inside the writing statement's own WHERE
clause, under the same row lock as the act, with no window between them.

**Real, overlapping gaps found by all three reviewers, none in the CASCADE-safety mechanism
itself but in read/write-path filtering elsewhere**:
- Task/column creation didn't check whether the target project was soft-deleted before
  inserting (ordinary reviewer).
- `reorder-projects.ts` leaked a soft-deleted project into its response and its position
  renumbering (ordinary reviewer).
- `GET /task/tasks/{id}`, `/task/export/{id}`, and global search (by project name, task
  title, and comment/activity) all still surfaced a soft-deleted project's content —
  live-reproduced by Opus.
- OS1 (blocking): the route's OpenAPI description claimed an automatic purge that no job
  performs yet (#198 tracks the job itself).
- OS2 (blocking): the PR's "Not done" section didn't name the three leaking read paths
  Opus found.
- Several smaller findings: response schema missing the new columns, stale UI copy, a
  documentation note on a latent `REPEATABLE READ` edge case (not used anywhere in this
  codebase today), a missing trailing newline, and a status-code claim in the PR body that
  didn't match what Opus actually measured (400/403/404 are all distinct, not "look the
  same," though none leaks a cross-tenant signal).

## Remediation (`54d4868`, then `ff4d11f`)

Fixed centrally where possible: `getProjectWorkspaceId` (the shared helper both task and
column creation call) now filters `deletedAt`, closing both call sites in one change.
`global-search.ts`'s single shared `workspaceFilter` (reused by all four of its
project-joining queries) got the same treatment. `get-tasks.ts`, `export-tasks.ts`, and
`reorder-projects.ts` were each fixed directly. The route description, UI copy, response
schema, and the smaller polish items were all addressed. A second commit (`ff4d11f`) fixed
one more UI-copy instance of the same overclaim, found by the alignment reviewer's delta
pass.

## Round 2 (delta re-review)

All three reviewers re-verified their own findings against the actual source at the new
head, not against the PR's description of it. All three confirmed their findings closed.
The ordinary correctness reviewer specifically re-checked that `create-task.ts`'s fix
applies unconditionally (not just on the has-assignee path, which was the exact shape of
the original gap). The alignment reviewer found one more instance of the same UI-copy
overclaim class (a different string than the one already fixed), fixed directly in
`ff4d11f`.

Opus extended its clearance across the `54d4868` → `ff4d11f` gap by git tree hash (every
path except `i18n/en-US.json` byte-identical; that file's only change moves a claim in the
less-overclaiming direction, outside security-review scope) rather than re-reviewing the
whole diff again. Opus also disclosed and corrected its own instrument error transparently:
an initial round-2 probe of global search reported a false leak, which turned out to be the
reviewer's own test matching the response's echoed `searchQuery` field rather than any real
leaked task — caught by reading the response shape and re-testing on result ids. The PR's
own test suite used the correct methodology from the start.

**Final verdict: CLEAR.** No finding blocks merge.

**Residual findings, all non-blocking, rolled into issue #202 (widened, not a new issue)**:
one more instance of the UI-copy overclaim (a different string, sidebar dialog rather than
the settings-page one already fixed); `GET /column/{projectId}` still returns a
soft-deleted project's columns; `update-task-status.ts`/`delete-task.ts`/`move-task.ts`
bypass the project filter, so a soft-deleted project's tasks stay individually
readable/mutable/movable/deletable by task id; a duplicate `position` value can now occur
between a soft-deleted and a live row (benign until a restore endpoint exists); a
misleading "does not belong to this workspace" error for a soft-deleted project in
`reorder-projects.ts`. None of these carries a cross-tenant or authorization risk — same
permission/workspace gates as before on every path, no cascade fires from any of them.
