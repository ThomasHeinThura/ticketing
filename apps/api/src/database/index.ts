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
import { resolveDatabaseConnectionString } from "./resolve-database-url";
import {
  accountTable,
  activityTable,
  apikeyTable,
  assetTable,
  auditLogTable,
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
  auditLogTable,
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

type DatabaseInstance = ReturnType<typeof drizzle<typeof schema>>;

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
