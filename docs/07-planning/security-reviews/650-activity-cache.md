# PR #650 — production activity-cache correction reviews

**Reviewed head:** `4cb15b89a45c5d3c703bb27258566b7c16d9a7f8`

Authentic independent delta reports below preserve earlier reviews and failures. No overall acceptance, waiver or performance cause is claimed.

## Original report: 650-activity-cache-independent-a-luna.md

SHA256: `ee09d722ea2f8cf64cc4e10ac9e2a032fa42a3a23a3889441e4174bf8f1cfb63`

# PR #650 ordinary independent review A — activity-cache delta

- **Verdict:** Clear; no blocking or non-blocking findings in the reviewed delta.
- **Candidate:** `4cb15b89a45c5d3c703bb27258566b7c16d9a7f8`
- **Comparison base:** `d2f855d4f63a2cf8b68d5e9bc6d99bc15a859058`
- **Scope:** Exact two-file delta in `apps/web/src/hooks/use-native-work-item-realtime.ts` and `apps/web/src/hooks/use-native-work-item-realtime.test.tsx`; checked the production activity query key/fetcher, native websocket event envelope, event invalidation/coalescing, and authorized activity query callers.
- **Independence / provenance:** Fresh subagent context dispatched for ordinary review A by the parent conductor; did not author, direct, or remediate this delta. Runtime identifies this reviewer as GPT-6; exact model/version alias is not exposed in this context. Assigned Luna-tier ordinary review.

## Review

The original P2 at `https://github.com/ThomasHeinThura/ticketing/pull/650#discussion_r4242636662` is resolved by the exact-head change. The old `['work-items', 'activity', key]` invalidation did not match production. `useGetActivitiesByTaskId` uses `['activities', taskId]`; native broadcasts intentionally send only `{ key }`, so the hook cannot form the task-specific key from the event. Invalidating the existing `['activities']` prefix with `refetchType: 'active'` reaches production activity queries without inventing an ID or expanding the websocket payload.

The new regression test mounts the real `useGetActivitiesByTaskId` hook and mocks its fetcher. It supplies a task ID different from the public work-item key, sends a `work_item.commented` frame carrying that public key, and verifies that the existing activity fetcher is called once with the internal task ID. It also asserts prefix invalidation with `refetchType: 'active'` and confirms neither detail nor project list refetches. This directly catches the original synthetic-key defect and the key/ID mismatch.

The prefix can refetch every *active* `['activities', taskId]` query in the current QueryClient. That is broader than one task because the authorized hint does not carry its internal ID; the refetched data remains fetched through each task-specific, authenticated production query. I found no correctness or authorization defect in that bounded tradeoff. Event deduplication and the existing debounced invalidation map coalesce repeated prefix invalidations as before.

## Checks run

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/use-native-work-item-realtime.test.tsx` — **1 file passed, 8 tests passed**.
- `pnpm --filter @taskdesk/web typecheck` — passed (both configured TypeScript projects).
- `git diff --check d2f855d4f63a2cf8b68d5e9bc6d99bc15a859058 4cb15b89a45c5d3c703bb27258566b7c16d9a7f8` — passed.
- Worktree was clean at the reviewed head before/after inspection; no source edits made.

This report is only the ordinary review of this exact delta and is not an overall merge-readiness claim.

## Original report: 650-activity-cache-independent-b-luna.md

SHA256: `764707e5e501128cfc3fb510dbc3720b44f74b61d51c46a4db8271e5e266f059`

# PR #650 bounded delta review B

- **Reviewer role:** independent ordinary review B
- **Model provenance:** GPT-6 Luna tier, assigned as review B by the orchestrating task. This subagent interface did not expose a more specific platform build/version string.
- **Independence:** fresh reviewer context; no authorship, direction, or remediation of the candidate. Did not rely on review A's conclusions.
- **Candidate:** `4cb15b89a45c5d3c703bb27258566b7c16d9a7f8`
- **Comparison base:** `d2f855d4f63a2cf8b68d5e9bc6d99bc15a859058`
- **Checkout:** `/Users/heinthura/.codex/worktrees/605-native-client-selected/Ticketing.v2`; clean at review start; HEAD matched candidate.
- **Scope:** the two-file delta in `use-native-work-item-realtime.ts` and its test. Read AGENTS.md, agent-workflow.md, CLAUDE.md, and the native realtime contract in `docs/01-architecture/realtime.md`; inspected the production activity query hook and all `activities` cache-key consumers.

## Checks and evidence

- `git diff --stat base..candidate`: two files, 33 insertions and 13 deletions.
- `git diff --check base..candidate`: passed.
- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/use-native-work-item-realtime.test.tsx`: **1 test file passed; 8 tests passed** (2.49 seconds).
- The changed regression mounts the production `useGetActivitiesByTaskId` hook, supplies internal `taskId="task-id-COMMENT"` distinct from the public key in the native frame (`WI-COMMENT`), then delivers a committed-comment event. It observes the active activity query refetch through the real activity fetcher, asserts the fetch uses the task ID, asserts the `['activities']` prefix invalidation, and asserts neither item detail nor list refetches. This is non-vacuous coverage of the actual production key namespace and event path.
- The production hook only adds the activity prefix for the contract's five activity-affecting event types (`escalated`, `unblocked`, `mentioned`, `commented`, `deleted`), and only after a payload key exists. Existing list/detail event mapping is unchanged. Per-socket event/key deduplication, the 150 ms coalescing timer, stale-only cleanup flushing, and late-frame disposal checks remain unchanged; the focused suite passes their existing cases.

