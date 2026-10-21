# Container image

One image serves the API, the agent bundle, the portal bundle, the scheduler and the CLI.
This is its specification; [ci-cd.md](../04-engineering/ci-cd.md) builds it. Written
2026-09-05.

The image includes `apps/api/dist/seed-sit-users.js`, bundled with the application build
and using the installed production dependencies. `scripts/deploy.sh local` invokes it
inside the application container; the explicit `--sit` argument is required. It is never
invoked by normal application startup or production deployment.

## Build and target platforms

The toolchain/dependency/build stages run on Docker's `BUILDPLATFORM`. TypeScript,
esbuild and Vite produce CPU-independent JavaScript/static assets once, avoiding a
second Vite/Rolldown build under QEMU for arm64. The production dependency install and
runtime use the requested target platform. Production `node_modules` are installed
separately on that platform; never copy the build host's dependency tree into the runtime.
Both linux/amd64 and linux/arm64 remain published, scanned and signed. The existing
release timeout, provenance and SBOM requirements remain unchanged.

## Stages

The executable definition is [Dockerfile](../../Dockerfile).

| Stage | Platform | Responsibility |
| --- | --- | --- |
| `base` | Build host | Pinned Node/pnpm toolchain |
| `deps` | Build host | Frozen workspace dependency install |
| `build` | Build host | API/seed JavaScript and both static web entries |
| `proddeps` | Target CPU | Separate production API/workspace dependency install |
| `runtime` | Target CPU | Non-root Node, target dependencies, built JavaScript/static assets and migrations |

Only production dependencies from `proddeps` reach the runtime. Build-stage copies into
runtime are generated JavaScript, static assets, manifests and migrations; native build
host binaries or `node_modules` do not cross that boundary.


## Entrypoint

```
1. validate the five required environment variables; exit 1 with a clear message if absent
2. if TASKDESK_ROLE = migrate: take the migration advisory lock, run migrations,
   create/repair the application role and its grants, release, exit 0   (migrations.md)
3. otherwise (TASKDESK_ROLE = web | jobs | all): refuse to start if the owner/migration
   credential is present in this process's own environment at all; refuse to start if the
   application connection turns out to be a superuser or owns anything (migrations.md,
   issue #296)
4. if TASKDESK_ROLE != jobs: start the HTTP listener (API + both bundles by Host header)
5. if TASKDESK_ROLE != web:  start the scheduler
6. readiness true
```

Step 2 and step 3 never both run in the same process (issue #296, S1 — independent Opus
5.5 review of PR #308): migrations and the database role/grant bootstrap run in a
separate, one-shot `TASKDESK_ROLE=migrate` invocation of this same image — run once
before the serving process starts, never inside it. In compose that is the `migrate`
service; in Kubernetes (the Helm chart) it is an initContainer on the same Pod. A
single-container deployment with no orchestrator support for either shape runs the image
twice: once with `TASKDESK_ROLE=migrate` and the owner URL, then normally with the
application URL only — see [configuration-reference.md](configuration-reference.md)'s
Local development section for the exact two commands.

`HEALTHCHECK` calls `/api/public/health/live` — process up, touches no dependency — so a
Postgres blip never restarts a healthy container; readiness is the load balancer's concern.

It is a `wget` one-liner, the same shape kaneo uses, and deliberately **not** a
`dist/healthcheck.js`: the build declares two esbuild entries (`index`, `cli`), so a third
output nothing produces would leave the container permanently `unhealthy` — and
`up -d --wait` blocks on exactly that ([deployment.md](deployment.md)).

Migrations run at boot under an advisory lock; the mechanism, the ordering and the two-phase
rule for destructive changes are in
[migrations.md](../04-engineering/migrations.md) and are not restated here.

## The CLI

`dist/cli.js` is a second esbuild entry from `apps/api/src/cli.ts`, sharing the API's
modules. Commands are in the [runbook](runbook.md). Because it needs the database URL and
the encryption key, it runs **inside the container** (`docker compose exec taskdesk node
dist/cli.js …`), never against the database from elsewhere.

## Native dependencies

`esbuild --packages=external` leaves `pg` and any native addon to `node_modules`, which
the target-platform production install prunes correctly. If `sharp` (image thumbnails) is adopted, it is the
one package that needs the glibc base — which is why the base is `bookworm-slim`, not
alpine, until measured otherwise.

## Multi-arch, signing, size

- `docker buildx build --platform linux/amd64,linux/arm64`, pushed by digest.
- Signed with cosign (keyless) and attested with build provenance
  ([ci-cd.md](../04-engineering/ci-cd.md) step 8); the same identity signs the release
  archive ([one-line-install.md](one-line-install.md)).
- Trivy gate: high/critical **with a fix available** fails the release (`ignore-unfixed:
  true`, decision log 2026-09-27 — a finding with no vendor fix yet doesn't block). Target
  size under 250 MB compressed; the
  `check:bundle-size` budget applies to the web bundles separately.

## Traceability

The three OCI labels identify the commit and the signed digest of any image. The running
process is traced through them (`docker inspect`), not through the application:
`GET /api/public/health/live` is a dependency-free liveness probe that returns only
`{"status":"ok"}`.

## Related

- [Deployment](deployment.md) · [CI/CD](../04-engineering/ci-cd.md) · [Migrations](../04-engineering/migrations.md)
