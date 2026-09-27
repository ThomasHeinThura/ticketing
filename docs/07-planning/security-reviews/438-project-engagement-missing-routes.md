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

---

## Security review — delta (2026-09-27)

**Model:** Opus 5.5, fresh independent context
**Session:** subagent `adac12aca19327996`

**Reviewed head:** `cb11cd59fb7ff8c647d3ec6c2c459c1f31743ad9`

**Verdict: CLEAR WITH FINDINGS.** Nothing blocks the merge. Both B1/B2 confirmed genuinely
fixed; all three S1-S3 confirmed genuinely fixed; one new should-fix finding (F1, same
class as S1).

**B1 confirmed fixed:** `check-openapi.mjs` clean (126 operations); `test-contract.mjs`
clean (0 unapproved breaking changes, Redocly findings unchanged at 16 vs `origin/main`);
diffed the regenerated contract file directly — exactly the 15 new routes appear.

**B2 confirmed fixed, and skipping `assertPublicDestination` confirmed correct:** read
`assert-public-destination.ts` in full — beyond scheme, it does private-IP/localhost
rejection and DNS resolution checks, which protect a URL the *server* fetches. Grepped
every read site of a document-link's `url` field and confirmed the server never fetches
it (only inserted, listed, deleted) — the only outbound-fetch code in `apps/api/src` is in
`index.ts` and `notification-preferences/delivery.ts`, neither touching document links.
Scheme-only restriction is therefore the right fix, not an under-fix; adding DNS/private-IP
checks would put a needless DNS lookup on a write path and would incorrectly reject
legitimate internal/intranet links. Live-attacked the fix with ~20 payloads (case variants,
leading whitespace/control characters, embedded tab/newline/NUL inside the scheme,
full-width homoglyph, `vbscript:`/`data:`/`file:`/`ftp:`/`blob:`, protocol-relative and
relative forms) — all correctly rejected with 400, nothing stored. Confirmed `https://`,
`http://`, mixed-case scheme, and a 2048-char URL all correctly accepted (200); a
2049-char URL correctly rejected.

**S1/S2/S3 confirmed fixed and genuinely tested:** reverted to the pre-fix schema,
confirmed all 12 new regression tests fail (12 failed, 19 passed) at that pre-fix state,
then confirmed they pass at the fix. Live-checked exact boundaries:
`escalationOrder`/`escalationWaitMinutes` at 2147483647 (200) vs 2147483648 (400); `role`
at 100 (200) vs 101 (400); `name`/`title` at 200 (200) vs 201 (400) — all limits confirmed
to match sibling schemas' own conventions (`workspace/schema.ts`'s `role`/`logo` fields),
not arbitrary.

**F1 (should-fix, real, not blocking):** the four new sub-resource path params
(`milestoneId`, `prerequisiteId`, `stakeholderId`, `documentLinkId`) are still bare
`z.string()` in `project/schema.ts` (~lines 145-163) — a NUL byte in any of them returns
500, not 400. Reproduced live on all four. Matches this codebase's own established rule
from issue #281 (`utils/reject-nul-byte.ts`) that a raw id from the URL must be rejected
with 400 — older routes (`/api/label/x%00y`, `/api/comment/x%00y`) and this same PR's own
`projectId` correctly do this; these four new fields were simply missed. **Fix:** apply
the file's own existing `nulSafeId` helper (already used for `personId` on line 207) to
all four. No information leaks either way (masked 500 body), so this is a should-fix, not
a security incident — matching this project's own convention that a code-defect-closing
rule needs a test, not that every gap of this shape is independently blocking.

**N1-N3 (informational, non-blocking):** URL stored exactly as typed (harmless for
browsers, future non-browser consumers should normalize); three near-duplicate NUL-byte
helpers now exist across `project/schema.ts`/`work-item/schema.ts`/`reject-nul-byte.ts`
(cosmetic); one test title undersells its own coverage (checked the rest live).

**Full suites at this head:** integration 97/97 files (1295/1295 tests); unit 60/60 files
(494/494 tests); `apps/api` typecheck clean (all three tsconfigs). Confirmed
`ALLOWED_URL_PROTOCOLS`'s export change breaks nothing — its existing callers and their
own tests (8/8) pass unchanged.

F1's fix is being commissioned as a narrow delta. Per this pass's own recommendation, the
re-review after that fix can be short — confirm F1's four fields are covered and nothing
else regressed — not a full fresh pass.
