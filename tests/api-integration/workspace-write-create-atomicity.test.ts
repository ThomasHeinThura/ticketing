/**
 * S4 — workspace creation and its REQUIRED default-role seeding commit
 * together or roll back together. Issue #6 (retrofit plan R6), issue #66.
 *
 * THE DEFECT THIS CLOSES. `afterCreateOrganization` seeds `workspace_role`
 * inside a `try/catch` that logs and continues (`apps/api/src/auth.ts`), and
 * the seed runs AFTER the plugin has already committed the workspace. A seed
 * failure therefore leaves a fully successful workspace whose `viewer`,
 * `member` and `admin` rows do not exist — for however long it takes the
 * boot-time backfill (`seed-default-workspace-roles.ts`, called once at
 * process start) to run, which on a long-lived process is "never".
 *
 * That is not a cosmetic hole. It is the state issue #66 is about: with no
 * `workspace_role` row to match, `hasWorkspacePermission` falls back to the
 * COMPILED-IN static role definition, so a narrowed role silently regains its
 * compiled privileges. #66's first ordered fix is exactly this file's subject
 * — "make S4's role seeding transactional … missing default rows stop being a
 * legitimate steady state". Removing the fallback is #66's SECOND step and is
 * NOT done here: S7 is blocked on #66 and the shared fallback stays put.
 *
 * FAILURE INJECTION IS AT THE DATABASE, NOT IN THE CODE. Every probe below
 * arms a `BEFORE INSERT` trigger that raises inside PostgreSQL, so the probe
 * is coupled to the transaction boundary and not to any function name,
 * spy-able export or call order. A refactor that keeps the guarantee keeps
 * these green; one that quietly reopens the hole cannot.
 *
 * A2-P8 deliberately runs the SAME injection against the still-mounted
 * inherited plugin route and asserts the OPPOSITE outcome. It is the RED half
 * of this batch, kept permanently: it proves the injection reaches the real
 * seeding path (so a green native probe is not vacuous) and it pins the
 * inherited defect until S10 unmounts the plugin.
 */
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { subscribeToEvent } from "../../apps/api/src/events";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import {
  createWorkspaceViaPlugin,
  signUpUser,
} from "./helpers/organization-http";
import { createWorkspaceNative } from "./helpers/workspace-write-http";

const FAIL_FUNCTION = "td_probe_fail_insert";

/** Raise inside PostgreSQL on every INSERT into `table`. */
async function armInsertFailure(table: string) {
  await db.execute(
    sql.raw(`
      CREATE OR REPLACE FUNCTION ${FAIL_FUNCTION}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'A2 probe: injected % insert failure', TG_TABLE_NAME;
      END;
      $$ LANGUAGE plpgsql;
    `),
  );
  await db.execute(
    sql.raw(`
      CREATE TRIGGER ${FAIL_FUNCTION}_${table}
      BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION ${FAIL_FUNCTION}();
    `),
  );
}

async function disarmInsertFailure(table: string) {
  await db.execute(
    sql.raw(`DROP TRIGGER IF EXISTS ${FAIL_FUNCTION}_${table} ON "${table}"`),
  );
}

