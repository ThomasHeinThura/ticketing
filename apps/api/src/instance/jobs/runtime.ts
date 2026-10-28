import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  evaluatePolicy,
  instanceScope,
  NO_SINGLE_RESOURCE,
  normaliseRouteKey,
} from "@taskdesk/permissions";
import { sql } from "drizzle-orm";
import db from "../../database";
import type { Executor } from "../../database/executor";
import { executorOrDefault } from "../../database/executor";
import { resolveIdentity } from "../../permissions/resolve-identity";
import { policyRegistry } from "../../policy-registry";
import {
  assertJobExecutionOwned,
  JobExecutionReservationLostError,
  withJobExecutionReservation,
} from "../../scheduler/leader-lock";
import {
  claimJobLease,
  releaseJobLease,
  renewJobLease,
} from "../../scheduler/repository";

const RUN_LEASE_SECONDS = 60;
const RUN_HEARTBEAT_MS = 10_000;
const QUEUE_POLL_MS = 1_000;
const RETENTION_DAYS = 30;

type JobTrigger = "scheduled" | "manual";
type JobRunState = "queued" | "running" | "succeeded" | "failed" | "lease_lost";

export type JobConfigurationRecord = {
  name: string;
  pattern: string | null;
  enabled: boolean;
  version: number;
  updatedAt: Date | string;
  updatedByPersonId: string | null;
};

export type JobRunSummary = {
  id: string;
  name: string;
  trigger: JobTrigger;
  state: JobRunState;
  requestedAt: Date | string;
  startedAt: Date | string | null;
  finishedAt: Date | string | null;
  durationMs: number | null;
  errorCode: "handler_failed" | "authorization_lost" | "lease_lost" | null;
};

type ExecuteHandler = (name: string) => (() => Promise<unknown>) | undefined;

export class ManualJobRunConflictError extends Error {
  constructor() {
    super("The job already has a queued or running manual execution.");
    this.name = "ManualJobRunConflictError";
  }
}

function rows<T>(result: { rows: unknown[] }): T[] {
  return result.rows as T[];
}

function nameList(names: readonly string[]) {
  return sql.join(
    names.map((name) => sql`${name}`),
    sql`, `,
  );
}

export async function readJobConfigurations(
  names: readonly string[],
): Promise<Map<string, JobConfigurationRecord>> {
  if (names.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT name, pattern, enabled, version, updated_at AS "updatedAt",
           updated_by_person_id AS "updatedByPersonId"
      FROM instance_job_configuration
     WHERE name IN (${nameList(names)})
  `);
  return new Map(
    rows<JobConfigurationRecord>(result).map((record) => [record.name, record]),
  );
}

export async function readLastJobRuns(
  names: readonly string[],
): Promise<Map<string, JobRunSummary>> {
  if (names.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT DISTINCT ON (name)
           id, name, trigger, state, requested_at AS "requestedAt",
           started_at AS "startedAt", finished_at AS "finishedAt",
           duration_ms AS "durationMs", error_code AS "errorCode"
      FROM instance_job_run
     WHERE name IN (${nameList(names)})
       AND state <> 'queued'
     ORDER BY name, started_at DESC NULLS LAST, requested_at DESC, id DESC
  `);
  return new Map(rows<JobRunSummary>(result).map((run) => [run.name, run]));
}

/** Pending manual work is reported separately from the latest actual execution. */
export async function readQueuedJobRuns(
  names: readonly string[],
): Promise<Map<string, JobRunSummary>> {
  if (names.length === 0) return new Map();
  const result = await db.execute(sql`
    SELECT DISTINCT ON (name)
           id, name, trigger, state, requested_at AS "requestedAt",
           started_at AS "startedAt", finished_at AS "finishedAt",
           duration_ms AS "durationMs", error_code AS "errorCode"
      FROM instance_job_run
     WHERE name IN (${nameList(names)}) AND trigger = 'manual'
       AND state = 'queued'
     ORDER BY name, requested_at DESC, id DESC
  `);
  return new Map(rows<JobRunSummary>(result).map((run) => [run.name, run]));
}

