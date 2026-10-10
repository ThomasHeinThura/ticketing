import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import db, { schema } from "../database";

export function getAuthUserLocale(email: string) {
  return db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
}

export function countAuthUsers() {
  return db.select({ value: count() }).from(schema.userTable);
}

export function countAuthUsersForExecutor(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  return executor.select({ value: count() }).from(schema.userTable);
}

export function getSetupCompletionMarker(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  return executor
    .select({ setupCompletedAt: schema.instanceSettingTable.setupCompletedAt })
    .from(schema.instanceSettingTable)
    .limit(1);
}

export function getFirstUserWorkspaceMembership(userId: string) {
  return db
    .select({ workspaceId: schema.workspaceUserTable.workspaceId })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, userId))
    .limit(1);
}

export function getActiveSessionForStepUp(
  sessionId: string,
  userId: string,
  now: Date,
) {
  return db
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, sessionId),
        eq(schema.sessionTable.userId, userId),
        eq(schema.sessionTable.portal, "agent"),
        gt(schema.sessionTable.expiresAt, now),
      ),
    )
    .limit(1);
}

export function getUserFactorEnabled(userId: string) {
  return db
    .select({ enabled: schema.userTable.twoFactorEnabled })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
}

export function getScimConnectionDetails(connectionId: string) {
  return db
    .select({
      version: schema.identityConnectionTable.configVersion,
      childId: schema.scimConnectionTable.identityConnectionId,
    })
    .from(schema.identityConnectionTable)
    .innerJoin(
      schema.scimConnectionTable,
      eq(
        schema.scimConnectionTable.identityConnectionId,
        schema.identityConnectionTable.id,
      ),
    )
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getScimConfigVersion(connectionId: string) {
  return db
    .select({ version: schema.identityConnectionTable.configVersion })
    .from(schema.identityConnectionTable)
    .innerJoin(
      schema.scimConnectionTable,
      eq(
        schema.scimConnectionTable.identityConnectionId,
        schema.identityConnectionTable.id,
      ),
    )
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getIdentityConfigVersion(connectionId: string) {
  return db
    .select({ version: schema.identityConnectionTable.configVersion })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export function getPasswordCredential(userId: string) {
  return db
    .select({ password: schema.accountTable.password })
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.userId, userId),
        eq(schema.accountTable.providerId, "credential"),
      ),
    )
    .limit(1);
}

export function getCustomerPortalIdentityRow(userId: string) {
  return db
    .select({ personId: schema.personTable.id })
    .from(schema.personTable)
    .innerJoin(
      schema.organisationTable,
      eq(schema.personTable.organisationId, schema.organisationTable.id),
    )
    .innerJoin(
      schema.membershipTable,
      and(
        eq(schema.membershipTable.personId, schema.personTable.id),
        eq(schema.membershipTable.scope, "organisation"),
        eq(schema.membershipTable.scopeId, schema.personTable.organisationId),
      ),
    )
    .innerJoin(
      schema.roleTable,
      eq(schema.membershipTable.roleId, schema.roleTable.id),
    )
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
        eq(schema.personTable.isPlaceholder, false),
        eq(schema.organisationTable.active, true),
        eq(schema.organisationTable.portalAccess, true),
        isNull(schema.organisationTable.deletedAt),
        eq(schema.roleTable.scope, "organisation"),
        eq(schema.roleTable.key, "customer"),
      ),
    )
    .limit(1);
}

export function getStoredAuthPluginConfigRows() {
  return db
    .select({
      id: schema.instancePluginConfigTable.id,
      pluginId: schema.instancePluginConfigTable.pluginId,
      enabled: schema.instancePluginConfigTable.enabled,
      scope: schema.instancePluginConfigTable.scope,
      portalScope: schema.instancePluginConfigTable.portalScope,
      configVersion: schema.instancePluginConfigTable.configVersion,
    })
    .from(schema.instancePluginConfigTable)
    .where(sql`${schema.instancePluginConfigTable.pluginId} like 'auth.%'`);
}

export function getIdentityConnectionConfigVersions() {
  return db
    .select({
      id: schema.identityConnectionTable.id,
      configVersion: schema.identityConnectionTable.configVersion,
    })
    .from(schema.identityConnectionTable);
}
