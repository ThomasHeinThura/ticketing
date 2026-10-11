import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type {
  BetterAuthOptions,
  DBAdapter,
  DBTransactionAdapter,
  Where,
} from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { and, eq, inArray } from "drizzle-orm";
import { appendAuditLog } from "../audit/audit-writer";
import db, { schema as importedSchema } from "../database";
import {
  apikeyTable,
  pendingActionTable,
  sessionTable,
} from "../database/schema";
import { enqueueOutboxEvent, eventScope } from "../events/outbox";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "./lifecycle-invalidation";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type ExplicitCredentialMutation = {
  kind: "api_key" | "session";
  route: string;
};

type ExplicitCredentialMutationState = ExplicitCredentialMutation & {
  deleteFailure: unknown | null;
};

const explicitMutationStorage =
  new AsyncLocalStorage<ExplicitCredentialMutationState>();
const transactionStorage = new AsyncLocalStorage<PendingActionTransaction>();

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
  const openTransaction = db.transaction.bind(db);
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return (
          callback: (tx: PendingActionTransaction) => Promise<unknown>,
          ...args: unknown[]
        ) =>
          openTransaction(
            (tx) => transactionStorage.run(tx, () => callback(tx)),
            ...(args as []),
          );
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

const credentialDatabase = databaseWithTransactionContext();

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
    const [invalidated] = await tx
      .update(pendingActionTable)
      .set({
        state: "invalidated",
        invalidationReason: "credential_revoked",
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
    if (!invalidated) continue;

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
        invalidationReason: "credential_revoked",
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
          after: {
            state: "invalidated",
            invalidationReason: "credential_revoked",
          },
        }),
      );
    } catch {
      auditFailures += 1;
    }
  }
  return auditFailures;
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
  await reportPendingActionAuditFailures(outcome.auditFailures ?? 0);
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
  condition: ReturnType<typeof eq>,
) {
  return tx
    .select({ id: sessionTable.id, expiresAt: sessionTable.expiresAt })
    .from(sessionTable)
    .where(condition)
    .orderBy(sessionTable.id)
    .for("update");
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
        const state = explicitMutationStorage.getStore();
        if (
          state?.kind !== "api_key" ||
          input.model !== "apikey" ||
          input.update.enabled !== false
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
          const result = await txAdapter.update<T>(input);
          const auditFailures = before
            ? await invalidatePendingActionsForCredential(tx, {
                type: "api_key",
                id: before.id,
              })
            : 0;
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
              const liveRows = (await sessionRowsQuery(tx, condition)).filter(
                (row) => row.expiresAt > now,
              );
              const result = await txAdapter.delete(input);
              let auditFailures = 0;
              for (const row of liveRows) {
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
              const liveRows = (await sessionRowsQuery(tx, condition)).filter(
                (row) => row.expiresAt > now,
              );
              const result = await txAdapter.deleteMany(input);
              let auditFailures = 0;
              for (const row of liveRows) {
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
