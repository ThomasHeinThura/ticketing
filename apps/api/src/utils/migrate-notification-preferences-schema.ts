import type { DatabaseInstance } from "../database";
import { migrateNotificationPreferencesSchema as runMigrateNotificationPreferencesSchema } from "../database/repositories/migrate-notification-preferences-schema.repository";

export function migrateNotificationPreferencesSchema(db?: DatabaseInstance) {
  return runMigrateNotificationPreferencesSchema(db);
}
