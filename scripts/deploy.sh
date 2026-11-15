#!/usr/bin/env bash
#
# TaskDesk deployment script.
#
#   scripts/deploy.sh local                     bring the stack up for development
#   scripts/deploy.sh sit                       bring the stack up for SIT rehearsal
#   scripts/deploy.sh uat                       bring the stack up for UAT
#   scripts/deploy.sh production                bring the stack up behind Traefik
#   scripts/deploy.sh upgrade [tag-or-digest]   verify signature -> pull -> up -d --wait
#   scripts/deploy.sh rollback <digest> <tag>   go back to a known-good release
#
# Flags:
#   --target production|sit|uat  select release overlay (upgrade/rollback; default production)
#   --overlay <path>    use an explicit Compose overlay path (deploy/upgrade/rollback)
#   --profile s3        also run the opt-in SeaweedFS object store
#   --no-verify         skip the cosign signature check (loud, deliberate)
#   --no-probe          skip the post-deploy API probe (CI only; never routine)
#   --seed              run the clean-install demo seed (sit, uat only). Requires verified setup;
#                       seed credentials stay private and existing accounts stay unchanged.
#
# It is idempotent. It generates any missing secret and never regenerates one
# that already has a value.
#
# Specification: docs/05-operations/deployment.md § First run
#   1. generate any missing secrets
#   2. start Postgres and Valkey (and SeaweedFS + bucket create with --profile
#      s3) and wait for health
#   3. start the application, which applies migrations under an advisory lock
#   4. print the one-time setup URL
#   5. seed demo data, if permitted
#   6. probe the API — and fail loudly if it cannot
#   7. print the URLs
#
# Step 6 is not optional. v1's script did this and it caught the "container
# started, nothing actually works" class of failure that `docker ps` misses.

set -Eeuo pipefail

CALLER_PWD="$(pwd)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Local SIT has its own fail-closed release path; do not load or generate root secrets.
if [ "${1:-}" = local-fresh ]; then
  shift
  exec node "$REPO_ROOT/deploy/local-fresh.mjs" "$@"
fi

if [ "${1:-}" = local ]; then
  shift
  exec node "$REPO_ROOT/deploy/local-release.mjs" "$@"
fi

ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/deploy/.env.example"
S3_CONFIG="$REPO_ROOT/deploy/seaweedfs/s3.json"

CALLER_IMAGE_TAG_SET="${TASKDESK_IMAGE_TAG+1}"
CALLER_IMAGE_TAG="${TASKDESK_IMAGE_TAG:-}"
CALLER_IMAGE_DIGEST_SET="${TASKDESK_IMAGE_DIGEST+1}"
CALLER_IMAGE_DIGEST="${TASKDESK_IMAGE_DIGEST:-}"

# The signature is verified against the EXACT workflow identity — repository,
# workflow file and ref — not just the OIDC issuer (docs/04-engineering/ci-cd.md).
# The workflow file is owned by #10; if it is renamed, this must be renamed with
# it, and a mismatch fails closed rather than silently accepting any signature.
COSIGN_ISSUER="https://token.actions.githubusercontent.com"
COSIGN_IDENTITY="https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main"

BLUE=$'\033[34m'; RED=$'\033[31m'; YELLOW=$'\033[33m'; GREEN=$'\033[32m'; OFF=$'\033[0m'
[ -t 1 ] || { BLUE=""; RED=""; YELLOW=""; GREEN=""; OFF=""; }

say()  { printf '%s==>%s %s\n' "$BLUE"   "$OFF" "$*"; }
warn() { printf '%s!! %s %s\n' "$YELLOW" "$OFF" "$*" >&2; }
ok()   { printf '%s ok%s %s\n' "$GREEN"  "$OFF" "$*"; }
die()  { printf '%sxx%s %s\n'  "$RED"    "$OFF" "$*" >&2; exit 1; }

MODE=""
PROFILE_S3=0
VERIFY=1
PROBE=1
SEED=0
UPGRADE_REF=""
ROLLBACK_DIGEST=""
ROLLBACK_TAG=""
TARGET="production"
TARGET_SET=0
OVERLAY=""
OVERLAY_SET=0

