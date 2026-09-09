# Pre-merge security review — PR #92 (vitest 4.1.11 lockfile patch, GHSA-82fw-gwwq-j7x9)

**Reviewed head:** `479b0dfcab110966ea11add8b7aec64b61681b04`

**Verdict: CLEAR.** No HIGH, no MEDIUM, nothing verified false. Two LOW informational notes,
both pre-existing on `main` and neither introduced nor worsened here.

**Status of the gate:** this review ran **before** merge and is complete. It closes the
mandatory independent Opus security review for the head named above, **and for that head
only.** A later commit touching anything outside `docs/07-planning/security-reviews/` voids
it and requires a fresh delta review. No waiver was sought or used; none is authorized.

**Reviewer independence.** A fresh, review-only Opus context that authored no part of the
change, made no edit, commit, push or comment, and confirmed `git status --porcelain` empty
at start, after a `--frozen-lockfile` install, and at finish. The base update onto `main` was
authored by the orchestrator, whose own verification is recorded in the pull request as
author verification and is explicitly **not** this review.

**Why a lockfile needs an Opus review at all.** The classifier puts `pnpm-lock.yaml` in
security scope. The reviewer confirmed that independently rather than accepting it:
`await readSecurityReviewScope()` returned a **23-glob union** (current 23, previous 23,
`removed: []`) at base `a9abf9a`; `pnpm-lock.yaml` MATCH; non-vacuity probe
`apps/api/src/auth.ts` MATCH; negative controls `apps/web/src/app/page.tsx` and `README.md`
NO-MATCH. That last step matters: `readSecurityReviewScope` is **async**, and calling it
without `await` yields an empty glob list that classifies every file as out of scope. A
"nothing in scope" answer is worthless without a probe proving the list was loaded.

---

## What was established, by measurement

| Claim | Evidence |
| --- | --- |
| **Lockfile-only** | `git diff origin/main...HEAD --name-status` → `M pnpm-lock.yaml` and nothing else. The branch's one substantive commit `8a05763` touches only that file |
| **Only the intended packages moved** | Both lockfiles YAML-parsed and compared per package rather than by reading the diff. **9 added** (vitest family at 4.1.11), **10 removed** (the same nine at 4.1.10, plus `tinyexec@1.2.4`), and decisively **0 entries modified in place** — no package kept its key while changing integrity. 1288 distinct names before and after |
| **The `tinyexec` drop is a de-duplication and an upgrade, not a downgrade** | `vitest@4.1.10` was the *sole* consumer of 1.2.4; at HEAD `vitest@4.1.11` uses 1.3.0. The five other dependents (`@antfu/install-pkg`, `@commitlint/cli`, `@commitlint/read`, two `nypm`) were already on 1.3.0 and are unchanged. `tinyexec` spawns subprocesses, so a silent re-point here would have mattered; there is none |
| **better-auth did NOT move** | Exactly three bases change their peer-hash suffix and no others — `@better-auth/api-key@1.6.25`, `@1.6.26`, `better-auth@1.6.30` — and **integrity is byte-identical on all three**. better-auth's expanded suffix differs by exactly one term, `(vitest@4.1.10)` → `(vitest@4.1.11)`. The authentication layer is untouched; only pnpm's peer-set identity was recomputed |
| **The advisory is real, and the fix is the delta** | GHSA-82fw-gwwq-j7x9 / CVE-2026-84373, medium, CVSS 5.9, CWE-22. `vitest` and `@vitest/mocker` vulnerable `>=2.1.0 <4.1.11`, first patched in 4.1.11. **`pnpm audit` was NOT clean on `origin/main`** — 2 moderate hits naming this exact advisory, exit 1 — versus clean at HEAD. The improvement is measured against the baseline rather than asserted from a clean end state |
| **Exposure is honestly small** | vitest is a devDependency in all 8 declaring manifests, `@vitest/browser` is not installed (optional peer only), browser mode is off, and nothing imports `mockerPlugin` or `interceptorPlugin`. This is a CI / developer-workstation exposure and effectively theoretical for this repository. Recorded plainly rather than inflated to justify the bump |
| **Scope discipline held** | No 5.x, 4.2+ or prerelease anywhere. Lockfile `overrides` byte-identical (36 keys); `pnpm-workspace.yaml` untouched; no `overrides`/`resolutions` in any manifest; `patchedDependencies` null on both sides; **0 specifier changes** across all 10 importers (15 version-only edits) |
| **Supply chain, checked beyond the brief** | All 9 new hashes are well-formed sha512 with 64-byte digests. Across both lockfiles the only resolution field is `integrity` — **0 tarball, 0 git, 0 directory** resolutions. `.npmrc` is tracked and 0 bytes. The reviewer then fetched all 9 digests from `registry.npmjs.org`: **all 9 match byte-for-byte.** `lockfileVersion` stays `'9.0'`; `pnpm install --frozen-lockfile` reports "Lockfile is up to date", exit 0, `git status` empty afterwards |
| **The test runner still runs the tests** | The failure mode that would defeat every other gate is a runner that installs cleanly and silently stops collecting. Baseline measured in a throwaway `--shared` clone of `origin/main`: both sides `--force`, 0 cached — libs 3, domain 59, mcp 30, permissions 236, email 16, ui 1, api 270, web 224 = **839 tests / 124 files / 11-of-11 tasks, identical on both sides**, both exit 0, no skips. `pnpm exec vitest --version` from `packages/domain` and `apps/api` → 4.1.11 (baseline clone → 4.1.10); `@vitest/mocker` on disk is 4.1.11 |

**Thomas's standing instruction was checked, not assumed.** Dependabot PR #70 was to be left
alone and Vitest 5 was not to be adopted as an incidental security fix. This change stays on
4.1.x. #70 was auto-closed **by Dependabot itself** at 06:55 ("no longer updatable") — not by
anyone overriding the instruction.

## Findings

**None blocking.** Two LOW, informational, both pre-existing:

- **LOW** — `apps/web/vite.config.ts:25` sets `server: { host: true }`, binding the app's dev
  server to all interfaces. Byte-identical on `main`, and not this advisory's path since it
  registers no vitest interceptor. Noted because it was seen, not because this change caused it.
- **LOW** — the #70 closure above, recorded so a future reader does not mistake it for an
  agent having acted against the instruction.

**What the reviewer declined to claim.** pnpm's peer-set digests are opaque and cannot be
recomputed independently, so their equality was *not* asserted as verified. Instead the
reviewer verified the two things that are checkable: integrity equality for every affected
base, and that the expanded peer closure differs by exactly one term.
