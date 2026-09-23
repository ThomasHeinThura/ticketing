import { describe, expect, it } from "vitest";
import type { WorkItem } from "@/types/work-item";
import { sortWorkItems } from "./sort-work-items";

function makeItem(overrides: Partial<WorkItem>): WorkItem {
  return {
    id: `wi_${overrides.number ?? 0}`,
    projectId: "proj_1",
    workspaceId: "ws_1",
    typeId: "type_1",
    number: 0,
    key: `PROJ-${overrides.number ?? 0}`,
    title: "",
    description: null,
    stateId: "state_1",
    priority: null,
    assigneeId: null,
    requesterId: null,
    parentId: null,
    position: "1.0000000000",
    customerVisibility: "private",
    startDate: null,
    dueDate: null,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("sortWorkItems", () => {
  it("sorts by key (numeric sequence) ascending and descending", () => {
    const items = [makeItem({ number: 10 }), makeItem({ number: 2 })];
    expect(sortWorkItems(items, "key", "asc").map((i) => i.number)).toEqual([
      2, 10,
    ]);
    expect(sortWorkItems(items, "key", "desc").map((i) => i.number)).toEqual([
      10, 2,
    ]);
  });

  it("sorts by title alphabetically", () => {
    const items = [
      makeItem({ number: 1, title: "Zebra" }),
      makeItem({ number: 2, title: "Alpha" }),
    ];
    expect(sortWorkItems(items, "title", "asc").map((i) => i.title)).toEqual([
      "Alpha",
      "Zebra",
    ]);
  });

  it("sorts by priority urgent > high > medium > low > none", () => {
    const items = [
      makeItem({ number: 1, priority: "low" }),
      makeItem({ number: 2, priority: "urgent" }),
      makeItem({ number: 3, priority: null }),
      makeItem({ number: 4, priority: "medium" }),
    ];
    expect(
      sortWorkItems(items, "priority", "asc").map((i) => i.priority),
    ).toEqual(["urgent", "medium", "low", null]);
  });

  it("always sorts a work item with no due date last, in either direction", () => {
    const items = [
      makeItem({ number: 1, dueDate: null }),
      makeItem({ number: 2, dueDate: "2026-10-01T00:00:00.000Z" }),
      makeItem({ number: 3, dueDate: "2026-09-01T00:00:00.000Z" }),
    ];

    expect(sortWorkItems(items, "dueDate", "asc").map((i) => i.number)).toEqual(
      [3, 2, 1],
    );
    expect(
      sortWorkItems(items, "dueDate", "desc").map((i) => i.number),
    ).toEqual([2, 3, 1]);
  });

  it("does not mutate its input", () => {
    const items = [makeItem({ number: 2 }), makeItem({ number: 1 })];
    const original = [...items];
    sortWorkItems(items, "key", "asc");
    expect(items).toEqual(original);
  });
});
