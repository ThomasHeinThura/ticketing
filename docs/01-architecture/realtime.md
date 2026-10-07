# Realtime

Two people looking at the same board must see each other's changes without refreshing.
That is the whole requirement, and it should not cost a message broker.

## Transport

WebSocket at `/api/ws`, via `@hono/node-server`'s built-in upgrade helper and the `ws`
server, on the same origin as the API so the session cookie authenticates the upgrade.
**Cookie-authenticated upgrades are not protected by the same-origin policy.**

P0 exposes native browser realtime only on the configured agent origin. CP-19 denies every
portal `/api` request and websocket upgrade with the same generic 404 before authentication,
session/API-key resolution, or socket handling. This denial takes precedence over the
otherwise applicable handshake checks below. The internal `portalAuth` instance is not a
public login or realtime surface; portal socket availability waits for the reviewed P3
identity boundary and a corresponding CP-19 change.

Before an agent-host route returns `101`, the request `Host` must identify exactly the
configured agent origin, including its port. Every handshake that resolves a session,
regardless of whether the credential arrived in a cookie or an explicit header, must carry
exactly one non-`null` `Origin`, equal to that host's complete configured origin (scheme,
host and port). A missing, literal `null`, malformed, duplicated or comma-list, foreign,
or mismatched `Origin` returns `403` before upgrade. An unknown or mismatched `Host` is
rejected by the host-routing guard with the generic `404` before upgrade.
Compare against the configured public origin, including when TLS terminates at a proxy;
HTTP CORS and origin values derived from the request URL or forwarding headers do not
replace this check. The session's stored `portal` must also be `agent`. Legacy sessions
without a stored portal are refused and require a fresh sign-in.

### Native work-item endpoint and protocol (P0)

The native work-item subscription transport is `GET /api/ws` on the agent origin. It uses
one socket and explicit `subscribe` / `unsubscribe` frames for work-item topics. The legacy
`/api/ws/user` notification socket and `/api/ws/{projectId}` Task-model socket remain for
their existing clients; they are not sources for native work-item event delivery. Their
retirement requires migrating those consumers separately. The native handshake authenticates
and checks the configured agent Host, exact Origin, and stored session portal before upgrade
using the rules above. API keys remain subject to their stored capability subset. This
endpoint is delegated to the WebSocket handshake in the route-policy registry; authorization
is performed again for each topic and periodically for the life of the connection.

Frames are JSON objects validated against a closed Zod union. The client may send
`{ "type": "subscribe", "topic": "project:{id}" }`,
`{ "type": "subscribe", "topic": "work_item:{key}" }`,
`{ "type": "unsubscribe", "topic": "…" }`, or `{ "type": "ping" }`.
Unknown properties, malformed JSON, unknown frame types, malformed topics, and more than
the existing per-socket frame limit close the connection. A successful subscription
returns `{ "type": "subscribed", "topic": "…" }`. A missing, foreign, archived, or
otherwise unreadable resource returns the same `{ "type": "subscription_denied" }`
shape; the server does not reveal whether it exists. The topic identifier is resolved from
the database and compared to authoritative project/work-item containment, never trusted as
 a request hint. `project:{projectId}` requires the same workspace reach and `work_item:read`
used by the project work-item list. `work_item:{key}` requires the same `work_item:read`
capability and row/project reach as `GET /api/work-items/{key}`. `user:` and `instance` topics are reserved for later protocol migrations and are denied by the native P0 work-item endpoint. Existing notification delivery continues over the legacy user socket.

Subscription authorization is refreshed on the 60-second floor and on existing identity,
membership, role, project, or session invalidation signals. A revoked session closes the
socket; lost resource reach drops the affected topic and sends the indistinguishable denial
frame. The server rechecks that a work item remains in its recorded project before every
fan-out. No subscription survives a key's move to a different project.

