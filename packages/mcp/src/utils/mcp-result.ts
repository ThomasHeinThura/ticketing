import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { untrustedContent } from "./untrusted.js";

export function textResult(data: unknown, isError = false): CallToolResult {
  const text =
    typeof data === "string" ? data : (JSON.stringify(data, null, 2) ?? "");
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    isError,
  };
}

export function errorResult(message: string): CallToolResult {
  return textResult({ error: message }, true);
}

/**
 * An error whose `message` is written by the MCP server itself and whose `detail` is text
 * copied from a TaskDesk response body. The detail is wrapped as untrusted content.
 */
export function errorResultWithDetail(
  message: string,
  detail: string | null,
): CallToolResult {
  return textResult(
    {
      error: message,
      ...(detail === null
        ? {}
        : { detail: untrustedContent(detail, "customer") }),
    },
    true,
  );
}
