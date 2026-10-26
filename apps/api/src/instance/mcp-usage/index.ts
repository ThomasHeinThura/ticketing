import { and, asc, gte, inArray, lt, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { portalForHost } from "../../auth";
import db from "../../database";
import { mcpToolInvocationTable } from "../../database/schema-mcp-telemetry";
import { MCP_TOOL_NAMES } from "../../mcp-telemetry/tool-names";
import { apiRouter, createRoute, jsonResponse, z } from "../../openapi";
import { setShadowLegacyAuthorization } from "../../permissions/shadow-context";
import { requireSessionOnly } from "../../utils/require-session-only";
import { requireCurrentInstanceAdmin } from "../require-instance-admin";

const errorSchema = z.object({ message: z.string() });
const keySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  prefix: z.string().nullable(),
  createdAt: z.string().datetime(),
  enabled: z.boolean(),
  recordedRequestCount: z.number().int().nonnegative(),
  lastRecordedAt: z.string().datetime().nullable(),
  autoDisabledAt: z.string().datetime().nullable(),
  clientReportedTools: z.array(
    z.object({
      toolName: z.enum(MCP_TOOL_NAMES),
      callCount: z.number().int().nonnegative(),
      errorCount: z.number().int().nonnegative(),
      errorRate: z.number().min(0).max(1),
      meanDurationMs: z.number().int().nonnegative(),
      maxDurationMs: z.number().int().nonnegative(),
      lastReportedAt: z.string().datetime(),
    }),
  ),
});
const responseSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  hasMore: z.boolean(),
  keys: z.array(keySchema),
});

type McpUsageRow = {
  periodStart: Date | string;
  periodEnd: Date | string;
  id: string;
  name: string | null;
  prefix: string | null;
  createdAt: Date | string;
  enabled: boolean;
  recordedRequestCount: number;
  lastRecordedAt: Date | string | null;
  autoDisabledAt: Date | string | null;
};

type McpToolUsageAggregate = {
  apiKeyId: string;
  toolName: (typeof MCP_TOOL_NAMES)[number];
  callCount: number;
  errorCount: number;
  meanDurationMs: number;
  maxDurationMs: number;
  lastReportedAt: Date;
};

function databaseTimestampToIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new HTTPException(503, { message: "Usage unavailable" });
  return date.toISOString();
}

const getRoute = createRoute({
  method: "get",
  operationId: "getInstanceMcpUsage",
  path: "/mcp/usage",
  tags: ["Instance"],
  summary: "Get recorded MCP key usage metadata",
  description:
    "Returns bounded 30-day server-recorded MCP-key API request attempts, safe key metadata, and separately labeled low-trust client-reported tool aggregates. Client reports contain no call content and are not authoritative execution evidence.",
  middleware: [requireSessionOnly()] as const,
  responses: {
    200: jsonResponse("Recorded MCP key usage metadata", responseSchema),
    403: jsonResponse("Forbidden", errorSchema),
    503: jsonResponse("Usage data unavailable", errorSchema),
  },
});

