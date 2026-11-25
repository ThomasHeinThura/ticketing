#!/usr/bin/env bash
#
# TaskDesk backup script — verify-only quiescence gate.
#
#   scripts/backup.sh [--project-name <name>] [--backup <id> | --output-dir <dir>]
#
# Run it through scripts/backup-maintenance.sh, which holds and releases the
# maintenance barrier. This script never stops, starts, connects or disconnects
# anything; it only verifies the barrier and refuses when it is not held.
# Specification: docs/technical/operations-and-distribution.md#backup-and-restore-method
#   0. Pin the app/PostgreSQL containers, data volume and database name/user;
#      refuse S3/unknown storage drivers and host/container database mismatch
#   1. Verify the held barrier (B0): only PostgreSQL runs in the project, nothing
#      mounts the data volume, PostgreSQL has no network, no client sessions on
#      any database of the server
#   2. Reserve a NEW target directory exclusively, enter it, confirm it is empty
#      and owned; every later write, rename and cleanup stays inside it
#   3. Dump PostgreSQL with `pg_dump -Fc` and verify it with `pg_restore --list`
#   4. Re-verify the barrier (B1); archive the data volume read-only, offline
#   5. Write checksums to a partial file, re-verify (B2), publish SHA256SUMS
#   6. Remind the operator that `.env` encryption keys live in a password manager

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
BACKUP_ROOT="${TASKDESK_BACKUP_ROOT:-$REPO_ROOT/backups}"
BACKUP_ID="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUTPUT_DIR=""
PROJECT_NAME=""
# The same identifier rule as scripts/restore.sh.
IDENTIFIER_RE='^[A-Za-z_][A-Za-z0-9_-]{0,62}$'

usage() {
  cat <<'EOF'
Usage:
  scripts/backup.sh [--project-name <name>] [--backup <id> | --output-dir <dir>]

Options:
  --project-name <name>  Select an isolated Compose project (default: Compose configuration)
  --backup <id>          Explicit backup identifier (default: UTC timestamp)
  --output-dir <dir>     Explicit NEW target directory (default: backups/<id>); it must not exist

Normally invoked by scripts/backup-maintenance.sh, which holds the maintenance barrier.
EOF
  exit "${1:-1}"
}

refuse() {
  printf 'xx refusing backup: %s\n' "$*" >&2
  exit 1
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
      [[ "$BACKUP_ID" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || { printf 'xx invalid backup identifier\n' >&2; exit 1; }
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

if [ -n "$OUTPUT_DIR" ]; then
  while [ "${OUTPUT_DIR%/}" != "$OUTPUT_DIR" ] && [ "$OUTPUT_DIR" != "/" ]; do OUTPUT_DIR="${OUTPUT_DIR%/}"; done
  case "${OUTPUT_DIR##*/}" in
    ""|.|..) printf 'xx invalid output directory\n' >&2; exit 1 ;;
  esac
fi

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-taskdesk}"
POSTGRES_DB="${POSTGRES_DB:-taskdesk}"
[[ "$POSTGRES_USER" =~ $IDENTIFIER_RE ]] || refuse "invalid POSTGRES_USER identifier"
[[ "$POSTGRES_DB" =~ $IDENTIFIER_RE ]] || refuse "invalid POSTGRES_DB identifier"
TARGET_DIR="${OUTPUT_DIR:-$BACKUP_ROOT/$BACKUP_ID}"

COMPOSE_FILES=(-f "$REPO_ROOT/compose.yml")
[ -z "$PROJECT_NAME" ] || COMPOSE_FILES+=(-p "$PROJECT_NAME")
dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }
# shellcheck source=scripts/lib/compose-data-volume.sh
. "$REPO_ROOT/scripts/lib/compose-data-volume.sh"

# Status before content: assign stdout to the named variable only when the
# command succeeded; the caller then validates the text.
capture() {
  local __name="$1" __out
  shift
  if ! __out="$("$@")"; then return 1; fi
  printf -v "$__name" '%s' "$__out"
}

