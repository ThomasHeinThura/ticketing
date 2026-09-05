# Traefik and domains

Traefik v3 terminates TLS, routes by hostname and applies security headers. Carried from
v1, which had this right.

## Three hostnames

| Hostname | Serves | Why separate |
| --- | --- | --- |
| `ticket.<domain>` | Agent bundle + API + WebSocket | Staff |
| `portal.<domain>` | Portal bundle + portal API | Separate cookie scope, separate identity providers, no agent code |
| `files.<domain>` | Attachment downloads (SeaweedFS / S3) | A hostile uploaded file executes against an origin with no application on it |

The first two are the subject of
[ADR 0004](../01-architecture/adr/0004-two-portals-two-origins.md). The third is a
straightforward containment measure.

## Routing

```yaml
labels:
  # agent
  - traefik.http.routers.taskdesk-agent.rule=Host(`ticket.${DOMAIN}`)
  - traefik.http.routers.taskdesk-agent.tls.certresolver=letsencrypt
  - traefik.http.routers.taskdesk-agent.middlewares=security-headers@file,compress@file

  # portal
  - traefik.http.routers.taskdesk-portal.rule=Host(`portal.${DOMAIN}`)
  - traefik.http.routers.taskdesk-portal.tls.certresolver=letsencrypt
  - traefik.http.routers.taskdesk-portal.middlewares=security-headers@file,compress@file

  - traefik.http.services.taskdesk.loadbalancer.server.port=5173
  - traefik.http.services.taskdesk.loadbalancer.healthcheck.path=/api/health/ready
```

Both hostnames reach the same container. The application selects the bundle from the
`Host` header, and the portal boundary middleware rejects a session that does not match.

## TLS

- Let's Encrypt via the ACME HTTP-01 challenge, or DNS-01 where a wildcard is wanted.
- TLS 1.2 minimum; 1.3 preferred.
- HSTS with `preload`, so plain HTTP is never accepted after the first visit.
- Certificates are auto-renewed. Expiry inside 14 days raises an alert — a certificate
  that quietly failed to renew is a classic Sunday-morning outage.

## Security headers

Applied by a file-provider middleware so they are declared once and cannot drift between
routers.

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
Cross-Origin-Opener-Policy: same-origin
X-Frame-Options: DENY
```

Content-Security-Policy is set by the application rather than by Traefik, because it needs
to know the configured storage origin, which is runtime configuration.

## WebSocket

Traefik forwards upgrades without configuration. What does need attention:

- Idle timeout above the application's 30-second heartbeat, or connections are culled
  mid-conversation.
- Sticky sessions are **not** required — the Valkey adapter handles cross-replica fan-out.

## Rate limiting

A first line at the edge, above the application's own per-identity limits:

```yaml
rateLimit:
  average: 100      # requests per second per source
  burst: 200
```

The edge limit is crude and protects the process. The application's limits are
identity-aware and enforce policy. Both are wanted.

## Local development

Local Traefik with a self-signed certificate, so the production label configuration is
exercised rather than being first tested in UAT.

`*.localhost` resolves to `127.0.0.1` in most browsers. Where it does not, add:

```
127.0.0.1  ticket.localhost portal.localhost files.localhost
```

`scripts/deploy.sh local` prints this. The self-signed root certificate is generated once
into `deploy/local/certs/` and can be trusted in the OS keychain to stop browser warnings.

## DNS

| Record | Type | Target |
| --- | --- | --- |
| `ticket.<domain>` | A / AAAA | Host |
| `portal.<domain>` | A / AAAA | Host |
| `files.<domain>` | A / AAAA | Host |

Or one wildcard `*.<domain>` with DNS-01 certificate issuance, which is simpler to operate
and is the recommended approach when the domain permits it.

## Shared Traefik

Where Traefik already exists on the host serving other applications — v1's arrangement —
TaskDesk attaches to the existing network and contributes only its labels. The
`compose.prod.yml` overlay assumes this and declares the network as external.

## Failure modes

| Symptom | Usual cause |
| --- | --- |
| 404 from Traefik | Router rule does not match; check `DOMAIN` and the labels |
| 502 | Container unhealthy or wrong service port |
| Certificate not issued | HTTP-01 blocked, or DNS not yet propagated |
| WebSocket disconnects every 60 s | Traefik idle timeout below the heartbeat |
| Portal shows the agent application | `Host` header not forwarded, or `TASKDESK_PORTAL_URL` mismatched |
| Redirect loop | `TASKDESK_TRUST_PROXY` unset behind TLS termination |

## Related

- [Deployment](deployment.md) · [Environments](environments.md)
- [Security model](../01-architecture/security-model.md) · [Runbook](runbook.md)
