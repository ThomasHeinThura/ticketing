# Security review — PR #397: purge `perl-base` from the runtime image, and ship `@taskdesk/domain` in it

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`). A fresh, independent subagent context. It did not write, direct or remediate this change.
**Date:** 2026-09-27
**Branch:** `fix/release-pipeline-perl-cve`

**Reviewed head:** `98832ca398c2506652795fbff26c1f9d937742f3`

**Verdict:** CLEAR WITH FINDINGS. The Dockerfile change is safe and both fixes work. But **F1 matters before merge**: this PR does **not** unblock the release scan, and the PR body says it does. The body must be corrected. No code change is required.

**Scope:** `Dockerfile` only. The PR has two commits beyond `main` (`f1819ca`): `59ef75e` (perl-base purge) and `2a0a8f8` (domain package). `98832ca` is a `main` merge that changes nothing else. `Dockerfile` is not on `ci-cd.md`'s security-review path list; the template gate itself reports "no security-review path touched". So this Opus pass is above the required tier. It was requested because the change affects the release's supply-chain gate.

## What was checked

1. **perl-base is really gone from the dpkg database, which is what Trivy reads.**
   - Rebuilt the `runtime` stage with its cache off (`--no-cache-filter runtime`). apt removed exactly one package, `perl-base (5.36.0-7+deb12u3)`, and nothing else. It warned "essential package", as expected.
   - In the built image: `dpkg -s perl-base` says "not installed". `/var/lib/dpkg/status` has no `Package: perl-base` entry. `/usr/bin/perl*` is gone. `dpkg --audit` and `apt-get check` are both clean.
   - Local Trivy (0.74.0, current DB) on this image does not report perl-base.
   - No installed package declares a `Depends`/`Pre-Depends` on `perl` or `perl-base`; only `Suggests`. But see F2: that is not proof of safety for an Essential package.

2. **Nothing this project runs needs Perl.**
   - `deploy/entrypoint.sh` is POSIX `sh` and `exec`s `node`.
   - Layers after the purge only use `groupadd`/`useradd` (C binaries from `passwd`), `find`, `chmod`, `mkdir` and `chown`. None of them runs apt or a maintainer script.
   - `git grep -w perl` over the repo finds only syntax-highlighting language labels in the web client and i18n. There are no `perl`, `debconf`, `adduser` or `apt-get` calls in `deploy/**`, `scripts/deploy*` or `docs/05-operations/**`.
   - No `spawn`/`exec` of `perl` in `/app/node_modules` or `apps/api/dist`.
   - `node -v` (24.20.0) and `wget --version` (the healthcheck client) both work.

3. **The `@taskdesk/domain` fix works, and without it the image does not boot.**
   - `apps/api` imports `@taskdesk/domain` from 4 files: `audit/audit-writer.ts`, `audit/verify-audit-chain.ts`, `work-item/controllers/assign-work-item.ts` and `list-assignable-people.ts`. It is `workspace:*` in `apps/api/package.json`.
   - The domain package has no runtime `dependencies`, so copying its manifest into `proddeps` and its `dist/` into `runtime` is all it needs. This is the same pattern already used for `email` and `permissions`. `turbo build --filter=@taskdesk/api` builds it through `^build`.
   - **Negative control.** I built `main` at `f1819ca` and booted it with valid configuration. It exits 1 with `ERR_MODULE_NOT_FOUND: Cannot find package '@taskdesk/domain' imported from /app/apps/api/dist/index.js`. So **`main` cannot currently produce a bootable image.**
   - **This head, end to end,** against `td-pr397-postgres` (Postgres 18.6) using a fresh throwaway database and role:
     - `TASKDESK_ROLE=migrate` with the owner URL ran every migration, set up the application role, and exited 0.
     - The app container then started as non-root `taskdesk`: 122 policies loaded, scheduler started, listening, 0 restarts, no module-resolution errors.
     - `GET /api/public/health/live` returned 200 `{"status":"ok"}`. `GET /api/public/health/ready` returned 200 `{"status":"ok"}`. The portal host `/` returned 200 `text/html`.
   - The throwaway database and role were dropped afterwards.

4. **Image size and contents.**
   - Uncompressed: 605.3 MB here against 604.6 MB for `main`; compressed is about 116 MB, well under the 250 MB target in `container-image.md`.
   - `packages/domain` adds 600 KB: 76 files of `tsc` output, including `.d.ts` and `.map` files, the same as `email` and `permissions`. It is outside `public/`.
   - Removing perl-base saves no bytes, because it lives in the base image's lower layer (F3).

5. **Nothing contradicts `docs/05-operations/container-image.md`.**
   - That document requires the bookworm-slim base, the wget healthcheck, and "Trivy high/critical fails the release". All three still hold.
   - It does not list workspace packages.

## Findings

**F1 — HIGH (accuracy of the PR's claim; merge condition on the PR body, not the code). The release scan will still fail after this merges.**
- CI's own release run on `main` (`36297151238`, `f1819ca`) reported **61 Debian findings (57 HIGH, 4 CRITICAL)** plus **4 HIGH in the `npm` bundled with the Node base image**. They span 18 OS packages; `perl-base` is one of them.
- Local Trivy on this head with the same severity filter still reports **53 Debian + 4 node-pkg** and exits 1.
- What remains:
  - `util-linux`, `libblkid1`, `libmount1`, `libsmartcols1`, `libuuid1`, `mount`, `bsdutils` and `ncurses-*`/`libtinfo6`: `affected`, no fix yet.
  - `zlib1g`: CRITICAL, `will_not_fix`.
  - `wget`, `gzip`, `libacl1`, `libsystemd0`, `libudev1`: `fix_deferred`.
  - `libpcre2-8-0`: a fix exists (`10.42-1+deb12u1`); the base image has "3 not upgraded".
  - `/usr/local/lib/node_modules/npm`'s `brace-expansion`, `tar` and `ip-address`: fixed upstream.
- `release.yml` scans with `ignore-unfixed: false`, so every one of these blocks.
- The PR body's statements are wrong and must be corrected before merge:
  - "Trivy's HIGH/CRITICAL scan stops failing"
  - "No other package in the image was flagged by the same Trivy run"
  - "will pass once this merges"
- Merging is still worth doing: it removes 8 real findings and fixes the boot crash.
- **Unblocking the release needs a separate change, and part of it is Thomas's decision:**
  - (a) Removing the unused `npm`/`corepack` from the runtime stage would clear the 4 node-pkg findings. The runtime only `exec`s `node`.
  - (b) `apt-get upgrade` in the runtime stage would clear the fixable OS findings.
  - (c) The unfixed and `will_not_fix` findings can only be cleared by one of:
    - changing the gate to `ignore-unfixed: true`: gate semantics, so it goes in the decision log;
    - a justified `.trivyignore`: effectively a waiver, which is Thomas's call only;
    - a different base image.

**F2 — LOW. perl-base is Essential, so "no other package depends on it" is not evidence of safety.**
- Debian policy lets packages rely on Essential packages without declaring a dependency. apt's output therefore could not have shown the real reverse dependencies.
- In this image the following Perl scripts are now broken: `debconf` and its `/usr/share/perl5/Debconf` modules, `adduser`/`deluser`, `update-rc.d`, `dpkg-reconfigure`, `dpkg-preconfigure`, `pam-auth-update` and `deb-systemd-helper`.
- Nothing in this image, its entrypoint, Compose, Helm or `deploy.sh` runs any of them (point 2 above), so this image is fine.
- The risk falls on anyone who extends it (`FROM taskdesk … RUN apt-get install …`). Maintainer scripts that source debconf will fail.
- Recommend two follow-ups:
  - Reword the Dockerfile comment's "no other installed package depending on it" to say what was actually verified.
  - Add one line to `container-image.md` saying the runtime image is not apt-extensible.

**F3 — INFO. The perl-base bytes are still in the base layer.** Removing a package in an upper layer only hides it (a whiteout). The files remain in the image's first layer, and the image is no smaller. Trivy's image scan reads the merged filesystem's dpkg status, so it no longer reports them. A scanner that inspects layer by layer would. This is acceptable for the stated purpose, but it should not be described as "removed from the image" in a stronger sense.

**F4 — LOW (structural guard; follow-up). Nothing checks the image's runtime dependency closure, which is how the domain gap reached `main`.**
- `check:dockerfile-deps` checks only the `deps` stage's manifest list.
- Nothing checks that `proddeps` and `runtime` carry every workspace package `apps/api` depends on at runtime.
- Neither `ci-fast.yml` nor `ci-full.yml` builds or boots the image.
- Suggested follow-up: extend `check:dockerfile-deps` to derive `apps/api`'s transitive `workspace:*` runtime dependencies and require both a `proddeps` manifest COPY and a `runtime` `dist` COPY for each. Or add a CI job that builds the image and boots it to `health/ready`, which is the check this review did by hand.

**F5 — INFO (documentation drift in this PR).**
- The Dockerfile header's deviation note (lines 14–19) still names only `@taskdesk/email` and `@taskdesk/permissions`. The inline comment at line 108 was updated; the header was not.
- The PR body does not describe commit `2a0a8f8` at all. Its `## Security review` section names a note path that differs from this file.
- The `pull request template + security review` check is also failing on body structure: a missing `## Design review H1–H6` section and a missing independent-review checkbox in `## Checklists`. The PR author has to fix these.

## Scope and tier

- **One Opus pass is the right tier.** This is a bounded fix of two independent lines in one file's runtime stage. It changes no authority, permission, migration or gate-semantics invariant, and `Dockerfile` is outside `ci-cd.md`'s security-scope list.
- **Bundling the two fixes is reasonable.** Both sit on the same release/deploy path, and each is useless without the other: a scan-cleaner image that cannot boot, or a bootable image the release pipeline refuses. The PR title and body must describe both.

## Delta rule

Any later commit on this branch that touches non-note paths needs a delta confirmation and a new `**Reviewed head:**` line. That includes a `main` merge, a rebase or a conflict resolution. This attestation covers `98832ca398c2506652795fbff26c1f9d937742f3` only. Editing the PR body does not change the SHA, and F1's body correction does not need re-review.
