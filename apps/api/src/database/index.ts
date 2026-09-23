import { config } from "dotenv-mono";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  accountTableRelations,
  activityTableRelations,
  apikeyTableRelations,
  assetTableRelations,
  columnTableRelations,
  commentTableRelations,
  externalLinkTableRelations,
  invitationTableRelations,
  labelTableRelations,
  membershipTableRelations,
  notificationTableRelations,
  organisationQuotaTableRelations,
  organisationTableRelations,
  personTableRelations,
  projectSlugClaimTableRelations,
  projectTableRelations,
  roleTableRelations,
  sessionTableRelations,
  stateTableRelations,
  stateTemplateTableRelations,
  taskActivityTableRelations,
  taskRelationTableRelations,
  taskReminderSentTableRelations,
  taskTableRelations,
  teamMemberTableRelations,
  teamTableRelations,
  timeEntryTableRelations,
  userNotificationPreferenceTableRelations,
  userNotificationWorkspaceProjectTableRelations,
  userNotificationWorkspaceRuleTableRelations,
  userTableRelations,
  verificationTableRelations,
  watcherTableRelations,
  workflowRuleTableRelations,
  workItemKeyAliasTableRelations,
  workItemKeyClaimTableRelations,
  workItemTableRelations,
  workItemTypeTableRelations,
  workspaceRoleTableRelations,
  workspaceTableRelations,
  workspaceUserTableRelations,
} from "./relations";
import {
  resolveDatabaseConnectionString,
  resolveMigrationDatabaseConnectionString,
} from "./resolve-database-url";
import {
  accountTable,
  activityTable,
  apikeyTable,
  assetTable,
  columnTable,
  commentTable,
  externalLinkTable,
  instanceSettingTable,
  invitationTable,
  jobLeaseTable,
  labelTable,
  legalHoldTable,
  membershipTable,
  notificationTable,
  organisationQuotaTable,
  organisationTable,
  personTable,
  projectSlugClaimTable,
  projectTable,
  roleTable,
  sessionTable,
  stateTable,
  stateTemplateTable,
  taskActivityTable,
  taskRelationTable,
  taskReminderSentTable,
  taskTable,
  teamMemberTable,
  teamTable,
  timeEntryTable,
  userAvatarTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  verificationTable,
  watcherTable,
  workflowRuleTable,
  workItemKeyAliasTable,
  workItemKeyClaimTable,
  workItemTable,
  workItemTypeTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
} from "./schema";

config();

export const schema = {
  accountTable,
  assetTable,
  activityTable,
  taskActivityTable,
  apikeyTable,
  columnTable,
  commentTable,
  externalLinkTable,
  instanceSettingTable,
  invitationTable,
  jobLeaseTable,
  labelTable,
  legalHoldTable,
  membershipTable,
  notificationTable,
  organisationQuotaTable,
  organisationTable,
  personTable,
  projectSlugClaimTable,
  projectTable,
  roleTable,
  sessionTable,
  stateTable,
  stateTemplateTable,
  taskRelationTable,
  taskReminderSentTable,
  taskTable,
  teamMemberTable,
  teamTable,
  timeEntryTable,
  userTable,
  userAvatarTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  verificationTable,
  watcherTable,
  workflowRuleTable,
  workItemKeyAliasTable,
  workItemKeyClaimTable,
  workItemTable,
  workItemTypeTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
  accountTableRelations,
  assetTableRelations,
  activityTableRelations,
  taskActivityTableRelations,
  apikeyTableRelations,
  columnTableRelations,
  commentTableRelations,
  externalLinkTableRelations,
  invitationTableRelations,
  labelTableRelations,
  membershipTableRelations,
  notificationTableRelations,
  organisationQuotaTableRelations,
  organisationTableRelations,
  personTableRelations,
  projectSlugClaimTableRelations,
  projectTableRelations,
  roleTableRelations,
  sessionTableRelations,
  stateTableRelations,
  stateTemplateTableRelations,
  taskRelationTableRelations,
  taskReminderSentTableRelations,
  taskTableRelations,
  teamMemberTableRelations,
  teamTableRelations,
  timeEntryTableRelations,
  userTableRelations,
  userNotificationPreferenceTableRelations,
  userNotificationWorkspaceProjectTableRelations,
  userNotificationWorkspaceRuleTableRelations,
  verificationTableRelations,
  watcherTableRelations,
  workflowRuleTableRelations,
  workItemKeyAliasTableRelations,
  workItemKeyClaimTableRelations,
  workItemTableRelations,
  workItemTypeTableRelations,
  workspaceRoleTableRelations,
  workspaceTableRelations,
  workspaceUserTableRelations,
};

