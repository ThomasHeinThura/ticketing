/**
 * `isPostgresDeadlockError` (issue #442, Opus security review of PR #457, D2/D3): the
 * narrow predicate that decides whether a caught error is Postgres's own
 * `40P01 deadlock_detected`, which `transitionWorkItem` maps to a 409 rather than letting
 * it surface as an unhandled 500 (`transition-work-item.ts`'s own doc comment explains
 * why this route and `set-work-item-parent.ts` can genuinely deadlock against each
 * other).
 *
 * D3 (third-round Opus delta review): the FIRST version of this predicate checked only
 * the top-level `.code`, which a real error from this codebase's own database layer
 * never carries -- Drizzle 0.45.2 wraps every driver error in its own `DrizzleQueryError`
 * and hangs the real `pg` error off `.cause`, exactly the same shape
 * `utils/is-unique-violation.ts`/`utils/is-raise-exception.ts` already had to account
 * for. The bare `{code: "40P01"}` case below is kept because it is still a legitimate
 * input shape (an unwrapped driver error), not because it is the realistic one; the
 * "wrapped in `cause`" case is what a genuine deadlock actually looks like in this
 * codebase and is what the original version of this test wrongly never covered.
 *
 * DISCLOSED SCOPE BOUNDARY: this is a unit test of the mapping predicate only. A live,
 * two-route reproduction (an actual concurrent `POST /transition` and
 * `POST /work-items/{key}/parent` colliding into a real Postgres deadlock) was run
 * manually during this review round (see the security-review note's D3 section for the
 * live-reproduction result), but is not itself committed as an automated integration
 * test -- coordinating two distinct routes' own internal lock sequences precisely enough
 * to force `40P01` deterministically, on every CI run, is substantially more involved
 * than this predicate's own unit coverage.
 */
import { describe, expect, it } from "vitest";
import { isPostgresDeadlockError } from "../../../apps/api/src/work-item/controllers/transition-work-item";

describe("isPostgresDeadlockError", () => {
  it("finds the driver error Drizzle wrapped in `cause`", () => {
    // The realistic shape: Drizzle rethrows its own `DrizzleQueryError` and hangs the
    // real `pg` error off `cause` -- reading `error.code` alone (the pre-D3 version of
    // this function) silently never matches, which is how a genuine deadlock became an
    // unhandled 500 instead of the 409 every other layer of this route already claimed.
    const wrapped = new Error('Failed query: update "work_item" …', {
      cause: Object.assign(new Error("deadlock detected"), {
        code: "40P01",
      }),
    });
    expect(isPostgresDeadlockError(wrapped)).toBe(true);
  });

  it("matches an unwrapped driver error too", () => {
    const direct = Object.assign(new Error("deadlock detected"), {
      code: "40P01",
    });
    expect(isPostgresDeadlockError(direct)).toBe(true);
  });

  it("does not match a different SQLSTATE (e.g. a unique-violation)", () => {
    expect(isPostgresDeadlockError({ code: "23505" })).toBe(false);
    expect(
      isPostgresDeadlockError(
        new Error("dup", {
          cause: Object.assign(new Error("dup"), { code: "23505" }),
        }),
      ),
    ).toBe(false);
  });

  it("does not match a plain Error with no code, anywhere in the chain", () => {
    expect(isPostgresDeadlockError(new Error("boom"))).toBe(false);
    expect(
      isPostgresDeadlockError(
        new Error("wrapped", { cause: new Error("boom") }),
      ),
    ).toBe(false);
  });

  it("fails closed (does not throw, returns false) on non-object input", () => {
    expect(isPostgresDeadlockError("40P01")).toBe(false);
    expect(isPostgresDeadlockError(null)).toBe(false);
    expect(isPostgresDeadlockError(undefined)).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const loop = new Error("loop") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(isPostgresDeadlockError(loop)).toBe(false);
  });
});
