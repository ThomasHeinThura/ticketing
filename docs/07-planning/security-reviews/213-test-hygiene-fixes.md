# Security review — PR #213 (issue #95: two LOW test-hygiene fixes deferred from #77)

**Reviewed head:** `cd7f2953b34f507304c5abe13b84e4971814b25d`

Substantively reviewed at `a4afd5680e17043406f582f83489ad94bd2e5bce`; clearance extended to
this head (a merge of `origin/main` into the branch, via an intervening note-only commit
that recorded this review) by the same reviewer, who independently verified — by the union
of each merge parent's own diff, not a two-endpoint diff alone, since that method can miss a
change-then-revert or a merge that silently substitutes content from an ancestor — that
exactly three paths landed (`.husky/pre-commit`, `docs/07-planning/status.md`, and this
note), confirmed both reviewed test files byte-identical by git blob hash, and re-executed
at the new head in a fresh worktree: unit 11/11, integration 12/12, both mutation proofs
reproduced identically. Scope note: this clearance covers the two test files only —
`.husky/pre-commit` came from PR #211, already independently reviewed and merged on its own
account, not assessed by this reviewer.

## What this PR does

Closes issue #95 — two LOW findings the fourth Opus review of PR #77 returned CLEAR with,
deliberately deferred to a later batched round:

- `tests/api/utils/require-workspace-capability.test.ts`'s `L1` probe pinned the
  authorization gate's message literal via `readFileSync` against the source text (which
  appears at two call sites and couldn't distinguish them). Replaced with a real request
  through the actual middleware, asserting the response body.
- `tests/api-integration/account-deletion.test.ts`'s `realOwnersAfter` query had no role
  filter, so its name and comment described a query that didn't exist. Added `eq(role,
  "owner")`.

## Classification (corrected from the PR body's own stated rationale)

The PR body claims security scope because "both files sit under `tests/api/**` /
`tests/api-integration/**`" — **no such path glob exists** in `docs/04-engineering/ci-cd.md`'s
authoritative list; this reasoning is factually wrong, verified directly against the list.

The real basis, confirmed by running the actual classifier
(`scripts/ci/lib/security-paths.mjs`) against both files: `require-workspace-capability.
test.ts` trips the content-based `looksLikeHonoRouter` detector (it constructs a real Hono
app, `new Hono<{ Variables: ... }>()`, to probe the middleware under test) — a match on
**one file only**. `account-deletion.test.ts` matches neither the path-glob list nor the
content detector, and is not itself security-review scope. The PR's conclusion (Opus review
needed) is right; its stated reason was not.

## Review (mandatory Opus, since one file trips the content-based detector)

**Verdict: CLEAR WITH FINDINGS — non-blocking. Nothing blocks merge.**

- **Fix 1 verified as a genuine strengthening, by mutation, not just reading.** Drifted only
  the capability-refusal throw's message (line 110), leaving the other call site's literal
  (line 76) intact: the new test correctly fails, and the *old* `readFileSync`+`.toContain`
  assertion still passes 11/11 — proving the old assertion was blind to exactly the drift it
  existed to catch, because the literal string still appeared elsewhere in the file. Checked
  the reverse direction too: no coverage is lost relative to the old assertion (both catch
  both sites drifting; neither alone catches only line 76 drifting).
- **Fix 2 verified load-bearing.** Retargeting the new `role = "owner"` filter to the
  impostor's actual planted value (`"owner,x"`) makes the assertion fail, confirming the
  filter genuinely excludes what it's meant to exclude rather than being a no-op.
- **Both test files independently re-run**: 11/11 and 12/12, matching the PR's claims
  exactly. Non-vacuity re-confirmed by reverting the production fix the integration test
  guards (`holdsOwnerExactly` → `hasOwnerRole`) and observing 1 failed / 11 passed — the
  modified test remains the sole witness.
- Diff confirmed as exactly two test files, one commit, zero production lines changed.

**Finding, non-blocking:** the PR body's stated security-scope rationale is factually wrong
(see Classification above) — the conclusion holds, the reasoning is corrected here.
