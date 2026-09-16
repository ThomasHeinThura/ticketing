# Pre-merge security review — PR #161 (S10: unmount the `organization()` plugin)

**Reviewed head:** `7ff2fa121845efaaf8b4cab981b6b4486835bc60`
**Base:** `origin/main` = `c864c64d171950c9ac76e9600a0c450145d51c02` (merge-base, verified
directly — the branch is exactly up to date with `main`, no catch-up merge pending)
**Review chain:** `b398070` (CHANGES REQUIRED — finding F1) → `e4be73f` (F1 fixed, CLEAR WITH
FINDINGS — finding F2) → `be6d68d` (F2 fixed) → `a76cf94` (this note) → `7ff2fa1` (OpenAPI
contract regenerated). Each head is a descendant of the last — a pure linear chain, no
rebase or history rewrite — so each pass carries forward rather than being invalidated.

**Verdict: CLEAR.** Two findings were raised and both are fixed and re-verified closed by
direct measurement: F1 (MEDIUM, raised blocking at `b398070`, fixed at `e4be73f`) and F2
(LOW, documentation, raised at `e4be73f`, fixed at `be6d68d`). Nothing in this change leaves
an authorization surface unenforced.

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
| **Suites green, independently run at every head** | Own worktree at `7ff2fa1`, `git status` verified clean before and after, own isolated database: `check:openapi` passes at **101 operations**, `typecheck` (api) clean, `typecheck` (web) clean, `biome ci .` **0 errors** (57 pre-existing warnings, unchanged), integration **47 files / 389 tests**, permissions **10 files / 76 tests** |

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

### F2 — LOW, documentation only. Raised at `e4be73f`; **FIXED at `be6d68d`**

`rbac.md`'s enforcement table was correctly reduced from three layers to two, but the
paragraph below it still described the deleted guard: it claimed the 409 was "scoped to the
caller, not to the workspace named in the request" and refused "every non-exempt
`/organization/*` action". Both halves were false after S10 — those routes no longer exist,
and the only surviving 409 (`GET /api/capabilities`) is the *opposite* scope.

Fixed at `be6d68d`, and the correction was verified against source rather than prose:
`resolveMembershipRole(db, workspaceId, userId)`
(`utils/workspace-member-roles.ts:320-324`) takes a `workspaceId`, and all four call sites
pass one (`require-workspace-permission.ts:127,204,239`;
`require-workspace-role-authority.ts:82`).

**The scope reduction this records is deliberate and is not a weakening.** Pre-S10, a caller
holding one malformed row in *any* workspace was refused on every non-exempt
`/organization/*` action, including requests naming a different, healthy workspace. That
cross-workspace bluntness existed only because the plugin's target was **steerable** — the
guard could not reliably tell which organization a request acted on, so it asked a
target-free question instead. Native routes resolve the workspace unambiguously from the
path parameter, so the decision for workspace B is derived from B's own valid row, which is
correct rather than permissive. Fail-closed still holds where the bad row actually is, and
migration `0050`'s `CHECK` — enforcement verified live — makes the state unreachable for new
writes regardless.

## The committed OpenAPI contract (`7ff2fa1`)

CI caught what no reviewer had checked: `tests/api-contract/openapi.json` still declared all
35 `/auth/organization/*` operations from the deleted `auth-openapi.ts`, so
`pnpm check:openapi` failed. Confirmed directly — the check exits **1** at `a76cf94` and
**0** at `7ff2fa1` (101 operations).

Verified mechanically rather than by reading the diff:

| Claim | Evidence |
| --- | --- |
| **It is a generated artifact, not hand-written** | Ran `pnpm openapi:write` at `7ff2fa1`; `git diff` came back **empty** — byte-identical to what is committed, reproduced from the same code already cleared |
| **Exactly the expected removals, nothing else** | **35** operationIds removed, **0** added; every one maps to an `/auth/organization/*` path, none outside the organization family. 101 + 35 = 136 |
| **The only insertions are already-reviewed content** | The 2 inserted lines are the two `#160` description strings from `get-workspace-invitations.ts` / `workspace/index.ts`, both already in this review |
| **Scope** | One file changed. No source, no test logic, no dependency, no migration |

This file documents the API surface; it enforces nothing at runtime. Bringing it back in
step with the code changes no behaviour and introduces no security surface.

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

- Did not re-run the #160 invitation probe at every subsequent head — `get-workspace-invitations.ts` and `cancel-invitation.ts` are byte-identical from `e4be73f` through `7ff2fa1`, so that end-to-end verification carries over unchanged from when it was first measured.
- Did not build or boot the Docker image.
- Did not re-derive the ordinary Sonnet reviewers' test-file-reconciliation work in full — spot-checked the security-relevant pieces (the four issue closures, the deleted guard's reachability) directly rather than trusting their conclusions, and formed independent judgment on each.

---

*Reviewed by a fresh Claude Opus context across four passes (2026-09-16): full review at
`b398070` (found F1), delta confirmation at `e4be73f` (F1 closed, found F2), delta
confirmation at `be6d68d`/`a76cf94` (F2 closed), and a final delta confirmation at `7ff2fa1`
(the OpenAPI contract regeneration CI itself caught, verified mechanically rather than read).*
