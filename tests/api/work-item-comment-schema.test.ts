import { describe, expect, it } from "vitest";
import { updateCommentBody } from "../../apps/api/src/work-item/comment-schema";

describe("CA-17 comment update body contract", () => {
  it("requires body while preserving nullable and opaque JSON values", () => {
    expect(updateCommentBody.safeParse({}).success).toBe(false);
    expect(updateCommentBody.safeParse({ body: null }).success).toBe(true);
    expect(updateCommentBody.safeParse({ body: "legacy text" }).success).toBe(
      true,
    );
    expect(
      updateCommentBody.safeParse({ body: { type: "doc", content: [] } })
        .success,
    ).toBe(true);
  });
});
