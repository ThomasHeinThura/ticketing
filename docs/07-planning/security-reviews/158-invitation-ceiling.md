# Pre-merge security review — PR #158 (native 100-pending-invitation ceiling, NB-1)

**Reviewed head:** `edd97e31eaed1482943095634db47e4c6feede5b`
**Base:** `origin/main` = `8d0f8f01df6e280669367a28c68d6ff09d5f3d04` (merge-base verified
directly — the branch is exactly up to date with `main`, 1 commit ahead, 0 behind, no
catch-up merge pending)

**Verdict: CLEAR WITH FINDINGS.** The ceiling holds atomically under adversarial
concurrency, at the exact boundary, behind the correct authorization. No exploitable
security defect. Two MEDIUM findings — one operability trap that fails closed (M1), one
pre-existing plugin divergence this PR does not introduce (M2) — and two informational
notes. None blocks merge. One process item about CI coverage is named at the end and is
for the orchestrator, not a defect in the change.

**Status of the gate:** this review closes the mandatory independent Opus security review
for the head named above, **and for that head only.** A later commit touching anything
outside `docs/07-planning/security-reviews/` voids it. No waiver was sought or used; the
PR's `## Gates` table cites no waived gate — every row is pass or n/a.

**Reviewer independence.** A fresh Opus context that authored, directed and remediated no
part of this change, working at the resolved head against its own isolated PostgreSQL 18
database (`opus_pr158_test` on the lane container, created for this review and dropped
afterwards). One prior independent Sonnet round preceded it. This pass did its own
adversarial work — twelve hand-written probes against real HTTP over a real database —
rather than re-confirming that round's conclusions.

**Classification.** In security-review scope (`docs/04-engineering/ci-cd.md`):
`apps/api/src/workspace/controllers/**` and `apps/api/src/workspace/index.ts` are both on
the path list. **No dependency change and no migration**: the 5-file diff contains no
`package.json`, no lockfile, no `pnpm-workspace.yaml`, and nothing under
`apps/api/drizzle/`.

---

## The property under review

*A workspace must never be able to hold more than `MAX_PENDING_INVITATIONS_PER_WORKSPACE`
pending `invitation` rows as a result of the native route, and the refusal must not be
raceable, guessable, or reachable by a caller who lacks `invitation:create` on that
workspace.* NB-1, inherited from S6a into the retrofit ledger's S10 row.

## What was established by measurement, not by reading

| Claim | Evidence |
| --- | --- |
| **The lock precedes every read** | `invite-workspace-member.ts:93-95` — `pg_advisory_xact_lock(WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE, hashtext(workspaceId))` is the first statement inside `db.transaction`, before the role lookup, the member lookup, the existing-invitation lookup and the count |
| **Count and INSERT share that transaction** | Count at `:181-189`, INSERT at `:198-209`, both inside the same `tx` that holds the lock; the lock releases only at commit |
| **No other code path inserts an `invitation` row** | Grepped exhaustively: `insert(schema.invitationTable)` has **exactly one** occurrence in `apps/api/src`, at `:199`. `accept`/`reject`/`cancel` only `UPDATE` `status`, which can only *decrement* the count |
| **The ceiling cannot be raced past** | From 99 rows, **25 concurrent** invites → `{200: 1, 400: 24}`, final pending count exactly **100**. From 95 rows, **30 concurrent** → exactly **5**×200, final exactly **100**. No run produced an overshoot |
| **The boundary is 100/101, not 99/100** | Read from the code (`>=`, `:190-192`), then measured: 99 seeded → real 100th = **200**, count 100; real 101st = **400**, count still **100**, body `This workspace already has the maximum of 100 pending invitations` |
| **Parity with the library semantics it replaces** | better-auth's own check is `>= invitationLimit` with `?? 100` (`crud-invites.mjs:167-172`) — the native check is at parity, not weaker |
| **Authorization strictly precedes the ceiling** | Middleware chain read at `index.ts:554-562`, then measured against a workspace at exactly 100: no session → **401** `Unauthorized`; non-member → **403** `You don't have access to this workspace`; `viewer` member → **403** `Insufficient permissions`. No unauthorized caller reaches the ceiling check or learns the count |
| **Only `admin`/`owner` can create an invitation at all** | The seeded role rows were read out of the database, not assumed: `viewer` → `"invitation":[]`, `member` → `"invitation":[]`, `admin` → `"invitation":["create","cancel"]`. Measured end-to-end: `admin` **200**, `member` **403**, `viewer` **403** |
| **The error message discloses nothing** | `workspace-invitation-errors.ts:36-38` interpolates only the limit — no email, id, user, or invitation. The web fetcher surfaces `response.text()` verbatim, so this is exactly what an authorized admin sees |
| **`resend` cannot dodge the ceiling** | `resend: true` for an email with no live invitation falls through to the ceiling check (`existingInvitation` is nullish) and is refused; `resend: true` for an *expired* row likewise, since the lookup filters `gt(expiresAt, now)`. Only a genuine live row takes the UPDATE branch, which inserts nothing |
| **Other refusals still fire first** | At a full workspace: `role: "owner"` → 400 owner-role message; unknown role → 400 `Workspace has no role named "…"`. Both were already reachable at any count, so the ceiling adds no new oracle |
| **Suites green, independently run** | Own isolated database at this exact head: full integration suite **57/57 files, 555/555 tests**; the PR's own file **23/23**; `typecheck` clean across all three tsconfig projects; `biome ci .` **0 errors** over 1119 files (58 pre-existing warnings, unchanged); `check:openapi` clean at **136 operations** |

