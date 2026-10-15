# PR #747 security review record: project realtime socket requires project reach (#745)

PR #747 closes #745. The legacy project socket (`/api/ws/{projectId}`) now requires reach to the specific project.

**At upgrade:** a new `requireLegacySocketProjectReach` middleware checks the origin first, then rejects NUL bytes, then checks project reach.
- An out-of-reach project, another workspace's project, a missing project and a soft-deleted project all get the identical 401.
- No upgrade happens, so no subscription is created.
- The rule covers sessions and API keys. Owners and admins with `sees_all` and instance admins keep access, and a customer reaches only projects of their own organisation.

**After upgrade:** the existing 60-second and per-delivery recheck uses the same helper. Revocation closes the socket with code 1008.

**Guard:** the guard requires the route to carry a reach mark.

A Claude Sonnet 5.5 lane implemented the change. The reviewers below are fresh, independent contexts. Parity with the native socket's capability and scope checks is tracked in #748.

## Review chain

- Ordinary review A by Claude Sonnet 5.5: APPROVE at `9a1caeda`. Two mutants survived, the disabled origin check and the API-key credential check. Tests that kill both were added at `67feeb14`.
- Ordinary review B by Claude Sonnet 5.5 (architecture, native socket, recheck design, docs): APPROVE at `67feeb14`. The native socket already enforces reach per topic. The full serialized suite passed 2830 tests.
- Security review by Claude Opus 5.5: CLEAR at `3e5fd647`, which is `67feeb14` cleanly merged with `main` `9af1ed06`. All 14 bypass variants were refused, the 401s are identical in body, headers and timing, revocation delivers nothing, and 7 of 8 mutations were caught; the survivor is redundant. Capability, scope and connection-limit parity is tracked in #748.
- Security rebind at `036d0ed7`: CLEAR. This head merges `main` `d7ab1a71` (#742). The one conflict, in `project-reach-route-keys.ts`, was resolved by keeping both sides' new key lists. Both guards pass on the merged tree, along with 107 permissions and 124 integration tests.

**Reviewed head:** `3e5fd64735207ea0c26947ae3ec6d57fdb6bf23c`
**Reviewed head:** `036d0ed7a516efe175d25e04c79008b97c858b1f`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `745-ordinary-a-sonnet.md` | Ordinary review A (16234794..9a1caeda) | Claude Sonnet 5.5 | `9a1caeda` | APPROVE | `84437ebd5f9827ac9f89ed642c5857a53e0ce8e938f52af9a74960d6d0c1b109` |
| 2 | `747-ordinary-b-sonnet.md` | Ordinary review B (16234794..67feeb14) | Claude Sonnet 5.5 | `67feeb14` | APPROVE | `09be088ccb91949a74a8dfd89a30dee6bdd57c7025e57a30dac268c598685d63` |
| 3 | `747-security-opus.md` | Security review (9af1ed06..3e5fd647) | Claude Opus 5.5 | `3e5fd647` | CLEAR | `49ec6772f30393ab7b4170aef1e1c7bd43a4ccaa75f1643a1cee5b3effa43125` |
| 4 | `747-036d-security-rebind-opus.md` | Security rebind (4ac27502..036d0ed7) | Claude Opus 5.5 | `036d0ed7` | CLEAR | `eeb9cb11fa626a11e9e97901dfc243367853a463e21422e65e63adac1943cfe7` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/745-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 84437ebd5f9827ac9f89ed642c5857a53e0ce8e938f52af9a74960d6d0c1b109) -->
# #745 / PR #747 ordinary review A (Claude Sonnet 5.5, fresh independent context)

**Reviewed head:** 9a1caedaed9c3be9e2ba5864e9d3fdf344157dbd
**Base / merge base:** origin/main, merge base 16234794f54df11891b17f0132f0107e8848fff0
**Model:** Claude Sonnet 5.5 (did not author, direct or remediate the change)
**Worktree:** /Users/heinthura/.codex/wt-745-rev-a (scratch, detached at the head; removed afterwards). Postgres: private container ws745-rev-a-pg (id 7b2f4ca81f77), db rev_a_745_test, removed by exact id.

## Runs (all at the exact head, unmutated)
- Integration `ws-project-reach.test.ts` + `node-server-websocket.test.ts`: 2 files, 35 tests, pass.
- Integration `nul-byte-param-sweep` + `existence-oracle-317` + `permissions-shadow-mode`: 3 files, 74 tests, pass.
- `pnpm test:permissions`: 16 files, 104 tests, pass (first attempt failed only because I had TASKDESK_DATABASE_URL exported in the shell; clean env passes).
- `tests/api/ws` unit: 10 files, 59 tests, pass.
- `pnpm check:route-policy`: 5/5 tasks successful.
- `pnpm lint:ci`: 2335 files, 0 errors, 210 warnings, 1 info (warnings pre-existing in style; no fixes applied).
- `pnpm typecheck`: 9/9 tasks successful.

