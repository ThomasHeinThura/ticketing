# Ponytail audit — 20 Nov 2026 (`main` at `e6db5ea6d`)

Read-only audit of five areas; every finding was checked by a separate verifier. Rejected findings are left out. Plan rows: Stream Q in [plan.md](../../plan.md). Also included: the CI failure analysis of the last 100 failed runs.

## Area: auth-perms

### Workspace invite rate limit is keyed by client IP on a signed-in route, so a whole office or proxy shares 5 invites a minute
- **Where:** `apps/api/src/utils/require-invite-rate-limit.ts` lines 20-53 (mounted at apps/api/src/workspace/index.ts:624)
- **Group:** should (scale)
- **What this is:** requireInviteRateLimit keys consumeSharedAuthRateLimit('invite', ...) on resolveIp(c). When no trusted client IP is available, every caller falls into the literal bucket 'no-trusted-ip'.
- **Problem:** The route already requires a session, workspace membership and invitation:create, so the actor is known. Keying on IP copies better-auth's anonymous-route behaviour. Every staff member who shares an egress address, across all workspaces on the instance, shares one 5-per-60s window.
- **Case:** Admins of workspace A and workspace B work from the same office NAT, or TASKDESK_TRUST_PROXY is 0 behind the reverse proxy so the proxy's address is the 'client'. Admin A sends 5 invitations. Admin B's first invitation in that minute gets 429. The same happens during UAT onboarding when one lead bulk-invites 6 people.
- **Fix:** In requireInviteRateLimit, use `const key = c.get("userId")` (requireSessionOnly runs earlier in the chain, so it is set). Keep INVITE_RATE_RULE and consumeSharedAuthRateLimit. Delete resolveIp and its now-unused imports (getConnInfo, rateLimitClientAddress, trustProxyDepth, resolveClientIp) and update the doc comment. In tests/api-integration/workspace-invite-rate-limit.test.ts, keep the 5-then-429 case for one user and add a second signed-up user whose first invite in the same window returns 200, sharing the same x-forwarded-for to prove the address no longer matters. Say in the PR that the key moved from client address to user and that the abuse gate still covers anonymous-style abuse.
- **If skipped:** Sporadic 429s on invitations for unrelated admins behind one address, and silent instance-wide throttling if the proxy hop count is misconfigured.

### Copy-invitation-link rate limiter is an in-process Map, so the limit multiplies with API replicas and resets on restart
- **Where:** `apps/api/src/utils/require-copy-link-rate-limit.ts` lines 14-120
- **Group:** should (scale)
- **What this is:** requireCopyInvitationLinkRateLimit keeps a module-level `buckets` Map keyed by userId: 30 requests a minute, at most 10,000 tracked actors. It is used by both workspace/index.ts:690 and customer-invitation/index.ts:81.
- **Problem:** This is per-process state. Every other auth-adjacent limiter in this area (invite, auth, anonymous invitation) uses the shared Valkey/Postgres coordinator. With N API processes the real limit is N x 30 a minute, and a restart clears it. It is also roughly 100 lines of hand-rolled bucket and prune logic that duplicates consumeSharedAuthRateLimit, which already handles the bounded memory fallback and the unshared-warning metric.
- **Case:** Two API replicas sit behind a round-robin balancer. One user copies invitation links 60 times in a minute and every request succeeds, because each replica counts only 30. Deploying a new image resets every bucket mid-window.
- **Fix:** Add "copy-link" to AuthRateLimitScope in apps/api/src/auth/rate-limit-storage.ts. Reduce requireCopyInvitationLinkRateLimit() to: return 401 when there is no userId; call `await consumeSharedAuthRateLimit("copy-link", userId, { window: 60, max: 30 })`; when the decision is not allowed, set the Retry-After header to String(decision.retryAfter ?? 60) and throw a 429. Keep the export name so the two route files stay unchanged. Delete the `buckets` Map, earliestLiveWindowStart, pruneExpired, resetCopyInvitationLinkRateLimitBuckets, copyInvitationLinkTrackedActorCount and the options parameter. Update both test files that use these exports: tests/api/customer-invitation/copy-link.test.ts (its options-based limiter test at line 232 and its reset calls at lines 67 and 79) and tests/api-integration/p5-invite-lifecycle.test.ts (reset calls at lines 1405, 1478 and 1525). Have them use unique user ids per test or the coordinator's test reset instead.
- **If skipped:** The CP-23 limit is not actually enforced once more than one API process runs, and 100 lines of duplicate limiter code stay in the tree.

### resolveCallerIdentity duplicates resolveRequestIdentity but drops the service-key branch, so service keys fail on some routes and pass on others
- **Where:** `apps/api/src/utils/has-project-reach.ts` lines 131-167 (vs apps/api/src/permissions/resolve-request-identity.ts:25-57)
- **Group:** nice (lean)
- **What this is:** Two helpers build the request identity from the same context facts: resolveCallerIdentity (webhook, workflow-rule, comment:160, attachment, capabilities/project-scope) and resolveRequestIdentity (time-entry, activity, comment:38, user-preference, terminology, search). Only resolveRequestIdentity handles apiKey.service by calling resolveServicePrincipal (AK-7).
- **Problem:** A workspace service key is inserted with userId null and referenceId null (api-key/service.ts:340, api-key/repository.ts:462), so c.get('userId') is ''. resolveCallerIdentity then calls resolveIdentity({userId:''}), finds no user row and returns null. This fails closed, so it is not a hole, but the same key gets different answers by route family, and the two copies can drift further.
- **Case:** A service key with workspace webhook/settings capabilities calls a webhook read route. callerIdentity() gets null and returns 403 'Insufficient permissions'. The same key calling a time-entry route resolves to its AK-7 workspace principal and is evaluated normally.
- **Fix:** Replace the body of resolveCallerIdentity with `return resolveRequestIdentity({ userId, apiKey: c.get("apiKey"), impersonatedBy: c.get("session")?.impersonatedBy });` (about 30 fewer lines), or point its callers at resolveRequestIdentity and delete it. Do not claim this enables service keys on webhook routes, because validateWorkspaceAccess still refuses them there. Some callers lack an earlier gate (for example workflow-rule and capabilities/project-scope); there a service key could move from always-denied to being evaluated against its stored workspace subset. That is a change to permission semantics, so get Thomas's approval and a Sol high-effort review first, and add one test showing that a service key gets the same answer on a resolveCallerIdentity route as on a resolveRequestIdentity route.
- **If skipped:** Inconsistent service-key behaviour across routes and two identity builders that must be kept in sync by hand.

## Area: data-jobs

