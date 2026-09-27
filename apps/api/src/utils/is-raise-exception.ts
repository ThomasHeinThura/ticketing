/**
 * PostgreSQL `raise_exception` (SQLSTATE P0001) detection -- the default SQLSTATE a plain
 * `RAISE EXCEPTION` (no explicit `SQLSTATE` clause) raises. Same "walk the `cause` chain,
 * never match on a message string" shape as `is-unique-violation.ts`'s own
 * `isUniqueViolation`, for the identical reason: Drizzle wraps the driver's error in a
 * `Failed query: …` Error and hangs the original off `cause`, several links down.
 *
 * Used by `set-work-item-parent.ts` as pure defense-in-depth: that controller already
 * validates `RH-8`'s cycle rule at the application layer (via `ancestorChain` +
 * `@taskdesk/domain`'s `validateReparent`) before ever issuing the write, so this should
 * never actually trip in practice -- the only way it fires is a genuine race lost against
 * migration 0056's `work_item_reject_parent_cycle` trigger (a concurrent reparent
 * completing between this route's own pre-write check and its `UPDATE`), which the
 * trigger's own row-locking walk is what actually prevents the cycle, not this catch.
 * There is no message-shaped way to tell "cycle" apart from the trigger's other two
 * `RAISE EXCEPTION`s (missing-ancestor, hop-limit) from out here, and the caller does not
 * need to: any of the three means "this reparent could not be safely completed," which a
 * generic 409 communicates plainly enough for a client to retry with fresh data.
 */
const MAX_CAUSE_DEPTH = 5;

export function isRaiseException(error: unknown): boolean {
  let candidate = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    if (typeof candidate !== "object" || candidate === null) {
      return false;
    }
    const { code, cause } = candidate as { code?: unknown; cause?: unknown };

    if (code === "P0001") {
      return true;
    }
    candidate = cause;
  }

  return false;
}
