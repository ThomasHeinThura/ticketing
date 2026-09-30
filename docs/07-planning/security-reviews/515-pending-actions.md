# PR #515 — pending-action persistence security review

**Reviewer:** GPT-6 Sol, fresh independent context; did not author, direct, or remediate the candidate.
**Reviewed head:** `36a2d6355a225949e5a50d3eb393edc8d8f93e17`
**Base:** `8cc4f76dc4a8af23c2cf4a9dc93f9093f7c77569` (`main`, including the G8 merge)
**Source verdict:** CLEAR for this bounded persistence slice. No blocking findings.
**Review:** [exact-head GPT-6 Sol review](https://github.com/ThomasHeinThura/ticketing/pull/515#issuecomment-5918336758)

## Scope

Reviewed the full 16-file base-to-head diff, including `pending-action/service.ts`,
`payload.ts`, `events/outbox.ts`, schema and migration snapshots/journal, focused service,
schema and payload tests, API-key ownership and authorization helpers, audit writer, and the
PA/EV/AU contracts. Checked the previous findings and the merged G8 workflow delta. The
independent GPT-6 Luna review at the same exact head also returned CLEAR:
[Luna review](https://github.com/ThomasHeinThura/ticketing/pull/515#issuecomment-5918310396).

## Security review

The API-key guard rejects missing, empty, and whitespace IDs before a transaction. The
transaction requires API-key actor metadata to identify the user connected to the requesting
person and locks an enabled key owned by that user before pending-action, outbox, or audit
writes. The validated key ID reaches workspace access validation. Regressions prove that
missing-ID and other-owner credentials create no pending-action, request-outbox, or
request-audit rows.

The resolver accepts only the canonical `DELETE /api/work-items/{key}` policy for this
key-addressed work-item target. Unsupported target/action pairs and the legacy ID-addressed
route are refused. Target scope and approval summary come from locked target and parent rows;
caller scope assertions cannot redirect the action. Caller-supplied target-version data is
rejected until its encoding is defined.

Sorted targets and the partial unique index prevent duplicate pending requests. Request and
decision state changes share a transaction with complete outbox envelopes; outbox failure
rolls back the state change. Audit failures use the existing nested savepoint, are caught and
logged, and preserve the state/outbox mutation as covered by the AU-14 regressions.

## Verification

The reviewer ran the following against the exact reviewed source head using Testcontainers
Postgres 18:

- Pending-action service and schema integration tests: **2 files, 19 tests passed**.
- Pending-action payload tests: **1 file, 4 tests passed**.

The Luna reviewer did not run local tests because its checkout had no root dependencies. The
implementing lane separately ran the focused service integration suite (**1 file, 17 tests**),
API dependency typecheck (**5 packages**), Biome, and `git diff --check` after merging
`main@8cc4f76d`.

At Sol review time, the exact-head GitHub integration and G8 checks were still running, the
PR-template/security-review check was red, and G11 was skipped. These are CI status details,
not part of the source verdict; verify the final exact-head checks separately.

## Limits and residuals

These service functions have no production callers yet. When wired, the caller must derive
requester, credential, and actor fields from authenticated context. This key-row ownership
check does not authenticate the secret itself, validate key expiry, or enforce key-specific
capability subsets; the caller/authentication path must do so before scoped API/MCP keys are
operational. Own reads and decisions also rely on authenticated requester resolution, and a
future denial endpoint must enforce the specified browser-session restriction.

Approval execution, authorization and freshness rechecks, step-up, impersonation refusal,
expiry/invalidation processing, full confirmation-impact summaries, DELETE-route retrofit,
keyed HTTP response replay, outbox delivery, and AU-14 metric/admin notification remain
incomplete. This review clears only the bounded persistence slice and does not claim PA/P4
completion or acceptance of those future integration paths. No UI screen changed.

## Note-only continuation

This note transcribes the independent review; the reviewed source head remains
`36a2d6355a225949e5a50d3eb393edc8d8f93e17`. Commits after that head contain only this review
artifact and PR evidence updates; no source files changed.