export async function enqueueManualJobRun(input: {
  name: string;
  actorPersonId: string;
  actorUserId: string;
  traceId: string | null;
}): Promise<{ id: string; state: "queued" }> {
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(2026, hashtext(${input.name}))`,
    );
    const config = await tx.execute(sql`
      SELECT enabled FROM instance_job_configuration WHERE name = ${input.name}
    `);
    if (rows<{ enabled: boolean }>(config)[0]?.enabled === false)
      throw new ManualJobRunConflictError();
    const active = await tx.execute(sql`
      SELECT 1 FROM instance_job_run
       WHERE name = ${input.name} AND trigger = 'manual'
         AND state IN ('queued', 'running')
       LIMIT 1
    `);
    if ((active.rowCount ?? 0) > 0) throw new ManualJobRunConflictError();
    await tx.execute(sql`
      INSERT INTO instance_job_run (id, name, trigger, state, actor_person_id)
      VALUES (${id}, ${input.name}, 'manual', 'queued', ${input.actorPersonId})
    `);
    const { appendAuditLog } = await import("../../audit/audit-writer");
    await appendAuditLog(tx, {
      action: "job.triggered",
      actorId: input.actorUserId,
      actorType: "person",
      traceId: input.traceId,
      entityType: "job",
      entityId: input.name,
      after: { runId: id, trigger: "manual", state: "queued" },
    });
  });
  return { id, state: "queued" };
}

export async function writeJobConfiguration(input: {
  name: string;
  pattern: string | null;
  enabled: boolean;
  expectedVersion: number;
  actorPersonId: string;
  actorUserId: string;
  traceId: string | null;
}): Promise<JobConfigurationRecord | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(2026, hashtext(${input.name}))`,
    );
    const beforeResult = await tx.execute(sql`
      SELECT name, pattern, enabled, version, updated_at AS "updatedAt",
             updated_by_person_id AS "updatedByPersonId"
        FROM instance_job_configuration
       WHERE name = ${input.name}
       FOR UPDATE
    `);
    const before = rows<JobConfigurationRecord>(beforeResult)[0];
    const currentVersion = before?.version ?? 0;
    if (currentVersion !== input.expectedVersion) return null;

    const version = currentVersion + 1;
    const updated = before
      ? await tx.execute(sql`
          UPDATE instance_job_configuration
             SET pattern = ${input.pattern}, enabled = ${input.enabled},
                 version = ${version}, updated_at = clock_timestamp(),
                 updated_by_person_id = ${input.actorPersonId}
           WHERE name = ${input.name} AND version = ${input.expectedVersion}
          RETURNING name, pattern, enabled, version,
                    updated_at AS "updatedAt",
                    updated_by_person_id AS "updatedByPersonId"
        `)
      : await tx.execute(sql`
          INSERT INTO instance_job_configuration
            (name, pattern, enabled, version, updated_by_person_id)
          VALUES (${input.name}, ${input.pattern}, ${input.enabled}, 1, ${input.actorPersonId})
          ON CONFLICT (name) DO NOTHING
          RETURNING name, pattern, enabled, version,
                    updated_at AS "updatedAt",
                    updated_by_person_id AS "updatedByPersonId"
        `);
    const after = rows<JobConfigurationRecord>(updated)[0];
    if (!after) return null;

    const { appendAuditLog } = await import("../../audit/audit-writer");
    await appendAuditLog(tx, {
      action: "job.configuration_changed",
      actorId: input.actorUserId,
      actorType: "person",
      traceId: input.traceId,
      entityType: "job",
      entityId: input.name,
      before: before
        ? {
            pattern: before.pattern,
            enabled: before.enabled,
            version: before.version,
          }
        : { pattern: null, enabled: true, version: 0 },
      after: {
        pattern: after.pattern,
        enabled: after.enabled,
        version: after.version,
      },
    });
    return after;
  });
}

