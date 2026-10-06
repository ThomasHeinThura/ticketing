import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db, { schema } from "../../database";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { normaliseTraceId } from "../../permissions/shadow-middleware";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "./audit-failure-notifier";
import { getObservabilitySettings } from "./repository";
import { applyRuntimeLogLevels, recordAuditWriteFailure } from "./runtime";
import type { LogLevels } from "./settings";
import { isLogLevelsEqual, logLevelsSchema, parseLogLevels } from "./settings";

const versionSchema = z.number().int().positive().safe();
const currentSettingsSchema = z.object({
  version: versionSchema,
  logLevels: logLevelsSchema,
  metricsTokenConfigured: z.boolean(),
  metricsTokenRotatedAt: z.string().datetime().nullable(),
});

async function readSettings() {
  const [row] = await getObservabilitySettings();
  if (!row)
    throw new HTTPException(503, {
      message: "Observability settings unavailable",
    });
  let logLevels: LogLevels;
  try {
    logLevels = parseLogLevels(row.levels);
  } catch {
    throw new HTTPException(503, {
      message: "Observability settings unavailable",
    });
  }
  return {
    version: row.version,
    logLevels,
    metricsTokenConfigured: row.tokenHash !== null,
    metricsTokenRotatedAt: row.rotatedAt?.toISOString() ?? null,
  };
}

const getRoute = createRoute({
  method: "get",
  operationId: "getInstanceObservability",
  path: "/observability",
  tags: ["Instance"],
  summary: "Get observability settings",
  responses: {
    200: jsonResponse("Safe observability settings", currentSettingsSchema),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    503: jsonResponse(
      "Settings unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

const patchRoute = createRoute({
  method: "patch",
  operationId: "patchInstanceObservability",
  path: "/observability",
  tags: ["Instance"],
  summary: "Update observability log levels",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z
            .object({ version: versionSchema, logLevels: logLevelsSchema })
            .strict(),
        },
      },
    },
  },
  responses: {
    200: jsonResponse("Updated safe settings", currentSettingsSchema),
    403: jsonResponse("Forbidden", z.object({ message: z.string() })),
    409: jsonResponse(
      "Version conflict",
      z.object({
        message: z.literal("version_conflict"),
        version: versionSchema,
      }),
    ),
    503: jsonResponse(
      "Settings unavailable",
      z.object({ message: z.string() }),
    ),
  },
});

const routes = apiRouter()
  .openapi(getRoute, async (c) => {
    await requireCurrentInstanceAdmin(c, "GET", "/api/instance/observability");
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(await readSettings(), 200);
  })
  .openapi(patchRoute, async (c) => {
    await requireCurrentInstanceAdmin(
      c,
      "PATCH",
      "/api/instance/observability",
    );
    c.header("Cache-Control", "no-store");
    const input = c.req.valid("json");
    const requested = parseLogLevels(input.logLevels);
    const previous = await readSettings();
    if (previous.version !== input.version) {
      return c.json(
        { message: "version_conflict" as const, version: previous.version },
        409,
      );
    }
    if (isLogLevelsEqual(previous.logLevels, requested)) {
      setShadowLegacyAuthorization(c, "allowed");
      c.header("Cache-Control", "no-store");
      return c.json(previous, 200);
    }
    const updated = await db
      .update(schema.instanceSettingTable)
      .set({
        observabilityLogLevels: requested,
        observabilityConfigVersion: sql`${schema.instanceSettingTable.observabilityConfigVersion} + 1`,
      })
      .where(
        and(
          eq(schema.instanceSettingTable.id, "singleton"),
          eq(
            schema.instanceSettingTable.observabilityConfigVersion,
            input.version,
          ),
        ),
      )
      .returning({
        version: schema.instanceSettingTable.observabilityConfigVersion,
      });
    if (!updated[0]) {
      const current = await readSettings();
      return c.json(
        { message: "version_conflict" as const, version: current.version },
        409,
      );
    }
    try {
      await appendAuditLog(db, {
        action: "instance.observability_changed",
        actorId: c.get("userId"),
        actorType: "person",
        traceId: normaliseTraceId(c.req.header("x-request-id")),
        workspaceId: null,
        entityType: "instance",
        entityId: "singleton",
        before: null,
        after: { changedKeys: ["logLevels"] },
      });
    } catch {
      // The settings CAS has committed. AU-14 handles this append failure via
      // the operational counter and a durable instance-admin notification.
      recordAuditWriteFailure("mutation");
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    }
    applyRuntimeLogLevels(requested);
    setShadowLegacyAuthorization(c, "allowed");
    c.header("Cache-Control", "no-store");
    return c.json(await readSettings(), 200);
  });

export default routes;
