import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { mcpToolInvocationTable } from "../database/schema-mcp-telemetry";
import type { McpToolName } from "./tool-names";

export type McpToolReport = {
  invocationId: string;
  toolName: McpToolName;
  durationMs: number;
  outcome: "success" | "error";
};

/** First report wins. Exact retries are acknowledged; conflicting retries are refused. */
export async function recordMcpToolReport(
  apiKeyId: string,
  report: McpToolReport,
): Promise<"created" | "duplicate"> {
  const [inserted] = await db
    .insert(mcpToolInvocationTable)
    .values({
      apiKeyId,
      invocationId: report.invocationId,
      toolName: report.toolName,
      durationMs: report.durationMs,
      outcome: report.outcome,
    })
    .onConflictDoNothing({
      target: [
        mcpToolInvocationTable.apiKeyId,
        mcpToolInvocationTable.invocationId,
      ],
    })
    .returning({ invocationId: mcpToolInvocationTable.invocationId });
  if (inserted) return "created";

  const [existing] = await db
    .select({
      toolName: mcpToolInvocationTable.toolName,
      durationMs: mcpToolInvocationTable.durationMs,
      outcome: mcpToolInvocationTable.outcome,
    })
    .from(mcpToolInvocationTable)
    .where(
      and(
        eq(mcpToolInvocationTable.apiKeyId, apiKeyId),
        eq(mcpToolInvocationTable.invocationId, report.invocationId),
      ),
    )
    .limit(1);
  if (
    existing?.toolName === report.toolName &&
    existing.durationMs === report.durationMs &&
    existing.outcome === report.outcome
  )
    return "duplicate";
  if (!existing) throw new Error("MCP tool report retry could not be resolved");
  throw new HTTPException(409, { message: "Invocation report conflict" });
}

/** Delete at most one bounded batch of expired rows using the database clock. */
export async function purgeExpiredToolReports(): Promise<number> {
  const result = await db.execute<{ deleted: number }>(sql`
    WITH expired AS MATERIALIZED (
      SELECT ctid
        FROM mcp_tool_invocation
       WHERE recorded_at < statement_timestamp() - interval '30 days'
       ORDER BY recorded_at, api_key_id, invocation_id
       LIMIT 10000
       FOR UPDATE SKIP LOCKED
    ), deleted AS (
      DELETE FROM mcp_tool_invocation target
       USING expired
       WHERE target.ctid = expired.ctid
       RETURNING 1
    )
    SELECT count(*)::int AS deleted FROM deleted
  `);
  return Number(result.rows[0]?.deleted ?? 0);
}
