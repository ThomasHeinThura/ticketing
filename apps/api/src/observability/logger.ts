import pino, { type DestinationStream, type Logger } from "pino";
import {
  AUDIT_FAILURE_OPERATIONS,
  type AuditFailureOperation,
  type RegisteredHttpRoute,
  registeredRouteKey,
  UNMATCHED_ROUTE,
} from "./metrics.js";
import {
  LOG_LEVELS,
  type LogLevel,
  type LogLevels,
  logLevelFor,
  OBSERVABILITY_MODULES,
  type ObservabilityModule,
  validateLogLevels,
} from "./settings.js";

export const LOG_MESSAGES = [
  "http.request",
  "auth.failure",
  "database.failure",
  "jobs.failure",
  "audit.write_failure",
  "plugins.failure",
  "realtime.failure",
  "observability.config_refresh_failure",
  "observability.listener_bind_failure",
] as const;
export type LogMessage = (typeof LOG_MESSAGES)[number];

export const LOG_RESULTS = ["ok", "failed", "denied", "degraded"] as const;
export type LogResult = (typeof LOG_RESULTS)[number];

export const HTTP_STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"] as const;
export type HttpStatusClass = (typeof HTTP_STATUS_CLASSES)[number];

export interface TaskDeskLogEvent {
  module: ObservabilityModule;
  message: LogMessage;
  level: LogLevel;
  traceId?: string;
  result?: LogResult;
  statusClass?: HttpStatusClass;
  durationMs?: number;
  route?: RegisteredHttpRoute | typeof UNMATCHED_ROUTE;
  auditOperation?: AuditFailureOperation;
}

export interface TaskDeskLogger {
  /** Atomically validate and apply a complete safe level snapshot. */
  setLogLevels(value: unknown): void;
  /** Emit only closed event keys and enumerated context values. */
  log(event: TaskDeskLogEvent): void;
}

const allowedEventKeys = new Set([
  "module",
  "message",
  "level",
  "traceId",
  "result",
  "statusClass",
  "durationMs",
  "route",
  "auditOperation",
]);
const validModules = new Set<string>(OBSERVABILITY_MODULES);
const validAuditOperations = new Set<string>(AUDIT_FAILURE_OPERATIONS);
const validMessages = new Set<string>(LOG_MESSAGES);
const validLevels = new Set<string>(LOG_LEVELS);
const validResults = new Set<string>(LOG_RESULTS);
const validStatusClasses = new Set<string>(HTTP_STATUS_CLASSES);
const safeTraceId = /^[A-Za-z0-9._:-]{1,128}$/;

function isRegisteredRoute(value: unknown): value is RegisteredHttpRoute {
  if (typeof value !== "string") return false;
  const separator = value.indexOf(" ");
  if (separator < 0) return false;
  try {
    return (
      registeredRouteKey(
        value.slice(0, separator),
        value.slice(separator + 1),
      ) === value
    );
  } catch {
    return false;
  }
}

function validateEvent(
  event: TaskDeskLogEvent,
  registeredRoutes: ReadonlySet<RegisteredHttpRoute>,
): void {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TypeError("Invalid structured log event");
  }
  if (Object.keys(event).some((key) => !allowedEventKeys.has(key))) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    !validModules.has(event.module) ||
    !validMessages.has(event.message) ||
    !validLevels.has(event.level)
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (event.traceId !== undefined && !safeTraceId.test(event.traceId)) {
    throw new TypeError("Invalid structured log event");
  }
  if (event.result !== undefined && !validResults.has(event.result)) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    event.statusClass !== undefined &&
    !validStatusClasses.has(event.statusClass)
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    event.durationMs !== undefined &&
    (!Number.isFinite(event.durationMs) || event.durationMs < 0)
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    event.route !== undefined &&
    event.route !== UNMATCHED_ROUTE &&
    (!isRegisteredRoute(event.route) || !registeredRoutes.has(event.route))
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    event.auditOperation !== undefined &&
    !validAuditOperations.has(event.auditOperation)
  ) {
    throw new TypeError("Invalid structured log event");
  }
}

/**
 * Create the application's allowlist logger. No request/error/config objects are
 * accepted or spread into records; Pino redaction is defense in depth only.
 */
export function createTaskDeskLogger(
  initialLevels: unknown,
  trustedRoutes: ReadonlySet<RegisteredHttpRoute>,
  destination: DestinationStream = process.stdout,
): TaskDeskLogger {
  let levels: LogLevels = validateLogLevels(initialLevels);
  const registeredRoutes = new Set<RegisteredHttpRoute>();
  if (!trustedRoutes || typeof trustedRoutes[Symbol.iterator] !== "function") {
    throw new TypeError("Invalid registered HTTP routes");
  }
  for (const route of trustedRoutes) {
    if (!isRegisteredRoute(route) || registeredRoutes.has(route)) {
      throw new TypeError("Invalid registered HTTP routes");
    }
    registeredRoutes.add(route);
  }
  const root: Logger = pino(
    {
      level: "trace",
      redact: {
        paths: [
          "authorization",
          "cookie",
          "set-cookie",
          "password",
          "token",
          "apiKey",
          "secret",
          "headers.authorization",
          "headers.cookie",
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['set-cookie']",
        ],
        censor: "[Redacted]",
      },
    },
    destination,
  );
  const moduleLoggers = new Map<ObservabilityModule, Logger>();

  const applyLevels = (next: LogLevels) => {
    for (const module of OBSERVABILITY_MODULES) {
      const logger = moduleLoggers.get(module);
      if (logger) logger.level = logLevelFor(module, next);
    }
    levels = next;
  };

  return {
    setLogLevels(value) {
      // Parse fully before mutating any logger, so partial/invalid updates cannot
      // leave modules at mixed versions.
      const next = validateLogLevels(value);
      applyLevels(next);
    },
    log(event) {
      validateEvent(event, registeredRoutes);
      let logger = moduleLoggers.get(event.module);
      if (!logger) {
        logger = root.child(
          { module: event.module },
          { level: logLevelFor(event.module, levels) },
        );
        moduleLoggers.set(event.module, logger);
      }
      if (!logger.isLevelEnabled(event.level)) return;

      const fields: Record<string, string | number> = {
        module: event.module,
        messageKey: event.message,
      };
      if (event.traceId !== undefined) fields.traceId = event.traceId;
      if (event.result !== undefined) fields.result = event.result;
      if (event.statusClass !== undefined)
        fields.statusClass = event.statusClass;
      if (event.durationMs !== undefined) fields.durationMs = event.durationMs;
      if (event.route !== undefined) fields.route = event.route;
      if (event.auditOperation !== undefined)
        fields.auditOperation = event.auditOperation;
      logger[event.level](fields, event.message);
    },
  };
}
