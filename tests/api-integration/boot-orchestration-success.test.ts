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
    if (roleName && originalDatabaseUrl) {
      const owner = new Client({ connectionString: originalDatabaseUrl });
      await owner.connect();
      try {
        await owner
          .query(`DROP OWNED BY ${quoteIdentifier(roleName)}`)
          .catch(() => undefined);
        await owner.query(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`);
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

    // Step 2: the app role now exists. Drop the migration URL so this matches a real
    // serving process's environment, then call runApiBootTasks -- the FIRST thing in
    // this file, and therefore in this module graph, to ever call `getDatabase()`. It
    // caches the app pool as this role, for the rest of this call (and this file).
    delete process.env.TASKDESK_MIGRATION_DATABASE_URL;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await expect(runApiBootTasks()).resolves.toBeUndefined();
    } finally {
      logSpy.mockRestore();
    }

    const logged = logSpy.mock.calls.map((call) => String(call[0]));
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
