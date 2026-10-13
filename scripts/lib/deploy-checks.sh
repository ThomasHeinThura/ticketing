#!/usr/bin/env bash
# Engine-level and byte-level checks used by scripts/deploy.sh.
#
# Sourced, never executed. Nothing here calls `exit` or `die`: every function
# returns non-zero and writes the reason to stderr, so the caller decides how to
# fail and CI can drive the same code against a real Docker engine.
#
# Why this file exists: the first two installer proofs failed because deploy.sh
# trusted the exit code or the human-readable text of `docker compose port` and
# `docker buildx imagetools inspect`. Both change between Compose/buildx
# versions (Compose v5.6.0 and 2.40.3 print `:0` with exit 0 for a port that is
# exposed but not published; buildx 0.30.1 ignores `--format '{{.Manifest.Digest}}'`
# and prints human text with exit 0). Every check below reads the Docker ENGINE
# (`docker inspect`) or raw registry BYTES (`--raw | sha256sum`), neither of
# which varies with the CLI plugin versions, and every one fails closed.

# The sha256 of empty input. A pipeline whose producer failed or printed nothing
# hashes to this, and it must never be accepted as an image digest.
DEPLOY_CHECKS_EMPTY_SHA256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

# assert_containers_unpublished <container-id>...
#
# Returns 0 only if EVERY container is on a non-host network, has
# PublishAllPorts false, declares no HostConfig.PortBindings entry and has no
# non-null NetworkSettings.Ports entry. No ids, an inspect failure or an
# unparsable answer all return 1. All ports are checked, not one configured
# port, so nothing on the service may be published at all.
assert_containers_unpublished() {
  local id line mode all cfg live
  if [ "$#" -eq 0 ]; then
    printf 'no container to check\n' >&2
    return 1
  fi
  for id in "$@"; do
    [ -n "$id" ] || { printf 'empty container id\n' >&2; return 1; }
    line="$(docker inspect --type container --format \
      '{{.HostConfig.NetworkMode}}|{{.HostConfig.PublishAllPorts}}|{{range $p, $b := .HostConfig.PortBindings}}{{$p}} {{end}}|{{range $p, $b := .NetworkSettings.Ports}}{{if $b}}{{$p}} {{end}}{{end}}' \
      "$id" 2>/dev/null)" || { printf 'cannot inspect container %s\n' "$id" >&2; return 1; }
    case "$line" in
      *'|'*'|'*'|'*) ;;
      *) printf 'unexpected inspect output for container %s\n' "$id" >&2; return 1 ;;
    esac
    IFS='|' read -r mode all cfg live <<< "$line"
    # `host` shares the host's network stack. `container:<id>` (what Compose's
    # `network_mode: service:<name>` resolves to) shares another container's stack, so
    # that container's publishes expose this one's ports even though this container
    # records none of its own.
    case "$mode" in
      host|container:*)
        printf 'container %s uses shared networking (%s)\n' "$id" "$mode" >&2
        return 1
        ;;
    esac
    if [ "$all" != false ]; then
      printf 'container %s publishes all exposed ports (PublishAllPorts=%s)\n' "$id" "$all" >&2
      return 1
    fi
    if [ -n "${cfg// /}" ] || [ -n "${live// /}" ]; then
      printf 'container %s publishes host ports: %s%s\n' "$id" "$cfg" "$live" >&2
      return 1
    fi
  done
}

# container_binds_host_port <container-id> <container-port> <host-port>
#
# Returns 0 if the container's configured bindings map <container-port>/tcp to
# <host-port>. An inspect failure or any other answer returns 1 ("not ours").
container_binds_host_port() {
  local id="$1" cport="$2" hport="$3" ports p
  [ -n "$id" ] || return 1
  ports="$(docker inspect --type container --format \
    "{{range \$b := index .HostConfig.PortBindings \"${cport}/tcp\"}}{{\$b.HostPort}} {{end}}" \
    "$id" 2>/dev/null)" || return 1
  for p in $ports; do
    [ "$((10#$p))" = "$((10#$hport))" ] 2>/dev/null && return 0
  done
  return 1
}

_deploy_checks_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 | awk '{print $1}'
  else return 1; fi
}

# resolve_image_digest <image-ref>
#
# Prints sha256:<hex>, the digest of the exact bytes the registry serves for the
# reference (the OCI index or manifest), computed locally from
# `docker buildx imagetools inspect --raw`. It does not parse human-readable
# output and does not use `--format`. Returns 1, with the reason on stderr, if
# buildx is missing, the inspect fails, the output is empty or the result is not
# a full lowercase sha256.
resolve_image_digest() {
  local ref="$1" hex
  docker buildx version >/dev/null 2>&1 \
    || { printf 'docker buildx is not installed\n' >&2; return 1; }
  hex="$(set -o pipefail; docker buildx imagetools inspect --raw "$ref" | _deploy_checks_sha256)" \
    || { printf 'could not read %s from the registry\n' "$ref" >&2; return 1; }
  if [ -z "$hex" ] || [ "$hex" = "$DEPLOY_CHECKS_EMPTY_SHA256" ]; then
    printf 'the registry returned no manifest bytes for %s\n' "$ref" >&2
    return 1
  fi
  [[ "$hex" =~ ^[0-9a-f]{64}$ ]] \
    || { printf 'unexpected hash output for %s\n' "$ref" >&2; return 1; }
  printf 'sha256:%s\n' "$hex"
}
