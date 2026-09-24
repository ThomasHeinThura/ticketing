# Pre-merge security review — PR #335 (Storybook 10 compatibility spike, `packages/ui`)

**Reviewed head:** `aaab19d4a37ca76dc295ff66a8fca19fc7097424`

**Merge base with `main`:** `dd067e21f77853b35dd79de31e99d258678b92b4` (`origin/main` was
`33ce9ec8a926b3dd0dbe8d00b828c69c72861408` at review time; the branch is one commit behind and
merges cleanly — `git merge-tree` reports no conflict).

**Verdict: CLEAR WITH FINDINGS.** The dependency change itself is clean: no install-time
scripts, no advisories, every new entry registry-resolved with a matching sha512, dev-only,
and absent from the runtime image and both build outputs. No HIGH. Two MEDIUM findings are
process/attestation defects in the pull request (S1, S2), not supply-chain defects, and must
be fixed before merge. This review does **not** clear the other merge gates — see "Gate
status" below.

**Status of the gate:** this review closes the mandatory independent Opus security review for
the head named above, **and for that head only.** A later commit touching anything outside
`docs/07-planning/security-reviews/` (including a `main` merge) voids it and needs a delta
attestation. No waiver was sought or used; none is authorized.

**Reviewer independence.** A fresh, review-only Opus 5.5 context commissioned by the
orchestrating session. It authored, directed and remediated no part of the change, made no code
edit, and its only write is this note. The change is attributed to a Codex agent (see S3).

---

## Surfaces examined

`packages/ui/package.json`, `pnpm-lock.yaml`, `packages/ui/.storybook/{main.ts,preview.ts,tailwind.css,vite-env.d.ts}`,
`packages/ui/src/components/button.stories.tsx`, `docs/07-planning/decision-log.md` (the PR's
entry), `pnpm-workspace.yaml`, `Dockerfile`, `.dockerignore`, `.gitignore`,
`docs/01-architecture/tech-stack.md`, `scripts/ci/lib/security-paths.mjs`.

Security-scope classification was measured, not assumed: `await readSecurityReviewScope()`
returned a 29-glob union; `pnpm-lock.yaml` and `packages/ui/package.json` MATCH; non-vacuity
probe `apps/api/src/auth.ts` MATCH; negative controls `README.md`,
`packages/ui/.storybook/main.ts`, `button.stories.tsx` and `decision-log.md` NO-MATCH.

## What was established, by measurement

