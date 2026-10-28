import { describe, expect, it } from "vitest";
import { prefixTsqueryText } from "../../apps/api/src/kb/full-text";

describe("knowledge base full-text query", () => {
  it("preserves indexed Unicode forms and makes distinct terms safe prefix clauses", () => {
    expect(prefixTsqueryText("Ｆｏｏ foo Cafe\u0301-бар 42")).toBe(
      "ｆｏｏ:* & foo:* & cafe\u0301:* & бар:* & 42:*",
    );
  });

  it("returns no query for punctuation-only input", () => {
    expect(prefixTsqueryText("!!! +++ ---")).toBeNull();
  });

  it("preserves every term supplied to the full-text query", () => {
    expect(
      prefixTsqueryText("one two three four five six seven eight nine"),
    ).toBe(
      "one:* & two:* & three:* & four:* & five:* & six:* & seven:* & eight:* & nine:*",
    );
  });
});