export async function readMcpUsage() {
  const result = await db.execute<McpUsageRow>(sql`
    WITH bounds AS MATERIALIZED (
      SELECT statement_timestamp() AS period_end,
             statement_timestamp() - interval '30 days' AS period_start
    ), selected_keys AS MATERIALIZED (
      SELECT k.id, k.name, COALESCE(k.start, k.prefix) AS prefix,
             extension.created_at AS key_created_at,
             (k.enabled IS TRUE AND extension.disabled_at IS NULL) AS enabled
        FROM apikey k
        JOIN api_key extension ON extension.apikey_id = k.id
       WHERE extension.is_mcp IS TRUE
         AND extension.person_id IS NOT NULL
       ORDER BY extension.created_at DESC, k.id
       LIMIT 201
    )
    SELECT bounds.period_start AS "periodStart",
           bounds.period_end AS "periodEnd",
           selected_keys.id,
           selected_keys.name,
           selected_keys.prefix,
           selected_keys.key_created_at AS "createdAt",
           selected_keys.enabled,
           COALESCE(requests.request_count, 0)::int AS "recordedRequestCount",
           requests.last_recorded_at AS "lastRecordedAt",
           auto_disabled.disabled_at AS "autoDisabledAt"
      FROM selected_keys
      CROSS JOIN bounds
      LEFT JOIN LATERAL (
        SELECT count(*) AS request_count, max(log.created_at) AS last_recorded_at
          FROM audit_log log
         WHERE log.entity_type = 'api_key'
           AND log.entity_id = selected_keys.id
           AND log.api_key_id = selected_keys.id
           AND log.actor_type = 'api_key'
           AND log.action = 'mcp.request'
           AND log.created_at >= bounds.period_start
           AND log.created_at < bounds.period_end
      ) requests ON true
      LEFT JOIN LATERAL (
        SELECT log.created_at AS disabled_at
          FROM audit_log log
         WHERE log.entity_type = 'api_key'
           AND log.entity_id = selected_keys.id
           AND log.api_key_id = selected_keys.id
           AND log.action = 'api_key.auto_disabled'
         ORDER BY log.created_at DESC, log.seq DESC
         LIMIT 1
      ) auto_disabled ON true
     ORDER BY selected_keys.key_created_at DESC, selected_keys.id
  `);

  const rows = result.rows as unknown as McpUsageRow[];
  const selected = rows.slice(0, 200);
  const first = rows[0];
  if (!first) {
    const bounds = await db.execute<{
      periodStart: Date | string;
      periodEnd: Date | string;
    }>(sql`
      SELECT statement_timestamp() - interval '30 days' AS "periodStart",
             statement_timestamp() AS "periodEnd"
    `);
    const range = bounds.rows[0];
    if (!range) throw new HTTPException(503, { message: "Usage unavailable" });
    return {
      periodStart: databaseTimestampToIso(range.periodStart),
      periodEnd: databaseTimestampToIso(range.periodEnd),
      hasMore: false,
      keys: [],
    };
  }

  const clientReportedToolsByKey = new Map<string, McpToolUsageAggregate[]>();
  if (selected.length > 0) {
    const periodStart =
      first.periodStart instanceof Date
        ? first.periodStart
        : new Date(first.periodStart);
    const periodEnd =
      first.periodEnd instanceof Date
        ? first.periodEnd
        : new Date(first.periodEnd);
    const toolAggregates = await db
      .select({
        apiKeyId: mcpToolInvocationTable.apiKeyId,
        toolName: mcpToolInvocationTable.toolName,
        callCount: sql<number>`count(*)::int`,
        errorCount: sql<number>`count(*) FILTER (WHERE ${mcpToolInvocationTable.outcome} = 'error')::int`,
        meanDurationMs: sql<number>`round(avg(${mcpToolInvocationTable.durationMs}))::int`,
        maxDurationMs: sql<number>`max(${mcpToolInvocationTable.durationMs})::int`,
        lastReportedAt: sql<Date>`max(${mcpToolInvocationTable.recordedAt})`,
      })
      .from(mcpToolInvocationTable)
      .where(
        and(
          inArray(
            mcpToolInvocationTable.apiKeyId,
            selected.map((row) => row.id),
          ),
          gte(mcpToolInvocationTable.recordedAt, periodStart),
          lt(mcpToolInvocationTable.recordedAt, periodEnd),
        ),
      )
      .groupBy(mcpToolInvocationTable.apiKeyId, mcpToolInvocationTable.toolName)
      .orderBy(
        asc(mcpToolInvocationTable.apiKeyId),
        asc(mcpToolInvocationTable.toolName),
      );
    for (const aggregate of toolAggregates) {
      const existing = clientReportedToolsByKey.get(aggregate.apiKeyId) ?? [];
      existing.push({
        ...aggregate,
        toolName: aggregate.toolName as (typeof MCP_TOOL_NAMES)[number],
        errorCount: Number(aggregate.errorCount),
        callCount: Number(aggregate.callCount),
        meanDurationMs: Number(aggregate.meanDurationMs),
        maxDurationMs: Number(aggregate.maxDurationMs),
      });
      clientReportedToolsByKey.set(aggregate.apiKeyId, existing);
    }
  }

  return {
    periodStart: databaseTimestampToIso(first.periodStart),
    periodEnd: databaseTimestampToIso(first.periodEnd),
    hasMore: rows.length > 200,
    keys: selected.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: databaseTimestampToIso(row.createdAt),
      enabled: row.enabled,
      recordedRequestCount: row.recordedRequestCount,
      lastRecordedAt: row.lastRecordedAt
        ? databaseTimestampToIso(row.lastRecordedAt)
        : null,
      autoDisabledAt: row.autoDisabledAt
        ? databaseTimestampToIso(row.autoDisabledAt)
        : null,
      clientReportedTools: (clientReportedToolsByKey.get(row.id) ?? []).map(
        (aggregate) => ({
          toolName: aggregate.toolName,
          callCount: aggregate.callCount,
          errorCount: aggregate.errorCount,
          errorRate:
            aggregate.callCount > 0
              ? aggregate.errorCount / aggregate.callCount
              : 0,
          meanDurationMs: aggregate.meanDurationMs,
          maxDurationMs: aggregate.maxDurationMs,
          lastReportedAt: databaseTimestampToIso(aggregate.lastReportedAt),
        }),
      ),
    })),
  };
}

const router = apiRouter().openapi(getRoute, async (c) => {
  if (portalForHost(c.req.header("host")) !== "agent")
    throw new HTTPException(403, { message: "Forbidden" });
  await requireCurrentInstanceAdmin(c, "GET", "/api/instance/mcp/usage");
  c.header("Cache-Control", "no-store");
  setShadowLegacyAuthorization(c, "allowed");
  return c.json(await readMcpUsage(), 200);
});

export default router;
