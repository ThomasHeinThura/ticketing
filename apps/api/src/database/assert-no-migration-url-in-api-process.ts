/**
 * Issue #296, S1 (Opus 5.5 review of PR #308, BLOCKING): the owner/migration
 * credential must never reach the long-running serving process's environment — not
 * "be present but unused", not "be present and then have its pool closed"; absent
 * entirely, because `/proc/self/environ` (and any process-level compromise — RCE, a
 * malicious dependency, an arbitrary file read) can read a live process's own
 * environment regardless of what the application code does with it afterwards.
 *
 * A correctly configured deployment never sets `TASKDESK_MIGRATION_DATABASE_URL` on
 * the API (or jobs) service/Deployment at all — only the separate, one-shot migrate
 * step (`TASKDESK_ROLE=migrate`, `runMigrationStep` in `apps/api/src/index.ts`)
 * receives it. This function is the structural backstop for when that wiring is
 * wrong: a copy-pasted compose overlay, a hand-edited Kubernetes manifest, an
 * operator running the image directly with the wrong env file. Called first thing in
 * `runApiBootTasks`, before any database connection is even attempted.
 *
 * Takes the value itself as a parameter, defaulting to the one named environment
 * read (`TASKDESK_MIGRATION_DATABASE_URL`) — not the whole environment object — for
 * two reasons: it makes this a pure, directly testable function with no env-var
 * mutation/restoration dance in its tests, and `pnpm check:env` (`docs/05-
 * operations/configuration-reference.md`'s enforcement) can only attribute a single
 * named read to its entry in that document; aliasing the whole environment object,
 * the way `packages/email/src/smtp-config.ts` does for its eight `SMTP_*` names, is
 * reported as unattributable and would need its own baseline entry for no real
 * benefit here — this function only ever needed the one name.
 */
export function assertNoMigrationUrlInApiProcess(
  migrationUrl: string | undefined = process.env
    .TASKDESK_MIGRATION_DATABASE_URL,
): void {
  if (migrationUrl) {
    throw new Error(
      "Refusing to start: TASKDESK_MIGRATION_DATABASE_URL is present in this " +
        "process's environment. That is the owner/migration credential, and it " +
        "must only ever reach the one-shot migrate step (TASKDESK_ROLE=migrate) " +
        "— never the long-running process that serves requests (issue #296, S1). " +
        "Check compose/Helm/your own deploy overlay: only the migrate service or " +
        "Job should set this variable; the API and jobs services/Deployments must " +
        "not. See docs/05-operations/configuration-reference.md.",
    );
  }
}
