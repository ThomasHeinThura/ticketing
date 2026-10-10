# deploy.sh / release.yml digest parse — review record

**Reviewed head:** `ab38fd63ffdbbb255bf5fab830180152f21d0144`

## The defect

Found by the post-merge installer proof of `v2.0.0-alpha.1`: a real Ubuntu 24.04 VM, docker 29.9.0, buildx v0.38.0.

- buildx v0.38 pads the line as `Digest:    sha256:…`.
- `scripts/deploy.sh` parsed it with `sed -n 's/^Digest: //p'`, so the strict digest check failed and every production install or upgrade aborted. Classified as a product defect.
- `.github/workflows/release.yml` had the same parse in its re-run immutability check.

## The fix

Both sites now use `awk '/^Digest:/ { if ($1 == "Digest:" && NF == 2) print $2; exit }'`.

- The strict regex, cosign identity/issuer/tag verification of `name@digest`, and release signing are unchanged.
- Implementation: Claude Sonnet context `a4639e85be7e33451`, directed by the Claude Opus conductor.
- Ordinary review: Claude Sonnet context `a9a25fc9411123f55`.
- Security review: Claude Opus context `a0a19c5daaf5002ff`, Sol tier under Thomas's routing. It is **not** a GPT-6 Sol review.

Each report below was written by its reviewer context to its own file and is inserted unmodified between the markers, with its SHA-256.

<!-- BEGIN REPORT (agent a9a25fc9411123f55; model claude-sonnet-5-5; role ordinary review; candidate 5807bda6b41c7da9517bd3e9d9aa6f8137cc553c; sha256 dbd3a90f6b181e66269c4b9bca0d0d7a75a5754ca87fa61b6f49a08781c0f3fe) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet review context, session 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (did not author or direct the change)
Reviewed head: 5807bda6b41c7da9517bd3e9d9aa6f8137cc553c (confirmed HEAD of /private/tmp/claude-501/fix-deploy-digest, branch claude/fix-deploy-digest-parse, parent b64f8062)
Verdict: APPROVE (no blocking findings). Two non-blocking items; one is a sibling parse site worth a follow-up.

## Findings

BLOCKING: none.

NON-BLOCKING
1. .github/workflows/release.yml:387 still uses the identical fragile parse `sed -n 's/^Digest: //p' <<< "$inspect_output" | head -n 1`. On a runner whose buildx pads the value (v0.38 behaviour) `existing_digest` keeps leading spaces. Effect there is not an abort of install: the `== "$DIGEST"` compare fails, so a retried publish of an already-published, correct immutable tag (v*/sha-*) hits the "already points at <digest>, not <digest>" error and exits 1. It fails closed (no wrong image pinned), but breaks idempotent re-runs of the publish job. The author's assessment of other parse sites should be confirmed as "deploy.sh only fixed; release.yml:387 same defect class, unfixed". Recommend a follow-up PR using the same awk. This workflow is under the security-scope path list (CI/gate machinery), so it needs its own Sol review; leaving it out of this PR is reasonable. release.yml:128/386 `inspect` calls only test success/failure and are unaffected; release.yml:182 uses `--raw` JSON and is unaffected. docs/05-operations/runbook.md:232 only mentions the command.
2. scripts/ci/install.test.mjs (new tests) do not exercise the index-vs-manifest selection. The fake emits one line only. Mutation: replacing the awk with `awk '/Digest:/ { print $NF }' | tail -n 1` (unanchored, last match) passes all 29 tests. So the property "pins the top-level index digest, never a nested one" is correct by construction but not locked by a test. Suggest adding a FAKE_DIGEST_LINE case with a full multi-manifest output (top Digest, then indented `Name: ...@sha256:<other>` / `Digest:` lines) and asserting cosign is called with the top digest.

