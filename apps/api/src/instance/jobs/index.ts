import { Cron } from "croner";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { nextScheduledAt, registeredJobCatalog } from "../../scheduler";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import {
  enqueueManualJobRun,
  type JobConfigurationRecord,
  type JobRunSummary,
  ManualJobRunConflictError,
  readJobConfigurations,
  readLastJobRuns,
  readQueuedJobRuns,
  writeJobConfiguration,
} from "./runtime";

const errorSchema = z.object({ message: z.string() });
const jobSchema = z.object({
  name: z.string(),
  pattern: z.string().nullable(),
  defaultPattern: z.string().nullable(),
  timezone: z.string().nullable(),
  enabled: z.boolean(),
  version: z.number().int().nonnegative(),
  nextRunAt: z.string().datetime().nullable(),
  manualRunAllowed: z.boolean(),
  lastRun: z
    .object({
      id: z.string(),
      trigger: z.enum(["scheduled", "manual"]),
      state: z.enum(["queued", "running", "succeeded", "failed", "lease_lost"]),
      requestedAt: z.string().datetime(),
      startedAt: z.string().datetime().nullable(),
      finishedAt: z.string().datetime().nullable(),
      durationMs: z.number().int().nonnegative().nullable(),
      errorCode: z
        .enum(["handler_failed", "authorization_lost", "lease_lost"])
        .nullable(),
    })
    .nullable(),
  queuedRun: z
    .object({
      id: z.string(),
      trigger: z.literal("manual"),
      state: z.literal("queued"),
      requestedAt: z.string().datetime(),
      startedAt: z.string().datetime().nullable(),
      finishedAt: z.string().datetime().nullable(),
      durationMs: z.number().int().nonnegative().nullable(),
      errorCode: z
        .enum(["handler_failed", "authorization_lost", "lease_lost"])
        .nullable(),
    })
    .nullable(),
});
const listResponseSchema = z.object({
  checkedAt: z.string().datetime(),
  jobs: z.array(jobSchema),
});
const patchBodySchema = z
  .object({
    expectedVersion: z.number().int().nonnegative().safe(),
    pattern: z.string().max(120).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) => value.pattern !== undefined || value.enabled !== undefined,
    "Provide a schedule or enabled-state change.",
  );
const updatedJobSchema = z.object({ job: jobSchema });
const runResponseSchema = z.object({
  run: z.object({ id: z.string(), state: z.literal("queued") }),
});

