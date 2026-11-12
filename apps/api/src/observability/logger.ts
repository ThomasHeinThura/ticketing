import pino, { type DestinationStream, type Logger } from "pino";
import {
  AUDIT_FAILURE_OPERATIONS,
  type AuditFailureOperation,
  type RegisteredHttpRoute,
  registeredRouteKey,
  UNMATCHED_ROUTE,
} from "./metrics.js";
import { SAFE_STACK_FUNCTIONS } from "./server-error-frames.js";
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
  "http.lifecycle_failure",
  "http.server_error",
  "auth.failure",
  "auth.unknown_key_capability",
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

export type StrictPolicyWitness = {
  readonly requestId: string;
  readonly route: RegisteredHttpRoute;
  readonly policySource: string;
  readonly decisionCategory: "allowed" | "denied";
  readonly provenanceValidationResult:
    | "complete"
    | "missing"
    | "ambiguous"
    | "failed"
    | "not_applicable";
};

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
  strictPolicyWitness?: StrictPolicyWitness;
  status?: number;
  method?:
    | "GET"
    | "HEAD"
    | "POST"
    | "PUT"
    | "PATCH"
    | "DELETE"
    | "OPTIONS"
    | "OTHER";
  frames?: string[];
  errorClass?: "HTTPException" | "Error" | "TypeError" | "RangeError" | "Other";
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
  "strictPolicyWitness",
  "status",
  "method",
  "errorClass",
  "frames",
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

const strictWitnessKeys = new Set([
  "requestId",
  "route",
  "policySource",
  "decisionCategory",
  "provenanceValidationResult",
]);

function snapshotPlainDataObject(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string> = new Set(),
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid structured log event");
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError("Invalid structured log event");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Invalid structured log event");
  }

  const snapshot: Record<string, unknown> = Object.create(null);
  const present = new Set<string>();
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedKeys.has(key)) {
      throw new TypeError("Invalid structured log event");
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError("Invalid structured log event");
    }
    snapshot[key] = descriptor.value;
    present.add(key);
  }
  for (const key of requiredKeys) {
    if (!present.has(key)) throw new TypeError("Invalid structured log event");
  }
  return snapshot;
}

