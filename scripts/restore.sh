#!/usr/bin/env bash
#
# TaskDesk restore script.
#
#   scripts/restore.sh --backup <id-or-dir> --confirm --mode local|sit|uat|production|isolated
#
# Specification: docs/guide/install-and-deploy.md
#   1. Verify backup checksums and `pg_restore --list` before stopping anything
#   2. Stop the application (`taskdesk`), leaving PostgreSQL running
#   3. Restore PostgreSQL into a temporary staging DB (`createdb` + `pg_restore`), then swap over live DB
#   4. Restore the attachment volume (`taskdesk_taskdesk-data`)
#   5. Start `migrate` and `taskdesk`; probe `/api/public/health/ready`

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
BACKUP_ROOT="${TASKDESK_BACKUP_ROOT:-$REPO_ROOT/backups}"
BACKUP_ARG=""
CONFIRMED=0
MODE=""
PROJECT_NAME=""
LEGACY_MOUNT=""

usage() {
  cat <<'EOF'
Usage:
  scripts/restore.sh --backup <id-or-dir> --confirm --mode local|sit|uat|production|isolated

Options:
  --project-name <name>  Select an isolated Compose project (default: Compose configuration)
  --backup <id-or-dir>  Backup identifier under backups/ or path to backup directory
  --confirm             Required confirmation flag before overwriting database and attachments
  --mode <mode>         Compose overlay mode (required): local, sit, uat, production or isolated
  --legacy-source-mount <path>  Source mount for backups without mount metadata
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
    --legacy-source-mount)
      [ $# -ge 2 ] || usage 1
      LEGACY_MOUNT="$2"
      [[ "$LEGACY_MOUNT" = /app/data || "$LEGACY_MOUNT" = /app/data/attachments ]] || { printf 'xx invalid legacy source mount\n' >&2; exit 1; }
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

if [ -z "$MODE" ]; then
  printf 'xx --mode is required (a wrong default would restart production as a dev stack)\n' >&2
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
MOUNT_FILE="$TARGET_DIR/attachment-mount.txt"

[ -f "$DUMP_FILE" ] || { printf 'xx missing %s\n' "$DUMP_FILE" >&2; exit 1; }
[ -f "$ATTACHMENTS_TAR" ] || { printf 'xx missing %s\n' "$ATTACHMENTS_TAR" >&2; exit 1; }
[ -f "$CHECKSUMS_FILE" ] || { printf 'xx missing %s\n' "$CHECKSUMS_FILE" >&2; exit 1; }
if [ -e "$MOUNT_FILE" ]; then
  [ -f "$MOUNT_FILE" ] && [ -z "$LEGACY_MOUNT" ] || { printf 'xx legacy source mount allowed only when metadata is absent\n' >&2; exit 1; }
  grep -Eq '^[0-9a-fA-F]{64}  attachment-mount[.]txt$' "$CHECKSUMS_FILE" || { printf 'xx attachment mount metadata is not checksummed\n' >&2; exit 1; }
else
  [ -n "$LEGACY_MOUNT" ] || { printf 'xx missing attachment mount metadata; specify --legacy-source-mount\n' >&2; exit 1; }
fi

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-taskdesk}"
POSTGRES_DB="${POSTGRES_DB:-taskdesk}"
PORT="${TASKDESK_PORT:-5173}"

[[ "$POSTGRES_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] || { printf 'xx invalid POSTGRES_USER identifier\n' >&2; exit 1; }
[[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_-]{0,62}$ ]] || { printf 'xx invalid POSTGRES_DB identifier\n' >&2; exit 1; }

printf '==> Verifying backup checksums in %s\n' "$TARGET_DIR"
(
  cd "$TARGET_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$CHECKSUMS_FILE"
  else
    shasum -a 256 -c "$CHECKSUMS_FILE"
  fi
)
if [ -f "$MOUNT_FILE" ]; then SOURCE_MOUNT="$(cat "$MOUNT_FILE")"; else SOURCE_MOUNT="$LEGACY_MOUNT"; fi
[[ "$SOURCE_MOUNT" = /app/data || "$SOURCE_MOUNT" = /app/data/attachments ]] || { printf 'xx invalid source mount\n' >&2; exit 1; }

COMPOSE_FILES=(-f compose.yml)
case "$MODE" in
  local)
    COMPOSE_FILES+=(-f deploy/compose.local.yml -f deploy/compose.traefik.yml)
    ;;
  isolated)
    [[ -n "$PROJECT_NAME" && "$PROJECT_NAME" != taskdesk ]] || { printf 'xx isolated restore requires a non-default --project-name\n' >&2; exit 1; }
    export TASKDESK_DRILL_DATA_MOUNT="$SOURCE_MOUNT"
    COMPOSE_FILES+=(-f deploy/compose.restore-drill.yml)
    ;;
  production)
    COMPOSE_FILES+=(-f deploy/compose.prod.yml)
    ;;
  sit|uat)
    COMPOSE_FILES+=(-f "deploy/compose.$MODE.yml")
    ;;
  *)
    printf 'xx unknown mode: %s (expected local, sit, uat, production or isolated)\n' "$MODE" >&2
    exit 1
    ;;
