# Pre-merge security review — PR #179 (P1 foundational identity schema: `organisation`, `organisation_quota`, `person`, `membership`, `role`)

**Original reviewed head (all three reviews below):** `f9777eb98f0386ad4b28128b311be91e5ed889b1`
**Head after the S1/S8 fix (this session):** `f152409d94a84dd8fcda7fb6953ed97dc022e408`

**Status: CHANGES REQUIRED at the original head, fixed in this session — pending a fresh
Opus delta-confirmation at the new head before merge.** Nothing in this note declares the
Opus verdict CLEAR; per this project's rule, only a fresh Opus pass, independent of whoever
authored the fix, can clear its own delta. No gate is waived.

## What this PR adds

Five new tables — exactly what `data-model.md` §2 specifies — as one small, purely additive
migration ahead of #23/#25, plus an idempotent boot-time seed (one internal `organisation`,
one `person` per existing `user` row). No route, no controller, no policy-registry entry, no
permission wiring, and no `resolveIdentity` implementation — all explicitly separate, later
work. `apps/api/src/database/**`, `apps/api/drizzle/*.sql` and `apps/api/src/index.ts` are
all on `docs/04-engineering/ci-cd.md`'s security-review-scope path list, which is why the
mandatory Opus pass applies.

## Round 1 — ordinary review: schema/migration fidelity against `data-model.md` §2 (Sonnet, head `f9777eb`)

