import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type {
  BetterAuthOptions,
  DBAdapter,
  DBTransactionAdapter,
  Where,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, inArray, ne, type SQL } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema as importedSchema } from "../database";
import {
  apikeyTable,
  pendingActionTable,
  personTable,
  sessionTable,
  userTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { recordAuditWriteFailure } from "../instance/observability/runtime";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "./lifecycle-invalidation";
import { evaluateActionRequiredAccess } from "./required-access";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type ExplicitCredentialMutation = {
  kind: "api_key" | "session";
  route: string;
};

type PendingActionInvalidationReason =
  | "credential_revoked"
  | "reach_lost"
  | "capability_removed"
  | "version_changed"
  | "scope_changed";

type ExplicitCredentialMutationState = ExplicitCredentialMutation & {
  deleteFailure: unknown | null;
};

const explicitMutationStorage =
  new AsyncLocalStorage<ExplicitCredentialMutationState>();
const transactionStorage = new AsyncLocalStorage<PendingActionTransaction>();

type TotpEnrollmentContext = {
  pendingActionAuditFailures: number;
  mutationAuditFailures: number;
  afterCommit: Array<() => Promise<void>>;
};
const totpEnrollmentStorage = new AsyncLocalStorage<TotpEnrollmentContext>();

type AccountDeletionContext = {
  auditFailures: number;
  retryRequested: boolean;
  userId: string | null;
};
const accountDeletionStorage = new AsyncLocalStorage<AccountDeletionContext>();

export class AccountDeletionRetryError extends Error {
  constructor() {
    super("Account workspace closure changed; retry the deletion transaction");
    this.name = "AccountDeletionRetryError";
  }
}

/** The route marker is server-owned and exists only around the Better Auth handler. */
export async function withExplicitCredentialMutation<T>(
  mutation: ExplicitCredentialMutation,
  callback: () => Promise<T>,
): Promise<{ result: T; state: ExplicitCredentialMutationState }> {
  const state: ExplicitCredentialMutationState = {
    ...mutation,
    deleteFailure: null,
  };
  const result = await explicitMutationStorage.run(state, callback);
  return { result, state };
}

/**
 * The Drizzle adapter transaction callback exposes only a Better Auth adapter.
 * This proxy captures the underlying Drizzle transaction while preserving the
 * callback adapter and all Better Auth option transforms/hooks.
 */
function databaseWithTransactionContext(): typeof db {
  return new Proxy(db, {
    get(target, property, receiver) {
      const tx = transactionStorage.getStore();
      if (property === "transaction") {
        return (
          callback: (tx: PendingActionTransaction) => Promise<unknown>,
          ...args: unknown[]
        ) => {
          if (tx) {
            return tx.transaction(
              (nested) =>
                transactionStorage.run(nested, () => callback(nested)),
              ...(args as []),
            );
          }
          // `db` is itself a lazy proxy. Resolve its transaction method only
          // when Better Auth starts a transaction, not while auth.ts imports
          // or the Drizzle adapter inspects this proxy.
          const openTransaction = Reflect.get(
            target,
            property,
            receiver,
          ) as typeof db.transaction;
          return openTransaction(
            (opened) => transactionStorage.run(opened, () => callback(opened)),
            ...(args as []),
          );
        };
      }
      if (tx) return Reflect.get(tx, property, tx);
      return Reflect.get(target, property, receiver);
    },
  });
}

const credentialDatabase = databaseWithTransactionContext();

class CredentialRevocationFailure extends Error {
  constructor(readonly originalError: unknown) {
    super("Explicit credential revocation failed");
    this.name = "CredentialRevocationFailure";
  }
}

class TotpResponseRollback extends Error {
  constructor(readonly response: Response) {
    super("Better Auth returned a server failure during TOTP enrollment");
    this.name = "TotpResponseRollback";
  }
}

/** Run the installed TOTP API operation and all adapter/hook writes atomically. */
export async function withTotpSessionEnrollment<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const current = totpEnrollmentStorage.getStore();
  if (current) return callback();

  let outcome: {
    result: T;
    pendingActionAuditFailures: number;
    mutationAuditFailures: number;
    afterCommit: Array<() => Promise<void>>;
  };
  try {
    outcome = await db.transaction(async (tx) => {
      await lockPendingActionLifecycle(tx);
      const context: TotpEnrollmentContext = {
        pendingActionAuditFailures: 0,
        mutationAuditFailures: 0,
        afterCommit: [],
      };
      return totpEnrollmentStorage.run(context, () =>
        transactionStorage.run(tx, async () => {
          const { result, state } = await withExplicitCredentialMutation(
            { kind: "session", route: "/two-factor/verify-totp" },
            callback,
          );
          if (state.deleteFailure) {
            throw new CredentialRevocationFailure(state.deleteFailure);
          }
          if (result instanceof Response && result.status >= 500) {
            throw new TotpResponseRollback(result);
          }
          return {
            result,
            pendingActionAuditFailures: context.pendingActionAuditFailures,
            mutationAuditFailures: context.mutationAuditFailures,
            afterCommit: context.afterCommit,
          };
        }),
      );
    });
  } catch (error) {
    if (error instanceof TotpResponseRollback) return error.response as T;
    throw error;
  }

  await reportPendingActionAuditFailures(outcome.pendingActionAuditFailures);
  for (let index = 0; index < outcome.mutationAuditFailures; index += 1) {
    recordAuditWriteFailure("mutation");
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
  }
  for (const callback of outcome.afterCommit) await callback();
  return outcome.result;
}

