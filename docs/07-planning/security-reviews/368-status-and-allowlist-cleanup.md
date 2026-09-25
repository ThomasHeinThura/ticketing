# Pre-merge review — PR #368 (status snapshot and allowlist cleanup)

**Reviewed head:** `a75151a8e89f4474e6b61a39a9b06381c3f4311e`

**Verdict: CLEAR.** The first pass was CLEAR WITH FINDINGS at
`1dead82cdf7986f599bab23b87d8ed2476465faa`, with one low finding (L1, wording in status.md).
L1 was fixed in `a75151a`, and the second pass at that head is CLEAR.

**Reviewer independence.** This was a fresh Opus 5.5 context that did not write, direct or fix
this change. The PR was written by the orchestrating session. It is tiny, so this one review
covers both the ordinary review and the security review. The review ran in separate scratch
worktrees. This note is its only commit.

**Model:** Claude Opus 5.5. **Tier:** final independent security review.
`scripts/ci/openapi-approved-breaks.json` is on ci-cd.md's security-scope list.

## Pass 1 at `1dead82` — CLEAR WITH FINDINGS

**Scope.** The diff against `origin/main` (`714a6537153fa5f61bd894465bfa14bbe867963d`) touches
two files: `scripts/ci/openapi-approved-breaks.json` and `docs/07-planning/status.md`. The head
contains `origin/main`.

**Allowlist emptied to `[]`: the gate can only get stricter.**
- `scripts/ci/test-contract.mjs` lets an entry approve a break only if the entry is new
  compared with `origin/main`. Entries already on main are printed as "stale allowlist entry
  (already on origin/main, approves nothing here — delete it)".
- #320's entry was one of those stale entries. Removing it approves nothing new and hides no
  finding. #320 is merged (`378e5e0`), so no open PR depends on the entry.
- `parseApprovedBreaks` accepts `[]` and returns `[]`.
- `pnpm test:contract` at the head, with Node 24.20.0, exited 0. Output: "Redocly lint:
  16 finding(s) remain from origin/main's 16", "oasdiff: no unapproved breaking API changes
  against origin/main (0 approved)".
- `node --test scripts/ci/test-contract.test.mjs`: 36 tests, 36 pass, 0 fail.

**status.md claims, checked against GitHub.**
- `origin/main` is at `714a653`.
- The merge commits from `gh pr view <n> --json mergeCommit` all match, and all nine PRs are
  MERGED:

  | PR | Merge commit |
  | --- | --- |
  | #340 | `9060512` |
  | #341 | `3c31081` |
  | #362 | `c0bd99d` |
  | #366 | `536d12a` |
  | #331 | `fb134c3` |
  | #367 | `6b0d861` |
  | #364 | `d6a9643` |
  | #320 | `378e5e0` |
  | #326 | `714a653` |
- #320's D0 cross-tenant cursor fix is pinned by a test that uses an attacker workspace and a
  victim workspace: `tests/api-integration/work-item-list-sort-pagination.test.ts:1041` on
  main.
- "All four lane agents stopped" and "#353 and #365 wait for #344" match the 2026-09-24
  decision-log entry (#366), items 1 and 2. #353, #365 and #344 are OPEN.
- The removed opening paragraph was stale. It said #341 "is being refreshed", but #341 merged
  as `3c31081`. Marking the 2026-09-24 snapshot "(superseded)" is correct.
- CLAUDE.md forbids keeping a live per-PR narrative in status.md. This snapshot doesn't: it
  records merges with their SHAs, plus one short "Blocked … and why" line.

**L1 (low, not blocking).** The snapshot said "#352 and #361 need their CI scanners rebuilt on
the TypeScript parser". That is true for #361: its latest Opus review at `2a48681` asks for the
TypeScript compiler API. It is not true for #352: its latest Opus review at `1f79c1e` asks for
the comment exemption and tag check to be deleted, only flat destructuring patterns to be
accepted, and the N1–N6 and K1–K2 bypasses to become tests.

## Pass 2 at `a75151a` — CLEAR

- One commit since `1dead82`: `a75151a`, "docs(status): state #352's and #361's remaining
  design work accurately". It changes only `docs/07-planning/status.md` (4 lines added, 3
  removed).
- The #352 line now matches its Opus review. #361 keeps the TypeScript-parser wording. L1 is
  closed.
- `scripts/ci/openapi-approved-breaks.json` is unchanged (`[]`), so the `test:contract` and
  unit-test results from pass 1 still apply.
- The head still contains `origin/main` at `714a653`.

**Not verified here:** whether the required CI checks are green on the final head. They must
be green before merge.
