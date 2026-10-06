import { config } from "dotenv-mono";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  accountTableRelations,
  activityTableRelations,
  apikeyTableRelations,
  assetTableRelations,
  columnTableRelations,
  documentLinkTableRelations,
  externalIdentityTableRelations,
  externalLinkTableRelations,
  identityConnectionTableRelations,
  invitationTableRelations,
  labelTableRelations,
  membershipGrantTableRelations,
  membershipTableRelations,
  milestoneTableRelations,
  notificationTableRelations,
  oidcGroupMappingTableRelations,
  organisationQuotaTableRelations,
  organisationTableRelations,
  personTableRelations,
  prerequisiteTableRelations,
  projectSlugClaimTableRelations,
  projectTableRelations,
  provisioningEventTableRelations,
  roleTableRelations,
  scheduledTransitionTableRelations,
  scimConnectionTableRelations,
  scimGroupDirectoryMemberTableRelations,
  scimGroupMappingTableRelations,
  scimGroupMemberTableRelations,
  scimGroupTableRelations,
  serviceCalendarTableRelations,
  sessionTableRelations,
  slaGoalTableRelations,
  slaPolicyTableRelations,
  slaPolicyVersionTableRelations,
  stakeholderTableRelations,
  stateTableRelations,
  stateTemplateTableRelations,
  stepUpConfirmationTableRelations,
  taskActivityTableRelations,
  taskCommentTableRelations,
  taskRelationTableRelations,
  taskReminderSentTableRelations,
  taskTableRelations,
  teamMemberTableRelations,
  teamTableRelations,
  timeEntryTableRelations,
  twoFactorTableRelations,
  userNotificationPreferenceTableRelations,
  userNotificationWorkspaceProjectTableRelations,
  userNotificationWorkspaceRuleTableRelations,
  userTableRelations,
  verificationTableRelations,
  watcherTableRelations,
  workflowRuleTableRelations,
  workflowTableRelations,
  workflowTransitionTableRelations,
  workflowVersionTableRelations,
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
  approvalTable,
  assetTable,
  attachmentTable,
  auditLogTable,
  cannedResponseTable,
  columnTable,
  commentTable,
  commentVersionTable,
  documentLinkTable,
  externalIdentityTable,
  externalLinkTable,
  identityConnectionTable,
  instanceFeatureFlagTable,
  instanceSettingTable,
  invitationTable,
  jobLeaseTable,
  labelTable,
  legalHoldTable,
  membershipGrantTable,
  membershipTable,
  milestoneTable,
  notificationTable,
  oidcGroupMappingTable,
  organisationQuotaTable,
  organisationRequestTypeTable,
  organisationTable,
  outboxTable,
  pendingActionTable,
  personTable,
  prerequisiteTable,
  projectFeatureFlagTable,
  projectSlugClaimTable,
  projectTable,
  provisioningEventTable,
  requestParticipantTable,
  requestTypeTable,
  requestTypeVersionTable,
  roleTable,
  scheduledTransitionTable,
  scimConnectionTable,
  scimGroupDirectoryMemberTable,
  scimGroupMappingTable,
  scimGroupMemberTable,
  scimGroupTable,
  serviceCalendarTable,
  sessionTable,
  slaGoalTable,
  slaPolicyTable,
  slaPolicyVersionTable,
  stakeholderTable,
  stateTable,
  stateTemplateTable,
  stepUpConfirmationTable,
  submissionMessageTable,
  submissionTable,
  taskActivityTable,
  taskCommentTable,
  taskRelationTable,
  taskReminderSentTable,
  taskTable,
  teamMemberTable,
  teamTable,
  timeEntryTable,
  twoFactorTable,
  userAvatarTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  userTable,
  verificationTable,
  watcherTable,
  workflowRuleTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  workItemKeyAliasTable,
  workItemKeyClaimTable,
  workItemTable,
  workItemTypeTable,
  workspaceFeatureFlagTable,
  workspaceRoleTable,
  workspaceTable,
  workspaceUserTable,
} from "./schema";

config();

