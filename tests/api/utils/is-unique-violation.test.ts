import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "../../../apps/api/src/utils/is-unique-violation";

describe("isUniqueViolation", () => {
  it("finds the driver error Drizzle wrapped in `cause`", () => {
    // Drizzle rethrows a `Failed query: …` Error and hangs the pg error off
    // `cause`, so reading `error.code` alone silently never matches — which
    // is how a slug collision became a 500 instead of a 409.
    const wrapped = new Error('Failed query: insert into "workspace" …', {
      cause: Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "workspace_slug_unique",
      }),
    });
    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(wrapped, "slug")).toBe(true);
  });

  it("matches an unwrapped driver error too", () => {
    const direct = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "workspace_slug_unique",
    });
    expect(isUniqueViolation(direct, "slug")).toBe(true);
  });

  it("does not match a different unique constraint when a column is named", () => {
    const other = new Error("Failed query", {
      cause: Object.assign(new Error("duplicate key"), {
        code: "23505",
        constraint: "session_token_unique",
      }),
    });
    expect(isUniqueViolation(other, "slug")).toBe(false);
    expect(isUniqueViolation(other)).toBe(true);
  });

  it("does not match other failures", () => {
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(
      isUniqueViolation(
        new Error("fk", {
          cause: Object.assign(new Error("fk"), { code: "23503" }),
        }),
      ),
    ).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const loop = new Error("loop") as Error & { cause?: unknown };
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });
});
