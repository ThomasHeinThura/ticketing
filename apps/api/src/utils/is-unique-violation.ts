/**
 * PostgreSQL `unique_violation` (SQLSTATE 23505) detection.
 *
 * The native workspace routes must answer a slug collision with 409, not the
 * unhandled 500 the retrofit plan calls out at risk R8.
 *
 * Drizzle does NOT rethrow the driver's error unchanged: it wraps it in a
 * `Failed query: …` Error and hangs the original off `cause`, so the code and
 * constraint name are one or more links down that chain. This walks the chain
 * rather than matching on a message string — and the wrapper's message
 * embeds the statement's bound parameters, so it is not something to parse or
 * to surface to a caller.
 */
const MAX_CAUSE_DEPTH = 5;

export function isUniqueViolation(error: unknown, column?: string): boolean {
  let candidate = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    const { code, constraint, cause } = candidate as {
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };

    if (code === "23505") {
      if (!column) {
        return true;
      }
      return typeof constraint === "string" && constraint.includes(column);
    }

    candidate = cause;
  }

  return false;
}