## The still-mounted plugin — is it a bypass?

The plugin's `/organization/invite-member` stays reachable until S10, and it writes the
**same table**: `auth.ts:310-315` maps `invitation → modelName: "invitation"` with
`organizationId → workspaceId`. So both caps count rows in one table. But they do **not**
count the same rows:

- **Live rows: no divergence.** At 100 unexpired pending rows, native → **400**, plugin →
  **403 `INVITATION_LIMIT_REACHED`**. Both refuse.
- **Expired rows: a real divergence.** better-auth's `findPendingInvitations`
  (`adapter.mjs:664-675`) ends with
  `.filter((invite) => new Date(invite.expiresAt) > new Date())`. The native count does not
  filter on expiry. **Measured:** with 100 expired-but-`pending` rows, native → **400**,
  plugin → **200**, and the table goes to **101** pending rows.

**This is not a PR-introduced problem.** Before this change the native route had **no cap
at all**, so the native path could create pending rows without bound. The PR strictly
tightens. The divergence is a property of the plugin's own expiry filter and disappears
when the plugin unmounts. It is recorded here as M2 so the S10 author inherits the fact
rather than rediscovering it.

---

## Findings

### M1 — MEDIUM, operability, fails closed, **not a merge blocker for this PR** — but IS a hard prerequisite for the S10 unmount PR, filed as issue #160

The ceiling counts every `status = 'pending'` row regardless of `expiresAt` (a deliberate,
well-argued choice — excluding expired rows would make the cap unenforceable). But
`get-workspace-invitations.ts:31-36` filters `status = 'pending' AND expiresAt > now`.

**Measured:** a workspace holding 100 expired-but-`pending` rows refuses a new invitation
with `This workspace already has the maximum of 100 pending invitations`, while
`GET /api/workspace/{id}/invitations` returns **`200` with zero rows**. The admin is told
the workspace is full and shown an empty list.

`cancelInvitation` requires an invitation id, and the native surface provides no way to
discover one for an expired row. The controller's own comment (`:178-180`) states the
remedy is *"an admin sitting on a stale backlog must cancel some of it before inviting
further -- a minor inconvenience"*. **That remedy is not reachable through the native API.**

**Why this does not block THIS PR's merge:**

- It **fails closed** — it refuses to create invitations. There is no privilege impact and
  no information disclosure.
- Only `admin`/`owner` can reach the route at all (measured above), so it cannot be
  triggered against a workspace by an outsider or an ordinary member.
- A remedy exists **today**: the plugin's `list-invitations` is unfiltered
  (`adapter.mjs:676-683`) and returns all 100 rows — measured, native list 0 rows vs
  plugin list 100 rows — and `cancelInvitation` works on an expired-pending row once its
  id is known.
