import { createId } from "@paralleldrive/cuid2";
import { and, asc, eq, sql } from "drizzle-orm";
import db from "../database";
import { apiKeyRateLimitCounterTable } from "../database/schema";
import { appendAuditSavepoint } from "../events/audit-savepoint";
import { eventScope } from "../events/outbox";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../instance/observability/audit-failure-notifier";
import { enqueueNotificationEvent } from "../notification/fanout";
import { resolveApiKeyAutoDisabledRecipient } from "../notification/recipient-resolvers";
import { invalidatePendingActionsForCredential } from "../pending-action/credential-invalidation";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "../pending-action/lifecycle-invalidation";
import {
  DEFAULT_API_KEY_BURST_THRESHOLD,
  MAX_API_KEY_BURST_THRESHOLD,
  MIN_API_KEY_BURST_THRESHOLD,
  type RateLimitBucket,
  type RateLimitClass,
  rateLimitConstraints,
} from "./rate-limit";
import { disableApiKey, loadApiKeyKind, lockApiKey } from "./repository";

const WINDOW_MS = 60_000;
const BUCKETS: readonly RateLimitBucket[] = [
  "mcp_bulk",
  "mcp_burst",
  "mcp_write",
  "total",
];
const AUTO_DISABLE_REASON = "mcp_burst_threshold_exceeded";

export type SharedRateLimitInput = {
  apiKeyId: string;
  isMcp: boolean;
  keyLimitPerMinute: number | null;
  mcpWriteCeilingPerMinute?: number;
  apiKeyBurstThreshold?: number;
  requestClass: RateLimitClass;
};

export type SharedRateLimitDecision =
  | { allowed: true; limit: number; remaining: number }
  | { allowed: false; limit: number; retryAfterSeconds: number }
  | { allowed: false; disabled: true };

type Counter = typeof apiKeyRateLimitCounterTable.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * This sentinel always escapes the first transaction, rolling back every rate bucket before
 * the lifecycle gate is acquired. The gated retry then locks lifecycle → key → counters.
 */
class BurstThresholdCrossing extends Error {}

function constraintsFor(input: SharedRateLimitInput) {
  return rateLimitConstraints(
    {
      isMcp: input.isMcp,
      keyLimitPerMinute: input.keyLimitPerMinute,
      ...(input.mcpWriteCeilingPerMinute === undefined
        ? {}
        : { mcpWriteCeilingPerMinute: input.mcpWriteCeilingPerMinute }),
    },
    input.requestClass,
  );
}

async function ensureCounterRows(tx: Tx, apiKeyId: string): Promise<void> {
  // Initialize every bucket before taking any counter row lock. The FK check for the new
  // bucket must not happen after another transaction has locked counters in a different order.
  await tx
    .insert(apiKeyRateLimitCounterTable)
    .values(
      BUCKETS.map((bucket) => ({
        apiKeyId,
        bucket,
        windowStartedAt: new Date(0),
        requestCount: 0,
      })),
    )
    .onConflictDoNothing();
}

async function lockCounterRows(tx: Tx, apiKeyId: string): Promise<Counter[]> {
  const rows = await tx
    .select()
    .from(apiKeyRateLimitCounterTable)
    .where(eq(apiKeyRateLimitCounterTable.apiKeyId, apiKeyId))
    .orderBy(asc(apiKeyRateLimitCounterTable.bucket))
    .for("update");
  if (rows.length !== BUCKETS.length)
    throw new Error("API key rate limit counters unavailable");
  return rows;
}

async function databaseNow(tx: Tx): Promise<Date> {
  const result = await tx.execute(sql`SELECT clock_timestamp() AS now`);
  const value = (result.rows[0] as { now?: unknown } | undefined)?.now;
  // node-postgres and PGlite return timestamptz as Date, while other supported drivers may
  // return the ISO string representation.
  const now =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (!now || Number.isNaN(now.getTime()))
    throw new Error("API key rate limit clock unavailable");
  return now;
}

function currentCounter(counter: Counter, now: Date) {
  const expired =
    now.getTime() - counter.windowStartedAt.getTime() >= WINDOW_MS;
  return {
    expired,
    count: expired ? 0 : counter.requestCount,
    windowStartedAt: expired ? now : counter.windowStartedAt,
  };
}

