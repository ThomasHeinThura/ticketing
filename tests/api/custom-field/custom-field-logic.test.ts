import { describe, expect, it } from "vitest";
import {
  applicableFields,
  conditionRefusal,
  conditionSatisfied,
  defaultValueFor,
  type FieldDefinition,
  fieldsConditionedOn,
  formatChangeRefused,
  isValueSet,
  missingRequiredFields,
  parseVisibilityCondition,
  removedOptionKeys,
  transitionRequiresFields,
  validateFieldValue,
  validateOptions,
} from "../../../apps/api/src/custom-field/logic";

const field = (
  overrides: Partial<FieldDefinition> & { id: string; key: string },
): FieldDefinition => ({
  format: "text",
  options: [],
  defaultValue: null,
  visibilityCondition: null,
  ...overrides,
});

describe("validateFieldValue", () => {
  const opts = [
    { key: "low", label: "Low" },
    { key: "high", label: "High" },
  ];
  it("clears on null or blank for every format", () => {
    expect(validateFieldValue({ format: "number", options: [] }, null)).toEqual(
      {
        ok: true,
        value: null,
      },
    );
    expect(validateFieldValue({ format: "email", options: [] }, "  ")).toEqual({
      ok: true,
      value: null,
    });
  });
  it("limits text to 500 characters", () => {
    expect(
      validateFieldValue({ format: "text", options: [] }, "a".repeat(501)).ok,
    ).toBe(false);
    expect(
      validateFieldValue({ format: "text", options: [] }, "a".repeat(500)).ok,
    ).toBe(true);
  });
  it("number is an integer, decimal any finite number", () => {
    expect(validateFieldValue({ format: "number", options: [] }, 1.5).ok).toBe(
      false,
    );
    expect(validateFieldValue({ format: "number", options: [] }, 7).ok).toBe(
      true,
    );
    expect(validateFieldValue({ format: "decimal", options: [] }, 1.5).ok).toBe(
      true,
    );
    expect(
      validateFieldValue({ format: "decimal", options: [] }, Number.NaN).ok,
    ).toBe(false);
  });
  it("currency needs an amount and a capital three-letter code", () => {
    const f = { format: "currency" as const, options: [] };
    expect(validateFieldValue(f, { amount: 10, currency: "USD" }).ok).toBe(
      true,
    );
    expect(validateFieldValue(f, { amount: 10, currency: "usd" }).ok).toBe(
      false,
    );
    expect(validateFieldValue(f, 10).ok).toBe(false);
  });
  it("date is a real calendar date; datetime needs an offset and is normalised", () => {
    expect(
      validateFieldValue({ format: "date", options: [] }, "2026-02-30").ok,
    ).toBe(false);
    expect(
      validateFieldValue({ format: "date", options: [] }, "2026-02-28").ok,
    ).toBe(true);
    const f = { format: "datetime" as const, options: [] };
    expect(validateFieldValue(f, "2026-10-23T10:00:00").ok).toBe(false);
    expect(validateFieldValue(f, "2026-10-23T10:00:00+02:00")).toEqual({
      ok: true,
      value: "2026-10-23T08:00:00.000Z",
    });
  });
  it("select and multi_select only accept defined option keys", () => {
    expect(
      validateFieldValue({ format: "select", options: opts }, "low").ok,
    ).toBe(true);
    expect(
      validateFieldValue({ format: "select", options: opts }, "mid").ok,
    ).toBe(false);
    expect(
      validateFieldValue({ format: "multi_select", options: opts }, [
        "low",
        "low",
        "high",
      ]),
    ).toEqual({ ok: true, value: ["low", "high"] });
    expect(
      validateFieldValue({ format: "multi_select", options: opts }, ["x"]).ok,
    ).toBe(false);
  });
  it("url allows only http(s); email is validated", () => {
    expect(
      validateFieldValue({ format: "url", options: [] }, "javascript:alert(1)")
        .ok,
    ).toBe(false);
    expect(
      validateFieldValue(
        { format: "url", options: [] },
        "https://example.com/a",
      ).ok,
    ).toBe(true);
    expect(
      validateFieldValue({ format: "email", options: [] }, "nope").ok,
    ).toBe(false);
  });
  it("boolean must be a boolean", () => {
    expect(
      validateFieldValue({ format: "boolean", options: [] }, "true").ok,
    ).toBe(false);
    expect(
      validateFieldValue({ format: "boolean", options: [] }, false),
    ).toEqual({
      ok: true,
      value: false,
    });
  });
});

describe("options (CF-7) and format lock (CF-9)", () => {
  it("requires options only for select formats and unique stable keys", () => {
    expect(validateOptions("select", [])).not.toBeNull();
    expect(validateOptions("text", [{ key: "a", label: "A" }])).not.toBeNull();
    expect(validateOptions("text", [])).toBeNull();
    expect(
      validateOptions("select", [
        { key: "a", label: "A" },
        { key: "a", label: "Other" },
      ]),
    ).toMatch(/Duplicate/);
    expect(validateOptions("select", [{ key: "A b", label: "A" }])).toMatch(
      /key/,
    );
  });
  it("renaming a label keeps the key; removing a key is reported", () => {
    expect(
      removedOptionKeys(
        [
          { key: "a", label: "A" },
          { key: "b", label: "B" },
        ],
        [{ key: "a", label: "Renamed" }],
      ),
    ).toEqual(["b"]);
  });
  it("refuses a format change", () => {
    expect(formatChangeRefused("text", "number")).toBe(true);
    expect(formatChangeRefused("text", "text")).toBe(false);
    expect(formatChangeRefused("text", undefined)).toBe(false);
  });
});

