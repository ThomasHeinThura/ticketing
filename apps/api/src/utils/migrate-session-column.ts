import type { DatabaseInstance } from "../database";
import { migrateSessionColumn as runMigrateSessionColumn } from "../database/repositories/migrate-session-column.repository";

export function migrateSessionColumn(db?: DatabaseInstance) {
  return runMigrateSessionColumn(db);
}
