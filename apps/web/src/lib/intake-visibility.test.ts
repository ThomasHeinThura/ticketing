import type { FormSchema } from "@taskdesk/domain";
import { describe, expect, it } from "vitest";
import { missingRequiredIntakeFields } from "./intake-validation";
import {
  isIntakeConditionSatisfied,
  resolveIntakeVisibility,
} from "./intake-visibility";

describe("request-type visibility parity", () => {
  it("RT-5: portal display and required validation share chained hidden-controller visibility", () => {
    const schema: FormSchema = {
      fields: [
        { key: "gate", type: "checkbox", label: "Gate" },
        {
          key: "controller",
          type: "select",
          label: "Controller",
          options: ["x", "y"],
          showIf: { field_key: "gate", op: "eq", value: true },
        },
        {
          key: "dependent",
          type: "text",
          label: "Dependent",
          required: true,
          showIf: { field_key: "controller", op: "neq", value: "x" },
        },
      ],
    };
    const staleDraft = { gate: false, controller: "x" };
    const visibility = resolveIntakeVisibility(schema, staleDraft);
    const renderedKeys = schema.fields
      .filter((field) => visibility.get(field.key) ?? true)
      .map((field) => field.key);

    expect(renderedKeys).toEqual(["gate", "dependent"]);
    expect(missingRequiredIntakeFields(schema, staleDraft)).toEqual([
      "dependent",
    ]);
    expect(
      schema.fields
        .filter((field) => visibility.get(field.key) ?? true)
        .filter((field) => field.key === "dependent").length,
    ).toBe(1);
  });

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
