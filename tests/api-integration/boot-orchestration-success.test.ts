/**
 * Second ordinary delta review of PR #308, APPROVE WITH NOTES — the fourth case of
 * `boot-orchestration.test.ts`: `runApiBootTasks` SUCCEEDING as a genuine, non-privileged
 * application role.
 *
 * Kept in its OWN file, deliberately, not folded into `boot-orchestration.test.ts`'s
 * shared `describe` block: `apps/api/src/database`'s app connection (`getDatabase()`) is
 * a lazily-created, module-level singleton, cached on first use for the rest of that
 * module graph's life. `boot-orchestration.test.ts`'s `resetTestDatabase()` (needed there,
 * to TRUNCATE between its own tests) is the first thing to touch it in that file, which
 * permanently caches it as the harness's OWNER connection for every test in that file --
 * exactly what its other three cases want, and exactly what this one must NOT have.
 * Vitest isolates each test FILE's module graph by default, so this file gets its own
 * fresh, never-yet-created `getDatabase()` singleton -- and the sequence below is
 * arranged so the FIRST thing that ever touches it is `runApiBootTasks()` itself, already
 * pointed at the application role.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runApiBootTasks, runMigrationStep } from "../../apps/api/src/index";
import { shutdownScheduler } from "../../apps/api/src/scheduler";
import { shutdownWebSocketAdapter } from "../../apps/api/src/ws";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function randomHex64(): string {
  return randomBytes(32).toString("hex");
}

function randomSuffix(): string {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}

describe("boot orchestration (issue #296, S1) — runApiBootTasks succeeds as the app role", () => {
  let roleName: string | undefined;
  let originalDatabaseUrl: string | undefined;
  let originalMigrationUrl: string | undefined;
  let seededWorkspaceId: string | undefined;
  let seededOrganisationId: string | undefined;

  afterEach(async () => {
    shutdownScheduler();
    await shutdownWebSocketAdapter();

    if (originalDatabaseUrl === undefined) {
      delete process.env.TASKDESK_DATABASE_URL;
    } else {
      process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
    }
    if (originalMigrationUrl === undefined) {
      delete process.env.TASKDESK_MIGRATION_DATABASE_URL;
    } else {
      process.env.TASKDESK_MIGRATION_DATABASE_URL = originalMigrationUrl;
    }

    // Cleanup uses a RAW connection to the known owner URL -- never the cached `db`
    // singleton, which by now is the application role and lacks DROP ROLE privilege.
    if (originalDatabaseUrl) {
      const owner = new Client({ connectionString: originalDatabaseUrl });
      await owner.connect();
      try {
        // Workspace delete cascades to whatever the backfill seeded under it
        // (work_item_type/state_template); the organisation has nothing else
        // referencing it once that is gone.
        if (seededWorkspaceId) {
          await owner
            .query("DELETE FROM workspace WHERE id = $1", [seededWorkspaceId])
            .catch(() => undefined);
        }
        if (seededOrganisationId) {
          await owner
            .query("DELETE FROM organisation WHERE id = $1", [
              seededOrganisationId,
            ])
            .catch(() => undefined);
        }
        if (roleName) {
          await owner
            .query(`DROP OWNED BY ${quoteIdentifier(roleName)}`)
            .catch(() => undefined);
          await owner.query(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`);
        }
      } finally {
        await owner.end();
      }
    }
  });

  it("succeeds as a genuine application role, logs the policy count, and runs the app-role boot steps (workspace/project default-seed backfill included)", async () => {
    originalDatabaseUrl = process.env.TASKDESK_DATABASE_URL;
    originalMigrationUrl = process.env.TASKDESK_MIGRATION_DATABASE_URL;
    if (!originalDatabaseUrl) {
      throw new Error("TASKDESK_DATABASE_URL must be set for this test");
    }

    roleName = `taskdesk_app_bootsuccess_${randomSuffix()}`;
    const password = randomHex64();

    // Step 1: create the role and migrate, via runMigrationStep's OWN separate
    // migration-pool singleton (apps/api/src/database's `getMigrationDatabase()`) --
    // this never touches `getDatabase()` (the app pool), so it cannot pre-empt the
    // caching this test depends on.
    process.env.TASKDESK_MIGRATION_DATABASE_URL = originalDatabaseUrl;
    const appUrl = new URL(originalDatabaseUrl);
    appUrl.username = roleName;
    appUrl.password = password;
    process.env.TASKDESK_DATABASE_URL = appUrl.toString();
    await runMigrationStep();

    // Seed one "legacy" workspace -- created directly, the way every workspace in the
    // database was created before #309/#313 taught create-workspace.ts to seed its
    // defaults in the same transaction -- so #321's backfill (folded into
    // runApiBootTasks right after seedInternalOrganisationAndStaffPersons) has real work
    // to do and logs its summary line. A RAW pg `Client` against the owner URL does the
    // insert, deliberately, not the drizzle `db`/`getDatabase()` singleton this test is
    // built around never touching before runApiBootTasks does.
    //
    // `organisation.is_internal` has its own partial unique index (at most one row may
    // carry it), and this database is shared with other test files against the same
    // Postgres instance -- an earlier file's own boot may already have created the one
    // internal organisation. So: reuse it if it exists, insert a fresh one (own cleanup
    // tracked) only if it does not. Either way, `ensureInternalOrganisation` (called
    // from inside runApiBootTasks, before the backfill) is a get-or-create keyed on
    // `is_internal`, so it adopts whichever row is here rather than racing a second one.
    const legacyWorkspaceId = `ws_${randomSuffix()}`;
    seededWorkspaceId = legacyWorkspaceId;
    const seedClient = new Client({ connectionString: originalDatabaseUrl });
    await seedClient.connect();
    try {
      const { rows: existingInternal } = await seedClient.query(
        "SELECT id FROM organisation WHERE is_internal = true LIMIT 1",
      );
      let internalOrganisationId: string;
      if (existingInternal.length > 0) {
        internalOrganisationId = existingInternal[0].id as string;
      } else {
        internalOrganisationId = `org_${randomSuffix()}`;
        seededOrganisationId = internalOrganisationId;
        await seedClient.query(
          "INSERT INTO organisation (id, key, name, is_internal) VALUES ($1, $2, 'Internal', true)",
          [internalOrganisationId, `internal-${randomSuffix()}`],
        );
      }
      await seedClient.query(
        "INSERT INTO workspace (id, organisation_id, name, slug, created_at) VALUES ($1, $2, 'Legacy workspace', $3, now())",
        [legacyWorkspaceId, internalOrganisationId, `legacy-${randomSuffix()}`],
      );
    } finally {
      await seedClient.end();
    }

    // Step 2: the app role now exists. Drop the migration URL so this matches a real
    // serving process's environment, then call runApiBootTasks -- the FIRST thing in
    // this file, and therefore in this module graph, to ever call `getDatabase()`. It
    // caches the app pool as this role, for the rest of this call (and this file).
    delete process.env.TASKDESK_MIGRATION_DATABASE_URL;

    // `mockRestore()` both restores the original implementation AND clears
    // `.mock.calls` -- read the captured calls BEFORE restoring, not after.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    let logged: string[];
    try {
      await expect(runApiBootTasks()).resolves.toBeUndefined();
      logged = logSpy.mock.calls.map((call) => String(call[0]));
    } finally {
      logSpy.mockRestore();
    }

    expect(logged.some((line) => /🔐 \d+ policies loaded/.test(line))).toBe(
      true,
    );

    // #321's workspace/project default-seed backfill runs inside runApiBootTasks, on
    // the app connection, right after seedInternalOrganisationAndStaffPersons -- never
    // in runMigrationStep, which has no need for it and runs as the owner. It logs its
    // own progress; asserting on that line (rather than re-deriving its exact wording
    // here, which would just duplicate backfill-workspace-project-defaults.test.ts's
    // own coverage of what it does) is what proves it actually ran as part of THIS
    // boot sequence, under the app role, not merely that it exists somewhere.
    expect(logged.some((line) => /backfill/i.test(line))).toBe(true);
  });
});
