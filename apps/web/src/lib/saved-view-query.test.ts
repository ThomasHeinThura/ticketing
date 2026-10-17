import { describe, expect, it } from "vitest";
import {
  cloneSavedViewName,
  isExecutableSavedViewQuery,
  isSavedViewSnapshotComplete,
  savedViewDefinitionMatches,
  savedViewQueryDocument,
  savedViewSort,
  savedViewStoredSearch,
  savedViewUrlContextMatches,
} from "./saved-view-query";
import { parseWorkItemFilterText } from "./work-item-filter";

const view = {
  workspaceId: "workspace-a",
  scope: "workspace",
  scopeId: "workspace-a",
  layout: "list",
  query: {
    entity: "work_item",
    filter: {
      op: "or",
      clauses: [
        { field: "priority", op: "eq", value: "high" },
        { field: "assignee", op: "eq", value: "@me" },
      ],
    },
    sort: [{ field: "priority", direction: "desc" }],
    columns: ["key", "title"],
  },
};

describe("saved-view query execution contract", () => {
  it("accepts the query properties preserved by the URL runner", () => {
    expect(
      isExecutableSavedViewQuery({
        entity: "work_item",
        filter: { field: "priority", op: "eq", value: "high" },
        sort: [{ field: "key", direction: "asc" }],
        columns: ["key", "title"],
      }),
    ).toBe(true);
    expect(isExecutableSavedViewQuery({ entity: "work_item" })).toBe(true);
    expect(isExecutableSavedViewQuery({})).toBe(true);
  });

  it.each([
    null,
    "work_item",
    [],
    { entity: "submission" },
    { entity: "work_item", groupBy: "state" },
    { entity: "work_item", aggregate: { count: "id" } },
    { entity: "work_item", futureExecutionMode: "silent" },
    { entity: "work_item", sort: [{ field: "key", direction: "sideways" }] },
    { entity: "work_item", sort: [{ field: "not-a-sort", direction: "asc" }] },
    // The list's rank order is not a saved-view sort.
    { entity: "work_item", sort: [{ field: "position", direction: "asc" }] },
    { entity: "work_item", sort: [{ field: "key", order: "asc" }] },
    { entity: "work_item", columns: ["secret"] },
    { entity: "work_item", columns: [] },
    { entity: "work_item", columns: ["key", "key"] },
    { entity: "work_item", filter: [] },
    { entity: "work_item", filter: { op: "and", clauses: [] } },
    {
      entity: "work_item",
      filter: { field: "priority", op: "eq", value: "x" },
    },
    {
      entity: "work_item",
      sort: [
        { field: "key", direction: "asc" },
        { field: "title", direction: "desc" },
      ],
    },
  ])("rejects stored semantics the URL runner cannot preserve: %o", (query) => {
    expect(isExecutableSavedViewQuery(query)).toBe(false);
  });

  it("keeps cloned names within the create contract's 200-character limit", () => {
    const clone = cloneSavedViewName("x".repeat(200));
    expect(clone).toHaveLength(200);
    expect(clone.endsWith(" copy")).toBe(true);
    expect(cloneSavedViewName("Escalations")).toBe("Escalations copy");
  });

  it("keeps URL snapshots inside the saved view workspace, scope, and layout", () => {
    const context = {
      workspaceId: "workspace-a",
      scope: "project",
      scopeId: "project-a",
      layout: "list",
    };
    expect(savedViewUrlContextMatches(context, {}, false)).toBe(true);
    expect(savedViewUrlContextMatches(context, context, true)).toBe(true);
    for (const changed of [
      { workspaceId: "workspace-b" },
      { scope: "workspace" },
      { scopeId: "project-b" },
      { layout: "board" },
    ])
      expect(
        savedViewUrlContextMatches(context, { ...context, ...changed }, true),
      ).toBe(false);
  });

  it("calls a URL a complete snapshot only when it names workspace, scope, id and layout", () => {
    const full = {
      workspaceId: "w",
      scope: "workspace",
      scopeId: "w",
      layout: "list",
    };
    expect(isSavedViewSnapshotComplete(full)).toBe(true);
    for (const missing of ["workspaceId", "scope", "scopeId", "layout"]) {
      const partial: Record<string, string> = { ...full };
      delete partial[missing];
      expect(isSavedViewSnapshotComplete(partial)).toBe(false);
    }
  });
});