## Check results
1. Parse correctness. Real buildx v0.38 structure (from F1 evidence F1-digest-parse-failure.txt, viewed with cat -vet): top-level `Name:`, `MediaType:`, `Digest:    sha256:...` at column 0, a blank-ish line, `Manifests:`, then nested entries that are indented two spaces (`  Name:        <ref>@sha256:<platform digest>`, etc.). The per-platform digest appears inside the nested `Name:` ref (and, in some versions, as an indented `Digest:` line), never at column 0. The awk `/^Digest:/ && $1 == "Digest:" { print $2; exit }` requires column-0 `Digest:`, so indented nested lines cannot match, and `exit` takes the first (top-level, index) one, which is the one cosign signed. Manual run on synthetic output (top Digest, nested `  Name: y@sha256:bb`, nested `  Digest: sha256:cc`) printed the top digest. Tab separator works; CRLF leaves `\r` in $2, which fails the strict regex (fail closed). `$1 == "Digest:"` also rejects `Digested:`-like prefixes. macOS awk 20200816 tested; POSIX constructs only, so mawk/gawk behave the same. Caveat: if a future buildx printed the nested digest at column 0 before the top one, this would mis-pick, but that is not the real shape.
2. Validation unweakened. Diff touches only the extraction line; the strict `^sha256:[0-9a-f]{64}$` check (deploy.sh:~324), cosign verify and tag annotation lines are unchanged (diff shows no other hunk). Extra whitespace is consumed only by awk field splitting, so nothing sloppy reaches the regex; empty/truncated/uppercase/non-sha256 values still die with the same message (tested).
3. Tests. `node --test scripts/ci/install.test.mjs` (node_modules symlinked from main checkout, removed afterwards; worktree clean): 29 tests, 29 pass, 0 fail. Mutation 1 (restore old `sed -n 's/^Digest: //p'`): 3 of the new tests fail (padded, tab, mixed), legacy single-space passes, so the positive tests are non-vacuous for the reported defect. Mutation 2: see non-blocking item 2 (survives). Negative tests assert nonzero exit, the strict-check message, and that cosign was never invoked with the repo digest or `verify`; the new log-read is guarded with try/catch so a missing log is handled. Fixture change `printf '%b\n' "${FAKE_DIGEST_LINE:-Digest: $FAKE_RESOLVED_DIGEST}"` is backward compatible for existing tests (all still pass).
4. Other parse sites. See non-blocking item 1; only release.yml:387 is the same class.

## Not checked
No real docker/buildx/cosign run, no Ubuntu VM; no image build/boot; did not run the full repo suite, only scripts/ci/install.test.mjs. Did not review the release.yml workflow beyond the parse sites. Older buildx versions' output shapes were not verified beyond the one captured evidence file (which is truncated after the first nested manifest).
<!-- END REPORT a9a25fc9411123f55 5807bda6 -->

<!-- BEGIN REPORT (agent a0a19c5daaf5002ff; model claude-opus-5-5; role Sol-tier security review; candidate 5807bda6b41c7da9517bd3e9d9aa6f8137cc553c; sha256 75a0c07188d8ec9e662a63100364dffa3893d278436a8945e97efffb08e50817) -->
Reviewer model: Claude Opus (claude-opus-5-5)
Reviewer context ID: claude-agent:a0a19c5daaf5002ff
**Reviewed head:** 5807bda6b41c7da9517bd3e9d9aa6f8137cc553c

**Verdict: PASS — no blocking findings.** Sol-tier security review, performed by a fresh Claude Opus context routed to the Sol tier. This is not GPT-6 Sol. The reviewer did not author, direct or remediate the candidate.

- Branch: `claude/fix-deploy-digest-parse`
- Base: main `b64f8062`
- Diff: `git diff b64f8062..5807bda6` changes `scripts/deploy.sh` (+4/-1) and `scripts/ci/install.test.mjs` (+58/-1)

## Review hygiene note

While this review was running, the shared worktree `/private/tmp/claude-501/fix-deploy-digest` had an **uncommitted** change. It put the old `sed -n 's/^Digest: //p'` line back at `scripts/deploy.sh:322`, and it most likely came from another reviewer's in-place mutation. It had cleared by the end of the review (`git status` clean).

To avoid that interference, every test and mutation below ran against a clean `git archive 5807bda6…` export in the scratchpad, not against the shared worktree. The verdict is about the committed SHA only.

## Surfaces examined

