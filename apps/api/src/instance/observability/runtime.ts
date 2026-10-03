import { normaliseRouteKey } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  createTaskDeskLogger,
  type TaskDeskLogEvent,
} from "../../observability/logger.js";
import {
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
import { parseLogLevels } from "./settings";

const routeKeys = policyRegistry.entries.flatMap(({ routeKey }) => {
  const match = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS) (\/[^?#]*)$/u.exec(
    routeKey,
  );
  return match ? [registeredRouteKey(match[1]!, match[2]!)] : [];
});
const trustedRoutes = new Set(routeKeys);
const metrics = createTaskDeskMetrics(routeKeys);
const logger = createTaskDeskLogger(defaultLogLevels(), trustedRoutes);
let listener: ReturnType<typeof createMetricsListener> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let failureLogged = false;

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
  operation:
    | "mutation"
    | "pending_action_decision"
    | "pending_action_self_read",
): void {
  metrics.recordAuditWriteFailure(operation);
  logger.log({
    module: "audit",
    message: "audit.write_failure",
    level: "error",
    result: "failed",
  });
}

export async function startObservabilityRuntime(): Promise<void> {
  const [row] = await db
    .select({ levels: schema.instanceSettingTable.observabilityLogLevels })
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

  refreshTimer = setInterval(() => {
    void db
      .select({ levels: schema.instanceSettingTable.observabilityLogLevels })
      .from(schema.instanceSettingTable)
      .where(eq(schema.instanceSettingTable.id, "singleton"))
      .limit(1)
      .then(([current]) => {
        if (!current) throw new Error("settings_missing");
        logger.setLogLevels(parseLogLevels(current.levels));
        failureLogged = false;
      })
      .catch(() => {
        if (failureLogged) return;
        failureLogged = true;
        logger.log({
          module: "http",
          message: "observability.config_refresh_failure",
          level: "warn",
          result: "degraded",
        });
      });
  }, 5_000);
  refreshTimer.unref();
}

export async function stopObservabilityRuntime(): Promise<void> {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = undefined;
  await listener?.stop();
  listener = undefined;
}