## 1. Correctness
- Global `authGuard` (`api.use("*")`) runs before the new middleware, so `userId`/`apiKey`/`session` are set when it runs. Order is origin, NUL, reach, as stated.
- Sessions, API keys (identity resolved as `api_key`; predicate includes the key), owner/admin (`sees_all`), instance admin: all covered by tests and pass. Customer: organisation read from the project row; reach by helper-level test. In practice a customer has no workspace_member row so the workspace predicate refuses first (same as before).
- 401s: I probed headers with a throwaway copy of the test (deleted). Out-of-reach, other-workspace and missing/soft-deleted answer status 401, empty body, same header set; only `x-taskdesk-request-id` differs (per request) and the CORS echo follows the request Origin, so there is no oracle. The committed test compares status and body only (see N2).
- No upgrade: `handshake` rejects if `open` fires; the in-reach socket still receives and the refused one has no socket.
- Recheck: same helper; revocation test closes with 1008. Facts passed (`ancestorProjectIds: []`, `ownerTeamId: null`) match the convention in every other reach site in the repo.
- Behaviour change worth noting: soft-deleted projects are now refused at upgrade (before, only the recheck filtered them). Intended and documented.

## 2. Web client
- The "Live updates unavailable" banner is driven only by `useNativeWorkItemRealtime` (route `/api/ws`, topic subscribe, separate authorisation). That route is untouched.
- `useProjectWebSocket` (project-layout, task-layout) uses the legacy `/api/ws/:projectId`. It never sets a banner; on close it retries up to 5 times (1,2,4,8,16 s) then stops silently. A member who reaches the project: unchanged. A member without project reach now gets 401 and five quiet retries, but that member also cannot read the project over REST, so no wrongful regression. No web code or test change needed; the hook tests mock WebSocket.
- Residual (N4): the legacy hook cannot distinguish 401 from a transient failure and burns its 5 retries for a never-reachable project. Cosmetic.

## 3. Performance
- Recheck (60 s floor and before every delivered event, per socket, serialised) now adds `resolveIdentity` (about 5 queries: user/person/org, workspace_user, workspace_role, memberships, teams) on top of auth plus the project lookup. For an event fanned to N sockets that is about N x 7 queries instead of about N x 2.
- Risk under load: `MAX_PENDING_CHECKS = 64` closes the socket (1008) if more than 64 checks queue behind a slow authority; heavier checks make that threshold easier to hit in event bursts, and pool pressure rises. Suggestion (non-blocking, follow-up): coalesce concurrent checks per connection and cache the result for a short TTL (1-2 s) or per event batch; invalidation already exists (`invalidateNativeAuthorization` -> `reauthorizeLegacyConnections`) so a short TTL does not weaken revocation beyond the 60 s floor.

## 4. Mutations (8 killed or survived as listed; ran ws-project-reach + node-server-websocket, guard via permissions config)
- M1 `reaches()` replaced by `true`: killed (4 failed).
- M2 drop `deletedAt` filter: killed (1 failed, soft-deleted test).
- M3 middleware reach check disabled: killed (4 failed, incl. existing node-server-websocket).
- M4 recheck always true: killed (2 failed, new revoke test and existing workspace-removal test).
- M5 organisationId nulled: killed (customer test).
- M8 reach mark removed: killed (project-reach-guard fails, test file errors).
- M6 NUL check removed: SURVIVED the two ws files; covered by `nul-byte-param-sweep` (not mutation-run there, it exercises `/api/ws/%00x`; I did not rerun it with the mutant). Acceptable.
- M7 origin check disabled in the middleware: SURVIVED. No integration test sends a foreign Origin to the legacy `/api/ws/:projectId` (the existing foreign-origin test targets the native `/api/ws`). The origin check was moved by this PR, so the move is not pinned. See N1.
- M9 identity resolved without the api-key credential: SURVIVED. The API-key test uses a plain enabled key whose owner has membership, so it cannot distinguish credential type. See N3.

## Findings
Blocking: none.

Non-blocking:
- N1 (recommend fixing before or right after merge): add a test that a foreign Origin (and a bad Host) on `/api/ws/{projectId}` returns 403/404 before any reach decision, including for an out-of-reach caller (proves origin-first ordering). The origin check moved from the handler to the middleware with no test on it.
- N2: the identical-refusal test compares status and body only; add headers (minus `x-taskdesk-request-id`) to match the stated invariant.
- N3: add an API-key negative (disabled key, or key whose owner is out of reach) so identity credential handling is non-vacuous.
- N4: legacy hook retries on 401; cosmetic.
- N5: performance suggestion above (coalesce or TTL cache); file as a follow-up with #632.

