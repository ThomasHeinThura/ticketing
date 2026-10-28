import { describe, expect, it } from "vitest";
import { extractDocumentText } from "../../../apps/api/src/intake/repository";

describe("portal projection body text", () => {
  it("returns a legacy plain-string body as it is", () => {
    expect(extractDocumentText("Moved to Done: fixed in 2.1")).toBe(
      "Moved to Done: fixed in 2.1",
    );
  });

  it("flattens a comment-shaped document, one line per paragraph", () => {
    expect(
      extractDocumentText({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
        ],
      }),
    ).toBe("First\nSecond");
  });

  it("renders nothing for a missing body", () => {
    expect(extractDocumentText(null)).toBe("");
  });
});