usage() { sed -n '3,21p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }

[ $# -ge 1 ] || usage
MODE="$1"; shift
case "$MODE" in
  production|sit|uat) ;;
  upgrade)
    if [ $# -ge 1 ] && [[ "${1:-}" != -* ]]; then
      UPGRADE_REF="$1"; shift
      case "$UPGRADE_REF" in
        sha256:*)
          [[ "$UPGRADE_REF" =~ ^sha256:[0-9a-f]{64}$ ]] \
            || die "upgrade digest must be a full lowercase sha256 digest (got '$UPGRADE_REF')"
          ;;
        *@sha256:*)
          UPGRADE_TAG_PART="${UPGRADE_REF%@*}"
          UPGRADE_DIGEST_PART="${UPGRADE_REF#*@}"
          [[ "$UPGRADE_TAG_PART" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] \
            || die "upgrade tag must be a valid container tag (got '$UPGRADE_TAG_PART')"
          [[ "$UPGRADE_DIGEST_PART" =~ ^sha256:[0-9a-f]{64}$ ]] \
            || die "upgrade digest must be a full lowercase sha256 digest (got '$UPGRADE_DIGEST_PART')"
          ;;
        *)
          [[ "$UPGRADE_REF" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] \
            || die "upgrade target must be a valid container tag or sha256 digest (got '$UPGRADE_REF')"
          ;;
      esac
    fi
    ;;
  rollback)
    [ $# -ge 2 ] || die "rollback needs a digest and its signed release tag: scripts/deploy.sh rollback sha256:… v2.0.0"
    ROLLBACK_DIGEST="$1"; shift
    ROLLBACK_TAG="$1"; shift
    case "$ROLLBACK_DIGEST" in
      sha256:*) ;;
      *) die "digest must look like sha256:…  (got '$ROLLBACK_DIGEST')" ;;
    esac
    [[ "$ROLLBACK_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] \
      || die "release tag must be a valid container tag (got '$ROLLBACK_TAG')"
    ;;
  -h|--help|help) usage 0 ;;
  *) die "unknown mode '$MODE'. One of: local, sit, uat, production, upgrade, rollback" ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --target) [ $# -ge 2 ] || die "--target needs production, sit, or uat"; TARGET="$2"; TARGET_SET=1; shift 2 ;;
    --target=*) TARGET="${1#*=}"; TARGET_SET=1; shift ;;
    --overlay) [ $# -ge 2 ] && [ -n "$2" ] || die "--overlay needs a Compose overlay path"; OVERLAY="$2"; OVERLAY_SET=1; shift 2 ;;
    --overlay=*) OVERLAY="${1#*=}"; [ -n "$OVERLAY" ] || die "--overlay needs a Compose overlay path"; OVERLAY_SET=1; shift ;;
    --profile) [ "${2:-}" = "s3" ] || die "--profile takes 's3'"; PROFILE_S3=1; shift 2 ;;
    --profile=s3) PROFILE_S3=1; shift ;;
    --no-verify) VERIFY=0; shift ;;
    --no-probe) PROBE=0; shift ;;
    --seed) SEED=1; shift ;;
    *) die "unknown flag '$1'" ;;
  esac
done

if [ "$SEED" -eq 1 ] && [[ "$MODE" != "sit" && "$MODE" != "uat" ]]; then
  die "--seed is only valid for clean-install sit or uat deployments"
fi

if [ "$TARGET_SET" -eq 1 ]; then
  [[ "$MODE" = upgrade || "$MODE" = rollback ]] || die "--target is only valid for upgrade and rollback"
fi
if [ "$OVERLAY_SET" -eq 1 ] && [ "$TARGET_SET" -eq 1 ]; then
  die "pass either --overlay or --target, not both"
fi
[[ "$TARGET" = production || "$TARGET" = sit || "$TARGET" = uat ]] || die "--target must be production, sit, or uat"

