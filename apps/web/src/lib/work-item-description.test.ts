import { describe, expect, it } from "vitest";
import { descriptionFromPlainText } from "./work-item-description";

describe("descriptionFromPlainText", () => {
  it("returns undefined for empty or whitespace-only input (the field is optional, WI-3)", () => {
    expect(descriptionFromPlainText("")).toBeUndefined();
    expect(descriptionFromPlainText("   \n \n\t")).toBeUndefined();
  });

  it("wraps each line as a paragraph in the Tiptap document shape the app reads", () => {
    expect(descriptionFromPlainText("First line\nSecond line")).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First line" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second line" }],
        },
      ],
    });
  });

  it("drops blank lines and trims each remaining line", () => {
    expect(descriptionFromPlainText("  Keep me  \n\n   \n also me")).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Keep me" }] },
        { type: "paragraph", content: [{ type: "text", text: "also me" }] },
      ],
    });
  });
});
