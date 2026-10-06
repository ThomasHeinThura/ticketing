# P2 approval continuity and withdrawal — source review record

**Reviewed head:** `d5b2842ece9263bd3ffe6719be445092d9947ddc`

This is a source-bound review record for the isolated P2 checkpoint. It does not claim full integration CI, live browser/API acceptance, protected merge, provider acceptance or P2 completion. The original product source is unchanged by this review-only descendant.

## Independent review lineage

Three fresh independent Luna contexts reviewed the complete thirteen-file API/frontend batch at `7ba6fa25fe89448fd2c38334a4f6509b26591742` against `f4789aefd3c3d08595642414dda63770d8973f64`. All ordinary verdicts were clear in their recorded scopes. The independent full Sol pass found B1: an authorized withdrawal retry against a terminal approval returned403 rather than the documented409. Its original blocked verdict remains unchanged.

The six-file structural remediation separates actor authorization from pending actionability. DTO `canWithdraw` remains false for terminal states; unauthorized callers receive403 without state disclosure, while the locked service returns409 for authorized terminal retries. A strong independent Luna delta and full independent Sol security delta clear exact `d5b2842ece9263bd3ffe6719be445092d9947ddc`. Neither reviewer authored or remediated the source.

## Actual proof and residuals

The author and independent reviewers separately passed the updated isolated PostgreSQL lifecycle test (one file/one comprehensive test), including all four terminal states and requester/session-admin/scoped-admin-key versus unauthorized/narrow-key outcomes, state/effect preservation and no terminal-state disclosure. Independent delta reviewers passed the domain suite (one file/79 tests). Ordinary UI review passed three files/16 tests, types, OpenAPI230 operations and both web builds. Exact commands/counts remain in the unchanged reports.

The actual built-UI browser journey uses mocked API routes; no live browser/API integration is inferred. Two ordinary reviewers' local database authentication failures happened before assertions and are not test passes. One generic contract run found four inherited pending-action `user_deactivation` differences versus origin/main; that integration residual is not waived or cleared by this source review. The pretransaction authority-fact TOCTOU remains documented, with no serializable claim. Approver-picker/new-request semantics remain outside this completed existing-request slice. P0 closure is independent.

## Original artifacts

- [p2-7ba6fa25-luna-a.md](586-p2-7ba6fa25-luna-a.md) — original reviewer bytes, SHA256 `4e5fc9e4cfaba7212c1c61f91a72f2056153185adcb8e9f913d59fdcc6ef9930`.
- [p2-7ba6fa25-luna-b.md](586-p2-7ba6fa25-luna-b.md) — original reviewer bytes, SHA256 `1a78cd751cdf5e049de24ada19255e816c05df9bc2b189fee596861af8f06a69`.
- [p2-7ba6fa25-luna-c.md](586-p2-7ba6fa25-luna-c.md) — original reviewer bytes, SHA256 `35d5ff95a0a2a79a9174a3eaa744e42784460e2a086a700d1e7dd3d56d963e50`.
- [p2-7ba6fa25-sol-security.md](586-p2-7ba6fa25-sol-security.md) — original reviewer bytes, SHA256 `4e2b45ace60d506e9da007998e56f192f2a95ab559dfc45a088c451b22abd390`.
- [p2-d5b2842e-luna-delta.md](586-p2-d5b2842e-luna-delta.md) — original reviewer bytes, SHA256 `8fdf8cc5a669cdc30ad48269037af9ad8c4827c5718e656b7d5276e89f7dfc90`.
- [p2-d5b2842e-sol-security-delta.md](586-p2-d5b2842e-sol-security-delta.md) — original reviewer bytes, SHA256 `d8e6be3083542d700d7c07ef2667cc73b9e9add0a070bfeb2ae4320262e1c301`.
