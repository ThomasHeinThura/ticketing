#!/usr/bin/env bash
#
# TaskDesk restore script.
#
#   scripts/restore.sh --backup <id-or-dir> --confirm [--mode local|production]
#
# Specification: docs/technical/operations-and-distribution.md § Restore
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
MODE_EXPLICIT=0
PROJECT_NAME=""
RECOVERY_TARGET="legacy"
PRIVATE_ENV_FILE=""

usage() {
  cat <<'EOF'
Usage:
  scripts/restore.sh --backup <id-or-dir> --confirm [--mode local|production]

Options:
  --target <target>    legacy (default) or local-sit; remote targets are refused
  --env-file <path>    Owner-only literal Compose env file (required for local-sit)
  --project-name <name>  Select an isolated Compose project (default: Compose configuration)
  --backup <id-or-dir>  Backup identifier under backups/ or path to backup directory
  --confirm             Required confirmation flag before overwriting database and attachments
  --mode <mode>         Compose overlay mode: local (default), production or isolated
EOF
  exit "${1:-1}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || usage 1
      RECOVERY_TARGET="$2"
      shift 2
      ;;
    --env-file)
      [ $# -ge 2 ] || usage 1
      PRIVATE_ENV_FILE="$2"
      shift 2
      ;;
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
      MODE_EXPLICIT=1
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

case "$RECOVERY_TARGET" in
  legacy)
    [[ -z "$PRIVATE_ENV_FILE" && "$PROJECT_NAME" != taskdesk-codex-testing ]] || { printf 'xx canonical SIT requires --target local-sit and --env-file; legacy environment overrides are refused\n' >&2; exit 1; }
    ;;
  local-sit)
    [[ "$MODE_EXPLICIT" = 0 && -n "$PRIVATE_ENV_FILE" && ( -z "$PROJECT_NAME" || "$PROJECT_NAME" = taskdesk-codex-testing ) ]] || { printf 'xx local-sit requires --env-file and the canonical project\n' >&2; exit 1; }
    ;;
  *) printf 'xx unsupported recovery target; Technexus SIT/UAT identity is not established by this helper\n' >&2; exit 1 ;;
esac

if [[ "$RECOVERY_TARGET" = legacy && -f "$ENV_FILE" ]]; then
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
if [[ "$RECOVERY_TARGET" = local-sit ]]; then
  dc() { node scripts/lib/compose-recovery-target.mjs compose "$PRIVATE_ENV_FILE" "$@"; }
fi

command -v node >/dev/null 2>&1 || { printf 'xx Node.js is required for archive validation\n' >&2; exit 1; }
umask 077
# Validate a private copy and consume that same copy. Later changes to the input
# directory cannot replace bytes between verification and destructive restore.
SNAPSHOT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/taskdesk-restore.XXXXXXXX")"
HELPER_ID=""
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$HELPER_ID" ]]; then
    docker rm -f "$HELPER_ID" >/dev/null 2>&1 || result=1
  fi
  rm -rf -- "$SNAPSHOT_DIR"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '==> Verifying backup checksums and complete attachment archive\n'
node scripts/lib/recovery-archive.mjs snapshot "$TARGET_DIR" "$SNAPSHOT_DIR"
if [[ "$RECOVERY_TARGET" = local-sit ]]; then
  [[ -f "$SNAPSHOT_DIR/source-identity.json" ]] || { printf 'xx canonical SIT restore requires a checksum-bound source identity manifest\n' >&2; exit 1; }
  node scripts/lib/compose-recovery-target.mjs identity "$PRIVATE_ENV_FILE" > "$SNAPSHOT_DIR/target-identity.json"
  node scripts/lib/compose-recovery-target.mjs compare "$SNAPSHOT_DIR/source-identity.json" "$SNAPSHOT_DIR/target-identity.json"
  printf 'xx canonical SIT identity matched, but restore is blocked: writer fencing and an isolated restore drill are not implemented\n' >&2
  exit 1
elif [[ -e "$SNAPSHOT_DIR/source-identity.json" ]]; then
  printf 'xx identity-bearing backups require their explicit target; legacy restore cannot convert attachment layouts\n' >&2
  exit 1
fi
DUMP_FILE="$SNAPSHOT_DIR/postgres.dump"
ATTACHMENTS_TAR="$SNAPSHOT_DIR/attachments.tar"
printf '==> Verifying database archive contents before stopping anything\n'
dc exec -T postgres pg_restore --list < "$DUMP_FILE" > "$SNAPSHOT_DIR/archive.list"
grep -q '^[^;[:space:]]' "$SNAPSHOT_DIR/archive.list" || { printf 'xx database archive has no entries\n' >&2; exit 1; }
dc exec -T postgres pg_restore --file=/dev/null < "$DUMP_FILE" >/dev/null

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
HELPER_ID="$(docker create --network none -i \
  -v "$DATA_VOLUME:/data" \
  alpine:3.22 \
  sh -c 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -C /data -xf - && chown -R 10001:10001 /data')"
[[ "$HELPER_ID" =~ ^[a-f0-9]{64}$ ]] || { HELPER_ID=""; printf 'xx invalid restore helper ID\n' >&2; exit 1; }
docker start -a -i "$HELPER_ID" < "$ATTACHMENTS_TAR"
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$HELPER_ID")" = 0 ]] || exit 1
docker rm "$HELPER_ID" >/dev/null
HELPER_ID=""

printf '==> Step 4: Running migrations and role grants\n'
dc run --rm migrate

printf '==> Step 5: Starting taskdesk application\n'
dc up -d --wait taskdesk

printf '==> Step 6: Probing /api/public/health/ready\n'
for _ in $(seq 1 30); do
  # The image ships no wget or curl; Node is the one HTTP client it has.
  if dc exec -T taskdesk node -e "fetch('http://127.0.0.1:${PORT}/api/public/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
    printf ' ok Restore commands completed and /api/public/health/ready is green; operator verification is still required\n'
    exit 0
  fi
  sleep 2
done

dc logs --tail 60 taskdesk || true
printf 'xx Restored container failed readiness probe\n' >&2
exit 1
