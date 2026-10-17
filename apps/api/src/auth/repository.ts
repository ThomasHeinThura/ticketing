import { timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { dbNowUtc } from "../utils/db-time";

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

export async function getActiveSessionForStepUp(
  sessionId: string,
  userId: string,
  now: Date,
) {
  return await db
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
      targetType: schema.pendingActionTable.targetType,
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

export async function countRecentOperationChallenges(
  executor: StepUpExecutor,
  personId: string,
  sessionId: string,
  operation: string,
) {
  return await executor
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

export async function lockOperationProof(
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
  return await executor
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

export async function lockActiveStepUpSession(
  executor: StepUpExecutor,
  sessionId: string,
  userId: string,
) {
  return await executor
    .select({ id: schema.sessionTable.id })
    .from(schema.sessionTable)
    .where(
      and(
        eq(schema.sessionTable.id, sessionId),
        eq(schema.sessionTable.userId, userId),
        eq(schema.sessionTable.portal, "agent"),
        // `session.expires_at` is a UTC wall clock in a `timestamp without time zone` column: a
        // bare `now()` would be coerced through the session TimeZone (#631).
        gt(schema.sessionTable.expiresAt, dbNowUtc()),
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

export async function lockOperationChallenge(
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
  return await executor
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

export async function createOperationChallengeRecord(
  executor: StepUpExecutor,
  input: {
    id: string;
    personId: string;
    sessionId: string;
    operation: string;
    route: string;
    version: number;
    bodyHash: Buffer;
    nonceHash: Buffer;
    limit: number;
  },
): Promise<Date | null> {
  const clock = await executor.execute<{
    challenge_expires_at: string;
  }>(sql`SELECT (now() + interval '5 minutes')::text AS challenge_expires_at`);
  const clockRow = clock.rows[0];
  if (!clockRow) throw new Error("Unable to read database challenge time");
  const expiresAt = new Date(clockRow.challenge_expires_at);

  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.operation}))`,
  );
  const [recent] = await countRecentOperationChallenges(
    executor,
    input.personId,
    input.sessionId,
    input.operation,
  );
  if ((recent?.value ?? 0) >= input.limit) return null;

  await executor
    .update(schema.stepUpConfirmationTable)
    .set({ challengeExpiresAt: sql`now()` })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
        eq(schema.stepUpConfirmationTable.operationKey, input.operation),
        eq(schema.stepUpConfirmationTable.state, "challenge"),
        gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
      ),
    );
  await executor
    .update(schema.stepUpConfirmationTable)
    .set({ state: "consumed", consumedAt: new Date() })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "operation"),
        eq(schema.stepUpConfirmationTable.operationKey, input.operation),
        eq(schema.stepUpConfirmationTable.state, "issued"),
      ),
    );
  await executor.insert(schema.stepUpConfirmationTable).values({
    id: input.id,
    personId: input.personId,
    sessionId: input.sessionId,
    bindingKind: "operation",
    pendingActionId: null,
    operationKey: input.operation,
    routeKey: input.route,
    expectedVersion: input.version,
    bodyHash: input.bodyHash,
    challengeNonceHash: input.nonceHash,
    state: "challenge",
    challengeExpiresAt: expiresAt,
  });
  return expiresAt;
}

export async function issueOperationTokenRecord(
  executor: StepUpExecutor,
  input: {
    id: string;
    personId: string;
    sessionId: string;
    userId: string;
    operation: string;
    route: string;
    version: number;
    bodyHash: Buffer;
    nonceHash: Buffer;
    tokenHash: Buffer;
    verifyAuthentication: () => Promise<
      "password" | "totp" | "backup_code" | null
    >;
  },
): Promise<{
  authMethod: "password" | "totp" | "backup_code";
  issuedAt: Date;
  tokenExpiresAt: Date;
} | null> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.operation}))`,
  );
  const [activeSession] = await lockActiveStepUpSession(
    executor,
    input.sessionId,
    input.userId,
  );
  if (!activeSession) return null;
  const [challenge] = await lockOperationChallenge(executor, input);
  if (!challenge?.bodyHash || !challenge.challengeNonceHash) return null;
  if (!timingSafeEqual(challenge.bodyHash, input.bodyHash)) return null;
  if (!timingSafeEqual(challenge.challengeNonceHash, input.nonceHash)) {
    // A challenge authorizes one verifier attempt; unrelated ids remain untouched.
    await executor
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`now()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
        ),
      );
    return null;
  }
  const authMethod = await input.verifyAuthentication();
  if (!authMethod) {
    await executor
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`now()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
        ),
      );
    return null;
  }
  const clock = await executor.execute<{
    issued_at: string;
    token_expires_at: string;
  }>(
    sql`SELECT now()::text AS issued_at, (now() + interval '5 minutes')::text AS token_expires_at`,
  );
  const clockRow = clock.rows[0];
  if (!clockRow) throw new Error("Unable to read database token time");
  const issuedAt = new Date(clockRow.issued_at);
  const tokenExpiresAt = new Date(clockRow.token_expires_at);
  const updated = await executor
    .update(schema.stepUpConfirmationTable)
    .set({
      state: "issued",
      tokenHash: input.tokenHash,
      authMethod,
      authenticatedAt: issuedAt,
      issuedAt,
      tokenExpiresAt,
    })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.id, input.id),
        eq(schema.stepUpConfirmationTable.state, "challenge"),
        gt(schema.stepUpConfirmationTable.challengeExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.stepUpConfirmationTable.id });
  return updated.length === 1 ? { authMethod, issuedAt, tokenExpiresAt } : null;
}

