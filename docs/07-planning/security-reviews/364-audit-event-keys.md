# Pre-merge security review — PR #364 (audit writer accepts events.md event keys, #360)

**Reviewed head:** `cc94b0e02fa2c437efb77325c8eecfe37361f7cc`

**Merge base with `origin/main`:** `8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918`

**Verdict: CLEAR WITH FINDINGS.** No HIGH, no MEDIUM. Two LOW and two informational notes,
none blocking. Nothing in this change weakens append-only enforcement, the hash chain, or
the secret backstop.

**Status of the gate:** this is the independent Opus 5.5 security review for the head named
above, and for that head only. Any later commit outside `docs/07-planning/security-reviews/`
voids it and needs a fresh delta review. No waiver was sought or used.

**Reviewer independence.** A fresh, review-only Opus context. It did not author, direct or
fix any part of this change. The author is GitHub Copilot (DeepSeek V4.1 Flash). The
reviewer's only commit is this file.

## What changed

Five files, +183/−11:

- `apps/api/src/events/event-keys.ts` (new): `EVENT_KEYS`, 42 keys transcribed from
  `events.md` § Catalogue.
- `apps/api/src/audit/audit-writer.ts`: `validateAction` now accepts
  `AUDIT_ONLY_ACTIONS ∪ EVENT_KEYS`. It used to accept `AUDIT_ONLY_ACTIONS` only. The
  `AUDIT_ACTIONS_NOT_YET_WIRED` (`legal_hold.*`) check still runs first.
- `apps/api/src/audit/actions.ts`: comment only.
- `tests/api/events/event-keys.test.ts` (new): parses the Catalogue's Key column and checks
  it against the registry in both directions.
- `tests/api-integration/audit-log.test.ts`: one new case. `work_item.assigned` appends and
  the chain verifies.

No migration, schema, grant, trigger, route, or policy file is touched.

## The six questions

**1. Unregistered key, or identity taken from caller input.** The writer still rejects any
action outside the union, before it runs any SQL. I checked the two sets for overlap and
for `legal_hold.*`: they are disjoint, and `legal_hold.*` is still refused.
`actorId`/`workspaceId`/`organisationId` are plain fields of `AppendAuditLogInput`. That was
true before this change, which does not alter it. **No production code calls
`appendAuditLog` at this head.** The only callers are in `tests/api-integration/audit-log.test.ts`.
So no request path can put caller input into an audit row yet. See F4.

**2. Append-only.** No file under `apps/api/drizzle/`, `schema.ts`,
`append-only-tables.ts`, `ensure-application-role.ts` or
`assert-application-role-is-not-privileged.ts` changed. The #296 design is intact: migration
0067 does `REVOKE UPDATE, DELETE, TRUNCATE ... FROM PUBLIC` and adds the
`audit_log_append_only` row trigger and the `audit_log_append_only_truncate` trigger, and the
API connects as a non-owner, non-superuser role. I ran it live. The trigger rejects UPDATE,
DELETE and TRUNCATE, the S4 tombstone carve-out holds, and
`db-application-role.test.ts` confirms the application role cannot UPDATE `audit_log`.

**3. The key list matches `events.md`.** I counted independently: Work items 12, SLA 4,
Approvals 5, Intake 5, Projects/prerequisites/budgets 4, Workspace 1, Platform 11, total 42.
That is exactly the 42 in `EVENT_KEYS`. The inherited `task.*`/`comment.*` vocabulary and
the "Not events" bullets (`schedule`, `work_item.field_changed`) are correctly left out. The
parity test fails in both directions, so adding a key requires a doc change reviewed in the
same PR. Adding a key widens only what the writer *accepts*. It does not make any mutation
emit anything. See F2.

