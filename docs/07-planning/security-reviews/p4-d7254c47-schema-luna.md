# Ordinary review — schema/domain lane

- **Candidate SHA:** `d7254c47d3a0bf1c243d3c490ab98eae8a98832c`
- **Comparison base:** `3096cb044bdf6ae98488bfc385f532fa6386343a`
- **Model:** GPT-6 Luna
- **Independence:** Fresh reviewer context; did not author, direct, or remediate this candidate. Earlier review notes and author-run evidence were treated as historical evidence only.
- **Scope:** Drizzle SQL/schema/journal/snapshot integration (especially suffix 88–111), membership-provenance migration boundary, SLA/calendar and work-item version pinning, identity lifecycle/outbox persistence, and relevant normative data-model/events/pending-actions/identity/SLA contracts.
- **Verdict:** **BLOCKED — two schema/migration findings.**

## Findings

### B1 — Blocking: snapshot 0088 has a broken parent link

`apps/api/drizzle/meta/0087_snapshot.json` has ID `944bb732-6c50-49eb-9cd7-8c2a88e4ece2`, and it is unchanged from the accepted base. The new `0088_snapshot.json` names `prevId` `7a70257d-0005-4444-abc7-a7f0ed7a5f8a`; no snapshot in the directory has that ID. The snapshot ancestry walk found a break exactly at 0088. The journal prefix entries 0–87 are byte-for-byte structurally unchanged from the accepted base and suffix indices 88–111 are contiguous, but that does not repair the generated snapshot chain. Regenerate/repair 0088 from the accepted 0087 snapshot ancestry, then verify the full graph and schema/migration drift.

Evidence: `0087_snapshot.json` and `0088_snapshot.json`; mechanical JSON walk over all 92 present snapshots. `git diff --check` passes, which does not validate snapshot ancestry.

### B2 — Blocking: SLA policy bindings do not enforce the documented workspace boundary

The data model calls `workspace.default_sla_policy_id`, `project.sla_policy_id`, and `work_item_type.sla_policy_id` same-workspace bindings; it also says each `work_item.sla_policy_version_id` is selected for that item. The policy/version rows expose `(workspace_id, id)` unique keys for composite references. However `schema.ts` and migrations 0088–0089 use only single-column FK references to `sla_policy.id` / `sla_policy_version.id` for these bindings. A row can therefore persist a policy/version owned by a different workspace while satisfying every FK. This leaves a cross-workspace association representable in the authoritative schema, despite the data model's same-workspace contract and this codebase's existing composite-FK tenant-attribution pattern. Add workspace-bearing composite FK targets/constraints (with the documented update behavior) for applicable bindings, including the item version pin, or amend the authoritative contract if a different invariant is intended; test rejection of cross-workspace raw writes.

Evidence: `docs/01-architecture/data-model.md` lines describing workspace/project/type same-workspace policy bindings and `work_item.sla_policy_version_id`; `schema.ts` workspace/project/type and work-item declarations; `0088` policy uniqueness and `0089` single-column FK DDL. `request_type` and `request_type_version` already use composite workspace-policy FKs, showing the intended enforcement pattern.

## Checks actually performed

- Confirmed `HEAD` is the exact candidate SHA; worktree was clean at review start.
- Compared journal against accepted base: 88 accepted entries preserved exactly; new entries have contiguous indices 88–111 (24 entries).
- Snapshot graph check: 92 snapshots found; first new generated snapshot (0088) has a missing/wrong parent link, finding B1.
- Reviewed SQL/schema declarations for service calendars, SLA policy/version/goal constraints and work-item pin, membership grant source shape and provenance cutover, user-deactivation pending-action action constraint, instance-scoped outbox allowed-kind checks, lifecycle transaction use, and the corresponding normative docs.
- Reviewed the cutover integration test: it locates `MEMBERSHIP_PROVENANCE_CUTOVER_TAG` from the journal, applies migrations up to that derived boundary, asserts failure/rollback before owner reconciliation, then exercises the approved backfill path.
- Ran targeted domain tests: `pnpm --filter @taskdesk/domain exec vitest run src/calendar/calendar.test.ts src/calendar/holiday-import.test.ts src/identity/membership-projection.test.ts` — **3 files, 85 tests passed**.
- Ran `git diff --check <base>..<candidate>` — passed.
- Did **not** run the migration/Testcontainers integration test: `TASKDESK_DATABASE_URL` is unset in this review environment, and no per-lane private `*_test` PostgreSQL instance was available. No full test suite, browser, image, or outbox delivery claim was made.

## Non-blocking observations / limits

- The event contract permits instance-scoped envelopes only with an empty `scope`; the DB constraint requires null `organisation_id` and restricts kinds to the three pending-action kinds plus `identity.deprovisioned`. Writers inspected pass null workspace scope. This confirms durable insertion shape only; no fanout/drain consumer exists in this candidate, so it proves neither delivery nor phase completion.
- No independent verification is claimed for unrelated API/UI behavior or the author-reported checks in the supplied packet.
