import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("./work-item-attachments", () => ({
  resumeWorkItemAttachment: mocks.resume,
}));

import { HttpError } from "@/lib/http-error";
import {
  dismissWorkItemUpload,
  enqueueWorkItemUploads,
  getWorkItemUploads,
  resetWorkItemUploads,
  retryWorkItemUpload,
} from "./work-item-upload-queue";

type Deferred = {
  resolve: (value?: unknown) => void;
  reject: (reason: unknown) => void;
  progress?: (loaded: number, total: number) => void;
  checkpoint?: (value: unknown) => void;
  options?: { commentId?: string };
};

const pending: Deferred[] = [];
function file(name: string, content = "bytes") {
  return new File([content], name, { type: "text/plain" });
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  pending.length = 0;
  resetWorkItemUploads();
  mocks.resume.mockReset().mockImplementation(
    (
      _key: string,
      _file: File,
      _checkpoint: unknown,
      onCheckpoint: (value: unknown) => void,
      options: Deferred["options"] & {
        onProgress?: (loaded: number, total: number) => void;
      },
    ) =>
      new Promise((resolve, reject) => {
        pending.push({
          resolve,
          reject,
          progress: options?.onProgress,
          checkpoint: onCheckpoint,
          options,
        });
      }),
  );
});
afterEach(() => resetWorkItemUploads());

describe("AT-12 upload queue", () => {
  it("uploads at most three files at once and starts the next as one finishes", async () => {
    enqueueWorkItemUploads({
      itemKey: "OPS-1",
      files: ["a", "b", "c", "d", "e"].map((name) => file(name)),
    });
    await flush();
    expect(mocks.resume).toHaveBeenCalledTimes(3);
    expect(getWorkItemUploads().map((upload) => upload.state)).toEqual([
      "uploading",
      "uploading",
      "uploading",
      "queued",
      "queued",
    ]);
    pending[0]?.resolve();
    await flush();
    expect(mocks.resume).toHaveBeenCalledTimes(4);
    // The finished file leaves the queue: its persisted row is the list's job now.
    expect(getWorkItemUploads()).toHaveLength(4);
  });

  it("reports each file's own byte progress", async () => {
    enqueueWorkItemUploads({ itemKey: "OPS-1", files: [file("a"), file("b")] });
    await flush();
    pending[1]?.progress?.(3, 5);
    const [first, second] = getWorkItemUploads();
    expect(first?.loaded).toBe(0);
    expect(second?.loaded).toBe(3);
  });

  it("one failure does not abandon the batch, shows its own reason, and keeps the signed checkpoint for a same-ID retry", async () => {
    const done = vi.fn();
    enqueueWorkItemUploads({
      itemKey: "OPS-1",
      files: [file("bad.exe"), file("good.txt")],
      onDone: done,
    });
    await flush();
    pending[0]?.checkpoint?.({ attachmentId: "att-1" });
    pending[0]?.reject(new HttpError(400, '".exe" files aren\'t allowed.'));
    pending[1]?.resolve();
    await flush();
    const remaining = getWorkItemUploads();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      state: "failed",
      reason: '".exe" files aren\'t allowed.',
      checkpoint: { attachmentId: "att-1" },
    });
    expect(done).toHaveBeenCalledTimes(2);

    retryWorkItemUpload(remaining[0]?.id ?? -1);
    await flush();
    expect(mocks.resume).toHaveBeenCalledTimes(3);
    expect(mocks.resume.mock.calls[2]?.[2]).toEqual({ attachmentId: "att-1" });
  });

  it("never shows a server-side failure's text and marks empty files without contacting the API", async () => {
    enqueueWorkItemUploads({
      itemKey: "OPS-1",
      files: [file("empty.txt", "")],
    });
    await flush();
    expect(mocks.resume).not.toHaveBeenCalled();
    expect(getWorkItemUploads()[0]).toMatchObject({
      state: "failed",
      empty: true,
    });
    dismissWorkItemUpload(getWorkItemUploads()[0]?.id ?? -1);
    expect(getWorkItemUploads()).toHaveLength(0);
    enqueueWorkItemUploads({ itemKey: "OPS-1", files: [file("a")] });
    await flush();
    pending[0]?.reject(new HttpError(503, "storage exploded"));
    await flush();
    expect(getWorkItemUploads()[0]?.reason).toBeUndefined();
  });

  it("targets a comment when asked and continues without any component mounted (AT-13)", async () => {
    enqueueWorkItemUploads({
      itemKey: "OPS-1",
      commentId: "comment-9",
      files: [file("a")],
    });
    await flush();
    expect(pending[0]?.options?.commentId).toBe("comment-9");
    expect(getWorkItemUploads()[0]?.commentId).toBe("comment-9");
  });

  it("warns before the user leaves the app only while uploads are active (AT-13)", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    enqueueWorkItemUploads({ itemKey: "OPS-1", files: [file("a")] });
    await flush();
    expect(add).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    const handler = add.mock.calls.find(
      ([name]) => name === "beforeunload",
    )?.[1] as (event: BeforeUnloadEvent) => void;
    const event = new Event("beforeunload", {
      cancelable: true,
    }) as BeforeUnloadEvent;
    handler(event);
    expect(event.defaultPrevented).toBe(true);
    pending[0]?.resolve();
    await flush();
    expect(remove).toHaveBeenCalledWith("beforeunload", handler);
    // A failed upload no longer blocks leaving: there is nothing in flight.
    enqueueWorkItemUploads({ itemKey: "OPS-1", files: [file("b")] });
    await flush();
    pending[1]?.reject(new Error("offline"));
    await flush();
    expect(remove).toHaveBeenCalledTimes(2);
    add.mockRestore();
    remove.mockRestore();
  });
});
