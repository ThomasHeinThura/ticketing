import { describe, expect, it } from "vitest";
import { cspReportRequestSchema } from "../../../apps/api/src/security-headers/csp-report";

describe("bounded CSP report envelopes", () => {
  it("accepts standard legacy and Reporting API CSP violation bodies", () => {
    expect(
      cspReportRequestSchema.safeParse({
        "csp-report": {
          "document-uri": "https://agent.example.test/",
          "violated-directive": "script-src-elem",
          "blocked-uri": "https://bad.example.test/x.js",
          "status-code": 200,
        },
      }).success,
    ).toBe(true);
    expect(
      cspReportRequestSchema.safeParse([
        {
          type: "csp-violation",
          age: 4,
          url: "https://portal.example.test/",
          user_agent: "browser",
          body: {
            effectiveDirective: "frame-src",
            blockedURL: "https://bad.example.test/",
          },
        },
      ]).success,
    ).toBe(true);
  });

  it("rejects unrelated, oversized, malformed, and unbounded report batches", () => {
    expect(
      cspReportRequestSchema.safeParse({ event: "anything" }).success,
    ).toBe(false);
    expect(
      cspReportRequestSchema.safeParse([{ type: "network-error", body: {} }])
        .success,
    ).toBe(false);
    expect(
      cspReportRequestSchema.safeParse(
        Array.from({ length: 21 }, () => ({ type: "csp-violation", body: {} })),
      ).success,
    ).toBe(false);
    expect(
      cspReportRequestSchema.safeParse({
        "csp-report": { "blocked-uri": "x".repeat(4097) },
      }).success,
    ).toBe(false);
    expect(
      cspReportRequestSchema.safeParse({
        "csp-report": Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`field-${index}`, "x"]),
        ),
      }).success,
    ).toBe(false);
  });
});