| Probe | Evidence |
| --- | --- |
| **Direct dependencies** | Three `devDependencies` added to `packages/ui`, all **pinned exactly**: `storybook@10.6.0`, `@storybook/react-vite@10.6.0`, `@tailwindcss/vite@4.3.3`. No `dependencies` change. Two scripts added (`storybook dev -p 6006`, `storybook build`). `@tailwindcss/vite@4.3.3` was already in the graph via `apps/web` (`^4.3.3`); only its declaration in `packages/ui` is new |
| **Publishers** | `storybook`, `@storybook/react-vite`, `@storybook/builder-vite`, `@storybook/react`: published by GitHub Actions with SLSA v1 provenance, maintainers the Storybook core team (shilman, ndelangen, tmeasday, ghengeveld, …); 10.6.0 published 2026-09-02. `@tailwindcss/vite@4.3.3`: GitHub Actions + provenance, Tailwind Labs maintainers. Notable transitive: `oxc-parser@0.127.0`, `oxc-resolver@11.21.2` (boshen, provenance), `@joshwooding/vite-plugin-react-docgen-typescript@0.7.0` (joshwooding, provenance) |
| **Transitive delta** | Lockfile `packages:` parsed per key, base `dd067e2` vs head: **1493 → 1595, 102 added, 0 removed, 0 entries whose integrity changed in place.** Of the 102, 47 are platform-specific optional native/wasm bindings (`@oxc-parser/binding-*`, `@oxc-resolver/binding-*`, `@emnapi/*`, `@napi-rs/wasm-runtime`, `@tybys/wasm-util`); 57 of the 102 materialize on this linux-x64 host. Duplicate older copies enter for Storybook's own test instrumentation (`@testing-library/jest-dom@6.9.1`, `@vitest/expect|spy|utils|pretty-format@3.2.4`, `chai@5`) — dev-only, audit-clean. `head` vs current `origin/main` gives the same 102 (main's newest commit does not touch the lockfile). The only non-additive lockfile edit is `empathic@2.0.0` losing `optional: true` (now a required transitive of storybook); the pglite `-` lines are diff re-alignment, not removals |
| **Importers** | Only `packages/ui`'s importer changes (3 added specifiers). Lockfile `overrides` unchanged; `check:overrides` → 36 overrides, one source |
| **Install-time scripts** | Every materialized new package's `package.json` scanned: **0 `preinstall` / `install` / `postinstall`**, no `binding.gyp`. Five have a `prepare` script (`ast-types`, `recast`, `oxc-resolver`, `pathval`, `tinyspy`), which pnpm does not run for registry tarballs. `onlyBuiltDependencies` (biome, bcrypt, better-sqlite3, esbuild) is unchanged and admits none of the new packages. The install's "Ignored build scripts" list (`@prisma/engines`, `cpu-features`, `msw`, `prisma`, `protobufjs`, `ssh2`) contains no new package |
| **Integrity / provenance of resolution** | All 102 new entries carry `integrity`. Across the whole head lockfile: **0 tarball, 0 git, 0 codeload/github resolutions.** The six Storybook/Tailwind direct-and-core digests were fetched from `registry.npmjs.org` and **match the lockfile byte-for-byte**. No typosquat-looking names (all names resolve to the expected upstream projects above) |
| **Known vulnerabilities** | At head: `pnpm audit --prod` → no known vulnerabilities; `pnpm audit` (full) → no known vulnerabilities; `pnpm audit --audit-level=high` exit 0. CI `supply chain - dependency audit` green. Storybook 10.6.0 is past the 2025 manager-bundle env-var exposure fix line |
| **Not in production** | `Dockerfile` `proddeps` stage copies only `apps/api`, `email`, `libs`, `permissions`, `typescript-config` manifests and runs `pnpm install --prod --frozen-lockfile --no-optional --ignore-scripts` — `packages/ui` and `apps/web` manifests are never copied there, so Storybook cannot reach the runtime `node_modules`. It does install in the `deps`/`build` stage (full frozen install, build scripts gated by the unchanged allowlist). `check:dockerfile-deps` → 9 manifests match. Fresh `turbo build` of `@taskdesk/api` and `@taskdesk/web` at head: **0 files mentioning `storybook`, 0 containing the Button story** in `apps/web/dist` or `apps/api/dist`. `packages/ui` exports only `./src/index.ts` and styles; nothing imports a `*.stories.*` file or uses `import.meta.glob`. `storybook-static/` is gitignored |
| **Package still healthy** | `pnpm --filter @taskdesk/ui typecheck` clean (the story compiles, types resolve); `pnpm --filter @taskdesk/ui test` → 30 files / 56 tests passed, matching the PR's claim. `check:ui` clean. `pnpm install --frozen-lockfile` succeeded |
| **Dependency authorization** | `docs/01-architecture/tech-stack.md:75` (on `main`, an authoritative spec) already selects **Storybook 10** and requires it to be "spiked against kaneo's exact stack … before P0 adopts it; the result and the framework package pin go in the decision log." The spike and pin are what this PR supplies. The decision log on `main` has no prior Storybook-pin entry (only the 2026-09-05 "Storybook 10 (was 8)" doc-reconcile line); the PR adds one (see S2) |

## Findings

- **S1 — MEDIUM (false attestation in the PR body).** The `Any change` checklist ticks
  `[x] No dependency added`. The PR adds three direct devDependencies and 102 lockfile packages.
  A ticked box that is untrue is exactly what the checklist-genuineness rules exist to catch.
  Fix: untick it and state the dependencies added (or replace with the correct statement citing
  the decision-log entry). Body-only edits do not void this review's code-head binding, but the
  template gate re-runs on the new body.

- **S2 — MEDIUM (decision-log entry: authority and placement).** (a) The entry was written by
  the lane in `decision-log.md`, an orchestrator-owned surface, and says **"Decided by: Thomas
  authorized the recommended Storybook dependency option."** This reviewer cannot verify that
  sentence from any repository or PR record. `tech-stack.md` already authorizes Storybook 10
  itself, so the dependency choice is covered; but the orchestrator must confirm (or rewrite)
  the attribution of the decision before merge rather than let a lane-authored claim of Thomas's
  authority enter an append-only log. (b) The entry is inserted **above** the `## Format`
  section, while every other entry sits below it (on `main` the newest entry, #318's, is at line
  20, after `## Format`). Move it below `## Format`, newest first, when merging `main`.

- **S3 — LOW (attribution; already raised by the orchestrator).** The single commit `aaab19d`
  is authored `Claude Code <noreply@anthropic.com>` while `## Implemented by` names a "Codex
  agent" with no model or session. The orchestrator's PR comment already blocks merge on this;
  recorded here so it is not lost. No security consequence to the code itself.

