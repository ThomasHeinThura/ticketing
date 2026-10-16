#!/usr/bin/env bash
# Build and boot the exact checked-out candidate image without publishing it.
set -Eeuo pipefail

fail() {
  printf 'shipping image smoke: %s\n' "$1" >&2
  exit 1
}

: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
: "${GITHUB_RUN_ATTEMPT:?GITHUB_RUN_ATTEMPT is required}"

candidate_sha="$GITHUB_SHA"
[[ "$candidate_sha" =~ ^[0-9a-f]{40}$ ]] || fail "candidate SHA is not a full lowercase commit SHA"
checkout_sha="$(git rev-parse --verify HEAD^{commit})"
[[ "$checkout_sha" == "$candidate_sha" ]] || fail "checkout SHA does not match the GitHub candidate SHA"

run_suffix="${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
project="taskdesk-image-${run_suffix}"
network="${project}-net"
image_tag="hosted-${run_suffix}"
image_ref="ghcr.io/thomasheinthura/taskdesk:${image_tag}"
work_dir="$(mktemp -d "$RUNNER_TEMP/taskdesk-image-smoke.XXXXXX")"
context="$work_dir/context"
env_file="$work_dir/compose.env"
override_file="$work_dir/compose.override.yml"
proof_file="$RUNNER_TEMP/taskdesk-image-proof-${run_suffix}.json"
mkdir -m 700 "$context"

compose() {
  docker compose --project-name "$project" --project-directory "$context" \
    --env-file "$env_file" -f "$context/compose.yml" -f "$override_file" "$@"
}

