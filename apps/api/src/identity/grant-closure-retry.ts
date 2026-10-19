import { IdentityGrantClosureChangedError } from "./errors";

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError`; the Postgres SQLSTATE lives on
 * the innermost `cause`. Walk the chain so a wrapped 40P01/40001/23503/23505 is retried.
 */
export function databaseErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/u.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export async function retryIdentityGrantClosure<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const code = databaseErrorCode(error);
      const retryableDatabaseConflict =
        code === "40P01" ||
        code === "40001" ||
        code === "23503" ||
        code === "23505";
      if (
        (!(error instanceof IdentityGrantClosureChangedError) &&
          !retryableDatabaseConflict) ||
        attempt === 2
      )
        throw error;
    }
  }
  throw new IdentityGrantClosureChangedError();
}
