# Security review — DOMPurify update (#520)

**Reviewed head:** `cf16d9ce59ec55d65f7092d562a6874c73d87bc7`

**Reviewer:** Independent GPT-6 Sol context `/root/dompurify_520_sol_security`.
**Verdict:** CLEAR for security at the reviewed code head; no security blocker found.
**Review record:** https://github.com/ThomasHeinThura/ticketing/pull/520#issuecomment-5920191296

## Scope and evidence

The reviewer compared the candidate with `main` at
`9e3e8860b1b2060bbb11d78629d3ae879fcbb4f1`. The net diff updates only
`apps/web/package.json` and the matching `pnpm-lock.yaml` records for DOMPurify
3.4.13 to 3.4.16. The reviewer verified the lockfile integrity against the
published npm registry value and confirmed that the direct web dependency and
Mermaid resolve to the same version.

The existing Mermaid call uses strict rendering, disables HTML labels, and
sanitizes the SVG string with DOMPurify's SVG and SVG-filter profiles before
placing it in preview `innerHTML`. The reviewer found no `IN_PLACE` use, custom
hook, or global `setConfig` in the repository, and checked the relevant upstream
advisories and 3.4.16 release notes. This dependency update changes no route,
policy, authorization, or CI-gate semantics.

The independent Luna ordinary review of the same code head is recorded at
https://github.com/ThomasHeinThura/ticketing/pull/520#issuecomment-5920171886.
The Sol reviewer inspected the exact-head diff, lock graph and sanitizer call
site; no new local browser reproduction or test/build was run in that review.

## Residuals and merge gate

The existing task-description tests mock Mermaid, so this PR has no direct
Mermaid/SVG sanitizer regression test or browser evidence. The Sol verdict is a
security clearance only. At the time of review, the PR-template/security-review
check was red and other CI checks were pending. The candidate must not merge
until the committed note is linked from the PR body and all required checks are
green at the final head.