async function writeCounter(
  tx: Tx,
  apiKeyId: string,
  bucket: RateLimitBucket,
  value: { count: number; windowStartedAt: Date },
) {
  await tx
    .update(apiKeyRateLimitCounterTable)
    .set({
      windowStartedAt: value.windowStartedAt,
      requestCount: value.count,
    })
    .where(
      and(
        eq(apiKeyRateLimitCounterTable.apiKeyId, apiKeyId),
        eq(apiKeyRateLimitCounterTable.bucket, bucket),
      ),
    );
}

function refusalFor(
  constraints: ReturnType<typeof constraintsFor>,
  counterByBucket: Map<string, Counter>,
  now: Date,
): SharedRateLimitDecision | null {
  const blocked = constraints
    .map((constraint) => ({
      ...constraint,
      counter: counterByBucket.get(constraint.bucket),
    }))
    .filter(({ counter, limit }) => {
      if (!counter) throw new Error("API key rate limit counter missing");
      const current = currentCounter(counter, now);
      return !current.expired && current.count >= limit;
    });
  if (blocked.length === 0) return null;

  return {
    allowed: false,
    limit: Math.min(...constraints.map(({ limit }) => limit)),
    retryAfterSeconds: Math.max(
      1,
      ...blocked.map(({ counter }) => {
        if (!counter) throw new Error("API key rate limit counter missing");
        return Math.ceil(
          (counter.windowStartedAt.getTime() + WINDOW_MS - now.getTime()) /
            1000,
        );
      }),
    ),
  };
}

async function invalidateForAutoDisable(tx: Tx, apiKeyId: string) {
  await disableApiKey(tx, apiKeyId, AUTO_DISABLE_REASON);
  const pendingActionAuditFailures =
    await invalidatePendingActionsForCredential(tx, {
      type: "api_key",
      id: apiKeyId,
    });

  const eventId = `evt_${createId()}`;
  const occurredAt = new Date().toISOString();
  await enqueueNotificationEvent(
    tx,
    {
      id: eventId,
      kind: "api_key.auto_disabled",
      occurredAt,
      actor: { type: "system", id: null, name: "TaskDesk" },
      scope: eventScope({
        workspaceId: null,
        organisationId: null,
        projectId: null,
      }),
      payload: {
        key: apiKeyId,
        url: "/agent/settings/profile/api-keys",
        apiKeyId,
        reason: AUTO_DISABLE_REASON,
      },
      causationId: null,
      depth: 0,
      originAutomationId: null,
    },
    { resolveRecipients: resolveApiKeyAutoDisabledRecipient },
  );
  const auditFailed = await appendAuditSavepoint(tx, {
    actorId: null,
    actorType: "system",
    apiKeyId,
    action: "api_key.auto_disabled",
    entityType: "api_key",
    entityId: apiKeyId,
    after: { reason: AUTO_DISABLE_REASON },
  });

  return { pendingActionAuditFailures, auditFailed };
}

