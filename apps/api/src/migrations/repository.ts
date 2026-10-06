import { eq } from "drizzle-orm";
import db, { schema } from "../database";

type MigrationExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function listProjectsForColumnMigration() {
  return db.select().from(schema.projectTable);
}

export function listProjectColumnsForMigration(
  executor: MigrationExecutor,
  projectId: string,
) {
  return executor
    .select({ id: schema.columnTable.id, slug: schema.columnTable.slug })
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, projectId));
}
