import { describe, expect, it } from "vitest";
import { commentBody } from "../../../apps/api/src/work-item/comment-schema";

function documentWithImage(src: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "image", attrs: { src, alt: "screenshot" } }],
      },
    ],
  };
}

describe("commentBody image references", () => {
  it("accepts the canonical app attachment route", () => {
    expect(
      commentBody.safeParse(documentWithImage("/api/asset/asset123")).success,
    ).toBe(true);
  });

  it.each([
    "https://tracker.example/pixel.png",
    "//tracker.example/pixel.png",
    "data:image/png;base64,AAAA",
    "/api/asset/asset123?tracking=1",
    "/api/asset/../user/avatar",
  ])("rejects noncanonical comment image source %s", (src) => {
    expect(commentBody.safeParse(documentWithImage(src)).success).toBe(false);
  });
});
