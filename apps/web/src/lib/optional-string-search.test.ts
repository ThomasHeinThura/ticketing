import { describe, expect, it } from "vitest";
import { parseOptionalStringSearch } from "./optional-string-search";

describe("parseOptionalStringSearch", () => {
  it("keeps only declared optional string fields", () => {
    expect(
      parseOptionalStringSearch(
        {
          email: "person@example.test",
          redirect: "/agent",
          ignored: "not part of this route",
        },
        ["email", "redirect"],
      ),
    ).toEqual({ email: "person@example.test", redirect: "/agent" });
  });

  it.each([null, 42, ["one", "two"]])(
    "rejects a supplied non-string field: %s",
    (value) => {
      expect(() =>
        parseOptionalStringSearch({ setupToken: value }, ["setupToken"]),
      ).toThrow("Search parameter setupToken must be a string.");
    },
  );
});
