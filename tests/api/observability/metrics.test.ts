import { describe, expect, it } from "vitest";
import {
  AUDIT_FAILURE_OPERATIONS,
  createTaskDeskMetrics,
  registeredRouteKey,
} from "../../../apps/api/src/observability/metrics.js";

describe("bounded TaskDesk metrics", () => {
  it("uses only registered method-template routes and finite method/status labels", async () => {
    const route = registeredRouteKey("GET", "/api/work-items/:key");
    const metrics = createTaskDeskMetrics([route]);
    metrics.recordHttpRequest({
      registeredRoute: route,
      method: "GET",
      statusCode: 200,
      durationSeconds: 0.042,
    });
    metrics.recordHttpRequest({
      registeredRoute: "/api/work-items/private-customer-key",
      method: "BREW",
      statusCode: 404,
      durationSeconds: 0.004,
    });
    metrics.recordAuditWriteFailure("mutation");
    metrics.recordAuditWriteFailure("audit_read");
    metrics.recordAuthReload("ok", 5);
    metrics.recordAuthReload("failed", 5);

    const exposition = await metrics.metrics();
    expect(exposition).toContain(
      'route="GET /api/work-items/:key",method="GET",status="2xx"',
    );
    expect(exposition).toContain(
      'route="unmatched",method="OTHER",status="4xx"',
    );
    expect(exposition).toContain('operation="mutation"');
    expect(exposition).toContain('operation="audit_read"');
    expect(exposition).toContain('outcome="ok"');
    expect(exposition).toContain('outcome="failed"');
    expect(exposition).toContain("taskdesk_auth_config_version 5");
    expect(exposition).toContain("taskdesk_auth_rate_limit_unshared 0");
    expect(exposition).not.toContain("private-customer-key");
    expect(exposition).not.toContain("nodejs_");
    expect(exposition.match(/^# HELP /gm)).toHaveLength(7);
    expect(AUDIT_FAILURE_OPERATIONS).toEqual([
      "mutation",
      "pending_action_decision",
      "pending_action_self_read",
      "audit_read",
    ]);
  });

  it("tracks whether auth rate limiting is unshared per replica or backed by Valkey", async () => {
    const metrics = createTaskDeskMetrics([]);
    metrics.setAuthRateLimitUnshared(true);
    expect(await metrics.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 1",
    );
    metrics.setAuthRateLimitUnshared(false);
    expect(await metrics.metrics()).toContain(
      "taskdesk_auth_rate_limit_unshared 0",
    );
  });

  it("keeps in-flight scalar balanced when completion is called more than once", async () => {
    const metrics = createTaskDeskMetrics([]);
    const finish = metrics.beginHttpRequest();
    finish();
    finish();
    expect(await metrics.metrics()).toContain("taskdesk_http_in_flight 0");
  });

  it("rejects unbounded route templates, duplicate registrations, and invalid observations", () => {
    expect(() =>
      registeredRouteKey("GET", "/api/work-items/real-id"),
    ).not.toThrow();
    expect(() => registeredRouteKey("GET", "/api/items?raw=1")).toThrow();
    const route = registeredRouteKey("GET", "/api/items/:id");
    expect(() => createTaskDeskMetrics([route, route])).toThrow();
    const metrics = createTaskDeskMetrics([route]);
    expect(() =>
      metrics.recordHttpRequest({
        registeredRoute: route,
        method: "GET",
        statusCode: 600,
        durationSeconds: 0,
      }),
    ).toThrow("Invalid HTTP metric observation");
    expect(() => metrics.recordAuditWriteFailure("raw-id" as never)).toThrow(
      "Invalid audit metric operation",
    );
    expect(() => metrics.setAuthRateLimitUnshared("1" as never)).toThrow(
      "Invalid auth rate limit unshared observation",
    );
  });
});