async function insertRunningRun(
  name: string,
  trigger: JobTrigger,
  runnerId: string,
  existingId?: string,
  executor?: Executor,
) {
  const query = executorOrDefault(executor);
  if (existingId) {
    const result = await query.execute(sql`
      WITH tick AS (SELECT clock_timestamp() AS value)
      UPDATE instance_job_run
         SET state = 'running', started_at = tick.value,
             heartbeat_at = tick.value,
             run_lease_expires_at = tick.value + (${RUN_LEASE_SECONDS} * interval '1 second'),
             runner_id = ${runnerId}
        FROM tick
       WHERE id = ${existingId} AND state = 'queued' AND trigger = 'manual'
      RETURNING id
    `);
    return (result.rowCount ?? 0) > 0;
  }
  const id = randomUUID();
  await query.execute(sql`
    WITH tick AS (SELECT clock_timestamp() AS value)
    INSERT INTO instance_job_run
      (id, name, trigger, state, requested_at, started_at, heartbeat_at,
       runner_id, run_lease_expires_at)
    SELECT ${id}, ${name}, ${trigger}, 'running', tick.value, tick.value,
           tick.value, ${runnerId},
           tick.value + (${RUN_LEASE_SECONDS} * interval '1 second')
      FROM tick
  `);
  return id;
}

async function runReservationOwned(
  id: string,
  runnerId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM instance_job_run
     WHERE id = ${id} AND state = 'running' AND runner_id = ${runnerId}
       AND run_lease_expires_at > clock_timestamp()
     LIMIT 1
  `);
  return (result.rowCount ?? 0) > 0;
}

async function heartbeatRun(
  id: string,
  runnerId: string,
  manualJobName?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      WITH tick AS (SELECT clock_timestamp() AS value)
      UPDATE instance_job_run
         SET heartbeat_at = tick.value,
             run_lease_expires_at = tick.value + (${RUN_LEASE_SECONDS} * interval '1 second')
        FROM tick
       WHERE id = ${id} AND state = 'running' AND runner_id = ${runnerId}
         AND run_lease_expires_at > tick.value
    `);
    if ((result.rowCount ?? 0) === 0) return false;
    if (manualJobName) {
      return renewJobLease(
        manualJobName,
        runnerId,
        `${RUN_LEASE_SECONDS} seconds`,
        tx,
      );
    }
    return true;
  });
}

async function markRunLeaseLost(id: string, runnerId: string) {
  await db.execute(sql`
    UPDATE instance_job_run
       SET state = 'lease_lost', error_code = 'lease_lost',
           finished_at = clock_timestamp(), runner_id = NULL,
           run_lease_expires_at = NULL, duration_ms = NULL
     WHERE id = ${id} AND state = 'running' AND runner_id = ${runnerId}
  `);
}

async function finishRun(input: {
  id: string;
  runnerId: string;
  state: "succeeded" | "failed";
  durationMs: number;
  errorCode: "handler_failed" | null;
}) {
  await db.execute(sql`
    UPDATE instance_job_run
       SET state = ${input.state}, finished_at = clock_timestamp(),
           runner_id = NULL, run_lease_expires_at = NULL,
           duration_ms = ${input.durationMs}, error_code = ${input.errorCode}
     WHERE id = ${input.id} AND state = 'running' AND runner_id = ${input.runnerId}
       AND run_lease_expires_at > clock_timestamp()
  `);
}

async function failAuthorization(run: { id: string; runnerId: string }) {
  await db.execute(sql`
    UPDATE instance_job_run
       SET state = 'failed', finished_at = clock_timestamp(),
           runner_id = NULL, run_lease_expires_at = NULL,
           duration_ms = 0, error_code = 'authorization_lost'
     WHERE id = ${run.id} AND state = 'running' AND runner_id = ${run.runnerId}
       AND run_lease_expires_at > clock_timestamp()
  `);
}