# Pin one Compose service's container: exactly one full 64-hex ID.
pin_container() {
  local __name="$1" service="$2" short full
  capture short dc ps -a -q "$service" || refuse "cannot list the $service container"
  [[ "$short" =~ ^[a-f0-9]{12,64}$ ]] || refuse "expected exactly one $service container"
  capture full docker inspect --format '{{.Id}}' "$short" || refuse "cannot inspect the $service container"
  [[ "$full" =~ ^[a-f0-9]{64}$ ]] || refuse "unexpected $service container identity"
  printf -v "$__name" '%s' "$full"
}

# Read one named, non-secret variable from a container's configuration. Docker's
# template filters it, so no other variable (and no password) leaves the CLI.
# Sets ENV_PRESENT (0/1) and ENV_VALUE; refuses on duplicates or malformed entries.
read_container_env() {
  local key="$1" id="$2" out line count=0
  ENV_PRESENT=0
  ENV_VALUE=""
  capture out docker inspect --format "{{range .Config.Env}}{{\$kv := split . \"=\"}}{{if eq (index \$kv 0) \"$key\"}}{{len \$kv}} {{index \$kv 1}}{{println}}{{end}}{{end}}" "$id" \
    || refuse "cannot read $key from the selected container"
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    count=$((count + 1))
    [ "${line%% *}" = 2 ] || refuse "$key has an unsupported value in the selected container"
    ENV_VALUE="${line#2 }"
  done <<< "$out"
  [ "$count" -le 1 ] || refuse "$key is ambiguous in the selected container"
  [ "$count" -eq 0 ] || ENV_PRESENT=1
}

# ---------------------------------------------------------------------------
# 0. Pin identities, database target and storage driver (no output yet).
# ---------------------------------------------------------------------------
DATA_MOUNT="$(resolve_compose_data_volume)" || exit 1
DATA_VOLUME="${DATA_MOUNT%%:*}"
DATA_DESTINATION="${DATA_MOUNT#*:}"
pin_container APP_ID taskdesk
pin_container DB_ID postgres

capture APP_LABELS docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$APP_ID" \
  || refuse "cannot inspect application labels"
PROJECT="${APP_LABELS%%|*}"
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || refuse "unexpected Compose project label"
[ "$APP_LABELS" = "$PROJECT|taskdesk" ] || refuse "selected application container is not the taskdesk service"
[ -z "$PROJECT_NAME" ] || [ "$PROJECT" = "$PROJECT_NAME" ] || refuse "selected containers belong to another Compose project"
capture DB_LABELS docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$DB_ID" \
  || refuse "cannot inspect database labels"
[ "$DB_LABELS" = "$PROJECT|postgres" ] || refuse "selected database container is not this project's postgres service"

read_container_env POSTGRES_DB "$DB_ID"
[ "$ENV_PRESENT" = 1 ] && [[ "$ENV_VALUE" =~ $IDENTIFIER_RE ]] || refuse "the database container has no valid POSTGRES_DB"
PIN_DB="$ENV_VALUE"
read_container_env POSTGRES_USER "$DB_ID"
[ "$ENV_PRESENT" = 1 ] && [[ "$ENV_VALUE" =~ $IDENTIFIER_RE ]] || refuse "the database container has no valid POSTGRES_USER"
PIN_USER="$ENV_VALUE"
if [ "$PIN_DB" != "$POSTGRES_DB" ] || [ "$PIN_USER" != "$POSTGRES_USER" ]; then
  refuse "host POSTGRES_DB/POSTGRES_USER differ from the selected database container; restore would target a different database"
fi

read_container_env TASKDESK_STORAGE_DRIVER "$APP_ID"
DRIVER="$ENV_VALUE"
# Trim like the runtime's String.trim(); compare case-insensitively like its toLowerCase().
DRIVER="${DRIVER#"${DRIVER%%[![:space:]]*}"}"
DRIVER="${DRIVER%"${DRIVER##*[![:space:]]}"}"
shopt -s nocasematch
case "$DRIVER" in
  ""|filesystem) ;;
  *) shopt -u nocasematch; refuse "storage driver is not filesystem; S3 objects need the separate paired object backup (no files written)" ;;
esac
shopt -u nocasematch

# ---------------------------------------------------------------------------
# Held-barrier verification (read-only). Called at B0, B1 and B2.
# ---------------------------------------------------------------------------
WITNESS_SQL="SELECT current_database() || '|' || count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()"

