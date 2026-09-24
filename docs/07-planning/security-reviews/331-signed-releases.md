# Pre-merge security review — PR #331 (signed SHA-based releases, issue #11)

**Reviewed head:** `6a956b5b2f563da7babab5351bad36b33900414a`

**Verdict: CHANGES NEEDED.** Two BLOCKING findings: S1 (supply chain in the signing job) and
S2 (governance: an unverified "Decided by: Thomas" entry). Six NON-BLOCKING findings. Nothing
in this PR is script-injectable. No path lets a pull request, a fork or a non-`main` ref sign
or publish under the identity that `scripts/deploy.sh` accepts.

**Status of the gate:** this is the required independent Opus security review, run **before**
merge. It covers the head named above **and that head only**. Because the verdict is CHANGES
NEEDED, it does **not** close the gate. A remediation head needs a fresh delta review. No
waiver was sought or used, and none is authorized.

**Reviewer independence.** This was a fresh Opus 5.5 context that is review-only. It did not
author, direct or remediate any part of the change. It made no code edit, no GitHub approval
and no PR comment. Its only write is this note. `git status --porcelain` was empty after a
`--frozen-lockfile` install and before this note was written.

**Attribution recorded.** `## Implemented by` says: "Codex agent; exact model variant is not
exposed in this runtime". The one commit (`6a956b5`) is authored `Claude Code`. The
orchestrator's PR comment says the Claude session did not write this PR. Under the
2026-09-23 attribution rule, the orchestrator must reconcile this before merge. This review
takes no position on who wrote the change. The attribution matters here only because it
bears on S2.

**Base.** The merge base is `dd067e2`. `origin/main` is `33ce9ec`, one commit ahead (#322,
API-only, disjoint from this diff). Any update-branch changes the head, so it needs the
reviewed-head binding re-attested.

---

## Surfaces examined

`gh pr diff 331 --name-only` returned:

- `.github/workflows/release.yml` (new, 253 lines). This is in security scope as CI/gate
  machinery and the signing trust root.
- `docs/04-engineering/ci-cd.md` (orchestrator-owned)
- `docs/07-planning/decision-log.md` (orchestrator-owned)
- `docs/07-planning/release-plan.md`
- `docs/05-operations/runbook.md`
- `docs/01-architecture/tech-stack.md`
- `docs/04-engineering/repository-bootstrap.md`
- `CHANGELOG.md`

I also read these unchanged consumers and inputs:

- `scripts/deploy.sh`: `COSIGN_IDENTITY` (l.43–47), `image_ref` (l.215–223),
  `verify_signature` (l.225–244), and its uses at l.364, l.381 and l.396.
- `compose.yml` l.29
- `Dockerfile`
- `.dockerignore`
- `docs/05-operations/deployment.md`
- The 2026-09-05 release-plan decision entry.

## Probes and results

| # | Probe | Result |
| --- | --- | --- |
| 1a | Triggers | `push: branches: [main]` and `workflow_dispatch` (inputs: `source_sha`, `version`). There is no `pull_request`, `pull_request_target`, `workflow_run` or tag trigger. |
| 1b | Ref gate | The job-level `if: github.ref == 'refs/heads/main'` rejects a dispatch from any other branch or tag. Even without it, a workflow run from another ref would get a Fulcio SAN of `…/release.yml@refs/heads/<other>`. The exact-identity check in `deploy.sh` and in the workflow's own verify step (l.235) would reject that. PASS |
| 1c | Permissions | Top level is `contents: read`. The one job holds `actions: read`, `attestations: write`, `contents: write`, `id-token: write` and `packages: write`. Each is needed by some step. All are granted to every step in the job, including third-party ones (see S1). |
| 1d | Fork / untrusted branch | Neither can reach this workflow's secrets or OIDC token. Pushing to `main` needs a PR under branch protection. A write-access user who pushes a modified workflow to another branch gets a non-`main` SAN, and `deploy.sh` rejects it. PASS |
| 2 | Script injection | Every `${{ }}` inside a `run:` block goes through `env:`. That covers the inputs, event name, run id, image, digest, tags, version and SHA. Interpolations in `with:` (`ref`, `tags`, `build-args`, `output-file`) are not shell. `version` is checked against a strict SemVer regex before any use, and `source_sha` against a hex regex. PASS |
| 3a | Action pinning | All 8 `uses:` are pinned to 40-character SHAs. I checked each against upstream with `gh api repos/<a>/git/ref/tags/<t>`: checkout v5.1.0, setup-qemu v3.6.0, setup-buildx v3.12.0, cosign-installer v4.1.0, build-push v6.18.0, sbom-action v0.20.7 and attest v4.0.0 each match their lightweight tag. The trivy-action v0.36.0 tag is annotated. It peels to `ed142fd…`, is SSH-signed and was tagged 2026-04-22, after the March 2026 trivy-action tag hijack. That action's own nested `setup-trivy` is also SHA-pinned. PASS for `uses:`. Runtime downloads are not pinned (S1). |
| 3b | Signer and verification | `cosign-installer` installs cosign `v3.0.5` (the release exists). Signing is keyless via GitHub OIDC (l.205). The post-publish verify (l.233–236) pins `--certificate-oidc-issuer https://token.actions.githubusercontent.com` and `--certificate-identity https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main`. Both strings are identical to `deploy.sh` l.46–47. PASS |
| 4a | Digest binding | `cosign sign "${IMAGE}@${DIGEST}"` uses the index digest from `build-push-action` outputs, not a tag. Attestation `subject-digest` is the same digest. Channel tags are created only afterwards, from `@${DIGEST}`. PASS |
| 4b | Documented verify | The verify appears in `deploy.sh` and in the workflow. There is no copy-paste operator `cosign verify` command in `runbook.md` or `deployment.md` (S7). |
| 4c | Unsigned image under the same name | Unsigned `candidate-<run>-<attempt>` tags stay in GHCR after a failed scan. `deploy.sh` would reject them. However, `deploy.sh` verifies a tag and then pulls the tag again (S3). |
| 4d | Does the consumer verify? | Yes. `production`, `upgrade` and `rollback` all call `verify_signature` before `dc pull`. `--no-verify` is an explicit, loud opt-out. PASS, with S3. |
| 5 | Secrets and caches | No secret is echoed. `docker login` uses `--password-stdin`. `.dockerignore` excludes `.git`, so the token that checkout persists in `.git/config` does not enter the build context. Nothing secret reaches build-args or provenance (`VERSION`, `GIT_SHA`, `BUILD_TIME`). `build-push-action` has no `cache-from`/`cache-to`. `trivy-action` (default `cache: true`, restore-keys `cache-trivy-`) and `setup-qemu-action` (default `cache-image: true`) do use the Actions cache. That cache is scoped to `main` here, and PR-scope caches are not readable from `main` (S6). |
| 6a | actionlint 1.7.7 | Two shellcheck notes: SC2129 (style) and SC2153 (info, a false positive). No errors. |
| 6b | zizmor 1.16.3 `--offline` | One medium finding: `artipacked` at l.48 (checkout persists credentials). Folded into S1. |
| 6c | `pnpm test:all --list` (the "CI matches ci-cd.md" job) | Exit 0. 0 passed, 0 failed, 16 not enabled. |
| 6d | `node --test scripts/ci/*.test.mjs scripts/ci/lib/*.test.mjs scripts/ci/probes/*.test.mjs` | 495 tests in 88 suites. 495 pass, 0 fail. |
| 7a | Independent ordinary review | **None recorded.** `gh pr view --json reviews` returns `[]`, there are no review comments, and the body says "Pending independent ordinary review". |
| 7b | Required checks at head | All green except "pull request template + security review", which **fails** (twice). The expected cause is the pending review items. |
| 7c | `check-pr-template.mjs --body <body>` | 2 problems. (1) `## Security review` **Note:** must link a committed review note. (2) The "Independent Opus security review" checklist box is unticked, which is a BLOCKER. |

