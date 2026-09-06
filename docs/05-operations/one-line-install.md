# One-line install

- **Status:** ⬜ Planned — P0, alongside `scripts/deploy.sh`
- **Depends on:** [Deployment](deployment.md), which this wraps rather than replaces

## Purpose

```bash
curl -fsSL https://get.taskdesk.dev | bash
```

The script is `install.sh` — the same name it is called by in
[traefik-and-domains.md](traefik-and-domains.md) and the one you get from
`curl -o install.sh`. One command, on a clean machine with nothing but a shell and outbound
HTTPS, ends with a running instance and a printed sign-in URL. This is the installer a small customer runs
without ever cloning a repository, and it is also what a bigger customer's automation calls
identically — the same command either way.

**It is a bootstrapper, not a second implementation.** It fetches the same release
artefact and runs the same `scripts/deploy.sh` that [Deployment](deployment.md) already
documents — including its idempotency and its final API probe. There is exactly one
deployment mechanism; this is a shorter path onto it, not a parallel one. A user who never
runs the one-liner and instead follows the manual `git clone` steps in
[Deployment](deployment.md) ends up with an identical result.

## What it does

1. **Detects** OS and architecture (Linux x86-64 / arm64; macOS for local evaluation only —
   production targets Linux). Refuses unsupported combinations with a clear message rather
   than failing halfway through.
2. **Checks for Docker** and the Compose plugin. If absent, offers to install them via the
   distribution's own package manager or Docker's official install script, and **asks
   before doing anything that requires root** unless `--yes` was passed.
3. **Downloads a pinned release archive** — a specific tagged version's tarball from the
   project's release artefacts, verified against a published SHA-256 checksum — into an
   install directory (`~/taskdesk` by default, `--dir` to override). It downloads a
   released *artefact*, not `git clone`, so the machine does not need `git` and the version
   installed is exactly the one named, never whatever `main` happens to contain that day.
4. **Writes `.env`** using the same secret-generation logic `scripts/deploy.sh` already has
   — generated once, never regenerated over an existing value.
5. **Runs `scripts/deploy.sh`** in the requested mode (`local` by default; `--env
   production` for a real deployment with a real domain and TLS). Every step from
   [Deployment](deployment.md)'s "First run" — start dependencies, wait for health, apply
   migrations, create the bootstrap administrator, probe the API — happens exactly as
   documented, because it is the same script.
6. **Prints the result**: the one-time **setup URL and its token**, read from the container
   log and printed as the last thing on screen, at which the first administrator is created;
   and a reminder that everything else — storage, mail, identity providers, branding — is
   configured in God Mode, not in a file. A fresh install works with **no storage
   configuration at all**: `storage.filesystem` is the default until an administrator
   chooses otherwise, so there is no bucket, no credential and no third hostname to arrange
   first. The token is short-lived; if it has expired by the time you get to it, see the
   runbook's **First run** section.

### Production pre-flight

`--env production` runs two checks before it touches anything, because both failures are
cheap to catch here and expensive to diagnose later:

- **DNS.** The hostnames in play must already resolve to this host — ACME HTTP-01 needs them
  before the first `up`. `ticket.` and `portal.` always; `files.` **only when `--files-host`
  is given**, because a `storage.filesystem` install has no third hostname at all
  ([deployment.md](deployment.md)). The script prints the exact records to create and stops.
- **Port 5173 must not already be bound.** Production publishes no application port — that
  is what makes `TASKDESK_TRUST_PROXY=1` sound ([traefik-and-domains.md](traefik-and-domains.md))
  — so something already listening on 5173 means another stack is running, or a local-mode
  install is still up on this host. The check does **not** run for `--env local`, where
  publishing 5173 is exactly what the local overlay is for.

## Flags

