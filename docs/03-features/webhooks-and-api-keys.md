# Webhooks and API keys

- **Phase:** P4
- **Status:** ⬜
- **Feature flag:** always on
- **Depends on:** plugin architecture, background jobs, RBAC

## Purpose

Let other systems react to what happens here, and let other systems act here.

The realistic integration story is not a bespoke connector per tool. It is: **a signed
webhook out, an authenticated API in**, and let Power Automate, n8n, Zapier or a script do
the rest.

## Webhooks out

### Events

```
work_item.created         work_item.updated        work_item.transitioned
work_item.assigned        work_item.commented      work_item.deleted
approval.requested        approval.decided         approval.expired
sla.at_risk               sla.breached             sla.met
submission.received       submission.accepted      submission.declined
project.created           project.archived
prerequisite.overdue
```

### Envelope

```jsonc
{
  "id": "evt_01J8XQ…",              // unique; use for idempotency
  "event": "sla.breached",
  "occurredAt": "2026-09-05T10:14:22Z",
  "instance": "https://ticket.example.com",
  "actor": { "id": "usr_…", "name": "Jane Smith" },   // null for system
  "data": {
    "workItem": { "key": "SUP-1234", "title": "Printer offline",
                  "url": "https://ticket.example.com/agent/work-items/SUP-1234" },
    "project":  { "key": "SUP", "name": "Contoso Support" },
    "sla":      { "metric": "resolution", "dueAt": "…", "breachedBy": 45 }
  }
}
```

Stable and self-describing. `data` always carries a `url`, because the first thing anyone
does with a webhook is build a link back.

### Delivery

- `WH-1` Signed with HMAC-SHA256 over the raw body, in `X-TaskDesk-Signature`, using a
  per-webhook secret. The secret is rotatable and never returned by the API.
- `WH-2` Also sent: `X-TaskDesk-Event`, `X-TaskDesk-Delivery`, `X-TaskDesk-Timestamp`.
  Consumers should reject timestamps older than five minutes to prevent replay.
- `WH-3` Written to `outbox` **in the same transaction as the change**, then delivered by
  `outbox-drain`. Never fire-and-forget.
- `WH-4` Retry with exponential backoff: 30 s, 2 m, 10 m, 1 h, 6 h, 24 h. Dead after six
  attempts.
- `WH-5` Ten-second timeout. Only `2xx` is success.
- `WH-6` Delivery history is visible per webhook: status code, duration, error, payload.
  An administrator must be able to see that their endpoint has been returning 500 for two
  days.
- `WH-7` A webhook failing continuously for 24 hours is auto-disabled and the owner is
  notified. It does not retry forever into a void.
- `WH-8` Redelivery of a specific event is available from the UI.

### SSRF protection

- `WH-9` The URL is resolved and checked against private, loopback, link-local and
  metadata ranges before connecting.
- `WH-10` It is **re-checked at connect time** against the address actually connected to,
  which is what defeats DNS rebinding. Resolving once and connecting later is the classic
  hole.
- `WH-11` Redirects are not followed to a different host.
- `WH-12` HTTPS only, except for explicitly allowlisted hosts in development.

## API keys in

- `AK-1` Created per user under profile settings, or per workspace as a service key.
- `AK-2` Shown **once** at creation. Stored as an Argon2id hash with a visible prefix for
  identification.
- `AK-3` A key carries an explicit capability subset and **can never exceed its owner's
  authority**. If the owner is demoted, the key is clamped on the next request.
- `AK-4` Optional expiry, optional IP allowlist, per-key rate limit.
- `AK-5` Every request records last-used time and IP, so unused keys are visible and
  revocable.
- `AK-6` Revocation is immediate.
- `AK-7` A service key belongs to a workspace, not a person, so it survives that person
  leaving. Creating one requires `api_key:manage`.
- `AK-8` Keys authenticate as `Authorization: Bearer tdk_…`.

## Permissions

| Action | Capability |
| --- | --- |
| Manage workspace webhooks | `webhook:manage` |
| See delivery history | `webhook:manage` |
| Create a personal API key | Self |
| Create a workspace service key | `api_key:manage` |
| Revoke anyone's key | `api_key:manage` |

## Screens

Webhook list with health indicator; webhook editor with event selection, secret rotation
and a **Send test event** button; delivery history with payload inspection and redelivery.

API key list showing prefix, scope, last used and expiry; creation dialog that displays the
key once with an explicit "copy it now, you will not see it again".

## API

```
GET    /api/webhooks                          webhook:manage
POST   /api/webhooks                          webhook:manage
PATCH  /api/webhooks/{id}                     webhook:manage
DELETE /api/webhooks/{id}                     webhook:manage
POST   /api/webhooks/{id}/test                webhook:manage
POST   /api/webhooks/{id}/rotate-secret       webhook:manage + re-auth
GET    /api/webhooks/{id}/deliveries          webhook:manage
POST   /api/webhooks/deliveries/{id}/redeliver webhook:manage
GET    /api/api-keys                          (self) | api_key:manage
POST   /api/api-keys                          (self) | api_key:manage
DELETE /api/api-keys/{id}                     (self) | api_key:manage
```

## Edge cases

| Case | Behaviour |
| --- | --- |
| Endpoint returns 200 slowly, every time | Ten-second timeout; slow deliveries are visible in history |
| Endpoint returns 301 to another host | Not followed. Recorded as a failure with the reason |
| Secret rotated mid-flight | Queued deliveries sign with the secret current at send time |
| Webhook created for an event later removed | Auto-disabled, owner notified |
| API key used after the owner is deactivated | Rejected. The key follows the owner's status |
| Key with capabilities the owner has since lost | Clamped to the owner's current authority |
| Consumer replays an old event | Their responsibility; the timestamp header and event id enable idempotency, and this is documented |

## Testing

Integration: SSRF guard rejects private addresses at resolve **and** at connect; signature
verifies against a known vector; retry and dead-letter behaviour; an API key cannot exceed
its owner's authority.

E2E: create a webhook, send a test, inspect the delivery, rotate the secret, redeliver.

## Related

- [Background jobs](../01-architecture/background-jobs.md) · [Security model](../01-architecture/security-model.md)
- [Automations](automations.md) · [MCP server](mcp-server.md)
