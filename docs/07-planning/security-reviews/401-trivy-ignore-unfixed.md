# Security review — PR #401: release Trivy scan set to `ignore-unfixed: true`, plus fixes for the findings that do have a fix

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`). A fresh, independent subagent context, spawned by the orchestrating session for this review only. It did not write, direct or remediate this change.
**Date:** 2026-09-27
**Branch:** `fix/trivy-ignore-unfixed`

**Reviewed head:** `10cce79d19907c1572ea80242b139a5b5d6f4c38`

**Verdict:** CLEAR WITH FINDINGS. The gate change is exactly what Thomas approved and nothing more. The Dockerfile fixes work. An independent scan with the pinned Trivy gives 0 findings and exit code 0. **F1 is a merge condition:** four operative documents still say "high or critical fails the release", and they must be updated to match. That is a docs-only delta, and it needs a delta confirmation on the new head (see "Delta rule").

**Scope:** one commit beyond `main` (`e4f7678`). It touches:
- `.github/workflows/release.yml`: in security-review scope under `.github/**`.
- `Dockerfile`: not in scope, but it is the same release path.
- `docs/07-planning/decision-log.md`

The branch is up to date with `main`.

## What was checked

1. **The change is exactly what was authorized, and only that.**
   - The newest decision-log entry (2026-09-27) authorizes one thing: `ignore-unfixed: false` → `true` on the two Trivy steps, with `severity` and `exit-code` unchanged. It records that Thomas chose option 1 of three.
   - The `release.yml` diff is exactly that: two `ignore-unfixed` lines, two step `name:` strings, and one comment.
   - In both steps, `severity: HIGH,CRITICAL`, `exit-code: '1'`, `cache: false`, `version: v0.73.0`, `scan-type`, `image-ref` and the action SHA pin (`ed142fd…`, v0.36.0) are unchanged.
   - No `trivyignores`, `skip-dirs`, `skip-files`, `scanners`, `vuln-type`, `trivy-config` or `continue-on-error` was added.
   - These are the only two scan steps in `.github/**`, and no other workflow file changed.
   - Every other `release.yml` step is unchanged: build, digest extraction, SBOM, sign, attest, publish and verify.
   - The `Dockerfile` changes are remediation that makes the image pass the unchanged-severity gate. They are not gate changes, so they need no separate authorization. #397's review (F1 a/b) already recommended them as ordinary fixes.

2. **How `ignore-unfixed` really behaves** (checked in Trivy v0.73.0's source and the pinned action, not from memory).
   - The action (`action.yaml` at `ed142fd…`) exports `TRIVY_IGNORE_UNFIXED=true` only when the input is not `false`. `exit-code: '1'` becomes `TRIVY_EXIT_CODE=1`, and the severity input becomes `TRIVY_SEVERITY`.
   - `pkg/flag/vulnerability_flags.go`: `--ignore-unfixed` is shorthand for `--ignore-status` with **every status except `fixed`**. That covers `affected`, `will_not_fix`, `fix_deferred`, `end_of_life`, `under_investigation` and `unknown`.
   - `pkg/vulnerability/vulnerability.go` `FillInfo`: `Status = fixed` if and only if the advisory has a non-empty `FixedVersion`. This is worked out again on **every scan**, from whatever DB that scan loaded. `pkg/result/filter.go` then drops the ignored statuses.
   - Nothing persists between runs. There is no suppression list and no baseline, and with `cache: false` every CI run downloads a fresh DB.
   - **So when a vendor ships a fix, that finding blocks the next release run automatically.** This happens even at the same pinned base digest, because fix availability comes from distro advisory data, not from the image.
   - This was seen live here: bookworm is now `oldstable`/LTS, and the libpcre2 fix arrived as a DLA. Trivy picked it up as `fixed`.
   - The remaining gaps are narrower and listed as F3.

3. **Independent reproduction.** Trivy v0.73.0 was downloaded from the GitHub release, and its sha256 matched the release checksums file.
   - The PR image was built from a `git archive` of this head with `NODE_IMAGE` pinned to CI's exact digest (`node:24.20.0-bookworm-slim@sha256:ba849c60…`). The `runtime` stage had its cache off (`--no-cache-filter runtime`), because the first build had reused the author's cached layer.
   - The apt log shows `libpcre2-8-0` upgraded `10.42-1` → `10.42-1+deb12u1` from `bookworm-security`, and `perl-base` removed.
   - Scan settings: a fresh cache directory, then CI's exact settings (`TRIVY_SEVERITY=HIGH,CRITICAL TRIVY_IGNORE_UNFIXED=true TRIVY_EXIT_CODE=1`), with the default scanners (vuln + secret).
   - **Result on this head: 0 vulnerabilities in debian 12.15 and in all 252 node-pkg targets, 0 secrets, exit 0.**
   - **Negative control:** `main` at `e4f7678` was built the same way and scanned with the same flags. It exits 1 with exactly 7 findings, all `fixed`:
     - `libpcre2-8-0`: CVE-2026-86145, CVE-2026-89157, CVE-2026-89161
     - npm-bundled `brace-expansion`: CVE-2026-14257, CVE-2026-69152
     - npm-bundled `ip-address`: CVE-2026-69192
     - npm-bundled `tar`: CVE-2026-73566

     This matches the PR's claim. So the flag alone would not have unblocked the release; the Dockerfile fixes are required.
   - **What the flag now hides on this head** (same scan without `--ignore-unfixed`): 50 HIGH/CRITICAL findings, **none with a `FixedVersion`**.
     - 43 `affected`: util-linux family, ncurses/libtinfo6.
     - 6 `fix_deferred`: wget ×2, gzip, libacl1, libsystemd0, libudev1.
     - 1 `will_not_fix`: zlib1g CVE-2023-45853, CRITICAL, the minizip code Debian does not build into zlib1g.
     - 0 `end_of_life`.
   - **arm64 (not built; this host has no QEMU binfmt, and I did not register one on a shared host).** Trivy remote-scanned the pinned base index for `linux/amd64` and `linux/arm64` with `--ignore-unfixed`. The two fixable sets are **identical**: the same 7 findings, npm paths under `/usr/local/lib/node_modules/npm/`. `bookworm-security`'s `binary-arm64/Packages` carries `libpcre2-8-0 10.42-1+deb12u1`. Both fixes are architecture-independent, so arm64 should also come out at 0. That is an inference; CI's arm64 step is the real check.

4. **Removing the bundled npm.**
   - Runtime use: `deploy/entrypoint.sh` `exec`s `node`. No Compose file, Helm chart, `scripts/deploy.sh` or `docs/05-operations/**` runs npm or npx in the container. `deploy.sh`'s `pnpm seed` runs on the host. The build stages use pnpm through corepack, which is a separate directory and still works.
   - `/usr/local/bin/{npm,npx}` and `/usr/local/lib/node_modules/npm` are gone, and no symlinks are left dangling.
   - Boot check against a throwaway `postgres:18-alpine`, removed afterwards:
     - `TASKDESK_ROLE=migrate` exited 0.
     - The app ran as uid 10001 and started, with 0 restarts.
     - `GET /api/public/health/live` and `/ready` both returned `{"status":"ok"}`.
     - `node -v` 24.20.0, `corepack` 0.35.0 and `wget` all still work.
   - **SBOM.** `anchore/sbom-action` runs syft v1.44.0 against the pushed per-arch digest, meaning the final `runtime` stage, with syft's default squashed scope. I ran that pinned syft (checksum-verified) locally:
     - `main` image: 3262 components, including `npm` and 144 components under the npm directory.
     - This head: 2974 components, 0 npm, and `libpcre2-8-0` at `10.42-1+deb12u1`.
     - The SBOM therefore matches the filesystem that actually runs, which is the right thing for a consumer. BuildKit's `sbom: true` attestation also uses a squashed view.
     - An all-layers view still shows npm in the base layer (F5).
     - Removing npm does not affect signing, provenance or the selected-source attestation. All three bind the image digest, and the digest is produced after the `RUN`.
   - **Reproducibility.** `apt-get install --only-upgrade libpcre2-8-0` is not version-pinned, just like the existing unpinned `wget` install. The image was already not bit-reproducible across Debian repo updates, so this is not a regression.
   - `--only-upgrade` never installs a missing package, and it exits 0 once the base ships the fixed version.

5. **Process.**
   - The classification is right: `.github/workflows/release.yml` is CI/gate machinery, in scope under `.github/**`.
   - This is a real change to what the release gate fails on. Under AGENTS.md's table it is at least the "bounded fix that changes pass/fail semantics for a narrow, well-understood case" row: **one strong ordinary review plus a single full Opus pass**.
   - Nothing was waived: every `## Gates` row is `n/a` with a reason, and none says `waived`. The gate's real behaviour was changed with Thomas's own recorded decision, which is not a bypass of an unchanged gate.
   - The decision-log entry is newest-first and append-only; the diff only adds lines. It records the options, who decided and the reason.
   - Not done yet (F6): `## Reviewed by` is still `PENDING`, and `## Security review`'s `**Note:**` is still a `<pr>` placeholder. That placeholder is the only current `pull request template + security review` failure.

## Findings

**F1 — MEDIUM (merge condition; docs only). The operative documents still describe the old, stricter gate.**
- CLAUDE.md requires a decision that changes a rule to "update the operative documents in the same change". These documents still say, unqualified, "high or critical fails":
  - `docs/04-engineering/ci-cd.md:444` (step 4)
  - `docs/01-architecture/security-model.md:413`
  - `docs/05-operations/container-image.md:104`
  - `docs/07-planning/release-plan.md:146`
- `ci-cd.md` matters most. It is the authoritative CI description, and the next reviewer will check `release.yml` against it.
- The `CI matches ci-cd.md` check does not compare this flag, so it cannot catch the drift.
- **Fix:** qualify each line along the lines of "high or critical *with a fix available* fails (`ignore-unfixed`; decision log 2026-09-27)". Optionally, have the decision-log entry name these lines as the ones it amends.

**F2 — MEDIUM (follow-up, pre-existing; this change makes it more relevant). A repo-root Trivy config or ignore file would silently reshape this gate, and adding one does not trigger a security review.**
- The action runs Trivy in the workspace checkout, so Trivy loads these files from the current directory by default:
  - `trivy.yaml` (`--config` default, `pkg/flag/global_flags.go`)
  - `.trivyignore` / `.trivyignore.yaml` (`--ignorefile` default, `pkg/result/ignore.go`)
- None of these paths is in `ci-cd.md`'s security-review list. A PR adding a `.trivyignore`, which the decision log itself treats as a waiver-class option, would get only ordinary review.
- **Fix:** add `trivy.yaml`, `.trivyignore` and `.trivyignore.yaml` (or `.trivyignore*`) to the scope list. Alternatively, pin the scan to an explicit empty ignore file and config.

**F3 — LOW (follow-up). What `ignore-unfixed` makes quiet that used to be loud.**
- (a) The flag hides `end_of_life` too. Trivy's Debian 12 end-of-life date is 2028-06-10 (`pkg/detector/ospkg/debian/debian.go`). After that, no fixes arrive, every finding is "unfixed", and the scan stays green while the base image goes stale. Today there are 0 `end_of_life` findings and no EOSL warning. Suggest setting `TRIVY_EXIT_ON_EOL=1` on both steps (`--exit-on-eol` exists in v0.73.0; the action has no input for it, so use step `env:`), or a dated follow-up to move the base image (decision-log option 3).
- (b) The scan runs only on push to `main` and on dispatch. A fix that becomes available for an image that is already published is not noticed until the next push. This was already true before this change, but the old gate at least failed on everything. A scheduled re-scan of `edge` would close it.

**F4 — LOW (optional). Upgrading one named package makes every future Debian fix a new release breakage.**
- The base image also has pending security updates for `liblzma5` (DLA-4783-1) and `tzdata` (DLA-4792-1). Both are `UNKNOWN` severity, so neither blocks today.
- With the base digest pinned, each future Debian fix for a HIGH in a base package will fail the release until someone edits this `RUN` line by hand.
- `apt-get upgrade -y` (before the purge) would take all security fixes automatically. The trade-off is less control over exactly what changed, which the unpinned installs already accept. This is Thomas's or the orchestrator's call; it does not block.

**F5 — INFO. The bytes are still in the base layer, and there are other unused package managers.**
- As with #397's F3, deleting `/usr/local/lib/node_modules/npm` in an upper layer only hides it (whiteout). The image is not smaller, and all-layers tools (`syft --scope all-layers`) still list npm.
- The squashed view is what Trivy's image scan and the published SBOMs use. It is the correct view for "what can run".
- `/opt/yarn-v1.22.22` (yarn 1) and corepack are also unused at runtime. They are clean today, but they are the same kind of future failure as npm was. They could be removed the same way if they ever get flagged.

**F6 — INFO (process; for the orchestrator).**
- `## Reviewed by` is `PENDING`. The one strong ordinary review still has to be recorded; this Opus pass does not replace it.
- The `**Note:**` must link this file's exact path.
- Attribution mismatch: the commit's git author is `Codex GPT-6` (this host's `user.name`), but the trailer and PR body say Sonnet 5. The body and trailer are presumably correct. Flagged only so that any `coder`-panel reviewer exclusion is applied correctly once `pal-mcp` returns.

## Scope and tier

- **A single full Opus pass is the right security tier**: a one-flag change to a gate's pass/fail semantics, authorized by Thomas, plus two bounded Dockerfile remediations. It changes no authority, permission or migration invariant.
- There are no repeated-round concerns here.

## Delta rule

- Any later commit on this branch that touches non-note paths needs a delta confirmation and a new `**Reviewed head:**` line. That includes F1's doc edits, a `main` merge, a rebase or a conflict resolution.
- For F1 alone, the delta confirmation only needs to verify two things: the new commit touches just the four named doc files, and it only qualifies the Trivy sentence.
- This attestation covers `10cce79d19907c1572ea80242b139a5b5d6f4c38` only.

---

## Delta confirmation — F1/F2 fix (2026-09-27)

**Reviewed head:** `2894737b43e193faea8014f5b030d62d59fc9bbb`
**Previously reviewed head:** `10cce79d19907c1572ea80242b139a5b5d6f4c38`
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged.

Implements exactly Opus's own F1 and F2 findings, nothing else:
- F1: the four named docs (`ci-cd.md`, `security-model.md`, `container-image.md`,
  `release-plan.md`) now qualify "high or critical fails" with "with a vendor-supplied fix
  available", citing this decision log entry. Docs only.
- F2: `trivy.yaml`/`.trivyignore`/`.trivyignore.yaml` added to `ci-cd.md`'s
  security-review-scope path list.
- `git diff --stat` against the previously reviewed head confirms exactly these 4 files
  changed, no code.

---

## Lightweight re-confirmation after branch update (2026-09-27)

**Reviewed head:** `1b635e56b001c75d8f8c7a2cc4bf65b741f6dc73`
**Previously reviewed head:** `6334d37...` (the F1/F2 delta confirmation head)
**Reviewer:** orchestrating session (mechanical verification)
**Verdict:** CLEAR, unchanged.

- Merging `main` (bringing in #392 and #396, both already Opus-CLEARed) produced one real
  conflict, in `docs/07-planning/decision-log.md` — both branches had independently
  prepended a new entry at the same insertion point. Resolved by keeping both entries in
  full, newest first; verified no content lost (`grep -c "^### 2026-09-27"` before/after
  matches expected count).
- The `Dockerfile` merged automatically with no conflict; confirmed this PR's own changes
  (`ignore-unfixed`, the `libpcre2-8-0` upgrade, the npm removal) are all still present and
  unchanged after the merge.
- `git show --remerge-diff` on every OTHER file in the merge matches #392's or #396's own
  already-reviewed content exactly — zero overlap with, or unexpected change to, this PR's
  own files.
- Caught and fixed my own mistake during this merge: an initial `git add -A` swept in two
  unrelated, untracked files that happen to sit in this shared checkout
  (`.sla-staging/types.ts`, `docs/07-planning/status-check-2026-09-18.md`, neither belonging
  to this PR or session). Removed from the commit before pushing (amended the not-yet-reviewed
  merge commit and force-pushed, since nothing had reviewed it yet); confirmed absent from the
  final pushed commit.
