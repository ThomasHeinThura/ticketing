#!/usr/bin/env bash
set -Eeuo pipefail

readonly ACCEPTED_SHA="f10f9a8fd383044926136cb0c233888e087d2ef9"
readonly CURRENT_SHA="10034a893b83ef0eba1d801b77d6e81f1e5a0e2e"
readonly RUN_BRANCH="codex/p0-hosted-ab-run"
readonly RUN_REF="refs/heads/${RUN_BRANCH}"
readonly TEST_GREP='G11: work-list LCP|G11: board render, 200 tasks'
readonly REPO="${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is required}"
readonly RUN_ID="${GITHUB_RUN_ID:?GITHUB_RUN_ID is required}"
readonly RUN_SHA="${GITHUB_SHA:?GITHUB_SHA is required}"
readonly RUNNER_TEMP_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}"
readonly EVIDENCE="${RUNNER_TEMP_DIR}/taskdesk-g11-ab-${RUN_ID}"
readonly WORKTREE_ROOT="${RUNNER_TEMP_DIR}/taskdesk-g11-ab-${RUN_ID}.worktrees"
readonly OWNER_MARKER="${WORKTREE_ROOT}/.taskdesk-owned-run"
readonly WORKTREES=(accepted-f10 current-10034)
readonly CANONICAL_FILES=(
  apps/web/e2e/performance.bench.ts
  apps/web/playwright.perf.config.ts
  apps/web/e2e/helpers/g11-performance-fixture.ts
)
readonly FINGERPRINT_FILES=(
  apps/web/e2e/performance.bench.ts
  apps/web/playwright.perf.config.ts
  apps/web/e2e/helpers/g11-performance-fixture.ts
  apps/web/package.json
  apps/web/vite.config.ts
  package.json
  pnpm-lock.yaml
  .github/actions/setup/action.yml
)

mkdir -m 700 "$EVIDENCE"
mkdir -m 700 "$EVIDENCE/accepted-f10" "$EVIDENCE/current-10034"
printf 'owned_worktree_cleanup=not_started\n' > "$EVIDENCE/cleanup-receipt.txt"

write_run_metadata() {
  cat > "$EVIDENCE/run-metadata.txt" <<EOF
workflow_ref=${GITHUB_REF:-unrecorded}
workflow_sha=$RUN_SHA
workflow_run_id=$RUN_ID
accepted_source_sha=$ACCEPTED_SHA
current_source_sha=$CURRENT_SHA
test_selection=$TEST_GREP
diagnostic_only=true
EOF
}
write_run_metadata

if [[ "${GITHUB_REF:-}" != "$RUN_REF" ]]; then
  printf 'Refusing unexpected workflow ref: %s\n' "${GITHUB_REF:-unset}" >&2
  exit 2
fi
if [[ "$(git -C "$REPO" rev-parse HEAD)" != "$RUN_SHA" ]]; then
  printf 'Checkout HEAD does not match GITHUB_SHA.\n' >&2
  exit 2
fi

if [[ -e "$WORKTREE_ROOT" || -L "$WORKTREE_ROOT" ]]; then
  printf 'Owned worktree path already exists; refusing to reuse it.\n' >&2
  exit 2
fi
mkdir -m 700 "$WORKTREE_ROOT"
printf 'run_id=%s\nworkflow_sha=%s\nrepo=%s\n' "$RUN_ID" "$RUN_SHA" "$REPO" > "$OWNER_MARKER"
chmod 600 "$OWNER_MARKER"

