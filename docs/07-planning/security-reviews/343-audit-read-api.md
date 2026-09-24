# Security review — audit-read API (`GET /api/instance/audit`, `GET /api/workspaces/{workspaceId}/audit`, AU-10/11/12/13)

**Reviewer:** Opus 5.5, fresh independent context. I did not author, direct or remediate this change.
**Reviewed head:** `2d89f6ac432b72ebe83f49b19418e1842d889fcf`
**Reviewed SHA:** `2d89f6ac432b72ebe83f49b19418e1842d889fcf` (confirmed with `gh pr view 343 --json headRefOid`, before and after the probes)
**Pull request:** #343 (`feat/audit-read-api`), base `dd067e2`. `main` is one commit ahead at `33ce9ec` (#322). That commit does not touch these files.
**Date:** 2026-09-23

## Attribution as found

- The PR body has **no `## Implemented by` section**. The orchestrator's reviewer-packet comment names the author as "Cline (mimo-v2.26 flash)".
- The one commit, `2d89f6a`, is authored by `Cline (audit API) <agent@taskdesk.local>`.
- `CLAUDE.md` § Model tiers says implementation on this project is Claude Sonnet, spawned explicitly. It also says non-Claude coding agents "are not part of this project's process". This review records the discrepancy. Resolving it is not this review's call (see Gates).

## Surfaces examined

- `apps/api/src/audit/{index.ts,policy.ts,response.ts,schema.ts}`
- `apps/api/src/audit/controllers/{audit-read-common.ts,list-instance-audit.ts,list-workspace-audit.ts}`
- The wiring in `apps/api/src/index.ts` (flat `api.route("/", audit)` mount, below the app-wide auth guard), plus `apps/api/src/database/index.ts` (the barrel fix) and `apps/api/src/policy-registry.ts`
- `tests/api-integration/audit-read.test.ts`, `tests/permissions/regen-matrix.test.ts`, the `matrix.fixture.json` diff (+68 lines) and the `openapi.json` diff
- These were not changed by the PR, but the change depends on them:
  - `utils/is-instance-admin.ts`
  - `utils/authenticate-api-request.ts` (API-key context)
  - `utils/require-workspace-capability.ts`
  - `utils/require-workspace-membership.ts`
  - `utils/workspace-access-middleware.ts` (`fromParam`)
  - `audit/audit-writer.ts` (input shape, AU-2 backstop)
  - `audit/verify-audit-chain.ts`
  - `database/schema.ts` `auditLogTable`
- Docs:
  - `audit-trail.md` AU-1–AU-7, AU-10–AU-15, § Permissions, § API
  - `rbac.md` § Capabilities, built-in roles, § Reach, elevated list and session-only routes
  - `reviews/2026-09-05/security.md` row "Logging and audit access scope"
  - `security-reviews/291-audit-log-table.md`

## What I ran (exact head, private DB `pr343_opus_test` on td-lane-pg, Postgres 18)