export type DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>;

let pool: Pool | undefined;
let dbInstance: DatabaseInstance | undefined;

export function getDatabasePool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: resolveDatabaseConnectionString(),
      // Fail fast when Railway's internal network is slow rather than hanging
      // indefinitely and blocking every API request.
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      max: 10,
    });

    // node-postgres emits "error" on the pool when an IDLE client dies
    // server-side (a Postgres restart/blip). An EventEmitter with no "error"
    // listener throws on that event, which is an unhandled exception that
    // crashes the whole process — turning a brief database outage into a
    // full restart, exactly what the liveness/readiness split
    // (docs/05-operations/deployment.md § Health and readiness) exists to
    // prevent. A regularly-polled /api/public/health/ready makes an idle
    // pooled client, and therefore this failure mode, routinely reachable
    // rather than theoretical.
    pool.on("error", (error) => {
      console.error("Database pool: idle client error", error);
    });
  }

  return pool;
}

export function getDatabase(): DatabaseInstance {
  if (!dbInstance) {
    dbInstance = drizzle(getDatabasePool(), {
      schema,
    });
  }

  return dbInstance;
}

// --- migration/owner connection (issue #296) -------------------------------
//
// A separate pool, from a separate connection string
// (`resolveMigrationDatabaseConnectionString`), used only during startup: Drizzle's
// `migrate()`, the hand-written pre-migrate schema fixups in `runStartupTasks`, and
// `ensureApplicationRole`'s role/grant bootstrap all run DDL and must run as the
// role that owns the tables, never as the application role `getDatabase()` serves
// requests with. Kept apart from `pool`/`dbInstance` above so the two connections
// can never be silently conflated, and closed (`closeMigrationPool`) once startup
// finishes — nothing after boot needs it, and holding it open would just be two
// pools competing for the database's `max_connections`.
let migrationPool: Pool | undefined;
let migrationDbInstance: DatabaseInstance | undefined;

export function getMigrationDatabasePool(): Pool {
  if (!migrationPool) {
    migrationPool = new Pool({
      connectionString: resolveMigrationDatabaseConnectionString(),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      // Startup-only and single-purpose: migrations run one statement at a time,
      // never concurrently, so this pool never needs more than one connection.
      max: 1,
    });

    migrationPool.on("error", (error) => {
      console.error("Migration database pool: idle client error", error);
    });
  }

  return migrationPool;
}

export function getMigrationDatabase(): DatabaseInstance {
  if (!migrationDbInstance) {
    migrationDbInstance = drizzle(getMigrationDatabasePool(), {
      schema,
    });
  }

  return migrationDbInstance;
}

/**
 * Ends the migration pool's connection(s). Safe to call even if the pool was never
 * created (single-URL mode resolves to the same connection string as the app
 * pool, but still gets its own `Pool` instance here — closing it does not touch
 * `pool`/`dbInstance` above).
 */
export async function closeMigrationPool(): Promise<void> {
  if (migrationPool) {
    const toClose = migrationPool;
    migrationPool = undefined;
    migrationDbInstance = undefined;
    await toClose.end();
  }
}

const db = new Proxy({} as DatabaseInstance, {
  get(_target, property, receiver) {
    const value = Reflect.get(getDatabase(), property, receiver);

    if (typeof value === "function") {
      return value.bind(getDatabase());
    }

    return value;
  },
});

export default db;
