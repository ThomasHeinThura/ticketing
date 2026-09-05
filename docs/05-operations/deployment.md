# Deployment

Docker Compose behind Traefik. Same topology as v1, one fewer application container.

## Stack

| Service | Image | Purpose |
| --- | --- | --- |
| `traefik` | `traefik:v3` | TLS, routing by host, security headers |
| `taskdesk` | `taskdesk:{version}` | API + agent bundle + portal bundle + jobs |
| `postgres` | `postgres:18-alpine` | All primary data. Bumped from 16 — see [tech stack](../01-architecture/tech-stack.md) |
| `valkey` | `valkey/valkey:9-alpine` | Cache, pub/sub, rate limits |
| `seaweedfs` | `chrislusf/seaweedfs` | Default self-hosted object storage. **Not MinIO** — see [tech stack](../01-architecture/tech-stack.md) |
| `keycloak` | `keycloak:26` | **Optional.** Only if a deployment wants it |
| `mailpit` | `axllent/mailpit` | Local development only |

One application container instead of v1's four (core-api, bff, worker, frontend). See
[ADR 0002](../01-architecture/adr/0002-single-backend.md).

## Routing

```
                    ┌──────────┐
   ticket.<domain> ─┤          ├─► taskdesk : agent bundle
   portal.<domain> ─┤ Traefik  ├─► taskdesk : portal bundle
    files.<domain> ─┤          ├─► seaweedfs
                    └──────────┘
```

Traefik routes by `Host()`. The application selects which bundle to serve from the
`Host` header, and the portal boundary middleware rejects a mismatched session.

Attachments are served from a **third hostname**, so a successfully uploaded hostile file
cannot execute against the application origin.

## First run

The short path, on any machine with a shell and outbound HTTPS:

```bash
curl -fsSL https://get.taskdesk.dev | bash
```

See [One-line install](one-line-install.md) for what that actually does, its flags, its
trust model, and the offline alternative. It is a thin bootstrapper around exactly the
manual steps below — running it is never required, only shorter.

The manual path it wraps:

```bash
git clone <repo> && cd Ticketing.v2
cp deploy/.env.example .env
$EDITOR .env                          # domain, DB password, secrets
scripts/deploy.sh local
```

The script is **idempotent** — safe to re-run, and it never regenerates a secret that
already exists. Carried from v1, where this was one of the better decisions.

It:

1. Generates any missing secrets.
2. Generates a self-signed certificate (local only).
3. Starts Postgres, Valkey and SeaweedFS, and waits for health.
4. Starts the application, which applies migrations under an advisory lock.
5. Creates the bootstrap administrator from `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`.
6. Seeds demo data, if permitted.
7. **Probes the API** — signs in, lists projects — and fails loudly if it cannot.
8. Prints the URLs.

Step 7 is not optional. v1's script did this and it caught the "container started, nothing
actually works" class of failure that a `docker ps` check misses entirely.

Then: sign in at `https://ticket.localhost`, open God Mode, and configure everything else
through the UI. **No further environment variables.** See
[plugin architecture](../01-architecture/plugin-architecture.md).

## Compose files

| File | Purpose |
| --- | --- |
| `compose.yml` | Base — local development, ports published, no TLS |
| `compose.prod.yml` | Overlay — no published ports, Traefik labels, resource limits |
| `compose.uat.yml` | Overlay — as production, different hostnames |
| `compose.traefik.yml` | Local Traefik, so production labels can be tested locally |
| `compose.keycloak.yml` | Optional Keycloak |
| `compose.observability.yml` | Optional Prometheus, Grafana, Loki |

```bash
docker compose -f compose.yml -f compose.prod.yml up -d
```

Base plus overlay, never a separate full file per environment — that is how they drift.

## Resource sizing

For 100 concurrent users. Compare with v1's 17.5 cores and 11.0 GiB.

| Service | CPU limit | Memory limit | Reservation |
| --- | --- | --- | --- |
| `taskdesk` | 2.0 | 1536 M | 0.5 / 512 M |
| `postgres` | 2.0 | 2048 M | 0.5 / 512 M |
| `valkey` | 0.5 | 512 M | 0.1 / 64 M |
| `seaweedfs` | 0.5 | 512 M | 0.1 / 128 M |
| `traefik` | 0.5 | 256 M | 0.1 / 64 M |
| **Total** | **5.5** | **4.9 GiB** | |
| *+ Keycloak, if used* | *2.0* | *2560 M* | |

Roughly half of v1's footprint before Keycloak, and a third of it when Keycloak is not
deployed — which is now the default.

## Scaling

Horizontally, by replica count:

```yaml
taskdesk:
  deploy:
    replicas: 3
```

This requires `TASKDESK_VALKEY_URL` to be set, which switches the WebSocket adapter to
Valkey pub/sub. Job leasing already ensures each scheduled job runs once across the set.

Postgres is the vertical limit. Read replicas are a later problem, and one we would rather
have than pre-solve.

## Kubernetes

A Helm chart exists at `charts/taskdesk/`, inherited from kaneo. It is a **secondary**
path — supported, tested at each release, but Compose behind Traefik is the primary
target because that is what we and our customers actually run.

## Upgrades

```bash
docker compose pull
docker compose up -d
```

Migrations apply at start under an advisory lock, so concurrent replicas do not race. The
old container stops after the new one reports ready.

**Before any upgrade:** take a database backup and note the current digest, so rollback is
one command. See [backup and restore](backup-and-restore.md).

## Deploy targets

| Target | Notes |
| --- | --- |
| **One-line install** | `curl \| bash` onto plain Docker Compose — the default recommendation, see [One-line install](one-line-install.md) |
| **Dokploy** | v1's production path. Compose-managed with a UI |
| **Plain Docker Compose** | A host, Traefik, a systemd unit — what the one-liner sets up |
| **Kubernetes** | Helm chart, any conformant distribution (EKS, AKS, GKE, k3s, on-prem). Secondary to Compose+Traefik, meaning less-exercised by us day to day — not less supported. Tested every release |
| **Single-node** | Everything on one machine, filesystem storage plugin, no Valkey |
| **AWS Marketplace** | Container-product listing of the same image. See [AWS Marketplace listing](aws-marketplace.md) |

The single-node profile matters: it is what a small customer will run, and it must work
with no object store and no cache.

"Any environment" means: the same image, the same Helm chart and the same Compose files
work identically whether the target is a laptop, a customer's own Kubernetes cluster, a
bare host reached by SSH, or infrastructure procured through a cloud marketplace. Nothing
about the application differs by target — only how the container is scheduled and how TLS
is terminated differ, and both are infrastructure concerns, never application code.

## Health and readiness

| Endpoint | Semantics |
| --- | --- |
| `/api/health/live` | The process is up. **Touches no dependency** |
| `/api/health/ready` | Database reachable, migrations applied |
| `/api/health/deep` | Every dependency and plugin checked |

A liveness probe that fails when Postgres blips will restart a healthy container and turn a
brief outage into a long one. Hence the separation.

## Related

- [Environments](environments.md) · [Configuration reference](configuration-reference.md)
- [Traefik and domains](traefik-and-domains.md) · [Runbook](runbook.md)
- [One-line install](one-line-install.md) · [AWS Marketplace listing](aws-marketplace.md)
