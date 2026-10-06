import {
  type LogLevels,
  logLevelsSchema,
  validateLogLevels,
} from "../../observability/settings.js";
import { z } from "../../openapi";

export type { LogLevels };
export { logLevelsSchema };

export function parseLogLevels(value: unknown): LogLevels {
  return validateLogLevels(value);
}

export function isLogLevelsEqual(left: LogLevels, right: LogLevels): boolean {
  return (
    left.default === right.default &&
    ["http", "auth", "database", "jobs", "audit", "plugins", "realtime"].every(
      (module) =>
        left.modules[module as keyof LogLevels["modules"]] ===
        right.modules[module as keyof LogLevels["modules"]],
    )
  );
}

export const logLevelsUpdateSchema = z
  .object({
    version: z.number().int().positive().safe(),
    logLevels: logLevelsSchema,
  })
  .strict();
