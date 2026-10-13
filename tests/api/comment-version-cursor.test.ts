import { describe, expect, it } from "vitest";
import {
  decodeCommentVersionCursor,
  encodeCommentVersionCursor,
} from "../../apps/api/src/work-item/controllers/list-comment-versions";
import { listCommentVersionsQuery } from "../../apps/api/src/work-item/schema";

describe("comment-version cursor binding", () => {
  const cursor = {
    v: 1 as const,
    workItemKey: "TD-42",
    commentId: "comment-abc",
    number: 7,
    id: "version-xyz",
  };

  it("round-trips canonical parent-bound cursors", () => {
    const encoded = encodeCommentVersionCursor(cursor);
    expect(decodeCommentVersionCursor(encoded, "TD-42", "comment-abc")).toEqual(
      cursor,
    );
  });

  it("rejects a cursor reused for another comment or work item", () => {
    const encoded = encodeCommentVersionCursor(cursor);
    expect(() =>
      decodeCommentVersionCursor(encoded, "TD-43", "comment-abc"),
    ).toThrow();
    expect(() =>
      decodeCommentVersionCursor(encoded, "TD-42", "comment-other"),
    ).toThrow();
  });

  it("rejects malformed and noncanonical encodings", () => {
    expect(() =>
      decodeCommentVersionCursor("not-a-cursor", "TD-42", "comment-abc"),
    ).toThrow();
    const noncanonical = `${encodeCommentVersionCursor(cursor)}=`;
    expect(() =>
      decodeCommentVersionCursor(noncanonical, "TD-42", "comment-abc"),
    ).toThrow();
  });

  it("bounds version numbers to PostgreSQL integer values before querying", () => {
    const atMaximum = encodeCommentVersionCursor({
      ...cursor,
      number: 2_147_483_647,
    });
    expect(
      decodeCommentVersionCursor(atMaximum, "TD-42", "comment-abc").number,
    ).toBe(2_147_483_647);

    const aboveMaximum = encodeCommentVersionCursor({
      ...cursor,
      number: 2_147_483_648,
    });
    expect(() =>
      decodeCommentVersionCursor(aboveMaximum, "TD-42", "comment-abc"),
    ).toThrow("cursor: malformed");
  });

  it("keeps page sizes bounded and cursor input finite", () => {
    expect(listCommentVersionsQuery.safeParse({}).success).toBe(true);
    expect(listCommentVersionsQuery.safeParse({ limit: 10 }).success).toBe(
      true,
    );
    expect(listCommentVersionsQuery.safeParse({ limit: 11 }).success).toBe(
      false,
    );
    expect(
      listCommentVersionsQuery.safeParse({ cursor: "x".repeat(513) }).success,
    ).toBe(false);
  });
});
