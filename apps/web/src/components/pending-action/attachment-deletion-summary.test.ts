import { describe, expect, it } from "vitest";
import { parseAttachmentDeletionSummary } from "./attachment-deletion-summary";

const summary = {
  attachmentId: "file-a",
  filename: "certificate.pdf",
  mimeType: "application/pdf",
  size: 2048,
  key: "HELP-4",
  title: "Certificate rotation",
  recoveryHours: 24,
  alreadyDeleted: false,
};

describe("attachment deletion confirmation projection", () => {
  it("shows exact file metadata without projecting storage locators", () => {
    expect(
      parseAttachmentDeletionSummary({
        ...summary,
        objectKey: "private-locator",
        downloadUrl: "private-url",
      }),
    ).toEqual(summary);
  });
  it.each([
    { redacted: true },
    { attachmentId: "" },
    { filename: "" },
    { size: -1 },
    { size: Number.NaN },
    { size: 1.5 },
    { recoveryHours: 23 },
    { key: "unknown" },
    { title: "" },
  ])("refuses incomplete or redacted confirmation: %j", (delta) => {
    expect(parseAttachmentDeletionSummary({ ...summary, ...delta })).toBeNull();
  });
});
