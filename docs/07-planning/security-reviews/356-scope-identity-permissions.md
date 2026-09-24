# Pre-merge security review — PR #356 (security-review scope adds identity and permissions)

**Reviewed head:** `f73f42aa4ac08912a4a976348440452d286cd93a`

**Merge base:** `7bebaf61c50d2a65255e459827c88c1d30230340`. This was `origin/main` at review time, so the PR is not behind `main`.

**Reviewer:** Claude Opus 5.5, a fresh, review-only context commissioned by the orchestrating session. The orchestrator authored this PR. This context wrote no part of the change, and its only write is this note.

**VERDICT: CLEAR WITH FINDINGS.** There are four findings, all LOW or informational. None blocks the merge and none weakens the gate. No gate is waived.

---

## What changed

- `docs/04-engineering/ci-cd.md`: one line was added to the first block of the authoritative security-review list. It adds `packages/domain/src/identity/**` and `apps/api/src/permissions/**`.
- `docs/07-planning/decision-log.md`: three entries were added.
  - 2026-09-24, the scope widening.
  - 2026-09-23, the P3 gate requires all 25 acceptance tests against a real Entra tenant.
  - 2026-09-23, every SCIM identity conflict returns one generic `409`.

No code, workflow, template, or checker changed.

## 1. The parser picks up both globs

`scripts/ci/lib/security-paths.mjs` `parseSecurityReviewPaths` finds the fenced block that contains `packages/permissions/**`. It splits each line on runs of two or more spaces and drops tokens that contain a space. The new line is two tokens separated by six spaces, so both parse.

I parsed the list at the merge base and at the head:

- **Base:** 29 globs. **Head:** 31 globs.
- **Added:** `packages/domain/src/identity/**`, `apps/api/src/permissions/**`.
- **Removed:** none.

Predicate check at base and head, using `globToRegExp`:

| Path | Base | Head |
| --- | --- | --- |
| `packages/domain/src/identity/x.ts` | out | **in** |
| `packages/domain/src/identity/scim/patch.ts` | out | **in** |
| `apps/api/src/permissions/resolve-identity.ts` | out | **in** |
| `apps/api/src/permissions/shadow/mw.ts` | out | **in** |
| `packages/domain/src/identity.ts`, `packages/domain/src/identityx/a.ts`, `apps/api/src/permissionsx.ts`, `packages/domain/src/sla/x.ts` | out | out (the match is anchored, not a prefix match) |
| `apps/api/src/auth.ts`, `apps/api/src/utils/a.ts`, `packages/permissions/src/a.ts`, `scripts/ci/x.mjs`, `docs/04-engineering/ci-cd.md`, `.github/workflows/ci.yml`, `apps/api/drizzle/0001.sql`, `package.json`, `apps/web/package.json`, `pnpm-lock.yaml` | in | in |

**End to end.** A throwaway script, not committed, built scratch repositories with `scripts/ci/lib/scratch-repo.mjs`. Each one ran the shipped `check-pr-template.mjs` against a body whose security **Model:** is `Sonnet 5`.

| Scenario | Checker result |
| --- | --- |
| Base is this PR's `ci-cd.md` (post-merge `main`); diff touches only `packages/domain/src/identity/x.ts` | exit 1. It reports "touches 1 security path(s) — packages/domain/src/identity/x.ts — so **Model:** must name Opus". |
| The same, touching only `apps/api/src/permissions/resolve-identity.ts` | exit 1, with the same message for that path. |
| **Control:** base is the pre-PR `ci-cd.md`; the same two diffs | exit 0, "no security-review path touched (29 glob(s))". So the scenarios above are not vacuous. |

I also checked the real paths:

- PR #346 adds `packages/domain/src/identity/{identity,portal,types}.ts` and `identity.test.ts`.
- PR #323 adds `apps/api/src/permissions/shadow-*.ts`.
- #315's `apps/api/src/permissions/resolve-identity.ts` is already on `main`.

All of them fall under the new globs.

## 2. Union at the merge base and head

`readSecurityReviewScope` computes union semantics (`ci-cd.md` around line 272). It feeds `check-pr-template.mjs` line 111, and line 343 requires the review when anything is `touched` or anything is `removed`.

| Scenario | Scope result | Checker result |
| --- | --- | --- |
| **This PR's shape:** old base, new head, diff is `ci-cd.md` plus the decision log | `previous` 29, `current` 31, `union` 31, `added` = the two globs, `removed` = [] | exit 1. `docs/04-engineering/ci-cd.md` is itself in scope, so the PR needs Opus. |
| Old base, new head, **plus** an identity file in the same diff | — | exit 1, naming both paths. Widening takes effect on the widening PR itself. |
| **Revert:** base is the post-merge list, head restores the old list | `removed` = both globs, `union` 31 | exit 1. The checker prints "2 security-review glob(s) REMOVED … measured against the UNION". A later narrowing cannot escape. |

The real PR body, run through `check-pr-template.mjs` in the worktree, is refused until this note is linked. That is expected.

## 3. No weakening

Base list, 29 globs:

