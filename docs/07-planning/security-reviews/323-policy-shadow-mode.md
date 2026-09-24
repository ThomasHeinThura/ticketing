# Security review — request-path policy shadow mode (issue #8 Slice 2)

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `3c43cb881c4b62fc3a764748981854f2ddee40a0`
**Reviewed SHA:** `3c43cb881c4b62fc3a764748981854f2ddee40a0` (confirmed via `gh pr view 323 --json headRefOid`)
**Pull request:** #323
**Date:** 2026-09-23

**Verdict: CHANGES NEEDED** — one blocking finding (S1). The blocking finding is about
whether the evidence can be trusted, not about runtime behaviour. Shadow mode never changes
a live security decision (see Probe 1).

## Head verification

- `3c43cb8` is a two-parent merge of `06c58b5` (the PR tip) and `dd067e2`. `dd067e2` is
  `origin/main` at review time, and it is the merge base.
- `git diff origin/main...3c43cb8` touches 17 files, which is exactly the PR's file list. The
  merge carried no conflict resolution into PR-owned files.

## Surfaces examined

- `apps/api/src/permissions/shadow-config.ts`, `shadow-evaluation.ts`, `shadow-middleware.ts`,
  `shadow-schema.ts`, `shadow-store.ts` (all read in full)
- `apps/api/src/index.ts`: the auth guard (`api.use("*")`), its `try`/`catch`, `app.onError`, and
  the `eventContext` AsyncLocalStorage (`apps/api/src/events/index.ts`)
- `apps/api/src/utils/workspace-access-middleware.ts` (the whole middleware body, all source types)
  and `apps/api/src/work-item/require-work-item-reach.ts`
- Every `c.set("workspaceId")` site (`task-relation/index.ts`, `require-invitation-workspace-access.ts`,
  `workspace-access-middleware.ts`, `require-work-item-reach.ts`), and every reader of the
  `projectId` / `workItemId` context keys
