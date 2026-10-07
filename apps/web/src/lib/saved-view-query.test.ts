import { describe, expect, it } from "vitest";
import {
  cloneSavedViewName,
  isExecutableSavedViewQuery,
  savedViewUrlContextMatches,
} from "./saved-view-query";

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
  });

  it.each([
    { entity: "submission" },
    { entity: "work_item", groupBy: "state" },
    { entity: "work_item", aggregate: { count: "id" } },
    { entity: "work_item", futureExecutionMode: "silent" },
    { entity: "work_item", sort: [{ field: "key", direction: "sideways" }] },
    { entity: "work_item", sort: [{ field: "not-a-sort", direction: "asc" }] },
    { entity: "work_item", columns: ["secret"] },
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
  });

  it("keeps URL snapshots inside the saved view workspace, scope, and layout", () => {
    const view = {
      workspaceId: "workspace-a",
      scope: "project",
      scopeId: "project-a",
      layout: "list",
    };
    expect(savedViewUrlContextMatches(view, {}, false)).toBe(true);
    expect(savedViewUrlContextMatches(view, view, true)).toBe(true);
    expect(
      savedViewUrlContextMatches(
        view,
        { ...view, workspaceId: "workspace-b" },
        true,
      ),
    ).toBe(false);
    expect(
      savedViewUrlContextMatches(view, { ...view, scope: "workspace" }, true),
    ).toBe(false);
  });
});
