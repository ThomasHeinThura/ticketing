import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { loadApiKeyKind } from "../api-key/repository";
import { apiRouter, createRoute, errorResponse, z } from "../openapi";
import { setShadowLegacyAuthorization } from "../permissions/shadow-context";
import { recordMcpToolReport } from "./repository";
import { MCP_TOOL_NAMES, MCP_TOOL_REPORT_MAX_DURATION_MS } from "./tool-names";

const reportSchema = z
  .object({
    invocationId: z.string().uuid(),
    toolName: z.enum(MCP_TOOL_NAMES),
    durationMs: z.number().int().min(0).max(MCP_TOOL_REPORT_MAX_DURATION_MS),
    outcome: z.enum(["success", "error"]),
  })
  .strict();

async function requirePersonalMcpKey(c: Context, next: Next) {
  const apiKey = c.get("apiKey") as
    | { id: string; enabled: boolean }
    | undefined;
  if (!apiKey) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "MCP personal key required" });
  }

  const kind = await loadApiKeyKind(apiKey.id);
  if (
    !apiKey.enabled ||
    kind.kind !== "personal" ||
    !kind.isMcp ||
    !kind.personId ||
    kind.disabledAt
  ) {
    setShadowLegacyAuthorization(c, "denied");
    throw new HTTPException(403, { message: "MCP personal key required" });
  }

  setShadowLegacyAuthorization(c, "allowed");
  await next();
}

const reportToolRoute = createRoute({
  method: "post",
  operationId: "reportMcpToolInvocation",
  path: "/mcp/tool-reports",
  tags: ["MCP"],
  summary: "Report bounded client-side MCP tool statistics",
  description:
    "Accepts low-trust client-reported tool name, duration, outcome and invocation ID only. The report is not execution evidence and never affects permissions, billing or automatic key disabling.",
  middleware: [requirePersonalMcpKey] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: reportSchema } },
    },
  },
  responses: {
    204: { description: "Report recorded or an exact retry acknowledged" },
    400: errorResponse("Malformed or out-of-range telemetry report"),
    403: errorResponse("A personal MCP API key is required"),
    409: errorResponse("Invocation ID was already used for another report"),
  },
});

const router = apiRouter().openapi(reportToolRoute, async (c) => {
  const input = c.req.valid("json");
  const apiKey = c.get("apiKey") as { id: string };
  await recordMcpToolReport(apiKey.id, input);
  c.header("Cache-Control", "no-store");
  return c.body(null, 204);
});

export default router;
