# API design

REST over HTTP, described by an OpenAPI document generated from Zod schemas via
`@hono/zod-openapi`. **The OpenAPI document is the published contract for third parties**
(MCP clients, importers, customers' integrations, the Scalar reference); **the in-repo
client is a Hono RPC client typed structurally from the route definitions**, not generated
from the spec — see [Typed client](#typed-client). Rewritten 2026-09-05 after the
[planning review](../07-planning/review-2026-09-05.md).

**OpenAPI version.** `@hono/zod-openapi` emits **3.1** today, and the validators we run
(Redocly CLI, `oasdiff`) target 3.1. OpenAPI 3.2 (September 2025) is a strictly
3.1-compatible feature release; we adopt it the moment the emitter and validators support
it, with no change to any schema. The document says which version it is; the docs never
claim a version the toolchain cannot produce.

## Principles

1. **Schema first.** Request and response shapes are Zod schemas. The OpenAPI document
   derives from them and the Hono RPC types derive from the same route definitions. There
   is no hand-written spec to drift.
2. **Explicit response schemas.** Handlers never return a Drizzle row. They map to a
   response schema. This is how secrets and internal columns stay off the wire.
3. **Every route declares a policy** — one of the five kinds in [RBAC](rbac.md). No
   policy ⇒ build fails.
4. **Boring REST.** Nouns, plural, kebab-case. Verbs live in HTTP methods, except for
   genuine actions which get an explicit sub-resource.
5. **Errors are machine-readable.** RFC 9457 problem details, always.
6. **CSRF is a cookie-only concern.** The `Origin`/`Referer` check and the double-submit
   token apply **only to cookie-authenticated unsafe requests**, because the cookie is the
   only credential a browser attaches ambiently; requests bearing an API key, a bearer token
   or a SCIM token are exempt from both, and non-browser clients that send no `Origin` are
   not refused. Stated once in
   [security-model.md](security-model.md#sessions-csrf-and-step-up) — this is a citation,
   not a second rule.

## Base paths

| Prefix | Purpose | Policy kind |
| --- | --- | --- |
| `/api/*` | The application API | capability |
| `/api/me/*` | The caller's own records: settings, preferences, API keys, approvals | `authenticated + self` |
| `/api/public/*` | Unauthenticated: branding, `health/live` and `health/ready`, the login page's provider **buttons only** (label + id — never discovery URLs, tenant ids or domain restrictions), terminology, CSP reports | `public` with reason — **no exceptions**, so the router's blanket kind is true of every route under it |
| `/api/instance/*` | God Mode. `instance:*` capabilities. Includes the dependency-enumerating deep health check, `GET /api/instance/health/deep` — capability `instance:admin`, scope `instance`; it is **not** on the public router, and the `/metrics` bearer token is not an alternative credential for it | capability |
| `/api/portal/*` | Customer portal — a deliberately narrow, separate router | `portal` with predicate |
| `/auth/*` | better-auth handler | `delegated: better-auth` |
| `/ws` | WebSocket upgrade | `delegated: websocket` (Origin-checked — [realtime.md](realtime.md)) |
| `/metrics` | Prometheus scrape, bearer-guarded | `delegated: metrics` |
| `/scim/v2/*` | Inbound SCIM 2.0 provisioning — Microsoft Entra first. `application/scim+json`. Authenticated by a per-connection bearer token that fixes the organisation, portal scope and allowed resources server-side ([identity-provisioning.md](../03-features/identity-provisioning.md)) | `delegated: scim` |
| `/openapi.json` · `/docs` | Spec and Scalar reference UI | `public` |

### Why `/api/portal/*` is separate

The portal router is a small, hand-audited surface rather than the same handlers with a
role check. Fewer endpoints to reason about, no chance of a staff-only query parameter
being honoured for a customer, and the whole router can be reviewed in one sitting. Its
handlers reuse the domain layer but never share request shapes **or routes** with the
agent API — a single route serving "either session" is forbidden
([ADR 0004](adr/0004-two-portals-two-origins.md)).

## Path parameters — one convention

| Parameter | Form | Example |
| --- | --- | --- |
| Work items | `{key}` — the human key | `/api/work-items/SUP-1234` |
| Projects | `{projectId}` — CUID2 | `/api/projects/{projectId}` |
| Submissions | `{ref}` — `SUB-n` | `/api/submissions/SUB-88` |
| Everything else | `{id}` — CUID2 | `/api/webhooks/{id}` |

Work items are addressed by **key** because the key is what people copy out of chat
messages. Ids remain in payloads for machine use. Policy keys in `policy.ts` use exactly
these forms, and `PolicyMap<typeof routes>` makes a mismatch a type error.

## Workspace context

Many routes are workspace-scoped but carry no workspace in the path (`/api/custom-fields`,
`/api/capabilities`, `/api/webhooks`, `/api/views`, `/api/notifications`). They read the
workspace from the **`X-Workspace-Id` header** (or `?workspace=` for GET), which the
policy middleware validates against the identity's memberships **before** the policy
check. Absent ⇒ `400`; not a member ⇒ `404`. The typed client sets the header from the
current workspace automatically; there is no other mechanism.

## URL shape

```
GET    /api/projects
POST   /api/projects
GET    /api/projects/{projectId}
PATCH  /api/projects/{projectId}
DELETE /api/projects/{projectId}

GET    /api/projects/{projectId}/work-items
POST   /api/projects/{projectId}/work-items

GET    /api/work-items/{key}
PATCH  /api/work-items/{key}
POST   /api/work-items/{key}/transition      ← action: state change with note
POST   /api/work-items/{key}/assign
POST   /api/work-items/{key}/watch
DELETE /api/work-items/{key}/watch
GET    /api/work-items/{key}/activity
POST   /api/work-items/{key}/comments
GET    /api/work-items/{key}/sla             ← computed fresh, never stored
```

## Collections

Cursor pagination. Offset pagination is not offered — it is wrong under concurrent
writes and it is slow at depth. The one exception is `/scim/v2/*`, where SCIM 2.0 mandates
1-based `startIndex`/`count` and Microsoft Entra sends exactly that
([identity-provisioning.md](../03-features/identity-provisioning.md) `IP-13`); it is the
only offset-paginated surface, and it is small.

```
GET /api/projects/{projectId}/work-items
    ?cursor=<opaque>
    &limit=50                       (default 50, max 200)
    &state=in_progress,blocked
    &assignee=me|<personId>|none
    &priority=high,urgent
    &label=<id>
    &due_before=2026-10-01
    &q=printer
    &sort=position|created_at|due_date|priority
    &order=asc|desc
```

```json
{
  "data": [ … ],
  "page": { "nextCursor": "…", "hasMore": true },
  "meta": { "total": 1284 }
}
```

`meta.total` is an estimate for large sets and is documented as such.

## Query grammar — filters, sort, grouping, aggregation

Complex queries — saved views, queues, tier 2 and tier 3 reports — use one structured
document, sent as `POST /api/work-items/search` and stored verbatim as
`saved_view.query`:

```json
{
  "entity": "work_item",
  "filter": {
    "op": "and",
    "clauses": [
      { "field": "state.group", "op": "in", "value": ["started"] },
      { "field": "sla.state",   "op": "eq", "value": "at_risk" },
      { "field": "cf.impact",   "op": "eq", "value": "Everyone" },
      { "op": "or", "clauses": [
        { "field": "assignee", "op": "eq", "value": "@me" },
        { "field": "watcher",  "op": "contains", "value": "@me" }
      ]}
    ]
  },
  "sort":    [{ "field": "priority", "order": "desc" }],
  "columns": ["key", "title", "state", "assignee", "sla.due_at"],
  "groupBy": "assignee",
  "aggregate": { "fn": "count" }
}
```

- `entity` ∈ `work_item | submission | time_entry | sla_event`. A queue over submissions
  *and* work items is two saved views presented together, not one document.
- **Fields are whitelisted per entity**; `cf.<key>` addresses a custom field; `organisation`
  resolves through `project.organisation_id`; `sla.state` and `sla.due_at` resolve against
  `work_item_sla_cache` and are **eventually consistent** (five-minute refresh) — the
  detail endpoint always recomputes, and where they disagree the computed value wins
  ([ADR 0009](adr/0009-lazy-sla-evaluation.md)).
- `groupBy` and `aggregate` (`count | sum { field } | avg { field } | percentile { field, p }`)
  are what tier 3 reports add; a plain saved view omits them.
- The grammar compiles to parameterised SQL and can never express arbitrary SQL.
- **Authorization inside the filter.** Every filterable field carries its own read
  capability (a customer cannot filter on `assignee` or an internal custom field; the
  request is 422 naming the field); the filter is evaluated **after** the identity scope is
  applied; and `meta.total` counts only rows within reach — so search can never become an
  existence oracle for records the caller may not see.

A saved view is exactly a stored query document plus a `layout`; there is **one** route
family for saved views, `/api/views`, defined in
[search-and-saved-views.md](../03-features/search-and-saved-views.md). Reports do not add a
second.

## Actions

Where an operation is not CRUD, it is a `POST` to a named sub-resource with a body:

```
POST /api/work-items/{key}/transition        { toStateId, note?, noteVisibility? }
POST /api/work-items/{key}/approvals         { approverId, expiresAt }
POST /api/approvals/{id}/decide              { decision: 'approve'|'reject', note }
POST /api/submissions/{ref}/accept           { projectId, typeId }
POST /api/imports/{id}/dry-run               ← an import run is a resource with a lifecycle
POST /api/instance/plugins/{id}/test         { config }
```

Actions return the mutated resource in its normal response shape, so the client can
update its cache without a refetch. Actions that can race (self-assign, claim a
submission) accept an optional `If-Match` or use a conditional update and return `409`
naming the winner.

## Errors

RFC 9457 `application/problem+json` — **every** error response, including validation.
The media type is declared on every error response schema so Scalar renders it correctly.
**One exception, because the protocol demands it:** `/scim/v2/*` answers with SCIM 2.0
error objects (`urn:ietf:params:scim:api:messages:2.0:Error`, `application/scim+json`) —
Microsoft Entra parses those, not problem documents
([identity-provisioning.md](../03-features/identity-provisioning.md) `IP-14`).

```json
{
  "type": "https://docs.taskdesk.dev/errors/insufficient-capability",
  "title": "Insufficient capability",
  "status": 403,
  "detail": "This action requires work_item:assign in project SUP.",
  "instance": "/api/work-items/SUP-1234/assign",
  "capability": "work_item:assign",
  "traceId": "01J8…"
}
```

| Status | Used for |
| --- | --- |
| **202** | **Accepted, not performed.** A user-initiated `DELETE` of an ordinary record — work item, comment, attachment, custom field, saved view, time entry, label — and every destructive MCP call returns `202` with `{ pendingActionId, action, summary, confirmation, expiresAt, approveUrl }`; the requesting human approves in the UI and the server executes — [pending-actions.md](pending-actions.md). A retry while pending is `409 pending_approval` with the same id, whether or not it carries an `Idempotency-Key`. **The elevated targets are the exception:** deleting a workspace, organisation, project, API key, webhook, identity connection or `auth.*` plugin carries `sessionOnly: true`, so on an API key, an MCP key or an impersonation session it is `403 session_required` **before the policy runs** — no 202, no pending action ([pending-actions.md](pending-actions.md) `PA-5`) |
| 400 | Malformed request; missing workspace context; a SCIM or OIDC payload carrying a forbidden tenant/role/capability attribute (`forbidden_attribute`) |
| 401 | No or invalid session |
| 403 | In reach, missing capability. `capability` names what is missing. Also `session_required` (an API/MCP key or impersonation session on a session-only route) and `no_approver` (a service key requesting a deletion) |
| 404 | Not found **or out of reach** — deliberately indistinguishable |
| 409 | Conflict: version mismatch, duplicate key, illegal transition (`reason`), in-flight idempotent duplicate, `pending_approval` (a retry while a pending action is open), `target_changed` (a target's version moved between a pending action's request and its approval) |
| 422 | Validation failed. `errors[]` gives field-level detail |
| 429 | Rate limited. `Retry-After` set; `quota` names which limit |
| 500 | Unexpected. `traceId` correlates to logs. Never leaks internals |

Validation errors are a full problem document with `errors` as an extension member, so
React Hook Form can bind them directly:

```json
{
  "type": "https://docs.taskdesk.dev/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "instance": "/api/projects/…/work-items",
  "traceId": "01J8…",
  "errors": [
    { "path": "title",            "code": "too_short", "message": "Title is required" },
    { "path": "customFields.abc", "code": "required",  "message": "Impact is required" }
  ]
}
```

## Concurrency

Mutable resources carry a `version` integer — the tables marked **v** in the
[data model](data-model.md). `PATCH` may send `If-Match: "<version>"`; a mismatch returns
`409` with both versions so the client can show a merge affordance. **Rank changes
(`POST …/rank`) are exempt and last-write-wins** — dragging must never 409.

## Idempotency

Unsafe requests may send `Idempotency-Key`. The key, request hash and response are stored
in `idempotency_key` for 24 hours; a repeat returns the original response; a duplicate that
arrives **while the first is still in flight** returns `409`. Required for importers,
mandatory for anything invoked by an AI agent, which may retry.

**Order matters for deletions.** The idempotency middleware runs **before** the pending-action
layer, so a keyed retry of a `DELETE` replays the stored `202` and creates nothing. An unkeyed
repeat reaches the pending-action layer and is stopped there by a uniqueness rule on the open
action, returning `409 pending_approval` with the existing id. Either way there is exactly one
pending action per set of targets — never two for a human to reason about
([pending-actions.md](pending-actions.md) `PA-4`).

## Rate limiting

Two nested buckets, both in Valkey, one `429` shape:

| Bucket | Limit | Names itself in `quota` as |
| --- | --- | --- |
| **Outer — organisation quota** | Default 600 requests / minute per organisation ([multi-tenancy.md](multi-tenancy.md)) | `organisation` |
| **Inner — identity × route class** | Auth 10/min/IP · portal writes 60/min · agent writes 300/min · reads 1000/min · search 60/min · API keys: `min(key.rate_limit_per_minute, class limit)`; MCP-flagged keys additionally capped by `instance_setting.mcp_write_ceiling_per_minute` | `route_class` |
| **Anonymous class** | `/api/public/*` 60/min/IP · non-login `/auth/*` (magic link, OTP, reset) 5/min/IP **and** 3/hour per target email · WebSocket upgrades 10/min/IP. Responses on the mail-sending endpoints are constant-time and identical whether or not the account exists | `anonymous` |

Client IP is taken from `X-Forwarded-For` only at the trusted-proxy hop configured by
`TASKDESK_TRUST_PROXY`; a forged header moves no bucket. Every bucket, including the
organisation quota, produces the same `429` problem document with `quota` and
`Retry-After`.

Configurable in God Mode; the table above is the default. **Without Valkey the counters
are per replica and therefore approximate** — a multi-replica deployment must configure
Valkey ([scaling.md](../05-operations/scaling.md)).

## Versioning

The API is unversioned until `2.0.0` ships ([release-plan.md](../07-planning/release-plan.md)).
After that:

- Additive changes (new optional field, new endpoint, new event key) go out freely.
- Breaking changes get a new path segment, and the old one is supported for two minor
  releases with a `Deprecation` and `Sunset` header.
- The OpenAPI diff (`oasdiff`) runs in CI against `main`, and a breaking change without a
  version bump fails the build.

## Typed client

`packages/libs` exports a **Hono RPC client** typed from the server's exported `AppType`.
It does not read the OpenAPI document; the types flow through the monorepo, so a server
change that the client does not reflect fails `pnpm typecheck` — there is no generation
step and nothing to regenerate.

```ts
// apps/api/src/index.ts
export type AppType = typeof app;

// packages/libs/src/client.ts
import { hc } from 'hono/client';
export const api = hc<AppType>(baseUrl, { headers: () => ({ 'X-Workspace-Id': currentWorkspaceId() }) });

// apps/web — path segments mirror the URL literally
const res = await api.api['work-items'][':key'].$get({ param: { key: 'SUP-1234' } });
//    ^ fully typed from the server route — a server change breaks the client build
```

Routes are declared with `createRoute({ path: '/api/work-items/{key}', … })`;
`@hono/zod-openapi` converts `{key}` for the document and `:key` for the router. The
frontend never constructs URLs by hand and never uses `fetch` directly.

## Documentation

`/docs` serves a Scalar reference generated from the live spec. The spec is exported in CI
to `apps/site/public/openapi.json` so the documentation website renders the same
reference, and it is what MCP tool schemas and third-party integrators consume.

## Related

- [RBAC](rbac.md) · [Security model](security-model.md) · [Realtime](realtime.md) · [Events](events.md)
- [Coding standards](../04-engineering/coding-standards.md)
