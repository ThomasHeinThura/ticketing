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
 *
 * `constraintName` is matched EXACTLY against `pg_constraint`'s own name for
 * the violated constraint — never as a substring (issue #269, filed from #23's
 * mandatory Opus review of PR #261, finding E7): a substring match on e.g.
 * `"key"` would also match any future unrelated `*_key_something` constraint
 * added near a caller's own insert, silently broadening or narrowing what a
 * caller catches whenever a nearby constraint gets renamed. Pass every
 * constraint name the caller's own insert(s) can actually raise (an array
 * when more than one write in the same try/catch can each raise a different
 * one) — see each call site's own comment for which, and
 * `tests/api/utils/is-unique-violation.test.ts` for how those names were
 * confirmed against the live schema.
 */
const MAX_CAUSE_DEPTH = 5;

export function isUniqueViolation(
  error: unknown,
  constraintName?: string | readonly string[],
): boolean {
  const expected =
    constraintName === undefined
      ? undefined
      : new Set(
          typeof constraintName === "string"
            ? [constraintName]
            : constraintName,
        );
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
      if (!expected) {
        return true;
      }
      return typeof constraint === "string" && expected.has(constraint);
    }

    candidate = cause;
  }

  return false;
}