Not checked: Redis multi-instance fan-out, live browser run, image build/boot (not run; change is API-only, but the repo routine wants it after merge if deploy-affecting).

**Verdict: APPROVE (no blocking findings). Non-blocking N1 recommended before merge.**
<!-- END REPORT (sha256 84437ebd5f9827ac9f89ed642c5857a53e0ce8e938f52af9a74960d6d0c1b109) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/747-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 09be088ccb91949a74a8dfd89a30dee6bdd57c7025e57a30dac268c598685d63) -->
# PR #747 ordinary review B (design, docs, whole realtime system)

**Reviewed head:** 67feeb14d44afb9dc90af93c3b05a7d3326add86
**Base:** main 16234794 (merge base compared with `git diff 16234794 HEAD`)
**Model/context:** Claude Sonnet 5.5, fresh independent context (did not author/direct/remediate; reviewer A report not read before forming this view)
**Worktree:** /private/tmp/claude-501/wt-747-b (detached at the head; removed after the run)

## Runs (all at the exact head, in the scratch worktree)
| Command | Result |
| --- | --- |
| `CI=true pnpm test:integration` (full serialized suite, Testcontainers Postgres managed by the run itself, no container left behind) | 199 files passed, 2830 tests passed, 0 failed (782 s) |
| `CI=true vitest run --config vitest.integration.config.ts ws- node-server-websocket` | 2 files, 37 tests passed (ws-project-reach + node-server-websocket) |
| `vitest run --config vitest.permissions.config.ts` (test:permissions) | 16 files, 104 tests passed |
| `pnpm lint:ci` (biome ci) | exit 0, 0 errors (210 pre-existing warnings) |
| `apps/api pnpm typecheck` (5 tsc projects) | clean |
| `apps/web pnpm typecheck` | clean |
| web `vitest run src/hooks` (realtime hooks incl. use-project-websocket, use-user-websocket, use-native-work-item-realtime) | 28 files, 126 tests passed |

Docker: no container created by me remained (Testcontainers self-cleaned; I stopped/removed nothing else).