- `scripts/deploy.sh:270-284`: `image_ref`
- `scripts/deploy.sh:286-307`: `verify_signature`, which checks the cosign issuer and identity and the `tag=` annotation
- `scripts/deploy.sh:309-329`: `resolve_and_verify_image`, the changed site
- `scripts/deploy.sh:47-48`: `COSIGN_ISSUER` and `COSIGN_IDENTITY`. Neither changed.
- `scripts/deploy.sh:72-77, 133, 475`: other parsing sites
- `.github/workflows/release.yml`
  - `:128`: unused-tag probe
  - `:182-186`: `--raw` index parse
  - `:313-326`: `cosign sign "${IMAGE}@${DIGEST}"` with tag and source_sha annotations
  - `:386-399`: idempotent tag publish
  - `:402-417`: post-sign verify
- `scripts/ci/install.test.mjs`: the fake docker shim (`FAKE_DIGEST_LINE`), 4 positive and 5 negative digest tests
- Evidence
  - `/Users/heinthura/.codex/taskdesk-evidence/2026-10-10/p0-installer-proof-20261010T024034Z/F1-digest-parse-failure.txt`. It shows real buildx v0.38.0 output: a top-level `Digest:    sha256:3df2…` under `MediaType: application/vnd.oci.image.index.v1+json`, with child manifests indented under `Manifests:`.
  - `U-installer-fresh-failure.log`. It shows `TASKDESK_IMAGE_DIGEST=` empty.

## Adversarial analysis

### 1. Supply-chain integrity: can the awk pick a different digest?

New extractor: `awk '/^Digest:/ && $1 == "Digest:" { print $2; exit }'`

- **Per-platform and attestation manifests.** In buildx human output these are indented two or more spaces under `Manifests:`. Their digests appear as `Name: …@sha256:…` or as an indented `vnd.docker.reference.digest:` annotation. The `^Digest:` anchor never matches an indented line. Probed with a realistic multi-platform output that included an attestation manifest. Result: the top-level index digest A was selected.
- **A second or injected `Digest:` line.** The top-level `Name`/`MediaType`/`Digest` block is printed before `Manifests:` and `Annotations:`. `exit` on the first match therefore pins the index digest. Anything a hostile registry or annotation value could inject (for example, an annotation value with an embedded newline) comes **after** it and is never reached.
  - Probed `Digest: A … Digest: B` (injected after): A was selected.
  - Probed an indented ` Digest: B` before the real line: ignored, and A was selected.
  - The only text before the top-level Digest is `Name`, which is our own `$tag_ref`, and `MediaType`.
  - `exit` on first match is the right choice. It keeps the old `head -n 1` semantics.
- **Laxness compared with the old sed.**
  - `$2` takes the first whitespace field. `Digest:    <A> extra` now gives `<A>`, where the old sed gave `<A> extra`, which then failed the regex. This value is the registry's own authoritative field, and the result is still bound by cosign. It is not exploitable. NON-BLOCKING (N2).
  - `Digest:<A>` with no space gives empty and fails closed.
  - `Digest: Digest: <A>` gives `Digest:` and fails closed.
  - CRLF gives `<A>\r`. The regex rejects it (verified with `od -c`).
- **Fail-closed binding.** The regex `^sha256:[0-9a-f]{64}$` is unchanged (`deploy.sh:324`). The digest is exported and passed as `verify_signature "${IMAGE_REPOSITORY}@${digest}"` (`:328`), so cosign verifies `name@digest` against the pinned issuer and identity plus `tag=${TASKDESK_IMAGE_TAG}`. `release.yml:322-325` signs exactly `${IMAGE}@${DIGEST}`, the build's index digest. It does not sign recursively, so child or attestation manifests carry no signature for this identity. If a wrong digest were somehow selected, cosign verify would fail and the script would `die` before any pull. Compose receives the same exported digest.
- **`--format '{{.Manifest.Digest}}'`.** `docker buildx imagetools inspect --help` (local buildx v0.37.2) lists `--format string  Format the output using the given Go template`. `.Manifest.Digest` is the documented template field for the root descriptor. It would remove the dependence on human-readable layout, so it is marginally more robust. It is not materially safer, because the security property comes from the regex plus the cosign digest binding, not from the parser. I could not confirm the template live: GHCR TLS failed inside the sandbox with `x509: OSStatus -26276`. Optional hardening only. NON-BLOCKING (N3).

