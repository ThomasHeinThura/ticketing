import type { ApiKey } from "../openapi";

/** Only the API-key kind loaded by authentication can mark a mutation as MCP-originated. */
export function auditOriginForApiKey(
  apiKey: Pick<ApiKey, "isMcp"> | undefined,
): "mcp" | undefined {
  return apiKey?.isMcp === true ? "mcp" : undefined;
}
