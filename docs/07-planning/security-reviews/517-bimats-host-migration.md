# Security review — PR #517 Bimats product host migration

**Reviewer:** GPT-6 Sol, fresh independent context; did not author or remediate the candidate.
**Reviewed head:** `205d46a43ed7bead356e06dd878116c98586c60e`
**Base:** `4f1eec81c904b91339c71f6fbd2123387e193acf`
**Date:** 2026-09-30
**Verdict:** CLEAR — the prior credential-destination blocker on the predecessor head is fixed.

## Surfaces examined

- `apps/api/src/index.ts` runtime OpenAPI server selection and global bearer-auth declaration.
- `apps/api/scripts/export-openapi.ts` and `tests/api-contract/openapi.json` public export configuration.
- Runtime OpenAPI integration regressions for the unset and explicitly configured `KANEO_API_URL` cases.
- Changed domain references in application, email, chart, package, and documentation files.

## Assessment

When `KANEO_API_URL` is absent or empty, `/api/openapi` now advertises the root-relative
server `/api`. The OpenAPI document is served by the same origin, and its API paths are
relative to that server, so authenticated requests remain on the self-hosted instance.
An explicit `KANEO_API_URL` continues to be normalized and honored. The static exporter
sets the canonical public host `https://taskdesk.bimats.com`, and the checked-in public
contract uses `https://taskdesk.bimats.com/api`; this does not change the self-hosted
runtime default.

The old exact-head candidate advertised the live Bimats host to every self-hosted runtime
with no configured API URL. This would have allowed a generated client or API explorer to
send a self-hosted bearer token to Bimats. The same-origin `/api` default and regression
tests close that path. No authorization, CORS, or credential validation behavior changed.

## Review evidence and residuals

This verdict was based on code inspection and the candidate's regression coverage; the Sol
reviewer did not independently run tests. The canonical host currently returns 404 in live
checks, so public-site deployment and origin routing remain operational acceptance work.
