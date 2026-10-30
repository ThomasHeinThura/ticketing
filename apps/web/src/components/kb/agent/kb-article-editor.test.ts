import { describe, expect, it } from "vitest";
import type { KbArticle } from "@/fetchers/kb";
import { changesOf } from "./kb-article-editor";

const article = {
  title: "Runbook",
  categoryId: null,
  projectId: null,
  customerVisible: false,
  ownerId: "person-a",
  reviewDueAt: null,
} as KbArticle;

const draft = (ownerId: string | null) => ({
  title: "Runbook",
  body: {},
  categoryId: null,
  projectId: null,
  customerVisible: false,
  ownerId,
  reviewDueAt: "",
});

describe("KB article owner editing", () => {
  it("sends an explicitly selected owner as part of the persisted change set", () => {
    expect(changesOf(article, draft("person-b"), false, false)).toEqual({
      ownerId: "person-b",
    });
  });

  it("sends null when the owner is cleared", () => {
    expect(changesOf(article, draft(null), false, false)).toEqual({
      ownerId: null,
    });
  });
});

describe("KB review calendar date persistence", () => {
  it("sends the selected calendar day at UTC midnight, independent of local time", () => {
    expect(
      changesOf(
        article,
        { ...draft("person-a"), reviewDueAt: "2028-02-29" },
        false,
        false,
      ),
    ).toEqual({ reviewDueAt: "2028-02-29T00:00:00.000Z" });
  });

  it("clears an existing review date with null", () => {
    expect(
      changesOf(
        { ...article, reviewDueAt: "2026-10-30T00:00:00.000Z" },
        draft("person-a"),
        false,
        false,
      ),
    ).toEqual({ reviewDueAt: null });
  });

  it("does not rewrite an unchanged loaded date or its time", () => {
    expect(
      changesOf(
        { ...article, reviewDueAt: "2026-10-30T18:30:00.000Z" },
        { ...draft("person-a"), reviewDueAt: "2026-10-30" },
        false,
        false,
      ),
    ).toEqual({});
  });
});
