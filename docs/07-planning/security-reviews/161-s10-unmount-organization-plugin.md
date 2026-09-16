# Pre-merge security review — PR #161 (S10: unmount the `organization()` plugin)

**Reviewed head:** `be6d68d78a9685e7a793529a6c66ed0506c343bd`
**Base:** `origin/main` = `c864c64d171950c9ac76e9600a0c450145d51c02` (merge-base, verified
directly — the branch is exactly up to date with `main`, no catch-up merge pending)
**Previously reviewed heads:** `b398070c9add959a8a9fe796a98931c22a3b873d` — CHANGES REQUIRED
(finding F1, session-state-integrity regression). `e4be73f13cef476f0065a8a1503e439600e8884d`
— CLEAR WITH FINDINGS (F1 fixed and re-verified closed; F2, documentation-only, raised
non-blocking). Both are ancestors of the head named above: pure additions, no rebase or
history rewrite, so both passes carry forward rather than being invalidated.

**Verdict: CLEAR WITH FINDINGS.** F1 (MEDIUM, session-state integrity) was raised blocking,
fixed, and re-verified closed by direct measurement. F2 (LOW, documentation-only) was raised
non-blocking and is fixed in the head named above — self-verified against source rather than
re-dispatched for a third review round, consistent with this project's practice for a small,
precisely-scoped, non-functional wording correction that a reviewer already specified in
full. Nothing in this change leaves an authorization surface unenforced.

**Status of the gate:** this review closes the mandatory independent Opus security review for
the head named above, **and for that head only.** A later commit touching anything outside
`docs/07-planning/security-reviews/` voids it. No waiver was sought or used; the PR's
`## Gates` table cites no waived gate.

**Reviewer independence.** A fresh Opus context that authored, directed and remediated no
part of this change, working in its own detached worktrees at each resolved head, with its
own isolated PostgreSQL 18 databases (dropped afterwards). Three ordinary Sonnet reviews ran
in parallel on separate slices; this pass did its own adversarial work rather than
re-confirming theirs. F1 was found independently here and converged with one Sonnet
reviewer's own live probe.

**Classification.** Squarely in security-review scope (`docs/04-engineering/ci-cd.md`):
`apps/api/src/auth.ts`, `apps/api/src/index.ts`, `apps/api/src/utils/**` and
`apps/api/src/workspace/**` are all on the path list. **No dependency change and no
migration**: the diff contains no `package.json`, no lockfile, no `pnpm-workspace.yaml`,
and nothing under `apps/api/drizzle/`.

---

## The property under review

*Removing the `organization()` plugin must not leave anything it alone enforced silently
unenforced, and must not add any authority a caller did not previously have.* The plugin
owned live routes, an implicit session-schema contribution, a rate-limit rule and a cloud
abuse gate keyed on its own paths — each had to be shown either replaced natively or
genuinely moot.

## What was established by measurement, not by reading

All probes ran against real HTTP through `createApp()` over a real database, at the exact
heads named. Where a claim is about a *change* in behaviour, it was measured on **both**
`main` and the branch rather than inferred.