cleanup() {
  local original_status=$?
  local cleanup_status=0
  local name expected path resolved listed_head marker_content root_entries
  trap - EXIT
  set +e

  if [[ ! -d "$WORKTREE_ROOT" || -L "$WORKTREE_ROOT" || ! -f "$OWNER_MARKER" || -L "$OWNER_MARKER" ]]; then
    cleanup_status=1
  else
    marker_content="$(cat "$OWNER_MARKER")"
    if [[ "$marker_content" != "run_id=$RUN_ID
workflow_sha=$RUN_SHA
repo=$REPO" ]]; then
      cleanup_status=1
    fi
  fi

  if [[ "$cleanup_status" -eq 0 ]]; then
    for name in "${WORKTREES[@]}"; do
      path="$WORKTREE_ROOT/$name"
      if [[ ! -e "$path" && ! -L "$path" ]]; then
        continue
      fi
      if [[ -L "$path" || ! -d "$path" ]]; then
        cleanup_status=1
        continue
      fi
      resolved="$(realpath "$path")"
      if [[ "$resolved" != "$path" ]]; then
        cleanup_status=1
        continue
      fi
      if ! listed_head="$(git -C "$REPO" worktree list --porcelain | awk -v wanted="$path" '
        $1 == "worktree" { match_path = ($2 == wanted) }
        match_path && $1 == "HEAD" { print $2; exit }
      ')"; then
        cleanup_status=1
        continue
      fi
      case "$name" in
        accepted-f10) expected="$ACCEPTED_SHA" ;;
        current-10034) expected="$CURRENT_SHA" ;;
        *) cleanup_status=1; continue ;;
      esac
      if [[ "$listed_head" != "$expected" || "$(git -C "$path" rev-parse HEAD 2>/dev/null || true)" != "$expected" ]]; then
        cleanup_status=1
        continue
      fi
      if ! git -C "$REPO" worktree remove --force "$path"; then
        cleanup_status=1
      fi
      if [[ -e "$path" || -L "$path" ]]; then
        cleanup_status=1
      fi
    done
  fi

  if [[ "$cleanup_status" -eq 0 ]]; then
    root_entries="$(find "$WORKTREE_ROOT" -mindepth 1 -maxdepth 1 -print | LC_ALL=C sort)"
    if [[ "$root_entries" != "$OWNER_MARKER" ]]; then
      cleanup_status=1
    elif ! rm "$OWNER_MARKER" || ! rmdir "$WORKTREE_ROOT"; then
      cleanup_status=1
    fi
  fi

  {
    printf 'run_id=%s\nworkflow_sha=%s\n' "$RUN_ID" "$RUN_SHA"
    if [[ "$cleanup_status" -eq 0 && ! -e "$WORKTREE_ROOT" ]]; then
      printf 'owned_worktree_cleanup=complete\n'
    else
      printf 'owned_worktree_cleanup=failed_closed\n'
      printf 'worktree_root_retained=%s\n' "$WORKTREE_ROOT"
    fi
  } > "$EVIDENCE/cleanup-receipt.txt"

  if [[ "$cleanup_status" -ne 0 && "$original_status" -eq 0 ]]; then
    original_status=1
  fi
  exit "$original_status"
}
trap cleanup EXIT

for sha in "$ACCEPTED_SHA" "$CURRENT_SHA"; do
  git -C "$REPO" cat-file -e "$sha^{commit}"
done

git -C "$REPO" worktree add --detach "$WORKTREE_ROOT/accepted-f10" "$ACCEPTED_SHA"
git -C "$REPO" worktree add --detach "$WORKTREE_ROOT/current-10034" "$CURRENT_SHA"

for file in "${CANONICAL_FILES[@]}"; do
  accepted_hash="$(git -C "$WORKTREE_ROOT/accepted-f10" rev-parse "$ACCEPTED_SHA:$file")"
  current_hash="$(git -C "$WORKTREE_ROOT/current-10034" rev-parse "$CURRENT_SHA:$file")"
  if [[ "$accepted_hash" != "$current_hash" ]]; then
    printf 'Canonical benchmark/config/fixture differs at %s: %s vs %s\n' "$file" "$accepted_hash" "$current_hash" >&2
    exit 3
  fi
done

if node -e 'const net = require("node:net"); const socket = net.createConnection({ host: "127.0.0.1", port: 4178 }); let done = false; const finish = (code) => { if (!done) { done = true; socket.destroy(); process.exit(code); } }; socket.setTimeout(1500, () => finish(2)); socket.once("connect", () => { console.error("Port 4178 is already accepting connections; refusing to reuse it."); finish(1); }); socket.once("error", (error) => finish(error.code === "ECONNREFUSED" ? 0 : 2));'; then
  :
