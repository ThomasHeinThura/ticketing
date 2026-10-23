import { beforeEach, describe, expect, it } from "vitest";
import {
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
      pushRecentItem("w1", item(String(n)));
    pushRecentItem("w1", item("5"));
    const recent = readRecentItems("w1");
    expect(recent).toHaveLength(MAX_RECENT_ITEMS);
    expect(recent[0]?.id).toBe("5");
    expect(recent.filter((entry) => entry.id === "5")).toHaveLength(1);
    expect(readRecentItems("w2")).toEqual([]);
  });

  it("ignores corrupt or off-site entries", () => {
    window.localStorage.setItem(
      "taskdesk:palette-recent:w1",
      JSON.stringify([
        { type: "work_item", id: "x", title: "T", href: "https://evil.test" },
        item("ok"),
      ]),
    );
    expect(readRecentItems("w1").map((entry) => entry.id)).toEqual(["ok"]);
    window.localStorage.setItem("taskdesk:palette-recent:w1", "{not json");
    expect(readRecentItems("w1")).toEqual([]);
  });
});
