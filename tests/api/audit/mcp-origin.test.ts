import { describe, expect, it } from "vitest";
import { auditOriginForApiKey } from "../../../apps/api/src/audit/mcp-origin";

describe("auditOriginForApiKey", () => {
  it("marks only a verified persisted MCP key", () => {
    expect(auditOriginForApiKey({ isMcp: true })).toBe("mcp");
    expect(auditOriginForApiKey({ isMcp: false })).toBeUndefined();
    expect(auditOriginForApiKey({})).toBeUndefined();
    expect(auditOriginForApiKey(undefined)).toBeUndefined();
  });
});
