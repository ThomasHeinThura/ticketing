# PR #511 — P3 identity domain-binding security review

**Model:** GPT-6 Sol
**Reviewer context:** `/root/p3_511_sol_review_b` — fresh independent context; did not author or remediate the candidate
**Verdict:** CLEAR WITH NONBLOCKING RESIDUALS for the domain-only slice
**Reviewed head:** `b62d62391572245452531363f9ce3c9d0fb042fb`
**Base:** `6a93fb3b75f7aa90bcff127ccf545eb5b3ad1670`

Reviewed the complete four-file diff, identity provisioning rules IP-1/2/3/4/9/26/27/29,
the data-model specification, PR scope, and exact-head checks. The normalizer rejects
malformed owner/domain data and duplicate matching bindings, canonicalizes ASCII case,
rejects trailing-dot and Unicode IDN addresses, and checks Entra's tenant-specific `iss`
and `tid` before using the address. `email_verified` is required only when the provider
emits it. Domain ownership does not grant organisation, portal, reach, or role authority.

No production caller of `normaliseEntraClaims` or `domain_bindings` exists in this candidate.
The caller and persistence work are deliberately out of scope. Until a later production
caller loads a complete ownership set from persisted rows with a uniqueness constraint, an
empty or incomplete owner list cannot distinguish an unbound domain from an omitted binding.
That integration is required before IP-9 can be described as operational. No blocking
finding applies to this domain-only helper slice.

Unicode/IDN address domains are currently rejected. Future configuration and lookup paths
must use one canonical domain representation.

I inspected the relevant tests but did not run them. Exact-head GitHub unit/component,
domain-coverage, static, build, and route-policy checks passed at review time. Dependency
audit and pull-request-template checks remained red, and Postgres integration was pending.

## Independent GPT-6 Sol delta review — 2026-10-01

**Model:** GPT-6 Sol
**Reviewer context:** `/root/p3_511_sol_exact` — fresh independent context; did not author,
direct, or remediate this candidate
**Reviewed head:** `108881f0f36f5dabed4838828af90a1dbea4f4ef`
**Comparison base:** prior Sol-reviewed code head
`b62d62391572245452531363f9ce3c9d0fb042fb`; current merge base with `main` is
`1727b69a6c07b6a1276d2b414b43e23c5adbefdf`
**Verdict:** CLEAR WITH NONBLOCKING RESIDUALS for the domain-only slice. No blocking finding.

The independent reviewer inspected every landed commit since the prior reviewed code head,
including the #511 note commits, #519 dependency commits, and merge `108881f0` against both
parents. The merge preserved the identity helper, tests, and security-model changes without
unexpected resolution. The review covered the full identity diff, types and tests,
IP-1/2/3/4/9/26/27/29, the security model, prior #511/#519 Sol notes, the PR evidence,
Nodemailer usage and SMTP options, and dependency manifest, override, and lockfile changes.

At that exact head the reviewer ran frozen `pnpm install`, domain tests (12 files / 570 tests),
domain typecheck, email tests (6 files / 16 tests), email build, Biome on changed identity
files, `git diff --check`, and `pnpm audit --audit-level=high` (zero high/critical, one low,
five moderate). No live SMTP relay, Postgres integration, browser, or container boot was run.
The exact-head PR template check was red because this committed delta note was still absent;
other required checks must be rechecked on the note-only commit.

This remains a pure domain helper. It has no production caller, persisted `domain_bindings`,
database uniqueness constraint, or complete server-side owner lookup. An empty or incomplete
owner array cannot establish ownership; operational IP-9 enforcement requires that later
integration. Unicode/IDN address domains remain rejected, so the future caller must use one
canonical domain representation. Real-Entra acceptance remains outstanding.

Source: [exact-head Sol review comment](https://github.com/ThomasHeinThura/ticketing/pull/511#issuecomment-5917793528).

## GPT-6 Sol G8 ancestry delta — 2026-10-01

**Model:** GPT-6 Sol
**Reviewer context:** `/root/p3_511_sol_exact` — the same independent reviewer context
as the preceding delta pass, not a newly fresh context; it did not author, direct, or
remediate the candidate
**Reviewed head:** `6f16fd0610ec7687cd7f73948b537663adb3dffd`
**Comparison base:** prior reviewed source head
`108881f0f36f5dabed4838828af90a1dbea4f4ef`
**Verdict:** CLEAR WITH NONBLOCKING RESIDUALS for this domain-only slice; no new blocker.

The reviewer inspected the note-only `b0bb19cd` commit, the G8 merge from
`main@8cc4f76dc4a8af23c2cf4a9dc93f9093f7c77569`, and merge head `6f16fd06`
against both parents. The merge introduced no conflict-resolution content; it did not
change the identity helper, its spec, API authentication, permissions, or the PR-template
and security-path checkers compared with the prior reviewed source. G8's source head
was separately Sol-reviewed, and this pass confirmed the exact #511 merge ancestry.

At this exact head the reviewer ran the domain suite (12 files / 570 tests), domain
typecheck, G8 probes (148 / 148), visual scope check (three screenshots covering two
active route-kind rows), and `git diff --check`. GitHub's required G8 and other checks
were green except the PR-template check, which correctly awaited this committed note.

Operational IP-9 remains outside this helper slice: it still lacks a production caller,
persisted bindings, a uniqueness constraint, and a complete owner set. Unicode/IDN
normalization and real-Entra acceptance are also deferred to that integration.

Source: [G8 ancestry Sol review comment](https://github.com/ThomasHeinThura/ticketing/pull/511#issuecomment-5918439160).