### 2. Verification is unchanged

`git diff b64f8062..HEAD -- scripts/deploy.sh` touches only lines 319-322: the comment and the extractor line. The strict regex (`:324-325`), `TASKDESK_IMAGE_DIGEST` export, `verify_signature` call, `COSIGN_ISSUER`, `COSIGN_IDENTITY` and `--annotations "tag=${tag}"` are byte-identical to base. The `TASKDESK_IMAGE_DIGEST`-preset path (rollback/repeat) is unaffected.

### 3. The tests are non-vacuous

- Full suite on the clean export at HEAD: `node --test scripts/ci/install.test.mjs` gives **29 tests, 29 pass, 0 fail** (node v26.10.0, node_modules symlinked and not committed).
- Mutations on temp copies:

| Mutant | Result |
| --- | --- |
| Revert extractor to `sed -n 's/^Digest: //p' \| head -n 1` | **3 fail** (padded, tab, mixed). Legacy single-space still passes, as expected. |
| Neutralise the regex (`[[ -n x \|\| -z x ]]`) | **4–5 negative tests fail.** Missing, truncated, uppercase and non-sha256 are shown; the output was truncated by `head`. |
| Loosen the regex to `^sha256:` | **2 fail** (truncated, uppercase). The md5 and empty cases are still rejected by the remaining prefix, which is correct. |
| `verify_signature "$(image_ref)"` | Survived. It is an **equivalent mutant**: `image_ref` returns `repo@$TASKDESK_IMAGE_DIGEST` once the digest is exported. |
| `verify_signature "repo:${TAG}"` (unbinds cosign from the digest) | **5 fail** (4 new positive tests and the existing repeat-install test). The new positive tests therefore assert the cosign `name@digest` binding. |

The negative tests also assert that cosign was never invoked with `taskdesk@` or `verify`, so "fails before verification" is checked, not assumed.

### 4. Other parsing sites of the same defect class

- **`.github/workflows/release.yml:387`**: `existing_digest="$(sed -n 's/^Digest: //p' <<< "$inspect_output" | head -n 1)"`. This is the same fixed-prefix parse in the immutable-tag idempotency check. The runner's buildx version is not pinned there, only the buildkit driver image at `:157`. With padded output, `existing_digest` comes out empty, so a re-run of an already-published tag fails with `immutable image tag … already points at , not <DIGEST>`. That **fails closed**: no wrong tag is moved and no unsigned digest is accepted. So it is a reliability defect, not a security bypass. Outside this diff. NON-BLOCKING (N1). It should be fixed the same way, or with `--format '{{.Manifest.Digest}}'`, in a follow-up.
- `release.yml:128` only tests whether inspect succeeds. Not affected.
- `release.yml:182-186` parses `--raw` JSON. Not affected.
- `deploy.sh:133` (`.env` `NAME=` sed) and `deploy.sh:475` (`docker inspect --format`) are a different class. Not affected.

## Findings

- **BLOCKING:** none.
- **NON-BLOCKING:**
  - **N1**: `.github/workflows/release.yml:387`. The same `^Digest: ` fixed-prefix parse remains in the release idempotency check. It fails closed (spurious "already points at ," error on a re-run under padded buildx). Recommend a follow-up issue.
  - **N2**: `scripts/deploy.sh:322`. `$2` drops trailing fields on the top-level Digest line, where the old sed rejected them. This is benign because the regex and the cosign `name@digest` binding decide. It could be tightened with `NF == 2`.
  - **N3**: `scripts/deploy.sh:317-322`. Optional hardening: `--format '{{.Manifest.Digest}}'` removes the dependence on human-readable layout. The flag is supported (buildx v0.37.2 help). The template output was not verified live.

## Residual risk

- buildx could change its human format again, for example by renaming or indenting the top-level `Digest:`. The current code fails closed in that case (empty digest, regex `die`). The risk is availability only, not integrity.
- The security property still depends on cosign identity, issuer and tag-annotation verification, which this diff does not change.

