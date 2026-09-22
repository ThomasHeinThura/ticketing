# Security review — #8 route-authorization classification pass

**Reviewed head:** `a6a2e499b1dd313719cf463e3326e7a86a914a46`

**Branch:** `feat/8-route-authorization-classification`
**Merge base with `main`:** `5c5a028e0ed5644452e176b0e55cb6a1b9ad38fe`
**Reviewer tier:** Opus, fresh independent context — did not author, orchestrate, remediate or
previously review this change. Two Sonnet rounds preceded this one (APPROVE, ALIGNED WITH
NOTES); every conclusion below was re-derived from source rather than inherited from them.
**Date:** 2026-09-22
**Scope of the mandate:** issue #8's own "Done when" clause — *"An Opus security review has read
every `public` and `delegated` reason and signed off, before P0 closes."* Plus adversarial
re-verification of the two behavioural fixes, an independent sample of `capability`/`self`
classifications, the deliberately-uncovered route, the runtime-integration gap, the full test
suite and the diff scope.

---

## Verdict

**CLEAR WITH FINDINGS (non-blocking).**

Every `public` and `delegated` reason on this branch is **true** against the handler it
describes. No route declared `public` is in fact credential-gated; no route declared `public` is
in fact something an unauthenticated caller should not reach; no `delegated` entry names a
surface outside the closed `DELEGATED_SURFACES` set. Both behavioural fixes are genuine and were
re-derived independently. The three findings below are documentation-accuracy and
follow-up-tracking items, not defects in what this branch ships, and none of them blocks merge.

---

## 1. Every `public` and `delegated` reason, read and verified

Enumerated by grepping `public: true` and `delegated:` across `apps/api/src/` at the reviewed
head: **9 public, 9 delegated, 18 total.** Each was read in full, then the actual handler was
read and traced.

### 1.1 `public` — all nine

| # | Route | Declared in | Handler traced | Reason true? |
| --- | --- | --- | --- | --- |
| P1 | `GET /api/health` | `policy-registry.ts:107` | `index.ts:326` — `c.json({status:"ok"})` | **Yes.** Returns a literal constant, reads nothing, touches no dependency. |
| P2 | `GET /api/public/health/live` | `policy-registry.ts:117` | `index.ts:333` — same constant | **Yes.** Reason says "touches no dependency"; the handler genuinely does not. |
| P3 | `GET /api/public/health/ready` | `policy-registry.ts:121` | `index.ts:342` — `getDatabase().execute(sql\`SELECT 1\`)`, 200/503 | **Yes.** Reason says "checks database reachability"; that is exactly and only what it does. See finding F3. |
| P4 | `PUT /api/storage/filesystem-upload` | `policy-registry.ts:134` | `index.ts:397`→`writeUploadedObject` (`storage/filesystem.ts`) | **Yes, and the reason is unusually precise.** Verified: HKDF-SHA256 key derived from `TASKDESK_AUTH_SECRET` (`deriveUploadTokenKey`); HMAC-SHA256 over `` `${key}\n${expires}` `` (`signUploadToken`); **constant-time** comparison via `crypto.timingSafeEqual` with a prior length check (`verifyUploadToken`); expiry enforced before verification; path safety re-derived independently of the token layer (`assertSafeRelativeKey` rejects NUL — confirmed a real `\x00` literal in the source bytes, not a space — backslash, absolute paths and `.`/`..`/empty segments; `resolveWithinRoot`; `assertNoSymlinkEscape` before and after `mkdir`; `O_NOFOLLOW` on open). "No session applies" is correct: the token *is* the credential, exactly as a presigned S3 URL is. |
| P5 | `GET /api/invitation/public/{id}` | `policy-registry.ts:155` | `index.ts:372` → `getInvitationDetails` (`utils/check-registration-allowed.ts`) | **Yes.** No credential is read anywhere on the path. The cuid2 claim is verified at source: `invitationTable.id` is `text().$defaultFn(() => createId()).primaryKey()` (`database/schema.ts:248`) — collision-resistant, non-sequential, not enumerable. The password-reset-link trust model is the right analogy. See finding F2 for a wording gap. |
| P6 | `GET /api/user/avatar/{id}` | `policy-registry.ts:196` | `index.ts:483` → `getAvatar` (`user/controllers/get-avatar.ts`) | **Yes, and both supporting claims check out.** The handler calls no authorization function at all — it selects by id and streams bytes. `userAvatarTable.id` is also a `createId()` cuid2 (`schema.ts:104`), and `saveAvatar` explicitly sets `id: createId()` inside its `onConflictDoUpdate` set clause (`user/controllers/save-avatar.ts`), so "the id changes on replace" is enforced in code, not merely intended — which is what makes the `Cache-Control: public, max-age=31536000, immutable` safe. |
| P7 | `GET /api/openapi` | `policy-registry.ts:206` | `index.ts:539` — `api.getOpenAPI31Document(...)` | **Yes.** The document is generated from static route definitions plus `KANEO_API_URL`; no query runs, no tenant data is reachable. Named explicitly in #8's own H2 text as pre-existing kaneo behaviour owned here. See finding F3. |
| P8 | `GET /api/instance/status` | `instance/policy.ts:26` | `instance/controllers/get-instance-status.ts` — `return { status: "ok" }` | **Yes.** The reason's load-bearing claim ("reveals no setup state") is literally true: the function body is a constant return. #18's fix — it previously computed `{hasUsers, hasAdmin}` live from the user table — is genuinely landed, not merely documented. The `elevated: false` + `elevationExemptionReason` pair is correct and required (`/api/instance/*`). |
| P9 | `GET /api/config` | `config/policy.ts:40` | `config/index.ts` → `utils/get-settings.ts` | **Yes, and I checked the response field-by-field for secret leakage.** `getSettings()` returns eleven booleans plus one operator-configured URL (`customOAuthLogoutUrl`). Crucially, the OAuth provider fields are `Boolean(process.env.GOOGLE_CLIENT_ID) && Boolean(process.env.GOOGLE_CLIENT_SECRET)` — the *presence* of a secret, never its value. `config/response.ts`'s Zod schema pins the shape, so a future field cannot silently widen it without a visible diff. No client id, no secret, no SMTP host, no internal URL. |

