# Workspace invitation query ownership — issue #580

**Reviewed head:** `f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe`
**Accepted comparison base:** `52a5480c7c5162966cab276755c66144edca6b69`
**Source commit parent:** `52a5480c7c5162966cab276755c66144edca6b69`
**Source tree:** `7b015468e25cb5ba1cee87c9c30617b1ac750f59` (3,451 entries)
**Source commit:** `refactor(api): extract workspace invitation repository (#580)`

## Change and boundary

The change moves the eight existing manager-invitation SQL statements from `invite-workspace-member.ts` into `workspace-invitation.repository.ts`. Transactional functions receive the caller-selected `Executor` (the existing transaction); metadata lookups keep using the shared database after commit. The existing predicates, selected and returned fields, statement order, role/member checks, locking, error mapping, transaction boundary, and post-commit email ordering remain unchanged. The new functions are persistence helpers, not new authorization entry points.

The source commit changes exactly two paths: the controller and the new repository module. Their SHA-256 values are `44f9d261ed86616582203b2e864326968665d4e2af202a2d9ed19fd9953f8fb7` and `b2f03a15e351e28a8af8d49c059ca824d73fb51f58962c5fc59a6d6d19df0ea7`. The shared role-assignment lock remains unchanged at `12ab64e3e3492e3b614c0ca2942841adc213b3a96861199a75a2359da912e56c`; all other accepted-main tree entries are conserved.

## Local source checks

The conductor completed these local checks on this exact clean source commit without changing its bytes. Their execution overlapped finalization of the independent Sol review, so they are reported separately from that review. `pnpm run lint:ci` exited 0 (2,416 files checked, 240 warnings, 12 infos, 0 errors); `pnpm typecheck` exited 0 (9/9 tasks, 5 cached). The complete three existing invitation integration files passed against PostgreSQL 18: 3/3 files, 36/36 tests, native exit 0, 18.392 seconds. The owned container cleanup exited 0, the private test environment file was removed, Docker inventory was conserved, and source pre/post checks were clean with non-owned accepted-tree entries conserved. These local checks are not a substitute for current hosted CI or image checks.

The local receipt is `root-verified-local.json`, SHA-256 `e2bb7797e229f5ee24a11d85fa04162dca396fb3d6638752a58bc3b38e590324`, retained in private task evidence. The hosted checks and shipping-image proof for the eventual PR head must be collected after publication; this note makes no claim that they have passed.


## Bounded query-checker diagnostic — unwired, not an acceptance gate

After the local checks, the conductor ran `node scripts/ci/check-queries.mjs` once on the same clean, unchanged source head. It exited 1 after 20.0513 seconds. The actual scan reported 2,673 overlapping instances, 138 distinct paths, and 1,483 path-line locations; it reported zero rows in the two owned invitation paths and four rows in the unchanged shared role-lock file: `execute` and raw SQL construction at lines 29 and 30, and `execute` and raw SQL construction at lines 32 and 33. The shared role-lock remains outside this PR. This is a bounded diagnostic result, not a count of unique queries, progress arithmetic, a wired required check, or acceptance of all issue #580. No failure is waived.