**PASS.** Column-by-column match confirmed for all five tables against the spec text
directly (not the PR's paraphrase); FK/`onDelete` behaviour checked against the spec's
stated invariants; the `role.key` NULL-collision fix (`coalesce(workspace_id, '')`) verified
for real against a live Postgres 18; `drizzle-kit check` reported no drift; every claimed
test/typecheck count reproduced exactly (typecheck clean, unit 320/47, integration 408/49,
including the new file's 12/12 in isolation). Minor non-blocking nits, none of them S1: no
index on `organisation_quota.updated_by` (breaks this PR's own otherwise-consistent
every-FK-gets-an-index discipline), a redundant plain index on
`organisation_quota.organisation_id` (already backed by its own unique constraint), and a
doc-accuracy note that `security-model.md`'s "Organisation hard delete purges" list predates
this PR's tables and should be extended to name them explicitly.

## Round 2 — ordinary review: seed correctness/idempotency, test genuineness, scope discipline (Sonnet, head `f9777eb`)

**PASS.** Verified the seed is genuinely race-safe, not just check-then-insert, by
**reproducing the concurrent-boot race**: 5 users pre-inserted into an empty database, the
seed fired via `Promise.allSettled` at concurrency 25 against a pool `max` of 10, run 3
times against a real, isolated Postgres 18 — every run produced exactly 1 internal
organisation and exactly 5 person rows, zero `user_id`s with more than one person row. Spot-
checked all 12 original tests as non-tautological (each hits real Postgres constraint
enforcement, a real HTTP sign-up, or a real FK-cascade delete — none merely restates what
the code does). Confirmed zero scope creep: exactly 9 files changed, all additive, no
route/controller/policy-registry/permission-wiring/`resolveIdentity`/workspace-family table
touched. One cosmetic non-blocking nit: the seed's `console.log` after the batch insert
reports `rows.length` (attempted, pre-`onConflictDoNothing`) rather than rows actually
inserted, which could overstate the count under a genuine concurrent-boot race — no data-
correctness impact.

## Round 3 — mandatory Opus security review (head `f9777eb`)

**Verdict: CHANGES REQUIRED.** Method: read `data-model.md` §2, `multi-tenancy.md`
"Identity across tenants", `auth-and-identity.md` (`resolveIdentity`, placeholder people),
`rbac.md`, and `packages/permissions/src/{identity,evaluator}.ts` on `main`; read the full
diff; applied `0052_hesitant_black_bolt.sql` to a real PostgreSQL 18 database and probed
every structural claim with SQL rather than reasoning about it.

### S1 (BLOCKING) — `person` uniqueness was scoped to the organisation; proven wrong, now fixed

`person_organisation_user_unique` was `(organisation_id, user_id) WHERE user_id IS NOT
NULL` — permitting **one `user` row to own two `person` rows in two organisations, on two
different sides.** Proven against the real migration with a real insert: `p_staff`
(`side: 'staff'`, `organisation_id: o_int`) and `p_cust` (`side: 'customer'`,
`organisation_id: o_cust`), both carrying `user_id = 'u1'`, both accepted.

Why this was wrong, not merely permissive:

1. `multi-tenancy.md` names this exact state — one login, two person rows — as the specific
   ambiguity the schema exists to prevent: two `person` rows for one human who genuinely
   needs both portals are "never linked", and each side signs in through its own
   `user` row, not one `user_id` shared across both.
2. `resolveIdentity` (`auth-and-identity.md`) is keyed and cached by `user_id` and returns a
   single `personId`/`organisationId`/`side` — a second row behind the same `user_id` would
   resolve arbitrarily (no `ORDER BY` on the underlying lookup), with the 30-second identity
   cache then pinning whichever answer came back first. A customer resolving as
   `side: "staff"` in the internal organisation was the concrete failure mode.
3. The PR's own seed already assumed the correct, **global** invariant — its skip-set query
   selects `person.user_id` across every organisation, not just one — so the code and the DB
   constraint disagreed about what the rule even was.
4. The PR body's judgment call #6 cited `data-model.md`'s "two `person` rows in different
   organisations may carry the same address" as justification for the per-organisation
   scoping. That sentence is about the `user.email` **attribute** being shared across two
   **different** `user` rows, not about one `user_id` appearing in two `person` rows — a
   misreading, corrected in the PR body in this session.

**Fix, this session (head `f152409`):** the unique index is now global —
`uniqueIndex("person_user_unique").on(table.userId).where(sql`${table.userId} is not
null`)` — strictly stronger than the old index, nothing lost (a placeholder person with a
null `user_id` is untouched by the predicate either way). Migration regenerated via
`drizzle-kit generate` as `0053_fix_person_user_unique_scope.sql` (additive on top of 0052,
which this PR has not yet merged) rather than hand-editing 0052's committed SQL;
`drizzle-kit check` reports no drift. The seed's `ON CONFLICT` arbiter
(`seed-internal-organisation.ts`) moved to `target: [personTable.userId]` to match — Postgres
requires the `WHERE` clause on an `ON CONFLICT` target to exactly match the index it
targets. Two new regression tests in
`tests/api-integration/p1-identity-schema-seed.test.ts`: the same `user_id` is rejected in a
second, different organisation (the reviewer's exact reproduction, direct DB insert); two
DIFFERENT `user_id`s each getting their own `person` row in different organisations still
succeeds (the actually-documented scenario).

### Non-blocking findings — each tracked, none fixed here (explicitly out of scope for this delta)

| Finding | What | Disposition |
| --- | --- | --- |
| S2 | `role.workspace_id` CASCADE + `membership.role_id` RESTRICT makes a workspace hard-delete impossible once any role is in use — two live routes (`delete-workspace.ts`, the account-erasure path `delete-account-data.ts`) would 500 the moment P1/P4 creates a workspace role with a membership | Issue [#180](https://github.com/ThomasHeinThura/ticketing/issues/180) |
| S3 | Nothing ties `membership.scope` to `role.scope` — a plausible escalation path (a `project`-scope membership pointing at an `instance`-scope role) once a future `resolveIdentity` builds `RoleGrant` from `role.scope` | Issue [#181](https://github.com/ThomasHeinThura/ticketing/issues/181) |
| S4 | The seed's fail-open default for an unrecognised `user` row is `side: "staff"` in the internal organisation, on every boot forever — correct today (every `user` is staff, no customer sign-up path exists), but nothing marks the day that stops being safe once P3 lands customer identities | Issue [#182](https://github.com/ThomasHeinThura/ticketing/issues/182) |
| S5 | No `CHECK` constraint on any enumerated column (`person.side`, `membership.scope`, `role.scope`, `organisation.default_customer_visibility`) — a stated `data-model.md` convention ("never free text"), fail-closed downstream today, but a repo-wide gap this PR inherits rather than creates | Folded into [#181](https://github.com/ThomasHeinThura/ticketing/issues/181) |
| S6 | A placeholder person (`is_placeholder: true`) can hold a `membership` row — `data-model.md`/`auth-and-identity.md` both say a placeholder "can never be assigned or hold a membership", and nothing in the DB stops it | Issue [#181](https://github.com/ThomasHeinThura/ticketing/issues/181) |
| S7 | `membership.scope_id` has no backstop against the person's own organisation (a `scope: 'organisation'` membership can point at a *different* organisation than the person belongs to; a `scope: 'workspace'` membership can reference a role owned by a different workspace) — accepted gap for this PR's scope (the same polymorphic-`scope_id` shape as `legal_hold.scope_id` elsewhere in the spec), but needs a named invariant + test in `rbac.md` before the membership-grant route is written | Issue [#181](https://github.com/ThomasHeinThura/ticketing/issues/181) |
| S8 | `data-model.md`'s Indexing section names exactly `create index on membership (person_id, scope, scope_id);` as the composite `resolveIdentity` will query by; the PR shipped two narrower indexes instead | **Fixed in this session, alongside S1** — see below |

### S8 — fixed inline (spec-fidelity, no judgment call needed)

Checked what index existed on `membership` for this shape: the PR shipped
`membership_personId_idx` on `(person_id)` alone and `membership_scope_scopeId_idx` on
`(scope, scope_id)` — neither is the single three-column composite the spec names, and
neither leading-prefix-covers it. Added the exact composite
(`membership_personId_scope_scopeId_idx` on `(person_id, scope, scope_id)`) and dropped
`membership_personId_idx` as now fully redundant (its access pattern is leading-prefix-
covered by the new composite). Kept `membership_scope_scopeId_idx`: it serves a genuinely
different lookup direction — all memberships for a given `(scope, scope_id)`, independent of
`person_id` — that the new composite's column order cannot serve, since a B-tree index can
only be used left-to-right from its first column.

## Test results at the new head (`f152409`)

All run against a real, isolated PostgreSQL 18 (private lane database `pr179fix_test` on
the shared `td-lane-pg` lane container, per `CLAUDE.md`'s per-lane-database convention),
migrated with `drizzle-kit migrate` through `0053`:

| Check | Result |
| --- | --- |
| `pnpm --filter @taskdesk/api typecheck` | 0 errors |
| `pnpm --filter @taskdesk/api test:unit` | **320 passed, 47 files** (unchanged) |
| `pnpm --filter @taskdesk/api test:integration` | **410 passed, 49 files** (408 + 2 new) |
| `pnpm --filter @taskdesk/api test:permissions` | **79 passed, 10 files** (unchanged — no route touched) |
| `p1-identity-schema-seed.test.ts` alone | **14 passed** (12 original + 2 new) |
| `drizzle-kit check` | "Everything's fine" — no schema/migration drift |
| `biome check` (pre-commit) | 0 errors, 64 pre-existing warnings (unchanged from the original head, none in files this fix touches) |

## What this note does not do

- It does not declare the Opus verdict CLEAR. That determination belongs to a fresh Opus
  session with no involvement in authoring this fix, reviewing the delta at `f152409`.
- It does not resolve S2–S7. Each has its own tracked issue; fixing any of them here would
  make this delta bigger than the small, re-reviewable fix the Opus reviewer asked for.
- It does not merge this pull request, edit `## Gates`, or waive anything.

## Status of the gate

The mandatory Opus security review for PR #179 returned CHANGES REQUIRED at
`f9777eb`. The one blocking finding (S1) is fixed at `f152409`, along with the cheap,
no-judgment-call S8 spec-fidelity fix from the same review. Both ordinary independent
reviews are already complete (both PASS, at the original head) and did not need to be
re-run for this delta — S8's index change is squarely inside the schema/migration-fidelity
lens already passed, and S1's fix tightens rather than changes the exact mechanism
(a partial unique index feeding the seed's `ON CONFLICT` arbiter) the seed reviewer already
verified is race-safe. **This gate is not yet closed**: a fresh, independent Opus
delta-confirmation at head `f152409` is required before this pull request merges. Neither
ordinary review nor this note may be read as satisfying it.