- `apps/api/src/permissions/resolve-identity.ts` (the loader's query shape) and the pool
  configuration in `apps/api/src/database/index.ts` (`max: 10`, `connectionTimeoutMillis: 5000`)
- `packages/permissions/src/evaluator.ts`: the scope constructors, and the
  `scope_mismatch`/`scope_source_mismatch` checks (around lines 1181–1205)
- The registry policies with `scopeSource: "request"` (in `capabilities`, `workspace`, `label`,
  `search`, `project` and `work-item` `policy.ts`), plus `invitation/policy.ts` and the
  websocket entries in `policy-registry.ts`
- `apps/api/drizzle/0068_policy_shadow_tables.sql`, `meta/0068_snapshot.json`, `meta/_journal.json`,
  `drizzle.config.ts`, and the drizzle-orm migrator (`pg-core/dialect.js`)
- Hono 4.13.5's `HonoRequest.matchedRoutes` and `compose`
- The PR body and both Sonnet reviews, issue #8 (the plan, the addendum and the prerequisites),
  issue #324, the 2026-09-23 decision-log entry on the branch, and
  `security-reviews/315-resolve-identity.md`

## Suites at this head

These ran on a private database, `pr323_opus_test`, on td-lane-pg, which was dropped afterwards.

- API unit (`vitest.config.ts`): **55 files, 433 tests, all passed.**
- Integration (`vitest.integration.config.ts`, full suite): **80 files, 1086 tests, all passed.**
- `pnpm test:permissions`: **10 files, 80 tests, all passed.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, all passed.**

## Probes

I wrote one throwaway probe file, `tests/api-integration/zz-opus-probe-323.test.ts`. It ran
against the real `createApp()` with `TASKDESK_POLICY_SHADOW=on`, the real registry, and real
Postgres. I did not commit it. Every result quoted below was observed, not inferred.

1. **Can shadow mode change a security decision? No.**
   - `runNextWithPolicyShadow` calls `next` exactly once on both branches, so legacy code
     can't run twice or be skipped.
   - Everything after `await next()` is synchronous and can't throw: it reads `c.res.status`
     and calls a pure function. The rest runs through `void runShadowEvaluation(...).catch(...)`.
     So nothing can reach the guard's `catch` and turn into a 500.
   - `next()` itself can't reject for an `HTTPException`, because Hono's `compose` converts it
     through `app.onError` at the level where it was thrown. By the time the shadow code runs,
     the response already exists.
   - The shadow path reads the context and never writes to it. It never reads the request body.
   - The new keys `projectId` and `workItemId` have **no reader** outside
     `permissions/shadow-*.ts`: a search for `get("projectId"|"workItemId")` and `c.var.` across
     `apps/api` found none.
   - `workspaceId` is set at the same points to the same values as before, and the new keys are
     set after it. The extra `id` and `projectId` columns in `require-work-item-reach.ts` are
     added to the same select with the same join and filter.
   - The only inherited state is the `eventContext` ALS, and the shadow path emits no events.
   - The two Sonnet reviews found responses byte-identical with shadow on and off. My probe runs
     agree: every status matched the legacy expectation.

2. **P1 — route attribution. Is the route key forgeable? No. Is it always correct? No (S2).**
   - The route key comes from the router's matched *pattern*, not the raw URL or a header, so a
     caller can't forge it and can't inflate its cardinality.
   - I enumerated every registered `/api` handler. For each one, I built a concrete path and
     compared the entry that actually runs (the first handler that isn't `ALL`) with the
     `matchedRoutes.at(-1)` the shadow uses.
   - Three routes below the guard are attributed to the wrong route:
     - `PUT /api/project/reorder` is recorded as `PUT /api/project/{id}`. Probe 5 confirmed this
       over HTTP: the tally row is `["PUT /api/project/{id}","unevaluated","row_scope_unavailable",1]`.
     - `GET /api/invitation/pending` is recorded as `GET /api/invitation/{id}`.
     - `GET /api/ws/user` is recorded as `GET /api/ws/{projectId}`.
   - The other 16 mismatches are routes above the guard. They never reach the wrapper.

3. **P2 — the trace id.** `x-request-id` is the only source of the trace id, and nothing else in
   `apps/api` reads or generates it. An 8,007-character forged value was stored verbatim
   (`traceLen=8007`). See S3.

4. **P3 — crowding out the cap.** A member of workspace A sent 60 `PUT /api/label/{id}` requests
   for a label in workspace B. The result was `events=50` and a tally `count=60`, so the tally
   stays exact and the detail rows are capped. See S4.

5. **P4 — burst load.** `GET /api/workspace/{id}` was sent in-process, with pool `max: 10`. Every
   response was 200 in both modes, and the tally summed exactly to N.

   | N / concurrency | shadow | wall | p50 | p99 | peak pool waiters | waiters at end | drain | heap |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | 3000 / 300 | off | 1.6 s | 131 ms | 207 ms | 587 | 0 | 0 | 201 MB |
   | 3000 / 300 | on | 6.0 s | 594 ms | 672 ms | 889 | 290 | 0.4 s | 249 MB |
   | 8000 / 2000 | off | 5.4 s | 1.08 s | 1.77 s | 3984 | 0 | 0 | 260 MB |
   | 8000 / 2000 | on | 20.5 s | 4.32 s | 8.31 s | 5987 | 1990 | 3.6 s | 561 MB |

   See S5.

6. **P6 — request-sourced workspace routes.** An admin called `GET /api/project?workspaceId=<own>`
   and `GET /api/label/workspace/<own>`, and both returned 200. Each one recorded
   `legacy_allow_policy_deny` / `scope_source_mismatch`, with the diagnostic *"This route's
   policy declares scopeSource "request", and the resolved scope came from "row""*. See S1.

7. **The instance-admin bypass** is recorded as `legacy_allow_policy_deny`. The PR's own
   integration test shows this on `PUT /api/label/{id}` (a row-sourced route), and the test
   passes at this head. On request-sourced routes S1 masks it.

## Findings

### S1 — BLOCKING — the shadow path builds a `RowScope` for every workspace policy, so every request-sourced workspace route records a false `legacy_allow_policy_deny`

`shadow-evaluation.ts:181-185` always calls `workspaceScopeFromRow({ workspaceId })`, whatever
the policy's `scopeSource` says. 16 registry entries declare `scope: "workspace", scopeSource: "request"`:

- `GET /api/capabilities`;
- the workspace members, roles, invitations and transfer-ownership routes;
- `GET /api/label/workspace/{workspaceId}` and `POST /api/label`;
- `GET /api/search`;
- `GET /api/project`, `POST /api/project` and `PUT /api/project/reorder`.

For every one of them, the evaluator refuses at the source check (`evaluator.ts` ~1193,
`scope_source_mismatch`) *before* it looks at the capability. The comparison then files that
refusal as `legacy_allow_policy_deny` (`shadow-evaluation.ts:281-290`). Probe 6 shows this.

Why it matters for safety:

- **No capability comparison runs on these routes at all.** A real disagreement there, such as
  the instance-admin bypass (#315 S8) or a custom role missing a capability, gets the same
  outcome and the same reason code as the shadow's own mistake.
- **The cut-over rule is "zero *unexplained* disagreements".** The easy explanation for these
  buckets is "a Slice 2 artifact", and that explanation would also wave through a genuine
  disagreement hidden inside them. That is the unsafe cut-over this evidence exists to prevent.
- **The PR body's coverage table and the decision-log entry are wrong about this.** Both say
  workspace-scoped capability policies are evaluated "fully". For request-sourced ones that is
  false.
- **It works against a Done-when item of #8.** "RowScope from loaded authoritative data, never a
  request hint" is one of #8's Done-when items. The shadow labels a request-derived value as
  row provenance: it comes from `fromQuery`, `fromBody` or `fromParam` and is membership-checked,
  but it is not a loaded row. This is inert here, but it is the pattern #8 forbids, sitting in
  the code that later slices will copy.

**Required fix:**

- In `buildShadowPolicySide`, branch on `policy.scopeSource`:
  - `"request"` → `workspaceScopeFromRequest({ workspaceId })`. This is legitimate: the value has
    already passed `validateWorkspaceAccess`.
  - `"row"` → `workspaceScopeFromRow` only.
- An evaluator decision whose code is `scope_mismatch` or `scope_source_mismatch` is caused by
  the shadow's own construction. Never file it as a disagreement: record it as `unevaluated`
  with a new reason (for example `scope_source_unavailable`). Or prevent it entirely.
- Add a unit test for each source, and an integration test on one request-sourced route that
  asserts `agree` for an allowed member.
- Correct the PR body's coverage table and the decision-log entry to match.
- Longer term, and in scope for #324: have `workspace-access-middleware.ts` expose *which*
  source kind produced `workspaceId` (row lookup or request value), so a `"row"` policy is only
  ever evaluated against a value that really came from a row.

### S2 — NON-BLOCKING — `matchedRoutes.at(-1)` puts three routes' evidence under the wrong route

`shadow-middleware.ts:140` assumes the last matched entry is the route that ran. When a literal
route and a parameter route both match a path, Hono runs the *first* one, but `at(-1)` returns
the *last*.

Probe 1 found three such routes: `PUT /api/project/reorder`, `GET /api/invitation/pending` and
`GET /api/ws/user`. Their traffic is evaluated against the other route's policy, and their own
route key never gets a tally row. A cut-over PR could then read that as "no traffic" rather than
"never measured".

Today all three fail safe:

- `reorder` lands in `{id}`'s bucket as `unevaluated`;
- `{id}` for invitations has no policy (#254), so its bucket is `unevaluated`;
- both websocket routes are `delegated`.

The same mechanism would give false `agree` results as soon as #324 widens coverage.

**Fix before any cut-over of the project, invitation or websocket router, and ideally in the S1
round:**

- select the first matched entry that isn't `ALL`, or cross-check it against `c.req.routePath`;
- commit Probe 1 as a permanent test: for every registered handler, the attributed key must
  equal the handler's own key.

### S3 — NON-BLOCKING — the trace id is caller-controlled, unbounded, and correlates with nothing

`shadow-middleware.ts:152` stores `x-request-id` verbatim (8,007 characters in Probe 2).
Nothing server-side generates the header or logs it, so it can't be joined to any server log.
Anyone can forge it to make one event row look like another.

This doesn't decide anything, but the addendum treats it as attribution. **Fix:**

- generate a server-side id per request, or accept the header only if it matches
  `^[A-Za-z0-9._-]{1,128}$` and otherwise store a generated one;
- document the trace id as untrusted.

### S4 — NON-BLOCKING — the 50-row cap can be crowded out, but the tally can't be diluted

Diluting doesn't work:

- "clean" means zero unexplained disagreements, not a ratio, and a flood of `agree` rows
  can't lower a disagreement count;
- the route key comes from the pattern, so it can't be forged (Probe 1);
- the outcome is computed on the server.

Crowding out does work. Probe 3 showed that any authenticated user can fill a bucket's 50
detail rows with their own requests, early in the UTC day. A real third-party disagreement
later in that bucket then has **no attributable row** (no workspace, no identity kind, no
trace id), although the tally still counts it. `shadow-store.ts:145-167`.

The runbook's summary SQL should state the rule outright:

- a bucket whose `count` is higher than its event rows can't be declared "explained" row by
  row, so it is not clean until every one of its requests is accounted for;
- and consider sampling per `(bucket, workspace_id, identity_kind)`, so one caller can't take
  up a whole bucket.

### S5 — NON-BLOCKING, before any non-UAT enablement — shadow work competes unbounded for the 10-connection pool

Each shadowed request adds a fire-and-forget chain of:

- 3 `resolveIdentity` queries;
- a hot-row tally upsert;
- for any outcome other than `agree`, a `count(*)` query plus an insert.

None of it has a concurrency bound or backpressure, and it shares the pool that legacy queries
use (`database/index.ts`, `max: 10`).

Probe 4 measured a latency increase of about 4.5× on legacy requests under a burst:

- p50 went from 131 ms to 594 ms, and at concurrency 2000 p99 went from 1.8 s to 8.3 s;
- throughput fell to about a quarter;
- 1,990 pool waiters were still queued after the burst ended;
- heap doubled, from 260 MB to 561 MB.

There were no errors at these sizes. But the pool queue has no limit, so enough load pushes
legacy waits toward `connectionTimeoutMillis`.

The PR body's "~1.2–1.5 ms" figure is for a single sequential stream, and it hides this
contention. It is acceptable for UAT soak traffic. **Before production enablement:**

- aggregate tallies in memory and flush them every few seconds;
- bound in-flight shadow evaluations with a semaphore;
- when saturated, drop and *count* the drops, persisting that count as its own `unevaluated`
  reason so coverage stays honest.

### S6 — NON-BLOCKING — the prune is bounded, but it may not keep up

`shadow-store.ts:66-102`:

- **It is capped low.** Each process deletes at most 5,000 rows per table per UTC day. The
  event table can take up to 50 rows × (route × outcome × reason) buckets per day, which is
  more than 5,000 at the registry's current size, so a backlog can grow for good.
- **A failed prune waits a day.** `lastPruneDay` is set *before* the deletes, so a failed prune
  isn't retried until the next day.

Loop the batch until fewer than `PRUNE_BATCH_SIZE` rows are deleted, with a cap on the total,
and set the guard only after the prune succeeds. Each statement is bounded, so this is not a
risk to request latency.

### S7 — NON-BLOCKING, judgement — the evidence tables can be tampered with by the app role

After #308 the single app role can UPDATE and DELETE both tables. It also owns them, so a
trigger can be disabled by that same role. Anyone who can already run arbitrary SQL as the app
role has worse options than rewriting evidence, so this is not a boundary. It *is* an integrity
guard against an app bug, or a "cleanup" run by hand before a cut-over.

**Recommendation:**

- On `policy_shadow_event`, add a trigger in the style of `audit_log`: reject every UPDATE, and
  allow DELETE only for rows older than the retention window.
- On `policy_shadow_tally`, allow an UPDATE only when the bucket key is unchanged and
  `NEW.count > OLD.count`.
- Every cut-over PR pastes the runbook summary output as it stood at decision time, so the
  evidence it cites can't later change underneath it.

I do not require this before merge.

### S8 — NON-BLOCKING, for #324 — the legacy outcome is inferred from the HTTP status, and some legacy denials are 400s

`isLegacyDenialStatus` (`shadow-evaluation.ts:311`) counts only 401, 403 and 404 as denials.
`workspace-access-middleware.ts` denies an out-of-reach `fromProject` id with **400**
(`:304`, "Workspace ID could not be determined"). `lookupMany` has the same pattern (`:286`).
Such requests are stored with `legacy_allowed = true`.

Today they are folded into `unevaluated`, because `workspaceId` is never set on that path. So
they cannot produce a false `agree` yet. But once #324 exposes rows *before* the deny, a
legacy 400 denial that the policy allows would be counted as `agree`. That would hide
`legacy_deny_policy_allow`, the one dangerous disagreement class.

**Before #324 widens row exposure:** have the legacy middleware record its authorization
decision explicitly, as a read-only `c.set`, rather than inferring it from the status. I recommend
adding this to #324's acceptance criteria (I did not edit the issue).

### S9 — NON-BLOCKING — how to renumber migration `0068`

The migration itself is additive (`CREATE TABLE` / `CREATE INDEX`) and forward-only.

**Both PRs use the same `when`.** #322 (`0068_workspace_role_is_system`, still OPEN) and this
PR both claim `idx: 68` **and the same `"when": 1790200000000`**. drizzle's migrator applies a
migration only when `last_applied.created_at < folderMillis` (`pg-core/dialect.js:62`). So if
the second PR is renumbered but its `when` is not raised, **every database that already applied
the first PR, UAT included, silently skips the second migration**. For this PR, that means the
shadow tables never exist, every write fails and is only logged, and no evidence is collected.

**Whichever PR merges second must:**

1. rename its SQL file to `0069_…`;
2. set that PR's journal entry to `idx: 69` and `tag: "0069_…"`, with a `when` strictly greater
   than the first PR's (for example `1790210000000`);
3. rebuild `meta/0069_snapshot.json` with `prevId` set to the first PR's `0068` snapshot `id` and a
   fresh `id`, keeping the first PR's schema changes;
4. check on a database already migrated through the first PR's `0068` that the second migration
   actually applies.

**The shadow tables are outside the snapshot, on purpose.** The PR's `0068_snapshot.json`
contains no `policy_shadow_*` table (it is 0067's table set under a new id), because
`drizzle.config.ts` reads only `schema.ts`. That is consistent, but drizzle-kit will never
detect drift on these two tables. Document it next to `shadow-schema.ts`.

### S10 — NON-BLOCKING, informational — data exposure is low

- The event rows hold ids, decision codes and fixed diagnostic templates. No body, header,
  secret, email or name is stored.
- `workspace_id` can name another tenant's workspace: `require-invitation-workspace-access.ts`
  sets it from the invitation row before any membership check. It is an id only, and it can
  only be read through the database.
- The `evaluator_threw` diagnostic stores `error.message`. For a database failure inside
  `resolveIdentity` that can include drizzle's "Failed query … params: <userId>" text.
  Acceptable, because the user id is not a secret; truncate the message if convenient.
- No route reads these tables.

## Verdict

**CHANGES NEEDED** at `3c43cb881c4b62fc3a764748981854f2ddee40a0`:

- **S1 must be fixed**, with its tests and corrections to the coverage table and decision log,
  before merge. Its fix is small and sits inside `shadow-evaluation.ts`.
- **S2 is best fixed in the same round.**
- **S3–S8 and S10 can follow**, most naturally in #324.
- **S9 must be applied by whichever PR merges second.**

Shadow mode is inert for live authorization at this head: I found no path by which it changes a
response, a context value a legacy check reads, or the number of times legacy code runs.

A delta review after the fix needs to check only:

- S1's scope construction, and its tests;
- S2, if it is included;
- that the shadow path still never writes a context key or response.

---

## Delta review — fix round `5d26f79`

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this fix round.
**Reviewed head:** `5d26f79ba32b31dfe5f28a14af99ebc453371aab`
**Commits since the note (`c697d35`):** one, `5d26f79 Cline (shadow fix round) fix(permissions): resolve #323 Opus findings S1-S7`.
Its parent is `c697d35`, and there is no `main` merge in between.

**Delta verdict: CHANGES NEEDED.**

- **S1 is fixed.**
- **S2, S3, S4 and S6 are fixed**, with small residuals listed below.
- **S5 is bounded and fast.** But it brings in one new blocking defect, D1: dropped
  evaluations are filed under a fake router group, so a saturated router looks clean in the
  per-router summary.
- **Separately, S9 is now live.** #322 has merged, `main` holds
  `0068_workspace_role_is_system.sql`, and this PR is `CONFLICTING`.

### Scope of the fix round

- **Code:** only `apps/api/src/permissions/shadow-evaluation.ts`, `shadow-middleware.ts` and
  `shadow-store.ts`.
- **Tests:** `tests/api/permissions/shadow-evaluation.test.ts` and
  `tests/api-integration/permissions-shadow-mode.test.ts`.
- **Docs outside the shadow files:** `docs/01-architecture/data-model.md` (the `trace_id` note),
  `docs/05-operations/runbook.md` (the S4/S7 rules and the check query), and
  **`docs/07-planning/decision-log.md`** (the "Coverage in this slice" paragraph was rewritten
  in place). See D3.
- **Nothing else:** no change to `index.ts`, `workspace-access-middleware.ts`,
  `require-work-item-reach.ts`, the migration or `packages/**`.
- **Still write-free:** a search of the three shadow files for `c.set`, `c.res =`, `c.header(`
  and `c.status(` found nothing. The new synchronous work after `await next()` can't throw:
  `attributedRouteKey` (a `find`, plus `normaliseRouteKey` inside a `try`) and the counter/queue
  bookkeeping. Evaluation is still fired off without being awaited.

### Suites at `5d26f79`

These ran on a private database, `pr323_opus_delta_test`, which was dropped afterwards.

- Unit: **55 files, 438 tests, all passed.**
- Integration: **80 files, 1092 tests, all passed.**
- `test:permissions`: **10 files, 80 tests, all passed.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, all passed.**

### Delta probes

These used a throwaway, uncommitted file, `tests/api-integration/zz-opus-delta-323.test.ts`,
with the real `createApp()`, shadow on, and real Postgres.

- **S1, over HTTP.**
  - **Allowed requests agree.** A workspace admin and an ordinary member each called
    `GET /api/project?workspaceId=<own>` and `GET /api/label/workspace/<own>`. Every call
    returned 200, and every tally was `agree` (count 2 per route).
  - **The instance-admin bypass is still recorded, with the right reason.** An instance admin
    who isn't a member got 200 on both routes. Both were recorded `legacy_allow_policy_deny`
    with `reason_code = forbidden` and `policy_code = forbidden`. That is a real capability
    denial, distinct from the new artifact code `scope_source_unavailable`.
  - **Fixed.**
- **S2.** I enumerated all 102 handlers registered below the guard. With the new rule (the
  first matched entry that isn't `ALL`), **0** are attributed to the wrong route.
  - Over HTTP, `PUT /api/project/reorder`, `GET /api/invitation/pending` and `GET /api/ws/user`
    each landed on their own key.
  - A path that matches no route (`/api/definitely-not-a-route`) is now not tallied at all.
    Before, it was tallied as `ALL /api/*`. That's acceptable, because no router owns it.
  - No `ALL`-method handler that isn't a wildcard exists below the guard, so no real route
    goes uncounted.
  - **Fixed.**
- **S3.**
  - **Absent header:** a server-generated UUID was stored (36 characters).
  - **Well-formed header:** `forged-trace.1` was stored as sent.
  - **Oversized or malformed header:** replaced by a generated UUID. The unit tests cover this,
    and so does the `{1,128}` pattern.
  - **Bounded: fixed.** It is still forgeable within that format. The code comment says so, but
    the new `data-model.md` text says the opposite. See D2.
- **S4.** The runbook now says that a bucket whose tally is higher than its event count
  "cannot be declared clean", and it adds a check query for this. **Fixed.**
- **S5, burst on `GET /api/workspace/{id}`, pool `max: 10`.**

  | N / concurrency | shadow | wall | p50 | p99 | peak pool waiters | dropped |
  | --- | --- | --- | --- | --- | --- | --- |
  | 3000 / 300 | off | 1.47 s | 121 ms | 213 ms | 586 | — |
  | 3000 / 300 | on | 1.42 s | 122 ms | 150 ms | 596 | 2800 |
  | 8000 / 2000 | off | 3.66 s | 791 ms | 912 ms | 3984 | — |
  | 8000 / 2000 | on | 3.90 s | 852 ms | 970 ms | 3998 | 7848 |

  - **Latency is back to the shadow-off level.** Before this round it was 594 ms / 672 ms and
    4.3 s / 8.3 s.
  - **Everything is counted.** The tally sums to exactly N, and the queue drains in about
    160 ms.
  - **Bounded: fixed.** But see D1.
- **S6.** The prune now loops over batches until it drains (capped at 200k rows), and it sets
  the day-guard only after it succeeds. **Fixed.** See D4 for residuals.

### Delta findings

#### D1 — BLOCKING — saturation drops are filed under `router_group = 'shadow-control'`, so a saturated router looks clean in the per-router summary

`shadow-store.ts:209` hard-codes `routerGroup: "shadow-control"` for `shadow_saturated` rows,
although the route key is known.

In the burst above, the tally for the workspace router
(`apps/api/src/workspace/policy.ts`) showed **only** `agree` (200, and then 152), while
**2,800 and then 7,848** of that router's requests were never evaluated. Those sat in a
separate `shadow-control` group.

The runbook's per-router summary and coverage queries both group by `router_group`. The
summary is what a cut-over PR cites. So on the evidence it is told to cite, a router where 93–98% of
requests were dropped reads as clean and exercised. That is exactly the falsely-clean router
this mechanism exists to prevent.

The new cap-check query happens to list the bucket, keyed by route, but nothing ties that
result back to the router's verdict.

**Fix:**

- write the drop row with the same group the evaluated rows use:
  `routerGroupFor(policyRegistry.get(routeKey)?.source)`, called from the middleware and passed
  in;
- add an assertion to the existing S5 integration test that the `shadow_saturated` row's
  `router_group` equals the route's registry source;
- optionally, have the runbook call `shadow_saturated` out as an unexplainable reason: a router
  with any such rows in the window is not clean.

#### D2 — NON-BLOCKING — the `trace_id` text in `data-model.md` is inaccurate

The table row now says the trace id is "generated server-side; never copied from an untrusted
request header". The code *does* copy a header that matches `^[A-Za-z0-9._-]{1,128}$`, and
the probe stored `forged-trace.1` as sent.

The code's own comment is correct ("untrusted even when it passes"). Make the data-model row
say the same.

#### D3 — NON-BLOCKING, for the orchestrator — `decision-log.md` was edited by the fix-round lane

The decision log is orchestrator-owned. The commit rewrites the entry's "Coverage in this
slice" paragraph in place. The commit message says it was "adopted from the parallel
orchestration context". The entry isn't on `main` yet, so this isn't an append-only violation
against `main`. But the orchestrator must confirm it owns the text.

The corrected paragraph now matches S1 (`RequestScope` for request-sourced policies), but two
points in it are still wrong:

- It says a denied request whose scope was not exposed becomes
  `unevaluated: scope_source_unavailable`. That code is only the shadow-artifact fallback. An
  unexposed scope is `row_scope_unavailable`.
- It doesn't mention the new `shadow_saturated` reason.

#### D4 — NON-BLOCKING — the prune has no in-progress guard and no retry backoff

The day-guard is now set only after success (`shadow-store.ts:110`), which is what S6 asked
for. This creates two new problems:

- **Concurrent prunes.** The first evaluations of each UTC day, up to the 8 in flight, each run
  their own prune loop at the same time.
- **Retries on every evaluation.** A persistent prune failure retries on every single
  evaluation, adding 2 failing DELETEs each time.

The S5 limit keeps both away from the pool, so there is no risk to legacy requests. **Fix:**
add an in-progress flag and a retry backoff (for example, at most once per hour after a
failure).

#### D5 — NON-BLOCKING, pre-existing, noted for the per-router soak — delegated routes where the handler denies itself

`GET /api/ws/user` without an upgrade header was recorded `legacy_deny_policy_allow`, the
dangerous class by name.

- A `delegated` policy always allows, while the handler's own authentication answer was a
  denial status.
- The old attribution produced the same result under `GET /api/ws/{projectId}`, so this isn't
  a regression.
- It fails safe, because the router isn't clean.
- But it puts noise into the one class that must stay meaningful.

For #324: compare `delegated` routes as `unevaluated: delegated_to_handler` rather than
filing them as a disagreement.

#### S9 — now required, not conditional

**#322 has merged.** `main` (`33ce9ec`) now holds `0068_workspace_role_is_system` with
`when: 1790200000000`, and #323 is `CONFLICTING`. This PR is the one that must renumber:

1. rename its migration to `0069_policy_shadow_tables.sql`;
2. set its journal entry to `idx: 69`, with a `when` **strictly greater than 1790200000000**. If
   `when` isn't raised, every database already migrated through #322 silently skips the tables;
3. rebuild `meta/0069_snapshot.json` from `main`'s `0068` snapshot, with that snapshot's `id` as
   `prevId`;
4. prove it applies on a database already at `main`'s `0068`.

The merge and renumber change the head. **So the final gate is a further delta review, limited
to the migration and journal and the merge's conflict resolution, plus D1.**

### Items from the original review not addressed, and not required for merge

- **S7:** the trigger. The runbook now carries the "paste the summary at decision time" rule,
  which covers the procedural half.
- **S8:** tracked for #324.
- **S10:** informational.

---

## Delta review 2 — squashed candidate `8fe8fdf`

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `8fe8fdf16db53e7de2d43344f3fcdcee7e89c617`
**Date:** 2026-09-24

**History rewritten.** The branch was squashed into one commit on top of `main` `7bebaf6`
(which includes #322, #308, #336, #345, #350 and #351):
`8fe8fdf feat(permissions): add policy shadow mode for request paths`, author `Claude Code`,
parent `7bebaf6` = `origin/main` = the merge base.

Because the history was rewritten, I reviewed the **whole** squashed diff against
`origin/main`, which is 19 files. The previous sections of this note survive byte-identical
inside the squash (checked against the earlier note commit `bc43606`).

**Verdict at this head: CLEAR WITH FINDINGS.**

- D1 and the S9 renumber are verified.
- S1–S6 still hold.
- There are no blocking findings.
- Two process items are for the orchestrator (E1, E2).

### What the squash contains beyond the reviewed shadow slice

Compared with the last reviewed code (`5d26f79`), the only shadow-code changes are D1 and D4:

- `shadow-middleware.ts`: drops now carry the route's real router group;
- `shadow-store.ts`: `recordShadowDrops(routeKey, routerGroup, count)`, plus a prune
  in-progress flag and a one-hour retry backoff;
- `shadow-schema.ts`: comment references changed `0068` → `0069`;
- one new assertion in the integration test;
- one new sentence in the runbook.

`resolve-identity.ts` and the other differences from `5d26f79` all come from `main` (#322 and
#308), not from this PR. `git diff origin/main...8fe8fdf` doesn't touch those files.

The PR's own files beyond the shadow slice are the ones below:

- `docs/07-planning/status.md` (+7 lines);
- `docs/07-planning/decision-log.md` (+56 lines, **two** new entries);
- `docs/05-operations/configuration-reference.md` (`TASKDESK_POLICY_SHADOW`);
- this note.

See E1.

**Invariant rechecked:** a search of `shadow-*.ts` for `c.set`, `c.res =`, `c.header(` and
`c.status(` found nothing. The `index.ts` hunk is the same one-call wrap as before, inside the
existing guard, and `workspace-access-middleware.ts` and `require-work-item-reach.ts` still
only add `c.set` calls. **Shadow mode still writes nothing to the context or the response.**

### Suites at `8fe8fdf`

These ran on a private database, `pr323_opus_d2_test`, which was dropped afterwards.

- Unit: **58 files, 476 tests, all passed.**
- `test:permissions`: **10 files, 80 tests, all passed.**
- `node --test 'scripts/ci/**/*.test.mjs'`: **495 tests, 88 suites, all passed.**
- **Integration, full suite: 84 files, 1150 tests, all passed on the second run.**
  - The first run failed 1 of 1150: `task.test.ts` › "creates an unassigned task when the
    assignee userId is empty".
  - The cause was a Postgres deadlock (`40P01`) between the harness's `TRUNCATE` and a lock on
    `task` / `task_activity`, a lock the shadow never takes. That file has shadow off.
  - The file passed 12/12 on its own, and the full suite then passed 1150/1150.
  - So this is a pre-existing harness flake that the shadow didn't cause. It isn't counted
    against this PR.

### Probes

I used throwaway files, now deleted, with the real `createApp()`, the real registry and real
Postgres.

1. **D1: fixed.** Bursts on `GET /api/workspace/{id}`, with shadow on and the per-router
   summary grouped by `router_group`:
   - At 3000 requests / concurrency 300: `apps/api/src/workspace/policy.ts` showed
     `agree 168` and `unevaluated/shadow_saturated 2832`.
   - At 8000 / 2000: that group showed `agree 152` and `unevaluated/shadow_saturated 7848`.
   - The saturated router's own summary now shows its drops, and there is no `shadow-control`
     group.
   - The runbook names `shadow_saturated` as never explainable, so a router with any such row
     isn't clean.
   - The new integration assertion covers this too.
2. **S5 re-measure.** Every response was 200 in both modes.

   | N / conc | shadow | p50 | p99 |
   | --- | --- | --- | --- |
   | 3000 / 300 | off | 128 ms | 213 ms |
   | 3000 / 300 | on | 137 ms | 214 ms |
   | 8000 / 2000 | off | 1247 / 848 ms | 1512 / 970 ms |
   | 8000 / 2000 | on | 1123 / 872 ms | 2168 / 1272 ms |

   The 8000 / 2000 rows are two paired runs, and host load varied between them.

   - p50 is at the shadow-off level.
   - p99 under extreme concurrency is about 30–40% higher than with shadow off. It was 4.5× higher
     before the bounds. See E3.
3. **S1, over HTTP.**
   - A plain member got 200 on `GET /api/project?workspaceId=<own>` and on
     `GET /api/label/workspace/<own>`, and both recorded **`agree`**.
   - A non-member instance admin got 200 on `GET /api/project`, recorded
     **`legacy_allow_policy_deny`** with `reason_code = forbidden` and
     `policy_code = forbidden`. That is distinct from the artifact code
     `scope_source_unavailable`.
4. **S2.** All 102 handlers below the guard are attributed to their own key, with **0**
   mismatches.
5. **S3.** Headers of 8,000 characters were replaced by a generated 36-character UUID. The
   unit tests cover the `{1,128}` pattern. **D2 is fixed:** `data-model.md` now says the trace
   id is accepted only when it is well-formed and is untrusted even then. One nit: that text
   cites "`shadow-evaluation.ts`'s own comment", but the comment is in
   `shadow-middleware.ts`.
6. **S4, S6 and D4:** present, as described above. The runbook has the tally-versus-events rule
   and query. The prune loops until drained, sets the guard only after success, has an
   in-progress flag, and backs off for an hour after a failure.
7. **S9, the migration renumber: fixed.**
   - **Renumbered:** it is now `0069_policy_shadow_tables.sql`, byte-identical to the old
     `0068_policy_shadow_tables.sql`. Journal `idx: 69`, **`when: 1790201000000` > 0068's
     `1790200000000`**.
   - **Snapshot chains to `main`:** `0069_snapshot.json` has `prevId` equal to `main`'s
     `0068` snapshot `id` (`552bb420-…`). Apart from `id` and `prevId`, it is identical to
     that snapshot, and it carries `is_system`.
   - **Nothing on `main` altered:** `main`'s `0068` SQL and snapshot are unchanged by this PR.
   - **Applies on a database already at `0068`:**
     - On a fresh database, drizzle's real migrator ran `main`'s folder: 69 migrations, last
       `created_at` 1790200000000, `is_system` present, no shadow tables.
     - Then the PR's folder: 70 migrations, last 1790201000000, **`policy_shadow_event` and
       `policy_shadow_tally` created**.
     - A re-run was a no-op.
8. **#308 app-role grants: covered.**
   - I created a fresh non-privileged role and ran `runMigrationStep()` with the owner URL
     and `runApiBootTasks()` with the migration URL removed, the same shape as
     `boot-orchestration-success.test.ts`. I then served requests with shadow on.
   - `has_table_privilege` shows INSERT, UPDATE and DELETE on both tables for the app role.
   - The tally upsert went from count 1 to 2, which exercises UPDATE. Two event rows were
     inserted. An expired event row I had seeded was pruned, which exercises DELETE. No
     `policy shadow:` error was logged.

### Findings at `8fe8fdf`

#### E1 — NON-BLOCKING, for the orchestrator — the PR itself edits `status.md` and `decision-log.md`

Both are orchestrator-owned.

- **Status file:** the squash adds a "Seventh pass" paragraph and two session-log entries to
  `status.md`.
- **Decision log:** it adds two new entries to `decision-log.md`:
  - "Sequence #8 shadow-mode tables after #322's migration", **"Decided by: Codex GPT-6"**;
  - the Slice 2 entry. Its "Coverage in this slice" paragraph is now accurate, and it
    resolves D3's two inaccuracies.
- **Content:** I found nothing false in either file that bears on security. The renumber
  entry describes exactly what the migration files do.
- **But:** CLAUDE.md makes these surfaces the orchestrator's to verify and write. The
  orchestrator must confirm it adopts both files' additions as its own before merge, or move
  them out into its own change.
- **Also:** the status.md text names a candidate SHA and review state that will be stale once
  this PR merges.

#### E2 — NON-BLOCKING — nit in `data-model.md`

The `trace_id` row cites the comment in the wrong file: it is in `shadow-middleware.ts`, not
`shadow-evaluation.ts`.

#### E3 — NON-BLOCKING, before production enablement — the in-flight bound is 8 of a 10-connection pool

`SHADOW_LIMITS.maxInflight = 8` (`shadow-middleware.ts:308`). Under saturation, shadow work can
hold 8 of the 10 pool connections, which explains the p99 rise at concurrency 2000 (probe 2).
That is acceptable for UAT soak traffic. Before any production enablement, set the bound to
about 2, or derive it from the pool size.

#### Carried forward, unchanged, not required for merge

- **S7:** there is no trigger. The grants are full CRUD by design, and the runbook's
  paste-at-decision-time rule is in place.
- **S8** and **D5:** for #324.
- **S10:** informational.

### Verdict

**CLEAR WITH FINDINGS** at `8fe8fdf16db53e7de2d43344f3fcdcee7e89c617`. There are no blocking
findings.

- The one gate item in this list is E1, for the orchestrator: adopt or remove the PR's
  `status.md` and `decision-log.md` edits before merge.
- E2 and E3 are non-blocking.

This note commit changes only this file. Any other change to the branch after `8fe8fdf`,
including a `main` merge, needs this clearance re-confirmed at the new head.

---

## Attestation — control-plane-only delta `7b591a2`

**Reviewed head:** `7b591a28c797d9e241e08ebbf43061f36cc00a5c`

- **The only new commit:** `7b591a2 docs(control-plane): drop #323's status.md edits; attribute the renumber entry to the orchestrator`. Its parent is `ab8de52`, and `origin/main` is still `7bebaf6`, the merge base.
- **`git diff ab8de52 7b591a2` touches two files, both docs:**
  - `docs/07-planning/decision-log.md`: one "Decided by:" line, which wrapped over two lines, is replaced by one line re-attributing the renumber entry to the orchestrating session.
  - `docs/07-planning/status.md`: 7 lines removed, which were the E1 additions.
- **`status.md` now has no diff against `origin/main`.** Correction to the relayed note: `main`'s `status.md` doesn't contain the removed "Seventh pass" text, so those lines didn't reach `main` separately. They were simply dropped.
- **Nothing else changed:** no code, test, migration, or other document.

**Verdict:** CLEAR WITH FINDINGS stands at `7b591a28c797d9e241e08ebbf43061f36cc00a5c`. E1 is resolved; E2 and E3 remain non-blocking.
