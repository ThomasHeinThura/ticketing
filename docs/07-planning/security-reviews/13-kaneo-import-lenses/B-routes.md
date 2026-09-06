# Security Review B — Routes & Authorization (TaskDesk v2, PR #13)

Reviewer: independent post-merge security review. Scope: `apps/api/src` route surface,
authentication reachability, tenant scoping, in-handler authz, websocket, assets, MCP/OAuth.

Status: COMPLETE. 24 findings (F-00..F-23).

---

## 0. How authentication is wired (mechanism, read this first)

`apps/api/src/index.ts:543-571` installs the ONLY app-wide authentication gate:

```ts
// index.ts:543
api.use("*", async (c, next) => {
  const path = c.req.path;
  if (
    path.startsWith("/api/mcp") ||
    path.startsWith("/api/.well-known/") ||
    path === "/api/billing/webhook"
  ) {
    return next();                       // <-- explicit auth bypass list
  }
  ...
      await authenticateApiRequest(c);
```

Two consequences that drive most of this report:

1. **Registration order is the access-control policy.** Hono runs matched handlers
   in registration order; a handler registered *before* `api.use("*")` returns a
   Response without ever calling `next()`, so the auth middleware never executes.
   Every route registered above `index.ts:543` is therefore anonymous. There is no
   allowlist, no decorator, no policy registry — a future contributor who adds a
   route 10 lines too high ships an unauthenticated endpoint and no test will
   notice. This is precisely the v1 failure mode (omission, not commission).
2. **Authorization is not performed by this middleware at all.** It only sets
   `userId`. Every tenant check is re-implemented per route (or omitted) inside
   the router files via `workspaceAccess.*` middleware or ad-hoc handler code.

`authenticateApiRequest` (`utils/authenticate-api-request.ts:63-127`) accepts
`x-api-key`, `Authorization: Bearer <api key>`, `Authorization: Bearer <session
token>`, or a cookie session. Note `verifyApiKey` is tried *before* the session on
bearer tokens.


## 1. Complete enumeration of routes reachable WITHOUT authentication

Everything registered above `api.use("*", ...)` at `index.ts:543`, plus the three
paths that middleware explicitly waves through.

| # | Route | file:line | Anonymous access defensible? |
|---|-------|-----------|------------------------------|
| 1 | `GET /api/health` | index.ts:200-202 | Yes. Returns `{"status":"ok"}` only. No version, no DB probe, no build info. |
| 2 | `GET /api/instance/status` | index.ts:204-224 | Borderline. Returns `{hasUsers, hasAdmin}`; that is a first-boot takeover oracle — see F-12. |
| 3 | `GET /api/public-project/:id` | index.ts:226-232 | Only for genuinely public projects; the implementation over-shares — see F-01/F-02. Scheduled for #6 deletion. |
| 4 | `POST /api/github-integration/webhook` | index.ts:233 | Yes — signature required (`github-integration/index.ts:339-342`, 400 without `x-hub-signature-256`). Scheduled for #6 deletion. |
| 5 | `POST /api/gitea-integration/webhook/:integrationId` | index.ts:235-238 | Yes — HMAC verified and rejected when no secret is configured (`plugins/gitea/webhook-handler.ts:95-102`). Minor: distinct anonymous error strings ("Gitea integration not found" vs "Invalid webhook signature", `:85`/`:101`) form an integration-id existence oracle. Scheduled for #6 deletion. |
| 6 | `GET /api/invitation/public/:id` | index.ts:240-244 | Needed for the invite-accept screen, but discloses the invitee's email, the workspace name, and the inviter's name — see F-14. |
| 7 | `GET /api/auth/get-session` | index.ts:246-263 | Yes — returns null when unauthenticated, by design. |
| 8 | `GET /api/asset/{id}` | index.ts:265-341 | Conditional. `security: []` in the OpenAPI doc, and `authorizeAssetAccess` returns early for public-project assets — see F-16/F-17. |
| 9 | `GET /api/user/avatar/{id}` | index.ts:345-390 | Declared "Public, immutable" (index.ts:353). Any avatar of any user in any tenant is downloadable by id — see F-13. |
| 10 | `GET /api/config` (whole `config` router) | index.ts:393 + config/index.ts:21 | Yes. `utils/get-settings.ts:8-32` returns booleans plus `customOAuthLogoutUrl`; no secret values, only `Boolean(...)` presence flags. Defensible. |
| 11 | `GET /api/openapi` | index.ts:402-456 | Exposes the full route surface, all schemas, all operation ids. Low, but it is a free map for an attacker — see F-15. |
| 12 | `GET /api/auth/device` | index.ts:473-510 | Better Auth device flow, intentional. |
| 13 | `ALL /api/auth/*` (POST/GET/PUT/PATCH/DELETE) | index.ts:511-538 | Better Auth surface; auth endpoints must be anonymous. Note the bearer→`x-api-key` rewrite at index.ts:527-535. |
| 14 | `api.route("/", mcpRoutes)` — every MCP path | index.ts:541, mcp/index.ts | Registered above the gate AND explicitly skipped by it (`path.startsWith("/api/mcp")`). See §9. |
| 15 | `app.route("/", mcpWellKnownRoutes(...))` — `/.well-known/*` | index.ts:613-619 | Mounted on `app`, not `api`, so it is outside `/api` entirely and can never be covered by the API gate. |
| 16 | `POST /api/billing/webhook` | index.ts:548 (explicit skip) | Signature IS verified (`billing/index.ts:135-158`, `constructWebhookEvent` + 400 on failure). Defensible. Scheduled for #6 deletion. |

Everything else is behind `authenticateApiRequest`.

### F-00 (HIGH, structural) — Authentication is enforced by source-code ordering, not policy

**file:line:** `apps/api/src/index.ts:543-571` (the gate) vs. `index.ts:200-448` (16 routes above it)

There is no declarative "this route is public" registry. A route is anonymous iff a
developer happened to type it above line 543. `createRoute({ security: [] })` is
*documentation only* — it changes the generated OpenAPI document (index.ts:445-455)
and has **zero** runtime effect. So the OpenAPI `security` field and the actual
enforcement can silently disagree in either direction, and nothing tests the
agreement.

**Attack path:** not directly exploitable; it is the defect *generator*. TaskDesk v1
shipped eleven authorization holes, all omissions. This file is the same machine.

**Fix:** invert the default. Register `authenticateApiRequest` as the first
middleware on `api`, and make anonymous routes opt out through an explicit,
enumerable allowlist keyed by method+path (e.g. `const ANONYMOUS_ROUTES = new
Set([...])`), asserted in CI against the OpenAPI document's `security: []` set so
the two can never drift.

**Owner:** #7 policy registry (+ #10 CI for the drift assertion).

## 2. `public-project` and anonymous project data

### F-01 (HIGH) — `GET /api/public-project/:id` publishes far more than a "public board"

**file:line:** `apps/api/src/index.ts:226-232` → `project/controllers/get-public-project.ts:26` →
`task/controllers/get-tasks.ts:255-266`

The inline route hands the project id straight to `getTasks(id)`, whose return shape is:

```ts
// task/controllers/get-tasks.ts:255-266
return { data: { id, name, slug, icon, description, isPublic,
                 workspaceId, columns, archivedTasks, plannedTasks }, ... }
```