### Rescheduling a task through the full update (Gantt drag, PUT /v2/task/:id) keeps old reminder markers, so no reminder fires for the new due date
- **Where:** `apps/api/src/task/controllers/update-task.ts` lines 60-145 (updateTaskRow at 134)
- **Group:** should (bug)
- **What this is:** The due-date-only route (update-task-due-date.ts:46) calls clearTaskReminders before changing dueDate. The full update path changes dueDate through updateTaskRow and never clears task_reminder_sent. listTasksNeedingReminder (scheduler/repository.ts:183-197) leaves out any task that already has a marker for that reminder type.
- **Problem:** Once a 'configured_before' or 'overdue' reminder has been sent, moving the task's due date through this path stops every later reminder of that type, for good.
- **Case:** Task due 20 Nov 10:00. The overdue reminder is sent at 10:05. The user drags the task's Gantt bar (gantt-task-bar.tsx:102 calls useUpdateTask, which sends PUT /v2/task/:id to updateTask) to 27 Nov. On 27 Nov no due-soon or overdue notification goes out, because the 20 Nov marker rows still exist.
- **Fix:** In update-task.ts, add clearTaskReminders to the import from "../repository". Inside the transaction, after the `changes.length === 0` early return and before updateTaskRow, add: `if (dateValue(lockedTask.dueDate) !== dateValue(nextDueDate)) await clearTaskReminders(tx, identity, id);`. Add one integration test on a fresh _test database: insert a task_reminder_sent row for a task, PUT /v2/task/:id with a different dueDate, check that the row is gone; then PUT with the same dueDate and check that a marker row is kept.
- **If skipped:** Assignees silently stop getting due and overdue reminders on any task that was rescheduled from the Gantt view or through the API.

### Due-date reminders are lost for good if the job misses a 10-minute window
- **Where:** `apps/api/src/scheduler/due-date-reminders.ts` lines 18-35
- **Group:** should (bug)
- **What this is:** The overdue window is [now-10m, now] and the configured_before window is [now-REMINDER_WINDOW_MINUTES(10), now]. The job runs every 5 minutes. Nothing catches up on targets that fall outside the window.
- **Problem:** After a restart, a deploy, a God Mode disable, a lease held by a stuck run, or a DB blip longer than about 5-10 minutes, every task whose reminder time fell in the gap never gets that reminder. The task_reminder_sent marker already prevents duplicates, so the narrow window protects nothing.
- **Case:** The API is redeployed 09:00-09:15 and due-date-reminders does not run. A task due 09:03 never gets a task_overdue notification, and a task whose 24 h lead time fell at 09:07 never gets due_date_reminder.
- **Fix:** In buildWindows, start both windows at a 24 h catch-up horizon. For example, add `const CATCH_UP_MS = 24 * 60 * MINUTE_MS;` and use `start: new Date(nowMs - CATCH_UP_MS)` for upcoming and overdue. The simpler way is to set REMINDER_WINDOW_MINUTES = 24 * 60 in reminder-timing.ts and use it for the overdue window too. Keep the isNull(marker) filter and the onConflictDoNothing insert as they are; together they keep each reminder to one send. Update tests/api/scheduler/reminder-timing.test.ts, whose 'does not send ... after the delivery window' case asserts the 10-minute limit, or delete the unused isReminderDue and its test. Say in the PR that one behaviour changes on purpose. A task created or re-dated so that its lead-time target, or its due date, is already up to 24 h in the past now gets the reminder on the next run, about 5 minutes later. Before, it never got one. Make it widen-only: no new options and no changes to the marker or schema.
- **If skipped:** Reminders go missing silently after every outage or deploy that lasts longer than one cadence.

### sla-scan locks every open SLA item and runs about 8 queries on each one every 5 minutes, even when nothing changed
- **Where:** `apps/api/src/scheduler/sla-scan.ts` lines 24-60, 152-190
- **Group:** nice (scale)
- **What this is:** For each open item that has an SLA policy, scanWorkItemSla opens a transaction, takes FOR UPDATE on work_item and FOR SHARE on project, then reads the feature flag, the clock, the pauses, the policy evaluation and the cache. This runs one item at a time, in series, under a single lease.
- **Problem:** The cost grows with the number of open SLA items, including items already breached on every metric, which can never emit again. It also takes row locks that briefly block staff PATCHes on those items. With tens of thousands of open tickets, a pass can take longer than the 5-minute cadence, so at-risk events arrive late.
- **Case:** 20k open tickets × about 8 round trips at roughly 2 ms each is about 5 min per pass. Every ticket is row-locked every 5 minutes. An agent's If-Match PATCH waits behind the scanner's lock, and a pass that runs over pushes back the next scan's at-risk and breach detection.
- **Fix:** Smallest safe change: before taking any locks, read the item's cache rows and the policy's metric list. If every metric is already 'breached' (scanDecision can never emit after breached) and slaPolicyVersionId and the pause rows have not changed since computedAt, skip scanWorkItemSla. Equivalently, add a NOT EXISTS / all-breached filter to the candidate query, keyed on computedAt being newer than the item's updatedAt. Keep the locking re-check unchanged for every other item. Add one integration test showing that a fully breached item is skipped and that a re-pinned or unpaused item is scanned again. Do this only if real open-item volume grows; it is not needed for UAT.
- **If skipped:** SLA alerts arrive late and lock contention grows as ticket volume grows.

### The automation schedule sweep checks the feature flag once per candidate item
- **Where:** `apps/api/src/automation/schedule.ts` lines 305-321
- **Group:** nice (speed)
- **What this is:** Inside the per-rule transaction, which holds FOR UPDATE on the automation row and an advisory xact lock, the loop calls automationsEnabled(rule.workspaceId, item.projectId) for each of up to 50 items. Each call resolves project features from the DB.
- **Problem:** There are up to 50 repeated flag lookups per rule per tick, all for the same few projects, while the rule row stays locked. consumer.ts:205-211 already caches this lookup per project.
- **Case:** A workspace rule matching 50 items in one project resolves feature.automations for that project 50 times per sweep page, every due minute, on every replica that wins the rule lease.
- **Fix:** In schedule.ts, put `const flagCache = new Map<string, boolean>();` before `for (const item of items)`. Then replace the check with: `let enabled = flagCache.get(item.projectId); if (enabled === undefined) { enabled = await automationsEnabled(rule.workspaceId, item.projectId); flagCache.set(item.projectId, enabled); } if (!enabled) continue;`. This is the same pattern as consumer.ts:203-211. Optionally move the check before evaluateConditions so skipped projects cost nothing.
- **If skipped:** About 50× extra queries per rule page and a longer lock hold on the rule row.

### The notification-digest job logs raw error messages, which can contain tenant data
- **Where:** `apps/api/src/scheduler/notification-digest.ts` lines 38-52, 66-80
- **Group:** nice (risk)
- **What this is:** Both catch blocks write `error.message.slice(0, 200)` to stdout. Other background paths deliberately log only the error name (outbox-consumer.ts parentErrorLabel says the raw message 'may hold data').
- **Problem:** PostgreSQL and provider errors put values into the message, such as unique-violation details with email addresses or recipient addresses from SMTP errors. These end up in container logs.
- **Case:** A digest delivery fails with a pg error like 'duplicate key value violates unique constraint ... Key (recipient_email)=(customer@x.com) already exists'. That customer email is printed to the job log.
- **Fix:** In both catch blocks in apps/api/src/scheduler/notification-digest.ts, delete the `message` field. Log only the error name, using the same sanitisation as outbox-consumer.ts parentErrorLabel: export it and reuse it, or apply the same /^[A-Za-z0-9_]{1,64}$/ check inline. If a test asserts on the logged message, update it.
- **If skipped:** Personal data leaks into operational logs.

## Area: portal-keys-mcp