export function isCredentialRevocationFailure(error: unknown): error is Error {
  return error instanceof CredentialRevocationFailure;
}

/** The TOTP after-hook may only register nontransactional effects after commit. */
export function afterTotpEnrollmentCommit(callback: () => Promise<void>) {
  const context = totpEnrollmentStorage.getStore();
  if (!context) {
    throw new Error("TOTP enrollment requires its outer transaction");
  }
  context.afterCommit.push(callback);
}

export function currentTotpEnrollmentTransaction() {
  const tx = transactionStorage.getStore();
  if (!tx || !totpEnrollmentStorage.getStore()) {
    throw new Error("TOTP enrollment requires its outer transaction");
  }
  return tx;
}

export function noteTotpEnrollmentMutationAuditFailure() {
  const context = totpEnrollmentStorage.getStore();
  if (!context) {
    throw new Error("TOTP enrollment requires its outer transaction");
  }
  context.mutationAuditFailures += 1;
}

/** Revoke exactly the peer sessions Better Auth's TOTP enrollment sweeps. */
export async function revokeTotpPeerSessions(
  userId: string,
  verifiedSessionId: string,
) {
  const tx = transactionStorage.getStore();
  const context = totpEnrollmentStorage.getStore();
  if (!tx || !context) {
    throw new Error(
      "TOTP peer-session revocation requires its outer transaction",
    );
  }
  const revokedSessions = await sessionRowsQuery(
    tx,
    and(
      eq(sessionTable.userId, userId),
      ne(sessionTable.id, verifiedSessionId),
    ),
  );
  for (const session of revokedSessions) {
    context.pendingActionAuditFailures +=
      await invalidatePendingActionsForCredential(tx, {
        type: "session",
        id: session.id,
      });
  }
  if (revokedSessions.length === 0) return;

  const selectedIds = revokedSessions.map(({ id }) => id).sort();
  const deletedSessions = await tx
    .delete(sessionTable)
    .where(inArray(sessionTable.id, selectedIds))
    .returning({ id: sessionTable.id });
  const deletedIds = deletedSessions.map(({ id }) => id).sort();
  if (
    selectedIds.length !== deletedIds.length ||
    selectedIds.some((id, index) => id !== deletedIds[index])
  ) {
    throw new Error("TOTP peer-session deletion did not match its locked set");
  }
}

