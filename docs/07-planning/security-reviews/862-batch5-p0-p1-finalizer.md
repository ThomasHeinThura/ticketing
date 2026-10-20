# Security & Phase Finalizer Review — PR #862 (`agy/batch5-p0-p1-e2e-and-orbstack-sit`)

**Reviewed head:** `297e7bb4dd744ce696d14ef9e95445da70d368db`
**Comparison base:** `a716e6ba18f3f1d00a985c94fd18075c3d6a2276` (and integrated Batches 0–5 `10ff9b063d78a1864c9d7e159d1a5cc14f2b67ae..297e7bb4dd744ce696d14ef9e95445da70d368db`)
**Reviewer:** Independent Critical, Security & Phase Finalizer Reviewer (`2e8ff9ca-0b25-46a3-80d0-e542fa6c85db`, `Gemini 4 Argon`)
**Date:** 2026-10-20

## Scope Inspected

- `scripts/backup.sh`
- `scripts/restore.sh`
- `apps/web/e2e/p0-p1-journeys.spec.ts`
- `.gitignore`
- `CHANGELOG.md`
- `docs/03-features/README.md`
- `docs/07-planning/active-mission.md`
- `docs/07-planning/integration-execution-queue.md`
- `docs/07-planning/status.md`

## Findings & Disposition

- **Backup & Restore Security (`scripts/backup.sh`, `scripts/restore.sh`):**
  - Enforces `umask 077` and `chmod 0600` on `postgres.dump`, `attachments.tar`, and `SHA256SUMS`; excludes `.env` and encryption/auth secrets from the backup archive; adds `backups/` to `.gitignore`.
  - Requires explicit `--confirm` on restore, pre-verifies `SHA256SUMS` and `pg_restore --list` before stopping `taskdesk`, restores PostgreSQL in a single transaction (`pg_restore --single-transaction --no-owner`), restores non-root `10001:10001` ownership on `taskdesk_taskdesk-data`, runs `migrate`, and verifies `/api/public/health/ready` HTTP 200.
- **Integrated Stage P0/P1 E2E Journeys (`apps/web/e2e/p0-p1-journeys.spec.ts`):**
  - Covers all 8 integrated Stage P0/P1 journeys across `/agent`, `/agent/inbox`, `/agent/my-work`, `/agent/search`, `/agent/projects/{key}`, `/agent/projects/{key}/work` (`list`, `table`, `board`, `?item=WLP-1`, CSV export, column controls), `/agent/projects/{key}/backlog`, `/agent/settings/profile/*`, `/agent/settings/*`, and `/agent/projects/{key}/settings/*` (`8/8 passed`).
- **Governance & Stopping Boundary (`active-mission.md`, `status.md`, `integration-execution-queue.md`):**
  - Transitions `Active mode` to **Hold** per the 2026-10-19 stop condition after completing Batches 0–5, local `docker compose up`, backup/restore verification, and disposable OrbStack VM (`taskdesk-sit-vm`) SIT verification.
  - Preserves truthful human-gate accounting (`🟡` for P1 features awaiting `H1`–`H6`).
- **Blocking findings:** 0
- **Non-blocking findings:** 0

## Verdict

**APPROVED** (`Gemini 4 Argon`)
