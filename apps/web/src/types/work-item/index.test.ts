import { describe, expect, it } from "vitest";
import type { WorkItem, WorkItemDetail } from "./index";
import {
  extractDescription,
  parseWorkItemDetailRow,
  parseWorkItemRow,
} from "./index";

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
    priority: "high",
    assigneeId: null,
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

function makeDetail(overrides: Partial<WorkItemDetail> = {}): WorkItemDetail {
  return {
    ...makeItem(),
    stateName: "Backlog",
    stateCategory: "backlog",
    assigneeName: null,
    ...overrides,
  } as WorkItemDetail;
}

describe("parseWorkItemDetailRow", () => {
  it("flags nothing on a fully valid detail row", () => {
    const row = parseWorkItemDetailRow(makeDetail());
    expect(row.unavailableFields).toEqual([]);
    expect(row.stateName).toBe("Backlog");
    expect(row.key).toBe("PROJ-123");
  });

  it("flags stateName alongside the list-level fields it shares with parseWorkItemRow", () => {
    const row = parseWorkItemDetailRow(
      makeDetail({ title: "", stateName: "", dueDate: "not-a-real-date" }),
    );
    expect(row.unavailableFields).toEqual(["title", "dueDate", "stateName"]);
  });

  it("flags a whitespace-only state name", () => {
    const row = parseWorkItemDetailRow(makeDetail({ stateName: "   " }));
    expect(row.unavailableFields).toEqual(["stateName"]);
  });

  it("flags a non-string state name (wrong type)", () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising a malformed wire value
    const row = parseWorkItemDetailRow(makeDetail({ stateName: 42 as any }));
    expect(row.unavailableFields).toEqual(["stateName"]);
  });

  it("treats a null assigneeName as valid and unflagged", () => {
    const row = parseWorkItemDetailRow(
      makeDetail({ assigneeId: "person_1", assigneeName: null }),
    );
    expect(row.unavailableFields).toEqual([]);
    expect(row.assigneeName).toBeNull();
  });
});

describe("extractDescription", () => {
  it("returns none for null and undefined", () => {
    expect(extractDescription(null)).toEqual({ kind: "none" });
    expect(extractDescription(undefined)).toEqual({ kind: "none" });
  });

  it("returns none for an empty or whitespace-only string", () => {
    expect(extractDescription("")).toEqual({ kind: "none" });
    expect(extractDescription("   \n  ")).toEqual({ kind: "none" });
  });

  it("returns a plain-text description as-is", () => {
    expect(extractDescription("Investigate the login bug")).toEqual({
      kind: "text",
      text: "Investigate the login bug",
    });
  });

  it("extracts paragraph text from a Tiptap document, block-separated", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "First paragraph" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "Second paragraph" }],
        },
      ],
    };

    expect(extractDescription(doc)).toEqual({
      kind: "text",
      text: "First paragraph\n\nSecond paragraph",
    });
  });

  it("returns none for an empty document", () => {
    expect(extractDescription({ type: "doc", content: [] })).toEqual({
      kind: "none",
    });
  });

  it("returns unsupported for a value it cannot read, rather than pretending there is no description", () => {
    expect(extractDescription(42)).toEqual({ kind: "unsupported" });
    expect(extractDescription([1, 2])).toEqual({ kind: "unsupported" });
    expect(extractDescription({ foo: "bar" })).toEqual({
      kind: "unsupported",
    });
  });
});
