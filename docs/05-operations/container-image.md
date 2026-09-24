# Container image

One image serves the API, the agent bundle, the portal bundle, the scheduler and the CLI.
This is its specification; [ci-cd.md](../04-engineering/ci-cd.md) builds it. Written
2026-09-05.

## Stages

```dockerfile
FROM node:24-bookworm-slim AS base          # glibc: pg, sharp and native addons build cleanly; alpine is an option later
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

FROM node:24-bookworm-slim AS runtime
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
  CMD wget --spider -q http://127.0.0.1:5173/api/public/health/live || exit 1
ENTRYPOINT ["./entrypoint.sh"]
LABEL org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_TIME org.opencontainers.image.source=https://github.com/<org>/taskdesk \
      org.opencontainers.image.licenses=AGPL-3.0
```

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
`pnpm deploy --prod` prunes correctly. If `sharp` (image thumbnails) is adopted, it is the
one package that needs the glibc base — which is why the base is `bookworm-slim`, not
alpine, until measured otherwise.

## Multi-arch, signing, size

- `docker buildx build --platform linux/amd64,linux/arm64`, pushed by digest.
- Signed with cosign (keyless) and attested with build provenance
  ([ci-cd.md](../04-engineering/ci-cd.md) step 8); the same identity signs the release
  archive ([one-line-install.md](one-line-install.md)).
- Trivy gate: high/critical fails the release. Target size under 250 MB compressed; the
  `check:bundle-size` budget applies to the web bundles separately.

## Traceability

The three OCI labels plus `GET /api/public/health/live` returning `{ version, sha }` mean
any running container can be traced to a commit and its signed digest.

## Related

- [Deployment](deployment.md) · [CI/CD](../04-engineering/ci-cd.md) · [Migrations](../04-engineering/migrations.md)