- **S4 — LOW (dev-only exposure).** `storybook dev -p 6006` passes no `--host`; Storybook's
  core server calls `.listen({ port, host: options.host })` with `host` undefined, which binds
  all interfaces. The Storybook dev server can also write story files from the UI. On this shared
  host (unrelated production containers alongside) prefer `storybook dev -p 6006 --host
  127.0.0.1`. Not blocking; nothing ships.

- **S5 — INFO.** Branch is one commit behind `main` (`33ce9ec`, API-only). Merging `main`
  changes the head; per the template gate's reviewed-head binding, obtain a delta attestation
  (lockfile/manifests unchanged by the merge) rather than assuming this note carries over.

- **S6 — INFO.** Build warns on a 1.1 MB Storybook preview chunk; tooling-only, correctly
  marked n/a for G11.

## Gate status at `aaab19d` (not cleared by this review)

| Gate | State |
| --- | --- |
| Independent ordinary review (different agent than the author, model + SHA recorded) | **Absent.** `## Reviewed by` says "Pending"; no review on the PR |
| Opus security review | This note (once its link is placed in `## Security review` → `**Note:**`) |
| Required CI | All green **except** `pull request template + security review` (FAILURE) |
| `node scripts/ci/check-pr-template.mjs --body <body>` (run locally) | **2 problems:** `## Security review` `**Note:**` must link the committed review; the unticked "Independent Opus security review completed" item is a blocker |
| Decision-log entry for the dependency | Present in this PR (S2 applies) |
| Waived gates in `## Gates` | None cited |
| Attribution (2026-09-23, PR #336 — still OPEN, not yet on `main`) | Unreconciled (S3) |

## What the reviewer did not do

Did not run `build-storybook` or the dev server (CI `build` is green and the PR reports both);
did not build the Docker image (the `proddeps` exclusion was established by reading the stage's
COPY list and the `check:dockerfile-deps` gate); did not independently audit `origin/main` (the
head audit is clean, so no delta can be worse); did not verify whether Thomas authorized the
pin (S2).

---

## Delta review — after the rebase onto `main` (2026-09-24)

**Reviewed head:** `0a0aa9ea872b977ef6eeff80d2d5b8f2c9c2ff89`

**Merge base with `main`:** `7bebaf61c50d2a65255e459827c88c1d30230340`, which is current
`origin/main`. The branch is no longer behind.

**Verdict: CLEAR.** The dependency surface is byte-identical to what was cleared at `aaab19d`.
S4 is fixed and I checked it at runtime. S1 is corrected. The S2 placement and Alternatives
fixes are in. Nothing new is in security scope. The remaining items below are gate and
attribution items for the orchestrator. None is a supply-chain defect. This section binds to
the head above only. Any later commit outside `docs/07-planning/security-reviews/` voids it.

**Independence.** Same Opus 5.5 reviewer context as the first pass. It authored, directed and
remediated none of `96fa296` or `0a0aa9e`. S4's remedy was only a recommendation in the first
pass; the lane wrote the fix.

### Commits since the reviewed `aaab19d`

`git range-diff dd067e2..e5c48d4 7bebaf6..0a0aa9e`:

| Old | New | Change |
| --- | --- | --- |
| `aaab19d` | `96fa296` (author `Claude Code <noreply@anthropic.com>`) | Rebased re-land. The range-diff differs **only** in `decision-log.md`: the hunk context moved, and `**Decided by:**` changed from "Thomas authorized the recommended Storybook dependency option…" to "Storybook 10 is already selected by `tech-stack.md`; the pin and compatibility result were recorded by the implementing agent" |
| `e5c48d4` | `4f1cd88` | `=` identical (this note) |
| — | `0a0aa9e` (author `Codex GPT-6 <agent@taskdesk.local>`) | `packages/ui/package.json`: `storybook dev -p 6006` → `storybook dev -p 6006 --host 127.0.0.1`. `decision-log.md`: the entry moves below `## Format` |

### Probes

| Probe | Evidence |
| --- | --- |
| **Dependency set unchanged** | `cmp` of `pnpm-lock.yaml` at `aaab19d` against head: **byte-identical**. `git diff aaab19d 0a0aa9e` touches no `pnpm-workspace.yaml`, `.npmrc` or `Dockerfile`. In `packages/ui/package.json` the only change is the one script line; the three pinned devDependencies are unchanged. `main` moved `dd067e2`→`7bebaf6` without touching the lockfile. Its one manifest edit (`apps/api` gained a `tsx` script in #322) adds no dependency. The 102-package delta, the registry hashes and the install-script scan from the first pass therefore carry over unchanged |
| **Install** | `pnpm install --frozen-lockfile` → "Lockfile is up to date"; the ignored-build-scripts list is unchanged (no new package) |
| **Audit** | `pnpm audit` → no known vulnerabilities. `pnpm audit --prod` → no known vulnerabilities. `--audit-level=high` exit 0 |
| **Gates** | `check:dockerfile-deps` → 9 manifests match. `check:overrides` → 36, one source |
| **S4 — loopback bind, at runtime** | `storybook dev --help` lists `-h, --host <string>`. I started `pnpm storybook --ci --no-open` at head. `ss -ltn` showed exactly `LISTEN 127.0.0.1:6006` (not `0.0.0.0`/`*`). `curl http://127.0.0.1:6006/` → `200`. The host's own interface address `10.0.14.33:6006` → **connection refused**. The server was stopped afterwards and 6006 was free again |
| **S1 — PR body** | `[x] No dependency added` is gone. It is replaced by `[x] Added dependencies are development-only, selected in docs/01-architecture/tech-stack.md, documented in the decision log, and audit-clean`, which is true per the first pass |
| **S2 — decision-log entry** | The entry now sits after `## Format` (`## Format` at line 8, entry at line 28), below the newer #351 entry and above #345's, newest first. It has an `**Alternatives:**` line. It no longer claims authority it cannot show. To place it, `0a0aa9e` also moved `## Format` above #351's entry, which had landed above `## Format` on `main`. No entry text changed; only placement. I verified that by diffing against `origin/main` |
| **Template gate** | `check-pr-template.mjs --body` at `0a0aa9e`, before this section existed, reported 2 problems. First, the note's only declared head (`aaab19d`) is not an ancestor after the rebase. Second, the Opus checkbox is unticked. This section declares an ancestor head, which is meant to clear the first. The second needs the PR body updated |

### Findings (delta)

- **S1 — CLOSED.** Checklist corrected.
- **S2 — CLOSED for placement and Alternatives; one LOW residual.** The coordinator relays that
  Thomas confirmed the Storybook 10.6.0 dev-only dependency to the orchestrating session. The
  orchestrator's PR comment of 2026-09-23T16:51Z asked for a "Confirmed by Thomas to the
  orchestrating session, 2026-09-23" line. The entry's `**Decided by:**` does not contain it,
  so the decision log still does not record Thomas's approval of the pin. I cannot verify the
  confirmation myself; it reached me second-hand. AGENTS.md do-not 4 ("add a dependency
  without asking") and the rule that a decision governing live behavior must be in the
  decision log before dependent code merges both point the same way: the orchestrator should
  add that line (it owns the file) before merge. This is not a security defect. The entry as
  written is truthful.
- **S3 — OPEN (attribution, LOW).** `96fa296` is still authored `Claude Code
  <noreply@anthropic.com>`. The PR body now discloses the mismatch rather than rewriting
  history. Whether disclosure satisfies the 2026-09-23 attribution rule (#336, now on `main`)
  is the orchestrator's call.
- **S4 — CLOSED.** Verified at runtime, above.
- **S5 — CLOSED.** Rebased; the merge base is current `main`.
- **S7 — NEW, MEDIUM (ordinary-review independence; a gate item, not a code defect).** The PR
  records the ordinary review as a "fresh independent GPT-6/Codex context". `0a0aa9e` is
  authored `Codex GPT-6`, and the original implementation is attributed to a Codex agent. The
  2026-09-23 #345 entry says the lane agents have no ordinary-review capacity until
  2026-09-30, and that until then a fresh Claude Sonnet context does the ordinary review. The
  #351 entry allows a current-model fallback **commissioned by the orchestrating session**.
  Before merge the orchestrator must confirm that it commissioned this GPT-6 review under #351
  and that the reviewer is independent of the author. If not, a fresh Sonnet (or #351
  fallback) ordinary review is still owed. I did not assess the ordinary review's content.

### Gate status at `0a0aa9e`

The ordinary review is recorded, subject to S7. Required CI on this head was green except
`pull request template + security review`, which should re-run after this note lands and the
PR body's Opus checkbox and note link are updated. No waived gate is cited. The Opus security
gate is closed by this section for `0a0aa9ea872b977ef6eeff80d2d5b8f2c9c2ff89`.
