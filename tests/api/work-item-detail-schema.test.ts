import { describe, expect, it } from "vitest";
import { workItemDetailSchema } from "../../apps/api/src/work-item/response";

describe("work-item detail response", () => {
  it("exposes only the configured CA-2 visibility values", () => {
    expect(
      workItemDetailSchema.shape.defaultCommentVisibility.parse("public"),
    ).toBe("public");
    expect(
      workItemDetailSchema.shape.defaultCommentVisibility.parse("internal"),
    ).toBe("internal");
    expect(
      workItemDetailSchema.shape.defaultCommentVisibility.safeParse("private")
        .success,
    ).toBe(false);
  });
});
