#!/usr/bin/env bash
# Resolve the selected application's actual data volume; never guess the project prefix.
# The caller supplies dc(), including its selected Compose project and files.
resolve_compose_data_volume() {
  local container mount
  container="$(dc ps -a -q taskdesk)" || return 1
  if [[ ! "$container" =~ ^[a-f0-9]{12,64}$ ]]; then
    printf 'xx expected one existing taskdesk container in the selected Compose project\n' >&2
    return 1
  fi
  mount="$(docker inspect --format '{{range .Mounts}}{{if or (eq .Destination "/app/data") (eq .Destination "/app/data/attachments")}}{{.Type}}:{{.Name}}{{"\n"}}{{end}}{{end}}' "$container")" || return 1
  if [[ ! "$mount" =~ ^volume:[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
    printf 'xx selected taskdesk container must mount one named volume at /app/data or /app/data/attachments\n' >&2
    return 1
  fi
  printf '%s\n' "${mount#volume:}"
}
