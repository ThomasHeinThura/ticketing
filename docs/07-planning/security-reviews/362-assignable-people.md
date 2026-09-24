# Pre-merge security review — PR #362 (assignable-people feed for the person picker, #30)

**Reviewed head:** `bd2388c520d931810e67fd44695b5f962a4171ac`

**Merge base with `main`:** `8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918`

**Verdict: CLEAR.** No HIGH, no MEDIUM. Four LOW findings, none blocking, each with a
failure scenario below. They are recommended follow-ups, not merge conditions.

**Status of the gate:** this is the mandatory independent Opus security review for the head
named above, **and for that head only.** A later commit touching anything outside
`docs/07-planning/security-reviews/` voids it and needs a fresh delta review. No waiver was
sought or used.

**Reviewer independence.** A fresh, review-only Opus 5.5 context. It wrote none of the
change and edited nothing outside this file. The review ran in a private worktree against a
private database (`o362_test`), dropped afterwards.

## Scope reviewed

`git diff 8f545c3..bd2388c`: `apps/api/src/work-item/{controllers/list-assignable-people.ts,
index.ts, policy.ts, response.ts}`, `packages/domain/src/workflow/workflow.ts`,
`tests/api-contract/openapi.json`, `tests/api-integration/work-item-assignable.test.ts`,
`tests/permissions/matrix.fixture.json`. The spec is `docs/03-features/assignment.md`
(AS-1, AS-2, AS-5, Screens, API). Also checked: `rbac.md`, `multi-tenancy.md`,
`data-model.md` (`person`, `membership`), `require-workspace-capability.ts`,
`workspace-member-roles.ts`.

## 1. Tenant scope

- **Roster predicate.** `membership.scope = 'project' AND membership.scope_id = :projectId
  AND person.active = true`, all in one `and()`. There is no `or()` anywhere in the change,
  so the #320 D0 grouping class cannot occur. The load query is also a single `and()`.
- **Project resolution.** `workspaceAccess.fromProject("projectId")` resolves the project's
  workspace from the database and checks the caller's membership before the handler runs.
  `projectId` then only feeds the roster `WHERE`, so a project in another workspace never
  gets as far as the roster query.
