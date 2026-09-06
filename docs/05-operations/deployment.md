# Deployment

Docker Compose behind Traefik. Same topology as v1, one fewer application container.

## Stack

| Service | Image | Purpose |
| --- | --- | --- |
| `traefik` | `traefik:v3` | TLS, routing by host, security headers |
| `taskdesk` | `ghcr.io/<org>/taskdesk:<version>` | API + agent bundle + portal bundle + jobs. Verified against its cosign signature before start |
| `postgres` | `postgres:18-alpine` | All primary data. Bumped from 16 — see [tech stack](../01-architecture/tech-stack.md) |
| `valkey` | `valkey/valkey:9-alpine` | Cache, pub/sub, rate limits |
| `seaweedfs` | `chrislusf/seaweedfs:<pinned>` | **Opt-in, `--profile s3`.** Self-hosted object storage for a deployment that wants `storage.s3` — or `dxflrs/garage` for one that prefers it; both speak the same S3 API. **Not MinIO** — see [tech stack](../01-architecture/tech-stack.md) |
| `keycloak` | `quay.io/keycloak/keycloak:26.7` | **Optional.** Only if a deployment wants it. (There is no Docker Hub `keycloak` image) |
| `mailpit` | `axllent/mailpit:<pinned>` | Local development only |

**A fresh install runs the first four services and nothing else.** The active storage plugin
is `storage.filesystem` — attachment bytes on a named Docker volume, no credentials, no
bucket, no third hostname ([decision log](../07-planning/decision-log.md)). Object storage is
a choice an administrator makes later, from God Mode.

**Every third-party image is pinned to a tag in `compose.yml`, never `latest`** — the same
rule [release-plan.md](../07-planning/release-plan.md) applies to our own image. Renovate
bumps the pins.

One application container instead of v1's four (core-api, bff, worker, frontend). See
[ADR 0002](../01-architecture/adr/0002-single-backend.md).

## Routing

```
                    ┌──────────┐
   ticket.<domain> ─┤          ├─► taskdesk : agent bundle
   portal.<domain> ─┤ Traefik  ├─► taskdesk : portal bundle
    files.<domain> ─┤          ├─► seaweedfs        (only with --profile s3)
                    └──────────┘
```

Traefik routes by `Host()`. The application selects which bundle to serve from the
`Host` header, and the portal boundary middleware rejects a mismatched session.

The **third hostname exists only when an operator-owned S3 endpoint is served behind this
Traefik** — the `--profile s3` stack, or a Garage instance on the same host. On the shipped
`storage.filesystem` install there is no files router and no third DNS record; on a real S3
or Azure bucket the files origin is the provider's, and this Traefik never sees it. Where the
separate origin does exist, a successfully uploaded hostile file executes against an origin
with no application on it, which is the whole point of it
([storage and attachments](../01-architecture/storage-and-attachments.md)).

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
3. Starts Postgres and Valkey — plus SeaweedFS and its bucket-create step when
   `--profile s3` is in play — and waits for health.
4. Starts the application, which applies migrations under an advisory lock.
5. Prints the one-time **setup URL** (agent origin + the token from the container log) at
   which the first administrator is created — or, for headless installs, creates it from
   `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`.
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
| `compose.yml` | Base — at the repository root. Services, images, volumes, networks. **Publishes no application port** |
| `deploy/compose.local.yml` | Overlay — local development: publishes 5173, no TLS, Mailpit |
| `deploy/compose.prod.yml` | Overlay — Traefik labels, resource limits, external proxy network |
| `deploy/compose.uat.yml` | Overlay — as production, different hostnames, and the bimats.com host's real topology: CloudFront terminates TLS, so the routers use the plain `web` entrypoint with no certificate resolver ([proxy topology evidence](proxy-topology-evidence.md)) |
| `deploy/compose.traefik.yml` | Local Traefik, so production labels can be tested locally |
| `deploy/compose.keycloak.yml` | Optional Keycloak |
| `deploy/compose.observability.yml` | Optional Prometheus, Grafana, Loki |

```bash
# production
docker compose -f compose.yml -f deploy/compose.prod.yml up -d --wait

# local development — this is the overlay that publishes the port
docker compose -f compose.yml -f deploy/compose.local.yml up -d --wait
```

**The port lives in the local overlay, not in the base file, and this is deliberate.**
Compose *concatenates* `ports:` across files — an overlay can add a published port but
cannot take one away — so a base file that published 5173 would publish it in production
too, and the "never published" premise that `TASKDESK_TRUST_PROXY=1` rests on
([traefik-and-domains.md](traefik-and-domains.md)) would be false. `scripts/deploy.sh
production` asserts it: `docker compose port taskdesk 5173` must fail, and the deploy stops
if it succeeds.

These are the paths; every command in [environments.md](environments.md),
[one-line-install.md](one-line-install.md) and the [runbook](runbook.md) uses them.

Base plus overlay, never a separate full file per environment — that is how they drift.

## Object storage, when it is wanted

