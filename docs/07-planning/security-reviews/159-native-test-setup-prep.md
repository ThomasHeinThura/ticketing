# Pre-merge security review — PR #159 (S10 prep: native test setup helpers)

**Reviewed head:** `f6e4a9f25dc177a1b93a253fb1508d1d763216a8`
**Base:** `origin/main` = `8d0f8f01df6e280669367a28c68d6ff09d5f3d04` (also the merge-base,
verified directly — the branch is exactly up to date with `main`, no catch-up merge pending)

**Verdict: CLEAR.** No finding.

## Scope — this is a LIGHTWEIGHT confirmation of ONE file, not a full pass over the PR

Recorded plainly so a later reader does not mistake this for more than it is.

This PR is pure test-setup mechanics: eleven files, **all** under `tests/api-integration/`,
swapping which HTTP helper a group of integration tests uses to create their fixtures.
`git diff main…--name-only` yields **zero** paths outside `tests/api-integration/` — no
`apps/api/src`, no `apps/web/src`, no migration under `apps/api/drizzle/`, no `package.json`,
no lockfile, no `pnpm-workspace.yaml`. **No production code is touched anywhere in this PR.**

One file, `tests/api-integration/workspace-role-duplicate-rows.test.ts`, mechanically trips
this repository's security-review-scope detector because it constructs its own standalone
`new Hono()` instance as a local test-harness probe. That construction is **pre-existing code
on `main`**, not introduced by this PR; the detector's heuristic cannot distinguish a
production route file from test code that merely instantiates a Hono app object.

Per the risk-graduated review-tier table (`AGENTS.md`; decision log, Thomas, 2026-09-16 — a
bounded change that alters no authority or gate-semantics invariant gets one strong Sonnet
review and then the single required Opus pass, rather than the full three-round tier),
this pass is deliberately narrow: **confirm by inspection that this PR's change to that one
file alters no authority or gate-pass/fail semantics.** Ordinary correctness, test quality
and the other ten files are covered by two independent Sonnet reviewers running in parallel;
this note does not restate or re-derive their work.

## What was confirmed

**The isolated diff for that file is two hunks and nothing else.** The import block replaces
`inviteAndAcceptAsNewMember` (from `helpers/organization-http`, which drives the still-mounted
`organization()` plugin routes that S10 unmounts) with `inviteAndAcceptAsNewMemberNative`
(from `helpers/workspace-invitation-write-http`, which drives S6a's own native routes), and
the single call site at line 143 is renamed to match. Specifically **unchanged**:

- the file's own `new Hono()` harness construction (line 64) and its stub context middleware;
- the authorization middleware wired into that harness —
  `requireWorkspacePermission({ project: ["read"] })` on `GET /probe`;
- the `"admin"` role argument passed to the fixture helper;
- every assertion and expected status code — the control `200` (line 152), the duplicate-row
  count assertions, and the fail-closed `403` (line 168) that is the point of the test;
- the migration-`0051` constraint drop/plant/restore sequence and its `finally` block.

**The `new Hono()` is genuinely a local test-only probe.** It is built fresh inside the
function-scoped `probe()` helper, its middleware copies `x-workspace-id` / `x-user-id`
headers directly into context vars, and it registers exactly one route whose only purpose is
to exercise `requireWorkspacePermission` in isolation from whatever a real route additionally
checks — which the file's own comment (lines 58–62) states. It is never exported, never
mounted into the application, and the real app under test is obtained separately from
`createApp()`. It confers no authority and is not reachable from anything that ships.

**The swap cannot make the test vacuously green.** This is the only route by which a
fixture-helper change could weaken a fail-closed assertion, so it was checked rather than
assumed. The security-meaningful assertion is the `403`; it is preceded by a control that
requires the member to be genuinely permitted (`probe → 200`) and the role row to exist
exactly once. A fixture that granted a weaker role, or no role, fails that control first and
loudly. `inviteAndAcceptAsNewMemberNative` additionally throws on any non-200 from either the
invite or the accept call, so a broken fixture surfaces as an error rather than a silent pass.

**Status of the gate:** this note closes the mandatory independent Opus security review for
the head named above, **and for that head only.** A later commit touching anything outside
`docs/07-planning/security-reviews/` voids it. No waiver was sought or used; the PR's
`## Gates` table cites no waived gate.

**Reviewer independence.** A fresh Opus context that authored, directed and remediated no part
of this change.

## What this review did not do

- Did not review the other ten changed files, beyond confirming by path that every one of them
  is under `tests/api-integration/` and that no production file is touched anywhere in the PR.
  Ordinary review of those files is the two parallel Sonnet reviewers' job.
- Did not audit the design of the `probe()` harness itself, the native S6a invitation routes it
  now exercises, or the `organization()` plugin routes it moves away from. Those routes carry
  their own reviews (PRs #112, #155).
- Did not run the integration suite. Green CI on this exact head is a separate required gate
  and was not treated as satisfied by this note.

---

*Reviewed by a fresh Claude Opus context, 2026-09-16, by inspection of the isolated diff and
its surrounding unchanged context. No database was created or touched for this review.*