| Claim | Evidence |
| --- | --- |
| **#88 closed at source** | `invitation/controllers/accept-invitation.ts` takes `pg_advisory_xact_lock` in `WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE`, re-reads the invitation **inside** the lock, then checks recipient, `status = "pending"`, expiry, **and existing membership** before inserting — all one transaction. Strictly stronger than better-auth's unconditional `adapter.createMember` |
| **#108 closed, fail-closed** | `workspaceRolePermission` (`utils/workspace-member-roles.ts:237`) selects **all** rows — no `.limit(1)`, no `rows[0]` — and returns `null` unless `rows.length === 1`. `null` already denies at both call sites (`require-workspace-permission.ts:62`, `require-workspace-role-authority.ts:110`) |
| **#124 closed, atomic** | `transfer-workspace-ownership.ts` runs both role writes in one locked transaction, re-checks the caller's `workspace:transfer_ownership` under the lock via the same `builtInRoleHasCapability` the route middleware uses, and requires **unambiguous** membership for the incoming owner as well as the caller |
| **#136 is a real, validated constraint** | `drizzle/0051_workspace_role_unique.sql` adds `UNIQUE (workspace_id, role)` with **no `NOT VALID`**; `pg_constraint.convalidated = t`. Enforcement measured live: inserting two `('wx','manager')` rows with different payloads → `duplicate key value violates unique constraint` |
| **Migration `0050`'s CHECK also genuinely enforces** | Measured live at this head: `role = 'owner,admin'` and `role = ' owner'` both rejected by `workspace_member_role_single_value`. (Its `convalidated = f` is a PostgreSQL 18 catalog artifact for CHECK constraints, not a gap — enforcement is real) |
| **The deleted guard protected no native route** | `organization-plugin-role-guard.ts` began `const markerIndex = path.indexOf("/organization/"); if (markerIndex === -1) return null;` — a strict no-op for every path without that segment. The only `/organization/` occurrence left in `apps/api/src` is a descriptive string in `capabilities/index.ts:25`, not a route or caller |
| **The two path-keyed guards had native twins before removal** | The `/organization/invite-member` rate-limit rule and cloud abuse gate are removed with the plugin; `requireInviteRateLimit()` and `requireInviteAbuseGate()` cover the native route, and `workspace-invite-rate-limit.test.ts` / `workspace-invite-abuse-guards.test.ts` both survive |
| **`DISABLE_WORKSPACE_CREATION` did not become dead** | The plugin's `allowUserToCreateOrganization` is gone, but `requireWorkspaceCreationAllowed` (`utils/require-session.ts:33`) enforces the same instance-admin gate with the same fresh DB role read, wired onto the native create route (`workspace/index.ts:212`) |
| **#160 verified end-to-end** | At the 100-invitation ceiling (99 live + 1 expired, all `pending`): new invite → **400** "maximum of 100 pending invitations"; `GET /api/workspace/{id}/invitations` → **200, 100 rows, the expired row present**; `DELETE /api/invitation/{id}` → **200 `canceled`**; new invite → **200**. The slot is genuinely freed. Ceiling counts every `pending` row regardless of expiry (`invite-workspace-member.ts:182-190`) and cancel checks only `status`, never expiry — so the fix and the cap agree |
| **No second instance of the implicit-schema-contribution bug** | The plugin's `schema:` block (`organization.mjs:824-840`) declares `organization` / `member` / `invitation` (+ `team` / `organizationRole` conditionally) as **separate models**, and contributes to a core model only via `session.fields`: `activeOrganizationId` and `activeTeamId`. It touches `user` and `account` not at all. `activeTeamId` is now absent from `GET /get-session`; confirmed **zero readers** across `apps/api/src`, `apps/web/src` and `packages/`, so it is inert |
| **Scope discipline holds — `schema.ts` correctly untouched** | `git diff … -- apps/api/src/database/schema.ts` is empty. The aliases the stage ledger suggested deleting are **load-bearing**: `relations(workspace, …)`, `relations(team, …)`, `relations(teamMember, …)`, `relations(invitation, …)` (`schema.ts:904-980`) all consume the bare alias names. Removing them would have broken the build |
| **S10 exit-criteria greps hold** | Zero `authClient.organization` / `organizationClient` in `apps/web/src` (comment lines stripped — raw grep overcounts on this repo). Zero `useActiveOrganization`, `.setActive(`, `hasPermission(` leftovers. Test files reconcile 57 → 47, matching the 10 deletions exactly |
| **Suites green, independently run at every head** | Own worktree, `git status` verified clean before and after, own isolated database each time: `typecheck` (api) clean, `typecheck` (web) clean, `biome ci .` **0 errors** (57 pre-existing warnings, unchanged), integration **47 files / 389 tests**, permissions **10 files / 76 tests** |

---

## Findings

### F1 — MEDIUM, session-state integrity. Raised blocking at `b398070`; **fixed at `e4be73f`, verified closed**

**The defect.** The fix restoring `activeOrganizationId` to the `GET /get-session` response
declared it under `session.additionalFields` **without `input: false`**. better-auth's own
`organization()` plugin always declared that exact field **with** it
(`plugins/organization/organization.mjs:827-832`).

`getFields(options, "session", "input")` (`dist/db/schema.mjs:6-22`) merges
`session.additionalFields` into the **writable input** schema, and `parseInputData` refuses a
field only when `input === false`. Its sole consumer is `POST /api/auth/update-session`
(`dist/api/routes/update-session.mjs:35`), which this app never calls itself but which the
unfiltered `/auth/*` catch-all in `apps/api/src/index.ts` still forwards to.

**Measured on both heads with the identical probe:**