### API key failure lockout is keyed on the raw IPv6 address, and a missing client IP turns it off
- **Where:** `apps/api/src/utils/verify-api-key.ts` lines 64-66, 98-104
- **Group:** should (risk)
- **What this is:** `noteFailure` and `verifyAdmitted` pass the raw `clientIp` to `FailureLimiter`, and skip it completely when `clientIp` is null. The other anonymous limiters (home-realm, invitation, step-up, invite) all key on `rateLimitClientAddress(ip)`, which collapses IPv6 to its /64, and use a shared `no-trusted-client-ip` bucket when the IP is null.
- **Problem:** An IPv6 client owns a whole /64, so it can use a new address on every request and never reach the 10-failures-per-minute lockout. With no lockout, the only thing left is `ArgonGate` (3 Argon2id runs at once for the whole process, a queue of 8). When a request has no trusted IP, failures are never counted at all. `resolve-client-ip.ts` says a null IP must fall back to a shared bucket.
- **Case:** A staff user creates two keys of their own, so they know both selectors. From an IPv6 /64 they send junk secrets with those selectors, changing the source address each time. Each attempt reaches Argon2id, and the per-IP lockout never starts. The global gate stays full, so every other key whose 5-minute verified cache has expired gets 503 verification_busy, across the whole process.
- **Fix:** In findVerifiedApiKey, compute `const limiterKey = rateLimitClientAddress(clientIp ?? "no-trusted-client-ip")` once, import it from ../identity/home-realm-rate-limit, and pass it through noteFailure, verifyGuarded and verifyAdmitted in place of clientIp. Then remove the `if (clientIp)` guards. Add one test in tests/api/api-key/verify-guard.test.ts (or the verify-api-key test): two addresses in the same /64 share one lockout. In scim-limits.ts scimClientKey, wrap only the resolved IP: `const ip = resolveClientIp(...); return ip ? rateLimitClientAddress(ip) : "no-trusted-ip";`. Its null fallback already exists.
- **If skipped:** Any key holder with IPv6 can hold the process-wide Argon gate full and lock out API and MCP clients whose cached verification has expired.

