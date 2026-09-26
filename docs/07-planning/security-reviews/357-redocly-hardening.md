# Security review — PR #357 (Redocly parser hardening + gate-scope glob additions)

**Reviewed head:** `09cc00b9409a1aa0cd398fab211b1cdf990f4d24`
**Reviewed head (post branch-update merge, no security-scope file in the delta):** `a4906d11a9f45c698248f07cf09b2c71e79a3725`

**Model:** Claude Opus 5.5, fresh independent context (did not author, direct, or remediate
this change).

**Verdict:** CLEAR WITH FINDINGS — nothing blocks merge.

## Verified

- Hardened `scripts/ci/test-contract.mjs` Redocly-report parser rejects: a duplicate
  `"totals"` marker, a truncated `problems[]` array (e.g. from `--max-problems`), and a
  report with `ignored > 0` (a `.redocly.lint-ignore.yaml` bypass) — all fail closed.
- `ignored === 0` requirement is correct, not merely cautious: Redocly 2.54.2's JSON output
  drops ignored problems from `problems[]`, counting them only in `totals.ignored`, so
  `problems.length === errors + warnings` is the right count and the separate `ignored === 0`
  check is what closes the real bypass an ignore file would otherwise create.
- New security-scope globs (`**/vitest*.config.*`, `tests/api-integration/global-setup.ts`)
  correctly cover all 10 tracked vitest configs including the permissions/integration ones.
- The decision-log duplicate found by ordinary review is fully resolved — zero diff against
  `origin/main` on that file; the 2026-09-24 entry appears exactly once, correctly ordered.
- No reference to or dependency on `pal-mcp`/9Router anywhere in this PR.
- Tests: 574/574 (`scripts/ci/**/*.test.mjs`), 46/46 on the two touched files,
  `test:contract` exits 0 with 16/16 findings matching baseline, no unapproved breaking
  changes.

## Non-blocking findings

1. **LOW:** the `ignored !== 0` rule (the one that closes the demonstrated bypass) has no
   dedicated test — removing it, `Number.isInteger(ignored)`, or `warnings < 0` from the
   source left all 39 existing tests passing. Follow-up: add one test asserting a report with
   `ignored: 1` and an empty `problems` array throws.
2. **LOW:** Redocly's `--max-problems` defaults to 100; if the baseline ever exceeds that, the
   parser correctly fails closed but with a generic "totals do not match" message rather than
   naming the real cause. Follow-up: pass an explicit high `--max-problems` value.
3. **INFO:** per-file `setupFiles` (`tests/permissions/setup.ts`, `tests/api-integration/setup.ts`,
   `tests/api/setup.ts`) remain out of security-review scope — same class as test files,
   deliberately excluded, not a regression introduced by this PR.

## Not done

- Did not attest a security-scope change in the branch-update merge itself — confirmed via
  `gh pr diff --name-only` that the merge introduced no file outside what was already
  reviewed (only `docs/07-planning/status.md`, non-security-scope).