## Not checked

- I did not run a live `imagetools inspect` against GHCR or the `--format` template: the sandbox blocked TLS.
- I did not run the fix in an Ubuntu VM. That is for the orchestrator's re-proof against the evidence run.
- I did not run the ordinary-review suite beyond `scripts/ci/install.test.mjs`. I did not check the CI status on the PR.
- I did not test busybox or gawk awk variants. The extractor uses only POSIX awk features: default FS, `$1`/`$2`, `exit`. It was exercised with BSD awk 20200816.
<!-- END REPORT a0a19c5daaf5002ff 5807bda6 -->

<!-- BEGIN REPORT (agent a9a25fc9411123f55; model claude-sonnet-5-5; role ordinary closure; candidate e2c00a939eeba29849efe17ce6233d3ad0783caa; sha256 d8fa1b770a43f460eca61faad5e38c417e0e637c350be34ff880ffc5b6d3c73f) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet review context, session 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (same reviewer as the prior round; did not author or edit the change)
Reviewed head: e2c00a939eeba29849efe17ce6233d3ad0783caa (diff 5807bda6..e2c00a93)
Verdict: BOTH PRIOR NON-BLOCKING FINDINGS CLOSED. No blocking findings. One new non-blocking note.

Method: `git archive e2c00a93` exported to a temp dir ($TMPDIR/exp), node_modules symlinked there only; all tests and mutations ran on that export. The shared worktree was not touched (read-only `git diff` only).

## Closure
1. release.yml:387 (was sed with fixed `Digest: ` prefix): now `awk '/^Digest:/ && $1 == "Digest:" && NF == 2 { print $2; exit }'` (release.yml:388). Same parse as deploy.sh, so padded buildx output no longer defeats the immutable-tag equality check. CLOSED. Manual run on padded/nested sample returned the top-level digest.
2. Nested-digest test gap: new multi-manifest fixture (top-level index Digest at col 0, two indented per-platform Name/Digest blocks) plus a "later injected Digest line" case; assertions require cosign to be called with the INDEX digest and never with the platform/attestation digests (or the injected one). CLOSED. Mutation proof below.

## Test run
`node --test scripts/ci/install.test.mjs` on clean export: 33 pass, 0 fail.

## Mutations (on temp export, each restored before the next)
- M1 deploy.sh unanchored last-match awk (the previously surviving mutant): 2 fail (multi-manifest, injected-line). Killed.
- M2 deploy.sh drop `exit`: 1 fail (injected-line). Killed.
- M3 deploy.sh drop `NF == 2`: 1 fail (trailing-junk refusal). Killed.
- M4 release.yml reverted to legacy sed: 1 fail (release workflow parse test). Killed.
- M5 release.yml drop `NF == 2`: 1 fail (same test). Killed.

## Validation unweakened
deploy.sh change only adds `NF == 2` (stricter: a Digest line with extra tokens now yields empty, which fails the strict `^sha256:[0-9a-f]{64}$` check; tested via "trailing junk"). Regex, cosign verify and tag annotation untouched. Padded, tab and mixed-whitespace forms still pass.

## New NON-BLOCKING note
- scripts/ci/install.test.mjs (release workflow test): it pins the release.yml awk by source-text regex only, not behaviour; the awk is identical to the behaviourally tested deploy.sh one, so risk is low. A cosmetic edit to the awk text will require updating the regex. Acceptable.
- Minor: `NF == 2` means a malformed first `Digest:` line (extra tokens) is skipped and a later well-formed column-0 Digest line would be used. Real buildx has no such second column-0 line, and any result still passes the strict regex; the release.yml path additionally compares against the signed $DIGEST. No action needed.

## Not checked
Real docker/buildx/cosign or a CI run of release.yml; release.yml is security-scope CI machinery, so its required GPT-6 Sol review is separate and not covered here.
<!-- END REPORT a9a25fc9411123f55 e2c00a93 -->

