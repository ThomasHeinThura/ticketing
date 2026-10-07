import { describe, expect, it } from "vitest";
import { isIntakeConditionSatisfied } from "./intake-visibility";

describe("request-type visibility parity", () => {
  it("treats false as a set value and nullish or empty values as unset", () => {
    const condition = { field_key: "enabled", op: "is_set" } as const;
    expect(isIntakeConditionSatisfied(condition, false)).toBe(true);
    expect(isIntakeConditionSatisfied(condition, 0)).toBe(true);
    expect(isIntakeConditionSatisfied(condition, null)).toBe(false);
    expect(isIntakeConditionSatisfied(condition, undefined)).toBe(false);
    expect(isIntakeConditionSatisfied(condition, "")).toBe(false);
    expect(isIntakeConditionSatisfied(condition, " \t\n ")).toBe(false);
    expect(isIntakeConditionSatisfied(condition, " value ")).toBe(true);
  });

  it("uses the canonical domain equality, inequality, and membership operators", () => {
    expect(
      isIntakeConditionSatisfied(
        { field_key: "choice", op: "eq", value: "yes" },
        "yes",
      ),
    ).toBe(true);
    expect(
      isIntakeConditionSatisfied(
        { field_key: "choice", op: "neq", value: "yes" },
        "no",
      ),
    ).toBe(true);
    expect(
      isIntakeConditionSatisfied(
        { field_key: "choice", op: "in", value: ["yes", "maybe"] },
        "maybe",
      ),
    ).toBe(true);
  });
});
