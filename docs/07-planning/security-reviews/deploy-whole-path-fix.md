# Deploy/install whole-path fix — review record

**Reviewed head:** `98d7de56287d967a44cb1e5afb72ffe48818a224`

## Background

The signed-release installer proof failed twice:

- `v2.0.0-alpha.1`: the buildx padded `Digest:` line, fixed by #617.
- `v2.0.0-alpha.2`: `compose port` returns `:0` with rc 0 for an unpublished port.

An independent Opus whole-path diagnosis then tested every tool-output site against Docker CE 29.9/Compose 5.6/buildx 0.38 and Ubuntu docker.io 29.1/Compose 2.40/buildx 0.30.

## The fix

- The port check is engine-level, covers all replicas, and runs before and after start. It fails closed on host or shared networking.
- The digest is taken from raw index bytes, and buildx is required.
- Install auto-install is Ubuntu only.
- The docs are corrected and the test stub matches real tool output.
- A real-Docker CI step runs both toolchains.

## Contexts

- **Implementation:** Claude Sonnet `a4639e85be7e33451`.
- **Ordinary review:** Claude Sonnet `a36586d5afa4c3819` at `22c1ee7d`.
- **Security review:** Claude Opus 5.5 `abbf154c303b60dc2`. The first verdict was CHANGES REQUIRED (B-1, shared network mode); the closure at `98d7de56` is CLEARED, re-proven on real Docker. It is not a GPT-6 Sol review.

Each report is inserted unmodified, with its SHA-256.

<!-- BEGIN REPORT (agent adcb9194b77a4a904; model claude-opus-5-5; role independent whole-path diagnosis (Docker CE and Ubuntu toolchains); candidate 511c917fcf039857d73946f17fc0ce048d05b11f; sha256 ef2b91cd8219e421fe6d5407d29d91646efaa8ea168059a946cc4cb80f43c715) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Context id: fresh independent subagent context in session 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (difficult-diagnosis specialist; did not author, direct or remediate any deploy.sh/install.sh change)

# Whole-path diagnosis: `install.sh` + `scripts/deploy.sh` against real tools

- **Date:** 2026-10-10
- **Code examined:** `origin/main` = `511c917fcf039857d73946f17fc0ce048d05b11f` (read with `git show origin/main:<path>`; the working tree was not used and nothing in the repo was edited, committed or pushed).
- **Files:** `scripts/deploy.sh`, `scripts/lib/local-certificate.sh`, `install.sh`, `compose.yml`, `deploy/compose.{prod,local,traefik,uat}.yml`, `deploy/entrypoint.sh`, `deploy/.env.example`, `docs/05-operations/{one-line-install,deployment,proxy-topology-evidence}.md`, `scripts/ci/install.test.mjs`, `.github/workflows/{ci-full,release}.yml`, prior evidence in `~/.codex/taskdesk-evidence/2026-10-10/p0-installer-proof{,-2}-*`.
- **Real image:** `ghcr.io/thomasheinthura/taskdesk:sha-8ddb9de8d4d242a0832f6f91e12872300480a905` → index digest `sha256:3df21d9f8473167fca94aed2c3ab582586c504658c8727164aa8467fff7bced6`.

## Summary (plain language)

1. **The F1 port check is broken on every current Compose, not only v5.6.0.** For a port that is exposed but not published, `docker compose port` prints `:0` and exits 0 on both toolchains tested: Compose **v5.6.0** (Docker's repo) and **2.40.3** (Ubuntu's `docker-compose-v2`). The #308 security review had already seen this on **v5.5.1**, where the text was `invalid IP:0`. So `production`, `upgrade` and `rollback` all die with a false "PUBLISHED" error on every host. I reproduced it with the real unmodified script on both toolchains, and once more through the real `install.sh` path.
2. **The same check also passes when it should fail (fail-open) in edge cases.** It reports "no application port is published" when `taskdesk` runs with `network_mode: host`. It also misses ports published on another container port, looks only at the first replica, and runs only after the container is already serving. None of these is reachable with the shipped overlays. But this check is the guard for the `TASKDESK_TRUST_PROXY` invariant, so the fix should close them, and the structured check below does at no extra cost.
3. **The auto-install path `install.sh` advertises does not produce a working host.** On Ubuntu, `apt-get install docker.io docker-compose-v2` installs **no buildx**: `docker-buildx` is only a *Suggests*. `deploy.sh production`/`upgrade` then die with "could not resolve … to an immutable digest". The real cause, `docker: unknown command: docker buildx`, only shows in stderr. On Debian 12/13, Fedora 42, CentOS Stream 9 and Rocky 9, the package names `install.sh` uses do not exist, so the apt/dnf call itself fails.
4. **A trap for whoever writes the digest fix:** Ubuntu's buildx **0.30.1** silently ignores `--format '{{.Manifest.Digest}}'`. It prints the full human output with **rc=0**. The obvious "use `--format`" fix would therefore break every Ubuntu host. `--raw | sha256sum` and `{{json .Manifest}}` behave the same on 0.30.1 and 0.38.0.
5. **Everything else consumed is sound on both toolchains:** cosign verify (including its negatives), `up --wait` exit codes, `run --rm migrate` exit propagation, the readiness probe, the setup-token grep, the upgrade-mode `RepoDigests`/`Config.Image` reads, the openssl `-checkhost` text and the tar entry-type parse.

## Environments (owner-approved disposable OrbStack VMs)

| VM | OS | Toolchain | Engine ID | Store |
|---|---|---|---|---|
| `taskdesk-deploy-diagnosis` (A) | Ubuntu 24.04 arm64 | Docker official apt repo: docker-ce **29.9.0**, compose plugin **v5.6.0**, buildx **v0.38.0** | `e888d49a-…` | containerd snapshotter |
| `taskdesk-deploy-diagnosis-ubuntu` (B) | Ubuntu 24.04 arm64 | Ubuntu archive (exactly what `install.sh` L213 installs): docker.io **29.1.3**, docker-compose-v2 **2.40.3+ds1**, **no buildx**. Ubuntu `docker-buildx` **0.30.1** was added later for the format tests. | `b1f61ee5-…` | containerd snapshotter |

Both VMs: cosign **v3.0.5** (`cosign-linux-arm64: OK` against the official `cosign_checksums.txt`), OpenSSL 3.0.13, iproute2 6.1.0, GNU bash 5.2.21, mawk 1.3.4, GNU tar 1.35, coreutils 9.4. Both engine IDs differ from the Mac engine (`c152c629-…`).

Method:
- `probe.sh` ran every consumed command against a minimal project that mirrors `compose.yml`'s shape: a named project and named network, an `expose`d but unpublished 5173, healthchecks, a `service_completed_successfully` one-shot, a failing one-shot, an unhealthy service, and published, loopback and other-port overlays.
- `real-run.sh` ran the **unmodified** `deploy.sh` from 511c917f against the real signed image in four modes: `production`, `upgrade`, `rollback` and `local` (twice).
- The real `install.sh` from main ran against release `v2.0.0-alpha.2`, whose archive carries the 511c917f `deploy.sh`.
- `candidate.sh` checked the proposed replacements against real tools in nine cases.

## Consumption-site table

A = Docker official toolchain (v5.6.0 / buildx 0.38). B = Ubuntu toolchain (2.40.3; buildx absent, then 0.30.1). PASS means the script's assumption holds against the real output.

### `scripts/deploy.sh`