esac

[ -z "$PROJECT_NAME" ] || COMPOSE_FILES+=(-p "$PROJECT_NAME")

dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

printf '==> Verifying pg_restore --list on %s\n' "$DUMP_FILE"
dc exec -T postgres pg_restore --list < "$DUMP_FILE" >/dev/null

# Resolve before the first mutation. A missing/ambiguous/bind-mounted target fails closed.
# shellcheck source=scripts/lib/compose-data-volume.sh
. "$REPO_ROOT/scripts/lib/compose-data-volume.sh"
DATA_MOUNT="$(resolve_compose_data_volume)" || exit 1
DATA_VOLUME="${DATA_MOUNT%%:*}"
[ "$SOURCE_MOUNT" = "${DATA_MOUNT#*:}" ] || { printf 'xx attachment mount mismatch; restore refused\n' >&2; exit 1; }

# The stack's own postgres image carries sh and tar, so no unpinned image is pulled.
HELPER_IMAGE="$(dc images -q postgres | head -1)"
[ -n "$HELPER_IMAGE" ] || { printf 'xx cannot find the postgres image to run the attachment helper\n' >&2; exit 1; }

STAGING_DB="${POSTGRES_DB:0:35}_restore_staging_$$"
RECOVERY_DB="${POSTGRES_DB:0:35}_restore_recovery_$$"
STAGING_ACTIVE=0
PROMOTED=0
UNDO_DIR=".restore-undo-$$"
UNDO_FILE="$UNDO_DIR/attachments.tar"
cleanup_staging_db() {
  if [ "$STAGING_ACTIVE" -eq 1 ]; then
    dc exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$STAGING_DB' AND pid <> pg_backend_pid();" \
      -c "DROP DATABASE IF EXISTS \"$STAGING_DB\";" >/dev/null 2>&1 || true
    dc up -d --wait taskdesk || printf 'xx Could not restart taskdesk after staging failure\n' >&2
  fi
  if [ "$PROMOTED" -eq 1 ]; then
    printf 'xx Restore incomplete; recovery database: %s; attachment undo archive in volume %s: %s\n' "$RECOVERY_DB" "$DATA_VOLUME" "$UNDO_FILE" >&2
  fi
}
trap cleanup_staging_db EXIT

printf '==> Step 1: Stopping taskdesk container (leaving PostgreSQL running)\n'
dc stop taskdesk

printf '==> Step 2: Restoring PostgreSQL dump into staging database (%s)\n' "$STAGING_DB"
STAGING_ACTIVE=1
dc exec -T postgres dropdb --if-exists -U "$POSTGRES_USER" "$STAGING_DB" >/dev/null
dc exec -T postgres createdb -U "$POSTGRES_USER" -O "$POSTGRES_USER" "$STAGING_DB"
dc exec -T postgres pg_restore --single-transaction --no-owner --role="$POSTGRES_USER" -U "$POSTGRES_USER" -d "$STAGING_DB" < "$DUMP_FILE"

# Retain the restored copy on any promotion failure. Both renames roll back together.
STAGING_ACTIVE=0
printf '==> Promoting staging database (%s -> %s)\n' "$STAGING_DB" "$POSTGRES_DB"
dc exec -T postgres psql --single-transaction -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$POSTGRES_DB', '$STAGING_DB') AND pid <> pg_backend_pid();" \
  -c "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO \"$RECOVERY_DB\";" \
  -c "ALTER DATABASE \"$STAGING_DB\" RENAME TO \"$POSTGRES_DB\";" >/dev/null
PROMOTED=1

printf '==> Step 3: Restoring attachment volume (%s)\n' "$DATA_VOLUME"
docker run --rm -i \
  -v "$DATA_VOLUME:/data" \
  --entrypoint sh "$HELPER_IMAGE" \
  -c 'undo="$1"; mkdir "/data/$undo" && tar -C /data --exclude="./$undo" -cf "/data/$undo/attachments.tar" . && tar -C /data --exclude="./$undo" --exclude="./$undo/*" -xf - && chown -R 10001:10001 /data' sh "$UNDO_DIR" < "$ATTACHMENTS_TAR"

printf '==> Step 4: Running migrations and role grants\n'
dc run --rm migrate

printf '==> Step 5: Starting taskdesk application\n'
dc up -d --wait taskdesk

printf '==> Step 6: Probing /api/public/health/ready\n'
for _ in $(seq 1 30); do
  # The image ships no wget or curl; Node is the one HTTP client it has.
  if dc exec -T taskdesk node -e "fetch('http://127.0.0.1:${PORT}/api/public/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
    dc exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
      -c "DROP DATABASE \"$RECOVERY_DB\";" >/dev/null
    PROMOTED=0
    docker run --rm -v "$DATA_VOLUME:/data" --entrypoint sh "$HELPER_IMAGE" -c 'rm -f "/data/$1/attachments.tar" && rmdir "/data/$1"' sh "$UNDO_DIR"
    printf ' ok Restore verified and /api/public/health/ready is green\n'
    exit 0
  fi
  sleep 2
done

dc logs --tail 60 taskdesk || true
printf 'xx Restored container failed readiness probe\n' >&2
exit 1
