# Security review — workspace-scoped `sees_all` reach (issue #319)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `96fc97085afdc99c75d8ba52ffa9b605435aa5fc`
**Delta re-checked head:** `941bc3955b008df6aa751303bb09a4739d7b6658` (docs-only follow-up; see § Delta re-check)
**Pull request:** #334 (`fix/319-scoped-reach`)
**Closes finding:** #315 Opus review S3 (`315-resolve-identity.md`), issue #319
**Date:** 2026-09-23

## Head verification

- `96fc970` is a single commit whose parent is `dd067e2`, which was `origin/main` at review
  time. There is no merge commit and no conflict resolution.
- The PR diff covers 8 files: `packages/permissions/src/{identity.ts,evaluator.ts,evaluator.test.ts}`,
  `apps/api/src/permissions/resolve-identity.ts`, `tests/api/permissions/resolve-identity.test.ts`,
  `tests/permissions/matrix.test.ts`, `docs/01-architecture/rbac.md`, and
  `docs/03-features/webhooks-and-api-keys.md`.

## Surfaces examined

- `packages/permissions/src/identity.ts`: `Reach`, `Membership`, `ResolvedIdentity`.
- `packages/permissions/src/evaluator.ts`: `reaches()` in full, `authorityFor`, `can`, and
  the reach block of `evaluatePolicy`.
- `apps/api/src/permissions/resolve-identity.ts`: `resolveIdentityFromFacts` in full, and the
  loader's `seesAll: false` literal.
- `apps/api/src/database/schema.ts`: `workspace_member.workspace_id` is `NOT NULL`. The
  polymorphic `membership` table has `scope_id` and `sees_all`.
- `docs/01-architecture/rbac.md` § Reach and § elevated list; `data-model.md` `membership`;
  `webhooks-and-api-keys.md` `WH-14` and `WH-15`, before and after the change.
- Every consumer of `Reach` or `reach.kind` in the repository, found by grep across
  `packages/`, `apps/`, `tests/` and `scripts/`.
- Open PR #323 (`feat/8-shadow-mode` @ `5d26f79`): `shadow-evaluation.ts` `workspaceInReach`.
- Open PR #322 (`fix/318-reserve-role-names` @ `fb92bff`): its `resolve-identity.ts` hunks,
  and a `git merge-tree` against this head.

## Suites at this head

These ran in the worktree at `96fc970`, with the private database `pr334_opus_test` on
td-lane-pg. The database was dropped afterwards.

| Suite | Result |
| --- | --- |
| `pnpm test:permissions` | 10 files / 80 tests pass (5 turbo tasks) |
| `packages/permissions` `pnpm test` | 13 files / 261 tests pass |
| `apps/api` `test:unit` | 54 files / 412 tests pass |
| `apps/api` `test:integration` | 79 files / 1082 tests pass |
| `pnpm typecheck` (plus `--force` on permissions and api) | green |
| `node --test 'scripts/ci/**/*.test.mjs'` | 495 / 495 pass |

## Probes

### 1. Workspace scoping (pure evaluator, not in the suite)

These ran as a temporary `packages/permissions/src/zz-opus334-probe.test.ts`, which was not
committed. The identity has a workspace membership in `ws-a` with `seesAll: true`, and
`reach: { kind: "membership_with_workspaces", workspaceIds: ["ws-a"] }`.

| # | Probe | Result |
| --- | --- | --- |
| P1 | A's internal project, an A project for a customer org, an A sub-project, an A project owned by a team the person is not in | all reach ✓ |
| P2 | B's project, B's project carrying the person's own org id, B's team-owned project, a B project whose ancestor id is an A id, a B project whose `organisationId` and `projectId` equal the literal `"ws-a"` | none reach ✓ |
| P3 | A private item in A that is not visible to the person (`visibleToPersonIds`) | no reach ✓ (`sees_all` does not override `CP-16`) |
| P4 | `can()` for `instance:read_audit` at instance scope; `project:read` in `ws-b`; `project:update` in `ws-a` for a viewer | all false ✓ (`sees_all` confers no authority, including at instance scope) |
| P5 | A resource with `workspaceId` of `null`, `undefined`, `""`, `"WS-A"` or `" ws-a"` | no reach ✓ (fails closed) |
| P6 | `workspaceIds: []` | behaves exactly like `membership` ✓ |
| P7 | Unknown reach shapes: `workspace`, a misspelt `membership_with_workspace`, `ALL`, `{}` | no reach ✓ (`default: return false`) |
| P8 | A malformed payload: `workspaceIds: [undefined]`, with the resource's `workspaceId` also `undefined` | **reaches**. See S2. The resolver cannot produce this. |
| P9 | `kind: "all"` reaches B; customer `organisation` reach is unchanged | ✓ |