async function actorStillAuthorized(
  actorPersonId: string | null,
): Promise<boolean> {
  if (!actorPersonId) return false;
  const actor = await db.execute(sql`
    SELECT u.id AS "userId"
      FROM person p
      JOIN "user" u ON u.id = p.user_id
     WHERE p.id = ${actorPersonId} AND p.side = 'staff' AND p.active = true
       AND u.role = 'admin' AND u.banned IS DISTINCT FROM true
     LIMIT 1
  `);
  const userId = rows<{ userId: string }>(actor)[0]?.userId;
  if (!userId) return false;
  const identity = await resolveIdentity({ userId, credential: "session" });
  if (!identity) return false;
  const entry = policyRegistry.get(
    normaliseRouteKey("POST /api/instance/jobs/{name}/run"),
  );
  if (entry?.kind !== "capability") return false;
  return evaluatePolicy(entry.policy, {
    identity,
    target: {},
    scope: instanceScope(),
    inReach: NO_SINGLE_RESOURCE,
  }).allowed;
}

export async function pruneJobRunHistory() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
    await tx.execute(sql`
      WITH expired AS (
        SELECT r.id
          FROM instance_job_run r
         WHERE r.state IN ('succeeded', 'failed', 'lease_lost')
           AND r.requested_at < clock_timestamp() - (${RETENTION_DAYS} * interval '1 day')
           AND r.finished_at < clock_timestamp() - (${RETENTION_DAYS} * interval '1 day')
           AND (
             (r.trigger = 'scheduled' AND r.actor_person_id IS NULL)
             OR
             (r.trigger = 'manual' AND r.actor_person_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM person p
                   JOIN legal_hold h ON h.lifted_at IS NULL
                    AND ((h.scope = 'person' AND h.scope_id = p.id)
                      OR (h.scope = 'organisation' AND h.scope_id = p.organisation_id))
                  WHERE p.id = r.actor_person_id
               ))
           )
         ORDER BY r.requested_at
         LIMIT 500
         FOR UPDATE OF r SKIP LOCKED
      )
      DELETE FROM instance_job_run r USING expired WHERE r.id = expired.id
    `);
  });
}

async function markExpiredRunsLeaseLost() {
  await db.execute(sql`
    UPDATE instance_job_run
       SET state = 'lease_lost', error_code = 'lease_lost',
           finished_at = clock_timestamp(), runner_id = NULL,
           run_lease_expires_at = NULL, duration_ms = NULL
     WHERE state = 'running' AND run_lease_expires_at <= clock_timestamp()
  `);
}

async function startClaimedManualRun(
  run: {
    id: string;
    name: string;
    actorPersonId: string | null;
    runnerId: string;
  },
  executeHandler: ExecuteHandler,
) {
  const runnerId = run.runnerId;
  const started = performance.now();
  let ownershipLost = false;
  const heartbeat = setInterval(() => {
    void heartbeatRun(run.id, runnerId, run.name)
      .then((owned) => {
        if (!owned) ownershipLost = true;
      })
      .catch(() => {
        ownershipLost = true;
      });
  }, RUN_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    if (!(await actorStillAuthorized(run.actorPersonId))) {
      await failAuthorization({ id: run.id, runnerId });
      return;
    }
    const handler = executeHandler(run.name);
    if (!handler) {
      await finishRun({
        id: run.id,
        runnerId,
        state: "failed",
        durationMs: 0,
        errorCode: "handler_failed",
      });
      return;
    }
    await withJobExecutionReservation(
      {
        jobName: run.name,
        runId: run.id,
        runnerId,
        leaseOwner: runnerId,
        assertRunOwned: () => runReservationOwned(run.id, runnerId),
      },
      async () => {
        await assertJobExecutionOwned();
        return handler();
      },
    );
    if (!ownershipLost)
      await finishRun({
        id: run.id,
        runnerId,
        state: "succeeded",
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        errorCode: null,
      });
  } catch (error) {
    if (error instanceof JobExecutionReservationLostError) {
      await markRunLeaseLost(run.id, runnerId).catch(() => undefined);
    } else if (!ownershipLost) {
      await finishRun({
        id: run.id,
        runnerId,
        state: "failed",
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        errorCode: "handler_failed",
      });
    }
  } finally {
    clearInterval(heartbeat);
    await releaseJobLease(run.name, runnerId).catch(() => undefined);
  }
}

