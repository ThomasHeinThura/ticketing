import { describe, expect, it } from "vitest";
import {
  buildPlanningPayload,
  classifyOwnershipFailure,
  classifyPlanningFailure,
  dayToDateString,
  isPlanningDirty,
  projectKeyError,
  projectLevels,
  selectableParents,
  toPlanningValues,
  validatePlanning,
} from "./project-planning-form";

const empty = {
  managerId: null,
  defaultAssigneeId: null,
  startDate: null,
  endDate: null,
};

describe("project key (PR-13)", () => {
  it.each(["AB", "ALPHA", "ABCDEFGH"])("accepts %s", (key) => {
    expect(projectKeyError(key)).toBeNull();
  });
  it.each(["A", "ABCDEFGHI", "alpha", "AB1", "AB-C"])("rejects %s", (key) => {
    expect(projectKeyError(key)).toBe("format");
  });
  it("requires a key", () => {
    expect(projectKeyError("  ")).toBe("required");
  });
  it("keeps an unchanged legacy key valid but not a changed invalid one", () => {
    expect(projectKeyError("legacy-key", "legacy-key")).toBeNull();
    expect(projectKeyError("other-key", "legacy-key")).toBe("format");
  });
});

describe("planning values", () => {
  it("narrows a project payload and treats unknown values as unset", () => {
    expect(
      toPlanningValues({
        managerId: "p1",
        startDate: "2026-01-01",
        endDate: 5,
        defaultAssigneeId: "",
      }),
    ).toEqual({
      managerId: "p1",
      defaultAssigneeId: null,
      startDate: "2026-01-01",
      endDate: null,
    });
  });

  it("detects dirtiness and builds a payload of changed fields only", () => {
    const saved = { ...empty, managerId: "p1", startDate: "2026-01-01" };
    const draft = { ...saved, endDate: "2026-02-01", managerId: null };
    expect(isPlanningDirty(saved, saved)).toBe(false);
    expect(isPlanningDirty(saved, draft)).toBe(true);
    expect(buildPlanningPayload(saved, draft)).toEqual({
      managerId: null,
      endDate: "2026-02-01",
    });
    expect(buildPlanningPayload(saved, saved)).toEqual({});
  });

  it("flags an end date before the start date", () => {
    expect(
      validatePlanning({
        ...empty,
        startDate: "2026-02-01",
        endDate: "2026-01-01",
      }),
    ).toEqual({ endBeforeStart: true });
    expect(
      validatePlanning({
        ...empty,
        startDate: "2026-01-01",
        endDate: "2026-01-01",
      }),
    ).toEqual({});
    expect(validatePlanning({ ...empty, endDate: "2026-01-01" })).toEqual({});
  });

  it("formats a local calendar day as YYYY-MM-DD", () => {
    expect(dayToDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayToDateString(undefined)).toBeNull();
  });
});

describe("failure classification", () => {
  it("maps planning failures by status and stable code", () => {
    expect(classifyPlanningFailure(403, "x")).toBe("forbidden");
    expect(classifyPlanningFailure(409, "x")).toBe("keyTaken");
    expect(classifyPlanningFailure(400, "PR-13: a project key")).toBe(
      "keyFormat",
    );
    expect(classifyPlanningFailure(422, "end_date_before_start_date")).toBe(
      "datesOrdered",
    );
    expect(
      classifyPlanningFailure(422, "manager_must_be_active_project_member"),
    ).toBe("personNotEligible");
    expect(classifyPlanningFailure(500, "boom")).toBe("generic");
  });

  it("maps ownership failures", () => {
    expect(classifyOwnershipFailure(403, "")).toBe("forbidden");
    expect(classifyOwnershipFailure(422, "PR-1: the hierarchy is capped")).toBe(
      "depth",
    );
    expect(classifyOwnershipFailure(422, "project_parent_is_descendant")).toBe(
      "cycle",
    );
    expect(classifyOwnershipFailure(422, "project_parent_archived: x")).toBe(
      "parentArchived",
    );
    expect(classifyOwnershipFailure(422, "project_parent_not_found")).toBe(
      "parentNotFound",
    );
  });
});

describe("parent selection", () => {
  const projects = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "x", parentId: null },
    { id: "z", parentId: null, archivedAt: "2026-01-01" },
  ];

  it("excludes the project, its descendants and archived projects", () => {
    expect(selectableParents(projects, "a").map((p) => p.id)).toEqual(["x"]);
    expect(selectableParents(projects, "c").map((p) => p.id)).toEqual([
      "a",
      "b",
      "x",
    ]);
  });

  it("computes levels", () => {
    const levels = projectLevels(projects);
    expect(levels.get("a")).toBe(1);
    expect(levels.get("c")).toBe(3);
  });
});