Anonymous callers therefore receive, for one `isPublic` project:
- **`workspaceId`** — the tenant identifier, which is the input to `?workspaceId=` on
  every other route and to `workspaceAccess.fromQuery()`;
- **`archivedTasks` and `plannedTasks`** — backlog and archived work, which no product
  surface presents as "the public board";
- per task: `description` (full body), `assigneeName`, `assigneeId`, `assigneeImage`
  (`get-tasks.ts:122-138`) — staff roster PII;
- per task: `externalLinks` including `url`, `title`, and parsed `metadata`
  (`get-tasks.ts:166-212`) — internal GitHub/Gitea issue and PR URLs, i.e. private
  repository names.

**Attack path:** an unauthenticated attacker with any public project id (they are linked
from the product's own share UI, and appear in referrers, chat unfurls, and search
engines) issues `curl https://host/api/public-project/<id>` and gets the tenant id, the
whole employee list of that project, every archived ticket, and internal repo URLs.

**Fix:** `#6` deletes this route. Until then, and in whatever replaces it, project a
narrow DTO: public columns and non-archived tasks only, no `workspaceId`, no assignee
identity beyond a display name if the product needs one, no `externalLinks`.

**Owner:** #6 removals (**resolved by #6 deletion**) — but the DTO lesson must carry into
any replacement share link.

### F-02 (MEDIUM) — `getPublicProject` answers 403 for a private project, confirming it exists

**file:line:** `project/controllers/get-public-project.ts:20-24`

```ts
if (!project.isPublic) {
  throw new HTTPException(403, { message: "Project is not public" });
}
```

vs. `404 "Project not found"` at line 14-18 when the id does not exist.

**Attack path:** an unauthenticated attacker holding a candidate project id learns from
403-vs-404 whether that project exists on this instance. On TaskDesk Cloud this turns a
project id leaked anywhere (a screenshot, a URL in a support ticket) into confirmation
that a given tenant is a customer.

**Fix:** return 404 for both. Nothing anonymous should ever distinguish "private" from
"absent".

**Owner:** #6 removals (**resolved by #6 deletion**).

---

## 3. Tenant scoping — traced samples (12 data-returning routes across 8 routers)

Verdict up front: the `workspaceAccess.*` middleware family is genuinely applied on the
surviving routers, and the id→workspace lookups it performs are correct joins. The
failures are (a) one fail-open fallback in that middleware, (b) permission checks absent
on read routes, and (c) API-key scope not enforced on reads.

