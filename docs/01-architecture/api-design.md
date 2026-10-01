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
| `/api/public/*` | Unauthenticated: branding, `health/live` and `health/ready`, the login page's provider **buttons only** (label + id — never discovery URLs, tenant ids or domain restrictions), terminology, CSP reports, and the two origin-specific `POST /api/public/{agent|portal}/notification-preference-handoffs` routes (one-purpose signed email token; short-lived selector handoff only) | `public` with reason — **no exceptions**, so the router's blanket kind is true of every route under it |
| `/api/instance/*` | God Mode. `instance:*` capabilities. Includes the dependency-enumerating deep health check, `GET /api/instance/health/deep` — capability `instance:admin`, scope `instance`; it is **not** on the public router, and the `/metrics` bearer token is not an alternative credential for it | capability |
| `/api/portal/*` | Customer portal — a deliberately narrow, separate router | `portal` with predicate |
| `/auth/*` | better-auth handler | `delegated: better-auth` |
| `/ws` | WebSocket upgrade | `delegated: websocket` (Origin-checked — [realtime.md](realtime.md)) |
| `/metrics` | Exact `GET /metrics` Prometheus scrape on its own Node listener, bearer-guarded | `delegated: metrics` |
| `/scim/v2/*` | Inbound SCIM 2.0 provisioning — Microsoft Entra first. `application/scim+json`. Authenticated by a per-connection bearer token that fixes the organisation, portal scope and allowed resources server-side ([identity-provisioning.md](../03-features/identity-provisioning.md)) | `delegated: scim` |
| `/openapi.json` · `/docs` | Spec and Scalar reference UI | `public` |

### Metrics listener and permission coverage

The `/metrics` route is served by a separate Node listener on fixed internal port 9464; it
is not mounted on the Hono API application and has no Traefik route. The module that starts
that listener exports its declarative listener manifest: listener port, exact method and
path, and delegated policy key `GET /metrics`. `tests/permissions/route-coverage.test.ts`
enumerates this manifest as well as `app.routes`. Coverage fails if the listener is present
without the delegated policy, if the policy is orphaned, or if the constructed listener
does not match its manifest. A handwritten test-only route list is insufficient evidence.

The listener accepts only `GET /metrics` without a query string. `HEAD`, `OPTIONS`, or any
other method on that path returns `405`; every other path returns `404`.

### Observability administration and step-up

The instance administrator API contract is:

```
GET   /api/instance/observability                       instance:admin, instance scope
PATCH /api/instance/observability                       instance:admin, instance scope
POST  /api/instance/observability/metrics-token/rotate  instance:admin, instance scope, elevated, session-only
POST  /api/me/step-up/challenges                       authenticated + self, session-only
POST  /api/me/step-up                                   authenticated + self, session-only
```

GET returns exactly `{version, logLevels, metricsTokenConfigured,
metricsTokenRotatedAt}` with `Cache-Control: no-store`; neither digest nor token is included.
PATCH accepts only `{version, logLevels}`, uses compare-and-set on the singleton version,
audits changed keys only, and never accepts a token. A stale version returns `409
version_conflict` with the current safe version. Rotation accepts only `{version}`, returns
exactly `{version, token, metricsTokenRotatedAt}` once with `Cache-Control: no-store`, and
requires a single-use `X-TaskDesk-Step-Up-Token` bound to this exact operation, version and
canonical request body. For the operation binding, the parsed body is exactly one property,
`version`, whose value is a positive safe integer; request validation rejects unknown
properties. Syntactically valid JSON may contain insignificant whitespace or equivalent
JSON numeric spelling. The server serializes the validated value as UTF-8
`{"version":<base-10 integer>}` with no whitespace and hashes those canonical bytes for both
challenge and execution. It never hashes raw wire bytes or trusts a client hash. Equivalent
wire JSON therefore binds to the same semantic operation; a different parsed version or
extra property fails. Duplicate-key rejection is not implied by ordinary JSON/Zod parsing;
the parsed semantic value is the binding contract. Challenge and step-up mint responses are also
`Cache-Control: no-store`; the challenge nonce and step-up token each appear once.

Each successful configuration mutation appends the audit-only key
`instance.observability_changed`, with actor, trace id and changed keys (`logLevels` or
`metricsToken`) only; values, bearer token, hash and arbitrary before/after objects never
enter audit. An audit append failure follows AU-14: roll back the nested audit savepoint,
report the failure through the defined operational signal, and preserve the committed
configuration mutation.

