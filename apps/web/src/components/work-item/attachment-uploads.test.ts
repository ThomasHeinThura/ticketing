import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const presign = vi.hoisted(() => vi.fn());
const complete = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/attachments", () => ({
  presignWorkItemAttachment: (...args: unknown[]) => presign(...args),
  completeWorkItemAttachment: (...args: unknown[]) => complete(...args),
}));

class SuccessfulUploadRequest {
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open() {}
  setRequestHeader() {}
  send() {
    this.upload.onprogress?.({
      lengthComputable: true,
      loaded: 1,
      total: 1,
    } as ProgressEvent);
    queueMicrotask(() => this.onload?.());
  }
  abort() {
    this.onabort?.();
  }
}

class HeldUploadRequest extends SuccessfulUploadRequest {
  static requests: HeldUploadRequest[] = [];
  constructor() {
    super();
    HeldUploadRequest.requests.push(this);
  }
  override send() {}
}

describe("work-item attachment upload lifecycle (AT-12/AT-13)", () => {
  beforeEach(() => {
    presign.mockReset();
    complete.mockReset();
    vi.stubGlobal("XMLHttpRequest", SuccessfulUploadRequest);
    presign.mockImplementation(async (input: { filename: string }) => {
      if (input.filename === "rejected.exe") {
        throw new Error("Executable files aren't allowed.");
      }
      return {
        uploadUrl: "https://storage.example/upload",
        uploadHeaders: { "Content-Type": "image/png" },
        attachmentId: `attachment-${input.filename}`,
      };
    });
    complete.mockResolvedValue({ id: "complete" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps an upload alive across subscriber navigation and reports each file outcome independently", async () => {
    const {
      enqueueAttachmentUploads,
      getWorkItemAttachmentUploadsSnapshot,
      subscribeAttachmentUploads,
    } = await import("./attachment-uploads");
    const workItemKey = `WI-${crypto.randomUUID()}`;
    const listener = vi.fn();
    const unsubscribe = subscribeAttachmentUploads(listener);
    const refresh = vi.fn();

    enqueueAttachmentUploads(
      workItemKey,
      [
        new File(["image"], "image.png", { type: "image/png" }),
        new File(["bad"], "rejected.exe", { type: "application/octet-stream" }),
      ],
      refresh,
    );
    unsubscribe();

    await vi.waitFor(() => {
      const uploads = getWorkItemAttachmentUploadsSnapshot(workItemKey);
      expect(uploads).toHaveLength(2);
      expect(uploads.map((upload) => upload.status).sort()).toEqual([
        "complete",
        "failed",
      ]);
    });

    const uploads = getWorkItemAttachmentUploadsSnapshot(workItemKey);
    expect(
      uploads.find((upload) => upload.filename === "rejected.exe")?.error,
    ).toBe("Executable files aren't allowed.");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();
  });

  it("warns before leaving and aborts the active transfer on pagehide (AT-13)", async () => {
    vi.stubGlobal("XMLHttpRequest", HeldUploadRequest);
    HeldUploadRequest.requests = [];
    presign.mockResolvedValue({
      uploadUrl: "https://storage.example/upload",
      uploadHeaders: { "Content-Type": "image/png" },
      attachmentId: "attachment-pending",
    });

    const { enqueueAttachmentUploads, getWorkItemAttachmentUploadsSnapshot } =
      await import("./attachment-uploads");
    const workItemKey = `WI-${crypto.randomUUID()}`;
    enqueueAttachmentUploads(workItemKey, [new File(["image"], "pending.png")]);
    await vi.waitFor(() => expect(HeldUploadRequest.requests).toHaveLength(1));

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => {
      const [upload] = getWorkItemAttachmentUploadsSnapshot(workItemKey);
      expect(upload?.status).toBe("failed");
      expect(upload?.cancellation).toBe("leaving-app");
    });
  });
});
