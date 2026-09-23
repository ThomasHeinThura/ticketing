# Security review — wire WI-6 activity rows and `work_item.*` events into work-item create/update

**Reviewer:** Opus 5.5, fresh independent context. Did not author, direct, or remediate this change.
**Reviewed head:** `6b29818067e6e91b70311a2651fb09cba3612ef0`
**Reviewed SHA:** `6b29818067e6e91b70311a2651fb09cba3612ef0` (confirmed via `gh pr view 292 --json headRefOid`)
**Pull request:** #292
**Date:** 2026-09-23

## Surfaces examined

- `apps/api/src/work-item/controllers/create-work-item.ts`, `update-work-item.ts`
- `apps/api/src/work-item/index.ts` (`resolveActor`, create/update handlers, `set_priority` field gate)
- `apps/api/src/work-item/activity.ts` (`resolveVisibility`, `recordWorkItemActivity`, `diffWorkItemFieldChanges`, new `start_date` entry)
- `apps/api/src/events/index.ts` (in-process `EventEmitter` bus) and every `subscribeToEvent` caller:
  `ws/index.ts`, `notification/index.ts`, `activity/index.ts`, `plugins/registry.ts`
- `apps/api/src/utils/authenticate-api-request.ts` (only writer of `c.get("apiKey")`/`userId`)
- Every reader of `activityTable` (none outside the writer; `search` reads `task_activity` only)
- `docs/01-architecture/events.md` diff; `data-model.md` actor convention and `activity` row; CA-7/CA-9
- `tests/api-integration/work-item-activity-wiring.test.ts`, `work-item-update.test.ts`

## Probes run

All on a private database `pr292_opus_test` on td-lane-pg (127.0.0.1:55440), dropped afterwards.

1. **Full integration suite at the exact head:** `vitest run --config vitest.integration.config.ts`:
   **73 files / 976 tests passed**, exit 0. That includes the new `work-item-activity-wiring.test.ts`
   (forced-failure rollback, after-commit ordering, api-key actor, 409/404/unchanged zero-row cases).
2. **A throwaway live probe file** (`tests/api-integration/zz-opus-probe-292.test.ts`, deleted after
   the run, never committed), going through `createApp()` with the real middleware chain and real
   `apikey` rows resolved by `verifyApiKey`:
   - P1: PATCH `dueDate` null to `1970-01-01T00:00:00.000Z`, then back to null. Both returned 200 and the
     version bumped 1 to 2 to 3. **Zero `updated` activity rows and zero `work_item.updated` events** (S1).
   - P2: a valid cookie session for member A plus `Authorization: Bearer <key of outsider B>` returned
     **403** with no event: the key wins and the cookie is ignored, so B's reach governs and nothing is
     escalated. A's own key sent via `x-api-key` returned 200 and the row has `actor_type=api_key` and
     `actor_id=A`. A bogus `x-api-key` plus a valid cookie returned **401** (no fallback to the cookie).
     `x-actor-type: system` plus an empty `x-api-key` plus a cookie returned 200 as `person`/A: there is no
     header-driven actor.
   - P3: an outsider PATCHing A's key got **404**. An outsider POSTing to A's project got **403**. A viewer
     in A PATCHing got **403**, and PATCHing a nonexistent key got **404**. Afterwards there was still
     exactly 1 activity row (the `created` one), the title and version were unchanged, and **0 events**
     had fired.
   - P4: a validation failure (`title: ""`) returned 400 and a stale If-Match returned 409, with 0 rows
     and 0 events for both. An unchanged-value PATCH returned 200, bumped the version (pre-existing
     behaviour) and wrote 0 rows and 0 events.
3. **Subscriber sweep:** I enumerated every `subscribeToEvent` key in `apps/api/src` (`ws/index.ts`,
   `notification/index.ts`, `activity/index.ts`, `plugins/registry.ts`). Every one is a `task.*`,
   `comment.*`, `task-relation.*`, `time-entry.created`, `workspace.created` or `notification.created`
   key. **Nothing subscribes to `work_item.*`**, and there is no wildcard or `onAny` listener. The bus
   is an in-process `EventEmitter` and is not bridged to Redis (the Redis adapter carries websocket
   broadcasts only). So no customer, websocket, plugin or webhook path forwards these payloads today.
4. **Reader sweep:** `activityTable` has no reader anywhere in `apps/api/src` besides its writer.
   `search` reads `task_activity` only, and no `with: { activities }` relational read exists. No public
   API exposes the new rows yet.

## Attack surfaces, and what held

- **Visibility (1).** The `created` row's payload is `{key, title}` only. Both are customer-facing by
  CA-7 (`title` is a public `updated` field, and the key is the public identifier), and the test pins
  the payload exactly. The per-change `visibility` in `changes[]` is computed by the **same**
  `resolveVisibility` over the **same** `activityRows` objects that `recordWorkItemActivity` classifies
  (`update-work-item.ts:247`, `activity.ts` insert). Neither sets an override, so the two cannot drift.
  `start_date` is not in `PUBLIC_PAIRS`, so it fails closed to `internal`, which is correct.