describe("saved view <-> URL definition (SV-14, SV-19)", () => {
  it("shows exactly what the view stored, the filter in canonical text, with the stored sort and columns", () => {
    expect(savedViewStoredSearch(view)).toEqual({
      workspaceId: "workspace-a",
      scope: "workspace",
      scopeId: "workspace-a",
      layout: "list",
      filter: "OR(priority:high,assignee:@me)",
      sort: "priority",
      dir: "desc",
      columns: ["key", "title"],
    });
  });

  it("adds no sort, direction, filter or columns that the view did not store", () => {
    expect(
      savedViewStoredSearch({ ...view, query: { entity: "work_item" } }),
    ).toEqual({
      workspaceId: "workspace-a",
      scope: "workspace",
      scopeId: "workspace-a",
      layout: "list",
    });
    expect(
      savedViewQueryDocument(
        savedViewStoredSearch({ ...view, query: { entity: "work_item" } }),
      ),
    ).toEqual({ entity: "work_item" });
  });

  it("round-trips a stored query through the URL form without losing or adding anything", () => {
    const search = savedViewStoredSearch(view);
    expect(savedViewQueryDocument(search)).toEqual(view.query);
  });

  it("stores the search endpoint's `order` as the envelope's `direction`", () => {
    expect(
      savedViewQueryDocument({ sort: "title", dir: "desc" }),
    ).toMatchObject({ sort: [{ field: "title", direction: "desc" }] });
    expect(savedViewSort({ sort: "title", dir: "desc" })).toEqual({
      field: "title",
      order: "desc",
    });
  });

  it("reads a partial sort one way only: a field alone ascends, a direction alone sorts by key, neither is none", () => {
    expect(savedViewSort({ sort: "priority" })).toEqual({
      field: "priority",
      order: "asc",
    });
    expect(savedViewSort({ dir: "desc" })).toEqual({
      field: "key",
      order: "desc",
    });
    expect(savedViewSort({})).toBeUndefined();
    expect(savedViewSort({ sort: "position", dir: "asc" })).toBeUndefined();
  });

  it("refuses to store filter text that does not parse", () => {
    expect(() => savedViewQueryDocument({ filter: "priority:bad" })).toThrow();
  });

  it("recognises the stored definition however its filter is written, so the server runs the stored view", () => {
    const base = savedViewStoredSearch(view);
    expect(savedViewDefinitionMatches(view, base)).toBe(true);
    // Infix text for the same AST.
    expect(
      savedViewDefinitionMatches(view, {
        ...base,
        filter: "priority:high OR assignee:@me",
      }),
    ).toBe(true);
    expect(parseWorkItemFilterText("priority:high OR assignee:@me")).toEqual(
      view.query.filter,
    );
  });

  it.each([
    ["filter", { filter: "priority:low" }],
    ["sort field", { sort: "title" as const }],
    ["direction", { dir: "asc" as const }],
    ["columns", { columns: ["key" as const] }],
    ["scope", { scope: "project" as const }],
    ["workspace", { workspaceId: "workspace-b" }],
    ["layout", { layout: "board" }],
    ["unparseable filter", { filter: "priority:" }],
  ])(
    "is not the stored definition when the %s differs, so it runs as a direct search",
    (_name, change) => {
      expect(
        savedViewDefinitionMatches(view, {
          ...savedViewStoredSearch(view),
          ...change,
        }),
      ).toBe(false);
    },
  );

  it("treats a stored query with no sort as matching a URL with no sort, and not one that adds a sort", () => {
    const bare = { ...view, query: { entity: "work_item" } };
    const stored = savedViewStoredSearch(bare);
    expect(savedViewDefinitionMatches(bare, stored)).toBe(true);
    expect(savedViewDefinitionMatches(bare, { ...stored, sort: "key" })).toBe(
      false,
    );
  });
});
