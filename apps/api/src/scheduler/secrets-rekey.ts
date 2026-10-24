import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import { runSecretsRekey } from "../secrets/rekey";
import { withJobLease } from "./leader-lock";

// background-jobs.md: `secrets-rekey`, on demand, lease TTL 30 minutes.
export const SECRETS_REKEY_JOB = "secrets-rekey";
export const SECRETS_REKEY_LEASE_MS = 30 * 60 * 1000;

export type SecretsRekeyJobOutcome =
  | (Awaited<ReturnType<typeof runSecretsRekey>> & { status: "completed" })
  | { status: "held_elsewhere" };

/**
 * `GM-13`: the registered job body, started by the elevated rotate-secrets action. Leader-locked
 * and resumable; writes `secrets.rekeyed` with counts only, never a key id, envelope or secret.
 */
export async function runSecretsRekeyJob(actor: {
  userId: string | null;
  traceId?: string | null;
}): Promise<SecretsRekeyJobOutcome> {
  const startedAt = Date.now();
  try {
    const outcome = await withJobLease<SecretsRekeyJobOutcome>(
      SECRETS_REKEY_JOB,
      async () => {
        const result = await runSecretsRekey();
        await appendAuditLog(db, {
          action: "secrets.rekeyed",
          actorId: actor.userId,
          actorType: actor.userId ? "person" : "system",
          traceId: actor.traceId ?? null,
          workspaceId: null,
          entityType: "instance",
          entityId: "singleton",
          after: {
            pluginsRekeyed: result.rekeyed.plugins,
            identityConnectionsRekeyed: result.rekeyed.identityConnections,
            textSecretsRekeyed: result.rekeyed.textSecrets,
            pluginsFailed: result.failed.plugins,
            identityConnectionsFailed: result.failed.identityConnections,
            textSecretsFailed: result.failed.textSecrets,
          },
        });
        return { ...result, status: "completed" as const };
      },
      () => ({ status: "held_elsewhere" as const }),
      SECRETS_REKEY_LEASE_MS,
    );
    console.log(
      JSON.stringify({
        job: SECRETS_REKEY_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed:
          outcome.status === "completed"
            ? outcome.rekeyed.plugins +
              outcome.rekeyed.identityConnections +
              outcome.rekeyed.textSecrets
            : 0,
        outcome:
          outcome.status === "completed" &&
          outcome.failed.plugins +
            outcome.failed.identityConnections +
            outcome.failed.textSecrets >
            0
            ? "degraded"
            : "ok",
      }),
    );
    return outcome;
  } catch (error) {
    console.log(
      JSON.stringify({
        job: SECRETS_REKEY_JOB,
        durationMs: Date.now() - startedAt,
        itemsProcessed: null,
        outcome: "failed",
      }),
    );
    throw error;
  }
}