<!-- BEGIN REPORT (agent a9a25fc9411123f55; model claude-sonnet-5-5; role ordinary closure 2; candidate ab38fd63ffdbbb255bf5fab830180152f21d0144; sha256 54709c27765cca0f2acea675cb8d428b18e0e802fa1dec090a222da133024f4c) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent Sonnet review context, session 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (same reviewer as prior rounds; did not author or edit the change)
Reviewed head: ab38fd63ffdbbb255bf5fab830180152f21d0144 (diff e2c00a93..ab38fd63)
Verdict: APPROVE. Delta is correct, strictly fail-closed, and well covered. No blocking or new non-blocking findings.

Method: `git archive ab38fd63` to a temp dir, node_modules symlinked there only; all tests and mutations ran on the export (removed afterwards). Shared worktree untouched.

## Delta
deploy.sh:322 and release.yml:388 awk changed from
  `/^Digest:/ && $1 == "Digest:" && NF == 2 { print $2; exit }`
to
  `/^Digest:/ { if ($1 == "Digest:" && NF == 2) print $2; exit }`.
The first column-0 `Digest:`-prefixed line now always terminates the scan; if it is malformed (extra tokens, empty value, `Digested:` style) nothing is printed, so the strict `^sha256:[0-9a-f]{64}$` check (unchanged) fails closed. This closes the previous round's note that a malformed first line was skipped in favour of a later one. Manual run: malformed-first then valid-second prints nothing; well-formed line prints the digest. Indented nested Digest lines still never match (column-0 anchor). Index-digest selection is unchanged.

## Tests
`node --test scripts/ci/install.test.mjs` on clean export: 36 pass, 0 fail.
New cases: indented Digest line placed before the top-level one (must still pin the index digest); malformed first line then valid line (refused); empty first `Digest:` then valid line (refused). Release workflow source-pin regex updated to the new awk.

## Mutations (temp export, restored between)
- M1 revert to e2c00a93 awk form: 2 fail (malformed-first, empty-first). Killed.
- M2 unanchored `/Digest:/` regex: 1 fail (indented-before-top-level). Killed.
- M3 drop `exit` (print every well-formed, head -n 1): 2 fail (malformed-first, empty-first). Killed.
- M4 release.yml drop `NF == 2`: 1 fail (release workflow pin test). Killed.

## Residual notes (informational, not findings)
The release.yml test remains a source-text pin rather than behavioural; its awk is identical to the behaviourally tested deploy.sh one. release.yml is security-scope CI machinery, so the separate GPT-6 Sol review is still required and not covered here.

## Not checked
Real docker/buildx/cosign, CI run of release.yml, full repo suite (only install.test.mjs).
<!-- END REPORT a9a25fc9411123f55 ab38fd63 -->

<!-- BEGIN REPORT (agent a0a19c5daaf5002ff; model claude-opus-5-5; role Sol-tier security closures 1 and 2; candidate ab38fd63ffdbbb255bf5fab830180152f21d0144; sha256 a7d4739c02212c1337a7bf88be394d2a8c9d0912e2e4805503dfb96f092c6fc0) -->
Reviewer model: Claude Opus (claude-opus-5-5)
Reviewer context ID: claude-agent:a0a19c5daaf5002ff
**Reviewed head:** e2c00a939eeba29849efe17ce6233d3ad0783caa

**Verdict: PASS — N1, N2 and N3 are resolved, nothing regressed, and nothing blocks.**

This is a Sol-tier closure pass by a fresh Claude Opus context routed to the Sol tier. It is not GPT-6 Sol. It covers `scripts/deploy.sh` and the CI-machinery change in `.github/workflows/release.yml`. I did not author, direct or remediate this change.

The fix adds `NF == 2`. That creates one new non-blocking edge case (N4, below). It is not exploitable, but I recommend tightening it.

- Diff reviewed: `git diff 5807bda6..e2c00a93`. It touches `.github/workflows/release.yml` (+2/-1), `scripts/deploy.sh` (+1/-1) and `scripts/ci/install.test.mjs` (+56).
- Prior review: `deploy-digest-security-review-opus.md`, at `5807bda6b41c7da9517bd3e9d9aa6f8137cc553c`.
- Method: the worktree is shared, so all tests and mutations ran against a clean `git archive e2c00a93…` export in the scratchpad.

## Closure of earlier findings