---

## Findings

### S1 — BLOCKING — Signing job runs unpinned third-party code while holding the release identity

`.github/workflows/release.yml:31–253`, in particular l.36–43, l.49, l.116, l.119,
l.162–199 and l.43.

The whole trust model rests on one idea: a valid signature for
`release.yml@refs/heads/main` proves this pipeline built the digest. `ci-cd.md`'s hardening
section says so outright: "a compromised CI identity produces a *validly signed* image". In
this PR, one job holds `id-token: write`, `contents: write`, `packages: write` and
`attestations: write`, and in that same job it runs:

- `docker/setup-qemu-action` with its default image `docker.io/tonistiigi/binfmt:latest`.
  That is a mutable tag, run as a **privileged** container on the runner (checked at the
  pinned SHA, `action.yml` l.10–12). It is also cached in the Actions cache by default.
- `docker/setup-buildx-action` with the default `docker-container` driver. That boots a
  privileged `moby/buildkit` container from a mutable default tag. BuildKit **produces the
  bytes that get signed**.
- `trivy-action`, which downloads the trivy `v0.73.0` binary by version tag at runtime.
- `anchore/sbom-action`, which downloads syft `v1.44.0` by version tag at runtime.
  `github-token` defaults to `github.token`, so this third-party action is handed the
  `contents: write` token.
- A job-level `GH_TOKEN: ${{ github.token }}` (l.43), which exposes the `contents: write`
  token to every step's environment.
- `actions/checkout` with `persist-credentials` left at its default, so the write token
  sits in `.git/config` for the rest of the job (zizmor `artipacked`).

Pinning the action SHAs does not cover any of this code. It is exactly the path used in the
March 2026 trivy compromise, where a malicious release binary was fetched by version. Any
one of these components, if compromised, can request the OIDC token and sign an arbitrary
digest under the one identity `deploy.sh` trusts. It can also push tags or branches with
`contents: write`. In the privileged-container cases it can simply change what BuildKit
emits before the legitimate signing step signs it.

**Required change:**

1. Split the job. A build-and-scan job holds `contents: read` and `packages: write` only. A
   separate sign-and-publish job `needs:` it, takes the digest as a job output, holds
   `id-token`, `attestations`, `packages` and `contents: write`, and runs only first-party
   code: checkout (if needed), `cosign-installer`, `actions/attest`, the `gh` CLI and
   `imagetools`. No scanner, no SBOM tool and no QEMU runs in that job. The SBOM files pass
   between jobs as artifacts.
2. Pin the BuildKit and binfmt images by digest (`setup-buildx-action`
   `driver-opts: image=moby/buildkit:<ver>@sha256:…`; `setup-qemu-action`
   `image: tonistiigi/binfmt:<ver>@sha256:…`, `cache-image: false`).
3. Set `persist-credentials: false` on checkout. The repository is public, so the `git
   fetch` at l.72 needs no credential. Move `GH_TOKEN` from job `env` to the two steps that
   use `gh`.
4. Optionally, pass `token-setup-trivy`/`github-token` explicitly as a read-only value, or
   install trivy and syft by checksum.

### S2 — BLOCKING (governance; the orchestrator must verify) — Decision-log entry claims a Thomas decision this review cannot trace

`docs/07-planning/decision-log.md:10–25`.

A lane agent that is not Claude added a newest-first entry that ends "**Decided by:** Thomas
(2026-09-23)". The decision log and `ci-cd.md` are orchestrator-owned surfaces. The entry
does two things:

- It reverses the security posture recorded in `ci-cd.md` on `main`. Before: "The Release
  workflow runs only on manual dispatch from `main` or `release/*`" and "the build pipeline
  … has Docker registry credentials and nothing else". After: **every** `main` push is
  signed with the release identity. That is what creates S3's tag-binding gap.
