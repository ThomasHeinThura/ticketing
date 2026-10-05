# Independent ordinary review — schema/domain lane

- **Candidate SHA:** `d2092ea94f220e303ef5ff50e43961b593893512`
- **Accepted comparison base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Prior reviewed head:** `d7254c47d3a0bf1c243d3c490ab98eae8a98832c`
- **Model:** GPT-6 Luna
- **Independence:** Fresh reviewer context. Did not author, direct, or remediate this candidate. Prior report and author evidence were treated as claims/evidence, not as clearance.
- **Verdict:** **CLEAR — schema/domain review has no blocking findings at this exact head.** This is not stage completion or whole-candidate clearance.

## Scope and findings

Reviewed the accepted-base-to-candidate history with focus on the complete corrections since `d7254c47`: snapshot 0088 ancestry and journal regression; migration 0112 and Drizzle schema for all four same-workspace SLA policy/version references; cross-workspace rejection tests; instance-scoped pending-action expiry; SCIM lifecycle event/audit transaction integration; and the existing membership-provenance cutover boundary and migration integration test. Checked relevant contracts in `data-model.md`, `events.md`, `pending-actions.md`, `identity-provisioning.md`, `sla.md`, and `service-calendars.md`.

No blocking finding:

- Snapshot 0088 now points to the accepted 0087 snapshot ID. The snapshot walk found 93 snapshots, no parent-chain errors, no duplicate IDs, and the root sentinel was correct. Journal indices 0–112 are contiguous; all 88 accepted-base entries are structurally unchanged, with 25 appended entries.
- Migration 0112 replaces the four single-column SLA FKs with workspace-bearing composite FKs: workspace default policy, project policy, work-item-type policy, and work-item pinned policy version. The exact targets exist as unique keys. Delete remains `RESTRICT`; update defaults to `NO ACTION`, preserving tenant boundary integrity. Nullable policy IDs retain the documented unset state through PostgreSQL's default `MATCH SIMPLE` semantics. The matching Drizzle declarations and 0112 snapshot contain all four constraints.
- Added integration assertions attempt foreign-workspace assignment for each of the four pointer types. Existing workspace and item creation behavior continues to pin the selected SLA version; no mutable-binding backfill was introduced.
- SCIM deactivation writes `identity.deprovisioned` into the same lifecycle transaction as the person/grant changes, with the exact empty instance scope and documented payload. Audit uses the documented nested savepoint/AU-14 exception. Repeated/no-op transitions do not emit duplicate lifecycle events. The event remains pending for an undelivered outbox consumer; no delivery is claimed.
- Pending-action expiry handles only the registered null-scope `user_deactivation`/`person` shape, leaves malformed/unsupported null-scope records pending while marking degradation, and emits the expected decision audit/outbox for the supported shape.
- The provenance migration still derives its boundary from the journal, rejects unresolved rows before DDL, wraps cutover DDL/backfill/projection work in a transaction, and the integration test verifies failure rollback and the accepted reconciliation path. The accepted journal prefix is unchanged.

## Checks actually performed

- `git rev-parse HEAD` — exact candidate SHA confirmed; `git status --short` was empty at review start.
- Snapshot/journal ancestry walk using Node — **93 snapshots; 0 chain errors; 113 journal entries; contiguous indices**.
- Accepted journal-prefix comparison using `git show <base>:apps/api/drizzle/meta/_journal.json` — **88/88 entries identical; 25 appended**.
- `pnpm --filter @taskdesk/api exec drizzle-kit check` — passed (`Everything's fine`).
- `git diff --check 3096cb044bdf6ae98488bfc385f532fa6386343a..HEAD` — passed.
- Source inspection of the full 0112 DDL/schema/snapshot/test changes and the pending-action, SCIM, and membership-provenance boundaries described above.

No PostgreSQL integration test was run in this reviewer context; the requested environment states no DB is configured and prohibits fallback/shared/default databases. The author's packet reports 4 scoped integration files / 27 tests, but no standalone raw transcript for that final run was retained, so I do not count that as independently reproduced evidence. No broad unit suite, browser, image, outbox drain, CI, or deployment result is claimed. The parent session was already running the broad unit lane, so I did not duplicate it.

## Residuals / limits

Outbox event creation is durable; the outbox drain/delivery consumer remains absent and is an explicit residual. UI-panel review and the required independent GPT-6 Sol security review remain separate gates. This report clears only the schema/domain ordinary-review lane and makes no P4 completion claim.
