import { describe, expect, it } from "vitest";
import { isIntakeConditionSatisfied } from "./intake-visibility";

describe("request-type visibility parity", () => {
  it("treats false as a set value and nullish or empty values as unset", () => {
    const condition = { field_key: "enabled", op: "is_set" };
    expect(isIntakeConditionSatisfied(condition, false)).toBe(true);
    expect(isIntakeConditionSatisfied(condition, 0)).toBe(true);
    expect(isIntakeConditionSatisfied(condition, null)).toBe(false);
    expect(isIntakeConditionSatisfied(condition, undefined)).toBe(false);
    expect(isIntakeConditionSatisfied(condition, "")).toBe(false);
  });
});
