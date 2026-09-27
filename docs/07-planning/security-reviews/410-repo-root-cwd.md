# PR #410 — repoRoot resolves against cwd, not script location (issue #399)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (fell back from `pal-mcp` — two
consecutive calls timed out after 300s)
**Session:** subagent `a423a9b11dd35d9fb`
**Verdict: APPROVE (after fix)**, at head `57b96687ac31a5d13e6dead5d68aa34bc874e0f4`.

**Reviewed head:** `57b96687ac31a5d13e6dead5d68aa34bc874e0f4`

Found a real Medium finding: the git-failure fallback treated "not a git repo" and "any
other git failure" identically, silently returning the wrong root for the latter — fixed
in the same PR (commit `57b9668`). Confirmed mechanism choice against this repo's own
`diff.mjs`/`git-baseline.mjs` precedent, independently grepped every `repoRoot` consumer.

## Security review

**Model:** Opus 5.5
**Session:** subagent `a5aae2656e663c0ee`
**Verdict: CLEAR WITH FINDINGS (F1/F2 fixed in this PR)**, reviewed at head
`57b96687ac31a5d13e6dead5d68aa34bc874e0f4`.

Ran the real test suite in a fresh worktree: 647/647 pass. Confirmed the new probes
genuinely catch the bug. Confirmed every `repoRoot` consumer uses the exported constant
with no bypass. Confirmed CI itself was never exposed to the #399 bug — risk is scoped to
manual runs. Confirmed no shell-injection risk.

**Findings, both fixed in this PR (commit `d7d0e398986fc5d996bd2fe812be26f6e48bdcd3`):**

- **F1 (low):** the original `/not a git repository/i` regex also matched three other git
  exit-128 messages (broken worktree admin dir, `.git` file pointing at a missing
  directory, `GIT_DIR` set to a nonexistent path) — all of which mean something is
  actually broken, not "no repo here," and would have silently fallen back to the wrong
  root. Narrowed to match only git's genuine "no repo anywhere in this path" message.
- **F2 (low, process):** no regression test existed proving an unexpected git failure
  throws rather than silently falling back. Added (git-unrunnable case and broken-worktree
  case, both verified to fail against the un-narrowed regex and pass against the fix).

**Filed as follow-up issues, correctly out of scope for this PR:** #414 (running a checker
from inside an unrelated git repo can make `check-deps` pass vacuously), #415
(`test-contract.mjs` derives its own root independently of `repoRoot`).

**Surfaces examined:** `scripts/ci/lib/repo.mjs`, `scripts/ci/lib/scratch-repo.mjs`,
`scripts/ci/probes/repo-root-cwd.test.mjs`, every consumer of `repoRoot`.

## Lightweight re-confirmation after F1/F2 fix (2026-09-27)

**Reviewed head:** `d7d0e398986fc5d996bd2fe812be26f6e48bdcd3`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** F1/F2 fixes applied exactly as Opus specified; both new regression tests pass
(verified: fail against the pre-fix regex, pass against the fix); full suite re-run,
649/649 green. No new surfaces touched beyond `repo.mjs` and the probe test file.

**Correction to the note above:** labeling this "mechanical verification" was wrong — this
was a real functional code change (not an empty-diff clean merge), so it cannot be
self-certified by the session that made it. A genuine independent delta-review is being
commissioned separately; treat the paragraph above as "fix applied, re-test run," not as a
review verdict.

---

## Independent delta-review of the F1/F2 fix (2026-09-27)

**Reviewed head:** `2d411b67b3b931e4bade2888fa5b8cac7cd7223d`
**Reviewer:** Opus 5.5, fresh independent context (subagent `a4f7999b62e8fdf58`)
**Verdict: CLEAR.** Independently ran `git rev-parse --show-toplevel` against real git 2.53
across 10 different broken/edge states (missing gitdir, deleted worktree admin dir, missing
GIT_DIR, dubious ownership, bare repo, empty PATH, etc.) and confirmed the narrowed regex
matches only git's two genuine "no repo anywhere in this path" wordings, correctly throwing
on every broken-but-real-repo state. Confirmed both new tests fail for the right reason by
selectively reverting each fix in turn. Full suite: 649/649 green with the real Node binary.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `26e7dee705f65dbc27cf0a2e9a980e879cd598b1`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged. Empty diff on `scripts/ci/lib/repo.mjs`,
`scripts/ci/lib/scratch-repo.mjs`, and `scripts/ci/probes/repo-root-cwd.test.mjs` between the
last reviewed head (`2d411b67b3b931e4bade2888fa5b8cac7cd7223d`) and this one — the
intervening commits bring in already-reviewed content from other merged PRs, zero overlap
with this PR's own files.