assert_barrier() {
  local phase="$1" out mode count
  capture out docker inspect --format '{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$APP_ID" \
    || refuse "$phase: cannot inspect the application container"
  [ "$out" = "$APP_ID|$PROJECT|taskdesk" ] || refuse "$phase: application container identity changed"
  capture out docker inspect --format '{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}' "$DB_ID" \
    || refuse "$phase: cannot inspect the database container"
  [ "$out" = "$DB_ID|$PROJECT|postgres" ] || refuse "$phase: database container identity changed"
  capture out resolve_compose_data_volume || refuse "$phase: cannot resolve the data volume"
  [ "$out" = "$DATA_MOUNT" ] || refuse "$phase: data volume changed"
  capture out docker ps -q --no-trunc --filter "label=com.docker.compose.project=$PROJECT" \
    || refuse "$phase: cannot list running project containers"
  [ "$out" = "$DB_ID" ] || refuse "$phase: application writers are running; only PostgreSQL may run during the backup"
  capture out docker ps -q --no-trunc --filter "volume=$DATA_VOLUME" \
    || refuse "$phase: cannot list data-volume users"
  [ -z "$out" ] || refuse "$phase: a running container mounts the data volume"
  capture out docker inspect --format '{{.HostConfig.NetworkMode}}|{{len .NetworkSettings.Networks}}' "$DB_ID" \
    || refuse "$phase: cannot inspect database networks"
  mode="${out%|*}"
  count="${out##*|}"
  case "$mode" in
    host|none|container:*) refuse "$phase: unsupported database network mode" ;;
  esac
  [ "$count" = 0 ] || refuse "$phase: PostgreSQL is still attached to a network; isolate it first"
  docker exec "$DB_ID" sh -c 'for n in /sys/class/net/*; do [ "$n" = /sys/class/net/lo ] || exit 1; done' \
    || refuse "$phase: PostgreSQL has a non-loopback interface"
  capture out docker exec "$DB_ID" psql -X -Atq -U "$PIN_USER" -d "$PIN_DB" -c "$WITNESS_SQL" \
    || refuse "$phase: cannot check database sessions"
  [ "$out" = "$PIN_DB|0" ] || refuse "$phase: database client sessions are active or the database target changed"
}

# ---------------------------------------------------------------------------
# Owned output and cleanup.
# ---------------------------------------------------------------------------
OWNED=0
DONE=0
TARGET_REAL=""
# Relative to the reserved directory, which becomes the working directory.
DUMP_FILE="postgres.dump"
MOUNT_FILE="attachment-mount.txt"
ATTACHMENTS_TAR="attachments.tar"
PARTIAL_FILE=".SHA256SUMS.partial"
CHECKSUMS_FILE="SHA256SUMS"

