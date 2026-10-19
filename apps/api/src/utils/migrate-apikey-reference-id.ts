import type { DatabaseInstance } from "../database";
import { migrateApiKeyReferenceId as runMigrateApiKeyReferenceId } from "../database/repositories/migrate-apikey-reference-id.repository";

export function migrateApiKeyReferenceId(db?: DatabaseInstance) {
  return runMigrateApiKeyReferenceId(db);
}
