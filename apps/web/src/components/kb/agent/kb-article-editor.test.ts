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
