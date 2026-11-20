#!/usr/bin/env bash
#
# TaskDesk backup maintenance wrapper — the only command that holds and
# releases the backup barrier for one run.
#
#   scripts/backup-maintenance.sh --project-name <name> (--backup <id> | --output-dir <dir>)
#
# Specification: docs/technical/operations-and-distribution.md#backup-and-restore-method
#   1. Preflight, no mutation: pin the app/PostgreSQL containers, database name/user and
#      data volume; refuse a running migrate/one-off/unknown service, a data-volume user
#      outside this project, or a database network record that cannot be restored exactly.
#   2. Hold: stop this project's known long-lived services, require zero database clients,
#      then disconnect PostgreSQL from every recorded network.
#   3. Run scripts/backup.sh (verify-only), then release in an EXIT handler: reconnect the
#      recorded networks with their exact aliases, restart only what was running, check
#      readiness. Never `compose up`, `restart`, migrate or pull.
# Exit codes: 0 backup published and release verified; 1 backup not published and
# release verified (or nothing was changed); 2 release failed or unknown; 3 release
# verified (or not needed) but the outcome evidence could not be written.
# The private record directory is kept after every run as evidence; it is never an
# input for a later run.
# Output and record-root paths containing control characters are unsupported.

# Deliberately no `-e`: every command below is checked explicitly so that the
# release handler can never be skipped.
set -Euo pipefail
umask 077

no_control() { [[ "$1" != *[[:cntrl:]]* ]]; }
physical_dir() {
  local value
  value="$(cd -P -- "$2" && pwd -P && printf '.')" || return 1
  value="${value%.}"
  value="${value%$'\n'}"
  no_control "$value" || return 1
  printf -v "$1" '%s' "$value"
}
no_control "${BASH_SOURCE[0]}" || { printf 'xx control characters in source path are unsupported\n' >&2; exit 1; }
physical_dir INVOCATION_DIR . || { printf 'xx invalid invocation directory\n' >&2; exit 1; }
physical_dir REPO_ROOT "$(dirname "${BASH_SOURCE[0]}")/.." || { printf 'xx invalid source directory\n' >&2; exit 1; }
cd "$REPO_ROOT" || exit 1

KNOWN_SERVICES=" taskdesk valkey seaweedfs mailpit traefik proxy web "
IDENTIFIER_RE='^[A-Za-z_][A-Za-z0-9_-]{0,62}$'
ALIAS_RE='^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'
WITNESS_SQL="SELECT current_database() || '|' || count(*) FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()"
LABELS_FORMAT='{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.oneoff"}}'
NETWORKS_FORMAT='{{range $k, $n := .NetworkSettings.Networks}}{{$n.NetworkID}} {{join $n.Aliases ","}}{{println}}{{end}}'

usage() {
  cat <<'EOF'
Usage:
  scripts/backup-maintenance.sh --project-name <name> (--backup <id> | --output-dir <dir>)

Holds the maintenance barrier for one backup run, runs scripts/backup.sh, then releases it.
Output and record-root paths containing control characters are unsupported.
Exit codes: 0 backup published and released; 1 not published, released or unchanged; 2 release failed or unknown;
3 released or unchanged, but the outcome evidence could not be written.
EOF
  exit "${1:-1}"
}

refuse() {
  printf 'xx refusing maintenance backup: %s\n' "$*" >&2
  exit 1
}