| ID | Status | Evidence |
| --- | --- | --- |
| N1 `release.yml:387` legacy sed | **Closed** | Replaced with `awk '/^Digest:/ && $1 == "Digest:" && NF == 2 { print $2; exit }' <<< "$inspect_output"`. A static test guards it: reverting to sed fails the test, and dropping `NF == 2` fails it too. |
| N2 trailing fields accepted | **Closed** | `NF == 2` added at `deploy.sh:322`. The new negative test "a digest with trailing junk" fails when `NF == 2` is removed. |
| N3 `--format` hardening | **Not adopted.** Acceptable: it was optional. | The parser stays layout-dependent but fails closed. |

## Regression check

- **Verification is unchanged.** `git diff b64f8062..e2c00a93 -- scripts/deploy.sh` changes only the extractor line and its comment. The strict regex, the digest export, the `verify_signature "${IMAGE_REPOSITORY}@${digest}"` call, the cosign issuer and identity, and the `tag=` annotation are byte-identical to base.
- **release.yml.** The only change is line 387 plus a comment.
  - Shell behaviour is unchanged: `set -Eeuo pipefail` holds, and awk exits 0 when nothing matches.
  - An empty or mismatched `existing_digest` still gives `::error:: … exit 1`, so it fails closed.
  - Permissions, signing, the attest step and post-sign verify are untouched.
  - The `2>&1` merge was already there. buildx stderr does not begin with `Digest:`.
- **Full suite** (`node --test scripts/ci/install.test.mjs`, node v26.10.0): **33 tests, 33 pass, 0 fail.** That is 29 previous tests plus 2 multi-manifest/injection tests, 1 static release.yml test and 1 trailing-junk test.

## Mutation results (temp copies of e2c00a93)

| Mutant | Result |
| --- | --- |
| Drop `NF == 2` in deploy.sh | Killed: trailing-junk test fails |
| Drop `exit` in deploy.sh | Killed: injected-Digest test fails |
| Take the last `Digest:` (`END { print d }`) | Killed: injected-Digest test fails |
| Drop the `/^Digest:/` anchor | **Survives.** Awk's `$1` strips leading blanks, so indented child `Digest:` lines would match. They still come after the top-level line, though, so `exit` keeps the index digest. The mutant behaves the same as the original on real buildx output. Non-blocking (N5). |
| release.yml back to legacy sed | Killed: static test fails |
| release.yml drop `NF == 2` | Killed: static test fails |

## New findings

- **N4 (NON-BLOCKING): `scripts/deploy.sh:322` and `.github/workflows/release.yml:388`.**
  - **What changed.** Before, `exit` fired on the first `Digest:` line. Now `NF == 2` sits inside the match condition, so the parser skips a malformed top-level `Digest:` line and keeps scanning for a later well-formed one.
  - **Reproduced.** Input `Digest:    <A> extra` … `Digest: <B>` returns **B**. Input `Digest:` (empty) … `Digest: <B>` also returns **B**. Before this commit, both cases failed closed.
  - **Not exploitable in deploy.sh.** Only the response itself can produce this. Whoever controls the response could already put B on the top line. B must still pass cosign `name@digest` verification with the pinned identity and the `tag=` annotation.
  - **Impact in release.yml.** In the same adversarial-output case, a false `existing_digest == DIGEST` would make the tag publish `continue` without moving the tag. That is a false "already published" message, not an integrity bypass.
  - **Fix.** Exit on the first top-level `Digest:` whatever its shape:
    `awk '/^Digest:/ { if ($1 == "Digest:" && NF == 2) print $2; exit }'`
    I checked it: it returns empty (fails closed) for both inputs above and still accepts the single-space, padded and tab forms.
  - **Test to add.** A negative case "malformed top-level Digest followed by a well-formed one" would pin this. The current trailing-junk test covers only a single line.
- **N5 (NON-BLOCKING): test gap.** The `/^Digest:/` anchor is not independently pinned, because realistic fixtures always put the top-level line first. Optional test: an indented `  Digest:` placed *before* the top-level line.

## Residual risk

The integrity guarantee still rests on the strict regex and on cosign verification of `name@digest` with the pinned issuer, identity and `tag=` annotation. That is unchanged and was re-verified. If the buildx format changes again, the parser fails closed: the risk is availability, not integrity.

