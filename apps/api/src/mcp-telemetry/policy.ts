import type { PolicyMap } from "@taskdesk/permissions";

export const mcpTelemetryPolicies = {
  "POST /api/mcp/tool-reports": {
    authenticated: true,
    self: true,
    personParam: {
      exempt: "no_person_parameter",
      reason:
        "accepts only the authenticated personal MCP key own bounded diagnostic reports",
    },
  },
} as const satisfies PolicyMap;