- **Actor (2).** The only writers of `apiKey` and `userId` are in `authenticate-api-request.ts`. Every
  session branch leaves `apiKey` unset, and every key branch sets it and replaces `userId` with the
  key owner. `resolveActor` (`work-item/index.ts:99`) therefore gives `api_key` if and only if the
  request authenticated by key. A key-authenticated request is never recorded as `person`, and no
  header can choose the actor. This confirms the fix in `f400b3a`. The api-key tests authenticate
  through the real `verifyApiKey` path, not a mock.
- **Tenant and permission (3).** Activity `workspace_id` comes from `inserted.workspaceId` or
  `updated.workspaceId`, which is the row's own value, and #192's composite FK backs it. The route
  middleware is unchanged (no `?workspaceId=` fallback, per #285). The `set_priority` check still runs
  in the handler before `updateWorkItem` (#271). The body schema is unchanged (#277). The lock
  `SELECT` is scoped by the same `key` plus `workspaceId` as the old CAS. The in-transaction order is
  missing row, then 404; deleted project, then 404; version mismatch, then 409. That preserves the old
  zero-row disambiguation (a deleted project beat a version mismatch before as well).
- **Atomicity (4).** The activity insert and the field update share one `tx`. The forced-failure test
  proves rollback. `publishEvent` runs only after `db.transaction` resolves, so a commit failure throws
  before the event. `subscribeToEvent`'s wrapper is async and catches its own errors, so a subscriber
  failure cannot turn a committed write into a 500. The `FOR UPDATE` lock is held across a single
  project lookup, one `UPDATE` and one multi-row `INSERT`, with no await on anything outside the
  database. That is minimal.

## Findings

### S1 — NON-BLOCKING: a date change between null and the Unix epoch writes no activity row and no event

`apps/api/src/work-item/activity.ts:282-290` (`valuesDiffer`). When exactly one side is a `Date`,
`new Date(null).getTime()` is `0`, so `null` and `1970-01-01T00:00:00Z` compare equal. The validator's
floor is 1900 (`schema.ts`), so the epoch is an accepted input. The `due_date` (public) or `start_date`
change commits and bumps the version, but WI-6/CA-6's journal and `work_item.updated` are silently
skipped in both directions.

*Reproduction:* probe P1 above. PATCH `{dueDate:"1970-01-01T00:00:00.000Z"}` over a null due date returns
200, version becomes 2, and the item has 0 `updated` rows and 0 events. PATCH `{dueDate:null}` behaves
the same way.

Impact is low: it needs a nonsensical date, and it lets a writer hide one specific transition from
the journal. The function predates this PR (#275), but this PR is what makes it reachable. *Fix:* treat
`null` against a non-null value as always differing before the `Date` branch, and add a regression test
for both directions. It is fine to fix this in a follow-up.

### S2 — NON-BLOCKING: `work_item.created` hardcodes `source: "agent"` even when an API key created the item

`apps/api/src/work-item/controllers/create-work-item.ts:201`. `events.md`'s enum is
`portal|agent|api|automation|import`. A key-authenticated create (probe P2b, and the PR's own api-key
test) emits `actorType: "api_key"` but `source: "agent"`. The two fields contradict each other, and any
future automation or webhook condition on `source` will misclassify API-created items. No consumer
exists today (probe 3). *Fix:* derive `source` from the same `resolveActor` result (`api_key` gives
`api`), or pass it in from the route.

### S3 — NON-BLOCKING (forward-looking): the `internal`-entry drop rule is a sentence, not a mechanism

`update-work-item.ts:240-258` puts internal `from`/`to` values (today `start_date`, and later
`assignee`) into `work_item.updated.changes[]`. `events.md` now says a customer or webhook consumer
"must drop an `internal` entry". That is safe today only because nothing subscribes (probe 3).
`work_item.created` also carries a top-level `visibility: "public"` next to `requesterId` and
`actorId`, which a future consumer could over-read as "this whole payload is customer-safe".

Per CLAUDE.md, a rule that closes a code defect needs a test. The first webhook, portal or websocket
consumer of `work_item.*` should go through one projection helper that strips `internal` entries and
non-public fields, and should carry a test that an internal change never reaches it. That work belongs
on the webhook-delivery or portal issue, not in this PR.

### Not findings (checked)

- Recording the owner's id as `actor_id` for `api_key` actors, with no `api_key_id` column on `activity`,
  matches `data-model.md` as it stands today. Which specific key acted is not recoverable from
  `activity`; it should come from `audit_log` once that is wired.
- An unchanged-value PATCH still bumps `version` while writing nothing. That is pre-existing WI-7
  behaviour and is not introduced here.

## Verdict

**CLEAR WITH FINDINGS.** Nothing is blocking. The actor fix in `f400b3a` is confirmed. There is no
visibility leak through the rows or through any existing subscriber. Tenant scoping and the
permission and ordering invariants from #261, #271, #277 and #285 are preserved, and so are atomicity
and after-commit event ordering. S1 through S3 are follow-ups.
