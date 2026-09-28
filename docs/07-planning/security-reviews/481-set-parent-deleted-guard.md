# PR #483 — set-parent's proposed-parent deleted/archived guard (issue #481)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (spawned as `pal-reviewer`; fell back
from `pal-mcp`'s `coder` chain to a direct Sonnet review because this session's local git
identity is configured as "Codex GPT-6" and the reviewer had no way to confirm from inside
its own sandbox whether that reflects the PR's actual authorship — recorded per the
model-tier fallback rule rather than guessing)
**Session:** subagent `a0ecd66ca5b1b7fe1`

**Reviewed head:** `4ab505e0bf5418514b32385d524f975c17309225`

**Verdict: clear with findings (non-blocking).** The fix is correct, minimal, and reuses the
`rank-work-item.ts` precedent pattern exactly. The new check runs before the RH-6 same-project
check and before `validateReparent`/`ancestorChain`/`descendantDepth`, so an archived/deleted
parent never reaches the cycle/depth logic, and the response gives no way to distinguish
"archived/deleted" from "never existed" (matches this route's existing anti-enumeration
discipline). Both new tests create a genuine second row, flip `deletedAt`/`archivedAt`
directly, assert the exact 404 and message, and re-read the child afterward to confirm
`parent_id` is unchanged — confirming the reject is atomic.

**Finding (non-blocking, already tracked separately):** the SUBJECT work item (the one being
re-parented, not the proposed parent) is not itself checked for `archivedAt`/`deletedAt`
anywhere in this route's call path — neither `require-work-item-reach.ts` nor this function's
own re-read of `item`. This is the symmetric gap to what #481 fixed, on the other side of the
same call. It predates this PR, is out of #481's stated scope (which named only the parent
lookup), and is now flagged as its own follow-up task by the orchestrating session rather than
folded into this PR.

## Security review (mandatory, Opus)

**Model:** Opus, fresh independent context, did not author or orchestrate this change
**Session:** subagent `adfe805a3e327c6ec`

**Reviewed head:** `4ab505e0bf5418514b32385d524f975c17309225`