| Flag | Effect |
| --- | --- |
| `--env local\|production` | Which Compose overlay to bring up. Default `local` |
| `--domain <domain>` | Derives `ticket.<domain>` and `portal.<domain>` for `production`; `--agent-host` / `--portal-host` override either. `--files-host` adds the third hostname, and is only wanted when this host also serves an operator-owned S3 endpoint. The DNS pre-flight above checks exactly the hostnames in play |
| `--version <tag>` | Install a specific release instead of the latest stable one |
| `--dir <path>` | Install directory. Default `~/taskdesk` |
| `--yes` | Do not prompt before installing Docker or writing files |
| `--dry-run` | Print every step it would take without doing any of them |

`curl ... | bash -s -- --dry-run` is the recommended first run for anyone who wants to see
what the script does before it does it — see **Trust model** below.

## Trust model

Piping a downloaded script into a shell is a real trust decision, and the installer is
built to make that decision an informed one rather than to paper over it.

- **Served only over HTTPS**, from a domain under our control, with HSTS. There is no HTTP
  fallback.
- **The installer script itself is small, reviewable, and does no work beyond the steps
  listed above.** All actual logic — secret generation, health waiting, migration,
  probing — lives in the versioned `scripts/deploy.sh` inside the release artefact, which
  anyone can read before running by downloading the same release from the repository.
- **The release archive is signed, not merely checksummed.** A checksum fetched from the
  same origin over the same connection only defends against corruption — not against the
  compromise of `get.taskdesk.dev`, which is the threat a `curl | bash` reader is actually
  worried about. So CI signs the release archive and its checksum file with **cosign**
  (keyless, the same identity that signs the container image — [ci-cd.md](../04-engineering/ci-cd.md)),
  and the installer verifies the signature against the published identity before
  extracting anything. There is no silent fallback: `--skip-verify` exists, prints a loud
  warning, and is the operator's explicit choice. A verification failure aborts with no
  partial state left behind. The installer's own SHA-256 is published in the docs so
  `curl -o install.sh && sha256sum -c` is always possible.
- **`--dry-run` prints the exact commands** the installer would execute, so a security-
  conscious operator can review the plan before committing to it — and can equally well
  just `curl -fsSL https://get.taskdesk.dev -o install.sh`, read it, and run it locally,
  which is always an option and is documented as one, not treated as an edge case.
- **Root is requested only for the Docker installation step**, and only after an explicit
  prompt (or `--yes`). Everything after that runs as the invoking user, inside containers.
- **Idempotent**, inherited directly from `scripts/deploy.sh`: running the one-liner again
  on an existing install does not regenerate secrets or duplicate data. Re-running it is
  the documented way to pick up a version bump via `--version`.

## Offline / air-gapped

A network that cannot reach `get.taskdesk.dev` at deploy time is expected, not exotic — see
[Deploy targets](deployment.md#deploy-targets)'s single-node profile. The same release
archive the installer downloads is published as a plain, checksummed file; the documented
alternative is:

```bash
# on a machine with internet access
curl -fsSLo taskdesk-v2.x.x.tar.gz https://github.com/<org>/taskdesk/releases/download/v2.x.x/taskdesk-v2.x.x.tar.gz
sha256sum -c taskdesk-v2.x.x.tar.gz.sha256

# transferred to the air-gapped host
tar xzf taskdesk-v2.x.x.tar.gz && cd taskdesk-v2.x.x
scripts/deploy.sh local     # or production
```

Which is exactly [Deployment](deployment.md)'s manual path, one step shorter because there
is no `git clone` — a release archive, not a repository, is what ships.

## Hosting

`get.taskdesk.dev` serves two static files from the same infrastructure as the
documentation site (`apps/site`): the installer script, and `stable.txt` — a one-line file
containing the current stable version tag, rewritten by the release pipeline only when a
digest is promoted ([release-plan.md](../07-planning/release-plan.md)). The script reads
`stable.txt` and installs that tag; `--version` overrides it. Nothing is resolved
dynamically and nothing about the installer requires application code to be running
anywhere.

## Related

- [Deployment](deployment.md) · [Environments](environments.md)
- [Configuration reference](configuration-reference.md) · [Traefik and domains](traefik-and-domains.md)
