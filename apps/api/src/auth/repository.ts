import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import db, { schema } from "../database";

export function getActiveAgentSession(
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

export function getLocalFactorPolicyRow() {
  return db
    .select({ policy: schema.instanceSettingTable.localFactorPolicy })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
}

export function getActivePersonFactorState(userId: string) {
  return db
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      active: schema.personTable.active,
      enabled: schema.userTable.twoFactorEnabled,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
}

export function listPersonRoleMemberships(personId: string) {
  return db
    .select({ roleId: schema.membershipTable.roleId })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.membershipTable.roleId, schema.roleTable.id),
    )
    .where(eq(schema.membershipTable.personId, personId));
}

export function getRoleById(roleId: string) {
  return db
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, roleId))
    .limit(1);
}

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

export function getPendingActionForStepUp(
  actionId: string,
  personId: string,
  now: Date,
) {
  return db
    .select({
      action: schema.pendingActionTable.action,
      confirmation: schema.pendingActionTable.confirmationRequired,
      routeKey: schema.pendingActionTable.routeKey,
    })
    .from(schema.pendingActionTable)
    .where(
      and(
        eq(schema.pendingActionTable.id, actionId),
        eq(schema.pendingActionTable.requestedByPersonId, personId),
        eq(schema.pendingActionTable.state, "pending"),
        gt(schema.pendingActionTable.expiresAt, now),
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

export function getUserId(userId: string) {
  return db
    .select({ id: schema.userTable.id })
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

type StepUpExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function lockPendingActionForChallenge(
  executor: StepUpExecutor,
  actionId: string,
  personId: string,
) {
  return executor
    .select({
      id: schema.pendingActionTable.id,
      confirmation: schema.pendingActionTable.confirmationRequired,
    })
    .from(schema.pendingActionTable)
    .where(
      and(
        eq(schema.pendingActionTable.id, actionId),
        eq(schema.pendingActionTable.requestedByPersonId, personId),
        eq(schema.pendingActionTable.state, "pending"),
        gt(schema.pendingActionTable.expiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function countRecentPendingActionChallenges(
  executor: StepUpExecutor,
  personId: string,
  sessionId: string,
  pendingActionId: string,
) {
  return executor
    .select({ value: count() })
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.personId, personId),
        eq(schema.stepUpConfirmationTable.sessionId, sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
        eq(schema.stepUpConfirmationTable.pendingActionId, pendingActionId),
        gt(
          schema.stepUpConfirmationTable.createdAt,
          sql`now() - interval '15 minutes'`,
        ),
      ),
    );
}

export function countRecentOperationChallenges(
  executor: StepUpExecutor,
  personId: string,
  sessionId: string,
  operation: string,
) {
  return executor
    .select({ value: count() })
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.personId, personId),
        eq(schema.stepUpConfirmationTable.sessionId, sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
        eq(schema.stepUpConfirmationTable.operationKey, operation),
        gt(
          schema.stepUpConfirmationTable.createdAt,
          sql`now() - interval '15 minutes'`,
        ),
      ),
    );
}

export function lockPendingActionProof(
  executor: StepUpExecutor,
  input: {
    tokenHash: Buffer;
    personId: string;
    sessionId: string;
    pendingActionId: string;
  },
) {
  return executor
    .select({ id: schema.stepUpConfirmationTable.id })
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.tokenHash, input.tokenHash),
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
        eq(
          schema.stepUpConfirmationTable.pendingActionId,
          input.pendingActionId,
        ),
        eq(schema.stepUpConfirmationTable.state, "issued"),
        gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockOperationProof(
  executor: StepUpExecutor,
  input: {
    tokenHash: Buffer;
    personId: string;
    sessionId: string;
    operation: string;
    route: string;
    version: number;
  },
) {
  return executor
    .select()
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.tokenHash, input.tokenHash),
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
        eq(schema.stepUpConfirmationTable.operationKey, input.operation),
        eq(schema.stepUpConfirmationTable.routeKey, input.route),
        eq(schema.stepUpConfirmationTable.expectedVersion, input.version),
        eq(schema.stepUpConfirmationTable.state, "issued"),
        gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockActiveStepUpSession(
  executor: StepUpExecutor,
  sessionId: string,
  userId: string,
) {
  return executor
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, sessionId),
        eq(schema.sessionTable.userId, userId),
        eq(schema.sessionTable.portal, "agent"),
        gt(schema.sessionTable.expiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockPendingActionById(
  executor: StepUpExecutor,
  actionId: string,
  personId: string,
) {
  return executor
    .select({ id: schema.pendingActionTable.id })
    .from(schema.pendingActionTable)
    .where(
      and(
        eq(schema.pendingActionTable.id, actionId),
        eq(schema.pendingActionTable.requestedByPersonId, personId),
        eq(schema.pendingActionTable.state, "pending"),
        gt(schema.pendingActionTable.expiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockPendingActionChallenge(
  executor: StepUpExecutor,
  input: {
    id: string;
    personId: string;
    sessionId: string;
    pendingActionId: string;
  },
) {
  return executor
    .select()
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.id, input.id),
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
        eq(
          schema.stepUpConfirmationTable.pendingActionId,
          input.pendingActionId,
        ),
        eq(schema.stepUpConfirmationTable.state, "challenge"),
        gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
      ),
    )
    .for("update")
    .limit(1);
}

export function lockOperationChallenge(
  executor: StepUpExecutor,
  input: {
    id: string;
    personId: string;
    sessionId: string;
    operation: string;
    route: string;
    version: number;
  },
) {
  return executor
    .select()
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.id, input.id),
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
        eq(schema.stepUpConfirmationTable.operationKey, input.operation),
        eq(schema.stepUpConfirmationTable.routeKey, input.route),
        eq(schema.stepUpConfirmationTable.expectedVersion, input.version),
        eq(schema.stepUpConfirmationTable.state, "challenge"),
        gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
      ),
    )
    .for("update")
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
