# Instance users API

The Instance Users API lets an instance administrator inspect accounts and carry out the
available account-lifecycle actions. The Users management screen is held for a later web
slice; this page documents the API that is available now and does not imply that the screen
has shipped.

## Directory access

An authenticated agent session with `instance:admin` can list accounts with
`GET /api/instance/users` and read one account with `GET /api/instance/users/{id}`. The list
supports cursor pagination and optional search and person filters. Responses contain an
allowlisted account summary. They do not contain passwords, API-key material, session ids,
IP addresses, user-agent values, raw roles, or suspension reasons.

Customer sessions, API keys, and authenticated users without instance administrator access
cannot use these routes.

## Deactivation

Deactivation is a two-step operation. An administrator sends an empty JSON object to
`POST /api/instance/users/{id}/deactivate`. The request does not change the account. It creates
a pending action that the same requester must approve from an authenticated agent session.
Approval requires the account's current email address and a fresh PA-15 step-up proof bound to
that pending action. The server rechecks the target and the administrator's current authority
before it executes.

The request is refused when the administrator targets their own account or when deactivation
would leave the instance without an active, unbanned administrator. A successful deactivation
disables the person's access while preserving the person and authored history. It ends the
configured memberships and revokes the person's current sessions and personal API keys.
Reactivation does not restore access that was retired by deactivation.

Pending actions are terminal when the requester loses the action's required access, explicitly
revokes the original credential, or deletes the linked account. Restoring the same credential
or access does not revive a terminal action. Ordinary session expiry alone leaves a pending
action available after the requester signs in again; routine expired-session cleanup does not
cancel it.

## Related routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/instance/users` | List accounts |
| `GET` | `/api/instance/users/{id}` | Read an account summary |
| `POST` | `/api/instance/users/{id}/suspend` | Suspend an account |
| `POST` | `/api/instance/users/{id}/unsuspend` | Clear a suspension |
| `POST` | `/api/instance/users/{id}/sign-out` | Revoke current target sessions |
| `POST` | `/api/instance/users/{id}/deactivate` | Create a pending deactivation action |

State-changing requests require a session CSRF token. The full authorization, confirmation,
and lifecycle rules are in the [God Mode specification](../../../docs/03-features/god-mode.md#users)
and the [pending actions contract](../../../docs/01-architecture/pending-actions.md).