async function evaluateAttempt(
  tx: Tx,
  input: SharedRateLimitInput,
  options: { retryUnderLifecycleGate: boolean },
): Promise<{
  decision: SharedRateLimitDecision;
  pendingActionAuditFailures: number;
  auditFailed: boolean;
}> {
  const constraints = constraintsFor(input);
  const burstEnabled = input.isMcp && input.requestClass !== "read";
  const threshold =
    input.apiKeyBurstThreshold ?? DEFAULT_API_KEY_BURST_THRESHOLD;
  if (
    burstEnabled &&
    (!Number.isInteger(threshold) ||
      threshold < MIN_API_KEY_BURST_THRESHOLD ||
      threshold > MAX_API_KEY_BURST_THRESHOLD)
  )
    throw new Error("API key burst threshold unavailable");
  await ensureCounterRows(tx, input.apiKeyId);
  const counters = await lockCounterRows(tx, input.apiKeyId);
  const counterByBucket = new Map(
    counters.map((counter) => [counter.bucket, counter]),
  );
  const now = await databaseNow(tx);
  const burst = counterByBucket.get("mcp_burst");
  if (!burst) throw new Error("API key burst counter unavailable");

  const nextBurst = burstEnabled ? currentCounter(burst, now) : null;
  const nextBurstCount = nextBurst ? nextBurst.count + 1 : null;
  const crossing = nextBurstCount !== null && nextBurstCount > threshold;
  if (crossing && !options.retryUnderLifecycleGate)
    throw new BurstThresholdCrossing();

  const refusal = refusalFor(constraints, counterByBucket, now);
  if (crossing) {
    if (!nextBurst || nextBurstCount === null)
      throw new Error("API key burst counter unavailable");
    await writeCounter(tx, input.apiKeyId, "mcp_burst", {
      count: nextBurstCount,
      windowStartedAt: nextBurst.windowStartedAt,
    });
    const lifecycle = await invalidateForAutoDisable(tx, input.apiKeyId);
    return {
      decision: { allowed: false, disabled: true },
      ...lifecycle,
    };
  }

  if (burstEnabled && nextBurst && nextBurstCount !== null) {
    await writeCounter(tx, input.apiKeyId, "mcp_burst", {
      count: nextBurstCount,
      windowStartedAt: nextBurst.windowStartedAt,
    });
  }
  if (refusal) {
    return {
      decision: refusal,
      pendingActionAuditFailures: 0,
      auditFailed: false,
    };
  }

  let remaining = Number.POSITIVE_INFINITY;
  for (const constraint of constraints) {
    const counter = counterByBucket.get(constraint.bucket);
    if (!counter) throw new Error("API key rate limit counter missing");
    const current = currentCounter(counter, now);
    const requestCount = current.count + 1;
    await writeCounter(tx, input.apiKeyId, constraint.bucket, {
      windowStartedAt: current.windowStartedAt,
      count: requestCount,
    });
    remaining = Math.min(remaining, constraint.limit - requestCount);
  }

  return {
    decision: {
      allowed: true,
      limit: Math.min(...constraints.map(({ limit }) => limit)),
      remaining: Math.max(0, remaining),
    },
    pendingActionAuditFailures: 0,
    auditFailed: false,
  };
}

async function retryBurstCrossingUnderLifecycleGate(
  input: SharedRateLimitInput,
): Promise<{
  decision: SharedRateLimitDecision;
  pendingActionAuditFailures: number;
  auditFailed: boolean;
}> {
  return db.transaction(async (tx) => {
    // Match explicit key revocation: lifecycle gate first, then key row, then all counters.
    await lockPendingActionLifecycle(tx);
    const lockedKey = await lockApiKey(tx, input.apiKeyId);
    if (!lockedKey?.enabled)
      return {
        decision: { allowed: false, disabled: true },
        pendingActionAuditFailures: 0,
        auditFailed: false,
      };
    const currentKey = await loadApiKeyKind(input.apiKeyId, tx);
    if (!currentKey.isMcp || currentKey.disabledAt) {
      return {
        decision: { allowed: false, disabled: true },
        pendingActionAuditFailures: 0,
        auditFailed: false,
      };
    }
    return evaluateAttempt(
      tx,
      {
        ...input,
        isMcp: currentKey.isMcp,
        keyLimitPerMinute: currentKey.rateLimitPerMinute,
      },
      { retryUnderLifecycleGate: true },
    );
  });
}

async function recordPostCommitAuditFailures(result: {
  pendingActionAuditFailures: number;
  auditFailed: boolean;
}) {
  if (result.pendingActionAuditFailures > 0)
    await reportPendingActionAuditFailures(result.pendingActionAuditFailures);
  if (result.auditFailed)
    await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
}

/**
 * AK-4/MC-10/MC-22 admission shared by every API process. Normal limit refusals do not
 * consume total/write/bulk admission buckets, but each verified MCP write attempt consumes
 * the bounded burst bucket. Crossing attempts roll back the fast counter transaction and
 * retry under the pending-action lifecycle → key → counter lock order before disabling.
 */
export async function consumeApiKeyRateLimit(
  input: SharedRateLimitInput,
): Promise<SharedRateLimitDecision> {
  try {
    const result = await db.transaction((tx) =>
      evaluateAttempt(tx, input, { retryUnderLifecycleGate: false }),
    );
    await recordPostCommitAuditFailures(result);
    return result.decision;
  } catch (error) {
    if (!(error instanceof BurstThresholdCrossing)) throw error;
  }

  const result = await retryBurstCrossingUnderLifecycleGate(input);
  await recordPostCommitAuditFailures(result);
  return result.decision;
}