## Not checked

- A live `imagetools inspect` or `--format` call against GHCR (the sandbox blocked TLS).
- An Ubuntu VM re-proof of the installer.
- An actual run of the release.yml job: I reviewed it statically and ran the awk against synthetic input.
- CI status on the PR.
- Test suites other than `scripts/ci/install.test.mjs`.

---

# Closure 2: N4 and N5

Reviewer model: Claude Opus (claude-opus-5-5)
Reviewer context ID: claude-agent:a0a19c5daaf5002ff
**Reviewed head:** ab38fd63ffdbbb255bf5fab830180152f21d0144

**Verdict: PASS — N4 and N5 are closed. No regressions, no blocking or new findings, and no open items from this review series.**

This is a Sol-tier pass by a fresh Claude Opus context, not GPT-6 Sol. I did not author, direct or remediate this change.

- **Diff:** `git diff e2c00a93..ab38fd63` touches `scripts/deploy.sh` (+1/-1), `.github/workflows/release.yml` (+1/-1) and `scripts/ci/install.test.mjs` (+17/-1).
- **Method:** all tests and mutations ran on a clean `git archive ab38fd63…` export in the scratchpad, not on the shared worktree.

## Closure

| ID | Status | Evidence |
| --- | --- | --- |
| N4: the parser could skip a malformed first line and take a later one | **Closed** | `deploy.sh:322` and `release.yml:388` now both use `awk '/^Digest:/ { if ($1 == "Digest:" && NF == 2) print $2; exit }'`, the form I tested. Exit is now unconditional on the first `^Digest:` line. Two new refusal tests cover the case: "malformed first Digest line followed by a valid one" and "empty first Digest line followed by a valid one". |
| N5: the `/^Digest:/` anchor was not pinned by any test | **Closed** | A new positive test places an indented `  Digest: <A>` before the top-level line and asserts that cosign receives `INDEX_DIGEST` and never A. |

## Tests

`node --test scripts/ci/install.test.mjs` (node v26.10.0) gives **36 tests, 36 pass, 0 fail**. This matches the author's count.

## Mutation results (temp copies of ab38fd63)

Every mutant is killed:

| Mutant | Killed by |
| --- | --- |
| Revert deploy.sh to the e2c00a93 form (`NF == 2` in the match condition) | The 2 new refusal tests |
| Remove the `^Digest:` anchor (`$1 == "Digest:" { … exit }`) | The indented-before test |
| Remove `NF == 2` | Trailing-junk test and malformed-first test |
| Remove `exit` | Both refusal tests and the injected-Digest test |
| Revert release.yml to the e2c00a93 form | Static release.yml test |

## Direct awk probes

| Input | Result |
| --- | --- |
| Single-space, padded or tab-separated value | Digest accepted |
| `Digest:<A>` (no space) | Empty, so the install fails closed |
| `Digest:    <A> extra` followed by `Digest: <A>` | Empty, so the install fails closed |
| Indented child `Digest:` before the top-level line | Top-level digest selected |

## Regression check

Across the whole branch (`b64f8062..ab38fd63`), the non-test changes are exactly two extractor lines and their comments: `deploy.sh:322` and `release.yml:388`. The following are byte-identical to base:

- the strict regex `^sha256:[0-9a-f]{64}$`
- the `TASKDESK_IMAGE_DIGEST` export
- `verify_signature "${IMAGE_REPOSITORY}@${digest}"`
- the cosign issuer, identity and `tag=` annotation
- release signing, attestation and post-sign verify
- the release.yml error path for a mismatched or empty `existing_digest` (it still fails closed)

## Residual risk and not checked

These are unchanged from the earlier sections:

- I made no live GHCR `imagetools inspect` or `--format` call (the sandbox blocked TLS).
- I did not re-run the installer in an Ubuntu VM.
- I did not run the release.yml job itself.
- I did not check CI status on the PR.

If buildx changes its output format again, the parser fails closed: the risk is availability, not integrity.
<!-- END REPORT a0a19c5daaf5002ff ab38fd63 -->

