import { eq, isNull, notExists, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { seedProjectStates } from "./seed-project-states";
import { seedWorkspaceDefaults } from "./seed-workspace-defaults";

/**
 * Issue #316: backfill the default `work_item_type`/`state_template`/`state` rows for
 * workspaces and projects created BEFORE #309 (PR #313) taught `create-workspace.ts` and
 * `create-project.ts` to seed them in their own creating transaction. Those two routes
 * already cover every workspace/project created from here on; this covers everything
 * created before that landed -- including UAT's existing database, which has neither.
 *
 * Runs once per boot, from `runStartupTasks()`, AFTER Drizzle migrations. Boot step, not a
 * migration: the acceptance criteria for #316 require reusing "exactly #313's seed data
 * and functions, with no second copy" ( `DEFAULT_WORK_ITEM_TYPES`, `DEFAULT_STATE_TEMPLATES`
 * and the `seedWorkspaceDefaults`/`seedProjectStates` functions themselves), and a
 * pure-SQL migration cannot import TypeScript -- it would have to re-encode that data as a
 * second, divergeable copy in SQL. See this PR's body for the full mechanism trade-off.
 *
 * Never touches a workspace or project an operator has already customised:
 * - a workspace is only backfilled when it has NEITHER any `work_item_type` NOR any
 *   `state_template` row yet (exactly #316's "none of the default ... rows" wording --
 *   a workspace with its own custom types/templates, even a partial or renamed set, is
 *   left alone);
 * - a project is only backfilled when it has NO `state` row yet.
 * Both checks are the same "no rows of that kind" guard `seedWorkspaceDefaults` and
 * `seedProjectStates` themselves already rely on for per-row idempotence -- this file only
 * adds the "which existing rows still need it" query on top.
 *
 * Concurrency:
 * - `seedWorkspaceDefaults` is already safe unguarded: both of its target tables carry a
 *   `unique(workspace_id, key)` index (`work_item_type_workspace_key_unique`,
 *   `state_template_workspace_key_unique`) and it inserts with `onConflictDoNothing`
 *   against that exact index, so two replicas backfilling the same legacy workspace at
 *   once just have one insert win per row -- no lock needed here beyond what already
 *   ships in #313.
 * - `seedProjectStates` is NOT: #313's Opus security review (S2) flagged that its
 *   check-then-insert is only safe because `create-project.ts` always calls it from
 *   inside a transaction holding `pg_advisory_xact_lock(1524, hashtext(workspaceId))`.
 *   `state` carries no `unique(project_id, state_template_id)` constraint to fall back
 *   on, and adding one would mean editing `apps/api/src/database/schema.ts`, which this
 *   PR does not touch (owned by #308, the in-flight DB role split -- see this PR's body).
 *   So this file takes the SAME lock, the same way, around each project's backfill: a
 *   dedicated transaction that acquires `pg_advisory_xact_lock(1524, hashtext(workspaceId))`
 *   before calling `seedProjectStates`. That serializes against both a live
 *   `POST /api/project` create for the same workspace and against another replica's
 *   concurrent backfill pass over the same workspace's legacy projects, exactly like two
 *   concurrent real creates in the same workspace already serialize today.
 *
 * Idempotent overall: a second boot (or a second replica booting at the same time) finds
 * nothing left to backfill once the first pass has committed, and re-running against a
 * workspace/project that was backfilled or created normally is a silent no-op.
 */
export async function backfillWorkspaceAndProjectDefaults(): Promise<void> {
  const backfilledWorkspaces = await backfillLegacyWorkspaceDefaults();
  const backfilledProjects = await backfillLegacyProjectStates();

  if (backfilledWorkspaces > 0 || backfilledProjects > 0) {
    console.log(
      `✅ Backfilled defaults for ${backfilledWorkspaces} legacy workspace(s) and ${backfilledProjects} legacy project(s) (#316).`,
    );
  }
}

async function backfillLegacyWorkspaceDefaults(): Promise<number> {
  const legacyWorkspaces = await db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(
      sql`${notExists(
        db
          .select({ one: sql`1` })
          .from(schema.workItemTypeTable)
          .where(
            eq(schema.workItemTypeTable.workspaceId, schema.workspaceTable.id),
          ),
      )} and ${notExists(
        db
          .select({ one: sql`1` })
          .from(schema.stateTemplateTable)
          .where(
            eq(schema.stateTemplateTable.workspaceId, schema.workspaceTable.id),
          ),
      )}`,
    );

  for (const workspace of legacyWorkspaces) {
    await seedWorkspaceDefaults(workspace.id);
  }

  return legacyWorkspaces.length;
}

async function backfillLegacyProjectStates(): Promise<number> {
  const legacyProjects = await db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.projectTable)
    .where(
      sql`${isNull(schema.projectTable.deletedAt)} and ${notExists(
        db
          .select({ one: sql`1` })
          .from(schema.stateTable)
          .where(eq(schema.stateTable.projectId, schema.projectTable.id)),
      )}`,
    );

  for (const project of legacyProjects) {
    await db.transaction(async (tx) => {
      // Same lock, same key, same reason as `create-project.ts`'s own comment on
      // `pg_advisory_xact_lock(1524, hashtext(workspaceId))`: serialize per workspace so
      // this can never race a live project create or another replica's backfill pass.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(1524, hashtext(${project.workspaceId}))`,
      );
      await seedProjectStates(project.id, project.workspaceId, tx);
    });
  }

  return legacyProjects.length;
}

export default backfillWorkspaceAndProjectDefaults;
