/**
 * The API's MCP telemetry allowlist (`apps/api`) and the tools `@taskdesk/mcp` registers must
 * name exactly the same tools, aliases included. The packages may not import each other
 * (check:deps), so the parity check lives here, outside both workspaces.
 */
import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES } from "../../apps/api/src/mcp-telemetry/tool-names.js";
import { registerTools } from "../../packages/mcp/src/tools/register.js";

describe("MCP tool names", () => {
  it("keeps the API telemetry allowlist in parity with every registered name and alias", () => {
    const names: string[] = [];
    const server = {
      registerTool: (name: string) => {
        names.push(name);
      },
    };
    const client = {
      json: async () => ({}),
      reportToolInvocation: async () => {},
    };
    registerTools(server as never, { client: client as never });
    expect(names.length).toBeGreaterThan(0);
    expect([...names].sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });
});
