# Pre-merge security review — PR #155 (S7: native workspace-role list/write routes)

**Reviewed head:** `a64190f6842ff144618097dfc81229bf5ce42143`
**Base:** `origin/main` = `ee6975d8766beaf2c9dc3c555eb02b022f2c9ce3` (merge-base, verified
directly — the branch is exactly up to date with `main`, no catch-up merge pending)

**Verdict: CLEAR.** The security property this stage exists to establish holds under direct
adversarial measurement. One MEDIUM data-integrity finding (M1, a cross-lock gap that fails
closed) and three informational notes, none of which is an exploitable privilege escalation
and none of which blocks merge. Required follow-ups are named below.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, **and for that head only.** A later commit touching anything
outside `docs/07-planning/security-reviews/` voids it. No waiver was sought or used; the
PR's `## Gates` table cites no waived gate.

**Reviewer independence.** A fresh Opus context that authored, directed and remediated no
part of this change, working in its own clone at the resolved head, with its own isolated
PostgreSQL 18 database. Three prior independent Sonnet rounds preceded it (recorded on the
PR at `73cfd27`; the current head `a64190f` carries reviewer 2's whitespace-name fix). This
pass did its own adversarial work — 21 hand-written probes against real HTTP over a real
database — rather than re-confirming those rounds' conclusions.

**Classification.** Squarely in security-review scope
(`docs/04-engineering/ci-cd.md`): `apps/api/src/workspace/controllers/**`,
`apps/api/src/workspace/index.ts`, `apps/api/src/workspace/policy.ts`, and
`apps/api/src/utils/require-workspace-permission.ts` all appear on the path list. **No
dependency change and no migration**: the 30-file diff contains no `package.json`, no
lockfile, no `pnpm-workspace.yaml`, and nothing under `apps/api/drizzle/`. The
`UNIQUE (workspace_id, role)` constraint this stage depends on is migration `0051`, already
on `main` (PR #122).

---

## The property under review

*A caller must never be able to cause a role to exist — by creating one or editing one —
that grants a `(resource, action)` pair the caller did not already hold at the moment of the
request* (`RL-3` in `roles-and-permissions-ui.md`; S7 blueprint Finding F2). Everything else
in this stage is scaffolding around that one sentence.

## What was established by measurement, not by reading

All probes were run against a fresh clone at `a64190f`, real HTTP through `createApp()`,
against a private `opus_pr155_test` / `opus_pr155b_test` database on the lane PostgreSQL 18
container (both dropped afterwards). The `admin` role's real statements were read out of the
database rather than assumed:

```
{"organization":["update"],"invitation":["create","cancel"],"member":["create","update","delete"],
 "team":["create","update","delete"],"ac":["create","read","update","delete"],
 "project":[...],"task":[...],"label":[...],"workspace":["read","update","manage_settings"]}
```

— no `organization:delete`, no `workspace:delete`. Those are the two gaps between `admin` and
`owner`, and `DELETE /api/workspace/{workspaceId}` is gated on
`requireWorkspacePermission({organization:["delete"]})`, so `organization:delete` is the
escalation target.

| Claim | Evidence |
| --- | --- |
| **The ceiling holds on create** | As `admin`: `POST .../roles` with `{organization:["delete"]}` → **403**, `You cannot grant a permission you do not hold yourself: organization:delete`, and **zero rows** inserted (asserted against the table, not the status) |
| **It holds on update too** | As `admin`: `PATCH` the seeded `viewer` role to `{organization:["delete"]}` → **403**, and the stored `permission` string is **byte-identical** to before |
| **A partially-held grant is refused atomically** | `{task:["read"], organization:["delete"]}` → **403**, zero rows. The held half does not land |
| **It is a ceiling, not a blanket ban** | The identical create as `owner` → **200**. The check discriminates on what the caller holds, not on the resource |
| **The full escalation chain dead-ends** | As `admin`: build the widest role the ceiling legitimately permits (literally `admin`'s own resolved statements, accepted 200), self-assign it through S5's `PATCH .../members/{userId}/role` (200), then `DELETE /api/workspace/{id}` → **403**. Then re-attempt minting `organization:delete` *from inside the new role* → **403**. **No ratchet**: the caller's resolved statements after the loop are a subset of what they were before it, never a superset |
| **`resolveCallerWorkspaceStatements`'s "no instance-admin branch" reasoning is sound** | Verified behaviourally, not from the comment. An instance admin (`user.role = "admin"`) who is only a `viewer` member: create **403**, update **403**, delete **403**, zero rows. Control: the *same* user, once genuinely a workspace `admin`, create **200**. `requireWorkspaceRoleAuthority` never takes the `isInstanceAdmin` shortcut — it resolves the real membership and refuses if it does not itself satisfy the route's `ac:[...]` — so by the time the controller runs, `resolveMembershipRole` for this caller is known to resolve, and the two resolutions read through the same `workspaceRolePermission` helper and cannot drift |
| **All four routes share one middleware chain** | Read in `workspace/index.ts`: every one is `[requireSessionOnly(), workspaceAccess.fromParam("workspaceId"), requireWorkspaceMembership, requireWorkspacePermission({ac:[…]}), requireWorkspaceRoleAuthority({ac:[…]})]`. No route is registered differently, and the `.openapi()` handlers are all on the same `workspace` router |
| **`requireSessionOnly()` genuinely fires on all four** | Not covered by any suite in this PR (see N2), so measured directly with a **real** `apikey` row and the real base64url key hash: `x-api-key` **and** `Authorization: Bearer`, on list/create/update/delete — **8/8 → 403 `session_required`**, and the `workspace_role` row count was unchanged (3) afterwards. No widening relative to the plugin's `enableSessionForAPIKeys: false` posture |
| **The advisory lock actually serialises same-name creates** | 8 concurrent `POST` with an identical name → **1×200, 7×409**, exactly **one** row. The clean `RoleNameTakenError` path, not a raw `23505` |
| **The 25-role ceiling cannot be raced past** | From 23 rows, 10 concurrent creates → **2×200, 8×400**, total **25**. Sequentially, the 26th → 400 with the count unchanged |
| **Cross-workspace addressing is safe** | A `roleId` belonging to workspace A, submitted through workspace B's path (caller is owner of both): `PATCH` **404**, `DELETE` **404**, and A's row untouched in both cases. `update-workspace-role.ts`'s final `UPDATE … WHERE id = ?` omits `workspaceId`, but is preceded in the same transaction, under the same lock, by a `(workspaceId, id)`-scoped `SELECT`, and `id` is the primary key — so the omission is not reachable |
| **No existence oracle** | A non-member probing a **real** `roleId` and a fabricated one gets the identical **403 / 403**; list is **403**. A `viewer` attempting create gets the identical **403** for a name that is taken and one that is free — the permission gate fires before the uniqueness check, so there is no name-enumeration side channel |
| **The delete guard is correct in both directions** | Deleting a role a member currently holds → **400**, row intact. After reassigning that member → **200**, row gone. An unassigned seeded role deletes cleanly |
| **A role NAMED after a `BUILT_IN_ROLES` key confers nothing** | This was the most promising second-order lead and it is closed. `requireWorkspaceCapability` resolves the **canonical** vocabulary from the plain role *name* via `builtInRoleHasCapability`, entirely bypassing the `permission` JSON `missingGrants` guards. Measured: an admin creates roles named `instance_admin`, `manager` and `constructor` (all 200, permission `{}`), self-assigns `instance_admin` (200) — then `POST .../transfer-ownership` → **403** and `DELETE /api/workspace/{id}` → **403**. Safe today because `requireWorkspaceCapability` has exactly one call site (`workspace:transfer_ownership`), `ADMIN_CAPABILITIES` is defined as `OWNER_CAPABILITIES` minus `workspace:delete` and `workspace:transfer_ownership` so **only `owner` holds it**, and `"owner"` is refused as a role name by both the native route and the plugin. See N4 for why this is worth writing down anyway |
| **`builtInRoleStatements`'s `in`-operator trap is unreachable** | `require-workspace-permission.ts:17` uses `role in builtInRoles` rather than `Object.hasOwn` — but both of its call sites (lines 157 and 243) pass the **literal** `"owner"`. Grepped exhaustively; no attacker-controlled value reaches it |
| **Suites green, independently run** | Fresh clone at this head, own isolated database: `pnpm --filter @taskdesk/api typecheck` clean (after building the workspace packages); the **full** integration suite **57 files / 551 tests, 0 failures** (177 s); `workspace-role-writes.test.ts` alone **26/26**; `pnpm test:permissions` 4/4 tasks; `pnpm check:openapi` clean at **136 operations** |

## The still-mounted plugin — is it a bypass?

The `organization()` plugin's own `create-role`/`update-role`/`delete-role` stay reachable
until S10, so I tested whether they can be used to get around anything the native routes
enforce. **They cannot, for the property that matters:**

- **Ceiling**: plugin `POST /api/auth/organization/create-role` as `admin` with
  `{organization:["delete"]}` → **403 `YOU_ARE_NOT_ALLOWED_TO_CREATE_A_ROLE`,
  `missingPermissions:["organization:delete"]`**, no row. better-auth's own
  `checkIfMemberHasPermission` is the same control, and this PR's native check is at parity
  with it, not weaker than it.
- **Name hygiene**: `organizationPluginRoleGuard` (PR #110) already refuses `"  owner  "`
  (400 `INVALID_ROLE_VALUE`, leading/trailing whitespace) and `"   "` (400, "names no role at
  all") at the plugin, and `"Owner"` is refused as already taken. So the whitespace-name fix
  this PR's Zod schema adds brings the native route **to** plugin parity rather than leaving
  a gap on either side.
- **The one residual asymmetry, and it is benign**: the plugin still accepts `"ops/infra"`
  (200) because `normalizeRoleName` only lower-cases. This is exactly the case Ambiguity Q1
  anticipated, and keying the native update/delete paths on the opaque `roleId` rather than
  the name is what makes such a row still addressable. Confirmed: the role appears in the
  native `GET .../roles` output and is updatable/deletable by id.
- **Locking**: the plugin's routes take no advisory lock at all, so the native lock is
  "among native callers" only — the same qualifier `workspace-membership-lock.ts` already
  documents for `workspace_member`. That closes at S10, not here. Correctly stated in
  `workspace-role-lock.ts`'s own doc comment.

## Re-deriving the delete-guard's comma-split exception independently

`roleIsReferencedBy` is issue #82's one approved carve-out, so I re-derived it from scratch
rather than checking the stated argument.

**Call sites**: exactly one in production (`deleteWorkspaceRole`, where `true` throws
`RoleAssignedToMembersError` → 400 and nothing is written) plus the unit test. Grepped
exhaustively. It does not leak into any authorization read.

**The argument in the code comment is right but understates itself.** "It only blocks a
deletion, never grants a permission" is true, but the sharper reason is about which failure
each reading produces:

- Comma-splitting can only turn a `false` into a `true` relative to an exact-match read, so
  it can only ever produce **more refusals to delete**.
- An exact-match read would **delete** a row a comma-joined member still references,
  orphaning that member's role name. A missing `workspace_role` row denies everywhere —
  verified: `customRoleStatements` and `ownRoleStatements` both return `null`, and #66's
  compiled-default fallback is gone — so the orphan itself fails closed. But the orphaned
  *name* remains in `workspace_member.role`, and `workspace_member.role` is a name, not a
  foreign key, so a later role created under the same name is silently inherited by the
  orphan. **That** is the privilege-widening failure, and the comma-aware read is what
  prevents it.
- The failure comma-awareness may cause — an un-deletable row — has a documented remedy
  (reassign the members, then delete) *and* a strictly stronger alternative that is never
  blocked: `PATCH` the role's permission set to `{}`, which revokes immediately. Revocation
  is therefore never denied; only the row deletion is.

**Conclusion: the exception holds, for every path that calls it.** No path exists from this
predicate's outcome to a grant.

---

## Findings

### M1 — MEDIUM, data integrity, fails closed, **not a merge blocker**: the role lock (`4_003`) and the membership lock (`4_002`) do not serialise against each other

**Measured, 30 out of 30 interleavings.** `deleteWorkspaceRole` takes
`WORKSPACE_ROLE_LOCK_NAMESPACE` (`4_003`). Every membership writer —
`update-workspace-member-role.ts`, `add-workspace-member.ts` and
`invitation/controllers/accept-invitation.ts` — takes `WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE`
(`4_002`). Two different namespaces on the same key do not block each other, so a delete and
an assignment of the *same* role name run concurrently:

```
delete -> 200 | assign -> 200 | member.role = "ephemeral" | workspace_role row exists = false
dangling references over 30 interleavings: 30
```

The delete reads the member rows, sees nobody holding the role, and deletes; the assignment
independently verifies the role row exists and writes the member. Both commit. The result is
a `workspace_member.role` pointing at a role that no longer exists — precisely the state the
delete guard exists to prevent.

**Why this is not an escalation, and why it does not block merge:**

- The dangling member **fails closed**, measured: `GET .../roles` → **403**,
  `DELETE /api/workspace/{id}` → **403**. `customRoleStatements`/`ownRoleStatements` return
  `null` on a missing row, and #66's compiled-default fallback was removed, so a dangling
  role grants nothing.
- The actor needs `ac:delete` **and** `member:update` — i.e. already a workspace admin — and
  gains nothing they lack: an admin can already lock a member out legitimately (assign
  `viewer`, or `PATCH` the role to `{}`) and can already assign any role within their own
  ceiling.
- The only privilege-widening variant (the orphan silently inherits a later role created
  under the same name) requires an independent, *more* privileged actor to later create that
  name unwittingly. The attacker cannot drive it.
- The routes this PR replaces are strictly worse: better-auth's `deleteRole` and
  `updateMemberRole` take **no** lock at all. This is not a regression.

**But one thing here is factually wrong and should be corrected.**
`delete-workspace-role.ts`'s doc comment (lines 65–67) states the guard runs *"both under
the same advisory lock create/update use, so a concurrent add of a member into this exact
role cannot race the delete."* The second clause is false, and I measured it false 30/30.
`workspace-role-lock.ts`'s own comment is accurate (it claims only that `4_003` serialises
create/update/delete among themselves); it is the delete controller's comment that
overclaims. A future author reading that sentence would reasonably build on a guarantee that
does not exist — the exact shape of defect this repository keeps finding one table over.

**Required follow-up, deliberately NOT as a change to this PR:**

1. File an issue for the cross-lock gap. The straightforward fix is for
   `deleteWorkspaceRole` to take `4_002` as well (in a fixed order to avoid deadlock), or for
   the reference check and the membership writes to share one namespace.
2. Correct the `delete-workspace-role.ts` doc comment.

Both belong in a follow-up PR rather than in this one: amending the comment changes the SHA
and would **void this review's head binding**, forcing a fresh Opus pass on a P0
critical-path candidate to fix a comment. Merging as-is and correcting immediately after is
the cheaper and safer sequence.

### N1 — INFORMATIONAL: `__proto__` as a permission resource key returns 200 with the key silently dropped, instead of 400

`{"__proto__": ["read"]}` → **200**, stored `{}`. `{"task":["read"], "__proto__":["delete"]}`
→ **200**, stored `{"task":["read"]}`. Zod v4's `z.record` strips the key before
`invalidResources` ever sees it, so `Object.keys()` is empty and the resource check passes
vacuously. `constructor`, `toString` and `valueOf` **are** caught correctly (400) — they
survive as own properties.

**Not a vulnerability.** Verified: no prototype pollution (`Object.prototype` untouched, the
parsed object's prototype unchanged), and the smuggled key is *dropped*, never honoured — the
outcome is strictly less privilege than requested. `invalidResources` also runs *before*
`missingGrants`, so no inherited-property key can ever reach `callerStatements?.[resource]`.
The only defect is a cosmetic inconsistency: one reserved key 200s-and-ignores where its
three siblings 400. Worth a line in a follow-up, not a change here.

### N2 — INFORMATIONAL, test coverage: the session-only assertion the blueprint required was not written

S7 blueprint §5 lists *"API key / impersonation session get `session_required` 403 on all
four routes"* as a required test. `workspace-role-writes.test.ts` has no such case, and
`tests/api-integration/workspace-session-only.test.ts` carries a **hard-coded** case list of
the four S2 read routes that this PR did not extend. **The behaviour is correct** — I
measured all eight combinations at 403 with the exact `session_required` message and zero
writes (table above) — so this is a missing regression guard, not a live gap. Worth adding
the four routes to that file's `cases` array in a follow-up.

### N3 — INFORMATIONAL, pre-existing (PR #122, not this PR): `schema.ts` does not declare the unique constraint migration `0051` added

`apps/api/src/database/schema.ts`'s `workspaceRoleTable` declares two plain `index(...)`
entries and no `unique(...)` on `(workspaceId, role)`, while
`apps/api/drizzle/0051_workspace_role_unique.sql` adds
`workspace_role_workspace_id_role_unique`. Drizzle's schema is the source of truth for
generation, so a future `drizzle-kit generate` could emit a migration that **drops** the
constraint. That matters here specifically because `workspace-role-lock.ts`'s own reasoning
treats the constraint as the backstop beneath the advisory lock. Pre-existing and out of this
PR's scope; worth an issue so the backstop cannot silently disappear.

### N4 — INFORMATIONAL, latent structural hazard, nothing reachable today

Two authorization vocabularies read the same `workspace_member.role` string:
`hasWorkspacePermission` resolves the **legacy** `{resource: action[]}` statements from the
`workspace_role` row (which `missingGrants` bounds), while `requireWorkspaceCapability`
resolves the **canonical** `BUILT_IN_ROLES` capability set from the role **name**, which
`missingGrants` does not bound at all. Creating a `workspace_role` row named after a built-in
role is permitted (measured: `instance_admin`, `manager`, `constructor` all 200).

Nothing is reachable today, and I confirmed it by measurement rather than by argument:
`requireWorkspaceCapability` has exactly one call site, for `workspace:transfer_ownership`,
which only `owner` holds, and `"owner"` is an unusable role name on both the native and the
plugin paths. `/api/capabilities` is also safe — it computes over `hasWorkspacePermission`,
not over `BUILT_IN_ROLES`.

**The hazard is the second call site.** The day `requireWorkspaceCapability(…)` is used for a
capability that `admin`, `manager`, `lead`, `member` or `viewer` holds canonically, an admin
could confer it by creating a role with that built-in name and assigning it — without ever
passing the RL-3 ceiling, because the ceiling reasons only about the legacy vocabulary.
Worth recording now so #7's capability migration inherits the constraint rather than
rediscovering it.

---

## What this review did not do

- Did not re-derive the three prior Sonnet rounds' findings; it formed its own judgment and
  measured it instead. (Those rounds are recorded on the PR at `73cfd27`; this head carries
  reviewer 2's whitespace-name fix, which I re-verified independently — `"owner"`, `"Owner"`,
  `"OWNER"`, `"  owner  "` and `"\towner\n"` are all 400, and no row is written.)
- Did not exercise the roles UI in a browser. `apps/web/**` was reviewed by reading: the four
  hooks are repointed onto fetchers with no logic change, the two `roles.tsx` call sites move
  from `roleName: role.role` to `roleId: role.id` with the full row already in scope, and a
  comment-aware grep confirms **zero** remaining executable `authClient.organization.*`
  callers. The PR's own `## Not done` section is honest about this gap.
- Did not audit the `organization()` plugin's role routes as a whole — only whether they can
  bypass what the native routes enforce (they cannot, for the ceiling) and whether their name
  handling is now weaker than the native path's (it is not).
- Did not review the two guardrails the blueprint defers by design (role-rank comparison,
  last-administrator protection). They need `rank`/`is_system` vocabulary the legacy
  `workspace_role` shape has no columns for, and the ledger and `rbac.md` both now say so.

## Two PR-hygiene items for the orchestrator, not security findings

- The PR body's `## Reviewed by` section still reads **PENDING**, and `## Security review`
  still reads *"Not yet created"*, while three Sonnet rounds are recorded in the PR's own
  comment thread and this note now exists. The one failing status check is **"pull request
  template + security review"**; both sections need filling in before it will go green.
- Every other required check is green on this exact SHA, including `integration - Postgres
  18`, `route policy coverage + permission matrix`, `contract - OpenAPI drift`, both CodeQL
  analyses and the supply-chain jobs. Branch protection's "up to date" condition is
  satisfied — the merge-base is `main`'s current tip.

---

*Reviewed by a fresh Claude Opus context, 2026-09-16. Test databases `opus_pr155_test` and
`opus_pr155b_test` were created for this review on the lane PostgreSQL container and dropped
afterwards; no other lane's database was touched.*
