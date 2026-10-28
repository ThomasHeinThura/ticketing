import { describe, expect, it } from "vitest";
import {
  createProjectBody,
  PROJECT_KEY_PATTERN,
  updateProjectBody,
  updateProjectOwnershipBody,
} from "../../../apps/api/src/project/schema";

const base = { name: "Alpha", workspaceId: "w1", icon: "Layout" };

describe("PR-13 project key on create", () => {
  it.each(["AB", "ALPHA", "ABCDEFGH"])("accepts %s", (slug) => {
    expect(createProjectBody.safeParse({ ...base, slug }).success).toBe(true);
  });

  it.each(["A", "ABCDEFGHI", "alpha", "AB1", "AB-C", "AB C", "", "ÅB"])(
    "rejects %j",
    (slug) => {
      expect(createProjectBody.safeParse({ ...base, slug }).success).toBe(
        false,
      );
    },
  );

  it("exports the pattern the update path applies to a changed key", () => {
    expect(PROJECT_KEY_PATTERN.test("KAN")).toBe(true);
    expect(PROJECT_KEY_PATTERN.test("kan-1")).toBe(false);
  });
});

describe("update body", () => {
  const body = {
    name: "Alpha",
    icon: "Layout",
    slug: "legacy-key",
    description: "",
  };

  it("keeps accepting a legacy stored key (checked only when it changes)", () => {
    expect(updateProjectBody.safeParse(body).success).toBe(true);
  });

  it("drops parentId and ownerTeamId: they are not general-settings fields", () => {
    const parsed = updateProjectBody.parse({
      ...body,
      parentId: "p2",
      ownerTeamId: "t1",
    });
    expect(parsed).not.toHaveProperty("parentId");
    expect(parsed).not.toHaveProperty("ownerTeamId");
  });

  it("validates calendar dates and treats omitted and null differently", () => {
    expect(
      updateProjectBody.safeParse({ ...body, startDate: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      updateProjectBody.safeParse({ ...body, startDate: "2026/01/01" }).success,
    ).toBe(false);
    const cleared = updateProjectBody.parse({
      ...body,
      startDate: null,
      endDate: "2026-12-31",
    });
    expect(cleared.startDate).toBeNull();
    expect(cleared.endDate).toBe("2026-12-31");
    expect(updateProjectBody.parse(body).startDate).toBeUndefined();
  });

  it("accepts a manager and default assignee, or null to clear", () => {
    const parsed = updateProjectBody.parse({
      ...body,
      managerId: "p1",
      defaultAssigneeId: null,
    });
    expect(parsed.managerId).toBe("p1");
    expect(parsed.defaultAssigneeId).toBeNull();
  });
});

describe("ownership body", () => {
  it("takes a parent id or null and nothing else is required", () => {
    expect(
      updateProjectOwnershipBody.safeParse({ parentId: "p1" }).success,
    ).toBe(true);
    expect(
      updateProjectOwnershipBody.safeParse({ parentId: null }).success,
    ).toBe(true);
    expect(updateProjectOwnershipBody.safeParse({}).success).toBe(false);
  });
});
