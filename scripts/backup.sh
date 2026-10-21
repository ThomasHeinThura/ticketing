#!/usr/bin/env bash
#
# TaskDesk backup script.
#
#   scripts/backup.sh [--backup <id>] [--output-dir <dir>]
#
# Specification: docs/05-operations/backup-and-restore.md § Method
#   1. Dump PostgreSQL with `pg_dump -Fc` (custom compressed format)
#   2. Verify the dump is restorable with `pg_restore --list`
#   3. Archive the attachment volume (`taskdesk-data` mounted at `/app/data`)
#   4. Write SHA-256 checksums (`SHA256SUMS`) with 0600 permissions
#   5. Remind the operator that `.env` encryption keys live in a password manager

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
BACKUP_ROOT="${TASKDESK_BACKUP_ROOT:-$REPO_ROOT/backups}"
BACKUP_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUTPUT_DIR=""
PROJECT_NAME=""

usage() {
  cat <<'EOF'
Usage:
  scripts/backup.sh [--backup <id>] [--output-dir <dir>]

Options:
  --project-name <name>  Select an isolated Compose project (default: Compose configuration)
  --backup <id>       Explicit backup identifier (default: UTC timestamp)
  --output-dir <dir>  Explicit target directory (default: backups/<id>)
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
      BACKUP_ID="$2"
      shift 2
      ;;
    --output-dir)
      [ $# -ge 2 ] || usage 1
      OUTPUT_DIR="$2"
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

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-taskdesk}"
POSTGRES_DB="${POSTGRES_DB:-taskdesk}"
TARGET_DIR="${OUTPUT_DIR:-$BACKUP_ROOT/$BACKUP_ID}"

COMPOSE_FILES=(-f compose.yml)
[ -z "$PROJECT_NAME" ] || COMPOSE_FILES+=(-p "$PROJECT_NAME")
dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }
# shellcheck source=scripts/lib/compose-data-volume.sh
. "$REPO_ROOT/scripts/lib/compose-data-volume.sh"
DATA_VOLUME="$(resolve_compose_data_volume)" || exit 1

umask 077
mkdir -p "$TARGET_DIR"

DUMP_FILE="$TARGET_DIR/postgres.dump"
ATTACHMENTS_TAR="$TARGET_DIR/attachments.tar"
CHECKSUMS_FILE="$TARGET_DIR/SHA256SUMS"

printf '==> Dumping PostgreSQL database (%s) to %s\n' "$POSTGRES_DB" "$DUMP_FILE"
dc exec -T postgres \
  pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DUMP_FILE"

printf '==> Verifying dump restorability with pg_restore --list\n'
LIST_COUNT="$(dc exec -T postgres pg_restore --list < "$DUMP_FILE" | grep -c '^[^;]' || true)"
if [ "${LIST_COUNT:-0}" -le 0 ]; then
  printf 'xx pg_restore --list returned no archive entries for %s\n' "$DUMP_FILE" >&2
  exit 1
fi

printf '==> Archiving attachment volume (%s) to %s\n' "$DATA_VOLUME" "$ATTACHMENTS_TAR"
docker run --rm \
  -v "$DATA_VOLUME:/data:ro" \
  alpine:3.22 \
  tar -C /data -cf - . > "$ATTACHMENTS_TAR"

printf '==> Recording SHA-256 checksums\n'
(
  cd "$TARGET_DIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum postgres.dump attachments.tar > "$CHECKSUMS_FILE"
  else
    shasum -a 256 postgres.dump attachments.tar > "$CHECKSUMS_FILE"
  fi
)
chmod 0600 "$DUMP_FILE" "$ATTACHMENTS_TAR" "$CHECKSUMS_FILE"

printf ' ok Backup complete: %s (pg_restore entries: %s)\n' "$TARGET_DIR" "$LIST_COUNT"
printf ' !! Store TASKDESK_ENCRYPTION_KEY, TASKDESK_AUTH_SECRET, and TASKDESK_ENCRYPTION_KEY_PREVIOUS in your password manager separately from backups.\n'
