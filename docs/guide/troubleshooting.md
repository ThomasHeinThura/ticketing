---
title: Troubleshooting
---

# Troubleshooting

Start with the logs and the readiness probe:

```sh
docker compose logs --tail 100 taskdesk
docker compose exec taskdesk node -e "fetch('http://127.0.0.1:5173/api/public/health/ready').then(r => console.log(r.status))"
```

The image has no `curl`, so the probe uses Node. A `200` means the application is ready.

## The container exits at start

The entrypoint refuses to start when `TASKDESK_DATABASE_URL`, `TASKDESK_ENCRYPTION_KEY`, `TASKDESK_AUTH_SECRET`, `TASKDESK_AGENT_URL` or `TASKDESK_PORTAL_URL` is missing, and when either secret is shorter than 32 characters. The message names the variable. Run `scripts/deploy.sh`, which generates missing secrets, or set them in `.env`.

The application also refuses to run if its database role is privileged, or if `TASKDESK_MIGRATION_DATABASE_URL` is set in its process. Only the one-shot `migrate` service should hold the migration URL, so use the URLs the shipped Compose files build.

## Traefik returns 404

The router rule is built from `DOMAIN`, or from `TASKDESK_AGENT_HOST` and `TASKDESK_PORTAL_HOST`. A wrong value produces a Traefik 404 and never reaches TaskDesk. Check the values in `.env`, the DNS records, and that Traefik runs on the external `proxy` network with a `letsencrypt` resolver.

## deploy.sh stops early

- No `cosign`: install it, or pass `--no-verify` knowing the image is unchecked.
- Signature verification failed: nothing was pulled. Check the tag and digest.
- Application port published: an overlay added a `ports:` entry for the `taskdesk` service. Remove it.
- API never became ready: the script prints the last log lines. Read them first.

## No setup URL in the log

The setup token appears only while no administrator exists, lasts an hour and changes on every restart. Restart the `taskdesk` container and read the log again. For a headless install, set `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` and sign up with that address.

## Portal sign-in fails

The portal is recognised by its exact host and port. If you serve it on a non-default port, `TASKDESK_PORTAL_URL` must include the port. Staff and customers use separate cookies, so signing in on one host never signs you in on the other.

## Everyone was signed out

Changing `TASKDESK_AUTH_SECRET` invalidates all sessions. A rollback to an older image can also reject sessions from the newer one. Sign in again.

## Integrations stopped working after a restore

The encryption key must match the one in use when the secrets were saved. Restore the original `TASKDESK_ENCRYPTION_KEY`. If it is lost, re-enter the secrets for each integration in God Mode.

## A feature is missing from the menu

Most features start off. Ask an instance administrator to turn on the flag in God Mode, Features, and check for a workspace or project override.

## Rollback did not fix an upgrade problem

A rollback swaps the image and does not undo migrations. Restore the backup you took before the upgrade with `scripts/restore.sh`.