cleanup_status=not_started
cleanup() {
  local status=$?
  trap - EXIT
  set +e
  local down_status=0
  if [[ -f "$env_file" ]]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || down_status=$?
  fi
  local network_status=0 image_status=0
  if docker network inspect "$network" >/dev/null 2>&1; then
    docker network rm "$network" >/dev/null 2>&1 || network_status=$?
  fi
  if docker image inspect "$image_ref" >/dev/null 2>&1; then
    docker image rm "$image_ref" >/dev/null 2>&1 || image_status=$?
  fi
  rm -rf "$work_dir" || true
  local temp_status=0
  [[ ! -e "$work_dir" ]] || temp_status=1
  if [[ $down_status -eq 0 && $network_status -eq 0 && $image_status -eq 0 && $temp_status -eq 0 ]]; then
    cleanup_status=complete
  else
    cleanup_status=failed
  fi
  if [[ -f "$proof_file" ]]; then
    node - "$proof_file" "$cleanup_status" "$status" "$down_status" \
      "$network_status" "$image_status" "$temp_status" <<'NODE'
const fs = require("node:fs");
const [file, cleanup, exitCode, composeDown, networkRemoval, imageRemoval, tempRemoval] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
    proof.cleanup = {
      status: cleanup,
  composeDown: Number(composeDown),
  networkRemoval: Number(networkRemoval),
  imageRemoval: Number(imageRemoval),
  temporaryContextRemoved: tempRemoval === "0",
      commandExitCode: Number(exitCode),
    };
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
NODE
  fi
  if [[ $status -eq 0 && ( $down_status -ne 0 || $network_status -ne 0 || $image_status -ne 0 || $temp_status -ne 0 ) ]]; then
    printf 'shipping image smoke: owned-resource cleanup failed\n' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

node - "$proof_file" "$candidate_sha" "$checkout_sha" "$image_ref" <<'NODE'
const fs = require("node:fs");
const [file, candidate, checkout, image] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  candidateSha: candidate,
  checkoutSha: checkout,
  imageRef: image,
  build: "pending",
  imageId: null,
  platform: null,
  configuredUser: null,
  runtimeUid: null,
  migrationJournalEntries: null,
  appliedMigrations: null,
  healthcheck: "pending",
  liveProbe: "pending",
  readyProbe: "pending",
  cleanup: { status: "pending" },
}, null, 2)}\n`, { mode: 0o600 });
NODE

# Archive the checked-out event candidate rather than relying on checkout's ref name.
git archive --format=tar "$candidate_sha" | tar -xf - -C "$context"

postgres_password="$(openssl rand -hex 24)"
app_password="$(openssl rand -hex 24)"
encryption_key="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"
cat > "$env_file" <<EOF
POSTGRES_DB=taskdesk
POSTGRES_USER=taskdesk
POSTGRES_PASSWORD=$postgres_password
TASKDESK_APP_DB_PASSWORD=$app_password
TASKDESK_ENCRYPTION_KEY=$encryption_key
TASKDESK_AUTH_SECRET=$auth_secret
TASKDESK_AGENT_URL=https://ticket.localhost
TASKDESK_PORTAL_URL=https://portal.localhost
TASKDESK_IMAGE_TAG=$image_tag
TASKDESK_IMAGE_DIGEST=
EOF
chmod 600 "$env_file"
cat > "$override_file" <<EOF
networks:
  taskdesk:
    name: $network
EOF

docker_arch="$(docker info --format '{{.Architecture}}')"
case "$docker_arch" in
  aarch64|arm64) docker_platform_arch=arm64 ;;
  x86_64|amd64) docker_platform_arch=amd64 ;;
  *) fail "unsupported hosted Docker architecture: $docker_arch" ;;
esac
docker build --pull --platform "linux/$docker_platform_arch" \
  --build-arg "GIT_SHA=$candidate_sha" --tag "$image_ref" "$context" >/dev/null
image_id="$(docker image inspect --format '{{.Id}}' "$image_ref")"
image_os="$(docker image inspect --format '{{.Os}}' "$image_ref")"
image_arch="$(docker image inspect --format '{{.Architecture}}' "$image_ref")"
configured_user="$(docker image inspect --format '{{.Config.User}}' "$image_ref")"
[[ "$image_os" == linux && -n "$image_arch" ]] || fail "built image platform is not a Linux platform"
[[ -n "$configured_user" && "$configured_user" != 0 && "$configured_user" != root ]] || fail "image does not declare a non-root runtime user"

journal_entries="$(node -e 'process.stdout.write(String(require(process.argv[1]).entries.length))' "$context/apps/api/drizzle/meta/_journal.json")"
[[ "$journal_entries" =~ ^[1-9][0-9]*$ ]] || fail "source migration journal is empty or unreadable"

node - "$proof_file" "$image_id" "$image_os/$image_arch" "$configured_user" "$journal_entries" <<'NODE'
const fs = require("node:fs");
const [file, id, platform, user, count] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
Object.assign(proof, { build: "passed", imageId: id, platform, configuredUser: user, migrationJournalEntries: Number(count) });
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
NODE

timeout 300s docker compose --project-name "$project" --project-directory "$context" \
  --env-file "$env_file" -f "$context/compose.yml" -f "$override_file" \
  up -d --wait --wait-timeout 285 taskdesk >/dev/null 2>&1 || fail "candidate stack failed to migrate or become healthy"
migrate_id="$(compose ps -a -q migrate)"
[[ -n "$migrate_id" ]] || fail "Compose did not retain the one-shot migration container"
migrate_exit="$(docker inspect --format '{{.State.ExitCode}}' "$migrate_id")"
[[ "$migrate_exit" == 0 ]] || fail "migration service did not exit successfully"

applied_migrations="$(compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc '\''select count(*) from "__drizzle_migrations"'\''')"
[[ "$applied_migrations" == "$journal_entries" ]] || fail "database applied-migration count differs from the source journal count"

runtime_uid="$(compose exec -T taskdesk id -u | tr -d '\r\n')"
[[ "$runtime_uid" =~ ^[1-9][0-9]*$ ]] || fail "running application container is not using a non-root UID"
health_status="$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q taskdesk)")"
[[ "$health_status" == healthy ]] || fail "application image healthcheck is not healthy"

probe_status=pending
for endpoint in live ready; do
  probe_status=pending
  for _ in $(seq 1 30); do
    if compose exec -T taskdesk wget -q --spider "http://127.0.0.1:5173/api/public/health/$endpoint" >/dev/null 2>&1; then
      probe_status=passed
      break
    fi
    sleep 2
  done
  [[ "$probe_status" == passed ]] || fail "application $endpoint probe did not return success"
  if [[ "$endpoint" == live ]]; then live_status=passed; else ready_status=passed; fi
done

node - "$proof_file" "$runtime_uid" "$applied_migrations" "$health_status" "$live_status" "$ready_status" <<'NODE'
const fs = require("node:fs");
const [file, uid, applied, health, live, ready] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
Object.assign(proof, { runtimeUid: Number(uid), appliedMigrations: Number(applied), healthcheck: health, liveProbe: live, readyProbe: ready });
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
NODE
printf 'shipping image smoke passed for %s (%s)\n' "$candidate_sha" "$image_id"
