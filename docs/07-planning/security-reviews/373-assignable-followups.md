# Pre-merge security review — PR #373 (assignable feed follow-ups to #362's L1–L4)

**Reviewed head:** `34a4f23a0e340aec56fd4f566967f607fd85b1ce`

**Merge base with `main`:** `e414895231784ca7e59b22c7b02509de8c26966b`

**Verdict: CLEAR.** No HIGH, MEDIUM or LOW findings. There is one informational note
(N1) and one correction to my own earlier review (L4).

**Scope and authority.** The change touches:
- `apps/api/src/work-item/controllers/list-assignable-people.ts`;
- `apps/api/src/work-item/index.ts`;
- `docs/03-features/assignment.md` (a spec sentence recording the workspace-scoped count);
- `tests/api-integration/work-item-assignable.test.ts` (three new cases).

The fix is authorized by the merged decision-log PR #374 ("authorize named post-merge
fixes"), which names #362 L1–L4.

**Reviewer independence.** A fresh, review-only Opus 5.5 context. It wrote none of the
change. It worked in a private worktree against a private database, `o373_test`, which was
dropped afterwards. Scratch probes were not committed.

## 1. Is each of L1–L4 closed?

| Finding | Fix | Re-measured on real Postgres over HTTP | Status |
| --- | --- | --- | --- |
| L1: cross-workspace load count | `eq(work_item.workspace_id, workspaceId)` in the load `and()`. `workspaceId` is `c.get("workspaceId")`, set by `workspaceAccess.fromProject` from the project's own row, so the client cannot supply it. | Ada has 3 open items in workspace B and 1 in A; a workspace-A lead now sees `openWorkCount: 1` (it was 3 at #362). | Closed |
| L2: whole-table aggregate | `inArray(work_item.assignee_id, [...allowed.keys()])`. It is never empty, because the function returns before the query when `allowed.size === 0`. | `EXPLAIN` gives an Index Scan on `work_item_assigneeId_idx` (`assignee_id = ANY(...)`), with `workspace_id` as a filter, then primary-key lookups on `state` and `state_template`. There is no Seq Scan on `work_item`, with or without `enable_seqscan`. | Closed |
| L3: customer and placeholder people listed | `eq(person.side,'staff')` and `eq(person.is_placeholder,false)` in the roster `and()`. | A customer-side person and a placeholder person, each with a project membership row: the feed now returns `[]` (both were listed at #362). | Closed |
| L4: unordered caller `LIMIT 1` | The caller is now resolved as the staff person with this `user_id` who is on this project's roster, ordered by `created_at`. | See the correction below. | Closed (defence in depth) |

**Correction to my #362 review (L4).** The lane is right, and my premise was wrong.
`person_user_unique` is a partial UNIQUE index, `ON person (user_id) WHERE user_id IS NOT
NULL`. It is in `schema.ts` and in migration
`apps/api/drizzle/0053_fix_person_user_unique_scope.sql:4`, and it was already on #362's
merge base (`8f545c3`). I missed it and read only `person_userId_idx`. A live probe confirms
it: inserting a second `person` row for an existing `user_id` is rejected with constraint
`person_user_unique`. So the multi-row tie L4 described cannot happen. The new resolution is
harmless defence in depth. It also ties the self branch to the same facts the roster uses
(staff, and on this roster).

## 2. New leaks or authority changes

- **Authority.** No capability or policy entry changed. The `assign`, `update` and
  empty tiers are computed the same way as at #362. Every change narrows what is returned:
  - the roster adds two filters;
  - the count adds two filters;
  - caller resolution adds a roster join. At #362, a caller whose person was not on this
    roster already got `[]` from the self branch, because `byPerson.get` missed. So this is
    no behaviour change for any reachable caller.
- **Grouping.** The added predicates sit inside the existing single `and()` blocks. There is
  still no `or()` anywhere (the #320 D0 class).
- **No existence oracle** (re-measured). A foreign workspace's project and a made-up id both
  return `400 "Workspace ID could not be determined"`, byte-identical.
- **Response shape** is unchanged: `personId`, `name`, `roleName`, `openWorkCount`.
  `check:openapi` matches (110 operations). `test:contract` exits 0: Redocly findings stay at
  the baseline of 16, and oasdiff finds no unapproved breaking changes against `origin/main`.

## N1 — informational, not a finding

The count is now scoped to the workspace, not to what the caller can reach. Today these are
the same thing: project reach *is* workspace membership (`work-item/policy.ts` file comment,
`project/index.ts`). When per-project reach (`ProjectReachFacts`) goes live, the count should
be re-scoped to reachable projects. Otherwise a restricted project's items would again be
visible as one number. There is nothing to fix now; this records the dependency.

## Evidence (run at the reviewed head, private DB `o373_test`)

| Check | Result |
| --- | --- |
| `tests/api-integration/work-item-assignable.test.ts` | 1 file, 11/11 passed (8 existing + 3 new: L1, L3, L4) |
| `apps/api` unit | 59 files, 490/490 passed |
| `test:permissions` | 11 files, 81/81 passed |
| `apps/api` `tsc --noEmit` | clean |
| `check:openapi` | matches (110 operations) |
| `test:contract` | exit 0 (Redocly 16 findings, same as baseline; oasdiff no breaking changes) |
| `check:route-policy` | exit 0 |
| Reviewer probes | P1 oracle: identical 400s; P2 L1 closed (count 1, not 4); P3 L3 closed (`[]`); P4 `person_user_unique` rejects a second row; P5 index-only plan for the load query |
| GitHub CI at `34a4f23` | every required check green, except `pull request template + security review`, the gate this file feeds |

## Merge-head attestation (Opus 5.5)

**Reviewed head:** `a4172cf5087716474cf5af54d32cf8348dfd0124`

This is a fresh Opus 5.5 context, 2026-09-26. It attests the `gh pr update-branch` merge of
`main` at `8a51415e18b7681db5491570ac7c01f99e4fe9d9` into `672c0e7`. `672c0e7` is the Opus note
over the reviewed code head `34a4f23`, and it changed only this file.

- **Parents:** exactly (`672c0e7`, `8a51415`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution. It is the only commit not on `main`.
- **What `main` gained since the reviewed base `e414895`:** only #374 (`78ca997`, `eeb2397`,
  merged by `8a51415`), which touches `decision-log.md` and `status.md`. #343, #330, #370 and
  #328 were already in the reviewed base, so the Opus review at `34a4f23` already saw them.
- **PR change unchanged:** `git diff e414895 672c0e7` and `git diff 8a51415 a4172cf` are
  byte-identical (same sha256), and no file overlaps.
- **Interaction with #343:** none. This PR touches
  `apps/api/src/work-item/{index.ts,controllers/list-assignable-people.ts}`,
  `assignment.md`, its integration test and this note. It does not touch #343's
  `apps/api/src/index.ts`, `policy.ts` or `tests/permissions/matrix.fixture.json`. The matrix
  and route-coverage suites pass at the merge head.
- **Commands at `a4172cf`** (packages built first; private DB `att373_test`, dropped
  afterwards):
  - `pnpm check:openapi`: "matches the API (110 operations)".
  - `apps/api test:unit` passes 59 files / 490 tests.
  - `apps/api test:permissions` passes 11 files / 81 tests.
  - `tests/api-integration/work-item-assignable.test.ts` passes 1 / 11.

**Verdict at `a4172cf5087716474cf5af54d32cf8348dfd0124`: CLEAR.**

## Merge-head attestation (Opus 5.5) — after #352 merged

**Reviewed head:** `79396a861775ca245f2821ad6d5a1dae52eed661`

This is a fresh Opus 5.5 context, 2026-09-26. It attests the `gh pr update-branch` merge of
`main` at `9c490d76b2b46f92b83df9f93a1a40f34437cd1b` (#352: the env-read detector in
`scripts/ci/lib/env-reads.mjs` and its tests, a reworded comment in `require-auth-secret.ts`,
and docs) into the previously attested head `985bc6f`. `8a51415..9c490d7` is that one merge.

- **Parents:** exactly (`985bc6f`, `9c490d7`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution. It is the only commit not on `main`.
- **PR change unchanged:** `git diff 8a51415 985bc6f` and `git diff 9c490d7 79396a8` are
  byte-identical (same sha256), and no file overlaps.
- **Interaction with #352:** this PR's `apps/` changes add no `process`/`import.meta`
  environment access. `pnpm check:env` exits 0 at `79396a8` with #352's detector: "29
  environment read(s), every one attributable to configuration-reference.md", scanning 1020
  files.
- **Tests at `79396a8`** (packages built first): `apps/api test:unit` passes 59 files / 490
  tests.

**Verdict at `79396a861775ca245f2821ad6d5a1dae52eed661`: CLEAR.**
