import { describe, expect, it } from "vitest";
import { matchesInboxFilter } from "./notification-filters";

const row = (kind: string | null, type = "info", isRead = false) => ({
  kind,
  type,
  isRead,
});

describe("NO-13 inbox filters", () => {
  it("all matches everything, unread only unread rows", () => {
    expect(matchesInboxFilter(row(null), "all")).toBe(true);
    expect(matchesInboxFilter(row(null, "info", true), "unread")).toBe(false);
    expect(matchesInboxFilter(row(null, "info", false), "unread")).toBe(true);
  });

  it("mentions match the mention event and the legacy mention type", () => {
    expect(matchesInboxFilter(row("work_item.mentioned"), "mentions")).toBe(
      true,
    );
    expect(matchesInboxFilter(row(null, "task_mention"), "mentions")).toBe(
      true,
    );
    expect(matchesInboxFilter(row("work_item.commented"), "mentions")).toBe(
      false,
    );
  });

  it("assignments match assigned and unassigned events and the legacy type", () => {
    expect(matchesInboxFilter(row("work_item.assigned"), "assignments")).toBe(
      true,
    );
    expect(matchesInboxFilter(row("work_item.unassigned"), "assignments")).toBe(
      true,
    );
    expect(
      matchesInboxFilter(row(null, "task_assignee_changed"), "assignments"),
    ).toBe(true);
    expect(matchesInboxFilter(row("sla.breached"), "assignments")).toBe(false);
  });
});
