#!/usr/bin/env bash

validate_local_certificate_domain() {
  local domain="$1"
  local label
  local -a labels

  if [[ ! "$domain" =~ ^[A-Za-z0-9.-]+$ ]] ||
    ((${#domain} > 253)) ||
    [[ "$domain" == .* || "$domain" == *. || "$domain" == *..* ]]; then
    printf 'DOMAIN must be a DNS name containing only letters, digits, dots and hyphens.\n' >&2
    return 1
  fi

  IFS=. read -r -a labels <<< "$domain"
  for label in "${labels[@]}"; do
    if ((${#label} == 0 || ${#label} > 63)) ||
      [[ ! "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]]; then
      printf 'DOMAIN must contain DNS labels of 1–63 letters, digits or interior hyphens.\n' >&2
      return 1
    fi
  done
}

local_certificate_covers_routes() {
  local certificate="$1"
  local domain="$2"
  local hostname

  [ -f "$certificate" ] || return 1
  openssl x509 -in "$certificate" -noout -checkend 2592000 >/dev/null 2>&1 || return 1
  for hostname in "ticket.${domain}" "portal.${domain}" "mail.${domain}" "files.${domain}"; do
    openssl x509 -in "$certificate" -noout -checkhost "$hostname" >/dev/null 2>&1 || return 1
  done
}

prepare_local_certificate() {
  local cert_dir="$1"
  local domain="$2"
  local temp_dir
  local backup_dir
  local cert_path="$cert_dir/local.crt"
  local key_path="$cert_dir/local.key"

  validate_local_certificate_domain "$domain" || return 1
  if [ -f "$key_path" ] && local_certificate_covers_routes "$cert_path" "$domain"; then
    return 0
  fi

  mkdir -p "$cert_dir"
  temp_dir="$(mktemp -d "$cert_dir/.taskdesk-cert.XXXXXX")"
  if ! openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -subj "/CN=*.${domain}" \
    -addext "subjectAltName=DNS:*.${domain},DNS:${domain},DNS:ticket.${domain},DNS:portal.${domain},DNS:mail.${domain},DNS:files.${domain}" \
    -addext "basicConstraints=critical,CA:FALSE" \
    -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
    -addext "extendedKeyUsage=serverAuth" \
    -keyout "$temp_dir/local.key" -out "$temp_dir/local.crt" >/dev/null 2>&1; then
    rm -rf "$temp_dir"
    printf 'Could not generate the local TLS certificate.\n' >&2
    return 1
  fi
  chmod 0600 "$temp_dir/local.key"

  if [ -e "$cert_path" ] || [ -e "$key_path" ]; then
    backup_dir="$(mktemp -d "$cert_dir/replaced-XXXXXX")"
    [ ! -e "$cert_path" ] || cp -p "$cert_path" "$backup_dir/local.crt"
    [ ! -e "$key_path" ] || cp -p "$key_path" "$backup_dir/local.key"
    printf 'Saved the previous local TLS material to %s before renewal.\n' "$backup_dir" >&2
  fi

  mv "$temp_dir/local.key" "$key_path"
  mv "$temp_dir/local.crt" "$cert_path"
  rmdir "$temp_dir"
}