describe("conditional visibility (CF-6)", () => {
  it("parses the contract shape and rejects others", () => {
    expect(
      parseVisibilityCondition({ field_key: "risk", op: "eq", value: "high" }),
    ).toEqual({ field_key: "risk", op: "eq", value: "high" });
    expect(
      parseVisibilityCondition({ field_key: "risk", op: "is_set" }),
    ).toEqual({
      field_key: "risk",
      op: "is_set",
    });
    expect(
      parseVisibilityCondition({ field_key: "risk", op: "in", value: 1 }),
    ).toBe("invalid");
    expect(
      parseVisibilityCondition({ field_key: "r", op: "gt", value: 1 }),
    ).toBe("invalid");
    expect(parseVisibilityCondition(null)).toBeNull();
  });
  it("evaluates eq, neq, in and is_set", () => {
    const values = { risk: "high", tags: ["a", "b"], note: "" };
    expect(
      conditionSatisfied(
        { field_key: "risk", op: "eq", value: "high" },
        values,
      ),
    ).toBe(true);
    expect(
      conditionSatisfied(
        { field_key: "risk", op: "neq", value: "high" },
        values,
      ),
    ).toBe(false);
    expect(
      conditionSatisfied(
        { field_key: "risk", op: "in", value: ["low", "high"] },
        values,
      ),
    ).toBe(true);
    expect(
      conditionSatisfied({ field_key: "tags", op: "in", value: ["b"] }, values),
    ).toBe(true);
    expect(
      conditionSatisfied({ field_key: "note", op: "is_set" }, values),
    ).toBe(false);
    expect(conditionSatisfied(null, {})).toBe(true);
  });
  it("is single level", () => {
    const others = [
      field({ id: "1", key: "risk" }),
      field({
        id: "2",
        key: "nested",
        visibilityCondition: { field_key: "risk", op: "is_set" },
      }),
    ];
    expect(
      conditionRefusal(
        { key: "x" },
        { field_key: "risk", op: "is_set" },
        others,
      ),
    ).toBeNull();
    expect(
      conditionRefusal(
        { key: "x" },
        { field_key: "nested", op: "is_set" },
        others,
      ),
    ).toMatch(/conditional/);
    expect(
      conditionRefusal({ key: "x" }, { field_key: "x", op: "is_set" }, others),
    ).toMatch(/itself/);
    // `risk` controls `nested`, so `risk` may not become conditional.
    expect(
      conditionRefusal({ key: "risk" }, { field_key: "other", op: "is_set" }, [
        ...others,
        field({ id: "3", key: "other" }),
      ]),
    ).toMatch(/depend/);
    expect(fieldsConditionedOn("risk", others)).toEqual(["nested"]);
  });
});

describe("applicability and required gate (CF-2, CF-3, CF-4)", () => {
  const fields = [
    field({ id: "a", key: "asset_tag" }),
    field({ id: "b", key: "cost_centre" }),
    field({
      id: "c",
      key: "rollback",
      visibilityCondition: { field_key: "risk", op: "eq", value: "high" },
    }),
    field({ id: "d", key: "risk", format: "select" }),
  ];
  const visibility = new Map([
    ["a", { visible: true, required: true }],
    ["c", { visible: true, required: true }],
    ["d", { visible: true, required: false }],
  ]);

  it("omits fields not visible for the type", () => {
    expect(applicableFields(fields, visibility, {}).map((f) => f.key)).toEqual([
      "asset_tag",
      "rollback",
      "risk",
    ]);
  });
  it("lists empty required shown fields; unmet conditional is not required", () => {
    expect(missingRequiredFields(fields, visibility, {})).toEqual([
      "asset_tag",
    ]);
    expect(
      missingRequiredFields(fields, visibility, {
        asset_tag: "X1",
        risk: "high",
      }),
    ).toEqual(["rollback"]);
    expect(
      missingRequiredFields(fields, visibility, {
        asset_tag: "X1",
        risk: "low",
      }),
    ).toEqual([]);
  });
  it("gates started and completed but never cancelled", () => {
    expect(transitionRequiresFields("started")).toBe(true);
    expect(transitionRequiresFields("completed")).toBe(true);
    expect(transitionRequiresFields("cancelled")).toBe(false);
    expect(transitionRequiresFields("unstarted")).toBe(false);
  });
  it("treats blanks and empty lists as unset", () => {
    expect(isValueSet("")).toBe(false);
    expect(isValueSet([])).toBe(false);
    expect(isValueSet(0)).toBe(true);
    expect(isValueSet(false)).toBe(true);
  });
});

describe("defaults (CF-5)", () => {
  it("uses a valid default and ignores an invalid one", () => {
    expect(
      defaultValueFor(
        field({ id: "1", key: "n", format: "number", defaultValue: 3 }),
      ),
    ).toBe(3);
    expect(
      defaultValueFor(
        field({ id: "1", key: "n", format: "number", defaultValue: "x" }),
      ),
    ).toBeNull();
  });
});
