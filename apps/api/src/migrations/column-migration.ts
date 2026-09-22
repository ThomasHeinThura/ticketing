import { eq, sql } from "drizzle-orm";
import db from "../database";
import { columnTable, projectTable, taskTable } from "../database/schema";

const DEFAULT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
];

/**
 * The advisory-lock namespace for this file's check-then-insert default-column seed
 * (issue #134). `column` carries no `UNIQUE (project_id, slug)` -- unlike
 * `workspace_role`'s `workspace_role_workspace_id_role_unique` (migration 0051, issue
 * #118) -- so there is no constraint an `onConflictDoNothing` could target here, and
 * `create-column.ts`'s own check-then-insert (409 on a duplicate slug, not DB-enforced)
 * means a duplicate-slug row is not something a fresh unique index could safely assume is
 * absent from every existing deployment without its own dedup migration -- out of scope
 * for this fix. An advisory lock, keyed per project like `WORKSPACE_ROLE_LOCK_NAMESPACE`
 * (`workspace-role-lock.ts`) is keyed per workspace, closes the race instead: two replicas
 * racing this seed for the same legacy project now serialize, and the loser sees the
 * winner's rows already present and skips.
 *
 * Distinct from the namespaces already in use: `create-project.ts` / `reorder-projects.ts`
 * use `1524`, `auth.ts`'s admin-promotion lock uses `2026`,
 * `workspace-membership-lock.ts` uses `4_002`, `workspace-role-lock.ts` uses `4_003`.
 */
const COLUMN_SEED_LOCK_NAMESPACE = 4_004;

export async function migrateColumns() {
  console.log("🔄 Starting column migration...");

  const projects = await db.select().from(projectTable);

  if (projects.length === 0) {
    console.log("No projects found, skipping column migration");
    return;
  }

  for (const project of projects) {
    const columnMap = await db.transaction(async (tx) => {
      // Held for the rest of this transaction (pg_advisory_xact_lock): serializes this
      // project's check-then-insert against any other replica running the same startup
      // seed concurrently, so only one of them ever observes "no columns yet" and inserts.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${COLUMN_SEED_LOCK_NAMESPACE}, hashtext(${project.id}))`,
      );

      const projectColumns = await tx
        .select({
          id: columnTable.id,
          slug: columnTable.slug,
        })
        .from(columnTable)
        .where(eq(columnTable.projectId, project.id));

      const map = new Map<string, string>(
        projectColumns.map((column) => [column.slug, column.id]),
      );

      // Only seed missing default slugs for legacy projects that have no columns yet.
      // If the project already has columns, missing slugs are intentional (user removed them);
      // re-inserting on every startup would undo deletions after each API restart.
      if (projectColumns.length === 0) {
        for (const defaultColumn of DEFAULT_COLUMNS) {
          if (map.has(defaultColumn.slug)) {
            continue;
          }

          const [inserted] = await tx
            .insert(columnTable)
            .values({
              projectId: project.id,
              name: defaultColumn.name,
              slug: defaultColumn.slug,
              position: defaultColumn.position,
              isFinal: defaultColumn.isFinal,
            })
            .returning({ id: columnTable.id, slug: columnTable.slug });

          if (inserted) {
            map.set(inserted.slug, inserted.id);
          }
        }
      }

      return map;
    });

    for (const [slug, columnId] of columnMap) {
      await db
        .update(taskTable)
        .set({ columnId })
        .where(
          sql`${taskTable.projectId} = ${project.id}
              AND ${taskTable.status} = ${slug}
              AND ${taskTable.columnId} IS DISTINCT FROM ${columnId}`,
        );
    }
  }

  console.log(
    `✅ Column migration complete! Migrated ${projects.length} projects`,
  );
}
