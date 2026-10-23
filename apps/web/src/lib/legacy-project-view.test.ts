import { describe, expect, it } from "vitest";
import {
  isAuthorizedLegacyProject,
  legacyTaskHref,
  translateLegacyProjectView,
} from "./legacy-project-view";

describe("legacy project compatibility", () => {
  it("requires the actual returned ID and workspace", () => {
    expect(isAuthorizedLegacyProject(undefined, "p", "w")).toBe(false);
    expect(
      isAuthorizedLegacyProject({ id: "p", workspaceId: "other" }, "p", "w"),
    ).toBe(false);
    expect(
      isAuthorizedLegacyProject({ id: "other", workspaceId: "w" }, "p", "w"),
    ).toBe(false);
    expect(
      isAuthorizedLegacyProject({ id: "p", workspaceId: "w" }, "p", "w"),
    ).toBe(true);
  });
  it("preserves exact canonical filter, layout, direction and permanent selection", () => {
    const result = translateLegacyProjectView(
      {
        layout: "list",
        sort: "number",
        dir: "desc",
        filter: "state:started",
        taskId: "HELP-4",
        hierarchy: { itemKey: "HELP-4", collapsed: true },
        relations: { itemKey: "HELP-4", picker: true },
      },
      "help",
      "board",
    );
    const url = new URL(result.href, "https://test.invalid");
    expect(url.pathname).toBe("/agent/projects/help/work");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      layout: "list",
      sort: "key",
      dir: "desc",
      filter: "state:started",
      item: "HELP-4",
    });
    expect(url.searchParams.has("hierarchy")).toBe(true);
    expect(url.searchParams.has("relations")).toBe(true);
    expect(result.unsupported).toEqual([]);
    expect(result.legacyTaskId).toBeUndefined();
  });
  it("translates supported priority without replacing the canonical predicate", () => {
    const result = translateLegacyProjectView(
      { priority: ["high", "urgent"], filter: "state:started" },
      "help",
      "board",
    );
    expect(
      new URL(result.href, "https://test.invalid").searchParams.get("filter"),
    ).toBe("AND(state:started,priority:in(high,urgent))");
    expect(result.unsupported).toEqual([]);
  });
  it("fails visibly for unsupported legacy predicates and explicit sort", () => {
    expect(
      translateLegacyProjectView(
        {
          q: "private",
          status: ["active-column"],
          assignee: ["userid"],
          labels: ["labelid"],
          dueDate: ["dueThisWeek"],
          priority: ["none"],
          sort: "createdAt",
        },
        "help",
        "board",
      ).unsupported,
    ).toEqual([
      "q",
      "status",
      "assignee",
      "labels",
      "dueDate",
      "sort",
      "priority",
    ]);
    expect(translateLegacyProjectView({}, "help", "board").unsupported).toEqual(
      [],
    );
  });
  it("does not turn a legacy UUID or number into a canonical item", () => {
    const result = translateLegacyProjectView(
      { taskId: "real-legacy-uuid" },
      "help",
      "backlog",
    );
    expect(result.href).not.toContain("item=");
    expect(result.legacyTaskId).toBe("real-legacy-uuid");
    expect(
      legacyTaskHref("w", "p", "real-legacy-uuid", "other"),
    ).toBeUndefined();
    expect(legacyTaskHref("w", "p", "real-legacy-uuid", "p")).toBe(
      "/dashboard/workspace/w/project/p/task/real-legacy-uuid",
    );
  });
  it("drops item-scoped controls belonging to a different selected item", () => {
    const result = translateLegacyProjectView(
      { taskId: "HELP-4", relations: { itemKey: "HELP-6", picker: true } },
      "help",
      "backlog",
    );
    expect(result.href).toContain("/backlog?");
    expect(result.href).not.toContain("relations=");
  });
});
