#!/usr/bin/env bash
# Bound only setup acquisitions. APT's own retries never rerun browser or Docker tests.
set -Eeuo pipefail

if [[ "${1:-}" != --bounded ]]; then
  exec timeout --kill-after=10s 8m "$0" --bounded "$@"
fi
shift
mode="${1:-}"
shift || true
work="$(mktemp -d)"
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

case "$mode" in
  chromium)
    [[ $# -eq 0 ]] || exit 2
    # Run install-deps as root so its apt-get update inherits strict APT_CONFIG.
    # Install the browser separately as the runner user, preserving its cache location.
    sudo env "PATH=$PATH" TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$config" "$PWD/apps/web/node_modules/.bin/playwright" install-deps chromium
    apps/web/node_modules/.bin/playwright install chromium
    ;;
  debs)
    [[ $# -eq 1 && -d "$1" && ! -L "$1" ]] || { echo 'Expected an existing, non-symlink DEB directory' >&2; exit 2; }
    debs_dir="$(cd "$1" && pwd -P)"
    [[ -z "$(ls -A "$debs_dir")" ]] || { echo 'DEB directory must be empty' >&2; exit 2; }
    sudo env "PATH=$PATH" TASKDESK_APT_BINARY="$apt_binary" TASKDESK_APT_CONFIG="$config" apt-get update -qq
    (cd "$debs_dir" && apt-get download docker-compose-v2 docker-buildx)
    ;;
  *) echo 'Expected chromium or debs mode' >&2; exit 2 ;;
esac
