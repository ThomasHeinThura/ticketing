import { describe, expect, it } from "vitest";
import {
  missingRequiredIntakeFields,
  submissionAnswerRows,
} from "./intake-validation";

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

  it("counts a required file field as answered only when files are staged for it", () => {
    const schema = {
      fields: [
        { key: "evidence", type: "file", label: "Evidence", required: true },
        {
          key: "hiddenFile",
          type: "file",
          label: "Hidden",
          required: true,
          showIf: { field_key: "evidence", op: "eq", value: "never" },
        },
      ],
    } as const;

    expect(missingRequiredIntakeFields(schema, {})).toEqual(["evidence"]);
    expect(
      missingRequiredIntakeFields(schema, {}, (key) => key === "evidence"),
    ).toEqual([]);
  });
});

describe("immutable submission answer labels", () => {
  it("uses the version's labels and never shows a key the version does not declare", () => {
    expect(
      submissionAnswerRows([{ key: "field_1", label: "New question" }], {
        field_1: "Printer jam",
        legacy_key: "Other",
      }),
    ).toEqual([
      { key: "field_1", label: "New question", value: "Printer jam" },
    ]);
  });

  it("lists answers in the form's field order, not the order they were stored in", () => {
    expect(
      submissionAnswerRows(
        [
          { key: "summary", label: "Short summary" },
          { key: "details", label: "What happened?" },
        ],
        { details: "It stopped", legacy: "x", summary: "VPN down" },
      ).map((row) => row.label),
    ).toEqual(["Short summary", "What happened?"]);
  });

  it("falls back to the key when a declared field has no label", () => {
    expect(
      submissionAnswerRows([{ key: "field_1", label: "" }], { field_1: "x" }),
    ).toEqual([{ key: "field_1", label: "field_1", value: "x" }]);
  });

  it("hides the answer of a field that is hidden for these answers", () => {
    const fields = [
      { key: "gate", label: "Hardware?", type: "checkbox" },
      {
        key: "serial",
        label: "Serial",
        type: "text",
        showIf: { field_key: "gate", op: "eq", value: true },
      },
    ];
    expect(
      submissionAnswerRows(fields, { gate: false, serial: "smuggled" }).map(
        (row) => row.key,
      ),
    ).toEqual(["gate"]);
    expect(
      submissionAnswerRows(fields, { gate: true, serial: "SN-1" }).map(
        (row) => row.value,
      ),
    ).toEqual(["true", "SN-1"]);
  });

  it("repairs a checkbox condition stored as text, as the server does", () => {
    const fields = [
      { key: "gate", label: "Gate", type: "checkbox" },
      {
        key: "detail",
        label: "Detail",
        type: "text",
        showIf: { field_key: "gate", op: "eq", value: "true" },
      },
    ];
    expect(
      submissionAnswerRows(fields, { gate: true, detail: "kept" }).map(
        (row) => row.key,
      ),
    ).toEqual(["gate", "detail"]);
    expect(
      submissionAnswerRows(fields, { gate: false, detail: "hidden" }).map(
        (row) => row.key,
      ),
    ).toEqual(["gate"]);
  });

  it("never shows a file field or a missing or non-object answer set", () => {
    expect(
      submissionAnswerRows([{ key: "upload", label: "Upload", type: "file" }], {
        upload: "forged",
      }),
    ).toEqual([]);
    expect(submissionAnswerRows([{ key: "a", label: "A" }], undefined)).toEqual(
      [],
    );
    expect(submissionAnswerRows(undefined, { a: "x" })).toEqual([]);
    expect(
      submissionAnswerRows([{ key: "a", label: "A" }], "plain text" as never),
    ).toEqual([]);
  });
});
