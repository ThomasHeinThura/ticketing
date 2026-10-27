import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecentItems,
  MAX_RECENT_ITEMS,
  pushRecentItem,
  readRecentItems,
} from "./recent-items";

const item = (id: string) => ({
  type: "work_item" as const,
  id,
  title: `Item ${id}`,
  href: `/agent/work-items/${id}`,
});

describe("palette recent items (SV-6)", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps newest first, de-duplicates and bounds the list per workspace", () => {
    for (let n = 0; n < MAX_RECENT_ITEMS + 3; n++)
      pushRecentItem("u1", "w1", item(String(n)));
    pushRecentItem("u1", "w1", item("5"));
    const recent = readRecentItems("u1", "w1");
    expect(recent).toHaveLength(MAX_RECENT_ITEMS);
    expect(recent[0]?.id).toBe("5");
    expect(recent.filter((entry) => entry.id === "5")).toHaveLength(1);
    expect(readRecentItems("u1", "w2")).toEqual([]);
  });

  it("ignores corrupt or off-site entries", () => {
    window.localStorage.setItem(
      "taskdesk:palette-recent:u1:w1",
      JSON.stringify([
        { type: "work_item", id: "x", title: "T", href: "https://evil.test" },
        item("ok"),
      ]),
    );
    expect(readRecentItems("u1", "w1").map((entry) => entry.id)).toEqual([
      "ok",
    ]);
    window.localStorage.setItem("taskdesk:palette-recent:u1:w1", "{not json");
    expect(readRecentItems("u1", "w1")).toEqual([]);
  });

  it("never shows one user's recents to another user and clears on sign-out", () => {
    pushRecentItem("u1", "w1", item("secret"));
    expect(readRecentItems("u2", "w1")).toEqual([]);
    window.localStorage.setItem("taskdesk:palette-recent:w1", "[]");
    window.localStorage.setItem("unrelated", "keep");
    clearRecentItems();
    expect(readRecentItems("u1", "w1")).toEqual([]);
    expect(
      window.localStorage.getItem("taskdesk:palette-recent:w1"),
    ).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep");
  });
});
