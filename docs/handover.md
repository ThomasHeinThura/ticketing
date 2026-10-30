# Handover — 30 October 2026 (evening)

Read [AGENTS.md](../AGENTS.md), [status](status.md), [roadmap](roadmap.md) and [testing](testing.md).

## Who works on version 2

From 30 Oct Thomas moved Codex to version 1. **Claude (Opus) is the only version 2 implementer** until UAT. Nobody else edits this repository, its worktrees or the local SIT stack without Thomas.

## Goal

**UAT launch on Friday 6 November 2026.** UAT runs on the Technexus hosts. The plan, day by day, is in the [roadmap](roadmap.md#uat-week-plan-30-oct--6-nov-2026).

## Thomas's decisions (30 Oct)

- Technexus becomes UAT. No new infrastructure this week.
- Standing approval: merge to `main` when every non-G11 required check is green and the change is reviewed; deploy to Technexus after the local SIT smoke passes. Once UAT users are on Technexus, each deploy asks Thomas first.
- Independent review of high-risk changes (auth, permissions, God Mode sign-in, security, migrations, deletion): a fresh-context Opus reviewer with a neutral packet. This is a UAT-week exception to "a model never reviews its own work".
- Settings split (L-03) ships before UAT. The Pages/KB editor (L-04) ships a first slice before UAT; the rest follows as UAT updates.
- Local SIT moved from OrbStack to Docker Desktop as a **fresh** install with new test accounts. The old OrbStack SIT data is left untouched.

## Release chain (every merge)

1. `main` merge → `release.yml` publishes a signed image. Verify it with `gh attestation verify oci://ghcr.io/thomasheinthura/taskdesk@<digest> --owner ThomasHeinThura --signer-workflow ThomasHeinThura/ticketing/.github/workflows/release.yml`.
2. Local SIT (Docker Desktop): set `TASKDESK_IMAGE_TAG`/`TASKDESK_IMAGE_DIGEST` in the worktree `.env`, run `scripts/deploy.sh local`, then the API smoke.
3. Technexus: back up the database (`pg_dump -Fc`, verified with `pg_restore --list`), the data volume and `.env`, and record row and migration counts. Then set the tag and digest in `.env` and run the compose `up -d --wait` recorded in the host README. Verify the migrate exit code, unchanged counts, and both public hosts on `/` and `/api/public/health/ready`. The host has no `deploy.sh` and no cosign; the signature is verified on the laptop in step 1.
4. A failure at any step stops the release. Roll back by restoring the previous `.env` (image only when the migration count is unchanged; otherwise also restore the database).

## State now

- `main` 308b45ff5, signed digest `sha256:affc6cd4e520…`, is deployed on **local SIT (Docker Desktop)** and **Technexus**. Technexus migrations were 212 before and after, with row counts unchanged and both hosts returning 200. The backup is `backups/pre-308b45f-20261030T113408Z` on the host.
- [#993](https://github.com/ThomasHeinThura/ticketing/pull/993) fixes `deploy.sh local` on a fresh install (probe without wget, seed credentials file, intake and portal flags for the SIT seed).
- Codex's unfinished library-Button change is uncommitted in `.taskdesk-ui-create-label-button-20261030` (37 focused tests pass; full suite, browser and CI not run).
- Open drafts #918, #919 and #920 conflict with `main`; they wait until after UAT unless needed.

## Never

- Touch the live native PostgreSQL `taskdesk_browser_journey_1022_test` on 62870 (currently not running).
- Weaken, skip or exempt a check, or change budgets, thresholds or calibration. G11 stays report-only.
- Write hosts, keys, credentials, cookies or database URLs into docs, logs or PRs.
- Remove a container except by exact id; never prune.
