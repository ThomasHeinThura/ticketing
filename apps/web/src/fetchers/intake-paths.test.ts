import { describe, expect, it } from "vitest";
import {
  portalSubmissionAttachmentDownloadPath,
  portalSubmissionAttachmentPreviewPath,
  staffSubmissionAttachmentDownloadPath,
  staffSubmissionAttachmentPreviewPath,
} from "./intake";

describe("submission attachment paths", () => {
  it("keeps portal preview and download on portal reach routes with encoded identifiers", () => {
    expect(portalSubmissionAttachmentPreviewPath("SUB/7", "file/1")).toBe(
      "/portal/submissions/SUB%2F7/attachments/file%2F1/preview",
    );
    expect(portalSubmissionAttachmentDownloadPath("SUB/7", "file/1")).toBe(
      "/portal/submissions/SUB%2F7/attachments/file%2F1",
    );
  });

  it("keeps staff preview and download on triage reach routes with encoded identifiers", () => {
    expect(staffSubmissionAttachmentPreviewPath("SUB/7", "file/1")).toBe(
      "/submissions/SUB%2F7/attachments/file%2F1/preview",
    );
    expect(staffSubmissionAttachmentDownloadPath("SUB/7", "file/1")).toBe(
      "/submissions/SUB%2F7/attachments/file%2F1",
    );
  });
});