| # | Route | Scoping middleware | Handler query actually constrained? | Verdict |
|---|-------|--------------------|--------------------------------------|---------|
| 1 | `GET /api/project/{id}` (project/index.ts:76-92) | `workspaceAccess.fromProject()` | `get-project.ts:8-11`: `and(eq(projectTable.id,id), eq(projectTable.workspaceId, workspaceId))` | **OK** — double-checked in the query |
| 2 | `GET /api/project?workspaceId=` (project/index.ts:31-46) | `fromQuery()` | handler passes `c.get("workspaceId")` (index.ts:224-231), which is the middleware's validated value, not the raw query | **OK** |
| 3 | `GET /api/task/tasks/{projectId}` (task/index.ts:82-99) | `fromProject("projectId")` | `get-tasks.ts:78`: `eq(taskTable.projectId, projectId)` only — no workspace predicate; relies wholly on middleware | **OK but single-layer** |
| 4 | `GET /api/task/{id}` (task/index.ts:161-177) | `fromTask()` | `getTask(id)` — no tenant predicate; relies wholly on middleware | **OK but single-layer** |
| 5 | `GET /api/search?workspaceId=` (search/index.ts:12-29) | `fromQuery()` | `global-search.ts:147-149` `workspaceFilter = eq(projectTable.workspaceId, workspaceId)`, applied to tasks (l.190,254), projects (l.319), activities/comments (l.430); workspaces use `inArray(workspaceTable.id, accessibleWorkspaceIds)` (l.368) | **OK.** The attacker-supplied `projectId` narrows *within* the filter (`and(workspaceFilter, projectId ? eq(...) : undefined)`), it does not replace it. |
| 6 | `GET /api/comment/{taskId}` (comment/index.ts:23-40) | `fromTaskId()` | `get-comments.ts:19-26`: `eq(activityTable.taskId, taskId)` — no tenant predicate | **OK but single-layer** |
| 7 | `PUT /api/comment/{id}` (comment/index.ts:69-93) | `fromComment()` + `task:update` | `activity/controllers/update-comment.ts:16-22`: `and(eq(id), eq(activityTable.userId, userId), eq(type,'comment'))` | **OK — author-scoped in the query** |
| 8 | `GET /api/workspace/{workspaceId}/members` (workspace/index.ts:13-32) | `fromParam("workspaceId")` | `get-workspace-members.ts:16`: `eq(workspaceUserTable.workspaceId, workspaceId)` | **OK** (but see F-07: returns every member's email to a `viewer`) |
| 9 | `GET /api/time-entry/{id}` (time-entry/index.ts:40-56) | `fromTimeEntry()` | `get-time-entry.ts:6-9`: `db.select().from(timeEntryTable).where(eq(timeEntryTable.id, id))` — **no tenant predicate at all** | **OK but single-layer** |
| 10 | `GET /api/external-link/task/{taskId}` (external-link/index.ts:16-32) | `fromTaskId("taskId")` | `eq(externalLinkTable.taskId, taskId)`; the `integration` relation is column-pinned to `{id,type}` (l.44) so provider secrets stay out | **OK — good** |
| 11 | `GET /api/label/{id}` (label/index.ts:89-104) | `fromLabel()` | `get-label.ts:5-7`: `eq(label.id, id)` — no tenant predicate | **OK today, but this is the one that F-04's fallback undermines** |
| 12 | `GET /api/{slack,discord,telegram,gitea,github,generic-webhook}-integration/project/{projectId}` | `fromProject("projectId")` **only** | scoped, but **no `requireWorkspacePermission`** | **Gap — F-06** |

I could not construct a working cross-tenant read on any of routes 1-11 by supplying a
foreign id: every one of them resolves the id to its owning workspace *before* the
handler runs and calls `validateWorkspaceAccess`. The scoping is real. What is fragile
is *how* it is enforced — see F-03/F-04 — and what it does not check — F-05/F-06.

### F-03 (HIGH) — every tenant check is a per-route opt-in; forgetting one is silent

**file:line:** `utils/workspace-access-middleware.ts:279-362` (the `workspaceAccess`
helpers) and the 60+ call sites listed above.

`apiRouter()` (`openapi.ts:25-39`) applies no authorization. A route with no
`middleware:` key gets **no** tenant check and **no** permission check, and still
compiles, still type-checks, still passes `defaultHook` validation, and still appears in
the OpenAPI document as a normal authenticated endpoint. `createRoute({ security: [] })`
is likewise inert at runtime — it only edits the generated document
(`index.ts:445-455`).

Two live instances of exactly this omission already exist in the merged tree:
`notification-preferences` workspace routes (F-08) and every integration GET (F-06). In
v1 this same shape produced eleven holes.

**Fix (this is the #7 deliverable):** a policy registry that every route must satisfy —
e.g. `createRoute` requires a `policy` field, and a CI check walks the router tree and
fails the build on any route whose policy is missing or is `public` without an entry in
the anonymous allowlist. Make "no policy" a compile error rather than an open door.

**Owner:** #7 policy registry, enforced by #10 CI.

### F-04 (HIGH) — `workspaceAccess.from*` falls back to an attacker-controlled `?workspaceId=` when the id lookup fails

**file:line:** `utils/workspace-access-middleware.ts:294-361` (the fallback source) and
`:56-118` (the loop), with the fail-open at `:273-276`.

Every id-based helper except `fromProject` and `fromTasks` is built as a **two-source
chain**:

```ts
// workspace-access-middleware.ts:294-300
fromTask: (idKey = "id") =>
  workspaceAccessMiddleware({
    sources: [
      { type: "lookup", resource: "task", idKey },
      { type: "query", key: "workspaceId" },      // <-- fallback
    ],
  }),
```

and the loop takes the first source that yields a truthy value:

```ts
// :109-112
if (workspaceId) { break; }
```

So whenever the lookup returns `null`, the middleware **authorizes against a workspace id
the caller typed into the query string**, sets `c.set("workspaceId", <attacker's own>)`,
and lets the handler proceed to act on the *path* id it was given. Every downstream
`requireWorkspacePermission` then evaluates the caller's role **in their own workspace**.

The lookup returns `null` in three ways, one of which is a genuine fail-open:

1. `lookupWorkspaceId` swallows **any** database error and returns `null`:
   ```ts
   // :273-276
   } catch (error) {
     console.error(`Error looking up workspaceId for ${resource}:`, error);
     return null;
   }
   ```
   A transient DB error on the lookup query does not fail the request closed — it
   downgrades it to "trust the query string". Under connection-pool exhaustion this is
   reachable by an attacker who simply generates load.
2. A nullable owning column. `lookupWorkspaceId` returns `label?.workspaceId || null`
   (`:175`) and `labelTable.workspaceId` is declared **nullable** in
   `database/schema.ts:650-653` (no `.notNull()`). `assign-label-to-task.ts:50` then
   skips its own guard for exactly that case:
   ```ts
   if (label.workspaceId && label.workspaceId !== task.workspaceId) { throw 400 }
   ```
   A label row with `workspace_id IS NULL` is therefore attachable to *any* task in *any*
   tenant by `PUT /api/label/<null-ws-label-id>/task?workspaceId=<attacker's own>` with
   `{"taskId":"<victim's task>"}`. Mitigating fact, verified: migration
   `drizzle/0005_jittery_monster_badoon.sql:70-73` deletes null rows and applies
   `SET NOT NULL` in the database, so a migrated instance has no such rows today. The
   ORM type and the DB constraint disagree, so this is one `drizzle-kit push` or one
   hand-written migration away from being live — and the code has no guard of its own.
3. An `idKey` that does not match the route's path parameter name. Today all 60+ call
   sites match (I checked each); the day someone renames `/{id}` to `/{labelId}` without
   touching the middleware argument, that route silently starts trusting
   `?workspaceId=`.

**Attack path (case 1, reachable today):** authenticated user of tenant A sends
`PUT /api/task/status/<victim task id>?workspaceId=<A's workspace>` repeatedly while the
DB pool is saturated. On any request where the lookup query errors, the middleware
authorizes against A, `requireWorkspacePermission({task:["update"]})` passes because the
user is an admin in A, and `updateTaskStatus(<victim task id>, ...)` executes with no
tenant predicate of its own.

**Fix:** delete the query fallback entirely — it exists only to paper over routes where
the id might be absent, and those should 400. Then make `lookupWorkspaceId` **rethrow**
instead of returning `null` on error, and distinguish "not found" (404) from "lookup
failed" (500). Fail closed.

**Owner:** #7 policy registry (the helper is the policy layer) — this one should be fixed
before #7 lands, it is a two-line change.

## 4. 404-vs-403: the API is a cross-tenant existence oracle

### F-05 (MEDIUM) — Foreign resource ids are answered 403, non-existent ids 400/404

**file:line:** `utils/validate-workspace-access.ts:54-58` (the 403) vs
`utils/workspace-access-middleware.ts:114-118` (the 400).

```ts
// validate-workspace-access.ts:54-58
if (membership.length === 0) {
  throw new HTTPException(403, { message: "You don't have access to this workspace" });
}
```

```ts
// workspace-access-middleware.ts:114-118
if (!workspaceId) {
  throw new HTTPException(400, { message: "Workspace ID could not be determined" });
}
```

**Attack path:** an authenticated user of tenant A probes `GET /api/task/<id>` (or
`/project/<id>`, `/label/<id>`, `/comment/<id>`, `/column/<id>`, `/time-entry/<id>`,
`/activity/<id>`, `/workflow-rule/<id>`) with no `?workspaceId=`:

- **403 "You don't have access to this workspace"** → the id exists, in someone else's
  tenant.
- **400 "Workspace ID could not be determined"** → the id does not exist anywhere.

The two responses differ in status code *and* body string, so the oracle is trivially
scriptable. It works across the whole id space of every resource type. On a
self-hosted single-tenant install this is noise; on TaskDesk Cloud it is a
cross-customer information leak, and it converts any id disclosed in a screenshot, a
support thread, a Sentry breadcrumb, or a shared URL into confirmation of that customer's
data.

The same oracle exists on three other surfaces:
- `GET /api/asset/{id}` — `index.ts:305-307` throws 404 when no row, and
  `authorizeAssetAccess` → `validateWorkspaceAccess` throws **403** when the row exists
  in another tenant (`index.ts:309`).
- `GET /api/public-project/:id` — F-02, and anonymous.
- `GET /api/ws/{projectId}` — `index.ts:698-700` throws **401** for an unknown project,
  while `validateWorkspaceAccess` throws **403** for a foreign one (`index.ts:702`).

**Fix:** a single `notFoundOrForbidden()` helper used by all tenant checks that returns
**404 with an identical body** for both "absent" and "not yours". Keep the real reason in
the server log, never in the response. Add a CI test that asserts the two cases are
byte-identical.

**Owner:** #7 policy registry (the helper belongs to the policy layer) + #10 CI for the
byte-identical assertion.

---

## 5. Authorization performed INSIDE handlers rather than by middleware

These are the ones that get missed, so here is the complete list I found. Each one is a
place where deleting or reordering a few lines in a controller removes a tenant check
with no middleware, no type, and no test noticing.

| Where | file:line | What it checks | Risk |
|-------|-----------|----------------|------|
| Billing — read | `billing/index.ts:161-163` | `await validateWorkspaceAccess(c.get("userId"), workspaceId)` inside the handler | Route declares `403` in its OpenAPI responses but carries **no** `middleware:`; the check is one deleted line. *(resolved by #6 deletion)* |
| Billing — checkout | `billing/index.ts:167-169` | `await requireBillingManager(userId, workspaceId)` | same *(resolved by #6 deletion)* |
| Billing — portal | `billing/index.ts:180` | `await requireBillingManager(userId, workspaceId)` | same *(resolved by #6 deletion)* |
| Notification preferences — upsert | `notification-preferences/service.ts:513` (`assertWorkspaceMembership`) called from `index.ts:114-121` | workspace membership | Route has **no** `middleware:` at all (`notification-preferences/index.ts:56-76`) yet documents `403: "No access to the workspace"`. Survives #6. See F-08. |
| Notification preferences — delete | `notification-preferences/service.ts:634` | workspace membership | same. Survives #6. |
| Task relations — create | `task-relation/index.ts:48-68` (`scopeToSourceTask`) | hand-rolled body read + `validateWorkspaceAccess` | Bespoke re-implementation of `workspaceAccess.fromBody`-style logic. Correct today. Scopes to the **source** task only — the target task is validated inside the controller, not here. Survives #6. |
| Task relations — delete | `task-relation/index.ts:70-89` (`scopeToRelation`) | relation → source task → workspace | same shape. Survives #6. |
| Label attach | `label/controllers/assign-label-to-task.ts:50-54` | label/task same-workspace | The **only** thing stopping a cross-tenant attach; skipped when `label.workspaceId` is null (F-04 case 2). Survives #6. |
| Label create | `label/controllers/create-label.ts:34-38` | `task.workspaceId !== workspaceId → 404` | Correct, and correctly uses 404 not 403. Survives #6. |
| Task move | `task/controllers/move-task.ts:123-127` | source/destination same workspace | The **only** thing stopping a task being moved into another tenant's project. Survives #6. |
| Task update | `task/controllers/update-task.ts:42-46, 51-56` | project pinning + `assertAssignableUser` | Survives #6. |
| Task image finalize | `task/index.ts:840-851` (`assertTaskImageKeyMatchesContext`) | object key must match workspace/project/task | Good check, but in-handler. Survives #6. |
| Gitea integration read | `gitea-integration/index.ts:230-236` | `hasWorkspacePermission(c,{workspace:["manage_settings"]})` gates the webhook secret | *(resolved by #6 deletion)* |
| Asset download | `index.ts:309` → `utils/authorize-asset-access.ts` | see §8 | Inline in `index.ts`, not a router. Survives #6. |
| MCP consent decision | `mcp/controllers/oauth-consent.ts:113-118` | trusted origin + Better Auth session | The MCP surface is excluded from the app-wide gate, so this is the *only* auth on that route. *(resolved by #6 deletion)* |
| WebSocket project subscribe | `index.ts:690-702` | project lookup + `validateWorkspaceAccess` | Inline in the upgrade callback. Survives #6. See §6. |

**Fix:** every row above should become a declared policy on the route, evaluated by the
framework before the handler is entered, with the in-controller check kept only as
defense in depth (and, where the controller check is currently the *only* check, kept
permanently).

**Owner:** #7 policy registry; #8 router retrofit for the per-router mechanics.

### F-06 (MEDIUM) — Integration read routes are gated on membership but not on permission

**file:line:** `slack-integration/index.ts:93`, `discord-integration/index.ts:95`,
`telegram-integration/index.ts:61`, `gitea-integration/index.ts:104`,
`github-integration/index.ts:114`, `generic-webhook-integration/index.ts:88`

Every one of these is `middleware: [workspaceAccess.fromProject("projectId")] as const`
— membership only. The corresponding create/update/delete routes all use
`manageAccess = [workspaceAccess.fromProject("projectId"),
requireWorkspacePermission({ workspace: ["manage_settings"] })]`
(e.g. `gitea-integration/index.ts:43-46`), so the write side is admin-gated and the read
side is not.

**Attack path:** a user holding the **viewer** role in a workspace reads the full
integration configuration of every project — channel names, repository owner/name, base
URLs, active status, and the webhook callback URL.

Credit where due: the secrets themselves are handled correctly.
`slack-integration/index.ts:53-54` returns `webhookConfigured` + `maskedWebhookUrl`;
`gitea-integration/controllers/get-gitea-integration.ts:42-45` masks the access token and
gates `webhookSecret` behind an explicit `hasWorkspacePermission({workspace:
["manage_settings"]})` check (`gitea-integration/index.ts:230-236`). So this is a
metadata leak, not a credential leak.

**Fix:** add `requireWorkspacePermission({ workspace: ["manage_settings"] })` (or a new
`integration:read`) to the six GET routes.

**Owner:** #6 removals — all six integration routers are scheduled for deletion
(**resolved by #6 deletion**). Do not retrofit; just confirm the deletion lands.

### F-07 (LOW) — `GET /api/workspace/{id}/members` returns every member's email to a viewer

**file:line:** `workspace/controllers/get-workspace-members.ts:7-16`

```ts
.select({ id: userTable.id, name: userTable.name,
          email: userTable.email, image: userTable.image,
          role: workspaceUserTable.role })
```

Route middleware is `workspaceAccess.fromParam("workspaceId")` only
(`workspace/index.ts:20`) — no permission check. Any member of any role, including a
guest or viewer invited to a single project, enumerates the whole workspace's email
addresses and role assignments. Defensible for a collaboration product; worth a
deliberate decision rather than an accident, and `role` in particular hands an attacker
the list of admins to phish.

**Fix:** gate on a `member:read` permission, or drop `email` for non-admin callers.
**Owner:** #7 policy registry.

### F-08 (MEDIUM) — Notification-preference workspace rules have no route-level authorization

**file:line:** `notification-preferences/index.ts:56-91` (both routes), authorization at
`notification-preferences/service.ts:513` and `:634`

`PUT` and `DELETE /api/notification-preferences/workspaces/{workspaceId}` carry **no**
`middleware:` key while documenting `403: "No access to the workspace"`. The only thing
that makes the documented 403 true is `assertWorkspaceMembership(userId, workspaceId)`
buried in the service layer. It is correct today — and it is exactly the shape that
produced v1's eleven holes: a documented guarantee with no enforceable link to the code
that provides it.

Note also these routes write per-workspace delivery configuration, and
`notification-preferences/secrets.ts` exists because that configuration holds secrets;
`service.ts:417/485/572` write them. An omission here is not cosmetic.

**Fix:** add `workspaceAccess.fromParam("workspaceId")` to both routes and keep the
service assertion as defense in depth.

**Owner:** #8 router retrofit.

## 6. The WebSocket surface (`apps/api/src/ws/`)

**Is it authenticated?** Yes, and correctly. Both endpoints call
`authenticateApiRequest(c)` inside the `upgradeWebSocket` callback
(`index.ts:626-637` for `/api/ws/user`, `index.ts:674-688` for `/api/ws/:projectId`) and
rethrow the `HTTPException`. I verified the transport honours this: `@hono/node-ws@1.3.1`
runs the upgrade through `init.app.request(...)` and only completes the handshake if the
connection symbol was set — a throwing `createEvents` leaves it unset, so
`socket.end("HTTP/1.1 401 ...")` fires and no socket is ever opened
(`node_modules/.pnpm/@hono+node-ws@1.3.1/.../dist/index.js`, `injectWebSocket`).

**Is the subscription tenant-scoped?** Yes at connect time:

```ts
// index.ts:690-702
const [project] = await db.select({ workspaceId: schema.projectTable.workspaceId })
  .from(schema.projectTable).where(eq(schema.projectTable.id, projectId)).limit(1);
if (!project) { throw new HTTPException(401, { message: "Unauthorized" }); }
await validateWorkspaceAccess(userId, project.workspaceId);
```

and the fan-out is keyed by `projectId` into a per-project connection set
(`ws/index.ts:161-181, 183-195`), with user-targeted messages keyed by `userId`
(`ws/index.ts:66-84`). Message payloads are ids and event types only — `{type,
projectId, taskId, sourceTaskId, targetTaskId}` (`ws/index.ts:379-389`) — never task
content, so a hijacked socket leaks metadata rather than data. `onMessage` is a no-op
for anything but `ping` (`index.ts:645-664, 717-733`); there is no client-driven
subscribe verb, so a connected client cannot widen its own scope. That is the right
design.

Three defects:

### F-09 (MEDIUM) — WebSocket upgrades accept cookie auth with no `Origin` check (cross-site WebSocket hijacking)

**file:line:** `index.ts:624-643` and `index.ts:673-744`; auth path
`utils/authenticate-api-request.ts:118-127` (cookie session branch)

The `cors()` middleware at `index.ts:173-194` restricts XHR/fetch, but browsers do **not**
apply CORS to WebSocket handshakes — `new WebSocket(...)` sends the victim's cookies to
any origin and there is no `Origin` validation anywhere in either upgrade handler.

**Attack path:** a victim with an active TaskDesk session visits `evil.com`, which runs
`new WebSocket("wss://taskdesk.example.com/api/ws/user")`. The handshake carries the
session cookie, `authenticateApiRequest` succeeds, and `evil.com` now receives a
`NOTIFICATION_CREATED` push every time the victim is mentioned, assigned, or invited —
a persistent activity side channel on the victim's account, with no interaction beyond
keeping the tab open. With a known `projectId` (F-01 hands these out anonymously) the
attacker upgrades to `/api/ws/<projectId>` and receives every task id as it changes.

**Fix:** validate `Origin` against the same allowlist `cors()` uses, on both upgrade
handlers, before `authenticateApiRequest`; reject on mismatch. Prefer requiring a bearer
token for WS and refusing cookie-only upgrades.

**Owner:** NEW ISSUE.

### F-10 (MEDIUM) — WebSocket authorization is never re-evaluated after connect

**file:line:** `index.ts:702` (the only `validateWorkspaceAccess` call) and
`ws/index.ts:183-205` (connections held until the socket closes)

Membership is checked exactly once, at handshake. A user removed from the workspace, or
downgraded, or whose project is deleted, keeps receiving that project's event stream for
as long as the socket stays open — and the client keepalive (`ping` every 30s, per the
comment at `index.ts:719-721`) means it stays open indefinitely.

**Attack path:** an employee is offboarded; their browser tab stays open; they continue
to observe task-change activity on the projects they were removed from.

**Fix:** re-validate on an interval (or on a `workspace.member_removed` /
`project.deleted` event) and close the socket; `ProjectConnection` already carries
`userId` (`ws/index.ts:17-21`) so the sweep is cheap.

**Owner:** NEW ISSUE.

### F-11 (LOW) — WebSocket upgrade leaks project existence (401 vs 403)

**file:line:** `index.ts:698-702` — 401 for an unknown project, 403 (from
`validate-workspace-access.ts:55`) for a foreign one. Same oracle as F-05, on a route
that is trivially probed. Fold into the F-05 fix.

**Owner:** #7 policy registry.

---

## 7. Health, metrics, diagnostics

- `GET /api/health` (`index.ts:200-202`) returns `{"status":"ok"}` and nothing else. No
  version string, no dependency probe, no build hash, no DB round trip. **This is
  correct** — do not let anyone "improve" it into a dependency dashboard.
- There is **no** `/metrics`, no Prometheus endpoint, no `/debug`, no `/status` beyond
  the below. I grepped the router surface and found none.
- Sentry is initialised (`instrument.ts`, `index.ts:1`) and captures 5xx only
  (`index.ts:142-153`) — expected errors are not reported, which is the right call.

### F-12 (LOW) — `GET /api/instance/status` is an unauthenticated first-boot takeover oracle

**file:line:** `index.ts:204-224` → `instance/controllers/get-instance-status.ts:9-20`

```ts
return { hasUsers: (totalRow?.value ?? 0) > 0,
         hasAdmin: (adminRow?.value ?? 0) > 0 };
```

The route's own description states the consequence: *"When hasUsers is false the next
signup becomes the instance admin."*

**Attack path:** an attacker scans for TaskDesk instances and polls
`/api/instance/status`. The moment a freshly deployed instance answers
`{"hasUsers":false}` — the window between `docker compose up` and the operator reaching
the signup page — the attacker registers first and owns the instance as admin.
`validate-workspace-access.ts:39-41` then grants that account access to **every**
workspace on the box. For a self-hosted-first product this is the highest-value
unauthenticated endpoint on the API.

**Fix:** the UI needs this, so keep it, but close the race: bind first-admin claim to a
one-time bootstrap token printed to the server log or read from an env var, so winning
the poll is not sufficient. At minimum, rate-limit the endpoint and log every hit.

**Owner:** NEW ISSUE.

### F-13 (LOW) — `GET /api/user/avatar/{id}` is unauthenticated across all tenants

**file:line:** `index.ts:345-390`, controller `user/controllers/get-avatar.ts:6-16`

```ts
.select({ ... data: userAvatarTable.data ... })
.from(userAvatarTable).where(eq(userAvatarTable.id, id)).limit(1);
```

No tenant predicate, no session, `security: []`, `Cache-Control: public, max-age=31536000,
immutable`. Any avatar of any user of any tenant is fetchable by whoever holds the id.
Ids are cuid2 so not enumerable, and avatars are low-sensitivity — but the route is
described in the code as "Public, immutable, and cache-friendly" (`index.ts:353`), which
is a decision, not an oversight, and should be recorded as an accepted risk rather than
discovered later.

**Fix:** accept and document, or require a session and switch to `private` caching.
**Owner:** NEW ISSUE (documentation/accepted-risk).

### F-14 (LOW) — `GET /api/invitation/public/{id}` discloses the invitee's email address anonymously

**file:line:** `index.ts:240-244` → `utils/check-registration-allowed.ts:125-146`

```ts
.select({ id, email: invitationTable.email, workspaceName: workspaceTable.name,
          inviterName: userTable.name, expiresAt, status })
```

Anonymous callers receive the **invitee's email address**, the **workspace name**, and
the **inviter's real name**. The authenticated twin `GET /api/invitation/{id}`
(`invitation/index.ts:26-38, 48-50`) is worse in one respect: it has no middleware and no
ownership check, so any authenticated user of any tenant reads any invitation by id
without being its recipient.

Ids are cuid2, so this is disclosure-on-URL-leak rather than enumeration — but invitation
URLs travel through email, chat, and browser history, and `Referer` leakage from the
accept page is a realistic path.

**Fix:** return only what the accept screen needs (workspace name, expiry, validity) and
never the email. On the authenticated route, require that the invitation's email matches
`c.get("userEmail")`.

**Owner:** #8 router retrofit.

### F-15 (LOW) — `GET /api/openapi` publishes the complete route surface anonymously

**file:line:** `index.ts:402-456`

Every path, method, parameter, schema, and operation id — including the hidden
cloud-only billing routes (`billing/index.ts:56` `cloudOnly = { hide: true }` removes
them from the document, so that one is handled) and every MCP/OAuth endpoint. Not a
vulnerability on its own; it removes all reconnaissance cost. Gate behind auth on
production instances if the API reference is served separately.

**Owner:** NEW ISSUE (low).

## 8. Asset / attachment authorization — `utils/authorize-asset-access.ts` (full file, 29 lines)

```ts
 1  import type { Context } from "hono";
 2  import { resolveAssetBearerOrCookie } from "./authenticate-api-request";
 3  import { validateWorkspaceAccess } from "./validate-workspace-access";
 4
 5  type AssetAccessTarget = {
 6    workspaceId: string;
 7    isPublic: boolean | null;
 8  };
...
19  export async function authorizeAssetAccess(
20    c: Context,
21    asset: AssetAccessTarget,
22  ): Promise<void> {
23    if (asset.isPublic) {
24      return;
25    }
26
27    const { userId, apiKeyId } = await resolveAssetBearerOrCookie(c);
28    await validateWorkspaceAccess(userId, asset.workspaceId, apiKeyId);
29  }
```

### F-16 (HIGH) — CONFIRMED: the anonymous branch at line 23 serves every asset of a public project, including comment attachments that no public surface renders

The `isPublic` on line 23 is **the project's** flag, selected by the caller at
`index.ts:295` (`isPublic: schema.projectTable.isPublic`) via an inner join on
`assetTable.projectId`. It is not a per-asset flag — the `asset` table has none
(`database/schema.ts:585-629`). So "this project is public" is silently promoted to
"every byte ever uploaded anywhere in this project is world-readable".

Assets carry a `surface` column, `notNull().default("description")`
(`database/schema.ts:616`), whose values are `"description"` and `"comment"`
(`storage/s3.ts:231-232`). The public project endpoint returns **tasks only** — it never
returns comments (`task/controllers/get-tasks.ts:255-266`). Comment attachments in a
public project are therefore anonymously downloadable even though the comment thread
containing them is not anonymously readable. Nobody choosing "make this board public"
is consenting to that.

Two further consequences of the same branch:
- **Retroactive exposure.** `PUT /api/project/{id}` accepts `isPublic`
  (`project/index.ts:250-263`); flipping it publishes every historical attachment in that
  project instantly, with no listing, no review step, and no way to exclude one file.
  Flipping it back does not recall anything already fetched — the response is served with
  `Cache-Control: public, max-age=300` (`index.ts:322-324`), so shared caches keep it.
- **No credential is even consulted.** Line 23 returns before
  `resolveAssetBearerOrCookie`, by design (the doc comment at lines 10-18 explains why).
  That is the correct ordering *given* the design; the design is what is wrong.

**Attack path:** any project ever marked public → attacker collects asset ids from the
public board's task descriptions, then walks adjacent ids or harvests them from
`objectKey` patterns; every file returns 200 with no credential. Even without id
guessing, every attachment referenced from any *comment* on that project is reachable by
anyone who ever saw its URL, forever, regardless of the comment's visibility.

**Fix:** give `asset` its own `is_public` column, set it only for assets actually
referenced by a surface the public view renders (`surface = 'description'` on a
non-archived task), and check *that* on line 23 rather than the project flag. Serve public
assets from a distinct path so the private path can require credentials unconditionally.

**Owner:** NEW ISSUE (survives #6 — this is not the `public-project` route, it is the
asset pipeline).

### F-17 (MEDIUM) — Other weaknesses in the same file

**a. API key scope is never consulted.** Line 28 passes `apiKeyId` to
`validateWorkspaceAccess`, which only checks that the key belongs to the user and is
enabled:

```ts
// validate-workspace-access.ts:10-31
if (apiKeyId) {
  const apiKey = await db.select().from(schema.apikeyTable)
    .where(and(eq(id, apiKeyId), or(eq(referenceId, userId), eq(userId, userId)),
               eq(enabled, true))).limit(1);
  if (apiKey.length === 0) { throw new HTTPException(403, ...); }
}
```

It never reads `apikeyTable.permissions`, which `verify-api-key.ts:71` went to the trouble
of parsing. A key minted with a narrow scope downloads every attachment in every workspace
its owner belongs to. (This generalises — see F-20.)

**b. Instance-admin bypass, unlogged.** `validate-workspace-access.ts:33-41` returns
early for `user.role === "admin"`, so an instance admin reads every asset in every tenant
with no audit trail. Correct for self-hosted, a superuser on Cloud.

**c. 404-vs-403 oracle.** `index.ts:305-307` returns 404 when the asset row is missing;
line 28 raises 403 when the row exists in another tenant. Same leak as F-05.

**d. Cross-origin probe via cookie auth.** `resolveAssetBearerOrCookie`
(`authenticate-api-request.ts:157-166`) accepts a plain cookie session, and the route sets
no `Sec-Fetch-Site` requirement. `<img src="https://host/api/asset/<id>">` on
`evil.com` fires `onload` when the logged-in victim can read the asset and `onerror`
when they cannot — a cross-origin oracle for "does this victim have access to asset X",
usable without any API credential.

**e. No task/activity-level check.** The function authorizes at workspace granularity
only; `assetTable.taskId` and `assetTable.activityId` (`schema.ts:604-610`) are never
consulted. That matches TaskDesk's current model (workspace membership implies project
access), so it is not a hole today — but the moment per-project or guest roles ship, this
function is wrong and nothing here will flag it. Leave a comment saying so.

**Fix:** enforce `apiKey.permissions` in `validateWorkspaceAccess`; make the miss/forbid
responses identical; require `Sec-Fetch-Site: same-origin` (or a bearer token) for the
private branch; add the granularity note.

**Owner:** (a) NEW ISSUE / #7; (c) #7 policy registry; (d) NEW ISSUE; (b),(e) documented
accepted risk.

---

## 9. MCP and OAuth router surfaces

The MCP surface is doubly exempt from the app-wide gate: it is registered above it
(`index.ts:541 api.route("/", mcpRoutes)`) **and** explicitly skipped by it
(`index.ts:546-547 path.startsWith("/api/mcp") || path.startsWith("/api/.well-known/")`).
Every authorization on it is hand-written in `mcp/index.ts` and
`mcp/controllers/oauth-consent.ts`.

Positives worth recording, because whatever replaces this should keep them: PKCE is
mandatory and S256-only (`mcp/schemas.ts:42-45`), verified on exchange
(`mcp/oauth.ts:104-107, 120`); the redirect URI is bound at authorize
(`oauth-consent.ts:79-81`) and re-checked at consent (`:124-126`) and at exchange
(`oauth.ts:119`); auth codes are single-use via `consumeState` (`oauth.ts:115`); the
consent POST requires a trusted `Origin` (`oauth-consent.ts:113-115`) *and* a real
session (`:117-118`); MCP session ownership is checked and a mismatched owner is reported
as 404 rather than 403 (`mcp/index.ts:203-210`) — the one place in this codebase that
gets the F-05 lesson right; and MCP tools call back through the API over HTTP with the
caller's own token (`mcp/index.ts:47-53`), so tenant scoping is inherited rather than
reimplemented.

### F-18 (HIGH) — An MCP consent grant mints a full 30-day Better Auth session, not a scoped token

**file:line:** `mcp/oauth.ts:122-134`

```ts
const sessionToken = randomUUID();
const expiresIn = 30 * 24 * 60 * 60;
await db.insert(sessionTable).values({
  id: createId(), token: sessionToken, userId: stored.userId,
  expiresAt: new Date(Date.now() + expiresIn * 1000), ... });
return { accessToken: sessionToken, expiresIn };
```

The "MCP access token" **is** a row in `session`. `authenticateApiRequest` accepts it as a
bearer session on every route in the API (`authenticate-api-request.ts:105-113`). There is
no scope, no audience, no `mcp` marker, and no way for the user to see or revoke it
separately from their browser sessions.

**Attack path:** anyone can register an OAuth client anonymously (`POST /api/mcp/register`,
`security: []`, `mcp/index.ts:76-99`) with an attacker-chosen `client_name` (max 100 chars,
`schemas.ts:32`) and an attacker-controlled `redirect_uri` (any https host, or any custom
scheme — `schemas.ts:17-19` accepts `/^[a-z][a-z0-9+.-]*:$/`). They send a victim a
consent link; the consent page shows the attacker's chosen client name
(`oauth-consent.ts:102`); one click hands over a **30-day full-account session token**,
not an MCP-scoped one. Because it is an ordinary session row, it survives password change
handling only if Better Auth revokes sessions on password change — worth confirming
separately.

**Fix:** #6 deletes the MCP OAuth flow. Two things must happen alongside the deletion:
(1) purge/invalidate `session` rows minted by `exchangeCode`, since deleting the route
does not delete the long-lived tokens it already issued; (2) if any token-issuing flow
returns, issue a distinctly-typed, separately-revocable, scoped credential — never a raw
session row.

**Owner:** #6 removals (**resolved by #6 deletion**), plus a NEW ISSUE for the
already-issued-token cleanup, which the deletion does not cover.

### F-19 (MEDIUM) — Anonymous, unauthenticated, unbounded OAuth client registration

**file:line:** `mcp/index.ts:76-99` (route, `security: []`),
`oauth-consent.ts:57-72`, `mcp/oauth.ts:47-65`

`registerClient` writes a row on every anonymous POST. `enforceStateCap` is applied only
to the `"request"` kind (`oauth.ts:77`, cap 10 000); the `"client"` kind has **no cap**,
only a 30-day TTL (`oauth.ts:35`). There is no rate limit on the route.

**Attack path:** an unauthenticated attacker loops `POST /api/mcp/register` and writes
unbounded rows into the OAuth state table for 30 days each — storage exhaustion on a
self-hosted instance, and a large corpus of plausible-looking client names for the consent
phishing in F-18.

**Owner:** #6 removals (**resolved by #6 deletion**).

### F-20 (MEDIUM) — API key permission scopes are enforced on write routes only, never on reads

**file:line:** `utils/require-workspace-permission.ts:142-147` (the only place
`apiKey.permissions` is checked) vs. every read route.

```ts
// require-workspace-permission.ts:142-147
const apiKey = c.get("apiKey") as { permissions?: ... } | undefined;
if (apiKey?.permissions && !satisfies(apiKey.permissions, permissions)) {
  throw new HTTPException(403, { message: "Insufficient API key scope" });
}
```

This runs **only** inside `requireWorkspacePermission`, and `requireWorkspacePermission` is
attached only to mutating routes. Every read route in the surviving surface carries
`workspaceAccess.*` alone: `GET /task/{id}` (task/index.ts:167), `GET /task/tasks/{projectId}`
(:89), `GET /task/export/{projectId}` (:249), `GET /project` and `GET /project/{id}`
(project/index.ts:38, 82), `GET /search` (search/index.ts:20), `GET /comment/{taskId}`
(comment/index.ts:30), `GET /activity/{taskId}` (activity/index.ts:32),
`GET /label/*` (label/index.ts:34, 52, 95), `GET /time-entry/*` (time-entry/index.ts:28, 46),
`GET /external-link/task/{taskId}` (external-link/index.ts:23),
`GET /workspace/{id}/members` (workspace/index.ts:20), `GET /asset/{id}` (index.ts:264),
and the whole notification / notification-preferences router (no middleware at all).

**Attack path:** a user mints an API key scoped to `{"task":["create"]}` for a CI bot and
pastes it into a third-party service. That key reads every task, every comment, every
attachment, every time entry, every member email, and can run global search across every
workspace its owner belongs to. The narrow scope the user chose is decorative on reads.

**Fix:** enforce the key's permission map in `validateWorkspaceAccess` (or in a
middleware that always runs), so scope is checked even when no
`requireWorkspacePermission` is attached. Add a read permission to every read route as
part of #7.

**Owner:** #7 policy registry.

---

## 10. State mutation via GET

I checked every `get-*` controller for writes:
`grep -rln "db.insert|db.update|db.delete|tx.insert|tx.update|tx.delete" --include="get-*.ts"`
returns **nothing**. The core routers are clean: no GET route in task, project, workspace,
comment, label, activity, time-entry, column, search, notification, external-link, or
task-relation mutates state.

One exception, on the exempt MCP surface:

### F-21 (LOW) — `GET /api/mcp/authorize` writes a database row, unauthenticated

**file:line:** `mcp/index.ts:100-115` (route, `method: "get"`, `security: []`) →
`oauth-consent.ts:83-88` → `mcp/oauth.ts:73-86`

```ts
export async function createAuthorizationRequest(params) {
  await deleteExpiredStates();
  await enforceStateCap("request", maxAuthorizationRequests);   // 10_000
  const requestId = randomUUID();
  await putState("request", requestId, params, new Date(Date.now() + requestTtlMs));
```

An anonymous GET performs three writes (a delete sweep, a cap enforcement, an insert).
The comment at `oauth.ts:38` acknowledges it — *"authorize is reachable without a
session"* — and caps the table at 10 000 rows, so this is bounded; but a GET that
performs an unauthenticated write, plus a full-table expiry sweep per request, is a cheap
amplification target and violates GET semantics (caches and prefetchers will trigger it).

**Owner:** #6 removals (**resolved by #6 deletion**).

Also worth noting rather than filing: `GET /api/auth/device` (`index.ts:473-510`) and the
`ALL /api/auth/*` passthrough (`index.ts:511-538`) delegate to Better Auth, whose device
flow does write on GET. That is upstream behaviour, not a TaskDesk defect.

---

## 11. Mass assignment

I looked for request bodies spread into database writes:

- `grep -rn "\.values({ \.\.\." --include=*.ts` → **no hits**.
- `grep -rn "\.\.\.c\.req\.valid|\.\.\.body\b|\.\.\.payload|\.\.\.input" --include=*.ts` →
  one hit, `plugins/gitea/webhook-handler.ts:188`, which spreads a Gitea webhook payload
  into an in-memory object, not into a DB update.
- Every `.set({...})` I inspected lists columns literally:
  `task/controllers/update-task.ts:69-79` (title, status, columnId, startDate, dueDate,
  projectId, description, priority, position, userId),
  `project/controllers/update-project.ts:33`, `column/controllers/update-column.ts:25`,
  `time-entry/controllers/update-time-entry.ts:34-38`,
  `task/index.ts:861-871` (asset finalize).
- `billing/controllers/handle-webhook.ts:142` is the one `.set({ ...updates, ... })`, but
  `updates` is a locally constructed object, not request-derived.

**No mass-assignment defect found.** Zod request schemas plus explicit column lists mean
the body cannot reach an unintended column. This is genuinely well done and should be
locked in by a CI lint rule (#10) that forbids spreading a validated body into
`.set()`/`.values()`.

Two adjacent notes:
- `update-task.ts:42-46` explicitly refuses a `projectId` change through the update route
  (*"Use the task move endpoint"*), which is the right way to stop a body field
  re-parenting a row across projects.
- `task/controllers/update-task.ts:51-56` and `utils/assert-assignable-user.ts:49-58`
  stop a body-supplied `userId` from assigning a task to a non-member — note that
  `filterAssignableUsers:32-44` deliberately also allows any instance admin.

---

## 12. Two more findings that do not fit a numbered question

### F-22 (MEDIUM) — Any workspace member can edit another member's time entries

**file:line:** route `time-entry/index.ts:85-110`
(`workspaceAccess.fromTimeEntry()` + `requireWorkspacePermission({task:["update"]})`),
controller `time-entry/controllers/update-time-entry.ts:14-41`

```ts
const [updatedTimeEntry] = await db.update(timeEntryTable)
  .set({ startTime, endTime: effectiveEndTime, duration,
         ...(description !== undefined && { description }) })
  .where(eq(timeEntryTable.id, timeEntryId))       // <-- no userId predicate
  .returning();
```

`timeEntryTable` records who logged the time, but the update never constrains on it.
Compare `activity/controllers/update-comment.ts:34-40`, which correctly pins
`eq(activityTable.userId, userId)`.

**Attack path:** a member of a workspace with the ordinary `task:update` permission
rewrites any colleague's logged hours — start time, end time, duration, description — and
`GET /api/time-entry/{id}` (`get-time-entry.ts:6-9`, also unfiltered) lets them read them
first. Where time entries feed invoicing or payroll this is a financial-integrity issue,
and there is no audit trail on the table.

**Fix:** add `eq(timeEntryTable.userId, userId)` to the update, and introduce a separate
`time_entry:manage_others` permission for the workspace-admin case.

**Owner:** #8 router retrofit.

### F-23 (LOW) — CORS reflects arbitrary origins with credentials whenever `NODE_ENV !== "production"`

**file:line:** `index.ts:165, 173-194`

```ts
const reflectUnconfiguredOrigins = process.env.NODE_ENV !== "production";
...
origin: (origin) => {
  if (!corsOrigins) {
    return reflectUnconfiguredOrigins ? origin || "*" : null;
  }
```

with `credentials: true`. The code comments the risk honestly. The exposure is that a
self-hosted operator who runs the bundled image without setting `NODE_ENV=production` —
easy to do, and `docker run` does not set it for you — gets an API that reflects **any**
origin with credentials, so any website the operator visits can read their entire
authenticated API. `CORS_ORIGINS`/`TASKDESK_AGENT_URL` being unset is exactly the default
state of a fresh deployment.

**Fix:** default to closed. Reflect only when an explicit `CORS_ALLOW_ANY_ORIGIN=true`
(or `--dev`) is set, never merely because `NODE_ENV` is unset.

**Owner:** NEW ISSUE.

---

## Summary table

| ID | Sev | Title | Owner |
|----|-----|-------|-------|
| F-00 | HIGH | Auth enforced by source ordering, not policy; `security: []` is doc-only | #7 + #10 |
| F-01 | HIGH | `public-project` leaks workspaceId, archived/planned tasks, assignee PII, external links | #6 deletion |
| F-02 | MED | `public-project` 403-vs-404 confirms private projects exist (anonymous) | #6 deletion |
| F-03 | HIGH | Tenant checks are per-route opt-in; a missing `middleware:` is silent | #7 + #10 |
| F-04 | HIGH | `workspaceAccess.from*` falls back to attacker-supplied `?workspaceId=`; lookup errors fail open | #7 (fix now) |
| F-05 | MED | 403-vs-400/404 cross-tenant existence oracle across 8 resource types | #7 + #10 |
| F-06 | MED | Integration GETs gated on membership, not permission (viewer reads config) | #6 deletion |
| F-07 | LOW | Workspace member list exposes all emails + roles to any viewer | #7 |
| F-08 | MED | Notification-preference workspace routes have no route-level authz | #8 |
| F-09 | MED | WebSocket upgrade: cookie auth with no Origin check (CSWSH) | NEW |
| F-10 | MED | WebSocket authorization never re-evaluated after connect | NEW |
| F-11 | LOW | WebSocket 401-vs-403 project existence oracle | #7 |
| F-12 | LOW | `instance/status` is an unauthenticated first-boot admin-takeover oracle | NEW |
| F-13 | LOW | `user/avatar/{id}` unauthenticated across all tenants (accepted?) | NEW |
| F-14 | LOW | `invitation/public/{id}` discloses invitee email anonymously; authed twin has no ownership check | #8 |
| F-15 | LOW | `GET /api/openapi` publishes the whole route surface anonymously | NEW |
| F-16 | HIGH | Asset anonymous branch: public project ⇒ every asset incl. comment attachments; retroactive, irrevocable | NEW |
| F-17 | MED | Asset authz: API-key scope ignored, admin bypass unlogged, 403/404 oracle, cross-origin `<img>` probe | #7 + NEW |
| F-18 | HIGH | MCP consent mints a full 30-day session token, not a scoped one | #6 deletion + NEW (revoke issued tokens) |
| F-19 | MED | Anonymous unbounded OAuth client registration | #6 deletion |
| F-20 | MED | API key permission scopes never enforced on any read route | #7 |
| F-21 | LOW | `GET /api/mcp/authorize` writes to the DB unauthenticated | #6 deletion |
| F-22 | MED | Any member can edit another member's time entries | #8 |
| F-23 | LOW | CORS reflects any origin with credentials when `NODE_ENV` is unset | NEW |

**What survives #6 and therefore matters most:** F-00, F-03, F-04 (the middleware
fail-open), F-05 (the oracle), F-08, F-09/F-10 (websocket), F-16/F-17 (assets), F-20
(API-key scope), F-22 (time entries).

**What I could not break:** I attempted cross-tenant reads by supplying foreign ids on
twelve data-returning routes across eight routers (§3) and none of them succeeded — the
`workspaceAccess.*` lookups resolve the id to its true owner before the handler runs.
Reorder endpoints (`project/controllers/reorder-projects.ts:41-50`,
`column/controllers/reorder-columns.ts:14-23`), task move
(`move-task.ts:123-127`), label create (`create-label.ts:34-38`), bulk task update
(`workspace-access-middleware.ts:77-106`), comment update/delete
(`update-comment.ts:16-22`), and asset finalize (`task/index.ts:840-851`) all verify
batch/target ownership correctly. The tenant model is sound; its *enforcement mechanism*
is what is one omission away from failing, which is the same thing that happened in v1.
