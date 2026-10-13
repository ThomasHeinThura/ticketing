import { describe, expect, it } from "vitest";

describe("jsdom layout stubs", () => {
  it("lets ProseMirror measure Range and Text nodes", () => {
    const text = document.createTextNode("abc");
    document.body.appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    expect(range.getClientRects()).toHaveLength(0);
    expect(range.getBoundingClientRect().width).toBe(0);
    expect(
      (text as unknown as { getClientRects(): unknown[] }).getClientRects(),
    ).toHaveLength(0);
    text.remove();
  });
});
