#!/usr/bin/env bash
#
# TaskDesk backup script.
#
#   scripts/backup.sh [--backup <id>] [--output-dir <dir>]
#
# Specification: docs/technical/operations-and-distribution.md § Method
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

command -v node >/dev/null 2>&1 || { printf 'xx Node.js is required for archive validation\n' >&2; exit 1; }
[[ "$BACKUP_ID" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { printf 'xx invalid backup identifier\n' >&2; exit 1; }

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
# A backup is published only after every check passes. Existing backups are never reused.
[[ ! -e "$TARGET_DIR" && ! -L "$TARGET_DIR" ]] || { printf 'xx backup destination already exists\n' >&2; exit 1; }
mkdir -p "$(dirname "$TARGET_DIR")"
LOCK_DIR="${TARGET_DIR}.lock"
mkdir "$LOCK_DIR" || { printf 'xx backup destination is locked\n' >&2; exit 1; }
STAGING_DIR=""
HELPER_ID=""
cleanup() {
  local result=$?
  trap - EXIT
  if [[ -n "$HELPER_ID" ]]; then
    docker rm -f "$HELPER_ID" >/dev/null 2>&1 || result=1
  fi
  [[ -z "$STAGING_DIR" ]] || rm -rf -- "$STAGING_DIR"
  rmdir "$LOCK_DIR" || result=1
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
STAGING_DIR="$(mktemp -d "${TARGET_DIR}.partial.XXXXXXXX")"
PUBLISHED_DIR="$TARGET_DIR"
TARGET_DIR="$STAGING_DIR"

DUMP_FILE="$TARGET_DIR/postgres.dump"
ATTACHMENTS_TAR="$TARGET_DIR/attachments.tar"
CHECKSUMS_FILE="$TARGET_DIR/SHA256SUMS"

printf '==> Dumping PostgreSQL database (%s) to %s\n' "$POSTGRES_DB" "$DUMP_FILE"
dc exec -T postgres \
  pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB" > "$DUMP_FILE"

printf '==> Verifying database archive listing and payload\n'
dc exec -T postgres pg_restore --list < "$DUMP_FILE" > "$TARGET_DIR/archive.list"
LIST_COUNT="$(grep -c '^[^;[:space:]]' "$TARGET_DIR/archive.list" || true)"
rm -- "$TARGET_DIR/archive.list"
# Listing only validates the table of contents; decode all data before publication.
dc exec -T postgres pg_restore --file=/dev/null < "$DUMP_FILE" >/dev/null
if [ "${LIST_COUNT:-0}" -le 0 ]; then
  printf 'xx pg_restore --list returned no archive entries for %s\n' "$DUMP_FILE" >&2
  exit 1
fi

printf '==> Archiving attachment volume (%s) to %s\n' "$DATA_VOLUME" "$ATTACHMENTS_TAR"
HELPER_ID="$(docker create --network none \
  -v "$DATA_VOLUME:/data:ro" \
  alpine:3.22 tar -C /data -cf - .)"
[[ "$HELPER_ID" =~ ^[a-f0-9]{64}$ ]] || { HELPER_ID=""; printf 'xx invalid backup helper ID\n' >&2; exit 1; }
docker start -a "$HELPER_ID" > "$ATTACHMENTS_TAR"
# docker start -a does not reliably propagate the container exit status.
[[ "$(docker inspect --format '{{.State.ExitCode}}' "$HELPER_ID")" = 0 ]] || exit 1
docker rm "$HELPER_ID" >/dev/null
HELPER_ID=""

printf '==> Validating attachment archive and recording SHA-256 checksums\n'
node scripts/lib/recovery-archive.mjs tar "$ATTACHMENTS_TAR"
node scripts/lib/recovery-archive.mjs checksums "$TARGET_DIR"
chmod 0600 "$DUMP_FILE" "$ATTACHMENTS_TAR" "$CHECKSUMS_FILE"
node scripts/lib/recovery-archive.mjs publish "$TARGET_DIR" "$PUBLISHED_DIR"
rm -rf -- "$STAGING_DIR"
STAGING_DIR=""
printf ' ok Backup archive complete: %s (pg_restore entries: %s)\n' "$PUBLISHED_DIR" "$LIST_COUNT"
printf ' !! Archive checks do not establish a consistent snapshot or a successful restore drill.\n'
printf ' !! Store TASKDESK_ENCRYPTION_KEY, TASKDESK_AUTH_SECRET, and TASKDESK_ENCRYPTION_KEY_PREVIOUS in your password manager separately from backups.\n'
