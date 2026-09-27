# Security review queue marker — PR #331 signed releases

**Status: PENDING — OPUS 5.5 DELTA REVIEW. No clearance is claimed.**

The prior independent Opus 5.5 review at `6a956b5b2f563da7babab5351bad36b33900414a` returned
**CHANGES NEEDED** and remains recorded in
[`331-signed-releases.md`](331-signed-releases.md). It is historical evidence only and does
not clear the current remediation candidate.

The current candidate requires a fresh independent Opus review after ordinary review and
required checks complete. The reviewer must inspect the exact candidate head, verify the
remediation to S1/S2 and the follow-up changes to S3–S8, then replace this queue marker with
an actual review record. No `Reviewed head` attestation is included because no reviewer has
reviewed the current head.

The independent ordinary review of `77e116e00357e3dad09b1a5f55a974c9dcf8e5c6` returned
**CHANGES NEEDED** with three release-path blockers: GHCR login occurred after cosign
signing; the default SLSA predicate described the workflow dispatch SHA rather than an
older selected source SHA; and rollback verified a digest using the currently configured
tag instead of the tag signed for that digest. The remediation was confirmed by the next
independent ordinary delta review; this remains ordinary evidence only, not Opus clearance.

The independent ordinary delta review of `22fde4739ce7b970e48b57fcf16a0de314b2302c`
confirmed those three fixes, but found a further usability blocker in the upgrade success
hint: it still printed the full `repository@digest` reference and omitted the now-required
signed release tag. The current unreviewed delta derives the prior running container's tag
and prints a complete rollback command only when both values are known; otherwise it asks
the operator to confirm the tag. No live release/registry rollback has been run.

## Remediation scope recorded for the pending pass

- S1: separate build/scan from signing/publication; pin the privileged QEMU and BuildKit
  images; remove persisted checkout credentials and broad job-level tokens.
- S2: remove the unauthorised decision-log text and record only Thomas's confirmed selected-
  SHA/manual-release choice with alternatives, below `## Format`.
- S3: sign tag/source-SHA annotations, verify the expected tag, and resolve the deployment
  digest once so verification and pull target identical bytes.
- S4–S6: reject retagging a version/SHA tag to a different digest; isolate concurrency groups;
  refuse stale `edge` updates; disable the scanner cache; disable the privileged binfmt cache.
- S7–S8: add operator verification commands, require an exact lowercase 40-character SHA,
  and correct the CI/CD pipeline description.
- Ordinary-review delta: authenticate the signer job with GHCR before cosign; add a signed
  custom predicate binding the artifact digest to the validated selected source commit
  while retaining the SLSA workflow provenance; require the signed tag for rollback and
  persist that tag with its digest.
- Follow-up ordinary-review delta: the post-upgrade hint derives the previous image's
  configured tag from the still-running old container and pairs it with the bare digest.

**Unblocker:** an independent authenticated Opus 5.5 reviewer. Current-session
`claude auth status` reports `loggedIn: false`; another model cannot substitute.
