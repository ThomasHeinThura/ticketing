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