export const schema = {
  approvalTable,
  accountTable,
  assetTable,
  activityTable,
  attachmentTable,
  auditLogTable,
  taskActivityTable,
  apikeyTable,
  cannedResponseTable,
  columnTable,
  commentTable,
  commentVersionTable,
  taskCommentTable,
  documentLinkTable,
  externalLinkTable,
  instanceSettingTable,
  identityConnectionTable,
  scimConnectionTable,
  externalIdentityTable,
  oidcGroupMappingTable,
  scimGroupMappingTable,
  membershipGrantTable,
  scimGroupMemberTable,
  scimGroupTable,
  scimGroupDirectoryMemberTable,
  provisioningEventTable,
  invitationTable,
  instanceFeatureFlagTable,
  jobLeaseTable,
  labelTable,
  legalHoldTable,
  membershipTable,
  milestoneTable,
  notificationTable,
  outboxTable,
  organisationQuotaTable,
  organisationTable,
  pendingActionTable,
  personTable,
  prerequisiteTable,
  projectSlugClaimTable,
  projectTable,
  projectFeatureFlagTable,
  organisationRequestTypeTable,
  requestParticipantTable,
  requestTypeTable,
  requestTypeVersionTable,
  submissionMessageTable,
  submissionTable,
  roleTable,
  serviceCalendarTable,
  slaGoalTable,
  slaPolicyTable,
  slaPolicyVersionTable,
  sessionTable,
  stepUpConfirmationTable,
  stakeholderTable,
  stateTable,
  stateTemplateTable,
  taskRelationTable,
  taskReminderSentTable,
  taskTable,
  teamMemberTable,
  teamTable,
  timeEntryTable,
  twoFactorTable,
  userTable,
  userAvatarTable,
  userNotificationPreferenceTable,
  userNotificationWorkspaceProjectTable,
  userNotificationWorkspaceRuleTable,
  verificationTable,
  watcherTable,
  workflowRuleTable,
  workflowTable,
  workflowTransitionTable,
  workflowVersionTable,
  scheduledTransitionTable,
  workItemKeyAliasTable,
  workItemKeyClaimTable,
  workItemTable,
  workItemTypeTable,
  workspaceRoleTable,
  workspaceFeatureFlagTable,
  workspaceTable,
  workspaceUserTable,
  accountTableRelations,
  assetTableRelations,
  activityTableRelations,
  taskActivityTableRelations,
  apikeyTableRelations,
  columnTableRelations,
  taskCommentTableRelations,
  documentLinkTableRelations,
  externalLinkTableRelations,
  invitationTableRelations,
  identityConnectionTableRelations,
  scimConnectionTableRelations,
  externalIdentityTableRelations,
  oidcGroupMappingTableRelations,
  scimGroupMappingTableRelations,
  membershipGrantTableRelations,
  scimGroupMemberTableRelations,
  scimGroupTableRelations,
  scimGroupDirectoryMemberTableRelations,
  provisioningEventTableRelations,
  labelTableRelations,
  membershipTableRelations,
  milestoneTableRelations,
  notificationTableRelations,
  organisationQuotaTableRelations,
  organisationTableRelations,
  personTableRelations,
  prerequisiteTableRelations,
  projectSlugClaimTableRelations,
  projectTableRelations,
  roleTableRelations,
  slaGoalTableRelations,
  slaPolicyTableRelations,
  slaPolicyVersionTableRelations,
  serviceCalendarTableRelations,
  sessionTableRelations,
  stepUpConfirmationTableRelations,
  stakeholderTableRelations,
  stateTableRelations,
  stateTemplateTableRelations,
  taskRelationTableRelations,
  taskReminderSentTableRelations,
  taskTableRelations,
  teamMemberTableRelations,
  teamTableRelations,
  timeEntryTableRelations,
  twoFactorTableRelations,
  userTableRelations,
  userNotificationPreferenceTableRelations,
  userNotificationWorkspaceProjectTableRelations,
  userNotificationWorkspaceRuleTableRelations,
  verificationTableRelations,
  watcherTableRelations,
  workflowRuleTableRelations,
  workflowTableRelations,
  workflowTransitionTableRelations,
  workflowVersionTableRelations,
  scheduledTransitionTableRelations,
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
      // One client retains the migration advisory lock while Drizzle's dialect
      // and the transactional provenance cutover use a second pooled connection.
      max: 2,
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