SELECTED_OVERLAY=""
if [ "$OVERLAY_SET" -eq 1 ]; then
  if [ -f "$OVERLAY" ]; then
    SELECTED_OVERLAY="$OVERLAY"
  elif [ -f "$CALLER_PWD/$OVERLAY" ]; then
    SELECTED_OVERLAY="$CALLER_PWD/$OVERLAY"
  else
    die "Compose overlay '$OVERLAY' does not exist"
  fi
  if [[ ( "$SELECTED_OVERLAY" = *compose.sit.yml || "$SELECTED_OVERLAY" = *compose.uat.yml ) && ( "$MODE" = upgrade || "$MODE" = rollback ) ]]; then
    [ "$VERIFY" -eq 1 ] || die "--no-verify is not allowed for signed SIT/UAT releases"
    [ "$PROBE" -eq 1 ] || die "--no-probe is not allowed for signed SIT/UAT releases"
  fi
else
  EFFECTIVE_ENV="$MODE"
  if [[ "$MODE" = upgrade || "$MODE" = rollback ]]; then
    EFFECTIVE_ENV="$TARGET"
  fi
  case "$EFFECTIVE_ENV" in
    sit)
      if [[ "$MODE" = upgrade || "$MODE" = rollback ]]; then
        [ "$VERIFY" -eq 1 ] || die "--no-verify is not allowed for signed SIT releases"
        [ "$PROBE" -eq 1 ] || die "--no-probe is not allowed for signed SIT releases"
      fi
      [ -f "$REPO_ROOT/deploy/compose.sit.yml" ] || die "SIT overlay deploy/compose.sit.yml is required for signed SIT releases"
      SELECTED_OVERLAY="deploy/compose.sit.yml"
      ;;
    uat)
      if [[ "$MODE" = upgrade || "$MODE" = rollback ]]; then
        [ "$VERIFY" -eq 1 ] || die "--no-verify is not allowed for signed UAT releases"
        [ "$PROBE" -eq 1 ] || die "--no-probe is not allowed for signed UAT releases"
      fi
      [ -f "$REPO_ROOT/deploy/compose.uat.yml" ] || die "UAT overlay deploy/compose.uat.yml is required for signed UAT releases"
      SELECTED_OVERLAY="deploy/compose.uat.yml"
      ;;
    production)
      [ -f "$REPO_ROOT/deploy/compose.prod.yml" ] || die "Production overlay deploy/compose.prod.yml is required"
      SELECTED_OVERLAY="deploy/compose.prod.yml"
      ;;
  esac
fi

# ---------------------------------------------------------------------------
# Compose file selection. No file publishes the application port: the base and
# production overlay never did, and the local overlay stopped in #752.
# ---------------------------------------------------------------------------
COMPOSE_FILES=(-f compose.yml -f "$SELECTED_OVERLAY")
[ "$PROFILE_S3" -eq 1 ] && COMPOSE_FILES+=(--profile s3)

dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

# Engine-level port check and byte-derived digest resolver (see the file header
# for why neither parses `compose port` or buildx human text).
# shellcheck source=scripts/lib/deploy-checks.sh
. "$REPO_ROOT/scripts/lib/deploy-checks.sh"

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "the docker compose plugin is not installed"
docker info >/dev/null 2>&1 || die "cannot talk to the Docker daemon — is it running, and are you in the docker group?"

# ---------------------------------------------------------------------------
# 1 · Secrets — generated once, never regenerated
# ---------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  say "creating .env from deploy/.env.example"
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
fi

# Replace `NAME=` with `NAME=<generated>` only when the value is empty. An
# existing value is never touched: regenerating TASKDESK_AUTH_SECRET signs
# everyone out, and regenerating TASKDESK_ENCRYPTION_KEY makes every stored
# plugin secret unreadable.
generate_if_empty() {
  local name="$1" value
  value="$(sed -n "s/^${name}=//p" "$ENV_FILE" | head -1)"
  if [ -z "$value" ]; then
    local generated
    generated="$(openssl rand -hex 32)"
    if grep -q "^${name}=" "$ENV_FILE"; then
      # `|` as the delimiter: hex never contains one.
      sed -i.bak "s|^${name}=.*|${name}=${generated}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      printf '%s=%s\n' "$name" "$generated" >> "$ENV_FILE"
    fi
    say "generated $name"
  fi
}
command -v openssl >/dev/null 2>&1 || die "openssl is needed to generate secrets"
generate_if_empty TASKDESK_ENCRYPTION_KEY
generate_if_empty TASKDESK_AUTH_SECRET
generate_if_empty POSTGRES_PASSWORD
# The application role's password (issue #296) — a separate secret from
# POSTGRES_PASSWORD, which now belongs only to the migration/owner connection.
# The application itself creates the role and sets this password at boot
# (apps/api/src/database/ensure-application-role.ts); this script only has to
# make sure a value exists for compose to put in TASKDESK_DATABASE_URL.
generate_if_empty TASKDESK_APP_DB_PASSWORD

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a
[ -z "$CALLER_IMAGE_TAG_SET" ] || { TASKDESK_IMAGE_TAG="$CALLER_IMAGE_TAG"; export TASKDESK_IMAGE_TAG; }
[ -z "$CALLER_IMAGE_DIGEST_SET" ] || { TASKDESK_IMAGE_DIGEST="$CALLER_IMAGE_DIGEST"; export TASKDESK_IMAGE_DIGEST; }

