import type { RekeyProgress } from "../../secrets/rekey";

/** `god-mode.md` Health: each check reports one of these. */
export type HealthState = "ok" | "degraded" | "failing" | "unknown";

export type HealthCheck = {
  key: string;
  state: HealthState;
  /** Counts and booleans only; never a secret, key id or row content. */
  detail: Record<string, number | boolean | null>;
};

/** Database: a query round trip over 100 ms is degraded; unreachable is failing. */
export const DATABASE_DEGRADED_MS = 100;

export function classifyDatabase(latencyMs: number | null): HealthCheck {
  return {
    key: "database",
    state:
      latencyMs === null
        ? "failing"
        : latencyMs > DATABASE_DEGRADED_MS
          ? "degraded"
          : "ok",
    detail: { latencyMs },
  };
}

/**
 * `GM-14`: encryption-key rotation. Complete (every secret under the current key) is ok, and is
 * the signal that the operator may remove `TASKDESK_ENCRYPTION_KEY_PREVIOUS`. Rows still under
 * an old key are degraded while the previous key is configured (a rekey is pending) and failing
 * when it is not, because those secrets can no longer be decrypted.
 */
export function classifySecrets(progress: RekeyProgress): HealthCheck {
  const pending =
    progress.pending.plugins +
    progress.pending.identityConnections +
    progress.pending.textSecrets;
  const total =
    progress.total.plugins +
    progress.total.identityConnections +
    progress.total.textSecrets;
  const state: HealthState =
    progress.currentKeyId === null
      ? total === 0
        ? "unknown"
        : "failing"
      : pending === 0
        ? progress.expiredInvitationDeliveryEnvelopes > 0
          ? "degraded"
          : "ok"
        : progress.previousKeyConfigured
          ? "degraded"
          : "failing";
  return {
    key: "secrets_encryption",
    state,
    detail: {
      keyConfigured: progress.currentKeyId !== null,
      previousKeyConfigured: progress.previousKeyConfigured,
      secretsTotal: total,
      secretsPendingRekey: pending,
      expiredInvitationDeliveryEnvelopes:
        progress.expiredInvitationDeliveryEnvelopes,
      rekeyComplete: progress.complete,
      safeToRemovePreviousKey:
        progress.complete && progress.previousKeyConfigured,
    },
  };
}

/** Outbox and notification deliveries: any dead letter is failing (`god-mode.md` Health). */
export function classifyDeliveries(counts: {
  outboxDead: number;
  outboxPending: number;
  deliveriesDead: number;
  deliveriesPending: number;
}): HealthCheck {
  return {
    key: "outbox",
    state:
      counts.outboxDead > 0 || counts.deliveriesDead > 0 ? "failing" : "ok",
    detail: { ...counts },
  };
}
