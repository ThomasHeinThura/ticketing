import { describe, expect, it } from "vitest";
import {
  assignOptionKeys,
  conditionSatisfied,
  fieldsForType,
  formatValue,
  missingRequired,
  slugifyFieldKey,
} from "./custom-field";

const field = (
  key: string,
  visibility: { workItemTypeId: string; visible: boolean; required: boolean }[],
  condition: Parameters<typeof conditionSatisfied>[0] = null,
) => ({
  id: key,
  key,
  position: 0,
  sectionId: "s",
  visibilityCondition: condition,
  visibility,
});

describe("custom field helpers", () => {
  it("offers only fields visible for the type (CF-3) and carries requiredness", () => {
    const fields = [
      field("a", [{ workItemTypeId: "t1", visible: true, required: true }]),
      field("b", [{ workItemTypeId: "t1", visible: false, required: false }]),
      field("c", [{ workItemTypeId: "t2", visible: true, required: false }]),
    ];
    expect(fieldsForType(fields, "t1").map((f) => [f.key, f.required])).toEqual(
      [["a", true]],
    );
  });

  it("evaluates conditions and ignores a hidden required field (CF-6)", () => {
    const condition = { field_key: "risk", op: "eq" as const, value: "high" };
    expect(conditionSatisfied(condition, { risk: "high" })).toBe(true);
    expect(conditionSatisfied(condition, { risk: "low" })).toBe(false);
    const fields = [
      { key: "rollback", required: true, visibilityCondition: condition },
    ];
    expect(missingRequired(fields, { risk: "low" })).toEqual([]);
    expect(missingRequired(fields, { risk: "high" })).toEqual(["rollback"]);
    expect(missingRequired(fields, { risk: "high", rollback: "plan" })).toEqual(
      [],
    );
  });

  it("slugifies keys and gives new options stable unique keys (CF-7)", () => {
    expect(slugifyFieldKey("Asset tag")).toBe("asset_tag");
    expect(slugifyFieldKey("2nd site")).toBe("f_2nd_site");
    expect(slugifyFieldKey("   ")).toBe("");
    expect(
      assignOptionKeys([
        { key: "low", label: "Low (renamed)" },
        { key: null, label: "Very high" },
        { key: null, label: "Very high" },
      ]),
    ).toEqual([
      { key: "low", label: "Low (renamed)" },
      { key: "very-high", label: "Very high" },
      { key: "very-high-2", label: "Very high" },
    ]);
  });

  it("renders select values through their labels", () => {
    const select = {
      format: "select" as const,
      options: [{ key: "low", label: "Low" }],
    };
    expect(formatValue(select, "low")).toBe("Low");
    expect(formatValue(select, null)).toBe("");
  });
});
