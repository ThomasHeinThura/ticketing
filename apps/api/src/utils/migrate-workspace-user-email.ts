import type { DatabaseInstance } from "../database";
import { migrateWorkspaceUserEmail as runMigrateWorkspaceUserEmail } from "../database/repositories/migrate-workspace-user-email.repository";

export function migrateWorkspaceUserEmail(db?: DatabaseInstance) {
  return runMigrateWorkspaceUserEmail(db);
}