/**
 * Run one exact Better Auth account-deletion entrypoint in a request-local
 * transaction. Its adapter calls, account cleanup hook and pending-action
 * invalidations all resolve to the same Drizzle transaction.
 */
export async function withAccountDeletionTransaction<T>(
  callback: () => Promise<T>,
): Promise<T> {
  const existing = accountDeletionStorage.getStore();
  if (existing) return callback();

  for (let attempt = 0; ; attempt += 1) {
    try {
      const outcome = await db.transaction(async (tx) => {
        await lockPendingActionLifecycle(tx);
        const context: AccountDeletionContext = {
          auditFailures: 0,
          retryRequested: false,
          userId: null,
        };
        return accountDeletionStorage.run(context, () =>
          transactionStorage.run(tx, async () => {
            const result = await callback();
            if (context.retryRequested) throw new AccountDeletionRetryError();
            if (context.userId) {
              const [remainingUser] = await tx
                .select({ id: userTable.id })
                .from(userTable)
                .where(eq(userTable.id, context.userId))
                .limit(1);
              if (remainingUser) {
                throw new Error(
                  "Better Auth account deletion did not complete",
                );
              }
            }
            return { result, auditFailures: context.auditFailures };
          }),
        );
      });
      await reportPendingActionAuditFailures(outcome.auditFailures);
      return outcome.result;
    } catch (error) {
      if (!(error instanceof AccountDeletionRetryError) || attempt >= 4) {
        throw error;
      }
    }
  }
}

/** Called by the existing Better Auth beforeDelete hook inside the outer tx. */
export async function invalidateAccountDeletionCredentials(
  userId: string,
  tx: PendingActionTransaction,
) {
  const context = accountDeletionStorage.getStore();
  if (!context || transactionStorage.getStore() !== tx) {
    throw new Error("Account deletion requires its request transaction");
  }
  context.userId = userId;
  const occurredAt = new Date();
  // Lock the linked identity before credential/action rows. Expiry cleanup may
  // already have removed the original session, but account teardown still
  // removes this person's ability to act on any remaining request.
  const linkedPeople = await tx
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .orderBy(personTable.id)
    .for("update");
  if (linkedPeople.length > 1) {
    throw new Error("Account deletion found multiple linked people");
  }
  const sessions = await tx
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(eq(sessionTable.userId, userId))
    .orderBy(sessionTable.id)
    .for("update");
  const apiKeys = await tx
    .select({ id: apikeyTable.id })
    .from(apikeyTable)
    .where(eq(apikeyTable.userId, userId))
    .orderBy(apikeyTable.id)
    .for("update");
  const credentials = [
    ...sessions.map(({ id }) => ({ type: "session" as const, id })),
    ...apiKeys.map(({ id }) => ({ type: "api_key" as const, id })),
  ].sort(
    (left, right) =>
      left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
  );
  for (const credential of credentials) {
    context.auditFailures += await invalidatePendingActionsForCredential(
      tx,
      credential,
      occurredAt,
    );
  }

  const personId = linkedPeople[0]?.id;
  if (!personId) return;
  const residualActions = await tx
    .select()
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.requestedByPersonId, personId),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .orderBy(pendingActionTable.id)
    .for("update");
  for (const action of residualActions) {
    context.auditFailures += await invalidatePendingActionRow(
      tx,
      action,
      "capability_removed",
      occurredAt,
    );
  }
}

export function currentAccountDeletionTransaction() {
  const context = accountDeletionStorage.getStore();
  const tx = transactionStorage.getStore();
  if (!context || !tx) {
    throw new Error("Account deletion requires its request transaction");
  }
  return tx;
}

export function hasAccountDeletionTransaction() {
  return accountDeletionStorage.getStore() !== undefined;
}

export function requestAccountDeletionRetry() {
  const context = accountDeletionStorage.getStore();
  if (!context) throw new Error("Account deletion retry has no request scope");
  context.retryRequested = true;
}

function currentTransaction(): PendingActionTransaction {
  const tx = transactionStorage.getStore();
  if (!tx) {
    throw new Error("Credential revocation requires its adapter transaction");
  }
  return tx;
}