`storage.filesystem` needs none of this. For a deployment that wants an S3 API on the same
host, the `s3` profile carries a service that can actually start — SeaweedFS is not a
single-process S3 server by default, and a bare `chrislusf/seaweedfs` container listening on
8333 is a container that does nothing:

```yaml
seaweedfs:
  image: chrislusf/seaweedfs:<pinned>
  profiles: [s3]
  command: >
    server -dir=/data -s3 -s3.port=8333
    -s3.config=/etc/seaweedfs/s3.json
    -master.volumeSizeLimitMB=1024
  volumes:
    - seaweedfs-data:/data
    - ./deploy/seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:8333/status"]
    interval: 15s
    timeout: 3s
    retries: 10
```

`s3.json` holds a static access key and secret, generated once by `scripts/deploy.sh` and
written with `0600`. The script also runs the **bucket-create step** after the health check
passes — a bucket that does not exist yet is the first presign's failure, not the first
upload's.

**The storage plugin's configured public endpoint must equal the browser-facing origin.** An
S3 SigV4 signature covers the `Host` header, so a URL presigned for the internal
`seaweedfs:8333` endpoint does not verify when the browser fetches it at
`https://files.<domain>`; the plugin's public endpoint is what goes into the signature.
For the same reason the **bucket's own CORS** — not a Traefik middleware — must allow
exactly the two portal origins, because a presigned POST is a cross-origin request from the
agent or portal page straight to the storage endpoint. Both are stated once here and cited
elsewhere.

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
| *− SeaweedFS, on the shipped filesystem storage* | *−0.5* | *−512 M* | |
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
Valkey pub/sub and makes rate limits shared rather than per-replica. Job leasing ensures
each scheduled job runs once across the set; `TASKDESK_ROLE=web` on the request-serving
replicas and `TASKDESK_ROLE=jobs` on one dedicated replica separates the two workloads
when event-loop lag says it is time ([scaling.md](scaling.md)).

Postgres is the vertical limit. Read replicas are a later problem, and one we would rather
have than pre-solve.

## Kubernetes

A Helm chart lives at `charts/taskdesk/`. It is **derived from kaneo's chart but
substantially rewritten**. kaneo also ships a single combined image — nginx serving the web
bundle next to the node API, one entrypoint starting both, one Deployment behind one
hostname. The difference is what the image does: TaskDesk serves **both** bundles from the
Node process, selected by `Host` header, with no nginx, so the chart needs three Ingress
hosts, a `TASKDESK_ROLE` split across two Deployments and a values contract of its own —
[kubernetes.md](kubernetes.md). Compose behind Traefik remains the primary target because
that is what we and our customers actually run; the chart is linted, templated and
packaged in CI from P2 and is the artefact the [AWS Marketplace listing](aws-marketplace.md)
validates in P7.

## Upgrades

```bash
scripts/deploy.sh upgrade            # verify the cosign signature → pull → up -d --wait
```

**The signature check is the point.** The stack table promises the image is verified against
its cosign signature before start, and [ci-cd.md](../04-engineering/ci-cd.md) signs it
against an exact workflow identity; a bare `docker compose pull` verifies nothing and
silently drops that control. The raw commands below are the **no-verification fallback**,
for a host that cannot reach the transparency log — label it as such when you use it:

```bash
docker compose pull                  # no signature verification
docker compose up -d --wait
```

Migrations apply at start under an advisory lock, so concurrent replicas do not race
([migrations.md](../04-engineering/migrations.md)).

**Be honest about downtime.** Plain Compose does not do health-gated replacement: on a
single-replica stack `up -d` stops the old container, then starts the new one — expect a
short outage per upgrade (typically under a minute, longer if a migration is heavy), and
plan the window. `--wait` makes the command block until the new container is healthy so a
failed start is loud. With `replicas: 2+` behind Traefik, a scale-up/scale-down sequence
gives a rolling upgrade; genuine zero-downtime rolling updates are the Kubernetes path.

**Before any upgrade:** take a database backup and note the current digest, so rollback is
one command — `scripts/deploy.sh rollback <digest>`, which verifies the signature on the way
back down too ([runbook](runbook.md)). See [backup and restore](backup-and-restore.md).

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
| `/api/public/health/live` | The process is up. **Touches no dependency**. Anonymous |
| `/api/public/health/ready` | Database reachable, migrations applied. Anonymous |
| `/api/instance/health/deep` | Every dependency and plugin checked. Needs an `instance:admin` session — the metrics bearer token does not grant it — it enumerates dependencies ([observability.md](../01-architecture/observability.md)) |

A liveness probe that fails when Postgres blips will restart a healthy container and turn a
brief outage into a long one. Hence the separation.

## Related

- [Environments](environments.md) · [Configuration reference](configuration-reference.md)
- [Traefik and domains](traefik-and-domains.md) · [Proxy topology evidence](proxy-topology-evidence.md) · [Runbook](runbook.md)
- [One-line install](one-line-install.md) · [AWS Marketplace listing](aws-marketplace.md)