### Webhook quota check and insert can race past the limit
- **Where:** `apps/api/src/webhook/repository.ts` lines 133-158, 189-205
- **Group:** nice (scale)
- **What this is:** `createWebhook` runs `assertWebhookQuota` (a count of the organisation's webhooks) and then the insert, in one READ COMMITTED transaction with no lock. The storage quota takes `pg_advisory_xact_lock(hashtextextended('attachment-storage-quota:'||org))` for exactly this case (attachment/repository.ts:909).
- **Problem:** Two creates at the same moment both count limit-1, both pass, and both insert. The step-up spend is per user, so it only serialises requests from the same admin.
- **Case:** An organisation has max_webhooks=10 and 9 webhooks. Two admins (or a script using two service keys) create a webhook at the same time. Both transactions see a count of 9 and both commit, leaving 11 webhooks. Each extra webhook adds deliveries and outbound load that the quota was meant to cap.
- **Fix:** In assertWebhookQuota, right after the `if (!workspace)` check, add: `await executor.execute(sql\`select pg_advisory_xact_lock(hashtextextended(${\`webhook-quota:${workspace.organisationId}\`}, 0))\`);`. The only caller is createWebhook, which already runs it inside its transaction, so the lock is held until commit. A concurrency integration test is optional. If you add one, run two creates at limit-1 and expect one 201 and one 429.
- **If skipped:** The webhook quota is soft under concurrency. It overshoots by the number of creates that run at once.

### Filesystem v1 portal download token is dead in production
- **Where:** `apps/api/src/storage/filesystem.ts` lines 864-866, 1015-1062
- **Group:** nice (lean)
- **What this is:** `PORTAL_ATTACHMENT_DOWNLOAD_TOKEN_INFO`, `createPortalAttachmentDownloadUrl(key, filename, personId, apiBaseUrl)` and `readPortalAttachmentDownloadObject` in filesystem.ts.
- **Problem:** Every production download URL comes from `portal-servable.createPortalAttachmentDownloadUrl`, which always calls `createPortalDownloadV2`. The `/storage/portal-download` route checks only `verifyPortalDownloadV2`. A grep across apps, packages and tests finds the v1 mint and reader only in tests/api/storage/portal-servable.test.ts.
- **Case:** A reviewer changing portal download security has to reason about two token formats with different HKDF info strings. Only one of them is accepted anywhere, and the tests still exercise the other as if it were live.
- **Fix:** In apps/api/src/storage/filesystem.ts, delete PORTAL_ATTACHMENT_DOWNLOAD_TOKEN_INFO, createPortalAttachmentDownloadUrl and readPortalAttachmentDownloadObject. Keep the upload info constant and signPortalToken/verifyPortalToken. In tests/api/storage/portal-servable.test.ts, drop those two imports and delete the whole 'binds a submission file's download to the person it was minted for' test (around line 229). In the two upload tests, remove only the trailing v1 download sections (around lines 95-109 and 153 to the end of the agent-download check). Keep their upload assertions. v2 download coverage already lives in portal-download-token.test.ts and portal-attachment-storage.test.ts.
- **If skipped:** About 50 lines of security-sensitive code that is only kept alive by its own tests.

### SCIM WindowCounter is a test-only in-memory limiter
- **Where:** `apps/api/src/identity/scim-limits.ts` lines 28, 59-111, 130-142
- **Group:** nice (lean)
- **What this is:** The `WindowCounter` class and the optional `counter` parameter on `scimConnectionRateLimit`.
- **Problem:** Production calls `scimConnectionRateLimit(fn)` without a counter, so it always uses the shared database store (`consumeScimRateLimit`). `WindowCounter` is constructed only in tests/api/identity/scim-limits.test.ts. Those middleware tests therefore exercise an in-memory branch that production never runs, and the real branch is not covered there.
- **Case:** A bug in the database-backed `scim_connection` path, such as a wrong retry-after or no isolation between connections, passes the 'SCIM connection rate limit' tests, because they inject a WindowCounter.
- **Fix:** Delete `WindowCounter`, `MAX_TRACKED_KEYS` and the `counter` parameter from scim-limits.ts, and keep only the consumeScimRateLimit branch with its try/catch that returns 503. In tests/api/identity/scim-limits.test.ts, add vi.mock("../../../apps/api/src/identity/scim-rate-limit-store", ...) so consumeScimRateLimit returns allowed or denied with a retryAfterSeconds value. Mock recordScimRequestDenied too if the test does not already stub it. Remove the WindowCounter describe block, and build app() without a counter in the 429-isolation test and both body-limit tests. Leave the integration tests as they are, since they already cover the database path.
- **If skipped:** About 55 lines of dead limiter, plus tests that do not cover the production path.

### MCP client 401 retry and credential purge cannot run
- **Where:** `packages/mcp/src/taskdesk/client.ts` lines 57-62
- **Group:** nice (lean)
- **What this is:** The branch `if (res.status === 401 && !didRetry && !this.auth.usingApiKey) { await this.auth.clearToken(); return this.authorizedFetch(...) }`, together with `AuthService.clearToken`, `clientId` and auth/token-store.ts.
- **Problem:** Without an API key, `getAccessToken()` throws before `fetch` is called. So `usingApiKey === false` with a response in hand never happens. The retry, `clearToken` and `clearCredentials` are unreachable, which also means the stale credentials.json they were kept to purge is never purged. client.test.ts:51-69 fakes an AuthService that has no API key and still returns a token, a state the real class cannot produce.
- **Case:** A user with an old ~/.config/taskdesk-mcp/credentials.json and no TASKDESK_API_KEY gets the 'TASKDESK_API_KEY is required' error. The file is never deleted, even though the comments promise it will be.
- **Fix:** In packages/mcp/src/taskdesk/client.ts, delete the 401 retry branch (lines 57-62) and the `didRetry` parameter. In auth-service.ts, delete `clearToken`, the `clearCredentials` import and its doc-comment sentence. Delete packages/mcp/src/auth/token-store.ts. In tests, delete the client.test.ts "clears the cached token and retries once after a 401" case, plus the `clearToken` stubs in the other fakes (optional). In auth-service.test.ts, delete the token-store vi.mock/hoisted mock and the "clearToken purges a stale credentials file" case. Removing `clientId` is optional: it is unused, but the constructor callers would also need editing, so leave it unless it is trivial. Do not add a purge in the throw path: the file is already ignored, and deleting a file from the user's home directory during a failed auth adds risk for no benefit.
- **If skipped:** About 60 lines of dead auth plumbing, and a test that checks an impossible state.

### Duplicate stored-permission parser in verifyApiKey
- **Where:** `apps/api/src/utils/verify-api-key.ts` lines 146-169, 230
- **Group:** nice (lean)
- **What this is:** `parsePermissions(raw)` duplicates `apiKeyScopeFromStoredPermissions(raw)` in utils/require-api-key-permission-scope.ts, which create-preparation, imports/access and pending-action/required-access already use.
- **Problem:** The two parse the same column with different results for malformed input (`{}` here, `null` there). Both deny today. But there are two parsers for one security column, and only one is shared with the other callers.
- **Case:** Someone tightens the shared parser, for example to reject unknown resources. verifyApiKey keeps the old behaviour, so the request-time key scope and the pending-action re-check can disagree about the same key.
- **Fix:** In verify-api-key.ts, import apiKeyScopeFromStoredPermissions and set `permissions: apiKeyScopeFromStoredPermissions(apiKey.permissions).permissions ?? null`, then delete parsePermissions. Optionally harden ws/native-work-item-realtime.ts:156 to `credential.apiKeyId !== undefined && !credential.apiKeyPermissions?.work_item?.includes("read")`, so the extra check still runs when malformed permissions now come through as null. Run tests/api/api-key and tests/api-integration/api-key-owner-state.test.ts afterwards.
- **If skipped:** About 24 duplicate lines on an authorization path.

### Inline-asset detach runs three queries per removed image inside the locked task transaction
- **Where:** `apps/api/src/storage/cleanup-assets.ts` lines 119-128
- **Group:** nice (speed)
- **What this is:** `syncInlineAssetReferences` loops over the removed assets and awaits `isAssetReferencedElsewhere` for each one. That function runs a description LIKE query, a comment LIKE query and an activity LIKE query.
- **Problem:** The queries run one after another while the caller holds the task/project lock, so every other edit to that task waits behind them.
- **Case:** An agent replaces a description that held 30 pasted screenshots. That is 90 sequential LIKE queries over the task's comments and activity while the task row is locked, and concurrent comment posts on the ticket stall for the whole time.
- **Fix:** Keep the fix small. In syncInlineAssetReferences, run the three existing repository queries once with the pattern '%/api/asset/%'. Union extractAssetIds over the description, the comment contents and the activity contents into one referenced Set. Then set toDetach = assets.filter(a => !referenced.has(a.id)). Delete isAssetReferencedElsewhere. Change no repository or SQL, and add one unit test where an image removed from one place is still referenced in a comment, so it is not detached.
- **If skipped:** Edits that remove many images take longer and lock the task for the whole time.

## Area: web

### Notification bell stops updating for good after a ~31 s outage
- **Where:** `apps/web/src/hooks/use-user-websocket.ts` lines 98-107 (onclose), 13-14 (MAX_RETRIES)
- **Group:** should (bug)
- **What this is:** The user socket reconnects at most 5 times (1+2+4+8+16 s) and then stops until the page is reloaded. Notification queries have no other refresh path: the query client defaults are refetchOnWindowFocus:false and refetchOnMount:false (query-client/index.ts:125-126), and notificationInboxOptions sets no refetchInterval.
- **Problem:** Any API restart, deploy (scripts/deploy.sh upgrade), laptop sleep or Wi-Fi drop longer than about 31 s leaves every open agent tab with a frozen inbox and unread badge, and nothing on screen says so. The native and project sockets do not have this problem: they keep retrying with a capped backoff, or fall back to polling. The effect also has no `disposed` flag. When it re-runs (StrictMode, or the session id changing), the old socket's async onclose clears the new socket's ping, sets wsRef to null and schedules a second connect. That leaves an orphan socket that is never closed and invalidates notifications twice.
- **Case:** An agent has TaskDesk open, then the API is upgraded and takes 45 s to come back. Retries 1-5 all fail, so retriesRef ends at 5 and no more retries are scheduled. A customer reply then creates NOTIFICATION_CREATED, and the agent's bell never changes until they reload.
- **Fix:** The suggested fix is correct and small. In onclose, drop the MAX_RETRIES cap and copy use-native-work-item-realtime.ts:346-349: `const ceiling = Math.min(30_000, BASE_DELAY * 2 ** retriesRef.current); retriesRef.current += 1; timeoutRef.current = setTimeout(connect, Math.floor(ceiling * (0.5 + Math.random() * 0.5)));`. Then add `let disposed = false` in the effect, set `disposed = true` in cleanup in place of `retriesRef.current = MAX_RETRIES`, and start onclose with `if (disposed) return;`, before clearPing and wsRef = null. Add one case to the existing use-user-websocket.reconnect.test.tsx: fire 6 closes, advance the fake timers and assert a 7th connect.
- **If skipped:** Agents miss customer replies and mentions after every deploy or network blip until they reload, which is a likely UAT complaint.

### Internal comment drafts and portal form answers survive sign-out
- **Where:** `apps/web/src/components/work-item/work-item-comment-composer.tsx` lines 232, 315-335; routes/portal/catalogue.tsx:179-181, 357-368; hooks/mutations/use-sign-out.ts:26
- **Group:** should (risk)
- **What this is:** Unsent comment drafts are written to localStorage under `taskdesk:comment-draft:<userId>:<key>`, including internal-visibility text. Portal intake answers go under `taskdesk:intake-draft:<portalUserId>:...`. Sign-out calls only clearRecentItems(), which removes the `recent` prefix and nothing else. A draft is removed only after a successful submit or when it is emptied.
- **Problem:** Staff internal notes and customer form answers (which can hold personal data) stay readable in the browser after sign-out, on any shared or kiosk machine. The keys also grow without bound: one key for every item someone started typing on and walked away from.
- **Case:** An agent on a shared support desk PC types an internal note on TD-42 ('customer is on credit hold, do not ship') and navigates away without posting, then signs out. The next person opens DevTools > Application > Local Storage and reads the note. The same happens with a customer's half-filled request form on a shared office PC.
- **Fix:** Add a prefix argument to the existing loop in recent-items.ts, for example clearStoredKeys(prefixes: string[]), keeping its try/catch. In use-sign-out.ts onSuccess, call it with the recent prefix plus `taskdesk:comment-draft:` and `taskdesk:intake-draft:`. Call the same helper with `taskdesk:intake-draft:` and `taskdesk:comment-draft:` from the portal sign-out handler (portal-user-menu.tsx, which uses portal-auth-client signOut). Add one unit test that seeds both prefixes and checks they are gone after sign-out.
- **If skipped:** A confidentiality leak of internal notes and customer data on shared machines.

### Every realtime event makes every viewer refetch every loaded page
- **Where:** `apps/web/src/hooks/use-native-work-item-realtime.ts` lines 20, 145-166, 189-191; hooks/queries/work-item/use-get-board-work-items.ts:13,109; use-get-combined-board-work-items.ts:52
- **Group:** nice (scale)
- **What this is:** Any work_item.* frame on `project:X` invalidates `["work-items", X]`. That prefix covers the list, the board (200-row pages) and the combined board infinite queries. TanStack v5 refetches every loaded page of an infinite query in sequence, and the 150 ms debounce is per tab with no jitter. Separately, the combined board polls every 30 s with all pages, whatever the realtime state.
- **Problem:** Load grows as viewers x loaded pages x events, all at the same moment. Each page read joins custom fields, labels, SLA and blockers on the server, so one busy project turns into a request burst on every edit.
- **Case:** 25 agents have project SUP open on the board, which loads 3 pages of 200. One agent drags a card (a transition plus a rank, giving 2 events about 150 ms apart, possibly 2 flushes). Within about 150 ms, 25 tabs each issue 3 sequential board page reads: 75-150 heavy queries for one drag. Bulk-editing 20 items repeats that 20 times.
- **Fix:** Smallest step: in use-get-combined-board-work-items.ts, gate the poll the same way the board does. Pass realtimeStatus in and use `refetchInterval: realtimeStatus === "available" ? false : 30_000`. If load measurements later show a burst, add a small jitter only to frames from other windows, for example `INVALIDATION_DEBOUNCE_MS + Math.random() * 300`. Do not add maxPages to the board or list queries.
- **If skipped:** API and database CPU spikes under normal multi-agent use, which show up as slow boards across the whole instance.

### Tested domain rules the API never calls (assignment, identity, portal reach)
- **Where:** `packages/domain/src/assignment/assignment.ts` lines 77-173, 264-316; identity/portal.ts 1-23; identity/membership-projection.ts 1-86; identity/identity.ts (mapExternalGroupsToRoles, decideProvisioningTransition, validateIdentityConnection, scimConflictResponse); workflow/workflow.ts evaluateGuards (only internal)
- **Group:** nice (lean)
- **What this is:** resolveDefaultAssignee, resolveAssignmentEffect, decideConcurrentSelfAssign, workItemsAssignedToInactive, resolveAssigneeOnProjectMove and countOpenAssignments are not even re-exported from the barrel. canReachCustomerPortalResource, projectEffectiveMembership, mapExternalGroupsToRoles and decideProvisioningTransition are exported but referenced by nothing outside packages/domain except their own tests (grepped apps, packages, tests and scripts).
- **Problem:** Their unit tests pass and look like coverage of concurrency, portal reach and IdP-to-role rules, but the API enforces those rules in its own code. A bug in the real path is not caught, while the dead copy stays green.
- **Case:** The API's self-assign race or IdP group mapping regresses. assignment.test.ts and identity.test.ts still pass because they test functions production never calls.
- **Fix:** Delete the unused functions and their test blocks: the six assignment functions in assignment.ts and assignment.test.ts; identity/portal.ts and identity/membership-projection.ts with their tests and barrel lines; and mapExternalGroupsToRoles, decideProvisioningTransition, validateIdentityConnection and scimConflictResponse with their tests in identity.ts and identity.test.ts. Remove any types only they use. Keep evaluateGuards, because workflow.ts calls it. Do not rewire API call sites in this change. If a domain rule should be the real one, track that as its own high-risk backlog item.
- **If skipped:** False confidence on security-relevant rules, plus about 300 lines of source and tests to maintain.

### Combined board disables drag whenever a capability query refetches
- **Where:** `apps/web/src/components/work-item/work-item-board-view.tsx` lines 171-196
- **Group:** nice (bug)
- **What this is:** A source project's capabilities count as `ready` only when `!query.isFetching`. These queries have a 5 min staleTime, so a remount or invalidation refetches them while their data is still valid.
- **Problem:** canRank and canTransition flip to false during every background capability refetch, even though the cached answer is still good.
- **Case:** A lead keeps the combined board open past 5 minutes. A remount or workspace-capabilities invalidation starts a refetch, and for its duration every card in that project cannot be dragged. A drag that started just before gets refused with 'transition forbidden'.
- **Fix:** In apps/web/src/components/work-item/work-item-board-view.tsx, change `ready` to `Boolean(capabilities) && !query?.isError`. This drops `!query?.isFetching`, and `!query?.isPending` goes too because having data already implies it. Update or add a test in work-item-board-view or work-item-board tests showing that a card stays draggable while its capability query refetches with data already cached.
- **If skipped:** Intermittent 'can't drag' reports on the combined board that are hard to reproduce.

## Area: ops-scripts

### Restore throws away its only undo before it checks that the restore worked
- **Where:** `scripts/restore.sh` lines 179-180, 186, 189-205
- **Group:** should (bug)
- **What this is:** Line 179-180 runs DROP DATABASE on the renamed pre-restore database right after promotion. Line 186 then runs `find /data -mindepth 1 -maxdepth 1 ... -exec rm -rf` on the live attachment volume before it moves the backup files in. Both happen before migrate (189) and the readiness probe (195-205).
- **Problem:** When migrate or readiness fails, the previous database and the previous attachments are already gone. The wipe also breaks the documented contract in operations-and-distribution.md: 'Restore object storage forward-only'. It also deletes every attachment uploaded after the backup was taken, which the doc calls the harmless direction to keep.
- **Case:** An operator restores the wrong but valid backup id, or a dump that migrate cannot apply to the current image, or the .env key differs and readiness stays red. The script prints 'Restored container failed readiness probe'. The live DB was already dropped at line 180 and /data was already emptied at line 186, so there is nothing to go back to unless someone took a separate manual backup.
- **Fix:** 1) Database: move the `DROP DATABASE "$RECOVERY_DB"` psql call from lines 179-180 to just before `exit 0` on line 199, after readiness passes. Then add a trap or failure message that prints the RECOVERY_DB name, so the operator knows which database to rename back. 2) Attachments: replace the whole alpine `sh -c` on line 186 with `sh -c 'tar -C /data -xf - && chown -R 10001:10001 /data'`. That extracts over the existing tree (forward-only), and drops the stage dir, the find/rm wipe and the mv. 3) Update the operations-and-distribution.md sentence to "dropped only after readiness is green". 4) In scripts/ci/compose-recovery.test.mjs, add a case where readiness or migrate fails, and assert that `DROP DATABASE "taskdesk_restore_recovery_` never runs. Also update the ordering assertions in the DO-2 swap test.
- **If skipped:** One mistyped --backup id or one bad migration during a real restore loses all current data permanently.

