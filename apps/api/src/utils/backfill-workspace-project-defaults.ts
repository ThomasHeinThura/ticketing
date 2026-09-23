import { and, eq, exists, isNull, notExists, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { seedProjectStates } from "./seed-project-states";
import {
  seedDefaultStateTemplates,
  seedDefaultWorkItemTypes,
} from "./seed-workspace-defaults";

export type WorkspaceBackfillSummary = {
  /** Workspaces that had SOME work to do (missing at least one kind of default row). */
  processed: number;
  typesSeeded: number;
  templatesSeeded: number;
  /** Failed and left exactly as found -- its transaction rolled back, retried next boot. */
  failed: number;
};

export type ProjectBackfillSummary = {
  seeded: number;
  /** Failed and left exactly as found -- its transaction rolled back, retried next boot. */
  failed: number;
  /** Excluded from this run: the workspace has no active `state_template` to adopt from
   * yet. Not a failure -- retried automatically once one exists. */
  skippedNoActiveTemplate: number;
};

export type BackfillSummary = {
  workspaces: WorkspaceBackfillSummary;
  projects: ProjectBackfillSummary;
};

/**
 * Issue #316: backfill the default `work_item_type`/`state_template`/`state` rows for
 * workspaces and projects created BEFORE #309 (PR #313) taught `create-workspace.ts` and
 * `create-project.ts` to seed them in their own creating transaction. Those two routes
 * already cover every workspace/project created from here on; this covers everything
 * created before that landed -- including UAT's existing database, which has neither.
 *
 * Runs once per boot, from `runApiBootTasks()` (issue #296 split `runStartupTasks()` into a
 * one-shot `runMigrationStep()` and this API-boot function; this call belongs here, never
 * in `runMigrationStep()`, because it is ordinary app-role DML under its own advisory
 * lock, not DDL, and the migration process has already exited by the time this runs),
 * AFTER Drizzle migrations. Boot step, not a
 * migration: the acceptance criteria for #316 require reusing "exactly #313's seed data
 * and functions, with no second copy" (`DEFAULT_WORK_ITEM_TYPES`, `DEFAULT_STATE_TEMPLATES`
 * and the `seedDefaultWorkItemTypes`/`seedDefaultStateTemplates`/`seedProjectStates`
 * functions themselves), and a pure-SQL migration cannot import TypeScript -- it would
 * have to re-encode that data as a second, divergeable copy in SQL. See this PR's body for
 * the full mechanism trade-off.
 *
 * Never touches a workspace or project an operator has already customised, and the guard
 * is PER KIND, not per workspace (independent review of this PR, first round):
 * - default `work_item_type` rows are seeded for a workspace only if it has NO
 *   `work_item_type` row of its own yet, regardless of whether it already has
 *   `state_template` rows;
 * - default `state_template` rows are seeded only if it has NO `state_template` row of
 *   its own yet, regardless of `work_item_type`;
 * - a project's default `state` rows are seeded only if it has NO `state` row yet.
 * A workspace with a custom type set but no templates of its own therefore gets exactly
 * the default templates added, and keeps its custom types untouched -- never both kinds
 * lumped under one workspace-level guard.
 *
 * **Atomicity, per workspace** (independent review of this PR, first round -- BLOCKING,
 * reproduced live): each workspace's backfill runs inside its OWN transaction, checking
 * both kinds and inserting whichever is missing before committing. This is not merely
 * belt-and-suspenders: `onConflictDoNothing` on each table's `unique(workspace_id, key)`
 * index makes EACH insert idempotent on its OWN, but it does nothing to stop a crash
 * between the type insert and the template insert from committing one without the other
 * -- reproduced live in review by injecting a throw between the two inserts, which left a
 * workspace with 9 types and 0 templates, and because the per-kind guard then saw a type
 * row, that workspace was skipped forever. Wrapping both checks and both (conditional)
 * inserts in one transaction makes a workspace's backfill all-or-nothing: a failure rolls
 * the whole workspace back to exactly its pre-backfill state, so the SAME "missing this
 * kind" guard that skips an already-customised workspace also correctly re-selects a
 * workspace whose backfill attempt failed, on the next boot.
 *
 * **Per-item failure isolation.** A failure backfilling one workspace or project must not
 * abort every other one, or a single bad row turns a partial, recoverable gap into a
 * boot-blocking incident for an unrelated tenant. Each workspace/project is backfilled in
 * its own `try`/`catch`: a failure is logged (the id and the error's class only -- never
 * the error message, which could echo back column data) and counted, its transaction has
 * already rolled back so nothing partial was left behind, and the loop continues to the
 * next item. This is a deliberate choice, not an oversight: the alternative (one failure
 * aborts the whole boot) would let a single malformed legacy row -- for instance a
 * workspace whose `organisation_id` violates a constraint this backfill doesn't itself
 * touch -- take down every OTHER tenant's ability to start the process at all, which is a
 * strictly worse failure mode for a best-effort data backfill than "this one tenant's
 * gap persists one more boot and is retried." A summary line at the end of each run
 * reports how many succeeded, failed and (for projects) were skipped, so a failure is
 * visible in the boot log even though it does not stop the boot.
 *
 * **Projects whose workspace has zero active templates are excluded from the query
 * itself** (independent review of this PR, first round), not merely skipped at runtime --
 * see `backfillLegacyProjectStates`'s own comment. Such a project is not a failure: it is
 * retried automatically, at no extra cost, once its workspace has an active template
 * (either from this same backfill run seeding the workspace first, or from an operator
 * un-archiving one) -- logged once per run as a count, not per project, so it does not
 * spam the boot log every restart while genuinely waiting on that.
 *
 * Concurrency:
 * - Two replicas backfilling the SAME legacy workspace concurrently: each runs the
 *   workspace's two existence checks and conditional inserts inside its own transaction.
 *   Postgres's default READ COMMITTED isolation means the second transaction's checks run
 *   against whatever the first has already committed by the time it starts, and
 *   `onConflictDoNothing` on each table's `unique(workspace_id, key)` index is the
 *   backstop for the residual window where both transactions' checks land before either
 *   commits -- one insert wins per row, the other is a no-op. That backstop covers
 *   concurrent RACES between independent writers; it is not what makes a single
 *   transaction's own two inserts atomic with each other -- that is the transaction
 *   boundary above, not this index.
 * - `seedProjectStates` is NOT safe unguarded: #313's Opus security review (S2) flagged
 *   that its check-then-insert is only safe because `create-project.ts` always calls it
 *   from inside a transaction holding `pg_advisory_xact_lock(1524, hashtext(workspaceId))`.
 *   `state` carries no `unique(project_id, state_template_id)` constraint to fall back on
 *   (adding one means editing `apps/api/src/database/schema.ts`, out of scope for this PR
 *   -- see this PR's body). So this file takes the SAME lock, the same way, around each
 *   project's backfill: a dedicated transaction that acquires
 *   `pg_advisory_xact_lock(1524, hashtext(workspaceId))` before calling `seedProjectStates`.
 *   That serializes against both a live `POST /api/project` create for the same workspace
 *   and against another replica's concurrent backfill pass over the same workspace's
 *   legacy projects, exactly like two concurrent real creates in the same workspace
 *   already serialize today. Verified live: 3 runs of 30-way concurrent
 *   `backfillWorkspaceAndProjectDefaults()` calls against the same legacy project each
 *   left it with exactly one default state; removing the lock reproduces a real
 *   `state_project_default_unique` violation reliably (3/3 runs).
 *
 * Idempotent overall: a second boot (or a second replica booting at the same time) finds
 * nothing left to backfill once the first pass has committed, and re-running against a
 * workspace/project that was backfilled or created normally is a silent no-op.
 */
export async function backfillWorkspaceAndProjectDefaults(): Promise<BackfillSummary> {
  const workspaces = await backfillLegacyWorkspaceDefaults();
  const projects = await backfillLegacyProjectStates();

  if (
    workspaces.processed > 0 ||
    projects.seeded > 0 ||
    projects.failed > 0 ||
    projects.skippedNoActiveTemplate > 0
  ) {
    console.log(
      `✅ Backfill (#316) summary: workspaces -- ${workspaces.processed} processed ` +
        `(${workspaces.typesSeeded} seeded default types, ${workspaces.templatesSeeded} ` +
        `seeded default templates, ${workspaces.failed} failed); projects -- ` +
        `${projects.seeded} seeded default states, ${projects.failed} failed, ` +
        `${projects.skippedNoActiveTemplate} skipped (workspace has no active ` +
        "state_template yet).",
    );
  }

  return { workspaces, projects };
}

function logBackfillFailure(
  kind: "workspace" | "project",
  id: string,
  error: unknown,
) {
  // Log the id and the error's CLASS only -- never its message, which for a database
  // error can echo back column values (issue #316 review, "without secrets").
  const errorClass = error instanceof Error ? error.name : typeof error;
  console.error(
    `⚠️ Backfill (#316): failed to seed defaults for ${kind} ${id}: ${errorClass}`,
  );
}

async function backfillLegacyWorkspaceDefaults(): Promise<WorkspaceBackfillSummary> {
  const hasTypeSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.workItemTypeTable)
      .where(
        eq(schema.workItemTypeTable.workspaceId, schema.workspaceTable.id),
      );
  const hasTemplateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTemplateTable)
      .where(
        eq(schema.stateTemplateTable.workspaceId, schema.workspaceTable.id),
      );

  // Candidates: missing EITHER kind. The per-kind check that decides what actually gets
  // inserted happens again, per kind, inside each workspace's own transaction below --
  // this outer query only narrows which workspaces are worth opening a transaction for.
  const candidates = await db
    .select({ id: schema.workspaceTable.id })
    .from(schema.workspaceTable)
    .where(
      sql`${notExists(hasTypeSubquery())} or ${notExists(hasTemplateSubquery())}`,
    );

  let typesSeeded = 0;
  let templatesSeeded = 0;
  let failed = 0;

  for (const workspace of candidates) {
    try {
      const result = await db.transaction(async (tx) => {
        const [existingType] = await tx
          .select({ id: schema.workItemTypeTable.id })
          .from(schema.workItemTypeTable)
          .where(eq(schema.workItemTypeTable.workspaceId, workspace.id))
          .limit(1);
        const [existingTemplate] = await tx
          .select({ id: schema.stateTemplateTable.id })
          .from(schema.stateTemplateTable)
          .where(eq(schema.stateTemplateTable.workspaceId, workspace.id))
          .limit(1);

        let seededTypes = false;
        let seededTemplates = false;

        if (!existingType) {
          await seedDefaultWorkItemTypes(workspace.id, tx);
          seededTypes = true;
        }
        if (!existingTemplate) {
          await seedDefaultStateTemplates(workspace.id, tx);
          seededTemplates = true;
        }

        return { seededTypes, seededTemplates };
      });

      // Only counted once the transaction has actually COMMITTED -- incrementing inside
      // the transaction callback itself would count work a later failure in the SAME
      // transaction then rolled back.
      if (result.seededTypes) typesSeeded += 1;
      if (result.seededTemplates) templatesSeeded += 1;
    } catch (error) {
      failed += 1;
      logBackfillFailure("workspace", workspace.id, error);
    }
  }

  return { processed: candidates.length, typesSeeded, templatesSeeded, failed };
}

