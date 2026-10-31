#!/usr/bin/env bash
#
# TaskDesk restore script.
#
#   scripts/restore.sh --backup <id-or-dir> --confirm [--mode local|production]
#
# Specification: docs/05-operations/backup-and-restore.md § Restore
#   1. Verify backup checksums and `pg_restore --list` before stopping anything
#   2. Stop the application (`taskdesk`), leaving PostgreSQL running
#   3. Restore PostgreSQL (`pg_restore --clean --if-exists --no-owner`)
#   4. Restore the attachment volume (`taskdesk_taskdesk-data`)
#   5. Start `migrate` and `taskdesk`; probe `/api/public/health/ready`

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
BACKUP_ROOT="${TASKDESK_BACKUP_ROOT:-$REPO_ROOT/backups}"
BACKUP_ARG=""
CONFIRMED=0
MODE="local"
PROJECT_NAME=""

usage() {
  cat <<'EOF'
Usage:
  scripts/restore.sh --backup <id-or-dir> --confirm [--mode local|production]

Options:
  --project-name <name>  Select an isolated Compose project (default: Compose configuration)
  --backup <id-or-dir>  Backup identifier under backups/ or path to backup directory
  --confirm             Required confirmation flag before overwriting database and attachments
  --mode <mode>         Compose overlay mode: local (default), production or isolated
EOF
  exit "${1:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --project-name)
      [ $# -ge 2 ] || usage 1
      PROJECT_NAME="$2"
      [[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { printf 'xx invalid Compose project name\n' >&2; exit 1; }
      shift 2
      ;;
    --backup)
      [ $# -ge 2 ] || usage 1
      BACKUP_ARG="$2"
      shift 2
      ;;
    --confirm)
      CONFIRMED=1
      shift
      ;;
    --mode)
      [ $# -ge 2 ] || usage 1
      MODE="$2"
      shift 2
      ;;
    -h|--help|help)
      usage 0
      ;;
    *)
      printf 'xx unknown argument: %s\n' "$1" >&2
      usage 1
      ;;
  esac
done

if [ -z "$BACKUP_ARG" ]; then
  printf 'xx --backup <id-or-dir> is required\n' >&2
  usage 1
fi

if [ "$CONFIRMED" -ne 1 ]; then
  printf 'xx --confirm is required to execute a restore\n' >&2
  exit 1
fi

if [ -d "$BACKUP_ARG" ]; then
  TARGET_DIR="$(cd "$BACKUP_ARG" && pwd)"
elif [ -d "$BACKUP_ROOT/$BACKUP_ARG" ]; then
  TARGET_DIR="$(cd "$BACKUP_ROOT/$BACKUP_ARG" && pwd)"
else
  printf 'xx backup directory not found: %s\n' "$BACKUP_ARG" >&2
  exit 1
fi

DUMP_FILE="$TARGET_DIR/postgres.dump"
ATTACHMENTS_TAR="$TARGET_DIR/attachments.tar"
CHECKSUMS_FILE="$TARGET_DIR/SHA256SUMS"

[ -f "$DUMP_FILE" ] || { printf 'xx missing %s\n' "$DUMP_FILE" >&2; exit 1; }
[ -f "$ATTACHMENTS_TAR" ] || { printf 'xx missing %s\n' "$ATTACHMENTS_TAR" >&2; exit 1; }
[ -f "$CHECKSUMS_FILE" ] || { printf 'xx missing %s\n' "$CHECKSUMS_FILE" >&2; exit 1; }

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-taskdesk}"
POSTGRES_DB="${POSTGRES_DB:-taskdesk}"
PORT="${TASKDESK_PORT:-5173}"

COMPOSE_FILES=(-f compose.yml)
case "$MODE" in
  local)
    COMPOSE_FILES+=(-f deploy/compose.local.yml -f deploy/compose.traefik.yml)
    ;;
  isolated)
    [[ -n "$PROJECT_NAME" && "$PROJECT_NAME" != taskdesk ]] || { printf 'xx isolated restore requires a non-default --project-name\n' >&2; exit 1; }
    COMPOSE_FILES+=(-f deploy/compose.restore-drill.yml)
    ;;
  production)
    COMPOSE_FILES+=(-f deploy/compose.prod.yml)
    ;;
  *)
    printf 'xx unknown mode: %s (expected local, production or isolated)\n' "$MODE" >&2
    exit 1
    ;;
esac

[ -z "$PROJECT_NAME" ] || COMPOSE_FILES+=(-p "$PROJECT_NAME")

dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

printf '==> Verifying backup checksums in %s\n' "$TARGET_DIR"
(
  cd "$TARGET_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$CHECKSUMS_FILE"
  else
    shasum -a 256 -c "$CHECKSUMS_FILE"
  fi
)

printf '==> Verifying pg_restore --list on %s\n' "$DUMP_FILE"
dc exec -T postgres pg_restore --list < "$DUMP_FILE" >/dev/null

# Resolve before the first mutation. A missing/ambiguous/bind-mounted target fails closed.
# shellcheck source=scripts/lib/compose-data-volume.sh
. "$REPO_ROOT/scripts/lib/compose-data-volume.sh"
DATA_VOLUME="$(resolve_compose_data_volume)" || exit 1

printf '==> Step 1: Stopping taskdesk container (leaving PostgreSQL running)\n'
dc stop taskdesk

printf '==> Step 2: Restoring PostgreSQL database (%s)\n' "$POSTGRES_DB"
dc exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$POSTGRES_DB' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"$POSTGRES_DB\";" \
  -c "CREATE DATABASE \"$POSTGRES_DB\" OWNER \"$POSTGRES_USER\";" >/dev/null
dc exec -T postgres pg_restore --single-transaction --no-owner --role="$POSTGRES_USER" -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$DUMP_FILE"

printf '==> Step 3: Restoring attachment volume (%s)\n' "$DATA_VOLUME"
docker run --rm -i \
  -v "$DATA_VOLUME:/data" \
  alpine:3.22 \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -C /data -xf - && chown -R 10001:10001 /data' < "$ATTACHMENTS_TAR"

printf '==> Step 4: Running migrations and role grants\n'
dc run --rm migrate

printf '==> Step 5: Starting taskdesk application\n'
dc up -d --wait taskdesk

printf '==> Step 6: Probing /api/public/health/ready\n'
for _ in $(seq 1 30); do
  # The image ships no wget or curl; Node is the one HTTP client it has.
  if dc exec -T taskdesk node -e "fetch('http://127.0.0.1:${PORT}/api/public/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
    printf ' ok Restore verified and /api/public/health/ready is green\n'
    exit 0
  fi
  sleep 2
done

dc logs --tail 60 taskdesk || true
printf 'xx Restored container failed readiness probe\n' >&2
exit 1
