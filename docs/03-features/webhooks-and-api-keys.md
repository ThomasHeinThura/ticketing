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

The deliverable events are the **W** column of the canonical catalogue in
[events.md](../01-architecture/events.md) — this document does not keep its own list. As of
2026-09-05 that is:

```
work_item.created         work_item.updated        work_item.transitioned
work_item.assigned        work_item.unassigned     work_item.commented
work_item.escalated       work_item.overdue        work_item.deleted
approval.requested        approval.decided         approval.expired
sla.at_risk               sla.breached             sla.met
submission.received       submission.accepted      submission.declined
submission.withdrawn      project.created          project.archived
prerequisite.overdue      budget.threshold_reached
```

`webhook.events[]` stores these keys; `EV-4` in the catalogue governs renames.

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
  days. **Payload bodies are shown only for deliveries whose referenced entity is in the
  reader's reach** — otherwise the row shows status, duration and error with the body
  redacted. Delivery history is not an export channel.
- `WH-7` A webhook failing continuously for 24 hours is auto-disabled and the owner is
  notified. It does not retry forever into a void.
- `WH-8` Redelivery of a specific event is available from the UI.
- `WH-13` Secret rotation keeps the previous secret valid for **24 hours**; deliveries in
  that window carry two signatures (`X-TaskDesk-Signature` and
  `X-TaskDesk-Signature-Previous`) so a consumer can roll over without a gap. "Rotate all
  webhook secrets" is a God Mode incident action.
- `WH-14` **A webhook delivers only events within its owner's reach.** A workspace webhook
  is stamped with the creator's identity; at delivery time the event's entity is checked
  against that identity's reach, and an out-of-reach event is skipped (recorded as
  `skipped_out_of_reach`, not failed). A webhook whose owner has `sees_all` or
  `instance:admin` therefore receives everything; a manager's webhook receives their
  projects. When the owner leaves, the webhook is **paused** and must be re-owned by
  someone with `webhook:manage` — it does not silently inherit anyone's reach. The same
  rule applies to the automation action "Call a webhook" ([automations.md](automations.md)),
  which runs as the rule's `effective_role_id`. `webhook-delivery-reach.test.ts`: a manager
  with membership in project A only never sees project B content via delivery or history.

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
  leaving. Creating one requires `api_key:manage` **and is an elevated action**; its
  capability subset is **bounded by the creator's authority at creation** (evaluated
  against the expanded closure, like a role grant) and the exact set granted is written to
  the audit row. On use it is evaluated against its own stored subset. A service key is
  never a way to hold more authority than the person who created it held at the time.
- `AK-9` Keys flagged `is_mcp` default to the **read** capabilities only; write
  capabilities are an explicit opt-in at creation, shown with a warning
  ([mcp-server.md](mcp-server.md) `MC-15`).
- `AK-10` **A service key can never be an MCP key** — `CHECK (NOT is_mcp OR person_id IS
  NOT NULL)`. An MCP key is always a personal key owned by a named human (`MC-20`, `MC-21`).
- `AK-11` Deleting an API key or a webhook is a **pending action** with typed exact name
  and step-up ([pending-actions.md](../01-architecture/pending-actions.md)); a service key
  cannot request any deletion (`PA-5`). Revocation (`AK-6`) is immediate and is not a
  deletion — the row stays for audit.
- `AK-8` Keys authenticate as `Authorization: Bearer tdk_…`.

## Permissions

| Action | Capability |
| --- | --- |
| Manage workspace webhooks | `webhook:manage` |
| See delivery history | `webhook:manage` |
| Create a personal API key | Self |
| Create a workspace service key | `api_key:manage` + elevated; bounded by the creator's authority |
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
GET    /api/me/api-keys                            authenticated + self        (personal keys)
POST   /api/me/api-keys                            authenticated + self        (personal key — clamped to the owner)
DELETE /api/me/api-keys/{id}                       authenticated + self  E     → 202 pending action (typed name + step-up)
POST   /api/me/api-keys/{id}/revoke                authenticated + self        (immediate; not a deletion — AK-6)
GET    /api/workspaces/{id}/api-keys               api_key:manage              (service keys)
POST   /api/workspaces/{id}/api-keys               api_key:manage  E           (service key — bounded by the creator, AK-7)
DELETE /api/workspaces/{id}/api-keys/{keyId}       api_key:manage  E           → 202 pending action (typed name + step-up)
POST   /api/workspaces/{id}/api-keys/{keyId}/revoke api_key:manage             (immediate)
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