```
apps/api/src/**/policy.ts, packages/permissions/**, apps/api/src/plugins/**,
apps/api/src/storage/**, apps/api/src/auth*, apps/api/src/index.ts, apps/api/src/utils/**,
apps/api/src/capabilities/**, apps/api/src/**/index.ts, apps/api/src/**/controllers/**,
apps/api/drizzle/*.sql, apps/api/src/policy-registry.ts, apps/api/src/database/**,
packages/mcp/src/auth/**, scripts/deploy.sh, apps/api/src/middleware/**,
apps/api/src/webhooks/**, apps/api/src/scim/**, packages/plugins-contracts/**, .github/**,
package.json, scripts/ci/**, **/package.json, turbo.json, pnpm-lock.yaml,
docs/04-engineering/ci-cd.md, pnpm-workspace.yaml, .npmrc, .pnpmfile.cjs
```

The head list, 31 globs, is the same 29 plus `packages/domain/src/identity/**` and `apps/api/src/permissions/**`.

- Nothing was removed or reordered in a way that changes the parse.
- The block-anchor glob `packages/permissions/**` is still present.
- The prose token "any new route file (a new *.ts exporting a Hono router)" is still skipped by the parser as before, and is still enforced separately by `looksLikeHonoRouter`.

No other place restates the list. `sdlc.md` and `security-model.md` only cite it. No workflow has a `paths:` filter that could stop the checker from running on the new directories.

## 4. The decision entries

None of the three entries contains a `**Waives gate:**` line or anything else that `scripts/ci/lib/gate-waiver.mjs` parses. None changes gate semantics beyond what it says.

- **Scope widening (2026-09-24).** It describes exactly the one-line change above, and it only tightens. It was decided by the orchestrator under the standing delegation. That is consistent with the rules: widening a gate is not waiving one, and only a waiver is reserved to Thomas.
- **25 acceptance tests (2026-09-23).** This tightens the P3 gate from 17 tests to 25.
- **Generic SCIM 409 (2026-09-23).** This is a security tightening. It removes the cross-tenant existence oracle that IP-32's existing-resource id would have created, because same-connection and cross-connection conflicts become indistinguishable to the caller.

## Findings

**F1 — LOW. The `packages/domain/src/index.ts` barrel is outside the scope.**
- #346 re-exports the identity module through `packages/domain/src/index.ts`.
- A change to that barrel alone could re-point an exported identity function to a different implementation, for example one defined in a non-identity file, and trip no review.
- This is the same class of gap as the one this PR closes, but narrower. It needs a deliberate edit outside `identity/`.
- It is not blocking. It is worth a follow-up: either add `packages/domain/src/index.ts`, or make `apps/api` import identity rules from a sub-path.

**F2 — INFO. `packages/domain/src/identity/**` does not exist on `main` yet.**
- The directory arrives with #346.
- The list marks other future paths "(path does not exist yet)", and this one is not marked.
- This is cosmetic. The glob is correct and takes effect the moment #346 lands, which is the point.

**F3 — INFO. The two 2026-09-23 decisions go into force before their operative documents change.**
Once this PR merges, `main` will still carry the older text in:
- `phases.md:119` and `phases.md:245` ("17 SCIM/Entra acceptance tests");
- `release-plan.md:71`;
- `accelerated-delivery-plan.md:127`;
- IP-32 in `identity-provisioning.md` ("the existing resource's `id` in the detail").

#346 carries those edits. Until #346 merges, the source hierarchy resolves the conflict in favour of the decision log. Both decisions only tighten, so the gap is not dangerous.

This review cannot verify, from repository evidence, that Thomas confirmed these two decisions in session. That rests on the orchestrator's attestation in the entries.

**F4 — INFO, pre-existing. One 2026-09-23 entry sits above the `## Format` block.**
- That entry, "Current-model ordinary-review fallback…", came from #351.
- So the new 2026-09-24 entry is not literally first in a log described as "Newest first".
- This PR did not introduce the misplacement, and it has no gate effect.

## Evidence run at the reviewed head

- `pnpm install --frozen-lockfile`: clean.
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, 495 pass, 0 fail, 0 skipped.**
- `node scripts/ci/test-all.mjs --list`: the CI-matches-`ci-cd.md` reconciliation reports no drift, and the command exits 0. Its summary line is "0 passed · 0 failed · 16 not enabled yet".

## Merge-head attestation (Opus 5.5)

**Reviewed head:** `f0976a295eab52e58d9b1e4d921e9cf04cc86e8a`