- It drops semantic-release as the versioning mechanism.

Structurally, it sits **above** the `## Format` heading. Every other entry sits below it. It
also has no **Alternatives** line.

Nothing in the PR shows Thomas made this decision. If he did, the orchestrator should record
or confirm it (with the correct placement). If he did not, this is a lower source claiming
the highest authority. Under `CLAUDE.md`'s hierarchy, dependent code must not merge until
the decision is genuinely in force.

### S3 — NON-BLOCKING (track as an issue) — Tag-to-digest binding is not verified, and verify-then-pull is TOCTOU

`scripts/deploy.sh:215–223, 238–243, 364–366, 381–383` (unchanged by this PR, but this PR
creates the signed inputs it consumes).

- **Tag substitution.** Edge builds (every `main` SHA) and versioned releases are signed
  with the **same** SAN, and the signature binds only the digest. Anyone who can move a
  GHCR tag could repoint `v2.0.0` at any earlier edge digest, and `deploy.sh` would accept
  it. That includes a compromised `packages: write` token, or any step in S1 today. Fix
  options:
  - add `-a tag=<tag> -a source_sha=<sha>` annotations and check them at verify time;
  - verify the attestation's `--certificate-github-workflow-trigger`/`-sha`;
  - have `deploy.sh` require an explicit digest for `production` and `upgrade`.
- **TOCTOU.** When `TASKDESK_IMAGE_DIGEST` is empty (the `deploy/.env.example` default),
  `verify_signature` checks `taskdesk:<tag>`, and then `dc pull` resolves the tag **again**.
  A tag moved in between gets pulled unverified. Fix: resolve the digest once, verify
  `repo@digest`, and pull `repo@digest`.

The UAT updater described in `ci-cd.md` ("polls `edge`, verifies, pulls") must resolve the
digest once in the same way.

### S4 — NON-BLOCKING — A rerun can silently republish a version tag at a new digest

`.github/workflows/release.yml:94–101, 214–223, 238–253`.

The duplicate-release guard checks only the Git tag and the GitHub release. Suppose a run
publishes `ghcr…/taskdesk:v<version>` and then fails at `gh release create`. A rerun passes
both checks, builds a new, non-bit-identical index, and moves the image tag. A version tag
should be immutable.

**Fix:** also refuse when `docker buildx imagetools inspect "${image}:${tag}"` succeeds, or
create the Git tag/release before the registry tag.

### S5 — NON-BLOCKING — Concurrency and ordering edge cases

`.github/workflows/release.yml:24–28, 82–86`.

- **Cancelled dispatch.** GitHub keeps only one *pending* run per concurrency group. A
  manually dispatched release that is waiting behind a running edge build is **cancelled**
  if another push to `main` arrives.
- **`edge` moving backwards.** Re-running an older push run (`run_attempt` 2) moves `edge`
  back to an older digest.

**Fix:** use separate groups for edge and release. On push, skip moving `edge` unless
`source_sha == origin/main` at publish time.

### S6 — NON-BLOCKING — Scanner DB and binfmt image restored from the Actions cache inside the release job

`.github/workflows/release.yml:116, 162–179`.

These caches are `main`-scoped, so a PR cannot poison them. Still, a poisoned trivy DB would
quietly weaken the HIGH/CRITICAL gate. The binfmt cache (a privileged image) is covered by
S1.

**Fix:** set `cache: false` on both trivy steps.

### S7 — NON-BLOCKING — No operator-runnable verification command in the docs

`docs/05-operations/runbook.md` and `docs/05-operations/deployment.md`.

Add the exact `cosign verify --certificate-oidc-issuer … --certificate-identity …
ghcr.io/thomasheinthura/taskdesk@sha256:…` and `gh attestation verify` lines, so
verification is not only possible through `deploy.sh`. The 2026-09-05 architecture review
already asked for this.

### S8 — NON-BLOCKING — Minor correctness and doc drift

- **SHA regex too loose.** `release.yml:67` accepts 40–64 hex characters in any case. So a
  41–63-character value, or an uppercase SHA, gets past the regex. The uppercase form then
  flows into `GIT_SHA` and `--target`.
  **Fix:** normalise with `source_sha="$(git rev-parse --verify "${source_sha}^{commit}")"`
  and require exactly `^[0-9a-f]{40}$`.