**Surfaces examined:** `apps/api/src/work-item/controllers/set-work-item-parent.ts` (full
file, including the PR #432 advisory-lock/F1 and D2 doc comments), `hierarchy-lock.ts`,
`require-work-item-reach.ts`, `rank-work-item.ts:82` (the precedent), `delete-work-item.ts`,
`database/schema.ts:2310-2311` (the `archivedAt`/`deletedAt` column definitions),
`tests/api-integration/work-item-hierarchy.test.ts` (the two new tests and the surrounding
happy-path/cross-workspace tests), issue #481's body. Checked out the real candidate SHA in a
clean worktree (not just the pasted diff) and ran the actual test suite against a private
`opus483_test` Postgres database on `td-lane-pg`: `tests/api-integration/work-item-hierarchy.test.ts`,
14/14 passed. Independently confirmed both new tests are non-vacuous by reverting the one-line
production fix and re-running — both fail (`expected 200 to be 404`) against the unfixed code,
pass against the fix.

**Verdict: clear with findings (non-blocking).** No change required before merge.

- The fix cannot reject a valid, live parent (`archivedAt`/`deletedAt` are `Date | null`,
  truthy only when actually set); existing happy-path tests still return 200.
- It throws before any write — inside the transaction, before `ancestorChain`,
  `validateReparent`, or the `UPDATE` — so a rejected attempt rolls back cleanly.
- Anti-enumeration is preserved: a deleted/archived parent gets the same 404 status and the
  same message as a missing key or a cross-workspace key, from the same single-query path
  plus an in-memory check — no extra query, no measurable timing difference. One
  behavior change, judged more conservative and not a leak: a deleted/archived parent in a
  *different* project of the same workspace now gets 404 (from the new check) instead of the
  RH-6 400, because the new check runs first.
- No interaction with the advisory-lock/race-closing logic from PR #432: the transaction's
  statement order is unchanged (lock -> locked item re-read -> project-alive check -> parent
  read -> **new guard** -> RH-6 -> D2 project-id check); the new check reads only an
  already-fetched row, adding no statement and no new TOCTOU window.
- Confirmed the same subject-item asymmetry the ordinary review flagged, and is knowingly
  excluding it from this verdict as a separate, already-tracked gap, not a miss.

**Other findings, all non-blocking:**
- **N1 (informational):** the parent read takes no row lock, and `delete-work-item.ts`
  doesn't take the hierarchy advisory lock, so a parent soft-deleted by a concurrent
  transaction after this read but before commit could still end up set as the parent. Treated
  as informational: the resulting state (a live child pointing at a since-deleted parent) is
  the same "orphaned, not cascaded" state `delete-work-item.ts`'s own WI-22 note already
  allows, and this check is no weaker than the existence check it replaces. If closed later,
  `.for("share")` on the parent select would block against the delete's `UPDATE` (`.for("key
  share")` would not).
- **N2 (informational):** the archived branch is defensive-only today — nothing in
  `apps/api/src` currently writes `work_item.archived_at`; it is reachable only via a direct
  database write, which is how the new test reaches it. Still correct to have, and matches
  `rank-work-item.ts`'s own defensive posture.
- **N3 (optional, not required):** the existing cross-workspace test checks only status, not
  message text; pinning the message there too would additionally cover the anti-enumeration
  contract for that case, but is not required by this PR.

**What was not checked:** only this one integration file was run, not the full integration
suite; N1 was reasoned from the code, not reproduced with two live transactions; CI status,
the OpenAPI contract, and any frontend impact were not reviewed (status codes and messages are
unchanged, so no drift is expected).

## Note on issue #295 overlap

Issue #295 (a `40P01` deadlock-retry wrapper for this same file's write transaction) is being
worked concurrently on branch `fix/295-parent-write-deadlock-retry`, not yet a pull request as
of this PR's branch point. This diff is against the pre-#295 transaction shape. Whichever of
the two lands second will very likely need a rebase over the other in
`set-work-item-parent.ts` before merge.

---

## Merge resolution: #295 landed first, rebased over it (d1429f82)

**Confirmed by:** the orchestrating session, directly — not a fresh Opus pass.

**What happened:** issue #295's deadlock-retry wrapper merged to `main` as PR #482 while
this PR's reviews were in progress, exactly as anticipated in the note above. PR #483 became
`CONFLICTING`. Rather than a blind auto-merge, resolved by hand:

**Verified the conflict was purely textual, not semantic.** `#482` only wraps the existing
`db.transaction(...)` call in `runWithParentWriteDeadlockRetry(() => ...)`; it does not
reorder or restructure the transaction's internal logic. This branch's own clean (pre-merge)
structure — item lookup → `projectAlive` check → parent lookup → **archived/deleted guard**
→ RH-6 → D2 → `ancestorChain`/`descendantDepth`/`validateReparent` → `UPDATE` — is byte-for-byte
identical in `origin/main` post-#482, except for the outer retry wrapper. Confirmed this by
diffing both sides directly before resolving anything.

**Resolution:** took `origin/main`'s file wholesale (so #482's retry wrapper and its own
review are untouched) and reapplied only this PR's one-line change:
`if (!parent)` → `if (!parent || parent.archivedAt || parent.deletedAt)`. Verified via
`git diff origin/main -- apps/api/src/work-item/controllers/set-work-item-parent.ts` that
this is the *only* production-code difference from `origin/main` at the merge — no other
line touched, confirming nothing from either PR's own reviewed logic was lost or altered.

**Verified beyond the diff:** ran the real test suites against a fresh Postgres database
(`wt483_test` on `td-lane-pg`, dropped afterward): `work-item-hierarchy.test.ts` (14/14 pass,
including both of this PR's own new archived/deleted-parent tests) and
`work-item-parent-write-deadlock-retry.test.ts` (2/2 pass) both green at the merged head.

**Verdict:** both reviews above (ordinary and Opus, at `4ab505e0`) remain valid at this
merge. The change from the reviewed head is a mechanical rebase with a single reapplied
one-line diff, verified identical to what was already reviewed, plus real test confirmation
that both PRs' logic coexists correctly.

**Reviewed head:** `d1429f829c5fde27ebf445ea36aa8d8c7a01acaa`