- The pre-PR state was worse in the sense that matters for NB-1: no native cap at all.

**Why it must nevertheless be tracked as a hard S10 prerequisite:** the escape hatch above
is the plugin, and S10 unmounts the plugin. There is **no implemented cleanup job** —
`docs/01-architecture/background-jobs.md:81` documents `session-cleanup` purging
"expired ... invitations", but there is no jobs directory in `apps/api/src` and no
`session-cleanup` symbol anywhere in the source. After the unmount, a workspace that
accrues 100 stale-pending rows over normal use has **no native path back**.

**Filed as [issue #160](https://github.com/ThomasHeinThura/ticketing/issues/160), explicitly
blocking the S10 unmount PR's merge** — flagged to that PR's implementer directly. Any one of
three fixes closes it: a native list/cancel path that can see expired rows; counting only
unexpired rows once a cleanup job exists; or implementing the documented `session-cleanup`
purge.

### M2 — MEDIUM, **pre-existing, not introduced by this PR**: the native and plugin caps count different row sets, and the new constant's doc comment implies otherwise

`workspace-invitation-limits.ts` explains that 100 was chosen so "unmounting the plugin
later does not silently loosen a limit nobody ever actually chose to loosen." That is true
of the **number**. It is not true of the **counted set**: the plugin excludes expired rows,
the native check includes them (evidence under "The still-mounted plugin" above). Today
that makes the native route stricter, and the plugin can create a row past the point where
the native route refuses.

Not a vulnerability, and not a regression — the native route had no cap before. Recorded so
the S10 author does not build on a false parity premise. Worth one corrective line in that
comment in a follow-up.

### N1 — INFORMATIONAL: the ceiling count has no supporting index on `status`

Indexes on `invitation` are `(id)` primary key, `invitation_workspaceId_idx` on
`(workspace_id)`, `invitation_email_idx` on `(email)`, `invitation_inviterId_idx` on
`(inviter_id)`. There is **no `(workspace_id, status)`** index, and `schema.ts:231-235`
declares none.

**Measured** with 60,050 rows for a single workspace (60,000 resolved, 50 pending):

```
Aggregate  (actual time=5.789..5.790 rows=1 loops=1)
  ->  Bitmap Heap Scan on invitation  (actual time=5.774..5.782 rows=50 loops=1)
        Recheck Cond: (workspace_id = '…'::text)
        Filter: (status = 'pending'::text)
        Rows Removed by Filter: 60000
        Heap Blocks: exact=1270
        ->  Bitmap Index Scan on "invitation_workspaceId_idx"  (rows=60050)
Execution Time: 5.812 ms
```

Cost is linear in a workspace's **lifetime** invitation rows, not in the 100-row pending
set the ceiling bounds, and it is paid while holding the membership advisory lock — so it
also extends that lock's hold time for concurrent membership writes. A real invite at that
scale still completed in 25 ms wall.

**Not a DoS.** Only `invitation:create` holders create rows, and the route is rate-limited
to 5 per 60 s per client IP (`require-invite-rate-limit.ts`). A partial index
`ON invitation (workspace_id) WHERE status = 'pending'` would make the count O(pending).
Deliberately not done here: it is a migration, and adding one would widen this PR's
security-review scope for a latency improvement nothing currently needs.

### N2 — INFORMATIONAL, contract hygiene: the route's 400 description no longer lists every 400

`index.ts:575-577` still reads `"Invalid body, an unknown role, or the role was 'owner'"`
and does not mention the ceiling. `check:openapi` is green (the description is unchanged,
so the committed document matches) — nothing is broken; the published contract is simply
incomplete about one refusal reason. Worth a line in a follow-up.

---

## Process item, resolved before merge

**`integration - Postgres 18` never ran on the originally reviewed SHA (`edd97e3`).**
`ci-full.yml` triggers on `pull_request: types: [labeled, synchronize, ready_for_review]` —
not `opened` — so a pull request opened from an already-pushed single-commit branch never
fires it on its first commit, and that job is also not among `protect-main`'s required
contexts. This commit (adding this note) is itself a `synchronize` event, which triggers a
fresh `ci-full` run — confirmed green before merge, see the PR's own checks.

---

## What this review did not do

- Did not audit the `organization()` plugin's invitation routes as a whole — only whether
  they can bypass what the native ceiling enforces (they can, for expired-row-blocked
  workspaces; pre-existing and out of this PR's scope) and whether the two caps count the
  same rows (they do not — M2).
- Did not exercise any UI. No `apps/web/**` file is touched; the existing fetcher
  (`apps/web/src/fetchers/workspace/invite-workspace-member.ts:27-33`) surfaces any non-2xx
  body verbatim, so the new message reaches the admin without a frontend change. Read, not
  clicked.
- Did not re-derive the prior Sonnet round's findings; it formed its own judgment and
  measured it instead.
- Did not test the S10 unmounted state, which does not exist yet. M1's severity rests on
  what that state will look like, argued from the absent cleanup job rather than
  demonstrated.
- `pnpm test:permissions` reports 73/76 in this environment. The **identical three
  failures occur on `main`** at the same commit, so they are a pre-existing local-environment
  artifact (all three concern the `ALL /*` middleware registration), not this change. CI's
  "route policy coverage + permission matrix" is green on this SHA.

---

*Reviewed by a fresh Claude Opus context, 2026-09-16. Test database `opus_pr158_test` was
created for this review on the lane PostgreSQL 18 container and dropped afterwards; no
other lane's database was touched.*

---

## Delta confirmation — reviewed head moved to `80a05c0`

The full review above was performed at `edd97e31eaed1482943095634db47e4c6feede5b`. Two things
landed after it, so `scripts/ci/check-pr-template.mjs` requires a fresh reviewed-head
declaration — it judges over landed commits, not the net diff. The new reviewed head:

**Reviewed head:** `80a05c0fbf53ae61a624c94df4fa94596677b17d`

### What landed since `edd97e3`

| Commit | Contents |
| --- | --- |
| `1826cf9` | This review note itself — `docs/07-planning/security-reviews/158-invitation-ceiling.md` only. |
| `80a05c0` | Merge of `origin/main`, bringing in PR #159 (`e055f39`, `1d24c25`, `f6e4a9f`, `cefb590`, `973093b`): eleven `tests/api-integration/**` files and `docs/07-planning/security-reviews/159-native-test-setup-prep.md`. PR #159 was independently reviewed and merged on its own. |

Every path across both is under `tests/api-integration/**` or
`docs/07-planning/security-reviews/**`. Nothing under `apps/api/src/**`, `apps/web/src/**`,
`packages/**` or `scripts/**` landed.

### Confirmed unchanged

`git diff edd97e3 80a05c0` over the four reviewed surfaces is **empty**:

- `apps/api/src/workspace/controllers/invite-workspace-member.ts`
- `apps/api/src/workspace/controllers/workspace-invitation-errors.ts`
- `apps/api/src/utils/workspace-invitation-limits.ts`
- `apps/api/src/workspace/index.ts`

All four were confirmed present at `80a05c0` first, so the empty diff reflects identical
content rather than mistyped paths.

### The one shared file

`tests/api-integration/workspace-invitation-writes.test.ts` is the only file both PRs touch,
and the only file the merge had to resolve (`git show --cc 80a05c0` produces exactly one
hunk, the import block). The two changes are disjoint and combined cleanly:

- from #159: `inviteAndAcceptAsNewMember` dropped from the `organization-http` import,
  `inviteAndAcceptAsNewMemberNative` added to the native-helper import, and five setup call
  sites swapped;
- from #158: the `MAX_PENDING_INVITATIONS_PER_WORKSPACE` import and the four ceiling tests,
  untouched by the merge.

No duplicate or orphaned import, no surviving non-native call site, no logic collision. This
is native-route test scaffolding, not a security surface — a sanity check, not a re-review.

**Verdict: CLEAR.** The delta is mechanical on every security-relevant surface. The
substantive findings and the clearance recorded above stand unchanged at `80a05c0`.

*Delta confirmed by a fresh Claude Opus context, 2026-09-16. No code was read for
re-derivation; this addendum covers only what moved.*
