import { describe, expect, it } from "vitest";
import {
  parseSettingKey,
  projectSettingKey,
} from "../../apps/api/src/user-preference/whitelist";

describe("settings whitelist: list groups and columns (VW-15, VW-19)", () => {
  it("maps listGroups.<projectId> and columns.<projectId> to project rows", () => {
    expect(parseSettingKey("listGroups.proj_1")).toMatchObject({
      kind: "listGroups",
      scope: "project",
      scopeId: "proj_1",
      rowKey: "listGroups",
    });
    expect(parseSettingKey("columns.proj_1")).toMatchObject({
      kind: "columns",
      scope: "project",
      scopeId: "proj_1",
      rowKey: "columns",
    });
  });

  it("serves each stored project row under its own settings key", () => {
    expect(projectSettingKey("layout", "p")).toBe("layout.p");
    expect(projectSettingKey("listGroups", "p")).toBe("listGroups.p");
    expect(projectSettingKey("columns", "p")).toBe("columns.p");
    expect(projectSettingKey("pinned_view_ids", "p")).toBeUndefined();
  });

  it("refuses an invalid project id and any unlisted key", () => {
    expect(parseSettingKey("columns.bad id")).toBeUndefined();
    expect(parseSettingKey(`listGroups.${"a".repeat(129)}`)).toBeUndefined();
    expect(parseSettingKey("columnWidths.bad id")).toBeUndefined();
    expect(parseSettingKey("theme")).toBeUndefined();
  });

  it("accepts collapsed group ids as a bounded set of ids", () => {
    const target = parseSettingKey("listGroups.p");
    expect(target?.schema.safeParse(["a", "b"]).success).toBe(true);
    expect(target?.schema.safeParse([]).success).toBe(true);
    expect(target?.schema.safeParse(["a", "a"]).success).toBe(false);
    expect(target?.schema.safeParse(["bad id"]).success).toBe(false);
    expect(
      target?.schema.safeParse(Array.from({ length: 51 }, (_, i) => `s${i}`))
        .success,
    ).toBe(false);
    expect(target?.schema.safeParse("a").success).toBe(false);
  });

  it("accepts native and custom-field column identifiers syntactically", () => {
    const target = parseSettingKey("columns.p");
    expect(target?.schema.safeParse(["title", "key", "state"]).success).toBe(
      true,
    );
    expect(target?.schema.safeParse([]).success).toBe(false);
    expect(target?.schema.safeParse(["title", "title"]).success).toBe(false);
    expect(target?.schema.safeParse(["cf.severity"]).success).toBe(true);
    expect(target?.schema.safeParse(["cf.Bad-Key"]).success).toBe(false);
    expect(target?.schema.safeParse("title").success).toBe(false);
  });

  it("accepts native and custom-field widths syntactically and serves their project key", () => {
    const target = parseSettingKey("columnWidths.p");
    expect(target).toMatchObject({
      kind: "columnWidths",
      scope: "project",
      scopeId: "p",
      rowKey: "columnWidths",
    });
    expect(projectSettingKey("columnWidths", "p")).toBe("columnWidths.p");
    expect(target?.schema.safeParse({ key: 64, title: 800 }).success).toBe(
      true,
    );
    expect(target?.schema.safeParse({ "cf.severity": 180 }).success).toBe(true);
    expect(target?.schema.safeParse({}).success).toBe(true);
    for (const bad of [
      { title: 63 },
      { title: 801 },
      { title: 100.5 },
      { title: "120" },
      { unknown: 120 },
      { "cf.Bad-Key": 120 },
      [],
    ]) {
      expect(target?.schema.safeParse(bad).success).toBe(false);
    }
  });
});
