import type { BrowserContext, Request, Response } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { attachPerformanceNetworkCapture } from "../../e2e/helpers/performance-network-summary";

function makeContext() {
  const listeners = new Map<string, (value: never) => void>();
  const context = {
    on(event: string, listener: (value: never) => void) {
      listeners.set(event, listener);
    },
    off(event: string, listener: (value: never) => void) {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  } as unknown as BrowserContext;
  return {
    context,
    emit(event: string, value: unknown) {
      listeners.get(event)?.(value as never);
    },
    listenerCount: () => listeners.size,
  };
}

function makeRequest(url: string, method = "POST") {
  return {
    method: () => method,
    url: () => url,
    resourceType: () => "fetch",
    timing: () => ({
      requestStart: 0,
      responseStart: 12.5,
      responseEnd: 18.25,
      responseBodySize: 999,
    }),
    headers: () => ({ "x-probe-secret": "sentinel" }),
    postData: () => "secret-body",
  } as unknown as Request;
}

function completeRequest(
  emit: (event: string, value: unknown) => void,
  request: Request,
  status = 201,
) {
  emit("request", request);
  emit("response", {
    request: () => request,
    status: () => status,
  } as unknown as Response);
  emit("requestfinished", request);
}

describe("G11 sanitized performance network evidence", () => {
  it("keeps only allowlisted same-origin fields and finite timings", () => {
    const mock = makeContext();
    const capture = attachPerformanceNetworkCapture(
      mock.context,
      "http://127.0.0.1:4178",
    );
    const request = makeRequest(
      "http://127.0.0.1:4178/api/fixture?token=secret",
    );

    completeRequest(mock.emit, request);
    const json = capture.finish();
    const summary = JSON.parse(json) as {
      requests: Array<Record<string, unknown>>;
      droppedCount: number;
      truncated: boolean;
    };

    expect(summary.requests).toEqual([
      {
        method: "POST",
        path: "/api/fixture",
        resourceType: "fetch",
        status: 201,
        timing: { requestStart: 0, responseStart: 12.5, responseEnd: 18.25 },
      },
    ]);
    expect(json).not.toContain("token=secret");
    expect(json).not.toContain("sentinel");
    expect(json).not.toContain("secret-body");
    expect(summary.droppedCount).toBe(0);
    expect(summary.truncated).toBe(false);
    expect(mock.listenerCount()).toBe(0);
  });

  it("masks secret-like path segments and external origins", () => {
    const mock = makeContext();
    const capture = attachPerformanceNetworkCapture(
      mock.context,
      "http://127.0.0.1:4178",
    );
    const secretPath = makeRequest(
      "http://127.0.0.1:4178/api/reset/token/short-secret",
      "TRACE",
    );
    const projectPath = makeRequest(
      "http://127.0.0.1:4178/agent/projects/project-g11/work",
      "GET",
    );
    const external = makeRequest(
      "https://outside.example/private?token=x",
      "GET",
    );

    completeRequest(mock.emit, secretPath, 200);
    completeRequest(mock.emit, projectPath, 200);
    completeRequest(mock.emit, external, 200);
    const json = capture.finish();
    const summary = JSON.parse(json) as {
      requests: Array<Record<string, unknown>>;
    };

    expect(summary.requests.map((request) => request.path)).toEqual([
      "/api/reset/:redacted/:redacted",
      "/agent/projects/:redacted/work",
      "external",
    ]);
    expect(summary.requests[0]?.method).toBe("OTHER");
    expect(json).not.toContain("short-secret");
    expect(json).not.toContain("outside.example");
    expect(json).not.toContain("token=x");
  });

  it("drops unknown methods, resource types, statuses, and non-finite timings", () => {
    const mock = makeContext();
    const capture = attachPerformanceNetworkCapture(
      mock.context,
      "http://127.0.0.1:4178",
    );
    const request = {
      method: () => "TRACE",
      url: () => "http://127.0.0.1:4178/api/probe",
      resourceType: () => "unknown-type",
      timing: () => ({
        requestStart: Number.NaN,
        responseStart: -1,
        responseEnd: Number.POSITIVE_INFINITY,
      }),
    } as unknown as Request;

    completeRequest(mock.emit, request, 700);
    const summary = JSON.parse(capture.finish()) as {
      requests: Array<Record<string, unknown>>;
    };

    expect(summary.requests).toEqual([
      {
        method: "OTHER",
        path: "/api/probe",
        resourceType: "other",
      },
    ]);
  });

  it("reports entry and byte truncation instead of silently dropping evidence", () => {
    const mock = makeContext();
    const capture = attachPerformanceNetworkCapture(
      mock.context,
      "http://127.0.0.1:4178",
      { maxRequests: 2, maxAttachmentBytes: 260 },
    );
    for (let index = 0; index < 5; index += 1) {
      const suffix = "a".repeat(70);
      completeRequest(
        mock.emit,
        makeRequest(`http://127.0.0.1:4178/api/${suffix}/${index}`, "GET"),
        200,
      );
    }

    const json = capture.finish();
    const summary = JSON.parse(json) as {
      requests: Array<Record<string, unknown>>;
      droppedCount: number;
      truncated: boolean;
    };

    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(260);
    expect(summary.requests.length).toBeLessThanOrEqual(2);
    expect(summary.droppedCount).toBeGreaterThan(0);
    expect(summary.truncated).toBe(true);
  });
});
