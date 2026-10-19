import { timingSafeEqual } from "node:crypto";
import type { JsonValue } from "@taskdesk/domain";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { SETUP_TOKEN_SINGLETON_ID } from "../instance/setup-token";
import { dbClockUtc } from "../utils/db-time";

export type StepUpExecutor = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type PendingActionStepUpAdmission = {
  action: string;
  targetType: string;
  confirmation: string;
  routeKey: string;
};

export type VerifiedStepUpAuthentication =
  | "password"
  | "totp"
  | "backup_code"
  | {
      authMethod: "password" | "totp" | "backup_code";
      revalidate: (executor: StepUpExecutor) => Promise<boolean>;
    };

export async function getAuthUserLocale(email: string) {
  return await db
    .select({ locale: schema.userTable.locale })
    .from(schema.userTable)
    .where(eq(schema.userTable.email, email))
    .limit(1);
}

export async function countAuthUsers() {
  return await db.select({ value: count() }).from(schema.userTable);
}

export async function countAuthUsersForExecutor(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  return await executor.select({ value: count() }).from(schema.userTable);
}

export async function getSetupCompletionMarker(
  executor: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0],
) {
  return await executor
    .select({ setupCompletedAt: schema.instanceSettingTable.setupCompletedAt })
    .from(schema.instanceSettingTable)
    .limit(1);
}

