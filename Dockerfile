# TaskDesk — one image: API + agent bundle + portal bundle + scheduler.
#
# Specification: docs/05-operations/container-image.md
# This file replaces Dockerfile.kaneo, which cannot build in this tree: it COPYs
# apps/web/nginx.kaneo.conf, apps/web/env.sh and deploy/kaneo-entrypoint.sh, none
# of which the kaneo import copied in.
#
# Build (single arch, verification):
#   docker build -t taskdesk:dev .
# Build (release, multi-arch, pushed by digest — see docs/04-engineering/ci-cd.md):
#   docker buildx build --platform linux/amd64,linux/arm64 --push .
#
# Deviations from container-image.md, and why:
#   * `pnpm deploy --prod /out/api` is NOT used. Neither @taskdesk/email nor
#     @taskdesk/permissions declares a `files` field, and their build output
#     (`dist/`) is gitignored, so `pnpm deploy` would copy the workspace packages
#     without the compiled JavaScript the API imports at runtime. The runtime
#     stage therefore keeps the pnpm workspace layout and installs a pruned
#     production tree with `pnpm install --prod`.
#   * wget is installed explicitly. container-image.md assumes it is present
#     (kaneo's image was Alpine, where busybox provides it); node:24-bookworm-slim
#     ships neither wget nor curl, so the documented HEALTHCHECK would fail on a
#     missing binary rather than on a missing endpoint.

ARG NODE_IMAGE=node:24.20.0-bookworm-slim

# ---------------------------------------------------------------------------
# base — toolchain only
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    CI=true \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate
WORKDIR /repo

# ---------------------------------------------------------------------------
# deps — every workspace manifest, then one cached install
# ---------------------------------------------------------------------------
FROM base AS deps
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/email/package.json packages/email/
COPY packages/libs/package.json packages/libs/
COPY packages/mcp/package.json packages/mcp/
COPY packages/permissions/package.json packages/permissions/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build — API bundle (esbuild) and web bundle(s) (vite)
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm turbo build --ui=stream --filter=@taskdesk/api --filter=@taskdesk/web
#   api: esbuild --bundle --platform=node --packages=external -> apps/api/dist/index.js
#   web: vite build                                           -> apps/web/dist
# When #9 splits the web app into two entries the output becomes
# apps/web/dist/agent and apps/web/dist/portal; both land under /app/public
# below, so this stage does not change.

# ---------------------------------------------------------------------------
# proddeps — pruned production node_modules for the API only
# ---------------------------------------------------------------------------
FROM base AS proddeps
COPY --from=build /repo/.npmrc /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=build /repo/apps/api/package.json apps/api/
COPY --from=build /repo/packages/email/package.json packages/email/
COPY --from=build /repo/packages/libs/package.json packages/libs/
COPY --from=build /repo/packages/permissions/package.json packages/permissions/
COPY --from=build /repo/packages/typescript-config/package.json packages/typescript-config/
# apps/web and packages/mcp are deliberately absent: neither ships in the runtime
# image, and their dependency trees are the bulk of the workspace.
# --ignore-scripts also skips the root `prepare: husky`, which cannot run without
# the husky devDependency.
RUN NODE_ENV=production pnpm install --prod --frozen-lockfile --no-optional --ignore-scripts

# ---------------------------------------------------------------------------
# runtime — production only, non-root
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

# wget is the healthcheck client and nothing else; see the deviation note above.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 taskdesk \
 && useradd --system --uid 10001 --gid taskdesk --home-dir /app --shell /usr/sbin/nologin taskdesk

WORKDIR /app

# Production dependency tree (pnpm workspace layout — the API bundle imports
# @taskdesk/email and @taskdesk/permissions as external packages).
COPY --from=proddeps --chown=taskdesk:taskdesk /repo/node_modules ./node_modules
COPY --from=proddeps --chown=taskdesk:taskdesk /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=proddeps --chown=taskdesk:taskdesk /repo/packages ./packages

# Built workspace packages (dist/), overlaying the manifests copied above.
COPY --from=build --chown=taskdesk:taskdesk /repo/packages/email/dist ./packages/email/dist
COPY --from=build --chown=taskdesk:taskdesk /repo/packages/permissions/dist ./packages/permissions/dist

# The API bundle and its migrations. The migrator resolves
# `${dirname(index.js)}/../drizzle`, so these two paths are a pair.
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/api/drizzle ./apps/api/drizzle
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/api/package.json ./apps/api/package.json

# Web bundles, served by the Node process and selected by Host header.
COPY --from=build --chown=taskdesk:taskdesk /repo/apps/web/dist ./public
# vite builds with `sourcemap: "hidden"` for Sentry, which uploads the maps from
# the build stage. Shipping them in the runtime image would put 39 MB of
# application source under a public directory; strip them here.
RUN find ./public -type f -name '*.map' -delete

# Licence and attribution travel with the image (AGPL-3.0 + kaneo's MIT notice).
COPY --chown=taskdesk:taskdesk NOTICE LICENSE THIRD-PARTY-NOTICES.md ./
COPY --chown=taskdesk:taskdesk deploy/entrypoint.sh ./entrypoint.sh
RUN chmod 0555 ./entrypoint.sh

# Attachment bytes for the default storage.filesystem backend. It exists in the
# image, owned by the runtime user, so that a fresh named volume mounted here
# inherits that ownership instead of being created root-owned and unwritable.
#
# No VOLUME directive: Compose and Helm both mount this path explicitly, and a
# VOLUME here would additionally create an anonymous volume on every plain
# `docker run`.
RUN mkdir -p /app/data/attachments && chown -R taskdesk:taskdesk /app/data

USER taskdesk

ENV NODE_ENV=production \
    TASKDESK_PORT=5173

EXPOSE 5173

# Liveness only: the process is up, no dependency touched, so a Postgres blip
# never restarts a healthy container. Readiness is the load balancer's concern
# (/api/public/health/ready).
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget --spider -q "http://127.0.0.1:${TASKDESK_PORT}/api/public/health/live" || exit 1

ENTRYPOINT ["./entrypoint.sh"]

ARG VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
LABEL org.opencontainers.image.title="TaskDesk" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$GIT_SHA \
      org.opencontainers.image.created=$BUILD_TIME \
      org.opencontainers.image.source="https://github.com/ThomasHeinThura/ticketing" \
      org.opencontainers.image.licenses="AGPL-3.0"
