/**
 * PostgreSQL `lock_not_available` (SQLSTATE 55P03) detection -- what `lock_timeout` raises when
 * a lock wait gives up. Same "walk the `cause` chain, never match on a message string" shape as
 * `is-raise-exception.ts` and `is-unique-violation.ts`: Drizzle wraps the driver's error and
 * hangs the real `pg` error off `.cause`.
 */
const MAX_CAUSE_DEPTH = 5;

export function isLockNotAvailable(error: unknown): boolean {
  let candidate = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    const { code, cause } = candidate as { code?: unknown; cause?: unknown };

    if (code === "55P03") {
      return true;
    }
    candidate = cause;
  }

  return false;
}
