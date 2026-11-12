import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../apps/api/src/attachment/repository", () => ({}));

import { parseAttachmentFormSchema } from "../../apps/api/src/attachment/controllers/presign-submission-attachment";

describe("attachment form snapshot parsing", () => {
  const valid = {
    fields: [
      { key: "gate", type: "checkbox", label: "Gate" },
      {
        key: "file",
        type: "file",
        label: "File",
        showIf: { field_key: "gate", op: "eq", value: false },
      },
    ],
  };
  it("accepts a valid conditional form", () => {
    expect(parseAttachmentFormSchema(valid)).toEqual(valid);
  });
  it("rejects malformed snapshots and invalid condition values", () => {
    expect(parseAttachmentFormSchema(null)).toBeNull();
    expect(parseAttachmentFormSchema({ fields: [null] })).toBeNull();
    expect(
      parseAttachmentFormSchema({
        fields: [
          {
            key: "file",
            type: "file",
            label: "File",
            showIf: { field_key: "gate", op: "eq", value: { nested: true } },
          },
        ],
      }),
    ).toBeNull();
  });

  it("reads a version published by an older build that the editor schema would refuse", () => {
    const legacy = {
      fields: [
        // A blank label, an unknown property and an out-of-range option list: all readable.
        { key: "gate", type: "checkbox", label: "", placeholder: "old" },
        {
          key: "file",
          type: "file",
          label: "File",
          extra: { anything: true },
          showIf: { field_key: "gate", op: "eq", value: "true" },
        },
        { key: "kind", type: "select", label: "Kind", options: [] },
      ],
      version: 3,
    };
    const parsed = parseAttachmentFormSchema(legacy);
    expect(parsed?.fields.map((field) => field.key)).toEqual([
      "gate",
      "file",
      "kind",
    ]);
    // The same repair as everywhere else: the text "true" on a checkbox controller is true.
    expect(parsed?.fields[1]?.showIf?.value).toBe(true);
  });

  it("repairs the empty-string condition left on a checkbox controller", () => {
    const parsed = parseAttachmentFormSchema({
      fields: [
        { key: "gate", type: "checkbox", label: "Gate" },
        {
          key: "file",
          type: "file",
          label: "File",
          showIf: { field_key: "gate", op: "eq", value: "" },
        },
      ],
    });
    expect(parsed?.fields[1]?.showIf?.value).toBe(false);
    // Idempotent: reading the repaired snapshot again changes nothing.
    expect(parseAttachmentFormSchema(parsed)).toEqual(parsed);
  });

  it("refuses only what the visibility rules cannot read", () => {
    expect(parseAttachmentFormSchema(undefined)).toBeNull();
    expect(parseAttachmentFormSchema([])).toBeNull();
    expect(parseAttachmentFormSchema({})).toBeNull();
    expect(parseAttachmentFormSchema({ fields: "text" })).toBeNull();
    expect(
      parseAttachmentFormSchema({ fields: [{ type: "file" }] }),
    ).toBeNull();
    expect(parseAttachmentFormSchema({ fields: [{ key: "a" }] })).toBeNull();
    expect(
      parseAttachmentFormSchema({
        fields: [{ key: "a", type: "file", showIf: "gate" }],
      }),
    ).toBeNull();
    expect(parseAttachmentFormSchema({ fields: [] })).toEqual({ fields: [] });
  });
});