| Suite | Result |
| --- | --- |
| Integration (full) | **80 files, 1088 tests, all passed** |
| PR's own `audit-read.test.ts` | 6/6 |
| `test:permissions` | **81/81** (after building `@taskdesk/domain`, which the brief's build filter omits) |
| Unit (`apps/api`) | **54 files, 412 tests** |
| `check:openapi` | matches (108 operations) |
| `node --test 'scripts/ci/**/*.test.mjs'` | **495/495** |
| `check-pr-template.mjs --body` (live PR body) | **EXIT 1, 11 problems** — see Gates |

**Mutation check.** I neutralised the handler-level `eq(auditLogTable.workspaceId, workspaceId)` in `list-workspace-audit.ts`. The PR's tenant-isolation test went red (1 failed / 5 passed). I restored the line, and `git status` was clean afterwards.

**Adversarial probes.** These ran over real HTTP (`app.request`) against the real DB, from a throwaway file `zz-opus-probe-343.test.ts`. The file was run, deleted from the worktree and never committed.

1. **Who can read — instance route.**
   - Anonymous: 401.
   - Workspace owner (not an instance admin): 403.
   - Customer-role member: 403.
   - Non-admin's API key: 403.
   - **Instance admin's personal API key: 200.** This matches the spec: list reads are not on rbac.md's elevated or session-only list. See S3 for how it is attributed.
2. **Who can read — workspace route.**
   - `admin` 200, `manager` 200, `owner` 200.
   - `lead`, `member`, `viewer`, `customer`: all 403. This matches `workspace:manage_settings` in rbac.md's built-in roles table.
   - Instance admin who is not a member: 403. That is consistent with the fixture, and the instance route covers them.
3. **Tenant filter.** I seeded 7 rows each in workspace A, workspace B and `workspace_id IS NULL`, plus an A row with `organisation_id` NULL (the tombstone shape).
   - Workspace A's owner read under each of these queries: `limit=1/3/500`, `action=role.`, empty, `%`, `_`, `\`, `since`/`until` windows, a far-future `since`, and a smuggled `?workspaceId=<B>`.
   - Every response held **zero** foreign or null-workspace rows. Null-workspace rows are reachable only on the instance route. Tombstoned rows stay visible in their workspace, which matches AU-7's "still renders everywhere it did before".
   - `%`, `_` and `\` prefixes returned 0 rows, so the LIKE escaping holds.
   - Repeated params (`action=a&action=b`, `limit=2&limit=500`) → 400.
4. **Pagination and cursor.** There is **no cursor**, so the #320 keyset-OR class cannot occur. The query is one `AND` of `eq(workspace_id)` with optional prefix, `since` and `until` filters. `combineFilters` uses Drizzle's `and(...)`, which parenthesises. Pages are `limit` ≤ 500, newest first, with `until=` windowing. That is functional scope, not security scope.
5. **What is returned.** The response keys are exactly: `id`, `seq`, `createdAt`, `actorId`, `actorType`, `impersonatorId`, `workspaceId`, `organisationId`, `action`, `entityType`, `entityId`, `before`, `after`.
   - `actor_ip`, `user_agent`, `trace_id`, `api_key_id`, `prev_hash` and `row_hash` are **not** returned. Sentinel values seeded in those columns never appeared in any body.
   - `before`/`after` are returned as stored. The spec wants this: the God Mode screen shows the diff.
   - Secrets: the writer's AU-2 backstop refused my probe's own `projectSecretName` key at write time. So a secret-named key cannot reach a row, and this route echoes only what the writer accepted. The route adds no new secret path.
6. **Reading must not write rows it shouldn't.**
   - `audit.read` count deltas: one instance read +1, two more +2, one workspace read +1.
   - A denied read (403 on both routes) and an invalid query (400) added **+0**.
   - Every existing row's `id`, `row_hash` and `organisation_id` was byte-identical before and after. The new rows only append.
   - `verifyAuditChain` returned `ok: true` after the reads.
   - The workspace `audit.read` row carries the workspace id.
7. **AU-14 under real failure.** I added a temporary `BEFORE INSERT` trigger that raises on `action = 'audit.read'`. The instance read still returned **200**. I dropped the trigger afterwards.
8. **Existence oracle (#290).** Workspace A's owner requested foreign workspace B and a nonexistent id. Both returned 403 with the same body (`You don't have access to this workspace`) and the same headers once `date` is excluded.
9. **Malformed input, 400 vs 500.**
   - Most bad input returns 400: `limit` 0, 501, `abc`, −1 or 1.5; malformed or offset datetimes; `action` over 200 characters; NUL in the path param (400, from #290's guard); NUL inside `since`.
   - **Three return 500** (S2): `action=%00`, `action=auth.%00`, and `since=0000-01-01T00:00:00Z`.
   - SQL-ish path params gave 403. Everything is parameterised through Drizzle, and I found no string-built SQL.

## Findings

### S1 — NON-BLOCKING for this head, and a decision is needed before the first project-scoped audit writer merges: workspace audit reads are not reach-filtered, so a `manager` sees `before`/`after` for projects outside their reach

**Where:**
- `apps/api/src/audit/controllers/list-workspace-audit.ts:26-37`
- `apps/api/src/audit/index.ts:51`
- `apps/api/src/audit/policy.ts:49-54`

**The spec and the code.** `audit-trail.md` § Permissions and § API gate the workspace log on `workspace:manage_settings` and say nothing about reach. The code matches that text exactly.

**The open concern.** The 2026-09-05 security review, row "Logging and audit access scope", flagged this shape. It asked for the spec to "state whether workspace audit reads are reach-filtered; if they are not, say so deliberately and require `sees_all` or a dedicated capability". Neither `audit-trail.md`, `rbac.md` nor the decision log records a disposition. `pending-actions.md:218` makes the opposite choice for the analogous support read ("`workspace:manage_settings`, reach-filtered").

**Reproduced.** A `manager` (rank 60, holds `manage_settings`, not `sees_all`, no project membership) received the full `after` payload of a `project.reach_changed` row.

**Why it is not blocking at this head.** `audit_log` has no `project_id` column, so the table cannot be reach-filtered today without a per-`entity_type` join. More importantly, **nothing on `main` writes a project-scoped audit row yet**. `appendAuditLog`'s only production caller is this PR's own `audit.read`. So there is no live exposure at this head.

**When it starts to matter.** The first writer of `work_item.*`, `project.*`, `attachment.downloaded` and similar rows makes this real.

**Decision required (for Thomas; this review does not decide it).** Choose one:
- (a) Accept unfiltered workspace audit reads for `manage_settings` holders, and write that into `audit-trail.md` AU-10.
- (b) Require `sees_all` (or `owner`/`admin`) for the workspace log.
- (c) Denormalise `project_id` onto `audit_log` and reach-filter.

Record the choice in the decision log before project-scoped audit writes land.

### S2 — NON-BLOCKING: attacker-controlled query values reach Postgres unvalidated and return 500

**Where:**
- `apps/api/src/audit/schema.ts:8` (`action` accepts `\u0000`)
- `schema.ts:10-11` (`z.string().datetime()` accepts year `0000`)
- `audit-read-common.ts:25-36`

**What happens.**
- A NUL in `action` makes Postgres raise `22021` inside `LIKE`.
- `since`/`until` of `0000-01-01T00:00:00Z` becomes a JS `Date` whose ISO form Postgres rejects as out of range.

Both surface as a generic `500 Internal Server Error`. There is no information leak, the body is constant, and it fails closed. However, #290 established that NUL input on these surfaces returns 400, and a 500 on crafted input is noise in error alerting.

**Fix.**
- Refine `action` with `.refine((s) => !s.includes("\u0000"))`, or reuse the #290 NUL guard.
- Bound the datetimes to a range Postgres accepts, for example year ≥ 1.
- Add two regression cases to `audit-read.test.ts`.

### S3 — NON-BLOCKING: the `audit.read` row misattributes API-key and impersonated reads, and records no IP, user agent or trace

**Where:** `apps/api/src/audit/controllers/audit-read-common.ts:55-65`

**What happens.** `writeAuditRead` hard-codes `actorType: "person"` and never passes `apiKeyId`, `impersonatorId`, `actorIp`, `userAgent` or `traceId`.

**Probe.** An instance admin reading the whole instance log with a personal API key produced an `audit.read` row saying `actorType: "person", apiKeyId: null, actor_ip: null, user_agent: null`. The writer already supports `"api_key"` and `apiKeyId`.

**Why it matters.** AU-1 says rows record actor IP and user agent. AU-4 will need `impersonatorId` once impersonation lands. For "who read the audit log", the credential that did the reading is the most useful forensic fact.

**Fix.**
- When `c.get("apiKey")` is set, write `actorType: "api_key"` with `apiKeyId`.
- Pass the request's IP, user agent and trace id through.
- Assert both in the AU-13 test.

### S4 — NON-BLOCKING (note): every audit read takes the global chain lock

**Where:** `apps/api/src/audit/controllers/audit-read-common.ts:55`, calling into `appendAuditLog`.

**What happens.** AU-13 makes every successful read append a row. `appendAuditLog` serialises on `pg_advisory_xact_lock(AUDIT_CHAIN_LOCK_KEY)` instance-wide. A `manage_settings` holder in any workspace can therefore hammer the read route. Each read takes the lock every mutation's audit write also needs, so this is a cross-tenant contention amplifier.

**Why not blocking.** The spec chose one row per read deliberately (AU-13's volume decision). Nothing here is wrong against the spec, and requests are authenticated. It belongs with the rate-limit and noisy-neighbour work, not in this PR.

### Nit (no finding number)

- `tests/permissions/regen-matrix.test.ts:16-19`:
  - It is a permanently-present test that asserts `expect(true).toBe(true)` on every normal run.
  - With `REGEN_MATRIX=1` it rewrites the checked-in fixture. `matrix.test.ts` reads the fixture at import time, so it cannot become self-satisfying within one run. Even so, a regenerator is a script, not a test.
  - Its docstring's `bunx --bun` invocation does not match this repo's toolchain.
  - Consider moving it to `scripts/`. Not security-relevant as wired, because CI never sets the variable.
- The workspace `audit.read` row stores `organisation_id` NULL. Setting it to the workspace's organisation would keep AU-7 tombstoning of these rows consistent with other workspace rows.

## Checks that came back clean

- **Registry and coverage.** Both routes are in `POLICY_SOURCES`. `test:permissions` 81/81 covers route-coverage parity and the regenerated matrix.
  - The instance route declares `instance:read_audit`, `scope: "instance"`, a written reach exemption, and `elevated: false` with a reason. `rbac.md` lists only `POST /api/instance/audit/export` as elevated, so `false` is correct for the list.
  - The matrix rows match runtime for every role I probed.
- **Runtime vs declared capability** (the PR's flagged alignment 2). `isInstanceAdmin(c)` (`user.role === "admin"`, from the session or a fresh DB read for API keys) is the codebase's single instance-authority primitive. `instance_admin` holds every `instance:*` capability. I found no role that holds `instance:read_audit` without being `user.role = admin`, so the check is not wider than the declaration. Confirmed.
- **Plural path** (flagged alignment 1). It follows `audit-trail.md` § API verbatim. It is not security-relevant.
- **Flat mount at `/`.** The audit router carries no `use()` middleware, so mounting at `/` adds middleware to no other route. Both paths are registered after the app-wide `authenticateApiRequest` guard, as the anonymous 401 shows.
- **`database/index.ts` barrel fix.** It only adds `auditLogTable` to the `schema` object. It is additive and correct.
- **Customers (AU-12).** Customers are refused on both routes.

## Gates at this head

| Gate | State |
| --- | --- |
| Required CI | Everything green **except** `pull request template + security review` = **FAILURE** |
| `check-pr-template.mjs --body` (run from this worktree on the live body) | **EXIT 1, 11 problems.** The body lacks every fixed section: `## Implemented by`, `## Reviewed by`, `## Security review`, `## Screens opened`, `## Checklists`, `## Design review H1–H6`, `## Not done` |
| Independent ordinary review by a different agent, with model and SHA | **Absent.** No GitHub review, and no review comment beyond the orchestrator's reviewer packet |
| Attribution | **Does not reconcile.** There is no `## Implemented by`; the commit author is "Cline (audit API)"; the packet says "Cline (mimo-v2.26 flash)". `CLAUDE.md` § Model tiers makes implementation Sonnet-only. The orchestrator must reconcile this, or Thomas must decide it. This review does not |
| Opus security review | This note |

## Verdict

**CLEAR WITH FINDINGS on the code at `2d89f6ac432b72ebe83f49b19418e1842d889fcf`. I found no blocking security defect.**

- **Holds:** authorisation on both routes, tenant isolation, the #290 existence-oracle parity, response field minimisation, append-only / chain integrity under reads, and AU-13/AU-14.
- **Non-blocking findings:**
  - S1 is a spec decision owed before project-scoped audit writers land.
  - S2 and S3 are small fixes, reasonable to take in this PR or immediately after.
  - S4 is a note.

**Not merge-ready, independent of the above.** The PR-template gate fails, and no independent ordinary review is recorded. Attribution does not reconcile with `## Implemented by` (the section is absent) or with the project's model-tier rule. Any new commit, including a body-only change that re-binds the reviewed head, needs this clearance re-confirmed at the new SHA.

---

## Delta review (Opus 5.5)

**Reviewer:** Opus 5.5, fresh independent context. I did not author, direct or remediate this change, and I did not write the first review above.
**Reviewed head:** `c0ae25aa2a666828e928ee32aee3220966e1e0f1`
**Previous Opus head:** `2d89f6ac432b72ebe83f49b19418e1842d889fcf`
**Base:** `origin/main` at `8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918`. The merge base equals it.
**Date:** 2026-09-24

### What changed since `2d89f6a`

- The branch gained two commits:
  - `773cfe5` is the first review note. It is docs only.
  - `c0ae25a` merges `main` at `8f545c3` into the branch.
- **No PR-owned code changed.** `git diff 2d89f6a c0ae25a` over the PR's own files touches only three:
  - `apps/api/src/database/index.ts`, which gained the migration pool from #308;
  - `apps/api/src/index.ts`, which gained changes from #308, #323, #338 and #354;
  - this note.
- In both code files, every hunk is `main`'s own text. `apps/api/src/audit/**`, `policy-registry.ts`, the audit tests, the matrix fixture and `openapi.json` are unchanged.
- **The merge was clean.** `git show --remerge-diff c0ae25a` is empty: there were no conflicts and no hand-edits in the merge.

### Checked against `main`'s new semantics

1. **Project reach, #334, and `sees_all` across workspaces.** This holds.
   - Neither audit route consults `Reach` or `resolveIdentity`. The workspace route is gated by three checks:
     - `workspaceAccess.fromParam` then `validateWorkspaceAccess`, which requires membership in the path workspace;
     - `requireWorkspaceMembership`;
     - `requireWorkspaceCapability("workspace:manage_settings")`, which reads the caller's role **in the path workspace**.
   - The handler then filters on `eq(workspace_id, <path id>)` without condition.
   - So a `sees_all` grant, or any role, in workspace A cannot open workspace B's rows. `membership_with_workspaces` is never read on this path. Also, `resolve-identity.ts:662` still hard-codes `seesAll: false`.
   - **Probe:** I tested a user with a high role in A and a low role in B, for owner/member, admin/viewer and manager/lead. B returned 403. A returned only A's rows under `""`, a smuggled `?workspaceId=<B>`, `limit=500` and `action=role.`. The instance route returned 403 for all three.
   - **Project-reach filtering (AU-10, #345):** the route is still unfiltered. That is exactly the state #345 accepts "until the first project-scoped audit writer merges". There is still no project-scoped writer on `main`: `appendAuditLog`'s only production caller is this PR's `audit.read`, and `audit_log` has no `project_id`.
   - **Tripwire:** #364 (event-key registration so domain mutations can append audit rows) is the unlock. #364 itself adds no writer. But the first PR that writes a project-scoped row must not merge before #344 (the `project_id` column and the reach filter). See D1.
2. **`and()`/`or()` grouping (#320 D0) and cursor leaks.** Both hold.
   - There is one `and(...)` in `combineFilters`, and Drizzle parenthesises it. There is no `or()` anywhere in `apps/api/src/audit/**`.
   - There is still no cursor, so there is no keyset `OR` and no cross-tenant cursor. The tenant predicate is a sibling inside the same `and()`, never an `or()` branch.
   - **Mutation check:** I neutralised `eq(auditLogTable.workspaceId, workspaceId)`. Both the PR's isolation test and my probe went red (2 failed / 8 passed). I then restored the line.
3. **Existence oracle (#338).** This holds.
   - A foreign workspace id and a nonexistent one return a **byte-identical 403** `You don't have access to this workspace`, with the same headers once `date` is excluded.
   - That is the answer every `fromParam` workspace route gives. #338 changed the asset and websocket routes to 404/401. It did not change the workspace-param family, so this route matches its siblings.
   - The API-key-invalid 403 has a different message, but it depends on the key, not the workspace, so it is no oracle.
4. **Secrets and PII.** This is unchanged from the first review.
   - Returned fields are exactly the 13 listed above. `actor_ip`, `user_agent`, `trace_id`, `api_key_id` and the hashes are not returned.
   - The AU-2 writer backstop is unchanged on `main`. #364 (open) edits `audit-writer.ts` and `actions.ts`, and it must keep that backstop intact. That is #364's review, not this one.
5. **Policies, rbac.md, matrix and coverage.** These hold.
   - The policies match `audit-trail.md` § API and rbac.md: `instance:read_audit` (rbac.md:38), and `workspace:manage_settings`. The list is not elevated; only `/export` is.
   - `test:permissions` passes 81/81.
   - **Shadow mode (#323/#354):** I ran the PR's tests and my probes with `TASKDESK_POLICY_SHADOW=on` and with it off. The results were identical (10/10 each way). Shadow mode observes and never alters the response.
6. **Merges.** The merge was clean (see above). `#308`'s app role holds `SELECT`/`INSERT` on `audit_log`, which is what this route needs.

### Suites at `c0ae25a` (private DB `o343_test`, td-lane-pg, Postgres 18)

| Suite | Result |
| --- | --- |
| Integration (full) | **86 files, 1170 tests, all passed** |
| `audit-read.test.ts` | 6/6 (and 6/6 with shadow on) |
| `test:permissions` | **11 files, 81 tests** |
| Unit (`apps/api`) | **58 files, 488 tests** |
| `check:openapi` | matches (108 operations) |

I ran the probes from a throwaway `zz-opus-probe-343-delta.test.ts` (4 tests). I deleted it without committing it, and `git status` was clean afterwards.

### Findings

**D1 — NON-BLOCKING for this head, and a sequencing tripwire.** Workspace audit reads are still not reach-filtered.
- **Failure scenario:** a PR lands that makes a domain mutation write `project.*` or `work_item.*` audit rows, which #364's key registration enables. Once it merges before #344, a `manager` with no reach into project P reads P's `before`/`after` payloads through `GET /api/workspaces/{id}/audit`.
- **Why it does not block now:** #345 explicitly accepts this state until then, and nothing on `main` writes such a row.
- **Required:** #344 lands first, or the first project-scoped writer's own PR carries the filter. Its Opus review must check this.

**S2 and S3 from the first review are still open. They are unchanged and still non-blocking.**
- **S2:** I re-probed at this head. `action=%00` and `since=0000-01-01T00:00:00Z` still return 500.
- **S3:** `audit.read` still hard-codes `actorType: "person"`, with no `apiKeyId`, IP or user agent.
- **S4:** the global chain lock on every read is also unchanged. It remains a note.

**Nothing new is BLOCKING.**

### Gates at this head (not a security finding, recorded for the orchestrator)

- **CI:** every required check is green **except** `pull request template + security review`, which is **FAILURE**.
  - `check-pr-template.mjs --body` on the live body still exits 1.
  - Every fixed section is missing: `## Implemented by`, `## Reviewed by`, `## Security review`, `## Screens opened`, `## Checklists`, `## Design review H1–H6` and `## Not done`.
- **GitGuardian: FAILURE.** It is not a required check. It is incident **37541345**, "Generic Password", at `charts/taskdesk/values.yaml:245`, which is the key name `passwordKey: postgres_uri`.
  - This is a false positive, and the same incident id #308 raised.
  - It arrives only through the `main` merge commit. This PR's own commits add nothing to the chart.
- **Ordinary review:** there is still no independent ordinary review recorded on the PR.

### Verdict

**CLEAR WITH FINDINGS at `c0ae25aa2a666828e928ee32aee3220966e1e0f1`. I found no blocking security defect.**

- This head keeps everything the first review cleared: authorisation, tenant isolation, oracle parity, field minimisation, and AU-13/AU-14.
- It stays correct under #323/#354 shadow mode, #334's workspace-scoped `sees_all` and #338's oracle work.
- D1 is a merge-ordering constraint on future writers.

**Not merge-ready**, for the gate reasons above. Any new commit to this branch, including a body-only change that moves the reviewed head, needs this clearance re-confirmed at the new SHA.