function validateEvent(
  event: unknown,
  registeredRoutes: ReadonlySet<RegisteredHttpRoute>,
  registeredPolicySourceByRoute: ReadonlyMap<RegisteredHttpRoute, string>,
): TaskDeskLogEvent {
  const input = snapshotPlainDataObject(event, allowedEventKeys);
  const module = input.module;
  const message = input.message;
  const level = input.level;
  const traceId = input.traceId;
  const result = input.result;
  const statusClass = input.statusClass;
  const durationMs = input.durationMs;
  const route = input.route;
  const auditOperation = input.auditOperation;
  if (
    input.status !== undefined &&
    (message !== "http.server_error" ||
      typeof input.status !== "number" ||
      !Number.isInteger(input.status) ||
      input.status < 500 ||
      input.status > 599)
  )
    throw new TypeError("Invalid structured log event");
  if (
    input.errorClass !== undefined &&
    (message !== "http.server_error" ||
      typeof input.errorClass !== "string" ||
      !["HTTPException", "Error", "TypeError", "RangeError", "Other"].includes(
        input.errorClass,
      ))
  )
    throw new TypeError("Invalid structured log event");
  if (
    typeof module !== "string" ||
    typeof message !== "string" ||
    typeof level !== "string" ||
    !validModules.has(module) ||
    !validMessages.has(message) ||
    !validLevels.has(level)
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    traceId !== undefined &&
    (typeof traceId !== "string" || !safeTraceId.test(traceId))
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    result !== undefined &&
    (typeof result !== "string" || !validResults.has(result))
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    statusClass !== undefined &&
    (typeof statusClass !== "string" || !validStatusClasses.has(statusClass))
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    durationMs !== undefined &&
    (typeof durationMs !== "number" ||
      !Number.isFinite(durationMs) ||
      durationMs < 0)
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    route !== undefined &&
    route !== UNMATCHED_ROUTE &&
    (typeof route !== "string" ||
      !isRegisteredRoute(route) ||
      !registeredRoutes.has(route))
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    auditOperation !== undefined &&
    (typeof auditOperation !== "string" ||
      !validAuditOperations.has(auditOperation))
  ) {
    throw new TypeError("Invalid structured log event");
  }
  if (
    input.method !== undefined &&
    (message !== "http.server_error" ||
      typeof input.method !== "string" ||
      ![
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "OTHER",
      ].includes(input.method))
  )
    throw new TypeError("Invalid structured log event");
  let frames: string[] | undefined;
  if (input.frames !== undefined) {
    if (message !== "http.server_error" || !Array.isArray(input.frames))
      throw new TypeError("Invalid structured log event");
    let descriptors: PropertyDescriptorMap;
    try {
      if (Object.getPrototypeOf(input.frames) !== Array.prototype)
        throw new TypeError("Invalid structured log event");
      descriptors = Object.getOwnPropertyDescriptors(input.frames as object);
    } catch {
      throw new TypeError("Invalid structured log event");
    }
    const length = descriptors.length?.value;
    if (
      !Number.isInteger(length) ||
      length < 0 ||
      length > 15 ||
      Reflect.ownKeys(descriptors).length !== length + 1
    )
      throw new TypeError("Invalid structured log event");
    frames = [];
    for (let i = 0; i < length; i++) {
      const descriptor = descriptors[String(i)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
        throw new TypeError("Invalid structured log event");
      const frame: unknown = descriptor.value;
      if (
        typeof frame !== "string" ||
        frame.length > 512 ||
        !/^(?:[\w.$<>-]{1,100} )?(?:(?:apps|packages|tests)\/[\w./-]+\.(?:[cm]?js|[cm]?ts|tsx|jsx)|node_modules\/(?:@[\w-]+\/)?[\w.-]+):[0-9]{1,7}:[0-9]{1,7}$/.test(
          frame,
        ) ||
        /^(?:[^ ]*(?:token|secret|password|credential|cookie|authorization)[^ ]*) /i.test(
          frame,
        ) ||
        /@[^/]+\./.test(frame) ||
        /[A-Za-z0-9_-]{32,}/.test(frame)
      )
        throw new TypeError("Invalid structured log event");
      const functionName = frame.includes(" ")
        ? frame.slice(0, frame.indexOf(" "))
        : undefined;
      if (
        functionName &&
        !(SAFE_STACK_FUNCTIONS as readonly string[]).includes(functionName)
      )
        throw new TypeError("Invalid structured log event");
      frames.push(frame);
    }
  }
  const safeEvent = Object.create(null) as TaskDeskLogEvent;
  safeEvent.module = module as ObservabilityModule;
  safeEvent.message = message as LogMessage;
  safeEvent.level = level as LogLevel;
  if (frames !== undefined) safeEvent.frames = frames;
  if (input.method !== undefined)
    safeEvent.method = input.method as TaskDeskLogEvent["method"];
  if (input.status !== undefined) safeEvent.status = input.status as number;
  if (input.errorClass !== undefined)
    safeEvent.errorClass = input.errorClass as TaskDeskLogEvent["errorClass"];
  if (traceId !== undefined) safeEvent.traceId = traceId as string;
  if (result !== undefined) safeEvent.result = result as LogResult;
  if (statusClass !== undefined)
    safeEvent.statusClass = statusClass as HttpStatusClass;
  if (durationMs !== undefined) safeEvent.durationMs = durationMs as number;
  if (route !== undefined)
    safeEvent.route = route as RegisteredHttpRoute | typeof UNMATCHED_ROUTE;
  if (auditOperation !== undefined)
    safeEvent.auditOperation = auditOperation as AuditFailureOperation;

  if (input.strictPolicyWitness !== undefined) {
    const witness = snapshotPlainDataObject(
      input.strictPolicyWitness,
      strictWitnessKeys,
      strictWitnessKeys,
    );
    const requestId = witness.requestId;
    const witnessRoute = witness.route;
    const policySource = witness.policySource;
    const decisionCategory = witness.decisionCategory;
    const provenanceValidationResult = witness.provenanceValidationResult;
    if (
      message !== "http.request" ||
      typeof requestId !== "string" ||
      !/^[0-9a-f]{32}$/.test(requestId) ||
      traceId !== requestId ||
      typeof witnessRoute !== "string" ||
      !registeredRoutes.has(witnessRoute as RegisteredHttpRoute) ||
      route !== witnessRoute ||
      typeof policySource !== "string" ||
      registeredPolicySourceByRoute.get(witnessRoute as RegisteredHttpRoute) !==
        policySource ||
      (decisionCategory !== "allowed" && decisionCategory !== "denied") ||
      typeof provenanceValidationResult !== "string" ||
      ![
        "complete",
        "missing",
        "ambiguous",
        "failed",
        "not_applicable",
      ].includes(provenanceValidationResult)
    ) {
      throw new TypeError("Invalid structured log event");
    }
    const canonicalWitness = Object.freeze(
      Object.assign(Object.create(null) as StrictPolicyWitness, {
        requestId,
        route: witnessRoute,
        policySource,
        decisionCategory,
        provenanceValidationResult,
      }),
    );
    safeEvent.strictPolicyWitness = canonicalWitness;
  }
  return safeEvent;
}

/**
 * Create the application's allowlist logger. No request/error/config objects are
 * accepted or spread into records; Pino redaction is defense in depth only.
 */
export function createTaskDeskLogger(
  initialLevels: unknown,
  trustedRoutes: ReadonlySet<RegisteredHttpRoute>,
  destination: DestinationStream = process.stdout,
  trustedPolicySourceByRoute: ReadonlyMap<
    RegisteredHttpRoute,
    string
  > = new Map(),
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
  const registeredPolicySourceByRoute = new Map(trustedPolicySourceByRoute);
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
      const safeEvent = validateEvent(
        event,
        registeredRoutes,
        registeredPolicySourceByRoute,
      );
      let logger = moduleLoggers.get(safeEvent.module);
      if (!logger) {
        const moduleBinding = { module: safeEvent.module };
        logger = root.child(moduleBinding, {
          level: logLevelFor(safeEvent.module, levels),
        });
        moduleLoggers.set(safeEvent.module, logger);
      }
      if (!logger.isLevelEnabled(safeEvent.level)) return;

      const fields: Record<string, unknown> = {
        module: safeEvent.module,
        messageKey: safeEvent.message,
      };
      if (safeEvent.frames !== undefined) fields.frames = safeEvent.frames;
      if (safeEvent.method !== undefined) fields.method = safeEvent.method;
      if (safeEvent.status !== undefined) fields.status = safeEvent.status;
      if (safeEvent.errorClass !== undefined)
        fields.errorClass = safeEvent.errorClass;
      if (safeEvent.traceId !== undefined) fields.traceId = safeEvent.traceId;
      if (safeEvent.result !== undefined) fields.result = safeEvent.result;
      if (safeEvent.statusClass !== undefined)
        fields.statusClass = safeEvent.statusClass;
      if (safeEvent.durationMs !== undefined)
        fields.durationMs = safeEvent.durationMs;
      if (safeEvent.route !== undefined) fields.route = safeEvent.route;
      if (safeEvent.auditOperation !== undefined)
        fields.auditOperation = safeEvent.auditOperation;
      if (safeEvent.strictPolicyWitness !== undefined)
        fields.strictPolicyWitness = safeEvent.strictPolicyWitness;
      logger[safeEvent.level](fields, safeEvent.message);
    },
  };
}
