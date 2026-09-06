#!/usr/bin/env bash
#
# TaskDesk deployment script.
#
#   scripts/deploy.sh local                  bring the stack up for development
#   scripts/deploy.sh production             bring the stack up behind Traefik
#   scripts/deploy.sh upgrade                verify signature -> pull -> up -d --wait
#   scripts/deploy.sh rollback <digest>      go back to a known-good digest
#
# Flags:
#   --profile s3        also run the opt-in SeaweedFS object store
#   --no-verify         skip the cosign signature check (loud, deliberate)
#   --no-probe          skip the post-deploy API probe (CI only; never routine)
#
# It is idempotent. It generates any missing secret and never regenerates one
# that already has a value.
#
# Specification: docs/05-operations/deployment.md § First run
#   1. generate any missing secrets
#   2. generate a self-signed certificate (local only)
#   3. start Postgres and Valkey (and SeaweedFS + bucket create with --profile
#      s3) and wait for health
#   4. start the application, which applies migrations under an advisory lock
#   5. print the one-time setup URL
#   6. seed demo data, if permitted
#   7. probe the API — and fail loudly if it cannot
#   8. print the URLs
#
# Step 7 is not optional. v1's script did this and it caught the "container
# started, nothing actually works" class of failure that `docker ps` misses.

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env"
ENV_EXAMPLE="$REPO_ROOT/deploy/.env.example"
CERT_DIR="$REPO_ROOT/deploy/local/certs"
TLS_DYNAMIC="$REPO_ROOT/deploy/traefik/dynamic/tls-local.yml"
S3_CONFIG="$REPO_ROOT/deploy/seaweedfs/s3.json"

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
ROLLBACK_DIGEST=""

usage() { sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }

[ $# -ge 1 ] || usage
MODE="$1"; shift
case "$MODE" in
  local|production|upgrade) ;;
  rollback)
    [ $# -ge 1 ] || die "rollback needs a digest: scripts/deploy.sh rollback sha256:…"
    ROLLBACK_DIGEST="$1"; shift
    case "$ROLLBACK_DIGEST" in
      sha256:*) ;;
      *) die "digest must look like sha256:…  (got '$ROLLBACK_DIGEST')" ;;
    esac
    ;;
  -h|--help|help) usage 0 ;;
  *) die "unknown mode '$MODE'. One of: local, production, upgrade, rollback" ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) [ "${2:-}" = "s3" ] || die "--profile takes 's3'"; PROFILE_S3=1; shift 2 ;;
    --profile=s3) PROFILE_S3=1; shift ;;
    --no-verify) VERIFY=0; shift ;;
    --no-probe) PROBE=0; shift ;;
    *) die "unknown flag '$1'" ;;
  esac
done

# ---------------------------------------------------------------------------
# Compose file selection. The base file publishes no application port; the
# local overlay is the only one that does, and production never loads it.
# ---------------------------------------------------------------------------
COMPOSE_FILES=(-f compose.yml)
case "$MODE" in
  local)
    COMPOSE_FILES+=(-f deploy/compose.local.yml -f deploy/compose.traefik.yml) ;;
  production|upgrade|rollback)
    COMPOSE_FILES+=(-f deploy/compose.prod.yml) ;;
esac
[ "$PROFILE_S3" -eq 1 ] && COMPOSE_FILES+=(--profile s3)

dc() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

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

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

# Compose has no boolean. Any non-empty TASKDESK_HSTS_PRELOAD — `0` included —
# selects the preload middleware, which commits the whole apex domain. Fail
# rather than let `0` quietly mean "on".
case "${TASKDESK_HSTS_PRELOAD:-}" in
  ""|1) ;;
  *) die "TASKDESK_HSTS_PRELOAD must be empty (off) or 1 (on); got '${TASKDESK_HSTS_PRELOAD}'.
     It is not a boolean to Compose: any non-empty value would turn preload on." ;;
esac

# ---------------------------------------------------------------------------
# 2 · Self-signed certificate — local only
# ---------------------------------------------------------------------------
if [ "$MODE" = "local" ]; then
  DOMAIN="${DOMAIN:-localhost}"
  if [ ! -f "$CERT_DIR/local.crt" ] || [ ! -f "$CERT_DIR/local.key" ]; then
    say "generating a self-signed certificate for *.${DOMAIN}"
    mkdir -p "$CERT_DIR"
    openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
      -subj "/CN=*.${DOMAIN}" \
      -addext "subjectAltName=DNS:*.${DOMAIN},DNS:${DOMAIN}" \
      -keyout "$CERT_DIR/local.key" -out "$CERT_DIR/local.crt" >/dev/null 2>&1
    chmod 0600 "$CERT_DIR/local.key"
  fi
  cat > "$TLS_DYNAMIC" <<'EOF'
# Generated by scripts/deploy.sh local. Not version-controlled.
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/certs/local.crt
        keyFile: /etc/traefik/certs/local.key
  certificates:
    - certFile: /etc/traefik/certs/local.crt
      keyFile: /etc/traefik/certs/local.key
EOF
  ok "certificate in deploy/local/certs — trust local.crt to stop browser warnings"
