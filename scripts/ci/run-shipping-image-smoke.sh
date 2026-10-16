#!/usr/bin/env bash
# Build and boot the exact candidate image without publishing it.
set -Eeuo pipefail

fail() {
  printf 'shipping image smoke: %s\n' "$1" >&2
  exit 1
}

[[ "${1:-}" == "--candidate-sha" ]] || fail "expected --candidate-sha <sha>"
candidate_sha="${2:-}"
[[ "$candidate_sha" =~ ^[0-9a-f]{40}$ ]] || fail "pass --candidate-sha followed by a full lowercase commit SHA"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

checkout_sha="$(git rev-parse --verify HEAD^{commit})"
git cat-file -e "${candidate_sha}^{commit}" || fail "candidate SHA is not available as a commit"

nonce="$(openssl rand -hex 16)"
run_suffix="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${nonce}"
project="taskdesk-image-${run_suffix}"
network="${project}-net"
image_tag="hosted-${run_suffix}"
image_ref="ghcr.io/thomasheinthura/taskdesk:${image_tag}"
network_label="org.taskdesk.ci-run"
image_label="org.taskdesk.ci-run"
work_dir="$(mktemp -d "$RUNNER_TEMP/taskdesk-image-smoke.XXXXXX")"
context="$work_dir/context"
env_file="$work_dir/compose.env"
override_file="$work_dir/compose.override.yml"
proof_file="$RUNNER_TEMP/taskdesk-image-proof-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}.json"
mkdir -m 700 "$context"

compose() {
  docker compose --project-name "$project" --project-directory "$context" \
    --env-file "$env_file" -f "$context/compose.yml" -f "$override_file" "$@"
}

