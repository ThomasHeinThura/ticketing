# Realtime

Two people looking at the same board must see each other's changes without refreshing.
That is the whole requirement, and it should not cost a message broker.

## Transport

WebSocket at `/ws`, via `@hono/node-ws`, on the same origin as the API so the session
cookie authenticates the upgrade. **Cookie-authenticated upgrades are not protected by the
same-origin policy**, so the handler also requires the `Origin` header to equal the
configured origin for the request host and the session's `portal` to match it — otherwise
403 before the upgrade. This is a security control, not polish
([security-model.md](security-model.md)).

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
| `instance` | Instance admins | Plugin config changes, job failures |

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

## Presence and typing (Phase 4)

Presence — who else is on this work item — is stored in Valkey with a short TTL and
broadcast on the topic. If Valkey is absent, presence is simply unavailable; it is not a
correctness feature.

Typing indicators in comment threads follow the same pattern, throttled to one message
every 3 seconds per person.

## Collaborative editing — explicitly later

Plane runs Hocuspocus for CRDT-backed collaborative rich text. It is genuinely nice and it
is genuinely a whole subsystem: a second server process, Y.js documents, awareness state,
persistence and conflict resolution.

**Not in scope before Phase 5.** Until then, concurrent edits to a description are handled
with optimistic concurrency: a `409` and a clear "someone else changed this" affordance.
Revisit when there is evidence people actually co-edit descriptions.

## Fallback

If the WebSocket cannot connect — a proxy that strips upgrades, a hostile corporate
network — the client falls back to polling active queries every 30 seconds and shows a
small "live updates unavailable" indicator. The application remains fully usable.

## Testing

| Test | Asserts |
| --- | --- |
| `ws-auth.test.ts` | Upgrade without a session is refused |
| `ws-origin.test.ts` | Upgrade with a foreign `Origin`, or a portal session on the agent host, is refused |
| `ws-subscribe-policy.test.ts` | Subscribing to an out-of-reach project is refused, indistinguishably from a non-existent one |
| `ws-reauthorize.test.ts` | Subscribe, revoke the membership, assert no further events arrive |
| `ws-frame-validation.test.ts` | Malformed frames and `user:` topics for another person are refused |
| `ws-fanout.test.ts` | Two clients, one mutation, both receive it once |
| `ws-valkey-adapter.test.ts` | Cross-replica delivery via a real Valkey container |
| E2E `realtime.spec.ts` | Two browser contexts on one board; a drag in one appears in the other |

## Related

- [Architecture overview](overview.md) · [Background jobs](background-jobs.md)
- [Notifications](../03-features/notifications.md)