PROJECT=""
TARGET_ARGS=()
TARGET_COUNT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project-name)
      [ $# -ge 2 ] || usage 1
      PROJECT="$2"
      shift 2
      ;;
    --backup|--output-dir)
      [ $# -ge 2 ] || usage 1
      TARGET_ARGS=("$1" "$2")
      TARGET_COUNT=$((TARGET_COUNT + 1))
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
[[ "$PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { printf 'xx --project-name is required and must be a valid Compose project name\n' >&2; exit 1; }
[ "$TARGET_COUNT" -eq 1 ] || { printf 'xx exactly one of --backup or --output-dir is required\n' >&2; exit 1; }
no_control "${TASKDESK_BACKUP_ROOT:-}" || refuse "control characters in record root are unsupported"
no_control "${TARGET_ARGS[1]}" || refuse "control characters in output paths are unsupported"
no_control "${TMPDIR:-}" || refuse "control characters in TMPDIR are unsupported"

if [ "${TARGET_ARGS[0]}" = "--backup" ]; then
  [[ "${TARGET_ARGS[1]}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$ ]] || refuse "invalid backup identifier"
  TARGET_PATH="${TASKDESK_BACKUP_ROOT:-$REPO_ROOT/backups}/${TARGET_ARGS[1]}"
  case "$TARGET_PATH" in /*) ;; *) TARGET_PATH="$REPO_ROOT/$TARGET_PATH" ;; esac
else
  [ -n "${TARGET_ARGS[1]}" ] || refuse "output directory must not be empty"
  case "${TARGET_ARGS[1]}" in /*) ;; *) TARGET_ARGS[1]="$INVOCATION_DIR/${TARGET_ARGS[1]}" ;; esac
  while [ "${TARGET_ARGS[1]%/}" != "${TARGET_ARGS[1]}" ] && [ "${TARGET_ARGS[1]}" != / ]; do TARGET_ARGS[1]="${TARGET_ARGS[1]%/}"; done
  case "${TARGET_ARGS[1]##*/}" in ""|.|..) refuse "invalid output directory" ;; esac
  TARGET_PATH="${TARGET_ARGS[1]}"
fi
# Do not collapse traversal across symlinks or a component that does not exist yet.
check_traversal() {
  local remaining="${1#/}" prefix="" missing=0 part
  while [ -n "$remaining" ]; do
    part="${remaining%%/*}"
    case "$remaining" in */*) remaining="${remaining#*/}" ;; *) remaining="" ;; esac
    [ -n "$part" ] || continue
    [ "$part" != .. ] || [ "$missing" = 0 ] || refuse "path traversal follows a missing component"
    prefix="$prefix/$part"
    [ -e "$prefix" ] || [ -L "$prefix" ] || missing=1
  done
}
check_traversal "$TARGET_PATH"
[ ! -e "$TARGET_PATH" ] && [ ! -L "$TARGET_PATH" ] || refuse "output directory already exists"
TARGET_PARENT="${TARGET_PATH%/*}"
[ -n "$TARGET_PARENT" ] || TARGET_PARENT=/
while [ ! -e "$TARGET_PARENT" ] && [ ! -L "$TARGET_PARENT" ]; do
  TARGET_PARENT="${TARGET_PARENT%/*}"
  [ -n "$TARGET_PARENT" ] || TARGET_PARENT=/
done
[ -d "$TARGET_PARENT" ] && [ -w "$TARGET_PARENT" ] || refuse "output parent is not a writable directory"
physical_dir TARGET_PARENT_REAL "$TARGET_PARENT" || refuse "invalid physical output parent"
dc() { docker compose -f "$REPO_ROOT/compose.yml" -p "$PROJECT" "$@"; }
# shellcheck source=scripts/lib/compose-data-volume.sh
. "$REPO_ROOT/scripts/lib/compose-data-volume.sh"

# Status before content: assign stdout only when the command succeeded.
capture() {
  local __name="$1" __out
  shift
  if ! __out="$("$@")"; then return 1; fi
  printf -v "$__name" '%s' "$__out"
}

is_known_service() {
  case "$KNOWN_SERVICES" in *" $1 "*) return 0 ;; esac
  return 1
}

# Sets ENV_PRESENT/ENV_VALUE for one named, non-secret container variable.
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

pin_container() {
  local __name="$1" service="$2" short full
  capture short dc ps -a -q "$service" || refuse "cannot list the $service container"
  [[ "$short" =~ ^[a-f0-9]{12,64}$ ]] || refuse "expected exactly one $service container"
  capture full docker inspect --format '{{.Id}}' "$short" || refuse "cannot inspect the $service container"
  [[ "$full" =~ ^[a-f0-9]{64}$ ]] || refuse "unexpected $service container identity"
  printf -v "$__name" '%s' "$full"
}

# ---------------------------------------------------------------------------
# Private record directory: outside OS temp, created exclusively, kept forever.
# ---------------------------------------------------------------------------
REC_ROOT="${TASKDESK_BACKUP_ROOT:-$REPO_ROOT/backups}"
case "$REC_ROOT" in /*) ;; *) REC_ROOT="$REPO_ROOT/$REC_ROOT" ;; esac
check_traversal "$REC_ROOT"
REC_PROBE="$REC_ROOT"
while [ ! -e "$REC_PROBE" ] && [ ! -L "$REC_PROBE" ]; do
  REC_PROBE="${REC_PROBE%/*}"
  [ -n "$REC_PROBE" ] || REC_PROBE=/
done
physical_dir REC_PROBE_REAL "$REC_PROBE" || refuse "invalid physical record root"
if [ -n "${TMPDIR:-}" ]; then
  if [ -d "$TMPDIR" ]; then physical_dir TMP_REAL "$TMPDIR" || refuse "invalid physical TMPDIR"; else TMP_REAL="${TMPDIR%/}"; fi
fi
mkdir -p -- "$REC_ROOT" || refuse "cannot create the backup root"
physical_dir REC_ROOT_REAL "$REC_ROOT" || refuse "cannot resolve the backup root"
case "$REC_ROOT_REAL/" in
  /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) refuse "the record directory must not be under an OS temp directory" ;;
esac
if [ -n "${TMPDIR:-}" ]; then
  case "$REC_ROOT_REAL/" in "$TMP_REAL"/*) refuse "the record directory must not be under TMPDIR" ;; esac
fi
capture STAMP date -u +%Y%m%dT%H%M%SZ || refuse "cannot read the clock"
REC="$REC_ROOT_REAL/.maintenance-$PROJECT-$STAMP"
mkdir -- "$REC" || refuse "cannot reserve the record directory $REC"
cd -P -- "$REC" || refuse "cannot enter the reserved record directory"
shopt -s nullglob dotglob
record_entries=(*)
shopt -u nullglob dotglob
[ "${#record_entries[@]}" -eq 0 ] && [ -O . ] || refuse "record directory replaced before use; nothing written"
chmod 0700 . || refuse "cannot secure record directory"
record_mode="$(stat -f %Lp . 2>/dev/null)" || record_mode="$(stat -c %a . 2>/dev/null)" || refuse "cannot verify record directory mode"
[ "$record_mode" = 700 ] || refuse "record directory mode is not 0700"
physical_dir REC_PHYSICAL . || refuse "cannot resolve the record directory"
[ ! -e "$TARGET_PATH" ] && [ ! -L "$TARGET_PATH" ] || refuse "output directory already exists after creating the record"
TARGET_PARENT="${TARGET_PATH%/*}"
[ -n "$TARGET_PARENT" ] || TARGET_PARENT=/
while [ ! -e "$TARGET_PARENT" ] && [ ! -L "$TARGET_PARENT" ]; do
  TARGET_PARENT="${TARGET_PARENT%/*}"
  [ -n "$TARGET_PARENT" ] || TARGET_PARENT=/
done
physical_dir TARGET_PARENT_REAL "$TARGET_PARENT" || refuse "cannot resolve output parent"
case "$TARGET_PARENT_REAL/" in "$REC_PHYSICAL/"*) refuse "output overlaps the record directory" ;; esac

# ---------------------------------------------------------------------------
# Outcome reporting and release (installed before any mutation).
# ---------------------------------------------------------------------------
MUTATING=0
BACKUP_RESULT=not-run
RELEASE=not-needed
OBSERVED=""
RUNNING=()
RUNNING_SVC=()
RUNNING_COUNT=0
NET_IDS=()
NET_ALIASES=()
NET_COUNT=0

in_list() { # needle haystack...
  local needle="$1" item
  shift
  for item in "$@"; do [ "$item" = "$needle" ] && return 0; done
  return 1
}

# Equal comma-separated alias sets; saved aliases have no duplicates.
alias_sets_equal() {
  local a=() b=() x
  IFS=',' read -r -a a <<< "$1"
  IFS=',' read -r -a b <<< "$2"
  [ "${#a[@]}" -eq "${#b[@]}" ] || return 1
  for x in "${a[@]+"${a[@]}"}"; do in_list "$x" "${b[@]+"${b[@]}"}" || return 1; done
  for x in "${b[@]+"${b[@]}"}"; do in_list "$x" "${a[@]+"${a[@]}"}" || return 1; done
  return 0
}

observe() {
  local i out nets="" network_data="" line
  OBSERVED=""
  OBSERVATION_STATUS=verified
  i=0
  while [ "$i" -lt "$RUNNING_COUNT" ]; do
    if capture out docker inspect --format '{{.State.Running}}' "${RUNNING[$i]}" && { [ "$out" = true ] || [ "$out" = false ]; }; then
      [ "$out" = true ] || { [ "$OBSERVATION_STATUS" = unknown ] || OBSERVATION_STATUS=failed; }
    else
      out=unknown
      OBSERVATION_STATUS=unknown
    fi
    OBSERVED="${OBSERVED}writer ${RUNNING[$i]} running=$out"$'\n'
    i=$((i + 1))
  done
  if capture out docker inspect --format '{{.State.Running}}' "$APP" && { [ "$out" = true ] || [ "$out" = false ]; }; then
    [ "$out" = "$APP_WAS_RUNNING" ] || { [ "$OBSERVATION_STATUS" = unknown ] || OBSERVATION_STATUS=failed; }
  else
    out=unknown
    OBSERVATION_STATUS=unknown
  fi
  OBSERVED="${OBSERVED}app $APP running=$out"$'\n'
  if capture network_data docker inspect --format "$NETWORKS_FORMAT" "$DB"; then
    while IFS= read -r line; do [ -n "$line" ] && nets="${nets}${nets:+;}$line"; done <<< "$network_data"
    networks_match_text "$network_data" || { [ "$OBSERVATION_STATUS" = unknown ] || OBSERVATION_STATUS=failed; }
    OBSERVED="${OBSERVED}db_networks=${nets:-none}"$'\n'
  else
    OBSERVATION_STATUS=unknown
    OBSERVED="${OBSERVED}db_networks=unknown"$'\n'
  fi
}

stop_again() {
  local i=0
  while [ "$i" -lt "$RUNNING_COUNT" ]; do
    if ! docker stop "${RUNNING[$i]}" >/dev/null; then
      printf 'xx could not stop %s again\n' "${RUNNING[$i]}" >&2
    fi
    i=$((i + 1))
  done
}

# Exact original network IDs and alias sets on the database, and nothing else.
# Returns 0 when they match, 1 when they differ, 2 when they cannot be read.
networks_match_text() {
  local out="$1" line nid aliases found i count=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    count=$((count + 1))
    nid="${line%% *}"
    aliases="${line#* }"
    found=0
    i=0
    while [ "$i" -lt "$NET_COUNT" ]; do
      if [ "${NET_IDS[$i]}" = "$nid" ] && alias_sets_equal "$aliases" "${NET_ALIASES[$i]}"; then found=1; fi
      i=$((i + 1))
    done
    [ "$found" = 1 ] || return 1
  done <<< "$out"
  [ "$count" -eq "$NET_COUNT" ] || return 1
  return 0
}

networks_match() {
  local out
  capture out docker inspect --format "$NETWORKS_FORMAT" "$DB" || return 2
  networks_match_text "$out"
}

release() {
  local i out line nid aliases current=() cur_count=0 args=() alias_list=() a found attempt
  # 1. The pinned containers must still be the same containers.
  if ! capture out docker inspect --format '{{.Id}}' "$DB"; then RELEASE=unknown; observe; return; fi
  if [ "$out" != "$DB" ]; then RELEASE=failed; observe; return; fi
  i=0
  while [ "$i" -lt "$RUNNING_COUNT" ]; do
    if ! capture out docker inspect --format "$LABELS_FORMAT" "${RUNNING[$i]}"; then RELEASE=unknown; observe; return; fi
    case "$out" in
      "${RUNNING[$i]}|$PROJECT|${RUNNING_SVC[$i]}|"|"${RUNNING[$i]}|$PROJECT|${RUNNING_SVC[$i]}|False") ;;
      *) RELEASE=failed; observe; return ;;
    esac
    i=$((i + 1))
  done
  # 2. Reconcile against the original record, whatever earlier commands reported.
  if ! capture out docker inspect --format '{{range $k, $n := .NetworkSettings.Networks}}{{$n.NetworkID}}{{println}}{{end}}' "$DB"; then
    RELEASE=unknown; observe; return
  fi
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    current+=("$line")
    cur_count=$((cur_count + 1))
  done <<< "$out"
  i=0
  while [ "$i" -lt "$NET_COUNT" ]; do
    if ! in_list "${NET_IDS[$i]}" "${current[@]+"${current[@]}"}"; then
      args=()
      IFS=',' read -r -a alias_list <<< "${NET_ALIASES[$i]}"
      for a in "${alias_list[@]+"${alias_list[@]}"}"; do args+=(--alias "$a"); done
      if ! docker network connect "${args[@]}" "${NET_IDS[$i]}" "$DB"; then
        RELEASE=failed; observe; return
      fi
    fi
    i=$((i + 1))
  done
  # 3. The exact original network IDs and alias sets, and nothing else.
  networks_match
  case $? in
    0) ;;
    2) RELEASE=unknown; observe; return ;;
    *) RELEASE=failed; observe; return ;;
  esac
  # 4. Restart only the long-lived services that were running before.
  if [ "$RUNNING_COUNT" -gt 0 ]; then
    if ! docker start "${RUNNING[@]}" >/dev/null; then stop_again; RELEASE=failed; observe; return; fi
    i=0
    while [ "$i" -lt "$RUNNING_COUNT" ]; do
      if ! capture out docker inspect --format '{{.State.Running}}' "${RUNNING[$i]}" || [ "$out" != true ]; then
        stop_again; RELEASE=failed; observe; return
      fi
      i=$((i + 1))
    done
  fi
  # 5. The application: ready if it was running before, still stopped otherwise.
  if [ "$APP_WAS_RUNNING" = true ]; then
    if ! docker exec "$APP" node -e "require('node:dns').lookup('postgres', (e) => process.exit(e ? 1 : 0))" >/dev/null 2>&1; then
      stop_again; RELEASE=failed; observe; return
    fi
    attempt=0
    while :; do
      if docker exec "$APP" node -e "fetch('http://127.0.0.1:${APP_PORT}/api/public/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
        break
      fi
      attempt=$((attempt + 1))
      if [ "$attempt" -ge 30 ]; then stop_again; RELEASE=failed; observe; return; fi
      sleep 2
    done
  else
    if ! capture out docker inspect --format '{{.State.Running}}' "$APP" || [ "$out" != false ]; then
      RELEASE=failed; observe; return
    fi
  fi
  # Capture and validate the same facts that will be written to the record.
  observe
  case "$OBSERVATION_STATUS" in
    unknown) RELEASE=unknown ;;
    failed) RELEASE=failed ;;
    *) RELEASE=verified ;;
  esac
}

OUTCOME_WRITTEN=0
report_outcome() {
  local text
  text="backup=$BACKUP_RESULT"$'\n'"release=$RELEASE"$'\n'"$OBSERVED"
  printf '%s' "$text" >&2
  if ! printf '%s' "$text" > "./outcome"; then
    printf 'xx evidence failure: the outcome record could not be written; the backup and release lines above are the only report and the on-disk record is incomplete\n' >&2
  else
    OUTCOME_WRITTEN=1
    printf ' .. evidence record: %s\n' "$(pwd -P 2>/dev/null || printf '%s (moved; locate by inspection)' "$REC_PHYSICAL")" >&2
  fi
  case "$RELEASE" in
    failed|unknown)
      printf 'xx barrier release %s; recovery needs a separately reviewed, environment-specific plan (no compose up/restart/migrate). The record is context only.\n' "$RELEASE" >&2
      ;;
  esac
}

on_exit() {
  local st=$?
  trap - EXIT
  trap '' INT TERM HUP
  if [ "$MUTATING" = 1 ]; then release; fi
  report_outcome
  case "$RELEASE" in
    verified|not-needed) ;;
    *) exit 2 ;;
  esac
  [ "$OUTCOME_WRITTEN" = 1 ] || exit 3
  exit "$st"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

# ---------------------------------------------------------------------------
# 1. Preflight (no mutation).
# ---------------------------------------------------------------------------
APP=""
DB=""
pin_container APP taskdesk
pin_container DB postgres
capture out docker inspect --format "$LABELS_FORMAT" "$APP" || refuse "cannot inspect application labels"
case "$out" in "$APP|$PROJECT|taskdesk|"|"$APP|$PROJECT|taskdesk|False") ;; *) refuse "selected application container is not this project's taskdesk service" ;; esac
capture out docker inspect --format "$LABELS_FORMAT" "$DB" || refuse "cannot inspect database labels"
case "$out" in "$DB|$PROJECT|postgres|"|"$DB|$PROJECT|postgres|False") ;; *) refuse "selected database container is not this project's postgres service" ;; esac
capture out docker inspect --format '{{.State.Running}}|{{.HostConfig.NetworkMode}}' "$DB" || refuse "cannot inspect the database state"
[ "${out%%|*}" = true ] || refuse "PostgreSQL is not running"
case "${out#*|}" in host|none|container:*) refuse "unsupported database network mode" ;; esac
capture APP_WAS_RUNNING docker inspect --format '{{.State.Running}}' "$APP" || refuse "cannot inspect the application state"
case "$APP_WAS_RUNNING" in true|false) ;; *) refuse "unexpected application state" ;; esac

read_container_env POSTGRES_DB "$DB"
[ "$ENV_PRESENT" = 1 ] && [[ "$ENV_VALUE" =~ $IDENTIFIER_RE ]] || refuse "the database container has no valid POSTGRES_DB"
PIN_DB="$ENV_VALUE"
read_container_env POSTGRES_USER "$DB"
[ "$ENV_PRESENT" = 1 ] && [[ "$ENV_VALUE" =~ $IDENTIFIER_RE ]] || refuse "the database container has no valid POSTGRES_USER"
PIN_USER="$ENV_VALUE"
read_container_env TASKDESK_PORT "$APP"
APP_PORT="5173"
[ "$ENV_PRESENT" = 0 ] || APP_PORT="$ENV_VALUE"
[[ "$APP_PORT" =~ ^[0-9]{1,5}$ ]] || refuse "the application container has an invalid TASKDESK_PORT"

capture DATA_MOUNT resolve_compose_data_volume || refuse "cannot resolve the data volume"
DATA_VOLUME="${DATA_MOUNT%%:*}"

# Local writer inventory: only this project's known long-lived services may be stopped.
capture out docker ps -q --no-trunc --filter "label=com.docker.compose.project=$PROJECT" || refuse "cannot list running project containers"
while IFS= read -r id; do
  [ -n "$id" ] || continue
  [[ "$id" =~ ^[a-f0-9]{64}$ ]] || refuse "unexpected container ID in the project inventory"
  [ "$id" != "$DB" ] || continue
  capture meta docker inspect --format "$LABELS_FORMAT" "$id" || refuse "cannot inspect running container $id"
  IFS='|' read -r m_id m_project m_service m_oneoff <<< "$meta"
  [ "$m_id" = "$id" ] && [ "$m_project" = "$PROJECT" ] || refuse "container $id is not part of project $PROJECT"
  case "$m_oneoff" in ""|False) ;; *) refuse "one-off container $id ($m_service) is running; wait for it to finish and retry" ;; esac
  is_known_service "$m_service" || refuse "service $m_service ($id) is running (for example migrate); wait for it to finish and retry"
  RUNNING+=("$id")
  RUNNING_SVC+=("$m_service")
  RUNNING_COUNT=$((RUNNING_COUNT + 1))
done <<< "$out"

# Every running user of the data volume must be one of those local services.
capture out docker ps -q --no-trunc --filter "volume=$DATA_VOLUME" || refuse "cannot list data-volume users"
while IFS= read -r id; do
  [ -n "$id" ] || continue
  in_list "$id" "${RUNNING[@]+"${RUNNING[@]}"}" \
    || refuse "container $id outside this project's known services mounts the data volume; stop it under its own owner's procedure"
done <<< "$out"

# The database's original networks and aliases, which release must restore exactly.
capture out docker inspect --format "$NETWORKS_FORMAT" "$DB" || refuse "cannot read the database networks"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  nid="${line%% *}"
  aliases="${line#* }"
  [ "$nid" != "$line" ] || refuse "database network $nid has no aliases"
  [[ "$nid" =~ ^[a-f0-9]{64}$ ]] || refuse "unexpected database network ID"
  in_list "$nid" "${NET_IDS[@]+"${NET_IDS[@]}"}" && refuse "duplicate database network $nid"
  case "$aliases" in ""|*,|,*|*,,*) refuse "database network $nid has an empty alias" ;; esac
  list=()
  IFS=',' read -r -a list <<< "$aliases"
  seen=()
  has_postgres=0
  for a in "${list[@]+"${list[@]}"}"; do
    [[ "$a" =~ $ALIAS_RE ]] || refuse "database network $nid has an unsupported alias"
    in_list "$a" "${seen[@]+"${seen[@]}"}" && refuse "database network $nid repeats an alias"
    seen+=("$a")
    [ "$a" != postgres ] || has_postgres=1
  done
  [ "$has_postgres" = 1 ] || refuse "database network $nid has no postgres alias"
  NET_IDS+=("$nid")
  NET_ALIASES+=("$aliases")
  NET_COUNT=$((NET_COUNT + 1))
done <<< "$out"
[ "$NET_COUNT" -gt 0 ] || refuse "PostgreSQL has no networks to record (already isolated); this needs a separately reviewed procedure"

# Write the record (IDs, names and aliases only — no secrets).
{
  printf 'project=%s\napp=%s\ndb=%s\napp_was_running=%s\ndb_name=%s\ndb_user=%s\napp_port=%s\ndata_volume=%s\n' \
    "$PROJECT" "$APP" "$DB" "$APP_WAS_RUNNING" "$PIN_DB" "$PIN_USER" "$APP_PORT" "$DATA_VOLUME"
} > "./ids" || refuse "cannot write the record"
: > "./running" || refuse "cannot write the record"
i=0
while [ "$i" -lt "$RUNNING_COUNT" ]; do
  printf '%s %s\n' "${RUNNING[$i]}" "${RUNNING_SVC[$i]}" >> "./running" || refuse "cannot write the record"
  i=$((i + 1))
done
: > "./networks" || refuse "cannot write the record"
i=0
while [ "$i" -lt "$NET_COUNT" ]; do
  printf '%s %s\n' "${NET_IDS[$i]}" "${NET_ALIASES[$i]}" >> "./networks" || refuse "cannot write the record"
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# 2. Hold. From here every exit runs the release handler.
# ---------------------------------------------------------------------------
MUTATING=1
i=0
while [ "$i" -lt "$RUNNING_COUNT" ]; do
  if ! docker stop "${RUNNING[$i]}" >/dev/null; then
    printf 'xx could not stop %s\n' "${RUNNING[$i]}" >&2
    exit 1
  fi
  i=$((i + 1))
done
i=0
while [ "$i" -lt "$RUNNING_COUNT" ]; do
  if ! capture out docker inspect --format '{{.State.Running}}' "${RUNNING[$i]}" || [ "$out" != false ]; then
    printf 'xx %s did not stop\n' "${RUNNING[$i]}" >&2
    exit 1
  fi
  i=$((i + 1))
done

# Clients must have drained before PostgreSQL is disconnected; never terminate them.
if ! capture out docker exec "$DB" psql -X -Atq -U "$PIN_USER" -d "$PIN_DB" -c "$WITNESS_SQL"; then
  printf 'xx the database client check failed; PostgreSQL was not disconnected\n' >&2
  exit 1
fi
if [ "$out" != "$PIN_DB|0" ]; then
  printf 'xx database clients are active (or the target changed); coordinate them and retry. PostgreSQL was not disconnected.\n' >&2
  exit 1
fi

i=0
while [ "$i" -lt "$NET_COUNT" ]; do
  if ! printf '%s\n' "${NET_IDS[$i]}" >> "./attempted"; then
    printf 'xx cannot log the network disconnect; stopping before it\n' >&2
    exit 1
  fi
  if ! docker network disconnect "${NET_IDS[$i]}" "$DB"; then
    printf 'xx could not disconnect PostgreSQL from network %s\n' "${NET_IDS[$i]}" >&2
    exit 1
  fi
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# 3. Verify-only backup; the EXIT handler releases whatever the result.
# ---------------------------------------------------------------------------
if "$REPO_ROOT/scripts/backup.sh" --project-name "$PROJECT" "${TARGET_ARGS[@]}"; then
  BACKUP_RESULT=published
  exit 0
fi
BACKUP_RESULT=failed-or-refused
exit 1
