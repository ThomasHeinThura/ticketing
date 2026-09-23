/**
 * Issue #296 -- the API used to connect to Postgres as the table-owning role, which the
 * official postgres image makes a superuser at cluster init. A compromised API process
 * therefore inherited full superuser rights over the database, including the ability to
 * disable `audit_log`'s append-only triggers (found by PR #291's Opus review).
 *
 * `ensureApplicationRole` (`apps/api/src/database/ensure-application-role.ts`) and
 * `assertApplicationRoleIsNotPrivileged`
 * (`apps/api/src/database/assert-application-role-is-not-privileged.ts`) are the fix.
 * This suite exercises both against real Postgres -- every assertion below is either a
 * database-level privilege check or a real permission-denied error, and a reverted fix
 * (see the mutation check this PR's description records) makes it fail red.
 *
 * A unique, per-run role name (`taskdesk_app_<random>`) is used throughout, never a fixed
 * name, so this can never collide with a role something else on the shared `td-lane-pg`
 * container depends on -- and the role is fully torn down (`DROP OWNED BY` then
 * `DROP ROLE`) in `afterAll`, whether the test body passed or failed.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db, { type DatabaseInstance, schema } from "../../apps/api/src/database";
import { assertApplicationRoleIsNotPrivileged } from "../../apps/api/src/database/assert-application-role-is-not-privileged";
import { ensureApplicationRole } from "../../apps/api/src/database/ensure-application-role";
import { ensureInternalOrganisation } from "../../apps/api/src/utils/seed-internal-organisation";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function randomHex64(): string {
  return randomBytes(32).toString("hex");
}

/** `drizzle-orm` wraps the real Postgres error; the actual driver error (with Postgres's
 * own permission/ownership message) is one level down, on `.cause`. Same helper
 * `audit-log.test.ts` uses for the same reason. */
function deepestMessage(error: unknown): string {
  let current: unknown = error;
  let message = "";
  while (current instanceof Error) {
    message = current.message;
    current = current.cause;
  }
  return message;
}

async function expectPermissionDenied(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow(/permission denied|must be owner of/i);
}

// ── Minimal fixture builders -- same pattern as work-item-parent-cycle-guard.test.ts ──

async function makeWorkspace() {
  const organisation = await ensureInternalOrganisation();
  return requireRow(
    await db
      .insert(schema.workspaceTable)
      .values({
        name: "DB Role Split Test Workspace",
        slug: `db-role-ws-${randomUUID()}`,
        createdAt: new Date(),
        organisationId: organisation.id,
      })
      .returning(),
    "makeWorkspace",
  );
}

async function makeProject(workspaceId: string) {
  return requireRow(
    await db
      .insert(schema.projectTable)
      .values({
        workspaceId,
        slug: `db-role-project-${randomUUID()}`,
        name: "DB Role Split Test Project",
      })
      .returning(),
    "makeProject",
  );
}

async function makeWorkItemType(workspaceId: string) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItemType",
  );
}

async function makeDefaultState(workspaceId: string, projectId: string) {
  const now = new Date();
  const stateTemplate = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state_template",
  );
  return requireRow(
    await db
      .insert(schema.stateTable)
      .values({
        projectId,
        stateTemplateId: stateTemplate.id,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeDefaultState: state",
  );
}

async function makeWorkItem(
  workspaceId: string,
  projectId: string,
  projectSlug: string,
  typeId: string,
  stateId: string,
  number: number,
) {
  const now = new Date();
  return requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        projectId,
        workspaceId,
        typeId,
        stateId,
        number,
        key: `${projectSlug}-${number}`,
        title: "DB role split test work item",
        createdAt: now,
        updatedAt: now,
      })
      .returning(),
    "makeWorkItem",
  );
}