The captured raw log is retained privately at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-18/invitation-f637-query-diagnostic-root/native-query-diagnostic.log` (450,970 bytes; SHA-256 `01f55ec15004ad21f4d7b28f5ec90f54503e846e6896dad3ce1759d41ff9cf56`). The bounded machine summary and native process/source receipt below are copied byte-for-byte from the private evidence.

### Bounded result summary (verbatim JSON bytes)

```json
{
  "source": "f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe",
  "nativeExit": 1,
  "instances": 2673,
  "distinctPaths": 138,
  "distinctPathLineLocations": 1483,
  "ownedControllerOrRepositoryRows": [],
  "sharedRoleLockRows": [
    {
      "path": "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts",
      "line": 29,
      "message": "database operation execute is outside an allowed repository or explicit persistence-infrastructure file"
    },
    {
      "path": "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts",
      "line": 30,
      "message": "raw SQL fragment construction is outside an allowed repository or explicit persistence-infrastructure file"
    },
    {
      "path": "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts",
      "line": 32,
      "message": "database operation execute is outside an allowed repository or explicit persistence-infrastructure file"
    },
    {
      "path": "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts",
      "line": 33,
      "message": "raw SQL fragment construction is outside an allowed repository or explicit persistence-infrastructure file"
    }
  ],
  "unwiredDiagnosticOnly": true,
  "notUniqueQueriesOrProgress": true,
  "sourceConserved": true,
  "rawSha256": "01f55ec15004ad21f4d7b28f5ec90f54503e846e6896dad3ce1759d41ff9cf56"
}
```

### Native process and source receipt (verbatim JSON bytes)

```json
{
  "startedAt": "2026-10-18T04:50:23.429373+00:00",
  "endedAt": "2026-10-18T04:50:43.480911+00:00",
  "nativeExit": 1,
  "timedOut": false,
  "elapsedSeconds": 20.051300291204825,
  "argv": [
    "node",
    "scripts/ci/check-queries.mjs"
  ],
  "source": {
    "head": "f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe",
    "status": "",
    "hashes": {
      "apps/api/src/workspace/controllers/invite-workspace-member.ts": "44f9d261ed86616582203b2e864326968665d4e2af202a2d9ed19fd9953f8fb7",
      "apps/api/src/workspace/workspace-invitation.repository.ts": "b2f03a15e351e28a8af8d49c059ca824d73fb51f58962c5fc59a6d6d19df0ea7",
      "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts": "12ab64e3e3492e3b614c0ca2942841adc213b3a96861199a75a2359da912e56c",
      "scripts/ci/check-queries.mjs": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244"
    }
  },
  "sourcePost": {
    "head": "f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe",
    "status": "",
    "hashes": {
      "apps/api/src/workspace/controllers/invite-workspace-member.ts": "44f9d261ed86616582203b2e864326968665d4e2af202a2d9ed19fd9953f8fb7",
      "apps/api/src/workspace/workspace-invitation.repository.ts": "b2f03a15e351e28a8af8d49c059ca824d73fb51f58962c5fc59a6d6d19df0ea7",
      "apps/api/src/workspace/controllers/workspace-role-assignment-lock.ts": "12ab64e3e3492e3b614c0ca2942841adc213b3a96861199a75a2359da912e56c",
      "scripts/ci/check-queries.mjs": "3ae301ab73e7ae55012bb74bacf2cc6e7dde253c02dccdcb2fecc5bcffa31244"
    }
  },
  "sourceConserved": true,
  "rawBytes": 450970,
  "rawSha256": "01f55ec15004ad21f4d7b28f5ec90f54503e846e6896dad3ce1759d41ff9cf56",
  "unwiredDiagnosticOnly": true,
  "notQueryOwnershipAcceptance": true
}
```

## Ordinary review

**Reviewed head:** `f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe`
**Reviewer context:** fresh independent GPT-6 Luna-configured context; native provenance records configured model/context only, not served weights.

<!-- BEGIN AUTHENTIC ORDINARY REVIEW REPORT (verbatim bytes) -->
# Ordinary review — workspace invitation query ownership (#580)

- **Verdict:** CLEAR — no blocking or non-blocking findings.
- **Reviewed candidate:** `f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe`
- **Comparison base:** `52a5480c7c5162966cab276755c66144edca6b69` (candidate's sole parent)
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate.
- **Model provenance:** GPT-6 review context; platform-served model/version attestation is unavailable in this reviewer context.
- **Scope:** Exact two-path diff only.
  - `apps/api/src/workspace/controllers/invite-workspace-member.ts` — SHA-256 `44f9d261ed86616582203b2e864326968665d4e2af202a2d9ed19fd9953f8fb7`
  - `apps/api/src/workspace/workspace-invitation.repository.ts` — SHA-256 `b2f03a15e351e28a8af8d49c059ca824d73fb51f58962c5fc59a6d6d19df0ea7`

## Checks performed

- Read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and `docs/07-planning/active-mission.md`.
- Read the query-ownership rules in `docs/04-engineering/coding-standards.md`, the query-scoping contract in `docs/01-architecture/multi-tenancy.md`, and the security-review path list in `docs/04-engineering/ci-cd.md`.
- Inspected `base..candidate` diff, current source, `Executor`, invitation transport error mapping, email sender, and relevant invitation integration-test cases by source inspection.
- Confirmed candidate HEAD, sole parent, clean worktree, and both source-file SHA-256 values. `git diff --check base..candidate` emitted no diagnostics.
- No tests, runtime checks, install, formatting, or source writes were performed, per assignment.

## Review

The diff relocates the eight existing SQL statements into a module recognized by the issue #580 repository filename convention. The six statements executed inside the transaction take `executor: Executor` first and are called with the existing `tx`; the repository does not open or commit a transaction. The two workspace/inviter lookups still use shared `db` after the transaction and before the email send.

Comparison with the base shows the same selected columns, joins, predicates, expiry comparison, workspace scoping, `.limit(1)`, pending count scope, update fields, insert values, returning behavior, and query ordering. The controller retains normalization, owner-role rejection, lock placement, typed errors, no-row errors, and post-commit email ordering. The inspected route continues to map the same errors to the same HTTP statuses. Existing integration coverage includes invitation creation, role/member rejection, duplicate pending invite and resend, invitation ceiling and workspace scoping; these tests were not executed in this review.

The change touches `apps/api/src/**/controllers/**`, which is in the authoritative security-review scope. The intended relocation appears to change query ownership only and does not alter authority or gate semantics, so this ordinary review is sized to the one-reviewer row. The separately required fresh security-tier confirmation remains outstanding and is not supplied by this verdict.

## Findings and residuals

- **Blocking:** None.
- **Non-blocking:** None.
- **Residual:** Source inspection does not prove runtime database behavior; no tests or runtime checks were run. Current query-ownership check is documented as planned and not wired.

<!-- END AUTHENTIC ORDINARY REVIEW REPORT -->

## Independent security confirmation

**Reviewed head:** `f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe`
**Reviewer context:** fresh independent GPT-6.1 Sol-configured context; native provenance records configured model/context only, not served weights.

<!-- BEGIN AUTHENTIC SECURITY REVIEW REPORT (verbatim bytes) -->
# Independent security confirmation — workspace invitation query ownership (#580)

**Verdict:** CLEAR — no blocking or non-blocking findings in the reviewed delta.
**Reviewed head:** f6371ace99ab934d47931fc9d3bc9a2ca73c3fbe
**Comparison base:** 52a5480c7c5162966cab276755c66144edca6b69
**Model:** GPT-6.1 Sol
**Model provenance:** This reviewer was assigned/configured `gpt-6.1-sol` with `high` reasoning. This is assignment metadata, not a platform-served-weights/version attestation, which is unavailable in this context.
**Reviewer context:** `/root/invitation_f637_security_sol`; fresh independent security reviewer. I did not author, direct, or remediate this candidate. I received a bounded review assignment rather than inherited author turns.
**Date:** 2026-10-18
**Risk classification:** Security-scope controller path, with provably unchanged authority and statement semantics. The workflow's one ordinary reviewer plus lightweight independent security confirmation row applies. This report supplies only the security role.

## Source and scope verified

The candidate is clean, has exactly the comparison base as its sole parent, and changes only these two files:

- `apps/api/src/workspace/controllers/invite-workspace-member.ts`: SHA-256 `44f9d261ed86616582203b2e864326968665d4e2af202a2d9ed19fd9953f8fb7`.
- New `apps/api/src/workspace/workspace-invitation.repository.ts`: SHA-256 `b2f03a15e351e28a8af8d49c059ca824d73fb51f58962c5fc59a6d6d19df0ea7`.

The remote main branch resolved to the comparison base during this review. The base identifies the protected #840 merge. The shared role-assignment lock file remains unchanged, with SHA-256 `12ab64e3e3492e3b614c0ca2942841adc213b3a96861199a75a2359da912e56c`.

I read the accepted AGENTS, active mission, workflow/model/review rules, CLAUDE adapter, query-ownership/executor and tenant-scoping contracts, authoritative CI security-scope list, newest status/decision entries, issue #580, and RL-15's invitation role-lock contract. I read the completed ordinary review report at `query580-invitation-commit-fe04-preparation-luna/invitation-f637-ordinary-luna.md`; its verdict is CLEAR on this exact candidate and base. I independently checked source rather than treating that verdict as proof.

## Security assessment

All eight statements have the same projections, tables, joins, predicates, limits, update fields, insert values, and returning shape as the base:

| Statement | Security-relevant preservation |
| --- | --- |
| Role lookup | Exact workspace and role; same limit and selected role. |
| Existing member lookup | Same membership/user join and exact workspace plus normalized-email equality. |
| Existing invitation lookup | Same workspace, normalized email, pending status, strict expiry `gt(now)`, and limit. |
| Resend update | Same id obtained from that scoped lookup; same expiry/role update and full returning row. |
| Pending count | Same workspace and pending status; expired pending rows still consume capacity. |
| Invitation insert | Same workspace, email, role, pending status, expiry, creation timestamp and inviter. |
| Workspace email metadata | Same workspace-id lookup/projection on shared db after commit. |
| Inviter email metadata | Same inviter-id lookup/projection on shared db after commit. |

The six transactional statements all receive the actual existing `tx` as their first argument. They await execution and return materialized rows; no query builder escapes. No repository function opens, commits, or rolls back a transaction. The membership namespace 4002 then role namespace 4003 locks still precede role/member/invitation reads and writes. The helper's remaining inline lock statements are unchanged and remain separate unfinished query-ownership work.

The controller retains email trim/lowercase normalization, owner-role refusal before entering the transaction, role-not-found/member/duplicate/ceiling errors, no-row failures, the single captured `now` and 48-hour expiry, resend-before-cap order, and transaction rollback on rejection. Metadata reads and the email send still occur only after successful transaction resolution. A failure before commit cannot reach the email call through this control flow.

The sole production controller call remains the unchanged native route. It supplies the resolved workspace and authenticated user context after the unchanged session-only, workspace-access, actual-membership, invitation-create permission, workspace-role authority, rate-limit, and invitation-abuse guards. Error-to-HTTP mapping and route policy are unchanged. The new repository functions are persistence primitives with explicit ids, not independent authorization entry points; this relocation does not prove a universal identity-scoping wrapper. It adds no route or caller. Recipient email guards and acceptance's role revalidation/shared lock flow remain unchanged in the existing invitation repository/controller.

## Verification actually performed

Read-only Git/source inspection: exact head and parent, clean status, full two-file base-to-head diff, file hashes, caller search, unchanged route/policy/error mapping, Executor contract, shared lock, owner predicate, input schema, email sender, and the recipient email predicate/acceptance flow. `git diff --check base..head` emitted no diagnostics. Live GitHub reads checked open PRs, issue #580, and the current main SHA.

I inspected regression-test source for invite creation, owner/unknown-role/member refusal, duplicate and resend behavior, ordinary member/admin authorization, ceiling/workspace scoping, resend at capacity, and expired-pending capacity. I also inspected the invitation repository recipient predicate and acceptance implementation and located the existing role-deletion race and recipient-change regression cases. I did not execute those tests.

**Tests/runtime run by this reviewer:** none, as assigned. No install, formatting, source edits, Git writes, browser, container, SMTP, PostgreSQL execution, or hosted-check verification was performed. The conductor's checks were still pending when this report was written; earlier dirty-tree results are not presented as current-head proof.

## Findings and limits

- **Blocking findings:** None.
- **Non-blocking findings:** None.
- **Residual risk:** Source equivalence is not runtime acceptance. The conductor must retain current source-bound tests and all required hosted/image/boot gates before merge. Whole #580, the shared lock's ownership conversion, and final checker activation remain unfinished. This review does not activate invitations, waive a gate, approve deployment, or claim stage completion.

<!-- END AUTHENTIC SECURITY REVIEW REPORT -->

## Native reviewer-context provenance

The following JSON is the original provenance record, embedded byte-for-byte. It identifies two distinct fresh contexts and configured model/reasoning pairs; it is not a served-weights attestation.

```json
[
  {
    "id": "01a14d51-93ef-7033-b34c-a6f9402fabd1",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
          "depth": 1,
          "agent_path": "/root/invitation_f637_ordinary_luna",
          "agent_nickname": "Kuhn the 2nd",
          "agent_role": null
        }
      }
    },
    "actualTurnContextPairs": [
      [
        "gpt-6-luna",
        "high"
      ]
    ],
    "interpretation": "configured native context/model metadata, not served weights attestation"
  },
  {
    "id": "01a14d52-d40d-7271-9b20-04c3f83431df",
    "source": {
      "subagent": {
        "thread_spawn": {
          "parent_thread_id": "01a14000-d9e0-7bb1-b3fd-2c0204a4834c",
          "depth": 1,
          "agent_path": "/root/invitation_f637_security_sol",
          "agent_nickname": "Hooke the 2nd",
          "agent_role": null
        }
      }
    },
    "actualTurnContextPairs": [
      [
        "gpt-6.1-sol",
        "high"
      ]
    ],
    "interpretation": "configured native context/model metadata, not served weights attestation"
  }
]

```

## Residuals

- This two-file relocation is not completion of issue #580. The shared role-lock ownership conversion and query-checker activation remain unfinished.
- Invitation activation, SSO, registration, outbound invitation-hold decisions, and other authorization/product behavior are outside this change and remain unchanged.
- Current exact-head hosted checks and shipping-image build/boot/health evidence remain mandatory and must pass before merge. No frontend change, screen, or browser journey is claimed or required for this API-only query-ownership relocation. No pass is inferred from historical results or these local checks.
- Carrier, selected #810/#811 work, signed combined release, exact-digest laptop HTTPS SIT, nonempty attachment backup/usable isolated application restore, and the fresh final independent audit remain unfinished. No phase, issue, stage, or mission completion is claimed.

## Evidence integrity

Both review reports above are copied from their authentic private evidence files without edits. The native context JSON is also copied byte-for-byte. The ordinary review reported no findings on the exact two-file diff. The independent Sol report independently checked source semantics, route/permission boundary, locks, and existing integration-test coverage and reported no findings. Their contemporaneous hosted-check status is preserved verbatim in the reports. The local checks are recorded separately; their execution overlapped finalization of the Sol review and does not alter or substitute for either review.