else
  printf 'Preview port 4178 is occupied or could not be checked; refusing to reclaim it.\n' >&2
  exit 4
fi

capture_source() {
  local tree="$1"
  local output="$2"
  {
    printf 'head='; git -C "$tree" rev-parse HEAD
    printf 'tree='; git -C "$tree" rev-parse 'HEAD^{tree}'
    printf '\nFILE_GIT_BLOB_IDS\n'
    for file in "${FINGERPRINT_FILES[@]}"; do
      printf '%s ' "$file"
      git -C "$tree" rev-parse "HEAD:$file"
    done
    printf '\nSOURCE_FILE_SHA256\n'
    for file in "${FINGERPRINT_FILES[@]}"; do
      sha256sum "$tree/$file"
    done
  } > "$output"
}

capture_build_assets() {
  local tree="$1"
  local output="$2"
  local assets="$tree/apps/web/dist/assets"
  if [[ ! -d "$assets" ]]; then
    printf 'Missing expected web build assets: %s\n' "$assets" >&2
    return 1
  fi
  {
    printf 'bundled_css_and_fonts_sha256\n'
    find "$assets" -maxdepth 1 -type f \( -name '*.css' -o -name '*.woff2' \) -print0 \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' file; do sha256sum "$file"; done
    printf '\nasset_directory_manifest_sha256\n'
    find "$assets" -maxdepth 1 -type f -print0 \
      | LC_ALL=C sort -z \
      | while IFS= read -r -d '' file; do sha256sum "$file"; done
  } > "$output"
}

capture_environment() {
  local tree="$1"
  local output="$2"
  local browser_path browser_hash browser_version
  browser_path="$(cd "$tree/apps/web" && node -e 'process.stdout.write(require("@playwright/test").chromium.executablePath())')"
  if [[ ! -x "$browser_path" ]]; then
    printf 'Playwright Chromium executable is missing: %s\n' "$browser_path" >&2
    return 1
  fi
  browser_hash="$(sha256sum "$browser_path" | awk '{print $1}')"
  browser_version="$("$browser_path" --version)"
  {
    printf 'captured_utc='; date -u +%FT%TZ
    printf 'runner_os=%s\nrunner_arch=%s\nimage_os=%s\nimage_version=%s\n' \
      "${RUNNER_OS:-unrecorded}" "${RUNNER_ARCH:-unrecorded}" \
      "${ImageOS:-unrecorded}" "${ImageVersion:-unrecorded}"
    cat /etc/os-release
    printf '\nuname\n'; uname -a
    printf '\narchitecture\n'; uname -m
    printf '\nlscpu\n'; lscpu
    printf '\nnode='; node --version
    printf 'pnpm='; pnpm --version
    printf 'playwright='; (cd "$tree/apps/web" && pnpm exec playwright --version)
    printf 'chromium_path=%s\nchromium_version=%s\nchromium_sha256=%s\n' \
      "$browser_path" "$browser_version" "$browser_hash"
    printf '\nCPU_MODEL_LINES\n'
    rg -m 1 '^(model name|Hardware)[[:space:]]*:' /proc/cpuinfo || true
    printf '\nFONT_PACKAGES\n'
    dpkg-query -W -f='${binary:Package}\t${Version}\n' 'fonts-*' 2>/dev/null | LC_ALL=C sort || true
    if command -v fc-list >/dev/null 2>&1; then
      printf '\nFONT_FAMILY_LIST_SHA256\n'
      fc-list --format '%{family}\n' | LC_ALL=C sort -u | sha256sum
    else
      printf '\nFONT_FAMILY_LIST_SHA256=fc-list-unavailable\n'
    fi
  } > "$output"
}

install_source() {
  local tree="$1"
  local name="$2"
  (cd "$tree" && pnpm install --frozen-lockfile)
  printf '%s_install=passed\n' "$name" >> "$EVIDENCE/run-metadata.txt"
}

build_source() {
  local tree="$1"
  local name="$2"
  (cd "$tree" && VITE_API_URL='' pnpm build)
  capture_build_assets "$tree" "$EVIDENCE/$name/build-assets.txt"
  printf '%s_build=passed\n' "$name" >> "$EVIDENCE/run-metadata.txt"
}