### restore.sh has no mode for SIT, UAT or local SIT, so it rebuilds the stack with the wrong overlay
- **Where:** `scripts/restore.sh` lines 111-129, 189-192
- **Group:** should (bug)
- **What this is:** The only modes are local (compose.local.yml + traefik), isolated (restore-drill) and production (compose.prod.yml). Technexus SIT runs compose.sit.yml, UAT runs compose.uat.yml (project taskdesk-v2-uat) and laptop SIT runs compose.testing.yml. Steps 4-5 (`dc run --rm migrate`, `dc up -d --wait taskdesk`) recreate containers from whatever overlay the mode picks. backup.sh has the same gap: it uses only `-f compose.yml`, so without --project-name it targets project `taskdesk` rather than `taskdesk-v2-uat`.
- **Problem:** On every real environment, the restore swaps the DB first and then recreates the app with the wrong configuration.
- **Case:** On Technexus SIT, `scripts/restore.sh --backup X --confirm --mode production` promotes the DB, drops the old one and wipes /data. Then `dc up taskdesk` needs the external network `proxy` from compose.prod.yml, which does not exist there (SIT uses `web`), and fails. The app stays down on a half-restored state. If `proxy` does exist, taskdesk comes up with TRUST_PROXY=1 instead of 2 and prod router labels, so rate limits and audit logs record the wrong client IP. Laptop SIT (compose.testing.yml, env_file credentials) cannot be restored with this script at all.
- **Fix:** In scripts/restore.sh, add `sit) COMPOSE_FILES+=(-f deploy/compose.sit.yml) ;;` and `uat) COMPOSE_FILES+=(-f deploy/compose.uat.yml) ;;` to the mode case. Also update the usage text, the error message, and the docs line in operations-and-distribution.md. The uat overlay's `name:` then selects taskdesk-v2-uat with no -p. Add one case to scripts/ci/compose-recovery.test.mjs asserting that `--mode sit` and `--mode uat` pass the matching -f overlay. Leave backup.sh alone (`--project-name` already covers it). Laptop SIT (compose.testing.yml with SIT_COMPOSE_ENV) is out of scope; it goes through deploy.sh local.
- **If skipped:** The documented Technexus 'back up, then rollback' path cannot actually restore SIT or UAT.