### 2. Contract consumers

- Only `reaches()` in `packages/permissions/src/evaluator.ts` branches on `identity.reach.kind`
  on `main` at this head. No `apps/api` route, middleware or query builder reads `reach`.
  Nothing uses an `if (kind === "membership") … else /* treat as all */` shape that the new
  variant could silently widen.
- The only producer is `resolveIdentityFromFacts`. Test fixtures build `all`, `organisation`
  or `membership` literals, and none depended on sees_all mapping to `all`.
- `evaluatePolicy` consumes a caller-supplied `inReach` boolean, not `Reach`. It is unchanged.
- **PR #323 `workspaceInReach`:** it handles `all`, then `organisation`, then falls through to
  the workspace-membership check. A `membership_with_workspaces` identity falls through to that
  check. Its sees_all workspace always is one of its workspace memberships, so the answer is
  correct and nothing is widened. The doc comment there still says `"all"` means "instance:admin
  or an explicit sees_all grant", which is stale once this PR lands (S5).
- No default changed: an identity with no sees_all still resolves `{ kind: "membership" }`,
  and instance admin still resolves `{ kind: "all" }`.

### 3. Fail-closed

- An unknown `kind` reaches nothing (`default: return false`). This is unchanged, and P7
  covers it.
- An empty `workspaceIds` array gives ordinary membership reach only (P6).
- A null, undefined or empty resource workspace reaches nothing unless the reach payload is
  itself malformed (P5, P8).
- `instance_admin` still gets `{ kind: "all" }`, which rbac.md step 1 requires. It takes
  precedence over sees_all in the resolver's ternary. No test pins that precedence (S3).

### 4. `resolve-identity.ts`

- sees_all is collected only from `memberships` entries that the loop pushed. Each entry has
  `scope: "workspace"` and `scopeId` equal to the `workspace_member.workspace_id` it was
  grouped by, which is `NOT NULL`. A workspace whose role row is malformed, ambiguous, custom,
  or a non-workspace built-in is skipped before the push, so its sees_all is dropped. That fails
  closed.
- Membership removal deletes the `workspace_member` row, so the sees_all workspace drops out
  on the next resolution.
- The "only the literal needs to change" comment has been corrected, as #319 required.
- The filter does not check `membership.scope === "workspace"` (S4). This is inert today,
  because only workspace-scope entries exist.
- **Interaction with #322 (`is_system` genuine-row rule).** `git merge-tree` against
  `fb92bff` auto-merges `resolve-identity.ts` cleanly. #322's `isGenuineBuiltInRoleGrant`
  `continue` sits before the `memberships.push`, so a sees_all flag on a row that is not
  genuine never enters `seesAllWorkspaceIds`. That is the correct fail-closed composition.
  There is one **textual conflict**, in `tests/api/permissions/resolve-identity.test.ts`, in
  the `sees_all` test's fixture rows: #334 adds a `ws-2` row and #322 adds `isSystemRole: true`.
  The resolution is to keep both rows, each with `isSystemRole: true`. Otherwise the `ws-2`
  authority assertion fails under #322. Whichever of the two lands second should also add a test
  that sees_all on a row that is not genuine yields no `workspaceIds` entry.

### 5. Mutation checks (each restored with `git checkout`; `git status` clean afterwards)

