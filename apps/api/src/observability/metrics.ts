import { Counter, Gauge, Histogram, Registry } from "prom-client";

export const HTTP_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "OTHER",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const HTTP_STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"] as const;
export type HttpStatusClass = (typeof HTTP_STATUS_CLASSES)[number];

export const AUDIT_FAILURE_OPERATIONS = [
  "mutation",
  "pending_action_decision",
  "pending_action_self_read",
  "audit_read",
] as const;
export type AuditFailureOperation = (typeof AUDIT_FAILURE_OPERATIONS)[number];

export const UNMATCHED_ROUTE = "unmatched" as const;
export const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

/** A trusted method+template key taken from the live route registry. */
export type RegisteredHttpRoute = string & {
  readonly __registeredHttpRoute: unique symbol;
};

const methodSet = new Set<string>(
  HTTP_METHODS.filter((method) => method !== "OTHER"),
);
const auditOperationSet = new Set<string>(AUDIT_FAILURE_OPERATIONS);
const registeredRoutePattern =
  /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) \/[^?#]*$/;

export function registeredRouteKey(
  method: string,
  template: string,
): RegisteredHttpRoute {
  const key = `${method} ${template}`;
  if (!registeredRoutePattern.test(key)) {
    throw new TypeError("Invalid registered HTTP route");
  }
  return key as RegisteredHttpRoute;
}

export interface HttpRequestMetric {
  /** Exact method+template key resolved from the actual app route registry. */
  registeredRoute?: string;
  method: string;
  statusCode: number;
  durationSeconds: number;
}

export interface TaskDeskMetrics {
  registry: Registry;
  beginHttpRequest(): () => void;
  recordHttpRequest(request: HttpRequestMetric): void;
  recordAuditWriteFailure(operation: AuditFailureOperation): void;
  recordAuthReload(outcome: "ok" | "failed", configVersion: number): void;
  metrics(): Promise<string>;
  contentType: string;
}

export function createTaskDeskMetrics(
  registeredRoutes: readonly RegisteredHttpRoute[],
): TaskDeskMetrics {
  const routeSet = new Set<string>();
  for (const route of registeredRoutes) {
    if (typeof route !== "string" || !registeredRoutePattern.test(route)) {
      throw new TypeError("Invalid registered HTTP route");
    }
    if (routeSet.has(route))
      throw new TypeError("Duplicate registered HTTP route");
    routeSet.add(route);
  }

  // An isolated registry prevents default process, runtime, and business collectors
  // from silently expanding this finite P0 catalogue.
  const registry = new Registry();
  const requests = new Counter({
    name: "taskdesk_http_requests_total",
    help: "HTTP requests served by the TaskDesk API.",
    labelNames: ["route", "method", "status"] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: "taskdesk_http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labelNames: ["route", "method"] as const,
    buckets: [...HTTP_DURATION_BUCKETS_SECONDS],
    registers: [registry],
  });
  const inFlight = new Gauge({
    name: "taskdesk_http_in_flight",
    help: "HTTP requests currently being served.",
    registers: [registry],
  });
  const auditFailures = new Counter({
    name: "taskdesk_audit_write_failures_total",
    help: "Audit writes that failed after preserving the caller contract.",
    labelNames: ["operation"] as const,
    registers: [registry],
  });
  const authReloads = new Counter({
    name: "taskdesk_auth_reload_total",
    help: "Auth configuration reloads by outcome.",
    labelNames: ["outcome"] as const,
    registers: [registry],
  });
  const authConfigVersion = new Gauge({
    name: "taskdesk_auth_config_version",
    help: "Auth configuration version currently served by this replica.",
    registers: [registry],
  });

  return {
    registry,
    beginHttpRequest() {
      inFlight.inc();
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        inFlight.dec();
      };
    },
    recordHttpRequest(request) {
      if (
        !Number.isInteger(request.statusCode) ||
        request.statusCode < 100 ||
        request.statusCode > 599 ||
        !Number.isFinite(request.durationSeconds) ||
        request.durationSeconds < 0
      ) {
        throw new TypeError("Invalid HTTP metric observation");
      }
      const method = methodSet.has(request.method)
        ? (request.method as HttpMethod)
        : "OTHER";
      const route =
        request.registeredRoute && routeSet.has(request.registeredRoute)
          ? request.registeredRoute
          : UNMATCHED_ROUTE;
      const status =
        `${Math.floor(request.statusCode / 100)}xx` as HttpStatusClass;
      requests.inc({ route, method, status });
      duration.observe({ route, method }, request.durationSeconds);
    },
    recordAuditWriteFailure(operation) {
      if (!auditOperationSet.has(operation)) {
        throw new TypeError("Invalid audit metric operation");
      }
      auditFailures.inc({ operation });
    },
    recordAuthReload(outcome, configVersion) {
      if (outcome !== "ok" && outcome !== "failed") {
        throw new TypeError("Invalid auth reload outcome");
      }
      if (!Number.isInteger(configVersion) || configVersion < 0) {
        throw new TypeError("Invalid auth configuration version");
      }
      authReloads.inc({ outcome });
      if (outcome === "ok") authConfigVersion.set(configVersion);
    },
    metrics: () => registry.metrics(),
    contentType: registry.contentType,
  };
}