const getRoute = createRoute({
  method: "get",
  operationId: "listInstanceJobs",
  path: "/jobs",
  tags: ["Instance"],
  summary: "List instance jobs and recent runs",
  description:
    "Returns the exact registered job names, live persisted schedule overrides, the next scheduled invocation, and metadata-only most recent run history.",
  responses: {
    200: jsonResponse(
      "Registered jobs and their latest run",
      listResponseSchema,
    ),
    403: jsonResponse("Forbidden", errorSchema),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "updateInstanceJobConfiguration",
  path: "/jobs/{name}",
  tags: ["Instance"],
  summary: "Update a registered job schedule",
  request: {
    params: z.object({ name: z.string().min(1).max(120) }),
    body: {
      required: true,
      content: { "application/json": { schema: patchBodySchema } },
    },
  },
  responses: {
    200: jsonResponse("Updated job configuration", updatedJobSchema),
    400: jsonResponse("Invalid job configuration", errorSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Job not registered", errorSchema),
    409: jsonResponse("Configuration changed or a run is queued", errorSchema),
  },
});

const runRoute = createRoute({
  method: "post",
  operationId: "queueInstanceJobRun",
  path: "/jobs/{name}/run",
  tags: ["Instance"],
  summary: "Queue a registered job for manual execution",
  request: { params: z.object({ name: z.string().min(1).max(120) }) },
  responses: {
    202: jsonResponse("Job run queued", runResponseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    404: jsonResponse("Job is not manually runnable", errorSchema),
    409: jsonResponse("Job disabled or already queued", errorSchema),
  },
});

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toRunSummary(run: JobRunSummary | undefined) {
  if (!run) return null;
  const requestedAt = iso(run.requestedAt);
  if (!requestedAt) return null;
  return {
    id: run.id,
    trigger: run.trigger,
    state: run.state,
    requestedAt,
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    durationMs: run.durationMs,
    errorCode: run.errorCode,
  };
}

function toQueuedRunSummary(run: JobRunSummary | undefined) {
  if (run?.trigger !== "manual" || run.state !== "queued") return null;
  const requestedAt = iso(run.requestedAt);
  if (!requestedAt) return null;
  return {
    id: run.id,
    trigger: "manual" as const,
    state: run.state,
    requestedAt,
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    durationMs: run.durationMs,
    errorCode: run.errorCode,
  };
}

function nextScheduleFor(
  pattern: string | null,
  timezone: string | null,
  enabled: boolean,
) {
  if (!pattern || !enabled) return null;
  return iso(nextScheduledAt(pattern, timezone));
}

async function readJobRows() {
  const definitions = registeredJobCatalog();
  const names = definitions.map((job) => job.name);
  const [configs, runs, queuedRuns] = await Promise.all([
    readJobConfigurations(names),
    readLastJobRuns(names),
    readQueuedJobRuns(names),
  ]);
  return definitions.map((job) => {
    const config: JobConfigurationRecord | undefined = configs.get(job.name);
    const lastRun: JobRunSummary | undefined = runs.get(job.name);
    const queuedRun: JobRunSummary | undefined = queuedRuns.get(job.name);
    return {
      name: job.name,
      pattern:
        job.defaultPattern === null
          ? null
          : (config?.pattern ?? job.defaultPattern),
      defaultPattern: job.defaultPattern,
      timezone: job.timezone,
      enabled:
        job.defaultPattern === null ? true : (config?.enabled ?? job.enabled),
      version: config?.version ?? 0,
      nextRunAt: nextScheduleFor(
        job.defaultPattern === null
          ? null
          : (config?.pattern ?? job.defaultPattern),
        job.timezone,
        job.defaultPattern === null ? false : (config?.enabled ?? job.enabled),
      ),
      manualRunAllowed: job.manualRunAllowed,
      lastRun: toRunSummary(lastRun),
      queuedRun: toQueuedRunSummary(queuedRun),
    };
  });
}

async function loadAdminPerson(userId: string): Promise<string> {
  const result = await db.execute(sql`
    SELECT id FROM person
     WHERE user_id = ${userId} AND side = 'staff' AND active = true
     LIMIT 1
  `);
  const personId = (result.rows[0] as { id?: string } | undefined)?.id;
  if (!personId) throw new HTTPException(403, { message: "Forbidden" });
  return personId;
}

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/jobs");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(
      { checkedAt: new Date().toISOString(), jobs: await readJobRows() },
      200,
    );
  })
  .openapi(patchRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "PATCH", "/api/instance/jobs/{name}");
    const { name } = c.req.valid("param");
    const body = c.req.valid("json");
    const job = registeredJobCatalog().find((entry) => entry.name === name);
    if (!job)
      throw new HTTPException(404, { message: "Job is not registered" });
    if (job.defaultPattern === null)
      throw new HTTPException(400, {
        message: "This job is managed by its elevated operation.",
      });
    const currentConfig = (await readJobConfigurations([name])).get(name);
    const storedPattern =
      body.pattern === undefined
        ? (currentConfig?.pattern ?? null)
        : body.pattern;
    const enabled = body.enabled ?? currentConfig?.enabled ?? true;
    if (storedPattern !== null) {
      try {
        const schedule = new Cron(storedPattern, {
          timezone: job.timezone ?? undefined,
          paused: true,
        });
        schedule.stop();
      } catch {
        throw new HTTPException(400, { message: "Invalid job schedule" });
      }
    }
    const actorUserId = c.get("userId") as string;
    const actorPersonId = await loadAdminPerson(actorUserId);
    const updated = await writeJobConfiguration({
      name,
      pattern: storedPattern,
      enabled,
      expectedVersion: body.expectedVersion,
      actorPersonId,
      actorUserId,
      traceId: normaliseTraceId(c.req.header("x-request-id")),
    });
    if (!updated)
      throw new HTTPException(409, {
        message: "Job configuration changed or a manual run is queued.",
      });
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    const rows = await readJobRows();
    const updatedJob = rows.find((entry) => entry.name === name);
    if (!updatedJob)
      throw new HTTPException(503, { message: "Job status is unavailable" });
    return c.json({ job: updatedJob }, 200);
  })
  .openapi(runRoute, async (c) => {
    const { name } = c.req.valid("param");
    await requireCurrentInstanceAdmin(
      c,
      "POST",
      "/api/instance/jobs/{name}/run",
    );
    const job = registeredJobCatalog().find((entry) => entry.name === name);
    if (!job?.manualRunAllowed)
      throw new HTTPException(404, { message: "Job is not manually runnable" });
    if (!job.enabled)
      throw new HTTPException(409, { message: "Job is disabled" });
    const actorUserId = c.get("userId") as string;
    const actorPersonId = await loadAdminPerson(actorUserId);
    try {
      const run = await enqueueManualJobRun({
        name,
        actorPersonId,
        actorUserId,
        traceId: normaliseTraceId(c.req.header("x-request-id")),
      });
      setShadowLegacyAuthorization(c, "allowed");
      return c.json({ run }, 202);
    } catch (error) {
      if (error instanceof ManualJobRunConflictError)
        throw new HTTPException(409, {
          message: "Job is disabled or already queued",
        });
      throw error;
    }
  });

export default routes;
