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
interface AuthHolder {
  current(): BetterAuth;                 // what /auth/* and the session middleware use
  configVersion(): number;               // the instance_plugin_config.config_version it was built from
  reload(reason: string): Promise<void>; // build → validate → swap, or keep the old one
}
```

`/auth/*` is mounted **once**, as `(c) => holder.current().handler(c.req.raw)`. The mount
never changes; only what `current()` returns does.

## Build → validate → swap

```
1. read every enabled auth.* row from instance_plugin_config, plus the instance session policy
2. construct a NEW better-auth instance from them           ← may throw
3. validate: run each provider's discovery against its cached document; assert auth.password present
4. swap: holder.current = new instance; holder.configVersion = max(config_version)
5. log + metric: taskdesk_auth_reload_total{outcome}, taskdesk_auth_config_version
```

- **Construction or validation throwing keeps the previous instance.** The failure is
  logged with the offending plugin id, surfaced in God Mode → Health, and the `test()` that
  the administrator ran before saving is what should have caught it. The system never
  ends up with *no* auth instance.
- **Swap is a pointer assignment** — atomic in JavaScript. In-flight requests holding a
  reference to the old instance finish on it.
- **What survives a swap, by construction:** the session table (both instances read the
  same rows through the same Drizzle adapter), `TASKDESK_AUTH_SECRET` (identical input),
  cookie names and attributes (derived from the request host, not from configuration), the
  rate-limit store (shared Valkey / in-memory reference passed in, not re-created). A
  reload never signs anyone out.
- **What does not survive, deliberately:** an OAuth authorisation flow started against a
  provider that was *disabled* by the change fails at the callback with a clear message
  and an audit row. Flows against unchanged providers complete, because their
  configuration is identical in the new instance.
- `auth.password` cannot be disabled ([plugin-architecture.md](plugin-architecture.md)); the
  validate step refuses a configuration without it.

## Propagation to replicas

A God Mode save writes the `instance_plugin_config` row (bumping `config_version`) and
then publishes `auth.reload` on the `taskdesk:control` Valkey channel
([realtime.md](realtime.md)). Every replica's subscriber calls `holder.reload()`.

**Pub/sub is an accelerator, not the source of truth.** Every replica also polls
`max(config_version) where plugin_id like 'auth.%'` every **10 seconds** and reloads when it
differs from `holder.configVersion()`. A deployment with no Valkey converges within 10 s;
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
| `auth-cookie-per-host.test.ts` | Agent and portal hosts issue different cookie names; `session.portal` is set and enforced |

## Related

- [Auth and identity](auth-and-identity.md) · [Plugin architecture](plugin-architecture.md) · [Realtime](realtime.md)
- [ADR 0003](adr/0003-better-auth-primary.md) · [ADR 0006](adr/0006-plugin-registry.md)
