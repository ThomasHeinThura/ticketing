#!/usr/bin/env bash
# Runs scripts/ci/deploy-real-docker.test.mjs against a real Docker engine twice: with the
# runner's own Compose/buildx, then with Ubuntu's docker-compose-v2 and docker-buildx
# (what install.sh installs on Ubuntu) placed first on the CLI plugin path through
# DOCKER_CONFIG. Same engine, second plugin toolchain.
#
# Neither run may skip: a skipped run reports "success" while checking nothing, so the
# skipped count is read from the node:test summary and anything but 0 fails.
set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
SUDO=''
[ "$(id -u)" -eq 0 ] || SUDO='sudo'

run_suite() {
  local label="$1" out="$work/${1// /-}.out"
  echo "::group::deploy real-docker: ${label}"
  TASKDESK_REAL_DOCKER=1 node --test "$REPO_ROOT/scripts/ci/deploy-real-docker.test.mjs" 2>&1 | tee "$out"
  echo "::endgroup::"
  grep -Eq '^(ℹ|#) skipped 0$' "$out" || { echo "deploy real-docker (${label}): tests were skipped" >&2; return 1; }
  grep -Eq '^(ℹ|#) fail 0$' "$out" || { echo "deploy real-docker (${label}): tests failed" >&2; return 1; }
}

run_suite "runner toolchain"

mkdir -p "$work/debs" "$work/x" "$work/config/cli-plugins"
$SUDO apt-get update -qq
(cd "$work/debs" && apt-get download docker-compose-v2 docker-buildx)
for deb in "$work"/debs/*.deb; do dpkg -x "$deb" "$work/x"; done
for plugin in docker-compose docker-buildx; do
  src="$(find "$work/x" -type f -name "$plugin" -path '*cli-plugins*' | head -n 1)"
  [ -n "$src" ] || { echo "Ubuntu package did not contain $plugin" >&2; exit 1; }
  cp "$src" "$work/config/cli-plugins/$plugin"
  chmod +x "$work/config/cli-plugins/$plugin"
done
export TASKDESK_DOCKER_CONFIG="$work/config"
DOCKER_CONFIG="$TASKDESK_DOCKER_CONFIG" docker compose version
DOCKER_CONFIG="$TASKDESK_DOCKER_CONFIG" docker buildx version
run_suite "Ubuntu docker-compose-v2 and docker-buildx"
