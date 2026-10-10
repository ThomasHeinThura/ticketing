#!/usr/bin/env bash
# TaskDesk thin release bootstrap. Full deployment logic remains in scripts/deploy.sh.
set -Eeuo pipefail

readonly REPOSITORY='ThomasHeinThura/ticketing'
readonly RELEASE_BASE="https://github.com/${REPOSITORY}/releases/download"
readonly STABLE_URL='https://get.taskdesk.dev/stable.txt'
readonly COSIGN_ISSUER='https://token.actions.githubusercontent.com'
readonly COSIGN_IDENTITY="https://github.com/${REPOSITORY}/.github/workflows/release.yml@refs/heads/main"

say() { printf '==> %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Usage: install.sh [--env local|production] [--domain DOMAIN]
                  [--agent-host HOST] [--portal-host HOST] [--files-host HOST]
                  [--version TAG] [--dir PATH] [--yes] [--dry-run] [--skip-verify]
USAGE
}

MODE=local DOMAIN='' AGENT_HOST='' PORTAL_HOST='' FILES_HOST=''
DOMAIN_SET=0 AGENT_HOST_SET=0 PORTAL_HOST_SET=0 FILES_HOST_SET=0
VERSION='' INSTALL_DIR="${HOME:-}/taskdesk" YES=0 DRY_RUN=0 SKIP_VERIFY=0 PROFILE_S3=0
while (($#)); do
  case "$1" in
    --env) (($# >= 2)) || die '--env needs local or production'; MODE="$2"; shift 2 ;;
    --domain) (($# >= 2)) || die '--domain needs a DNS domain'; DOMAIN="$2"; DOMAIN_SET=1; shift 2 ;;
    --agent-host) (($# >= 2)) || die '--agent-host needs a hostname'; AGENT_HOST="$2"; AGENT_HOST_SET=1; shift 2 ;;
    --portal-host) (($# >= 2)) || die '--portal-host needs a hostname'; PORTAL_HOST="$2"; PORTAL_HOST_SET=1; shift 2 ;;
    --files-host) (($# >= 2)) || die '--files-host needs a hostname'; FILES_HOST="$2"; FILES_HOST_SET=1; shift 2 ;;
    --profile) (($# >= 2)) || die '--profile needs s3'; [[ "$2" == s3 ]] || die '--profile supports only s3'; PROFILE_S3=1; shift 2 ;;
    --version) (($# >= 2)) || die '--version needs a release tag'; VERSION="$2"; shift 2 ;;
    --dir) (($# >= 2)) || die '--dir needs a path'; INSTALL_DIR="$2"; shift 2 ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-verify) SKIP_VERIFY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$MODE" == local || "$MODE" == production ]] || die '--env must be local or production'
[[ -n "$INSTALL_DIR" && "$INSTALL_DIR" != / ]] || die '--dir must be a non-root path'
valid_dns_name() {
  local name="$1" label
  [[ "$name" =~ ^[A-Za-z0-9.-]+$ && "$name" != .* && "$name" != *. && "$name" != *..* && ${#name} -le 253 ]] || return 1
  local IFS=.; read -r -a _labels <<< "$name"
  for label in "${_labels[@]}"; do [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$ ]] || return 1; done
}
valid_release_tag() { [[ "$1" =~ ^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?$ ]]; }

read_env_value() {
  local key="$1" file="$INSTALL_DIR/.env"
  [[ -f "$file" && ! -L "$file" ]] || return 0
  awk -v key="$key" 'index($0,key"=")==1 { value=substr($0,length(key)+2) } END { if (value != "") print value }' "$file"
}
EXISTING_ENV=0
[[ ! -f "$INSTALL_DIR/.env" ]] || EXISTING_ENV=1
if ((DOMAIN_SET == 0)); then DOMAIN="$(read_env_value DOMAIN)"; fi
if ((AGENT_HOST_SET == 0)); then AGENT_HOST="$(read_env_value TASKDESK_AGENT_HOST)"; fi
if ((DOMAIN_SET)); then ((AGENT_HOST_SET)) || AGENT_HOST=""; fi
if ((PORTAL_HOST_SET == 0)); then PORTAL_HOST="$(read_env_value TASKDESK_PORTAL_HOST)"; fi
if ((DOMAIN_SET)); then ((PORTAL_HOST_SET)) || PORTAL_HOST=""; fi
if ((FILES_HOST_SET == 0)); then FILES_HOST="$(read_env_value TASKDESK_FILES_HOST)"; fi
if [[ -n "$DOMAIN" ]]; then valid_dns_name "$DOMAIN" || die '--domain or existing DOMAIN must be a valid DNS name'; fi
for host in "$AGENT_HOST" "$PORTAL_HOST" "$FILES_HOST"; do [[ -z "$host" ]] || valid_dns_name "$host" || die 'host overrides must be valid DNS names'; done
if [[ "$MODE" == production ]]; then
  [[ -n "$DOMAIN" ]] || die 'production requires --domain or an existing DOMAIN in .env'
  [[ -n "$AGENT_HOST" ]] || AGENT_HOST="ticket.${DOMAIN}"
  [[ -n "$PORTAL_HOST" ]] || PORTAL_HOST="portal.${DOMAIN}"
  [[ "$AGENT_HOST" != "$PORTAL_HOST" ]] || die 'agent and portal hostnames must be distinct'
else
  [[ -n "$AGENT_HOST" ]] || AGENT_HOST="ticket.${DOMAIN:-localhost}"
  [[ -n "$PORTAL_HOST" ]] || PORTAL_HOST="portal.${DOMAIN:-localhost}"
fi
if [[ -z "$FILES_HOST" ]] && ((PROFILE_S3)); then FILES_HOST="files.${DOMAIN:-localhost}"; fi

case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) PLATFORM=linux-amd64 ;;
  Linux:aarch64|Linux:arm64) PLATFORM=linux-arm64 ;;
  Darwin:x86_64|Darwin:arm64) PLATFORM=darwin-local ;;
  *) die "unsupported operating system or architecture: $(uname -s)/$(uname -m)" ;;
esac
if [[ "$MODE" == production && "$PLATFORM" == darwin-local ]]; then die 'production installs require Linux'; fi

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else die 'sha256sum or shasum is required'; fi
}

if ((DRY_RUN)); then
  say "platform: ${PLATFORM}; mode: ${MODE}; install directory: ${INSTALL_DIR}"
  say 'would resolve a stable release tag, fetch the signed release archive, verify its cosign bundles and SHA-256, unpack to a private temporary directory, preserve existing .env/runtime data, and invoke scripts/deploy.sh'
  if ((PROFILE_S3)); then say "would deploy with: scripts/deploy.sh ${MODE} --profile s3"; else say "would deploy with: scripts/deploy.sh ${MODE}"; fi
  if [[ "$MODE" == production ]]; then say "would preflight DNS for: ${AGENT_HOST} ${PORTAL_HOST}${FILES_HOST:+ ${FILES_HOST}} and verify TCP port 5173 is free"; fi
  if [[ -n "$VERSION" ]]; then
    requested="${VERSION#v}"
    valid_release_tag "$requested" || die 'release version must be a SemVer tag'
    requested="v${requested}"
    say "release assets: ${RELEASE_BASE}/${requested}/taskdesk-${requested}.tar.gz and signed .sha256/cosign bundles"
    if ((SKIP_VERIFY == 0)); then
      say "would run cosign verify-blob with issuer ${COSIGN_ISSUER} and identity ${COSIGN_IDENTITY}"
    fi
    say "would check the signed checksum, reject unsafe archive paths, preserve existing runtime data in ${INSTALL_DIR}, then run ./scripts/deploy.sh ${MODE}"
  else
    say "would fetch the stable tag from ${STABLE_URL}, then verify and install its signed GitHub release archive"
  fi
  if ! command -v docker >/dev/null 2>&1; then say 'if Docker is absent, offer a package-manager installation after verified download and before writing files'; fi
  ((SKIP_VERIFY)) && warn '--skip-verify explicitly disables release signature verification'
  exit 0
fi

for tool in curl tar awk mktemp; do command -v "$tool" >/dev/null 2>&1 || die "required command not found: ${tool}"; done
if ((SKIP_VERIFY == 0)); then command -v cosign >/dev/null 2>&1 || die 'cosign is required to verify the signed release; install it or explicitly choose --skip-verify'; fi

resolve_host() {
  if command -v getent >/dev/null 2>&1; then getent ahosts "$1" >/dev/null 2>&1
  elif command -v dscacheutil >/dev/null 2>&1; then dscacheutil -q host -a name "$1" | grep -q '^ip_address:'
  elif command -v host >/dev/null 2>&1; then host "$1" | grep -q 'has address\|has IPv6 address'
  else die 'DNS preflight needs getent, dscacheutil or host'; fi
}
if [[ "$MODE" == production ]]; then
  dns_hosts=("$AGENT_HOST" "$PORTAL_HOST")
  [[ -z "$FILES_HOST" ]] || dns_hosts+=("$FILES_HOST")
  ((PROFILE_S3 == 0)) || [[ -n "$FILES_HOST" ]] || dns_hosts+=("files.${DOMAIN}")
  for host in "${dns_hosts[@]}"; do
    resolve_host "$host" || die "DNS name ${host} does not resolve; create a record pointing to this host, then retry"
  done
  if [[ "$(uname -s)" == Linux ]] && command -v ss >/dev/null 2>&1; then
    ss -H -ltn 'sport = :5173' | grep -q . && die 'TCP port 5173 is already bound; production must not publish the application port'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:5173 -sTCP:LISTEN >/dev/null 2>&1 && die 'TCP port 5173 is already bound; production must not publish the application port'
  else die 'cannot prove TCP port 5173 is free (install ss or lsof)'; fi
fi

if [[ -z "$VERSION" ]]; then
  say 'resolving the published stable release pointer'
  VERSION="$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 30 "$STABLE_URL")" || die 'could not resolve stable.txt over HTTPS'
fi
VERSION="${VERSION#v}"
valid_release_tag "$VERSION" || die 'release version must be a SemVer tag such as 2.22.0 or 2.22.0-rc.1'
VERSION="v${VERSION}"
ARCHIVE="taskdesk-${VERSION}.tar.gz"
CHECKSUM="${ARCHIVE}.sha256"
BUNDLE="${ARCHIVE}.sigstore.json"
CHECKSUM_BUNDLE="${CHECKSUM}.sigstore.json"
RELEASE_URL="${RELEASE_BASE}/${VERSION}"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/taskdesk-install.XXXXXX")" || die 'could not create a private temporary directory'
chmod 0700 "$TMP_ROOT"
cleanup() { rm -rf "$TMP_ROOT"; }
trap cleanup EXIT HUP INT TERM
for asset in "$ARCHIVE" "$CHECKSUM" "$BUNDLE" "$CHECKSUM_BUNDLE"; do
  say "downloading ${asset}"
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 300 "${RELEASE_URL}/${asset}" -o "${TMP_ROOT}/${asset}" || die "could not download release asset ${asset}"
done
if ((SKIP_VERIFY == 0)); then
  for pair in "$ARCHIVE:$BUNDLE" "$CHECKSUM:$CHECKSUM_BUNDLE"; do
    file="${pair%%:*}"; bundle="${pair#*:}"
    cosign verify-blob --bundle "${TMP_ROOT}/${bundle}" --certificate-oidc-issuer "$COSIGN_ISSUER" --certificate-identity "$COSIGN_IDENTITY" "${TMP_ROOT}/${file}" >/dev/null || die "cosign verification failed for ${file}"
  done
else
  warn 'SIGNATURE VERIFICATION SKIPPED (--skip-verify); the archive and checksum are not authenticated'
fi
read -r expected checksum_name checksum_extra < "${TMP_ROOT}/${CHECKSUM}" || die 'signed checksum file is empty'
[[ "$expected" =~ ^[0-9a-f]{64}$ && "$checksum_name" == "$ARCHIVE" && -z "${checksum_extra:-}" ]] || die 'signed checksum file has an invalid format or filename'
actual="$(sha256_file "${TMP_ROOT}/${ARCHIVE}")"
[[ "$expected" == "$actual" ]] || die 'release archive SHA-256 does not match its signed checksum'

# Check every member before extraction: no absolute paths, parent traversal, or
# content outside the one versioned release root.
tar -tzf "${TMP_ROOT}/${ARCHIVE}" > "${TMP_ROOT}/archive-members.txt" || die 'could not list release archive contents'
while IFS= read -r member; do
  [[ -n "$member" && "$member" != /* && "$member" != *'..'* ]] || die 'release archive contains an unsafe path'
  [[ "$member" == "taskdesk-${VERSION}/"* ]] || die 'release archive contains a path outside its expected root'
done < "${TMP_ROOT}/archive-members.txt"
# Inspect entry types before extraction. A symlink can redirect a later member
# outside the private staging directory; hardlinks and special files are not
# part of the deployment bundle contract either.
tar -tvzf "${TMP_ROOT}/${ARCHIVE}" > "${TMP_ROOT}/archive-details.txt" || die 'could not inspect release archive entries'
while IFS= read -r entry; do
  entry_type="${entry:0:1}"
  [[ "$entry_type" == '-' || "$entry_type" == 'd' ]] || die 'release archive contains a symbolic link, hardlink, or special file'
done < "${TMP_ROOT}/archive-details.txt"
mkdir -m 0700 "${TMP_ROOT}/unpacked"
tar -xzf "${TMP_ROOT}/${ARCHIVE}" -C "${TMP_ROOT}/unpacked"
RELEASE_ROOT="${TMP_ROOT}/unpacked/taskdesk-${VERSION}"
for required in compose.yml scripts/deploy.sh scripts/lib/local-certificate.sh scripts/lib/deploy-checks.sh deploy/.env.example deploy/compose.local.yml deploy/compose.prod.yml deploy/compose.traefik.yml deploy/traefik/dynamic/middlewares.yml; do
  [[ -f "${RELEASE_ROOT}/${required}" && ! -L "${RELEASE_ROOT}/${required}" ]] || die "release archive is missing a required regular file: ${required}"
done
[[ ! -L "$INSTALL_DIR" && ! -L "$INSTALL_DIR/.env" ]] || die 'installation directory and .env must not be symbolic links'
if ((YES == 0)); then
  if [[ "$EXISTING_ENV" == 1 ]]; then
    read -r -p "Update TaskDesk deployment files in ${INSTALL_DIR} and run the deploy script? [y/N] " answer
  else
    read -r -p "Install TaskDesk deployment files in ${INSTALL_DIR} and run the deploy script? [y/N] " answer
  fi
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] || die 'installation declined; no files were written'
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
  warn 'Docker Engine, the Compose plugin and docker buildx are required.'
  if ((YES == 0)); then
    read -r -p 'Install Docker using this system package manager now? [y/N] ' answer
    [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]] || die 'Docker installation declined; install Docker and rerun install.sh'
  fi
  ID=''
  [[ ! -r /etc/os-release ]] || . /etc/os-release
  case "$(uname -s):${ID:-}" in
    Darwin:*) command -v brew >/dev/null 2>&1 || die 'install Docker Desktop from docker.com or install Homebrew, then rerun'; brew install --cask docker ;;
    Linux:ubuntu) command -v sudo >/dev/null 2>&1 || die 'sudo is required to install Docker'; sudo apt-get update; sudo apt-get install -y docker.io docker-compose-v2 docker-buildx; sudo systemctl enable --now docker ;;
    Linux:debian|Linux:fedora|Linux:rhel|Linux:centos) die "automatic Docker installation is only supported on Ubuntu; this distribution's own packages do not reliably provide the Compose plugin and buildx that deploy.sh needs. Install Docker Engine, the Compose plugin and buildx from Docker's official repository (https://docs.docker.com/engine/install/), then rerun install.sh" ;;
    Linux:arch) die 'automatic Docker installation is disabled on Arch Linux to avoid partial system upgrades; install Docker during a synchronized full-system update, then rerun install.sh' ;;
    *) die 'automatic Docker installation is unsupported for this distribution; install Docker Engine, the Compose plugin and buildx, then rerun';;
  esac
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && docker buildx version >/dev/null 2>&1 || die 'Docker, the Compose plugin or docker buildx is still unavailable after installation'
fi
docker info >/dev/null 2>&1 || die 'Docker daemon is not reachable; start Docker and ensure the invoking user can access it before rerunning'
mkdir -p "$INSTALL_DIR"
[[ -d "$INSTALL_DIR" && ! -L "$INSTALL_DIR" ]] || die '--dir must be a real directory'
for member in compose.yml scripts/deploy.sh scripts/lib/local-certificate.sh scripts/lib/deploy-checks.sh deploy/.env.example deploy/compose.local.yml deploy/compose.prod.yml deploy/compose.traefik.yml deploy/compose.uat.yml deploy/compose.keycloak.yml deploy/compose.observability.yml deploy/entrypoint.sh deploy/seaweedfs/README.md deploy/traefik/dynamic/middlewares.yml; do
  [[ -f "${RELEASE_ROOT}/${member}" ]] || continue
  parent="$INSTALL_DIR"
  IFS=/ read -r -a parts <<< "$(dirname "$member")"
  for part in "${parts[@]}"; do
    [[ "$part" == . ]] && continue
    parent="${parent}/${part}"
    [[ ! -L "$parent" ]] || die "refusing to write through a symbolic link: ${parent}"
    mkdir -p "$parent"
  done
  tmp_file="$(mktemp "${parent}/.${member##*/}.install.XXXXXX")"
  cp -p "${RELEASE_ROOT}/${member}" "$tmp_file"
  mv -f "$tmp_file" "${INSTALL_DIR}/${member}"
done
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  cp "${INSTALL_DIR}/deploy/.env.example" "${INSTALL_DIR}/.env"
  chmod 0600 "${INSTALL_DIR}/.env"
fi
[[ ! -L "${INSTALL_DIR}/.env" ]] || die 'refusing to modify a symbolic-link .env file'

set_env_value() {
  local key="$1" value="$2" temp
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "invalid value for ${key}"
  temp="$(mktemp "${INSTALL_DIR}/.env.install.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found=0 }
    index($0, key "=")==1 { if (!found) { print key "=" value; found=1 }; next }
    { print }
    END { if (!found) print key "=" value }
  ' "${INSTALL_DIR}/.env" > "$temp"
  chmod 0600 "$temp"
  mv "$temp" "${INSTALL_DIR}/.env"
}
set_image_selection() {
  local tag="$1" digest="$2" temp
  [[ "$tag" != *$'\n'* && "$tag" != *$'\r'* ]] || die 'invalid value for TASKDESK_IMAGE_TAG'
  [[ "$digest" != *$'\n'* && "$digest" != *$'\r'* ]] || die 'invalid value for TASKDESK_IMAGE_DIGEST'
  temp="$(mktemp "${INSTALL_DIR}/.env.install.XXXXXX")"
  awk -v tag="$tag" -v digest="$digest" '
    BEGIN { tag_found=0; digest_found=0 }
    index($0, "TASKDESK_IMAGE_TAG=")==1 {
      if (!tag_found) { print "TASKDESK_IMAGE_TAG=" tag; tag_found=1 }
      next
    }
    index($0, "TASKDESK_IMAGE_DIGEST=")==1 {
      if (!digest_found) { print "TASKDESK_IMAGE_DIGEST=" digest; digest_found=1 }
      next
    }
    { print }
    END {
      if (!tag_found) print "TASKDESK_IMAGE_TAG=" tag
      if (!digest_found) print "TASKDESK_IMAGE_DIGEST=" digest
    }
  ' "${INSTALL_DIR}/.env" > "$temp"
  chmod 0600 "$temp"
  mv "$temp" "${INSTALL_DIR}/.env"
}
previous_image_tag="$(read_env_value TASKDESK_IMAGE_TAG)"
# A new release selection supersedes any digest retained by a rollback.
image_digest="$(read_env_value TASKDESK_IMAGE_DIGEST)"
if [[ "$previous_image_tag" != "$VERSION" ]]; then
  image_digest=''
fi
set_image_selection "$VERSION" "$image_digest"
if ((DOMAIN_SET)) || ((EXISTING_ENV == 0)); then set_env_value DOMAIN "${DOMAIN:-localhost}"; fi
if ((AGENT_HOST_SET || DOMAIN_SET || EXISTING_ENV == 0)); then
  set_env_value TASKDESK_AGENT_URL "https://${AGENT_HOST}"
  set_env_value TASKDESK_AGENT_HOST "$AGENT_HOST"
fi
if ((PORTAL_HOST_SET || DOMAIN_SET || EXISTING_ENV == 0)); then
  set_env_value TASKDESK_PORTAL_URL "https://${PORTAL_HOST}"
  set_env_value TASKDESK_PORTAL_HOST "$PORTAL_HOST"
fi
if ((FILES_HOST_SET || DOMAIN_SET || PROFILE_S3 || EXISTING_ENV == 0)); then set_env_value TASKDESK_FILES_HOST "${FILES_HOST:-files.${DOMAIN:-localhost}}"; fi

say "starting TaskDesk ${VERSION} in ${MODE} mode"
(
  cd "$INSTALL_DIR"
  if ((PROFILE_S3)); then ./scripts/deploy.sh "$MODE" --profile s3; else ./scripts/deploy.sh "$MODE"; fi
)
say 'deployment command completed; scripts/deploy.sh performs the final API health probe and prints the first-run setup URL'
