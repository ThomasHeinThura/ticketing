---
title: Install and deploy
---

# Install and deploy

TaskDesk ships as one container image. The Compose stack adds PostgreSQL and Valkey, and an optional SeaweedFS object store. `scripts/deploy.sh` starts it, checks the image signature and probes the API before it reports success.

## What you need

- Linux or macOS with Docker, the Compose plugin and `docker buildx`.
- `cosign`, to verify the signed image.
- Two DNS names that point at the server, for example `ticket.example.com` for staff and `portal.example.com` for customers. Add `files.example.com` if you use the S3 profile.
- A Traefik v3 proxy that already runs on the host. The production overlay `deploy/compose.prod.yml` joins an existing external Docker network named `proxy` and adds routing labels. It does not start a proxy. Your Traefik needs a `websecure` entrypoint, a certificate resolver named `letsencrypt`, and the middlewares in `deploy/traefik/dynamic/middlewares.yml` loaded through its file provider.

The application port is never published. Only the proxy network reaches it, and `scripts/deploy.sh` stops if it finds a published port.

## Quick start

From a release archive or a checkout of a release tag:

```sh
cp deploy/.env.example .env
```

Edit `.env` and set at least:

| Variable | Meaning |
| --- | --- |
| `DOMAIN` | Base domain. The agent host is `ticket.<DOMAIN>` and the portal host is `portal.<DOMAIN>` unless you override them. |
| `TASKDESK_AGENT_URL` | Public origin of the agent host, for example `https://ticket.example.com`. |
| `TASKDESK_PORTAL_URL` | Public origin of the portal host. It must differ from the agent origin. |
| `TASKDESK_AGENT_HOST`, `TASKDESK_PORTAL_HOST`, `TASKDESK_FILES_HOST` | Optional hostname overrides for Traefik routing. |

Then run:

```sh
scripts/deploy.sh production
```

The script generates any missing secret and never replaces one that already has a value. It then verifies the image signature, pulls the images, runs migrations, starts the application, probes `/api/public/health/ready` and prints the URLs. Add `--profile s3` to start the bundled SeaweedFS object store.

On a first start the log prints a one-time setup URL. Open it to create the first administrator. See [Administration](administration.md).

`install.sh` at the repository root wraps the same steps. It resolves a release, verifies the cosign bundles and checksum, unpacks into `~/taskdesk` (or `--dir`) and runs `scripts/deploy.sh`. Use `./install.sh --env production --domain example.com --dry-run` to see what it would do.

For Kubernetes, `charts/taskdesk` holds a Helm chart for the same image.

## Environment variables

The application reads five required variables and a few optional ones. Everything else, such as storage, email, identity providers and branding, is set in God Mode and stored in the database.

| Variable | Notes |
| --- | --- |
| `TASKDESK_ENCRYPTION_KEY` | 64 hex characters, from `openssl rand -hex 32`. It decrypts stored integration secrets. If you lose it, every configured integration must be set up again. Keep a copy outside the server. |
| `TASKDESK_AUTH_SECRET` | 64 hex characters. It signs sessions. Changing it signs everyone out. |
| `TASKDESK_AGENT_URL`, `TASKDESK_PORTAL_URL` | The two public origins. |
| `TASKDESK_DATABASE_URL` | Composed for you in the shipped stack from `TASKDESK_APP_DB_PASSWORD`. Set it only to use a database outside the stack. |
| `TASKDESK_ROLE` | `all` (default), `web` or `jobs`. Selects which parts run in the process. |
| `TASKDESK_VALKEY_URL` | Needed for more than one replica. The stack points it at the bundled Valkey. |
| `TASKDESK_TRUST_PROXY` | Number of trusted proxy hops, not a boolean. The production overlay sets `1`. |
| `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` | For headless installs: signing up with exactly this address creates the first administrator. |
| `TASKDESK_ENCRYPTION_KEY_PREVIOUS` | Set only while rotating the encryption key. |
| `TASKDESK_IMAGE_TAG`, `TASKDESK_IMAGE_DIGEST` | The image Compose pulls. `scripts/deploy.sh` maintains them. |
| `TASKDESK_HSTS_PRELOAD` | Empty for off, `1` for `includeSubDomains; preload`. Any other value is rejected. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `TASKDESK_APP_DB_PASSWORD` | Database container settings. The deploy script generates the passwords. |

`deploy/.env.example` documents each one.

## HTTPS and the proxy

Traefik terminates TLS with the `letsencrypt` resolver and applies the security-header, compression and rate-limit middlewares to both hosts. A wrong `DOMAIN` produces a 404 from Traefik, not an application error. If more than one proxy sits in front of TaskDesk, set `TASKDESK_TRUST_PROXY` to the real number of hops, because the client address is read from `X-Forwarded-For` at that hop.

## Verify the signed image

Each release image is signed with cosign from the project's release workflow. `scripts/deploy.sh` checks the signature on every `production`, `upgrade` and `rollback` run and refuses to pull an image that fails. To check by hand:

```sh
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity <workflow identity> \
  --annotations tag=<release tag> \
  <image>@sha256:<digest>
```

Copy the workflow identity from `COSIGN_IDENTITY` in `scripts/deploy.sh`, and the image name from `compose.yml`. The `--no-verify` flag skips the check for hosts that cannot reach the transparency log. It prints a warning, and it is refused for SIT and UAT targets.

## Upgrade

1. Take a backup (below) and note the running image digest.
2. Run `scripts/deploy.sh upgrade <tag-or-digest>`. Without an argument it re-resolves the tag in `.env`.
3. The script verifies the signature, pulls, runs migrations, replaces the container and probes the API. Expect a short outage, because a single-replica Compose stack replaces the container in place.

The script prints the exact rollback command when it finishes. To go back:

```sh
scripts/deploy.sh rollback sha256:<digest> <release tag>
```

A rollback changes the image only. It does not undo migrations. If the upgrade applied a destructive migration, restore the backup instead.

## Backup

```sh
scripts/backup-maintenance.sh --project-name taskdesk --backup <id>
```

The wrapper stops the stack's long-running services, checks that PostgreSQL has no clients, runs `scripts/backup.sh`, then restarts what was running. Plan for downtime. The backup is written to `backups/<id>`, or under `TASKDESK_BACKUP_ROOT` if you set it, and holds:

- a PostgreSQL custom-format dump, checked with `pg_restore --list`;
- an archive of the attachment data volume;
- a `SHA256SUMS` file.

Use `--output-dir <dir>` instead of `--backup` to choose a new target directory. The script refuses to run when attachments use S3 storage or an unknown driver, so back up object storage separately. It does not copy `.env`. Store `TASKDESK_ENCRYPTION_KEY` and `TASKDESK_AUTH_SECRET` somewhere safe, because a restore needs them.

## Restore

```sh
scripts/restore.sh --backup <id-or-dir> --mode production --confirm
```

The script verifies checksums first, stops the application, restores the database into a staging database and swaps it in, restores the attachment volume, then starts `migrate` and `taskdesk` and probes readiness. `--confirm` is required because the restore overwrites the live database and attachments. The default mode is `local`, so pass `--mode production` on a production host. `--project-name <name>` selects another Compose project.
