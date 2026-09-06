#!/bin/sh
# TaskDesk container entrypoint.
#
# Specification: docs/05-operations/container-image.md § Entrypoint
#
#   1. validate the five required environment variables; exit 1 with a clear
#      message if absent
#   2. take the migration advisory lock, run migrations, release
#   3. if TASKDESK_ROLE != jobs: start the HTTP listener
#   4. if TASKDESK_ROLE != web:  start the scheduler
#   5. readiness true
#
# Steps 2-5 happen inside the application process today: apps/api/src/index.ts
# runs its startup tasks (migrations) before it listens, and starts the
# scheduler in-process. This script therefore owns step 1 and the handover, and
# fails fast rather than letting the process start with a missing secret.
#
# It never prints a secret's value, only its name.

set -eu

fail() {
  echo "taskdesk: $1" >&2
  exit 1
}

missing=""
for name in \
  TASKDESK_DATABASE_URL \
  TASKDESK_ENCRYPTION_KEY \
  TASKDESK_AUTH_SECRET \
  TASKDESK_AGENT_URL \
  TASKDESK_PORTAL_URL
do
  eval "value=\${$name:-}"
  [ -n "$value" ] || missing="$missing  $name
"
done

if [ -n "$missing" ]; then
  echo "taskdesk: refusing to start — required configuration is missing:" >&2
  printf '%s' "$missing" >&2
  cat >&2 <<'EOF'
Set them in your .env file (see deploy/.env.example) and start again.

  TASKDESK_DATABASE_URL    postgres://taskdesk:...@postgres:5432/taskdesk
  TASKDESK_ENCRYPTION_KEY  64 hex characters   openssl rand -hex 32
  TASKDESK_AUTH_SECRET     64 hex characters   openssl rand -hex 32
  TASKDESK_AGENT_URL       https://ticket.example.com
  TASKDESK_PORTAL_URL      https://portal.example.com

There is no default for any of them, and there must not be: an absent
TASKDESK_AUTH_SECRET once fell through to a constant published in better-auth's
own source, which signed every session cookie with a value anyone can read.
Reference: docs/05-operations/configuration-reference.md
EOF
  exit 1
fi

# Length floors only. The application owns the real rule; these two catch the
# "I pasted the example line" class of mistake before the first request.
[ "${#TASKDESK_AUTH_SECRET}" -ge 32 ] \
  || fail "TASKDESK_AUTH_SECRET is shorter than 32 characters. Generate one with: openssl rand -hex 32"
[ "${#TASKDESK_ENCRYPTION_KEY}" -ge 32 ] \
  || fail "TASKDESK_ENCRYPTION_KEY is shorter than 32 characters. Generate one with: openssl rand -hex 32"

case "${TASKDESK_ROLE:-all}" in
  all|web|jobs) ;;
  *) fail "TASKDESK_ROLE must be one of: all, web, jobs (got '${TASKDESK_ROLE}')" ;;
esac

# exec, so SIGTERM reaches node and its graceful shutdown runs.
exec node apps/api/dist/index.js "$@"
