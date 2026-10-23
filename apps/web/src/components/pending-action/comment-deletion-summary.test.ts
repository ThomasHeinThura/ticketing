import { describe, expect, it } from "vitest";
import { parseCommentDeletionSummary } from "./comment-deletion-summary";

const summary = {
  commentId: "comment-1",
  key: "HELP-4",
  title: "Rotation",
  visibility: "internal",
  commentBody: {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Exact comment" }] },
    ],
  },
};
describe("comment deletion preview", () => {
  it("extracts text without rendering arbitrary rich-document attributes", () => {
    expect(
      parseCommentDeletionSummary({
        ...summary,
        commentBody: {
          type: "doc",
          attrs: { html: "<script>private</script>" },
          content: [{ type: "text", text: "Exact comment" }],
        },
      })?.preview,
    ).toBe("Exact comment");
  });
  it("rejects redacted, missing or invalid identity summaries", () => {
    expect(
      parseCommentDeletionSummary({ ...summary, redacted: true }),
    ).toBeNull();
    expect(
      parseCommentDeletionSummary({ ...summary, key: "other/path" }),
    ).toBeNull();
    expect(
      parseCommentDeletionSummary({ ...summary, visibility: "secret" }),
    ).toBeNull();
    expect(
      parseCommentDeletionSummary({
        commentId: "comment-1",
        key: "HELP-4",
        title: "Rotation",
        visibility: "public",
      }),
    ).toBeNull();
  });
  it("bounds deep and large documents without recursion", () => {
    const node: Record<string, unknown> = { type: "doc" };
    node.content = [node];
    expect(
      parseCommentDeletionSummary({ ...summary, commentBody: node })?.preview,
    ).toBe("");
    expect(
      parseCommentDeletionSummary({ ...summary, commentBody: "x".repeat(5000) })
        ?.preview,
    ).toHaveLength(4000);
  });
});