### Attachment backup layout depends on the mount point, and restore never checks it
- **Where:** `scripts/lib/compose-data-volume.sh` lines 11-16 (used by backup.sh:80,101-104 and restore.sh:149,183-186)
- **Group:** should (bug)
- **What this is:** The resolver accepts a volume mounted at either /app/data or /app/data/attachments and returns only the volume name. backup.sh tars the volume root and restore.sh extracts at the volume root. Storage reads from DEFAULT_ROOT=/app/data/attachments (apps/api/src/storage/filesystem.ts:91). Base compose mounts at /app/data, so that volume holds `attachments/<key>`. compose.testing.yml mounts at /app/data/attachments, so that volume holds `<key>`.
- **Problem:** A backup taken from one layout and restored into the other puts every file one directory off. The readiness probe never touches attachments, so the restore reports success.
- **Case:** Back up laptop SIT (compose.testing.yml) and restore it into a base, UAT or restore-drill stack: files land at /app/data/<key> and every download fails. The other direction lands them at /app/data/attachments/attachments/<key>. In both cases the restore still prints 'Restore verified ... green', and the old attachments were already removed.
- **Fix:** Keep the fix small: refuse a mismatch instead of converting between layouts. Have resolve_compose_data_volume print `<name> <destination>`, and have both callers split that output. backup.sh writes the destination to a MOUNT file and adds MOUNT to the sha256sum line. Before the first mutation, restore.sh checks the backup's MOUNT against the target's destination: if they differ, it exits with 'xx backup layout <a> does not match target <b>'. If MOUNT is missing (a backup made before this change), it also refuses unless an explicit flag is given. Update compose-recovery.test.mjs to cover the mismatch refusal. A path-shifting conversion (strip or add the attachments/ prefix) is only worth building if laptop-to-Technexus data moves become a real need.
- **If skipped:** A cross-environment restore, such as laptop data moved to Technexus, silently loses every attachment.

### A failed restore leaves the app stopped, and no test covers it
- **Where:** `scripts/restore.sh` lines 154-170
- **Group:** should (risk)
- **What this is:** `dc stop taskdesk` runs at line 164. If createdb or pg_restore into staging fails, set -e exits, and the EXIT trap only drops the staging DB. Nothing starts taskdesk again. The DO-2 test (compose-recovery.test.mjs:235) checks that the live DB is untouched, but not that the app is restarted.
- **Problem:** The live DB is intact, yet the service stays down until someone notices and starts it by hand.
- **Case:** A dump from a newer Postgres, or one that hits a missing extension, fails pg_restore at line 170. The script exits non-zero and taskdesk stays stopped with the original DB still there. Customers and staff get 502s.
- **Fix:** In cleanup_staging_db, inside the existing `if [ "$STAGING_ACTIVE" -eq 1 ]` block and after the DROP DATABASE, add `dc start taskdesk >/dev/null 2>&1 || true` with a one-line comment: the live DB was never touched, so bring the app back. Do not restart when STAGING_ACTIVE is 0, because the promotion and lost-commit-acknowledgement paths need operator inspection under the contract. In the DO-2 failure test in scripts/ci/compose-recovery.test.mjs, add `assert.match(failed.calls, /start taskdesk/);`. Also check that the fixture's docker stub records `start` calls the way it records `stop`.
- **If skipped:** Any restore that is rejected (the safe outcome) still turns into an outage.

### Re-using a backup id truncates the previous good backup before the new one is verified
- **Where:** `scripts/backup.sh` lines 46-49, 73, 83-91
- **Group:** nice (risk)
- **What this is:** `--backup <id>` or `--output-dir` points at an existing directory, `mkdir -p` accepts it, and `pg_dump ... > "$DUMP_FILE"` truncates the old dump at once.
- **Problem:** A failure in the new run leaves an empty or partial dump next to the old SHA256SUMS. That directory then holds no valid backup at all.
- **Case:** A cron job runs `scripts/backup.sh --backup nightly`. Tonight pg_dump fails halfway (DB restart or disk full). Last night's postgres.dump has already been overwritten, and restore.sh rejects the checksum mismatch, so the only local backup is lost.
- **Fix:** Write each new run into a staging directory and move it into place only after every step passes. Do not refuse existing dirs. After `umask 077`: `STAGE="$(mktemp -d "${TARGET_DIR%/}.partial.XXXXXX")"; trap 'rm -rf "$STAGE"' EXIT`. Point DUMP_FILE, ATTACHMENTS_TAR and CHECKSUMS_FILE at "$STAGE" and run the checksum subshell in "$STAGE". After the chmod: `mkdir -p "$TARGET_DIR" && mv -f "$STAGE"/postgres.dump "$STAGE"/attachments.tar "$STAGE"/SHA256SUMS "$TARGET_DIR"/ && rmdir "$STAGE"; trap - EXIT`. A failed run then leaves the previous backup untouched, and the existing compose-recovery tests keep passing.
- **If skipped:** A fixed-name rotation loses its last good copy on the first failed run.