export async function dispatchOneManualRun(executeHandler: ExecuteHandler) {
  const run = await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT id, name, actor_person_id AS "actorPersonId"
        FROM instance_job_run
       WHERE trigger = 'manual' AND state = 'queued'
       ORDER BY requested_at, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
    `);
    const queued = rows<{
      id: string;
      name: string;
      actorPersonId: string | null;
    }>(result)[0];
    if (!queued) return null;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(2026, hashtext(${queued.name}))`,
    );
    const configuration = await tx.execute(sql`
      SELECT enabled FROM instance_job_configuration WHERE name = ${queued.name}
    `);
    if (rows<{ enabled: boolean }>(configuration)[0]?.enabled === false)
      return null;
    const runnerId = randomUUID();
    const ownsLease = await claimJobLease(
      queued.name,
      runnerId,
      `${RUN_LEASE_SECONDS} seconds`,
      tx,
    );
    if (!ownsLease) return null;
    const claimed = await insertRunningRun(
      queued.name,
      "manual",
      runnerId,
      queued.id,
      tx,
    );
    if (!claimed) {
      await releaseJobLease(queued.name, runnerId, tx);
      return null;
    }
    return claimed ? { ...queued, runnerId } : null;
  });
  if (run) await startClaimedManualRun(run, executeHandler);
}

let workerTimer: ReturnType<typeof setInterval> | undefined;
let activeManualDispatch = false;
let retentionTick = 0;

export function startJobRunWorker(executeHandler: ExecuteHandler): () => void {
  if (workerTimer) return () => stopJobRunWorker();
  workerTimer = setInterval(() => {
    if (activeManualDispatch) return;
    activeManualDispatch = true;
    void (async () => {
      try {
        await markExpiredRunsLeaseLost();
        await dispatchOneManualRun(executeHandler);
        retentionTick += 1;
        if (retentionTick >= 3_600) {
          retentionTick = 0;
          await pruneJobRunHistory();
        }
      } catch {
        // The row remains queued/running. A later tick retries only the safe claim operation.
      } finally {
        activeManualDispatch = false;
      }
    })();
  }, QUEUE_POLL_MS);
  workerTimer.unref?.();
  return () => stopJobRunWorker();
}

export function stopJobRunWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = undefined;
  activeManualDispatch = false;
}

export async function runScheduledJobWithHistory<T>(
  name: string,
  handler: () => Promise<T>,
): Promise<T> {
  const runnerId = randomUUID();
  let runId: string | null = null;
  try {
    const inserted = await insertRunningRun(name, "scheduled", runnerId);
    runId = typeof inserted === "string" ? inserted : null;
  } catch {
    // History failure must not suppress the scheduled business job.
  }
  if (!runId) return handler();

  let ownershipLost = false;
  const started = performance.now();
  const heartbeat = setInterval(() => {
    void heartbeatRun(runId as string, runnerId)
      .then((owned) => {
        if (!owned) ownershipLost = true;
      })
      .catch(() => {
        ownershipLost = true;
      });
  }, RUN_HEARTBEAT_MS);
  heartbeat.unref?.();
  let result: T;
  try {
    result = await withJobExecutionReservation(
      {
        jobName: name,
        runId,
        runnerId,
        assertRunOwned: () => runReservationOwned(runId as string, runnerId),
      },
      async () => {
        await assertJobExecutionOwned();
        return handler();
      },
    );
  } catch (error) {
    if (error instanceof JobExecutionReservationLostError) {
      await markRunLeaseLost(runId, runnerId).catch(() => undefined);
    } else if (!ownershipLost) {
      await finishRun({
        id: runId,
        runnerId,
        state: "failed",
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        errorCode: "handler_failed",
      }).catch(() => undefined);
    }
    clearInterval(heartbeat);
    throw error;
  }
  if (!ownershipLost)
    await finishRun({
      id: runId,
      runnerId,
      state: "succeeded",
      durationMs: Math.max(0, Math.round(performance.now() - started)),
      errorCode: null,
    }).catch(() => undefined);
  clearInterval(heartbeat);
  return result;
}