proof_init() {
  node - "$proof_file" "$candidate_sha" "$checkout_sha" "$image_ref" "$network" <<'NODE'
const fs = require("node:fs");
const [file, candidate, checkout, image, network] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  candidateSha: candidate,
  checkoutSha: checkout,
  imageRef: image,
  networkName: network,
  networkId: null,
  networkDriver: null,
  networkScope: null,
  networkOwnershipLabelVerified: false,
  build: "pending",
  imageId: null,
  platform: null,
  configuredUser: null,
  runtimeUid: null,
  migrateImageId: null,
  taskdeskImageId: null,
  serviceImageIds: {},
  hostPortBindingsByService: {},
  publishAllPortsByService: {},
  serviceNetworkEvidence: {},
  migrationJournalEntries: null,
  appliedMigrations: null,
  healthcheck: "pending",
  liveStatus: null,
  readyStatus: null,
  finalVerdict: "pending",
  cleanup: { status: "pending" },
}, null, 2)}\n`, { mode: 0o600 });
NODE
}

cleanup_status=not_started
network_created=0
image_id=
project_started=0
cleanup() {
  local status=$?
  trap - EXIT
  set +e
  local down_status=0 network_status=0 image_status=0 temp_status=0 proof_status=1
  if [[ $project_started -eq 1 ]]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || down_status=$?
  fi
  if [[ $network_created -eq 1 ]]; then
    local found_label
    found_label="$(docker network inspect --format "{{ index .Labels \"$network_label\" }}" "$network" 2>/dev/null)"
    if [[ "$found_label" == "$nonce" ]]; then
      docker network rm "$network" >/dev/null 2>&1 || network_status=$?
    else
      network_status=1
    fi
  fi
  if [[ -z "$image_id" ]] && docker image inspect "$image_ref" >/dev/null 2>&1; then
    local possible_image_label
    possible_image_label="$(docker image inspect --format "{{ index .Config.Labels \"$image_label\" }}" "$image_ref" 2>/dev/null)"
    if [[ "$possible_image_label" == "$nonce" ]]; then
      image_id="$(docker image inspect --format '{{.Id}}' "$image_ref" 2>/dev/null)"
    fi
  fi
  if [[ -n "$image_id" ]]; then
    local found_image_label
    found_image_label="$(docker image inspect --format "{{ index .Config.Labels \"$image_label\" }}" "$image_id" 2>/dev/null)"
    if [[ "$found_image_label" == "$nonce" ]]; then
      docker image rm "$image_id" >/dev/null 2>&1 || image_status=$?
    else
      image_status=1
    fi
  fi
  rm -rf "$work_dir" || temp_status=$?
  [[ ! -e "$work_dir" ]] || temp_status=1
  if [[ $down_status -eq 0 && $network_status -eq 0 && $image_status -eq 0 && $temp_status -eq 0 ]]; then
    cleanup_status=complete
  else
    cleanup_status=failed
  fi
  if [[ -f "$proof_file" && -r "$proof_file" ]]; then
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
const services = ["migrate", "taskdesk", "postgres", "valkey"];
const isolatedServiceNetwork = services.every((service) => {
  const evidence = proof.serviceNetworkEvidence?.[service];
  const attachments = evidence?.attachments;
  const names = Object.keys(attachments ?? {});
  return evidence?.networkMode === proof.networkName && names.length === 1 &&
    names[0] === proof.networkName && attachments[proof.networkName] === proof.networkId;
});
const noServicePorts = services.every((service) => {
  const bindings = proof.hostPortBindingsByService?.[service];
  const publishAll = proof.publishAllPortsByService?.[service];
  return publishAll === false && (bindings === null ||
    (typeof bindings === "object" && !Array.isArray(bindings) && Object.keys(bindings).length === 0));
});
const configuredUserAccount = String(proof.configuredUser ?? "").split(":", 1)[0];
const configuredUserIsNonRoot = configuredUserAccount.length > 0 &&
  configuredUserAccount !== "root" && !/^0+$/.test(configuredUserAccount);
const complete = proof.candidateSha && /^[0-9a-f]{40}$/.test(proof.candidateSha) &&
  proof.checkoutSha && /^[0-9a-f]{40}$/.test(proof.checkoutSha) &&
  proof.networkName && proof.networkId && proof.networkDriver === "bridge" && proof.networkScope === "local" &&
  proof.networkOwnershipLabelVerified && isolatedServiceNetwork &&
  proof.build === "passed" && proof.imageId && proof.platform &&
  configuredUserIsNonRoot && proof.runtimeUid > 0 && proof.migrateImageId === proof.imageId &&
  proof.taskdeskImageId === proof.imageId && noServicePorts &&
  proof.serviceImageIds?.migrate === proof.imageId && proof.serviceImageIds?.taskdesk === proof.imageId &&
  proof.serviceImageIds?.postgres && proof.serviceImageIds?.valkey &&
  Number.isInteger(proof.migrationJournalEntries) && proof.migrationJournalEntries > 0 &&
  proof.appliedMigrations === proof.migrationJournalEntries && proof.healthcheck === "healthy" &&
  proof.liveStatus === 200 && proof.readyStatus === 200 &&
  cleanup === "complete" && Number(composeDown) === 0 && Number(networkRemoval) === 0 &&
  Number(imageRemoval) === 0 && tempRemoval === "0" && Number(exitCode) === 0;
proof.finalVerdict = complete ? "passed" : "failed";
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
if (!complete) process.exit(2);
NODE
    proof_status=$?
  else
    printf 'shipping image smoke: proof artifact is missing or unreadable after cleanup\n' >&2
  fi
  if [[ $status -eq 0 && ( $down_status -ne 0 || $network_status -ne 0 || $image_status -ne 0 || $temp_status -ne 0 || $proof_status -ne 0 ) ]]; then
    printf 'shipping image smoke: owned-resource cleanup or proof recording failed\n' >&2
    status=1
  fi
  if [[ $status -eq 0 ]]; then
    printf 'shipping image smoke passed for candidate %s (checkout %s, image %s)\n' "$candidate_sha" "$checkout_sha" "$image_id"
  fi
  exit "$status"
}
trap cleanup EXIT
proof_init

# Bind the build context to the explicit PR-head SHA (or merge-group SHA).
git archive --format=tar "$candidate_sha" | tar -xf - -C "$context"

# Refuse nonce collisions; cleanup is limited to resources this run creates and labels.
if docker network inspect "$network" >/dev/null 2>&1; then fail "unique network name already exists"; fi
if docker image inspect "$image_ref" >/dev/null 2>&1; then fail "unique local image tag already exists"; fi

docker network create --driver bridge --label "$network_label=$nonce" "$network" >/dev/null
network_created=1
network_owner="$(docker network inspect --format "{{ index .Labels \"$network_label\" }}" "$network")"
[[ "$network_owner" == "$nonce" ]] || fail "created network ownership label did not match this run"
network_id="$(docker network inspect --format '{{.Id}}' "$network")"
[[ -n "$network_id" ]] || fail "owned isolated network has no network ID"
network_driver="$(docker network inspect --format '{{.Driver}}' "$network")"
network_scope="$(docker network inspect --format '{{.Scope}}' "$network")"
[[ "$network_driver" == bridge && "$network_scope" == local ]] || fail "owned network is not a local bridge network"
node - "$proof_file" "$network_id" "$network_driver" "$network_scope" <<'NODE'
const fs = require("node:fs");
const [file, id, driver, scope] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
proof.networkId = id;
proof.networkDriver = driver;
proof.networkScope = scope;
proof.networkOwnershipLabelVerified = true;
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
NODE

postgres_password="$(openssl rand -hex 24)"
app_password="$(openssl rand -hex 24)"
encryption_key="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"
cat > "$env_file" <<EOF_ENV
POSTGRES_DB=taskdesk
POSTGRES_USER=taskdesk
POSTGRES_PASSWORD=$postgres_password
TASKDESK_APP_DB_PASSWORD=$app_password
TASKDESK_ENCRYPTION_KEY=$encryption_key
TASKDESK_AUTH_SECRET=$auth_secret
TASKDESK_AGENT_URL=https://ticketing.localhost
TASKDESK_PORTAL_URL=https://portal.localhost
TASKDESK_IMAGE_TAG=$image_tag
TASKDESK_IMAGE_DIGEST=
EOF_ENV
chmod 600 "$env_file"
cat > "$override_file" <<EOF_COMPOSE
networks:
  taskdesk:
    name: $network
    external: true
EOF_COMPOSE

architecture="$(docker info --format '{{.Architecture}}')"
case "$architecture" in
  aarch64|arm64) platform_arch=arm64 ;;
  x86_64|amd64) platform_arch=amd64 ;;
  *) fail "unsupported hosted Docker architecture: $architecture" ;;
esac
docker build --pull --platform "linux/$platform_arch" \
  --build-arg "GIT_SHA=$candidate_sha" \
  --label "$image_label=$nonce" \
  --label "org.opencontainers.image.revision=$candidate_sha" \
  --tag "$image_ref" "$context" >/dev/null
image_id="$(docker image inspect --format '{{.Id}}' "$image_ref")"
[[ -n "$image_id" ]] || fail "built image has no image ID"
[[ "$(docker image inspect --format "{{ index .Config.Labels \"$image_label\" }}" "$image_id")" == "$nonce" ]] || fail "built image ownership label did not match this run"
image_os="$(docker image inspect --format '{{.Os}}' "$image_id")"
image_arch="$(docker image inspect --format '{{.Architecture}}' "$image_id")"
configured_user="$(docker image inspect --format '{{.Config.User}}' "$image_id")"
[[ "$image_os" == linux && "$image_arch" == "$platform_arch" ]] || fail "built image platform does not match the hosted platform"
configured_user_account="${configured_user%%:*}"
[[ -n "$configured_user_account" && "$configured_user_account" != root && ! "$configured_user_account" =~ ^0+$ ]] || fail "image does not declare a non-root runtime user"

journal_entries="$(node -e 'process.stdout.write(String(require(process.argv[1]).entries.length))' "$context/apps/api/drizzle/meta/_journal.json")"
[[ "$journal_entries" =~ ^[1-9][0-9]*$ ]] || fail "source migration journal is empty or unreadable"

node - "$proof_file" "$image_id" "linux/$image_arch" "$configured_user" "$journal_entries" <<'NODE'
const fs = require("node:fs");
const [file, id, platform, user, count] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
Object.assign(proof, { build: "passed", imageId: id, platform, configuredUser: user, migrationJournalEntries: Number(count) });
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
NODE

project_started=1
timeout 300s docker compose --project-name "$project" --project-directory "$context" \
  --env-file "$env_file" -f "$context/compose.yml" -f "$override_file" \
  up -d --wait --wait-timeout 285 taskdesk >/dev/null 2>&1 || fail "candidate stack failed to migrate or become healthy"

services=(migrate taskdesk postgres valkey)
service_ids=()
service_image_ids=()
for index in 0 1 2 3; do
  service="${services[$index]}"
  service_ids[$index]="$(compose ps -a -q "$service")"
  [[ -n "${service_ids[$index]}" ]] || fail "Compose did not retain the $service container"
  service_image_ids[$index]="$(docker inspect --format '{{.Image}}' "${service_ids[$index]}")"
  bindings="$(docker inspect --format '{{json .HostConfig.PortBindings}}' "${service_ids[$index]}")"
  publish_all="$(docker inspect --format '{{.HostConfig.PublishAllPorts}}' "${service_ids[$index]}")"
  network_mode="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "${service_ids[$index]}")"
  network_attachments="$(docker inspect --format '{{json .NetworkSettings.Networks}}' "${service_ids[$index]}")"
  node - "$proof_file" "$service" "${service_image_ids[$index]}" "$bindings" "$publish_all" \
    "$network_mode" "$network_attachments" "$network" "$network_id" <<'NODE'
const fs = require("node:fs");
const [file, service, image, rawBindings, publishAll, mode, rawNetworks, ownedName, ownedId] = process.argv.slice(2);
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
const networks = JSON.parse(rawNetworks);
const attachments = Object.fromEntries(Object.entries(networks ?? {}).map(([name, settings]) => [name, settings?.NetworkID ?? null]));
const bindings = rawBindings === "null" ? null : JSON.parse(rawBindings);
const noPorts = bindings === null ||
  (typeof bindings === "object" && !Array.isArray(bindings) && Object.keys(bindings).length === 0);
proof.serviceImageIds[service] = image;
proof.hostPortBindingsByService[service] = bindings;
proof.publishAllPortsByService[service] = publishAll === "true";
proof.serviceNetworkEvidence[service] = { networkMode: mode, attachments };
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
const names = Object.keys(attachments);
const isolated = mode === ownedName && names.length === 1 && names[0] === ownedName && attachments[ownedName] === ownedId;
if (!isolated) {
  process.stderr.write(`shipping image smoke: ${service} is not attached only to the owned isolated network\n`);
  process.exit(1);
}
if (publishAll !== "false" || !noPorts) {
  process.stderr.write(`shipping image smoke: ${service} has host port exposure\n`);
  process.exit(1);
}
NODE
done
migrate_id="${service_ids[0]}"
taskdesk_id="${service_ids[1]}"
migrate_exit="$(docker inspect --format '{{.State.ExitCode}}' "$migrate_id")"
[[ "$migrate_exit" == 0 ]] || fail "migration service did not exit successfully"
migrate_image_id="${service_image_ids[0]}"
taskdesk_image_id="${service_image_ids[1]}"
[[ "$migrate_image_id" == "$image_id" && "$taskdesk_image_id" == "$image_id" ]] || fail "running services do not use the locally built candidate image"

applied_migrations="$(compose exec -T postgres sh -ec 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "select count(*) from \"drizzle\".\"__drizzle_migrations\""')"
[[ "$applied_migrations" == "$journal_entries" ]] || fail "qualified migration-ledger count differs from the candidate source journal"
runtime_uid="$(compose exec -T taskdesk id -u | tr -d '\r\n')"
[[ "$runtime_uid" =~ ^[1-9][0-9]*$ ]] || fail "running application container is not using a non-root UID"
health_status="$(docker inspect --format '{{.State.Health.Status}}' "$taskdesk_id")"
[[ "$health_status" == healthy ]] || fail "application image healthcheck is not healthy"

http_status() {
  compose exec -T taskdesk node -e '
const path = process.argv[1];
fetch(`http://127.0.0.1:5173${path}`, { redirect: "manual", signal: AbortSignal.timeout(5000) })
  .then((response) => { process.stdout.write(String(response.status)); process.exit(response.status === 200 ? 0 : 1); })
  .catch(() => process.exit(1));