## Findings

- **Blocking findings:** none.
- **Non-blocking observation:** prefix invalidation intentionally marks all matching activity queries stale and refetches all active matching observers. This is broader than one work item, but every refetch goes through the existing policy-enforced fetcher; the key-only socket hint does not gain read authority or introduce a public-key-as-internal-ID cache key. The bounded change and regression make this consequence explicit.

## Prior P2 disposition

The earlier P2 about invalidating `['work-items', 'activity', publicKey]` is **resolved in this candidate**. Production activity queries are keyed `['activities', taskId]`; the candidate now invalidates their actual prefix while preserving the key-only event contract. No finding remains for the cited stale-key mismatch.

## Verdict

**Approve this bounded delta.** The targeted test passes and the implementation follows the documented key-only invalidation model. This verdict covers only the exact candidate SHA and comparison base above; it is not an overall merge-readiness claim.

## Original report: 650-activity-cache-security-sol.md

SHA256: `587141bc702cd12205594506c016d39ad78b87db8b9f604aa4691e6c26c95684`

# PR #650 — independent security review of activity-cache correction

**Verdict: CLEAR for the exact current-head activity-cache delta.** No blocking finding. This is a focused full security pass on the changed native-hint → query-invalidation → activity-fetch path, following the two independent ordinary CLEAR reports. It is not an overall PR, hosted-check, browser, image, or merge-readiness verdict.

- **Reviewed head:** `4cb15b89a45c5d3c703bb27258566b7c16d9a7f8`
- **Comparison parent:** `d2f855d4f63a2cf8b68d5e9bc6d99bc15a859058`
- **Accepted-main merge base:** `00c6c82e4fe44f443f51be755c8b04febd32c35d` (`git merge-base` confirmed)
- **Tree:** clean before and after review; no product files edited.
- **Role, independence, provenance:** Fresh independent Sol-tier security-review subagent context assigned by the parent as GPT-6 Sol. I did not author, direct, or remediate the candidate and did not participate in ordinary reviews A or B. This runtime exposes the GPT-6 family to this context but does not independently expose a more precise serving version; the parent dispatch assignment is the provenance of the Sol-tier label. No inherited author reasoning was used as evidence.
- **Delta:** two web hook files, 33 insertions and 13 deletions. Production changes only the affected activity invalidation key from nonexistent `['work-items','activity',publicKey]` to the actual `['activities']` prefix for five existing activity-affecting frame types. The test mounts the production activity hook.

## Security assessment

The native websocket server authorizes each project/work-item subscription using identity, project reach, workspace access, and API-key permission checks, reauthorizes it after identity invalidation and periodically, and sends at most a public work-item key in the hint. Customer delivery remains filtered by `customerVisible`. This delta does not change those checks or the emitted envelope. The client requires an event ID and payload key before selecting any activity invalidation, preserving the existing event mapping; the five types are escalated, unblocked, mentioned, commented, and deleted. It does not use the untrusted frame to construct a task ID, URL, or API request.

Production `useGetActivitiesByTaskId` caches under `['activities', taskId]` and calls `getActivitesByTaskId({ taskId })`. The changed prefix invalidation uses TanStack's `refetchType: 'active'`: every currently active matching activity query may refetch, but each keeps its own task ID and goes through the existing `GET /api/activity/{taskId}` route. That route has `workspaceAccess.fromTaskId(..., { requireProjectReach: true })`; the registry declares `work_item:read`, row scope, and required reach. No websocket hint is treated as authority for the HTTP request. The broader prefix may cause additional authenticated fetches across visible feeds, which is a non-blocking performance tradeoff under the key-only envelope, not a data grant. Inactive matching queries are marked stale and fetch through the same route if later activated.

The pre-existing per-socket event/key deduplication and 150 ms pending-key map coalesce duplicate deliveries and repeated `['activities']` keys. The socket identity check, disposal check, stale-only cleanup flush, and late-frame guard remain intact. The new regression uses `task-id-COMMENT` distinct from public `WI-COMMENT`, proves one comment event refetches the real production activity hook with the internal task ID, and asserts no list or detail refetch. The focused suite also exercises duplicate event delivery, cleanup, reconnect, and project switch. I found no cross-tenant cache read, authorization bypass, or stale callback introduced by this delta.

**Prior P2 disposition:** resolved at this head. The earlier synthetic cache key could never match the production activity hook; this candidate invalidates its actual prefix without adding an internal ID to the public hint. The original P2 should not be carried forward as open against this SHA.

## Checks performed

- `pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/hooks/use-native-work-item-realtime.test.tsx` — **1 file, 8 tests passed**. Vite emitted an informational native-config warning.
- `pnpm --filter @taskdesk/web typecheck` — passed, both configured TypeScript projects.
- `git diff --check d2f855d4f63a2cf8b68d5e9bc6d99bc15a859058..HEAD` — passed.
- Inspected the exact delta, full hook and test, production activity query/fetcher/callers, activity route and policy, workspace-access middleware, websocket subscription/delivery/reauthorization path, query-client error handling, workflow and CI security-scope policy, and the two exact-head ordinary reports. No DB, Docker, full suite, browser, or hosted checks were run for this focused review.

**Blocking findings:** none. **Non-blocking observation:** one authorized comment hint can refetch other active activity feeds in the same QueryClient because the server envelope carries only a public key. This is bounded by active observers and existing HTTP authorization. **Residual:** runtime latency/load with many simultaneous activity observers was not measured here; current evidence covers the functional and security behavior of the correction, not performance acceptance for the entire PR.
