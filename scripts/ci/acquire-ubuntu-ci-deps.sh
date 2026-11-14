#!/usr/bin/env bash
# Bound only setup acquisitions. APT's own retries never rerun browser or Docker tests.
set -Eeuo pipefail

if [[ "${1:-}" != --bounded ]]; then
  exec timeout --kill-after=10s 8m "$0" --bounded "$@"
fi
shift
repo_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
playwright="$repo_root/apps/web/node_modules/.bin/playwright"

# Opt-in offline mode: a pinned, locally verified bundle replaces every APT
# network call. It never falls back to the network when verification fails.
bundle_archive=""
if [[ "${1:-}" == --bundle-archive ]]; then
  [[ $# -ge 2 && -f "$2" && ! -L "$2" ]] || { echo 'Expected an existing, non-symlink bundle archive' >&2; exit 2; }
  bundle_archive="$(cd "$(dirname "$2")" && pwd -P)/$(basename "$2")"
  shift 2
fi
mode="${1:-}"
shift || true

# Validate every argument before any verification or acquisition work.
debs_dir=""
case "$mode" in
  chromium) [[ $# -eq 0 ]] || { echo 'chromium mode takes no arguments' >&2; exit 2; } ;;
  debs)
    [[ $# -eq 1 && -d "$1" && ! -L "$1" ]] || { echo 'Expected an existing, non-symlink DEB directory' >&2; exit 2; }
    debs_dir="$(cd "$1" && pwd -P)"
    [[ -z "$(ls -A "$debs_dir")" ]] || { echo 'DEB directory must be empty' >&2; exit 2; }
    ;;
  *) echo 'Expected chromium or debs mode' >&2; exit 2 ;;
esac

# Canonical temp base so symlinked temp roots (macOS /var/folders) never trip path checks.
tmp_base="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
work="$(mktemp -d "$tmp_base/taskdesk-ci-deps.XXXXXX")"
trap 'rm -rf "$work"' EXIT
chmod 755 "$work"
config="$work/apt.conf"
apt_binary="$(command -v apt-get)"
# Playwright invokes apt-get itself. Apply the config after system files as a
# command-line option so runner configuration cannot override these bounds.
cat > "$work/apt-get" <<'WRAPPER'
#!/bin/sh
exec "$TASKDESK_APT_BINARY" -c "$TASKDESK_APT_CONFIG" "$@"
WRAPPER
chmod 755 "$work/apt-get"
export TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$config"
export PATH="$work:$PATH"
cat > "$config" <<'CONFIG'
Acquire::Retries "2";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Update::Error-Mode "any";
CONFIG

if [[ -n "$bundle_archive" ]]; then
  # $work stays traversable for the apt wrapper; the bundle lives in a private child.
  bundle_parent="$work/bundle"
  mkdir -m 700 "$bundle_parent"
  bundle_dir="$(node "$repo_root/scripts/ci/verify-ubuntu-ci-bundle.mjs" \
    --archive "$bundle_archive" \
    --manifest "$repo_root/scripts/ci/ubuntu-ci-bundle.manifest.json" \
    --destination-parent "$bundle_parent")" || { echo 'Bundle verification failed; no network fallback' >&2; exit 1; }

  case "$mode" in
    debs)
      docker_debs=("$bundle_dir"/docker-debs/docker-compose-v2_*.deb "$bundle_dir"/docker-debs/docker-buildx_*.deb)
      [[ ${#docker_debs[@]} -eq 2 && -f "${docker_debs[0]}" && -f "${docker_debs[1]}" && "$(ls "$bundle_dir/docker-debs" | wc -l | tr -d ' ')" -eq 2 ]] || { echo 'Expected exactly two Docker DEBs in the verified bundle' >&2; exit 1; }
      cp -p -- "${docker_debs[@]}" "$debs_dir/"
      ;;
    chromium)
      roots=()
      while IFS= read -r root; do roots+=("$root"); done < "$bundle_dir/playwright-roots.txt"
      [[ ${#roots[@]} -eq 33 ]] || { echo 'Expected 33 Playwright root packages in the verified bundle' >&2; exit 1; }
      # Isolated, empty APT state that indexes only the verified local repository.
      mkdir -p "$work/sources.list.d" "$work/lists/partial" "$work/archives/partial" "$work/apt-methods"
      # Only local transports exist: http, https and ftp methods are physically absent.
      for method in file copy store gzip xz; do
        [[ -x "/usr/lib/apt/methods/$method" ]] && ln -s "/usr/lib/apt/methods/$method" "$work/apt-methods/$method"
      done
      printf 'deb [trusted=yes] file:%s ./\n' "$bundle_dir/apt-repo" > "$work/sources.list"
      cat > "$work/offline-apt.conf" <<OFFLINE
APT::Sandbox::User "root";
APT::Get::Allow-Downgrades "false";
APT::Get::Remove "false";
APT::Get::Upgrade "false";
APT::Install-Recommends "false";
APT::Install-Suggests "false";
Dir::Etc::sourcelist "$work/sources.list";
Dir::Etc::sourceparts "$work/sources.list.d";
Dir::State::lists "$work/lists";
Dir::Cache::archives "$work/archives";
Dir::Bin::methods "$work/apt-methods";
OFFLINE
      sudo env "PATH=$PATH" DEBIAN_FRONTEND=noninteractive TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$work/offline-apt.conf" apt-get update -qq
      # Runner packages at or above the pinned versions stay untouched; only
      # missing roots and dependencies come from the verified local repository.
      sudo env "PATH=$PATH" DEBIAN_FRONTEND=noninteractive TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$work/offline-apt.conf" apt-get install -y --no-upgrade --no-install-recommends "${roots[@]}"
      "$playwright" install chromium
      ;;
  esac
  exit 0
fi

case "$mode" in
  chromium)
    # Run install-deps as root so its apt-get update inherits strict APT_CONFIG.
    # Install the browser separately as the runner user, preserving its cache location.
    sudo env "PATH=$PATH" TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$config" "$playwright" install-deps chromium
    "$playwright" install chromium
    ;;
  debs)
    sudo env "PATH=$PATH" TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$config" apt-get update -qq
    (cd "$debs_dir" && apt-get download docker-compose-v2 docker-buildx)
    ;;
esac