The rotation binding is not implementable merely by marking the policy elevated. It depends
on a challenge/token verifier that actually validates the required fresh authentication
method and atomically consumes the token with the rotation CAS. Where the account's required
method cannot be verified, return `403 step_up_unavailable` and do not rotate. See
[security-model.md](security-model.md#sessions-csrf-and-step-up) and
[pending-actions.md](pending-actions.md) `PA-15`.

### Identity-connection configuration compare-and-set

`PATCH /api/instance/identity-connections/{id}` carries the connection's expected positive
safe-integer `configVersion` with the configured fields. Under the `IP-22` total lock order,
compare it with `identity_connection.config_version`; a stale version returns
`409 version_conflict` with only the current safe version and changes nothing. Every
committed connection-configuration mutation advances the version exactly once. In
particular, changing JIT enabled/default-role/target policy and lowering an enabled agent
connection's `max_role_rank` apply the `IP-22` source-scoped retirement, projection,
audit/provisioning and existing event/outbox changes in the same CAS transaction. The
shared lock/retry protocol prevents racing a mapping write, OIDC login, SCIM synchronization,
role edit or connection disable into committing stale authority. This ordinary connection
update is not a new PA-15 operation; the two OIDC mapping routes below retain their separate
operation-bound proof.

The separate administration route `PATCH /api/instance/identity-connections/{id}/scim` has
a proposed route-wide `instance:admin`, `elevated: true`, `sessionOnly: true` policy. Its
strict request/response DTO, edit/omission semantics, parent `config_version` CAS, and
dedicated PA-15 route/body/version binding are not specified by this contract. They are an
open owner obligation tracked in [issue #561](https://github.com/ThomasHeinThura/ticketing/issues/561).
Do not infer an operation key or reuse an OIDC/metrics proof. Until that contract is
specified, a mounted SCIM administration write fails closed with the existing
`403 step_up_unavailable` response and makes no configuration or grant mutation.

### OIDC group-mapping administration

The existing agent connection editor and organisation Identity tab use this single route
family. The organisation screen is server-filtered through the connection's persisted
`organisation_id`; it does not supply or select an organisation in a mapping request.

```
GET   /api/instance/identity-connections/{id}/oidc-group-mappings
      instance:admin, instance scope, elevated: false
POST  /api/instance/identity-connections/{id}/oidc-group-mappings
      instance:admin, instance scope, elevated, session-only
PATCH /api/instance/identity-connections/{id}/oidc-group-mappings/{mappingId}
      instance:admin, instance scope, elevated, session-only
```

The GET policy declares `scopeSource: instance` and an explicit elevation exemption reason:
read-only mapping configuration returns no credentials or provider claims. Each route
requires `instance:admin`, `scope: instance`, and `scopeSource: instance`; mapping writes
also require `elevated: true` and `sessionOnly: true`. API keys, MCP keys and impersonation
sessions receive `403 session_required` before a write or step-up operation. The collection
and item handlers load the connection from `{id}`; an item must belong to that connection.
Unknown connections and missing or foreign mapping ids share the same `404` response.

All request objects are strict and reject unknown properties. In particular, callers cannot
supply `organisationId`, `portalScope`, capabilities, `seesAll`, grant source, `createdBy`,
or external identity/person ids. These routes accept only God Mode session requests; neither
OIDC claims nor a SCIM bearer can invoke them. Errors use RFC 9457 problem details, never
SCIM error objects. Administrator configuration responses use `Cache-Control: no-store`.

`MappingDto` is an explicit projection of the persisted mapping and contains exactly:

```json
{
  "id": "...",
  "externalGroupId": "...",
  "externalGroupNameSnapshot": null,
  "roleId": "...",
  "scope": "organisation",
  "scopeId": "...",
  "enabled": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`scopeId` is the persisted organisation id for customer mappings and workspace id for agent
mappings. No provider response, raw claim list, credential, secret or unlisted database
column is returned. GET returns `{data: MappingDto[], configVersion}` ordered by immutable
`externalGroupId`; `configVersion` is the current positive `identity_connection.config_version`.

POST accepts exactly `{configVersion, externalGroupId, externalGroupNameSnapshot?, roleId,
scope, scopeId?, enabled?}`. `configVersion` is a positive safe integer. The immutable
`externalGroupId` is a canonical lower-case, hyphenated Entra object-id UUID, validated by
the same canonicalizer used for the IP-28 token `groups` array before matching or
uniqueness validation. A malformed id is rejected. It is never a group name or email.
`externalGroupNameSnapshot` is display-only and defaults to null; `enabled` defaults to
true. Customer connections require `scope: "organisation"`, omit `scopeId`, resolve the
persisted scope id from the connection's organisation, and accept only the existing customer
role. Agent connections require `scope: "workspace"`, an existing workspace with
`deleted_at IS NULL` owned by the unique active, non-deleted internal organisation, and an
existing staff role scoped to that workspace. The instance administrator explicitly selects
the workspace. Create, target change, enable and login reconciliation revalidate this
predicate and the role's current rank/capabilities under `max_role_rank`; neither the agent
connection nor provider data chooses the workspace. Agent connections keep
`organisation_id = NULL`. See `IP-3` and `IP-20` in
[identity-provisioning.md](../03-features/identity-provisioning.md).
`201` returns `{data: MappingDto, configVersion}` with the incremented version.

PATCH accepts exactly `{configVersion, externalGroupNameSnapshot?, roleId?, scopeId?,
enabled?}` and requires at least one mutable property. `externalGroupId`, `scope`, the
connection, organisation and portal scope cannot change through PATCH. A customer mapping
cannot change its resolved organisation target. An agent `scopeId` change is a target
change. `200` returns `{data: MappingDto, configVersion}` with the incremented version.
There is no mapping DELETE, bulk replacement, or omission-as-removal operation in the first
release; `enabled: false` is the administrative removal action and preserves mapping and
grant/audit history.

Every create, edit and enable revalidates the current Entra connection, portal and
organisation, target ownership, role existence and side/scope, current rank against
`max_role_rank`, administrator authority/rank guardrails and forbidden capabilities. All
mapping writes are unconditionally elevated even for customer, display-only or otherwise
non-authority changes; the SCIM mapping elevation thresholds do not apply to these OIDC
routes (IP-6). The
same validation runs for disabled rows. A mapping can never mint a role or capability,
`instance:admin`, `sees_all`, customer-to-staff access or cross-organisation/workspace reach.
Invalid persisted mappings fail closed at read and reconciliation boundaries. The write
compares body `configVersion` with `identity_connection.config_version` under the same
connection lock/transaction as the mapping mutation and advances it exactly once on success.
Stale versions return `409 version_conflict` with only the current safe version; duplicate
`(identity_connection_id, external_group_id)` returns `409`; validation failures return
`422` with field errors; unknown/foreign resources remain masked as `404`; missing
capability/elevation is `403`. A failed check makes no mapping, grant or version change.

Both writes always require a PA-15 operation-bound step-up confirmation, not only when a
handler decides the selected role is risky. PA-15 registers
`oidc_group_mapping_create` for the POST route and `oidc_group_mapping_update` for the PATCH
route. Challenge and proof-completion requests bind the operation key, exact route,
connection id, mapping id for update, expected `configVersion`, and the strict validated
request body. The server serializes the schema-parsed body in declared property order,
omitting absent optional fields while preserving explicit nulls and applying declared
defaults, then hashes UTF-8 JSON for the closed envelope `{routeKey, connectionId,
mappingId?, request}`. Neither client-selected route keys nor client-supplied hashes are
accepted. Execution recomputes the same envelope from the path and validated body and
consumes the five-minute single-use proof atomically with the version compare-and-set and
mutation. A stale version or failed validation rolls back token consumption; retry requires
a new challenge for the current version and exact request. An unavailable required factor
or SSO verifier returns `403 step_up_unavailable` without mutation. This proof is not the
metrics rotation operation and does not create a session-wide freshness window.

In one write transaction, use the shared `IP-22` total lock order and closure
rediscovery/retry; revalidate caller authority, mapping, role and rank under those locks.
Create makes no grant; a later validated OIDC login must observe the group claim. Disable,
role change or target change retires only active OIDC grants from that mapping, recomputes
each affected one-role effective membership, writes the existing
`provisioning_event` kind `group.mapping_changed` and safe `audit_log` evidence under
AU-14, and publishes authority-cache invalidation after commit. Re-enable never resurrects
retired grants before a later validated OIDC login through this connection with complete
matching groups and current admission. A SCIM update cannot restore an OIDC grant; SCIM
grants require fresh authenticated SCIM evidence. A write for connection A cannot change
connection B, SCIM, direct or another mapping's grants. No Graph lookup or new event key is
introduced. The existing identity-connection DELETE remains the PA-5/GM-6 pending-action
operation.

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
`/api/capabilities`, `/api/webhooks`, `/api/views`). They read the
workspace from the **`X-Workspace-Id` header** (or `?workspace=` for GET), which the
policy middleware validates against the identity's memberships **before** the policy
check. Absent ⇒ `400`; not a member ⇒ `404`. The typed client sets the header from the
current workspace automatically; there is no other mechanism.

Notification inbox routes under `/api/notification` are authenticated-self routes: they
derive `person_id` from the session and do not require workspace context. Each returned or
mutated notification must also pass reach filtering for its referenced resource under that
resource's policy; inaccessible or deleted resources are omitted from collections and
cannot be read or mutated by id. Notification preference routes are self routes too, but
workspace- and project-scoped preference routes validate the selected scope against the
person's current reach.

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
  resolves through `project.organisation_id`; `state.group` is not a stored column — it
  resolves through the join `state.state_template_id → state_template.group`
  ([data-model.md](data-model.md) §3); `sla.state` and `sla.due_at` resolve against
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

**Before `2.0.0`, a deliberate breaking change is allowed only through the reviewed
allowlist** (decision log, 2026-09-25): an entry in `scripts/ci/openapi-approved-breaks.json`,
naming the exact operation, oasdiff rule and oasdiff finding fingerprint, added in the
**same PR** that makes the break, with its own **GPT-6 Sol security review** on that PR (the
file is in the security-review scope — [ci-cd.md](../04-engineering/ci-cd.md)) and a
reference to the decision-log entry that authorized it. **Entries approve only the break in
the PR that adds them — delete them after that PR merges.** Once an entry's PR lands, that
entry is on `origin/main` and stops approving anything; a later PR making a similar break on
the same route needs its own new entry and its own GPT-6 Sol review, never a leftover one. Any
finding that no NEW entry in the current PR matches still fails CI, and a new entry that
matches no finding fails too, as a stale or typo'd entry. From the first stable `v2.0.0` (or
later) release tag on, this allowlist must be empty — a breaking change is versioned with a
new path segment as above, never allowlisted.

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