type AdapterWhere = Where[];
type AdapterUpdateInput = Parameters<DBAdapter<BetterAuthOptions>["update"]>[0];

function exactSelector(where: AdapterWhere | undefined, allowedField: string) {
  const selector = where?.[0];
  if (
    !selector ||
    where?.length !== 1 ||
    selector.field !== allowedField ||
    selector.operator !== undefined
  ) {
    return undefined;
  }
  return selector;
}

function exactInSelector(
  where: AdapterWhere | undefined,
  allowedField: string,
) {
  const selector = where?.[0];
  if (
    !selector ||
    where?.length !== 1 ||
    selector.field !== allowedField ||
    selector.operator !== "in" ||
    !Array.isArray(selector.value) ||
    !selector.value.every((value) => typeof value === "string")
  ) {
    return undefined;
  }
  return selector;
}

/**
 * Permanently invalidate still-pending actions tied to one explicit credential
 * revocation. The caller holds the lifecycle gate and the credential row lock.
 */
export async function invalidatePendingActionsForCredential(
  tx: PendingActionTransaction,
  credential: { type: "session" | "api_key"; id: string },
  occurredAt = new Date(),
): Promise<number> {
  const pendingRows = await tx
    .select()
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.credentialType, credential.type),
        eq(pendingActionTable.credentialId, credential.id),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .orderBy(pendingActionTable.id)
    .for("update");

  let auditFailures = 0;
  for (const row of pendingRows) {
    auditFailures += await invalidatePendingActionRow(
      tx,
      row,
      "credential_revoked",
      occurredAt,
    );
  }
  return auditFailures;
}