**4. Swallowed or wrong-rollback failures.** Nothing changed here. The writer still throws
and never catches. With a caller transaction it runs in a SAVEPOINT, so an uncaught throw
rolls back the caller's mutation. A caller that catches the throw keeps its mutation, and
the audit row is rolled back. The AU-14 choice between these ("mutation still succeeds, but
never silently") is still the caller's to make. No caller exists yet, so no path can swallow
a failure or roll back wrongly today. Each wiring PR must make that choice explicitly.

**5. Secrets or PII.** Nothing changed here. `assertNoObviousSecret` and the 64 KB truncation
still run on every row, whatever the action. The new test's payload holds ids only
(`assigneeId`). Some catalogue payloads carry free text: `reason`, `note?`, `error`,
`lastError`, `changes[].from/to`. If a wiring PR copies an event payload straight into
`before`/`after`, those fields could hold PII or error strings. That is a wiring concern,
not something this change introduces. See F4.

**6. Tests and CI.** Run in this worktree at the reviewed head, Node 24.20.0, with a private
`o364_test` database on 127.0.0.1:55440. The database was dropped afterwards.

| Suite | Files | Tests | Result |
| --- | --: | --: | --- |
| `apps/api` unit (`vitest.config.ts`, includes `tests/api/events/event-keys.test.ts`) | 59 | 490 | all passed |
| `apps/api` `test:permissions` | 10 | 80 | all passed |
| `tests/api-integration/audit-log.test.ts` (includes the append-only trigger block: UPDATE / DELETE / TRUNCATE) | 1 | 50 | all passed |
| `tests/api-integration/db-application-role.test.ts` (#296 grant-level checks) | 1 | 29 | all passed |

CI at review time (`gh pr view 364 --json statusCheckRollup`, head `cc94b0e`): CodeQL, both
Analyze jobs and GitGuardian passed. The three NOT ENABLED gates were skipped. Every other
required check was still queued or in progress. **This review does not attest CI green.**
The merger must confirm every required check at this head.

## Findings

**F1 — LOW. Both allowlists are mutable module-level `Set<string>`s.** Any module in the
process can call `EVENT_KEYS.add("anything")` or `AUDIT_ONLY_ACTIONS.add(...)`. After that,
`validateAction` accepts the added key with no doc change and no failing test. The parity
test reads the set at import time, in its own process, so it cannot see a runtime `.add`.
*Failure scenario:* a future helper, or a plugin loaded in-process, "registers" a custom
event key at startup, and audit rows appear under a key no document defines. This is not
exploitable today; nothing calls `.add`. `AUDIT_ONLY_ACTIONS` already had this problem, and
this change repeats it for the second set. *Suggested fix (not required for this merge):*
export both as `ReadonlySet<string>` and freeze them, or wrap `has` in a function. That
turns the misuse into a type error.

**F2 — LOW. The check is membership only. It does not tie a key to a mutation.** The writer
now accepts keys emitted by jobs or used only for notifications: `work_item.due_soon`,
`approval.expiring`, `sla.at_risk`, `import.chunk_completed`, `automation.run_failed`. None
of these is a mutation that `audit-trail.md` would audit. It also accepts any domain key from
any caller. For example, a route could write `sla.breached` for an unrelated change.
*Failure scenario:* a wiring PR copies the wrong key, and the audit trail records a
misleading action that passes the writer's checks. Before this change the only mistake a
wrong key could cause was a rejected write. Now it can produce a wrong row. This is inherent
to a flat allowlist. The real protection is reviewing each wiring PR against its feature
spec. Recorded so those reviews check the key, not just that the write happens.

**F3 — INFO. The parity parser fails closed on unusual keys.** The test's regex is
`/^\| \`([a-z_]+\.[a-z_]+)\`/`. It silently skips any future Catalogue key with a digit or
a third dotted segment. Such a key would sit in the doc but not the registry, so the writer
would *reject* it. That fails safe and a wiring test would catch it. The `> 30` floor and
the duplicate check guard against the parser breaking outright. No action needed now.

**F4 — INFO, for the wiring PRs (#353 and later), not this one.** This PR finally makes
domain-keyed audit rows possible, so the first real callers are next. Their Opus reviews must
confirm three things:
(a) `actorId`, `actorType`, `apiKeyId`, `impersonatorId`, `workspaceId` and
`organisationId` come from the authenticated request context and the resolved resource.
They must never come from the request body or path parameters.
(b) The AU-14 choice is made explicitly. Either the audit write propagates in the same
transaction, or it is caught with a real alert. It must never be caught silently.
(c) `before`/`after` hold ids and changed field names, not raw free-text event payload
fields (`reason`, `note`, `error`, `lastError`).

## Verdict

**CLEAR WITH FINDINGS** at `cc94b0e02fa2c437efb77325c8eecfe37361f7cc`. F1–F4 do not block
merging. F1 is a cheap hardening step for a follow-up. F2 and F4 are instructions for
reviewing the wiring PRs. The merge still needs every required CI check green at this head,
and those checks were not complete when this review ran.

## Merge-head attestation (Opus 5.5) — after #340 merged

**Reviewed head:** `929055b28a04df32c3b01c773f11a6cc8377d875`

This is a fresh Opus 5.5 context, 2026-09-24. It attests the `gh pr update-branch` merge of
`main` at `9060512c887bc74006d09768c333e5312e32e53e` (#340, the create-work-item dialog) into
the previously reviewed head `b7c70a4`. `8f545c3..9060512` is that one merge.

- **Parents:** exactly (`b7c70a4`, `9060512`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution. It is the only commit not on `main` since
  `b7c70a4`, and there is no non-merge code commit.
- **PR change unchanged:** `git diff 8f545c3 b7c70a4` and `git diff 9060512 929055b` are
  byte-identical (same sha256). No file overlaps with #340.
- `b7c70a4` is note-only over the reviewed code head `cc94b0e`.
- **Interaction with #340:** #340's API change is one read-only route,
  `GET /api/workspace/{workspaceId}/work-item-types`, plus a policy entry and schemas. It
  emits no event and writes no audit row. It adds no key that could conflict with
  `events/event-keys.ts`'s `EVENT_KEYS` or `audit/actions.ts`. The existing `work_item.*`
  keys, such as `work_item.created`, are unchanged by #340.
- **Tests at `929055b`** (packages built first; private DB `o_att_test`, dropped afterwards):
  - `apps/api test:unit` passes 59 files / 490 tests, including `tests/api/events/event-keys.test.ts`.
  - `tests/api-integration/audit-log.test.ts` passes 1 / 50.
- **CI at `929055b` when this was written:** `pull request template + security review`
  failed on the STALE binding. That is expected, and this note clears it. Other contexts were
  queued or in progress.

**Verdict at `929055b28a04df32c3b01c773f11a6cc8377d875`: CLEAR.**

## Merge-head attestation (Opus 5.5) — after #341 merged

**Reviewed head:** `f3412ea6d6db8bc72695981570ed6252f7fc9884`

This is a fresh Opus 5.5 context, 2026-09-24. It attests the `gh pr update-branch` merge of
`main` at `3c310815ba1a8fb85b56668be6032f177cef4825` (#341, the error-boundary primitive in
`packages/ui` and `apps/web`, plus `biome.json`) into the previously attested head `b616f5e`.
`9060512..3c31081` is that one merge.

- **Parents:** exactly (`b616f5e`, `3c31081`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution. It is the only commit not on `main` since
  `b616f5e`, and there is no non-merge code commit.
- **PR change unchanged:** `git diff 9060512 b616f5e` and `git diff 3c31081 f3412ea` are byte-identical (same sha256), and no file overlaps.
- **Interaction with #341:** none. #341 touches only UI, web, `biome.json` and docs; no audit or event key is emitted or registered.
- **Tests at `f3412ea`:** `apps/api test:unit` passes 59 files / 490 tests (packages built first).

**Verdict at `f3412ea6d6db8bc72695981570ed6252f7fc9884`: CLEAR.**

## Merge-head attestation (Opus 5.5) — after #362 and #366 merged

**Reviewed head:** `164c0f45ffae4bde0a79f576578050a4a745693d`

This is a fresh Opus 5.5 context, 2026-09-25, with `main` at
`536d12a5e5c44e4ab6ed10ac51aa9b5b1f396b38`. The last attestation was at `f3412ea`, recorded in
note `d7b655f`.

**Commits from `d7b655f` to `164c0f4` that are not on `main`:** both are merges, and there is
no non-merge commit. `git show --remerge-diff` is empty for each.
- `5ce9d07`: merge of `main@c0bd99d` (#362)
- `164c0f4`: merge of `main@536d12a` (#366)

The parents of `164c0f4` are exactly (`5ce9d07`, `536d12a`).

- **PR change unchanged:** `git diff 3c31081 d7b655f` and `git diff 536d12a 164c0f4` are
  byte-identical (same sha256), and no file overlaps.
- **Interaction with #362:** the assignable-people feed is a read-only route. It emits no event
  and writes no audit row, so it adds no key that could conflict with `EVENT_KEYS` or the
  audit actions.
- **Tests at `164c0f4`** (packages built first): `apps/api test:unit` passes 59 files / 490
  tests.

**Verdict at `164c0f45ffae4bde0a79f576578050a4a745693d`: CLEAR.**

## Merge-head attestation (Opus 5.5) — after #331 merged

**Reviewed head:** `e812fe3a04e649ec7d26400a50a971fc0558d4a8`

This is a fresh Opus 5.5 context, 2026-09-25. It attests the `gh pr update-branch` merge of
`main` at `fb134c3e9e26f2fd339ed0a866dab0d440250876` (#331, signed SHA-based releases: the release
workflow, `deploy.sh`, `scripts/lib`, docs and the decision log) into the previously attested
head `742a3d8`. `536d12a..fb134c3` is that one merge.

- **Parents:** exactly (`742a3d8`, `fb134c3`). `git show --remerge-diff` is empty, so the
  merge was clean with no manual resolution. It is the only commit not on `main`.
- **PR change unchanged:** `git diff 536d12a 742a3d8` and `git diff fb134c3 e812fe3` are
  byte-identical (same sha256), and no file overlaps.
- **Interaction:** none. #331 changes no file under `apps/`, `packages/` or `tests/`.
- **Tests at `e812fe3`** (packages built first): `apps/api test:unit` passes 59 files / 490
  tests.

**Verdict at `e812fe3a04e649ec7d26400a50a971fc0558d4a8`: CLEAR.**