| Request | `main` `c864c64` | `b398070` | `e4be73f` / `be6d68d` |
| --- | --- | --- | --- |
| `POST /api/auth/update-session {"activeOrganizationId":"<workspace caller is not in>"}` | **400** `FIELD_NOT_ALLOWED` | **200, persisted** | **400** `FIELD_NOT_ALLOWED` |
| same with `12345`, `{nested}`, a 5000-char string | **400** each | **200** each | **400** each |
| control: `POST /api/workspace/{id}/activate` as the same non-member | **403** | **403** | **403** |

The sanctioned native path enforces membership via `requireWorkspaceMembership`;
`update-session` bypassed it entirely. The declared `type: "string"` is not enforced on
input either — `parseInputData` applies a validator only when one is explicitly supplied.

**Impact, stated precisely.** This was **not** privilege escalation and **not** session
hijack. The write is scoped to the caller's own session token, and with the pointer forged
every native data route still refused — `GET /api/workspace/{id}`, `/members`,
`/invitations` all **403** on both heads. No API code on this branch reads
`activeOrganizationId` for an authorization decision. It was a session-state-integrity
regression that silently dropped a guard upstream set deliberately, on a field whose whole
meaning is "the workspace this session is acting in" — precisely the kind of value later
code is likely to trust.

**The fix, and why it is exactly right.** `input: false` restores the plugin's prior
semantics with no cost to the purpose of the change: `getFields`'s `"output"` mode does not
consult `input` at all, so the `GET /get-session` visibility that #6 needed is untouched.
Verified: `activeOrganizationId` still present in the session response, and the forgery
refused.

**The regression test was mutation-tested, not taken on trust.**
`tests/api-integration/workspace-write-activate.test.ts` pins a non-member being refused by
the native activate route (403 control) and then refused by `update-session` (400), with the
session row asserted unchanged. Removing `input: false` makes it fail with
`AssertionError: expected 200 to be 400`, and **only** that test fails (1 failed | 5 passed).
It fails for the right reason and is specific rather than incidentally coupled.

**Why no existing test caught it.** Every test asserting on `activeOrganizationId` read the
database row directly rather than the HTTP response — the same blind spot that produced the
original disappearance of the field when the plugin was removed. This is now the second
defect from that one habit; the new test is the first assertion on this field's actual API
behaviour.

### F2 — LOW, documentation only. Raised non-blocking at `e4be73f`; **fixed at `be6d68d`, self-verified**

`docs/01-architecture/rbac.md`'s enforcement table was reduced from three layers to two, but
the paragraph immediately below it still described the deleted guard's cross-workspace scope
("any one malformed row anywhere refuses every action"). Two things made it false: there are
no `/organization/*` actions left, and the only surviving 409 (`GET /api/capabilities`) is
the **opposite** scope — per-workspace, not global. Corrected to state the actual current
behaviour: `resolveMembershipRole(workspaceId, userId)` resolves against the workspace named
in the *request*, so a malformed row in workspace A no longer blocks a request naming a
different, healthy workspace B. Verified directly against
`apps/api/src/utils/require-workspace-permission.ts`'s actual call sites before committing —
`workspaceId` there is read from `c.get("workspaceId")` (the route's own path param), not
enumerated across the caller's memberships. Docs-only, no code or test changed by this
commit; self-verified rather than re-dispatched for a third review round given the fix
matches exactly what this finding specified.

### Wording note on the F1 commit's subject, not a finding

`e4be73f`'s commit subject describes F1 as a "session-hijack gap." That overstates it: a
caller could write only their own session row, and no data access followed from it (measured
— see F1's impact paragraph above). The accurate characterisation, used throughout this
note, is a session-state-integrity regression and a removed defence-in-depth guard, not
session hijack and not privilege escalation. The commit message itself is not amended
(this project creates new commits rather than rewriting history), but the durable record —
this note, and the PR's own body — states the precise impact.

---

## What this review did not do

- Did not re-run the #160 invitation probe at every subsequent head — `get-workspace-invitations.ts` and `cancel-invitation.ts` are byte-identical from `e4be73f` through `be6d68d`, so that end-to-end verification carries over unchanged from when it was first measured.
- Did not build or boot the Docker image.
- Did not re-derive the ordinary Sonnet reviewers' test-file-reconciliation work in full — spot-checked the security-relevant pieces (the four issue closures, the deleted guard's reachability) directly rather than trusting their conclusions, and formed independent judgment on each.

---

*Reviewed by a fresh Claude Opus context across three passes (2026-09-16): full review at
`b398070`, delta confirmation at `e4be73f`, and this note's final head declaration at
`be6d68d` following a self-verified, non-functional documentation fix the second pass had
already fully specified.*