- **Existence oracle (#338 standard).** Measured on real Postgres over HTTP, as a workspace-A
  admin: workspace B's real project gives `400 "Workspace ID could not be determined"`, and a
  non-existent project id gives `400 "Workspace ID could not be determined"`. Status and body
  are byte-identical, so there is no oracle. There is no key-addressed input: the route takes
  only `projectId`.
- **Weak test assertion (not a defect).** The PR's own "non-member" case accepts
  `[400, 403, 404]`, so it would not catch a regression that made the two responses differ.
  Tightening it to the measured identical `400` is a cheap follow-up.

## 2. Data exposure

- **Fields returned:** `personId`, `name` (the linked `user.name`, or null), `roleName`, and
  `openWorkCount`. There are no emails, no SSO or external-identity ids, and no user ids.
  The zod schema (`AssignablePerson`) and the OpenAPI baseline match these fields.
- **Deactivated people** are excluded (`person.active = true`); the PR's test covers this.
- **Pagination and search:** none exists, and the spec asks for neither. There is no
  user-supplied search term, so LIKE-injection and ReDoS do not apply. Result size is bounded
  by the project roster.

## 3. Authority

- **Policy vs `rbac.md` / `assignment.md`:** `GET /api/projects/{id}/assignable`
  requires `work_item:read`, as the spec's route table says. The actor-dependent filter
  matches AS-1 and AS-2 and the Screens section:
  - a holder of `work_item:assign` sees the active roster;
  - a holder of `work_item:update` without `assign` sees only themselves;
  - anyone else gets `[]`.

  Both capability reads go through `workspaceMemberRoles`, `isUnambiguousMembership` and
  `builtInRoleHasCapability`, the same predicate `assertCallerHasCapability` uses (#318's
  genuine-row rule included). A duplicated or ambiguous membership row fails closed to `[]`.
- **Registry and coverage:** the route is in `workItemPolicies` (`scope: project`,
  `scopeSource: row`, `reach: required`). The permission-matrix fixture has all eight roles.
  `route-coverage.test.ts` passes (17 tests), and so does `check:route-policy`.
- **`workflow.ts`:** the change only extracts the literal `["completed","cancelled"]` into an
  exported `CLOSED_STATE_GROUPS` and builds the same `CLOSED_GROUPS` set from it.
  `isClosedGroup` behaves the same. The set is a copy made at module load, so mutating the
  exported array would not affect it. The only other caller is the new controller. The domain
  suite passes (470/470).

## Findings

### L1 — `openWorkCount` counts work outside the caller's reach, across workspaces (LOW)

The load query has no project or workspace filter; it counts every open, non-archived,
non-deleted item assigned to the person anywhere in the instance. Staff people belong to the
single internal organisation and work across workspaces, and a workspace is not a security
boundary (`multi-tenancy.md`). So the count includes items in projects that serve other
customer organisations, where the caller has no reach.

*Failure scenario (measured):* Ada is on the roster of project A in workspace A and holds 3
open items in workspace B's project. A lead of workspace A, with no access to B, sees
`openWorkCount: 3`. Over time, a caller can watch that number and infer activity in projects
they cannot read.

*Why it is LOW:* it reveals one number, with no content, keys or titles. The spec's own
purpose ("who is already loaded") wants the person's overall load, and the controller's
docstring says this was a deliberate choice. *Recommendation:* either scope the count to
projects in the caller's reach, or record the "global load" decision in `assignment.md`, so
the choice is written down rather than left implicit.

### L2 — The load query aggregates the whole `work_item` table on every call (LOW)

`loadRows` groups every assigned open item in the instance and then drops what it does not
need in memory. It is not restricted to the ids in `allowed`.

*Failure scenario:* on a large instance, every picker open runs a full aggregate. Anyone with
`work_item:read` can open the picker, and it opens often in list and bulk views, so this is
cheap load amplification.

*Fix:* add `inArray(workItemTable.assigneeId, [...allowed.keys()])` to the same `and()`.
This also shrinks L1's exposure to the people actually shown.

### L3 — Customer-side and placeholder persons are not filtered (LOW, defence in depth)

The roster predicate does not check `person.side = 'staff'` or
`person.is_placeholder = false`. `data-model.md` says a placeholder "can never be assigned or
hold a membership", and that customer people hold only organisation-scoped memberships. The
database does not enforce either rule.

*Failure scenario (measured):* when a customer-side or placeholder person has a
`membership(scope='project')` row, the feed lists them as assignable. No application path
writes `membership` today (there is no `insert(membershipTable)` in `apps/api/src`), so this
cannot be reached yet. It becomes reachable once SCIM, import or roster-management writers
land.

*Recommendation:* add both predicates to the shared roster helper that #359 will extract, so
the feed and `POST /assign` refuse these people together.

### L4 — The caller's person is read with an unordered `LIMIT 1` (LOW)

`person.user_id` is not unique (`person_userId_idx` is a plain index). The handler picks
`LIMIT 1` with no `ORDER BY`, which is the same pattern `workspace-member-roles.ts`
documents as nondeterministic.

*Failure scenario:* a user with two `person` rows (staff plus customer, per
`multi-tenancy.md`, if both are linked to one user) may resolve to the wrong row. A self-only
caller then sees `[]` instead of "Assign to me". This fails closed: the chosen id is only
used to look up an entry already in this project's roster, so no one else's entry can be
returned.

*Recommendation:* resolve the caller as the person on this roster whose `user_id` matches,
not as an arbitrary person row.

## Evidence (run at the reviewed head)

| Check | Result |
| --- | --- |
| `tests/api-integration/work-item-assignable.test.ts` (private DB `o362_test`) | 1 file, 8/8 passed |
| `apps/api` unit (`vitest.config.ts`) | 58 files, 488/488 passed |
| `packages/domain` unit | 8 files, 470/470 passed |
| `test:permissions` (`vitest.permissions.config.ts`) | 10 files, 80/80 passed (route-coverage 17) |
| `check:openapi` | baseline matches (107 operations) |
| `check:route-policy` | exit 0 |
| Reviewer probes (scratch, not committed) | P1 oracle: identical 400s; P2: L1 reproduced; P3: L3 reproduced |
| GitHub CI at `bd2388c` | all required checks green, except `integration - Postgres 18` still pending and `pull request template + security review` failing, which is the gate this file feeds |

The first unit and permissions runs failed with `Failed to resolve entry for package
"@taskdesk/email"`. This was the environment, not the change: the fresh worktree had no
package build. After building `packages/*`, both suites passed in full.