**`public` adversarial pass (issue #8 risk R20, plus the scanning-oracle / existence-leak class).**
I looked specifically for exploitation beyond what each reason accounts for:

- **No scanning oracle survives.** P1/P2/P8 are constants. P9 is instance-wide configuration the
  login screen provably needs before any credential exists, and it is identical for every
  caller — it distinguishes nothing about users, tenants or setup state. The one historical
  oracle on this surface (`/api/instance/status` revealing `hasAdmin`, letting an attacker race
  an operator to claim an instance — finding E-13) is closed at source, verified above.
- **No enumeration primitive.** The two id-addressed public routes (P5, P6) both key on cuid2
  identifiers generated by `@paralleldrive/cuid2`. Neither is sequential, neither is derived
  from a user id, and neither route offers a listing. Reachability is possession of a link,
  which is the stated model.
- **No credential-adjacent abuse on P4.** The upload token binds the exact object key, so a
  valid token cannot be replayed against a different key; the TTL bounds it; overwrite is
  limited to the single key the token was minted for. The expiry-before-signature ordering
  lets a caller distinguish "expired" from "invalid", which discloses nothing an attacker does
  not already know about their own token.
- **Residual, accepted, and worth naming (F2, F3):** P5 discloses more fields than its reason
  enumerates, and P3/P7 are unauthenticated surfaces whose exposure is deliberate but worth an
  operator-facing note. Neither is a false claim; both are below.

### 1.2 `delegated` — all nine

`DELEGATED_SURFACES` is the closed set `["better-auth", "websocket", "metrics", "scim"]`
(`packages/permissions/src/policy.ts`). All nine entries name `better-auth` or `websocket`; no
entry invents a sixth surface or stretches an existing one.

| # | Route(s) | Surface | Handler traced | Reason true? |
| --- | --- | --- | --- | --- |
| D1–D5 | `GET/POST/PUT/PATCH/DELETE /api/auth/*` | `better-auth` | `index.ts:648` — `api.on([...], "/auth/*", ...)` forwarding to `auth.handler(buildAuthRequest(c))` | **Yes.** This genuinely *is* the better-auth mount; the handler's only extra logic is moving a Bearer token into the `x-api-key` header when it is not already a valid session, which is credential plumbing inside the delegated surface, not an authorization decision this registry should be modelling. The reason's own caveat — that the endpoint set is the runtime plugin list, closed by `better-auth-plugin-list.test.ts`'s allowlist assertion — is accurate and that test is green (part of the 80). |
| D6 | `GET /api/ws/user` | `websocket` | `index.ts:812` | **Yes.** `await authenticateApiRequest(c)` runs inside the `upgradeWebSocket` callback, before the returned handler object exists and therefore before the socket opens. A thrown `HTTPException` is re-thrown unchanged; a non-HTTP error becomes a 500. No connection is registered unless `userId` is set. |
| D7 | `GET /api/ws/{projectId}` | `websocket` | `index.ts:861` | **Yes, and stronger than the reason claims.** Same pre-upgrade `authenticateApiRequest`, then the project row is loaded and `validateWorkspaceAccess(userId, project.workspaceId)` is called — a real membership check, not just authentication. A missing project 401s rather than opening an unscoped socket. |
| D8 | `GET /api/auth/get-session` | `better-auth` | `index.ts:378` — `auth.handler(buildAuthRequest(c))` | **Yes.** Byte-for-byte the same forward as the wildcard; the carve-out exists solely to attach an OpenAPI schema. "Unauthenticated-callable by design" is correct — this is precisely the endpoint a caller with no session uses to discover that. |
| D9 | `GET /api/auth/device` | `better-auth` | `index.ts:610` | **Yes — and I specifically hunted for an open redirect here, because the reason mentions query parameters "echoed into the redirect URL".** There is none. The redirect origin is built from `process.env.TASKDESK_AGENT_URL` (server-controlled, trailing slash stripped) with a fixed `/device` path; only `user_code` is attached, and via `URL.searchParams.set`, which percent-encodes. The `ui` parameter is constrained by Zod to the literal `"1"` and is never placed in the URL at all — it only selects the redirect branch. Everything else forwards to `auth.handler`. |

**One wording imprecision, not a defect:** D9's reason says "the request's own `user_code`/`ui`
query parameters echoed into the redirect URL". Only `user_code` is echoed. The statement is
conservative in the safe direction (it claims *more* is echoed than actually is), so it cannot
mislead a reviewer into under-checking. Noted, not raised as a finding.

---

## 2. The two behavioural fixes, re-derived independently

### 2.1 `GET /api/asset/{id}` moved below the auth guard — **verified, three ways**

This is the canonical H2 failure case named in issue #8's own text, so I did not accept any
part of it on report.

**(a) Handler body byte-identical.** I extracted the handler closure from both revisions by
brace-balancing from `async (c) => {` after `path: "/asset/{id}"`, and compared the raw strings:

```
old handler bytes: 2133   new: 2133   BYTE IDENTICAL: True
```

The only changes in the `createRoute` *descriptor* are: `security: []` removed (correct — the
route is no longer public), `description` rewritten to state the credential requirement, `401`
added, and `403`/`404` switched from bare objects to the shared `errorResponse()` helper. No
logic moved.

**(b) Genuinely below the guard.** Read from `index.ts` directly, not from the policy comment:
the app-wide guard `api.use("*", ...)` calling `authenticateApiRequest` is at **line 674**; the
asset route's `api.openapi(` is at **line 707**. Below, unambiguously.

**(c) No other route's relative order shifted.** I extracted the complete ordered registration
sequence (`api.openapi` paths, `api.route` mounts, `app.use`, and the guard) from both revisions
and diffed them. Old 30 entries, new 30 entries, and the diff is exactly one move:

```
 openapi:/instance/status
 openapi:/auth/get-session
-openapi:/asset/{id}
 openapi:/storage/filesystem-upload
 openapi:/user/avatar/{id}
 route:/config
 openapi:/auth/device
 ===API AUTH GUARD===
+openapi:/asset/{id}
 route:/oauth
```

Nothing else changed position. `route-coverage.test.ts` now also asserts
`aboveGuard.has("GET /api/asset/{id}") === false` against the live router, so the move is pinned
by a regression test rather than by a comment — and it substituted `GET /api/openapi` as the
positive above-guard assertion so the test does not become vacuous.

**(d) The route really was never public.** `authorizeAssetAccess` →
`resolveAssetBearerOrCookie`, whose every branch ends in `throw new HTTPException(401)` when no
credential resolves → `validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId)`, which
returns early for a platform admin and otherwise 403s without a `workspace_user` row. The policy
in `apps/api/src/asset/policy.ts` therefore describes what runs. Its self-criticism is also
correct and worth preserving: it declares `scope: "workspace"` rather than `project`/`work_item`
*because the runtime only ever evaluates `asset.workspaceId`*, and it says so — declaring a
narrower scope would have asserted a boundary the code does not enforce. That is the right
instinct and the opposite of the R20 failure.

### 2.2 `GET /api/invitation/pending` gains `requireSessionOnly()` — **verified by tracing both credential paths**

The change is one line: `middleware: [requireSessionOnly()] as const` on `getPendingRoute`
(`apps/api/src/invitation/index.ts`). I traced whether it does what the policy's new
`sessionOnly: true` claims, from `authenticateApiRequest` outward rather than from the
middleware inward.

**An API-key-authenticated request is blocked.** `authenticateApiRequest` has two API-key
branches (`x-api-key` header, and a Bearer token that `verifyApiKey` accepts). Both set
`c.set("session", null)` and `c.set("apiKey", {...})`. `requireSessionOnly` tests
`if (c.get("apiKey"))` **first**, and throws `403 session_required`. Blocked. ✔

**A normal browser session passes.** The cookie path sets `c.set("session", sessionResult.session)`
and never touches `apiKey`. `requireSessionOnly` then finds no `apiKey`, finds a truthy
`session`, finds no `impersonatedBy`, and calls `next()`. Passes. ✔ The better-auth bearer
*session token* path (`getSessionFromBearerOnlyHeaders`) behaves identically — session set,
`apiKey` absent — so the middleware's own doc comment ("cookie or better-auth bearer session
token; both populate `c.get("session")` with `apiKey` absent") is accurate.

**Ordering is sound.** The invitation router is mounted at `index.ts:806`, below the guard at
674, so `authenticateApiRequest` has already populated `apiKey`/`session` before the route
middleware runs. There is no window in which `requireSessionOnly` reads an unpopulated context.

**Impersonation branch is currently unreachable but correct.** No `admin()` plugin is mounted in
`auth.ts`, so `session.impersonatedBy` is never set today. Keeping the check is right — it costs
nothing and closes the gap on the day such a plugin lands. The doc comment says exactly this and
does not overclaim.

**The declaration order is also right.** `sessionOnly: true` was added to the policy *in the same
change* that added the middleware, not before. Given that nothing evaluates the registry at
request time yet (§4), declaring the flag without the middleware would have been precisely the
"declared-and-inert metadata" that `policy.ts`'s own doc comment says this registry exists to
refuse. The lane got this ordering correct.

A related note verified in passing: `workspace/policy.ts`'s new
`GET /api/workspace/{workspaceId}/members` entry also declares `sessionOnly: true`, and
`requireSessionOnly()` is genuinely present on that route in `apps/api/src/workspace/index.ts`
(pre-existing on `main`, line 157). Declaration matches runtime.

---

## 3. Independent sample of `capability` / `self` classifications

Deliberately weighted away from what the two Sonnet rounds covered (task, comment, user, oauth,
label, asset, invitation). **32 route classifications verified**, each read against its actual
router middleware and, where the middleware alone did not settle it, against the controller:

**`column` (5/5)** — All five confirmed against `column/index.ts`: `GET /{projectId}` has only
`workspaceAccess.fromProject("projectId")` (no capability check), and the policy declares
`project:read` while stating plainly that nothing distinct enforces it. The four mutation routes
all carry `requireWorkspacePermission({ project: ["update"] })`, matching the declared
`project:update`. `fromColumn("id")` for the `{id}` routes does issue a real
`column ⋈ project` join. ✔

**`task-relation` (3/3)** — `GET /{taskId}` → `fromTaskId` only; `POST /` → `scopeToSourceTask` +
`task:["update"]`; `DELETE /{id}` → `scopeToRelation` + `task:["update"]`. All three match. The
`scope: "work_item"` choice over `project` is correct per rbac.md's own
`GET /api/work-items/{key}` precedent. ✔

**`workflow-rule` (3/3)** — `GET /{projectId}` reach-only; `PUT /{projectId}` and `DELETE /{id}`
both `project:["update"]` behind `fromProject` / `fromWorkflowRule`. ✔

**`external-link` (1/1)** — single route, `fromTaskId("taskId")` only, no
`requireWorkspacePermission` anywhere in the router. Policy says exactly that. ✔

**`activity` (5/5)** — Verified the file's own flagged gap is real: `PUT /api/activity/comment`
and `DELETE /api/activity/comment` carry **only** `workspaceAccess.fromActivity("activityId")`,
with no `requireWorkspacePermission`, whereas their `/api/comment/{id}` twins carry
`requireWorkspacePermission({ task: ["update"] })`. The policy declares `comment:update_own` /
`comment:delete_own` and names the weaker gate in a comment rather than inventing a capability to
match it. I then confirmed the ownership constraint is real and structural: both shared
controllers (`activity/controllers/update-comment.ts`, `delete-comment.ts`) filter on
`and(eq(id), eq(activityTable.userId, userId), eq(type, "comment"))` on **both** the pre-read and
the write. So `_own` is enforced in the controller even though no middleware says so. ✔

**`notification` (5/5)** — All five `self`. Verified every controller: `getNotifications`,
`markAllNotificationsAsRead`, `clearNotifications` all filter `WHERE userId = caller`;
`markNotificationAsRead` filters `and(eq(id), eq(userId))`; and the `POST` claim was checked at
the schema, not the handler — `createNotificationBody` (`notification/schema.ts`) has **no
`userId` field at all**, so targeting another user is not expressible. Every call site passes
`c.get("userId")`. ✔

**`notification-preferences` (4/4)** — All four `self`. `assertWorkspaceMembership` exists at
`service.ts:119` and is genuinely the **first** statement of both `upsertWorkspaceRule` (line
513) and `deleteWorkspaceRule` (line 634), before any row is touched; it 403s on a missing
`workspace_user` row. The policy's own flag — that this check lives in the service layer with no
`workspaceAccess.*` middleware backing it at the route — is accurate and is the right thing to
have raised. ✔

**`search` (1/1)** — `workspaceAccess.fromQuery()` is the only middleware; `workspaceId` is a
required query parameter, so `scopeSource: "request"` is the honest declaration (nothing loads
and re-verifies a `workspace` row). I confirmed the `userEmail` claim: `globalSearch`'s
`if (!resolvedUserId && userEmail)` branch is dead through this route because `search/index.ts`
always passes `c.get("userId")`. I also confirmed that when `workspaceId` *is* supplied the
`workspaceFilter` does **not** intersect with `accessibleWorkspaceIds` — which is safe only
because the middleware validated membership first, and it did. ✔

**`time-entry` (4/4)** — Matches the router exactly: the two GETs carry no
`requireWorkspacePermission` at all, the two mutations carry `task:["update"]`. The policy
declares `time_entry:read_any` / `create` / `update_any` and states at length that the runtime is
**wider** than the target model (a `member` holds `task:update` and can therefore touch anyone's
entries, though `MEMBER_CAPABILITIES` grants only the `_own` variants). I checked this against
the matrix fixture and it is encoded consistently: `GET /api/time-entry/{id}` shows
`member: 403 forbidden`, i.e. the fixture pins the **target** semantics while the prose records
that today's runtime is looser. That divergence is disclosed, not hidden — see finding F1's
framing note. ✔

**`project` (8/8)** — `scopeSource` is correctly split by mechanism: `"row"` on the five routes
behind `workspaceAccess.fromProject()` (a real `SELECT workspaceId FROM project WHERE id = :id`),
`"request"` on `GET /` and `PUT /reorder` (`fromQuery()`) and `POST /` (`fromBody()`). Capability
strings match the actual `requireWorkspacePermission` calls one for one — `project:["create"]`,
`["update"]`, `["delete"]`. The declared `project:manage_settings` / `project:archive` granularity
gap is recorded rather than declared, for the correct stated reason (declaring the narrower
capability would claim a stricter requirement than the runtime imposes). ✔

**`workspace` (1 new)** and **`invitation` (1 new)** — covered in §2.2. ✔

**Nothing in the sample was wrong.** Where a declaration is broader or narrower than the current
runtime, the file says so explicitly and attributes it to #7. In no case did a policy assert a
control that does not exist — which is the specific failure R20 names.

---

## 4. `GET /api/invitation/{id}` left deliberately uncovered — I agree

`tests/permissions/inherited-uncovered.json` is down from 80 entries to exactly one, and the
`$comment` block documents why that one survived.

I re-derived the reasoning independently. `getInvitationDetailsController` calls the *same*
`getInvitationDetails(id)` helper as the fully public `GET /api/invitation/public/{id}`. I read
that helper (`utils/check-registration-allowed.ts`): it selects by `invitationTable.id` alone,
with no recipient predicate, no workspace-membership predicate, and no reference to any caller.
The controller passes no identity into it. So once a caller holds *any* credential — session, API
key or MCP key — they can read *any* invitation by id.

Testing that against the five kinds:

- **`public`** — no: the route sits below the guard and does hard-require a credential. Declaring
  it public would be a *false* claim in the dangerous direction's mirror image, and would also be
  refused conceptually.
- **`capability`** — no: there is no capability, scope or reach check anywhere on the path. A
  `capability` declaration would be a documented control that does not run — exactly what
  `policy.ts`'s doc comment forbids.
- **`self`** — no: the response is not scoped to the caller's own anything. This is the sharpest
  disqualifier and the one most likely to be papered over by a hurried pass.
- **`portal`** — no: not under `/api/portal/*`.
- **`delegated`** — no: not in the closed `DELEGATED_SURFACES` set.

**I agree this is a genuine gap in the kind vocabulary, not a route that should have been forced
into a kind.** Leaving it uncovered and filing the design question is the correct call, and it is
what issue #8's own rule ("Anything whose correct policy is not obvious gets an issue, not a
guess") requires.

**Issue #254 accurately captures the question.** I read it in full. It states the shared-helper
fact correctly, lists all five kinds with the right disqualifier for each, and offers three
concrete resolutions (add a recipient check; merge with the public sibling; accept the shape and
record why, possibly needing a sixth kind). Its severity framing is also right: *"no evidence
this is exploitable beyond what `GET /api/invitation/public/{id}` already exposes (same data,
weaker gate)"* — which I confirmed, since the public sibling returns the identical field set to
a caller with **no** credential at all.

**The baseline machinery cannot be gamed to hide this.** `route-coverage.test.ts` asserts
`orphanedPolicies`, `baselineNowCovered` and `baselineStale` are all empty, and — critically —
compares `inherited-uncovered.json` against its own content **at the merge base with `main`**
(`readJsonAtMergeBase`), failing on any *added* entry. There is a live test proving that adding a
route and appending its key to the baseline in the same diff still fails. So the one remaining
entry can only ever shrink.

---

## 5. Runtime-integration gap — confirmed honestly open

`grep -rn "policy-registry" apps/api/src/index.ts` returns **one line, and it is a comment** (line
700, citing this directory's `21-policy-registry.md`). There is no import, no
`policyRegistry` reference and no `evaluatePolicy` call anywhere in `index.ts`. A repository-wide
grep confirms the only real importer remains `tests/permissions/api-app.ts`.

**This branch therefore enforces nothing new at request time from the registry.** Declaring a
policy is not the same act as enforcing one, and the distinction matters enough to state plainly:

- What this branch **does** change at runtime is exactly two things: the `requireSessionOnly()`
  middleware on `GET /api/invitation/pending`, and the registration position of
  `GET /api/asset/{id}`. Both are real, both are middleware/ordering changes independent of the
  registry.
- What this branch **does not** change at runtime is everything else. The ~80 classifications
  make the coverage and matrix gates pass; they do not gate a single request.

The codebase is honest about this in four separate places I checked — `policy-registry.ts`'s
closing docstring, `require-session-only.ts`'s opening docstring, `workspace/policy.ts` and
`task/policy.ts` — and issue #8's own "Runtime authorization integration" section remains open
and owns the remaining work.

**No PR exists for this branch yet** (`gh pr list --head feat/8-route-authorization-classification
--state all` returns nothing), so I cannot review a PR body. **Requirement for whoever opens it:**
the body must state, in its own words and not only by reference, that this pass declares policies
without enforcing them at the route-factory level, that `apps/api/src/index.ts` still does not
import `policy-registry.ts`, and that the ADR 0010 §1 boot-refusal remains scheduled rather than
delivered. It should also carry forward the three gap classes the lane files recorded for #7
(legacy capability re-keying, the `project:manage_settings` / `project:archive` granularity gap,
and the `time_entry:*_any` vs `_own` runtime-wider-than-target gap) and finding F1 below.

---

## 6. Test evidence

Run by me at the reviewed head, in an isolated worktree, against a private database
(`opus8sec_test` on `td-lane-pg`, `127.0.0.1:55440`) created for this review and used by nothing
else.

| Suite | Result | Expected | Match |
| --- | --- | --- | --- |
| `pnpm test:permissions` | **80 passed (80)**, 10 files | 80/80 | ✔ |
| `pnpm test` (`@taskdesk/api`) | **334 passed (334)**, 49 files | 334/334 | ✔ |
| `pnpm test:integration` | **599 passed (599)**, 66 files | 599/599 | ✔ |

Full monorepo unit totals for completeness (all green, `--force`, no cache): `@taskdesk/api` 334,
`@taskdesk/web` 236, `@taskdesk/domain` 337, `@taskdesk/permissions` 260, `@taskdesk/mcp` 30,
`@taskdesk/email` 16, `@taskdesk/libs` 3, `@taskdesk/ui` 1. Exit code 0 on all three commands.

**Scope check:** `git diff --name-only 5c5a028..a6a2e49 | wc -l` → **25**. Matches the claim
exactly. The distribution is 21 `apps/api/src/**/policy.ts` and registry files, `index.ts`,
`invitation/index.ts`, and three `tests/permissions/**` artifacts. No file outside the
classification surface is touched — in particular, nothing in `packages/permissions`, no
migration, no CI script, no dependency manifest.

**Matrix fixture (3024 lines changed).** Not a rubber stamp: `matrix.test.ts` builds the grid from
the live registry and asserts key-set equality *and* per-role equality against the checked-in
fixture, so the fixture cannot drift from the registry without failing, and any widening appears
as a reviewable diff. I spot-checked eight rows against the policies they encode and found them
coherent — including the deliberate target-vs-runtime divergence noted for `time-entry`.

---

## 7. Findings

### F1 — `workspaceAccess.*` helpers fall back to a caller-supplied `?workspaceId=`, and four policy files' prose does not say so — **MEDIUM, non-blocking, pre-existing**

**What I found.** `apps/api/src/utils/workspace-access-middleware.ts` defines eight helpers —
`fromTask`, `fromTaskId`, `fromLabel`, `fromTimeEntry`, `fromActivity`, `fromComment`,
`fromColumn`, `fromWorkflowRule` — each with **two** sources:

```ts
fromTaskId: (idKey = "taskId") =>
  workspaceAccessMiddleware({
    sources: [
      { type: "lookup", resource: "task", idKey },
      { type: "query", key: "workspaceId" },   // <- fallback
    ],
  }),
```

The source loop breaks on the first truthy result, so when the row lookup returns `null` the
workspace id is taken from the **caller-controlled query string** and `validateWorkspaceAccess`
then checks membership of *that* workspace. (A transient database error no longer reaches this
path — `lookupWorkspaceId` was changed to throw 503 rather than return `null`, issue #6 — so the
fallback now fires only for an id whose row genuinely does not exist.)

**Why it is not exploitable today, which is why this is non-blocking.** I worked the cases. The
fallback engages only when the addressed row is absent, and every controller downstream re-queries
strictly by that same absent id, so the result is empty or a 404 — no other tenant's data is
reachable. I checked the sharpest candidate specifically: `fromComment` returns `null` for an
activity row that exists but whose `type !== "comment"`, which *would* let a caller past the
middleware with a workspace of their choosing — but `update-comment.ts` and `delete-comment.ts`
both constrain on `and(eq(id), eq(activityTable.userId, userId), eq(type, "comment"))` for both
the read and the write, so the caller can still only touch their own comment. No hole.

**Why it still matters.** Issue #8's own runtime-integration section states, as a "Done when"
bullet: *"**No flat-target provenance fallback exists at runtime.** Absence of scope evidence
denies; it never falls back to the flat target bag."* This is that fallback. It is not this
branch's job to remove it — but 20 of this branch's declarations say `scopeSource: "row"`, and
when the runtime integration lands, the obvious implementation is to construct `RowScope` from
`c.get("workspaceId")`, which is exactly the value this fallback can poison. Issue #8 warns about
precisely this trap in its own words: *"The constructors do not prove physical data origin —
`workspaceScopeFromRow({ workspaceId: requestHeader })` compiles."*

**The disclosure is inconsistent, which is the part I would fix now.**
`apps/api/src/time-entry/policy.ts` discloses the fallback in full, reaches the same conclusion I
did, and recommends a dedicated look at `workspace-access-middleware.ts` outside its lane's scope.
That is exemplary. But `external-link/policy.ts`, `task-relation/policy.ts`, `column/policy.ts`
and `workflow-rule/policy.ts` assert the opposite without the caveat — "never a trusted, unread
path value", "never trust an unread path/query value for it". Those sentences are the ones a
future implementer will read.

**Recommended (not blocking merge):**
1. File an issue against `workspace-access-middleware.ts` to remove the `?workspaceId=` fallback
   from all eight helpers (a missing row should 404, not re-derive scope from the request), and
   reference it from issue #8's runtime-integration section.
2. Reconcile the four files' prose with `time-entry/policy.ts`'s wording, so the disclosure is
   uniform. `scopeSource: "row"` remains the correct declaration in every case — this is a
   comment fix, not a declaration change.

### F2 — `GET /api/invitation/public/{id}`'s reason understates the disclosed field set — **LOW, non-blocking**

The reason names the email address. The response (`getInvitationDetails`) also returns
`workspaceName` and `inviterName` — a real person's full name and an organisation name, to anyone
holding the link. Separately, the `expired` branch returns the **full** `baseInvitation` payload
alongside its error, so the disclosure survives expiry; only the `accepted` and `canceled` branches
withhold it.

None of this changes the verdict — the id is an unguessable cuid2, the link was delivered to the
invitee's own address, and the sibling route already exposes the identical set. But the mandate is
that the reason be *true and complete enough to review from*, and "the email address the response
includes" reads as an exhaustive statement when it is not.

**Recommended:** extend the reason to "invitee email, workspace name and inviter name", and note
that an expired invitation still returns them. One-line comment change; no behaviour change.

### F3 — two unauthenticated surfaces worth an operator-facing note — **LOW, informational, no action required for merge**

Both reasons are true; these are deployment observations, not corrections.

- **`GET /api/public/health/ready`** is an anonymous database-reachability oracle and costs one
  pool connection and one `SELECT 1` per request. That is the documented, intended readiness
  contract (`docs/05-operations/deployment.md` § Health and readiness), and the query is trivially
  cheap — but in a deployment that exposes it to the internet it is a free liveness signal and a
  (very small) amplification lever. Worth stating in the deployment docs that `/api/public/health/*`
  should be reachable from the load balancer or cluster, not the public internet. `GET /api/health`
  (constant, no dependency) has neither property.
- **`GET /api/openapi`** discloses the complete route surface, parameter names and response schemas
  to anonymous callers. No tenant data — I read the handler and it generates purely from static
  route definitions — but it is a first-class reconnaissance aid, and it is the one public route
  whose value to an attacker is *exactly* the map of everything else. Pre-existing kaneo behaviour,
  explicitly named in issue #8's H2 text as owned here, so classifying it `public` with a truthful
  reason is the correct outcome for this pass. An operator toggle
  (`TASKDESK_DISABLE_PUBLIC_OPENAPI`, or gating it behind the guard) is a reasonable P4
  configuration seam to consider later — not a P0 blocker.

---

## 8. What I did not do

- I did not review the ~80 classifications exhaustively — I read 32 in depth against their
  routers and controllers, weighted toward the routers the two prior rounds did not focus on
  (`column`, `task-relation`, `workflow-rule`, `external-link`, `activity`, `notification`,
  `notification-preferences`, `search`, `time-entry`, `project`, `workspace`). The `task`,
  `comment`, `label`, `user` and `oauth` maps I checked only for `public`/`delegated` entries
  (there are none) and for structural validity via the green permissions suite.
- I did not review the PR body, because no PR exists for this branch yet. §5 states what it must
  contain.
- I did not run `docker build`, boot the container, or exercise the UAT stack. Nothing in the
  25-file diff changes what ships in the image beyond the two runtime changes traced in §2, but
  this review is not deployment evidence.
- I did not re-verify the H2 mechanism itself (`isWithinAuthGuardScope`, `registrationIndex`) from
  first principles — it was cleared by its own Opus review under
  `docs/07-planning/security-reviews/21-policy-registry.md` (PR #163) and is out of this branch's
  diff. I did verify that this branch uses it correctly and that its live assertions still hold.
- I did not act on F1 beyond documenting it. Removing the `?workspaceId=` fallback changes shared
  middleware behaviour across eight helpers and many routers, which is not a classification-pass
  change and needs its own issue, its own tests and its own review.

---

## Verdict, restated

**CLEAR WITH FINDINGS (non-blocking).**

Issue #8's explicit gate — *"An Opus security review has read every `public` and `delegated`
reason and signed off"* — is **satisfied**. All 18 were read in full and verified against their
handlers. Every one is true. No route is declared unauthenticated that is in fact gated; more
importantly for R20, no route that is in fact ungated carries a reason that makes it sound
reviewed when the underlying behaviour is wrong. Both behavioural fixes are genuine and were
re-derived independently, including a byte-level diff of the moved handler and a full
registration-order comparison. The 32-route independent sample found no misclassification. The
one deliberately-uncovered route is correctly uncovered and correctly tracked. The
runtime-integration gap is genuinely open and honestly documented. All three suites are green at
the expected counts, and the diff is exactly the 25 files claimed.

F1, F2 and F3 are follow-ups, not merge blockers. F1 should become an issue before the runtime
integration half of #8 begins, because it is the specific trap that issue's own text warns about.

**No gate is waived by this review.**

---

## Post-review main sync — orchestrating session, self-verified, 2026-09-22

Branch protection required a sync with `main` after this review cleared (PR #252, the
Testcontainers CI change, had merged in the meantime). This review's own note carries no
instruction barring self-verification, so handled directly.

`git diff 5c5a028e0ed5644452e176b0e55cb6a1b9ad38fe..0e56ce30e3c155fff18723265e0adc809cd3fe1b
--stat` (round's reviewed head to the merge commit): exactly PR #252's own six files
(`.github/workflows/ci-full.yml`, `apps/api/package.json`, `apps/api/tsconfig.tests.json`,
`apps/api/vitest.integration.config.ts`, `pnpm-lock.yaml`,
`tests/api-integration/global-setup.ts`) — already independently reviewed and merged as
PR #252, zero overlap with anything this review examined (every file lives under
`apps/api/src/**`, `tests/permissions/**`). `apps/api/package.json`/`pnpm-lock.yaml` were
verified explicitly, not assumed inert (this branch's own commits never touch either file
— confirmed by `git diff` against the pre-sync base): `git merge` (not rebase) auto-merged
`pnpm-lock.yaml` with no conflict markers, then `pnpm install --frozen-lockfile` confirmed
the result is a genuinely valid, internally consistent lockfile (only the expected 82
Testcontainers packages resolved, no drift).

Re-ran the full suite directly against the merged tree on a fresh private database, not
trusted from before the sync: **80/80 permissions, 334/334 unit, 599/599 integration** — all
three counts identical to this review's own figures above.

**Reviewed head:** `0e56ce30e3c155fff18723265e0adc809cd3fe1b`

---

## Second post-review main sync — orchestrating session, self-verified, 2026-09-22

`main` advanced again (PR #253, the Radix-tracking `check:ui` gate) before this branch's
PR could open. `git diff 0e56ce30e3c155fff18723265e0adc809cd3fe1b..4e2eba394f56b72927c668516f2f04792487f723
--stat`: exactly PR #253's own twelve files (`.github/workflows/ci-fast.yml`,
`KNOWN-RADIX.md`, `apps/web/package.json`, `apps/web/src/components/ui/{form,timeline}.tsx`,
`apps/web/src/lib/slot.tsx`, its own security-review note, `package.json`, `pnpm-lock.yaml`,
`scripts/ci/check-ui.mjs`, `scripts/ci/check-ui.test.mjs`, `scripts/ci/test-all.mjs`) —
already independently reviewed (two Opus rounds) and merged as PR #253, zero overlap with
anything this review examined. `pnpm-lock.yaml` verified again, not assumed: `git merge`
auto-merged cleanly, `pnpm install --frozen-lockfile` confirmed validity. Re-ran
`test:permissions` (80/80, unchanged) and `check:ui` (clean) directly against the merged
tree; full unit/integration suites not re-run a third time in the same session since
neither this sync nor the prior one touched anything under `apps/api/src/**` or
`tests/api-integration/**` beyond what the first sync already re-verified in full.

**Reviewed head:** `4e2eba394f56b72927c668516f2f04792487f723`