# Compose has no boolean. Any non-empty TASKDESK_HSTS_PRELOAD — `0` included —
# selects the preload middleware, which commits the whole apex domain. Fail
# rather than let `0` quietly mean "on".
case "${TASKDESK_HSTS_PRELOAD:-}" in
  ""|1) ;;
  *) die "TASKDESK_HSTS_PRELOAD must be empty (off) or 1 (on); got '${TASKDESK_HSTS_PRELOAD}'.
     It is not a boolean to Compose: any non-empty value would turn preload on." ;;
esac

# ---------------------------------------------------------------------------
# SeaweedFS credentials — only for --profile s3, written 0600
# ---------------------------------------------------------------------------
if [ "$PROFILE_S3" -eq 1 ] && [ ! -f "$S3_CONFIG" ]; then
  say "generating deploy/seaweedfs/s3.json"
  mkdir -p "$(dirname "$S3_CONFIG")"
  S3_KEY="taskdesk"
  S3_SECRET="$(openssl rand -hex 24)"
  cat > "$S3_CONFIG" <<EOF
{
  "identities": [
    {
      "name": "taskdesk",
      "credentials": [{ "accessKey": "${S3_KEY}", "secretKey": "${S3_SECRET}" }],
      "actions": ["Read", "Write", "List", "Tagging", "Admin"]
    }
  ]
}
EOF
  chmod 0600 "$S3_CONFIG"
  warn "the S3 access key and secret are in deploy/seaweedfs/s3.json (0600)."
  warn "enter them in God Mode -> Storage; nothing reads them from a file."
fi

# ---------------------------------------------------------------------------
# Image signature — resolve a mutable tag once, then verify and pull only the
# immutable digest. Compose receives the digest through the exported variable.
# ---------------------------------------------------------------------------
IMAGE_REPOSITORY="ghcr.io/thomasheinthura/taskdesk"

image_ref() {
  local tag="${TASKDESK_IMAGE_TAG:-v2.0.0}"
  local digest="${1:-${TASKDESK_IMAGE_DIGEST:-}}"
  if [ -n "$digest" ]; then
    printf '%s@%s' "$IMAGE_REPOSITORY" "$digest"
  else
    printf '%s:%s' "$IMAGE_REPOSITORY" "$tag"
  fi
}