finish() {
  local status=$?
  trap - EXIT INT TERM
  if [ "$DONE" = 1 ]; then exit 0; fi
  if [ "$OWNED" = 1 ]; then
    # Only the files this run created, inside the reserved directory it is still
    # standing in: a path swapped after reservation cannot redirect this cleanup.
    rm -f -- "./$DUMP_FILE" "./$ATTACHMENTS_TAR" "./$MOUNT_FILE" "./$PARTIAL_FILE" "./$CHECKSUMS_FILE" \
      || printf 'xx could not remove incomplete backup files in %s\n' "$TARGET_REAL" >&2
    if [ "$(pwd -P)" = "$TARGET_REAL" ]; then
      rmdir -- "$TARGET_REAL" 2>/dev/null \
        || printf 'xx incomplete backup directory left for manual inspection: %s\n' "$TARGET_REAL" >&2
    else
      printf 'xx the reserved backup directory was moved; inspect it manually: %s\n' "$(pwd -P)" >&2
    fi
  fi
  [ "$status" -ne 0 ] || printf 'xx backup did not complete\n' >&2
  printf ' !! If a maintenance barrier is held, release it (scripts/backup-maintenance.sh releases its own run).\n' >&2
  exit 1
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

assert_barrier B0

umask 077
capture PARENT_DIR dirname -- "$TARGET_DIR" || refuse "invalid output directory"
mkdir -p -- "$PARENT_DIR" || refuse "cannot create the backup parent directory"
# The final component is created exclusively: an existing directory, file,
# symlink or a concurrent run with the same target is refused untouched.
mkdir -- "$TARGET_DIR" || refuse "output directory exists or cannot be reserved: $TARGET_DIR"
# Anchor every later write, read, rename and cleanup to the reserved directory
# itself. Before writing, prove it is the new directory: empty and owned by us.
# A path swapped before this check is refused untouched; one swapped later no
# longer affects this run, which only uses relative names from here on.
cd -P -- "$TARGET_DIR" || refuse "cannot enter the reserved output directory: $TARGET_DIR"
shopt -s nullglob dotglob
RESERVED_ENTRIES=(*)
shopt -u nullglob dotglob
if [ "${#RESERVED_ENTRIES[@]}" -ne 0 ] || [ ! -O . ]; then
  refuse "reserved output directory was replaced before use; nothing was written: $TARGET_DIR"
fi
chmod 0700 . || refuse "cannot restrict the reserved output directory"
capture TARGET_REAL pwd -P || refuse "cannot resolve the reserved output directory"
OWNED=1
set -o noclobber

printf '==> Dumping PostgreSQL database to %s/%s\n' "$TARGET_REAL" "$DUMP_FILE"
if ! docker exec "$DB_ID" pg_dump -Fc -U "$PIN_USER" "$PIN_DB" > "$DUMP_FILE"; then
  refuse "pg_dump failed"
fi

printf '==> Verifying dump restorability with pg_restore --list\n'
if ! LIST_OUTPUT="$(docker exec -i "$DB_ID" pg_restore --list < "$DUMP_FILE")"; then
  refuse "pg_restore --list failed for $DUMP_FILE"
fi
LIST_COUNT=0
while IFS= read -r line; do
  case "$line" in
    ""|";"*) ;;
    *) LIST_COUNT=$((LIST_COUNT + 1)) ;;
  esac
done <<< "$LIST_OUTPUT"
if [ "$LIST_COUNT" -le 0 ]; then
  printf 'xx pg_restore --list returned no archive entries for %s\n' "$DUMP_FILE" >&2
  exit 1
fi

assert_barrier B1

printf '==> Archiving attachment volume (%s) to %s/%s\n' "$DATA_VOLUME" "$TARGET_REAL" "$ATTACHMENTS_TAR"
capture HELPER_IMAGE docker inspect --format '{{.Image}}' "$DB_ID" \
  && [ -n "$HELPER_IMAGE" ] || refuse "cannot read the postgres image for the archive helper"
# The stack's own postgres image carries tar, so no unpinned image is pulled.
if ! docker run --rm --network none \
  -v "$DATA_VOLUME:/data:ro" \
  --entrypoint tar "$HELPER_IMAGE" \
  -C /data -cf - . > "$ATTACHMENTS_TAR"; then
  refuse "attachment archive failed"
fi

printf '%s\n' "$DATA_DESTINATION" > "$MOUNT_FILE" || refuse "cannot record attachment mount"
printf '==> Recording SHA-256 checksums\n'
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$DUMP_FILE" "$ATTACHMENTS_TAR" "$MOUNT_FILE" > "$PARTIAL_FILE" || refuse "checksum failed"
else
  shasum -a 256 "$DUMP_FILE" "$ATTACHMENTS_TAR" "$MOUNT_FILE" > "$PARTIAL_FILE" || refuse "checksum failed"
fi

assert_barrier B2

# Publish the completeness marker only after the final barrier check.
mv -- "$PARTIAL_FILE" "$CHECKSUMS_FILE" || refuse "cannot publish SHA256SUMS"
chmod 0600 "$DUMP_FILE" "$ATTACHMENTS_TAR" "$MOUNT_FILE" "$CHECKSUMS_FILE" || refuse "cannot restrict backup file permissions"
DONE=1

printf ' ok Backup complete: %s (pg_restore entries: %s)\n' "$TARGET_REAL" "$LIST_COUNT"
printf ' !! Store TASKDESK_ENCRYPTION_KEY, TASKDESK_AUTH_SECRET, and TASKDESK_ENCRYPTION_KEY_PREVIOUS in your password manager separately from backups.\n'
