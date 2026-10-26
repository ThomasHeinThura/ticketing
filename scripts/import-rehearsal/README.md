# Import cutover rehearsal

Runs backup, a staged CSV import through the API, a delta re-import with a killed and resumed worker, a rerun that proves zero duplicates, reconciliation, and a rollback by restoring the backup. It records timings, steps and a rehearsal-defined freeze boundary in `cutover_rehearsal` and in `docs/report/audit/p6-cutover-rehearsal-<id>.json`.

It only runs against a restored copy. `guard.ts` refuses the live browser database (`taskdesk_browser_journey_1022_test`), port 62870, a non-loopback host, and any run without `--confirm-copy=<database name>`. It creates its own throwaway workspace and admin API key in that copy and never touches a source system.

```
TASKDESK_DATABASE_URL=<owner url of the copy> TASKDESK_AUTH_SECRET=... TASKDESK_ENCRYPTION_KEY=... \
  pnpm --filter @taskdesk/api exec tsx --tsconfig ../../scripts/import-rehearsal/tsconfig.json \
  ../../scripts/import-rehearsal/rehearse.ts --confirm-copy=<database name>
```

The copy must already be migrated (0199 adds `import_reconciliation` and `cutover_rehearsal`). Options: `--rows 48`, `--chunk 4`, `--kill-after-chunks 2`, `--report-dir`, `--work-dir`. Backups go to the work directory (default: system temp), not the repository.

Limits: the backup and restore steps mirror `scripts/backup.sh` and `scripts/restore.sh` against a native PostgreSQL (those scripts drive `docker compose`); production uses the real scripts. The killed worker's per-run lease is released by SQL, standing in for the one-hour lease expiry. There is no whole-run undo and no product freeze contract; recovery is restore from backup.
