#!/usr/bin/env bash

preflight_required_commands() {
  local command_name
  local -a missing=()
  local -a required=(
    awk bash cat chmod date dirname find git lscpu mkdir node pnpm realpath rm rmdir
    sha256sum sort uname
  )

  for command_name in "${required[@]}"; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
      missing+=("$command_name")
    fi
  done

  if ((${#missing[@]} > 0)); then
    printf 'Missing required diagnostic commands before setup: %s\n' \
      "${missing[*]}" >&2
    return 1
  fi
}