- **`ci-cd.md` pipeline table is inaccurate.** `docs/04-engineering/ci-cd.md:9–12` lists
  "Build" as signing and publishing edge on `main`, and "Release" as manual dispatch. In
  fact one workflow, `release.yml`, does both, and `ci-*.yml` never signs. (The step list
  at l.384–393 does match the workflow's order.)
- **`ci-cd.md` hardening bullet (l.477–481)** should name the split-job design once S1 is
  fixed.

---

## Gate status at this head

- **Ordinary independent review:** not recorded. It must come from an agent other than the
  implementing Codex lane, stating the model and this exact SHA.
- **Required checks:** all green except "pull request template + security review", which
  fails.
- **Template checker (local):** 2 problems (security-review note link; unticked Opus box).
- **This review:** CHANGES NEEDED. S1 and S2 block.

---

## Delta review (Opus 5.5) at `3a0af48`

**Reviewed head:** `3a0af48148ce2c5ac7600f3be83d27c8655d94b2`

**Verdict (security gate): CLEAR WITH FINDINGS.** S1 and S2 are closed. S3 through S8 are
fixed, apart from the NON-BLOCKING residuals D1–D5 below. This closes the Opus security gate
for this head and this head only. A later commit that touches anything outside
`docs/07-planning/security-reviews/` voids this clearance. No waiver was sought or used.

This clears security only. The **merge gates listed under "Gates the orchestrator must
check" are separate and are not satisfied at this head.** Two of them come from the
decision log, and this review cannot satisfy them.

**Reviewer independence.** This was a fresh Opus 5.5 context, working in a new detached
worktree at the exact head. It authored, directed and remediated nothing. Its only write is
this section.

### History: what was rewritten

The branch was rebased onto `origin/main` `7bebaf6`, and the merge base is the tip of
`main`. The rebase did three things:

- `5601a33` re-lands the originally reviewed `6a956b5`. `git range-diff` shows exactly one
  difference: the unauthorised decision-log hunk (S2) was dropped. Nothing else changed.
- `8ea2f96` carries the first Opus note. It is **byte-identical** to the one pushed at
  `6f7403b`. `6f7403b` itself is no longer an ancestor, because the branch was
  force-rewritten.
- The remediation commits are `b18df44`, `1d3d0e6`, `77e116e`, `22fde47` and `3a0af48`.
  Only `1d3d0e6` uses a distinct lane identity (`Codex (GPT-6 Luna) <agent@taskdesk.local>`).
  The other four are authored `Claude Code <noreply@anthropic.com>`, after the 2026-09-23
  commit-identity rule. See the gates section.

Diff against `main`: `release.yml`, `scripts/deploy.sh`, `ci-cd.md`, `runbook.md`,
`release-plan.md`, `decision-log.md` (+12), `status.md` (+46), `tech-stack.md`,
`repository-bootstrap.md`, `CHANGELOG.md`, and two security-review files.

### S1: CLOSED

| Check | Result |
| --- | --- |
| Split authority | `build-scan` (l.29–239) holds `contents: read` and `packages: write` only. `sign-publish` (l.241–398) holds `id-token`, `attestations`, `contents: write`, `packages` and `actions: read`, and runs **only** `sigstore/cosign-installer` (SHA-pinned; installs cosign v3.0.5), `actions/attest` (SHA-pinned, first-party), `docker login`, `docker buildx imagetools`, `jq` and the `gh` CLI. It has no checkout, and no scanner, SBOM tool, QEMU or BuildKit. PASS |
| Images pinned by digest | I resolved each pin live with `docker buildx imagetools inspect`, and each matches its tag. `tonistiigi/binfmt:qemu-v10.0.4@sha256:8f58e621…` (`cache-image: false`); `moby/buildkit:v0.25.2@sha256:0f63d66f…`; `NODE_IMAGE=node:24.20.0-bookworm-slim@sha256:ba849c60…`, passed as a build-arg to the Dockerfile's two `FROM ${NODE_IMAGE}` stages. The new `actions/upload-artifact@ea165f8d…` matches upstream `v4.6.2`. PASS |
| `persist-credentials: false` | Set (l.58). `sign-publish` has no checkout at all. PASS |
| `GH_TOKEN` scope | Set only on the steps that call `gh`: validate (l.69, in the read-only-contents job), publish tags (l.330), download SBOMs (l.376) and create release (l.384). There is no job-level `GH_TOKEN`. PASS |
| trivy and syft | Still downloaded by version, not checksum. They now run **only** in `build-scan`, which has no OIDC identity and no contents write. `cache: false` is set on both trivy steps. PASS for S1's bar; see D1 for what remains. |
| Crossing the job boundary | `sign-publish` signs `needs.build-scan.outputs.digest`. That is `steps.build.outputs.digest` from `build-push-action`, recorded before any third-party scanner step runs. It passes through `env:` only and is never shell-interpolated. The only file artifact is `release-sboms`, which is informational. It is uploaded as release assets and never executed or signed. See D1 and D4. |

### S2: CLOSED (on the orchestrator's attestation of Thomas's confirmation)

`decision-log.md:30–38` now sits **below** `## Format` (l.18). It has an **Alternatives**
line and ends "**Confirmed by:** Thomas in the 2026-09-23 session response". I cannot see
Thomas's session response, so this rests on the orchestrator's PR comment of
2026-09-23T16:51Z.

NON-BLOCKING wording gap: the orchestrator's comment says Thomas approved **signing every
`main` push with the release identity**. The entry, however, only says "the existing
automatic `edge` cadence remains as documented". The security-relevant half of the decision
should be stated in the entry itself.

### S3: FIXED (residual D2)

- **Tag bound to signature.** `release.yml:267–280` signs once per published tag, with
  `--annotations tag=<tag>` and `source_sha=<sha>`. `deploy.sh:255` verifies
  `--annotations tag=${TASKDESK_IMAGE_TAG}`. Repointing `v2.0.0` at an edge digest (signed
  `tag=edge`/`tag=sha-…`) now **fails** verification.
- **TOCTOU closed.** `resolve_and_verify_image` (`deploy.sh:261–278`) resolves the tag to a
  digest once, requires `^sha256:[0-9a-f]{64}$`, exports `TASKDESK_IMAGE_DIGEST`, and
  verifies `repo@digest`. `compose.yml:35,63` then renders `repo:tag@digest` for both
  `taskdesk` and `migrate`, so `dc pull` (l.400, 425, 480) fetches the verified bytes. The
  exported variable wins over `.env`, which is sourced first (l.158).
- **Rollback.** `rollback` requires the digest and its signed tag, verifies both, and
  persists both. The upgrade hint prints a complete command only when both are known.

### S4–S8

| Finding | Status |
| --- | --- |
| **S4** rerun republishes the version tag | **Fixed.** The validate step refuses when the Git tag, the GitHub release or the image tag already exists, and it fails closed on an ambiguous lookup error (l.112–134). The publish step refuses to move a `v*`/`sha-*` tag to a different digest and is idempotent for the same one (l.339–351). Residual D3. |
| **S5** concurrency / stale edge | **Fixed.** Concurrency groups are separate: `taskdesk-edge`, and `taskdesk-release-<version>` (l.25). `edge` moves only when `SOURCE_SHA` equals the live `main` tip (l.333–338). |
| **S6** scanner cache | **Fixed.** `cache: false` on both trivy steps, and `cache-image: false` for binfmt. |
| **S7** operator verification commands | **Fixed.** `runbook.md` "Verify a published image" covers `cosign verify` with exact issuer, identity and tag/source annotations, plus two `gh attestation verify` calls. Residual D5. |
| **S8** SHA regex / pipeline table | **Fixed.** The input must be `^[0-9a-f]{40}$` and is re-normalised with `git rev-parse --verify` (l.80–95). The `ci-cd.md` table and hardening bullets now describe the single `release.yml` with split jobs. |

### New NON-BLOCKING residuals

- **D1: build-job outputs are trusted across the boundary.** `build-scan` still runs
  third-party code (trivy and syft binaries fetched by version) on a runner with
  passwordless sudo. That job's docker config also holds a `packages: write` token.
  - A compromised scanner could push arbitrary unsigned images or tags. `deploy.sh`
    rejects those, so the impact is limited to denying a release by squatting on a tag.
  - In principle, a root-level compromise could also tamper with the runner worker's
    recorded job outputs before they are uploaded.
  - This is the accepted residual of the standard GitHub split-job pattern, which SLSA's
    container generator shares. Hardening option: install trivy and syft by checksum
    (`skip-setup-trivy` plus a verified binary).
- **D2: signatures on a mutable channel never expire.** Every edge digest carries a
  permanent `tag=edge` signature. That includes stale runs, because signing (l.267)
  happens before the stale-edge skip (l.335).
  - Anyone who can write the registry can repoint `edge` at an older signed edge digest,
    and it will verify.
  - Release tags are unaffected.
  - Mitigations: UAT's updater could compare `source_sha` against `main`, or signing could
    move after the stale-edge check.
- **D3: a failed release can leave a second signed digest for the same version.** Suppose
  a run signs `tag=vX` on digest D1 and then fails before the tag is published. A rerun
  builds D2 and signs `tag=vX` again, so both digests verify as `vX`. D1 comes from the same
  selected source and passed the same scans, so the impact is low.
- **D4: SBOMs are not attested.** The release SBOMs are uploaded as plain assets. An
  `actions/attest-sbom` or `cosign attest --type cyclonedx` step would make them
  verifiable.
- **D5: the runbook's attestation checks are not ref-pinned.**
  - `runbook.md:217–224` uses `--signer-workflow` with no ref pin, so an attestation from
    `release.yml` run on another branch would also match. Add `--source-ref
    refs/heads/main`, or `--cert-identity` with the exact SAN.
  - The `jq` predicate check does not compare `imageDigest`.
  - The cosign check above it is exact, so this only weakens the secondary evidence.

### Tooling at this head

| Tool | Result |
| --- | --- |
| actionlint 1.7.7 | One SC2129 style note only. |
| zizmor 1.16.3 `--offline` | "No findings to report" (2 suppressed). `artipacked` is gone. |
| `pnpm test:all --list` (CI-matches-docs) | Exit 0. 0 passed, 0 failed, 16 not enabled. |
| `node --test scripts/ci/*.test.mjs scripts/ci/lib/*.test.mjs scripts/ci/probes/*.test.mjs` | 495 of 495 pass. |
| `bash -n scripts/deploy.sh` | OK. |
| GitHub checks at head | All green except "pull request template + security review". One cancelled run each of "unit + component" and "gate checkers" sits beside green reruns. |
| `check-pr-template.mjs --body` | 2 problems. (1) The body links `331-signed-releases-remediation-pending.md`, which has no `Reviewed head`. (2) The Opus box is unticked. The body should link this note, and the queue marker should be retired. |

### Gates the orchestrator must check (not security findings; each blocks merge under the decision log)

1. **Ordinary-review independence.**
   - `## Implemented by` names "Codex GPT-6 Luna" for the remediation.
   - `## Reviewed by` names "GPT-6 Luna (independent context)" as the reviewer at `3a0af48`.
   - The 2026-09-23 lane entry says "the same agent or tool is never both author and
     ordinary reviewer".
   - The newer 2026-09-23 entry says that until 2026-09-30, a **fresh Claude Sonnet
     context** does ordinary reviews, because the lane agents reported no review capacity.
   - On the record as it stands, the ordinary review at this head does not satisfy either
     entry.
2. **Attribution.** Four remediation commits were made after the rule and are still
   authored `Claude Code`. The PR body itself calls this "unreconciled … a merge blocker".
3. **Control-plane edits.** The lane edited `docs/07-planning/status.md`, which is
   orchestrator-owned. Those edits include entries about #323 and #334 that fall outside
   this PR's scope. The decision-log edit is covered by the S2 confirmation.

---

## Delta review 2 (Opus 5.5) at `b3a3e3a`

**Reviewed heads:** `da7912aab5f03ea9482aa347068bfdf0b861bb11` (commissioned), then the final
head. The PR head moved during this review. `da7912a` was reviewed in full first; then
`b3a3e3a` was pushed, changing only `docs/07-planning/status.md` (+5/−3, prose).

**Reviewed head:** `b3a3e3a5cfeaba86da6bf1ee9c248c94688fed36`

**Verdict (security gate): CLEAR WITH FINDINGS.** Nothing blocks. The S1/S3 invariants still
hold. This clearance covers these heads and no others: any later commit outside
`docs/07-planning/security-reviews/` voids it. No waiver was sought or used. The merge gates
recorded in the previous delta section are still for the orchestrator to verify; this
section does not re-clear them.

**Independence.** This was a fresh Opus 5.5 context in a new detached worktree. It authored,
directed and remediated nothing. Its only write is this section.

### What changed since `7fa9188`

`7fa9188` is an ancestor (no rewrite this time). There are five commits, all authored
`Codex GPT-6 Luna <codex-gpt-6@taskdesk.local>`, a distinct lane identity:

- `a5441a6`
- `b1e4db7`
- `48a0272`
- `da7912a`
- `b3a3e3a`

`git diff 7fa9188 b3a3e3a -- .github compose.yml` is **empty**. In `scripts/deploy.sh`, only
the local-mode certificate block changed (l.172–188). The rest of the delta is
documentation: `observability.md`, `security-model.md`, `configuration-reference.md`,
`deployment.md`, `runbook.md`, `decision-log.md` (+18) and `status.md`.

### 1. Local certificate generation and renewal (`scripts/deploy.sh:172–188`)

| Check | Result |
| --- | --- |
| Scope | Runs only in `MODE=local`. `production`/`upgrade`/`rollback` never touch `$CERT_DIR` (`deploy/local/certs`, which is gitignored). |
| What "stale" means | `local_certificate_covers_routes` checks `openssl x509 -checkhost` for `ticket.`, `portal.`, `mail.` and `files.${DOMAIN}`. A missing key, a missing cert, or any host not covered triggers regeneration. I checked this empirically with OpenSSL 3.5.5. The previous wildcard-only certificate (`DNS:*.localhost,DNS:localhost`) **fails** `-checkhost ticket.localhost`, because OpenSSL will not match a wildcard directly under a single-label name. So existing installs regenerate once. The new certificate names each host explicitly, passes all four checks, and is therefore stable on later runs. |
| Key permissions | OpenSSL 3.5.5 writes `-keyout` as mode **600** (measured, umask 022), and the script then runs `chmod 0600`. The key is never echoed: openssl output goes to `/dev/null`, and nothing prints the key path contents. PASS |
| Command injection | `DOMAIN` (from the operator's `.env`, defaulting to `localhost`) is double-quoted in every argv position (`-subj`, `-addext`, `-checkhost`). No shell evaluation. PASS. See D6 for the value-level caveat. |
| Race / symlink | The paths sit inside the operator's own checkout. An attacker would need write access to the repository directory. That is not a new trust boundary, and the behaviour is unchanged from `main`. No finding. |
| Operator cert overwritten | A hand-placed cert that covers all four hosts is kept. One that is missing any host is **silently replaced**, key included (D7). |

### 2. Diagnostics

- `deploy.sh` gains no new output beyond the unchanged `say` line naming `*.${DOMAIN}`.
- The runbook's new diagnostic commands print no secret, connection string or env value:
  - `dc stats --no-stream`;
  - `pg_stat_activity` grouped by `state`;
  - `notification` counts by `type`;
  - `dc logs --since=1h | grep -Ei 'outbox|notification'`.
  All `psql` calls authenticate through the container's own user and DB variables, with no
  password on the command line.
- The removed commands had exported `METRICS_TOKEN` and `$ADMIN_SESSION_COOKIE` into shell
  history. Removing them reduces exposure.
- The claims that `/metrics`, port 9464 and `/api/instance/health/deep` are "not currently
  served" are **verified**: `grep` over `apps/api/src` finds no such route or listener.
- The runbook attestation checks now pin `--source-ref refs/heads/main` and compare
  `imageDigest`. **D5 is closed.**

### 3. Earlier invariants

- **S1 holds.** `release.yml` is byte-identical to `7fa9188`: split `build-scan` /
  `sign-publish`, digest-pinned images, `persist-credentials: false`, step-scoped `GH_TOKEN`.
- **S3 holds.** `resolve_and_verify_image`, the `--annotations tag=` verification and
  `compose.yml`'s `repo:tag@digest` rendering are all unchanged.

### New NON-BLOCKING findings

- **D6: `DOMAIN` is not validated before use in X.509 fields.** `deploy.sh:172–187`.
  - A `DOMAIN` containing `,` adds extra `subjectAltName` entries, including `IP:` or
    arbitrary `DNS:` entries. One containing `/` adds subject RDNs.
  - Only the operator controls `.env`, so this is self-inflicted rather than exploitable.
  - Suggested fix: reject anything outside `^[A-Za-z0-9.-]+$`, the same way
    `TASKDESK_HSTS_PRELOAD` is validated.
- **D7: renewal can replace an operator-supplied local cert without keeping a copy.**
  - Suggested fix: move the old `local.crt`/`local.key` to `*.bak` (or refuse and ask),
    and print that it happened.
- **D8 (pre-existing, not introduced here): the generated certificate is a CA.**
  - `openssl req -x509` applies the default `v3_ca` profile. I measured
    `basicConstraints: critical, CA:TRUE` on the generated cert.
  - The script tells the operator to trust `local.crt`. A trusted CA whose key lives in the
    checkout can mint a certificate for *any* hostname that browser accepts.
  - Suggested fix: add `-addext basicConstraints=critical,CA:FALSE`,
    `-addext keyUsage=critical,digitalSignature,keyEncipherment` and
    `-addext extendedKeyUsage=serverAuth`.
  - Expiry is also not checked (no `-checkend`). A certificate past 825 days is not
    renewed automatically.

### Governance note for the orchestrator (not a security finding)

`a5441a6` adds a decision-log entry, "2026-09-24 · P0 ordinary reviews use fresh GPT-6
contexts while Claude is unavailable", ending "**Decided by:** Thomas, 2026-09-24". The lane
agent wrote it into an orchestrator-owned surface, and it governs the ordinary-review gate
for this very PR. This is the same class as S2. The orchestrator must confirm Thomas made
this decision before relying on it. The lane also edited `status.md` again.

### Tooling at the final head

| Tool | Result |
| --- | --- |
| `bash -n scripts/deploy.sh` | OK |
| shellcheck 0.11.0 | Three warnings, all pre-existing and outside the delta: SC1090 ×2 (`. "$ENV_FILE"`) and SC2034 (l.328). None in the changed block. |
| `pnpm test:all --list` (the CI-matches-ci-cd.md job) | Exit 0 |
| `node --test scripts/ci/*.test.mjs scripts/ci/lib/*.test.mjs scripts/ci/probes/*.test.mjs` | 495 of 495 pass |

## Delta review 3 (Opus 5.5) at `a67b5e3`

**Reviewed head:** `a67b5e311f5dd0453b981f9cc6dac704f7239672`

Previous Opus-attested head: `b3a3e3a5cfeaba86da6bf1ee9c248c94688fed36` (delta 2, note at `2d4dc2f`).

**Verdict (security gate): CHANGES NEEDED.** No new vulnerability was introduced. D6, D7 and
D8 are fixed. But the new certificate helper's route-coverage check does not work on the
OpenSSL that CI runs (F1). The required `gate checkers + red probes` check is red at this
head because of it. The fix has to touch `scripts/lib/local-certificate.sh`, which is in
security scope, so a further delta review is needed anyway. No waiver was sought or used.

**Independence.** This was a fresh Opus 5.5 context in a detached worktree. It authored,
directed and remediated nothing. Its only write is this section.

### Commits in `b3a3e3a..a67b5e3`

The brief listed four commits. There are seven on the branch's first-parent line, plus two
from `main` that arrived through the merge:

| Commit | Author | Content |
| --- | --- | --- |
| `2d4dc2f` | Opus reviewer | the delta-2 note (review-only) |
| `bd62c4d` | Codex GPT-6 | **not in the brief.** It adds `scripts/lib/local-certificate.sh` and moves the `deploy.sh` cert block into it. It adds `scripts/lib/**` to `ci-cd.md`'s security-scope list, with a matching `security-paths.test.mjs` entry. It also changes the `traefik-and-domains.md` prose and adds three tests. |
| `2d58080` | Codex GPT-6 | **not in the brief.** It changes `status.md` only. |
| `e19b75c` | Codex GPT-6 | key/cert public-key match before reuse, plus one test |
| `e04ea52` | Codex GPT-6 | `status.md` only |
| `81d2899` | Codex GPT-6 | merge of `origin/main` at `9d5deb9` |
| `a67b5e3` | Codex GPT-6 | `status.md` only |
| `776999d`, `9d5deb9` | from `main` | #355 and #323. Each was reviewed on its own PR. They are not re-reviewed here. |

This review covers `bd62c4d` and `2d58080` as well.

### 1. Local certificate helper (`scripts/lib/local-certificate.sh`, `deploy.sh:172–193`)

I probed the helper empirically with OpenSSL 3.5.5 on this host.

| Check | Result |
| --- | --- |
| Command injection | `DOMAIN` is always double-quoted in argv. There is no `eval`. `$(touch pwned)` was rejected, and nothing was executed. PASS |
| **D6** (DOMAIN validation) | **RESOLVED.** `validate_local_certificate_domain` runs before any file is written or any `openssl req`. It enforces `^[A-Za-z0-9.-]+$`, a total length of 253 or less, and 1–63-character LDH labels. Each of `x,IP:1.2.3.4`, `a/CN=evil`, `-oops`, `a..b` and the empty string gives rc=1 and creates no directory. Under `set -Eeuo pipefail`, that return aborts `deploy.sh`. Before validation, the unvalidated value reaches only `-checkhost` argv and the `say` line, which is harmless. |
| **D7** (backup before replacing) | **RESOLVED.** Existing `local.crt` and `local.key` are copied with `cp -p` into `mktemp -d replaced-XXXXXX` (mode 0700) before the new pair is moved in. The script prints the backup path to stderr. I checked that the backup is byte-identical to an operator key that had a mismatch. A pair that covers the routes, matches, and is valid for more than 30 days is kept untouched (idempotent run: no backup and no rewrite). |
| **D8** (CA:TRUE) | **RESOLVED.** The measured output is `basicConstraints: critical, CA:FALSE`, `keyUsage: critical, Digital Signature, Key Encipherment` and `extendedKeyUsage: serverAuth`. Expiry is now checked too, with `-checkend 2592000`. |
| Key permissions | The new key is written inside a 0700 `mktemp -d` directory and `chmod 0600`'d before `mv`. Under `umask 000` it measured 0600. The backup keeps the old key's original mode (for example 0644), but it sits inside a 0700 directory, so no other user can read it. PASS |
| Fail closed when openssl fails | With an `openssl req` shim that exits 1, the helper prints "Could not generate…", removes its temp directory, returns 1 and leaves the operator's files byte-identical. No backup is made. PASS |
| Overwrite / deletion | Nothing is deleted except the helper's own temp directory. The originals are replaced only after both a successful generation and a backup. The two `mv`s are not atomic as a pair. An interruption between them leaves a mismatched pair, which e19b75c's key check now detects and repairs on the next run. |
| e19b75c key-match | It compares `x509 -pubkey` with `pkey -pubout` (SPKI PEM for both), so it works for any key type. An encrypted key fails the check without a TTY and gets renewed, after a backup. See N2. |
| `bash -n` | OK for `deploy.sh` and `local-certificate.sh`. |
| shellcheck | **Not run.** It is not installed in this context. |
| `node --test scripts/ci/lib/local-certificate.test.mjs` | 4 of 4 pass locally with OpenSSL 3.5.5. |

### F1: BLOCKING (a correctness fault in a security-scope file; the required check is red). Route-coverage check is a no-op on OpenSSL 3.0

- **What fails in CI.** At `a67b5e3`, `gate checkers + red probes` fails on
  `local-certificate.test.mjs:132`, "preserves existing local TLS material before renewing
  it". The helper returned 0 and created no `replaced-*` directory.
  - It also fails the same way at `2d58080` (job 107468562198).
  - So the "all 498/499 CI-script tests pass" claims in `status.md` were local-only. CI has
    been red on this test since `bd62c4d`.
- **Cause, inferred rather than reproduced.** No OpenSSL 3.0 binary is available on this
  host.
  - In that test, the pair matches and is not near expiry. The only thing that should force
    renewal is SAN coverage, i.e. `openssl x509 -checkhost`.
  - The runner is `ubuntu-24.04`, which ships OpenSSL 3.0.x. There, `-checkhost` prints
    "does NOT match" but exits 0. The newer 3.5.5 exits non-zero, and that is what the
    delta-2 measurement and local runs used.
  - The key-mismatch test and the leaf-creation test pass on the runner. That fits:
    only the host check is ineffective.
- **Effect.** On the most common LTS OpenSSL, a certificate that does not cover
  `ticket/portal/mail/files.${DOMAIN}` is kept for good. For example, the old
  wildcard-only cert, or one issued for a previous `DOMAIN`, is never renewed. This does
  not weaken security, since it is a local self-signed cert. But the renewal behaviour this
  PR's documents describe does not happen, and the required check stays red.
- **Fix.** Don't rely on the exit status. Match the output instead, for example
  `openssl x509 … -checkhost "$h" | grep -q ' does match certificate'`, or compare the SAN
  list parsed from `-ext subjectAltName`. Keep the existing test as the regression test,
  since it already fails on 3.0.

### Non-blocking

- **N1.** Under a permissive umask, `mkdir -p "$cert_dir"` creates `deploy/local/certs`
  world-writable (0777 measured under `umask 000`). Another local user could then swap in
  a cert/key between runs.
  - The key file itself stays 0600.
  - Suggested fix: `mkdir -p -m 0700` or `chmod 0700 "$cert_dir"`. Traefik reads the
    directory through a bind mount, so check that the container's user can still read it.
- **N2.** `openssl pkey -in "$private_key"` on an encrypted key prompts for a passphrase on
  the TTY during an interactive `deploy.sh local`. Pass `-passin pass:` so the check fails
  without prompting. That is the right outcome, because Traefik cannot use an encrypted key.
- **N3.** `replaced-*` directories pile up, each with an old private key. They are
  gitignored under `deploy/local/certs/` and mounted read-only into Traefik (same trust
  domain). The documentation could say they are safe to delete.

### 2. Merge `81d2899`

- **It was not a clean merge.** `git merge-tree e04ea52 9d5deb9` conflicts in
  `docs/04-engineering/ci-cd.md` and `docs/07-planning/decision-log.md`.
- **`ci-cd.md` was resolved correctly.** The PR's line changes after the merge are the same
  as before it: `scripts/lib/**` is kept, and main's #355 coverage/e2e edits are kept.
- **The `decision-log.md` resolution dropped one of the PR's own entries.** The entry
  "2026-09-24 · P0 ordinary reviews use fresh GPT-6 contexts while Claude is unavailable"
  was removed. It was the one delta 2 flagged as untraceable, and no remaining document
  cites it. The "Manual release tags…" entry is kept.
  - Because it was never on `main`, dropping it rewrites no decision history. But the merge
    commit does this silently. The orchestrator should confirm it was intended.
- **Every other PR file is unchanged by the merge.** For every file, the line diff
  `mb..e04ea52` is identical to `9d5deb9..81d2899`.
- **Nothing else changed between the merge and the head.** `git diff 9d5deb9 a67b5e3 --
  .github` is only `release.yml`, and it is byte-identical to `b3a3e3a`. `compose.yml` and
  `deploy/` are unchanged. The helper, `deploy.sh` and its test are unchanged from `e19b75c`
  to `a67b5e3`.
- **Main's new CI jobs don't interact with the release workflow.** `release.yml` triggers on
  `push: main` / `workflow_dispatch` and depends only on its own `build-scan` job. It does
  not use `workflow_run`, and it does not read CI job names or statuses. The new
  `e2e - protected-route redirect` and `domain coverage (90%)` jobs pass at this head. S1
  and S3 still hold.
- **The PR is `CONFLICTING` with current `main`** (`3a45fc5`). #356 also widened the
  security scope to identity and permissions. Another main merge is needed, and it will need
  its own delta review. Per the memory note, merge main **before** the next Opus pass.

### 3. `status.md` commits (`2d58080`, `e04ea52`, `a67b5e3`)

All three are docs-only. They touch `status.md` alone. I found these inaccuracies:

- **The test-pass claims.** `2d58080` and `e04ea52` say all 498 and 499 CI-script tests
  pass. CI's `gate checkers + red probes` failed on the certificate backup test at
  `2d58080`, and it fails again at `a67b5e3`.
- **The explanation of the CI failure.** `a67b5e3` records the failure but attributes the
  doubt to the host (a focused run passing 11/11, and the host's `node` being a Bun shim).
  The failure is real and specific to the OpenSSL version (F1). It is not environmental
  noise.
- **"Current main `9d5deb9`".** `a67b5e3` says this, but it was already stale when written.
  `ecb5b63` (#334) had landed at 02:55Z, eight minutes before `a67b5e3` at 03:03Z.
- **The merge refresh.** `a67b5e3` says "#331 was refreshed onto current main" but does not
  mention that the merge dropped a decision-log entry.
- **The review-coverage claim.** `a67b5e3` calls `e19b75c` "separately reviewed". The
  ordinary-review claims are not verifiable from the repository. It was not Opus-reviewed
  until this note.

`status.md` is orchestrator-owned. The lane agent edited it three more times in this delta.

### 4. CI at `a67b5e3` (latest run of each required check)

| Check | State |
| --- | --- |
| **gate checkers + red probes** | **failure** (F1) |
| **pull request template + security review** | **failure**. The Opus exact-head review is pending. This note may satisfy the review-binding part. The checker also lists the merged main commits (`776999d`, `9d5deb9`, `81d2899`) as post-review commits, and this note does not re-review them. |
| The other 13 required checks: static, unit + component, build, registers, route policy, contract, CI matches ci-cd.md, dependency audit, secret scan, helm, domain coverage, integration, e2e | success |
| `github-advanced-security` (not required) | failure (exit 1 at line 218). CodeQL itself is success. |

### Must happen before merge

1. Fix F1.
2. Merge the current `main`.
3. Get a fresh Opus delta review of both.
4. Get all required checks green at that exact head.
