# Traefik and domains

Traefik v3 terminates TLS, routes by hostname and applies security headers. Carried from
v1, which had this right.

## Two hostnames, and sometimes a third

| Hostname | Serves | Why separate |
| --- | --- | --- |
| `ticket.<domain>` | Agent bundle + API + WebSocket | Staff |
| `portal.<domain>` | Portal bundle + portal API | Separate cookie scope, separate identity providers, no agent code |
| `files.<domain>` | Attachment downloads — **only when an operator-owned S3 endpoint is served behind this Traefik** (the `--profile s3` SeaweedFS service, or a Garage instance on the same host) | A hostile uploaded file executes against an origin with no application on it |

The first two are the subject of
[ADR 0004](../01-architecture/adr/0004-two-portals-two-origins.md). The third is a
straightforward containment measure — and a conditional one. A fresh install runs
`storage.filesystem` and has **two** hostnames; a deployment on real S3 or Azure Blob gets
its files origin from the provider. Only the middle case, where the operator runs the object
store themselves behind this proxy, produces a third record and the router below
([deployment.md](deployment.md)).

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
  - traefik.http.services.taskdesk.loadbalancer.healthcheck.path=/api/public/health/ready

  # files — on the storage container, not the application; only with --profile s3
  - traefik.http.routers.taskdesk-files.rule=Host(`files.${DOMAIN}`)
  - traefik.http.routers.taskdesk-files.tls.certresolver=letsencrypt
  - traefik.http.routers.taskdesk-files.middlewares=files-headers@file
  - traefik.http.services.taskdesk-files.loadbalancer.server.port=8333
```

`files-headers@file` adds `Content-Disposition: attachment` for anything not an image and a
restrictive `Content-Security-Policy: default-src 'none'; sandbox`. **On a real S3 backend
the files host is the bucket's own origin** and this router is not deployed: the files origin
comes from the storage plugin's configured public endpoint, read at runtime, and there is no
environment variable for it ([configuration-reference.md](configuration-reference.md)).

Two things this middleware does **not** do. It does not set the storage backend's CORS — a
presigned POST goes from the browser straight to the storage endpoint, so the **bucket's own**
CORS rules are what admit the agent and portal origins. And it does not affect signatures: a
URL presigned for the internal endpoint will not verify at `files.<domain>`, which is why the
plugin's configured public endpoint must equal the browser-facing one. Both are stated in
full in [deployment.md](deployment.md).

Both hostnames reach the same container. The application selects the bundle from the
`Host` header, and the portal boundary middleware rejects a session that does not match.

**The application port is never published in production.** Neither the base `compose.yml`
nor `deploy/compose.prod.yml` declares `ports:` on the `taskdesk` service; publishing 5173 is
the job of `deploy/compose.local.yml`, which production never loads. It has to be that way
round — Compose concatenates `ports:` across files, so an overlay can add a published port
but cannot remove one ([deployment.md](deployment.md)). In production, port 5173 is reachable
only on the Docker network Traefik shares with the container.

This is what makes `TASKDESK_TRUST_PROXY=1` safe: the only way a request can arrive is
through exactly one proxy hop, so `X-Forwarded-For` at that hop is the client and a forged
header is discarded. In the **shared-Traefik** pattern below the same rule holds — TaskDesk
attaches to the existing proxy network and publishes nothing — and `install.sh` refuses a
`--env production` install if it finds 5173 already bound on the host
([one-line-install.md](one-line-install.md)). Locally, 5173 being bound is the expected
state, so the check does not apply.

**One hop is the count for this arrangement, not a default to carry elsewhere.** Where a CDN
or load balancer sits in front of Traefik there are two appending hops and the value is `2`.
The count is measured — send a request with a deliberately wrong `X-Forwarded-For` and read
what arrives — never inferred from the number of boxes in the diagram. Method and results:
[proxy-topology-evidence.md](proxy-topology-evidence.md).

## TLS

Everything in this section describes Traefik terminating TLS itself, which is
what `deploy/compose.prod.yml` and `deploy/compose.local.yml` configure. **It is
not true of every host we run.** Where a CDN or load balancer sits in front,
TLS terminates there and Traefik receives plain HTTP on its `web` entrypoint —
no certificate resolver runs, an ACME challenge is never answered, and a
`websecure` router is never matched. The bimats.com UAT host is exactly that
shape (CloudFront in front), and `deploy/compose.uat.yml` therefore routes on
`web` with no `certresolver`. Which shape you are in is a measurement, not a
preference: [proxy-topology-evidence.md](proxy-topology-evidence.md).

- Let's Encrypt via the ACME HTTP-01 challenge, or DNS-01 where a wildcard is wanted.
- TLS 1.2 minimum; 1.3 preferred.
- HSTS on every response, so plain HTTP is never accepted after the first visit.
  `includeSubDomains` and `preload` are the operator's opt-in — see below.
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
to know the configured storage origin, which is runtime configuration. The policy itself —
per origin, with the nonce strategy and the report-only rollout — is written out in
[security-model.md](../01-architecture/security-model.md).

`preload` on `Strict-Transport-Security` is only meaningful once the **apex** domain is
submitted to the browser preload list, and `includeSubDomains` on an apex that also serves
unrelated services is a footgun. Both are **opt-in for the operator**, through
`TASKDESK_HSTS_PRELOAD` in `deploy/.env` — a Compose-only switch that selects which headers
middleware the routers use. The application never reads it; it is one of the variables listed
under "Variables the application does not read" in
[configuration-reference.md](configuration-reference.md). The header block above shows the
opted-in form; the default omits both directives.

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
127.0.0.1  ticket.localhost portal.localhost
```

Add `files.localhost` too when running the `s3` profile locally.

`scripts/deploy.sh local` prints this. The self-signed root certificate is generated once
into `deploy/local/certs/` and can be trusted in the OS keychain to stop browser warnings.

## DNS

| Record | Type | Target |
| --- | --- | --- |
| `ticket.<domain>` | A / AAAA | Host |
| `portal.<domain>` | A / AAAA | Host |
| `files.<domain>` | A / AAAA | Host — **only when the files router is deployed** |

Or one wildcard `*.<domain>` with DNS-01 certificate issuance, which is simpler to operate
and is the recommended approach when the domain permits it.

`install.sh` checks the third record only when `--files-host` is in play; on a
`storage.filesystem` install it is not created and not checked
([one-line-install.md](one-line-install.md)).

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
| Redirect loop | `TASKDESK_TRUST_PROXY=0` behind TLS termination — set it to the real hop count (`1` for the shipped compose). **Or**: TLS terminates at a CDN in front of Traefik, so `X-Forwarded-Proto` arriving at the application says `http` even though the viewer used HTTPS. Raising the hop count does not fix that one; fixing it means setting the header at the CDN ([proxy-topology-evidence.md](proxy-topology-evidence.md)) |
| Every request rate-limited as one client | `TASKDESK_TRUST_PROXY` too low — the proxy's address is being read as the client |
| A forged `X-Forwarded-For` moves the rate-limit bucket | `TASKDESK_TRUST_PROXY` too **high**, or the application port is published so the proxy can be bypassed entirely |

## Related

- [Deployment](deployment.md) · [Environments](environments.md)
- [Proxy topology evidence](proxy-topology-evidence.md) — how the trusted-hop count is measured, and what it measured here
- [Security model](../01-architecture/security-model.md) · [Runbook](runbook.md)