This is a fresh Opus 5.5 context, 2026-09-24. It attests the `gh pr update-branch` merge of
`main` at `776999db0eedea45110817cb8cf64c586963626e` (#355, domain coverage and Playwright e2e smoke CI jobs)
into the previously reviewed head `58d5a9b2c1689c0f7524b526108879ae76c5b318`.

- **Parents:** exactly (`58d5a9b2c1689c0f7524b526108879ae76c5b318`, `776999d`).
- **Clean merge:** `git show --remerge-diff` is empty. `ci-cd.md` and `decision-log.md`,
  which both overlap with #355, auto-merged.
- **PR change unchanged:** the added and removed lines are byte-identical before and after.
  Only blob indexes and hunk offsets differ, because #355 added lines above both hunks. `58d5a9b`
  is note-only over the reviewed code head `f73f42a`.
- **Interaction with main:** #355 added rows to the same fenced scope block
  (`**/vitest.config.*`, `apps/web/playwright.config.ts`, `apps/web/e2e/**`,
  `scripts/ci/redocly.yaml`). At `f0976a2`, `readSecurityReviewPaths()` parses both
  sets. `packages/domain/src/identity/scim.ts`, `apps/api/src/permissions/shadow-store.ts`,
  `apps/web/e2e/auth-redirect.spec.ts` and `packages/domain/vitest.config.ts` all match. So
  the scope only grows, and no row from either side is lost.
  - **Non-blocking note:** the decision log's newest-first order was already split before this
    PR. Some entries sit above `## Format`, and this PR's 2026-09-24 entry sits below the
    template and below 2026-09-23 entries. The merge did not create this. It is worth tidying
    in a later control-plane change.
- **Tests at `f0976a2`:** `pnpm test:ci-scripts` passes 502 / 502, with 0 failed.
- **CI at `f0976a2`:** several contexts were still in progress or queued when this was written. The
  only failure was `pull request template + security review`, which reported this file STALE
  for want of this note. That is expected.

**Verdict at `f0976a295eab52e58d9b1e4d921e9cf04cc86e8a`: CLEAR.**

## Merge-head attestation (Opus 5.5) — after #323 merged

**Reviewed head:** `1eed6fa4d592c25a18c391ecaf687752e04e5fc1`

This is a fresh Opus 5.5 context, 2026-09-24. It attests the `gh pr update-branch` merge of
`main` at `9d5deb92a81791598140007fe8e108d1a352855c` (#323, request-path policy shadow mode and
migration `0069`) into the previously attested head `0d7eca4344395107148b7158f0bf7eb568889369`. Main's tree at `9d5deb9` is
identical to #323's attested tree `eb94330`. `776999d..9d5deb9` is that one merge.

- **Parents:** exactly (`0d7eca4344395107148b7158f0bf7eb568889369`, `9d5deb9`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution.
- **PR change unchanged:** every added and removed line is identical. Only the hunk offsets
  in `decision-log.md` differ, because of #323's entries. The file auto-merged.
- **Interaction with #323:** #356's new scope row `apps/api/src/permissions/**` now also covers
  #323's merged `shadow-*.ts` files. That is intended, and it only grows the scope. #323 changed
  no `ci-cd.md`, workflow, lockfile or security-paths file.
- **Tests at `1eed6fa`:** `pnpm test:ci-scripts` passes 502 / 502.
- **CI at the merge head:** the only failure was `pull request template + security review`,
  which reported this file STALE for want of this note. That is expected, and this note is what
  clears it. `integration - Postgres 18` was still in progress when this was written, and merging
  needs it green.

**Verdict at `1eed6fa4d592c25a18c391ecaf687752e04e5fc1`: CLEAR.** The ordering note above
still stands and remains non-blocking.

## Merge-head attestation (Opus 5.5) — after #334 merged

**Reviewed head:** `bf95869e916fb9dc975088081ab23a2194ba4095`

This is a fresh Opus 5.5 context, 2026-09-24. It attests the `gh pr update-branch` merge of
`main` at `ecb5b63dcdf9e17aa706999e1a5c4c7e7ecf2075` (#334, sees_all scoped to the granting
workspace) into the previously attested head `76b982e9ba3bce524f811867e7afce0204cb8bb5`. Main's tree at `ecb5b63` is identical to
#334's attested tree `57d7194`. `9d5deb9..ecb5b63` is that one merge.

- **Parents:** exactly (`76b982e9ba3bce524f811867e7afce0204cb8bb5`, `ecb5b63`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution.
- **PR change unchanged:** `git diff 9d5deb9 76b982e` and `git diff ecb5b63 bf95869` are
  byte-identical (same sha256). No file overlaps with #334.
- **Interaction with #334:** at `bf95869`, `readSecurityReviewPaths()` returns 35 globs,
  including `packages/permissions/**`, `packages/domain/src/identity/**` and
  `apps/api/src/permissions/**`.
  - #334's source files match: `apps/api/src/permissions/resolve-identity.ts` matches the new
    row `apps/api/src/permissions/**`. `packages/permissions/src/{evaluator,identity}.ts`
    match `packages/permissions/**`.
  - #323's `apps/api/src/permissions/shadow-evaluation.ts` also matches the new row.
  - A near-miss path, `apps/api/src/permissionsX/a.ts`, does not match, so the glob does not
    over-match.
  - #334's `tests/**` and `rbac.md` are outside the scope list, as they were before this PR.
    That is unchanged by #356.
- **Tests at `bf95869`:** `pnpm test:ci-scripts` passes 502 / 502.
- **CI at `bf95869` when this was written:** the only failure was `pull request template +
  security review`, which reported this file STALE for want of this note. That is expected.
  Integration, unit, build, the gate checkers and CodeQL analysis were still running. Merging
  needs them green.

**Verdict at `bf95869e916fb9dc975088081ab23a2194ba4095`: CLEAR.**