verify_signature() {
  local ref="$1"
  local tag="${TASKDESK_IMAGE_TAG:-v2.0.0}"
  if [ "$VERIFY" -eq 0 ]; then
    warn "SIGNATURE VERIFICATION SKIPPED (--no-verify). You are pulling an image"
    warn "whose provenance has not been checked. This is the fallback for a host"
    warn "that cannot reach the transparency log, and nothing else."
    return 0
  fi
  command -v cosign >/dev/null 2>&1 || die "cosign is not installed, and the signature check is the point.
     Install it (https://docs.sigstore.dev/cosign/installation/) or, on a host that
     cannot reach the transparency log, re-run with --no-verify and understand that
     you are accepting an unverified image."
  say "verifying the cosign signature on $ref"
  cosign verify \
    --certificate-oidc-issuer "$COSIGN_ISSUER" \
    --certificate-identity "$COSIGN_IDENTITY" \
    --annotations "tag=${tag}" \
    "$ref" >/dev/null \
    || die "signature verification FAILED for $ref — not pulling. Nothing has changed."
  ok "signature verified"
}

resolve_and_verify_image() {
  local digest="${TASKDESK_IMAGE_DIGEST:-}"
  if [ -z "$digest" ]; then
    local tag_ref
    tag_ref="$(image_ref)"
    say "resolving $tag_ref to an immutable digest"
    command -v docker >/dev/null 2>&1 || die "docker is not installed"
    docker buildx version >/dev/null 2>&1 \
      || die "docker buildx is required to resolve $tag_ref to a digest.
     Ubuntu: apt-get install docker-buildx. Docker's own repository: docker-buildx-plugin."
    digest="$(resolve_image_digest "$tag_ref")" \
      || die "could not resolve $tag_ref to an immutable digest"
  fi
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || die "TASKDESK_IMAGE_DIGEST must be a full lowercase sha256 digest"
  TASKDESK_IMAGE_DIGEST="$digest"
  export TASKDESK_IMAGE_DIGEST
  verify_signature "${IMAGE_REPOSITORY}@${digest}"
}

# ---------------------------------------------------------------------------
# 3-4 · Dependencies, then the application
# ---------------------------------------------------------------------------
wait_for_deps() {
  say "starting Postgres and Valkey"
  local deps=(postgres valkey)
  [ "$PROFILE_S3" -eq 1 ] && deps+=(seaweedfs)
  dc up -d --wait "${deps[@]}"
  ok "dependencies healthy"
}

create_bucket() {
  [ "$PROFILE_S3" -eq 1 ] || return 0
  # A bucket that does not exist yet is the first presign's failure, not the
  # first upload's — so it is created here, after the health check passes.
  say "creating the attachments bucket in SeaweedFS"
  dc exec -T seaweedfs sh -c 'echo "s3.bucket.create -name taskdesk" | weed shell' >/dev/null 2>&1 \
    || warn "bucket create did not report success — check it in God Mode -> Storage before uploading"
}

# ---------------------------------------------------------------------------
# The production invariant, asserted rather than assumed
# ---------------------------------------------------------------------------
assert_port_unpublished() {
  # Judged from the Docker engine's own record of every taskdesk container
  # (including stopped ones and every replica), not from `compose port`: Compose
  # v5.6.0 and 2.40.3 print `:0` with exit 0 for a port that is exposed but not
  # published, so its exit code cannot tell "published" from "not published".
  # Fails closed on: no container, an inspect error, host networking,
  # PublishAllPorts, any configured port binding, any live port mapping.
  local ids reason
  ids="$(dc ps -a -q taskdesk)" \
    || die "cannot list the taskdesk containers to check that no port is published"
  # Unquoted on purpose: one id per line, one iteration per replica.
  # shellcheck disable=SC2086
  if ! reason="$(assert_containers_unpublished $ids 2>&1)"; then
    die "the taskdesk service is not proven unpublished (${reason}), and it must be in production.
     TASKDESK_TRUST_PROXY is only sound because the application port is reachable
     from the proxy network alone: published, a client can bypass Traefik and
     forge X-Forwarded-For directly. Compose concatenates \`ports:\` across files,
     so this usually means an overlay with a \`ports:\` entry for the taskdesk
     service was loaded (no shipped overlay has one), or the container uses host
     networking. Remove it from your own overlay, or bring the stack down and
     re-run without it.
     docs/05-operations/traefik-and-domains.md"
  fi
  ok "no application port is published"
}

probe_api() {
  [ "$PROBE" -eq 1 ] || { warn "post-deploy probe skipped (--no-probe)"; return 0; }
  local port="${TASKDESK_PORT:-5173}"
  say "probing the API"
  local i
  for i in $(seq 1 30); do
    # The image ships no wget or curl; Node is the one HTTP client it has.
    if dc exec -T taskdesk node -e "fetch('http://127.0.0.1:${port}/api/public/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
      ok "the API answers /api/public/health/ready"
      return 0
    fi
    sleep 2
  done
  dc logs --tail 60 taskdesk || true
  die "the API never became ready. The container may be running and the application not working —
     that is exactly the failure this probe exists to catch. Logs are above."
}

print_setup_token() {
  say "first run"
  # The setup token is printed once per start while setup_completed_at is null;
  # every restart issues a fresh one and invalidates the previous.
  local line
  line="$(dc logs taskdesk 2>/dev/null | grep -iE 'setup (token|url)' | tail -1 || true)"
  if [ -n "$line" ]; then
    printf '    %s\n' "$line"
  elif [ -n "${TASKDESK_BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
    printf '    headless install: the first administrator is %s\n' "$TASKDESK_BOOTSTRAP_ADMIN_EMAIL"
  else
    warn "no setup token in the container log."
    warn "the first-run setup page is not implemented yet (issue #11 scope note);"
    warn "until it is, follow docs/05-operations/runbook.md § First run."
  fi
}

seed_if_permitted() (
  [ "$MODE" = "local" ] || [ "$MODE" = "sit" ] || [ "$MODE" = "uat" ] || return 0
  if [ "$SEED" -ne 1 ]; then
    say "not seeding demo data (pass --seed after first-administrator setup)"
    return 0
  fi
  local in_container="/tmp/demo-credentials-$$.json"
  local credentials="$HOME/.taskdesk/demo-credentials.json"
  mkdir -p "$(dirname "$credentials")"
  chmod 700 "$(dirname "$credentials")"
  local had_credentials=0
  [ ! -f "$credentials" ] || { had_credentials=1; chmod 600 "$credentials"; }
  # Preserve existing credentials; recover a newly generated file only after verification.
  recover_demo_credentials() {
    local rc=$? copy_rc=0
    trap - EXIT
    if [ "$had_credentials" -eq 0 ] && dc exec -T taskdesk test -f "$in_container"; then
      local pending="" source_hash="" copied_hash=""
      pending=$(mktemp "$credentials.pending.XXXXXX") || copy_rc=1
      source_hash=$(dc exec -T taskdesk sha256sum "$in_container") || copy_rc=1
      if [ "$copy_rc" -eq 0 ]; then
        (umask 077; dc exec -T taskdesk cat "$in_container" > "$pending") &&
          chmod 600 "$pending" || copy_rc=1
        if command -v sha256sum >/dev/null 2>&1; then
          copied_hash=$(sha256sum "$pending") || copy_rc=1
        else
          copied_hash=$(shasum -a 256 "$pending") || copy_rc=1
        fi
        if [ "$copy_rc" -eq 0 ] && [ "${source_hash%% *}" = "${copied_hash%% *}" ]; then
          mv -f "$pending" "$credentials" || copy_rc=1
        else
          copy_rc=1
        fi
      fi
      [ -z "$pending" ] || rm -f "$pending"
    fi
    dc exec -T taskdesk rm -f "$in_container" || copy_rc=1
    if [ "$copy_rc" -ne 0 ]; then
      warn "could not verify and recover demo credentials"
      exit 1
    fi
    exit "$rc"
  }
  trap recover_demo_credentials EXIT
  if [ -f "$credentials" ]; then
    dc exec -T taskdesk sh -c 'umask 077; cat > "$1"' sh "$in_container" < "$credentials" \
      || die "could not restore private seed credentials"
  fi
  dc exec -T taskdesk node apps/api/dist/seed-uat.js --uat --credentials-file "$in_container" \
    || die "Demo seeding failed. Finish first-administrator setup, fix the error above and rerun with --seed."
  ok "Demo account passwords are in $credentials (0600)"
)

print_urls() {
  local domain="${DOMAIN:-localhost}"
  local agent_host="${TASKDESK_AGENT_HOST:-ticket.${domain}}"
  local portal_host="${TASKDESK_PORTAL_HOST:-portal.${domain}}"
  echo
  ok "TaskDesk is up"
  printf '    agent   %s\n' "${TASKDESK_AGENT_URL:-https://${agent_host}}"
  printf '    portal  %s\n' "${TASKDESK_PORTAL_URL:-https://${portal_host}}"
  echo
  printf '    Everything else — storage, mail, identity providers, branding — is\n'
  printf '    configured in God Mode, not in a file.\n'
}

persist_image_selection() {
  local tag="$1" digest="$2"
  if grep -q '^TASKDESK_IMAGE_TAG=' "$ENV_FILE"; then
    sed -i.bak "s|^TASKDESK_IMAGE_TAG=.*|TASKDESK_IMAGE_TAG=${tag}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf 'TASKDESK_IMAGE_TAG=%s\n' "$tag" >> "$ENV_FILE"
  fi
  if grep -q '^TASKDESK_IMAGE_DIGEST=' "$ENV_FILE"; then
    sed -i.bak "s|^TASKDESK_IMAGE_DIGEST=.*|TASKDESK_IMAGE_DIGEST=${digest}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf 'TASKDESK_IMAGE_DIGEST=%s\n' "$digest" >> "$ENV_FILE"
  fi
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
case "$MODE" in

  sit)
    wait_for_deps
    say "running migrations under the advisory lock"
    dc run --rm migrate
    say "creating the application containers (not started) to check their port configuration"
    dc up --no-start
    assert_port_unpublished
    say "starting the application"
    dc up -d --wait taskdesk
    assert_port_unpublished
    probe_api
    seed_if_permitted
    print_urls
    ;;

  uat)
    [ -n "${DOMAIN:-}" ] || die "DOMAIN is not set in .env — every Traefik router rule needs it"
    resolve_and_verify_image
    say "pulling"
    dc pull
    wait_for_deps
    create_bucket
    say "running migrations under the advisory lock"
    dc run --rm migrate
    say "creating the application containers (not started) to check their port configuration"
    dc up --no-start
    assert_port_unpublished
    say "starting the application"
    dc up -d --wait taskdesk
    assert_port_unpublished
    probe_api
    print_setup_token
    seed_if_permitted
    print_urls
    ;;

  production)
    [ -n "${DOMAIN:-}" ] || die "DOMAIN is not set in .env — every Traefik router rule needs it"
    resolve_and_verify_image
    say "pulling"
    dc pull
    wait_for_deps
    create_bucket
    say "creating the application containers (not started) to check their port configuration"
    dc up --no-start
    assert_port_unpublished
    say "starting the application"
    dc up -d --wait
    assert_port_unpublished
    probe_api
    print_setup_token
    print_urls
    ;;

  upgrade)
    say "before an upgrade: take a database backup and note the current digest."
    CURRENT="$(docker inspect --format '{{index .RepoDigests 0}}' "$(dc images -q taskdesk 2>/dev/null | head -1)" 2>/dev/null || true)"
    CURRENT_CONTAINER="$(dc ps -q taskdesk 2>/dev/null | head -1)"
    CURRENT_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' "$CURRENT_CONTAINER" 2>/dev/null || true)"
    CURRENT_TAG="${CURRENT_IMAGE_REF%@*}"
    CURRENT_TAG="${CURRENT_TAG##*:}"
    if [ -n "$CURRENT" ] && [[ "$CURRENT_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
      printf '    current: %s (signed tag: %s)\n' "$CURRENT" "$CURRENT_TAG"
    elif [ -n "$CURRENT" ]; then
      printf '    current: %s (could not read the configured signed tag)\n' "$CURRENT"
    fi
    if [ -n "$UPGRADE_REF" ]; then
      case "$UPGRADE_REF" in
        sha256:*)
          TASKDESK_IMAGE_DIGEST="$UPGRADE_REF"
          ;;
        *@sha256:*)
          TASKDESK_IMAGE_TAG="${UPGRADE_REF%@*}"
          TASKDESK_IMAGE_DIGEST="${UPGRADE_REF#*@}"
          ;;
        *)
          TASKDESK_IMAGE_TAG="$UPGRADE_REF"
          TASKDESK_IMAGE_DIGEST=""
          ;;
      esac
    elif [ -n "$CALLER_IMAGE_DIGEST_SET" ] && [ -n "$CALLER_IMAGE_DIGEST" ]; then
      TASKDESK_IMAGE_DIGEST="$CALLER_IMAGE_DIGEST"
    else
      # Clear any digest pinned in .env by an earlier rollback so upgrade resolves
      # the target tag fresh instead of redeploying the rolled-back digest.
      TASKDESK_IMAGE_DIGEST=""
    fi
    export TASKDESK_IMAGE_TAG TASKDESK_IMAGE_DIGEST
    resolve_and_verify_image
    persist_image_selection "${TASKDESK_IMAGE_TAG:-v2.0.0}" "$TASKDESK_IMAGE_DIGEST"
    say "pulling"
    dc pull migrate taskdesk
    # issue #296: `migrate` and `taskdesk` share an image tag, but a completed
    # one-shot service is not re-run just because `taskdesk` is targeted — its
    # `service_completed_successfully` condition is already satisfied by the
    # PREVIOUS version's run. Naming `migrate` explicitly here is what makes the
    # new image's migrations (and any grant changes) apply before the new
    # `taskdesk` container starts.
    say "running migrations for the new image"
    # issue #296, D1 (independent Opus 5.5 delta review of PR #308, BLOCKING):
    # `dc up -d --wait migrate` aimed at a one-shot service returned exit 1 even
    # when migrate succeeded (Compose v5.5.1, reproduced 3 times) — `--wait`'s own
    # exit code does not reliably reflect a `service_completed_successfully`
    # dependency's actual result the way a direct `run` does. Under `set -Eeuo
    # pipefail` that silently aborted BOTH `upgrade` and `rollback` right after
    # applying the new schema, leaving the OLD `taskdesk` container (still
    # connected as the owner, on a first upgrade from a pre-split version)
    # serving against it. `dc run --rm migrate` runs the one-shot container in
    # the foreground and exits with ITS real exit code — 0 only if migration and
    # the role/grant bootstrap actually succeeded — and `--rm` removes the
    # container afterward so a later `dc run --rm migrate` is never blocked by a
    # stale one of the same name.
    dc run --rm migrate
    # Plain Compose does not do health-gated replacement: on a single-replica
    # stack `up -d` stops the old container, then starts the new one. Expect a
    # short outage. --wait makes a failed start loud rather than silent.
    warn "expect a short outage: single-replica Compose replaces the container in place"
    dc up --no-start taskdesk
    assert_port_unpublished
    dc up -d --wait taskdesk
    assert_port_unpublished
    probe_api
    ROLLBACK_OVERLAY_FLAG="--target ${TARGET}"
    [ "$OVERLAY_SET" -eq 0 ] || ROLLBACK_OVERLAY_FLAG="--overlay ${OVERLAY}"
    if [ -n "$CURRENT" ] && [[ "$CURRENT_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
      CURRENT_DIGEST="${CURRENT##*@}"
      ok "upgraded. Roll back with: scripts/deploy.sh rollback ${CURRENT_DIGEST} ${CURRENT_TAG} ${ROLLBACK_OVERLAY_FLAG}"
    else
      ok "upgraded. Previous image digest was ${CURRENT:-unavailable}; confirm its signed image tag before rollback."
    fi
    ;;

  rollback)
    say "rolling back to $ROLLBACK_TAG ($ROLLBACK_DIGEST)"
    TASKDESK_IMAGE_TAG="$ROLLBACK_TAG"
    export TASKDESK_IMAGE_TAG
    TASKDESK_IMAGE_DIGEST="$ROLLBACK_DIGEST"
    export TASKDESK_IMAGE_DIGEST
    resolve_and_verify_image
    persist_image_selection "$ROLLBACK_TAG" "$ROLLBACK_DIGEST"
    dc pull migrate taskdesk
    # issue #296: re-running `migrate` against the rollback image is a no-op for
    # already-applied migrations and the idempotent role/grant step — safe, and
    # keeps `taskdesk`'s dependency condition genuinely satisfied for this image
    # rather than reusing a stale success from a different one.
    # D1 (see the `upgrade` case above for the full explanation): `dc run --rm`,
    # not `dc up -d --wait`, so a real migrate failure actually aborts this
    # script instead of silently succeeding.
    dc run --rm migrate
    dc up --no-start taskdesk
    assert_port_unpublished
    dc up -d --wait taskdesk
    assert_port_unpublished
    probe_api
    ok "rolled back to $ROLLBACK_DIGEST"
    warn "a rollback does NOT undo a migration. If the upgrade you are undoing"
    warn "applied a destructive change, restore from backup instead —"
    warn "docs/04-engineering/migrations.md, docs/05-operations/backup-and-restore.md"
    ;;
esac
