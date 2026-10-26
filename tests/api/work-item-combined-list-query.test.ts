import { describe, expect, it } from "vitest";
import { adaptCombinedWorkItemListQuery } from "../../apps/api/src/work-item/combined-list-query";
import { listWorkItemsQuery } from "../../apps/api/src/work-item/schema";

describe("combined board GET adapter", () => {
  it("preserves the existing filter and sorting contract", () => {
    const parsed = listWorkItemsQuery.parse({
      state: "state-a,state-b",
      assignee: "person-a",
      priority: "high,urgent",
      due_before: "2026-10-01",
      cycle: "cycle-a",
      module: "module-a",
      lifecycle: "archived",
      sort: "position",
      dir: "desc",
    });
    const adapted = adaptCombinedWorkItemListQuery(parsed);

    expect(adapted.query.sort).toEqual([{ field: "position", order: "desc" }]);
    expect(adapted.query.filter).toEqual({
      op: "and",
      clauses: [
        { field: "priority", op: "in", value: ["high", "urgent"] },
        { field: "dueDate", op: "lt", value: "2026-10-01" },
        { field: "lifecycle", op: "eq", value: "archived" },
      ],
    });
    expect(adapted.legacyFilters).toEqual({
      state: "state-a,state-b",
      assignee: "person-a",
      cycle: "cycle-a",
      module: "module-a",
    });
  });

  it("applies active/key/asc defaults and keeps assignee=me in search grammar", () => {
    const adapted = adaptCombinedWorkItemListQuery(
      listWorkItemsQuery.parse({ assignee: "me" }),
    );
    expect(adapted.query.sort).toEqual([{ field: "key", order: "asc" }]);
    expect(adapted.query.filter).toEqual({
      op: "and",
      clauses: [
        { field: "lifecycle", op: "eq", value: "active" },
        { field: "assignee", op: "eq", value: "@me" },
      ],
    });
    expect(adapted.legacyFilters).toEqual({});
  });

  it("does not widen an empty state list, matching the existing list SQL", () => {
    const adapted = adaptCombinedWorkItemListQuery(
      listWorkItemsQuery.parse({ state: ",," }),
    );
    expect(adapted.legacyFilters.state).toBe(",,");
  });
});
