import { eq, sql } from "drizzle-orm";
import db from "../database";
import { columnTable, projectTable, taskTable } from "../database/schema";

const DEFAULT_COLUMNS = [
  { name: "To Do", slug: "to-do", position: 0, isFinal: false },
  { name: "In Progress", slug: "in-progress", position: 1, isFinal: false },
  { name: "In Review", slug: "in-review", position: 2, isFinal: false },
  { name: "Done", slug: "done", position: 3, isFinal: true },
];

export async function migrateColumns() {
  console.log("🔄 Starting column migration...");

  const projects = await db.select().from(projectTable);

  if (projects.length === 0) {
    console.log("No projects found, skipping column migration");
    return;
  }

  for (const project of projects) {
    const projectColumns = await db
      .select({
        id: columnTable.id,
        slug: columnTable.slug,
      })
      .from(columnTable)
      .where(eq(columnTable.projectId, project.id));

    const columnMap = new Map<string, string>(
      projectColumns.map((column) => [column.slug, column.id]),
    );

    // Only seed missing default slugs for legacy projects that have no columns yet.
    // If the project already has columns, missing slugs are intentional (user removed them);
    // re-inserting on every startup would undo deletions after each API restart.
    if (projectColumns.length === 0) {
      for (const defaultColumn of DEFAULT_COLUMNS) {
        if (columnMap.has(defaultColumn.slug)) {
          continue;
        }

        const [inserted] = await db
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
          columnMap.set(inserted.slug, inserted.id);
        }
      }
    }

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