| Mutation | Result |
| --- | --- |
| M1 `evaluator.ts`: `workspaceIds.includes(project.workspaceId)` → `workspaceIds.length > 0` (global again) | `evaluator.test.ts` red (1); probes P2, P5 and P8 red |
| M2 `evaluator.ts`: sees_all branch returns `false` | `evaluator.test.ts` red (1) |
| M3 `resolve-identity.ts`: `isInstanceAdmin \|\| seesAll` → `{ kind: "all" }` (the pre-fix mapping) | `resolve-identity.test.ts` red (1) |
| M4 `resolve-identity.ts`: collect every membership, not just sees_all ones | `resolve-identity.test.ts` red (many) |
| M5 `resolve-identity.ts`: sees_all checked before instance admin (narrows an instance admin who also has sees_all) | **survives**, 43/43 green (S3) |

### 6. Gates

- `## Reviewed by` records two independent review contexts. One of them approved full SHA
  `96fc97085afdc99c75d8ba52ffa9b605435aa5fc`, which is this head. Both are recorded as
  **Codex** contexts, and the implementer is also Codex. CLAUDE.md's model-tier table says
  ordinary review is a fresh **Sonnet** context, and that only Claude Sonnet and Opus are in use.
  I found no decision-log entry that admits Codex. The orchestrator has to decide whether this
  record meets the ordinary-review tier (G1 below). I make no judgement on it here.
- `node scripts/ci/check-pr-template.mjs --body <body>` reports 2 problems. The first is that
  the Security review note link is missing. The second is that the Opus checkbox is unticked.
  Both are expected while this review is pending, and both close once the body links this note
  and ticks the box.
- **The required check `registers - env, vocabulary, reviews, skips, overrides` is red** at
  this head (run 35888677799). The cause is `check:reviews`. The body's `**Spec:**` field
  names `webhooks-and-api-keys.md`, and
  `docs/07-planning/reviews/2026-09-05/features-governance-design.md` §7 still holds 24 lines
  of open findings for that spec (AGENTS.md do-not 15). None of those findings concern reach.
  This is not a code defect, but the PR cannot merge while it is red (G2 below).

## Findings

**S1 — NON-BLOCKING (spec relaxation, recommend a decision-log line).**
`docs/03-features/webhooks-and-api-keys.md` `WH-15` (≈ lines 100–102 at this head) used to
say two things about a webhook whose owner has sees_all. It required `instance:admin` to
create one, and it listed the webhook in the security-posture panel. The new text removes
both controls for workspace-scoped sees_all. The scoping argument for dropping the
`instance:admin` requirement holds. However, a sees_all-owned webhook is still a standing
exfiltration channel for every event in a whole workspace, which goes past the owner's own
projects. Keeping it in the security-posture panel costs nothing. #319 did not ask for this
change. Webhooks are not implemented, so there is no live exposure. Recommendation: keep the
posture-panel listing, or record the relaxation in the decision log before webhook code is
written.

**S2 — NON-BLOCKING (defence in depth).** `packages/permissions/src/evaluator.ts:381-386`
matches with a plain `workspaceIds.includes(project.workspaceId)`. If the reach payload and
the resource facts are both malformed the same way (probe P8: `[undefined]` against
`undefined`, and likewise `""` against `""`), this reaches. The resolver cannot produce
either, because `workspace_id` is `NOT NULL`, and `ProjectReachFacts.workspaceId` is typed
`string`. A one-line guard would make the sees_all branch fail closed on its own, without
relying on its producers: `typeof project.workspaceId === "string" && project.workspaceId !== ""`.

**S3 — NON-BLOCKING (test gap).** `tests/api/permissions/resolve-identity.test.ts` has no
case for `isInstanceAdmin: true` combined with a sees_all membership. Mutation M5, which
puts sees_all before instance admin, survives. It fails closed, because it would narrow an
instance admin to one workspace rather than widen anyone, but rbac.md step 1 should be pinned.

**S4 — NON-BLOCKING (future-proofing).** `apps/api/src/permissions/resolve-identity.ts:420-426`
collects `scopeId` from every sees_all membership without checking `scope === "workspace"`.
The polymorphic `membership` table (`data-model.md` §2) can carry `sees_all` on organisation
and project rows. When the loader starts reading that table, a project-scope sees_all would be
put into `workspaceIds` as a project id. That is inert, since the ids are disjoint, but it is
wrong in meaning. Filter on `scope === "workspace"` now, while the change is one line.

