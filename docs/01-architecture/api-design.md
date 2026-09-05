# API design

REST over HTTP, described by OpenAPI 3.2 (the current release as of 2026-09-05 — a small,
strictly 3.1-compatible feature update adding structured tags, streaming-friendly media
types and clearer OAuth2 device-flow support; a 3.1 client or tool still reads our spec
correctly), generated from Zod schemas via
`@hono/zod-openapi`. The spec is the contract; the typed client is generated from it.

## Principles

1. **Schema first.** Request and response shapes are Zod schemas. The OpenAPI document
   and the TypeScript client both derive from them. There is no hand-written spec to
   drift.
2. **Explicit response schemas.** Handlers never return a Drizzle row. They map to a
   response schema. This is how secrets and internal columns stay off the wire.
3. **Every route declares a policy.** See [RBAC](rbac.md). No policy ⇒ build fails.
4. **Boring REST.** Nouns, plural, kebab-case. Verbs live in HTTP methods, except for
   genuine actions which get an explicit sub-resource.
5. **Errors are machine-readable.** RFC 9457 problem details.

## Base paths

| Prefix | Purpose |
| --- | --- |
| `/api/*` | The application API |
| `/api/public/*` | Unauthenticated: branding, health, enabled auth providers |
| `/api/instance/*` | God Mode. Requires `instance:admin` |
| `/api/portal/*` | Customer portal surface — a deliberately narrow, separate router |
| `/auth/*` | better-auth handler |
| `/ws` | WebSocket upgrade |
| `/openapi.json` · `/docs` | Spec and Scalar reference UI |

### Why `/api/portal/*` is separate

The portal router is a small, hand-audited surface rather than the same handlers with a
role check. Fewer endpoints to reason about, no chance of a staff-only query parameter
being honoured for a customer, and the whole router can be reviewed in one sitting. Its
handlers reuse the domain layer but never share request shapes with the agent API.

## URL shape

```
GET    /api/projects
POST   /api/projects
GET    /api/projects/{projectId}
PATCH  /api/projects/{projectId}
DELETE /api/projects/{projectId}

GET    /api/projects/{projectId}/work-items
POST   /api/projects/{projectId}/work-items

GET    /api/work-items/{key}                 ← by human key, e.g. SUP-1234
PATCH  /api/work-items/{key}
POST   /api/work-items/{key}/transition      ← action: state change with note
POST   /api/work-items/{key}/assign
POST   /api/work-items/{key}/watch
DELETE /api/work-items/{key}/watch
GET    /api/work-items/{key}/activity
POST   /api/work-items/{key}/comments
GET    /api/work-items/{key}/sla             ← computed, never stored
```

Work items are addressed by **key**, not id, because the key is what people copy out of
chat messages. Ids remain in payloads for machine use.

## Collections

Cursor pagination. Offset pagination is not offered — it is wrong under concurrent
writes and it is slow at depth.

```
GET /api/projects/{id}/work-items
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

`meta.total` is an estimate for large sets and is documented as such. An exact count on a
million-row table is not worth the scan.

## Filter grammar

Complex filters — saved views, reports — use a structured JSON filter rather than an
ever-growing query string:

```json
{
  "op": "and",
  "clauses": [
    { "field": "state.group", "op": "in", "value": ["started"] },
    { "field": "sla.state",   "op": "eq", "value": "at_risk" },
    { "op": "or", "clauses": [
      { "field": "assignee", "op": "eq", "value": "@me" },
      { "field": "watcher",  "op": "contains", "value": "@me" }
    ]}
  ]
}
```

Sent as `POST /api/work-items/search`. The same document is what `saved_view.query`
stores, so a saved view is exactly a stored search. Fields are whitelisted; the grammar
compiles to parameterised SQL and can never express arbitrary SQL.

## Actions

Where an operation is not CRUD, it is a `POST` to a named sub-resource with a body:

```
POST /api/work-items/{key}/transition        { toStateId, note?, noteVisibility? }
POST /api/work-items/{key}/approvals         { approverId, expiresAt }
POST /api/approvals/{id}/decide              { decision: 'approve'|'reject', note }
POST /api/submissions/{ref}/accept           { projectId, typeId }
POST /api/imports/{plugin}/dry-run           { source, mapping }
POST /api/instance/plugins/{id}/test         { config }
```

Actions return the mutated resource in its normal response shape, so the client can
update its cache without a refetch.

## Errors

RFC 9457 `application/problem+json`:

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
| 400 | Malformed request |
| 401 | No or invalid session |
| 403 | In reach, missing capability. `capability` names what is missing |
| 404 | Not found **or out of reach** — deliberately indistinguishable |
| 409 | Conflict: version mismatch, duplicate key, illegal transition |
| 422 | Validation failed. `errors[]` gives field-level detail |
| 429 | Rate limited. `Retry-After` set |
| 500 | Unexpected. `traceId` correlates to logs. Never leaks internals |

Validation errors are field-addressed so React Hook Form can bind them directly:

```json
{ "status": 422, "errors": [
  { "path": "title",            "code": "too_short", "message": "Title is required" },
  { "path": "customFields.abc", "code": "required",  "message": "Impact is required" }
]}
```

## Concurrency

Mutable resources carry a `version` integer. `PATCH` may send
`If-Match: "<version>"`; a mismatch returns `409` with both versions so the client can
show a merge affordance. Applied to work items, comments, workflows, SLA policies and
plugin configuration — the things two people plausibly edit at once.

## Idempotency

Unsafe requests may send `Idempotency-Key`. The key, request hash and response are stored
for 24 hours; a repeat returns the original response. Required for importers, mandatory
for anything invoked by an AI agent, which may retry.

## Rate limiting

Per identity, per route class, using Valkey (or in-memory when Valkey is absent):

| Class | Limit |
| --- | --- |
| Auth endpoints | 10 / minute / IP |
| Portal writes | 60 / minute / person |
| Agent writes | 300 / minute / person |
| Reads | 1000 / minute / person |
| Search | 60 / minute / person |
| API keys | Configurable per key |

Configurable in God Mode; the table above is the default.

## Versioning

The API is unversioned until v2.0 ships. After that:

- Additive changes (new optional field, new endpoint) go out freely.
- Breaking changes get a new path segment, and the old one is supported for two minor
  releases with a `Deprecation` and `Sunset` header.
- The OpenAPI diff is generated in CI, and a breaking change without a version bump
  fails the build.

## Typed client

`packages/libs` exports a Hono RPC client typed from the API's route definitions:

```ts
import { api } from '@taskdesk/libs';

const res = await api.workItems[':key'].$get({ param: { key: 'SUP-1234' } });
//    ^ fully typed from the server route — a server change breaks the client build
```

The frontend never constructs URLs by hand and never uses `fetch` directly.

## Documentation

`/docs` serves a Scalar reference generated from the live spec. The spec is also exported
in CI to `apps/site/public/openapi.json` so the documentation website renders the same
reference.

## Related

- [RBAC](rbac.md) · [Security model](security-model.md) · [Realtime](realtime.md)
- [Coding standards](../04-engineering/coding-standards.md)