## 1. Architecture
- Both sockets are still needed. The web app still uses the legacy `/api/ws/{projectId}` (`use-project-websocket.ts`, mounted in project-layout and task-layout) and `/api/ws/user`; native `/api/ws` carries only work-item topics. realtime.md already says legacy retirement is a separate migration.
- Native `/api/ws` does NOT share the gap. `authorizeNativeTopic` (native-work-item-realtime.ts) resolves identity and requires `evaluateProjectRead(...)` reachable AND capable (`project:read` / `work_item:read`), then `validateWorkspaceAccess`, then API-key permission scope, on subscribe, on every 60 s reauth (per topic) and on control-channel invalidations. Out-of-reach topics get `subscription_denied`. Covered by existing native tests in node-server-websocket.test.ts (grantNativeProjectRead + denied cases). Same defect class is therefore not present on the native path; no decision needed there.
- Legacy upgrade ordering is sound: the global `authGuard` (index.ts ~1346) authenticates and enforces local factor before the route middleware, so `requireLegacySocketProjectReach` always sees `userId`/`session`/`apiKey`. Origin is decided first, then NUL check, then reach; one 401 for out-of-reach / other-workspace / soft-deleted / missing. The mark sits on a middleware because the terminal handler is wrapped by strict-route-registration (author's note; consistent with code).

## 2. Recheck design
- Correctness: the check is stateless and DB-backed (`resolveIdentity` has no cache; `resolveCallerIdentity` reads the per-connection `c` only for credential kind/apiKey/impersonation). Each instance rechecks its own local connections from the DB, so Redis fan-out is correct: project broadcasts reach every instance, each runs `authorization.check(payload)` per local connection; control-channel `identity.invalidate` (userId/projectId filtered) reaches `reauthorizeLegacyConnections` on every instance. No instance-local reach state can go stale.
- Close semantics: a failed/false check calls `ws.close(1008, "authorization unavailable")` and the queued event is not sent; a throw fails closed; per-socket queue is ordered with a 64-pending bound that closes the socket. This matches realtime.md ("closes ... without sending the queued event", "failed authority lookup fails closed", "exhausted bounded authorization queue closes"). realtime.md does not state numeric code 1008 for legacy; nothing contradicts it.
- Cost (non-blocking): per delivered event per connection the check now does authenticateApiRequest + factor check + project query + `resolveIdentity` (user, workspace-membership/role, scoped-role, team queries, 4+ round trips). Pre-PR it was auth + one project query. Not cached or shared across connections of the same user/project. Pre-existing amplifier: `reauthorizeLegacyConnections` ignores `target.workspaceId` (only filters userId/projectId), so a workspace-only invalidation (workspace/index.ts, oidc-login) rechecks every legacy project socket on the instance, now at the heavier cost. Bounded by MAX_PENDING_CHECKS=64 per socket (overflow closes 1008, client reconnects), so degradation is closure not unbounded growth. Acceptable now; the implementer note already flags a per-connection cache as a follow-up if #632 adds push invalidation.
- Revocation (#632): the PR does not close #632 and does not claim to; project-reach loss is observed on the next event or 60 s floor (test proves close 1008). I found no project-membership removal route that calls `invalidateNativeAuthorization({projectId})`, so push revocation for project membership stays #632 scope.

## 3. Docs
- rbac.md addition matches code (origin first, same `reaches()` over persisted facts, customer org from project row, uniform 401, recheck on 60 s floor and before every event, guard + test names correct).
- realtime.md legacy paragraph and test-table row match code and tests (cases listed all exist in ws-project-reach.test.ts). 
- No web-client doc needs a change: the client retries a closed socket up to 5 times with backoff (bounded), and a user lacking project reach is not rendered on that project page.

## 4. Test quality
11 tests in ws-project-reach.test.ts exercise the real Node listener (session, API key, owner/admin/instance admin, identical-refusal incl. headers, no delivery to refused, soft-deleted==missing, revoke closes 1008, foreign Origin before reach, key-vs-session credential, customer org). The route guard (project-reach-guard.test.ts family 3) only asserts the declarative mark is present, but behaviour is covered by the integration file. Three pre-existing legacy tests in node-server-websocket.test.ts now grant project membership, which is the intended behaviour change.

## Findings
Blocking: none.

Non-blocking:
- N1 (design asymmetry, follow-up/decision): legacy check is reach only. Native also requires `project:read`/`work_item:read` capability and honours API-key permission scope (`work_item.read`). A project member whose role lacks read capability, or a narrowly scoped API key, can hold the legacy project socket and receive TASK_* hints. Pre-PR was weaker; the PR's scope is reach (#745), so not blocking, but file or log a decision on whether legacy should also require `project:read`.
- N2 (consistency): native project/work_item topics take `organisationId` from the workspace row and exclude archived projects; legacy now takes it from the project row (rbac step 6) and excludes only soft-deleted. The two paths can disagree for archived projects and for any customer-org mismatch. Align in a follow-up (native should likely read the project row per rbac step 6).
- N3 (cost): see section 2 (no cache; workspace-only invalidation fans out to all legacy project sockets).
- N4 (docs, adjacent, pre-existing): realtime.md lines ~63 and ~114 still describe native `project:{id}` as "workspace reach" while code requires project reach plus capability; and the new realtime.md sentence at line ~44 is an overlong unwrapped line. Cosmetic.

## Not checked
No live multi-instance Redis run (read the adapter/fan-out code only); no load measurement of the added queries; no manual UAT of the web client against the new 401.

## Verdict
APPROVE: no blocking findings at 67feeb14d44afb9dc90af93c3b05a7d3326add86 (ordinary B, design/docs/system angle). Required GPT-6 Sol security review is separate and still applies (security-scope paths).
<!-- END REPORT (sha256 09be088ccb91949a74a8dfd89a30dee6bdd57c7025e57a30dac268c598685d63) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/747-security-opus.md; Claude Opus 5.5; sha256 49ec6772f30393ab7b4170aef1e1c7bd43a4ccaa75f1643a1cee5b3effa43125) -->
# PR #747 security review: legacy project socket requires project reach (#745)

**Reviewed head:** 3e5fd64735207ea0c26947ae3ec6d57fdb6bf23c
**Base:** main 9af1ed063fdc86f2c96f999e7e7fd901c8e68c7b
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context. It did not author, direct or remediate this change.
**Role:** independent security reviewer (sampled big-reviewer role), as requested by the orchestrator. This does not replace the required GPT-6 Sol security gate under CLAUDE.md.
**Date:** 2026-10-14

## Head identity

- `gh pr view 747 --json headRefOid` returned `3e5fd64735207ea0c26947ae3ec6d57fdb6bf23c`. It was the same at the start and at the end of the review.
- The head is a merge of 67feeb14 (the head the Sonnet reviewers saw) with main 9af1ed06.
- `git merge-tree --write-tree 67feeb14 9af1ed06` gives `e4261f52a53374f7eecfd661f762f99db6ee66a1`. That equals `3e5fd647^{tree}`, so the merge is clean and adds no content.
- The review ran in a scratch detached worktree at the exact head. The worktree has been removed.

## Surfaces examined

- `apps/api/src/ws/legacy-project-reach.ts`: new file, read in full.
- `apps/api/src/index.ts`:
  - `authGuard` (about lines 1345–1403): the `/api/ws` host check, `authenticateApiRequest`, factor enrolment and CSRF.
  - The `/ws`, `/ws/user` and `/ws/:projectId` routes.
  - The per-delivery `authorize` closure.
- `apps/api/src/ws/index.ts`:
  - `addConnection`, `deliverToLocalConnections`, `broadcastToProject` (100 ms coalescing) and `reauthorizeLegacyConnections`.
- `apps/api/src/ws/legacy-connection-authorization.ts`: the ordered queue, `MAX_PENDING_CHECKS = 64`, the 60 s floor and the 1008 close.
- `apps/api/src/ws/broadcast-adapter.ts`: the `ProjectBroadcastMessage` payload shape.
- `apps/api/src/utils/has-project-reach.ts`: `resolveCallerIdentity`.
- `apps/api/src/permissions/resolve-identity.ts`: query count only.
- `apps/api/src/utils/workspace-access-middleware.ts`: `reachableWorkspacePredicate`.
- `apps/api/src/utils/authenticate-api-request.ts` and `verify-api-key.ts`: credential sources (headers only) and the key `enabled`/expiry check.
- `apps/api/src/policy-registry.ts`: the `GET /api/ws/{projectId}` entry.
- Tests:
  - `tests/api-integration/ws-project-reach.test.ts` (new)
  - `tests/api-integration/node-server-websocket.test.ts` (changed)
  - `tests/permissions/project-reach-guard.test.ts` (family 3)
  - `tests/api-integration/helpers/project-reach-route-keys.ts`
- Docs: the changes to `docs/01-architecture/rbac.md` and `realtime.md`.
- Prior evidence: `745-impl-sonnet.md`, `745-ordinary-a-sonnet.md`, `747-ordinary-b-sonnet.md`, and issue #748.

## Commands and results

All commands ran in the scratch worktree at 3e5fd647.

Postgres was a private Testcontainers `postgres:18-alpine` database named `taskdesk_test`, started with `CI=true` through `global-setup.ts`. Testcontainers removed its own containers. A `docker ps` before and after shows no new running container left by this review. I removed no other container.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | ok |
| `CI=true vitest --config vitest.integration.config.ts ws- node-server-websocket` | **2 files, 37 tests passed** (`ws-project-reach.test.ts` 11, `node-server-websocket.test.ts` 26) |
| `pnpm test:permissions` (turbo) | **16 files, 104 tests passed**, 5/5 tasks |
| `CI=true vitest --config vitest.integration.config.ts existence-oracle-317 nul-byte-param-sweep permissions-shadow-mode` | 3 files, 74 passed |
| `vitest run legacy-connection-authorization two-entry-host` (unit) | 2 files, 17 passed |
| `vitest run enforcement-config` (unit; this file failed on CI for this head) | 7/7 passed locally. The CI failure is a 10 s timeout in "refuses an invalid source before the production API module can boot", which this diff does not touch. Likely flaky, but the orchestrator must still get it green before merge. |
| `gitleaks git --log-opts=9af1ed06..3e5fd647` | 2 commits scanned, **no leaks found** |
| `gitleaks dir` on each of the 9 changed files | no leaks found (9/9) |
| Adversarial probe file (temporary, deleted, never committed) | 5 tests passed; results below |
| 8 mutations | 7 killed, 1 survived; details below |

### Adversarial probes (real Node listener, real sign-ups)

**1. Path and header variants.**
- The caller was a same-workspace member with no project reach.
- Every request also carried `x-original-url: /api/ws/{id}` and `x-forwarded-host`.
- **None of the 14 variants opened.**

| Variant | Result |
| --- | --- |
| plain path | 401 |
| trailing `/` | 404 |
| `/API/ws/…` | 503 (no route; no upgrade) |
| `/api/WS/…` | 404 |
| `/api//ws/…` | 404 |
| percent-encoded first character of the id | 401 |
| `?apiKey=x&projectId=other` | 401 (credentials come from headers only) |
| trailing `%2F` | 401 |
| `%00` | 400 |
| `/./` and `x/../` (normalised by the client) | 401 |
| `;x` | 401 |
| upper-cased id | 401 |

- Check: the project owner on the percent-encoded path gets **OPEN**.
- This is the expected result. `c.req.param` decodes the id once. The middleware's reach check and the handler's `addConnection` key read the same decoded value, so the id that is checked is the id that is subscribed.

**2. Timing oracle.**
- 40 rounds of each case.
- Median handshake times:

| Case | Median |
| --- | --- |
| out-of-reach (same workspace) | 4.52 ms |
| missing (same user) | 4.48 ms |
| other-workspace project | 4.55 ms |
| missing (stranger) | 4.68 ms |

- Every attempt returned 401.
- The spread is inside the noise. The code does identical work in all cases: identity is resolved first, then one project query with the reach predicate folded in, then the pure function `reaches()`.

**3. Reviewer B's N1, reproduced.**
- A project member whose project role has `capabilities: []` gets **OPEN** on the legacy socket, while `GET /api/project/{id}` returns **403**.
- An API key with `permissions = {workspace:["read"]}` for an in-reach member also gets **OPEN**.

**4. Revoke-then-burst race.**
- Open a socket, delete the project membership, then immediately send 20 `broadcastToProject` calls.
- Result: the socket closed with **1008**, **0 messages were delivered**, and a reconnect got **401**.

### Mutations

Integration mutations were run against `ws-project-reach.test.ts`. The guard mutation was run against `project-reach-guard.test.ts`. Every mutation was reverted with `git checkout`, and the worktree was clean afterwards.

| # | Mutation | Result |
| --- | --- | --- |
| M1 | `reaches()` short-circuited to `true` (back to the pre-PR workspace-only reach) | **killed**: 4 tests fail (identical refusal, no delivery, revoke close, customer org) |
| M2 | drop the `isNull(deletedAt)` filter | **killed**: soft-deleted test |
| M3 | per-delivery recheck ignores reach (`const project = true`) | **killed**: revoke-closes-1008 test |
| M4 | reach evaluated before origin | **killed**: foreign-Origin-first test |
| M5 | existing-but-unreachable project answers 403 (oracle) | **killed**: 3 tests |
| M6 | middleware not wrapped in `markReach` | **killed**: `project-reach-guard` family 3 |
| M7 | `organisationId: null` instead of the project row | **killed**: 2 customer tests |
| M8 | drop `apiKeyId` from `reachableWorkspacePredicate` in the helper | **survived** (non-blocking; see NB-3) |

## Answers to the security questions

### 1. Bypass

**No bypass found.**
- The global `authGuard` authenticates every `/api/ws/*` request before the route middleware runs. So `requireLegacySocketProjectReach` always sees `userId`, `session` and `apiKey`.
- The order is origin, then NUL, then project reach. That order is pinned by tests and by M4.
- Hono routing is strict and case-sensitive. Variants that do not match the route return 404 or 503 and never upgrade.
- Variants that do match decode to the same id that is both checked and subscribed.
- Credentials come from headers only. Query-string keys are ignored.
- The middleware throws before `upgradeWebSocket` runs, so no `onOpen` or `addConnection` happens on a refusal.

**Events between upgrade and the first recheck.** There is no gap.
- Every delivery goes through `conn.authorization.check(payload)`.
- That check runs `authorize()` (re-authentication, factor check, ban/portal check, and `callerReachesLegacySocketProject`) before `ws.send`.
- The checks for one socket are ordered, and a failed check is terminal.

**Reconnect and registration race.** It is closed by the same per-delivery gate.
- An invalidation that arrives while a socket is between upgrade and `onOpen` misses that socket.
- But the socket's first delivery re-checks against the database. The race probe confirmed this: 0 leaked messages.

### 2. Oracle

**No oracle found.**
- Out-of-reach, other-workspace, missing and soft-deleted projects all return the same 401 status, body and headers. The test compares them after excluding only request-id, `access-control-*` and `vary`.
- The `!identity` case returns `false` and gets the same 401.
- NUL returns 400 whether or not the project exists.
- A foreign Origin returns 403 before any reach decision.
- Timing medians are indistinguishable (see probe 2).

### 3. Reviewer B's N1 (no `project:read` or API-key scope on the legacy socket)

**Confirmed real. Non-blocking. Acceptable as the #748 follow-up.**

Reasons:
- **It is not a regression.** Before this PR, the same callers, and every other workspace member, could open the socket. The PR strictly narrows who can.
- **The payload is small.** `ProjectBroadcastMessage` is `{type, projectId, taskId?, sourceTaskId?, targetTaskId?}`: an event type and opaque ids. It has no titles, bodies, assignees or field values.
- **The callers are already known to the project.** They must be project members (or see-all/admin/customer-org) and hold workspace reach. A capability-less member already learns that the project exists from REST, which returns 403 to them, not 404.
- **What leaks is activity metadata only:** which task ids changed, and when.
- **Every built-in role carries `project:read`.** Only custom project roles, or a narrowly scoped key, hit the gap.

**Residual concern.** A narrowly scoped API key (for example workspace-read only) can watch the activity stream of every project its owner reaches. Least-privilege key users would not expect that.

#748 already names "Capability and scope". It should be prioritised alongside the archived-project and customer-org alignment, not left indefinitely.

### 4. DoS

**Non-blocking; tracked in #748 as "recheck cost".**

Cost per delivered event, per connection:
- `authenticateApiRequest` and the factor check;
- `resolveIdentity`, which is about 5 queries (user, members, workspace role, scoped roles, teams);
- one project query.

Before this PR the cost was authentication plus one query.

**Amplification needs an authenticated caller who reaches the project.** Such a caller can:
- open many legacy sockets to that project, because the legacy path has **no** per-person connection cap (the native socket has `MAX_CONNECTIONS_PER_PERSON = 5`);
- cause or wait for project events.

The result is K sockets × events × about 7 queries.

**Mitigations already in place:**
- `broadcastToProject` coalesces by message key over a 100 ms window.
- Each socket's queue is capped at 64 pending checks; overflow closes the socket with 1008. That bounds memory per socket, but not the total number of sockets, and not database load while checks complete.
- Refused upgrades now resolve identity before the lookup (for the oracle's sake). That costs about 6 queries per authenticated attempt, with no rate limit seen on the route.
- `reauthorizeLegacyConnections` ignores `workspaceId` targets. A workspace-only invalidation therefore rechecks every legacy project socket on the instance. This is pre-existing and noted by reviewer B.

**Is the bounded queue sufficient?** It is enough for memory and correctness (it fails closed). It is not enough as a database-load control.

**Recommendation, in #748 or a sibling issue:**
- a per-person cap on legacy sockets, like the native socket;
- coalescing or a short-TTL cache keyed by (connection, credential version), invalidated by the control channel.

### 5. Mutations and runs

See the tables above: 7 of 8 mutations killed; all requested suites green locally; gitleaks clean.

## Findings

**Blocking:** none.

**Non-blocking:**

- **NB-1 (N1, confirmed by reproduction).** The legacy socket admits project members who lack `project:read`, and API keys whose scope excludes project or work-item read. The payload is ids and types only, and access is strictly narrower than before. Tracked in #748; prioritise it.
- **NB-2 (DoS / cost).**
  - Each delivery now costs about 7 queries per connection.
  - There is no per-person cap on legacy sockets.
  - Workspace-only invalidations fan out to all legacy project sockets.
  - It fails closed and memory is bounded. Recheck cost is tracked in #748; add a legacy connection cap there too.
- **NB-3 (test coverage, defence in depth).** M8 survives. Removing the API-key clause from the helper's `reachableWorkspacePredicate` call breaks no test. It is not exploitable: `authenticateApiRequest` and `verifyApiKey` already reject disabled or expired keys, both at upgrade and in every recheck, and `resolveIdentity` refuses a disabled key. A test that disables the key while a socket is open (expecting a 1008 close) would pin it.
- **NB-4 (process, not this diff).** CI on this head shows these failures:
  - `unit + component`: an `enforcement-config.test.ts` timeout. It passes 7/7 locally and is unrelated to this change.
  - `performance - budgets (G11)`.
  - `pull request template + security review`: expected until the security review is recorded.
  - `integration - Postgres 18` was still pending when checked.

  None of these is a security finding. The merge must still wait for all of them to be green.

## Residual risk / not checked

- No multi-instance Redis run. I read the adapter fan-out code only.
- No load measurement of the added recheck queries.
- No check of the deployed image or UAT.
- I did not audit `resolveIdentity`'s internals beyond counting its queries, nor the `reaches()` implementation in `@taskdesk/permissions`. I relied on its existing tests and on M1/M7 for behaviour.
- Archived-project and customer-org-source parity with the native socket is deferred to #748, and I did not re-examine it.
- The timing medians come from a local loopback listener. A remote attacker sees more jitter, so the oracle is weaker for them, not stronger.

**Verdict:** CLEAR
<!-- END REPORT (sha256 49ec6772f30393ab7b4170aef1e1c7bd43a4ccaa75f1643a1cee5b3effa43125) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-14/747-036d-security-rebind-opus.md; Claude Opus 5.5; sha256 eeb9cb11fa626a11e9e97901dfc243367853a463e21422e65e63adac1943cfe7) -->
# PR #747: exact-head security rebind

**Reviewed head:** 036d0ed7a516efe175d25e04c79008b97c858b1f
**Previous security-reviewed head:** 3e5fd64735207ea0c26947ae3ec6d57fdb6bf23c (CLEAR, `747-security-opus.md`, sha256 `49ec6772f30393ab7b4170aef1e1c7bd43a4ccaa75f1643a1cee5b3effa43125`)
**Parents:** 4ac275021c4f564ab0da23ad98caf7b403935c04 (the note commit) and main d7ab1a7153a47f143b7d40d7e376bd59e1949ac3 (which merged #742)
**Merge base:** 9af1ed063fdc86f2c96f999e7e7fd901c8e68c7b
**Reviewer model:** Claude Opus 5.5 (claude-opus-5-5). Fresh independent role; I did not author, direct or remediate this change or its merge.
**Date:** 2026-10-15

This is a sampled Opus check. It does not replace the required GPT-6 Sol security gate.

## Head and main identity

- `gh pr view 747 --json headRefOid` returned `036d0ed7…`.
- `git ls-remote origin refs/heads/main` returned `d7ab1a7153a47f143b7d40d7e376bd59e1949ac3`. Both values held at the start and at the end of this check.
- `git log -1 --format=%P 036d0ed7` returned `4ac27502 d7ab1a71`.

## Note commit 4ac27502 (3e5fd647..4ac27502)

- It adds only `docs/07-planning/security-reviews/747-realtime-project-reach.md` (+384 lines). No code changed.
- The note records my report's SHA-256 as `49ec6772…`. That matches `shasum -a 256` of the private report file.
- The report text embedded in the note equals my report file, ignoring blank lines (`diff` exit 0).

## Merge resolution

- `git merge-tree --write-tree 4ac27502 d7ab1a71` gives tree `da73a0c3…` with one conflict, in `tests/api-integration/helpers/project-reach-route-keys.ts`.
- `git diff --name-only da73a0c3 036d0ed7` lists only that same file. **No other file differs from the merge-tree.**
- **The resolution only concatenates the two sides:**
  - Against the #747 parent (4ac27502), the head adds exactly #742's three exports: `PROJECT_LIST_ROUTE_KEYS`, `PROJECT_BODY_TARGET_ROUTE_KEYS` and `SAVED_VIEW_BY_ID_ROUTE_KEYS`, with their doc comments. They are appended after `PROJECT_SOCKET_ROUTE_KEYS`.
  - Against main (d7ab1a71), the head adds exactly #747's `PROJECT_SOCKET_ROUTE_KEYS` block. It is inserted before `PROJECT_LIST_ROUTE_KEYS`.
  - No line from either side was changed or dropped.
- **The file set from main matches.** `git diff --name-only 036d0ed7^1 036d0ed7` equals `git diff --name-only 9af1ed06 d7ab1a71`: 35 files, `diff` exit 0.

## Interaction with #742

- **`reach-mark.ts`.** #742 adds only an optional `reachFilteredList` field to the mark type. The legacy socket's `markReach(…, { projectReach: true, resources: ["project"] })` is unchanged and still valid.
- **The socket route still satisfies #742's guard.**
  - #742 adds a check over workspace-level GET collections, plus a list of reasoned exemptions.
  - `GET /api/ws/{projectId}` is a `delegated: "websocket"` route addressed to one project, not a workspace-level list.
  - Family 3 in `project-reach-guard.test.ts` (#747) still requires its project-reach mark.
  - The full permissions suite passes on the merged tree (below), with the guard's list and body-target families present alongside family 3.

## Commands and results (merged tree 036d0ed7, scratch worktree, private Postgres)

The database was a private Testcontainers `postgres:18-alpine` (`taskdesk_test`, via `CI=true`). It cleaned itself up. I removed no container by hand.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | ok |
| `pnpm test:permissions --force` (no turbo cache) | **16 files, 107 tests passed**; matches the conductor's 107 |
| `pnpm check:route-policy` | exit 0 (16 files, 107 tests passed) |
| `CI=true vitest --config vitest.integration.config.ts ws- node-server-websocket project-reach-reads project-reach-writes` | **5 files, 124 tests passed**. The files: `ws-project-reach`, `node-server-websocket`, `project-reach-reads`, `project-reach-writes` and `work-item-project-reach-reads` |

## Findings

- **Blocking:** none.
- **Non-blocking:** the items carried over from the CLEAR at 3e5fd647 still stand: N1 parity, recheck cost and the legacy connection cap (tracked in #748), and the survivor mutation M8. Nothing in #742 changes them.

## Residual / not checked

- I did not re-run the adversarial probes or the mutations. `git diff 3e5fd647 036d0ed7` shows no change to `apps/api/src/ws/`, `index.ts`, `has-project-reach.ts` or `resolve-identity.ts`.
- The only dependency of the socket that changed is `workspace-access-middleware.ts`, from #742: it adds saved-view reach. The `reachableWorkspacePredicate` function body is byte-identical (both versions hash to `78d7e992…`).
- Main's changes to `reach-mark.ts` add only a field.
- No CI check for this head was read in this pass; the orchestrator must confirm green.

**Verdict:** CLEAR
<!-- END REPORT (sha256 eeb9cb11fa626a11e9e97901dfc243367853a463e21422e65e63adac1943cfe7) -->
