# Operations and distribution contracts

This maintained reference states deployment, recovery, distribution and data-protection requirements. It is not evidence that a command, image, chart, hosted endpoint, backup, proxy chain or marketplace listing is implemented or accepted. Current Thomas instructions and recorded owner decisions take precedence: laptop SIT first, then verified Technexus cloud SIT; one coordinated worktree; local implementation feedback; one consolidated independent phase review. Preserve existing branch protections and publication verification.

One shipping application image, persisted runtime customer configuration, original Kaneo interfaces and tenant/security controls remain required. Shared registries and safety details live in [configuration](configuration.md), [safety/runtime](safety-and-runtime.md), [permissions](permissions.md), [data model](data-model.md), [events](events.md), [jobs](background-jobs.md) and [release gates](ci-gates.md). Examples do not grant permission to deploy, erase data or execute a migration repair.

Historical observed evidence is separated from requirements: old proxy captures, installer checksums, environment availability, rendered chart status, test claims and deadline estimates are not current evidence. Version-specific migration safeguards remain applicable only at their named frontier. Test/check commands describe required validation, not passing results.

## Contents

- [backup-and-restore](#backup-and-restore)
- [container-image](#container-image)
- [deployment](#deployment)
- [environments](#environments)
- [kubernetes](#kubernetes)
- [data-protection](#data-protection)
- [one-line-install](#one-line-install)
- [proxy-topology-evidence](#proxy-topology-evidence)
- [runbook](#runbook)
- [scaling](#scaling)
- [traefik-and-domains](#traefik-and-domains)
- [aws-marketplace](#aws-marketplace)

<a id="backup-and-restore"></a>
## Backup and restore
Backups require actual restore verification.

<a id="backup-and-restore-what-must-be-backed-up"></a>
### What must be backed up

| | Contains | Criticality |
| --- | --- | --- |
| **PostgreSQL** | Everything: work items, users, **and all runtime configuration** | Total loss |
| **The attachment volume** | Attachment bytes on the shipped `storage.filesystem` backend — a named Docker volume, not a bucket | Serious loss |
| **Object storage** | Attachment bytes, when `storage.s3` is the active plugin instead | Serious loss |
| **`.env`** | `TASKDESK_ENCRYPTION_KEY`, `TASKDESK_AUTH_SECRET` — and `TASKDESK_ENCRYPTION_KEY_PREVIOUS` whenever a rotation window is open | Without the key, every configured integration must be re-entered |

The last is easy to forget and is the one that ruins a restore. **Configuration is data**
— identity providers, SMTP, storage, branding, feature flags, roles all live in Postgres,
and their secrets are encrypted with a key that lives only in `.env`.

The second and third are alternatives, not both: which one applies is whichever storage
plugin the instance is actually running. A fresh install is `filesystem`, so **the default
thing to back up is a Docker volume** — and `rclone sync` to a bucket does not see it.

**During a key rotation, back up both keys.** Rotation is incremental
([runbook](#runbook)), so for the length of the window a dump legitimately contains rows
under either `key_id` and needs `TASKDESK_ENCRYPTION_KEY` *and*
`TASKDESK_ENCRYPTION_KEY_PREVIOUS` to restore. A dump taken mid-rotation and restored with
only the new key decrypts about half of your plugin secrets.

Store the encryption keys in a password manager, separately from the backups.

<a id="backup-and-restore-schedule"></a>
### Schedule

| | Frequency | Retention | Location |
| --- | --- | --- | --- |
| Postgres, production | Hourly | 48 hourly, 30 daily, 12 monthly | Local + offsite |
| Postgres, UAT | Daily | 7 daily | Local |
| Attachments — volume or bucket | Daily incremental | 30 days | Offsite |
| Secrets | On change | Versioned | Password manager |

Offsite is not optional. A backup on the same host survives a bad migration and nothing
else.

<a id="backup-and-restore-method"></a>
### Method

**Postgres** — `pg_dump -Fc`, compressed, checksummed, encrypted at rest.

```bash
scripts/backup.sh              # local dump, verification, attachment archive and checksums
```

For an isolated restore drill, use `--project-name <name>` on both backup and restore.
Both scripts resolve the named volume actually mounted at `/app/data` on that project's
existing application container. They refuse a missing/ambiguous container or a bind mount;
they never fall back to the default SIT volume. Restore resolves its target before stopping
anything. A scratch stack must already exist before restore. Start it with base Compose plus
`deploy/compose.restore-drill.yml` and an explicit non-default `-p <name>`; it has its own
internal network with no outbound route, no host ports and no proxy discovery. Restored
notification and webhook settings therefore cannot contact external destinations. Restore it with
`scripts/restore.sh --backup <dir> --confirm --mode isolated --project-name <name>`.
Do not use the local or production proxy overlays for a scratch drill.

A local archive/checksum alone does not establish encryption, offsite upload, retention or a `backup_run` record. Each remains a required independent result. Keep encryption keys separately as described below.

The script verifies the dump is restorable — `pg_restore --list` at minimum — before
uploading. A dump that cannot be listed will not restore, and finding that out during an
incident is the worst possible time.

**The attachment volume** (`storage.filesystem`, the shipped default) — `restic backup` of
the volume's mount point, or `tar` of it into the same offsite location as the dumps, taken
from a short-lived container that mounts it read-only. It is ordinary files on a Docker
volume, so nothing S3-shaped applies to it.

**Object storage** (`storage.s3`) — `rclone sync` (or `aws s3 sync`) incremental to a second
bucket in a different location. Backend-neutral; works for SeaweedFS, Garage and real S3
alike. *(Not `mc` — that is the MinIO client, and MinIO is the dependency the stack
dropped.)*

Every successful run — database, objects, WAL — writes a `backup_run` row
([data model](data-model.md)), which is how God Mode → Health knows
whether a backup has happened.

**Both together** — the two must be restorable to a *consistent* point.

<a id="backup-and-restore-restore"></a>
### Restore

Order matters.

```
1. Stop the application (leave Postgres running)
2. Restore Postgres
3. Restore object storage forward-only to the same point
4. Restore .env if the encryption key was lost
5. Start the application; migrations apply
6. Verify
```

**Why this order:** a database restored to yesterday alongside today's bucket shows
attachments the database does not know about, which is harmless. The reverse shows rows
whose objects are missing, which is not.

```bash
scripts/restore.sh --backup 2026-09-05T10-00 --confirm
```

<a id="backup-and-restore-verify-a-restore"></a>
### Verify a restore

Not a glance. A checklist:

- [ ] Sign in
- [ ] Open a project and a work item
- [ ] Download an attachment
- [ ] **God Mode → Health: every dependency green**
- [ ] **God Mode → Authentication: providers present and their secrets decrypt**
- [ ] **God Mode → Notifications: send a test email**
- [ ] **God Mode → Storage: test write succeeds**
- [ ] Feature flags as expected
- [ ] Roles and their capabilities intact
- [ ] Audit log present
- [ ] Row counts within expectation

The three items a naive restore test misses — **Health green**, **authentication secrets
decrypt** (sign in through a configured OIDC provider), and **a notification channel test
send succeeds** — are precisely what breaks when the encryption key was not restored.

<a id="backup-and-restore-monthly-restore-drill"></a>
### Monthly restore drill

**Restore to a scratch environment, monthly, and record the result.**

A backup you have never restored is a hypothesis. The drill produces a written record:
date, backup used, time taken, checklist outcome, problems found.

The drill copies production data — every organisation's tickets, the audit log's PII,
password and API-key hashes — so the scratch environment is not exempt from controls:

- It runs **behind the same access controls as production** (no public hostname, the
  operator's network only, TLS), or against a dump anonymised by `scripts/anonymise-dump.sh`
  (names, emails and free text replaced; structure and counts preserved) when the drill
  does not need to exercise sign-in.
- It is **destroyed within 24 hours**, and the destruction is part of the written record.
- The backup archive itself is encrypted with a key (`age` recipient or a KMS key) held
  **separately** from `TASKDESK_ENCRYPTION_KEY` and from the database credentials — a
  backup should not be readable by the person who can already read the database.
- The offsite target uses **write-only / append-only credentials** (S3 object lock or an
  IAM policy with `PutObject` and no `DeleteObject`), so a compromised host cannot delete
  the backups the disaster table depends on.
- `scripts/restore.sh` is run by the operator, never from inside the application, and the
  restore is recorded in the runbook log and — once the restored instance is up — as an
  `instance.restored` audit row.

A prior drill is not evidence for a different source, image, data set or restore target.

<a id="backup-and-restore-recovery-objectives"></a>
### Recovery objectives

| | Target |
| --- | --- |
| RPO — data we can afford to lose | 1 hour |
| RTO — time to restore service | 4 hours |
| RTO, single-node with local backup | 1 hour |

These drive the hourly schedule. If the business needs a lower RPO, that means continuous
archiving (WAL shipping), which is a decision to take deliberately rather than to drift
into.

<a id="backup-and-restore-point-in-time-recovery"></a>
### Point-in-time recovery

For production, WAL archiving gives recovery to any instant rather than to the last hourly
dump. Recommended once the instance carries real customer data.

```
archive_mode = on
archive_command = 'scripts/archive-wal.sh %p %f'
```

This changes RPO from one hour to seconds, at the cost of more storage and more operational
surface.

<a id="backup-and-restore-disaster-scenarios"></a>
### Disaster scenarios

| Scenario | Response |
| --- | --- |
| Bad migration | Restore the pre-upgrade backup. **Migrations are forward-only**, so rolling back the image alone does not undo the schema — this is why destructive migrations are two-phase |
| Accidental deletion by a user | Soft delete gives a 30-day window; no restore needed |
| Accidental deletion of a workspace | Restore to a scratch instance, export the affected rows, re-import |
| Host lost | Provision a new host, restore both stores, repoint DNS |
| Object storage lost | Restore the bucket; the database is unaffected |
| **Encryption key lost** | Data survives. **Every plugin secret must be re-entered by hand.** This is the scenario the password manager exists to prevent |
| Ransomware | Offsite, immutable backups. Retention beyond the likely dwell time |

<a id="backup-and-restore-customer-instances"></a>
### Customer instances

Customers running their own instance are responsible for their own backups. We ship
`scripts/backup.sh` and `scripts/restore.sh`, document them in the user documentation, and
**God Mode → Health warns when no backup has been recorded in 48 hours**.

That warning matters. Most self-hosters do not set up backups, and a warning in the
product is more effective than a paragraph in a manual.

<a id="container-image"></a>
## Container image
One image serves the API, the agent bundle, the portal bundle, the scheduler and the CLI.
This is its distribution contract; [CI/release gates](ci-gates.md) define the protected build path.

The image includes `apps/api/dist/seed-sit-users.js`, bundled with the application build
and using the installed production dependencies. `scripts/deploy.sh local` invokes it
inside the application container; the explicit `--sit` argument is required. It is never
invoked by normal application startup or production deployment.

<a id="container-image-stages"></a>
### Stages

```dockerfile
FROM node:24.22.1-trixie-slim AS base          # glibc: pg, sharp and native addons build cleanly; alpine is an option later
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/*/package.json packages/          # one line per package in practice
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm turbo build --filter=@taskdesk/api --filter=@taskdesk/web
#   api: esbuild --bundle --platform=node --packages=external → apps/api/dist/{index,cli}.js
#   web: vite build ×2 → apps/web/dist/agent, apps/web/dist/portal
RUN pnpm deploy --filter=@taskdesk/api --prod /out/api   # pruned production node_modules

FROM node:24.22.1-trixie-slim AS runtime
RUN groupadd -r taskdesk && useradd -r -g taskdesk -d /app taskdesk
WORKDIR /app
COPY --from=build --chown=taskdesk:taskdesk /out/api ./
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/api/dist ./dist
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/api/drizzle ./drizzle
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/web/dist ./public
COPY --chown=taskdesk:taskdesk deploy/entrypoint.sh NOTICE ./
USER taskdesk
ENV NODE_ENV=production TASKDESK_PORT=5173
EXPOSE 5173
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s \
  CMD ["node", "/app/healthcheck.mjs"]
ENTRYPOINT ["./entrypoint.sh"]
LABEL org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_TIME org.opencontainers.image.source=https://github.com/<org>/taskdesk \
      org.opencontainers.image.licenses=AGPL-3.0
```

<a id="container-image-entrypoint"></a>
### Entrypoint

```
1. validate the five required environment variables; exit 1 with a clear message if absent
2. if TASKDESK_ROLE = migrate: take the migration advisory lock, run migrations,
   create/repair the application role and its grants, release, exit 0   (migrations.md)
3. otherwise (TASKDESK_ROLE = web | jobs | all): refuse to start if the owner/migration
   credential is present in this process's own environment at all; refuse to start if the
   application connection turns out to be a superuser or owns anything (migrations.md,
   issue #296)
4. `web` and `all` start the HTTP/API and WebSocket listeners plus the metrics listener;
   `jobs` starts no HTTP, WebSocket, or metrics listener, but initializes the adapter for
   outbox and control-message publishing
5. `jobs` and `all` start the general scheduler and manual-run worker; `web` does not
6. `web` and `all` run the minute-cadence customer-invitation delivery poller. Its keys are
   held only in that process and are destroyed on shutdown; general jobs replicas cannot
   claim its rows
7. readiness true on HTTP-serving roles
```

Step 2 and step 3 never both run in the same process: migrations and the database role/grant bootstrap run in a
separate, one-shot `TASKDESK_ROLE=migrate` invocation of this same image — run once
before the serving process starts, never inside it. In compose that is the `migrate`
service; in Kubernetes (the Helm chart) it is an initContainer on the same Pod. A
single-container deployment with no orchestrator support for either shape runs the image
twice: once with `TASKDESK_ROLE=migrate` and the owner URL, then normally with the
application URL only — see [configuration-reference.md](configuration.md)'s
Local development section for the exact two commands.

`HEALTHCHECK` uses `/api/public/health/live` on `web` and `all`, and a fixed Unix socket at
`/tmp/taskdesk-liveness.sock` on `jobs`. Both checks report process liveness only and touch
no dependency, so a Postgres blip never restarts a healthy container; readiness is the load
balancer's concern. Jobs liveness accepts `ping\n` and returns the fixed `pong\n` response
within the 1.5-second probe deadline; it does not expose an API, WebSocket, or metrics
listener.

The image copies `deploy/healthcheck.mjs` directly to `/app/healthcheck.mjs` and invokes
the existing Node runtime. This removes the Wget package without introducing an
unproduced build entry. Serving roles use fixed loopback HTTP, the configured application
port and a 1.5-second deadline; only HTTP 200 succeeds. Jobs uses the fixed local Unix
socket and ping response above. Invalid ports, redirects, connection errors and timeouts
fail quietly. The exact copied file and endpoint behavior are tested; final image health
is also checked by `up -d --wait`
([deployment.md](#deployment)).

Migrations run in the isolated migration invocation before serving, under an advisory lock; the ordering and two-phase
rule for destructive changes are in
[migrations.md](design-and-decisions.md#migrations) and are not restated here.

<a id="container-image-the-cli"></a>
### The CLI

`dist/cli.js` is a second esbuild entry from `apps/api/src/cli.ts`, sharing the API's
modules. Commands are in the [runbook](#runbook). Because it needs the database URL and
the encryption key, it runs **inside the container** (`docker compose exec taskdesk node
dist/cli.js …`), never against the database from elsewhere.

<a id="container-image-native-dependencies"></a>
### Native dependencies

`esbuild --packages=external` leaves `pg` and any native addon to `node_modules`, which
`pnpm deploy --prod` prunes correctly. If `sharp` (image thumbnails) is adopted, it is the
one package that needs the glibc base — which is why the base is `trixie-slim`, not
alpine, until measured otherwise.

<a id="container-image-multi-arch-signing-size"></a>
### Multi-arch, signing, size

- `docker buildx build --platform linux/amd64,linux/arm64`, pushed by digest.
- Signed with cosign (keyless) and attested with build provenance
  ([ci-cd.md](ci-gates.md) step 8); the same identity signs the release
  archive ([one-line-install.md](#one-line-install)).
- Trivy gate: high/critical **with a fix available** fails the release (`ignore-unfixed:
  true`, decision log 2026-09-27 — a finding with no vendor fix yet doesn't block). Target
  size under 250 MB compressed; the
  `check:bundle-size` budget applies to the web bundles separately.

<a id="container-image-traceability"></a>
### Traceability

The three OCI labels identify the commit and the signed digest of any image. The running
process is traced through them (`docker inspect`), not through the application:
`GET /api/public/health/live` is a dependency-free liveness probe that returns only
`{"status":"ok"}`.

<a id="deployment"></a>
## Deployment
Docker Compose behind Traefik. Same topology as v1, one fewer application container.

<a id="deployment-stack"></a>
### Stack

| Service | Image | Purpose |
| --- | --- | --- |
| `traefik` | `traefik:v3` | TLS, routing by host, security headers |
| `taskdesk` | `ghcr.io/<org>/taskdesk:<version>` | API + agent bundle + portal bundle + jobs. Verified against its cosign signature before start |
| `postgres` | `postgres:18-alpine` | All primary data. Bumped from 16 — see [tech stack](architecture-and-experience.md#tech-stack) |
| `valkey` | `valkey/valkey:9-alpine` | Cache, pub/sub, rate limits |
| `seaweedfs` | `chrislusf/seaweedfs:<pinned>` | **Opt-in, `--profile s3`.** Self-hosted object storage for a deployment that wants `storage.s3` — or `dxflrs/garage` for one that prefers it; both speak the same S3 API. **Not MinIO** — see [tech stack](architecture-and-experience.md#tech-stack) |
| `keycloak` | `quay.io/keycloak/keycloak:26.7` | **Optional.** Only if a deployment wants it. (There is no Docker Hub `keycloak` image) |
| `mailpit` | `axllent/mailpit:<pinned>` | Optional local test inbox; sender configuration is separate |

**A fresh install runs the first four services and nothing else.** The active storage plugin
is `storage.filesystem` — attachment bytes on a named Docker volume, no credentials, no
bucket, no third hostname ([decision log](retained-constraints.md#decision-log)). Object storage is
a choice an administrator makes later, from God Mode.

**Every third-party image is pinned to a tag in `compose.yml`, never `latest`** — the same
rule [release-plan.md](retained-constraints.md#release-plan) applies to our own image. Renovate
bumps the pins.

One application container instead of v1's four (core-api, bff, worker, frontend). See
[ADR 0002](design-and-decisions.md#0002-single-backend).

<a id="deployment-routing"></a>
### Routing

```
                    ┌──────────┐
   ticket.<domain> ─┤          ├─► taskdesk : agent bundle
   portal.<domain> ─┤ Traefik  ├─► taskdesk : portal bundle
    files.<domain> ─┤          ├─► seaweedfs        (only with --profile s3)
                    └──────────┘

   docs.<domain> is a planned, separately implemented static service; it is not part of
   the four-service application fresh-install topology.
```

Traefik routes by `Host()`. The application selects which bundle to serve from the
`Host` header, and the portal boundary middleware rejects a mismatched session.

The **third hostname exists only when an operator-owned S3 endpoint is served behind this
Traefik** — the `--profile s3` stack, or a Garage instance on the same host. On the shipped
`storage.filesystem` install there is no files router and no third DNS record; on a real S3
or Azure bucket the files origin is the provider's, and this Traefik never sees it. Where the
separate origin does exist, a successfully uploaded hostile file executes against an origin
with no application on it, which is the whole point of it
([storage and attachments](safety-and-runtime.md#storage-and-attachments)).

<a id="deployment-independent-documentation-service-contract"></a>
<a id="deployment-planned-documentation-service-not-implemented"></a>
### Independent documentation service contract

The public docs site has its own `docs.<domain>` origin and static image, separate from the
`taskdesk` application image and from the conditional files origin. The target image is
`nginxinc/nginx-unprivileged:1.30.5-alpine3.24@sha256:ed04ec1ff34502c339ee5c3ae3f855442398edc1d05591e2b98981dcbbd20b1e`, subject to digest/platform verification at implementation. It serves only exported static `out/` files on port 8080 as non-root, returns a real 404 for unknown paths, and probes a static `/healthz`. It joins the proxy network only; production publishes no host port.

The router and docs service are added to local and production overlays separately. Add a UAT route only after confirming its CloudFront-to-Traefik path and web entrypoint. Build, scan, generate an SBOM, sign and publish the separate image from protected-main release automation; CI does not deploy it. A changed docs digest must trigger its own UAT pull, which verifies the signature and expected workflow identity before pulling the immutable digest and updating only the docs service. The existing app-image updater does not deploy the docs image. Verify docs container health, HTTPS through the confirmed proxy path, search against a published page and a genuine 404 for an unknown path. Retain the prior known-good docs digest for rollback without changing the application image. Production promotion manually pins the independently verified immutable docs digest after UAT verification. These are target requirements, not evidence that a docs updater, image, service, router, hostname or deployment exists. See the [docs-site contract](architecture-and-experience.md#plan).

<a id="deployment-first-run"></a>
### First run

The short path, on any machine with a shell and outbound HTTPS:

```bash
curl -fsSL https://get.taskdesk.dev | bash
```

See [One-line install](#one-line-install) for what that actually does, its flags, its
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
already exists. Existing deployment secrets and data are preserved.

Local deployment runs the bundled SIT seed inside the healthy application container with
`node apps/api/dist/seed-sit-users.js --sit --credentials-file <container /tmp path>`. No host Node/pnpm installation or published
database port is required. A seed failure fails deployment. The seed creates the four
interactive test accounts, turns intake and the customer portal on for the SIT workspace
(both default off, so a fresh install's catalogue would otherwise be empty), two published
customer request forms and two real submissions (one private, one organisation-visible).
The generated passwords are copied to `~/.taskdesk/sit-credentials.json` (0600) and removed
from the container. Re-running preserves existing submissions and
their triage progress. Production, upgrade and rollback never run this seed.

It:

1. Generates any missing secrets.
2. Generates a self-signed certificate (local only).
3. Starts Postgres and Valkey — plus SeaweedFS and its bucket-create step when
   `--profile s3` is in play — and waits for health.
4. Runs the one-shot `migrate` service (`TASKDESK_ROLE=migrate`), which applies
   migrations under an advisory lock and creates/repairs the non-superuser application
   role and its grants — the only step that ever uses the owner/migration credential
   (issue #296, S1). Then starts the application itself, which connects only as that
   application role and refuses to start if it can ever reach the owner credential or
   turns out to be privileged.
5. Prints the one-time **setup URL** (agent origin + the token from the container log) at
   which the first administrator is created — or, for headless installs, creates it from
   `TASKDESK_BOOTSTRAP_ADMIN_EMAIL`.
6. Seeds demo data, if permitted.
7. **Probes the API** — signs in, lists projects — and fails loudly if it cannot.
8. Prints the URLs.

Step 7 is mandatory: a running container is not evidence that the application works.

Then: sign in at `https://ticket.localhost`, open God Mode, and configure everything else
through the UI. **No further environment variables.** See
[plugin architecture](architecture-and-experience.md#plugin-architecture).

**On a host that already runs another reverse proxy on 80/443** (Dokploy, nginx, another
app), the bundled local Traefik can't publish those ports too. `scripts/deploy.sh
local` checks for this before starting anything and fails with the fix rather than a bare
Docker port-in-use error: set `TASKDESK_LOCAL_HTTP_PORT` / `TASKDESK_LOCAL_HTTPS_PORT` in
`.env` (e.g. `8080` / `8443`) and include the HTTPS port in `TASKDESK_AGENT_URL` /
`TASKDESK_PORTAL_URL` — see [traefik-and-domains.md § Local development](#traefik-and-domains-local-development).

<a id="deployment-compose-files"></a>
### Compose files

| File | Purpose |
| --- | --- |
| `compose.yml` | Base — at the repository root. Services, images, volumes, networks. **Publishes no application port** |
| `deploy/compose.local.yml` | Overlay — local development: local settings, Mailpit, Postgres on loopback. Publishes no application port (#752) |
| `deploy/compose.prod.yml` | Overlay — Traefik labels, resource limits, external proxy network |
| `deploy/compose.uat.yml` | Overlay — as production, different hostnames, and the bimats.com host's real topology: CloudFront terminates TLS, so the routers use the plain `web` entrypoint with no certificate resolver ([proxy topology evidence](#proxy-topology-evidence)) |
| `deploy/compose.traefik.yml` | Local Traefik, so production labels can be tested locally |
| `deploy/compose.keycloak.yml` | Optional Keycloak |
| `deploy/compose.observability.yml` | Optional Prometheus, Grafana, Loki |

```bash
# production
docker compose -f compose.yml -f deploy/compose.prod.yml up -d --wait

# local development — the local overlay plus its own Traefik (use scripts/deploy.sh local)
docker compose -f compose.yml -f deploy/compose.local.yml -f deploy/compose.traefik.yml up -d --wait
```

**No file publishes the application port, and this is deliberate.** It never lived in the
base file, and the local overlay stopped publishing it in #752; locally, the bundled Traefik
reaches it over the Docker network. Compose *concatenates* `ports:` across files — an overlay can add a published port but
cannot take one away — so a base file that published 5173 would publish it in production
too, and the "never published" premise that `TASKDESK_TRUST_PROXY=1` rests on
([traefik-and-domains.md](#traefik-and-domains)) would be false. `scripts/deploy.sh
production` asserts it from the Docker engine's own record of every `taskdesk` container
(`docker inspect`, stopped ones and every replica included), not from `docker compose
port`, whose exit code does not separate "published" from "exposed but not published"
(Compose v5.6.0 and 2.40.3 print `:0` with exit 0 for the latter). The deploy stops if any
`taskdesk` container uses host or container-shared networking (`network_mode: service:<name>` included), has `PublishAllPorts` set, declares any port
binding or shows any live host port mapping, and also if there is no container to check.
The check runs on the created-but-not-started containers and again once the stack is up.

These are the paths; every command in [environments.md](#environments),
[one-line-install.md](#one-line-install) and the [runbook](#runbook) uses them.

Base plus overlay, never a separate full file per environment — that is how they drift.

<a id="deployment-object-storage-when-it-is-wanted"></a>
### Object storage, when it is wanted

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

<a id="deployment-resource-sizing"></a>
### Resource sizing

Sizing target for 100 concurrent users; not measured acceptance evidence for a specific host.

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

These resource targets need measured capacity evidence; a functional-only SIT host does not establish them.

<a id="deployment-scaling"></a>
### Scaling

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
when event-loop lag says it is time ([scaling.md](#scaling)).

Postgres is the vertical limit. Read replicas are a later problem, and one we would rather
have than pre-solve.

<a id="deployment-kubernetes"></a>
### Kubernetes

A Helm chart lives at `charts/taskdesk/`. It is **derived from kaneo's chart but
substantially rewritten**. kaneo also ships a single combined image — nginx serving the web
bundle next to the node API, one entrypoint starting both, one Deployment behind one
hostname. The difference is what the image does: TaskDesk serves **both** bundles from the
Node process, selected by `Host` header, with no nginx, so the chart needs three Ingress
hosts, a `TASKDESK_ROLE` split across two Deployments and a values contract of its own —
[kubernetes.md](#kubernetes). Compose behind Traefik remains the primary target because
that is what we and our customers actually run; the chart is linted, templated and
packaged in CI from P2 and is the artefact the [AWS Marketplace listing](#aws-marketplace)
validates in P7.

<a id="deployment-upgrades"></a>
### Upgrades

```bash
scripts/deploy.sh upgrade            # verify the cosign signature → pull → up -d --wait
```

**The signature check is the point.** The stack table promises the image is verified against
its cosign signature before start, and [ci-cd.md](ci-gates.md) signs it
against an exact workflow identity; a bare `docker compose pull` verifies nothing and
silently drops that control. The raw commands below are the **no-verification fallback**,
for a host that cannot reach the transparency log — label it as such when you use it:

```bash
docker compose pull                  # no signature verification
docker compose up -d --wait
```

Migrations apply in the one-shot migration role under an advisory lock before serving, so concurrent replicas do not race
([migrations.md](design-and-decisions.md#migrations)).

**Be honest about downtime.** Plain Compose does not do health-gated replacement: on a
single-replica stack `up -d` stops the old container, then starts the new one — expect a
short outage per upgrade (typically under a minute, longer if a migration is heavy), and
plan the window. `--wait` makes the command block until the new container is healthy so a
failed start is loud. With `replicas: 2+` behind Traefik, a scale-up/scale-down sequence
gives a rolling upgrade; genuine zero-downtime rolling updates are the Kubernetes path.

**Before any upgrade:** take a database backup and note the current digest, so rollback is
one command — `scripts/deploy.sh rollback <digest>`, which verifies the signature on the way
back down too ([runbook](#runbook)). See [backup and restore](#backup-and-restore).

<a id="deployment-deploy-targets"></a>
### Deploy targets

| Target | Notes |
| --- | --- |
| **One-line install** | `curl \| bash` onto plain Docker Compose — the default recommendation, see [One-line install](#one-line-install) |
| **Dokploy** | v1's production path. Compose-managed with a UI |
| **Plain Docker Compose** | A host, Traefik, a systemd unit — what the one-liner sets up |
| **Kubernetes** | Helm chart, any conformant distribution (EKS, AKS, GKE, k3s, on-prem). Secondary to Compose+Traefik, meaning less-exercised by us day to day — not less supported. Tested every release |
| **Single-node** | Everything on one machine, filesystem storage plugin, no Valkey |
| **AWS Marketplace** | Container-product listing of the same image. See [AWS Marketplace listing](#aws-marketplace) |

The single-node profile matters: it is what a small customer will run, and it must work
with no object store and no cache.

"Any environment" means: the same image, the same Helm chart and the same Compose files
work identically whether the target is a laptop, a customer's own Kubernetes cluster, a
bare host reached by SSH, or infrastructure procured through a cloud marketplace. Nothing
about the application differs by target — only how the container is scheduled and how TLS
is terminated differ, and both are infrastructure concerns, never application code.

<a id="deployment-health-and-readiness"></a>
### Health and readiness

| Endpoint | Semantics |
| --- | --- |
| `/api/public/health/live` | Serving process is up. **Touches no dependency**. Anonymous; jobs use the image's local Unix-socket liveness probe |
| `/api/public/health/ready` | Database reachable, migrations applied. Anonymous |
| `/api/instance/health/deep` | Dependency/plugin diagnostics require instance-admin policy; listing the endpoint does not establish availability ([observability.md](safety-and-runtime.md#observability)) |

A liveness probe that fails when Postgres blips will restart a healthy container and turn a
brief outage into a long one. Hence the separation.

<a id="environments"></a>
## Environments
Local, verification and production environments use the same application image. Current execution order is laptop SIT first, then verified Technexus cloud SIT; named examples below are topology conventions, not evidence of an active endpoint.

| | Local | UAT | Production |
| --- | --- | --- | --- |
| Purpose | Development | Verification | Real work |
| Deploy | `scripts/deploy.sh local` | Automatic on merge to `main` | Manual promotion by digest |
| Data | Seeded | Anonymised copy of production | Real |
| TLS | Self-signed | Real certificate | Real certificate |
| Mail | Optional capture inbox with explicit sender configuration | Real SMTP, restricted recipients | Real SMTP |
| Backups | None | Daily | Hourly, offsite |
| Monitoring | None | Full | Full, alerting |
| Quality bar | — | **Production standard** | — |

<a id="environments-uat-is-held-to-the-production-standard"></a>
### UAT is held to the production standard

Verification must not have a weaker correctness or security bar than production.

A UAT that is allowed to be broken, slow or out of date stops being used. Then the first
real test of a change is production. So:

- UAT uses the same image, the same Compose overlay and the same resource limits.
- UAT is backed up and monitored.
- A broken UAT is a blocker, not a shrug.
- Alerts from UAT reach an attended destination; a log sink nobody reads is insufficient.

<a id="environments-local"></a>
### Local

```bash
cp deploy/.env.example .env
scripts/deploy.sh local
```

Runs at `https://ticket.localhost` and `https://portal.localhost` via local Traefik with a
self-signed certificate.

**Example alternate-port laptop topology:** configure the agent at `https://ticketing.localhost:8443`
and the portal at `https://portal.localhost:8443` (loopback only), when another proxy
holds 443. Its `.env` sets `TASKDESK_LOCAL_HTTP_PORT=8080`, `TASKDESK_LOCAL_HTTPS_PORT=8443`
and both public URLs with `:8443`. `scripts/deploy.sh local` seeds the SIT accounts, the
Acme customer organisation, and two published request types, with intake enabled.

Two hostnames means either `/etc/hosts` entries or `dnsmasq` for `*.localhost`. The script
prints exactly what to add.

**Use the verified deploy path.** The script generates secrets, waits for health, applies migrations and probes the result.
Skipping it produces a stack that appears to be running and is not.

<a id="environments-seed-data"></a>
#### Seed data

```bash
pnpm seed minimal      # 1 org, 1 project, 10 items — fast tests
pnpm seed realistic    # 5 orgs, 50 projects, 10k items, 200 people
pnpm seed hostile      # empty strings, 500-char titles, CJK, RTL, emoji, deep nesting
```

The hostile dataset finds more layout bugs than any other single technique. Use it before
declaring a screen done.

<a id="environments-uat"></a>
### UAT

- Hostnames: `ticket-uat.<domain>`, `portal-uat.<domain>`.
- Deployed automatically on merge to `main`.
- Database refreshed weekly from an anonymised production copy.

**Anonymisation** replaces names, emails, phone numbers and free text in comments and
descriptions, and drops attachments. Structure, volumes and timings are preserved, because
those are what make a realistic environment useful. The intended script is
`scripts/anonymise.ts`; its actual anonymisation must be verified before using real data. An anonymiser defect is a data breach.

Outbound mail is restricted to an allowlisted domain, so a UAT notification cannot reach a
real customer.

<a id="environments-production"></a>
### Production

- Hostnames: `ticket.<domain>`, `portal.<domain>` — and `files.<domain>` only when an
  operator-owned S3 endpoint is served behind this Traefik (`--profile s3`); on the default
  `storage.filesystem` there are two.
- Deployed by manual promotion of a digest already verified in UAT.
- Hourly database backups, offsite, with restore verified monthly.
- Full monitoring and alerting.

**Access:** production shell access is limited and audited. Routine operations —
configuration, user management, diagnostics — are done through God Mode, not through a
shell. If an operation requires a shell, that is a gap in God Mode and should be recorded
as one.

<a id="environments-customer-instances"></a>
### Customer instances

Every customer runs their own instance of the same image, configured entirely through
God Mode.

- No customer-specific build, tag or branch.
- Upgrades are `scripts/deploy.sh upgrade`, which verifies the image's cosign signature before
  pulling ([deployment.md](#deployment)); raw `docker compose pull && up -d` is the labelled
  no-verification fallback.
- Their configuration is theirs; we do not hold it.
- Support is by guiding them through God Mode, or by an audited impersonation session with
  their consent.

This is the whole reason for the plugin architecture. If a customer ever needs a code
change to be configured, that is a design failure, and it should be recorded as one in the
[decision log](retained-constraints.md#decision-log).

<a id="environments-promotion-path"></a>
### Promotion path

```
feature branch → PR (full CI) → main → UAT (automatic)
                                         │
                                    verify, smoke test
                                         │
                                         ▼
                              production (manual, by digest)
```

Never tag-based. The digest verified in UAT is the digest deployed to production, by
construction rather than by convention.

<a id="environments-naming"></a>
### Naming

| | Agent | Portal | Files |
| --- | --- | --- | --- |
| Local | `ticket.localhost` | `portal.localhost` | `files.localhost` |
| UAT | `ticket-uat.<domain>` | `portal-uat.<domain>` | `files-uat.<domain>` |
| Production | `ticket.<domain>` | `portal.<domain>` | `files.<domain>` |

Two hostnames per environment, three when the S3 profile is on. The third exists so attachments are served from an origin
that has no application on it — see
[storage and attachments](safety-and-runtime.md#storage-and-attachments).

<a id="kubernetes"></a>
## Kubernetes — the Helm values contract
The chart uses the same application image and bootstrap configuration as Compose. Node serves both application bundles by exact Host; there is no application nginx requirement. Target workload separation is request-serving replicas plus a scheduler role when needed. Conditional files ingress exists only for an operator-owned S3 endpoint.

<a id="kubernetes-shape"></a>
### Shape

The object table below records the retained single-Deployment compatibility contract; the following split-workload values are the target contract. They must be reconciled explicitly before claiming chart/Compose parity, not inferred from a rendered manifest.

| Object | Notes |
| --- | --- |
| `Deployment taskdesk` | Compatibility shape: one Deployment, `replicas` from `.Values.replicaCount` (default 1), readiness on `/api/public/health/ready`, liveness on `/api/public/health/live`. A compatibility render without per-replica `TASKDESK_ROLE` runs `all` unless `taskdesk.env.trustProxy`/`extraEnv` overrides it — so the `web`/`jobs` split `TASKDESK_ROLE` already supports requires explicit values/template integration |
| `initContainer migrate` | On the `taskdesk` Deployment's own Pod: runs migrations and the database role/grant bootstrap (`TASKDESK_ROLE=migrate`) under the advisory lock, before the `taskdesk` container starts. It is the ONLY place that ever carries `TASKDESK_MIGRATION_DATABASE_URL` (the owner/superuser credential) — the `taskdesk` container never receives it, and refuses to start if it ever does. A migration hook must not run before its required ServiceAccount/database exist. The initContainer completes before its Pod's serving containers start. Safe with multiple replicas: idempotent under its own advisory lock |
| `Service taskdesk` | Port 5173, in front of the `taskdesk` Deployment |
| `Ingress` | Agent and portal hosts, each with TLS, plus the files host **only** when the cluster serves an operator-owned S3 endpoint (`storage.bundled`); omitted on `storage.filesystem` and on a real S3 bucket |
| `ServiceAccount` | Created by default (`serviceAccount.create: true`); RBAC with named `resourceNames`, no wildcards — an AWS Marketplace requirement too |
| Secrets | **No chart-rendered `Secret` object by default** — every password (`TASKDESK_AUTH_SECRET`, `TASKDESK_ENCRYPTION_KEY`, the application role's password, the owner/migration password) is an inline value in the relevant Pod spec's `env`, the same as this chart's pre-existing convention, unless the operator sets the matching `existingSecret` value (`taskdesk.env.existingSecret`, `encryptionKeyExistingSecret`, `database.appExistingSecret`, `database.external.migration.existingSecret`, or the bundled `postgresql.auth.existingSecret`), in which case that field is read `valueFrom` the operator's own Secret instead. Under the credential-separation contract, `TASKDESK_DATABASE_URL` connects as the non-owner application role (`taskdesk_app`); the owner/migration credential is set only on the `initContainer migrate` row above, never on the `taskdesk` container. See the chart's maintained values documentation for the exact values (`taskdesk.env.database.app*`, `external.migration.*`) and [configuration-reference.md](configuration.md). An upgrade of an existing install must supply the application role's password. The other two required variables are not secrets and are not duplicated here: `TASKDESK_AGENT_URL` and `TASKDESK_PORTAL_URL` are **templated** as `https://` + `hosts.agent` / `hosts.portal` |

<a id="kubernetes-valuesyaml-contract"></a>
### `values.yaml` contract

```yaml
image:
  repository: ghcr.io/<org>/taskdesk
  tag: ""            # defaults to appVersion; a digest may be given instead
  digest: ""
  pullPolicy: IfNotPresent
hosts:
  agent: ticket.example.com
  portal: portal.example.com
  files: files.example.com          # "" to disable the files Ingress
tls:
  issuer: letsencrypt               # cert-manager ClusterIssuer, or "" for pre-provisioned secrets
web:
  replicas: 2
  resources: { requests: { cpu: 500m, memory: 512Mi }, limits: { cpu: "2", memory: 1536Mi } }
jobs:
  enabled: true
  resources: { requests: { cpu: 250m, memory: 512Mi }, limits: { cpu: "1", memory: 1024Mi } }
secrets:
  existingSecret: ""                # name of a Secret with TASKDESK_DATABASE_URL, TASKDESK_ENCRYPTION_KEY, TASKDESK_AUTH_SECRET
postgres:
  external: { url: "" }             # use a managed database…
  bundled: { enabled: false }       # …or the bundled bitnami-style chart for evaluation only
valkey:
  external: { url: "" }
  bundled: { enabled: true }
storage:
  bundled: { enabled: true }        # SeaweedFS for evaluation; production uses S3 configured in God Mode
serviceAccount:
  create: true
  annotations: {}                   # IRSA role ARN goes here on EKS
podSecurityContext: { runAsNonRoot: true, runAsUser: 10001, readOnlyRootFilesystem: true }
```

<a id="kubernetes-rules"></a>
### Rules

- **Image references appear only in `values.yaml`**, templated everywhere else — an AWS
  Marketplace validation rule as well as good practice.
- `helm lint` and `helm template` pass in the fast CI stage; the chart is packaged and
  pushed as an OCI artefact next to the image on release ([ci-cd.md](ci-gates.md)).
- Parity with Compose: every bootstrap variable and every hostname has exactly one
  corresponding value; there is no Kubernetes-only configuration.
- Rolling updates: `maxUnavailable: 0` on `taskdesk-web`; the jobs Deployment uses
  `Recreate` (one replica, lease-safe).

<a id="data-protection"></a>
## Data protection
The position a customer's data-protection agreement will ask about, written down once.


<a id="data-protection-roles"></a>
### Roles

A self-hosting customer is the **controller** and the operator; we are neither. When we
run an instance for a customer, we are the **processor** and this document is the technical
half of the DPA.

<a id="data-protection-data-inventory"></a>
### Data inventory

| Data | Where | Retention | Erasure path |
| --- | --- | --- | --- |
| Work items, comments, attachments | Postgres + object storage | Life of the organisation; soft-delete 30 days | Organisation deletion ([multi-tenancy.md](safety-and-runtime.md#multi-tenancy)); per-person anonymisation |
| `activity` (the journal) | Postgres | Forever | Per-person anonymisation tombstones the actor; content stays |
| `audit_log` | Postgres | 12 months (configurable) | Never edited; organisation tombstoned; person anonymised |
| Sessions, API keys, invitations | Postgres | On expiry | Purged with the organisation |
| Notifications | Postgres | Read rows: configured `notification_retention_days` (90 d default); unread rows retained | `session-cleanup` purges only expired read rows; organisation hard delete purges all. Person anonymisation tombstones identity fields; recipient-linked rows remain subject to this retention rule |
| Notification event envelopes, delivery children, digest groups and `outbox_dedupe_reservation` | Postgres | Terminal notification children and groups: 30 d after terminal `updated_at`; terminal event envelopes: 30 d after terminal `updated_at`, only after retained children are gone. Pending children and their parents are retained. Reservation authority expires 60 s after last renewal; expired rows are physically removed by daily `session-cleanup` | Export includes children keyed to the recipient and applicable digest metadata. Person/organisation holds retain matching children, groups and parent events. Purge children before empty groups; purge a parent only after no child references it. Reservation stores recipient, channel and dedupe key; deleted on release, daily expiry cleanup (including during holds), or cascade from deleted delivery owner/person. Lease expiry ends authority immediately even if the row remains until cleanup. Organisation hard deletion removes scoped children, empty groups, unreferenced applicable events and reservations without dangling references |
| Idempotency responses | Postgres | 24 h | Purged with the organisation |
| Logs | Pino → the operator's sink | Operator-defined | Allowlist serialisation; no request bodies |
| Backups | Operator's storage | Stated in [backup-and-restore.md](#backup-and-restore) | Deleted data persists in backups until they age out — stated, not hidden |

<a id="data-protection-subject-rights--per-person"></a>
### Subject rights — per person

- **Export**: God Mode → Users → *Export data* (`GET /api/instance/users/{id}/export`,
  elevated) — everything keyed to the person as JSON.
- **Erasure / anonymisation**: God Mode → Users → *Anonymise* — name and email replaced
  with tombstones, `person.active = false`, credentials and sessions removed; authored
  content is retained (it belongs to the organisation), attributed to "Former member".
  Audit rows keep the tombstoned reference. This is the honest resolution of "the journal
  is forever" against "the right to be forgotten": identity is erased, history is not.
- Both are audited and elevated ([rbac.md](permissions.md)).

**SCIM de-provisioning is not erasure.** When Microsoft Entra sends `active=false`, the
person is deactivated, sessions and personal keys are revoked and memberships end — but
name, email and authored content remain ([identity-provisioning.md](feature-contracts-p3.md#identity-provisioning)
`IP-15`). Erasure is the separate elevated *Anonymise* action above, and it checks legal
hold first.

Notification retention is configurable in God Mode. Only read notifications older than
`instance_setting.notification_retention_days` are time-purged; unread notifications remain
until read or organisation hard deletion. Person anonymisation tombstones identity fields
but does not change this notification retention rule. The 90-day value is a default, not a
fixed limit. `outbox_dedupe_reservation` is short-lived coordination data, not
notification history: it carries the recipient person id, channel and dedupe key while a
delivery lease is active. Lease authority ends exactly at its expiry, but the expired row may
remain physically present until daily `session-cleanup` removes it; workers can reclaim it
as soon as it expires. Rows are also removed on release or when their delivery owner/person
is deleted. Event-envelope, child-delivery and digest retention is separate from read/unread
inbox retention; a pending or held child retains its parent event. The configured read-purge behavior and unread retention are
acceptance requirements in
[notifications.md](feature-contracts-p4.md#notifications-in-app-inbox).

<a id="data-protection-legal-hold"></a>
### Legal hold

A per-organisation or per-person **legal hold** (God Mode → Organisations / Users → *Place
on hold*, elevated, audited) suspends retention purge of matching audit rows, read
notifications, terminal notification children and digest groups, parent event envelopes,
attachments and soft-deleted business rows, and blocks
hard delete for that scope until the hold is lifted; anonymisation requests against a held
person are refused with the hold named. `session-cleanup` still expires credentials,
sessions, invitations, idempotency keys and preference handoffs during a hold. It also
physically removes expired `outbox_dedupe_reservation` rows during a hold: these short-lived
coordination rows are not evidence, and the lease is already invalid at expiry. The per-tenant
export above is the e-discovery export — one organisation's data, nothing else's, in a
documented JSON shape. Holds are listed on the Health screen so nobody forgets one is in
place.

Hold matching is row-specific. A person hold matches notification `person_id` and delivery
`recipient_person_id`. An organisation hold matches the recipient's organisation, the
source `organisation_id`, or the owning organisation of the referenced notification
resource; parent events also match their source scope. If resource ownership cannot be
resolved, retain the row while any organisation hold is open. Read notifications matching a
hold are kept beyond configured retention; unread rows are retained independently of holds.
Held terminal children, groups and parent event rows are kept beyond 30 days; pending
children are never retention-purged. A held child keeps its parent and may conservatively
retain shared group history. The exact child-before-parent job predicates are in
[background-jobs.md](background-jobs.md).

It is a `legal_hold` row — `scope` (`organisation` \| `person`), `scope_id`, `placed_by`,
`placed_at`, `reason`, `lifted_by`, `lifted_at` — in [data-model.md](data-model.md);
`audit-purge`, selected history-purge paths in `session-cleanup`, and `attachment-gc` skip
matching held rows; reservation expiry cleanup deliberately does not
([background-jobs.md](background-jobs.md)), and placing or lifting a hold
is audited as `legal_hold.placed` / `legal_hold.lifted`.

<a id="data-protection-processing-locations-and-sub-processors"></a>
### Processing locations and sub-processors

None inherent — the product phones home to nothing. Sub-processors are exactly the plugins
an administrator configures (SMTP relay, S3 provider, identity provider, AI provider,
Sentry, OTLP), listed live in God Mode → Plugins, which is the sub-processor register.

<a id="one-line-install"></a>
## One-line install
- **Depends on:** [Deployment](#deployment), which the installer wraps instead of replacing.

<a id="one-line-install-purpose"></a>
### Purpose

The bootstrap source is [`install.sh`](../../install.sh). The intended public command is:

```bash
curl -fsSL https://get.taskdesk.dev/install.sh | bash
```

A clean host needs only a shell, outbound HTTPS, and the platform tools described below. The
installer obtains a specific signed GitHub release archive and hands off to the same
`scripts/deploy.sh` used by the manual deployment path. It does not clone the source tree or
implement a second deployment mechanism.

The bootstrapper and release assets require verification independently of public hosting. Serving `install.sh` and
`stable.txt` at `get.taskdesk.dev`, hardening that URL, and promoting the stable version
pointer are P7 hosting work. Until those static assets are published, use a reviewed local
copy of `install.sh` and pass `--version` for a published release.

<a id="one-line-install-install-flow"></a>
### Install flow

1. **Check the host.** Linux x86-64 and arm64 are supported for production. macOS is supported
   for local evaluation. Other operating systems and architectures stop before downloads.
2. **Check Docker.** Docker Engine, the Compose plugin and `docker buildx` must be available
   (`scripts/deploy.sh` resolves the image tag to a digest with buildx). If any is missing,
   the installer asks before installing them with the system package manager, which it only
   does on Ubuntu (`docker.io docker-compose-v2 docker-buildx`). On Debian, Fedora, RHEL and
   CentOS it stops with guidance to install Docker Engine, Compose and buildx from Docker's
   official repository, because those distributions' own package names do not reliably
   provide all three. Arch Linux
   stops with guidance to install Docker during a synchronized full-system update; the
   installer never runs a partial `pacman` upgrade. `--yes` accepts supported install prompts
   and the later install-file prompt. It never pipes a remote script into a shell. The Docker
   daemon must be running and accessible to the invoking user.
3. **Choose a release.** `--version TAG` selects an exact semantic version tag. Without that
   flag, the installer reads the single-line `stable.txt` pointer over HTTPS. A static
   `stable.txt` is published as part of P7 hosting; it is not dynamically resolved by a
   service.
4. **Authenticate before extraction.** Downloaded release assets are the versioned archive,
   its SHA-256 file, and separate cosign bundles for both files. Cosign verification pins the
   GitHub Actions OIDC issuer and the exact `release.yml` workflow identity. The archive hash
   must match the signed checksum. Archive members must stay under the expected versioned
   root and may not contain unsafe paths or symbolic links. `--skip-verify` is an explicit
   opt-out; it prints a warning and still checks the archive SHA-256.
5. **Install deployment files.** Files are unpacked in a private temporary directory before
   the installer prompts to write them. The installer preserves an existing `.env`, generated
   secrets, certificates, database volumes, and deployment data. When the selected version
   changes, it updates the image tag and clears a retained rollback digest so the selected
   version resolves to its signed image. It only changes hostname settings when the
   corresponding flags are supplied. A new `.env` is created from `deploy/.env.example`
   with mode `0600`.
6. **Delegate deployment.** The installer runs `scripts/deploy.sh` in the selected mode. That
   script generates only missing secrets, verifies the image signature, waits for health,
   runs migrations through its one-shot role, probes the API, and prints the first-run setup
   URL and token.

The install is repeatable. Running it again with a new `--version` updates deployment files
and image selection without replacing existing secret values or data.

<a id="one-line-install-production-preflight"></a>
### Production preflight

`--env production` requires `--domain` or an existing `DOMAIN` in the install directory's
`.env`. `--agent-host` and `--portal-host` override the derived `ticket.<domain>` and
`portal.<domain>` names. Compose routes and application public URLs use the same host values.
`--files-host` is checked only when supplied on that run, or when `--profile s3` is given (the
profile is never remembered, so repeat it when re-running an S3 install); the default
`TASKDESK_FILES_HOST` the installer records in `.env` is not DNS-checked on a re-run. A third hostname is needed only when this host
also serves an operator-owned S3 endpoint. Use `--profile s3` to start the bundled SeaweedFS
profile.

Before writing deployment files, the installer checks that the agent and portal names (and
the files name when requested) resolve, and that TCP port 5173 is free. DNS resolution alone
cannot establish which public host owns an address; the operator must ensure the records point
to this deployment host before proceeding. The preflight prints the record names that need
attention when resolution fails. Production does not publish the application port.

For local installs, host overrides are included in the generated local certificate SANs.
The installer leaves the local mode's application port and certificate behavior to
`scripts/deploy.sh`.

<a id="one-line-install-flags"></a>
### Flags

| Flag | Effect |
| --- | --- |
| `--env local\|production` | Selects deployment mode; default is `local` |
| `--domain DOMAIN` | Sets the Compose domain and derives agent/portal hostnames |
| `--agent-host HOST` | Overrides the agent route host and public URL |
| `--portal-host HOST` | Overrides the portal route host and public URL |
| `--files-host HOST` | Adds the files hostname to the production DNS check |
| `--profile s3` | Starts the optional S3 profile; configure its credentials in God Mode |
| `--version TAG` | Installs the exact release tag instead of the stable pointer |
| `--dir PATH` | Install directory; default is `~/taskdesk` |
| `--yes` | Skips the install-file and Docker-install prompts |
| `--dry-run` | Prints the release and deployment plan without downloading or writing files |
| `--skip-verify` | Explicitly skips cosign verification, warns, and retains the SHA-256 check |

Preview a pinned install without changing the host:

```bash
bash install.sh --version 2.22.0 --dry-run
```

<a id="one-line-install-trust-model"></a>
### Trust model

The signed archive and checksum file use keyless cosign signing from the repository's
`release.yml` workflow. The installer verifies both bundles with the same issuer and workflow
identity used by `scripts/deploy.sh`; a valid checksum from the same download site alone is
not treated as authentication. A verification failure stops before extraction or writes to the
install directory. There is no automatic fallback from a failed signature check.

The installer is inspectable source. A historical source checksum is not an authentication claim for the current downloaded script; verify the selected release archive/checksum signatures and exact workflow identity as specified above.

You can download and inspect the script before running it. The installer requests elevation
only through an explicit supported package-manager prompt when Docker is missing; Arch Linux
requires a synchronized full-system update performed by the operator. The rest of the flow
runs as the invoking user.

<a id="one-line-install-offline--air-gapped-install"></a>
### Offline / air-gapped install

Download the archive, checksum, and their cosign bundles on a connected machine. Verify both
signatures with the repository's exact workflow identity, verify the checksum, then transfer
and extract the archive:

```bash
version=v2.22.0
archive="taskdesk-${version}.tar.gz"
base="https://github.com/ThomasHeinThura/ticketing/releases/download/${version}"
curl -fsSLo "$archive" "$base/$archive"
curl -fsSLo "$archive.sha256" "$base/$archive.sha256"
curl -fsSLo "$archive.sigstore.json" "$base/$archive.sigstore.json"
curl -fsSLo "$archive.sha256.sigstore.json" "$base/$archive.sha256.sigstore.json"
identity='https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main'
cosign verify-blob --bundle "$archive.sigstore.json" --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity "$identity" "$archive"
cosign verify-blob --bundle "$archive.sha256.sigstore.json" --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity "$identity" "$archive.sha256"
sha256sum -c "$archive.sha256"
```

The installer cannot be used on the air-gapped host because it fetches its release assets
from GitHub. After transferring the four verified files, extract the archive and deploy from
the versioned directory. The example below distinguishes a new installation from an upgrade.
An upgrade must carry the previous installation's `.env` into the new version directory
before running the deploy script. It contains database, authentication, and encryption keys;
in particular, replacing `TASKDESK_ENCRYPTION_KEY` makes stored encrypted plugin credentials
unreadable. Transfer the file securely, keep its values unchanged, and restrict the new copy
to the installing user. If the previous `.env` is unavailable, stop and recover it from the
installation's protected backup; do not create a replacement and continue.

```bash
set -eu
tar -xzf "$archive"
cd "taskdesk-${version}"
# Choose exactly one. For an upgrade, point this at the previous version directory.
install_kind=upgrade
prior_dir=/srv/taskdesk-v2.21.0

if [ -e .env ]; then
  printf '%s\n' 'Refusing to overwrite .env in the extracted directory.' >&2
  exit 1
fi
case "$install_kind" in
  upgrade)
    if [ ! -d "$prior_dir" ] || [ ! -f "$prior_dir/.env" ] || [ -L "$prior_dir/.env" ]; then
      printf '%s\n' 'Upgrade requires the prior version directory and its regular .env file.' >&2
      exit 1
    fi
    transfer_file=".env.transfer.$$"
    trap 'rm -f "$transfer_file"' EXIT
    (umask 077; cp "$prior_dir/.env" "$transfer_file")
    chmod 600 "$transfer_file"
    if ! cmp -s "$prior_dir/.env" "$transfer_file"; then
      printf '%s\n' 'The copied .env does not match the prior file; refusing to deploy.' >&2
      exit 1
    fi
    mv "$transfer_file" .env
    trap - EXIT
    ;;
  fresh)
    cp deploy/.env.example .env
    chmod 600 .env
    ;;
  *)
    printf '%s\n' 'Set install_kind to upgrade or fresh.' >&2
    exit 1
    ;;
esac
${EDITOR:-vi} .env
scripts/deploy.sh local
```

For a fresh installation, set `install_kind=fresh`; this is the only path that copies the
example file. For an upgrade, retain the old version directory and its `.env` until the new
version is verified and backed up. The guarded copy fails before deployment if the prior file
is missing, a symlink, or differs after copying. Do not proceed by switching a failed upgrade
to `fresh`.

For production, configure the required host and secrets in `.env` and run
`scripts/deploy.sh production` instead. The signed archive contains deployment assets and
`scripts/deploy.sh`; it does not contain application source or secrets. See
[Deployment](#deployment) for the manual setup details.

<a id="one-line-install-hosting-boundary"></a>
### Hosting boundary

P7 publishes two static files at `get.taskdesk.dev`: `install.sh` and `stable.txt`. The latter
contains one stable release tag and is updated only by the P7 promotion process. This feature
does not create or operate that host, publish a customer release, or promote a version.

<a id="proxy-topology-evidence"></a>
## Proxy topology — measured, not assumed
`TASKDESK_TRUST_PROXY` is a security boundary: too few trusted appending hops collapse users into a proxy bucket; too many let caller-supplied forwarding data satisfy rate-limit or API-key allowlist checks. A diagram, a prior deployment or another host's capture cannot establish this value.

<a id="proxy-topology-evidence-the-method"></a>
### The method

Three questions, in order. Each has a way to answer it that does not involve
guessing.

**1 · Where does TLS terminate?**
Read the proxy's own access log for a real request and look at the entrypoint
and scheme it recorded. A proxy that recorded `http` on a port-80 entrypoint did
not terminate TLS; something in front of it did.

**2 · Does each hop append to `X-Forwarded-For`, or replace it?**
Send one request carrying a deliberately wrong `X-Forwarded-For`, and read what
each hop passed on. Appending hops each add one entry; a replacing hop
collapses the list to one. Only appending hops count.

**3 · What arrives at the application?**
The value that matters is the one the application process reads. Capture it
there — a request-header dump on a route that echoes them, or a log line —
rather than inferring it.

`TASKDESK_TRUST_PROXY` is then the number of hops that append, counted from the
application backwards. The client is that many entries from the right-hand end
of `X-Forwarded-For`.

<a id="proxy-topology-evidence-cdn-or-load-balancer-topology"></a>
### CDN or load-balancer topology

Determine TLS termination, trusted peer ranges, forwarding-header append/replace behavior and the exact headers received by the application on the selected deployment. The historical source included a host-specific CDN/Traefik observation and an incomplete end-to-end capture. Those observed IPs, hostnames, versions and a derived count of two are not current evidence and are not prescribed for Technexus.

Use controlled synthetic requests with deliberately forged `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`; capture only the bounded fields needed to prove routing. Do not add an open production header-echo endpoint or log credentials/request bodies. Record source/image identity, exact topology, application-observed peer/header chain and unforgeable client-IP selection. A forged header must move no rate-limit bucket and satisfy no API-key IP allowlist. If the measured count differs, fix the topology/overlay setting rather than special-case application code.

For trusted upstream peers, a proxy may preserve client-supplied forwarded protocol/host while appending a peer to XFF. A CDN-origin HTTP hop can also report `http` even when the viewer used HTTPS. Do not derive secure-cookie decisions or absolute URLs from untrusted forwarding values. Where a CDN terminates TLS, configure its trusted origin-side `X-Forwarded-Proto: https` override so viewer-supplied values cannot survive; verify the actual application-visible value. Hop-count changes do not fix forwarded-protocol errors.

The application owns correct configured-hop selection and must ignore unrelated entries without falling back to caller-supplied data. The deployment owns the measured topology, trusted upstream ranges and configured count. Until that chain is established, do not claim forwarding-based admission is verified.

<a id="proxy-topology-evidence-the-shipped-topology--traefik-terminating-tls"></a>
### The shipped topology — Traefik terminating TLS

`deploy/compose.prod.yml` and `deploy/compose.local.yml` set
`TASKDESK_TRUST_PROXY=1`, which is the documented default and correct for the
arrangement they describe: one Traefik, terminating TLS, directly in front, with
the application port unpublished so nothing else can reach the container.

That last clause is the load-bearing one. Compose *concatenates* `ports:` across
files, so the base `compose.yml` publishes nothing, and overlays must not publish 5173 either. `scripts/deploy.sh production`
asserts it from the Docker engine's record of every `taskdesk` container
(`docker inspect`: no host or container-shared networking, no `PublishAllPorts`, no port binding, no live
host port mapping; no container at all also stops the deploy). It does not rely on
`docker compose port`, whose exit code is 0 for an exposed but unpublished port. If the port were published, a client could reach the container
directly and set `X-Forwarded-For` to anything at all, and `1` would be a hole
rather than a setting.

---

<a id="runbook"></a>
## Runbook
What to do when something is wrong. Symptom-first, because that is how you arrive here.

Run the Compose commands below from the TaskDesk checkout on the host. On a production
host, select the same base and production overlay as `scripts/deploy.sh`:

```bash
dc() { docker compose -f compose.yml -f deploy/compose.prod.yml "$@"; }
```

For local development, use `dc() { docker compose -f compose.yml -f deploy/compose.local.yml -f deploy/compose.traefik.yml "$@"; }`.
The first-run `scripts/deploy.sh local` command sets up the local certificate and secrets.

**Metrics endpoint:** the serving API role starts a dedicated listener on port `9464` at
`GET /metrics`. Scrapes require the current bearer token; the listener reads its SHA-256
digest from PostgreSQL for each request. Rotate the token in God Mode → Observability and
store the one-time response directly in the monitoring system's secret store. Never put the
token in a command argument, log, ticket, or incident record. A missing or incorrect token
returns `401`; a database credential-read failure returns `503`. The listener bind failure
prevents API readiness. Migration and job roles do not start this listener.

<a id="runbook-audit-write-failure-alert"></a>
<a id="runbook-audit-write-failure-alert-after-instrumentation-is-deployed"></a>
### Audit-write failure alert

The target urgent alert is `increase(taskdesk_audit_write_failures_total[5m]) > 0`, grouped
by the closed `operation` label. When an alert fires,
preserve the alert timestamp and instance identity, then inspect that instance's application
logs for the matching safe error-level record and `traceId`:

```bash
dc logs --since=15m taskdesk
```

Use `operation` to distinguish a mutation audit append, a pending-action decision append, or
a pending-action self-read append. Confirm the operation's user-visible result and backing
row before asking a caller to retry: AU-14 mutations and pending-action decisions may have
committed even though their audit append failed; the pending-action self-read instead fails
closed. Treat the result as a known audit gap, not as evidence that the append-only hash chain
was altered. Record the affected time window and trace ids in the incident record without
copying credentials or request bodies.

AU-14 also writes an in-app notification for each current active instance administrator.
The notification contains only the finite operation name and occurrence time. The notifier
makes one bounded retry in a separate transaction after the audit savepoint has rolled back.
If both writes fail, the counter and safe error log remain the operator signals. Check the
administrators' in-app notifications alongside the matching metric and log record; neither
signal means the underlying mutation was rolled back.

<a id="runbook-triage"></a>
### Triage

1. **Is it up?** `curl https://ticket.<domain>/api/public/health/ready`
2. **Is it everything or one thing?** Check `dc ps`, TaskDesk logs and the database query below. Dependency detail requires the instance-admin endpoint; do not infer availability from a runbook example.
3. **What changed?** Last deploy, last configuration change (God Mode → Audit)
4. **Who is affected?** Compare which workspaces and users report the issue; Use configured, verified observability; no external error provider is assumed.
5. **Communicate before investigating.** A five-word status message buys an hour of quiet

---

<a id="runbook-symptoms"></a>
### Symptoms

<a id="runbook-first-run"></a>
#### First run

The install finished, and nobody has signed in yet. This is where the most likely incident
of an instance's whole life happens.

| Cause | Fix |
| --- | --- |
| **Setup token expired or lost** | The token is short-lived and single-use. While `setup_completed_at` is null, **every container restart prints a fresh token and invalidates the previous one** ([auth-and-identity.md](safety-and-runtime.md#auth-and-identity)) — so run `dc restart taskdesk` and read the new one out of `dc logs taskdesk`. Nothing else is lost; no administrator exists yet |
| Setup page says setup is already complete | Someone else claimed the first administrator. Sign in as them, or use break-glass below |
| Headless install created no administrator | `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` was unset. Set it and restart, or use the setup page |
| Certificate not issued on the first `up` | DNS did not point here when ACME ran. Fix the record and restart Traefik; the installer's pre-flight exists to catch exactly this ([one-line-install.md](#one-line-install)) |
| `scripts/deploy.sh local` dies with "port 80/443 is already bound" | The host already runs something else on that port (Dokploy, nginx, another app). Set `TASKDESK_LOCAL_HTTP_PORT` / `TASKDESK_LOCAL_HTTPS_PORT` in `.env` to free ports and re-run — see [traefik-and-domains.md § Local development](#traefik-and-domains-local-development) |

<a id="runbook-site-is-down"></a>
#### Site is down

```bash
dc ps
dc logs --tail=200 taskdesk
curl -sf "https://ticket.${DOMAIN}/api/public/health/live"
```

For a local stack, use `https://ticket.localhost/api/public/health/live` (the local
self-signed certificate must be trusted by the client).

| Cause | Fix |
| --- | --- |
| Container crash-looping | Read the logs. Usually a bad migration or a missing env var |
| Postgres unreachable | Check the container; check `TASKDESK_DATABASE_URL` |
| Traefik not routing | On local development, use `dc logs traefik`. In production, inspect the host proxy's own Compose project or service; TaskDesk's production overlay does not own Traefik. Check `DOMAIN` and labels |
| Certificate expired | Check the ACME resolver; renew manually if needed |
| Disk full | `df -h`. Usually Postgres WAL or Docker logs |

<a id="runbook-slow"></a>
#### Slow

```bash
dc stats --no-stream taskdesk
dc exec -T postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}" -c "select state, count(*) from pg_stat_activity where datname = current_database() group by state order by state;"
```

| Cause | Fix |
| --- | --- |
| DB connections high | Inspect the `pg_stat_activity` query above and TaskDesk logs for pool errors; do not infer a pool-waiter metric before its producer exists |
| Slow query | `pg_stat_statements`; `EXPLAIN ANALYZE`; add an index |
| Event loop lag | A job is hogging the loop — check which is running and whether it is chunked |
| Valkey down | Degraded, not broken. Restart it |
| Large unbounded response | Something is not paginating. Find it |

<a id="runbook-cannot-sign-in"></a>
#### Cannot sign in

**Do not start by changing configuration.** Establish which of these it is:

| Cause | Check |
| --- | --- |
| Identity provider misconfigured | God Mode → Authentication → **Test connection** |
| Provider certificate expired | The test reports it |
| Session secret rotated | Everyone signed out at once — expected, communicate it |
| Account suspended | God Mode → Users |
| MFA required, not enrolled | Required users complete verified enrollment before protected use. An unavailable required verifier fails closed; a setting is not proof of enforcement. |
| Portal boundary | A customer on the agent origin — this is correct behaviour |
| **All administrators locked out** | See break-glass below |

<a id="runbook-notifications-not-arriving"></a>
#### Notifications not arriving

```bash
dc logs --since=1h taskdesk | grep -Ei 'outbox|notification' || true
dc exec -T postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}" -c "select type, count(*) as notifications from notification where created_at > now() - interval '1 hour' group by type order by type;"
```

| Cause | Fix |
| --- | --- |
| No recent notification rows or logged send failures | Check the notification preferences and SMTP/ntfy settings; inspect the persisted outbox/delivery state and current recipient eligibility; an inbox row alone is not provider delivery |
| SMTP rejecting | Test in God Mode; show only the bounded safe outcome, never credentials or raw provider replies |
| Webhook endpoint down | Delivery history shows status codes. Auto-disabled after 24 h |
| User preference off | Not a fault |

<a id="runbook-sla-numbers-look-wrong"></a>
#### SLA numbers look wrong

SLA detail is recomputed from its authoritative policy/calendar/history. A derived cache may exist but cannot replace that authority; investigate the inputs and cache separately.

| Cause | Check |
| --- | --- |
| Wrong service calendar | Project settings → SLA; the calendar name is shown on the badge |
| Missing holidays | Calendar editor; the preview shows annual cover hours |
| Timezone | The calendar's timezone, not the viewer's |
| Unclosed pause | A work item stuck in a pausing state; the stale-paused report lists them |
| Policy version | An item created before a policy change uses the earlier version. This is correct |

<a id="runbook-jobs-not-running"></a>
#### Jobs not running

```bash
dc exec -T postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}" -c "select * from job_lease;"
```

| Cause | Fix |
| --- | --- |
| Lease held by a dead replica | Wait one TTL, or delete the row |
| Job disabled | God Mode → Jobs |
| Job erroring | Logs; run manually from God Mode to reproduce |

<a id="runbook-attachments-failing"></a>
#### Attachments failing

| Cause | Fix |
| --- | --- |
| Storage unreachable | God Mode → Storage → test |
| Credentials rotated | Re-enter in God Mode |
| Bucket full or quota hit | Check usage |
| Presign rejected by the storage endpoint | **The configured public endpoint is not the browser-facing origin.** A SigV4 signature covers the `Host` header, so a URL signed for the internal endpoint fails when the browser fetches it at the files origin. God Mode → Storage → public endpoint must equal what the browser sees ([deployment.md](#deployment)) |
| Presign accepted, browser upload blocked | The **bucket's** CORS does not allow the agent and portal origins. This is bucket configuration, not a Traefik middleware |
| Presign failing | Clock skew between the app and the object store breaks signatures |
| Bucket does not exist | The `--profile s3` bucket-create step did not run. Re-run `scripts/deploy.sh` |

---

<a id="runbook-break-glass-all-administrators-locked-out"></a>
### Break-glass: all administrators locked out

Requires database access. Every step is audited.

```bash
dc exec taskdesk node dist/cli.js grant-instance-admin you@example.com
```

The CLI is a build target of the image (`apps/api/src/cli.ts` → `dist/cli.js`,
[container-image.md](#container-image)). Every command writes an audit row with
`actor_type = 'system'` and the invoking OS user. Commands:

| Command | Does |
| --- | --- |
| `grant-instance-admin <email>` | Break-glass: grants `instance:admin` to an existing person |
| `disable-auth-plugin <id>` | Disables an identity provider and bumps `config_version` so every replica reloads ([auth runtime reconfiguration](safety-and-runtime.md#auth-runtime-reconfiguration)) |
| `verify-backup <file>` | `pg_restore --list` plus a decrypt check of one plugin secret against the current key |
| `rekey-status` | Progress of `secrets-rekey`: rows on the new `key_id` vs total |

The command writes an `audit_log` row recording that break-glass was used. If it appears in
the audit log and nobody knows why, treat it as an incident.

---

<a id="runbook-rolling-back"></a>
### Rolling back

```bash
scripts/deploy.sh rollback <previous-digest> <release-tag>
curl -sf "https://ticket.${DOMAIN}/api/public/health/ready"
```

`deploy.sh rollback` verifies the cosign signature on the digest using the tag annotation
that was signed when that image was published, stores both values in `.env`, and brings
the service back with `--wait`. For example, pass `v2.0.0` when rolling back to a digest
published as `v2.0.0`. **Rolling back
onto an unverified digest is still a supply-chain decision** — which is why the manual
sequence below is the labelled fallback rather than the procedure. After an upgrade the
script prints a complete rollback command using the prior running container's digest and
configured image tag. If it cannot recover that signed tag, it says so instead of printing
a command that cannot pass verification:

```bash
dc down taskdesk                     # no signature verification
# edit TASKDESK_IMAGE_DIGEST in .env
dc up -d --wait taskdesk
```

**Sessions across the cookie rename.** Releases that include #602 renamed the agent session
cookie to `__Host-tdk_agent_session` (Secure, host-only). Sessions issued by an earlier image
are not accepted after the upgrade, and sessions issued by the new image are not accepted after
a rollback to that earlier image. Either way users must sign in again. Tell users before the
change; no data is lost.

**Sign-in methods across migration 0213.** From the release with migration 0213, God Mode stores
local sign-in methods per portal (`instance_plugin_config` rows for `auth.password`,
`auth.magic-link` and `auth.email-otp`, `portal_scope` `agent`/`customer`), and the staff
sign-in page falls back to the password form when staff email code is off. Earlier images
still obey those rows, but their staff page shows only the email-code form when SMTP is
configured, and they have no screen for customer methods. Before rolling back past 0213:

1. In God Mode → Authentication → **Sign-in methods**, turn **Email code** for Staff back on (when SMTP is configured).
   Otherwise staff get a code form whose endpoint returns 404 and no password form.
2. Set the customer methods to the state you want the earlier image to keep. It cannot change
   them.

Prefer these God Mode saves over editing or deleting rows by hand. The 0213 CHECK change is
additive, so the earlier image runs on it and no schema rollback is needed.

**Applicability:** migration-specific procedures below apply only when crossing their named frontier with the described pre-migration schema. Reconcile actual journal/schema/provenance first; neither old observation nor rank alone authorizes data correction. Operator approval for a concrete destructive repair is a data-safety control, not an implementation review round.

**Migrations do not roll back.** If the release included a destructive migration, a code
rollback alone will not work — restore the pre-upgrade backup. This is why destructive
migrations are two-phase, and why the pre-upgrade backup is mandatory.

---

<a id="runbook-migration-0088-historical-frontier-applied-history-check"></a>
<a id="runbook-before-upgrading-to-migration-0088-and-later-applied-history-check"></a>
### Migration 0088 historical-frontier applied-history check

The Drizzle migrator runs a pending migration only when its journal `when` is greater than the
newest `created_at` already recorded. If an environment ever applied different migrations with
higher timestamps (for example a deploy from a train branch before the spine landed), the spine
migrations at or below that timestamp are **silently skipped**. On every target database, before
upgrading:

```sql
select to_regclass('drizzle.__drizzle_migrations') as migrations_table;
select max(created_at) from drizzle.__drizzle_migrations;  -- skip if the first query returned null
```

- A **fresh or empty** database proceeds: `migrations_table` is null (no `drizzle` schema or
  table yet), or the table exists with zero rows (`max` is null). All migrations then run from the
  start.
- When this exact historical frontier applies (through `0087_romantic_sway`), the result must be exactly `1791107747302`. Any other applied history requires reconciliation before crossing that frontier; do not apply this timestamp test to an already-upgraded database or rewrite migration history to make it pass.

---

<a id="runbook-upgrading-across-migration-0093-duplicate-membership-rows"></a>
### Upgrading across migration 0093: duplicate membership rows

Migration `0093_mature_exodus` replaces the non-unique `membership_personId_scope_scopeId_idx`
with the UNIQUE index `membership_person_scope_scope_id_unique` on
`(person_id, scope, scope_id)`. If the database already holds two membership rows for the same
person and scope, `CREATE UNIQUE INDEX` fails and **the whole upgrade aborts**: the Drizzle
migrator runs the pending migrations in one transaction, so nothing from 0088 onward is applied
and `__drizzle_migrations` is unchanged. The isolated migration role must finish before serving starts, so an affected deployment does not become ready until the duplicates are safely reconciled. The failure is atomic and safe to retry.

**Preflight** (run on the target database before upgrading from any version below 0093; it must
return no rows):

```sql
select person_id, scope, scope_id, count(*)
from membership
group by 1, 2, 3
having count(*) > 1;
```

<a id="runbook-remediation-only-if-the-preflight-returns-rows"></a>
#### Remediation, only if the preflight returns rows

Authority is **not** decided by `rank` alone. The permission resolver
(`apps/api/src/permissions/resolve-identity.ts`, `wellAnchored`, lines 491-530) unions every
membership row, but it ignores a row whose role does not belong to the scope's workspace, and a
person's capabilities are the union of their rows' roles. Deleting the wrong row can therefore
remove access (for example the only anchored row), keep a row the resolver ignores, or make
`sees_all` count when it did not. The `rank` collapse in `list-assignable-people.ts` is a display
rule only and is **not** a safe deletion rule.

Take the pre-upgrade backup first (see [backup-and-restore](#backup-and-restore)). **Stop the
API (or keep it read-only) before block (a) and leave it stopped until block (b) has committed**, so
no membership row changes between the plan and the apply. Block (b) also takes a
`share row exclusive` lock on `membership`, recomputes the plan with the same query as (a) (a
temp view defined once in (a)), and refuses to act unless the recomputed plan is identical to the
reviewed plan on every column, in both directions. Any change to a planned row (role, scope,
`sees_all`, inheritance, or a deleted, moved or newly duplicated row) therefore stops it.
Then work in
**one interactive `psql` session** against the database, in this order. **Do not run either
block with `psql -f` or any unattended tool**: the review pause is the point. Keep the session
open between the blocks (the plan is a session temp table), and save the printed output in the
release record.

**(a) Plan.** Read-only apart from a temp table. It prints every row of every duplicate group
with its role's workspace, rank and capabilities, whether the row is anchored the way the
resolver requires, whether it is direct or inherited, and its `sees_all`.

```sql
drop table if exists pg_temp.membership_dedupe_plan;
drop table if exists pg_temp.membership_dedupe_plan_now;
drop view if exists pg_temp.membership_dedupe_plan_q;

-- The plan query, defined once. Block (b) re-runs exactly this view after locking.
create temp view membership_dedupe_plan_q as
with base as (
  select m.id, m.person_id, m.scope, m.scope_id, m.role_id, m.sees_all,
         m.inherited_from, m.derived_from, m.created_at,
         r.scope as role_scope, r.workspace_id as role_workspace_id,
         r.rank as role_rank, r.capabilities as role_capabilities,
         -- Same test as resolve-identity.ts `wellAnchored`: the role must belong to the scope's workspace.
         (r.scope = m.scope and (
            (m.scope = 'workspace'
               and exists (select 1 from workspace w where w.id = m.scope_id)
               and r.workspace_id = m.scope_id)
         or (m.scope = 'project'
               and exists (select 1 from project p where p.id = m.scope_id
                           and p.workspace_id is not null and r.workspace_id = p.workspace_id))
         or (m.scope = 'organisation'
               and exists (select 1 from organisation o where o.id = m.scope_id)
               and r.workspace_id is null)
         )) as anchored,
         (m.inherited_from is null and m.derived_from is null) as direct
  from membership m
  join role r on r.id = m.role_id
), grp as (
  select b.person_id, b.scope, b.scope_id, count(*) as group_size,
         count(distinct b.role_id) as distinct_roles,
         bool_and(b.anchored) as all_anchored,
         exists (select 1 from base a
                  where (a.person_id, a.scope, a.scope_id) = (b.person_id, b.scope, b.scope_id)
                    and not exists (select 1 from base c
                                     where (c.person_id, c.scope, c.scope_id) = (a.person_id, a.scope, a.scope_id)
                                       and not (c.role_capabilities <@ a.role_capabilities))) as caps_nested,
         bool_or(b.sees_all) filter (where b.anchored) as anchored_sees_all
  from base b
  group by 1, 2, 3
  having count(*) > 1
)
select b.*, g.group_size, g.distinct_roles, g.all_anchored, g.caps_nested, g.anchored_sees_all,
       -- Automatic only when every row is anchored AND all rows carry the same role.
       case when g.all_anchored and g.distinct_roles = 1 then 'AUTO' else 'MANUAL' end as decision,
       row_number() over (
         partition by b.person_id, b.scope, b.scope_id
         order by b.anchored desc, b.direct desc, b.role_rank desc, b.created_at asc, b.id asc
       ) as keep_order
from base b
join grp g using (person_id, scope, scope_id);

create temp table membership_dedupe_plan as select * from pg_temp.membership_dedupe_plan_q;

-- (1) Review EVERY row of every duplicate group. keep_order = 1 is the row that would be kept.
select person_id, scope, scope_id, id, decision, keep_order, role_id, role_workspace_id,
       role_rank, role_capabilities, anchored, direct, inherited_from, derived_from,
       sees_all, anchored_sees_all, caps_nested, created_at
from membership_dedupe_plan
order by person_id, scope, scope_id, keep_order;

-- (2) Groups that need a human. Must be resolved by hand before the apply block will run.
select person_id, scope, scope_id, group_size, distinct_roles, all_anchored, caps_nested
from membership_dedupe_plan
where decision = 'MANUAL'
group by 1, 2, 3, 4, 5, 6, 7;
```

Rules the plan applies. A group is `AUTO` only when **every** row is anchored **and** all rows
carry the **same** `role_id`. Then the rows differ only in provenance and `sees_all`: the kept row
(`keep_order = 1`) is the anchored, direct row before an inherited one, then higher rank, then the
oldest, and it takes `sees_all` from the anchored rows only. Every other group is `MANUAL`:
any mis-anchored row, any differing `role_id`, or capability sets that are not nested
(`caps_nested = false`). Nothing is deleted automatically for a `MANUAL` group.

For each `MANUAL` group, decide by hand which rows to remove, from the printed capabilities and
anchoring, and delete those rows by `id` yourself (a person must keep every capability they hold
through an anchored row, or the loss must be signed off by the owner of that workspace). Then
re-run block (a) to rebuild the plan (it drops and recreates the temp table); the second result
set must be empty.

**(b) Apply.** Run only when the second result set of (a) is empty. It refuses to run if any
`MANUAL` group remains or the plan is stale (after either error, run `rollback;` and re-run (a)), updates `sees_all` on the kept row,
and deletes the other rows of the `AUTO` groups, in one transaction.

```sql
begin;

-- Block writers on membership until commit, then refuse to act on a plan that no longer matches.
lock table membership in share row exclusive mode;

drop table if exists pg_temp.membership_dedupe_plan_now;
create temp table membership_dedupe_plan_now as select * from pg_temp.membership_dedupe_plan_q;

do $$
begin
  if exists (select 1 from membership_dedupe_plan where decision = 'MANUAL') then
    raise exception 'MANUAL duplicate groups remain: resolve them by hand and re-run the plan';
  end if;
  -- The plan, recomputed now under the lock, must equal the reviewed plan on every column.
  if exists (select * from membership_dedupe_plan except select * from membership_dedupe_plan_now)
     or exists (select * from membership_dedupe_plan_now except select * from membership_dedupe_plan) then
    raise exception 'stale plan: membership changed since block (a); roll back and re-run block (a)';
  end if;
end $$;

-- AUTO groups: every row is anchored and has the same role, so the rows differ only in
-- provenance and sees_all. The kept row (keep_order = 1: direct before inherited, then oldest)
-- takes sees_all from the anchored rows of its group.
update membership k
   set sees_all = true
  from membership_dedupe_plan p
 where p.id = k.id and p.keep_order = 1 and p.anchored_sees_all and not k.sees_all;

delete from membership
 where id in (select id from membership_dedupe_plan where keep_order > 1);

commit;
```

Re-run the preflight; it must return no rows. Then upgrade. Record the preflight result for every
target environment in the release record.

**Foreign keys into `membership`.** When upgrading from accepted `main` (through 0087) no table
references `membership`, so deleting rows cannot cascade or null anything. A database that already
applied 0090-0092 has `membership_grant.membership_id` and `scim_group_member.membership_id`
(`0090_unique_the_stranger.sql`), both `ON DELETE SET NULL`: deleting a duplicate nulls those
provenance links on rows pointing at it, so review them before deleting.

---

<a id="runbook-upgrading-across-migration-0119-cross-tenant-rows"></a>
### Upgrading across migration 0119: cross-tenant rows

Migration `0119_tenant_composite_fks` replaces two single-column foreign keys with tenant-composite
ones and adds their parent unique keys: `saved_view (workspace_id, shared_with_team_id)` to
`team (workspace_id, id)`, and `notification_delivery (event_id, workspace_id)` to
`outbox (event_id, workspace_id)`. If a row already points across tenants, `ADD CONSTRAINT` fails
and **the whole pending upgrade aborts atomically** (same mechanics as 0093 above). Regardless of whether a prior runtime was expected to write these tables, run the preflight on every target database before upgrading from any version below 0119. It
must return no rows:

```sql
-- saved views shared to a team of a different workspace
select sv.id as saved_view_id, sv.workspace_id, t.id as team_id, t.workspace_id as team_workspace_id
from saved_view sv
join team t on t.id = sv.shared_with_team_id
where t.workspace_id <> sv.workspace_id;

-- deliveries whose workspace differs from the outbox event's workspace
-- (including instance-scoped events whose workspace_id is null)
select nd.id as delivery_id, nd.workspace_id, o.event_id, o.workspace_id as event_workspace_id
from notification_delivery nd
join outbox o on o.event_id = nd.event_id
where o.workspace_id is distinct from nd.workspace_id;
```

Remediation, only if rows are returned: these are anchoring defects, not data to preserve. Take the
pre-upgrade backup first, then for each offending `saved_view` either set `shared_with_team_id`
and `visibility` to a team of the view's own workspace or set `visibility = 'private'` with
`shared_with_team_id = null` (the CHECK `saved_view_team_visibility_consistency` requires the two
to move together), and delete each offending `notification_delivery` row. Deleting a delivery also cascades to its
`outbox_dedupe_reservation` row (0114). No regeneration is guaranteed. An instance-scoped event (null workspace) cannot have a workspace delivery; treat an authorized corrective delete as final and retain its bounded decision record.
Re-run the preflight to confirm no rows, then
upgrade.

<a id="runbook-upgrading-across-migration-0120-approval-anchor"></a>
### Upgrading across migration 0120: approval anchor

Migration `0120_approval_workspace_anchor` adds `approval.workspace_id`, backfills it from each
approval's work item, and replaces the single-column work-item foreign key with the composite
`approval_workspace_work_item_fk`.

**Lock.** The `DROP CONSTRAINT` and the `ADD` of the composite foreign key take an
`ACCESS EXCLUSIVE` lock on `work_item`, and the lock is held until the whole migrator batch
commits. Run the upgrade in a maintenance window, or set `lock_timeout` on the migrator session so
the upgrade fails fast instead of queueing behind traffic.

**Orphan preflight.** If a restored database holds an approval whose work item is missing, the
upgrade fails at `SET NOT NULL` and aborts atomically (same mechanics as 0093 above). Run
this read-only query on every target database below 0120; a past empty table is not evidence for the selected target. It must return no rows:

```sql
select a.id as approval_id, a.work_item_id
from approval a
left join work_item w on w.id = a.work_item_id
where w.id is null;
```

Remediation, only if rows are returned: an approval without its work item is an anchoring defect,
not data to preserve. Take the pre-upgrade backup first, keep the printed rows in the release
record, delete the offending `approval` rows, re-run the preflight to confirm no rows, then upgrade.

<a id="runbook-startup-refuses-incomplete-grant-projection-database-already-at-0119"></a>
### Startup refuses: "incomplete grant projection" (database already at 0119)

A database that already applied migrations 0088 to 0119 (for example from the schema spine)
holds the `membership_grant` table, but legacy `membership` rows were never projected into
grants. The API migrate step (`runMigrationStep`, also `db:migrate` and the
`TASKDESK_ROLE=migrate` process) refuses to start until every such membership has an active
grant: it does not guess a source, and `derived_from IS NULL` is never treated as direct
([ADR 0015](design-and-decisions.md#0015-membership-grant-provenance)). The refusal is atomic
and writes nothing. A database with no unprojected memberships is untouched, and the same
command is safe to rerun.

1. Take the pre-upgrade backup.
2. Produce the read-only inventory (counts printed, create-only mode 0600 report; once the grant
   table exists it lists only the unprojected memberships):

   ```sh
   TASKDESK_DATABASE_URL=<target> pnpm --filter @taskdesk/api db:identity-provenance-preflight \
     --output /secure/path/membership-preflight.json
   ```

   Exit 2 means rows need an owner decision; exit 0 means nothing needs repair.
3. The owner supplies a `taskdesk-membership-provenance-reconciliation/v1` file (private, mode
   0600, at most 4 MiB) with one `direct`/`admin` decision per listed row, naming a current
   instance administrator as `approverPersonId`. **The operator approval gate stays:** the repair
   will not run without this file, and a row it does not cover, a stale digest, or a non-admin
   approver is refused with nothing written.
4. Rerun the migration with the file:

   ```sh
   pnpm --filter @taskdesk/api db:migrate -- \
     --membership-provenance-reconciliation /secure/path/owner-reconciliation.json
   ```

   The grants are inserted and verified in one transaction under the parent-first table locks,
   then the remaining migrations run. Rerunning, with or without the file, changes nothing.

<a id="runbook-verify-a-published-image"></a>
### Verify a published image

Resolve the release tag to a digest first, then check both the cosign signature and the
GitHub build-provenance attestation for that immutable digest. Replace the example digest
with the value printed by `docker buildx imagetools inspect`.

```bash
IMAGE_TAG='v2.0.0' # use edge for the UAT edge channel
SOURCE_SHA='<40-hex-main-commit>'
IMAGE_REF='ghcr.io/thomasheinthura/taskdesk@sha256:<64-hex-digest>'
cosign verify \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  --certificate-identity 'https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main' \
  --annotations "tag=${IMAGE_TAG}" \
  --annotations "source_sha=${SOURCE_SHA}" \
  "$IMAGE_REF"
gh attestation verify "oci://${IMAGE_REF}" \
  --repo ThomasHeinThura/ticketing \
  --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --predicate-type 'https://slsa.dev/provenance/v1'
gh attestation verify "oci://${IMAGE_REF}" \
  --repo ThomasHeinThura/ticketing \
  --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml \
  --source-ref refs/heads/main \
  --predicate-type 'https://github.com/ThomasHeinThura/ticketing/attestations/release-source/v1' \
  --format json \
  | jq -e --arg repo 'ThomasHeinThura/ticketing' \
      --arg source "$SOURCE_SHA" \
      --arg image 'ghcr.io/thomasheinthura/taskdesk' \
      --arg digest "${IMAGE_REF##*@}" \
      'any(.[]; .verificationResult.statement.predicate.sourceRepository == $repo and
        .verificationResult.statement.predicate.sourceRef == "refs/heads/main" and
        .verificationResult.statement.predicate.sourceCommit == $source and
        .verificationResult.statement.predicate.image == $image and
        .verificationResult.statement.predicate.imageDigest == $digest)'
```

All three checks (cosign signature, workflow SLSA provenance, and the selected-source
predicate) must succeed before promoting a digest. The GitHub attestation checks also
require GitHub CLI authentication with read access to the repository. The SLSA predicate
identifies the workflow run that published the image; the separate signed TaskDesk
predicate binds that image digest to the validated source SHA, including when a manual
release selects an older commit on `main`.

---

<a id="runbook-incident-procedure"></a>
### Incident procedure

1. **Contain** — revoke sessions, disable the affected plugin or account, take it offline
   if that is safer than leaving it up.
2. **Communicate** — tell affected users something true, early. Silence is worse than
   "we're investigating".
3. **Assess** — the audit log is the source of truth for what was touched and by whom.
4. **Notify** — affected organisations, per contractual obligation, within the required
   window.
5. **Remediate** — fix, add a regression test, deploy.
6. **Review** — write it up. Root cause, timeline, what was slow, what to change.
   Blameless: the question is what in the system allowed it, not who did it.
7. **Record** — retain the incident finding and any owner decision in the concise maintained evidence/decision record.

---

<a id="runbook-routine-operations"></a>
### Routine operations

| Task | How |
| --- | --- |
| Add a customer organisation | God Mode → Organisations → New |
| Add an identity provider | God Mode → Authentication → Add, then **Test** |
| Suspend a user | God Mode → Users |
| Change SMTP | God Mode → Notifications, then **Test** |
| Enable or disable a feature | God Mode → Features |
| Trigger a job | God Mode → Jobs → Run now |
| Rotate the encryption key | Operator-staged: set `TASKDESK_ENCRYPTION_KEY` (new) + `TASKDESK_ENCRYPTION_KEY_PREVIOUS` (old), restart, then God Mode → Plugins → Rotate secrets (elevated) runs `secrets-rekey`; remove the previous key when Health confirms every row carries the new `key_id`. `GM-12`–`GM-14` |
| Export the audit log | God Mode → Audit → Export |

**Almost nothing here needs a shell.** If a routine operation does, that is a gap in
God Mode and should be recorded as one.

---

<a id="runbook-policy-shadow-summary"></a>
### Policy shadow summary

Issue #8, Slice 2's request-path shadow middleware records every request it evaluates to
`policy_shadow_tally` and, for a disagreement, `policy_shadow_event`
([data-model.md § Policy shadow evidence](data-model.md)).
For development/P0 and UAT verification, this per-router summary reports the user-authorized
three UTC calendar-date window — run against the deployment's own database, not exposed as an
HTTP endpoint. It does not establish production readiness or authorize production promotion;
production-specific go-live criteria apply only when promoting an actual production release.

<a id="runbook-strict-policy-router-cutover"></a>
### Strict policy router cutover

`TASKDESK_POLICY_ENFORCE` is a temporary bootstrap control for strict request-path evaluation
(`apps/api/src/permissions/strict-policy-enforcement.ts`). It accepts a comma-separated list of
exact registered policy-source paths. The default is empty, so no source is enforced. A listed
source is evaluated after that route's existing middleware and request validation, immediately
before its terminal handler. Existing authorization checks continue to run; a registry denial
prevents the handler from starting. The setting is read and validated during API module startup.
An unknown, duplicate, blank, whitespace-padded, or malformed source refuses startup.
The parser requires every other registered source before task and requires task last; it does
not reject arbitrary permutations of non-task sources. Operators use the registry-owned path
order for the staged rollout described below.

For a development or UAT rollout, first establish the documented three real, issue-free UTC
date buckets for the exact source and representative behaviors being considered (see **Policy
shadow summary** above). Record the source/build identity, selected UTC dates, route coverage,
complete summary output, and any explained outcomes with the deployment evidence. Do not
backfill missing observations or count a partial current day as a complete date. Only after
that evidence is accepted should the deployment's operator set the approved exact source list
and restart the API. Add eligible non-task sources in registry-owned path order; the complete
registered set must precede `apps/api/src/task/policy.ts`, which is required to be last. Do not
enable the task router until the role re-key prerequisite is verified and every preceding
source is already enforced. This staged setting does not authorize production promotion.

**Bounded public-config criterion (Thomas, 2026-10-08):** public `GET /api/config` is mounted before the authenticated shadow guard and cannot produce that guard's tally. For this route/source only, use exact-source public-response/source-ordering proof and the independently reviewed disposable config-source strict selection/health/rollback proof as the substitute; preserve actual dated public observations rather than inventing shadow rows. Every other source keeps the shadow/coverage/date requirements above. Config precedes task; the task re-key and last-source prerequisites remain. See the [bounded decision](retained-constraints.md#decision-log-policy-and-runtime-observability). This does not authorize persistent or production cutover by itself.

**Rollback:** remove the affected exact source path from the setting and restart the API. If
the task path is selected, remove it first before removing any preceding source. Setting the
value to empty and restarting returns all routes to their existing authorization plus shadow
mode. Confirm the running deployment's environment through the deployment's protected
configuration interface; never print environment values into a shell transcript or logs. Record
the rollback source/build and reason. A malformed setting intentionally prevents boot, so use
the last known-valid configuration when correcting a startup refusal.

**Per-router, per-date development summary for three UTC dates** (UTC today and the preceding
two dates; agree / disagree / unevaluated counts, by router group and outcome):

```sql
select
  day as utc_day,
  router_group,
  outcome,
  reason_code,
  sum(count) as total,
  max(last_seen_at) as last_seen_at
from policy_shadow_tally
where day >= ((now() at time zone 'UTC')::date - 2)
group by day, router_group, outcome, reason_code
order by day, router_group, outcome, total desc;
```

The inclusive predicate selects exactly three UTC date buckets. Record the selected date
values, source/build identity, and actual source-bound UTC coverage interval with the result.
The current UTC date may be partial: the date buckets alone do not prove three complete days
or 72 hours. Claim three issue-free days only when actual traffic and exercised router/behavior
coverage support all three dates; do not synthesize or backfill missing observations. Existing
representative evidence may count if it covers the same source and behavior.

**"Clean" means zero *unexplained* disagreements** — every `legacy_allow_policy_deny`,
`legacy_deny_policy_allow`, `unevaluated` and `evaluator_error` row above for a router group
must either be fixed or have its `reason_code` explained in the evidence for the window being
assessed. Record each summary output as it stood at decision time so later writes cannot
change the evidence underneath it. Any decision citing this query
must paste the complete output and identify its environment and window; a P0/UAT summary is
not production evidence. **`shadow_saturated` is never explainable row-by-row**: a router with
any such row in the window is not clean, because part of its traffic was never evaluated.

The three-day window applies to P0 development and UAT verification; it is not a seven-day UAT
cutover prerequisite. Actual production promotion remains subject to its production-specific
go-live criteria, which this development query does not satisfy or change.

An event cap can omit details after 50 matching events in a bucket. A non-agree tally bucket
whose count exceeds its event-row count is therefore not explained row by row and cannot be
declared clean. Check for such buckets before reviewing the event details:

```sql
select t.day, t.route_key, t.outcome, t.reason_code,
       t.count as tally_count, count(e.id) as event_count
from policy_shadow_tally t
left join policy_shadow_event e
  on e.day = t.day
 and e.route_key = t.route_key
 and e.outcome = t.outcome
 and e.reason_code is not distinct from t.reason_code
where t.day >= ((now() at time zone 'UTC')::date - 2)
  and t.outcome <> 'agree'
group by t.day, t.route_key, t.outcome, t.reason_code, t.count
having t.count > count(e.id)
order by t.day, t.route_key, t.outcome;
```

**Latest disagreements for one router**, to see exactly what tripped:

```sql
select route_key, outcome, reason_code, legacy_status, policy_status, policy_code,
       identity_kind, workspace_id, trace_id, created_at
from policy_shadow_event
where router_group = :router_group
order by created_at desc
limit 50;
```

**Coverage check** — this reports observed requests per router and UTC date. Compare each
required router group against all three selected dates; a missing date means coverage for that
router is not established and the window is not clean:

```sql
select day as utc_day, router_group, sum(count) as requests_evaluated
from policy_shadow_tally
where day >= ((now() at time zone 'UTC')::date - 2)
group by day, router_group
order by day, requests_evaluated asc;
```

**Coverage share, before vs after a cutover** (issue #324 acceptance criterion 6) — per
router group, what fraction of requests actually got a full policy comparison
(`agree`/`legacy_allow_policy_deny`/`legacy_deny_policy_allow`) rather than
`unevaluated`/`evaluator_error`, split by a chosen cutover day (a deploy date, a slice
boundary, or any other date worth comparing across). Substitute the literal date for
`:cutover_day` — this is a documented query, not a bound parameter:

```sql
select
  router_group,
  round(100.0 * coalesce(sum(count) filter (
    where day < :cutover_day
      and outcome in ('agree', 'legacy_allow_policy_deny', 'legacy_deny_policy_allow')
  ), 0) / nullif(sum(count) filter (where day < :cutover_day), 0), 1) as evaluated_pct_before,
  sum(count) filter (where day < :cutover_day) as total_before,
  round(100.0 * coalesce(sum(count) filter (
    where day >= :cutover_day
      and outcome in ('agree', 'legacy_allow_policy_deny', 'legacy_deny_policy_allow')
  ), 0) / nullif(sum(count) filter (where day >= :cutover_day), 0), 1) as evaluated_pct_after,
  sum(count) filter (where day >= :cutover_day) as total_after
from policy_shadow_tally
group by router_group
order by router_group;
```

A blank `evaluated_pct_before`/`evaluated_pct_after` means that window has no rows at all
for that router group (never exercised in that window), distinct from `0.0` (exercised, but
nothing evaluated) — `nullif`/`coalesce` are load-bearing for exactly that distinction, not
decoration. Those distinctions require actual before/after-count verification; this procedure supplies no passing result.

<a id="runbook-useful-commands"></a>
### Useful commands

```bash
dc logs -f taskdesk
dc exec postgres psql -U "${POSTGRES_USER:-taskdesk}" -d "${POSTGRES_DB:-taskdesk}"
docker stats
df -h && du -sh /var/lib/docker/volumes/*
```

<a id="scaling"></a>
## Scaling
<a id="scaling-where-we-start"></a>
### Where we start

One container, one Postgres, one Valkey — and SeaweedFS only if the S3 profile is enabled;
the default is `storage.filesystem` on a volume. The retained capacity target is 100 concurrent users on the stated resource envelope; it requires actual measurement and is not evidence from a functional-only SIT host.

**Do not optimise past this without measurements.** Every scaling mechanism below has a
cost, and paying it before the load exists is how a simple system becomes an operations
burden.

<a id="scaling-the-order-things-break"></a>
### The order things break

Based on where the pressure actually lands:

```
1. Postgres connections      ← first, and usually the surprise
2. Postgres CPU on reports
3. Node event loop           ← jobs competing with requests
4. Postgres storage
5. Object storage bandwidth
6. WebSocket connections
```

<a id="scaling-1--horizontal-replicas"></a>
### 1 · Horizontal replicas

```yaml
taskdesk:
  deploy:
    replicas: 3
```

Requires `TASKDESK_VALKEY_URL`, which switches the WebSocket adapter to Valkey pub/sub.
Scheduled jobs must preserve their registered lease/claim semantics across replicas; an outbox worker uses its separate claim model.

**Watch the connection pool.** Three replicas at a pool of 20 is 60 connections to a
Postgres whose default `max_connections` is 100. This is the most common way adding
replicas makes things *worse*.

Fix: lower the per-replica pool, or introduce PgBouncer in transaction mode.

<a id="scaling-2--postgres-tuning"></a>
### 2 · Postgres tuning

The first thing to do, and the cheapest.

```
shared_buffers        = 25% of RAM
effective_cache_size  = 75% of RAM
work_mem              = 16MB      # per sort, per connection — be careful
maintenance_work_mem  = 256MB
max_connections       = 200       # with PgBouncer in front
random_page_cost      = 1.1       # SSD
```

Then:

- `pg_stat_statements` to find the expensive queries.
- `EXPLAIN ANALYZE` before adding an index. Guessing at indexes adds write cost for no
  read benefit.
- `VACUUM`/`ANALYZE` autotuning for high-churn tables — `activity`, `notification`,
  `outbox`.

<a id="scaling-3--query-patterns"></a>
### 3 · Query patterns

| Problem | Fix |
| --- | --- |
| N+1 on list endpoints | Load related data in one query, or batch |
| Counting large tables | Estimate above 10,000 and say so in the response |
| Deep offset pagination | Already avoided — cursor pagination only |
| Reports over months | Already avoided — `metric_snapshot` for closed periods |
| Full-text on a large corpus | Require the appropriate GIN index; consider Meilisearch only if measured |

<a id="scaling-4--caching"></a>
### 4 · Caching

Valkey, with short TTLs and explicit invalidation.

| Cached | TTL | Invalidated by |
| --- | --- | --- |
| Resolved identity | 30 s | Membership or role change |
| Feature flag resolution | 60 s | Flag change |
| Branding | 5 min | Branding change |
| Queue counts | 30 s | TTL only |
| Service calendar expansion | 1 h | Calendar change |

**Never cache a policy decision.** Reach and authority are resolved per request; that is
what makes revocation immediate. Caching the *identity* is fine; caching the *answer* is
not.

Losing Valkey degrades performance and never loses data.

<a id="scaling-5--background-jobs"></a>
### 5 · Background jobs

The one real cost of [ADR 0007](design-and-decisions.md#0007-in-process-jobs) is that
jobs share the event loop with requests.

Mitigations, in order:

1. Chunk, and `await` between chunks.
2. Push aggregation into SQL.
3. Reduce cadence for expensive jobs.
4. Dedicate a replica to jobs — `TASKDESK_ROLE=jobs` on one replica (scheduler on, not in
   the proxy's backend pool) and `TASKDESK_ROLE=web` on the rest (scheduler off). This is
   the escape hatch; it needs a switch, not a code change, and the switch exists
   ([configuration-reference.md](configuration.md)).

Monitor `taskdesk_nodejs_eventloop_lag_seconds`. Sustained lag above 100 ms means step 4.

<a id="scaling-6--object-storage"></a>
### 6 · Object storage

Attachments are uploaded and downloaded **directly** via presigned URLs, so bytes never
pass through the application. This is why storage scales independently.

**One exception, stated plainly:** the `storage.filesystem` backend — the single-node
profile small customers run — has no presigned URLs, so bytes stream through the API with
a bounded, back-pressured path and the same size limit. That profile is explicitly not the
one this section is about; a deployment that outgrows it moves to an S3-compatible backend.

At volume: a CDN in front of the files origin, and lifecycle rules moving old objects to
infrequent-access tiers.

<a id="scaling-7--websockets"></a>
### 7 · WebSockets

Each connection costs memory and a file descriptor. Required limits: five sockets
per person per API replica and per socket kind (native and legacy project sockets are
counted separately, in each process, so N replicas allow up to 5N of each), fifty subscriptions per socket, idle close after five minutes.

At several thousand concurrent connections, raise the file descriptor limit and add
replicas. Sticky sessions are not needed — the Valkey adapter fans out across replicas.

<a id="scaling-what-we-will-not-do-preemptively"></a>
### What we will not do preemptively

| Not doing | Until |
| --- | --- |
| Read replicas | Read load measurably exceeds one Postgres |
| Sharding | Far beyond any plausible scale for us |
| Separate worker service | Event loop lag proves the need |
| Elasticsearch / Meilisearch | Postgres full-text is measured to be insufficient |
| Multi-region | A customer requires it contractually |
| Kubernetes as primary | Compose stops being enough |

Each of these is a real answer to a real problem we do not yet have.

<a id="scaling-capacity-planning"></a>
### Capacity planning

| Users | Shape |
| --- | --- |
| ≤ 100 | 1 replica, 2 cores, 4 GiB. The default |
| ≤ 500 | 2 replicas, Valkey, tuned Postgres, 8 GiB |
| ≤ 2,000 | 3–4 replicas, PgBouncer, dedicated Postgres host, 16 GiB |
| > 2,000 | Measure, then decide. Do not extrapolate this table |

<a id="scaling-load-testing"></a>
### Load testing

k6, before each release, with results recorded so regression is visible.

| Scenario | Target |
| --- | --- |
| 100 concurrent browsing | p95 < 500 ms |
| 50 concurrent board views | p95 < 800 ms |
| 1,000 creations per minute | No errors |
| SLA scan over 100,000 items | < 60 s |
| 500 concurrent WebSockets | Stable |

<a id="traefik-and-domains"></a>
## Traefik and domains
Traefik routes by exact hostname and applies security headers. TLS termination is established for the actual selected topology.

<a id="traefik-and-domains-two-app-hostnames-a-conditional-files-origin-and-a-planned-docs-origin"></a>
### Two app hostnames, a conditional files origin, and a planned docs origin

| Hostname | Serves | Why separate | Status |
| --- | --- | --- | --- |
| `ticket.<domain>` | Agent bundle + API + WebSocket | Staff | App origin |
| `portal.<domain>` | Portal bundle + portal API | Separate cookie scope, separate identity providers, no agent code | App origin |
| `files.<domain>` | Attachment downloads — **only when an operator-owned S3 endpoint is served behind this Traefik** (the `--profile s3` SeaweedFS service, or a Garage instance on the same host) | A hostile uploaded file executes against an origin with no application on it | Conditional on storage topology |
| `docs.<domain>` | Public static documentation | Independent public origin, separate static service and cache/content policy; no app session or API proxy | Planned by [docs-site plan](architecture-and-experience.md#plan); no router/service is implemented by this specification |

The two app origins are the subject of
[ADR 0004](design-and-decisions.md#0004-two-portals-two-origins). The files origin is a
straightforward containment measure — and a conditional one. A fresh install using
`storage.filesystem` has the two app hostnames and no files router; real S3 or Azure Blob
supplies its own files origin. Only a self-hosted object store behind this proxy adds the
conditional files record and router below ([deployment.md](#deployment)).

The docs origin is separate from that storage decision. If implemented, it adds its own
`docs.<domain>` router and static service regardless of whether files use local storage or an
external provider. The specification is not deployment evidence.

<a id="traefik-and-domains-environment-prefixed-names"></a>
### Environment-prefixed names

Every router, service and (on the shared-Traefik UAT overlay) middleware name below is
prefixed with the environment it belongs to — `taskdesk-local-*`, `taskdesk-uat-*`,
`taskdesk-prod-*` — never the bare `taskdesk` name all three overlays used before this.

Traefik's Docker provider discovers enabled containers across the host, not only one Compose project/network. Unprefixed router/service names can merge unrelated stacks and send traffic to an unreachable or wrong backend. Environment prefixes are mandatory even when operators expect no stale or parallel container.

<a id="traefik-and-domains-routing"></a>
### Routing

```yaml
labels:
  # agent
  - traefik.http.routers.taskdesk-prod-agent.rule=Host(`ticket.${DOMAIN}`)
  - traefik.http.routers.taskdesk-prod-agent.tls.certresolver=letsencrypt
  - traefik.http.routers.taskdesk-prod-agent.middlewares=security-headers@file,compress@file

  # portal
  - traefik.http.routers.taskdesk-prod-portal.rule=Host(`portal.${DOMAIN}`)
  - traefik.http.routers.taskdesk-prod-portal.tls.certresolver=letsencrypt
  - traefik.http.routers.taskdesk-prod-portal.middlewares=security-headers@file,compress@file

  - traefik.http.services.taskdesk-prod.loadbalancer.server.port=5173
  - traefik.http.services.taskdesk-prod.loadbalancer.healthcheck.path=/api/public/health/ready

  # files — on the storage container, not the application; only with --profile s3
  - traefik.http.routers.taskdesk-prod-files.rule=Host(`files.${DOMAIN}`)
  - traefik.http.routers.taskdesk-prod-files.tls.certresolver=letsencrypt
  - traefik.http.routers.taskdesk-prod-files.middlewares=files-headers@file
  - traefik.http.services.taskdesk-prod-files.loadbalancer.server.port=8333
```

(`deploy/compose.local.yml` uses the same shape with a `taskdesk-local-*` prefix, and
`deploy/compose.uat.yml` with `taskdesk-uat-*` — see those files for the exact labels.)

`files-headers@file` adds `Content-Disposition: attachment` for anything not an image and a
restrictive `Content-Security-Policy: default-src 'none'; sandbox`. **On a real S3 backend
the files host is the bucket's own origin** and this router is not deployed: the files origin
comes from the storage plugin's configured public endpoint, read at runtime, and there is no
environment variable for it ([configuration-reference.md](configuration.md)).

Two things this middleware does **not** do. It does not set the storage backend's CORS — a
presigned POST goes from the browser straight to the storage endpoint, so the **bucket's own**
CORS rules are what admit the agent and portal origins. And it does not affect signatures: a
URL presigned for the internal endpoint will not verify at `files.<domain>`, which is why the
plugin's configured public endpoint must equal the browser-facing one. Both are stated in
full in [deployment.md](#deployment).

Both hostnames reach the same container. The application selects the bundle from the
`Host` header, and the portal boundary middleware rejects a session that does not match.

**The application port is never published in production.** Neither the base `compose.yml`
nor `deploy/compose.prod.yml` declares `ports:` on the `taskdesk` service, and since #752
neither does `deploy/compose.local.yml`; the local stack reaches 5173 through its own
Traefik. It has to be that way round — Compose concatenates `ports:` across files, so an overlay can add a published port
but cannot remove one ([deployment.md](#deployment)). In production, port 5173 is reachable
only on the Docker network Traefik shares with the container.

This is what makes `TASKDESK_TRUST_PROXY=1` safe: the only way a request can arrive is
through exactly one proxy hop, so `X-Forwarded-For` at that hop is the client and a forged
header is discarded. In the **shared-Traefik** pattern below the same rule holds — TaskDesk
attaches to the existing proxy network and publishes nothing — and `install.sh` refuses a
`--env production` install if it finds 5173 already bound on the host
([one-line-install.md](#one-line-install)). That check applies to production installs
only.

**One hop is the count for this arrangement, not a default to carry elsewhere.** Where a CDN
or load balancer sits in front of Traefik there are two appending hops and the value is `2`.
The count is measured — send a request with a deliberately wrong `X-Forwarded-For` and read
what arrives — never inferred from the number of boxes in the diagram. Method and results:
[proxy-topology-evidence.md](#proxy-topology-evidence).

<a id="traefik-and-domains-tls"></a>
### TLS

Everything in this section describes Traefik terminating TLS itself, which is
what `deploy/compose.prod.yml` and `deploy/compose.local.yml` configure. **It is
not true of every host we run.** Where a CDN or load balancer sits in front,
TLS terminates there and Traefik receives plain HTTP on its `web` entrypoint —
no certificate resolver runs, an ACME challenge is never answered, and a
`websecure` router is never matched. A CDN-terminated overlay routes on `web` without an origin-side `certresolver` when the measured topology requires it; a historical UAT example is not proof for another host. Which shape you are in is a measurement, not a
preference: [proxy-topology-evidence.md](#proxy-topology-evidence).

- Let's Encrypt via the ACME HTTP-01 challenge, or DNS-01 where a wildcard is wanted.
- TLS 1.2 minimum; 1.3 preferred.
- HSTS on every response, so plain HTTP is never accepted after the first visit.
  `includeSubDomains` and `preload` are the operator's opt-in — see below.
- Certificates are auto-renewed. Expiry inside 14 days raises an alert — a certificate
  that quietly failed to renew is a classic Sunday-morning outage.

<a id="traefik-and-domains-security-headers"></a>
### Security headers

Applied by a file-provider middleware so they are declared once and cannot drift between
routers.

**Standalone file-provider contract:** load the repository's dynamic middleware file without a host-UID inotify dependency (`--providers.file.watch=false`). When watching is off, a bind-mounted file-content change alone does not guarantee Compose recreation; explicitly restart/recreate Traefik or rerun the deploy path to apply it. Missing file-provider middleware can leave every application/files router returning 404 while containers still appear up. A shared proxy that does not load this repository's file provider uses its own explicitly configured middleware or environment-prefixed Docker middleware labels; changing a watch flag cannot make an absent file provider exist.

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
[security-model.md](safety-and-runtime.md#security-model).

`preload` on `Strict-Transport-Security` is only meaningful once the **apex** domain is
submitted to the browser preload list, and `includeSubDomains` on an apex that also serves
unrelated services is a footgun. Both are **opt-in for the operator**, through
`TASKDESK_HSTS_PRELOAD` in `deploy/.env` — a Compose-only switch that selects which headers
middleware the routers use. The application never reads it; it is one of the variables listed
under "Variables the application does not read" in
[configuration-reference.md](configuration.md). The header block above shows the
opted-in form; the default omits both directives.

<a id="traefik-and-domains-websocket"></a>
### WebSocket

Traefik forwards upgrades without configuration. What does need attention:

- Idle timeout above the application's 30-second heartbeat, or connections are culled
  mid-conversation.
- Sticky sessions are **not** required — the Valkey adapter handles cross-replica fan-out.

<a id="traefik-and-domains-rate-limiting"></a>
### Rate limiting

A first line at the edge, above the application's own per-identity limits:

```yaml
rateLimit:
  average: 100      # requests per second per source
  burst: 1000      # a cold page load fetches many assets at once
```

The edge limit is crude and protects the process. The application's limits are
identity-aware and enforce policy. Both are wanted.

<a id="traefik-and-domains-local-development"></a>
### Local development

Local Traefik with a self-signed certificate, so the production label configuration is
exercised rather than being first tested in UAT.

`*.localhost` resolves to `127.0.0.1` in most browsers. Where it does not, add:

```
127.0.0.1  ticket.localhost portal.localhost
```

Add `files.localhost` too when running the `s3` profile locally.

**Port conflict with an existing reverse proxy.** The bundled local Traefik publishes
80/443, and a "clean machine" is the target, but plenty of real development hosts already
run something else on those ports (Dokploy, nginx, another app). Compose fails the whole
`up` when a published port is already bound, so `scripts/deploy.sh local` checks both ports
before starting anything and fails with instructions rather than a bare Docker "address
already in use". Fix: set `TASKDESK_LOCAL_HTTP_PORT` and/or `TASKDESK_LOCAL_HTTPS_PORT` in
`.env` to free ports (e.g. `8080` / `8443`), and add the HTTPS port to `TASKDESK_AGENT_URL` /
`TASKDESK_PORTAL_URL` and to the browser URL (host-file entries contain hostnames, not ports), e.g.
`https://ticket.localhost:8443`. `scripts/deploy.sh` prints this same reminder in its final
URLs when a non-default port is in play ([configuration-reference.md](configuration.md)).

This check is a best-effort pre-flight, not exhaustive — every case below fails open to the
same raw Docker error this exists to improve on, never to a silent skip of a real conflict:
it only probes `127.0.0.1`, so a listener bound only to `::` (with no dual-stack) or to a
specific non-loopback address is missed; and it does **not** catch a second checkout of
*this same repository* — `compose.yml` pins `name: taskdesk`, so a second checkout's
already-running local Traefik shares that Compose project, `docker compose port traefik`
succeeds against it, and `up` reads it as this stack's own and adopts it rather than
flagging a conflict This can adopt/recreate another checkout's containers; verify project ownership explicitly and do not treat it as a safe conflict detector.

**Loopback only (#752).** The local overlays bind every published port to loopback:
Traefik's HTTP and HTTPS ports on IPv4 `127.0.0.1` and IPv6 `[::1]`, and Postgres on
`127.0.0.1:5432`. The
application port `5173` is not published at all. Traefik reaches it over the `taskdesk`
network, `scripts/deploy.sh` probes it from inside the container, and the container health
check runs inside the container too. A host-published `5173` would bypass Traefik, and with
`TASKDESK_TRUST_PROXY=1` anything that reached it could forge `X-Forwarded-For`. A local
stack is therefore not reachable from another machine. To reach it from one deliberately,
add your own untracked Compose overlay that re-publishes Traefik's ports on the address you
choose (`ports: !override`), and only Traefik's ports: never the application, database,
cache or mail ports.

`scripts/deploy.sh local` prints this. It creates a self-signed **leaf** certificate for
the local routes in `deploy/local/certs/`; it is not a certificate authority. Trust
`local.crt` on the development machine to stop browser warnings. `DOMAIN` must be a valid
DNS name. If the certificate is missing a route name or expires within 30 days, the script
preserves the existing certificate/key in a private `replaced-*` directory before renewal.

<a id="traefik-and-domains-dns"></a>
### DNS

| Record | Type | Target |
| --- | --- | --- |
| `ticket.<domain>` | A / AAAA | Host |
| `portal.<domain>` | A / AAAA | Host |
| `files.<domain>` | A / AAAA | Host — **only when the files router is deployed** |

Or one wildcard `*.<domain>` with DNS-01 certificate issuance, which is simpler to operate
and is the recommended approach when the domain permits it.

`install.sh` checks the third record only when `--files-host` is in play; on a
`storage.filesystem` install it is not created and not checked
([one-line-install.md](#one-line-install)).

<a id="traefik-and-domains-shared-traefik"></a>
### Shared Traefik

Where Traefik already exists on the host serving other applications — v1's arrangement —
TaskDesk attaches to the existing network and contributes only its labels. The
`compose.prod.yml` overlay assumes this and declares the network as external.

<a id="traefik-and-domains-failure-modes"></a>
### Failure modes

| Symptom | Usual cause |
| --- | --- |
| 404 from Traefik | Router rule does not match; check `DOMAIN` and the labels |
| 502 | Container unhealthy or wrong service port |
| Certificate not issued | HTTP-01 blocked, or DNS not yet propagated |
| WebSocket disconnects every 60 s | Traefik idle timeout below the heartbeat |
| Portal shows the agent application | `Host` header not forwarded, or `TASKDESK_PORTAL_URL` mismatched |
| Redirect loop | `TASKDESK_TRUST_PROXY=0` behind TLS termination — set it to the real hop count (`1` for the shipped compose). **Or**: TLS terminates at a CDN in front of Traefik, so `X-Forwarded-Proto` arriving at the application says `http` even though the viewer used HTTPS. Raising the hop count does not fix that one; fixing it means setting the header at the CDN ([proxy-topology-evidence.md](#proxy-topology-evidence)) |
| Every request rate-limited as one client | `TASKDESK_TRUST_PROXY` too low — the proxy's address is being read as the client |
| A forged `X-Forwarded-For` moves the rate-limit bucket | `TASKDESK_TRUST_PROXY` too **high**, or the application port is published so the proxy can be bypassed entirely |

<a id="aws-marketplace"></a>
## AWS Marketplace listing
- **Listing model preference:** a **BYOL / contract** listing rather than self-hosted usage metering — the metering path needs anti-tamper guarantees that an AGPL self-hosted image cannot honestly give ([risks.md](retained-constraints.md#risks) R18); `license.aws-marketplace` metering stays an optional plugin per [ADR 0013](design-and-decisions.md#0013-marketplace-metering-plugin) if a metered tier is ever wanted
- **Depends on:** a feature-complete product, the external penetration test (R19)

The external AWS requirements below are a retained submission checklist, not a current-policy verification or a listing approval. Revalidate them against official AWS Marketplace documentation before submission or spending. Listing/entitlement remains an explicit owner commercial decision; it does not add a hosted control plane or change application permissions.

<a id="aws-marketplace-listing-type-container-product-not-saas-not-ami"></a>
### Listing type: container product, not SaaS, not AMI

TaskDesk runs entirely inside the **customer's own AWS account**, with no control plane we
operate. AWS's own SaaS architecture rules require a SaaS listing's control plane to sit in
infrastructure the *seller* manages — otherwise AWS classifies it as a "managed service,"
not SaaS — so a purely self-hosted product does not qualify for a SaaS listing. A
standalone AMI listing is not needed either, since we ship a container, not a VM image.

**The fit is a Container-based product**: the Docker image plus the Helm chart as a
"delivery option," deployable on EKS, ECS, Fargate, EKS Anywhere, ECS Anywhere, ROSA,
self-managed on-prem Kubernetes, or plain EC2. A product may declare up to four delivery
options — worth knowing if a bare-Compose delivery option is ever added alongside Helm.

<a id="aws-marketplace-security-review-is-automatic-and-mandatory"></a>
### Security review is automatic and mandatory

Every "Add Version" submission gets an AWS-run, layer-by-layer static vulnerability scan;
critical or remotely-exploitable findings block publishing outright. AWS recommends
pre-scanning with a tool such as Trivy — which [Security model](safety-and-runtime.md#security-model)
already runs in CI — before ever submitting. Mandatory container policies, all already
consistent with our own [security model](safety-and-runtime.md#security-model):

- No known vulnerabilities, malware, or end-of-life packages in the image.
- **No embedded AWS credentials, ever** — IAM roles for service accounts (IRSA on EKS) or
  IAM roles for tasks (ECS) only.
- Least-privilege IAM, non-root containers by default.
- No hardcoded secrets, and no password-based auth for any bundled service — including a
  generated or reset password. `auth.password` in our own [plugin
  architecture](architecture-and-experience.md#plugin-architecture) is administrator-configured at
  runtime, never a bundled default credential, so a configured local-auth method must not be confused with embedded default credentials; actual submission compliance still requires verification.

**Vendor Insights:** the retained contract treats this as outside the container listing; revalidate external eligibility instead of claiming an unsupported certification or evidence capability.

<a id="aws-marketplace-metering-and-entitlement"></a>
### Metering and entitlement

Handled entirely by the `license.aws-marketplace` plugin from
[ADR 0013](design-and-decisions.md#0013-marketplace-metering-plugin), which:

- Resolves the buyer's entitlement via the AWS Marketplace **Entitlement Service**.
- Meters usage via the AWS Marketplace **Metering Service** — `MeterUsage` for a
  self-defined pricing dimension (for example, active-agent-seats per month), or
  `RegisterUsage` for AWS's own per-running-task/pod hourly metering.
- For a contract or annual-commit price instead of metered usage, integrates **AWS License
  Manager**, which holds the entitlement but performs no metering of its own — that
  responsibility stays with the plugin.

Both metering calls must resolve the AWS region dynamically at runtime (a hardcoded region
throws `InvalidRegionException`) and must authenticate via an IAM role, never an embedded
key — consistent with the container-security policy above and with [security
model](safety-and-runtime.md#security-model)'s existing secret-handling rules.

**Anti-tamper — an open commercial risk, not a design task.** AWS's container policy says a
seller must ensure a buyer cannot bypass or substitute the metering call. In this product
that is **structurally unsatisfiable**: the buyer *is* the instance administrator who
enables and configures every plugin, including `license.*`, in God Mode; and under AGPL
the buyer may lawfully modify the source. Metering integrity in a self-hosted AGPL product
is therefore **contractual, not technical**, and the listing has to be chosen with that
understood. The options, recorded as **R18** in [risks.md](retained-constraints.md#risks):

1. **A BYOL / contract listing with no usage metering — recommended.** The buyer pays a
   fixed price through AWS; the `license.aws-marketplace` plugin only resolves entitlement
   (which tier) via License Manager. Removes the anti-tamper requirement entirely.
2. Hourly `RegisterUsage` per running task, which AWS itself performs at the container
   runtime — but it must then run **unleased on every replica** at start, the opposite of
   the lease model every other job uses; write that into the plugin if chosen.
3. Do not list.

Position to be taken before P7 starts, with AWS Partner Business Development consulted.

**AGPL §6 — corresponding source.** Distributing the image to a buyer through the
Marketplace ECR repository is *distribution* under AGPL §6, not only network use under §13:
the corresponding source for exactly that build must accompany or be offered with it. The
listing links the tagged source release (the same SHA the image's provenance attestation
names); the entitlement gate is contractual because the buyer may lawfully remove it.

<a id="aws-marketplace-helm-chart-requirements"></a>
### Helm chart requirements

AWS validates the chart at submission:

- Image references live only in `values.yaml`, as variables — never hardcoded elsewhere in
  a template.
- `helm lint` and `helm template` must pass cleanly, against Helm ≥ 3.19.0.
- **Every image the chart references — including open-source dependencies — must be pushed
  into the AWS-Marketplace-owned ECR repository created for the listing.** Docker Hub,
  Quay, or a public ECR reference is not accepted. This affects our own Helm chart's
  dependency images (for example, a Traefik or PgBouncer sidecar, if either is ever
  bundled by the chart rather than left to the cluster operator) and should be checked
  explicitly when the chart is finalised, not assumed away.
- A ServiceAccount the chart creates by default (`serviceAccount.create=true`), with
  narrowly-scoped RBAC — named `resourceNames`, never a wildcard.

<a id="aws-marketplace-agpl-and-the-buyers-own-obligation"></a>
### AGPL and the buyer's own obligation

None of AWS's container, AMI or SaaS policy pages address open-source licence type one way
or the other — it is not a stated blocker, but it is also not confirmed as a non-issue by
AWS itself, and is worth a direct question to AWS Partner / Marketplace Business
Development before relying on the assumption.

What is certain regardless of AWS's position: **AGPL's network-copyleft obligation lands
on the buyer, not on us** — see [ADR 0013](design-and-decisions.md#0013-marketplace-metering-plugin)
and [Licensing and attribution](retained-constraints.md#licensing-and-attribution). A company
that procures TaskDesk through AWS Marketplace and offers *their own* users a service built
on it must, in turn, make the corresponding source available to those users. The listing
description and buyer-facing documentation must say this plainly — it is easy for a buyer
unfamiliar with AGPL to miss, and a support conversation is a bad place to discover it.

<a id="aws-marketplace-seller-registration-checklist"></a>
### Seller registration checklist

1. Confirm the seller's country is eligible for direct AWS Marketplace registration
   (unsupported countries must sell through a reseller).
2. A dedicated seller AWS account, least-privilege IAM, root access locked down.
3. Company profile: display name, site, a short bio, and a logo (≤ 500 KB, SVG or PNG,
   300×150).
4. Tax forms — W-9 for a US entity, W-8BEN or W-8BEN-E plus VAT/GST details otherwise.
5. A US bank account, or a Hyperwallet virtual account, for payouts.
6. Accept the AWS Marketplace Seller Terms and Conditions.
7. In the Marketplace Management Portal: **Product → Server → Create server product →
   Container** — generate the product ID and code, add the dedicated ECR repository, add
   the initial version, wire up `MeterUsage`/`RegisterUsage` or License Manager if the tier
   is paid, and submit an "Update visibility" request from Limited to Public once AWS
   Seller Operations review passes.
8. A paid listing is required to start at a placeholder price (commonly $0.01) for internal
   testing before the real price is set at go-public.
9. Default listing cap is 20 public container-product listings per seller account; a higher
   cap is discretionary and tied to seller performance.

<a id="aws-marketplace-timing-and-decision-boundary"></a>
<a id="aws-marketplace-timing"></a>
### Timing and decision boundary

Marketplace packaging depends on a feature-complete distribution, verified image/chart delivery, corresponding source, commercial listing choice and external security requirements. Seller onboarding has lead time; start it only when the owner schedules the listing. Historical month/date estimates are not a delivery promise or authorization to submit a product.

## Conflicts, applicability and remaining decisions

- **Workload/chart shape:** the retained single-Deployment/replicaCount/existing-secret compatibility table and the target web/jobs/secret values are different contracts. Rendering one does not prove the other. Reconcile explicitly before claiming Helm/Compose parity; never expose the migration owner credential to serving containers.
- **Migration timing:** older prose said migrations ran inside application startup. The isolated one-shot migration role before serving is the governing credential-separation requirement. Legacy frontier SQL is not a universal repair for a newer schema/provenance model.
- **Local mail (Thomas,26 October):** the single local Compose stack may expose the fixed Mailpit capture mode only with `TASKDESK_LOCAL_MAILPIT_CAPTURE=true` and both approved `.localhost` HTTPS origins. An instance administrator selects and enables the persisted capture setting; it uses only `mailpit:1025`, no credentials/TLS, and clears prior SMTP credentials. Public deployments cannot activate this mode. An optional capture inbox is not automatically configured as the sender. Use actual persisted SMTP administration; production notify/webhook/import destinations cannot use a private-address bypass. A local synthetic receiver is evidence only for that authorized test path.
- **Promotion/topology:** old automatic UAT diagrams, example domains and historical hop counts do not authorize deployment or establish the Technexus proxy chain. Follow local-first verification, then the selected source/signature/digest and actual topology evidence; retain current owner-selected hosts and proxy settings.
- **Capacity:** resource tables are targets and contain different envelopes (aggregate service limits versus application-host shorthand). The 2-vCPU functional SIT host is not performance evidence. Preserve all budgets and measure on the relevant hardware; do not alter thresholds to claim a pass.
- **Restore isolation versus provider checks:** an isolated drill has no outbound route and must not send restored mail/webhooks to real recipients. Real-provider verification requires a separately authorized protected target or injected synthetic provider; record which checks are blocked by isolation rather than disabling it or claiming them passed.
- **Recovery scope:** work-item soft-delete windows, attachment minimum recovery time and irreversible retention/hard-purge operations differ. A blanket 30-day disaster-table shorthand does not extend every attachment window; verify the target's retained contract and reachable restore journey.
- **Fallback verification:** raw Compose and `--skip-verify` are explicitly labeled exceptional operator opt-outs, not the default deploy path or acceptance evidence for signed CI-built SIT images. No failed signature check silently falls back.
- **External listing rules:** AWS submission limits, commercial onboarding, APIs and licensing positions are retained requirements requiring current authoritative revalidation before submission. A normal release scan policy does not establish Marketplace acceptance or an external penetration test.
- **Strict-policy observations:** local-first feedback removes unnecessary remote waiting, not truthful dated security evidence. Do not invent or backfill the retained source/date/coverage record, confuse development observations with production promotion, or call a partial date a complete day.

## Related maintained references

Referenced operational and product decisions now resolve to maintained clauses below. Historical source names are provenance, not archive dependencies or acceptance. Current [requirements](../requirements.md) and [alignment](../alignment.md) retain unresolved decisions and scope.

<a id="pending-docs00-overviewlicensing-and-attribution"></a>
- [Maintained clause](retained-constraints.md#licensing-and-attribution); historical source: `docs/00-overview/licensing-and-attribution.md`.
<a id="pending-docs01-architectureadr0002-single-backend"></a>
- [Maintained clause](design-and-decisions.md#0002-single-backend); historical source: `docs/01-architecture/adr/0002-single-backend.md`.
<a id="pending-docs01-architectureadr0004-two-portals-two-origins"></a>
- [Maintained clause](design-and-decisions.md#0004-two-portals-two-origins); historical source: `docs/01-architecture/adr/0004-two-portals-two-origins.md`.
<a id="pending-docs01-architectureadr0007-in-process-jobs"></a>
- [Maintained clause](design-and-decisions.md#0007-in-process-jobs); historical source: `docs/01-architecture/adr/0007-in-process-jobs.md`.
<a id="pending-docs01-architectureadr0013-marketplace-metering-plugin"></a>
- [Maintained clause](design-and-decisions.md#0013-marketplace-metering-plugin); historical source: `docs/01-architecture/adr/0013-marketplace-metering-plugin.md`.
<a id="pending-docs01-architectureadr0015-membership-grant-provenance"></a>
- [Maintained clause](design-and-decisions.md#0015-membership-grant-provenance); historical source: `docs/01-architecture/adr/0015-membership-grant-provenance.md`.
<a id="pending-docs04-engineeringmigrations"></a>
- [Maintained clause](design-and-decisions.md#migrations); historical source: `docs/04-engineering/migrations.md`.
<a id="pending-docs07-planningdecision-log"></a>
- [Maintained clause](retained-constraints.md#decision-log); historical source: `docs/07-planning/decision-log.md`.
<a id="pending-docs07-planningdecision-log-2026-10-08--bounded-public-config-cutover-criterion-substitute"></a>
- [Maintained clause](retained-constraints.md#decision-log-policy-and-runtime-observability); historical source: `docs/07-planning/decision-log.md#2026-10-08--bounded-public-config-cutover-criterion-substitute`.
<a id="pending-docs07-planningrelease-plan"></a>
- [Maintained clause](retained-constraints.md#release-plan); historical source: `docs/07-planning/release-plan.md`.
<a id="pending-docs07-planningrisks"></a>
- [Maintained clause](retained-constraints.md#risks); historical source: `docs/07-planning/risks.md`.