' "$1"
}
probe() {
  local endpoint="$1" status=pending attempt
  for attempt in $(seq 1 30); do
    if status="$(http_status "/api/public/health/$endpoint" 2>/dev/null)"; then
      :
    else
      status="${status:-error}"
    fi
    if [[ "$status" == 200 ]]; then printf '200'; return 0; fi
    if [[ "$status" =~ ^[1-5][0-9][0-9]$ ]]; then printf '%s' "$status"; return 1; fi
    sleep 2
  done
  printf '%s' "$status"
  return 1
}
live_status="$(probe live)" || fail "live endpoint did not return exactly HTTP 200"
ready_status="$(probe ready)" || fail "ready endpoint did not return exactly HTTP 200"

node - "$proof_file" "$runtime_uid" "$applied_migrations" "$live_status" "$ready_status" "$health_status" \
  "${service_image_ids[0]}" "${service_image_ids[1]}" \
  "${service_image_ids[2]}" "${service_image_ids[3]}" <<'NODE'
const fs = require("node:fs");
const args = process.argv.slice(2);
const [file, uid, applied, live, ready, health, ...serviceValues] = args;
const proof = JSON.parse(fs.readFileSync(file, "utf8"));
const services = ["migrate", "taskdesk", "postgres", "valkey"];
for (let index = 0; index < services.length; index += 1) {
  if (proof.serviceImageIds[services[index]] !== serviceValues[index]) {
    throw new Error(`recorded image ID changed for ${services[index]}`);
  }
}
Object.assign(proof, {
  runtimeUid: Number(uid), migrateImageId: proof.serviceImageIds.migrate, taskdeskImageId: proof.serviceImageIds.taskdesk,
  appliedMigrations: Number(applied), liveStatus: Number(live), readyStatus: Number(ready), healthcheck: health,
});
fs.writeFileSync(file, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
NODE
printf 'shipping image smoke runtime checks complete; cleanup and proof validation pending\n'