async function snapshotAllTableCounts(): Promise<Record<string, number>> {
  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);

  const counts: Record<string, number> = {};
  for (const { table_name: tableName } of tables.rows) {
    const result = await db.execute<{ count: string }>(
      sql.raw(`SELECT count(*) AS count FROM "${tableName}"`),
    );
    counts[tableName] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

type RecordedEvent = { type: string; data: unknown };
const recordedEvents: RecordedEvent[] = [];
let eventSubscribersInitialized = false;

function initEventSubscribers() {
  if (eventSubscribersInitialized) return;
  eventSubscribersInitialized = true;
  subscribeToEvent("workspace.created", async (data) => {
    recordedEvents.push({ type: "workspace.created", data });
  });
}

const armedTables = new Set<string>();
async function arm(table: string) {
  armedTables.add(table);
  await armInsertFailure(table);
}

beforeEach(async () => {
  await resetTestDatabase();
  recordedEvents.length = 0;
  initEventSubscribers();
});

afterEach(async () => {
  for (const table of armedTables) {
    await disarmInsertFailure(table);
  }
  armedTables.clear();
});

describe("S4 native create is atomic with its default-role seed (A2-P6..A2-P10)", () => {
  it("A2-P6 rolls the ENTIRE creation back when default-role seeding fails — no workspace, member, team, team_member or session state survives", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    const [sessionBefore] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.userId, owner.user.id));
    const creatingSessionId = sessionBefore?.id;
    if (!creatingSessionId) throw new Error("expected one creating session");
    expect(sessionBefore?.activeOrganizationId).toBeNull();
    expect(sessionBefore?.activeTeamId).toBeNull();

    const before = await snapshotAllTableCounts();
    expect(Object.keys(before).length).toBeGreaterThanOrEqual(29);

    await arm("workspace_role");

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Doomed Workspace",
    });

    // The caller must be told. A 2xx here would be the exact bug: a
    // "successful" workspace with no authorization rows behind it.
    expect(created.status).toBeGreaterThanOrEqual(500);

    // Not one row anywhere — whole-database enumeration, the same method
    // §2.5 used to close the create contract at NINE.
    const after = await snapshotAllTableCounts();
    expect(after).toEqual(before);

    // Named explicitly as well as by row count, so a failure reads clearly.
    expect(await db.select().from(schema.workspaceTable)).toHaveLength(0);
    expect(await db.select().from(schema.workspaceUserTable)).toHaveLength(0);
    expect(await db.select().from(schema.workspaceRoleTable)).toHaveLength(0);
    expect(await db.select().from(schema.teamTable)).toHaveLength(0);
    expect(await db.select().from(schema.teamMemberTable)).toHaveLength(0);

    // Effects 7 and 8 must roll back with everything else: a session left
    // pointing at a workspace that does not exist is exactly the partial
    // state this batch exists to make impossible.
    const [sessionAfter] = await db
      .select()
      .from(schema.sessionTable)
      .where(eq(schema.sessionTable.id, creatingSessionId));
    expect(sessionAfter?.activeOrganizationId).toBeNull();
    expect(sessionAfter?.activeTeamId).toBeNull();

    // Effect 4 must not fire on a rolled-back create, so effect 9 cannot
    // either: no notification about a workspace nobody can reach.
    expect(recordedEvents).toHaveLength(0);
    expect(await db.select().from(schema.notificationTable)).toHaveLength(0);
  });

  it("A2-P7 rolls back just as completely when the default TEAM insert fails, not only the role seed", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);
    const before = await snapshotAllTableCounts();

    await arm("team");

    const created = await createWorkspaceNative(app, owner.cookie, {
      name: "Doomed By Team",
    });
    expect(created.status).toBeGreaterThanOrEqual(500);

    expect(await snapshotAllTableCounts()).toEqual(before);
    expect(recordedEvents).toHaveLength(0);
  });

  it("A2-P8 CHARACTERIZES THE INHERITED DEFECT: the same injection leaves the plugin's workspace behind with zero role rows", async () => {
    // This is the RED probe, kept permanently rather than deleted once the
    // native route went green. Two jobs:
    //   1. it proves the injection actually reaches the seeding path, so
    //      A2-P6's green is not vacuous;
    //   2. it pins the defect on the route that is still mounted and still
    //      serving every real client until S3/S8a repoint them.
    const { app } = createApp();
    const owner = await signUpUser(app);

    await arm("workspace_role");

    const created = await createWorkspaceViaPlugin(app, owner.cookie, {
      name: "Inherited Partial",
    });

    // The inherited path swallows the seed error and reports success.
    expect(created.status).toBe(200);
    const workspace = (await created.json()) as { id: string };

    const workspaceRows = await db
      .select()
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, workspace.id));
    expect(workspaceRows).toHaveLength(1);

    // …with none of its required authorization rows. This is the #66 window.
    const roleRows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(roleRows).toHaveLength(0);
  });

  it("A2-P9 a retry after the failure clears produces exactly ONE complete workspace, with no duplicated or leftover partial state", async () => {
    const { app } = createApp();
    const owner = await signUpUser(app);

    await arm("workspace_role");
    const failed = await createWorkspaceNative(app, owner.cookie, {
      name: "Retry Me",
    });
    expect(failed.status).toBeGreaterThanOrEqual(500);

    await disarmInsertFailure("workspace_role");
    armedTables.delete("workspace_role");

    const retried = await createWorkspaceNative(app, owner.cookie, {
      name: "Retry Me",
    });
    expect(retried.status).toBe(200);
    const workspace = (await retried.json()) as { id: string };

    // Exactly one workspace: the failed attempt left no half-built row for
    // the retry to collide with or to duplicate.
    const workspaces = await db.select().from(schema.workspaceTable);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).toBe(workspace.id);

    expect(await db.select().from(schema.workspaceUserTable)).toHaveLength(1);
    expect(await db.select().from(schema.teamTable)).toHaveLength(1);
    expect(await db.select().from(schema.teamMemberTable)).toHaveLength(1);

    const roleRows = await db
      .select()
      .from(schema.workspaceRoleTable)
      .where(eq(schema.workspaceRoleTable.workspaceId, workspace.id));
    expect(roleRows).toHaveLength(3);
    expect(new Set(roleRows.map((r) => r.role))).toEqual(
      new Set(["viewer", "member", "admin"]),
    );

    // Exactly one event and one notification — the rolled-back attempt
    // published nothing, so the retry cannot double-notify.
    const events = recordedEvents.filter(
      (e) => (e.data as { workspaceId?: string }).workspaceId === workspace.id,
    );
    expect(events).toHaveLength(1);
    expect(recordedEvents).toHaveLength(1);
  });

  it("A2-P10 every successful native create has all three required role rows — swept across repeated creates", async () => {
    // The positive form of the guarantee: there is no observable window in
    // which a natively created workspace exists without its role rows, so
    // "missing default rows" stops being a legitimate steady state (#66).
    const { app } = createApp();
    const owner = await signUpUser(app);

    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const created = await createWorkspaceNative(app, owner.cookie, {
        name: `Swept ${i}`,
      });
      expect(created.status).toBe(200);
      ids.push(((await created.json()) as { id: string }).id);
    }

    for (const id of ids) {
      const roleRows = await db
        .select()
        .from(schema.workspaceRoleTable)
        .where(eq(schema.workspaceRoleTable.workspaceId, id));
      expect(new Set(roleRows.map((r) => r.role))).toEqual(
        new Set(["viewer", "member", "admin"]),
      );
    }

    const workspaces = await db.select().from(schema.workspaceTable);
    expect(workspaces).toHaveLength(5);
  });
});
