# P4 bulk correction authority review

**Reviewed head:** ae2b88bd70cbca432253c5c2d952d32ce51349a0
**Comparison base:** 5e611b9d95b5aa120daa21c02373f87273903677
**Accepted behavior reference:** 3096cb044bdf6ae98488bfc385f532fa6386343a
**Reviewer:** GPT-6 Luna, fresh independent context; did not author, direct, or remediate this candidate
**Scope:** Full composed 8-file authority/fixture correction, with relevant assignment and RBAC contracts and changed planning evidence checked.
**Verdict:** CLEAR

## What I checked

- Compared the current `GET /api/capabilities` route with accepted `3096cb0` and the previous bulk head. Confirmed missing membership and non-malformed failed resolutions (including ambiguous duplicate rows) set legacy shadow authorization to `denied` and return 403; malformed-role resolution reaches the capability controller, returns an all-false 200 introspection map, and sets shadow authorization to `allowed`.
- Traced the capability controller and permission evaluator. Unknown role names remain denied by exact role lookup; the canonical `sla_policy:manage` capability check remains part of the returned `manageServiceCalendars` value and is not inferred from the legacy permission map.
- Reviewed the regression assertion that the malformed-role resolution itself is `malformed-role`, the all-false capability response check, and the existing unknown `toString` role endpoint test. The malformed role remains denied on an ordinary write route.
- Reviewed `resetTestDatabase` sequencing: on an empty database it migrates to create tables; on an existing database it truncates fixture rows before invoking the membership-provenance migration path, then ensures migrations are current. The added reset regression plants a membership and verifies reset removes it.
- Reviewed boot-test cleanup isolation and its `_test` database name guard, the strict-enforcement source fixture additions for service-calendar/SLA policy files, the schema column-count correction, and the assignment test replacement. The latter now tests a valid single project membership and project role; migration 0093 enforces uniqueness on `(person_id, scope, scope_id)`, so the former duplicate-row fixture is not a valid current state.
- Read the relevant assignment/RBAC specs and the recorded P4/P0 decision/status context. `git diff --check` passed.

## Findings

**Blocking:** None.

**Non-blocking:** None.

## Verification and limits

I did not run tests or the image build. The complete PostgreSQL, focused tests, typecheck, and Biome results listed in the private author evidence were treated as author-reported evidence, not as checks performed by this reviewer. This review is limited to the full composed correction at the exact head above; it does not clear unrelated candidate changes, required GPT-6 Sol security review, CI/image acceptance, merge, or phase completion.