### Installed hosts get no backup/restore scripts and no SIT overlay
- **Where:** `install.sh` lines 266 (and .github/workflows/release.yml git archive pathspec ~line 348)
- **Group:** should (risk)
- **What this is:** The release archive contains only `compose.yml deploy scripts/deploy.sh scripts/lib/local-certificate.sh scripts/lib/deploy-checks.sh`. scripts/backup.sh, scripts/restore.sh and scripts/lib/compose-data-volume.sh are never shipped. install.sh then copies a fixed member list that also leaves out deploy/compose.sit.yml and deploy/compose.restore-drill.yml, even though the archive has them.
- **Problem:** The documented recovery commands (`scripts/backup.sh`, `scripts/restore.sh`) do not exist on any host installed with install.sh. `deploy.sh sit` and `upgrade --target sit` fail there.
- **Case:** A host installed with `install.sh --env production`, then `scripts/backup.sh` gives 'No such file or directory'. `scripts/deploy.sh upgrade --target sit` dies with 'SIT overlay deploy/compose.sit.yml is required'.
- **Fix:** Add scripts/backup.sh, scripts/restore.sh and scripts/lib/compose-data-volume.sh to the git archive pathspec at release.yml:350. This changes a workflow, so it needs Thomas's approval. Then add those three files plus deploy/compose.sit.yml and deploy/compose.restore-drill.yml to the install.sh:266 member list. Optionally drop the two missing compose.keycloak/observability entries.
- **If skipped:** Customer installs have no supported way to back up or restore.

### upgrade saves the new image to .env before migrate and probe succeed, and prints the rollback command only on success
- **Where:** `scripts/deploy.sh` lines 620-623, 644-661
- **Group:** should (bug)
- **What this is:** persist_image_selection writes the new TASKDESK_IMAGE_TAG/DIGEST into .env at line 621. The pull, migrate, start and probe come after it. The 'Roll back with: ...' line is printed only at line 658, after probe_api passes.
- **Problem:** When an upgrade fails, .env already points at the failed image, and the exact rollback command is never printed.
- **Case:** Migrate fails on the new image (line 644) and the script dies. The old container keeps running, but .env now holds the new digest. The next `deploy.sh production`, `restore.sh` (which runs `dc run --rm migrate` and `dc up` from .env) or a host reboot with `docker compose up` brings up the broken image again. The operator has to dig the old digest out of line 594's output.
- **Fix:** Upgrade case only. Move `persist_image_selection "${TASKDESK_IMAGE_TAG:-v2.0.0}" "$TASKDESK_IMAGE_DIGEST"` from line 621 to just after `probe_api` (line 654). The exported TASKDESK_IMAGE_TAG and TASKDESK_IMAGE_DIGEST already feed compose during the run. Build the rollback command (ROLLBACK_OVERLAY_FLAG and CURRENT_DIGEST) before `dc run --rm migrate` and print it there as 'if this upgrade fails, roll back with: ...'. Keep the final ok line. Leave the rollback case as it is, because persisting before migrate is the intended behaviour there.
- **If skipped:** A failed upgrade turns into a sticky outage on the next compose action.

## CI failure analysis

## CI failure audit: last 100 failed runs (12–17 Nov)

**The short answer:** `main` has passed every required check. Of the recent failures, only two things matter.

1. **`supply chain - dependency audit` is now red for every run, and `main` will go red on its next push.** This is a required check. A new advisory came into the audit data some time between 03:58 and 18:14 on 17 Nov, and nothing in the repo changed.
2. **G11 fails on every PR.** It is report-only, so it does not block merges. The misses are real app performance problems, and one of them got much worse around 15–16 Nov.

The other failures were real defects on their own branches, or out-of-date baselines and manifests, and were fixed before merge. None of them has come back on `main` or on recent trains. The `failjobs.txt` counts match the per-job API counts closely (G11 75, G8 20, static 18).

**State of `main`:** CI-fast on pushes to `main` passed every time I checked, last on 17 Nov at 03:58 (run 44013930470). CI-full does not run on `main` pushes. Merged PRs #1195, #1197, #1198 and #1201 failed only G11. No CI-full run has fully passed since 26 Oct, because G11 always fails, so a red CI-full run tells you nothing by itself.

**Required checks** (from the `main` ruleset): static, unit + component, build, registers, route policy, gate checkers, contract, CI matches ci-cd.md, dependency audit, secret scan, helm, domain coverage, integration - Postgres 18, e2e, a11y G4, visual G8, PR template. G11 is not in the list.