**S5 — NON-BLOCKING (for PR #323, not this PR).** The `workspaceInReach` doc comment in
#323's `shadow-evaluation.ts` says reach `"all"` covers "an explicit sees_all grant". It
should be updated when #323 rebases onto this change. The logic is already correct.

**Gate items (not security findings, but they block merge):**

- **G1:** the ordinary-review record is from Codex contexts, not the Sonnet tier CLAUDE.md
  names. The orchestrator must decide whether it counts.
- **G2:** the required check `registers` is red because `check:reviews` sees
  `webhooks-and-api-keys.md` named in `**Spec:**` while that spec has open review findings.
  It must be green, by a legitimate route, before merge.

## Verdict

**CLEAR WITH FINDINGS** for security at `96fc97085afdc99c75d8ba52ffa9b605435aa5fc`.

The change does what #319 and #315 S3 asked:

- sees_all in workspace A gives reach within A only. It gives nothing in B, in B's
  organisations, projects or teams, or at instance scope.
- It grants no authority.
- It fails closed for unknown shapes and for an undeterminable workspace.
- It composes correctly with #322 and #323.

The adversarial probes and the mutation checks confirm this. S1–S5 are non-blocking. G1 and G2
are merge gates for the orchestrator, outside this security verdict. This review does not
clear them.

## Delta re-check at `941bc3955b008df6aa751303bb09a4739d7b6658`

`941bc39` ("docs: defer webhook reach wording to its review lane") was pushed onto the
branch during this review. Its parent is `96fc970`.

- `git diff 96fc970 941bc39` touches only `docs/03-features/webhooks-and-api-keys.md`. It
  restores that file byte-for-byte to its `origin/main` (`dd067e2`) content.
  `git diff 96fc970 941bc39 -- packages apps tests scripts` is empty. So every code probe,
  suite result and mutation above applies unchanged to `941bc39`.
- **S1 is withdrawn at `941bc39`.** `WH-15` again requires `instance:admin` to create a
  webhook owned by a sees_all identity, and again lists it in the security-posture panel.
  That is the stricter of the two texts, so no relaxation remains.
- The restored `WH-14` and `WH-15` wording, that a sees_all owner "receives everything",
  now disagrees with `rbac.md` step 2 as this PR amends it. `rbac.md` is the higher source.
  Once webhook delivery exists, it will go through `reaches()` and be workspace-scoped, so the
  gap is in the spec wording only, and it errs on the strict side. This is NON-BLOCKING, and
  it belongs to the webhook spec's own review lane, as the commit says.
- G2 should clear once `webhooks-and-api-keys.md` is also removed from the body's
  `**Spec:**` field. At the time of writing, the body still names it. That is the orchestrator's
  body edit.

**Verdict at `941bc39`: CLEAR WITH FINDINGS.** S2–S4 are non-blocking, and S5 is for #323.
G1 and G2 remain the orchestrator's merge gates.

## Delta re-check after rebase onto `main` @ `7bebaf6` (2026-09-24)

**Reviewed head:** `51af10d116eebe4f9b0ccff9f752c1a69c7df326`

The branch was rebased onto `origin/main` `7bebaf61c50d2a65255e459827c88c1d30230340`, which
includes #322, #308, #336, #345, #350 and #351. `96fc970`, `941bc39`, `2bb09e9` and `e5cf435` are
no longer in the branch history. The heads cited above are kept as a historical record only.
The binding head is the one on the line above. I reviewed this delta in a fresh detached worktree
at `51af10d`.

### Code identity

- `git range-diff dd067e2..e5cf435 7bebaf6..51af10d`:
  - `941bc39 = 7bb4a15`, `2bb09e9 = 8eaff7e` and `e5cf435 = 51af10d`. These are identical patches.
  - `96fc970 ! 9c1b87b` differs in exactly one hunk, in `tests/api/permissions/resolve-identity.test.ts`.
    That is the expected #322 conflict resolution. The `sees_all` test keeps both fixture rows,
    `ws-1` with `seesAll: true` and `ws-2` with `seesAll: false`, and each now carries
    `isSystemRole: true`.
- Blob-identical between `941bc39` and `51af10d`: `packages/permissions/src/{evaluator.ts,
  identity.ts,evaluator.test.ts}` and `tests/permissions/matrix.test.ts`.
  `resolve-identity.ts` and `rbac.md` differ only by #322's content already on `main`. The
  PR's own hunks to both are unchanged, per range-diff.

### #322 composition (probe, not committed)

In the merged `resolveIdentityFromFacts`, the `isGenuineBuiltInRoleGrant(...)` `continue`
(`resolve-identity.ts:421-430`) runs before `memberships.push` (`:432-436`). So
`seesAllWorkspaceIds` (`:456+`) only ever sees genuine grants. A temporary pure test confirmed
four cases, 4/4 green:

- A non-genuine `manager` row with `seesAll: true` resolves `{ kind: "membership" }` and no
  membership, so the sees_all is dropped.
- A mix of one non-genuine and one genuine sees_all row yields `workspaceIds: ["ws-real"]` only.
- `owner`, which is exempt from `is_system` by design, keeps its sees_all.
- A custom role name drops its sees_all.

### Gates

- **G2 closed.** `**Spec:**` no longer names `webhooks-and-api-keys.md`. `check:reviews`
  reports "no feature spec named in this change", and the required `registers` check is green
  on run 35921098966.
- G1 is unchanged. `## Reviewed by` still records Codex contexts, now at `941bc39`, which is not
  an ancestor after the rebase. That is for the orchestrator to settle.

### Suites at `51af10d` (private DB `pr334_opus_d_test`, dropped afterwards)

| Suite | Result |
| --- | --- |
| `pnpm test:permissions` | 10 files / 80 tests pass |
| `packages/permissions` `pnpm test` | 13 files / 261 tests pass |
| `apps/api` `test:unit` | 57 files / 450 tests pass |
| `apps/api` `test:integration` | 83 files / 1140 tests pass |
| `turbo typecheck --force` (permissions, api) | green |
| `node --test 'scripts/ci/**/*.test.mjs'` | 495 / 495 pass |

**Verdict at `51af10d116eebe4f9b0ccff9f752c1a69c7df326`: CLEAR WITH FINDINGS.** S2–S4 remain
non-blocking and S5 is for #323. The #322 fixture-conflict note in § 4 is resolved as
recommended. The test that sees_all on a non-genuine row is dropped is still absent from the
committed suite. It is non-blocking, and the probe above shows the behaviour is correct.

## Merge-head attestation (Opus 5.5)

**Reviewed head:** `60a79fbedadae8b5ebe1c62c96d7d80cef0fbbfd`

This is a fresh Opus 5.5 context, 2026-09-24. It attests the `gh pr update-branch` merge of
`main` at `776999db0eedea45110817cb8cf64c586963626e` (#355, domain coverage and Playwright e2e smoke CI jobs)
into the previously reviewed head `bc138e237f2fa641c9b1e7327afff1799ec4613a`.

- **Parents:** exactly (`bc138e237f2fa641c9b1e7327afff1799ec4613a`, `776999d`).
- **Clean merge:** `git show --remerge-diff` is empty, so there was no manual resolution.
- **PR change unchanged:** `git diff 7bebaf6 bc138e2` and `git diff 776999d 60a79fb` are
  byte-identical (same sha256). No file overlaps with main's changes since the base.
  `bc138e2` is note-only over the reviewed code head `51af10d`.
- **Interaction with main:** none. #355 touches CI workflows, e2e, coverage config and the
  scope list. This PR's `packages/permissions/**` and `apps/api/src/permissions/**` stay in
  security scope. The domain coverage job covers `packages/domain`, which this PR does not touch.
- **Tests at `60a79fb`** (packages built first, no DB): `@taskdesk/permissions` passes
  13 files / 261 tests. `apps/api test:permissions` passes 10 / 80. `apps/api test:unit`
  passes 57 / 450.
- **CI at `60a79fb`:** `integration - Postgres 18` was still in progress when this was written.
  Every other required context was green except `pull request template + security review`,
  which reported this file STALE for want of this note. That is expected.

**Verdict at `60a79fbedadae8b5ebe1c62c96d7d80cef0fbbfd`: CLEAR.** S2–S4 remain as recorded
above and non-blocking. Merging still needs the in-progress integration check to finish green.
