import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type ClientReportedToolUsage = {
  toolName: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  meanDurationMs: number;
  maxDurationMs: number;
  lastReportedAt: string;
};

export type McpUsageKey = {
  id: string;
  name: string | null;
  prefix: string | null;
  createdAt: string;
  enabled: boolean;
  recordedRequestCount: number;
  lastRecordedAt: string | null;
  autoDisabledAt: string | null;
  clientReportedTools: ClientReportedToolUsage[];
};

export type McpUsage = {
  periodStart: string;
  periodEnd: string;
  hasMore: boolean;
  keys: McpUsageKey[];
};

export async function getMcpUsage(): Promise<McpUsage> {
  const response = await apiFetch(getApiUrl("instance/mcp/usage"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "MCP usage request failed");
  return (await response.json()) as McpUsage;
}