async function backfillLegacyProjectStates(): Promise<ProjectBackfillSummary> {
  const hasStateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTable)
      .where(eq(schema.stateTable.projectId, schema.projectTable.id));
  // "Active" mirrors `seedProjectStates`'s own template query (`archived_at is null`).
  const hasActiveTemplateSubquery = () =>
    db
      .select({ one: sql`1` })
      .from(schema.stateTemplateTable)
      .where(
        and(
          eq(
            schema.stateTemplateTable.workspaceId,
            schema.projectTable.workspaceId,
          ),
          isNull(schema.stateTemplateTable.archivedAt),
        ),
      );

  // Excludes a project whose workspace has zero ACTIVE templates from the query itself
  // (independent review of this PR, first round) -- not merely a runtime skip. Without
  // this, such a project is re-selected as "legacy" on every single boot forever (its
  // workspace's own backfill either has not run yet within this same call, or every
  // template is archived), each time opening a transaction and taking the advisory lock
  // for no reason: `seedProjectStates` itself already no-ops when it finds zero active
  // templates (its own comment), so the wasted attempt would never insert anything.
  const legacyProjects = await db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.projectTable)
    .where(
      sql`${isNull(schema.projectTable.deletedAt)} and ${notExists(
        hasStateSubquery(),
      )} and ${exists(hasActiveTemplateSubquery())}`,
    );

  const [stuckRow] = await db
    .select({ stuckCount: sql<string>`count(*)` })
    .from(schema.projectTable)
    .where(
      sql`${isNull(schema.projectTable.deletedAt)} and ${notExists(
        hasStateSubquery(),
      )} and ${notExists(hasActiveTemplateSubquery())}`,
    );
  const skippedNoActiveTemplate = Number(stuckRow?.stuckCount ?? 0);

  let seeded = 0;
  let failed = 0;

  for (const project of legacyProjects) {
    try {
      await db.transaction(async (tx) => {
        // Same lock, same key, same reason as `create-project.ts`'s own comment on
        // `pg_advisory_xact_lock(1524, hashtext(workspaceId))`: serialize per workspace so
        // this can never race a live project create or another replica's backfill pass.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(1524, hashtext(${project.workspaceId}))`,
        );
        await seedProjectStates(project.id, project.workspaceId, tx);
      });
      seeded += 1;
    } catch (error) {
      failed += 1;
      logBackfillFailure("project", project.id, error);
    }
  }

  if (skippedNoActiveTemplate > 0) {
    console.warn(
      `⚠️ Backfill (#316): ${skippedNoActiveTemplate} legacy project(s) skipped this run ` +
        "-- their workspace has no active state_template row to adopt from yet. Retried " +
        "automatically on a later boot once one exists (from this same run's workspace " +
        "backfill, or an operator un-archiving a template).",
    );
  }

  return { seeded, failed, skippedNoActiveTemplate };
}

export default backfillWorkspaceAndProjectDefaults;
