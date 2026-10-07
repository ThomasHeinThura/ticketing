#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 2 ]]; then
  printf 'Usage: capture-build-assets.sh <source-tree> <output-file>\n' >&2
  exit 2
fi

tree_input="$1"
output="$2"
if [[ -L "$tree_input" || ! -d "$tree_input" ]]; then
  printf 'Source tree must be an existing real directory: %s\n' "$tree_input" >&2
  exit 2
fi
tree="$(cd "$tree_input" && pwd -P)"
output_parent="$(dirname "$output")"
if [[ -L "$output" || -L "$output_parent" || ! -d "$output_parent" ]]; then
  printf 'Output path or parent is missing or a symlink: %s\n' "$output" >&2
  exit 2
fi
output_parent="$(cd "$output_parent" && pwd -P)"
output="$output_parent/$(basename "$output")"

readonly -a entries=(agent portal)
for entry in "${entries[@]}"; do
  path="$tree/apps/web/dist/$entry"
  assets="$path/assets"
  if [[ -L "$path" || -L "$assets" || ! -d "$assets" ]]; then
    printf 'Missing or unsafe %s build asset directory: %s\n' "$entry" "$assets" >&2
    exit 1
  fi
  if [[ "$(cd "$assets" && pwd -P)" != "$assets" ]]; then
    printf 'Build asset directory resolves outside its expected path: %s\n' "$assets" >&2
    exit 1
  fi
  if [[ -n "$(find "$assets" -mindepth 1 -maxdepth 1 -type l -print -quit)" ]]; then
    printf 'Build asset directory contains a symlink: %s\n' "$assets" >&2
    exit 1
  fi
done

{
  printf 'bundled_css_and_fonts_sha256\n'
  for entry in "${entries[@]}"; do
    assets="$tree/apps/web/dist/$entry/assets"
    find "$assets" -maxdepth 1 -type f \( -name '*.css' -o -name '*.woff2' \) -print0 \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' file; do
          sha256sum "$file"
        done
  done
  printf '\nasset_directory_manifest_sha256\n'
  for entry in "${entries[@]}"; do
    assets="$tree/apps/web/dist/$entry/assets"
    find "$assets" -maxdepth 1 -type f -print0 \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' file; do
          sha256sum "$file"
        done
  done
} > "$output"
