# PR #610 — image repository deployment compatibility

**Reviewed head:** `c661dbecc9ba5dadc9a2f306cd39176eb1a807cc`

**Comparison base:** `23a01a62ece3ca7d17105626f64ad78641435ec1`.

The complete bounded implementation was reviewed after authoring. Both reviewers were fresh independent contexts that did not author, direct or remediate the source. This note records their actual verdicts; it does not declare the PR merge-ready or the Docker Hub mirror accepted. Later commits restricted to this security-review directory preserve the reviewed source under the repository's note-only descendant rule.

## Independent ordinary review

**Model:** GPT-6 Luna. **Session:** `/root/registry610_luna_review`.

# Independent ordinary review — image repository compatibility

- Reviewer: GPT-6 Luna (fresh independent context)
- Candidate: `c661dbecc9ba5dadc9a2f306cd39176eb1a807cc`
- Base: `23a01a62ece3ca7d17105626f64ad78641435ec1`
- Worktree: `/Users/heinthura/.codex/worktrees/sit-image-repository-compat-20261008`
- Scope: `compose.yml`, deployment/configuration docs and sample env, `scripts/deploy.sh`, focused CI probes.
- Verdict: **PASS — no blocking or non-blocking findings.**

## Review performed

Inspected the exact candidate diff and the applicable repository agent workflow, CI deployment/signing contract, deployment and configuration references, rollback runbook, and deploy-script control flow. Confirmed the custom repository is used consistently for `migrate`, `taskdesk`, tag resolution, digest verification, and subsequent Compose pulls; the default stays `ghcr.io/thomasheinthura/taskdesk`. The image remains pinned to the resolved or supplied full lowercase SHA-256 digest before pull. The existing exact cosign OIDC issuer, release workflow identity, and `tag` annotation are unchanged and still apply. A signature failure exits before pull, with no silent fallback. Repository, tag, digest, rollback digest, and registry port validation reject malformed values before image resolution; the focused test exercises injection-like repository input.

## Checks actually run

- `node --test scripts/ci/deploy-image-repository.test.mjs` — **4/4 passed**. Covered default repository in both services, custom repository plus tag/digest in both services, verifier/pull repository agreement and signature-failure fail-closed behavior, and malformed repository/tag/digest rejection before resolution.
- `pnpm check:env` — **passed**; 40 environment reads attributable to `configuration-reference.md`.
- `git diff --check 23a01a62ece3ca7d17105626f64ad78641435ec1..c661dbecc9ba5dadc9a2f306cd39176eb1a807cc` — passed.
- Review checkout remained at the exact candidate SHA and clean; no source edits were made.

## Limits

No Docker daemon/container boot, live registry access, or credentialed signature verification was performed. The probe suite uses command shims to verify invocation arguments and fail-closed ordering. The required independent GPT-6 Sol security review remains outstanding for this security-scope candidate; this report is only the bounded ordinary review.

## Additional independent security review

**Model:** GPT-6 Sol. **Session:** `/root/registry610_sol_security`.

# Independent GPT-6 Sol security review — PR #610

- **Exact candidate:** `c661dbecc9ba5dadc9a2f306cd39176eb1a807cc` against `23a01a62ece3ca7d17105626f64ad78641435ec1`.
- **Reviewer independence:** Fresh GPT-6 Sol context. I did not author, direct, or remediate this candidate. I made no source edits or deployment changes.
- **Risk tier:** Full security review. `scripts/deploy.sh` is a security-scope path and this change makes the image repository a configurable input to digest resolution, signature verification, and deployment.
- **Verdict:** **PASS — no blocking or non-blocking security findings at this exact SHA.** This is review evidence, not deployment, publication, CI, or merge approval.

## What I checked

I inspected the exact diff in `compose.yml`, `deploy/.env.example`, deployment/configuration documentation, `scripts/deploy.sh`, and the focused probes. I traced `local`, `production`, `upgrade`, and `rollback` through `validate_image_inputs`, `image_ref`, `resolve_and_verify_image`, `verify_signature`, and Compose. Both `migrate` and `taskdesk` interpolate the same repository and exported digest. The deploy script resolves a tag from that repository, checks the full lowercase SHA-256 digest, verifies `repository@digest`, and only then pulls. Rollback verifies the requested digest and signed tag before persisting them in `.env` and pulling. A failed cosign command aborts before pull; there is no implicit signature fallback. The existing explicit `--no-verify` operator override is unchanged and was not used in this review.

I compared the verifier's exact OIDC issuer (`https://token.actions.githubusercontent.com`), workflow identity (`https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main`), and `tag` annotation with `.github/workflows/release.yml` signing and post-publish verification. The repository override changes the referrer lookup target; it does not accept an unsigned copied manifest or weaken certificate/annotation matching. A mirror must carry a verifiable signature for that exact digest and signed tag. The release workflow signs the canonical GHCR image; mirror viability remains an external operational prerequisite, not a claim demonstrated by this review.

I checked the repository, port, tag, digest, and rollback-argument regexes against shell metacharacters, whitespace, uppercase digest, malformed ports, and ambiguous reference forms. Image refs and validation inputs are passed as quoted arguments to Docker and cosign, and the optional registry port is range checked. The shell sources the operator-owned `.env` before validation, as it already did before this change; this review treats that file as the trusted deployment configuration, not as an untrusted input parser. The new variable is registered in `configuration-reference.md`, and an unset or empty value retains the previous GHCR default.

## Checks run

- `node --test scripts/ci/deploy-image-repository.test.mjs`: **4/4 passed**. Includes default/custom Compose refs, verifier arguments and signature-failure no-pull behavior, and malformed input rejection before resolution.
- `bash -n scripts/deploy.sh`: passed.
- `pnpm check:env`: passed; 40 environment reads attributed to the configuration reference.
- `git diff --check 23a01a62ece3ca7d17105626f64ad78641435ec1..c661dbecc9ba5dadc9a2f306cd39176eb1a807cc`: passed.
- `gh pr view 610 --json headRefOid,baseRefOid,state,reviewDecision,statusCheckRollup`: confirmed the open PR head and base matched the review SHAs at review time. Required GitHub checks were not all green at that snapshot; the PR security-review check was failing pending this evidence.

## Limits

No live registry, Docker daemon, actual mirror signature, container boot, or deployment was exercised. The focused test uses Docker/cosign command shims; it establishes argument selection and fail-closed ordering, not that the Docker Hub mirror presently preserves GHCR's signature referrers. This verdict is limited to the source candidate at the SHA above; any source change requires exact-head review discipline.

## Operational acceptance boundary

The mirror must preserve the exact accepted image digest and verifiable signatures/provenance. No unsigned fallback is authorized. Actual registry mirror verification, integrated exact-head CI, protected merge and SIT deployment remain separate root-owned work. This source correction is held outside the frozen P0 product and may be composed only through the protected flow. No stage is claimed closed.