| Job | Failures | Required? | Root cause class | Exact failing test or step | Evidence (run ids) | Smallest fix |
|---|---|---|---|---|---|---|
| performance - budgets (G11) | 75 | No (report-only, frozen) | Real app defect, the same on every branch | **work-list LCP** misses every run: 2568–2955 ms against a 2500 budget. The LCP element is a list row ("Seeded work item 10"). DOMContentLoaded is about 2000 ms, so the entry chunks are too heavy. **work-list to detail route first paint** has two modes: about 300 ms, or 1700–1900 ms. Both modes can appear inside one run (samples 1759/1767/295 in run 43917230799). The slow mode first appears on `fix/after-uat-polish-batch-2` (#1192) on 15 Nov. Other misses come and go near the line: board render 200 tasks (505–594 ms against 500), assign task click (207–218 ms against 200), command palette (209 ms), board drag p95 (one run at 117 ms). Calibration put the runners in the fast class (factor 0.84–0.97), so slow runners do not explain this. | 44145713505, 43917230799, 43884050592, 43827048618, 43815864195, 43759490145 (slow mode); 43838629233, 43910684038 (about 300 ms) | Leave it non-blocking, as handover says. Do one bounded diagnosis of the new ~1.4 s stall on list to detail: compare the #1192 head with its base. G11 thresholds stay unchanged (Thomas's rule). |
| supply chain - dependency audit | 1 so far, will be every run | **Yes** | Environment: new upstream advisory, no patched version | `pnpm audit --audit-level=high`: GHSA-fc5q-39xc-vjpf, picomatch `<=4.0.7`, ReDoS, "Patched versions <0.0.0". Path is `apps/api > vitest > picomatch` and `vitest > tinyglobby > picomatch`. The lockfile has picomatch 4.0.5 and 4.0.7. 4.0.7 is the newest on npm. | 44145713257 (PR #1203). `main` passed at 03:58 the same day. | Needs Thomas's decision (see "What I need from you"). |
| visual regression (G8) | 20 | Yes | Out-of-date baselines or manifest on the branch (UI changed, nothing regenerated) | Before any test runs, `check:visual-scope` fails with: "no committed Playwright baseline … project-calendar-linux.png", "inventory route Forgot/Reset password … has no G8 test/baseline manifest entry", "Approvals inbox (/agent/my-work?lens=approvals) has no G8 … entry". Screenshot diffs: god-mode/admin screens 432 px each (legal-hold branch); portal screens (#1087 polish); forgot/reset password, intake triage queue, organisation identity (12 Nov train-f); workspace settings members; project timeline 18,203 px (s3-fixture). | 131399754941, 132779252124, 132817581111, 132776827650, 133400491051 | Regenerate baselines and the manifest in the pinned container on the branch that changes the UI. No recurrence on `main`. |
| static | 18 | Yes | Out-of-date manifest on branches (all 12–13 Nov) | `pnpm check:tokens`: "packages/ui/src/styles/pairs.json entry 213/215/230/235 occurrence contract omits a live source context". Also `pnpm check:i18n` (4). | 131825827765, 131772674121 | Update `pairs.json` together with the UI change. Fixed, no failures since 13 Nov. |
| e2e - protected-route redirect | 13 | Yes | Mostly real branch defects, plus one flaky test | d1-detail-instant: about 12 persisted journeys fail at `toHaveURL(/\/dashboard\/workspace\//)` and get `/agent` (board-drag-persisted.spec.ts:107, mfa-csrf-journey, sla-policy, realtime, and others). The branch changed the redirect after creating a workspace. **Flaky:** `motion-rules.spec.ts` "rule 9: reduced-motion disables spatial movement…", at `await expect(tooltipPopup).toBeVisible()` after `hover()` (line 896), and evaluating a detached element (line 253). Also seen: rules 1 and 5, and `work-item-detail-reaudit.spec.ts:308` create-dialog pickers (train-14-g). Playwright `retries: 0`. | 131825808479 (branch defect); 133400490958, 132479986729 (motion flake) | Branch: fix or drop the redirect change. Flake: before hovering, wait for the tooltip trigger to be stable (or focus it). Do not add retries. |
| integration shards 1–4 / Postgres 18 aggregate | 11/11/9/9 shards, 13 aggregate | Yes (aggregate) | The 12–13 Nov cluster was a broken shared train-f base (real defect). Later failures are sporadic, and one is a real defect. | The 12–13 Nov cluster repeats on 5 branches: `api-key-project-role-clamp` "a key never exceeds its owner…", `approval-lifecycle`, `audit-read` manager reach, `activity-relation-time-entry-crud`, `b5-staff-project-reach`, `wrong-portal-sign-in`. After that, each failure appears once: **`notification-inbox-filter-count.test.ts` fails with "bind message has 32967 parameter formats but 0 parameters" (PG 08P01).** The query goes over the PostgreSQL limit on bind parameters (a real defect when there are many reachable rows); I did not check whether `main` has it. `seaweedfs-s3.test.ts` "Hook timed out in 60000ms" (infra flake). `uat-seed.test.ts` "requires completed setup and seeds once": singleton deep-equal mismatch (branch). | 131400835419, 131708750974, 131434852959 (cluster); 132756933368 (bind overflow); 133357803101 (SeaweedFS); 132779252094 (uat-seed) | Cluster: fixed, no failures since 13 Nov. Check the notification query on `main` and chunk it or use `= ANY($1)`. SeaweedFS: raise the setup timeout or add a readiness wait. |
| unit + component | 10 | Yes | Real defect on the shared base (12–13 Nov), plus one branch defect | `tests/api/two-entry-host.test.ts` "keeps the server-side portal route allowlist equal to the portal route tree" (8 of 8 in that cluster). `migration-journal-order.test.ts` "gives every entry after the snapshot cut-off a meta snapshot". 16 Nov: `e2e-secret-redaction.test.ts`, where the new project-key-role-matrix specs did not turn off traces, video and screenshots. | 131774868553, 131434868763, 133618632636 | Already fixed before merge. Nothing to do. |
| build | 9 | Yes | Real defect (12–13 Nov) | `pnpm check:bundle-size`: "G11 agent work-list initial route graph: 354.8 KB gzip / 350 KB budget". | 131783595830 | Fixed. Bundle size is the same root problem as the G11 LCP miss. Headroom is probably small; see the ranked list below. |
| registers | 9 | Yes | Branch defect (12–13 Nov) | `pnpm check:env` "1 problem": env reads not registered in `staff-registration.ts:25`, `verified-placeholder-claim.ts:52`, `auth-local-methods.ts:185`, `seed-internal-organisation.ts:160`. Also `check:inventory` (2). | 131774868731 | Fixed. |
| a11y (G4) | 2 | Yes | Flaky test (same motion-rules tests) | motion-rules rules 1, 5 and 9 | 132479986767 (train-14-g) | Same fix as the motion flake above. |
| PR template + security review | 2 | Yes | Branch / process | `pr-template check`: section "missing or empty. Describe the actual outcome and checks…" | 132773950669, 131578273794 (dependabot) | Fill in the template. |

### What keeps failing, ranked

1. **The dependency audit blocks every PR and the next `main` push.** Every PR, #1203 included, now fails a required gate for a reason that has nothing to do with its code. There is no patched picomatch, and `ci-fast.yml:351-377` forbids `auditConfig`/`ignoreGhsas`, `--audit-level=critical` and `continue-on-error`. **Next action:** see "What I need from you". Until you decide, no PR can go green.
2. **G11 work-list LCP misses every run (2.57–2.95 s against 2.5 s).** The entry bundle is too heavy (DOMContentLoaded about 2 s, late chunks such as `date-time-picker` load after 6 s). **Next action:** none while G11 is frozen. When it is unfrozen, take the LCP row out of the entry graph (lazy-load row controls). That also gives back the bundle headroom that `build` ran out of on 12–13 Nov.
3. **G11 list to detail route has an intermittent ~1.4 s stall, new since about 15 Nov.** First seen on the #1192 (`after-uat-polish-batch-2`) branch, and on branches after it. It was about 300 ms before. A UAT user would notice this, and nobody sees it because the gate is report-only. **Next action:** run the perf diagnostic config (`playwright.perf-diagnostic.config.ts`) on the #1192 head and on its base, and compare the CPU profiles that the G11 diagnostic step already uploads.
4. **The motion-rules tooltip test is flaky** (rule 9, and sometimes rules 1 and 5). It hits both required e2e and a11y, with `retries: 0`. **Next action:** a single change to wait for a stable trigger before `hover()` in `apps/web/e2e/motion-rules.spec.ts` (around lines 894–896). Item L-02 in the roadmap backlog already covers flaky tests.
5. **The notification inbox query overflows the bind-parameter limit** (`notification-inbox-filter-count.test.ts`, 08P01, 32,967 parameters). Seen once on `fix/t11-scim-externalid-and-reach`. This looks like a real scaling defect (too many IDs bound one by one), and it would hit a large tenant too. **Next action:** check the query on `main` and bind one array parameter (`= ANY($1)`) instead of one per ID.
6. **G8 manifest and baselines go out of date on UI branches.** It is the same cause every time, because new routes and inventory rows are added without a baseline. **Next action:** before pushing a UI change, run `pnpm check:visual-scope` locally and regenerate baselines in the pinned container. This is process, not code.
7. **The SeaweedFS S3 integration setup sometimes times out at 60 s** (seen once). **Next action:** add a readiness wait in that test's setup. Only do it if it happens again.

Not recurring, nothing to do: the 12–13 Nov train-f cluster (unit two-entry-host, integration reach tests, `check:env`, bundle size, `pairs.json`) was a broken shared base and is gone on `main`.

### What I need from you

- **The picomatch advisory.** Upstream has no fix, the repo's rules forbid every audit exception, and you decide on gate exceptions. Do you want to (a) wait for an upstream picomatch release, (b) approve a recorded, time-limited exception for this one dev-only advisory, or (c) approve a dependency change that removes picomatch 4.x from the vitest path? Until you choose, #1203 and every other PR stay blocked.
- **Whether to diagnose the ~1.4 s route stall now,** even though G11 is frozen. It is a real UX regression that was merged while G11 was report-only.

---
I did not check: whether the bind-parameter overflow and the project-timeline G8 diff happen on `main`, every one of the 20 G8 logs, and the cause inside #1192. Main risk: the next push to `main` will fail the required dependency audit.
