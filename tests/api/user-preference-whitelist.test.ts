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
    expect(parseSettingKey("columnWidths.p")).toBeUndefined();
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

  it("accepts a non-empty, duplicate-free subset of the table columns", () => {
    const target = parseSettingKey("columns.p");
    expect(target?.schema.safeParse(["title", "key", "state"]).success).toBe(
      true,
    );
    expect(target?.schema.safeParse([]).success).toBe(false);
    expect(target?.schema.safeParse(["title", "title"]).success).toBe(false);
    expect(target?.schema.safeParse(["cf.severity"]).success).toBe(false);
    expect(target?.schema.safeParse("title").success).toBe(false);
  });
});