list_expected_tests() {
  local tree="$1"
  local name="$2"
  local list_file="$EVIDENCE/$name/test-list.log"
  (cd "$tree/apps/web" && pnpm exec playwright test --config playwright.perf.config.ts --list --grep "$TEST_GREP") > "$list_file" 2>&1
  local lcp_count board_count
  lcp_count="$(rg -F -o 'G11: work-list LCP' "$list_file" | wc -l | tr -d ' ')"
  board_count="$(rg -F -o 'G11: board render, 200 tasks' "$list_file" | wc -l | tr -d ' ')"
  if [[ "$lcp_count" != "1" || "$board_count" != "1" ]]; then
    cat "$list_file" >&2
    printf 'Expected exactly one LCP and one board diagnostic for %s; got %s and %s.\n' "$name" "$lcp_count" "$board_count" >&2
    return 5
  fi
}

run_measurement() {
  local tree="$1"
  local name="$2"
  local output="$EVIDENCE/$name"
  local status
  set +e
  (cd "$tree/apps/web" && pnpm exec playwright test --config playwright.perf.config.ts --grep "$TEST_GREP") > "$output/playwright.log" 2>&1
  status=$?
  set -e
  printf '%s\n' "$status" > "$output/exit-code.txt"
}

capture_source "$WORKTREE_ROOT/accepted-f10" "$EVIDENCE/accepted-f10/source-fingerprint.txt"
capture_source "$WORKTREE_ROOT/current-10034" "$EVIDENCE/current-10034/source-fingerprint.txt"

install_source "$WORKTREE_ROOT/accepted-f10" accepted-f10
install_source "$WORKTREE_ROOT/current-10034" current-10034
build_source "$WORKTREE_ROOT/accepted-f10" accepted-f10
build_source "$WORKTREE_ROOT/current-10034" current-10034

(cd "$WORKTREE_ROOT/accepted-f10" && apps/web/node_modules/.bin/playwright install --with-deps chromium)
printf 'chromium_install=passed\n' >> "$EVIDENCE/run-metadata.txt"

(
  cd "$WORKTREE_ROOT/accepted-f10"
  capture_environment "$WORKTREE_ROOT/accepted-f10" "$EVIDENCE/accepted-f10/environment.txt"
)
(
  cd "$WORKTREE_ROOT/current-10034"
  capture_environment "$WORKTREE_ROOT/current-10034" "$EVIDENCE/current-10034/environment.txt"
)
accepted_browser="$(rg '^chromium_sha256=' "$EVIDENCE/accepted-f10/environment.txt" | cut -d= -f2-)"
current_browser="$(rg '^chromium_sha256=' "$EVIDENCE/current-10034/environment.txt" | cut -d= -f2-)"
accepted_browser_path="$(rg '^chromium_path=' "$EVIDENCE/accepted-f10/environment.txt" | cut -d= -f2-)"
current_browser_path="$(rg '^chromium_path=' "$EVIDENCE/current-10034/environment.txt" | cut -d= -f2-)"
accepted_browser_version="$(rg '^chromium_version=' "$EVIDENCE/accepted-f10/environment.txt" | cut -d= -f2-)"
current_browser_version="$(rg '^chromium_version=' "$EVIDENCE/current-10034/environment.txt" | cut -d= -f2-)"
if [[ "$accepted_browser" != "$current_browser" || "$accepted_browser_path" != "$current_browser_path" || "$accepted_browser_version" != "$current_browser_version" ]]; then
  printf 'The selected Chromium executable differs between source contexts.\n' >&2
  exit 6
fi

list_expected_tests "$WORKTREE_ROOT/accepted-f10" accepted-f10
list_expected_tests "$WORKTREE_ROOT/current-10034" current-10034

run_measurement "$WORKTREE_ROOT/accepted-f10" accepted-f10
run_measurement "$WORKTREE_ROOT/current-10034" current-10034

failed=0
for name in accepted-f10 current-10034; do
  code="$(cat "$EVIDENCE/$name/exit-code.txt")"
  if [[ "$code" != "0" ]]; then
    failed=1
  fi
done
exit "$failed"