| # | Line | Command consumed | Assumption | A | B | Notes |
|---|---|---|---|---|---|---|
| S1 | 114 | `command -v docker` | rc | PASS | PASS | |
| S2 | 115 | `docker compose version >/dev/null` | rc 0 means a usable plugin | PASS | PASS | No version floor (D-11) |
| S3 | 116 | `docker info >/dev/null` | rc | PASS | PASS | |
| S4 | 133 | `sed -n "s/^NAME=//p" .env \| head -1` | first assignment | PASS | PASS | Info only: the `.` sourcing takes the *last* assignment |
| S5 | 158 | `set -a; . .env` | `.env` is the source of truth | PASS | PASS | Silently overrides a caller-exported `TASKDESK_IMAGE_DIGEST` (D-9) |
| S6 | 191 | `dc port traefik 80/443` rc | rc 0 means our Traefik owns the port | PASS* | PASS* | Real: running → `0.0.0.0:80` rc 0; absent or stopped → `service "traefik" is not running` rc 1. *Same rc-only contract as F1, latent (D-8) |
| S7 | 193 | bash `/dev/tcp` probe | bash feature | PASS | PASS | By inspection; no collision staged |
| S8 | lib 56,58,70,71 | `openssl x509 -checkend/-checkhost/-pubkey`, `openssl pkey -pubout` | text `" does match certificate"`; rc 0 even on mismatch | PASS | PASS | Real: `Hostname ticket.example.test does match certificate` / `Hostname nothere.invalid does NOT match certificate`, both rc 0. The script correctly keys on the text |
| S9 | 317 | `docker buildx imagetools inspect <tag>` | buildx is installed | PASS | **FAIL** | B: `docker: unknown command: docker buildx` → `xx could not resolve … to an immutable digest` (D-3) |
| S10 | 322 | `awk '/^Digest:/ {if ($1=="Digest:" && NF==2) print $2}'` | human text layout | PASS | PASS (0.30.1) | Both versions print a padded `Digest:    sha256:…`. Works today, but this is human text that already changed once (#617) |
| S11 | 324 | `^sha256:[0-9a-f]{64}$` | strict | PASS | PASS | This is what makes S10 fail closed |
| S12 | 300 | `cosign verify --certificate-oidc-issuer … --certificate-identity … --annotations tag=<tag> <repo@digest>` | rc | PASS | PASS | rc 0. Negatives: wrong `tag=` → rc 1 `missing or incorrect annotation`; wrong identity → rc 1 `no matching CertificateIdentity` |
| S13 | 462 | `dc pull` | rc | PASS | PASS (after buildx added) | |
| S14 | 338 | `dc up -d --wait postgres valkey` | rc reflects health | PASS | PASS | Unhealthy service → `container … is unhealthy` rc 1 on both |
| S15 | 451, 466 | `dc up -d --wait` (untargeted, includes completed `migrate`) | rc 0 when the one-shot exits 0 | PASS | PASS | rc 0 on both; the real stack reached the next step |
| S16 | 356 | **`dc port taskdesk 5173` rc** | **rc 0 means published** | **FAIL** | **FAIL** | Real: `:0`, rc 0, for an exposed but unpublished port (D-1). Fail-open cases too (D-2) |
| S17 | 374 | `dc exec -T taskdesk wget -q -O- …/api/public/health/ready` | wget in image | PASS | PASS | `{"status":"ok"}`; image has `/usr/bin/wget` (GNU Wget 1.21.3) |
| S18 | 380 | `dc logs --tail 60 taskdesk` | | PASS | PASS | |
| S19 | 390 | `dc logs taskdesk \| grep -iE 'setup (token\|url)'` | log text | PASS | PASS | Real line: `taskdesk-1  \| Setup token: <redacted>` |
| S20 | 475 | `dc images -q taskdesk \| head -1` then `docker inspect --format '{{index .RepoDigests 0}}'` | first RepoDigest is this repo's index digest | PASS | PASS | `images -q` prints bare hex (no `sha256:`). Real A: `ghcr.io/thomasheinthura/taskdesk@sha256:3df21d9f…`. B checked with the probe image. `\|\| true` absorbs the empty case |
| S21 | 476–479 | `dc ps -q taskdesk`; `docker inspect --format '{{.Config.Image}}'`; `%@*`, `##*:` | Config.Image is the compose image string | PASS | PASS | Real A: `ghcr.io/thomasheinthura/taskdesk:sha-8ddb…@sha256:3df21d9f…` → `CURRENT_TAG=sha-8ddb…`. B probe: `alpine:3.20@sha256:…` |
| S22 | 508, 550 | `dc run --rm migrate` | rc is migrate's exit code | PASS | PASS | Success rc 0; failing one-shot rc 3 propagated. The D1 comment is correct: targeted `up -d --wait migrate` gives rc 1 (`container … exited (0)`) on **both** versions |
| S23 | 513, 551 | `dc up -d --wait taskdesk` | rc | PASS | PASS | Real `rollback` and `upgrade` reached `assert_port_unpublished` |
| S24 | 517 | `${CURRENT##*@}` | | PASS | PASS | Fixes the second #308 finding (rollback hint) |
| S25 | 347 | `dc exec -T seaweedfs … weed shell` | | n/t | n/t | `--profile s3` not exercised |

### `install.sh`

| # | Line | Command consumed | Assumption | A | B | Notes |
|---|---|---|---|---|---|---|
| I1 | 88 | `sha256sum \| awk '{print $1}'` | GNU format | PASS | — | |
| I2 | 115–116 | `command -v curl tar awk mktemp cosign` | | PASS | — | |
| I3 | 119 | `getent ahosts` | rc | PASS | — | Used `/etc/hosts` entries |
| I4 | 132 | `ss -H -ltn 'sport = :5173' \| grep -q . && die` | ss works | PASS | — | Latent fail-open if `ss` errors (D-10, by inspection) |
| I5 | 140 | `curl … stable.txt` | host resolves | n/a | — | `get.taskdesk.dev` is NXDOMAIN; documented as P7 (`one-line-install.md` L3, L20) |
| I6 | 157 | `curl --fail …` 4 assets | rc | PASS | — | |
| I7 | 162 | `cosign verify-blob --bundle …` ×2 | rc | PASS | — | cosign 3.0.5 |
| I8 | 167–170 | `read expected name extra` vs `sha256sum` | 2-field format | PASS | — | |
| I9 | 174–186 | `tar -tzf`; `tar -tvzf` first char | `-`/`d` only | PASS | — | GNU tar 1.35 and macOS bsdtar 3.5.3 both mark hardlinks `h` and symlinks `l` (local test) |
| I10 | 203, 218 | `docker compose version` | | PASS | PASS | Does not check buildx (D-3) |
| I11 | 213 | `apt-get install -y docker.io docker-compose-v2` | gives a deploy-capable host | — | **FAIL** | Ubuntu 22.04/24.04: installs, but **no buildx**. Debian 12/13: `E: Unable to locate package docker-compose-v2` (D-5) |
| I12 | 214 | `dnf install -y docker docker-compose-plugin` | | — | **FAIL** | Fedora 42 / CentOS Stream 9: `No match for argument: docker-compose-plugin` (D-5) |
| I13 | 220 | `docker info` | invoking user can reach the daemon | PASS (root) | PASS (root) | By inspection: after a fresh apt install a non-root user is not in `docker` → fail-closed with a message |
| I14 | 301 | runs `deploy.sh production` | | **FAIL** at S16 | — | Real end to end on A (`--version 2.0.0-alpha.2`): verified, pulled, healthy, then `xx port 5173 is PUBLISHED` |

## Real outputs (load-bearing excerpts)

**S16, exposed but unpublished (the real stack, both toolchains):**
```
$ docker compose -f compose.yml -f deploy/compose.prod.yml port taskdesk 5173
:0
rc=0
$ docker inspect --format '{{json .Config.ExposedPorts}} {{json .HostConfig.PortBindings}} {{json .NetworkSettings.Ports}}' <taskdesk>
{"5173/tcp":{}} {} {"5173/tcp":null}
```
In both toolchains, a port that is not exposed at all gives an error: `no port 9999/tcp for container tdprobe-app-1: 5173/tcp` (B ends `: 0/tcp`), rc 1. Stopped or absent: `service "app" is not running`, rc 1. `docker port <id> 5173` (engine CLI): `no public port '5173' published`, rc 1.

**Compose `ps --format {{.Publishers}}` differs by version (a reason not to parse compose text):**
- A: `app running healthy [5173/tcp -> :0]`
- B: `app running healthy [{ 5173 0 tcp}]`

**Real unmodified deploy.sh, production:**
- A (v5.6.0): `ok signature verified` → `ok dependencies healthy` → `xx port 5173 is PUBLISHED…`, rc 1.
- B as installed by `install.sh`: `docker: unknown command: docker buildx` / `xx could not resolve ghcr.io/…:sha-8ddb… to an immutable digest`, rc 1.
- B + `docker-buildx` 0.30.1: `ok signature verified` → `ok dependencies healthy` → `xx port 5173 is PUBLISHED…`, rc 1.
- `rollback sha256:3df21d9f… sha-8ddb…` on **both** toolchains: verified, migrated (`✅ Migration step complete.`), then `xx port 5173 is PUBLISHED`.
- `local` (fresh and re-run) on both: rc 0, `ok the API answers /api/public/health/ready`.

**buildx format behavior on the real image:**

| Invocation | buildx 0.38.0 (A) | buildx 0.30.1 (Ubuntu) |
|---|---|---|
| plain + awk (current code) | `sha256:3df21d9f…` | `sha256:3df21d9f…` |
| `--format '{{.Manifest.Digest}}'` | `sha256:3df21d9f…` (1 line) | **full human output, 26 lines, rc 0** |
| `--format '{{ .Manifest.Digest }}'` | 1 line | human output, 26 lines |
| `--format '{{printf "%s" .Manifest.Digest}}'` | 1 line | 1 line |
| `--format '{{json .Manifest}}'` | JSON, `.digest` = `sha256:3df21d9f…` | same |
| `--raw \| sha256sum` | `3df21d9f…` | `3df21d9f…` |
| missing tag | `ERROR: …: not found` rc 1 | same |

**Compose version strings (for any floor check):**
- A: `--short` → `5.6.0`; `--format json` → `{"version":"v5.6.0"}`.
- B: `--short` → `2.40.3+ds1-0ubuntu1~24.04.1`; `--format json` → `{"version":"2.40.3+ds1-0ubuntu1~24.04.1"}`.

**Distro package availability (resolved inside throwaway containers in VM A):**

| Distro | `docker.io` | `docker-compose-v2` | `docker-compose` | `docker-buildx` | Exact install.sh command |
|---|---|---|---|---|---|
| Ubuntu 22.04 | 29.1.3 | 2.40.3 | 1.29.2 (v1) | 0.30.1 | installs, **no buildx** |
| Ubuntu 24.04 | 29.1.3 | 2.40.3 | 1.29.2 (v1) | 0.30.1 | installs, **no buildx** |
| Debian 12 | 20.10.24 | none | 1.29.2 (v1) | none | **fails** |
| Debian 13 | 26.1.5 | none | 2.26.1 (ships `/usr/libexec/docker/cli-plugins/docker-compose`) | 0.13.1 | **fails** |
| Fedora 42 | `docker` no match by name; `moby-engine` 29.4.2 | — | 5.1.2 | 0.34.0 | **fails** (`No match for argument: docker-compose-plugin`) |
| CentOS Stream 9 / Rocky 9 | none | — | none | none | **fails** |

## Defects

| ID | Severity | Fail direction | Defect |
|---|---|---|---|
| **D-1** | **Blocker (P0 proof)** | Closed (false positive) | `assert_port_unpublished` treats `docker compose port` rc 0 as "published". Real Compose returns rc 0 for an exposed but unpublished port, with `:0` on v5.6.0 and 2.40.3 and `invalid IP:0` on v5.5.1 (#308 review, `docs/07-planning/security-reviews/308-db-role-split.md` ~L546). Every `production`/`upgrade`/`rollback` on any current Compose exits 1 after the stack is already up. The image's own `EXPOSE 5173` (`{"5173/tcp":{}}`) is what makes this unconditional. |
| **D-2** | Medium (security guard quality) | **Open** | Same function, fail-open cases, all demonstrated with real tools: (a) `network_mode: host` gives `compose port` rc 1, so the check prints "no application port is published" while the app listens on the host; (b) ports published on another container port (`18080:8080`) are invisible; (c) only replica index 1 is checked; (d) the check runs only after `up --wait`, so a mistakenly published port has already been live for the whole health wait. Not reachable with the shipped overlays. |
| **D-3** | **Blocker (Ubuntu auto-install path)** | Closed | `install.sh` L213 installs no buildx, but `deploy.sh` `production`/`upgrade` require it (L317). Neither script checks for buildx, and the message names the wrong cause. `rollback` happens to skip buildx. |
| **D-4** | Fix hazard (not a current defect) | — | buildx 0.30.1 ignores `--format '{{.Manifest.Digest}}'` and returns human text with rc 0. A fix built on that template fails closed on every Ubuntu host. |
| **D-5** | High (advertised path) | Closed | `install.sh` auto-install package names do not exist on Debian 12/13 (`docker-compose-v2`) or Fedora/RHEL family (`docker-compose-plugin`). Debian 12 and EL9 have no usable distro Compose v2 at all. |
| **D-6** | Low (docs encode the wrong contract) | — | `docs/05-operations/deployment.md:143` and `proxy-topology-evidence.md:173` say "`docker compose port taskdesk 5173` must fail". Must change with D-1. `one-line-install.md` does not list buildx as a prerequisite. |
| **D-7** | Process | — | (a) `scripts/ci/install.test.mjs` L140–143 stub hardcodes `port) … exit 1`, i.e. it encodes the false contract, so the tests could never catch D-1. (b) D-1 was observed in the #308 security review and recorded as "worth a small follow-up", but no issue was filed (searched issues and PRs, all states). (c) The docker stub is the only docker the deploy tests ever meet, which is the root cause of both proof failures. |
| D-8 | Low | Closed (Compose then fails with a raw bind error) | Local preflight `dc port traefik N && return 0` uses the same rc-only contract. A `traefik` container without a binding for N would print `:0` rc 0 and skip the free-port probe. Not reachable with the shipped overlays. |
| D-9 | Low / explanation | — | `set -a; . .env` silently overrides a caller-exported `TASKDESK_IMAGE_DIGEST` with the `.env` empty value (observed: `TASKDESK_IMAGE_DIGEST=… ./scripts/deploy.sh production` still called buildx, both VMs). Behavior is consistent with ".env wins", but undocumented. |
| D-10 | Low | **Open** (preflight only) | `install.sh` L132 `ss -H … \| grep -q . && die`: if `ss` itself errors (e.g. an iproute2 without `-H`), stdout is empty and the port is treated as free. By inspection, not reproduced. deploy.sh's assertion is the real gate. |
| D-11 | Info | — | No Compose version floor. Behaviors verified on 2.40.3 and 5.6.0 only; Debian 13's 2.26.1 is untested. Version strings carry a `v` prefix or a `+ds…` suffix. |

## Fix list (smallest correct, toolchain-independent, fail-closed)

**F-1 (D-1, D-2): replace the `compose port` rc test with an engine-level structured check.** The template below was validated on both toolchains in nine cases (`candidate-*.txt`):
- no container → fail closed;
- created-not-started unpublished → ok;
- running unpublished → ok;
- stopped unpublished → ok;
- created-not-started published → die;
- running published → die;
- stopped published → die;
- other-port published → die;
- ephemeral host port → die;
- `network_mode: host` → die.

```
ids="$(dc ps -a -q taskdesk)" || die "…cannot list taskdesk containers"
[ -n "$ids" ] || die "…no taskdesk container to check"            # fail closed
for id in $ids; do
  line="$(docker inspect --type container --format \
    '{{.HostConfig.NetworkMode}}|{{.HostConfig.PublishAllPorts}}|{{range $p, $b := .HostConfig.PortBindings}}{{$p}} {{end}}|{{range $p, $b := .NetworkSettings.Ports}}{{if $b}}{{$p}} {{end}}{{end}}' \
    "$id")" || die "…cannot inspect $id"
  IFS='|' read -r mode all cfg live <<< "$line"
  [ "$mode" != host ] && [ "$all" = false ] && [ -z "${cfg// /}" ] && [ -z "${live// /}" ] \
    || die "…taskdesk publishes a host port (${cfg}${live}) or uses host networking"
done
```
Notes for the fixer:
- Check **all** ports, not just `TASKDESK_PORT`. Nothing on `taskdesk` should be published in production, and it removes the port-variable coupling.
- Use `ps -a` so stopped containers are still judged by their configuration.
- `{{range}}` over the maps is documented Go-template behavior and gave identical output on both toolchains.
- Optional hardening that closes D-2(d): in the `production` first run, call the same helper after `dc up --no-start` and before `dc up -d --wait`. Validated: `HostConfig.PortBindings` is populated in the `created` state on both toolchains. Keep the post-up call too. In `upgrade`/`rollback`, `--no-start` would recreate (stop) the old container a little earlier; that is acceptable, but it is the orchestrator's call.
- Put the helper in a sourceable `scripts/lib/*.sh`, following the `local-certificate.sh` precedent, so CI can call it against real docker (see the regression section). If you add a new lib file, also add it to the release archive list (`release.yml` ~L282), `install.sh`'s required-file list (L190) and copy list (L223).

**F-2 (D-3, D-4): make buildx an explicit precondition and derive the digest from bytes, not human text.**
- In `resolve_and_verify_image`, before the inspect: `docker buildx version >/dev/null 2>&1 || die "docker buildx is required to resolve ${tag_ref} to a digest (Ubuntu: apt-get install docker-buildx; Docker repo: docker-buildx-plugin)"`.
- Replace the awk with a byte-derived digest. Verified on 0.30.1 and 0.38.0:
  `raw="$(docker buildx imagetools inspect --raw "$tag_ref")" || die …; [ -n "$raw" ] || die …; digest="sha256:$(printf '%s' "$raw" | sha256sum | awk '{print $1}')"`.
  - Keep the existing strict regex. cosign then verifies exactly that digest, so any divergence fails closed.
  - Two cautions: `$(…)` strips trailing newlines, and the real `--raw` output ends in `}` with no newline (checked with `od`). If you prefer to avoid that subtlety, pipe straight into `sha256sum` under `pipefail` and reject `e3b0c442…`, the hash of empty input: a missing tag in a pipeline gave rc 1 plus that hash.
  - Do **not** use `--format '{{.Manifest.Digest}}'`; see D-4.
  - `sha256sum` is coreutils on Linux. Mirror `install.sh`'s `shasum -a 256` fallback if deploy.sh can run on macOS.
- `release.yml` L388 has the same awk. It runs on GitHub's buildx, so it is not urgent, but align it for consistency.

**F-3 (D-3, D-5): make the auto-install produce what deploy.sh needs, or refuse clearly.** Smallest correct:
- Ubuntu: `apt-get install -y docker.io docker-compose-v2 docker-buildx`.
- Every other distro: die with guidance to install Docker Engine, the Compose plugin and buildx from Docker's official repository, rather than guessing names. Debian 13 (`docker.io docker-compose docker-buildx`) and Fedora (`moby-engine docker-compose docker-buildx`) resolve as packages, but I did not install or run them (see Limits). Debian 12 and EL9 have no distro option.
- Extend the L203/L218 checks to `docker buildx version`, so an existing Docker without buildx is caught before any files are written.

**F-4 (D-8):** have the local preflight's "is it ours" test reuse the F-1 inspection on the `traefik` container (does `HostConfig.PortBindings["80/tcp"]` carry the configured HostPort?) instead of `dc port` rc. Low priority; keeps one contract.

**F-5 (D-6):** update `deployment.md:143` and `proxy-topology-evidence.md:173` to describe the new check, and list buildx in `one-line-install.md` prerequisites. Update `install.test.mjs`'s docker stub so `compose port` returns `:0` rc 0, the real behavior, and so `inspect` returns the template output. That way the stub can no longer encode the false contract.

**F-6 (D-11, optional):** if a floor is added, parse the leading `MAJOR.MINOR.PATCH` from `docker compose version --short` after stripping an optional `v` and anything from `+`. Base the floor on the versions tested (2.40.3, 5.6.0) or test lower ones first.

**F-7 (D-9, D-10): decisions for the orchestrator, not mechanical fixes.** Either document that `.env` wins for `TASKDESK_IMAGE_DIGEST` or honor an exported value. Make the `ss` preflight fail closed when `ss` exits non-zero.

Scope note: `scripts/deploy.sh` is on the security-scope list, so the fix PR needs the required GPT-6 Sol exact-head review.

## Regression recommendation (recommendation only)

The root cause of both proof failures is the same: the only docker the deploy logic ever meets in CI is a stub that encodes assumptions. A cheap real-tool layer fits `ci-full` without a new framework:

1. **Real-docker assertion job in `ci-full`** on `ubuntu-latest`, which already runs Docker Engine (the integration job relies on it for Testcontainers). Add one step that runs a small bash or `node:test` script (`scripts/ci/deploy-real-docker.test.mjs` fits the existing `scripts/ci/*.test.mjs` pattern). The script should:
   - bring up a tiny project mirroring `candidate.sh`, i.e. alpine pinned by digest, `expose: ["5173"]`, a healthcheck and a one-shot dependency;
   - source the F-1 helper from `scripts/lib/` and assert: **unpublished → pass**; published, loopback-published, other-port-published, ephemeral-published and `network_mode: host` → **die**; no container → **die**;
   - assert the exit codes deploy.sh depends on: untargeted `up -d --wait` with a completed one-shot is rc 0; targeted `up -d --wait <one-shot>` is rc ≠ 0 (guards the D1 comment); `run --rm` propagates rc 3; an unhealthy `--wait` is rc ≠ 0;
   - resolve a public multi-arch tag via the F-2 resolver and compare it with an independently computed `--raw | sha256sum`, plus a `not found` negative.

   Runtime is about 30–60 s.
2. **Cover the second toolchain without DinD.** The two failures were CLI-plugin format differences, not engine differences. In the same job, `apt-get download docker-compose-v2 docker-buildx`, then `dpkg -x` the packages into a temp dir. Run the same script a second time with `DOCKER_CONFIG` pointing at a dir whose `cli-plugins/` holds Ubuntu's compose 2.40.3 and buildx 0.30.1, against the runner's engine. That reproduces exactly toolchain B's plugin behavior, including the 0.30.1 `--format` quirk.
3. **Keep the stub tests, but make the stub honest:** `port` → `:0` rc 0, plus `inspect` handling (F-5).
4. **Make it gate where it matters:** run it whenever `scripts/deploy.sh`, `scripts/lib/**`, `install.sh`, `compose.yml` or `deploy/**` change, and make it a required check. A skipped job must not count as passing, per `ci-full.yml`'s own header. The gate change belongs to the orchestrator under `docs/04-engineering/ci-cd.md`.
5. The post-merge installer proof stays the end-to-end check. This layer only moves format and exit-code drift earlier, to PR time.

## Cleanup proof

- Baseline before creation: `orb list` showed 7 machines, none named `taskdesk-deploy-diagnosis*`. Mac engine `c152c629-9ae6-46d5-a27b-5dc1f779389b`, **19** containers, context `orbstack`.
- `orb delete -f taskdesk-deploy-diagnosis` rc 0; `orb delete -f taskdesk-deploy-diagnosis-ubuntu` rc 0. `orb list` afterwards shows the same 7 original machines (apim-docker, elk-apm-server, elk-dock, elk.oracledb, jumphost, micro, testdocker), all stopped as before.
- Mac engine afterwards: same ID `c152c629-…`, context `orbstack`, **21** containers. The 2 additions are not from this work:
  - `p599-opus-review-pg`, created 11:56:45;
  - `m0119-pg`, created 11:42:43.

  Both are `postgres:18` containers created during this session by other concurrent lanes. Every container this diagnosis ran was inside a VM, via `orb -m <vm>`. The only commands sent to the Mac engine were read-only (`docker info`, `docker ps`, `docker context show`). The 19 original containers are still present and were not touched. No `prune` was run anywhere.
- Evidence file `cleanup.txt` records the deletes and post-state. The two setup tokens printed by `deploy.sh local` inside the deleted VMs were redacted in the evidence files.

## Evidence (SHA-256)

Directory: `/private/tmp/claude-501/-Users-heinthura-Documents-Workfolder-Development-Ticketing-v2/3a9e9ce4-8409-47d4-b1be-1f1544697e70/scratchpad/`

| File | SHA-256 |
|---|---|
| `tree/main-511c917f.tar` (git archive of origin/main) | `9b519f515df511745d992ad3ec2edb4dd3534a18fbc3ca21b46919ce1de244a7` |
| `probe.sh` | `4fa2e3127e5aca9419d65214ea336b4ee57926a7c0761adcf35d21dfabf7dbba` |
| `real-run.sh` | `2be779d5da34927eb987794354801dad7a145c3769d0d623b0f2aae6c52ff94d` |
| `candidate.sh` | `33bd6094181caea6c9521f12b6c0c2a5c3c1d7449fdd823293b2ea51f6ad2873` |
| `evidence/probe-taskdesk-deploy-diagnosis.txt` (registry/cosign, A) | `bc3952f9fbc91ff273cfb0c08bd3fa5b9ad6fb0c59067915c7a7a2ca735bf8dd` |
| `evidence/probe-taskdesk-deploy-diagnosis-ubuntu.txt` (registry/cosign, B) | `54aa3b67b0d7d8752185c786f21dda43b1f42437a7c512eb79d429abdd08b449` |
| `evidence/probe2-taskdesk-deploy-diagnosis.txt` (compose, A) | `67273d0708f1c4d616001ae9a67ef739b71eddfc6956a8b65d98b30aec4692d4` |
| `evidence/probe2-taskdesk-deploy-diagnosis-ubuntu.txt` (compose, B) | `6bc8844e064fe3cfba76a30a699b440b1b75821ab826b61414cf24faa989a7d5` |
| `evidence/real-taskdesk-deploy-diagnosis.txt` (redacted) | `c1cf1ef10942f63ecaf3d9b2e62eb37326c40fadcc4d0252b013c30ac7a6675e` |
| `evidence/real-taskdesk-deploy-diagnosis-ubuntu.txt` (redacted) | `5516d7c795527731d3ecc035aba6a4ddc9c7492fa16c2338a327ef490c23d393` |
| `evidence/candidate-taskdesk-deploy-diagnosis.txt` | `da5198566cfa885612951cd9866941d03b668d3f40d1fb01310f509ae28b15c9` |
| `evidence/candidate-taskdesk-deploy-diagnosis-ubuntu.txt` | `734f7c7e916dc2888727965b8c198759c987b4530c8687bb9051bb3b205249af` |
| `evidence/cleanup.txt` | `7026416d9a522e14cdb10cd9b782c0722bd07c85a204b9168cad15161c28a0ed` |

Some extra commands were run inline rather than through these scripts; their output is quoted above but not saved as files: the buildx 0.30.1 format matrix, distro package resolution, the real `install.sh` run, `production` on B with buildx, and the bsdtar listing.

## Limits / not checked

- **Architectures:** arm64 VMs only. The amd64 image manifest was not pulled. Format behavior is CLI-side and architecture-independent, but this is not proven.
- **Image store:** containerd snapshotter only, which is the default on both fresh installs. The classic `overlay2` graphdriver, common on hosts upgraded from Docker < 29, was not tested for the S20/S21 `RepoDigests`/`Config.Image` reads.
- **Compose versions:** only v5.6.0 and 2.40.3 (v5.5.1 behavior comes from the #308 record). Debian 13's 2.26.1 and Fedora's 5.1.2 were not run. Neither was buildx 0.34 (Fedora) or 0.13.1 (Debian 13).
- **Distro installs:** Debian, Fedora and EL were checked by package resolution only. No Docker was installed or run on them.
- **Not exercised:** `--profile s3` (S25, SeaweedFS bucket creation), a real port collision for the `/dev/tcp` probe, an old iproute2 for D-10, and macOS `install.sh --env local` (darwin-local path: LibreSSL `-checkhost`, `shasum`, Docker Desktop).
- **Not done:** the end-to-end non-root flow after auto-install (docker group membership), by inspection only. `upgrade` across two *different* signed images: same-image upgrade only; the different-digest path was proven in the #308 review.
- **Candidate fixes:** validated as commands and templates against real tools, not as a patched `deploy.sh`. The worker's actual patch still needs its own real-tool run and the required reviews.
- `get.taskdesk.dev` NXDOMAIN is expected before P7 and is not counted as a defect.
<!-- END REPORT adcb9194b77a4a904 511c917f -->

<!-- BEGIN REPORT (agent a36586d5afa4c3819; model claude-sonnet-5-5; role ordinary review; candidate 22c1ee7d6d0e94783afac79bcb147f41c5edc7db; sha256 cb962d0ffb6d220dbba08114de002a24a5a31a87d5bc4def6d672fa5b1061a36) -->
Reviewer model: Claude Sonnet (claude-sonnet-5-5)
Context id: fresh independent subagent context, session 3a9e9ce4-8409-47d4-b1be-1f1544697e70 (did not author, direct or remediate the candidate)
Candidate SHA: 22c1ee7d6d0e94783afac79bcb147f41c5edc7db (verified; branch claude/fix-deploy-whole-path, one commit on main 24a48912)
Policy: main 24a48912 AGENTS.md and docs/04-engineering/agent-workflow.md
Verdict: CLEAR for ordinary review. No blocking finding. Four non-blocking notes. Security-scope (scripts/deploy.sh, scripts/lib/**, install.sh) still needs the required GPT-6 Sol exact-head review. The real-Docker CI step has never run on a real runner, because there is no Docker on this Mac; that is the main residual risk.

Method: `git archive HEAD` exported to /private/tmp/claude-501/rev-sonnet-export, with node_modules symlinked. Nothing in the worktree was edited. Mutations were made on temp copies mut-alwayspass and mut-oldport.

## 1. F-fixes against the diagnosis
- F-1 (D-1, D-2), scripts/lib/deploy-checks.sh:28-60 and scripts/deploy.sh `assert_port_unpublished`.
  - It lists with `dc ps -a -q taskdesk`, so stopped containers and every replica are included.
  - It uses the diagnosis template verbatim: `docker inspect` of NetworkMode, PublishAllPorts, PortBindings and live Ports, with no `TASKDESK_PORT` coupling.
  - It strengthens the template: a malformed inspect line is rejected, an empty id is rejected, and no container returns 1.
  - The caller dies on a failed listing, and on any non-zero helper result.
  - The check runs before and after start:
    - production: `up --no-start` plus assert, then `up -d --wait` plus assert;
    - upgrade and rollback: `up --no-start taskdesk` plus assert, then up plus assert.
  - Deviation: the diagnosis called the pre-start check "optional hardening". It is implemented in all three modes. The up-front recreate during upgrade and rollback is the cost the diagnosis flagged as the orchestrator's call; I accept it.
- F-2 (D-3, D-4), deploy-checks.sh:81-100 and deploy.sh `resolve_and_verify_image`.
  - It requires buildx up front, with a message naming the cause and the Ubuntu package.
  - It hashes the `--raw` bytes under `set -o pipefail`.
  - It rejects empty output and the empty-input sha e3b0c442….
  - It keeps the strict sha256 regex in deploy.sh afterward.
  - `$(…)` is applied to the hex only, so the trailing-newline caution does not apply.
  - It falls back to shasum when sha256sum is absent.
  - Not done: release.yml still parses the human `Digest:` line, which the diagnosis marked as non-urgent. install.test.mjs:572 pins that the awk is still present.
- F-3 (D-3, D-5), install.sh:203-217.
  - The auto-install runs only for `Linux:ubuntu`, with `docker.io docker-compose-v2 docker-buildx`.
  - Debian, Fedora, RHEL and CentOS die with guidance pointing to Docker's official repository.
  - Arch still dies.
  - The pre-check and the post-install check both include `docker buildx version`, and the consent prompt comes before any write (install.test.mjs:559).
- F-4 (D-8), deploy.sh `assert_local_port_free`. It uses `container_binds_host_port` on the `dc ps -q traefik` ids. An inspect failure returns 1, so the check falls through to the free-port probe, which is fail-closed.
- F-5 (D-6): the docs are updated (section 5), and the install.test.mjs stub is honest. `port` prints `:0` with rc 0 (line 166), buildx honours `--raw` only, and inspect is faked.
- Not implemented, and not required: F-6 (optional Compose version floor) and F-7 (D-9 `.env` wins, D-10 `ss` fail-open in the install.sh preflight). F-7 was a decision for the orchestrator. D-10 stays open, which is consistent with the diagnosis, since deploy.sh's assertion is the real gate. Neither is a regression.

## 2. Helper shipping and fail-closed
- release.yml:282 archive list: includes scripts/lib/deploy-checks.sh.
- install.sh:190 (required list) and install.sh:223 (copy list): both include it. The required list dies with "release archive is missing a required regular file". install.test.mjs:584 pins all three sites.
- Missing helper at run time: I moved the helper out of the export and ran `scripts/deploy.sh production`. deploy.sh:114 prints "No such file or directory" and exits non-zero (rc 1 when re-run directly). `set -Eeuo pipefail` is at deploy.sh:32. It fails before any docker action. It is not fail-open.
- scripts/lib/** is already a security-scope glob (ci-cd.md:319), so the helper is covered by the Sol gate.

## 3. Tests
- Ran on the export with Node v26.10.0: install.test.mjs, lib/deploy-checks.test.mjs and deploy-real-docker.test.mjs together gave 80 tests: 62 pass, 0 fail, 18 skipped. All 18 skips are the real-Docker file, which is inert without TASKDESK_REAL_DOCKER=1 as designed.
- `pnpm check:skips` (561 files, none skipped or focused) and `pnpm check:policy` pass. The variable-driven skip option is not flagged.
- Mutation 1, always-pass helper (`return 0` at the top of assert_containers_unpublished): both install.test.mjs (10 production fail-closed cases, plus the pre-start case) and deploy-checks.test.mjs (all the "-> fail" cases) go red. The real-Docker file also fails, hard rather than skipped, because there is no engine here. That is the correct behaviour.
- Mutation 2, old `dc port taskdesk` rc check restored: 13 install.test.mjs failures, including "accepts a running, exposed-but-unpublished container (compose port prints :0)" and the raw-bytes digest test. The honest stub catches D-1.
- run-deploy-real-docker.sh:
  - It runs the suite twice, once with the runner toolchain and once with Ubuntu's plugins on DOCKER_CONFIG.
  - It requires `skipped 0` and `fail 0` from the node:test summary (regex `^(ℹ|#) skipped 0$`) in both runs.
  - Under `set -Eeuo pipefail` with `tee`, a failing run propagates.
  - It extracts the plugins with `find -type f` and fails loudly if either is absent.
  - It matches the ℹ summary format that Node 26 printed in my runs. I did not test the `#` variant.
- The real-Docker test list covers the diagnosis's regression cases, plus replicas, an unknown id, a real Compose project in both created and running state, a registry resolve checked against Node's own sha256 and the human-text digest, and a missing tag.
- I could not run the real-Docker tests; there is no engine here. They run against the Docker CLI's `docker inspect` template output on CI only.
- Other gate suites: `node --test` over scripts/ci/lib, probes and test-contract gave 925 tests, 922 pass, 3 fail. The failures are changedFiles-with-resolvable-base and two typecheck-coverage tests. They are environmental (a git repo created in the export with no real base, and tsc via a symlinked node_modules). I did not compare against a pristine main export, so I cannot prove they are pre-existing; none touches deploy files.

## 4. CI and docs
- The step sits in the existing e2e job ("e2e - protected-route redirect"), ci-full.yml:100-102. It has the same `steps.scope.outputs.full != 'false'` guard as its neighbours and adds no new required context or job. The e2e job's `timeout-minutes: 20` is unchanged and the step is cheap; the reasoning is in ci-cd.md.
- `node scripts/ci/test-all.mjs --list` shows 40 gates and no deploy-specific row. That is consistent: the step is an addition to an existing job, not a gate row. ci-cd.md:263-276 documents it in prose. Workflow-gate/reconciliation tests in scripts/ci/lib and probes passed (922/925, above).
- apt step, run-deploy-real-docker.sh:29-37:
  - It runs `sudo apt-get update`, then `apt-get download docker-compose-v2 docker-buildx` as the unprivileged user into a temp dir, then `dpkg -x`.
  - It copies only the two plugin binaries.
  - It is sound for ubuntu-latest in principle.
  - Two untested assumptions:
    - The plugins are regular files at `*/cli-plugins/docker-compose` and `docker-buildx` inside the debs. A symlink would be missed, but it then fails loudly.
    - The 24.04 archive versions (older than the 2.40.3 and 0.30.1 the diagnosis tested) accept `--no-start`, `ps -a -q` and `imagetools inspect --raw`. They should, but this is unverified.

## 5. Docs accuracy
- deployment.md:143-149 and proxy-topology-evidence.md:173-176 describe the engine-level check accurately: all replicas, stopped ones included, host networking, PublishAllPorts, bindings, live mappings, and no container as a failure, checked before and after start.
- one-line-install.md:28-34 lists buildx and the Ubuntu-only auto-install with the Debian, Fedora, RHEL and CentOS guidance. The step description matches install.sh.
- Installer hash: one-line-install.md now says 17c1de23…71b6. `sha256sum install.sh` on the export gives exactly that, and install.test.mjs:863 passes.

## 6. Findings (all non-blocking)
1. scripts/ci/run-deploy-real-docker.sh:17-18 and deploy-real-docker.test.mjs:9-10 (comments): the test header says "ci-full's e2e job sets TASKDESK_REAL_DOCKER"; it is actually set by run-deploy-real-docker.sh. Cosmetic.
2. .github/workflows/release.yml (~L388, line unchanged): the immutability check still parses the human `Digest:` line, the same human-text assumption D-4 warned about. The diagnosis marked it non-urgent and it runs on GitHub's own buildx, but the test at install.test.mjs:572 now locks it in. Candidate follow-up, not a regression.
3. install.sh:210-217 (Debian and others): users who previously got a working auto-install on Debian or Fedora (which was broken anyway per D-5) now get a hard stop after the consent prompt. Intended per F-3; mention it in the release notes.
4. proxy-topology-evidence.md:176: one long line (the "If the port were published…" sentence was appended to the same line as the new text). Formatting only.
5. Residual: the real-Docker step and the Ubuntu-toolchain half are unproven on a real runner (see section 3 and 4). A first CI run is the test.

## Out of scope / regressions
None found. The diff is 13 files, all within the diagnosis's scope. The old `TASKDESK_PORT` coupling is removed from the check, with no behavioural loss since it now checks all ports.
<!-- END REPORT a36586d5afa4c3819 22c1ee7d -->

<!-- BEGIN REPORT (agent abbf154c303b60dc2; model claude-opus-5-5; role Sol-tier security review and B-1 closure; candidate 98d7de56287d967a44cb1e5afb72ffe48818a224; sha256 ebb07985c6395346a734789e26ab6d1742acd1fda0895d5f3031d038a1ed1898) -->
Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:not-exposed-to-agent (fresh independent subagent of session 3a9e9ce4-8409-47d4-b1be-1f1544697e70; this context did not author, direct or remediate the candidate, or the diagnosis in context adcb9194b77a4a904)
**Reviewed head:** 22c1ee7d6d0e94783afac79bcb147f41c5edc7db

**Verdict: CHANGES REQUIRED. One BLOCKING finding (B-1), narrow and a few lines to fix. Everything else is sound.** The supply-chain path, the published/PublishAllPorts/host-network/replica/inspect-failure cases, the install.sh changes and the CI step all hold up against real tools. B-1 is a demonstrated fail-open of the TASKDESK_TRUST_PROXY guard: real `deploy.sh production` printed "ok no application port is published" and "TaskDesk is up" while the API answered HTTP 200 on a host port, bypassing Traefik.

- Branch: `claude/fix-deploy-whole-path` (worktree `/private/tmp/claude-501/fix-deploy-2`, clean). Parent and comparison base: main `24a489129ba21398850ba271e169fccfd39a7b5a`. No PR exists for this head yet (`gh pr list --head` returned `[]`).
- Policy: AGENTS.md and `docs/04-engineering/agent-workflow.md` at main 24a48912.
- Surfaces examined: `scripts/deploy.sh`, `scripts/lib/deploy-checks.sh` (new), `install.sh`, `.github/workflows/ci-full.yml`, `.github/workflows/release.yml`, `.github/actions/change-scope/action.yml`, `scripts/ci/classify-change.mjs`, `scripts/ci/run-deploy-real-docker.sh` (new), `scripts/ci/deploy-real-docker.test.mjs` (new), `scripts/ci/lib/deploy-checks.test.mjs` (new), `scripts/ci/install.test.mjs`, `compose.yml`, `deploy/compose.prod.yml`, the `docs/04-engineering/ci-cd.md` delta, and the live `protect-main` ruleset.

## Findings

### BLOCKING

**B-1. `network_mode: container:<id>` / `service:<name>` passes the port check while the app is reachable from the host.** `scripts/lib/deploy-checks.sh:44`
- The helper rejects only `NetworkMode == host`.
- A taskdesk container that joins another container's network namespace has `NetworkMode=container:<id>`, `PublishAllPorts=false` and empty `PortBindings`/`Ports`, so it passes. Whatever the other container publishes still reaches the app's listener.
- This is the same bypass as host networking, which the candidate explicitly closes and documents ("Fails closed on: … host networking", `deploy.sh` comment at `assert_port_unpublished`). It needs the same precondition as every other case the guard exists for: an edit to the shipped compose files.

Reproduced with real tools (Ubuntu 24.04 VM, docker.io 29.1.3, Compose 2.40.3, buildx 0.30.1):
- Plain engine: `sr-proxy -p 127.0.0.1:15173:5173`, then `sr-app --network container:sr-proxy` listening on 5173.
  - `assert_containers_unpublished <sr-app>` returned rc 0.
  - `nc 127.0.0.1 15173` returned the app's payload.
- Compose: `taskdesk: network_mode: "service:proxy"`, with `proxy` publishing `127.0.0.1:15174:5173`. Helper rc 0; the app was reachable.
- **Real unmodified `deploy.sh production`** against the signed image `sha-8ddb9de8…`, with two edits:
  - `deploy/compose.prod.yml`: `network_mode: "service:valkey"` plus `networks: !reset []`;
  - `compose.yml`: valkey `ports: ["127.0.0.1:15190:5173"]`.
  - Result: rc 0. Both checks said ` ok no application port is published`; the run ended ` ok TaskDesk is up`.
  - `curl http://127.0.0.1:15190/api/public/health/ready` returned **HTTP 200** straight from the host, without Traefik. That is exactly the X-Forwarded-For forgery path the guard exists to prevent.

Fix (smallest correct):
- Make line 44 fail closed for `host` **and** any `container:*` mode, e.g. `case "$mode" in host|container:*) …return 1;; esac`. Resolving the target container recursively is also possible, but refusing is simpler and the shipped stack never uses either mode.
- Add a real-engine case to `deploy-real-docker.test.mjs` (`--network container:<published container>` → fail).
- Add a stub case to `scripts/ci/lib/deploy-checks.test.mjs`.

This is not a regression: main's `compose port` check also missed it. It is blocking because the candidate's stated purpose is to close the D-2 fail-open class of this exact guard, the bypass was demonstrated end to end, and the fix is a few lines.

### NON-BLOCKING

- **N-1. The pre-start check in `upgrade` and `rollback` is untested.** `scripts/deploy.sh:535-536` and `575-576`.
  - Deleting `dc up --no-start taskdesk; assert_port_unpublished` from either mode leaves `install.test.mjs` green (mutants d2 and d3 survived).
  - The same deletion in `production` (`:485-486`) is caught (d1 killed).
  - The post-start check still covers all modes, so the effect is only that a published port is live during the `--wait` window.
  - Add the same `/ up --no-start taskdesk$/` ordering assertion for upgrade and rollback.
- **N-2. The `live` (`NetworkSettings.Ports`) branch has no test that depends on it.** `scripts/lib/deploy-checks.sh:52`
  - Removing `|| [ -n "${live// /}" ]` leaves the stub tests green (mutant m3 survived).
  - On a real engine, live mappings always come with `PortBindings` or `PublishAllPorts`, so this is defense in depth that nothing tests. Either add a stub case (cfg empty, live non-empty → fail) or accept it as redundant.
- **N-3. The CI wrapper's anti-vacuity guard checks for "skipped 0" and "fail 0" but not for a minimum test count.** `scripts/ci/run-deploy-real-docker.sh:22-23`
  - A test file reduced to zero real tests passes. Verified: an import-only file gave wrapper rc 0. The skip guard does work: a test with a mutated `skip` was caught, rc 1.
  - Nothing asserts that the second run really used Ubuntu's plugins. Only the version is printed (`DOCKER_CONFIG=… docker compose version`), so a silent precedence failure would just repeat the runner toolchain.
  - Suggested: assert `# pass` ≥ 18, and assert the second `compose version` contains `+ds`.
- **N-4. Release ordering.**
  - The new `install.sh` requires `scripts/lib/deploy-checks.sh` in the archive (`install.sh:190`), so it refuses every already-published release (e.g. `v2.0.0-alpha.2`) until a release is cut from a commit containing the helper. That is fail-closed and correct, but the operator note or release step should say so.
  - The reverse case (an old install.sh with a new archive) is also fail-closed: `deploy.sh` sources the missing helper under `set -Eeuo pipefail` and exits 1 (checked in bash).
- **N-5. Ubuntu host with Docker's own `docker-ce` but no buildx.** `install.sh:213`
  - The new buildx precondition sends this host into the `apt-get install docker.io docker-compose-v2 docker-buildx` path, which conflicts with `docker-ce`/`containerd.io`.
  - It fails closed under `set -Eeuo pipefail`, but with an apt conflict message rather than "install docker-buildx-plugin". This is UX, not security.
- **N-6. The real-docker CI test exercises only the helper, never `deploy.sh`'s wiring of it.** The wiring (`ps -a -q` → helper → die) is covered by stubs in `install.test.mjs`. I ran it end to end in the VM (see Commands).
- **N-7. Step placement.** The new step comes after `Run browser smoke` in the `e2e` job (`ci-full.yml:100-102`), so a smoke failure skips it. The job, which is a required context, still fails, so nothing goes green silently.

### Checked and sound (focus areas 1–5)

**1. Supply chain**
- The sha256 of the `--raw` bytes equals the signed index digest. Four independent oracles agreed on `sha256:3df21d9f8473167fca94aed2c3ab582586c504658c8727164aa8467fff7bced6`:
  - the helper;
  - human `Digest:`;
  - ghcr's `Docker-Content-Digest` header from a direct registry HEAD;
  - Node `createHash` over the raw bytes in the CI test.
- Raw output: 1609 bytes, last byte `}`, with no trailing newline. `$(…)` stripping therefore cannot change the hash, and the helper pipes straight into the hasher anyway.
- `cosign verify` of `repo@<helper digest>` with the release identity, the issuer and `--annotations tag=sha-8ddb…`: rc 0. The digest of the same bytes plus a newline: rc 10, `no signatures found`.
- TOCTOU: if the registry serves different bytes at resolve time, the hash changes and cosign rejects it unless those exact bytes were signed by the release identity with the right `tag=` annotation. Cosign then fetches by digest, and Compose pulls `repo:tag@digest`, which Docker resolves and verifies by digest. In the VM, `Config.Image` was `…:sha-8ddb…@sha256:3df21d9f…` and `RepoDigests` was `…@sha256:3df21d9f…`. There is no exploitable window.
- Empty/failed output: `pipefail` inside the substitution, then the `e3b0c442…` check, then the 64-hex regex, then the strict regex in `deploy.sh`. A missing tag gives rc 1 with empty stdout. Removing `pipefail` alone is masked by the empty-hash check (mutant m8 survived as an equivalent mutant).
- Partial or garbage output with rc 0 gives a digest no signature exists for, so cosign fails closed. Under `--no-verify` the pull by that digest fails.

**2. Port invariant (other than B-1)**
- Published, ephemeral, other-port, loopback, PublishAllPorts, created-not-started, stopped and host network: all correct on the real engine (18/18 real tests, twice).
- Mixed replica set → fail. No ids → fail. Unknown id or inspect error → fail.
- Real `deploy.sh production` with a `ports:` edit stopped at the **pre-start** check (rc 1). The container was left `created` and never started.
- Real `deploy.sh production` with `network_mode: host` (+`networks: !reset []`) also stopped at the pre-start check with "uses host networking", rc 1.
- With the shipped files, `deploy.sh production` returned rc 0 on Ubuntu's own toolchain, with both checks passing and the probe OK.
- `-f` is always explicit, so `COMPOSE_FILE` and `compose.override.yml` cannot inject an overlay. Neither `network_mode` nor `ports` is env-interpolated in `compose.yml`/`compose.prod.yml`.
- A foreign container with forged `com.docker.compose.project=taskdesk` and service labels is added to the inspected set, which can only fail closed. It cannot hide the real one.
- The window between `up --no-start` and `up -d --wait` can only be exploited by a principal with Docker socket access (root-equivalent). Out of scope.

**3. install.sh**
- `docker.io docker-compose-v2 docker-buildx` all resolve from the signed Ubuntu archive. Installed in the VM: 29.1.3, 2.40.3, 0.30.1. No third-party sources are added.
- Debian, Fedora, RHEL and CentOS now die before installing anything. Other IDs die as before.
- buildx is checked both before and after the install.
- The helper is in the required list (`:190`) and the copy list (`:223`). A missing helper makes install die; mutant i3 was killed.
- The helper is inside the cosign-verified, sha256-checked archive, so its integrity is covered by the archive signature.
- `release.yml:282` adds it to `git archive`.

**4. CI step**
- `ci-full.yml` triggers on `pull_request` (not `pull_request_target`), `merge_group` and `workflow_dispatch`. Workflow `permissions: contents: read`; no secrets are referenced by the job or the step. Fork PR code runs with a read-only token and no secrets, the same as the existing jobs.
- `apt-get download` is authenticated against signed apt indexes. `dpkg -x` runs no maintainer scripts. `DOCKER_CONFIG` points at a fresh temp dir with no credentials. The registry access is to public ghcr.io.
- Skip-silently analysis:
  - The step's only condition is `full != 'false'`. The merge base's classifier returns `policy` only for policy Markdown, so any `scripts/**` change is full.
  - `e2e - protected-route redirect` is a required context in the live `protect-main` ruleset.
  - Inside the step, skipped > 0 or fail > 0 fails it, but see N-3.

**5. Tests and mutations** (summary; details in Commands)
- Local, macOS bash 3.2, Node 26: `deploy-checks.test.mjs` + `install.test.mjs` + `deploy-real-docker.test.mjs` = 80 tests, 62 pass, 0 fail, 18 skipped. The 18 skipped are the real-docker tests, inert as designed.
- VM, Node 18 TAP: real-docker 18/18 pass, 0 skipped. The full wrapper `run-deploy-real-docker.sh` gave rc 0, 18/18 twice.
- 18 mutants. Killed: m1 (no host check), m2 (no PublishAllPorts), m4 (no cfg), m5 (no empty-hash), m6 (no-args ok), m7 (first id only), m9 (inspect failure ignored), d1, d4 (assert is a no-op, 10 failures), d5 (no buildx precondition), i1, i2, i3.
- Survived:
  - m3 (live branch): N-2.
  - m8 (no pipefail): equivalent, masked by the empty-hash check.
  - d2 and d3 (pre-start check in upgrade/rollback): N-1.
  - d6 (`ps` failure tolerated): equivalent, because empty ids still fail closed in the helper.

## Commands (abridged)

```
git -C /private/tmp/claude-501/fix-deploy-2 rev-parse HEAD HEAD^   # 22c1ee7d…db / 24a48912…5a
git diff 24a48912..HEAD -- scripts/deploy.sh scripts/lib install.sh .github scripts/ci/run-deploy-real-docker.sh
git archive HEAD | tar -x -C $TMPDIR/sec-review-export            # clean export; all runs on copies
node --test scripts/ci/lib/deploy-checks.test.mjs scripts/ci/install.test.mjs scripts/ci/deploy-real-docker.test.mjs
# mutations: perl -0pi on a per-mutant copy of the export, then node --test on the relevant file
gh api repos/ThomasHeinThura/ticketing/rulesets/<id>               # e2e is required
orb create ubuntu:noble taskdesk-deploy-sec-review                 # VM engine ID 8a8d44fc-…, Mac engine c152c629-…
apt-get install -y docker.io docker-compose-v2 docker-buildx       # exactly install.sh:213
cosign v3.0.5 from GitHub release, `sha256sum -c` against cosign_checksums.txt: OK
TASKDESK_REAL_DOCKER=1 node --test scripts/ci/deploy-real-docker.test.mjs     # 18/18
bash scripts/ci/run-deploy-real-docker.sh                                     # rc 0, 18/18 ×2
resolve_image_digest ghcr.io/thomasheinthura/taskdesk:sha-8ddb9de8d4d242a0832f6f91e12872300480a905
  -> sha256:3df21d9f8473167fca94aed2c3ab582586c504658c8727164aa8467fff7bced6 (= human, = registry HEAD)
cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main \
  --annotations tag=sha-8ddb… ghcr.io/thomasheinthura/taskdesk@sha256:3df21d9f…   # rc 0 ; perturbed digest rc 10
./scripts/deploy.sh production   # shipped files: rc 0
                                 # + ports edit: rc 1 at the pre-start check, container left 'created'
                                 # + network_mode host: rc 1 "uses host networking"
                                 # + network_mode service:valkey, valkey publishing 5173: rc 0 <- B-1, curl 200
```

## Cleanup proof

- `orb delete -f taskdesk-deploy-sec-review`. Afterwards `orb list` shows only the pre-existing machines: apim-docker, elk-apm-server, elk-dock, elk.oracledb, jumphost, micro, testdocker. All stopped, and none is `taskdesk-deploy-sec-review`.
- Mac engine: `docker context show` = `orbstack` before and after; engine ID `c152c629-9ae6-46d5-a27b-5dc1f779389b` (29.4.0) before and after. I ran only read-only `docker info` and `docker ps` against it.
  - The container count changed from 21 to 19 during the review. The churn comes from another lane: `s1-fix2-pg` was created at 14:17 and showed "Up 1 second". It was not caused by this review.
  - The long-running `taskdesk-*` containers were untouched (Up 18–42 h).
- Temp files removed (`export.tar`, mutant copies). The candidate worktree is unchanged and clean; nothing was edited, committed or pushed.

## Residual risk and not checked

- **Not checked:** an actual GitHub Actions run of the new step. No PR exists, so I did not confirm `apt-get download` against the runner's mirror set, or that `$DOCKER_CONFIG/cli-plugins` takes precedence over the runner's docker-ce plugins. The plugin-search order is documented Docker CLI behavior, and in the VM both toolchains were the same Ubuntu build.
- **Not checked:** Docker's official toolchain (docker-ce, Compose v5.x, buildx 0.38). The diagnosis covered it; I tested only the Ubuntu toolchain that install.sh installs.
- **Not checked:** an end-to-end `install.sh` run with this candidate. No release archive carries the helper yet (N-4). I also did not run `upgrade` or `rollback` against real Docker.
- **Residual (out of scope for this guard):** another container on the taskdesk network that publishes a port and forwards it to `taskdesk:5173`, e.g. a socat sidecar. That is a proxy by construction, and the guard cannot tell it from Traefik.
- **Residual:** a principal with Docker socket access can change containers between the check and the start. That principal is root-equivalent.
- **Info:** `container_binds_host_port` evaluates `$((10#$hport))`, and `TASKDESK_LOCAL_HTTP(S)_PORT` comes from `.env`. `.env` is already sourced as shell and the value is regex-checked first (`deploy.sh` `assert_local_port_free`), so this is no new trust boundary.
- shellcheck was not available on this host. Only `bash -n` was run, and it passed for all four scripts.

---

# Closure check at 98d7de56

Reviewer model: Claude Opus 5.5 (claude-opus-5-5)
Reviewer context ID: claude-agent:abbf154c303b60dc2 (the same context that wrote the review above; its header said "not-exposed-to-agent" because the ID had not been given to it yet)
**Reviewed head:** 98d7de56287d967a44cb1e5afb72ffe48818a224

**Verdict: CLEARED. B-1 is closed and proven against real Docker. N-1, N-2, N-5 and N-7 are closed. N-3 is partly closed, with one non-blocking residual (NB-C1 below). No regressions found.** N-4 and N-6 were not in this closure request and remain as written above, both non-blocking.

- Delta: `git diff 22c1ee7d..98d7de56` is one commit, `98d7de56` "fix(deploy): refuse container-shared networking; prove the pre-start check in every mode", 11 files.
- Base: the previously reviewed head `22c1ee7d6d0e94783afac79bcb147f41c5edc7db`, on main `24a489129ba21398850ba271e169fccfd39a7b5a`.
- Clean `git archive 98d7de56` export. The worktree is clean and HEAD is 98d7de56.

## Item by item

- **B-1: CLOSED.**
  - `scripts/lib/deploy-checks.sh:48-53` now refuses `host|container:*` ("uses shared networking (<mode>)").
  - Docker network names cannot contain `:`, so a user network named e.g. `container-net` is not caught by mistake. A new stub case pins that.
  - New tests: a stub case, an `install.test.mjs` deploy-level case, a real-engine `--network container:<publishing container>` case, and a real Compose `network_mode: service:valkey` + valkey `ports:` case.
  - Real proof: VM `taskdesk-deploy-sec-review-2`, Ubuntu 24.04, docker.io 29.1.3, Compose 2.40.3, buildx 0.30.1, cosign v3.0.5 (checksum OK). The exported helper's sha256 in the VM equals the export's (`375a4c73…`).
  - My original repro: the real `deploy.sh production` against the signed `sha-8ddb9de8…` image, with `deploy/compose.prod.yml` set to `network_mode: "service:valkey"` + `networks: !reset []`, and `compose.yml` giving valkey `ports: ["127.0.0.1:15190:5173"]`.
    - Result: **rc 1** at the pre-start check: `xx the taskdesk service is not proven unpublished (container f218de03… uses shared networking (container:1d40965a…))`.
    - `taskdesk-taskdesk-1` was left `created` and never started. `curl 127.0.0.1:15190/api/public/health/ready` returned `000`, i.e. not reachable. The same repro at 22c1ee7d had returned rc 0 and HTTP 200.
  - Mutants:
    - reverting to `host)` only → 2 failures (killed);
    - widening to `container*` → 1 failure, because the `container-net` pass case is pinned (killed);
    - dropping `host` and keeping `container:*` → 2 failures (killed).
- **N-1: CLOSED.**
  - New `install.test.mjs` cases cover `production`, `upgrade` and `rollback`. The stub reports a published port until the app is started, so only the pre-start check can catch it, and each case asserts that `up -d --wait` never ran.
  - My original surviving mutants are now killed: d2 (upgrade) and d3 (rollback) each give 1 failure; d1 (production) gives 2.
- **N-2: CLOSED.** The stub and install-level cases "a live port mapping with no configured binding" are in. Mutant m3 (drop the `live` check) is now killed with 2 failures.
- **N-3: PARTLY CLOSED.**
  - Override proof works in both directions. The wrapper compares the version reported through `DOCKER_CONFIG` with the extracted `.deb` versions, and refuses when it matches the runner's version.
    - VM, identical toolchains: wrapper rc 1, "the plugin override is not taking effect" (correct refusal).
    - With Docker's official Compose v2.39.1 (sha256 OK) installed as the runner toolchain: wrapper **rc 0**. The runner run was 20/20; the second run reported `Docker Compose version 2.40.3+ds1-0ubuntu1~24.04.1` and was 20/20, with 0 skipped in both.
  - The zero-test guard (`tests [1-9]…`) is not effective. See NB-C1.
- **N-5: CLOSED.** `install.sh:205-207`: when Docker and Compose are present but buildx is missing, install stops before any consent prompt or package install. The message names both `docker-buildx-plugin` (docker-ce hosts) and `docker-buildx` (Ubuntu docker.io hosts). Reverting the block fails 2 tests. Only stub-tested (see Not checked).
- **N-7: CLOSED.** `ci-full.yml:100-104`: the step is now `if: always() && steps.scope.outputs.full != 'false'`, so a smoke failure no longer hides it. `always()` cannot turn a failure into a pass: the job (the required context `e2e - protected-route redirect`) still fails if any step fails. If the scope step itself fails, `full` is empty, which is `!= 'false'`, so the step still runs.

## No regressions

- Local run, Node 26: `deploy-checks.test.mjs` + `install.test.mjs` + `deploy-real-docker.test.mjs` = 90 tests, 70 pass, 0 fail, 20 skipped (the real-docker file, inert without `TASKDESK_REAL_DOCKER=1`).
- `bash -n` passes on all four scripts.
- `one-line-install.md`'s pinned installer hash `cd4078e8…` equals `shasum -a 256 install.sh` at 98d7de56.
- VM, the real `deploy.sh production`:
  - shipped files: **rc 0**; signature verified, both port checks ok, readiness probe ok, "TaskDesk is up";
  - `network_mode: host`: rc 1, "uses shared networking (host)";
  - published `ports:`: rc 1 at the pre-start check, container left `created`.
- VM real-docker suite (`TASKDESK_REAL_DOCKER=1`): 20/20 pass, 0 skipped. `service:valkey` inspects as `container:<id>`.
- Supply-chain code (`resolve_image_digest`, `resolve_and_verify_image`), `release.yml` and the install archive lists are unchanged in this delta.

## New non-blocking finding

- **NB-C1. The "tests > 0" guard cannot catch an empty test file.** `scripts/ci/run-deploy-real-docker.sh:25`
  - `node --test` counts a file that registers no tests as one passing test. I checked on Node 18 (VM) and Node 26 (local), with both the spec and TAP reporters: an import-only file reports `tests 1`, `pass 1`. CI uses Node 24 (`.github/actions/setup/action.yml:17`); I expect the same there but did not run it.
  - Result: the wrapper's `run_suite` gave rc 0 on an empty file.
  - The skip guard and the fail guard work, and emptying the file would show up in the PR diff and review, so this does not block.
  - Suggested follow-up: assert `pass` ≥ the known count (currently 20), or grep for specific test names.

## Commands (abridged)

```
git -C /private/tmp/claude-501/fix-deploy-2 rev-parse 98d7de56   # 98d7de56287d967a44cb1e5afb72ffe48818a224
git diff 22c1ee7d..98d7de56
git archive 98d7de56 | tar -x -C $TMPDIR/sec-review-export
node --test scripts/ci/lib/deploy-checks.test.mjs scripts/ci/install.test.mjs scripts/ci/deploy-real-docker.test.mjs  # 90/70/0/20
# mutants b1-revert, b1-anycontainer, m1-nohost, m3-nolive, d1, d2, d3, n5-revert: all killed
orb create ubuntu:noble taskdesk-deploy-sec-review-2         # VM engine 374c81fb-…
apt-get install -y docker.io docker-compose-v2 docker-buildx  # = install.sh:216 (Ubuntu)
./scripts/deploy.sh production                               # shipped rc 0 / service:valkey rc 1 / host rc 1 / ports rc 1
TASKDESK_REAL_DOCKER=1 node --test scripts/ci/deploy-real-docker.test.mjs   # 20/20
bash scripts/ci/run-deploy-real-docker.sh                    # identical toolchains rc 1 (correct); official compose v2.39.1 + Ubuntu override rc 0, 20/20 x2
```

## Cleanup proof

- `orb delete -f taskdesk-deploy-sec-review-2`. Afterwards `orb list` shows only apim-docker, elk-apm-server, elk-dock, elk.oracledb, jumphost, micro and testdocker (all stopped, all pre-existing). Neither `taskdesk-deploy-sec-review` nor `-2` is listed.
- Mac engine: context `orbstack`, engine ID `c152c629-9ae6-46d5-a27b-5dc1f779389b` (29.4.0) before and after. Only read-only `docker info`/`docker ps` were run against it. The `taskdesk-*` containers are still Up (19–43 h, healthy).
- Temp tarball and mutant copies removed. The worktree is unchanged (`git status` empty). Nothing was edited, committed or pushed.

## Residual risk and not checked

- **N-5:** only stub-tested. A real `install.sh` cannot reach line 205 yet, because every published release lacks the helper and is refused at line 190 (N-4).
- **Not run:** a GitHub Actions run of the new step on the real runner, including Node 24 and the runner's apt mirrors. The `DOCKER_CONFIG` precedence was proven in the VM with an official Compose plugin in `/usr/local/lib/docker/cli-plugins`, not with the runner's docker-ce layout.
- **Not run:** `upgrade` and `rollback` against real Docker. Their pre-start checks are proven by stubs and mutants only.
- **Still out of scope, as before:** a separate forwarding sidecar on the taskdesk network, and principals with access to the Docker socket.
<!-- END REPORT abbf154c303b60dc2 98d7de56 -->

