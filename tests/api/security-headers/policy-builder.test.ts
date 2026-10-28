import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  buildPdfPreviewContentSecurityPolicy,
  reportingEndpointsHeader,
  validateSecurityOrigins,
} from "../../../apps/api/src/security-headers/policy-builder";

const origins = validateSecurityOrigins({
  agent: "https://agent.example.test",
  portal: "https://portal.example.test",
  storage: {
    agent: ["https://files.example.test/presigned-prefix"],
    portal: [],
  },
  telemetry: {
    agent: ["https://sentry.example.test/events"],
    portal: ["https://telemetry.example.test/v1"],
  },
});

describe("per-surface CSP policy", () => {
  it("allows only explicit origins and keeps script, frame, and attachment rules strict", () => {
    const policy = buildContentSecurityPolicy({
      surface: "agent",
      nonce: "A1234567890123456789_abcd",
      origins,
    });

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(
      "script-src 'self' 'nonce-A1234567890123456789_abcd'",
    );
    expect(policy.split("; ")[1]).not.toContain("'unsafe-inline'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' blob: https://files.example.test");
    expect(policy).not.toContain("data:");
    expect(policy.split("; ")[1]).not.toContain("blob:");
    expect(policy).toContain(
      "connect-src 'self' wss://agent.example.test https://files.example.test https://sentry.example.test",
    );
    expect(policy).toContain(
      "frame-src https://agent.example.test/pdf-preview.html https://www.youtube.com/embed/",
    );
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("report-uri /api/public/csp-report");
    expect(policy).toContain("report-to csp-endpoint");
  });

  it("keeps the opaque PDF child isolated to its nonce and own static assets", () => {
    const policy = buildPdfPreviewContentSecurityPolicy({
      surface: "agent",
      nonce: "C1234567890123456789_abcd",
      origins,
    });
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(
      "script-src https://agent.example.test/assets/pdf-preview/ 'nonce-C1234567890123456789_abcd'",
    );
    expect(policy).toContain(
      "worker-src https://agent.example.test/assets/pdf-preview/ blob:",
    );
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("font-src 'none'");
    expect(policy).toContain("sandbox allow-scripts");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toContain("https://files.example.test");
  });

  it("uses the selected origin and never accepts a wildcard or injected source", () => {
    const policy = buildContentSecurityPolicy({
      surface: "portal",
      nonce: "B1234567890123456789_abcd",
      origins,
    });
    expect(policy).toContain("connect-src 'self' wss://portal.example.test");
    expect(policy).toContain("https://telemetry.example.test");
    expect(policy).not.toContain("agent.example.test");

    expect(() =>
      validateSecurityOrigins({
        agent: "https://agent.example.test",
        portal: "https://portal.example.test",
        storage: { agent: ["https://files.example.test, *"] },
      }),
    ).toThrow();
    expect(() =>
      validateSecurityOrigins({
        agent: "https://agent.example.test/path",
        portal: "https://portal.example.test",
      }),
    ).toThrow();
    expect(() =>
      buildContentSecurityPolicy({
        surface: "agent",
        nonce: "nonce-with-quotes'",
        origins,
      }),
    ).toThrow();
  });

  it("binds the Reporting API endpoint to the selected exact origin", () => {
    expect(reportingEndpointsHeader(origins.portal)).toBe(
      'csp-endpoint="https://portal.example.test/api/public/csp-report"',
    );
  });
});
