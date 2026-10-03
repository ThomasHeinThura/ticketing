import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./api-url";

describe("resolveApiBaseUrl", () => {
  it("appends /api when the base has no api suffix", () => {
    expect(resolveApiBaseUrl(undefined)).toBe("http://localhost:1337/api");
    expect(resolveApiBaseUrl("http://localhost:1337")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("treats an explicitly empty base as relative, not as unset", () => {
    expect(resolveApiBaseUrl("")).toBe("/api");
  });

  it("returns the URL unchanged when it already ends with /api", () => {
    expect(resolveApiBaseUrl("http://localhost:1337/api")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("strips trailing slashes before appending /api", () => {
    expect(resolveApiBaseUrl("http://localhost:1337/")).toBe(
      "http://localhost:1337/api",
    );
    expect(resolveApiBaseUrl("http://localhost:1337/api/")).toBe(
      "http://localhost:1337/api",
    );
  });

  it("preserves a long nonmatching slash run without suffix-regex backtracking", () => {
    const base = `https://taskdesk.test${"/".repeat(100_000)}x`;

    expect(resolveApiBaseUrl(base)).toBe(`${base}/api`);
  });
});
