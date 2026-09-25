import { describe, expect, it } from "vitest";
import type { WorkItem } from "./index";
import { parseWorkItemRow } from "./index";

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "wi_1",
    projectId: "proj_1",
    workspaceId: "ws_1",
    typeId: "type_1",
    number: 123,
    key: "PROJ-123",
    title: "Fix the thing",
    description: null,
    stateId: "state_1",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: "high",
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    position: "1.0000000000",
    customerVisibility: "private",
    startDate: null,
    dueDate: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    version: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as WorkItem;
}

describe("parseWorkItemRow", () => {
  it("flags nothing on a fully valid row", () => {
    const row = parseWorkItemRow(makeItem());
    expect(row.unavailableFields).toEqual([]);
    expect(row.key).toBe("PROJ-123");
    expect(row.title).toBe("Fix the thing");
    expect(row.priority).toBe("high");
    expect(row.dueDate).toBe("2026-10-01T00:00:00.000Z");
  });

  it("treats a null priority as valid and unflagged", () => {
    const row = parseWorkItemRow(makeItem({ priority: null }));
    expect(row.unavailableFields).toEqual([]);
    expect(row.priority).toBeNull();
  });

  it("treats a null dueDate as valid and unflagged", () => {
    const row = parseWorkItemRow(makeItem({ dueDate: null }));
    expect(row.unavailableFields).toEqual([]);
    expect(row.dueDate).toBeNull();
  });

  describe("title", () => {
    it("flags a blank title", () => {
      const row = parseWorkItemRow(makeItem({ title: "" }));
      expect(row.unavailableFields).toEqual(["title"]);
      expect(row.title).toBe("");
    });

    it("flags a whitespace-only title", () => {
      const row = parseWorkItemRow(makeItem({ title: "   " }));
      expect(row.unavailableFields).toEqual(["title"]);
    });

    it("flags a non-string title (wrong type)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: exercising a malformed wire value
      const row = parseWorkItemRow(makeItem({ title: 42 as any }));
      expect(row.unavailableFields).toEqual(["title"]);
      expect(row.title).toBe("");
    });
  });

  describe("priority", () => {
    it("flags an unknown priority string", () => {
      const row = parseWorkItemRow(
        makeItem({ priority: "not-a-real-priority" }),
      );
      expect(row.unavailableFields).toEqual(["priority"]);
      expect(row.priority).toBeNull();
    });

    it("flags a non-string, non-null priority (wrong type)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: exercising a malformed wire value
      const row = parseWorkItemRow(makeItem({ priority: 1 as any }));
      expect(row.unavailableFields).toEqual(["priority"]);
    });
  });

  describe("dueDate", () => {
    it("flags an unparseable dueDate string", () => {
      const row = parseWorkItemRow(makeItem({ dueDate: "not-a-real-date" }));
      expect(row.unavailableFields).toEqual(["dueDate"]);
      expect(row.dueDate).toBeNull();
    });

    it("flags a non-string, non-null dueDate (wrong type)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: exercising a malformed wire value
      const row = parseWorkItemRow(makeItem({ dueDate: 12345 as any }));
      expect(row.unavailableFields).toEqual(["dueDate"]);
    });
  });

  describe("key", () => {
    it("flags a key with no trailing number", () => {
      const row = parseWorkItemRow(makeItem({ key: "not-a-real-key" }));
      expect(row.unavailableFields).toEqual(["key"]);
      expect(row.key).toBe("");
    });

    it("flags a key whose trailing number doesn't match this row's own number", () => {
      const row = parseWorkItemRow(makeItem({ key: "PROJ-999", number: 123 }));
      expect(row.unavailableFields).toEqual(["key"]);
    });

    it("flags a blank key", () => {
      const row = parseWorkItemRow(makeItem({ key: "" }));
      expect(row.unavailableFields).toEqual(["key"]);
    });

    it("flags a non-string key (wrong type)", () => {
      // biome-ignore lint/suspicious/noExplicitAny: exercising a malformed wire value
      const row = parseWorkItemRow(makeItem({ key: 123 as any }));
      expect(row.unavailableFields).toEqual(["key"]);
    });

    it("flags a valid-shaped key when this row's own number is the wrong type", () => {
      const row = parseWorkItemRow(
        // biome-ignore lint/suspicious/noExplicitAny: exercising a malformed wire value
        makeItem({ key: "PROJ-123", number: "123" as any }),
      );
      expect(row.unavailableFields).toEqual(["key"]);
    });
  });

  it("flags every invalid field at once, and keeps the row's other data intact", () => {
    const row = parseWorkItemRow(
      makeItem({
        id: "wi_2",
        key: "not-a-real-key",
        title: "",
        priority: "not-a-real-priority",
        dueDate: "not-a-real-date",
      }),
    );

    expect(row.unavailableFields).toEqual([
      "key",
      "title",
      "priority",
      "dueDate",
    ]);
    expect(row.id).toBe("wi_2");
    expect(row.key).toBe("");
    expect(row.title).toBe("");
    expect(row.priority).toBeNull();
    expect(row.dueDate).toBeNull();
  });
});
