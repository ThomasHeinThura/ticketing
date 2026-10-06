# One-line install

- **Status:** P0 bootstrap source and signed release-asset path implemented; public URL hosting and stable-tag promotion belong to P7.
- **Depends on:** [Deployment](deployment.md), which the installer wraps instead of replacing.

## Purpose

The bootstrap source is [`install.sh`](../../install.sh). The intended public command is:

```bash
curl -fsSL https://get.taskdesk.dev/install.sh | bash
```

A clean host needs only a shell, outbound HTTPS, and the platform tools described below. The
installer obtains a specific signed GitHub release archive and hands off to the same
`scripts/deploy.sh` used by the manual deployment path. It does not clone the source tree or
implement a second deployment mechanism.

P0 provides the bootstrapper source and release workflow assets. Serving `install.sh` and
`stable.txt` at `get.taskdesk.dev`, hardening that URL, and promoting the stable version
pointer are P7 hosting work. Until those static assets are published, use a reviewed local
copy of `install.sh` and pass `--version` for a published release.

## Install flow

1. **Check the host.** Linux x86-64 and arm64 are supported for production. macOS is supported
   for local evaluation. Other operating systems and architectures stop before downloads.
2. **Check Docker.** Docker Engine and the Compose plugin must be available. If either is
   missing, the installer asks before using the supported system package manager. `--yes`
   accepts this prompt and the later install-file prompt. It never pipes a remote script into
   a shell. The Docker daemon must be running and accessible to the invoking user.
3. **Choose a release.** `--version TAG` selects an exact semantic version tag. Without that
   flag, the installer reads the single-line `stable.txt` pointer over HTTPS. A static
   `stable.txt` is published as part of P7 hosting; it is not dynamically resolved by a
   service.
4. **Authenticate before extraction.** Downloaded release assets are the versioned archive,
   its SHA-256 file, and separate cosign bundles for both files. Cosign verification pins the
   GitHub Actions OIDC issuer and the exact `release.yml` workflow identity. The archive hash
   must match the signed checksum. Archive members must stay under the expected versioned
   root and may not contain unsafe paths or symbolic links. `--skip-verify` is an explicit
   opt-out; it prints a warning and still checks the archive SHA-256.
5. **Install deployment files.** Files are unpacked in a private temporary directory before
   the installer prompts to write them. The installer preserves an existing `.env`, generated
   secrets, certificates, database volumes, and deployment data. It updates the image tag
   and only changes hostname settings when the corresponding flags are supplied. A new `.env`
   is created from `deploy/.env.example` with mode `0600`.
6. **Delegate deployment.** The installer runs `scripts/deploy.sh` in the selected mode. That
   script generates only missing secrets, verifies the image signature, waits for health,
   runs migrations through its one-shot role, probes the API, and prints the first-run setup
   URL and token.

The install is repeatable. Running it again with a new `--version` updates deployment files
and image selection without replacing existing secret values or data.

## Production preflight

`--env production` requires `--domain` or an existing `DOMAIN` in the install directory's
`.env`. `--agent-host` and `--portal-host` override the derived `ticket.<domain>` and
`portal.<domain>` names. Compose routes and application public URLs use the same host values.
`--files-host` is checked only when supplied; a third hostname is needed only when this host
also serves an operator-owned S3 endpoint. Use `--profile s3` to start the bundled SeaweedFS
profile.

Before writing deployment files, the installer checks that the agent and portal names (and
the files name when requested) resolve, and that TCP port 5173 is free. DNS resolution alone
cannot establish which public host owns an address; the operator must ensure the records point
to this deployment host before proceeding. The preflight prints the record names that need
attention when resolution fails. Production does not publish the application port.

For local installs, host overrides are included in the generated local certificate SANs.
The installer leaves the local mode's application port and certificate behavior to
`scripts/deploy.sh`.

## Flags

| Flag | Effect |
| --- | --- |
| `--env local\|production` | Selects deployment mode; default is `local` |
| `--domain DOMAIN` | Sets the Compose domain and derives agent/portal hostnames |
| `--agent-host HOST` | Overrides the agent route host and public URL |
| `--portal-host HOST` | Overrides the portal route host and public URL |
| `--files-host HOST` | Adds the files hostname to the production DNS check |
| `--profile s3` | Starts the optional S3 profile; configure its credentials in God Mode |
| `--version TAG` | Installs the exact release tag instead of the stable pointer |
| `--dir PATH` | Install directory; default is `~/taskdesk` |
| `--yes` | Skips the install-file and Docker-install prompts |
| `--dry-run` | Prints the release and deployment plan without downloading or writing files |
| `--skip-verify` | Explicitly skips cosign verification, warns, and retains the SHA-256 check |

Preview a pinned install without changing the host:

```bash
bash install.sh --version 2.22.0 --dry-run
```

## Trust model

The signed archive and checksum file use keyless cosign signing from the repository's
`release.yml` workflow. The installer verifies both bundles with the same issuer and workflow
identity used by `scripts/deploy.sh`; a valid checksum from the same download site alone is
not treated as authentication. A verification failure stops before extraction or writes to the
install directory. There is no automatic fallback from a failed signature check.

The source installer is small and reviewable. Its SHA-256 is:

```text
8e4025bdd9bb30c9eac6a4f3de1de3dac7a634b3e74d1aab58533b37021bd5b2
```

You can download and inspect the script before running it. The installer requests elevation
only through an explicit package-manager prompt when Docker is missing; the rest of the flow
runs as the invoking user.

## Offline / air-gapped install

Download the archive, checksum, and their cosign bundles on a connected machine. Verify both
signatures with the repository's exact workflow identity, verify the checksum, then transfer
and extract the archive:

```bash
version=v2.22.0
archive="taskdesk-${version}.tar.gz"
base="https://github.com/ThomasHeinThura/ticketing/releases/download/${version}"
curl -fsSLo "$archive" "$base/$archive"
curl -fsSLo "$archive.sha256" "$base/$archive.sha256"
curl -fsSLo "$archive.sigstore.json" "$base/$archive.sigstore.json"
curl -fsSLo "$archive.sha256.sigstore.json" "$base/$archive.sha256.sigstore.json"
identity='https://github.com/ThomasHeinThura/ticketing/.github/workflows/release.yml@refs/heads/main'
cosign verify-blob --bundle "$archive.sigstore.json" --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity "$identity" "$archive"
cosign verify-blob --bundle "$archive.sha256.sigstore.json" --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity "$identity" "$archive.sha256"
sha256sum -c "$archive.sha256"
```

After transferring all four verified files, run the same installer with the pinned version or
extract the archive under its versioned directory and follow [Deployment](deployment.md).
The signed offline archive contains deployment assets and `scripts/deploy.sh`; it does not
contain application source or secrets.

## Hosting boundary

P7 publishes two static files at `get.taskdesk.dev`: `install.sh` and `stable.txt`. The latter
contains one stable release tag and is updated only by the P7 promotion process. This feature
does not create or operate that host, publish a customer release, or promote a version.

## Related

- [Deployment](deployment.md) · [Environments](environments.md)
- [Configuration reference](configuration-reference.md) · [Traefik and domains](traefik-and-domains.md)
