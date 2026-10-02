# Realtime

Two people looking at the same board must see each other's changes without refreshing.
That is the whole requirement, and it should not cost a message broker.

## Transport

WebSocket at `/ws`, via `@hono/node-server`'s built-in upgrade helper and the `ws` server,
on the same origin as the API so the session cookie authenticates the upgrade. The current
Node listener mounts the user and project handshakes at `/api/ws/user` and
`/api/ws/:projectId`; `/ws` here describes the transport, not an additional route.
**Cookie-authenticated upgrades are not protected by the same-origin policy.**

**Proposed #560 Origin-only contract — pending Thomas's finished-spec read:** Before either
mounted route returns `101`, the request `Host` must identify exactly one configured app
origin, including its port. Every handshake that resolves a session, regardless of whether
the credential arrived in a cookie or an explicit header, must carry exactly one
non-`null` `Origin`, equal to that host's complete configured origin (scheme, host and
port). A missing, literal `null`, malformed, duplicated or comma-list, foreign, or
other-portal `Origin`, and an unknown or mismatched `Host`, return `403` before upgrade.
Compare against the configured public origin, including when TLS terminates at a proxy;
HTTP CORS and origin values derived from the request URL or forwarding headers do not
replace this check.
The session's stored `portal` must also match the request host under the separate portal
boundary in [auth-and-identity.md](auth-and-identity.md#sessions); this paragraph does not
close that unfinished part of #560.

**Proposed credential classification for review:** Only a request that resolves a valid
API key, with no session, may omit `Origin`. This includes the existing explicit
`x-api-key` and `Authorization: Bearer` API-key paths. If that request supplies `Origin`,
it must still be the single exact configured origin for its `Host`. An explicit bearer
token that resolves a session is subject to the session Origin and stored-portal rules,
even though HTTP CSRF treats bearer credentials as non-ambient. An invalid explicit
credential returns `401` without falling back to an accompanying cookie. With the
currently pinned better-auth configuration, `bearer()` is removed and a bare session
token in `Authorization: Bearer` does not resolve a session; it must receive `401`, not
an Origin exemption. This proposal does not enable that transport or introduce a query
credential, portal parameter, route or capability. The session-carrier rule and API-key
exception require Thomas's review; the HTTP CSRF rule in
[security-model.md](security-model.md#sessions-csrf-and-step-up) does not by itself settle
WebSocket handshake policy.

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
"next request", the decision is not made once: the server subscribes to the identity-cache
invalidation channel and **drops affected topics the moment a membership or role changes**,
and every subscription is re-checked every 60 s as a floor. Inbound frames are
Zod-validated; topics are parsed into a discriminated union, never prefix-matched; `user:`
topics are asserted against the session identity; `instance` requires `instance:admin` on
every re-check. Subscribe frames are rate-limited per socket. Broadcast is not a way around
policy.

## Topics

| Topic | Who subscribes | Carries |
| --- | --- | --- |
| `user:{personId}` | Every connected client, own id only | Notifications, assignment to you, approval requests |
| `project:{projectId}` | Anyone viewing a project surface | Work item create/update/delete/move, comments, state changes |
| `work_item:{key}` | Anyone with a work item open | Comments, activity, approvals, attachments |
| `instance` | Instance admins | Plugin config changes, job failures, import progress (`import.chunk_completed`) |

## Messages

```jsonc
{
  "type": "work_item.updated",
  "topic": "project:abc",
  "actorId": "usr_…",           // so the originator can ignore their own echo
  "at": "2026-09-05T10:14:22Z",
  "payload": { "key": "SUP-1234", "changed": ["state_id", "assignee_id"] }
}
```

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
    if (msg.actorId === me.id) return;              // ignore own echo
    queryClient.invalidateQueries({ queryKey: ['work-items', projectId] });
    if (msg.payload.key) {
      queryClient.invalidateQueries({ queryKey: ['work-item', msg.payload.key] });
    }
  },
});
```

Invalidation is debounced at 150 ms so a bulk update produces one refetch, not fifty.

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

### The control plane is a separate channel

User-facing topics travel on `taskdesk:ws`. **Replica coordination** — `auth.reload`,
`plugin.reload`, `flags.reload`, identity-cache invalidation — travels on `taskdesk:control`
and is never exposed to a browser. Pub/sub is an accelerator, not the source of truth: every
replica also polls the relevant `config_version` every 10 s, so a deployment with no Valkey
converges within the poll interval rather than silently diverging
([auth-runtime-reconfiguration.md](auth-runtime-reconfiguration.md)).

## Connection management

| Concern | Handling |
| --- | --- |
| Reconnect | Exponential backoff, 1 s → 30 s, with jitter |
| Missed messages | On reconnect the client refetches active queries. No replay buffer — the REST API is always the source of truth |
| Heartbeat | Ping every 30 s; a socket missing two pongs is closed |
| Backpressure | Per-connection queue capped at 100; overflow closes the socket and the client reconnects and refetches |
| Idle | Sockets with no subscriptions closed after 5 minutes |
| Limits | 5 concurrent sockets per person; 50 topic subscriptions per socket |
| Session revoked | The socket is closed immediately when its session is invalidated |
| Permission revoked | Affected topics are dropped on the invalidation message; the client is told which and refetches |
| Subscribe flood | Per-socket rate limit on inbound frames; a client exceeding it is closed |

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

If the WebSocket cannot connect — a proxy that strips upgrades, a hostile corporate
network — the client falls back to polling active queries every 30 seconds and shows a
small "live updates unavailable" indicator. The application remains fully usable.

## Testing

| Test | Asserts |
| --- | --- |
| `ws-auth.test.ts` | Upgrade without a valid credential is refused. On the pinned auth stack, an issued session token sent as `Authorization: Bearer` without its cookie returns `401` on both mounted Node routes; it does not become an API key or a newly supported bearer session |
| `ws-origin.test.ts` | For session-backed handshakes on both mounted Node routes: matching configured `Host` and one exact same-origin `Origin` can reach `101`; missing, `null`, malformed, duplicate/list, foreign and other-portal Origins, plus unknown or wrong-port Hosts, return `403` before `101`. This applies to every credential carrier that actually resolves a session. Use raw handshake headers for duplicate/list cases; HTTP CORS is not evidence |
| `ws-explicit-credential-origin.test.ts` | On both mounted Node routes, a valid explicit `x-api-key` and bearer API key without `Origin` retain access subject to existing reach policy; a supplied foreign Origin is refused. An invalid explicit bearer token or key with a valid cookie cannot fall back to that cookie. These proposed compatibility cases need the finished-spec decision |
| `ws-portal-session.test.ts` | Wrong-portal, unbound legacy, and revoked session rows never upgrade on either host; a valid session from each implemented portal succeeds with the matching host and Origin. This is the separate stored-session portion of #560, not evidence supplied by `ws-origin.test.ts` |
| `ws-subscribe-policy.test.ts` | Subscribing to an out-of-reach project is refused, indistinguishably from a non-existent one |
| `ws-reauthorize.test.ts` | Subscribe, revoke the membership, assert no further events arrive |
| `ws-frame-validation.test.ts` | Malformed frames and `user:` topics for another person are refused |
| `ws-fanout.test.ts` | Two clients, one mutation, both receive it once |
| `ws-valkey-adapter.test.ts` | Cross-replica delivery via a real Valkey container |
| E2E `realtime.spec.ts` | Two browser contexts on one board; a drag in one appears in the other |

## Related

- [Architecture overview](overview.md) · [Background jobs](background-jobs.md)
- [Notifications](../03-features/notifications.md)
