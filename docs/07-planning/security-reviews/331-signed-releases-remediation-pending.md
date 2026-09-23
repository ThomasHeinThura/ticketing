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

**Unblocker:** an independent authenticated Opus 5.5 reviewer. Current-session
`claude auth status` reports `loggedIn: false`; another model cannot substitute.
