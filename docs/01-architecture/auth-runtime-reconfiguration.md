# Auth runtime reconfiguration

How an administrator adds, changes or disables an identity provider in God Mode and every
replica picks it up within seconds, without a restart and without locking anyone out.
[ADR 0006](adr/0006-plugin-registry.md) calls this "the most delicate code in the system";
this document is its design. Written 2026-09-05 after the
[planning review](../07-planning/review-2026-09-05.md) found it specified in three
sentences across three documents.

## The problem

better-auth is constructed once, from a configuration object, and exposes a request
handler. Providers, cookie settings, plugins and the database adapter are all construction
inputs. Runtime provider changes therefore mean **constructing a new instance** and routing
requests to it — while requests are in flight, while OAuth flows are mid-redirect, and on
every replica, some of which may have no Valkey.

## The holder

```ts
// apps/api/src/auth/holder.ts
type Portal = 'agent' | 'customer';

interface AuthHolder {
  current(portal: Portal): BetterAuth;   // what /auth/* and the session middleware use
  configVersion(): number;               // greatest config_version it was built from — see below
  reload(reason: string): Promise<void>; // build → validate → swap, or keep the old pair
}
```

**Two instances, not one.** better-auth derives cookie names, `baseURL` and
`trustedOrigins` from *construction-time* configuration, so a single instance cannot issue
`__Host-tdk_agent_session` on one host and `__Host-tdk_portal_session` on another. Each
reload therefore constructs **a pair** — one instance per portal origin — and `current()`
takes the portal, resolved from the request host. Everything below happens to both members
of the pair, atomically: they are built together, validated together, and swapped together.
Decided 2026-09-06 (Claude Code, reversible); the cookie names and the reasoning are in
[auth-and-identity.md § Sessions](auth-and-identity.md#sessions).

`/auth/*` is mounted **once**, as
`(c) => holder.current(portalOf(c.req)).handler(c.req.raw)`. The mount never changes; only
what `current()` returns does.

## Build → validate → swap

```
1. read every enabled auth.* row from instance_plugin_config
   AND every enabled identity_connection            ← the OIDC connections live here
   plus the instance session policy
2. split the connections by portal_scope, and derive per portal:
   baseURL (that portal's origin), trustedOrigins (that origin only),
   cookie names (__Host-tdk_agent_session / __Host-tdk_portal_session),
   exact-match redirect URIs (built from that baseURL)
3. construct a NEW better-auth instance PER PORTAL from them   ← may throw
4. validate: run each provider's discovery against its cached document;
   assert auth.password present; assert each connection's resolved issuer is
   tenant-specific (IP-26)
5. swap: both instances at once; holder.configVersion = greatest(
       max(instance_plugin_config.config_version) where plugin_id like 'auth.%',
       max(identity_connection.config_version))
6. log + metric: taskdesk_auth_reload_total{outcome}, taskdesk_auth_config_version
```

Step 1 reads **both** tables because an OIDC connection is an `identity_connection` row,
not an `instance_plugin_config` row ([identity-provisioning.md](../03-features/identity-provisioning.md),
[data-model.md](data-model.md) §2). Reading only the latter would mean a God Mode change to
an Entra connection — the flagship P3 flow — never reached any replica without a restart.

- **Construction or validation throwing keeps the previous instance.** The failure is
  logged with the offending plugin id, surfaced in God Mode → Health, and the `test()` that
  the administrator ran before saving is what should have caught it. The system never
  ends up with *no* auth instance.
- **Swap is a pointer assignment** — atomic in JavaScript — and it assigns the *pair*, so a
  request can never land on a new agent instance and an old portal one. In-flight requests
  holding a reference to an old instance finish on it.
- **What survives a swap, by construction:** the session table (every instance reads the
  same rows through the same Drizzle adapter), `TASKDESK_AUTH_SECRET` (identical input),
  the **cookie names** and attributes, each instance's **`baseURL`** and **`trustedOrigins`**
  (all four derived from the two portal origins, which are deployment facts and not
  administrator-editable configuration), and the rate-limit store (shared Valkey /
  in-memory reference passed in, not re-created). A reload never signs anyone out.
  Redirect URIs are **recomputed** from `baseURL` on every reload, which is why they are
  listed here: they are identical across a swap unless the origins themselves changed.
- **What does not survive, deliberately:** an OAuth authorisation flow started against a
  provider that was *disabled* by the change fails at the callback with a clear message
  and an audit row. Flows against unchanged providers complete, because their
  configuration is identical in the new instance.
- `auth.password` cannot be disabled ([plugin-architecture.md](plugin-architecture.md)); the
  validate step refuses a configuration without it.

## Propagation to replicas

A God Mode save writes the `instance_plugin_config` row **or the `identity_connection` row**
(bumping that row's `config_version`) and then publishes `auth.reload` on the
`taskdesk:control` Valkey channel ([realtime.md](realtime.md)). Every replica's subscriber
calls `holder.reload()`. Adding, editing, disabling or deleting an identity connection
publishes on the same channel — `identity_connection.changed` ([events.md](events.md)) is
the event; `auth.reload` is the control message.

**Pub/sub is an accelerator, not the source of truth.** Every replica also polls
`greatest(max(instance_plugin_config.config_version) where plugin_id like 'auth.%',
max(identity_connection.config_version))` every **10 seconds** and reloads when it
differs from `holder.configVersion()`. Both maxima are in the polled value, so a connection
change converges on exactly the same terms as a plugin change. A deployment with no Valkey converges within 10 s;
a deployment with Valkey converges within a second and the poll is a no-op. No replica can
silently run a stale configuration for longer than the poll interval — which is the
property the two-replica-no-Valkey case previously lacked.

The same `taskdesk:control` channel and the same poll-fallback pattern carry
`plugin.reload` and `flags.reload`.

## Elevated action

Changing an `auth.*` row is on the single elevated-actions list in [rbac.md](rbac.md):
re-authentication within five minutes, and an audit row recording which keys changed —
never values.

## Break-glass

If a reload leaves administrators locked out despite the rules above (a provider that
passed `test()` but rejects real logins), `auth.password` is still enabled by construction,
and the CLI (`node dist/cli.js disable-auth-plugin <id>`, [runbook](../05-operations/runbook.md))
flips a row and bumps `config_version`, which the poll picks up within 10 s.

## Tests — the list ADR 0003 promised

| Test | Asserts |
| --- | --- |
| `auth-reload-swaps-atomically.test.ts` | A request started before the swap completes on the old instance; the next starts on the new |
| `auth-reload-keeps-sessions.test.ts` | A session issued before the reload is valid after it |
| `auth-reload-rollback-on-throw.test.ts` | A provider config that throws at construction leaves `current()` unchanged and Health degraded |
| `auth-reload-refuses-no-password.test.ts` | A configuration with `auth.password` disabled is rejected at validate |
| `auth-reload-poll-fallback.test.ts` | With no Valkey, a second replica converges within the poll interval |
| `auth-reload-disabled-provider-callback.test.ts` | A callback for a provider disabled mid-flow fails clearly and is audited |
| `auth-cookie-per-host.test.ts` | Agent and portal hosts issue `__Host-tdk_agent_session` and `__Host-tdk_portal_session` respectively, from the two constructed instances; `session.portal` is set and enforced |
| `auth-reload-on-identity-connection-change.test.ts` | A **newly added** `identity_connection` is usable without a restart, and a **disabled** customer connection stops issuing sessions on `portal.<domain>` — on a replica that learned of the change only from the poll |
| `auth-reload-recomputes-redirect-uris.test.ts` | After a swap, each instance's `trustedOrigins` holds only its own portal origin and its redirect URIs are rebuilt from its `baseURL`; a callback presented to the wrong instance is refused |

`03-portal-isolation-both-directions.test.ts`
([identity-provisioning.md](../03-features/identity-provisioning.md)) covers the portal
boundary at the *session* level. It does not cover reload, and these do not cover the
boundary — neither suite may be assumed to cover the other.

## Related

- [Auth and identity](auth-and-identity.md) · [Plugin architecture](plugin-architecture.md) · [Realtime](realtime.md)
- [ADR 0003](adr/0003-better-auth-primary.md) · [ADR 0006](adr/0006-plugin-registry.md)
