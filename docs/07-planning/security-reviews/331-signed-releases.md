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
