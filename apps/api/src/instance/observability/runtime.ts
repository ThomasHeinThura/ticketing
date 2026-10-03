import { eq } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  createTaskDeskLogger,
  type TaskDeskLogEvent,
} from "../../observability/logger.js";
import {
  type AuditFailureOperation,
  createTaskDeskMetrics,
  registeredRouteKey,
  UNMATCHED_ROUTE,
} from "../../observability/metrics.js";
import {
  createMetricsListener,
  METRICS_LISTENER_MANIFEST,
} from "../../observability/metrics-listener.js";
import { defaultLogLevels } from "../../observability/settings.js";
import { policyRegistry } from "../../policy-registry";
import { createObservabilityConfigRefresher } from "./config-refresh-version";
import { parseLogLevels } from "./settings";

const routeKeys = policyRegistry.entries.flatMap(({ routeKey }) => {
  const match = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\/[^?#]*)$/u.exec(
    routeKey,
  );
  if (!match) return [];
  const method = match[1];
  const pathname = match[2];
  return method && pathname ? [registeredRouteKey(method, pathname)] : [];
});
const trustedRoutes = new Set(routeKeys);
const metrics = createTaskDeskMetrics(routeKeys);
const logger = createTaskDeskLogger(defaultLogLevels(), trustedRoutes);
let listener: ReturnType<typeof createMetricsListener> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshController:
  | ReturnType<typeof createObservabilityConfigRefresher>
  | undefined;

export function logTaskDesk(event: TaskDeskLogEvent): void {
  logger.log(event);
}

export function applyRuntimeLogLevels(value: unknown): void {
  logger.setLogLevels(value);
}

export function observeRequest(input: {
  method: string;
  route?: string;
  status: number;
  durationMs: number;
}): void {
  metrics.recordHttpRequest({
    method: input.method,
    registeredRoute: input.route,
    statusCode: input.status,
    durationSeconds: input.durationMs / 1000,
  });
  const level =
    input.status >= 500 ? "error" : input.status >= 400 ? "warn" : "info";
  const route =
    input.route && trustedRoutes.has(input.route as (typeof routeKeys)[number])
      ? (input.route as (typeof routeKeys)[number])
      : UNMATCHED_ROUTE;
  logger.log({
    module: "http",
    message: "http.request",
    level,
    statusClass:
      `${Math.floor(input.status / 100)}xx` as TaskDeskLogEvent["statusClass"],
    durationMs: input.durationMs,
    route,
  });
}

export function beginObservedRequest(): () => void {
  return metrics.beginHttpRequest();
}

export function recordAuditWriteFailure(
  operation: AuditFailureOperation,
  options: { readonly log?: boolean } = {},
): void {
  metrics.recordAuditWriteFailure(operation);
  if (options.log !== false) {
    logger.log({
      module: "audit",
      message: "audit.write_failure",
      level: "error",
      result: "failed",
      auditOperation: operation,
    });
  }
}

export async function startObservabilityRuntime(): Promise<void> {
  const [row] = await db
    .select({
      version: schema.instanceSettingTable.observabilityConfigVersion,
      levels: schema.instanceSettingTable.observabilityLogLevels,
    })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  if (!row) throw new Error("Observability settings unavailable");
  logger.setLogLevels(parseLogLevels(row.levels));

  listener = createMetricsListener({
    readCurrentTokenDigest: async () => {
      const [current] = await db
        .select({ digest: schema.instanceSettingTable.metricsTokenHash })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"))
        .limit(1);
      return current?.digest ?? null;
    },
    renderMetrics: () => metrics.metrics(),
  });
  try {
    await listener.start();
  } catch {
    logger.log({
      module: "http",
      message: "observability.listener_bind_failure",
      level: "error",
      result: "failed",
    });
    throw new Error(
      `Metrics listener failed to bind on ${METRICS_LISTENER_MANIFEST.port}`,
    );
  }

  refreshController = createObservabilityConfigRefresher({
    read: async () => {
      const [current] = await db
        .select({
          version: schema.instanceSettingTable.observabilityConfigVersion,
          levels: schema.instanceSettingTable.observabilityLogLevels,
        })
        .from(schema.instanceSettingTable)
        .where(eq(schema.instanceSettingTable.id, "singleton"))
        .limit(1);
      return current;
    },
    validate: parseLogLevels,
    apply: applyRuntimeLogLevels,
    onFailure: () =>
      logger.log({
        module: "http",
        message: "observability.config_refresh_failure",
        level: "warn",
        result: "degraded",
      }),
    initialVersion: row.version,
  });
  refreshTimer = setInterval(() => {
    void refreshController?.refresh();
  }, 5_000);
  refreshTimer.unref();
}

export async function stopObservabilityRuntime(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;
  refreshController?.stop();
  refreshController = undefined;
  await listener?.stop();
  listener = undefined;
}
