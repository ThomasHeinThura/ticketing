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
});
