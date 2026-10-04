import { z } from "zod";

export const LOG_LEVELS = ["error", "warn", "info", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const OBSERVABILITY_MODULES = [
  "http",
  "auth",
  "database",
  "jobs",
  "audit",
  "plugins",
  "realtime",
] as const;
export type ObservabilityModule = (typeof OBSERVABILITY_MODULES)[number];

const levelSchema = z.enum(LOG_LEVELS);
const modulesSchema = z
  .object({
    http: levelSchema.optional(),
    auth: levelSchema.optional(),
    database: levelSchema.optional(),
    jobs: levelSchema.optional(),
    audit: levelSchema.optional(),
    plugins: levelSchema.optional(),
    realtime: levelSchema.optional(),
  })
  .strict();

export const logLevelsSchema = z
  .object({
    default: levelSchema,
    modules: modulesSchema,
  })
  .strict();

export type LogLevels = z.infer<typeof logLevelsSchema>;

export class InvalidLogLevelsError extends Error {
  constructor() {
    super("Invalid observability log levels");
    this.name = "InvalidLogLevelsError";
  }
}

/** Validate an untrusted persisted or submitted document without coercion. */
export function validateLogLevels(value: unknown): LogLevels {
  const parsed = logLevelsSchema.safeParse(value);
  if (!parsed.success) throw new InvalidLogLevelsError();
  return parsed.data;
}

export function defaultLogLevels(): LogLevels {
  return {
    default: "info",
    modules: {
      http: "info",
      auth: "info",
      database: "info",
      jobs: "info",
      audit: "info",
      plugins: "info",
      realtime: "info",
    },
  };
}

export function logLevelFor(
  module: ObservabilityModule,
  levels: LogLevels,
): LogLevel {
  return levels.modules[module] ?? levels.default;
}
