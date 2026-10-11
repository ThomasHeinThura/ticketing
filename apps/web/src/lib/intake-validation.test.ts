import { describe, expect, it } from "vitest";
import { missingRequiredIntakeFields } from "./intake-validation";

describe("portal required-field validation", () => {
  it("reports every visible blank required field and ignores hidden required fields", () => {
    const schema = {
      fields: [
        { key: "summary", type: "text", label: "Summary", required: true },
        {
          key: "details",
          type: "textarea",
          label: "Details",
          required: true,
        },
        {
          key: "category",
          type: "select",
          label: "Category",
          required: true,
          options: ["Access"],
        },
        {
          key: "other",
          type: "text",
          label: "Other",
          required: true,
          showIf: { field_key: "category", op: "eq", value: "Other" },
        },
      ],
    } as const;

    expect(
      missingRequiredIntakeFields(schema, {
        summary: "   ",
        details: "",
        category: "",
      }),
    ).toEqual(["summary", "details", "category"]);
  });

  it("does not report fields after a required selection is supplied", () => {
    const schema = {
      fields: [
        {
          key: "category",
          type: "select",
          label: "Category",
          required: true,
          options: ["Access"],
        },
      ],
    } as const;

    expect(missingRequiredIntakeFields(schema, { category: "Access" })).toEqual(
      [],
    );
  });
});
