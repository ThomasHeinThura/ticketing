#!/usr/bin/env bash
# Boots TaskDesk from the current checkout for the parity capture (CI only).
# The application port is published to loopback by a throw-away override; this never
# touches the repository's compose files and is not a deployment path.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
work="${RUNNER_TEMP:-/tmp}/parity-ours"
mkdir -p "$work"
cat > "$work/env" <<ENV
TASKDESK_AGENT_URL=http://agent.localhost:5173
TASKDESK_PORTAL_URL=http://portal.localhost:5173
TASKDESK_IMAGE_TAG=parity
POSTGRES_DB=taskdesk
POSTGRES_USER=taskdesk
POSTGRES_PASSWORD=$(openssl rand -hex 16)
TASKDESK_APP_DB_PASSWORD=$(openssl rand -hex 16)
TASKDESK_ENCRYPTION_KEY=$(openssl rand -hex 32)
TASKDESK_AUTH_SECRET=$(openssl rand -hex 32)
ENV
cat > "$work/override.yml" <<'YML'
services:
  taskdesk:
    environment:
      NODE_ENV: development
      TASKDESK_TRUST_PROXY: "1"
    ports:
      - "127.0.0.1:5173:5173"
YML
docker build -t ghcr.io/thomasheinthura/taskdesk:parity .
dc() { docker compose --env-file "$work/env" -f compose.yml -f "$work/override.yml" "$@"; }
dc up -d --wait postgres valkey
dc run --rm migrate
dc up -d --wait taskdesk
dc exec -T taskdesk node apps/api/dist/seed-sit-users.js --sit --credentials-file /tmp/parity-credentials.json
# The seed now generates private passwords; hand the admin one to the capture step only.
admin_password="$(dc exec -T taskdesk cat /tmp/parity-credentials.json \
  | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8"));process.stdout.write(c.accounts.find(a=>a.email==="admin@taskdesk.local").password)')"
echo "::add-mask::$admin_password"
echo "OURS_PASSWORD=$admin_password" >> "${GITHUB_ENV:?GITHUB_ENV is required}"
for i in $(seq 1 30); do
  curl -fsS http://agent.localhost:5173/api/public/health/ready >/dev/null && exit 0
  sleep 2
done
dc logs --tail 100 taskdesk
exit 1