async function invalidatePendingActionRow(
  tx: PendingActionTransaction,
  row: typeof pendingActionTable.$inferSelect,
  reason: PendingActionInvalidationReason,
  occurredAt: Date,
): Promise<number> {
  const [invalidated] = await tx
    .update(pendingActionTable)
    .set({
      state: "invalidated",
      invalidationReason: reason,
      decidedByPersonId: null,
      decisionSessionId: null,
      decidedAt: occurredAt,
    })
    .where(
      and(
        eq(pendingActionTable.id, row.id),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .returning({ id: pendingActionTable.id });
  if (!invalidated) return 0;

  await enqueueOutboxEvent(tx, {
    id: `evt_${randomUUID()}`,
    kind: "pending_action.decided",
    occurredAt: occurredAt.toISOString(),
    actor: {
      type: "system",
      id: null,
      name: "TaskDesk credential lifecycle",
    },
    scope: eventScope({
      workspaceId: row.workspaceId,
      organisationId: row.organisationId,
      projectId: row.projectId,
    }),
    payload: {
      key: row.id,
      url: `/agent/settings/profile/pending-actions/${row.id}`,
      pendingActionId: row.id,
      outcome: "invalidated",
      invalidationReason: reason,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });

  try {
    await tx.transaction(async (auditTx) =>
      appendAuditLog(auditTx, {
        actorId: null,
        actorType: "system",
        traceId: row.traceId,
        workspaceId: row.workspaceId,
        projectId: row.projectId,
        organisationId: row.organisationId,
        action: "pending_action.decided",
        entityType: "pending_action",
        entityId: row.id,
        before: { state: "pending" },
        after: { state: "invalidated", invalidationReason: reason },
      }),
    );
  } catch {
    return 1;
  }
  return 0;
}

export async function invalidatePendingActionForReason(
  tx: PendingActionTransaction,
  id: string,
  reason: Exclude<PendingActionInvalidationReason, "credential_revoked">,
  occurredAt: Date,
) {
  const [row] = await tx
    .select()
    .from(pendingActionTable)
    .where(
      and(
        eq(pendingActionTable.id, id),
        eq(pendingActionTable.state, "pending"),
      ),
    )
    .for("update")
    .limit(1);
  return row ? invalidatePendingActionRow(tx, row, reason, occurredAt) : 0;
}

async function runCredentialAdapterTransaction<R>(
  adapter: DBAdapter<BetterAuthOptions>,
  callback: (
    txAdapter: DBTransactionAdapter<BetterAuthOptions>,
    tx: PendingActionTransaction,
  ) => Promise<{ result: R; auditFailures?: number }>,
): Promise<R> {
  let outcome: { result: R; auditFailures?: number };
  try {
    outcome = await adapter.transaction(async (txAdapter) => {
      const tx = currentTransaction();
      await lockPendingActionLifecycle(tx);
      return callback(txAdapter, tx);
    });
  } catch (error) {
    const state = explicitMutationStorage.getStore();
    if (state) state.deleteFailure ??= error;
    throw error;
  }
  const accountDeletion = accountDeletionStorage.getStore();
  if (accountDeletion) {
    accountDeletion.auditFailures += outcome.auditFailures ?? 0;
  } else {
    await reportPendingActionAuditFailures(outcome.auditFailures ?? 0);
  }
  return outcome.result;
}

function markCredentialMutationFailure(error: unknown) {
  const state = explicitMutationStorage.getStore();
  if (state) {
    state.deleteFailure = error;
  }
}

function sessionRowsQuery(
  tx: PendingActionTransaction,
  condition: SQL | undefined,
) {
  if (!condition) throw new Error("A session revocation needs a selector");
  return tx
    .select({ id: sessionTable.id })
    .from(sessionTable)
    .where(condition)
    .orderBy(sessionTable.id)
    .for("update");
}

async function invalidatePendingActionsForCredentials(
  tx: PendingActionTransaction,
  credentials: Array<{ type: "session" | "api_key"; id: string }>,
  occurredAt: Date,
) {
  const unique = new Map(
    credentials.map((credential) => [
      `${credential.type}:${credential.id}`,
      credential,
    ]),
  );
  const ordered = [...unique.values()].sort(
    (left, right) =>
      left.type.localeCompare(right.type) || left.id.localeCompare(right.id),
  );
  let auditFailures = 0;
  for (const credential of ordered) {
    auditFailures += await invalidatePendingActionsForCredential(
      tx,
      credential,
      occurredAt,
    );
  }
  return auditFailures;
}

/** Lock and invalidate every session row a user-wide app mutation revokes. */
export async function lockAndInvalidateUserSessions(
  tx: PendingActionTransaction,
  userId: string,
  occurredAt = new Date(),
) {
  const sessions = await sessionRowsQuery(tx, eq(sessionTable.userId, userId));
  const auditFailures = await invalidatePendingActionsForCredentials(
    tx,
    sessions.map(({ id }) => ({ type: "session" as const, id })),
    occurredAt,
  );
  return { sessions, auditFailures };
}

/** Lock and invalidate the live sessions and API keys a user-wide mutation revokes. */
export async function lockAndInvalidateUserCredentials(
  tx: PendingActionTransaction,
  userId: string,
  occurredAt = new Date(),
) {
  const sessions = await lockAndInvalidateUserSessions(tx, userId, occurredAt);
  const apiKeys = await tx
    .select({ id: apikeyTable.id })
    .from(apikeyTable)
    .where(
      and(eq(apikeyTable.referenceId, userId), eq(apikeyTable.enabled, true)),
    )
    .orderBy(apikeyTable.id)
    .for("update");
  const auditFailures = await invalidatePendingActionsForCredentials(
    tx,
    apiKeys.map(({ id }) => ({ type: "api_key" as const, id })),
    occurredAt,
  );
  return {
    sessions: sessions.sessions,
    apiKeys,
    auditFailures: sessions.auditFailures + auditFailures,
  };
}

/** Lock and invalidate every session row the identity-connection disable removes. */
export async function lockAndInvalidateConnectionSessions(
  tx: PendingActionTransaction,
  connectionId: string,
  occurredAt = new Date(),
) {
  const sessions = await sessionRowsQuery(
    tx,
    eq(sessionTable.identityConnectionId, connectionId),
  );
  const auditFailures = await invalidatePendingActionsForCredentials(
    tx,
    sessions.map(({ id }) => ({ type: "session" as const, id })),
    occurredAt,
  );
  return { sessions, auditFailures };
}

function isExplicitSessionMutation(
  state: ExplicitCredentialMutationState | undefined,
) {
  return state?.kind === "session";
}

/** Build the installed Drizzle adapter and wrap only explicit PA-9 revocation writes. */
export function createCredentialAwareDrizzleAdapter() {
  return (options: BetterAuthOptions): DBAdapter<BetterAuthOptions> => {
    const base = drizzleAdapter(credentialDatabase, {
      provider: "pg",
      transaction: true,
      schema: {
        ...importedSchema,
        user: importedSchema.userTable,
        account: importedSchema.accountTable,
        session: importedSchema.sessionTable,
        verification: importedSchema.verificationTable,
        twoFactor: importedSchema.twoFactorTable,
        apikey: importedSchema.apikeyTable,
      },
    })(options);

    return {
      ...base,
      update: async <T>(input: AdapterUpdateInput) => {
        if (input.model !== "apikey") {
          return base.update<T>(input);
        }
        const updatesExpiry = input.update.expiresAt !== undefined;
        if (
          input.update.enabled !== false &&
          input.update.permissions === undefined &&
          !updatesExpiry
        ) {
          return base.update<T>(input);
        }
        const selector = exactSelector(input.where, "id");
        if (!selector || typeof selector.value !== "string") {
          markCredentialMutationFailure(
            new Error("Unexpected Better Auth API-key update selector"),
          );
          throw new Error("Unexpected Better Auth API-key update selector");
        }
        return runCredentialAdapterTransaction(base, async (txAdapter, tx) => {
          const [before] = await tx
            .select()
            .from(apikeyTable)
            .where(eq(apikeyTable.id, selector.value as string))
            .for("update");
          const now = new Date();
          const expiryExtensionAfterExpiry =
            before?.expiresAt !== null &&
            before?.expiresAt !== undefined &&
            before.expiresAt <= now &&
            input.update.expiresAt instanceof Date &&
            input.update.expiresAt > now;
          const expiryAuditFailures =
            before && expiryExtensionAfterExpiry
              ? await invalidatePendingActionsForCredential(
                  tx,
                  { type: "api_key", id: before.id },
                  now,
                )
              : 0;
          const result = await txAdapter.update<T>(input);
          if (input.update.enabled === false) {
            const auditFailures =
              expiryAuditFailures +
              (before
                ? await invalidatePendingActionsForCredential(tx, {
                    type: "api_key",
                    id: before.id,
                  })
                : 0);
            return { result, auditFailures };
          }

          let auditFailures = expiryAuditFailures;
          if (before && input.update.permissions !== undefined) {
            const pendingRows = await tx
              .select()
              .from(pendingActionTable)
              .where(
                and(
                  eq(pendingActionTable.credentialType, "api_key"),
                  eq(pendingActionTable.credentialId, before.id),
                  eq(pendingActionTable.state, "pending"),
                ),
              )
              .orderBy(pendingActionTable.id)
              .for("update");
            const permissionsAfter =
              typeof input.update.permissions === "string"
                ? input.update.permissions
                : null;
            for (const row of pendingRows) {
              if (row.credentialType !== "api_key") continue;
              const requiredAccessInput = {
                requestedByPersonId: row.requestedByPersonId,
                credentialType: "api_key" as const,
                credentialId: row.credentialId,
                action: row.action,
                targetType: row.targetType,
                targetIds: row.targetIds,
                routeKey: row.routeKey,
                workspaceId: row.workspaceId,
                projectId: row.projectId,
                organisationId: row.organisationId,
                confirmationRequired: row.confirmationRequired,
                payload: row.payload,
                payloadHash: row.payloadHash,
                targetVersions: row.targetVersions,
              };
              const beforeDecision = await evaluateActionRequiredAccess(
                tx,
                requiredAccessInput,
                { apiKeyPermissions: before.permissions },
              );
              if (!beforeDecision.allowed) continue;
              const afterDecision = await evaluateActionRequiredAccess(
                tx,
                requiredAccessInput,
                { apiKeyPermissions: permissionsAfter },
              );
              const reason =
                afterDecision.failure === "reach"
                  ? "reach_lost"
                  : afterDecision.failure === "capability"
                    ? "capability_removed"
                    : undefined;
              if (reason) {
                auditFailures += await invalidatePendingActionForReason(
                  tx,
                  row.id,
                  reason,
                  new Date(),
                );
              }
            }
          }
          return { result, auditFailures };
        });
      },
      delete: async (input) => {
        const state = explicitMutationStorage.getStore();
        if (state?.kind === "api_key" && input.model === "apikey") {
          const selector = exactSelector(input.where, "id");
          if (!selector || typeof selector.value !== "string") {
            markCredentialMutationFailure(
              new Error("Unexpected Better Auth API-key delete selector"),
            );
            throw new Error("Unexpected Better Auth API-key delete selector");
          }
          return runCredentialAdapterTransaction(
            base,
            async (txAdapter, tx) => {
              const [before] = await tx
                .select({ id: apikeyTable.id })
                .from(apikeyTable)
                .where(eq(apikeyTable.id, selector.value as string))
                .for("update");
              const result = await txAdapter.delete(input);
              const auditFailures = before
                ? await invalidatePendingActionsForCredential(tx, {
                    type: "api_key",
                    id: before.id,
                  })
                : 0;
              return { result, auditFailures };
            },
          );
        }

        if (isExplicitSessionMutation(state) && input.model === "session") {
          const tokenSelector = exactSelector(input.where, "token");
          const idSelector = exactSelector(input.where, "id");
          const selector = tokenSelector ?? idSelector;
          if (!selector || typeof selector.value !== "string") {
            markCredentialMutationFailure(
              new Error("Unexpected Better Auth session delete selector"),
            );
            throw new Error("Unexpected Better Auth session delete selector");
          }
          return runCredentialAdapterTransaction(
            base,
            async (txAdapter, tx) => {
              const now = new Date();
              const condition =
                selector.field === "token"
                  ? eq(sessionTable.token, selector.value as string)
                  : eq(sessionTable.id, selector.value as string);
              const revokedRows = await sessionRowsQuery(tx, condition);
              const result = await txAdapter.delete(input);
              let auditFailures = 0;
              for (const row of revokedRows) {
                auditFailures += await invalidatePendingActionsForCredential(
                  tx,
                  { type: "session", id: row.id },
                  now,
                );
              }
              return { result, auditFailures };
            },
          );
        }
        return base.delete(input);
      },
      deleteMany: async (input) => {
        const state = explicitMutationStorage.getStore();
        if (isExplicitSessionMutation(state) && input.model === "session") {
          const userSelector = exactSelector(input.where, "userId");
          const tokenSelector = exactInSelector(input.where, "token");
          if (!userSelector && !tokenSelector) {
            markCredentialMutationFailure(
              new Error("Unexpected Better Auth session deleteMany selector"),
            );
            throw new Error(
              "Unexpected Better Auth session deleteMany selector",
            );
          }
          return runCredentialAdapterTransaction(
            base,
            async (txAdapter, tx) => {
              const now = new Date();
              const condition = userSelector
                ? eq(sessionTable.userId, userSelector.value as string)
                : inArray(sessionTable.token, tokenSelector?.value as string[]);
              const revokedRows = await sessionRowsQuery(tx, condition);
              const result = await txAdapter.deleteMany(input);
              let auditFailures = 0;
              for (const row of revokedRows) {
                auditFailures += await invalidatePendingActionsForCredential(
                  tx,
                  { type: "session", id: row.id },
                  now,
                );
              }
              return { result, auditFailures };
            },
          );
        }
        return base.deleteMany(input);
      },
    };
  };
}