Only a request that resolves a valid API key, with no session, may omit `Origin`. This
includes the existing explicit `x-api-key` and `Authorization: Bearer` API-key paths. If
that request supplies `Origin`, it must still be the single exact configured origin for
its `Host`. An explicit bearer token that resolves a session is subject to the session
Origin and stored-portal rules, even though HTTP CSRF treats bearer credentials as
non-ambient. An invalid explicit credential returns `401` without falling back to an
accompanying cookie. With the currently pinned better-auth configuration, `bearer()` is
removed and a bare session token in `Authorization: Bearer` does not resolve a session;
it must receive `401`, not an Origin exemption. This rule does not enable that transport
or introduce a query credential, portal parameter, route or capability. The HTTP CSRF
rule in [security-model.md](security-model.md#sessions-csrf-and-step-up) does not by
itself settle WebSocket handshake policy.

```
Client                          Server
  │  GET /ws  (cookie, Origin)    │
  ├──────────────────────────────►│  check Origin == this host's configured origin
  │                               │  resolve session → identity; portal must match host
  │                               │  reject if no session (401) or wrong origin/portal (403)
  │◄──────────────────────────────┤  101 Switching Protocols
  │  { "type": "subscribe",       │
  │    "topic": "project:abc" }   │
  ├──────────────────────────────►│  authorize: may they read this project?
  │◄──────────────────────────────┤  { "type": "subscribed" }
  │                               │
  │◄──────────────────────────────┤  { "type": "work_item.updated", … }
```

**Subscription is authorized — and re-authorized.** A client asking for `project:xyz` it
cannot read is refused, and the refusal never distinguishes "does not exist" from "not in
reach" (the 404 rule applies on the socket too). Because a socket is long-lived and has no
"next request", the decision is not made once: every subscription is re-checked every 60 s.
In the current implementation a membership or role change is observed on that recheck.
Inbound frames are
Zod-validated; topics are parsed into a discriminated union, never prefix-matched; `user:` and `instance` topics are denied by the native P0 endpoint. Subscribe frames are rate-limited per socket. Broadcast is not a way around
policy.

## Topics

| Topic | Who subscribes | Carries |
| --- | --- | --- |
| `project:{projectId}` | Native P0: readers with workspace reach and `work_item:read` | Work item create/update and state changes |
| `work_item:{key}` | Native P0: readers with item reach and `work_item:read` | Work item detail and visible activity invalidations |
| `user:{personId}` | Legacy user socket during migration; native topic reserved | Notifications, assignment to you, approval requests |
| `instance` | Later protocol scope; denied by native P0 endpoint | Plugin config changes, job failures, import progress (`import.chunk_completed`) |

## Messages

```jsonc
{
  "type": "work_item.updated",
  "topic": "project:abc",
  "eventId": "evt_…",           // immutable outbox id; client deduplication key
  "at": "2026-09-05T10:14:22Z",
  "payload": { "key": "SUP-1234" }
}
```

The native work-item socket projection is deliberately key-only. It contains the canonical
event `type`, authorized `topic`, immutable `eventId`, `at`, and `payload.key`. It never
contains a work-item record, changed-field names, before/after values, comment body or id,
visibility, staff name, or the outbox payload. `events.md` remains the sole event-key and
domain-payload catalogue. The socket frame is an invalidation hint, and all displayed data
is fetched through the normal policy-enforced API.

| Existing canonical event | Project topic | Work-item topic | Customer portal |
| --- | --- | --- | --- |
| `work_item.created` | invalidate list | — | unavailable in P0; portal edge is denied |
| `work_item.updated`, `work_item.transitioned`, `work_item.assigned`, `work_item.unassigned` | invalidate list | invalidate matching item | unavailable in P0; portal edge is denied |
| `work_item.escalated`, `work_item.unblocked`, `work_item.mentioned` | invalidate list when the projection changes | invalidate matching item/activity | unavailable in P0; portal edge is denied |
| `work_item.commented` | invalidate list only if list projection depends on activity | invalidate matching activity | unavailable in P0; portal edge is denied |
| `work_item.deleted` | invalidate list | invalidate matching item/activity | unavailable in P0; portal edge is denied |

One event may reach both an authorized project and item topic. Clients deduplicate by
`eventId` for the life of the socket and always invalidate affected active queries,
including after their own mutation. Customer visibility suppression happens before fan-out and is based on the committed mutation's
visibility, not a client-supplied field. No socket event is emitted for an internal-only
comment or internal-only field change to a customer subscription.

**Messages carry what changed, not the full record.** The client invalidates the relevant
TanStack Query keys and refetches through the normal, policy-enforced API path. This
means:

- The socket never becomes a second, unaudited data path with its own authorization bugs.
- Payloads stay small.
- A client that missed messages recovers simply by refetching.

The one exception is presence, which has no REST equivalent and is sent whole.

## Client integration

```ts
useRealtime({
  topic: `project:${projectId}`,
  onMessage: (msg) => {
    if (seenEventIds.has(msg.eventId)) return;
    seenEventIds.add(msg.eventId);
    if (msg.topic.startsWith('project:') && msg.type !== 'work_item.commented') {
      queryClient.invalidateQueries({ queryKey: ['work-items', projectId] });
    }
    const key = msg.topic.startsWith('work_item:') ? msg.payload.key : undefined;
    if (key && msg.type !== 'work_item.created' && msg.type !== 'work_item.commented') {
      queryClient.invalidateQueries({ queryKey: ['work-items', 'detail', key] });
    }
    if (key && ['work_item.escalated', 'work_item.unblocked', 'work_item.mentioned', 'work_item.commented', 'work_item.deleted'].includes(msg.type)) {
      queryClient.invalidateQueries({ queryKey: ['work-items', 'activity', key] });
    }
  },
});
```

The native client deduplicates event IDs for each socket and debounces affected-query
invalidation for 150 ms. A bulk update therefore coalesces duplicate query keys on that
connection; independent sockets do not suppress each other's events. Comment events refresh
the activity key, while item mutations refresh detail and the project list when its projection
may change. Reconnect/outage polling remains active until subscription acknowledgement and
while the socket is unavailable.

## Scaling across replicas

```
        replica A                 replica B
        ┌────────┐                ┌────────┐
 client │  ws    │                │  ws    │ client
   ─────┤ adapter│                │ adapter├─────
        └───┬────┘                └────┬───┘
            │       Valkey pub/sub     │
            └──────────► taskdesk:ws ◄─┘
```

Two adapters implement the same interface:

- **`memory`** — default, single replica, zero dependencies.
- **`valkey`** — selected automatically when `TASKDESK_VALKEY_URL` is set. A mutation on
  replica A publishes to the channel; every replica fans out to its local sockets.

Nothing in application code knows which adapter is active.

Native cross-replica hints use the separate `taskdesk:ws-native:broadcast` Valkey channel. Native work-item changes are written as exactly one canonical `events.md` envelope to the
existing `outbox` in the same database transaction as the work-item mutation, activity and
required audit rows. The current in-process EventEmitter is not a durable source and does
not authorize publication before commit. After commit, the outbox dispatch seam publishes
one best-effort realtime invalidation using the outbox `eventId`; socket publication failure
is logged/observable but never rolls back a committed mutation. Realtime fan-out is an
at-most-once hint, not a replaying outbox consumer. The durable outbox remains available to
its registered consumers; reconnect refetch and active-query polling repair missed hints.
There is no new event key, table, retention policy, or feature flag.

### The control plane is a separate channel

User-facing topics travel on `taskdesk:ws`. **Replica coordination** — `auth.reload`,
`plugin.reload`, `flags.reload`, identity-cache invalidation — travels on `taskdesk:control`
and is never exposed to a browser. Pub/sub is an accelerator, not the source of truth: every
replica also polls the relevant `config_version` every 10 s, so a deployment with no Valkey
converges within the poll interval rather than silently diverging
([auth-runtime-reconfiguration.md](auth-runtime-reconfiguration.md)).

`identity.invalidate` is a private control message used by native work-item WebSockets after
committed authority changes. Its strict payload is `{ type: "identity.invalidate", userId?,
workspaceId?, projectId? }`; at least one target is required. Identifiers are internal routing
keys only and are never forwarded to browser sockets or logged. `userId` causes connections for
that person to reauthenticate immediately; `workspaceId` and `projectId` cause matching topic
subscriptions to be reauthorized and denied topics to be dropped. Publishers emit it only
after the corresponding session, membership, role, or project mutation commits. A control
message received before the mutation is visible is harmless because authorization is re-read
from PostgreSQL, and the 60-second refresh remains the recovery floor if publication is lost.
The in-memory adapter delivers within one process; the Valkey adapter uses `taskdesk:control`
for cross-replica delivery. This is control traffic, not a domain event or durable outbox row.

## Connection management

| Concern | Handling |
| --- | --- |
| Reconnect | Exponential backoff, 1 s → 30 s, with jitter |
| Missed messages | On reconnect the client refetches active queries. No replay buffer — the REST API is always the source of truth |
| Keepalive | Client sends a ping every 30 s; the server replies with `pong` |
| Backpressure | Native sockets close when buffered output exceeds 64 KiB; the client reconnects and refetches |
| Limits | 5 concurrent sockets per person; 50 topic subscriptions per socket |
| Session revoked | The socket re-authenticates at least every 60 s and closes when the session is no longer valid |
| Permission revoked | Affected topics are dropped on the invalidation message; the client is told which and refetches |
| Subscribe flood | Per-socket rate limit on inbound frames; a client exceeding it is closed |
| Transport unavailable | Show the shared-design-system status indicator and poll only active list/detail/activity queries every 30 s while foregrounded |
| Transport restored | Clear the indicator after successful upgrade and subscription; stop fallback polling |

## Presence and typing (Stage 4)

Presence — who else is on this work item — is stored in Valkey with a short TTL and
broadcast on the topic. If Valkey is absent, presence is simply unavailable; it is not a
correctness feature.

Typing indicators in comment threads follow the same pattern, throttled to one message
every 3 seconds per person.

## Collaborative editing — explicitly later

Plane runs Hocuspocus for CRDT-backed collaborative rich text. It is genuinely nice and it
is genuinely a whole subsystem: a second server process, Y.js documents, awareness state,
persistence and conflict resolution.

**Not in scope before Stage 5.** Until then, concurrent edits to a description are handled
with optimistic concurrency: a `409` and a clear "someone else changed this" affordance.
Revisit when there is evidence people actually co-edit descriptions.

## Fallback

An initial socket connection and its topic subscription acknowledgements are a pending
state, not an outage. Active queries keep the 30-second foreground polling fallback until
all requested topics are acknowledged, but the unavailable indicator appears only after a
connection error, close, or denied subscription. After an outage, keep the indicator and
polling active through reconnect until all requested topics are acknowledged again.

If the WebSocket cannot connect — a proxy that strips upgrades, a hostile corporate
network — the client falls back to polling active queries every 30 seconds and shows a
small "live updates unavailable" indicator. The application remains fully usable.

## Testing

| Test | Asserts |
| --- | --- |
| `ws-auth.test.ts` | Upgrade without a valid credential is refused. On the pinned auth stack, an issued session token sent as `Authorization: Bearer` without its cookie returns `401` on the agent host; it does not become an API key or a newly supported bearer session |
| `ws-origin.test.ts` | On the agent-host Node route, matching configured `Host` and one exact same-origin `Origin` can reach `101`; missing, `null`, malformed, duplicate/list, foreign Origins return `403` before `101`; an unknown or wrong-port Host receives the generic host-denial 404. Use raw handshake headers for duplicate/list cases; HTTP CORS is not evidence. Portal upgrades are covered by the CP-19 generic-denial host-routing test. |
| `ws-explicit-credential-origin.test.ts` | On the agent host, a valid explicit `x-api-key` and bearer API key without `Origin` retain access subject to existing reach policy; a supplied foreign Origin is refused. An invalid explicit bearer token or key with a valid cookie cannot fall back to that cookie. |
| `ws-portal-session.test.ts` | The agent host rejects non-agent, unbound legacy, and revoked session rows before upgrade. The portal public edge returns CP-19's generic 404 without session resolution; internal portal session binding tests do not assert public socket reachability. |
| `ws-subscribe-policy.test.ts` | Subscribing to an out-of-reach project is refused, indistinguishably from a non-existent one |
| `ws-reauthorize.test.ts` | Subscribe, revoke the membership, assert no further events arrive |
| `ws-frame-validation.test.ts` | Malformed frames and `user:` topics for another person are refused |
| `ws-fanout.test.ts` | Two clients, one mutation, both receive it once |
| `ws-valkey-adapter.test.ts` | Cross-replica delivery via a real Valkey container |
| E2E `realtime.spec.ts` | Two independently signed-in browser contexts open the same native work-item list. Create through the UI, then update through a real CSRF-protected, versioned API request; the other context observes the native `/api/ws` connection and renders both committed list responses before the 30-second polling fallback. This is the `work_item` path, not the legacy `task` board. The focused `node-server-websocket.test.ts` separately verifies two authorized actors receive one key-only hint per persisted POST/PATCH. Portal-host WebSocket denial remains covered by `ws-portal-session.test.ts` and CP-19 host-routing tests |

## Related

- [Architecture overview](overview.md) · [Background jobs](background-jobs.md)
- [Notifications](../03-features/notifications.md)