export async function consumeOperationProofRecord(
  executor: StepUpExecutor,
  input: {
    tokenHash: Buffer;
    personId: string;
    sessionId: string;
    operation: string;
    route: string;
    version: number;
    bodyHash: Buffer;
  },
): Promise<{ authMethod: "password" | "totp" | "backup_code" } | null> {
  const [proof] = await lockOperationProof(executor, input);
  if (!proof?.bodyHash || !proof.authMethod) return null;
  if (!timingSafeEqual(proof.bodyHash, input.bodyHash)) return null;
  const consumed = await executor
    .update(schema.stepUpConfirmationTable)
    .set({ state: "consumed", consumedAt: sql`now()` })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.id, proof.id),
        eq(schema.stepUpConfirmationTable.state, "issued"),
        gt(schema.stepUpConfirmationTable.tokenExpiresAt, sql`now()`),
      ),
    )
    .returning({ id: schema.stepUpConfirmationTable.id });
  if (consumed.length !== 1) return null;
  if (
    proof.authMethod !== "password" &&
    proof.authMethod !== "totp" &&
    proof.authMethod !== "backup_code"
  ) {
    return null;
  }
  return { authMethod: proof.authMethod };
}

export async function getCustomerPortalIdentityRow(userId: string) {
  return await db
    .select({
      personId: schema.personTable.id,
      organisationId: schema.personTable.organisationId,
      side: schema.personTable.side,
      personActive: schema.personTable.active,
      isPlaceholder: schema.personTable.isPlaceholder,
      organisationActive: schema.organisationTable.active,
      organisationPortalAccess: schema.organisationTable.portalAccess,
      organisationDeletedAt: schema.organisationTable.deletedAt,
      scope: schema.membershipTable.scope,
      scopeId: schema.membershipTable.scopeId,
      seesAll: schema.membershipTable.seesAll,
      roleId: schema.roleTable.id,
      roleKey: schema.roleTable.key,
      roleScope: schema.roleTable.scope,
      roleWorkspaceId: schema.roleTable.workspaceId,
      roleIsSystem: schema.roleTable.isSystem,
      roleRank: schema.roleTable.rank,
      roleCapabilities: schema.roleTable.capabilities,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.organisationTable,
      eq(schema.personTable.organisationId, schema.organisationTable.id),
    )
    .innerJoin(
      schema.membershipTable,
      eq(schema.membershipTable.personId, schema.personTable.id),
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
      ),
    );
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
