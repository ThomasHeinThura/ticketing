import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  list: vi.fn(),
  presign: vi.fn(),
  complete: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@taskdesk/libs", () => ({
  client: {
    "work-items": {
      ":key": {
        attachments: { $get: mocks.list, presign: { $post: mocks.presign } },
      },
    },
    attachments: {
      ":id": { $delete: mocks.remove, complete: { $post: mocks.complete } },
    },
  },
}));

import {
  requestAttachmentDeletion,
  resumeWorkItemAttachment,
  uploadWorkItemAttachment,
} from "./work-item-attachments";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => {
    mock.mockReset();
  });
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.presign.mockResolvedValue(
    Response.json({
      attachmentId: "file-1",
      uploadUrl: "https://storage.invalid/put",
      uploadHeaders: {},
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("attachment durable deletion fetcher", () => {
  it("requires202 with a concrete pending action and preserves exact ID encoding through the typed client", async () => {
    mocks.remove.mockResolvedValue(
      Response.json({ pendingActionId: "pa-1" }, { status: 202 }),
    );
    expect(await requestAttachmentDeletion("file/1")).toEqual({
      pendingActionId: "pa-1",
    });
    expect(mocks.remove).toHaveBeenCalledWith({ param: { id: "file/1" } });
  });
  it("reopens the requester's existing pending action on a repeated request", async () => {
    mocks.remove.mockResolvedValue(
      new Response("pending_approval: pa-existing", { status: 409 }),
    );
    expect(await requestAttachmentDeletion("file-1")).toEqual({
      pendingActionId: "pa-existing",
    });
  });
  it.each([200, 403, 404, 409])(
    "rejects status%s including obsolete direct success",
    async (status) => {
      mocks.remove.mockResolvedValue(
        Response.json({ state: "deleted" }, { status }),
      );
      await expect(requestAttachmentDeletion("file-1")).rejects.toMatchObject({
        status,
      });
    },
  );
  it.each([{}, { pendingActionId: "" }, { pendingActionId: 1 }])(
    "rejects malformed accepted response%j",
    async (body) => {
      mocks.remove.mockResolvedValue(Response.json(body, { status: 202 }));
      await expect(requestAttachmentDeletion("file-1")).rejects.toThrow(
        "Missing pending action reference",
      );
    },
  );
  it.each(["network", "refused"])(
    "a failed PUT (%s) never creates an unseen deletion approval",
    async (mode) => {
      if (mode === "network")
        mocks.fetch.mockRejectedValue(new Error("offline"));
      else mocks.fetch.mockResolvedValue(new Response(null, { status: 403 }));
      await expect(
        uploadWorkItemAttachment(
          "HELP-4",
          new File(["bytes"], "proof.pdf", { type: "application/pdf" }),
        ),
      ).rejects.toThrow();
      expect(mocks.remove).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
    },
  );
});

const checkpoint = {
  attachmentId: "known-id",
  uploadUrl: "https://signed.invalid/put",
  uploadHeaders: { "x-signed": "exact" },
  uploaded: true,
};
it("reconciles the exact ready ID after an ambiguous completion without another PUT or presign", async () => {
  mocks.list.mockResolvedValue(
    Response.json([{ id: "known-id", state: "ready" }]),
  );
  expect(
    await resumeWorkItemAttachment(
      "HELP-1",
      new File(["a"], "same.txt"),
      checkpoint,
      vi.fn(),
    ),
  ).toMatchObject({ id: "known-id" });
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.presign).not.toHaveBeenCalled();
  expect(mocks.complete).not.toHaveBeenCalled();
});
it("retries completion for the same pending ID and never guesses by filename", async () => {
  mocks.list.mockResolvedValue(
    Response.json([
      { id: "other-id", state: "ready", filename: "same.txt" },
      { id: "known-id", state: "pending" },
    ]),
  );
  mocks.complete.mockResolvedValue(
    Response.json({ id: "known-id", state: "ready" }),
  );
  await resumeWorkItemAttachment(
    "HELP-1",
    new File(["a"], "same.txt"),
    checkpoint,
    vi.fn(),
  );
  expect(mocks.complete).toHaveBeenCalledWith({ param: { id: "known-id" } });
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("retains the signed checkpoint across a failed PUT for a same-ID retry", async () => {
  const save = vi.fn();
  const file = new File(["a"], "a.txt");
  mocks.fetch.mockRejectedValueOnce(new Error("offline"));
  await expect(
    resumeWorkItemAttachment("HELP-1", file, undefined, save),
  ).rejects.toThrow("offline");
  const saved = save.mock.calls[0]?.[0];
  mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 200 }));
  mocks.complete.mockResolvedValueOnce(
    Response.json({ id: "file-1", state: "ready" }),
  );
  await resumeWorkItemAttachment("HELP-1", file, saved, save);
  expect(mocks.presign).toHaveBeenCalledTimes(1);
  expect(mocks.fetch).toHaveBeenLastCalledWith(saved.uploadUrl, {
    method: "PUT",
    headers: saved.uploadHeaders,
    body: file,
  });
});

describe("AT-1 comment target and AT-12 byte progress", () => {
  it("presigns against a comment only when one is named", async () => {
    mocks.fetch.mockImplementation(
      async () => new Response(null, { status: 200 }),
    );
    mocks.complete.mockImplementation(async () =>
      Response.json({ id: "file-1", state: "ready" }),
    );
    const file = new File(["a"], "a.txt");
    await resumeWorkItemAttachment("HELP-1", file, undefined, vi.fn(), {
      commentId: "comment-1",
    });
    expect(mocks.presign.mock.calls[0]?.[0]).toMatchObject({
      param: { key: "HELP-1" },
      json: { filename: "a.txt", commentId: "comment-1" },
    });
    mocks.presign.mockClear();
    mocks.presign.mockImplementation(async () =>
      Response.json({
        attachmentId: "file-2",
        uploadUrl: "https://storage.invalid/put",
        uploadHeaders: {},
      }),
    );
    await resumeWorkItemAttachment("HELP-1", file, undefined, vi.fn());
    expect(mocks.presign.mock.calls[0]?.[0].json).not.toHaveProperty(
      "commentId",
    );
  });

  class FakeRequest {
    static last: FakeRequest;
    status = 200;
    headers: Record<string, string> = {};
    upload: { onprogress?: (event: unknown) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    method = "";
    url = "";
    body: unknown;
    constructor() {
      FakeRequest.last = this;
    }
    static reset() {
      FakeRequest.last = undefined as unknown as FakeRequest;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(body: unknown) {
      this.body = body;
    }
  }

  it("reports upload bytes through XHR when progress is requested, using the signed headers", async () => {
    FakeRequest.reset();
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    mocks.complete.mockResolvedValue(
      Response.json({ id: "file-1", state: "ready" }),
    );
    mocks.presign.mockResolvedValue(
      Response.json({
        attachmentId: "file-1",
        uploadUrl: "https://storage.invalid/put?token=secret",
        uploadHeaders: { "content-type": "text/plain" },
      }),
    );
    const onProgress = vi.fn();
    const file = new File(["abcd"], "a.txt");
    const done = resumeWorkItemAttachment("HELP-1", file, undefined, vi.fn(), {
      onProgress,
    });
    await vi.waitFor(() => expect(FakeRequest.last?.body).toBe(file));
    expect(FakeRequest.last.method).toBe("PUT");
    expect(FakeRequest.last.headers).toEqual({ "content-type": "text/plain" });
    FakeRequest.last.upload.onprogress?.({
      lengthComputable: true,
      loaded: 2,
      total: 4,
    });
    FakeRequest.last.onload?.();
    await done;
    expect(onProgress).toHaveBeenNthCalledWith(1, 2, 4);
    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("a refused XHR PUT is an HttpError that never contains the signed URL", async () => {
    FakeRequest.reset();
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    mocks.presign.mockResolvedValue(
      Response.json({
        attachmentId: "file-1",
        uploadUrl: "https://storage.invalid/put?token=secret",
        uploadHeaders: {},
      }),
    );
    const done = resumeWorkItemAttachment(
      "HELP-1",
      new File(["a"], "a.txt"),
      undefined,
      vi.fn(),
      { onProgress: vi.fn() },
    );
    await vi.waitFor(() => expect(FakeRequest.last?.url).toBeTruthy());
    FakeRequest.last.status = 403;
    FakeRequest.last.onload?.();
    const error = await done.catch((reason: unknown) => reason);
    expect(error).toMatchObject({ status: 403 });
    expect(String((error as Error).message)).not.toContain("secret");
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
