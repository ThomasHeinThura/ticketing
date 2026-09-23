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