describe("issue #296 -- application role is non-superuser, owns nothing, DML-restricted", () => {
  const roleName = `taskdesk_app_${randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const rolePassword = randomHex64();

  let appConnectionString: string;
  let appPool: Pool | undefined;
  let appDb: DatabaseInstance;
  let appClient: Client | undefined;

  let fixture: {
    workspaceId: string;
    projectId: string;
    projectSlug: string;
    typeId: string;
    stateId: string;
    workItemId: string;
    auditLogId: string;
    activityId: string;
  };

  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    await resetTestDatabase();

    originalDatabaseUrl = process.env.TASKDESK_DATABASE_URL;
    if (!originalDatabaseUrl) {
      throw new Error("TASKDESK_DATABASE_URL must be set for this test");
    }

    // `ensureApplicationRole` derives the application role's name and password from
    // `resolveDatabaseConfig()`, i.e. from `TASKDESK_DATABASE_URL` -- exactly like
    // production boot does. Pointing that variable at this run's unique role/password,
    // for the same host/port/database the rest of the suite already uses, is what makes
    // `ensureApplicationRole(db)` (below, `db` is the OWNER/superuser connection in this
    // test harness -- see `.env.test.example`) create THIS run's role rather than
    // touching a shared one.
    const url = new URL(originalDatabaseUrl);
    url.username = roleName;
    url.password = rolePassword;
    appConnectionString = url.toString();
    process.env.TASKDESK_DATABASE_URL = appConnectionString;

    try {
      await ensureApplicationRole(db);
    } finally {
      process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
    }

    appPool = new Pool({ connectionString: appConnectionString });
    appDb = drizzle(appPool, { schema });
    appClient = new Client({ connectionString: appConnectionString });
    await appClient.connect();

    // Fixtures the app-role assertions below need: a real work item (for the ordinary
    // table checks) and one audit_log/activity row (inserted by the app role itself,
    // proving INSERT is genuinely granted, not just assumed).
    const workspace = await makeWorkspace();
    const project = await makeProject(workspace.id);
    const type = await makeWorkItemType(workspace.id);
    const state = await makeDefaultState(workspace.id, project.id);
    const workItem = await makeWorkItem(
      workspace.id,
      project.id,
      project.slug,
      type.id,
      state.id,
      1,
    );

    const auditLogId = `audit-${randomUUID()}`;
    await appClient.query(
      `INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, prev_hash, row_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        auditLogId,
        "person",
        "test.probe",
        "work_item",
        workItem.id,
        randomHex64(),
        randomHex64(),
      ],
    );

    const activityId = `activity-${randomUUID()}`;
    await appClient.query(
      `INSERT INTO activity (id, workspace_id, work_item_id, actor_type, verb)
       VALUES ($1, $2, $3, $4, $5)`,
      [activityId, workspace.id, workItem.id, "person", "created"],
    );

    fixture = {
      workspaceId: workspace.id,
      projectId: project.id,
      projectSlug: project.slug,
      typeId: type.id,
      stateId: state.id,
      workItemId: workItem.id,
      auditLogId,
      activityId,
    };
  });

  afterAll(async () => {
    await appClient?.end();
    await appPool?.end();

    // Reassign/drop everything the role owns or has been granted in this database
    // before dropping it -- `DROP ROLE` refuses otherwise. The role owns nothing by
    // design (that is the whole point of #296), but it does hold GRANTs (table DML,
    // sequence USAGE, the ALTER DEFAULT PRIVILEGES entry), which `DROP OWNED BY` clears
    // in this database same as ownership would be.
    await db.execute(sql.raw(`DROP OWNED BY ${quoteIdentifier(roleName)}`));
    await db.execute(
      sql.raw(`DROP ROLE IF EXISTS ${quoteIdentifier(roleName)}`),
    );

    if (originalDatabaseUrl) {
      process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("is not a Postgres superuser", async () => {
    const result = await appClient?.query(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    expect(result?.rows[0]?.rolsuper).toBe(false);
  });

  it("owns zero tables", async () => {
    const result = await appClient?.query(
      "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user",
    );
    expect(result?.rows[0]?.count).toBe(0);
  });

  it("can INSERT into audit_log and activity (already proven in beforeAll; re-verified for a second row)", async () => {
    await expect(
      appClient?.query(
        `INSERT INTO audit_log (id, actor_type, action, entity_type, entity_id, prev_hash, row_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          `audit-${randomUUID()}`,
          "person",
          "test.probe.second",
          "work_item",
          fixture.workItemId,
          randomHex64(),
          randomHex64(),
        ],
      ),
    ).resolves.toBeDefined();

    await expect(
      appClient?.query(
        `INSERT INTO activity (id, workspace_id, work_item_id, actor_type, verb)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          `activity-${randomUUID()}`,
          fixture.workspaceId,
          fixture.workItemId,
          "person",
          "updated",
        ],
      ),
    ).resolves.toBeDefined();
  });

  describe.each([
    ["audit_log", () => "auditLogId" as const],
    ["activity", () => "activityId" as const],
  ])("append-only table: %s", (tableName, fixtureKeyFn) => {
    it("refuses UPDATE", async () => {
      const id = fixture[fixtureKeyFn()];
      await expectPermissionDenied(
        appClient!.query(
          `UPDATE ${quoteIdentifier(tableName)} SET actor_type = actor_type WHERE id = $1`,
          [id],
        ),
      );
    });

    it("refuses DELETE", async () => {
      const id = fixture[fixtureKeyFn()];
      await expectPermissionDenied(
        appClient!.query(
          `DELETE FROM ${quoteIdentifier(tableName)} WHERE id = $1`,
          [id],
        ),
      );
    });

    it("refuses TRUNCATE", async () => {
      await expectPermissionDenied(
        appClient!.query(`TRUNCATE ${quoteIdentifier(tableName)}`),
      );
    });

    it("refuses DROP TABLE", async () => {
      await expectPermissionDenied(
        appClient!.query(`DROP TABLE ${quoteIdentifier(tableName)}`),
      );
    });

    it("refuses ALTER TABLE ... DISABLE TRIGGER", async () => {
      await expectPermissionDenied(
        appClient!.query(
          `ALTER TABLE ${quoteIdentifier(tableName)} DISABLE TRIGGER ALL`,
        ),
      );
    });
  });

  it("allows SELECT, INSERT, UPDATE and DELETE on an ordinary table (work_item)", async () => {
    const selectResult = await appClient?.query(
      "SELECT id FROM work_item WHERE id = $1",
      [fixture.workItemId],
    );
    expect(selectResult?.rows).toHaveLength(1);

    const insertResult = await appClient?.query(
      `INSERT INTO work_item (id, project_id, workspace_id, type_id, state_id, number, key, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
       RETURNING id`,
      [
        `wi-${randomUUID()}`,
        fixture.projectId,
        fixture.workspaceId,
        fixture.typeId,
        fixture.stateId,
        2,
        `${fixture.projectSlug}-2`,
        "Ordinary table DML check",
      ],
    );
    const insertedId = insertResult?.rows[0]?.id as string;
    expect(insertedId).toBeTruthy();

    await expect(
      appClient?.query("UPDATE work_item SET title = $1 WHERE id = $2", [
        "Updated by app role",
        insertedId,
      ]),
    ).resolves.toBeDefined();

    await expect(
      appClient?.query("DELETE FROM work_item WHERE id = $1", [insertedId]),
    ).resolves.toBeDefined();
  });

  it("passes assertApplicationRoleIsNotPrivileged for the app role connection", async () => {
    await expect(
      assertApplicationRoleIsNotPrivileged(appDb),
    ).resolves.not.toThrow();
  });

  it("makes assertApplicationRoleIsNotPrivileged throw for a superuser connection", async () => {
    let thrown: unknown;
    try {
      // `db` is this test harness's own owner/superuser connection
      // (`.env.test.example`'s `TASKDESK_DATABASE_URL`) -- exactly the misconfiguration
      // #296 closes, reproduced deliberately here as the negative case.
      await assertApplicationRoleIsNotPrivileged(db);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(deepestMessage(thrown)).toMatch(/superuser/i);
  });

  it("is idempotent: running ensureApplicationRole a second time changes nothing observable", async () => {
    const before = await appClient?.query(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );

    process.env.TASKDESK_DATABASE_URL = appConnectionString;
    try {
      await expect(ensureApplicationRole(db)).resolves.not.toThrow();
    } finally {
      if (originalDatabaseUrl) {
        process.env.TASKDESK_DATABASE_URL = originalDatabaseUrl;
      }
    }

    const after = await appClient?.query(
      "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
    );
    expect(after?.rows[0]?.rolsuper).toBe(before?.rows[0]?.rolsuper);
    expect(after?.rows[0]?.rolsuper).toBe(false);

    // The restricted grant on the append-only table is still in force after the
    // second run -- the second call did not accidentally widen it back out.
    await expectPermissionDenied(appClient!.query("TRUNCATE audit_log"));

    // And the ordinary grant is still in force too.
    await expect(
      appClient?.query("SELECT id FROM work_item WHERE id = $1", [
        fixture.workItemId,
      ]),
    ).resolves.toBeDefined();
  });
});
