# PR #438 — project/engagement missing routes (issue #25)

## Ordinary review

**Model:** Claude Sonnet 5, fresh independent context (direct analysis, real Bash/git
access)
**Session:** subagent `a3da30f5d9a36e97b` (round 1), `a6bcee96471a1c8ed` (delta round 2)

**Verdict: APPROVE**, at head `e591cd9cff1bc49ce8a14f58e21655cc61d4388b`.

Round 1 found one High-severity blocking finding: `add-stakeholder.ts` checked only that
`personId` existed anywhere in the database, no organisation scoping — a caller with
`project:update` on one workspace could attach a person from a completely different
organisation as a stakeholder. Fixed by joining `personTable` to `workspaceTable` on
`organisationId`, filtered by the route's own `workspaceId`. Round 2 independently
re-verified the join's structural soundness, confirmed the regression test genuinely
creates a different organisation, checked every other controller for the same class of
gap (found none), and reproduced the full suite (97 files / 1283 tests) green.

## Security review

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `a022bebf180f778c6`

**Reviewed head:** `e591cd9cff1bc49ce8a14f58e21655cc61d4388b`

**Verdict: BLOCKING.** Do not merge. Tenant scoping is sound (independently tried to break
it live against a real database — could not). Two real blockers, three should-fix items,
five informational notes.

**B1 (BLOCKING): the required "contract - OpenAPI drift" check fails.** All 15 new routes
are missing from `tests/api-integration/openapi.json` — `pnpm openapi:write` was never run
and committed. Confirmed both in CI (run 36331910987) and locally
(`node scripts/ci/check-openapi.mjs`). Not mentioned in the PR body. **Fix:** run
`pnpm openapi:write` and commit the regenerated contract file.

**B2 (BLOCKING, real, reproduced live): document-link `url` accepts `javascript:`/`data:`
schemes.** `apps/api/src/project/schema.ts:150` validates with `z.string().url()`, which
in zod 4 accepts any scheme. Live-tested: a `javascript:alert(document.cookie)` link with
`customerVisible: true` stored successfully (200); a `data:text/html,<script>...` link
also stored. No screen renders these yet, but the spec has customers, email, MCP and
integrations reading these links eventually — better closed now than cleaned up as stored
data later. **Fix:** restrict to `http`/`https` only. This codebase already has this exact
check in `utils/assert-public-destination.ts:94` — reuse it, and add a regression test.

**S1 (should-fix, real): a NUL byte in `name`/`title`/`role`/`url`/`personId` returns 500,
not 400.** Reproduced live. Matches a rule an earlier Opus review of PR #271 set, which
`work-item/schema.ts` already follows.

**S2 (should-fix, real): `escalationOrder`/`escalationWaitMinutes` return 500 for a value
too large for the database's integer column** (reproduced with 3000000000). Needs a
`.max(2147483647)` (or the domain's real sane maximum, if lower).

**S3 (should-fix): text fields have no length limit**, unlike `workItemTitle`'s `.max(500)`
and the workspace schemas' equivalents.

**N1 (informational):** sub-resources on an archived project can still be changed (200) —
matches `update-project.ts`'s own current behavior; PR-15 only makes the project's *work*
read-only, not correctly out of scope for this PR to fix.

**N2 (informational):** `document_link` has no `updated_at` column despite the data
model's usual convention — cosmetic, no PATCH route exists for it.

**N3 (informational):** the stakeholder fix means a stakeholder must belong to the
workspace's own organisation — correctly blocks customer-contact stakeholders until
`project.organisation_id` exists, the safe direction for an unimplemented case.

**N4 (informational):** the same person can be added twice as a stakeholder on one
project — spec doesn't say either way, not a defect.

**N5 (informational, process only):** the PR body's `## Reviewed by` section wasn't
updated to record the two ordinary-review rounds before this Opus pass ran — since fixed
by the orchestrating session.

**Verified clean:** all four tables match `data-model.md` §3 exactly; every one of the 16
controllers scopes correctly (verified `workspaceAccess.fromProject()` +
`requireActiveProject` + per-child `projectId` filter on every query; PATCH bodies
silently drop `personId`/`projectId`/`active`); the add-stakeholder fix held under a live
adversarial pass (cross-org attach denied, cross-org PATCH swap no-ops, cross-workspace
PATCH/DELETE/stand-down all 404, cross-workspace direct call 400, soft-deleted-project
routes all 404); 15 policy entries match 15 routes exactly, correct capability shape;
migration 0072 confirmed additive-only; #435/#436/#437 confirmed to have zero stub
routes/policy entries. Full suites reproduced: integration 97/97 files (1283/1283 tests),
permissions 12/12 files (82/82 tests), `apps/api` typecheck clean.

B1 and B2 are required before merge. S1-S3 should be fixed in the same round. A fresh
delta Opus confirmation is required on the new head — this is a code-changing fix, not a
no-op reconfirmation.
