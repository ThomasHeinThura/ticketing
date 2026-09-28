/**
 * `isPostgresDeadlockError` (issue #442, Opus security review of PR #457, D2): the
 * narrow predicate that decides whether a caught error is Postgres's own
 * `40P01 deadlock_detected`, which `transitionWorkItem` maps to a 409 rather than letting
 * it surface as an unhandled 500 (`transition-work-item.ts`'s own doc comment explains
 * why this route and `set-work-item-parent.ts` can genuinely deadlock against each
 * other).
 *
 * DISCLOSED SCOPE BOUNDARY: this is a unit test of the mapping predicate only. A live,
 * two-route reproduction (an actual concurrent `POST /transition` and
 * `POST /work-items/{key}/parent` colliding into a real Postgres deadlock) was not
 * attempted here -- coordinating two distinct routes' own internal lock sequences
 * precisely enough to force `40P01` deterministically is substantially more involved than
 * this predicate's own unit coverage, and was not attempted under this session's time
 * constraints. Flagged in the pull request body rather than silently left uncovered.
 */
import { describe, expect, it } from "vitest";
import { isPostgresDeadlockError } from "../../../apps/api/src/work-item/controllers/transition-work-item";

describe("isPostgresDeadlockError", () => {
  it("recognises a real pg deadlock error by its SQLSTATE code", () => {
    expect(isPostgresDeadlockError({ code: "40P01" })).toBe(true);
  });

  it("does not match a different SQLSTATE (e.g. a unique-violation)", () => {
    expect(isPostgresDeadlockError({ code: "23505" })).toBe(false);
  });

  it("does not match a plain Error with no code", () => {
    expect(isPostgresDeadlockError(new Error("boom"))).toBe(false);
  });

  it("fails closed (does not throw, returns false) on non-object input", () => {
    expect(isPostgresDeadlockError("40P01")).toBe(false);
    expect(isPostgresDeadlockError(null)).toBe(false);
    expect(isPostgresDeadlockError(undefined)).toBe(false);
  });
});