export async function lockFirstUserPromotion(
  executor: StepUpExecutor,
): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(2026)`);
}

export async function promoteFirstAuthUser(
  executor: StepUpExecutor,
  userId: string,
): Promise<void> {
  await executor
    .update(schema.userTable)
    .set({ role: "admin" })
    .where(eq(schema.userTable.id, userId));
}

export async function completeFirstUserSetup(
  executor: StepUpExecutor,
): Promise<void> {
  await executor
    .insert(schema.instanceSettingTable)
    .values({
      id: SETUP_TOKEN_SINGLETON_ID,
      setupCompletedAt: new Date(),
      setupTokenHash: null,
      setupTokenExpiresAt: null,
    })
    .onConflictDoUpdate({
      target: schema.instanceSettingTable.id,
      set: {
        setupCompletedAt: new Date(),
        setupTokenHash: null,
        setupTokenExpiresAt: null,
        updatedAt: new Date(),
      },
    });
}

export async function getFirstUserWorkspaceMembership(userId: string) {
  return await db
    .select({ workspaceId: schema.workspaceUserTable.workspaceId })
    .from(schema.workspaceUserTable)
    .where(eq(schema.workspaceUserTable.userId, userId))
    .limit(1);
}

export async function updateSessionPortal(
  executor: Executor,
  sessionId: string,
  portal: "agent" | "customer",
): Promise<void> {
  await executor
    .update(schema.sessionTable)
    .set({ portal })
    .where(eq(schema.sessionTable.id, sessionId));
}

export async function updateSessionActiveOrganizationId(
  executor: Executor,
  sessionId: string,
  activeOrganizationId: string,
): Promise<void> {
  await executor
    .update(schema.sessionTable)
    .set({ activeOrganizationId })
    .where(eq(schema.sessionTable.id, sessionId));
}

export async function getActiveSessionForStepUp(
  sessionId: string,
  userId: string,
  now: Date,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
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

export async function getPendingActionForStepUp(
  actionId: string,
  personId: string,
  now: Date,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
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

export async function getUserFactorEnabled(userId: string) {
  return await db
    .select({ enabled: schema.userTable.twoFactorEnabled })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
}

export async function getActiveLocalFactorIdentity(
  userId: string,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
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

export async function getInactiveLocalFactorIdentity(
  userId: string,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.active, false),
      ),
    )
    .limit(1);
}

export async function getLocalFactorPolicySetting(
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
    .select({ policy: schema.instanceSettingTable.localFactorPolicy })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
}

export async function getLocalFactorMembershipRoles(
  personId: string,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
    .select({ roleId: schema.membershipTable.roleId })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.membershipTable.roleId, schema.roleTable.id),
    )
    .where(eq(schema.membershipTable.personId, personId));
}

export async function getConfiguredLocalFactorRole(
  roleId: string,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
    .select({ id: schema.roleTable.id })
    .from(schema.roleTable)
    .where(eq(schema.roleTable.id, roleId))
    .limit(1);
}

export async function isCurrentInstanceAdminForStepUp(
  userId: string,
  executor: typeof db | StepUpExecutor = db,
) {
  const [admin] = await executor
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .innerJoin(
      schema.personTable,
      and(
        eq(schema.personTable.userId, schema.userTable.id),
        eq(schema.personTable.side, "staff"),
        eq(schema.personTable.active, true),
      ),
    )
    .where(
      and(eq(schema.userTable.id, userId), eq(schema.userTable.role, "admin")),
    )
    .limit(1);
  return admin !== undefined;
}

export async function getUserId(userId: string) {
  return await db
    .select({ id: schema.userTable.id })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);
}

export async function getScimConnectionDetails(connectionId: string) {
  return await db
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

export async function getScimConfigVersion(connectionId: string) {
  return await db
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

export async function getIdentityConfigVersion(connectionId: string) {
  return await db
    .select({ version: schema.identityConnectionTable.configVersion })
    .from(schema.identityConnectionTable)
    .where(eq(schema.identityConnectionTable.id, connectionId))
    .limit(1);
}

export async function getPasswordCredential(
  userId: string,
  executor: typeof db | StepUpExecutor = db,
) {
  return await executor
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

export async function createPendingActionChallengeRecord(
  executor: StepUpExecutor,
  input: {
    id: string;
    personId: string;
    sessionId: string;
    pendingActionId: string;
    nonceHash: Buffer;
    limit: number;
    onLimit: () => never;
  },
): Promise<Date | null> {
  const [action] = await executor
    .select({
      id: schema.pendingActionTable.id,
      confirmation: schema.pendingActionTable.confirmationRequired,
    })
    .from(schema.pendingActionTable)
    .where(
      and(
        eq(schema.pendingActionTable.id, input.pendingActionId),
        eq(schema.pendingActionTable.requestedByPersonId, input.personId),
        eq(schema.pendingActionTable.state, "pending"),
        gt(schema.pendingActionTable.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .for("update")
    .limit(1);
  if (!action?.confirmation.endsWith("_step_up")) return null;

  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.pendingActionId}))`,
  );
  const [recent] = await executor
    .select({ value: count() })
    .from(schema.stepUpConfirmationTable)
    .where(
      and(
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
        eq(
          schema.stepUpConfirmationTable.pendingActionId,
          input.pendingActionId,
        ),
        gt(
          schema.stepUpConfirmationTable.createdAt,
          sql`now() - interval '15 minutes'`,
        ),
      ),
    );
  if ((recent?.value ?? 0) >= input.limit) input.onLimit();

  await executor
    .update(schema.stepUpConfirmationTable)
    .set({ challengeExpiresAt: sql`now()` })
    .where(
      and(
        eq(schema.stepUpConfirmationTable.personId, input.personId),
        eq(schema.stepUpConfirmationTable.sessionId, input.sessionId),
        eq(schema.stepUpConfirmationTable.bindingKind, "pending_action"),
        eq(
          schema.stepUpConfirmationTable.pendingActionId,
          input.pendingActionId,
        ),
        eq(schema.stepUpConfirmationTable.state, "challenge"),
        gt(
          schema.stepUpConfirmationTable.challengeExpiresAt,
          sql`clock_timestamp()`,
        ),
      ),
    );
  await executor
    .update(schema.stepUpConfirmationTable)
    .set({ tokenExpiresAt: sql`now()` })
    .where(
      and(
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
    );

  const clock = await executor.execute<{ challenge_expires_at: string }>(
    sql`SELECT (now() + interval '5 minutes')::text AS challenge_expires_at`,
  );
  const clockRow = clock.rows[0];
  if (!clockRow) throw new Error("Database time is unavailable");
  const expiresAt = new Date(clockRow.challenge_expires_at);
  await executor.insert(schema.stepUpConfirmationTable).values({
    id: input.id,
    personId: input.personId,
    sessionId: input.sessionId,
    bindingKind: "pending_action",
    pendingActionId: input.pendingActionId,
    operationKey: null,
    routeKey: null,
    expectedVersion: null,
    bodyHash: null,
    challengeNonceHash: input.nonceHash,
    state: "challenge",
    challengeExpiresAt: expiresAt,
  });
  return expiresAt;
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

export async function consumePendingActionProofRecord(
  executor: StepUpExecutor,
  input: {
    tokenHash: Buffer;
    personId: string;
    sessionId: string;
    pendingActionId: string;
  },
): Promise<{ id: string } | null> {
  const [proof] = await executor
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
  if (!proof) return null;

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
  return consumed.length === 1 ? { id: proof.id } : null;
}

export async function issuePendingActionTokenRecord(
  executor: StepUpExecutor,
  input: {
    id: string;
    personId: string;
    sessionId: string;
    userId: string;
    pendingActionId: string;
    nonceHash: Buffer;
    tokenHash: Buffer;
    expectedPendingAction?: PendingActionStepUpAdmission;
    verifyAuthentication: (
      executor: StepUpExecutor,
    ) => Promise<VerifiedStepUpAuthentication | null>;
    finalize: <T>(
      callback: (executor: StepUpExecutor) => Promise<T>,
    ) => Promise<T | null>;
  },
): Promise<{
  authMethod: "password" | "totp" | "backup_code";
  tokenExpiresAt: Date;
} | null> {
  await executor.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${input.sessionId}), hashtext(${input.pendingActionId}))`,
  );
  const [activeSession] = await lockActiveStepUpSession(
    executor,
    input.sessionId,
    input.userId,
  );
  if (!activeSession) return null;

  const [action] = await executor
    .select({
      id: schema.pendingActionTable.id,
      action: schema.pendingActionTable.action,
      targetType: schema.pendingActionTable.targetType,
      confirmation: schema.pendingActionTable.confirmationRequired,
      routeKey: schema.pendingActionTable.routeKey,
    })
    .from(schema.pendingActionTable)
    .where(
      and(
        eq(schema.pendingActionTable.id, input.pendingActionId),
        eq(schema.pendingActionTable.requestedByPersonId, input.personId),
        eq(schema.pendingActionTable.state, "pending"),
        gt(schema.pendingActionTable.expiresAt, sql`clock_timestamp()`),
      ),
    )
    .for("update")
    .limit(1);
  if (!action) return null;
  if (
    input.expectedPendingAction &&
    (action.action !== input.expectedPendingAction.action ||
      action.targetType !== input.expectedPendingAction.targetType ||
      action.confirmation !== input.expectedPendingAction.confirmation ||
      action.routeKey !== input.expectedPendingAction.routeKey)
  ) {
    return null;
  }

  const [challenge] = await executor
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
        gt(
          schema.stepUpConfirmationTable.challengeExpiresAt,
          sql`clock_timestamp()`,
        ),
      ),
    )
    .for("update")
    .limit(1);
  if (!challenge) return null;

  if (!timingSafeEqual(challenge.challengeNonceHash, input.nonceHash)) {
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

  const verification = await input.verifyAuthentication(executor);
  if (!verification) {
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
  const authMethod =
    typeof verification === "string" ? verification : verification.authMethod;

  const finalized = await input.finalize(async (finalExecutor) => {
    const [currentSession] = await lockActiveStepUpSession(
      finalExecutor,
      input.sessionId,
      input.userId,
    );
    if (!currentSession) return null;
    const [currentAction] = await finalExecutor
      .select({
        id: schema.pendingActionTable.id,
        action: schema.pendingActionTable.action,
        targetType: schema.pendingActionTable.targetType,
        confirmation: schema.pendingActionTable.confirmationRequired,
        routeKey: schema.pendingActionTable.routeKey,
      })
      .from(schema.pendingActionTable)
      .where(
        and(
          eq(schema.pendingActionTable.id, input.pendingActionId),
          eq(schema.pendingActionTable.requestedByPersonId, input.personId),
          eq(schema.pendingActionTable.state, "pending"),
          gt(schema.pendingActionTable.expiresAt, sql`clock_timestamp()`),
        ),
      )
      .for("update")
      .limit(1);
    if (!currentAction) return null;
    if (
      input.expectedPendingAction &&
      (currentAction.action !== input.expectedPendingAction.action ||
        currentAction.targetType !== input.expectedPendingAction.targetType ||
        currentAction.confirmation !==
          input.expectedPendingAction.confirmation ||
        currentAction.routeKey !== input.expectedPendingAction.routeKey)
    ) {
      return null;
    }
    const [currentChallenge] = await finalExecutor
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
          gt(
            schema.stepUpConfirmationTable.challengeExpiresAt,
            sql`clock_timestamp()`,
          ),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !currentChallenge?.challengeNonceHash ||
      !timingSafeEqual(currentChallenge.challengeNonceHash, input.nonceHash)
    ) {
      return null;
    }
    if (
      typeof verification !== "string" &&
      !(await verification.revalidate(finalExecutor))
    ) {
      await finalExecutor
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, input.id),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    const clock = await finalExecutor.execute<{
      issued_at: string;
      token_expires_at: string;
    }>(
      sql`SELECT clock_timestamp()::text AS issued_at, (clock_timestamp() + interval '5 minutes')::text AS token_expires_at`,
    );
    const clockRow = clock.rows[0];
    if (!clockRow) throw new Error("Database time is unavailable");
    const issuedAt = new Date(clockRow.issued_at);
    const tokenExpiresAt = new Date(clockRow.token_expires_at);
    const updated = await finalExecutor
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
          gt(
            schema.stepUpConfirmationTable.challengeExpiresAt,
            sql`clock_timestamp()`,
          ),
        ),
      )
      .returning({ id: schema.stepUpConfirmationTable.id });
    return updated.length === 1 ? { authMethod, tokenExpiresAt } : null;
  });
  if (finalized === null) {
    // Proof attempts are one-shot even when a recovered mint savepoint failed.
    // This write uses the admitted outer executor after that savepoint rolled back.
    await executor
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
        ),
      );
  }
  return finalized;
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
        gt(schema.sessionTable.expiresAt, dbClockUtc()),
      ),
    )
    .for("update")
    .limit(1);
}

export async function hasLiveStepUpSession(
  executor: StepUpExecutor,
  sessionId: string,
  userId: string,
) {
  const [session] = await lockActiveStepUpSession(executor, sessionId, userId);
  return session !== undefined;
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
        gt(
          schema.stepUpConfirmationTable.challengeExpiresAt,
          sql`clock_timestamp()`,
        ),
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
    verifyAuthentication: (
      executor: StepUpExecutor,
    ) => Promise<VerifiedStepUpAuthentication | null>;
    finalize: <T>(
      callback: (executor: StepUpExecutor) => Promise<T>,
    ) => Promise<T | null>;
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
  const verification = await input.verifyAuthentication(executor);
  if (!verification) {
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
  const authMethod =
    typeof verification === "string" ? verification : verification.authMethod;
  const finalized = await input.finalize(async (finalExecutor) => {
    const [currentSession] = await lockActiveStepUpSession(
      finalExecutor,
      input.sessionId,
      input.userId,
    );
    if (!currentSession) return null;
    const [currentChallenge] = await lockOperationChallenge(
      finalExecutor,
      input,
    );
    if (
      !currentChallenge?.bodyHash ||
      !currentChallenge.challengeNonceHash ||
      !timingSafeEqual(currentChallenge.bodyHash, input.bodyHash) ||
      !timingSafeEqual(currentChallenge.challengeNonceHash, input.nonceHash)
    ) {
      return null;
    }
    if (
      typeof verification !== "string" &&
      !(await verification.revalidate(finalExecutor))
    ) {
      await finalExecutor
        .update(schema.stepUpConfirmationTable)
        .set({ challengeExpiresAt: sql`clock_timestamp()` })
        .where(
          and(
            eq(schema.stepUpConfirmationTable.id, input.id),
            eq(schema.stepUpConfirmationTable.state, "challenge"),
          ),
        );
      return null;
    }
    const clock = await finalExecutor.execute<{
      issued_at: string;
      token_expires_at: string;
    }>(
      sql`SELECT clock_timestamp()::text AS issued_at, (clock_timestamp() + interval '5 minutes')::text AS token_expires_at`,
    );
    const clockRow = clock.rows[0];
    if (!clockRow) throw new Error("Unable to read database token time");
    const issuedAt = new Date(clockRow.issued_at);
    const tokenExpiresAt = new Date(clockRow.token_expires_at);
    const updated = await finalExecutor
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
          gt(
            schema.stepUpConfirmationTable.challengeExpiresAt,
            sql`clock_timestamp()`,
          ),
        ),
      )
      .returning({ id: schema.stepUpConfirmationTable.id });
    return updated.length === 1
      ? { authMethod, issuedAt, tokenExpiresAt }
      : null;
  });
  if (finalized === null) {
    // Keep a successful verifier one-shot when post-check or minting fails.
    await executor
      .update(schema.stepUpConfirmationTable)
      .set({ challengeExpiresAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(schema.stepUpConfirmationTable.id, input.id),
          eq(schema.stepUpConfirmationTable.state, "challenge"),
        ),
      );
  }
  return finalized;
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
  const rows = await db
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
  type CustomerPortalIdentityRow = Omit<
    (typeof rows)[number],
    "roleCapabilities"
  > & { roleCapabilities: JsonValue };
  return rows.map(
    (row): CustomerPortalIdentityRow => ({
      ...row,
      roleCapabilities: row.roleCapabilities as JsonValue,
    }),
  );
}

export async function getStoredAuthPluginConfigRows() {
  return await db
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

export async function getIdentityConnectionConfigVersions() {
  return await db
    .select({
      id: schema.identityConnectionTable.id,
      configVersion: schema.identityConnectionTable.configVersion,
    })
    .from(schema.identityConnectionTable);
}
