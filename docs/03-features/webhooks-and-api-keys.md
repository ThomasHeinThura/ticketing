# Webhooks and API keys

- **Stage:** P4
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
- `WH-15` **Creating a webhook is an elevated action**, and so is changing an existing one's
  `url`. A webhook is a standing outbound data channel: `data` carries work item titles,
  project and actor names and SLA state for every event in the owner's reach, to an endpoint
  the creator chooses, indefinitely. That is durable *exfiltration*, and it was cheaper to
  create than a workspace service key — which is elevated (`AK-7`) precisely because it is
  durable authority. A compromised staff session holding `webhook:manage` therefore no longer
  installs one without a second factor. `POST /api/webhooks` and `url`-changing
  `PATCH /api/webhooks/{id}` are on the single elevated list in
  [rbac.md](../01-architecture/rbac.md#elevated-and-audited-actions--the-single-list). A
  webhook owned by an identity with `sees_all` or `instance:admin` receives everything and
  therefore requires `instance:admin` to create, and is listed in the security-posture panel.

### SSRF protection

- `WH-9` The URL is resolved and checked against private, loopback, link-local and
  metadata ranges before connecting.
- `WH-10` It is **re-checked at connect time** against the address actually connected to,
  which is what defeats DNS rebinding. Resolving once and connecting later is the classic
  hole.
- `WH-11` Redirects are not followed to a different host.
- `WH-12` HTTPS only. The development allowlist that relaxes this exists **only** when
  `NODE_ENV=development`. The production egress allowlist is a different thing and cannot
  widen a webhook: it is default-empty, God Mode-configurable, audited as an elevated change,
  and usable **only** by `ai.*` plugins reaching a self-hosted model on a private address —
  `webhook`, `notify.*` and `import.*` may never target private, link-local or metadata ranges
  in production, and no allowlist entry makes them able to. Stated once in
  [security-model.md](../01-architecture/security-model.md#input-handling); this is a citation.

## API keys in

- `AK-1` Created per user under profile settings, or per workspace as a service key.
- `AK-2` Shown **once** at creation. Stored as an Argon2id hash with a visible prefix for
  identification.
- `AK-3` A **personal** key carries an explicit capability subset and **can never exceed its
  owner's current authority**: it is clamped against the owner's live capabilities on **every
  request**, so a demotion takes effect on the next call. This clamping rule is personal keys
  only — a service key is not a person and is evaluated differently (`AK-7`).
- `AK-4` Optional expiry, optional IP allowlist, per-key rate limit.
- `AK-5` Every request records last-used time and IP, so unused keys are visible and
  revocable.
- `AK-6` Revocation is immediate.
- `AK-7` A service key belongs to a workspace, not a person, so it survives that person
  leaving. Creating one requires `api_key:manage` **and is an elevated action**; its
  capability subset is **bounded by the creator's authority at creation** (evaluated
  against the expanded closure, like a role grant) and the exact set granted is written to
  the audit row. On use it is evaluated **against its own stored subset** — not against any
  person's current authority, because there may be no such person. A service key is never a
  way to hold more authority than the person who created it held at the time.

  **The two rules, side by side, so neither is guessed at:** a *personal* key is clamped to
  its owner's **current** authority on every request (`AK-3`); a *service* key is evaluated
  against its **stored** subset (`AK-7`). `service-key-cannot-exceed-creator.spec.ts` asserts
  the creation-time bound; a companion asserts that a demoted creator does not shrink an
  already-issued service key.

  **When the creator is deactivated the key keeps working** — that is the point of a service
  key, and breaking CI on an offboarding is worse than the alternative. What changes is who is
  accountable: **ownership transfers to the workspace administrators** (everyone holding
  `api_key:manage` in that workspace), the key is flagged for re-attestation, and its next
  edit or rotation is an **elevated admin action** rather than a self-service one. God Mode's
  key list shows it as "created by a former member, owned by workspace admins", so a durable
  credential with no live owner is visible rather than silent. A service key whose workspace is
  deleted is revoked with the workspace, in the same approved deletion.
- `AK-9` **Every personal key is read-only by default** — `is_mcp` or not. Write capabilities
  are an explicit opt-in at creation, shown with a warning
  ([mcp-server.md](mcp-server.md) `MC-15`). `is_mcp` adds only the MCP-specific ceilings: the
  stricter write rate limit (`instance_setting.mcp_write_ceiling_per_minute`, `MC-22`) and a
  `404` when `feature.mcp` is off.

  **`is_mcp` is self-declared at creation and is therefore not a security boundary.** The MCP
  server is a thin client over the public API configured with `TASKDESK_API_KEY`, and nothing
  in the protocol proves a request came from it — an ordinary personal key pasted into
  `@taskdesk/mcp` works. That is why the controls that actually matter — the read-only default
  and the explicit write opt-in — hang off **every** personal key, where the server can enforce
  them, rather than off the flag. The flag remains useful for the ceilings, the "Use with an AI
  agent" UX, the untrusted-content warning and the audit trail; it is not relied on to keep
  anyone out. *Decided 2026-09-06 (Claude Code, reversible).*
- `AK-10` **A service key can never be an MCP key** — `CHECK (NOT is_mcp OR person_id IS
  NOT NULL)`. An MCP key is always a personal key owned by a named human (`MC-20`, `MC-21`).
- `AK-12` **Renaming or removing a capability is a two-phase change, because capability names
  live in `api_key.capabilities` as strings** — in a service key's frozen creation-time subset
  most of all. Stage one adds the new name and keeps the old one as a recorded alias for one
  release while a data migration rewrites `role.capabilities` and `api_key.capabilities`; stage
  two drops the alias. An unrecognised capability string on a stored key is logged and treated
  as absent, never wildcard-expanded. The rule and its decision-log requirement live in
  [rbac.md](../01-architecture/rbac.md#capabilities).
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
GET    /api/webhooks                          { capability: 'webhook:manage', scope: 'workspace' }   (workspace from X-Workspace-Id)
POST   /api/webhooks                          { capability: 'webhook:manage', scope: 'workspace', elevated: true, sessionOnly: true }   (WH-15)
PATCH  /api/webhooks/{id}                     { capability: 'webhook:manage', scope: 'workspace' } — and elevated + session-only when the body changes `url` (WH-15)
DELETE /api/webhooks/{id}                     { capability: 'webhook:manage', scope: 'workspace', elevated: true, sessionOnly: true }   → 202 pending action from a browser session; 403 session_required from an API or MCP key
POST   /api/webhooks/{id}/test                { capability: 'webhook:manage', scope: 'workspace' }
POST   /api/webhooks/{id}/rotate-secret       { capability: 'webhook:manage', scope: 'workspace', elevated: true, sessionOnly: true }
GET    /api/webhooks/{id}/deliveries          { capability: 'webhook:manage', scope: 'workspace' }
POST   /api/webhooks/deliveries/{id}/redeliver { capability: 'webhook:manage', scope: 'workspace' }
GET    /api/me/api-keys                            { authenticated: true, self: true }        (personal keys)
POST   /api/me/api-keys                            { authenticated: true, self: true }        (personal key — read-only unless writes are ticked, AK-9)
DELETE /api/me/api-keys/{id}                       { authenticated: true, self: true, elevated: true, sessionOnly: true }   → 202 pending action (typed name + step-up); 403 session_required from a key
POST   /api/me/api-keys/{id}/revoke                { authenticated: true, self: true }        (immediate; not a deletion — AK-6)
GET    /api/workspaces/{id}/api-keys               { capability: 'api_key:manage', scope: 'workspace' }        (service keys)
POST   /api/workspaces/{id}/api-keys               { capability: 'api_key:manage', scope: 'workspace', elevated: true, sessionOnly: true }   (service key — bounded by the creator, AK-7)
DELETE /api/workspaces/{id}/api-keys/{keyId}       { capability: 'api_key:manage', scope: 'workspace', elevated: true, sessionOnly: true }   → 202 pending action (typed name + step-up); 403 session_required from a key
POST   /api/workspaces/{id}/api-keys/{keyId}/revoke { capability: 'api_key:manage', scope: 'workspace' }       (immediate)
```

Every line is literal registry syntax — one of the five policy kinds in
[rbac.md](../01-architecture/rbac.md#route-policies--the-anti-v1-mechanism), plus the optional
`elevated` / `sessionOnly` fields. `check:route-policy-syntax` parses these blocks, so a route
line that is not a policy fails the docs lint rather than being translated at the keyboard.

## Edge cases

| Case | Behaviour |
| --- | --- |
| Endpoint returns 200 slowly, every time | Ten-second timeout; slow deliveries are visible in history |
| Endpoint returns 301 to another host | Not followed. Recorded as a failure with the reason |
| Secret rotated mid-flight | Queued deliveries sign with the secret current at send time |
| Webhook created for an event later removed | Auto-disabled, owner notified |
| **Personal** key used after the owner is deactivated | Rejected. A personal key follows its owner's status |
| **Personal** key with capabilities the owner has since lost | Clamped to the owner's current authority on the next request (`AK-3`) |
| **Service** key whose creator is deactivated or demoted | Keeps working against its stored subset. Ownership transfers to the workspace administrators, it is flagged for re-attestation, and its next edit or rotation is an elevated admin action (`AK-7`) |
| Consumer replays an old event | Their responsibility; the timestamp header and event id enable idempotency, and this is documented |

## Testing

Integration: SSRF guard rejects private addresses at resolve **and** at connect; signature
verifies against a known vector; retry and dead-letter behaviour; a **personal** key cannot
exceed its owner's current authority (`AK-3`); a **service** key keeps its stored subset when
its creator is demoted or deactivated, and its ownership shows as transferred (`AK-7`); a new
personal key has no write capability until one is ticked (`AK-9`); creating a webhook without
step-up is refused (`WH-15`).

E2E: create a webhook, send a test, inspect the delivery, rotate the secret, redeliver.

## Related

- [Background jobs](../01-architecture/background-jobs.md) · [Security model](../01-architecture/security-model.md)
- [Automations](automations.md) · [MCP server](mcp-server.md)