fi

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
# Image signature — verified before anything is pulled
# ---------------------------------------------------------------------------
image_ref() {
  local tag="${TASKDESK_IMAGE_TAG:-v2.0.0}"
  local digest="${1:-${TASKDESK_IMAGE_DIGEST:-}}"
  if [ -n "$digest" ]; then
    printf 'ghcr.io/thomasheinthura/taskdesk:%s@%s' "$tag" "$digest"
  else
    printf 'ghcr.io/thomasheinthura/taskdesk:%s' "$tag"
  fi
}

verify_signature() {
  local ref="$1"
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
    "$ref" >/dev/null \
    || die "signature verification FAILED for $ref — not pulling. Nothing has changed."
  ok "signature verified"
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
  local port="${TASKDESK_PORT:-5173}"
  if dc port taskdesk "$port" >/dev/null 2>&1; then
    die "port $port is PUBLISHED on the taskdesk service, and it must not be in production.
     TASKDESK_TRUST_PROXY is only sound because the application port is reachable
     from the proxy network alone: published, a client can bypass Traefik and
     forge X-Forwarded-For directly. Compose concatenates \`ports:\` across files,
     so this means a local overlay was loaded. Bring the stack down and re-run
     without deploy/compose.local.yml.
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
    if dc exec -T taskdesk wget -q -O- "http://127.0.0.1:${port}/api/public/health/ready" >/dev/null 2>&1; then
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

seed_if_permitted() {
  [ "$MODE" = "local" ] || return 0
  if grep -q '"seed"' "$REPO_ROOT/package.json" 2>/dev/null; then
    say "seeding demo data"
    pnpm seed minimal || warn "seeding failed — the stack is up regardless"
  else
    warn "no \`pnpm seed\` script yet — skipping demo data"
  fi
}

print_urls() {
  local domain="${DOMAIN:-localhost}"
  echo
  ok "TaskDesk is up"
  printf '    agent   %s\n' "${TASKDESK_AGENT_URL:-https://ticket.${domain}}"
  printf '    portal  %s\n' "${TASKDESK_PORTAL_URL:-https://portal.${domain}}"
  if [ "$MODE" = "local" ]; then
    printf '    mail    https://mail.%s\n' "$domain"
    [ "$PROFILE_S3" -eq 1 ] && printf '    files   https://files.%s\n' "$domain"
    echo
    printf '    *.localhost resolves to 127.0.0.1 in most browsers. Where it does not, add:\n'
    printf '      127.0.0.1  ticket.%s portal.%s mail.%s\n' "$domain" "$domain" "$domain"
    [ "$PROFILE_S3" -eq 1 ] && printf '      127.0.0.1  files.%s\n' "$domain"
  fi
  echo
  printf '    Everything else — storage, mail, identity providers, branding — is\n'
  printf '    configured in God Mode, not in a file.\n'
}

# ---------------------------------------------------------------------------
# Modes
# ---------------------------------------------------------------------------
case "$MODE" in

  local)
    wait_for_deps
    create_bucket
    say "starting the application (migrations run at boot, under an advisory lock)"
    dc up -d --wait
    probe_api
    print_setup_token
    seed_if_permitted
    print_urls
    ;;

  production)
    [ -n "${DOMAIN:-}" ] || die "DOMAIN is not set in .env — every Traefik router rule needs it"
    verify_signature "$(image_ref)"
    say "pulling"
    dc pull
    wait_for_deps
    create_bucket
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
    [ -n "$CURRENT" ] && printf '    current: %s\n' "$CURRENT"
    verify_signature "$(image_ref)"
    say "pulling"
    dc pull taskdesk
    # Plain Compose does not do health-gated replacement: on a single-replica
    # stack `up -d` stops the old container, then starts the new one. Expect a
    # short outage. --wait makes a failed start loud rather than silent.
    warn "expect a short outage: single-replica Compose replaces the container in place"
    dc up -d --wait taskdesk
    assert_port_unpublished
    probe_api
    ok "upgraded. Roll back with: scripts/deploy.sh rollback ${CURRENT:-<digest>}"
    ;;

  rollback)
    say "rolling back to $ROLLBACK_DIGEST"
    verify_signature "$(image_ref "$ROLLBACK_DIGEST")"
    if grep -q '^TASKDESK_IMAGE_DIGEST=' "$ENV_FILE"; then
      sed -i.bak "s|^TASKDESK_IMAGE_DIGEST=.*|TASKDESK_IMAGE_DIGEST=${ROLLBACK_DIGEST}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      printf 'TASKDESK_IMAGE_DIGEST=%s\n' "$ROLLBACK_DIGEST" >> "$ENV_FILE"
    fi
    set -a; . "$ENV_FILE"; set +a
    dc pull taskdesk
    dc up -d --wait taskdesk
    assert_port_unpublished
    probe_api
    ok "rolled back to $ROLLBACK_DIGEST"
    warn "a rollback does NOT undo a migration. If the upgrade you are undoing"
    warn "applied a destructive change, restore from backup instead —"
    warn "docs/04-engineering/migrations.md, docs/05-operations/backup-and-restore.md"
    ;;
esac
